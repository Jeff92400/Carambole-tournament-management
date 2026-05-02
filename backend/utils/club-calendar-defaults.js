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

// 12 pastel colors — distinguishable, light enough for black text.
const DEFAULT_PALETTE = [
  '#d4edda', // mint
  '#d4e6f7', // sky
  '#fce4d3', // peach
  '#e6dcf2', // lavender
  '#fff4c2', // light yellow
  '#ffe0e0', // light pink
  '#d4f1e8', // seafoam
  '#fde4f0', // rose
  '#e0e7ff', // periwinkle
  '#fff4e0', // cream
  '#e0f4d4', // light green
  '#f0d4f0', // light orchid
];

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
 * @param {Array<{id, display_name, calendar_color, calendar_abbrev}>} clubs
 * @returns {Array<{id, calendar_color, calendar_abbrev}>}  rows that
 *   should be UPDATEd. Clubs that already have both values set are
 *   omitted from the result.
 */
function computeDefaults(clubs) {
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
      ? DEFAULT_PALETTE[paletteIdx % DEFAULT_PALETTE.length]
      : club.calendar_color;
    if (needsColor) paletteIdx++;

    // Abbreviation: try 2 letters; if collision, try 3; if still
    // colliding, fall back to first-letter + last-word-first-letter
    // pair (covers e.g. two clubs starting with "Billard Club").
    let abbrev = club.calendar_abbrev;
    if (needsAbbrev) {
      const words = coreWords(club.display_name || '');
      let candidate = candidateAbbrev(words, 2);
      if (taken.has(candidate)) candidate = candidateAbbrev(words, 3);
      if (taken.has(candidate) && words.length >= 2) {
        candidate = (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
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
 */
async function backfillDefaults(db) {
  // Read existing clubs grouped by organization.
  const dbAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const dbRun = (sql, params) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); })
  );

  let rows;
  try {
    rows = await dbAll(
      `SELECT id, organization_id, display_name, calendar_color, calendar_abbrev
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

  let totalUpdated = 0;
  for (const orgClubs of byOrg.values()) {
    const updates = computeDefaults(orgClubs);
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
function computeForNewClub(newClub, siblings) {
  // Reuse the bulk algorithm by including the new club in the list with
  // empty styling, then picking off its computed update.
  const all = [
    ...siblings,
    {
      id: newClub.id,
      display_name: newClub.display_name,
      calendar_color: null,
      calendar_abbrev: null
    }
  ];
  const updates = computeDefaults(all);
  const mine = updates.find(u => u.id === newClub.id);
  return mine
    ? { calendar_color: mine.calendar_color, calendar_abbrev: mine.calendar_abbrev }
    : { calendar_color: null, calendar_abbrev: null };
}

module.exports = {
  DEFAULT_PALETTE,
  computeDefaults,
  backfillDefaults,
  computeForNewClub,
  // exported for tests
  _internal: { coreWords, candidateAbbrev, stripAccents }
};
