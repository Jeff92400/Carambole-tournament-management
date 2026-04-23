const express = require('express');
const router = express.Router();
const { authenticateToken, requireDdJ } = require('./auth');
const getDb = () => require('../db-loader');

// Helper: normalize licence for comparisons (removes spaces).
function normLicence(l) {
  return String(l || '').replace(/\s+/g, '');
}

// GET /api/directeur-jeu/competitions
// Returns tournaments for today + recent days for the DdJ's organization
router.get('/competitions', authenticateToken, requireDdJ, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;

  // Get today's date in Paris timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

  // Also get date 7 days ago for history
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const historyStart = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

  const query = `
    SELECT t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu, t.lieu_2,
           t.is_split, t.tournament_number, t.status,
           COUNT(DISTINCT cp.licence) as convoque_count,
           COUNT(DISTINCT CASE WHEN i.forfait = 1 THEN i.licence END) as forfait_count,
           COUNT(DISTINCT CASE WHEN i.inscription_id IS NOT NULL
             AND (i.forfait IS NULL OR i.forfait != 1)
             AND (i.statut IS NULL OR i.statut NOT IN ('désinscrit', 'indisponible'))
             THEN i.licence END) as inscrit_count
    FROM tournoi_ext t
    LEFT JOIN convocation_poules cp ON t.tournoi_id = cp.tournoi_id
    LEFT JOIN inscriptions i ON t.tournoi_id = i.tournoi_id
    WHERE DATE(t.debut) BETWEEN $1 AND $2
      AND ($3::int IS NULL OR t.organization_id = $3)
      AND t.parent_tournoi_id IS NULL
      AND LOWER(COALESCE(t.status, 'active')) != 'cancelled'
    GROUP BY t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu, t.lieu_2,
             t.is_split, t.tournament_number, t.status
    ORDER BY t.debut DESC, t.mode, t.categorie
  `;

  db.all(query, [historyStart, today, orgId], (err, rows) => {
    if (err) {
      console.error('[DdJ] Error fetching competitions:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    // Split into today vs history
    const todayStr = today;
    const competitions = (rows || []).map(row => {
      const rowDate = row.debut instanceof Date
        ? row.debut.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
        : String(row.debut).split('T')[0];
      return {
        ...row,
        is_today: rowDate === todayStr
      };
    });

    res.json(competitions);
  });
});

// ============================================================================
// STEP 1 — POINTAGE (check-in)
// ============================================================================
//
// Canonical data source for the DdJ day-of view is `convocation_poules` (who
// was assigned to a poule when admin sent convocations). Forfait state lives
// in `inscriptions` (columns `statut` + `forfait`). For each player row we
// join both so the front-end gets enough to display + the current check-in
// state.
//
// Forfait convention (kept in sync across PRESENT/FORFAIT transitions):
//   PRESENT  = inscriptions.statut = 'inscrit'  AND inscriptions.forfait = 0
//   FORFAIT  = inscriptions.statut = 'forfait'  AND inscriptions.forfait = 1
// ============================================================================

// GET /api/directeur-jeu/competitions/:id/pointage
// Returns tournament info + convoked player list with current forfait state.
router.get('/competitions/:id/pointage', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    // 1. Tournament info (org-scoped)
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, nom, mode, categorie, debut, lieu, lieu_2,
                tournament_number, status
         FROM tournoi_ext
         WHERE tournoi_id = $1
           AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }

    // 2. Game parameters (distance, reprises) — optional, nice-to-have for the
    // header bar. First check per-tournament override, then fall back to
    // defaults from game_parameters. Silent on miss.
    let gameParams = { distance: null, reprises: null };
    try {
      const override = await new Promise((resolve) => {
        db.get(
          `SELECT distance, reprises FROM tournament_parameter_overrides WHERE tournoi_id = $1`,
          [tournoiId],
          (err, row) => resolve(err ? null : row)
        );
      });
      if (override && override.distance != null) {
        gameParams = { distance: override.distance, reprises: override.reprises };
      } else {
        // Fall back to defaults (case-insensitive mode match per CLAUDE.md rule)
        const defaults = await new Promise((resolve) => {
          db.get(
            `SELECT distance, reprises FROM game_parameters
             WHERE UPPER(REPLACE(mode, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
               AND UPPER(categorie) = UPPER($2)
               AND ($3::int IS NULL OR organization_id = $3)
             LIMIT 1`,
            [tournament.mode, tournament.categorie, orgId],
            (err, row) => resolve(err ? null : row)
          );
        });
        if (defaults) gameParams = defaults;
      }
    } catch (e) {
      // Non-fatal — DdJ screen works without distance/reprises
    }

    // 3. Convoked player list, joined with players for FFB rank/moyenne
    // and with inscriptions for current forfait state.
    const players = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
           cp.licence,
           cp.player_name,
           cp.club,
           cp.poule_number,
           cp.player_order,
           p.first_name, p.last_name,
           p.rank_libre, p.rank_cadre, p.rank_bande, p.rank_3bandes,
           p.moyenne_generale,
           i.inscription_id,
           i.forfait,
           i.statut,
           i.commentaire
         FROM convocation_poules cp
         LEFT JOIN players p
           ON REPLACE(cp.licence, ' ', '') = REPLACE(p.licence, ' ', '')
           AND ($2::int IS NULL OR p.organization_id = $2)
         LEFT JOIN inscriptions i
           ON cp.tournoi_id = i.tournoi_id
           AND REPLACE(cp.licence, ' ', '') = REPLACE(i.licence, ' ', '')
         WHERE cp.tournoi_id = $1
           AND UPPER(cp.licence) NOT LIKE 'TEST%'
         ORDER BY cp.player_order NULLS LAST, cp.licence`,
        [tournoiId, orgId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // Normalize: compute a single `present` boolean per player from the two
    // legacy columns. The front-end should only ever see/send booleans.
    const enriched = players.map(p => {
      const isForfait = p.statut === 'forfait' || p.forfait === 1;
      return {
        licence: p.licence,
        licence_normalized: normLicence(p.licence),
        first_name: p.first_name || (p.player_name || '').split(' ').slice(0, -1).join(' '),
        last_name: p.last_name || (p.player_name || '').split(' ').slice(-1)[0] || '',
        player_name: p.player_name,
        club: p.club,
        poule_number: p.poule_number,
        player_order: p.player_order,
        rank_libre: p.rank_libre,
        rank_cadre: p.rank_cadre,
        rank_bande: p.rank_bande,
        rank_3bandes: p.rank_3bandes,
        moyenne_generale: p.moyenne_generale,
        present: !isForfait,
        commentaire: p.commentaire || null
      };
    });

    res.json({
      tournament: {
        ...tournament,
        distance: gameParams.distance,
        reprises: gameParams.reprises
      },
      players: enriched,
      total: enriched.length,
      present_count: enriched.filter(p => p.present).length,
      forfait_count: enriched.filter(p => !p.present).length
    });
  } catch (err) {
    console.error('[DdJ] /pointage GET error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du pointage' });
  }
});

// PUT /api/directeur-jeu/competitions/:id/pointage/:licence
// Toggle a player's check-in state. Body: { present: true|false }
router.put('/competitions/:id/pointage/:licence', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  const licence = normLicence(req.params.licence);
  const { present } = req.body || {};

  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  if (!licence) {
    return res.status(400).json({ error: 'Licence manquante' });
  }
  if (typeof present !== 'boolean') {
    return res.status(400).json({ error: '`present` doit être un booléen' });
  }

  try {
    // Verify the tournament belongs to the caller's org (defense in depth —
    // requireDdJ already gates on role but not on org).
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }

    // Verify this player is actually convoked (can't pointage someone not in
    // the poule list — avoids weird bulk-write attacks via crafted licences).
    const isConvoked = await new Promise((resolve, reject) => {
      db.get(
        `SELECT 1 FROM convocation_poules
         WHERE tournoi_id = $1 AND REPLACE(licence, ' ', '') = $2
         LIMIT 1`,
        [tournoiId, licence],
        (err, row) => err ? reject(err) : resolve(!!row)
      );
    });
    if (!isConvoked) {
      return res.status(404).json({ error: 'Joueur non convoqué pour ce tournoi' });
    }

    // Update inscriptions.statut + inscriptions.forfait together so the two
    // legacy columns stay in sync. The SET uses existing CASE conventions
    // documented at the top of this file.
    const newStatut = present ? 'inscrit' : 'forfait';
    const newForfait = present ? 0 : 1;

    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE inscriptions
         SET statut = $1, forfait = $2
         WHERE tournoi_id = $3 AND REPLACE(licence, ' ', '') = $4
           AND ($5::int IS NULL OR organization_id = $5)`,
        [newStatut, newForfait, tournoiId, licence, orgId],
        function(err) {
          if (err) return reject(err);
          // Row count is not uniformly reported between SQLite/PG adapters,
          // so best-effort: we treat a non-error response as success.
          resolve({ updated: true });
        }
      );
    });

    // Log to activity_logs for the audit trail used by admin pages.
    try {
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO activity_logs
             (licence, user_name, action_type, action_status,
              target_type, target_id, target_name, details, app_source)
           VALUES ($1, $2, $3, 'success', 'inscription', $4, $5, $6, 'directeur_jeu')`,
          [
            licence,
            req.user.username || 'DdJ',
            present ? 'ddj_pointage_present' : 'ddj_pointage_forfait',
            tournoiId,
            licence,
            JSON.stringify({ tournoi_id: tournoiId, present, triggered_by: req.user.userId })
          ],
          () => resolve()
        );
      });
    } catch (e) {
      // Non-fatal
    }

    res.json({ success: true, licence, present, statut: newStatut, forfait: newForfait });
  } catch (err) {
    console.error('[DdJ] /pointage PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du pointage' });
  }
});

module.exports = router;
