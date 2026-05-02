/**
 * Club calendar styling defaults — V 2.0.636
 *
 * Helpers to assign sensible per-club calendar_color and calendar_abbrev
 * values automatically. Used in two places:
 *
 *   - Backfill on server startup: any club where calendar_color or
 *     calendar_abbrev is NULL gets defaults filled in. Existing values
 *     are NEVER overwritten — admin choices always win.
 *
 *   - On club creation (POST /api/clubs): a brand-new club is styled
 *     immediately so the calendar grid views look right out of the box,
 *     including the FFB-seeded clubs of newly onboarded CDBs.
 *
 * The palette is a fixed cycle of 12 distinguishable pastels — assigned
 * deterministically in alphabetical order of clubs.display_name within
 * each organization. Re-running the backfill produces the same mapping.
 *
 * The abbreviation algorithm prefers a clean 2-letter prefix and
 * disambiguates collisions (Clamart / Clichy / Courbevoie all "Cl"
 * before disambiguation) by extending to 3 chars, then to "first letter
 * + last word's first letter" (CC for Cercle Clichy).
 */

// V 2.0.638 — Palette presets. Each is a 12-colour cycle of light
// backgrounds suitable for black text (auto-contrast logic switches to
// white text when the YIQ luminance drops, so even saturated values work).
//
// Per-CDB choice is stored in organization_settings.club_calendar_palette
// (default 'pastel'). Admins can switch the active palette in
// Paramètres → Calendrier; calling backfillDefaults afterwards repaints
// the gaps in the new palette.
const PALETTES = {
  pastel: [
    '#d4edda', '#d4e6f7', '#fce4d3', '#e6dcf2',
    '#fff4c2', '#ffe0e0', '#d4f1e8', '#fde4f0',
    '#e0e7ff', '#fff4e0', '#e0f4d4', '#f0d4f0'
  ],
  vif: [
    // brighter saturation, still light enough for black text
    '#a8e6cf', '#a0c4ff', '#ffb380', '#c8a2db',
    '#ffeb99', '#ffb3b3', '#a3e4d7', '#f8b6d2',
    '#bdb2ff', '#ffd6a5', '#caffbf', '#e0bbf0'
  ],
  monochrome: [
    // shades of the app primary purple, gradient feel
    '#ece4f5', '#dbcdee', '#cab6e6', '#b89edd',
    '#a787d4', '#9670cc', '#a787d4', '#cab6e6',
    '#e3d8ef', '#f1ebf7', '#ddd0ee', '#c3aae0'
  ]
};
// Back-compat alias for any caller still referencing DEFAULT_PALETTE.
const DEFAULT_PALETTE = PALETTES.pastel;

// Strip extraneous prefix words from billiards club names so the
// abbreviation reflects the city, not the boilerplate "Billard Club".
const NOISE_WORDS = new Set([
  'BILLARD', 'BILLARDS', 'CLUB', 'ASSOCIATION', 'ACADEMIE', 'ACADÉMIE',
  'CERCLE', 'ENTENTE', 'COMPAGNIE', 'AMICALE', 'A', 'AB', 'BC', 'CB',
  'DE', 'DES', 'DU', 'LA', 'LE', 'LES', 'L', 'D'
]);

/**
 * Strip diacritics so abbreviation comparisons are stable.
 *   "Châtillon" → "CHATILLON"
 */
function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/**
 * Pick the "core" word(s) of a club display_name by dropping the noise
 * prefix words listed above. Falls back to the original name if every
 * word is noise.
 */
function coreWords(displayName) {
  const words = stripAccents(displayName)
    .replace(/[^A-Z0-9\s\-/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter(w => !NOISE_WORDS.has(w) && w.length > 1);
  return meaningful.length > 0 ? meaningful : words;
}

/**
 * Build a candidate abbreviation of the requested length from the
 * core words, capitalized like a name.
 *   coreWords = ["CLAMART"], len=2  → "Cl"
 *   coreWords = ["CLAMART"], len=3  → "Cla"
 *   coreWords = ["BOIS","COLOMBES"], len=2 → "BC"
 *   coreWords = ["BOIS","COLOMBES"], len=3 → "BCo"
 */
function candidateAbbrev(words, len) {
  if (!words.length) return '';
  if (words.length === 1) {
    const w = words[0];
    return w.charAt(0).toUpperCase() + w.slice(1, len).toLowerCase();
  }
  // Multi-word: first letters of each word, then pad with letters from
  // the last word if we need more chars.
  const initials = words.map(w => w.charAt(0)).join('');
  if (initials.length >= len) return initials.slice(0, len).toUpperCase();
  const last = words[words.length - 1];
  const padding = last.slice(1, 1 + (len - initials.length)).toLowerCase();
  return (initials + padding).replace(/^./, c => c.toUpperCase());
}

/**
 * Compute calendar_color and calendar_abbrev for a list of clubs in one
 * organization. Existing non-null values are preserved as-is; only the
 * gaps are filled.
 *
 * @param {Array<{id, display_name, calendar_color, calendar_abbrev, calendar_code}>} clubs
 * @param {object} [opts]
 * @param {string} [opts.palette='pastel']  one of PALETTES keys
 * @returns {Array<{id, calendar_color, calendar_abbrev}>}  rows that
 *   should be UPDATEd. Clubs that already have both values set are
 *   omitted from the result.
 *
 * V 2.0.638 — added palette parameter (Q2).
 * V 2.0.638 — when calendar_code is set on a club without an abbrev,
 *   use it as the default rather than computing a new prefix (Q3).
 */
function computeDefaults(clubs, opts) {
  const paletteName = (opts && opts.palette) || 'pastel';
  const palette = PALETTES[paletteName] || PALETTES.pastel;
  // Sort alphabetically by display_name so the colour assignment is
  // stable across runs (same input → same output).
  const sorted = [...clubs].sort((a, b) =>
    (a.display_name || '').localeCompare(b.display_name || '', 'fr')
  );

  // Build a Set of abbreviations that are already taken (admin-set).
  const taken = new Set(
    sorted
      .map(c => (c.calendar_abbrev || '').trim())
      .filter(Boolean)
  );

  const updates = [];
  let paletteIdx = 0;

  for (const club of sorted) {
    const needsColor  = !club.calendar_color  || !club.calendar_color.trim();
    const needsAbbrev = !club.calendar_abbrev || !club.calendar_abbrev.trim();
    if (!needsColor && !needsAbbrev) continue;

    // Color: cycle through palette in alphabetical order so the same
    // index always maps to the same colour for that org.
    const color = needsColor
      ? palette[paletteIdx % palette.length]
      : club.calendar_color;
    if (needsColor) paletteIdx++;

    // Abbreviation strategy (V 2.0.638 — Q3 added):
    //   1. If calendar_code is set (legacy single-letter A/B/C... from
    //      the CDBHS Excel import), prefer that — admin already chose
    //      a meaningful unique code per club.
    //   2. Otherwise try 2-letter prefix from the display_name.
    //   3. If 2-letter collides, try 3.
    //   4. If 3-letter still collides, first + last-word initials.
    //   5. Last resort: append a digit suffix.
    let abbrev = club.calendar_abbrev;
    if (needsAbbrev) {
      const code = (club.calendar_code || '').trim();
      let candidate;
      if (code && code.length <= 8 && !taken.has(code)) {
        candidate = code;
      } else {
        const words = coreWords(club.display_name || '');
        candidate = candidateAbbrev(words, 2);
        if (taken.has(candidate)) candidate = candidateAbbrev(words, 3);
        if (taken.has(candidate) && words.length >= 2) {
          candidate = (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
        }
      }
      // Last resort: append digit until unique.
      let suffix = 2;
      let finalAbbrev = candidate;
      while (taken.has(finalAbbrev) && suffix < 10) {
        finalAbbrev = candidate + suffix;
        suffix++;
      }
      abbrev = finalAbbrev;
      taken.add(abbrev);
    }

    updates.push({
      id: club.id,
      calendar_color: color,
      calendar_abbrev: abbrev
    });
  }

  return updates;
}

/**
 * Backfill defaults for every organization's clubs that lack styling.
 * Called once on server startup (db-postgres.js initializeDatabase).
 *
 * Idempotent: a second run produces zero updates.
 *
 * V 2.0.638 — reads the per-org club_calendar_palette setting (default
 * 'pastel') and applies that palette when filling gaps for each org.
 * Existing values are preserved untouched.
 */
async function backfillDefaults(db) {
  const dbAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const dbRun = (sql, params) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); })
  );

  let rows;
  try {
    rows = await dbAll(
      `SELECT id, organization_id, display_name, calendar_color, calendar_abbrev, calendar_code
         FROM clubs`,
      []
    );
  } catch (err) {
    // Columns may not exist yet on a brand-new DB — the migration that
    // adds them runs in the same initializeDatabase pass. Silently skip;
    // next startup will succeed.
    if (/calendar_color|calendar_abbrev/i.test(err.message || '')) return;
    throw err;
  }

  // Group by org.
  const byOrg = new Map();
  for (const r of rows) {
    const k = r.organization_id == null ? 'null' : String(r.organization_id);
    if (!byOrg.has(k)) byOrg.set(k, []);
    byOrg.get(k).push(r);
  }

  // Read palette choice per org (best-effort — table may not exist on
  // a brand-new DB, in which case every org defaults to 'pastel').
  const paletteByOrg = new Map();
  try {
    const settingsRows = await dbAll(
      `SELECT organization_id, value FROM organization_settings
        WHERE key = 'club_calendar_palette'`,
      []
    );
    for (const r of settingsRows) {
      paletteByOrg.set(String(r.organization_id), r.value);
    }
  } catch (err) { /* table not ready yet — fine */ }

  let totalUpdated = 0;
  for (const [orgKey, orgClubs] of byOrg.entries()) {
    const palette = paletteByOrg.get(orgKey) || 'pastel';
    const updates = computeDefaults(orgClubs, { palette });
    for (const u of updates) {
      await dbRun(
        `UPDATE clubs SET calendar_color = $1, calendar_abbrev = $2 WHERE id = $3`,
        [u.calendar_color, u.calendar_abbrev, u.id]
      );
      totalUpdated++;
    }
  }
  if (totalUpdated > 0) {
    console.log(`[club-calendar-defaults] backfilled styling for ${totalUpdated} club(s).`);
  }
}

/**
 * Compute defaults for a single newly-created club, given the existing
 * clubs in the same organization. Used in POST /api/clubs to style the
 * fresh row immediately.
 *
 * @param {object} newClub  { id, display_name }  the fresh row
 * @param {Array}  siblings other clubs in the same org (any shape with
 *                          display_name + calendar_color + calendar_abbrev)
 * @returns {{calendar_color, calendar_abbrev}}
 */
function computeForNewClub(newClub, siblings, opts) {
  // Reuse the bulk algorithm by including the new club in the list with
  // empty styling, then picking off its computed update.
  const all = [
    ...siblings,
    {
      id: newClub.id,
      display_name: newClub.display_name,
      calendar_color: null,
      calendar_abbrev: null,
      calendar_code: newClub.calendar_code || null
    }
  ];
  const updates = computeDefaults(all, opts);
  const mine = updates.find(u => u.id === newClub.id);
  return mine
    ? { calendar_color: mine.calendar_color, calendar_abbrev: mine.calendar_abbrev }
    : { calendar_color: null, calendar_abbrev: null };
}

module.exports = {
  PALETTES,
  DEFAULT_PALETTE,
  computeDefaults,
  backfillDefaults,
  computeForNewClub,
  // exported for tests
  _internal: { coreWords, candidateAbbrev, stripAccents }
};
