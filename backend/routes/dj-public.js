// ============================================================
// V 2.0.595 — DdJ V3 public TV feed (no auth)
// ============================================================
//
// Read-only public endpoints used by the TV display in the playing
// hall. NO authentication required — anyone with the URL can view.
//
// Sensitive data is stripped server-side:
//   - No FFB licence numbers
//   - No emails / phones
//   - Player names are reduced to "First L." (first name + initial)
//   - Club names are kept (already public information)
//
// The feed is consumed by `frontend/dj-public.html` which polls
// this endpoint every 5 seconds.
// ============================================================

const express = require('express');
const router = express.Router();
const getDb = () => require('../db-loader');
const QRCode = require('qrcode');
// V 2.0.704 — loaders exported by directeur-jeu.js for the Roland-Garros
// style TV view. They return the full poules / bracket / consolante state
// already merged with saved scores + started_at/finished_at lifecycle.
const directeurJeu = require('./directeur-jeu');

// Reduce a player name to "First L." for public display.
function sanitizeName(firstName, lastName) {
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  if (!fn && !ln) return 'Joueur';
  if (!ln) return fn;
  return `${fn} ${ln.charAt(0).toUpperCase()}.`;
}

// Derive a status from started_at / finished_at + p*_points presence.
function deriveStatus(m) {
  if (m.finished_at || m.is_played) return 'finished';
  if (m.started_at) return 'in_progress';
  return 'pending';
}

// Normalize licence (strip spaces) for map lookups.
const normLic = (s) => String(s || '').replace(/\s+/g, '');

// GET /api/public/dj/:tournoi_id/feed
//
// Returns the full public state for one tournament's TV display:
//   - Tournament title, date, host club
//   - Table count + per-table status (free / busy + match summary)
//   - Top 3 upcoming poule matches (not yet started)
//   - Progression % across all 3 phases
router.get('/:tournoi_id/feed', async (req, res) => {
  const db = getDb();
  const tournoiId = parseInt(req.params.tournoi_id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    // 1. Tournament identity (also serves as the org check — the loaders
    //    are called with orgId=null since we already validated here).
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT t.tournoi_id, t.nom, t.debut, t.lieu, t.organization_id
           FROM tournoi_ext t
          WHERE t.tournoi_id = $1`,
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }

    // 2. DdJ session
    const session = await new Promise((resolve, reject) => {
      db.get(
        `SELECT table_count, table_numbers, ddj_name, started_at
           FROM ddj_session
          WHERE tournoi_id = $1`,
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    const tableNumbers = (() => {
      if (!session) return [];
      if (!session.table_numbers) return Array.from({ length: session.table_count }, (_, i) => i + 1);
      try {
        const arr = JSON.parse(session.table_numbers);
        if (!Array.isArray(arr) || arr.length === 0) return Array.from({ length: session.table_count }, (_, i) => i + 1);
        return arr.map(n => parseInt(n, 10)).filter(Number.isFinite);
      } catch (_) {
        return Array.from({ length: session.table_count }, (_, i) => i + 1);
      }
    })();

    if (!session) {
      return res.json({
        tournament: {
          name: tournament.nom,
          date: tournament.debut,
          location: tournament.lieu || null,
          // V 2.0.808 — mode exposed in this branch too for consistency
          // (TV layout reads it to detect Quilles).
          mode: tournament.mode || null
        },
        session: null,
        poules: [], bracket: null, consolante: null,
        upcoming: [], progress: { done: 0, total: 0, percent: 0 }
      });
    }

    // 3. Load full poules / bracket / consolante via the DdJ helpers.
    //    orgId=null skips the org filter (we did our own check above).
    const pouleCtx = await directeurJeu.loadPouleMatches(db, null, tournoiId);
    if (pouleCtx.error) {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }
    let bracketCtx = null;
    let consolanteCtx = null;
    try { bracketCtx = await directeurJeu.loadBracket(db, null, tournoiId); } catch (e) { console.error('[feed] loadBracket', e); }
    try { consolanteCtx = await directeurJeu.loadConsolante(db, null, tournoiId); } catch (e) { console.error('[feed] loadConsolante', e); }

    // 4. Collect every licence appearing anywhere → ONE players query →
    //    sanitized name map ("First L."). Names come back as "Last First"
    //    from the loaders so we'd need to flip them, but it's cleaner to
    //    re-resolve from the players table.
    const licenceSet = new Set();
    for (const p of (pouleCtx.poules || [])) {
      for (const pl of (p.players || [])) if (pl.licence) licenceSet.add(pl.licence);
    }
    if (bracketCtx && bracketCtx.phases) {
      for (const ph of bracketCtx.phases) {
        if (ph.p1 && ph.p1.licence) licenceSet.add(ph.p1.licence);
        if (ph.p2 && ph.p2.licence) licenceSet.add(ph.p2.licence);
      }
    }
    if (consolanteCtx && consolanteCtx.phases) {
      for (const ph of consolanteCtx.phases) {
        if (ph.p1 && ph.p1.licence) licenceSet.add(ph.p1.licence);
        if (ph.p2 && ph.p2.licence) licenceSet.add(ph.p2.licence);
      }
    }
    const licenceList = [...licenceSet];
    const nameMap = new Map();
    if (licenceList.length > 0) {
      const placeholders = licenceList.map((_, i) => `$${i + 1}`).join(',');
      const rows = await new Promise((resolve, reject) => {
        db.all(
          `SELECT licence, first_name, last_name, club
             FROM players
            WHERE licence IN (${placeholders})`,
          licenceList,
          (err, rs) => err ? reject(err) : resolve(rs || [])
        );
      });
      for (const r of rows) {
        nameMap.set(normLic(r.licence), {
          name: sanitizeName(r.first_name, r.last_name),
          club: r.club || null
        });
      }
    }
    const lookupName = (licence) => {
      const e = nameMap.get(normLic(licence));
      return e ? e.name : 'Joueur';
    };
    const lookupClub = (licence) => {
      const e = nameMap.get(normLic(licence));
      return e ? e.club : null;
    };

    // 5. Build sanitized poules — composition + classement (live wins/
    //    losses) + matches with status (pending/in_progress/finished).
    const poulesOut = (pouleCtx.poules || []).map(p => {
      const classementByLic = new Map();
      for (const c of (p.classement || [])) {
        classementByLic.set(normLic(c.licence), c);
      }
      // Players ordered by classement (live ranking) so "1st" appears at
      // the top of the poule card on the TV.
      const players = (p.classement || []).map((c, idx) => ({
        position: idx + 1,
        name: lookupName(c.licence),
        club: lookupClub(c.licence),
        wins: c.wins || 0,
        draws: c.draws || 0,
        losses: c.losses || 0,
        played: (c.wins || 0) + (c.draws || 0) + (c.losses || 0),
        match_points: c.match_points || 0
      }));
      const matches = (p.matches || []).map(m => ({
        match_number: m.match_number,
        table_number: m.table_number || null,
        p1_name: lookupName(m.p1_licence),
        p2_name: lookupName(m.p2_licence),
        p1_points: m.p1_points,
        p2_points: m.p2_points,
        status: deriveStatus(m),
        started_at: m.started_at,
        finished_at: m.finished_at
      }));
      // Pick a "home table" for the poule: the table where its first
      // pending/in_progress match is scheduled, or the most recent one.
      const homeTable = (() => {
        const next = matches.find(mm => mm.status !== 'finished' && mm.table_number);
        if (next) return next.table_number;
        const last = [...matches].reverse().find(mm => mm.table_number);
        return last ? last.table_number : null;
      })();
      return { number: p.number, table_number: homeTable, players, matches };
    });

    // 6. Build sanitized bracket (4 phases: SF1, SF2, F, PF).
    const buildBracketPhase = (ph) => ({
      phase: ph.phase,
      p1_name: ph.p1 ? lookupName(ph.p1.licence) : null,
      p2_name: ph.p2 ? lookupName(ph.p2.licence) : null,
      p1_poule: ph.p1 ? ph.p1.poule_number : null,
      p2_poule: ph.p2 ? ph.p2.poule_number : null,
      table_number: ph.table_number || null,
      p1_points: ph.p1_points,
      p2_points: ph.p2_points,
      status: deriveStatus(ph),
      started_at: ph.started_at,
      finished_at: ph.finished_at
    });
    // V 2.0.745 — include mode so TV frontend can branch layout
    const feedMode = (bracketCtx && bracketCtx.mode) || 'bracket';
    const bracketOut = bracketCtx
      ? {
          mode: feedMode,
          available: !!bracketCtx.can_start,
          phases: (bracketCtx.phases || []).map(buildBracketPhase)
        }
      : { mode: feedMode, available: false, phases: [] };

    // 7. Build sanitized consolante.
    const consolanteOut = consolanteCtx
      ? {
          available: !!consolanteCtx.can_start,
          phases: (consolanteCtx.phases || []).map(ph => ({
            phase: ph.phase,
            // V 2.0.722 — expose the FFB place label ("Place 09", "Places 11-12")
            // so the TV view matches the admin app instead of showing internal
            // codes (QF1/QF2/SF1/...).
            ffb_label: ph.ffb_label || null,
            p1_name: ph.p1 ? lookupName(ph.p1.licence) : null,
            p2_name: ph.p2 ? lookupName(ph.p2.licence) : null,
            table_number: ph.table_number || null,
            p1_points: ph.p1_points,
            p2_points: ph.p2_points,
            status: deriveStatus(ph),
            started_at: ph.started_at,
            finished_at: ph.finished_at
          }))
        }
      : { available: false, phases: [] };

    // 8. Upcoming queue — next 3 pending poule matches across all poules,
    //    flat list with table_number so the footer can show e.g. "Table 7".
    const upcoming = [];
    for (const p of poulesOut) {
      for (const m of p.matches) {
        if (m.status === 'pending') {
          upcoming.push({
            poule_number: p.number,
            match_number: m.match_number,
            p1_name: m.p1_name,
            p2_name: m.p2_name,
            table_number: m.table_number
          });
        }
      }
    }
    upcoming.sort((a, b) => a.poule_number - b.poule_number || a.match_number - b.match_number);
    const upcomingTop = upcoming.slice(0, 5);

    // 9. Progress — count finished vs known total across the 3 phases.
    let total = 0, done = 0;
    for (const p of poulesOut) {
      total += p.matches.length;
      done += p.matches.filter(m => m.status === 'finished').length;
    }
    for (const ph of bracketOut.phases) {
      total += 1;
      if (ph.status === 'finished') done += 1;
    }
    for (const ph of consolanteOut.phases) {
      total += 1;
      if (ph.status === 'finished') done += 1;
    }
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    res.json({
      mode: feedMode,
      tournament: {
        name: tournament.nom,
        date: tournament.debut,
        location: tournament.lieu || null,
        // V 2.0.806 — mode exposed so the TV layout can branch on Quilles
        // (no consolante: switch to a 2-column Poules | Phase finale layout).
        mode: tournament.mode || null
      },
      session: {
        table_count: session.table_count,
        table_numbers: tableNumbers,
        ddj_name: session.ddj_name,
        started_at: session.started_at
      },
      poules: poulesOut,
      bracket: bracketOut,
      consolante: consolanteOut,
      upcoming: upcomingTop,
      progress: { done, total, percent }
    });
  } catch (err) {
    console.error('[DdJ public feed] error:', err);
    res.status(500).json({ error: 'Erreur lors de la lecture du flux public' });
  }
});

// V 2.0.699 — Active sessions today, used by the public /tv landing page.
// Lets a TV in the playing hall pick from the day's tournaments without
// having to type the tournoi_id manually. Same sanitisation as /feed.
router.get('/active-today', async (req, res) => {
  const db = getDb();
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT s.tournoi_id, s.table_count, s.ddj_name, s.started_at,
                t.nom, t.debut, t.lieu, t.organization_id,
                o.short_name AS org_short_name, o.name AS org_name
           FROM ddj_session s
           JOIN tournoi_ext t ON t.tournoi_id = s.tournoi_id
      LEFT JOIN organizations o ON o.id = t.organization_id
          WHERE s.started_at >= NOW() - INTERVAL '24 hours'
            AND s.ended_at IS NULL
          ORDER BY s.started_at DESC`,
        [],
        (err, rs) => err ? reject(err) : resolve(rs || [])
      );
    });
    res.json({
      sessions: rows.map(r => ({
        tournoi_id: r.tournoi_id,
        name: r.nom,
        date: r.debut,
        location: r.lieu || null,
        ddj_name: r.ddj_name,
        table_count: r.table_count,
        organization: r.org_short_name || r.org_name || null,
        started_at: r.started_at
      }))
    });
  } catch (err) {
    console.error('[DdJ public active-today] error:', err);
    res.status(500).json({ error: 'Erreur lors de la lecture des sessions actives' });
  }
});

// V 2.0.700 — Generate a QR code for any TV URL.
// Returns SVG (lightweight, scales perfectly on a TV / smart-display).
// No auth: the QR is a wrapper around a public URL anyway.
//
// Query params:
//   ?text=<url>   the URL to encode (required)
//   ?size=<n>     pixel size hint (defaults to 240, capped at 640)
router.get('/qr', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text || text.length > 500) {
    return res.status(400).send('Bad text param');
  }
  const size = Math.min(640, Math.max(120, parseInt(req.query.size, 10) || 240));
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size,
      color: { dark: '#1a5276', light: '#ffffff' }
    });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (err) {
    console.error('[DdJ public qr] error:', err);
    res.status(500).send('QR generation failed');
  }
});

module.exports = router;
