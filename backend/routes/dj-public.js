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

// Reduce a player name to "First L." for public display.
function sanitizeName(firstName, lastName) {
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  if (!fn && !ln) return 'Joueur';
  if (!ln) return fn;
  return `${fn} ${ln.charAt(0).toUpperCase()}.`;
}

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
    // 1. Tournament identity
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

    // 2. DdJ session (table_count, table_numbers, started_at)
    const session = await new Promise((resolve, reject) => {
      db.get(
        `SELECT table_count, table_numbers, ddj_name, started_at
           FROM ddj_session
          WHERE tournoi_id = $1`,
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    // Parse custom table numbers — fall back to [1..table_count] for legacy rows
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

    // No session yet → return a minimal "not started" payload
    if (!session) {
      return res.json({
        tournament: {
          name: tournament.nom,
          date: tournament.debut,
          location: tournament.lieu || null
        },
        session: null,
        tables: [],
        upcoming: [],
        progress: { done: 0, total: 0, percent: 0 }
      });
    }

    // 3. In-progress matches (started_at NOT NULL, finished_at NULL)
    //    across the 3 phases. Same shape, UNIONed.
    const inProgress = await new Promise((resolve, reject) => {
      db.all(
        `SELECT 'poule' AS phase_kind, table_number, p1_licence, p2_licence,
                p1_points, p2_points, started_at,
                poule_number::text AS phase_label, match_number AS phase_index
           FROM ddj_poule_matches
          WHERE tournoi_id = $1 AND started_at IS NOT NULL AND finished_at IS NULL
            AND table_number IS NOT NULL
         UNION ALL
         SELECT 'bracket' AS phase_kind, table_number, p1_licence, p2_licence,
                p1_points, p2_points, started_at,
                phase::text AS phase_label, NULL::int AS phase_index
           FROM ddj_bracket_matches
          WHERE tournoi_id = $1 AND started_at IS NOT NULL AND finished_at IS NULL
            AND table_number IS NOT NULL
         UNION ALL
         SELECT 'consolante' AS phase_kind, table_number, p1_licence, p2_licence,
                p1_points, p2_points, started_at,
                phase::text AS phase_label, NULL::int AS phase_index
           FROM ddj_consolante_matches
          WHERE tournoi_id = $1 AND started_at IS NOT NULL AND finished_at IS NULL
            AND table_number IS NOT NULL`,
        [tournoiId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // 4. Upcoming poule matches (top 3 not started). The bracket/
    //    consolante upcoming matches are skipped here for simplicity —
    //    the TV doesn't need the full queue, just a flavour.
    const upcoming = await new Promise((resolve, reject) => {
      db.all(
        `SELECT poule_number, match_number, p1_licence, p2_licence
           FROM ddj_poule_matches
          WHERE tournoi_id = $1 AND started_at IS NULL
          ORDER BY poule_number, match_number
          LIMIT 3`,
        [tournoiId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // 5. Resolve all licences to (first_name, last_name) via players
    //    table. We do ONE query for all distinct licences appearing
    //    in inProgress + upcoming, and build a lookup map.
    const licenceSet = new Set();
    for (const m of inProgress) {
      if (m.p1_licence) licenceSet.add(m.p1_licence);
      if (m.p2_licence) licenceSet.add(m.p2_licence);
    }
    for (const m of upcoming) {
      if (m.p1_licence) licenceSet.add(m.p1_licence);
      if (m.p2_licence) licenceSet.add(m.p2_licence);
    }

    const licenceList = [...licenceSet];
    let nameMap = new Map();
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
        nameMap.set(r.licence, {
          name: sanitizeName(r.first_name, r.last_name),
          club: r.club || null
        });
      }
    }
    const lookupName = (licence) => {
      const e = nameMap.get(licence);
      return e ? e.name : 'Joueur';
    };

    // 6. Build per-table status array — iterate over the actual physical
    //    numbers (e.g. [6,7,8,9]) so the TV displays "Table 6" etc.
    const inProgressByTable = new Map();
    for (const m of inProgress) inProgressByTable.set(m.table_number, m);

    const tables = tableNumbers.map((n) => {
      const m = inProgressByTable.get(n);
      return {
        table_number: n,
        status: m ? 'busy' : 'free',
        match: m ? {
          phase_kind: m.phase_kind,
          phase_label: String(m.phase_label),
          p1_name: lookupName(m.p1_licence),
          p2_name: lookupName(m.p2_licence),
          p1_points: m.p1_points,
          p2_points: m.p2_points,
          started_at: m.started_at
        } : null
      };
    });

    // 7. Progress: count finished matches vs total expected
    //    For simplicity we only count what's already in the 3 tables.
    //    The "total expected" includes all poule matches (they're all
    //    pre-known once poules are generated) + the bracket and
    //    consolante phases (4 + N for consolante, but we count actual
    //    rows, which is fine — the TV doesn't need precision).
    const progress = await new Promise((resolve, reject) => {
      db.get(
        `SELECT
            (SELECT COUNT(*) FROM ddj_poule_matches WHERE tournoi_id = $1) +
            (SELECT COUNT(*) FROM ddj_bracket_matches WHERE tournoi_id = $1) +
            (SELECT COUNT(*) FROM ddj_consolante_matches WHERE tournoi_id = $1) AS total,
            (SELECT COUNT(*) FROM ddj_poule_matches WHERE tournoi_id = $1 AND finished_at IS NOT NULL) +
            (SELECT COUNT(*) FROM ddj_bracket_matches WHERE tournoi_id = $1 AND finished_at IS NOT NULL) +
            (SELECT COUNT(*) FROM ddj_consolante_matches WHERE tournoi_id = $1 AND finished_at IS NOT NULL) AS done`,
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row || { total: 0, done: 0 })
      );
    });
    const total = parseInt(progress.total, 10) || 0;
    const done = parseInt(progress.done, 10) || 0;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    // 8. Compose response
    res.json({
      tournament: {
        name: tournament.nom,
        date: tournament.debut,
        location: tournament.lieu || null
      },
      session: {
        table_count: session.table_count,
        ddj_name: session.ddj_name,
        started_at: session.started_at
      },
      tables,
      upcoming: upcoming.map(m => ({
        poule_number: m.poule_number,
        match_number: m.match_number,
        p1_name: lookupName(m.p1_licence),
        p2_name: lookupName(m.p2_licence)
      })),
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
