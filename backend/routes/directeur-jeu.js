const express = require('express');
const router = express.Router();
const { authenticateToken, requireDdJ, requireAdmin } = require('./auth');
const appSettings = require('../utils/app-settings');
const { getPouleConfigForOrg } = require('../utils/poule-config');
const getDb = () => require('../db-loader');

// V 2.0.695 — Parse the JSON-encoded table_numbers column.
// Returns an integer array of length === expectedCount.
//   raw === null / undefined / empty / unparseable → fallback to [1..expectedCount]
//   raw is a JSON array of integers → return it as-is, padded/truncated to expectedCount
// Always defensive: never throws, always returns a valid array.
function parseTableNumbers(raw, expectedCount) {
  const fallback = () => Array.from({ length: expectedCount }, (_, i) => i + 1);
  if (raw == null || raw === '') return fallback();
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (_) { return fallback(); }
  if (!Array.isArray(parsed)) return fallback();
  const ints = parsed.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n > 0);
  if (ints.length === 0) return fallback();
  // Pad with sequential numbers if too short, truncate if too long
  while (ints.length < expectedCount) ints.push(ints.length + 1);
  return ints.slice(0, expectedCount);
}

// ============================================================================
// Serpentine distribution — same algorithm as the admin flow
// (inscriptions.js distributeSimulationSerpentine). Duplicated here rather
// than imported to keep the module surface small; the code is small and
// stable. If this drifts, fold into a shared util.
// ============================================================================
function distributeSerpentine(players, pouleSizes) {
  const numPoules = pouleSizes.length;
  const poules = pouleSizes.map((size, i) => ({ number: i + 1, size, players: [] }));
  let playerIndex = 0;
  let round = 0;
  while (playerIndex < players.length) {
    const isLeftToRight = round % 2 === 0;
    for (let i = 0; i < numPoules && playerIndex < players.length; i++) {
      const pouleIndex = isLeftToRight ? i : (numPoules - 1 - i);
      const poule = poules[pouleIndex];
      if (poule.players.length < poule.size) {
        poules[pouleIndex].players.push({ ...players[playerIndex], serpentine_rank: playerIndex + 1 });
        playerIndex++;
      }
    }
    round++;
  }
  return poules;
}

// Helper: normalize licence for comparisons (removes spaces).
function normLicence(l) {
  return String(l || '').replace(/\s+/g, '');
}

/**
 * V 2.0.829 — Decide whether a match is truly finished given the latest
 * score entry and the tournament's game parameters.
 *
 * Historically the three score-save endpoints (poule, bracket, consolante)
 * unconditionally stamped finished_at = NOW() on every save. That made
 * intermediate score entries flip the match to "finished" — TV screen
 * showed ✓ and dropped the LIVE badge while play was still going, and
 * the DdJ entry view said "Match terminé" prematurely.
 *
 * New rule (used by all three save endpoints + the cancel endpoint):
 *   - Both points columns must be non-null (no half-saved row counts).
 *   - If `gp.distance` is known, a player reaching it ends the match.
 *   - If `gp.reprises` is known, hitting the cap ends the match.
 *   - If neither is known (legacy tournaments without game_params),
 *     fall back to "both points present" so we don't regress.
 *
 * The caller passes the result as a boolean parameter; the SQL uses a
 * CASE so `finished_at` flips back to NULL on any save that no longer
 * meets the condition (e.g. DdJ corrects a typo back to an intermediate
 * score). started_at is preserved by COALESCE in all three endpoints.
 */
function isMatchTrulyFinished(parsed, gp) {
  if (parsed.p1_points == null || parsed.p2_points == null) return false;
  if (gp && gp.distance != null) {
    if (parsed.p1_points >= gp.distance || parsed.p2_points >= gp.distance) return true;
  }
  if (gp && gp.reprises != null) {
    if ((parsed.p1_reprises != null && parsed.p1_reprises >= gp.reprises) ||
        (parsed.p2_reprises != null && parsed.p2_reprises >= gp.reprises)) {
      return true;
    }
  }
  // Backward-compatible fallback: tournament without game_params seeded
  // (no distance / reprises cap known). Treat "both scores entered" as
  // finished, same as the historical behavior.
  if (!gp || (gp.distance == null && gp.reprises == null)) return true;
  return false;
}

// V 2.0.829 — One-shot data heal: clears finished_at for any DdJ match
// row that was wrongly marked finished while having no scores. Fixes the
// state left behind by the pre-V 2.0.829 unconditional finished_at write.
// Runs once at module load, idempotent (a future correct save will just
// overwrite finished_at when truly finished).
(async function healCorruptFinishedAt() {
  try {
    const db = getDb();
    const tables = ['ddj_poule_matches', 'ddj_bracket_matches', 'ddj_consolante_matches'];
    for (const tbl of tables) {
      await new Promise((resolve) => {
        db.run(
          `UPDATE ${tbl}
             SET finished_at = NULL
           WHERE finished_at IS NOT NULL
             AND p1_points IS NULL
             AND p2_points IS NULL`,
          [],
          function (err) {
            if (err) {
              // Non-fatal — table may not exist on a fresh install, or
              // permissions may be missing in a dev env. Log and skip.
              console.warn(`[DdJ heal] ${tbl}: ${err.message}`);
            } else if (this && this.changes > 0) {
              console.log(`[DdJ heal] ${tbl}: cleared finished_at on ${this.changes} row(s)`);
            }
            resolve();
          }
        );
      });
    }
  } catch (e) {
    console.warn('[DdJ heal] skipped:', e?.message || e);
  }
})();

// V 2.0.847 — One-shot heal for the OTHER side of the pointage data:
// re-stamp is_checked_in = TRUE for any convocation_poules row whose
// player actually played at least one match (poule, bracket or
// consolante). Before V 2.0.846, re-saving the poule composition
// wiped is_checked_in; this restores the implicit "if they played,
// they were present" truth for already-completed sessions so the
// Pointage screen no longer shows them as "À pointer" on revisit.
// Idempotent — a player without any match stays uncheck.
(async function healLostCheckIns() {
  try {
    const db = getDb();
    await new Promise((resolve) => {
      db.run(
        `UPDATE convocation_poules cp
            SET is_checked_in = TRUE,
                checked_in_at = COALESCE(cp.checked_in_at, CURRENT_TIMESTAMP)
          WHERE (cp.is_checked_in IS DISTINCT FROM TRUE)
            AND EXISTS (
              SELECT 1 FROM ddj_poule_matches m
               WHERE m.tournoi_id = cp.tournoi_id
                 AND (REPLACE(m.p1_licence, ' ', '') = REPLACE(cp.licence, ' ', '')
                   OR REPLACE(m.p2_licence, ' ', '') = REPLACE(cp.licence, ' ', ''))
            )`,
        [],
        function (err) {
          if (err) {
            console.warn('[DdJ heal checkins/poule]', err.message);
          } else if (this && this.changes > 0) {
            console.log(`[DdJ heal] restored is_checked_in on ${this.changes} convocation_poules row(s) (via poule matches)`);
          }
          resolve();
        }
      );
    });
    // Same backfill, scoped through bracket + consolante. Tables may not
    // exist on a fresh install — non-fatal in both cases.
    for (const tbl of ['ddj_bracket_matches', 'ddj_consolante_matches']) {
      await new Promise((resolve) => {
        db.run(
          `UPDATE convocation_poules cp
              SET is_checked_in = TRUE,
                  checked_in_at = COALESCE(cp.checked_in_at, CURRENT_TIMESTAMP)
            WHERE (cp.is_checked_in IS DISTINCT FROM TRUE)
              AND EXISTS (
                SELECT 1 FROM ${tbl} m
                 WHERE m.tournoi_id = cp.tournoi_id
                   AND (REPLACE(m.p1_licence, ' ', '') = REPLACE(cp.licence, ' ', '')
                     OR REPLACE(m.p2_licence, ' ', '') = REPLACE(cp.licence, ' ', ''))
              )`,
          [],
          function (err) {
            if (err) {
              console.warn(`[DdJ heal checkins/${tbl}]`, err.message);
            } else if (this && this.changes > 0) {
              console.log(`[DdJ heal] restored is_checked_in on ${this.changes} more row(s) (via ${tbl})`);
            }
            resolve();
          }
        );
      });
    }
  } catch (e) {
    console.warn('[DdJ heal checkins] skipped:', e?.message || e);
  }
})();

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

  // V 2.0.790 — Quilles fields added to the SELECT so the competitions
  // dashboard can flag Quilles tournaments with the LBIF colour theme.
  const query = `
    SELECT t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu, t.lieu_2,
           t.is_split, t.tournament_number, t.status,
           t.tournament_format, t.tournament_type, t.tour_number,
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
             t.is_split, t.tournament_number, t.status,
             t.tournament_format, t.tournament_type, t.tour_number
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
    // V 2.0.790 — Quilles fields (tournament_format / tournament_type /
    // tour_number / distance_matrix_id / fixed_distance / nb_tables) added
    // to the SELECT so the DdJ frontend can render the LBIF banner and
    // adapt its workflow on the fly. Carambole tournaments have these
    // columns as null and the frontend renders the carambole layout
    // unchanged.
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, nom, mode, categorie, debut, lieu, lieu_2,
                tournament_number, status,
                tournament_format, tournament_type, tour_number,
                distance_matrix_id, fixed_distance, nb_tables
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

    // V 2.0.791 — Sprint 2 D.2: for Quilles tournaments, override the
    // carambole game_parameters lookup with resolveDistance(). 9Q uses
    // fixed_distance directly; 5Q needs nb_poules → counted from the saved
    // convocation_poules (poules already exist if we reached the pointage
    // screen). Reprises is forced to null (Quilles matches have no reprises).
    // V 2.0.805 — tournament_parameter_overrides.distance takes priority
    // (lets the DdJ change the distance on tournament day from the UI).
    try {
      const { isQuillesMode, resolveDistance } = require('../utils/quilles-helpers');
      if (isQuillesMode(tournament.mode)) {
        const overrideRow = await new Promise((resolve) => {
          db.get(
            `SELECT distance FROM tournament_parameter_overrides WHERE tournoi_id = $1`,
            [tournoiId],
            (err, r) => resolve(err ? null : r)
          );
        });
        if (overrideRow && overrideRow.distance != null) {
          gameParams = {
            distance: overrideRow.distance,
            reprises: null,
            _quilles_source: 'override',
            _quilles_warning: null
          };
        } else {
          const nbPoulesRow = await new Promise((resolve) => {
            db.get(
              `SELECT COUNT(DISTINCT poule_number)::int AS n
                 FROM convocation_poules
                WHERE tournoi_id = $1`,
              [tournoiId],
              (err, r) => resolve(err ? null : r)
            );
          });
          const nbPoules = nbPoulesRow?.n || null;
          const resolved = await resolveDistance(tournament, nbPoules, { db });
          gameParams = {
            distance: resolved.distance,
            reprises: null,
            _quilles_source: resolved.source,
            _quilles_warning: resolved.warning || null
          };
        }
      }
    } catch (e) {
      console.error('[DdJ pointage] Quilles resolveDistance error:', e.message);
    }

    // Resolve season from tournament date. Uses the shared helper so it
    // respects per-org overrides (current_season_override and the
    // season_start_month setting — some CDBs use a non-September cutoff).
    // Falls back to now() if the tournament has no debut date (defensive).
    const debutDate = tournament.debut ? new Date(tournament.debut) : new Date();
    const season = await appSettings.getCurrentSeason(debutDate, orgId);

    // 3. Convoked player list, joined with players for FFB rank, inscriptions
    // for forfait state, and player_ffb_classifications for the relevant
    // moyenne_ffb (tournament mode + current season).
    const players = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
           cp.licence,
           cp.player_name,
           cp.club,
           cp.poule_number,
           cp.player_order,
           cp.is_checked_in,
           cp.checked_in_at,
           p.first_name, p.last_name,
           p.rank_libre, p.rank_cadre, p.rank_bande, p.rank_3bandes,
           i.inscription_id,
           i.forfait,
           i.statut,
           i.commentaire,
           pfc.moyenne_ffb
         FROM convocation_poules cp
         LEFT JOIN players p
           ON REPLACE(cp.licence, ' ', '') = REPLACE(p.licence, ' ', '')
           AND ($2::int IS NULL OR p.organization_id = $2)
         LEFT JOIN inscriptions i
           ON cp.tournoi_id = i.tournoi_id
           AND REPLACE(cp.licence, ' ', '') = REPLACE(i.licence, ' ', '')
         LEFT JOIN game_modes gm
           ON UPPER(REPLACE(gm.code, ' ', '')) = UPPER(REPLACE($3, ' ', ''))
         LEFT JOIN player_ffb_classifications pfc
           ON REPLACE(pfc.licence, ' ', '') = REPLACE(cp.licence, ' ', '')
           AND pfc.game_mode_id = gm.id
           AND pfc.season = $4
         WHERE cp.tournoi_id = $1
           AND UPPER(cp.licence) NOT LIKE 'TEST%'
         ORDER BY cp.player_order NULLS LAST, cp.licence`,
        [tournoiId, orgId, tournament.mode || '', season],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // Normalize: compute a single `present` boolean per player from the two
    // legacy columns. The front-end should only ever see/send booleans.
    // V 2.0.754 — Also treat 'désinscrit' and 'indisponible' as absent: a
    // player who cancelled via the Player App (désinscrit) or was marked
    // unavailable (indisponible) must not be counted toward poule generation,
    // just like a last-minute forfait.
    const NON_PARTICIPATING_STATUTS = new Set(['forfait', 'désinscrit', 'indisponible']);
    const enriched = players.map(p => {
      const isForfait = NON_PARTICIPATING_STATUTS.has(p.statut) || p.forfait === 1;
      // V 2.0.767 — Explicit 3-state pointage:
      //   is_checked_in=true → joueur confirmé présent par le DdJ
      //   isForfait=true     → joueur déclaré forfait (legacy flow)
      //   ni l'un ni l'autre → "non pointé" (bloquera le passage à l'étape suivante)
      // `present` remains for backward-compat with downstream consumers (poule
      // generation, classement). A checked-in player is present. A forfait is
      // not. An un-pointed player is treated as "not present" for poule
      // generation purposes — admins must complete pointage first.
      const isCheckedIn = p.is_checked_in === true || p.is_checked_in === 't' || p.is_checked_in === 1;
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
        moyenne_generale: p.moyenne_ffb,
        is_checked_in: isCheckedIn,
        is_forfait: isForfait,
        present: isCheckedIn && !isForfait,  // legacy: present only if explicitly checked in
        checked_in_at: p.checked_in_at,
        commentaire: p.commentaire || null
      };
    });

    // V 2.0.544 — Compute the poule structure preview using the org's
    // actual allow_poule_of_2 setting, so the pointage screen shows the
    // correct hint (e.g. "3 poules (3+2+2)" instead of "2 poules (3+4)"
    // when poules of 2 are authorized).
    let poulePreview = null;
    try {
      const presentN = enriched.filter(p => p.present).length;
      if (presentN >= 2) {
        const cfg = await getPouleConfigForOrg(presentN, orgId, tournament.mode);
        if (cfg && Array.isArray(cfg.poules) && cfg.poules.length) {
          poulePreview = {
            count: cfg.poules.length,
            sizes: cfg.poules.slice()
          };
        }
      }
    } catch (e) { /* preview is non-critical */ }

    res.json({
      tournament: {
        ...tournament,
        distance: gameParams.distance,
        reprises: gameParams.reprises
      },
      players: enriched,
      total: enriched.length,
      present_count: enriched.filter(p => p.present).length,
      forfait_count: enriched.filter(p => !p.present).length,
      poule_preview: poulePreview
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

    // Data-integrity guard: if the DdJ is marking a player FORFAIT *after*
    // matches have already been entered for this tournament, require
    // explicit confirmation (force=true). The CSV/Excel-era flow had no
    // such concept; here, retroactively flipping a player to forfait while
    // their scores live in ddj_*_matches creates inconsistent state for
    // the eventual finalization (positions / season ranking). The frontend
    // catches the 409 below and shows a modal; user-confirmed re-POST
    // includes `force: true` and proceeds.
    if (present === false) {
      const force = req.body && req.body.force === true;
      if (!force) {
        const counts = await Promise.all([
          new Promise((resolve, reject) => {
            db.get(
              `SELECT COUNT(*)::int AS n FROM ddj_poule_matches
               WHERE tournoi_id = $1
                 AND (REPLACE(p1_licence, ' ', '') = $2 OR REPLACE(p2_licence, ' ', '') = $2)
                 AND p1_points IS NOT NULL AND p2_points IS NOT NULL`,
              [tournoiId, licence],
              (err, row) => err ? reject(err) : resolve(row?.n || 0)
            );
          }),
          new Promise((resolve, reject) => {
            db.get(
              `SELECT COUNT(*)::int AS n FROM ddj_bracket_matches
               WHERE tournoi_id = $1
                 AND (REPLACE(p1_licence, ' ', '') = $2 OR REPLACE(p2_licence, ' ', '') = $2)
                 AND p1_points IS NOT NULL AND p2_points IS NOT NULL`,
              [tournoiId, licence],
              (err, row) => err ? reject(err) : resolve(row?.n || 0)
            );
          }),
          new Promise((resolve, reject) => {
            db.get(
              `SELECT COUNT(*)::int AS n FROM ddj_consolante_matches
               WHERE tournoi_id = $1
                 AND (REPLACE(p1_licence, ' ', '') = $2 OR REPLACE(p2_licence, ' ', '') = $2)
                 AND p1_points IS NOT NULL AND p2_points IS NOT NULL`,
              [tournoiId, licence],
              (err, row) => err ? reject(err) : resolve(row?.n || 0)
            );
          })
        ]);
        const total = counts[0] + counts[1] + counts[2];
        if (total > 0) {
          return res.status(409).json({
            requiresConfirm: true,
            matches_count: total,
            poule_matches: counts[0],
            bracket_matches: counts[1],
            consolante_matches: counts[2],
            error: `${total} match(s) déjà saisi(s) pour ce joueur. Confirmer va le marquer forfait mais conserver les scores existants — ils seront pris en compte lors de la finalisation.`
          });
        }
      }
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
          resolve({ updated: true });
        }
      );
    });

    // V 2.0.767 — Mutual exclusivity: marking a player forfait clears any
    // explicit check-in so the 3-state pointage UI stays coherent. Going
    // back to "inscrit" (present=true) does NOT auto-tick the box — the
    // DdJ must explicitly check-in via the /checkin endpoint.
    if (present === false) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE convocation_poules
           SET is_checked_in = FALSE, checked_in_at = NULL
           WHERE tournoi_id = $1 AND REPLACE(licence, ' ', '') = $2`,
          [tournoiId, licence],
          function(err) { if (err) return reject(err); resolve(); }
        );
      });
    }

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

// PUT /api/directeur-jeu/competitions/:id/checkin/:licence
// V 2.0.767 — Toggle the explicit "checked in" flag on a convoked player.
// Body: { is_checked_in: true|false }
//
// This is distinct from the forfait toggle (PUT /pointage/:licence above) so
// the DdJ can independently mark presence and forfait. The pointage screen
// uses 3 visual states: non pointé / présent (checked in) / forfait. Marking
// a player checked-in clears any forfait status (the two states are mutually
// exclusive — a player can't be both present and forfait).
router.put('/competitions/:id/checkin/:licence', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  const licence = normLicence(req.params.licence);
  const { is_checked_in } = req.body || {};

  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  if (!licence) {
    return res.status(400).json({ error: 'Licence manquante' });
  }
  if (typeof is_checked_in !== 'boolean') {
    return res.status(400).json({ error: '`is_checked_in` doit être un booléen' });
  }

  try {
    // Verify the tournament belongs to the caller's org
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

    // Update the convocation_poules row(s) for this (tournoi, licence) — a
    // player may have one row per poule in split tournaments, all should
    // reflect the same check-in state.
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE convocation_poules
         SET is_checked_in = $1,
             checked_in_at = CASE WHEN $1 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE tournoi_id = $2 AND REPLACE(licence, ' ', '') = $3`,
        [is_checked_in, tournoiId, licence],
        function(err) { if (err) return reject(err); resolve(); }
      );
    });

    // If checking in, clear any existing forfait state on the inscription so
    // the two flags stay coherent. (Marking forfait separately is still the
    // explicit DdJ action via PUT /pointage above.)
    if (is_checked_in === true) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE inscriptions
           SET statut = 'inscrit', forfait = 0
           WHERE tournoi_id = $1 AND REPLACE(licence, ' ', '') = $2
             AND statut = 'forfait'
             AND ($3::int IS NULL OR organization_id = $3)`,
          [tournoiId, licence, orgId],
          function(err) { if (err) return reject(err); resolve(); }
        );
      });
    }

    // Audit log
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
            is_checked_in ? 'ddj_checkin_present' : 'ddj_checkin_uncheck',
            tournoiId,
            licence,
            JSON.stringify({ tournoi_id: tournoiId, is_checked_in, triggered_by: req.user.userId })
          ],
          () => resolve()
        );
      });
    } catch (e) { /* non-fatal */ }

    res.json({ success: true, licence, is_checked_in });
  } catch (err) {
    console.error('[DdJ] /checkin PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du check-in' });
  }
});

// ============================================================================
// STEP 2 — GÉNÉRATION DES POULES
// ============================================================================
//
// Workflow:
//   1. Client calls POST /competitions/:id/poules/generate (no body) — this
//      is idempotent and side-effect-free. We read the pointage state,
//      compute the serpentine, and return the proposal as JSON.
//   2. Client renders it for the DdJ to review.
//   3. Client calls PUT /competitions/:id/poules with the (possibly-edited)
//      composition to persist. We DELETE then INSERT convocation_poules
//      rows for a clean overwrite.
//
// Seed source for the serpentine (in priority order):
//   a) Season rankings (preferred — reflects actual on-season performance)
//   b) FFB moyenne from player_ffb_classifications (start-of-season reference)
//   c) Insertion order (fallback of fallback; deterministic but unseeded)
//
// Note: overwriting convocation_poules is semantically correct — once the
// DdJ regenerates on tournament day, those ARE the real poules. The admin's
// initial convocation emails are already sent (the persistent artifact); the
// table row is just a live reference which the Player App also reads. If a
// player sees updated poule info after forfaits, that's the whole point.
// ============================================================================

/**
 * GET the ordered list of present players for a tournament, enriched with
 * their best available seed value (ranking → FFB moyenne → null) so the
 * caller can run the serpentine. Separated from the route handler so both
 * the generate endpoint and any future auto-suggest UI can reuse it.
 */
async function loadPointageForSerpentine(db, orgId, tournoiId) {
  // Tournament info (needed for mode + season resolution)
  // V 2.0.804 — Sprint 2 D.2 fix: include Quilles columns
  // (distance_matrix_id, fixed_distance, nb_tables, organization_id) so the
  // resolveDistance() validation in /poules/generate doesn't think the
  // tournament has no matrix when in fact the DB has one. Without these
  // columns in the SELECT, the tournament object passed to resolveDistance
  // had matrix_id=undefined → fell into the "5Q has no distance_matrix_id"
  // branch even though the matrix was properly assigned.
  const tournament = await new Promise((resolve, reject) => {
    db.get(
      `SELECT tournoi_id, nom, mode, categorie, debut, organization_id,
              tournament_format, tournament_type, tour_number,
              distance_matrix_id, fixed_distance, nb_tables
       FROM tournoi_ext
       WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [tournoiId, orgId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  if (!tournament) return { error: 'not_found' };

  const debutDate = tournament.debut ? new Date(tournament.debut) : new Date();
  const season = await appSettings.getCurrentSeason(debutDate, orgId);

  // Load present players (forfaits excluded)
  const players = await new Promise((resolve, reject) => {
    db.all(
      `SELECT
         cp.licence,
         cp.player_name,
         cp.club,
         cp.location_name,
         cp.location_address,
         cp.start_time,
         cp.poule_number AS convocation_poule_number,
         cp.player_order AS convocation_player_order,
         p.first_name, p.last_name,
         p.rank_libre, p.rank_cadre, p.rank_bande, p.rank_3bandes,
         i.forfait, i.statut,
         pfc.moyenne_ffb,
         r.rank_position AS season_rank
       FROM convocation_poules cp
       LEFT JOIN players p
         ON REPLACE(cp.licence, ' ', '') = REPLACE(p.licence, ' ', '')
         AND ($2::int IS NULL OR p.organization_id = $2)
       LEFT JOIN inscriptions i
         ON cp.tournoi_id = i.tournoi_id
         AND REPLACE(cp.licence, ' ', '') = REPLACE(i.licence, ' ', '')
       LEFT JOIN game_modes gm
         ON UPPER(REPLACE(gm.code, ' ', '')) = UPPER(REPLACE($3, ' ', ''))
       LEFT JOIN player_ffb_classifications pfc
         ON REPLACE(pfc.licence, ' ', '') = REPLACE(cp.licence, ' ', '')
         AND pfc.game_mode_id = gm.id
         AND pfc.season = $4
       LEFT JOIN categories cat
         ON UPPER(REPLACE(cat.game_type, ' ', '')) = UPPER(REPLACE($3, ' ', ''))
         AND UPPER(cat.level) = UPPER($5)
         AND ($2::int IS NULL OR cat.organization_id = $2)
       LEFT JOIN rankings r
         ON r.category_id = cat.id
         AND r.season = $4
         AND REPLACE(r.licence, ' ', '') = REPLACE(cp.licence, ' ', '')
       WHERE cp.tournoi_id = $1
         AND UPPER(cp.licence) NOT LIKE 'TEST%'
         -- V 2.0.754 — Exclude all non-participating statuses: forfait,
         -- désinscrit (cancelled via Player App) and indisponible. COALESCE
         -- so players with no inscription row (rare) default to "present".
         AND COALESCE(i.statut, 'inscrit') NOT IN ('forfait', 'désinscrit', 'indisponible')
         AND COALESCE(i.forfait, 0) = 0
       ORDER BY cp.player_order NULLS LAST, cp.licence`,
      [tournoiId, orgId, tournament.mode || '', season, tournament.categorie || ''],
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });

  return { tournament, season, players };
}

// POST /api/directeur-jeu/competitions/:id/poules/generate
// Compute a serpentine proposal from current pointage state. Pure read — no DB writes.
router.post('/competitions/:id/poules/generate', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    const ctx = await loadPointageForSerpentine(db, orgId, tournoiId);
    if (ctx.error === 'not_found') {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }
    const { tournament, season, players } = ctx;

    if (players.length === 0) {
      return res.status(400).json({ error: 'Aucun joueur présent à répartir (pointage requis)' });
    }

    // V 2.0.550 — Preserve convocation poules when nothing has changed.
    // The convocation poules are the official ones (sent to players,
    // displayed in the Player App, printed for the day). If every convoked
    // player is still present (no forfait) AND every player already has a
    // valid poule_number from convocation_poules, we reuse that composition
    // verbatim — including any manual swaps the admin made before sending
    // convocations. This avoids the DdJ silently re-running the serpentine
    // and overwriting deliberate edits like "no two players from the same
    // club in the same poule".
    const convokedTotal = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*)::int AS n FROM convocation_poules WHERE tournoi_id = $1`,
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row ? row.n : 0)
      );
    });
    const everyoneHasPoule = players.every(p =>
      p.convocation_poule_number != null && p.convocation_poule_number > 0
    );
    // V 2.0.803 — Sprint 2 G follow-up: Quilles tournaments never have
    // pre-assigned poules (the admin "Convoquer" button stores poule_number=1
    // as a pure placeholder so the pointage screen finds the players). Force
    // the serpentine path for Quilles so 17 players don't end up in a single
    // poule because the "everyone has poule" preserved-composition heuristic
    // fires on the placeholder. Carambole tournaments keep the preserved
    // behaviour — admins legitimately pre-assign poules before the DdJ day.
    const { isQuillesMode: _isQ_genPoules } = require('../utils/quilles-helpers');
    const skipPreservedForQuilles = _isQ_genPoules(tournament.mode);
    if (!skipPreservedForQuilles && convokedTotal > 0 && players.length === convokedTotal && everyoneHasPoule) {
      // Group by convocation poule_number, preserving in-poule order.
      const byPoule = new Map();
      for (const p of players) {
        const k = p.convocation_poule_number;
        if (!byPoule.has(k)) byPoule.set(k, []);
        byPoule.get(k).push(p);
      }
      const sortedPouleNumbers = [...byPoule.keys()].sort((a, b) => a - b);
      let globalRank = 1;
      const preservedPoules = sortedPouleNumbers.map((num, idx) => {
        const list = byPoule.get(num);
        list.sort((a, b) => (a.convocation_player_order || 0) - (b.convocation_player_order || 0));
        return {
          number: idx + 1,                 // renumber 1..N for the UI
          size: list.length,
          players: list.map(p => ({ ...p, serpentine_rank: globalRank++ }))
        };
      });
      // Reuse the same shape `getPouleConfigForOrg` would produce for
      // the description / tables count (best-effort, non-blocking).
      const cfg = await getPouleConfigForOrg(players.length, orgId, tournament.mode).catch(() => null);
      const proposal = {
        tournament: {
          id: tournament.tournoi_id,
          nom: tournament.nom,
          mode: tournament.mode,
          categorie: tournament.categorie,
          debut: tournament.debut,
          season
        },
        seed_source: 'convocation_preserved',
        total_players: players.length,
        total_poules: preservedPoules.length,
        tables_needed: cfg ? cfg.tables : preservedPoules.length,
        description: cfg ? cfg.description : `${preservedPoules.length} poules`,
        poules: preservedPoules.map(pl => ({
          number: pl.number,
          size: pl.size,
          players: pl.players.map(p => ({
            licence: p.licence,
            licence_normalized: String(p.licence || '').replace(/\s+/g, ''),
            player_name: p.player_name || `${p.last_name || ''} ${p.first_name || ''}`.trim(),
            first_name: p.first_name,
            last_name: p.last_name,
            club: p.club,
            season_rank: p.season_rank,
            moyenne_ffb: p.moyenne_ffb,
            serpentine_rank: p.serpentine_rank,
            location_name: p.location_name,
            location_address: p.location_address,
            start_time: p.start_time
          }))
        }))
      };
      return res.json(proposal);
    }
    // Otherwise (forfaits, missing poule assignments, or no convocation
    // sent yet) fall through to the legacy serpentine path below.

    // Choose seed source with honest reporting so the UI can tell the DdJ
    // which criterion was used (useful when they ask "why is this player
    // first?"). The order matches the existing V 2.0.448 admin fallback.
    const hasRanking = players.some(p => p.season_rank != null);
    const hasFfbMoyenne = players.some(p => p.moyenne_ffb != null);
    let seedSource;
    if (hasRanking) seedSource = 'season_ranking';
    else if (hasFfbMoyenne) seedSource = 'ffb_moyenne';
    else seedSource = 'insertion_order';

    // Sort players by seed value (best first).
    // season_rank: lower is better → asc. Nulls last.
    // moyenne_ffb: higher is better → desc. Nulls last.
    // insertion_order: keep the convocation_poules order (player_order was
    //   the ORDER BY in loadPointageForSerpentine).
    const sorted = [...players];
    if (seedSource === 'season_ranking') {
      sorted.sort((a, b) => {
        const ar = a.season_rank == null ? Infinity : a.season_rank;
        const br = b.season_rank == null ? Infinity : b.season_rank;
        return ar - br;
      });
    } else if (seedSource === 'ffb_moyenne') {
      sorted.sort((a, b) => (b.moyenne_ffb || 0) - (a.moyenne_ffb || 0));
    }

    // V 2.0.818 — Sprint 2 LBIF Phase 3: Quilles tournaments follow the
    // LBIF règlement (Code Sportif chap 1.1.1.E) — poules of 3 strict +
    // qualifiés d'office identifiés par le ranking. Bypass carambole logic.
    const { isQuillesMode: _isQ_lbif } = require('../utils/quilles-helpers');
    if (_isQ_lbif(tournament.mode)) {
      try {
        const { getBracketConfig, distributeSerpentin, resolveDistance } = require('../utils/quilles-helpers');
        const lbifCfg = await getBracketConfig(sorted.length, { db });

        // Validate distance can be resolved for the qualification phase
        const resolvedDist = await resolveDistance(tournament, lbifCfg.nb_poules, { db, phase: 'qualif' });
        if (resolvedDist.distance == null) {
          return res.status(400).json({
            error: `Impossible de déterminer la distance pour ce tournoi Quilles : ${resolvedDist.warning || 'configuration incomplète'}. Vérifiez la matrice 5Q (et nb_tables) ou la distance fixe 9Q dans les paramètres du tournoi.`
          });
        }

        // LBIF: top N (par ranking) = qualifiés d'office. Le reste va en poules.
        const directQualifs = sorted.slice(0, lbifCfg.nb_direct_qualif);
        const pouleEligible = sorted.slice(lbifCfg.nb_direct_qualif);

        // Sanity check: les joueurs en poule doivent former exactement nb_poules × 3
        // (sauf en mode single_poule_fallback pour N<12).
        if (lbifCfg.mode === 'lbif' && pouleEligible.length !== lbifCfg.nb_poules * 3) {
          return res.status(400).json({
            error: `Incohérence LBIF : ${sorted.length} joueurs présents - ${lbifCfg.nb_direct_qualif} qualifiés d'office = ${pouleEligible.length}, mais la matrice attend ${lbifCfg.nb_poules}×3=${lbifCfg.nb_poules*3} joueurs en poules. Vérifiez la matrice quilles_bracket_configs pour ${sorted.length} joueurs.`
          });
        }

        // Distribute via serpentin (les joueurs sont déjà triés par ranking)
        const distributedArr = distributeSerpentin(pouleEligible, Math.max(1, lbifCfg.nb_poules));
        const poules = distributedArr.map((arr, idx) => ({
          number: idx + 1,
          size: arr.length,
          players: arr.map((p, i) => ({ ...p, serpentine_rank: i + 1 }))
        }));

        const proposal = {
          tournament: {
            id: tournament.tournoi_id,
            nom: tournament.nom,
            mode: tournament.mode,
            categorie: tournament.categorie,
            debut: tournament.debut,
            season
          },
          seed_source: seedSource,
          total_players: sorted.length,
          total_poules: lbifCfg.nb_poules,
          tables_needed: tournament.nb_tables || lbifCfg.nb_poules,
          description: lbifCfg.mode === 'single_poule_fallback'
            ? `Mode single poule (N=${sorted.length} < 12 LBIF) — 1 poule intégrale`
            : `${lbifCfg.nb_poules} poule(s) de 3 joueurs${lbifCfg.nb_direct_qualif > 0 ? ' + ' + lbifCfg.nb_direct_qualif + ' qualifié(s) d\'office' : ''}`,
          lbif: {
            nb_direct_qualif: lbifCfg.nb_direct_qualif,
            nb_barragistes: lbifCfg.nb_barragistes,
            nb_exempts_barrage: lbifCfg.nb_exempts_barrage,
            has_barrage: lbifCfg.has_barrage,
            bracket_start: lbifCfg.bracket_start,
            bracket_size: lbifCfg.bracket_size,
            mode: lbifCfg.mode,
            warning: lbifCfg._warning || null,
            distance_qualif: resolvedDist.distance,
            distance_source: resolvedDist.source
          },
          poules: poules.map(pl => ({
            number: pl.number,
            size: pl.size,
            players: pl.players.map(p => ({
              licence: p.licence,
              licence_normalized: String(p.licence || '').replace(/\s+/g, ''),
              player_name: p.player_name || `${p.last_name || ''} ${p.first_name || ''}`.trim(),
              first_name: p.first_name,
              last_name: p.last_name,
              club: p.club,
              season_rank: p.season_rank,
              moyenne_ffb: p.moyenne_ffb,
              serpentine_rank: p.serpentine_rank,
              location_name: p.location_name,
              location_address: p.location_address,
              start_time: p.start_time
            }))
          })),
          // V 2.0.818 — Direct qualifiers go straight to bracket (no poule).
          // The PUT /poules handler saves them with poule_number=0 + is_direct_qualif=true.
          direct_qualifs: directQualifs.map(p => ({
            licence: p.licence,
            licence_normalized: String(p.licence || '').replace(/\s+/g, ''),
            player_name: p.player_name || `${p.last_name || ''} ${p.first_name || ''}`.trim(),
            first_name: p.first_name,
            last_name: p.last_name,
            club: p.club,
            season_rank: p.season_rank,
            moyenne_ffb: p.moyenne_ffb,
            location_name: p.location_name,
            location_address: p.location_address,
            start_time: p.start_time
          }))
        };
        return res.json(proposal);
      } catch (lbifErr) {
        console.error('[DdJ] /poules/generate LBIF error:', lbifErr);
        return res.status(lbifErr.code === 'LBIF_MATRIX_OVERFLOW' ? 422 : 500).json({
          error: lbifErr.message,
          code: lbifErr.code || null
        });
      }
    }

    // Compute poule sizes using the org's allow_poule_of_2 setting.
    // V 2.0.789 — mode passed so Quilles tournaments use the per-mode
    // override (allow_poule_of_2_5q / allow_poule_of_2_9q).
    const pouleConfig = await getPouleConfigForOrg(sorted.length, orgId, tournament.mode);
    if (!pouleConfig.poules || pouleConfig.poules.length === 0) {
      return res.status(400).json({
        error: `Pas assez de joueurs présents (${sorted.length} / min ${pouleConfig.minPlayers})`
      });
    }

    // V 2.0.791 — Sprint 2 D.2: for Quilles, validate the distance can be
    // resolved BEFORE committing the poule generation. Catches missing
    // matrix / nb_tables / fixed_distance early so the DdJ gets a clear
    // error message instead of seeing the workflow proceed with an
    // undefined distance.
    try {
      const { isQuillesMode, resolveDistance } = require('../utils/quilles-helpers');
      if (isQuillesMode(tournament.mode)) {
        const nbPoules = pouleConfig.poules.length;
        const resolved = await resolveDistance(tournament, nbPoules, { db });
        if (resolved.distance == null) {
          return res.status(400).json({
            error: `Impossible de déterminer la distance pour ce tournoi Quilles : ${resolved.warning || 'configuration incomplète'}. Vérifiez la matrice 5Q (et nb_tables) ou la distance fixe 9Q dans les paramètres du tournoi.`
          });
        }
      }
    } catch (e) {
      console.error('[DdJ generate-poules] Quilles validation error:', e.message);
    }

    // Run the serpentine
    const poules = distributeSerpentine(sorted, pouleConfig.poules);

    // Simplify output shape for the front end
    const proposal = {
      tournament: {
        id: tournament.tournoi_id,
        nom: tournament.nom,
        mode: tournament.mode,
        categorie: tournament.categorie,
        debut: tournament.debut,
        season
      },
      seed_source: seedSource,
      total_players: sorted.length,
      total_poules: pouleConfig.poules.length,
      tables_needed: pouleConfig.tables,
      description: pouleConfig.description,
      poules: poules.map(pl => ({
        number: pl.number,
        size: pl.size,
        players: pl.players.map(p => ({
          licence: p.licence,
          licence_normalized: String(p.licence || '').replace(/\s+/g, ''),
          player_name: p.player_name || `${p.last_name || ''} ${p.first_name || ''}`.trim(),
          first_name: p.first_name,
          last_name: p.last_name,
          club: p.club,
          season_rank: p.season_rank,
          moyenne_ffb: p.moyenne_ffb,
          serpentine_rank: p.serpentine_rank,
          location_name: p.location_name,
          location_address: p.location_address,
          start_time: p.start_time
        }))
      }))
    };

    res.json(proposal);
  } catch (err) {
    console.error('[DdJ] /poules/generate error:', err);
    res.status(500).json({ error: 'Erreur lors de la génération des poules' });
  }
});

// PUT /api/directeur-jeu/competitions/:id/poules
// Persist a validated poule composition. Body: { poules: [{ number, players: [{licence}, ...] }, ...] }
// Overwrites the existing convocation_poules rows for this tournament.
router.put('/competitions/:id/poules', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  // V 2.0.818 — Sprint 2 LBIF Phase 3: accept direct_qualifs (LBIF qualifiés
  // d'office, jamais joué en poule, vont directement au bracket).
  // Saved as convocation_poules rows with poule_number=0 + is_direct_qualif=true.
  const { poules, direct_qualifs } = req.body || {};

  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  if (!Array.isArray(poules) || poules.length === 0) {
    return res.status(400).json({ error: 'Poules manquantes ou invalides' });
  }

  try {
    // Verify tournament belongs to caller's org
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

    // Snapshot existing location/time before we wipe, so the new rows can
    // inherit the admin's location_name / location_address / start_time
    // (the DdJ is only editing the poule composition, not the venue).
    // V 2.0.846 — Also preserve is_checked_in / checked_in_at so the
    // pointage state survives a re-save of the poule composition.
    // Previously, going back to the wizard and re-validating the poules
    // wiped every check-in (the DELETE FROM below dropped the columns),
    // leaving the DdJ to re-tick every present player. Reported by Jeff
    // ("when we closed a DdJ session and we come back to it the present
    // screen is not persistent"). Tied to the per-player licence so a
    // dropped-then-re-added player keeps their check-in too.
    const snapshotRows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT REPLACE(licence, ' ', '') AS lic_norm,
                location_name, location_address, start_time,
                is_checked_in, checked_in_at
         FROM convocation_poules
         WHERE tournoi_id = $1`,
        [tournoiId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });
    const snapshotByLic = new Map(snapshotRows.map(r => [r.lic_norm, r]));

    // Load player_name + club from the players table so the new rows have
    // fresh display data (defense against the admin having renamed a club).
    const playersLookup = await new Promise((resolve, reject) => {
      db.all(
        `SELECT REPLACE(licence, ' ', '') AS lic_norm, first_name, last_name, club
         FROM players
         WHERE ($1::int IS NULL OR organization_id = $1)`,
        [orgId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });
    const playersByLic = new Map(playersLookup.map(r => [r.lic_norm, r]));

    // Delete existing rows for this tournament (clean overwrite)
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM convocation_poules WHERE tournoi_id = $1`,
        [tournoiId],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Insert new rows
    let totalInserted = 0;
    for (const poule of poules) {
      const pouleNumber = parseInt(poule.number, 10) || 0;
      if (!pouleNumber) continue;
      const playersInPoule = Array.isArray(poule.players) ? poule.players : [];
      for (let idx = 0; idx < playersInPoule.length; idx++) {
        const rawLicence = playersInPoule[idx].licence;
        if (!rawLicence) continue;
        const licNorm = String(rawLicence).replace(/\s+/g, '');
        const snap = snapshotByLic.get(licNorm) || {};
        const pl = playersByLic.get(licNorm) || {};
        const displayName = [pl.first_name, pl.last_name].filter(Boolean).join(' ')
          || playersInPoule[idx].player_name || rawLicence;

        await new Promise((resolve, reject) => {
          // V 2.0.846 — also carry is_checked_in + checked_in_at across
          // the DELETE+INSERT so the pointage state survives. Defaults
          // to FALSE/NULL for new players that weren't in the snapshot.
          db.run(
            `INSERT INTO convocation_poules
               (tournoi_id, poule_number, licence, player_name, club,
                location_name, location_address, start_time, player_order,
                is_checked_in, checked_in_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              tournoiId,
              pouleNumber,
              rawLicence,
              displayName,
              pl.club || null,
              snap.location_name || null,
              snap.location_address || null,
              snap.start_time || null,
              idx + 1,
              snap.is_checked_in === true || snap.is_checked_in === 't' || snap.is_checked_in === 1
                ? true : false,
              snap.checked_in_at || null
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
        totalInserted++;
      }
    }

    // V 2.0.818 — Sprint 2 LBIF Phase 3: persist direct qualifiers (Quilles
    // LBIF "qualifiés d'office"). poule_number = 0 marks them as out-of-poule,
    // is_direct_qualif = TRUE flags them for the bracket setup later.
    let directQualifsInserted = 0;
    if (Array.isArray(direct_qualifs)) {
      for (let idx = 0; idx < direct_qualifs.length; idx++) {
        const rawLicence = direct_qualifs[idx].licence;
        if (!rawLicence) continue;
        const licNorm = String(rawLicence).replace(/\s+/g, '');
        const snap = snapshotByLic.get(licNorm) || {};
        const pl = playersByLic.get(licNorm) || {};
        const displayName = [pl.first_name, pl.last_name].filter(Boolean).join(' ')
          || direct_qualifs[idx].player_name || rawLicence;

        await new Promise((resolve, reject) => {
          // V 2.0.846 — same is_checked_in / checked_in_at preservation
          // as the regular poule INSERT above. Direct qualifiers (LBIF
          // qualifiés d'office) also go through pointage.
          db.run(
            `INSERT INTO convocation_poules
               (tournoi_id, poule_number, licence, player_name, club,
                location_name, location_address, start_time, player_order,
                is_direct_qualif, is_checked_in, checked_in_at)
             VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10)`,
            [
              tournoiId,
              rawLicence,
              displayName,
              pl.club || null,
              snap.location_name || null,
              snap.location_address || null,
              snap.start_time || null,
              idx + 1,
              snap.is_checked_in === true || snap.is_checked_in === 't' || snap.is_checked_in === 1
                ? true : false,
              snap.checked_in_at || null
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
        directQualifsInserted++;
      }
    }

    // V 2.0.746 — Stamp poules_saved_at so étape 3 can warn if the composition
    // is stale (validated before today, suggesting last-minute forfaits were not
    // reflected in a poule regeneration).
    try {
      await new Promise((resolve) => {
        db.run(
          `UPDATE ddj_session SET poules_saved_at = NOW() WHERE tournoi_id = $1`,
          [tournoiId],
          () => resolve()
        );
      });
    } catch (e) { /* non-fatal */ }

    // Activity log for audit
    try {
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO activity_logs
             (user_name, action_type, action_status, target_type, target_id, target_name, details, app_source)
           VALUES ($1, 'ddj_poules_saved', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [
            req.user.username || 'DdJ',
            tournoiId,
            `Tournoi ${tournoiId}`,
            JSON.stringify({ poules_count: poules.length, players_count: totalInserted })
          ],
          () => resolve()
        );
      });
    } catch (e) {
      // Non-fatal
    }

    res.json({
      success: true,
      tournoi_id: tournoiId,
      poules_count: poules.length,
      players_count: totalInserted,
      direct_qualifs_count: directQualifsInserted
    });
  } catch (err) {
    console.error('[DdJ] /poules PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des poules' });
  }
});

// ============================================================================
// STEP 3 — MATCHS DE POULE
// ============================================================================
//
// Workflow:
//   1. On entry, GET /competitions/:id/poule-matches loads:
//        - the current poule composition (from convocation_poules)
//        - the scheduled match list (generated round-robin per poule size)
//        - any already-saved results (from ddj_poule_matches)
//        - the live classement for each poule with auto-tiebreak
//   2. DdJ enters each match's scores (points / reprises / meilleure série
//      per player). PUT /competitions/:id/poule-matches/:matchId persists.
//   3. On each save, the live classement is recomputed and returned so the
//      UI shows the updated standings without a second round-trip.
//
// Match point scoring (FFB convention, configurable via org settings
// scoring_match_points_draw and scoring_match_points_loss):
//   Default: win=2, draw=1, loss=0. Total per match = 2 for both players
//   (1+1 if draw, 2+0 otherwise). Winner of the match is DERIVED from
//   p1_points vs p2_points — no separate "outcome" column.
//
// Tiebreak (FFB rule, automatic — no manual arbitration):
//   1. total_match_points desc
//   2. moyenne (= sum(points) / sum(reprises)) desc
//   3. best serie desc
//   4. head-to-head (if exactly 2 tied, whoever won the direct match)
//   5. licence asc (deterministic fallback)
// ============================================================================

/**
 * Generate a round-robin match schedule for N players.
 * Returns array of { match_number, p1_idx, p2_idx } where idx is 1-based
 * into the poule's player order.
 *
 * Ordering rule: same-club matches are placed first (so players who share a
 * club face each other at the start of the session and can leave together).
 * Within each group (same-club / cross-club) the lexicographic order is
 * preserved. If no players array is provided the rule cannot be applied and
 * the plain lexicographic order is used.
 *
 * Special case — poule of 2 players (V 2.0.528) :
 *   FFB rule for poules of 2 = aller-retour (each player plays the other twice,
 *   home/away). Match 1 = p1 vs p2, Match 2 = p2 vs p1 (player order swapped).
 *   Applies whenever N=2, regardless of org setting (the setting governs whether
 *   2-player poules are allowed; if one exists, it must be played twice).
 *
 * @param {number} numPlayers
 * @param {Array|null} players - Optional player objects with a `.club` field
 *   (1-based index matches idx in the returned schedule).
 */
// ─── FFB Code Sportif Article 6.2.09 — Tableaux d'ordre de matchs ──────────
// Fixed match sequences per poule size, as prescribed by the FFB.
// p1_idx / p2_idx are 1-based player positions within the poule (serpentine order).
// 5-player table: confirmed from Code Sportif FFB Carambole 2025-2026.
// 3/4-player tables: standard balanced round-robin (pending FFB verification).
const FFB_MATCH_TABLES = {
  2: [
    { p1_idx: 1, p2_idx: 2 },
    { p1_idx: 2, p2_idx: 1 }   // play each other twice
  ],
  3: [
    { p1_idx: 1, p2_idx: 2 },
    { p1_idx: 1, p2_idx: 3 },
    { p1_idx: 2, p2_idx: 3 }
  ],
  4: [
    { p1_idx: 1, p2_idx: 4 },
    { p1_idx: 2, p2_idx: 3 },
    { p1_idx: 1, p2_idx: 3 },
    { p1_idx: 2, p2_idx: 4 },
    { p1_idx: 1, p2_idx: 2 },
    { p1_idx: 3, p2_idx: 4 }
  ],
  5: [
    // Corrected V 2.0.757 — order verified against CDB9394 official FDM spreadsheet.
    // Within each round two matches run simultaneously; the CDB assigns them to
    // specific tables, so the intra-round ordering matters for table allocation.
    // Round 1: { p1_idx: 2, p2_idx: 5 } on T1, { p1_idx: 3, p2_idx: 4 } on T2
    // Round 2: { p1_idx: 2, p2_idx: 3 } on T1, { p1_idx: 1, p2_idx: 5 } on T2
    // Round 3: { p1_idx: 1, p2_idx: 4 } on T1, { p1_idx: 3, p2_idx: 5 } on T2
    // Round 4: { p1_idx: 1, p2_idx: 3 } on T1, { p1_idx: 2, p2_idx: 4 } on T2
    // Round 5: { p1_idx: 4, p2_idx: 5 } on T1, { p1_idx: 1, p2_idx: 2 } on T2
    { p1_idx: 2, p2_idx: 5 },  // M1
    { p1_idx: 3, p2_idx: 4 },  // M2
    { p1_idx: 2, p2_idx: 3 },  // M3
    { p1_idx: 1, p2_idx: 5 },  // M4
    { p1_idx: 1, p2_idx: 4 },  // M5
    { p1_idx: 3, p2_idx: 5 },  // M6
    { p1_idx: 1, p2_idx: 3 },  // M7
    { p1_idx: 2, p2_idx: 4 },  // M8
    { p1_idx: 4, p2_idx: 5 },  // M9
    { p1_idx: 1, p2_idx: 2 }   // M10
  ]
};

/**
 * Build the canonical FFB match order for a poule of numPlayers.
 * Applies same-club rule (art. 6.2.09 §9): if a same-club pair exists it is
 * promoted to match_number 1 (swap with the pair currently in position 0).
 * For sizes not covered by FFB_MATCH_TABLES, falls back to lexicographic order.
 *
 * @param {number}   numPlayers
 * @param {Array}    players    - player objects with .club (1-based index order); may be null
 * @returns {Array}  [{match_number, p1_idx, p2_idx}, ...]
 */
function getFFBMatchOrder(numPlayers, players) {
  let pairs;

  if (FFB_MATCH_TABLES[numPlayers]) {
    pairs = FFB_MATCH_TABLES[numPlayers].map(p => ({ ...p }));
  } else {
    // Fallback: lexicographic order for sizes not yet in the FFB table
    pairs = [];
    for (let i = 1; i <= numPlayers; i++) {
      for (let j = i + 1; j <= numPlayers; j++) {
        pairs.push({ p1_idx: i, p2_idx: j });
      }
    }
  }

  // Same-club rule: promote same-club pair to Round 1 only when it would otherwise
  // appear in a later round. Intra-Round-1 swaps must NOT be applied — they only
  // change table assignment and override the FFB-prescribed order (article 6.2.09).
  // tablesPerRound = floor(numPlayers / 2): pairs at indices 0..tablesPerRound-1
  // are all simultaneous (Round 1), so any same-club pair already there needs no move.
  if (players && players.length === numPlayers) {
    const tablesPerRound = Math.floor(numPlayers / 2);
    const isSameClub = (p1i, p2i) => {
      const c1 = (players[p1i - 1]?.club || '').trim().toLowerCase();
      const c2 = (players[p2i - 1]?.club || '').trim().toLowerCase();
      return c1 && c1 === c2;
    };
    const scIdx = pairs.findIndex(p => isSameClub(p.p1_idx, p.p2_idx));
    // Only promote if same-club pair is NOT already in Round 1
    if (scIdx >= tablesPerRound) {
      [pairs[0], pairs[scIdx]] = [pairs[scIdx], pairs[0]];
    }
  }

  return pairs.map((p, i) => ({ match_number: i + 1, ...p }));
}

/**
 * Build a flat match list using FFB canonical order (article 6.2.09).
 * Same-club pair is promoted to Round 1 only when it would otherwise appear
 * in a later round (intra-Round-1 swaps are never applied).
 *
 * @param {number} numPlayers
 * @param {Array|null} players
 * @returns {Array} [{match_number, p1_idx, p2_idx}, ...]
 */
function roundRobinSchedule(numPlayers, players = null) {
  return getFFBMatchOrder(numPlayers, players);
}

/**
 * V 2.0.752 — Generate a round-robin match schedule with table allocation
 * following FFB article 6.2.09 match tables.
 *
 * Matches are ordered by the FFB canonical sequence (same-club pair first when
 * applicable). They are then grouped into simultaneous rounds of tc matches
 * (tc = number of available tables). Consecutive pairs in the FFB sequence are
 * guaranteed to have no player overlap, so any tc consecutive matches can run
 * simultaneously.
 *
 * @param {Array}    players      - player objects with .club (1-based index order)
 * @param {number[]} tableNumbers - physical table numbers from ddj_session
 * @returns {Array} Flat list: {match_number, round_number, table_number, p1_idx, p2_idx}
 */
function roundRobinRoundsWithTables(players, tableNumbers) {
  const n = players.length;
  const tc = tableNumbers.length;
  if (n < 2 || tc < 1) return [];

  const ordered = getFFBMatchOrder(n, players);

  const result = [];
  for (let i = 0; i < ordered.length; i++) {
    const roundNumber = Math.floor(i / tc) + 1;
    const posInRound = i % tc;
    result.push({
      match_number: ordered[i].match_number,
      round_number: roundNumber,
      table_number: tableNumbers[posInRound],
      p1_idx: ordered[i].p1_idx,
      p2_idx: ordered[i].p2_idx
    });
  }
  return result;
}

/**
 * Compute match points for a single match given player scores.
 * Returns { p1_mp, p2_mp, outcome } where outcome ∈ 'p1_win' | 'p2_win' | 'draw'.
 * Null scores ⇒ match not played ⇒ returns null.
 */
function computeMatchPoints(p1_points, p2_points, settings) {
  if (p1_points == null || p2_points == null) return null;
  const mpDraw = parseInt(settings.scoring_match_points_draw ?? '1', 10);
  const mpLoss = parseInt(settings.scoring_match_points_loss ?? '0', 10);
  const mpWin = 2; // FFB standard (with draws worth 1 each, a match always distributes 2 MP total)

  if (p1_points > p2_points) return { p1_mp: mpWin, p2_mp: mpLoss, outcome: 'p1_win' };
  if (p1_points < p2_points) return { p1_mp: mpLoss, p2_mp: mpWin, outcome: 'p2_win' };
  return { p1_mp: mpDraw, p2_mp: mpDraw, outcome: 'draw' };
}

/**
 * Build the live classement for a single poule given its player list and
 * match results. Applies FFB auto-tiebreak rules. Returns an ordered array
 * of { licence, player_name, club, wins, draws, losses, match_points,
 * points_scored, reprises, moyenne, best_serie, rank, has_tie_below }.
 */
function buildPouleClassement(players, matches, settings) {
  // Accumulate per-player stats
  const statsByLic = new Map();
  for (const p of players) {
    statsByLic.set(p.licence_normalized, {
      licence: p.licence,
      licence_normalized: p.licence_normalized,
      player_name: p.player_name,
      club: p.club,
      wins: 0, draws: 0, losses: 0,
      match_points: 0,
      points_scored: 0,
      reprises: 0,
      best_serie: 0,
      h2h_wins: new Set() // whom this player beat head-to-head
    });
  }

  for (const m of matches) {
    if (m.p1_points == null || m.p2_points == null) continue;
    const mp = computeMatchPoints(m.p1_points, m.p2_points, settings);
    if (!mp) continue;
    const s1 = statsByLic.get(m.p1_licence_normalized);
    const s2 = statsByLic.get(m.p2_licence_normalized);
    if (!s1 || !s2) continue;
    s1.match_points += mp.p1_mp;
    s2.match_points += mp.p2_mp;
    s1.points_scored += m.p1_points;
    s2.points_scored += m.p2_points;
    s1.reprises += m.p1_reprises || 0;
    s2.reprises += m.p2_reprises || 0;
    s1.best_serie = Math.max(s1.best_serie, m.p1_serie || 0);
    s2.best_serie = Math.max(s2.best_serie, m.p2_serie || 0);
    if (mp.outcome === 'p1_win') { s1.wins++; s2.losses++; s1.h2h_wins.add(m.p2_licence_normalized); }
    else if (mp.outcome === 'p2_win') { s2.wins++; s1.losses++; s2.h2h_wins.add(m.p1_licence_normalized); }
    else { s1.draws++; s2.draws++; }
  }

  // Compute moyenne
  const arr = Array.from(statsByLic.values()).map(s => ({
    ...s,
    moyenne: s.reprises > 0 ? s.points_scored / s.reprises : 0
  }));

  // FFB tiebreak chain
  arr.sort((a, b) => {
    if (b.match_points !== a.match_points) return b.match_points - a.match_points;
    if (b.moyenne !== a.moyenne) return b.moyenne - a.moyenne;
    if (b.best_serie !== a.best_serie) return b.best_serie - a.best_serie;
    // Head-to-head (only resolves 2-way ties cleanly; if 3-way, fall through)
    if (a.h2h_wins.has(b.licence_normalized) && !b.h2h_wins.has(a.licence_normalized)) return -1;
    if (b.h2h_wins.has(a.licence_normalized) && !a.h2h_wins.has(b.licence_normalized)) return 1;
    // Deterministic fallback
    return String(a.licence).localeCompare(String(b.licence));
  });

  // Assign ranks + flag unresolved ties (players with equal MP/moyenne/serie
  // that h2h didn't resolve — DdJ may want to flag this in UI later)
  for (let i = 0; i < arr.length; i++) {
    arr[i].rank = i + 1;
    const next = arr[i + 1];
    arr[i].has_tie_below = !!(next
      && next.match_points === arr[i].match_points
      && next.moyenne === arr[i].moyenne
      && next.best_serie === arr[i].best_serie);
    // Strip internal set before returning
    delete arr[i].h2h_wins;
  }

  return arr;
}

/**
 * Load everything Step 3 needs for a tournament:
 *  - tournament header
 *  - poules composition (from convocation_poules)
 *  - scheduled matches (round-robin per poule size)
 *  - saved results (from ddj_poule_matches)
 *  - live classement per poule
 */
async function loadPouleMatches(db, orgId, tournoiId) {
  // V 2.0.791 — SELECT extended with Quilles columns so the downstream
  // resolveDistance() call can find them.
  const tournament = await new Promise((resolve, reject) => {
    db.get(
      `SELECT tournoi_id, nom, mode, categorie, debut, lieu, tournament_number,
              tournament_format, tournament_type, tour_number,
              distance_matrix_id, fixed_distance, nb_tables
       FROM tournoi_ext
       WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [tournoiId, orgId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  if (!tournament) return { error: 'not_found' };

  // Game parameters for this tournament — needed so the DdJ match screen
  // can (a) show the targets (distance, reprises), (b) hard-clamp inputs
  // to those maxima so a typo can't produce 65 pts for a 60-pts game, and
  // (c) display the moyenne range (for future in-range sanity check).
  // Priority: per-tournament override > per-org default in game_parameters.
  // Mode/categorie match uses the UPPER+REPLACE pattern for whitespace tolerance.
  let gameParams = { distance: null, distance_reduite: null, reprises: null, moyenne_mini: null, moyenne_maxi: null };
  try {
    const override = await new Promise((resolve) => {
      db.get(
        `SELECT distance, reprises FROM tournament_parameter_overrides WHERE tournoi_id = $1`,
        [tournoiId],
        (err, row) => resolve(err ? null : row)
      );
    });
    const defaults = await new Promise((resolve) => {
      db.get(
        `SELECT distance, distance_reduite, reprises, moyenne_mini, moyenne_maxi
         FROM game_parameters
         WHERE UPPER(REPLACE(mode, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
           AND UPPER(categorie) = UPPER($2)
           AND ($3::int IS NULL OR organization_id = $3)
         LIMIT 1`,
        [tournament.mode || '', tournament.categorie || '', orgId],
        (err, row) => resolve(err ? null : row)
      );
    });
    if (defaults) gameParams = { ...defaults };
    // Override wins for distance/reprises only (reduced distance + moyennes
    // come from the category, not the per-tournament override)
    if (override && override.distance != null) gameParams.distance = override.distance;
    if (override && override.reprises != null) gameParams.reprises = override.reprises;
  } catch (e) {
    // Non-fatal — DdJ screen works without the reference strip, just no clamping
  }

  // V 2.0.791 — Sprint 2 D.2: for Quilles tournaments, override the
  // carambole game_parameters lookup with resolveDistance(). Reprises is
  // forced to null so the match screen doesn't render a reprises field.
  // V 2.0.805 — tournament_parameter_overrides.distance takes priority
  // (lets the DdJ change the distance on tournament day from the UI).
  try {
    const { isQuillesMode, resolveDistance } = require('../utils/quilles-helpers');
    if (isQuillesMode(tournament.mode)) {
      // The override SELECT was already run earlier; re-read it here for
      // clarity (and to keep this code self-contained).
      const overrideRow = await new Promise((resolve) => {
        db.get(
          `SELECT distance FROM tournament_parameter_overrides WHERE tournoi_id = $1`,
          [tournoiId],
          (err, r) => resolve(err ? null : r)
        );
      });
      if (overrideRow && overrideRow.distance != null) {
        gameParams = {
          distance: overrideRow.distance,
          distance_reduite: null,
          reprises: null,
          moyenne_mini: null,
          moyenne_maxi: null,
          _quilles_source: 'override',
          _quilles_warning: null
        };
      } else {
        const nbPoulesRow = await new Promise((resolve) => {
          db.get(
            `SELECT COUNT(DISTINCT poule_number)::int AS n
               FROM convocation_poules
              WHERE tournoi_id = $1`,
            [tournoiId],
            (err, r) => resolve(err ? null : r)
          );
        });
        const nbPoules = nbPoulesRow?.n || null;
        const resolved = await resolveDistance(tournament, nbPoules, { db });
        gameParams = {
          distance: resolved.distance,
          distance_reduite: null,
          reprises: null,
          moyenne_mini: null,
          moyenne_maxi: null,
          _quilles_source: resolved.source,
          _quilles_warning: resolved.warning || null
        };
      }
    }
  } catch (e) {
    console.error('[DdJ loadPouleMatches] Quilles resolveDistance error:', e.message);
  }

  // Load poule composition ordered canonically.
  // V 2.0.819 — Sprint 2 LBIF Phase 3 fix: EXCLUDE direct qualifiers
  // (is_direct_qualif=true, poule_number=0). They don't play in poules,
  // they go straight to the bracket. The matchs / bracket pages will
  // re-load them via a dedicated query when needed.
  const rows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT cp.licence, cp.player_name, cp.club, cp.poule_number, cp.player_order,
              p.first_name, p.last_name
       FROM convocation_poules cp
       LEFT JOIN players p
         ON REPLACE(cp.licence, ' ', '') = REPLACE(p.licence, ' ', '')
         AND ($2::int IS NULL OR p.organization_id = $2)
       WHERE cp.tournoi_id = $1
         AND UPPER(cp.licence) NOT LIKE 'TEST%'
         AND COALESCE(cp.is_direct_qualif, FALSE) = FALSE
         AND cp.poule_number > 0
       ORDER BY cp.poule_number, cp.player_order NULLS LAST, cp.licence`,
      [tournoiId, orgId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });

  // Saved matches (may be empty if DdJ hasn't entered anything yet)
  // V 2.0.697 — also pull started_at / finished_at so the front-end can
  // tell apart "not started" / "in progress" / "finished" without relying
  // solely on score presence.
  const savedRows = await new Promise((resolve, reject) => {
    // V 2.0.793 — Sprint 2 D.3: p1_points_subis / p2_points_subis added to
    // the SELECT (Quilles-only fields seeded V 2.0.768, null for carambole).
    db.all(
      `SELECT id, poule_number, match_number, table_number,
              p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie, p1_points_subis,
              p2_points, p2_reprises, p2_serie, p2_points_subis,
              referee_name, referee_licence,
              entered_at, started_at, finished_at
       FROM ddj_poule_matches
       WHERE tournoi_id = $1
       ORDER BY poule_number, match_number`,
      [tournoiId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });

  // Settings for match point scoring
  const settings = await appSettings.getOrgSettingsBatch(orgId, [
    'scoring_match_points_draw',
    'scoring_match_points_loss'
  ]);

  // Group by poule, build the schedule + merge saved data
  const byPoule = new Map();
  for (const r of rows) {
    const pn = r.poule_number;
    if (!byPoule.has(pn)) byPoule.set(pn, []);
    byPoule.get(pn).push({
      licence: r.licence,
      licence_normalized: String(r.licence || '').replace(/\s+/g, ''),
      player_name: r.player_name || `${r.last_name || ''} ${r.first_name || ''}`.trim() || r.licence,
      club: r.club,
      player_order: r.player_order
    });
  }

  const savedByKey = new Map();
  for (const s of savedRows) {
    savedByKey.set(`${s.poule_number}:${s.match_number}`, s);
  }

  const poules = [];
  for (const [pn, playersArr] of [...byPoule.entries()].sort((a, b) => a[0] - b[0])) {
    const schedule = roundRobinSchedule(playersArr.length, playersArr);
    const matches = schedule.map(sch => {
      const p1 = playersArr[sch.p1_idx - 1];
      const p2 = playersArr[sch.p2_idx - 1];
      const saved = savedByKey.get(`${pn}:${sch.match_number}`);
      const m = {
        id: saved ? saved.id : null,
        match_number: sch.match_number,
        table_number: saved ? saved.table_number : null,
        p1_licence: p1.licence,
        p1_licence_normalized: p1.licence_normalized,
        p1_name: p1.player_name,
        p1_club: p1.club,
        p2_licence: p2.licence,
        p2_licence_normalized: p2.licence_normalized,
        p2_name: p2.player_name,
        p2_club: p2.club,
        p1_points: saved ? saved.p1_points : null,
        p1_reprises: saved ? saved.p1_reprises : null,
        p1_serie: saved ? saved.p1_serie : null,
        p1_points_subis: saved ? saved.p1_points_subis : null,
        p2_points: saved ? saved.p2_points : null,
        p2_reprises: saved ? saved.p2_reprises : null,
        p2_serie: saved ? saved.p2_serie : null,
        p2_points_subis: saved ? saved.p2_points_subis : null,
        // V 2.0.707 — expose persisted referee so the UI can pre-fill the
        // input on reload (was being saved but never read back, which
        // looked like a "not persisted" bug to the DdJ).
        referee_name: saved ? saved.referee_name : null,
        referee_licence: saved ? saved.referee_licence : null,
        entered_at: saved ? saved.entered_at : null,
        started_at: saved ? saved.started_at : null,
        finished_at: saved ? saved.finished_at : null,
        // V 2.0.840 — was "both scores entered" which made intermediate
        // saves flip the UI to "Match terminé" and the TV ✓ icon. Now
        // uses the same truly-finished test as the save endpoint so the
        // front-end label, the TV deriveStatus, and the workflow gates
        // all agree on "intermediate score → still in progress".
        is_played: !!(saved
          && saved.p1_points != null
          && saved.p2_points != null
          && isMatchTrulyFinished(
              { p1_points: saved.p1_points, p1_reprises: saved.p1_reprises,
                p2_points: saved.p2_points, p2_reprises: saved.p2_reprises },
              gameParams))
      };
      // Convenience: derive match points + outcome for UI
      const mp = computeMatchPoints(m.p1_points, m.p2_points, settings);
      m.p1_match_points = mp ? mp.p1_mp : null;
      m.p2_match_points = mp ? mp.p2_mp : null;
      m.outcome = mp ? mp.outcome : null;
      return m;
    });

    const classement = buildPouleClassement(playersArr, matches, settings);

    // V 2.0.708 — expose a "home table" at the poule level so the Planning
    // panel can show "Poule 1 · Table 6" instead of "Table non assignée".
    // Pick the first match that has a table_number (auto-assigned at the
    // generate-poules step) — they're typically all the same per poule.
    const pouleTable = (() => {
      for (const m of matches) {
        if (m.table_number) return m.table_number;
      }
      return null;
    })();

    poules.push({
      number: pn,
      size: playersArr.length,
      table_number: pouleTable,
      players: playersArr,
      matches,
      classement,
      all_matches_played: matches.every(m => m.is_played),
      ties_exist: classement.some(c => c.has_tie_below)
    });
  }

  // V 2.0.745 — Determine mode: 'single_poule' when total players < threshold,
  // 'bracket' otherwise. Propagated to every consumer (TV feed, matchs page,
  // bracket loader) so all UI branches on a single authoritative value.
  const singlePouleThreshold =
    parseInt(await appSettings.getOrgSetting(orgId, 'single_poule_threshold')) || 6;
  const totalPlayers = poules.reduce((sum, p) => sum + p.players.length, 0);
  const mode = totalPlayers > 0 && totalPlayers < singlePouleThreshold
    ? 'single_poule'
    : 'bracket';

  // V 2.0.746 — Expose when poules were last saved so étape 3 can warn
  // if the composition predates today (stale after last-minute forfaits).
  // V 2.0.749 — Also fetch table_count + table_numbers for single_poule
  // round/table allocation (computed on-the-fly from ddj_session).
  const sessionRow = await new Promise((resolve) => {
    db.get(
      `SELECT poules_saved_at, table_count, table_numbers FROM ddj_session WHERE tournoi_id = $1`,
      [tournoiId],
      (err, row) => resolve(err ? null : row)
    );
  });
  const poulesSavedAt = sessionRow ? sessionRow.poules_saved_at : null;

  // V 2.0.749 — In single_poule mode, rebuild each poule's match schedule
  // using Berger rounds + table allocation from the DdJ session.
  let sessionTableCount = 0;
  let sessionTableNumbers = null;
  if (mode === 'single_poule' && sessionRow && sessionRow.table_count) {
    sessionTableCount = parseInt(sessionRow.table_count) || 0;
    if (sessionTableCount > 0) {
      sessionTableNumbers = parseTableNumbers(sessionRow.table_numbers, sessionTableCount);
      // Recompute each poule's matches with round + table info
      for (const poule of poules) {
        const roundedSchedule = roundRobinRoundsWithTables(poule.players, sessionTableNumbers);
        for (const m of poule.matches) {
          const rs = roundedSchedule.find(s => s.match_number === m.match_number);
          if (rs) {
            m.round_number = rs.round_number;
            m.table_number = rs.table_number;
          }
        }
      }
    }
  }

  return {
    tournament, poules, settings, game_params: gameParams,
    mode, poules_saved_at: poulesSavedAt,
    // V 2.0.749 — Table allocation metadata for single_poule mode
    table_count: mode === 'single_poule' ? sessionTableCount : null,
    table_numbers: mode === 'single_poule' ? sessionTableNumbers : null
  };
}

// GET /api/directeur-jeu/competitions/:id/poule-matches
router.get('/competitions/:id/poule-matches', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    const result = await loadPouleMatches(db, orgId, tournoiId);
    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }
    if (!result.poules || result.poules.length === 0) {
      return res.status(400).json({
        error: 'Aucune poule composée — retournez à l\'étape 2 pour générer et valider les poules'
      });
    }
    res.json(result);
  } catch (err) {
    console.error('[DdJ] /poule-matches GET error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des matchs' });
  }
});

// PUT /api/directeur-jeu/competitions/:id/poule-matches
// Body: { poule_number, match_number, p1_points, p1_reprises, p1_serie,
//          p2_points, p2_reprises, p2_serie, table_number? }
// Upserts the match and returns the updated classement for the poule.
router.put('/competitions/:id/poule-matches', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  const b = req.body || {};
  const pn = parseInt(b.poule_number, 10);
  const mn = parseInt(b.match_number, 10);
  if (!Number.isFinite(pn) || !Number.isFinite(mn)) {
    return res.status(400).json({ error: 'poule_number et match_number requis' });
  }

  // Basic sanity checks on scores
  // V 2.0.793 — Sprint 2 D.3: p1_points_subis / p2_points_subis added for
  // Quilles matches (loser's accumulated score). Carambole matches leave
  // them null. Same positive-integer-or-null parsing as the other fields.
  const scoreFields = [
    'p1_points', 'p1_reprises', 'p1_serie', 'p1_points_subis',
    'p2_points', 'p2_reprises', 'p2_serie', 'p2_points_subis'
  ];
  const parsed = {};
  for (const f of scoreFields) {
    const v = b[f];
    if (v === null || v === undefined || v === '') {
      parsed[f] = null;
    } else {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `${f} doit être un entier positif ou null` });
      }
      parsed[f] = n;
    }
  }

  try {
    // Verify tournament belongs to caller's org
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

    // Reload the current poule composition so we can set p1/p2 licences
    // from the actual state (defense against a stale client sending bogus
    // matchNumber that doesn't match the current poule).
    const ctx = await loadPouleMatches(db, orgId, tournoiId);
    if (ctx.error) return res.status(404).json({ error: 'Tournoi introuvable' });
    const poule = ctx.poules.find(p => p.number === pn);
    if (!poule) return res.status(400).json({ error: 'Poule inconnue' });
    const match = poule.matches.find(m => m.match_number === mn);
    if (!match) return res.status(400).json({ error: 'Match inconnu dans cette poule' });

    // Server-side max validation — defense in depth. Client clamps but a
    // buggy / malicious client could still POST 999; we reject here so the
    // DB never holds points > distance_max or reprises > reprises_max.
    const gp = ctx.game_params || {};
    if (gp.distance != null) {
      if (parsed.p1_points != null && parsed.p1_points > gp.distance) {
        return res.status(400).json({ error: `Points J1 supérieurs à la distance (${gp.distance})` });
      }
      if (parsed.p2_points != null && parsed.p2_points > gp.distance) {
        return res.status(400).json({ error: `Points J2 supérieurs à la distance (${gp.distance})` });
      }
    }
    if (gp.reprises != null) {
      if (parsed.p1_reprises != null && parsed.p1_reprises > gp.reprises) {
        return res.status(400).json({ error: `Reprises J1 supérieures au maximum (${gp.reprises})` });
      }
      if (parsed.p2_reprises != null && parsed.p2_reprises > gp.reprises) {
        return res.status(400).json({ error: `Reprises J2 supérieures au maximum (${gp.reprises})` });
      }
    }

    const tableNumber = b.table_number != null && b.table_number !== ''
      ? parseInt(b.table_number, 10) || null
      : null;

    // V 2.0.842 — Require "meilleure série" before allowing a save that
    // would finalize the match. Carambole only — Quilles matches have
    // no série field (Sprint 2 D.3). Intermediate saves (match still
    // "en cours") are unaffected so the DdJ can keep logging partial
    // scores throughout play without being blocked.
    const willFinish = isMatchTrulyFinished(parsed, gp);
    if (willFinish) {
      let mode = '';
      try {
        const trow = await new Promise((resolve, reject) => {
          db.get('SELECT mode FROM tournoi_ext WHERE tournoi_id = $1',
            [tournoiId], (err, row) => err ? reject(err) : resolve(row));
        });
        mode = trow ? trow.mode : '';
      } catch (_) { /* fall through, treat as carambole */ }
      let isQuilles = false;
      try {
        const { isQuillesMode } = require('../utils/quilles-helpers');
        isQuilles = isQuillesMode(mode);
      } catch (_) { /* helper unavailable, treat as carambole */ }
      if (!isQuilles && (parsed.p1_serie == null || parsed.p2_serie == null)) {
        return res.status(400).json({
          error: 'Meilleure série obligatoire pour clôturer le match. Renseignez-la pour les deux joueurs (ou enregistrez un score intermédiaire pour l\'instant).'
        });
      }
    }

    // V3 referee fields (optional). When the DdJ submits via the V3 form,
    // these are filled. Older callers can omit them and we just store NULL.
    const refereeName = (b.referee_name || '').trim() || null;
    const refereeLicence = (b.referee_licence || '').trim() || null;

    // V3 timestamps:
    //   - started_at : preserved if already set (the DdJ may have called
    //     POST .../start when opening the score page). If NULL, we fall
    //     back to NOW() so the row always has a coherent start time.
    //   - finished_at : set to NOW() whenever a score is saved. The
    //     match is considered "in progress" if started_at IS NOT NULL
    //     AND finished_at IS NULL (see tables-status endpoint).
    // UPSERT the match
    // V 2.0.793 — p1_points_subis / p2_points_subis (Quilles loser's score)
    // added to INSERT + DO UPDATE. Null for carambole matches.
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_poule_matches
           (tournoi_id, poule_number, match_number, table_number,
            p1_licence, p2_licence,
            p1_points, p1_reprises, p1_serie, p1_points_subis,
            p2_points, p2_reprises, p2_serie, p2_points_subis,
            entered_at, entered_by,
            referee_name, referee_licence,
            started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 CURRENT_TIMESTAMP, $15, $16, $17,
                 CURRENT_TIMESTAMP,
                 CASE WHEN $18::bool THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT (tournoi_id, poule_number, match_number)
         DO UPDATE SET
           -- V 2.0.700 — preserve the existing table_number when the
           -- caller didn't specify one (e.g. saveMatch payload omits it).
           table_number = COALESCE(EXCLUDED.table_number, ddj_poule_matches.table_number),
           p1_points = EXCLUDED.p1_points,
           p1_reprises = EXCLUDED.p1_reprises,
           p1_serie = EXCLUDED.p1_serie,
           p1_points_subis = EXCLUDED.p1_points_subis,
           p2_points = EXCLUDED.p2_points,
           p2_reprises = EXCLUDED.p2_reprises,
           p2_serie = EXCLUDED.p2_serie,
           p2_points_subis = EXCLUDED.p2_points_subis,
           entered_at = CURRENT_TIMESTAMP,
           entered_by = EXCLUDED.entered_by,
           referee_name = EXCLUDED.referee_name,
           referee_licence = EXCLUDED.referee_licence,
           started_at = COALESCE(ddj_poule_matches.started_at, CURRENT_TIMESTAMP),
           -- V 2.0.829 — Conditional finished_at. See isMatchTrulyFinished()
           -- top of file. Lets intermediate score entries stay "in progress".
           finished_at = CASE WHEN $18::bool THEN CURRENT_TIMESTAMP ELSE NULL END`,
        [
          tournoiId, pn, mn, tableNumber,
          match.p1_licence, match.p2_licence,
          parsed.p1_points, parsed.p1_reprises, parsed.p1_serie, parsed.p1_points_subis,
          parsed.p2_points, parsed.p2_reprises, parsed.p2_serie, parsed.p2_points_subis,
          req.user.userId || null,
          refereeName, refereeLicence,
          isMatchTrulyFinished(parsed, gp)
        ],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Activity log
    try {
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO activity_logs
             (user_name, action_type, action_status, target_type, target_id, target_name, details, app_source)
           VALUES ($1, 'ddj_match_saved', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [
            req.user.username || 'DdJ',
            tournoiId,
            `Tournoi ${tournoiId} / Poule ${pn} / Match ${mn}`,
            JSON.stringify({ poule_number: pn, match_number: mn, ...parsed })
          ],
          () => resolve()
        );
      });
    } catch (e) { /* non-fatal */ }

    // Reload the poule so classement is correct after the new write
    const reload = await loadPouleMatches(db, orgId, tournoiId);
    const updatedPoule = reload.poules.find(p => p.number === pn);

    // V 2.0.711 — Option α: when this save was the last poule match of
    // the day (all poules now complete), eagerly allocate tables to the
    // bracket and the matchs de classement so the TV / Planning show the
    // full afternoon plan as soon as the poules end. loadBracket and
    // loadConsolante trigger autoAssignPhaseTables internally; we just
    // call them and discard the result. Fire-and-forget — the response
    // to the DdJ is already shaped from the poule reload above.
    const allDone = (reload.poules || []).length > 0
      && reload.poules.every(p => p.all_matches_played);
    if (allDone) {
      try {
        await loadBracket(db, orgId, tournoiId);
        await loadConsolante(db, orgId, tournoiId);
      } catch (e) {
        console.error('[DdJ] post-poule auto-allocation failed:', e);
        // non-fatal — lazy allocation still kicks in next time the
        // bracket / classement page is opened
      }
    }

    res.json({
      success: true,
      poule: updatedPoule
    });
  } catch (err) {
    console.error('[DdJ] /poule-matches PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du match' });
  }
});

// ============================================================================
// STEP 4 — BRACKET (phase finale)
// ============================================================================
//
// Seeding: we pool every poule's classement and apply the FFB tiebreak
// chain globally (match_points ↓ → moyenne ↓ → best_serie ↓ → licence).
// Top N qualify for the bracket. bracket_size is an org setting; MVP is
// hardcoded to 4 here.
//
// Bracket for size=4:
//   SF1: seed 1 vs seed 4
//   SF2: seed 2 vs seed 3
//   F  : winner(SF1) vs winner(SF2) → 1st / 2nd
//   PF : loser(SF1)  vs loser(SF2)  → 3rd / 4th
//
// F and PF are rendered "pending" until their upstream SF is saved. The
// final places 1–4 are derived from the bracket results; places 5+ come
// from Step 5 (matchs de classement), which is a separate commit.
//
// The bracket STRUCTURE is derived at read-time — not persisted. Only
// the match SCORES live in ddj_bracket_matches. This means: if the DdJ
// corrects a poule result after the bracket started, the seeding
// recomputes correctly. (Risk: already-entered bracket scores might now
// belong to the wrong players. Handled defensively below.)
// ============================================================================

const BRACKET_SIZE = 4; // MVP: hardcoded until we support QFs (size=8)

/**
 * Pool all poule classements and pick the top N qualifiers using the
 * same FFB tiebreak chain used within a poule (match_points, moyenne,
 * best_serie, then head-to-head — which isn't meaningful across poules
 * so we fall through to licence for a deterministic tiebreak).
 *
 * Returns { qualifiers, non_qualifiers } each as ordered arrays of the
 * classement-row shape already returned by buildPouleClassement().
 */
function computeBracketSeeding(poules, size) {
  const pool = [];
  for (const p of poules) {
    for (const row of p.classement) {
      pool.push({ ...row, poule_number: p.number });
    }
  }
  // V 2.0.538 — FFB rule (CDB 93-94 confirmed 27/04/2026):
  // Poule rank is a HARD PRIMARY KEY. All 1st-of-poule are taken first,
  // then 2nd-of-poule, etc. A 2nd-of-poule with better match points than
  // a 1st-of-poule from another poule does NOT qualify ahead of them.
  // Within the same poule-rank bucket, the FFB tiebreak chain applies
  // (match points → moyenne → meilleure série → licence as deterministic
  // fallback) and the serpentine then runs over the resulting order.
  pool.sort((a, b) => {
    const ra = a.rank || 99, rb = b.rank || 99;
    if (ra !== rb) return ra - rb;
    if (b.match_points !== a.match_points) return b.match_points - a.match_points;
    if ((b.moyenne || 0) !== (a.moyenne || 0)) return (b.moyenne || 0) - (a.moyenne || 0);
    if ((b.best_serie || 0) !== (a.best_serie || 0)) return (b.best_serie || 0) - (a.best_serie || 0);
    return String(a.licence).localeCompare(String(b.licence));
  });
  return {
    qualifiers: pool.slice(0, size),
    non_qualifiers: pool.slice(size)
  };
}

/**
 * Given a saved bracket match row (with p1_points etc), derive who won
 * and who lost, using the same match-points rule as the poule matches.
 * Returns { winner_licence, loser_licence, outcome } or null if the
 * match isn't played yet.
 */
function deriveBracketOutcome(match) {
  if (match == null || match.p1_points == null || match.p2_points == null) return null;
  if (match.p1_points > match.p2_points) {
    return { winner_licence: match.p1_licence, loser_licence: match.p2_licence, outcome: 'p1_win' };
  }
  if (match.p1_points < match.p2_points) {
    return { winner_licence: match.p2_licence, loser_licence: match.p1_licence, outcome: 'p2_win' };
  }
  // Draws don't really exist in a knockout bracket — if it happens, we
  // keep the current order (p1 "wins" by convention) and flag it so the
  // UI can hint the DdJ to fix it. In real play this shouldn't occur
  // since a knockout match MUST have a winner.
  return { winner_licence: match.p1_licence, loser_licence: match.p2_licence, outcome: 'draw', invalid: true };
}

/**
 * V 2.0.708 — Auto-assign tables to phases that don't yet have one.
 *
 * Lazy-persistent: when the DdJ first opens the bracket / matchs de
 * classement page after the poules are done, this is called as part of
 * loadBracket / loadConsolante. For each phase that's ready to play
 * (`can_enter`) but doesn't have a saved table_number yet, we pick one
 * from the session.table_numbers rotation and INSERT a stub row
 * (table_number only, no scores, no started_at). The stub becomes
 * visible on the public TV and the planning panel.
 *
 * If the DdJ later overrides the table by clicking ▶ Match commencé
 * with a different table, the COALESCE in the /start endpoint preserves
 * the override (since started_at is what gates "match commenced").
 *
 * @param {object} db
 * @param {number} tournoiId
 * @param {string} tableName  'ddj_bracket_matches' | 'ddj_consolante_matches'
 * @param {Array}  phases     mutated in place: phases without table_number
 *                            get a default assigned
 */
async function autoAssignPhaseTables(db, tournoiId, tableName, phases, options = {}) {
  if (!Array.isArray(phases) || phases.length === 0) return;
  const { excludeTables = [], maxTables = null } = options;

  // Read session
  const session = await new Promise((resolve) => {
    db.get(
      `SELECT table_count, table_numbers FROM ddj_session WHERE tournoi_id = $1`,
      [tournoiId],
      (err, row) => resolve(err ? null : row)
    );
  });
  if (!session) return;
  const allTables = parseTableNumbers(session.table_numbers, session.table_count);
  if (!allTables.length) return;

  // V 2.0.711 — Determine the rotation of tables this phase group is
  // allowed to use. Two cap mechanisms:
  //   - excludeTables: filter out tables used by another phase group
  //     (e.g. consolante excludes the bracket's tables so the two run
  //     in parallel without claiming the same billard).
  //   - maxTables: cap the rotation length, so the bracket reserves only
  //     2 tables (SF1+SF2 in parallel, then F+PF reuse the same 2) and
  //     the remaining tables go to the consolante.
  // If both filters leave zero usable tables (very small clubs), fall
  // back to the full rotation — degraded mode is better than no table.
  const excluded = new Set(excludeTables);
  let tables = allTables.filter(t => !excluded.has(t));
  if (maxTables && tables.length > maxTables) tables = tables.slice(0, maxTables);
  if (!tables.length) tables = allTables;
  const allowed = new Set(tables);

  // V 2.0.711 — Cycle through the allowed tables. Skip:
  //   - true round-1 byes (has_bye AND no depends_on → no opponent ever)
  //   - phases that are already started (DdJ has begun playing)
  // Generalised self-heal: reset any existing allocation that's NOT in
  // the allowed set (covers both 'table conflict with another phase
  // group' and 'pre-V711 over-allocation that claimed too many tables').
  let cursor = 0;
  for (const ph of phases) {
    const isPureBye = ph.has_bye && (!Array.isArray(ph.depends_on) || ph.depends_on.length === 0);
    if (isPureBye) continue;
    if (ph.started_at) continue;

    if (ph.table_number && !allowed.has(ph.table_number)) {
      await new Promise((resolve) => {
        db.run(
          `UPDATE ${tableName} SET table_number = NULL
           WHERE tournoi_id = $1 AND phase = $2 AND started_at IS NULL`,
          [tournoiId, ph.phase],
          () => resolve()
        );
      });
      ph.table_number = null;
    }
    if (ph.table_number) continue;
    const t = tables[cursor % tables.length];
    cursor++;
    await new Promise((resolve) => {
      db.run(
        `INSERT INTO ${tableName} (tournoi_id, phase, table_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (tournoi_id, phase) DO UPDATE SET
           table_number = COALESCE(${tableName}.table_number, EXCLUDED.table_number)`,
        [tournoiId, ph.phase, t],
        () => resolve()
      );
    });
    ph.table_number = t;
  }
}

/**
 * Build the full bracket state for a tournament:
 *  - seeding from poule classements
 *  - each phase (SF1, SF2, F, PF) with resolved players (or pending if
 *    the upstream SF isn't done yet)
 *  - final places 1-4 if F and PF are both saved
 */
async function loadBracket(db, orgId, tournoiId) {
  // Reuse Step 3's loadPouleMatches for classements + game_params
  const ctx = await loadPouleMatches(db, orgId, tournoiId);
  if (ctx.error) return ctx;

  // V 2.0.830 — Sprint 2 LBIF Phase 5: dispatch to Quilles-specific bracket
  // builder when the tournament is in Quilles mode. The Quilles bracket is
  // dynamic (8 or 16 players, phases EIGHTH/QF/SF/F/PF) and composed from
  // exempts + barrage winners + qualifiés d'office, not from the top of the
  // poule classements. Falling back to the carambole code below would seed
  // the wrong players. Carambole flow unchanged.
  try {
    const { isQuillesMode } = require('../utils/quilles-helpers');
    if (ctx.tournament && isQuillesMode(ctx.tournament.mode)) {
      return await loadBracketQuilles(db, orgId, tournoiId, ctx);
    }
  } catch (e) {
    console.error('[loadBracket] Quilles dispatch failed, falling through to carambole:', e.message);
    // Defensive fallthrough — carambole path still works for non-Quilles.
  }

  // V 2.0.745 — Single-poule guard: when the tournament is below the threshold
  // (e.g. 5 players) there is no bracket phase. Return a clean "no bracket"
  // context so all consumers (admin pages + TV feed) know to skip steps 4 & 5.
  if (ctx.mode === 'single_poule') {
    return {
      tournament: ctx.tournament,
      game_params: ctx.game_params,
      settings: ctx.settings,
      bracket_size: BRACKET_SIZE,
      can_start: false,
      mode: 'single_poule',
      qualifiers: [],
      non_qualifiers: [],
      phases: [],
      final_places: [],
      seed_override_active: false,
      post_poule_ranking: []
    };
  }

  const allPoulesPlayed = ctx.poules.every(p => p.all_matches_played);
  let { qualifiers, non_qualifiers } = computeBracketSeeding(ctx.poules, BRACKET_SIZE);

  // V 2.0.535 — Manual seed override: if the DdJ has reordered qualifiers
  // post-poules to match an external (potentially incorrect) FFB ranking,
  // apply that order BEFORE deriving SF pairings.
  let seedOverrideActive = false;
  const overrideRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT seed_position, licence FROM ddj_bracket_seed_overrides
       WHERE tournoi_id = $1 ORDER BY seed_position ASC`,
      [tournoiId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });
  if (overrideRows.length === qualifiers.length && overrideRows.length > 0) {
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const reordered = [];
    for (const r of overrideRows) {
      const target = qualifiers.find(q => norm(q.licence) === norm(r.licence));
      if (target) reordered.push(target);
    }
    if (reordered.length === qualifiers.length) {
      qualifiers = reordered;
      seedOverrideActive = true;
    }
  }

  // Fetch any saved bracket match rows
  // V 2.0.698 — also pull started_at / finished_at so the UI can show the
  // "▶ Match commencé" button vs "⏳ En cours" badge vs "✓ Terminé".
  // V 2.0.797 — Sprint 2 D.4: p1_points_subis / p2_points_subis added to
  // the bracket SELECT (Quilles-only fields seeded V 2.0.768).
  const savedRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, phase, table_number, p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie, p1_points_subis,
              p2_points, p2_reprises, p2_serie, p2_points_subis,
              referee_name, referee_licence,
              entered_at, started_at, finished_at
       FROM ddj_bracket_matches
       WHERE tournoi_id = $1`,
      [tournoiId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });
  const savedByPhase = new Map(savedRows.map(r => [r.phase, r]));

  // Helper: find a qualifier by licence (returns the full classement row
  // with poule_number) so UI can show "Poule 1" alongside the name.
  const findQualifier = (licNorm) =>
    qualifiers.find(q => q.licence_normalized === licNorm) || null;

  // Build each phase. Until the bracket can start (not all poules done
  // or < size qualifiers), everything is "pending" with null players.
  const canStart = allPoulesPlayed && qualifiers.length >= BRACKET_SIZE;
  const phases = [];

  const buildPhase = (phase, p1, p2, depends_on = null) => {
    const saved = savedByPhase.get(phase) || null;
    const m = {
      phase,
      can_enter: !!(p1 && p2),            // both players known
      depends_on,                          // list of upstream phases
      p1: p1 || null,
      p2: p2 || null,
      table_number: saved ? saved.table_number : null,
      p1_points: saved ? saved.p1_points : null,
      p1_reprises: saved ? saved.p1_reprises : null,
      p1_serie: saved ? saved.p1_serie : null,
      p1_points_subis: saved ? saved.p1_points_subis : null,
      p2_points: saved ? saved.p2_points : null,
      p2_reprises: saved ? saved.p2_reprises : null,
      p2_serie: saved ? saved.p2_serie : null,
      p2_points_subis: saved ? saved.p2_points_subis : null,
      // V 2.0.707 — expose persisted referee for UI pre-fill
      referee_name: saved ? saved.referee_name : null,
      referee_licence: saved ? saved.referee_licence : null,
      // V 2.0.840 — truly-finished test (see helper top of file).
      is_played: !!(saved
        && saved.p1_points != null
        && saved.p2_points != null
        && isMatchTrulyFinished(
            { p1_points: saved.p1_points, p1_reprises: saved.p1_reprises,
              p2_points: saved.p2_points, p2_reprises: saved.p2_reprises },
            ctx.game_params)),
      entered_at: saved ? saved.entered_at : null,
      started_at: saved ? saved.started_at : null,
      finished_at: saved ? saved.finished_at : null
    };
    // Derive match points + outcome for the UI
    if (m.is_played) {
      const mp = computeMatchPoints(m.p1_points, m.p2_points, ctx.settings || {});
      m.p1_match_points = mp ? mp.p1_mp : null;
      m.p2_match_points = mp ? mp.p2_mp : null;
      m.outcome = mp ? mp.outcome : null;
    } else {
      m.p1_match_points = null;
      m.p2_match_points = null;
      m.outcome = null;
    }
    // If the saved row's p1/p2 licences don't match the current expected
    // ones (because a poule result was edited post-hoc), flag it. UI can
    // then offer a "refresh" that DELETEs the stale bracket row.
    if (saved && p1 && p2) {
      const expected = [p1.licence_normalized, p2.licence_normalized].sort().join('|');
      const actual = [
        String(saved.p1_licence || '').replace(/\s+/g, ''),
        String(saved.p2_licence || '').replace(/\s+/g, '')
      ].sort().join('|');
      m.stale = expected !== actual;
    } else {
      m.stale = false;
    }
    return m;
  };

  // SF1 / SF2 players come straight from seeding
  const sf1 = canStart
    ? buildPhase('SF1', qualifiers[0], qualifiers[3])
    : buildPhase('SF1', null, null);
  const sf2 = canStart
    ? buildPhase('SF2', qualifiers[1], qualifiers[2])
    : buildPhase('SF2', null, null);
  phases.push(sf1, sf2);

  // F and PF depend on SF outcomes
  const sf1_out = deriveBracketOutcome({ ...sf1, p1_licence: sf1.p1?.licence, p2_licence: sf1.p2?.licence });
  const sf2_out = deriveBracketOutcome({ ...sf2, p1_licence: sf2.p1?.licence, p2_licence: sf2.p2?.licence });

  const winnerSF1 = sf1_out ? findQualifier(String(sf1_out.winner_licence).replace(/\s+/g, '')) : null;
  const loserSF1  = sf1_out ? findQualifier(String(sf1_out.loser_licence).replace(/\s+/g, '')) : null;
  const winnerSF2 = sf2_out ? findQualifier(String(sf2_out.winner_licence).replace(/\s+/g, '')) : null;
  const loserSF2  = sf2_out ? findQualifier(String(sf2_out.loser_licence).replace(/\s+/g, '')) : null;

  const f  = buildPhase('F',  winnerSF1, winnerSF2, ['SF1', 'SF2']);
  const pf = buildPhase('PF', loserSF1,  loserSF2,  ['SF1', 'SF2']);
  phases.push(f, pf);

  // V 2.0.711 — auto-assign tables. Bracket reserves only the first 2
  // tables (SF1+SF2 in parallel, then F+PF reuse the same 2). The
  // remaining tables are left for the Matchs de classement which run
  // in parallel during the afternoon.
  if (canStart) {
    await autoAssignPhaseTables(db, tournoiId, 'ddj_bracket_matches', phases, { maxTables: 2 });
  }

  // Final positions (1st-4th) if F and PF are both played
  let finalPlaces = null;
  if (f.is_played && pf.is_played) {
    const f_out  = deriveBracketOutcome({ ...f,  p1_licence: f.p1?.licence,  p2_licence: f.p2?.licence });
    const pf_out = deriveBracketOutcome({ ...pf, p1_licence: pf.p1?.licence, p2_licence: pf.p2?.licence });
    if (f_out && pf_out) {
      finalPlaces = [
        { place: 1, licence: f_out.winner_licence,  name: findQualifier(String(f_out.winner_licence).replace(/\s+/g, ''))?.player_name },
        { place: 2, licence: f_out.loser_licence,   name: findQualifier(String(f_out.loser_licence).replace(/\s+/g, ''))?.player_name },
        { place: 3, licence: pf_out.winner_licence, name: findQualifier(String(pf_out.winner_licence).replace(/\s+/g, ''))?.player_name },
        { place: 4, licence: pf_out.loser_licence,  name: findQualifier(String(pf_out.loser_licence).replace(/\s+/g, ''))?.player_name }
      ];
    }
  }

  // V 2.0.536 / V 2.0.538 — Intermediate post-poule FFB-style ranking for
  // the bracket page. Derived directly from the poule classements (which
  // carry the within-poule rank), so it respects the FFB primary key on
  // poule rank: all 1st-of-poule come first, then 2nd-of-poule, etc.
  // Within each poule-rank bucket, FFB tiebreak (MP → moyenne → série).
  const postPouleRanking = [];
  try {
    for (const p of ctx.poules || []) {
      for (const row of p.classement || []) {
        const matchesPlayed = (row.wins || 0) + (row.draws || 0) + (row.losses || 0);
        const winRate = matchesPlayed > 0 ? Math.round(((row.wins || 0) / matchesPlayed) * 100) : 0;
        postPouleRanking.push({
          licence: row.licence,
          name: row.player_name,
          club: row.club,
          poule_number: p.number,
          poule_rank: row.rank,
          matches_played: matchesPlayed,
          wins: row.wins || 0,
          draws: row.draws || 0,
          losses: row.losses || 0,
          match_points: row.match_points || 0,
          win_rate: winRate,
          total_points: row.points_scored || 0,
          total_reprises: row.reprises || 0,
          moyenne: Math.round(((row.moyenne) || 0) * 1000) / 1000,
          best_serie: row.best_serie || 0
        });
      }
    }
    postPouleRanking.sort((a, b) => {
      const ra = a.poule_rank || 99, rb = b.poule_rank || 99;
      if (ra !== rb) return ra - rb;
      if (b.match_points !== a.match_points) return b.match_points - a.match_points;
      if (b.moyenne !== a.moyenne) return b.moyenne - a.moyenne;
      if ((b.best_serie || 0) !== (a.best_serie || 0)) return (b.best_serie || 0) - (a.best_serie || 0);
      return String(a.licence).localeCompare(String(b.licence));
    });
    postPouleRanking.forEach((p, i) => { p.rank = i + 1; });
  } catch (err) {
    console.error('[DdJ] post_poule_ranking build error:', err);
  }

  return {
    tournament: ctx.tournament,
    game_params: ctx.game_params,
    settings: ctx.settings,
    bracket_size: BRACKET_SIZE,
    can_start: canStart,
    mode: 'bracket',
    qualifiers,
    non_qualifiers,
    phases,
    final_places: finalPlaces,
    seed_override_active: seedOverrideActive,
    post_poule_ranking: postPouleRanking
  };
}

// ============================================================================
// V 2.0.830 — Sprint 2 LBIF Phase 5: BRACKET DYNAMIQUE (Quilles only)
//
// Builds the dynamic 8- or 16-player bracket from the LBIF règlement:
//   - 8-bracket (N ∈ [12, 24], bracket_start = 'quarter'):
//       4 QF → 2 SF → F + PF (7 matches total)
//   - 16-bracket (N ∈ [25, 46], bracket_start = 'eighth'):
//       8 EIGHTH → 4 QF → 2 SF → F + PF (15 matches total)
//
// Qualifier composition (in seed order, highest seed first):
//   • exempts          (top nb_exempts_barrage of the post-poule serpentin)
//   • barrage winners  (in barrage match order)
//   • direct_qualifs   (out-of-poule players)
// For the LBIF exceptions where has_barrage = false (N ∈ {12, 23, 24}),
// all qualified-from-poules players (top 2 per poule, serpentin-reranked)
// take the bracket spots.
//
// Seeding follows the standard tennis-style cross-pairing so that top seeds
// are kept in opposite halves of the bracket:
//   8-bracket : (1v8, 4v5, 3v6, 2v7) → QF1+QF2 → SF1, QF3+QF4 → SF2
//   16-bracket: (1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15)
//
// Distance is resolved per-phase (eighth/quarter/semi/final) via the LBIF
// distance matrix so the UI can enforce phase-specific max values.
// ============================================================================

// Standard tennis-style bracket pairings (0-indexed seed positions).
// Designed so winners of (1,N) and (4,N-3) meet in SF1, keeping seeds 1 & 2
// on opposite halves. Generated by mirroring the bracket halves.
const _QUILLES_SEED_PAIRS = {
  8:  [[0,7], [3,4], [2,5], [1,6]],
  16: [[0,15], [7,8], [4,11], [3,12], [2,13], [5,10], [6,9], [1,14]]
};

async function loadBracketQuilles(db, orgId, tournoiId, pouleCtx) {
  const { getBracketConfig, computeReclassementSerpentin, resolveDistance } =
    require('../utils/quilles-helpers');

  // 1. Reuse loadBarrage to get exempts / barragistes / direct_qualifs /
  //    saved barrage matches + lbifCfg. loadBarrage also returns the
  //    tournament row already filtered by orgId.
  const barrageCtx = await loadBarrage(db, orgId, tournoiId);
  if (barrageCtx.error === 'not_found') return barrageCtx;
  if (barrageCtx.applicable === false && barrageCtx.reason !== 'lbif_no_barrage') {
    // single_poule fallback or carambole — return a no-bracket shell
    return _emptyQuillesBracket(pouleCtx);
  }

  const tournament = barrageCtx.tournament || pouleCtx.tournament;
  const lbifCfg = barrageCtx.lbif;
  if (!lbifCfg) return _emptyQuillesBracket(pouleCtx);
  const bracketSize = lbifCfg.bracket_size;
  const bracketStart = lbifCfg.bracket_start; // 'quarter' | 'eighth' | 'semi'

  if (!bracketSize || !_QUILLES_SEED_PAIRS[bracketSize]) {
    return _emptyQuillesBracket(pouleCtx);
  }

  // 2. Readiness: all poules done + (no barrage OR all barrage matches done)
  const allPoulesPlayed = (pouleCtx.poules || []).every(p => p.all_matches_played);
  const barrageReady = !lbifCfg.has_barrage || (
    barrageCtx.all_done &&
    (barrageCtx.matches || []).length === barrageCtx.expected_matches_count
  );

  // 3. Compose qualifiers in seed order
  const qualifiers = [];
  const mkQ = (src, p) => ({
    licence: p.licence,
    licence_normalized: String(p.licence || '').replace(/\s+/g, ''),
    player_name: p.player_name,
    club: p.club,
    source: src,
    poule_number: p.poule_number || null
  });

  if (lbifCfg.has_barrage) {
    // V 2.0.834 — Historically-grounded composition. We DERIVE exempts and
    // barragistes from the saved barrage matches (source of truth: who
    // actually played a barrage match IS a barragiste), instead of trusting
    // the current rerank. This is robust to any change in the rerank
    // algorithm between barrage setup and bracket build (e.g. V 2.0.832
    // making the tie-break deterministic shifted which players landed in
    // each bucket; the originally-recorded barrage roster takes precedence).

    // 1. All players who qualified from poules (top N per poule)
    const allPouleQualifiers = [];
    for (const poule of pouleCtx.poules || []) {
      const top = (poule.classement || []).slice(0, lbifCfg.qualified_per_poule);
      for (const c of top) {
        allPouleQualifiers.push({
          licence: c.licence,
          player_name: c.player_name,
          club: c.club,
          match_points: c.match_points,
          points_scored: c.points_scored || c.points || 0,
          poule_number: poule.number
        });
      }
    }
    const normLic = (s) => String(s || '').replace(/\s+/g, '');

    // 2. Licences of every player who actually played a saved barrage match
    const barragePlayed = new Set();
    for (const m of barrageCtx.matches || []) {
      if (m.p1_licence) barragePlayed.add(normLic(m.p1_licence));
      if (m.p2_licence) barragePlayed.add(normLic(m.p2_licence));
    }

    // 3. Helper: resolve any licence to a player object (poule classement
    //    first, then convocation_poules fallback for safety).
    const resolveByLicence = async (lic) => {
      const norm = normLic(lic);
      const inPoule = allPouleQualifiers.find(p => normLic(p.licence) === norm);
      if (inPoule) return inPoule;
      const row = await new Promise((resolve) => {
        db.get(
          `SELECT licence, player_name, club, poule_number
             FROM convocation_poules
            WHERE tournoi_id = $1 AND REPLACE(licence, ' ', '') = $2
            LIMIT 1`,
          [tournoiId, norm], (err, r) => resolve(err ? null : r)
        );
      });
      return row || { licence: norm, player_name: 'Joueur', club: null, poule_number: null };
    };

    // 4. Exempts = poule qualifiers who DIDN'T play barrage. Sorted by the
    //    current serpentin rerank (so display order is consistent with the
    //    barrage page).
    if (barragePlayed.size > 0) {
      const exemptCandidates = allPouleQualifiers.filter(p => !barragePlayed.has(normLic(p.licence)));
      // Use the same rerank to order them (deterministic since V 2.0.832).
      const rerankedExempts = computeReclassementSerpentin(exemptCandidates);
      for (const e of rerankedExempts) qualifiers.push(mkQ('exempt', e));
    } else {
      // No barrage played yet — fall back to the rerank's current exempts.
      for (const e of barrageCtx.exempts || []) qualifiers.push(mkQ('exempt', e));
    }

    // 5. Barrage winners (in match order) — resilient lookup across all
    //    poule qualifiers + convocation_poules fallback.
    for (const m of barrageCtx.matches || []) {
      const played = m.p1_points != null && m.p2_points != null;
      if (!played) continue;
      const winnerLic = m.p1_points > m.p2_points ? m.p1_licence : m.p2_licence;
      const winner = await resolveByLicence(winnerLic);
      if (winner) qualifiers.push(mkQ('barrage_winner', winner));
    }
    for (const dq of barrageCtx.direct_qualifs || []) qualifiers.push(mkQ('direct', dq));
  } else {
    // LBIF exceptions (N=12/23/24): no barrage, fill bracket from poule
    // top-2 + direct_qualifs via serpentin reranking.
    const fromPoules = [];
    for (const poule of pouleCtx.poules || []) {
      const top = (poule.classement || []).slice(0, lbifCfg.qualified_per_poule);
      for (const c of top) {
        fromPoules.push({
          licence: c.licence,
          player_name: c.player_name,
          club: c.club,
          match_points: c.match_points,
          points_scored: c.points_scored || c.points || 0,
          poule_number: poule.number
        });
      }
    }
    const reranked = computeReclassementSerpentin(fromPoules);
    const nFromPoules = Math.max(0, bracketSize - (barrageCtx.direct_qualifs || []).length);
    for (const p of reranked.slice(0, nFromPoules)) qualifiers.push(mkQ('exempt', p));
    for (const dq of barrageCtx.direct_qualifs || []) qualifiers.push(mkQ('direct', dq));
  }

  // V 2.0.833 — Dedupe qualifiers by licence. The shifted serpentin (V 2.0.832
  // deterministic tie-break) can put a player who already played the barrage
  // back into the exempts list, then they show up again as a barrage_winner
  // from the saved match. The first occurrence wins (exempts before barrage
  // winners before direct_qualifs).
  {
    const seen = new Set();
    for (let i = qualifiers.length - 1; i >= 0; i--) {
      if (seen.has(qualifiers[i].licence_normalized)) qualifiers.splice(i, 1);
      else seen.add(qualifiers[i].licence_normalized);
    }
    // Re-establish source priority by sorting: exempt → barrage_winner → direct
    const srcPri = { exempt: 0, barrage_winner: 1, direct: 2 };
    qualifiers.sort((a, b) => (srcPri[a.source] ?? 9) - (srcPri[b.source] ?? 9));
  }

  // 4. Apply manual seed override (DdJ may reorder seeds to match FFB ranking)
  let seedOverrideActive = false;
  const overrideRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT seed_position, licence FROM ddj_bracket_seed_overrides
       WHERE tournoi_id = $1 ORDER BY seed_position ASC`,
      [tournoiId], (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });
  if (overrideRows.length === qualifiers.length && overrideRows.length > 0) {
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const reordered = [];
    for (const r of overrideRows) {
      const target = qualifiers.find(q => q.licence_normalized === norm(r.licence));
      if (target) reordered.push(target);
    }
    if (reordered.length === qualifiers.length) {
      for (let i = 0; i < reordered.length; i++) qualifiers[i] = reordered[i];
      seedOverrideActive = true;
    }
  }

  // 5. Resolve distance per phase (LBIF matrix supports phase-aware values)
  const phaseDistances = {};
  for (const ph of ['eighth', 'quarter', 'semi', 'final']) {
    try {
      const r = await resolveDistance(tournament, lbifCfg.nb_poules, { db, phase: ph });
      phaseDistances[ph] = r ? r.distance : null;
    } catch (_) { phaseDistances[ph] = null; }
  }
  const distanceForPhase = (phase) => {
    if (phase === 'F' || phase === 'PF') return phaseDistances.final;
    if (phase === 'SF1' || phase === 'SF2') return phaseDistances.semi;
    if (phase.startsWith('QF')) return phaseDistances.quarter;
    if (phase.startsWith('EIGHTH')) return phaseDistances.eighth;
    return null;
  };

  // 6. Load saved bracket matches
  const savedRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, phase, table_number, p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie, p1_points_subis,
              p2_points, p2_reprises, p2_serie, p2_points_subis,
              referee_name, referee_licence,
              entered_at, started_at, finished_at
         FROM ddj_bracket_matches WHERE tournoi_id = $1`,
      [tournoiId], (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });
  const savedByPhase = new Map(savedRows.map(r => [r.phase, r]));

  const findQualifier = (licNorm) =>
    qualifiers.find(q => q.licence_normalized === licNorm) || null;
  const canStart = allPoulesPlayed && barrageReady && qualifiers.length >= bracketSize;

  const buildPhase = (phase, p1, p2, depends_on = null) => {
    const saved = savedByPhase.get(phase) || null;
    // V 2.0.851 — When the upstream chain didn't resolve a player (e.g. a
    // QF or SF was edited / cleared after the F was already played), fall
    // back to the licences stored on the saved row. These were written
    // when the match was actually entered, so they're the source of truth.
    // Without this, deeper-phase final_places would lose the winner's name
    // (observed in production: F was played but SF1 was "en attente", so
    // place #1 came back with licence=undefined → empty cell on the recap).
    if (!p1 && saved && saved.p1_licence) {
      p1 = findQualifier(String(saved.p1_licence).replace(/\s+/g, ''));
    }
    if (!p2 && saved && saved.p2_licence) {
      p2 = findQualifier(String(saved.p2_licence).replace(/\s+/g, ''));
    }
    const m = {
      phase,
      can_enter: !!(p1 && p2),
      depends_on,
      p1: p1 || null, p2: p2 || null,
      // V 2.0.851 — expose saved licences so callers can recover after a
      // chain break (used by the F/PF outcome derivation below + by
      // buildLbifClassement when it walks the phase list).
      p1_licence_saved: saved ? (saved.p1_licence || null) : null,
      p2_licence_saved: saved ? (saved.p2_licence || null) : null,
      table_number: saved ? saved.table_number : null,
      p1_points: saved ? saved.p1_points : null,
      p1_reprises: saved ? saved.p1_reprises : null,
      p1_serie: saved ? saved.p1_serie : null,
      p1_points_subis: saved ? saved.p1_points_subis : null,
      p2_points: saved ? saved.p2_points : null,
      p2_reprises: saved ? saved.p2_reprises : null,
      p2_serie: saved ? saved.p2_serie : null,
      p2_points_subis: saved ? saved.p2_points_subis : null,
      referee_name: saved ? saved.referee_name : null,
      referee_licence: saved ? saved.referee_licence : null,
      // V 2.0.840 — truly-finished test (see helper top of file).
      is_played: !!(saved
        && saved.p1_points != null
        && saved.p2_points != null
        && isMatchTrulyFinished(
            { p1_points: saved.p1_points, p1_reprises: saved.p1_reprises,
              p2_points: saved.p2_points, p2_reprises: saved.p2_reprises },
            pouleCtx.game_params)),
      entered_at: saved ? saved.entered_at : null,
      started_at: saved ? saved.started_at : null,
      finished_at: saved ? saved.finished_at : null,
      distance: distanceForPhase(phase)
    };
    if (m.is_played) {
      const mp = computeMatchPoints(m.p1_points, m.p2_points, pouleCtx.settings || {});
      m.p1_match_points = mp ? mp.p1_mp : null;
      m.p2_match_points = mp ? mp.p2_mp : null;
      m.outcome = mp ? mp.outcome : null;
    } else {
      m.p1_match_points = null; m.p2_match_points = null; m.outcome = null;
    }
    if (saved && p1 && p2) {
      const expected = [p1.licence_normalized, p2.licence_normalized].sort().join('|');
      const actual = [
        String(saved.p1_licence || '').replace(/\s+/g, ''),
        String(saved.p2_licence || '').replace(/\s+/g, '')
      ].sort().join('|');
      m.stale = expected !== actual;
    } else m.stale = false;
    return m;
  };

  // 7. Build all phases bottom-up
  const phases = [];
  const seedPairs = _QUILLES_SEED_PAIRS[bracketSize];

  let qfFeeders = []; // qualifier objects feeding QF1..QF4

  if (bracketStart === 'eighth') {
    // 8 EIGHTH matches → winners feed QFs in pairs
    const eighthWinners = [];
    for (let i = 0; i < 8; i++) {
      const phase = `EIGHTH${i + 1}`;
      const p1 = canStart ? qualifiers[seedPairs[i][0]] : null;
      const p2 = canStart ? qualifiers[seedPairs[i][1]] : null;
      const ph = buildPhase(phase, p1, p2);
      phases.push(ph);
      const out = ph.is_played ? deriveBracketOutcome({
        ...ph, p1_licence: ph.p1?.licence, p2_licence: ph.p2?.licence
      }) : null;
      eighthWinners.push(out
        ? findQualifier(String(out.winner_licence).replace(/\s+/g, ''))
        : null);
    }
    // QF1=E1w vs E2w, QF2=E3w vs E4w, QF3=E5w vs E6w, QF4=E7w vs E8w
    for (let q = 0; q < 4; q++) {
      const dep = [`EIGHTH${q*2+1}`, `EIGHTH${q*2+2}`];
      const qf = buildPhase(`QF${q + 1}`, eighthWinners[q*2], eighthWinners[q*2 + 1], dep);
      phases.push(qf);
      qfFeeders.push(qf);
    }
  } else {
    // bracket_start === 'quarter' (and bracket_size === 8)
    for (let q = 0; q < 4; q++) {
      const p1 = canStart ? qualifiers[seedPairs[q][0]] : null;
      const p2 = canStart ? qualifiers[seedPairs[q][1]] : null;
      const qf = buildPhase(`QF${q + 1}`, p1, p2);
      phases.push(qf);
      qfFeeders.push(qf);
    }
  }

  // SF1 = QF1 winner vs QF2 winner, SF2 = QF3 winner vs QF4 winner
  const qfWinners = qfFeeders.map(qf => {
    if (!qf.is_played) return null;
    const out = deriveBracketOutcome({
      ...qf, p1_licence: qf.p1?.licence, p2_licence: qf.p2?.licence
    });
    return out ? findQualifier(String(out.winner_licence).replace(/\s+/g, '')) : null;
  });
  const sf1 = buildPhase('SF1', qfWinners[0], qfWinners[1], ['QF1', 'QF2']);
  const sf2 = buildPhase('SF2', qfWinners[2], qfWinners[3], ['QF3', 'QF4']);
  phases.push(sf1, sf2);

  // F and PF from SF outcomes
  const sf1Out = sf1.is_played ? deriveBracketOutcome({ ...sf1, p1_licence: sf1.p1?.licence, p2_licence: sf1.p2?.licence }) : null;
  const sf2Out = sf2.is_played ? deriveBracketOutcome({ ...sf2, p1_licence: sf2.p1?.licence, p2_licence: sf2.p2?.licence }) : null;
  const winnerSF1 = sf1Out ? findQualifier(String(sf1Out.winner_licence).replace(/\s+/g, '')) : null;
  const loserSF1  = sf1Out ? findQualifier(String(sf1Out.loser_licence).replace(/\s+/g, ''))  : null;
  const winnerSF2 = sf2Out ? findQualifier(String(sf2Out.winner_licence).replace(/\s+/g, '')) : null;
  const loserSF2  = sf2Out ? findQualifier(String(sf2Out.loser_licence).replace(/\s+/g, ''))  : null;
  phases.push(buildPhase('F',  winnerSF1, winnerSF2, ['SF1', 'SF2']));
  phases.push(buildPhase('PF', loserSF1,  loserSF2,  ['SF1', 'SF2']));

  // 8. Final places (only when F + PF are both played)
  // V 2.0.851 — Use saved licences as the source of truth (p1_licence_saved
  // / p2_licence_saved set by buildPhase). Name lookup falls back to a
  // direct convocation_poules query when findQualifier returns null
  // (mirror of the V 2.0.833 pattern for barrage winners). Without these
  // two fallbacks, an upstream chain break (e.g. SF1 cleared) would leave
  // the F winner with licence=undefined → empty #1 on the podium.
  let finalPlaces = null;
  const f  = phases.find(ph => ph.phase === 'F');
  const pf = phases.find(ph => ph.phase === 'PF');
  if (f && f.is_played && pf && pf.is_played) {
    const fOut  = deriveBracketOutcome({
      ...f,
      p1_licence: f.p1?.licence  || f.p1_licence_saved,
      p2_licence: f.p2?.licence  || f.p2_licence_saved
    });
    const pfOut = deriveBracketOutcome({
      ...pf,
      p1_licence: pf.p1?.licence || pf.p1_licence_saved,
      p2_licence: pf.p2?.licence || pf.p2_licence_saved
    });
    if (fOut && pfOut) {
      const resolveName = async (lic) => {
        if (!lic) return null;
        const norm = String(lic).replace(/\s+/g, '');
        const q = findQualifier(norm);
        if (q && q.player_name) return q.player_name;
        // Fallback: look up directly in convocation_poules
        return await new Promise((resolve) => {
          db.get(
            `SELECT player_name FROM convocation_poules
              WHERE tournoi_id = $1 AND REPLACE(licence, ' ', '') = $2
              LIMIT 1`,
            [tournoiId, norm],
            (err, r) => resolve(err ? null : (r ? r.player_name : null))
          );
        });
      };
      finalPlaces = [
        { place: 1, licence: fOut.winner_licence,  name: await resolveName(fOut.winner_licence)  },
        { place: 2, licence: fOut.loser_licence,   name: await resolveName(fOut.loser_licence)   },
        { place: 3, licence: pfOut.winner_licence, name: await resolveName(pfOut.winner_licence) },
        { place: 4, licence: pfOut.loser_licence,  name: await resolveName(pfOut.loser_licence)  }
      ];
    }
  }

  // 9. Auto-assign tables. Quilles has no consolante so we use the full pool.
  if (canStart) {
    await autoAssignPhaseTables(db, tournoiId, 'ddj_bracket_matches', phases);
  }

  return {
    tournament,
    game_params: pouleCtx.game_params,
    settings: pouleCtx.settings,
    bracket_size: bracketSize,
    bracket_start: bracketStart,
    lbif: lbifCfg,
    phase_distances: phaseDistances,
    can_start: canStart,
    mode: 'lbif_bracket',
    qualifiers,
    non_qualifiers: [],
    phases,
    final_places: finalPlaces,
    seed_override_active: seedOverrideActive,
    post_poule_ranking: []
  };
}

function _emptyQuillesBracket(pouleCtx) {
  return {
    tournament: pouleCtx ? pouleCtx.tournament : null,
    game_params: pouleCtx ? pouleCtx.game_params : null,
    settings: pouleCtx ? pouleCtx.settings : null,
    bracket_size: 0,
    can_start: false,
    mode: 'lbif_bracket',
    qualifiers: [],
    non_qualifiers: [],
    phases: [],
    final_places: [],
    seed_override_active: false,
    post_poule_ranking: []
  };
}

// ============================================================================
// V 2.0.820 — Sprint 2 LBIF Phase 4: PHASE DE BARRAGE (Quilles only)
//
// Per LBIF chap 1.1.3, après les poules les top-2 de chaque poule sont
// reclassés (serpentin), puis :
//   - les "exempts" (top nb_exempts_barrage du reclassement) sautent le
//     barrage et vont direct au bracket
//   - les "barragistes" (suivants nb_barragistes) jouent un round
//     d'élimination directe
//   - les vainqueurs du barrage rejoignent les exempts + direct qualifs
//     dans le bracket
//
// Exceptions règlement : si N inscrits ∈ {12, 23, 24}, has_barrage=false
// → la phase entière est skippée, tous les qualifiés des poules vont
// direct au bracket.
// ============================================================================

/**
 * Load barrage state for a tournament: matches scheduled (if any),
 * the exempts list, the barragistes list, and a flag indicating whether
 * the barrage is applicable / startable / done.
 *
 * @returns {object} { applicable, can_start, started, all_done, matches,
 *   exempts, direct_qualifs, lbif: { nb_barragistes, nb_exempts_barrage },
 *   tournament, game_params }
 */
async function loadBarrage(db, orgId, tournoiId) {
  const { isQuillesMode, getBracketConfig, computeReclassementSerpentin, resolveDistance } = require('../utils/quilles-helpers');

  // V 2.0.822 — Defensive just-in-time table creation. The startup migration
  // in db-postgres.js V 2.0.820 should have created this table; if for any
  // reason the migration didn't run (deploy ordering, init error earlier in
  // the chain, manual rollback), we ensure the table exists before querying.
  // Idempotent — no-op if the table already exists.
  try {
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS ddj_barrage_matches (
          id SERIAL PRIMARY KEY,
          tournoi_id INTEGER NOT NULL REFERENCES tournoi_ext(tournoi_id) ON DELETE CASCADE,
          match_number INTEGER NOT NULL,
          table_number INTEGER,
          p1_licence TEXT NOT NULL,
          p2_licence TEXT NOT NULL,
          p1_points INTEGER,
          p1_points_subis INTEGER,
          p2_points INTEGER,
          p2_points_subis INTEGER,
          referee_name TEXT,
          referee_licence TEXT,
          entered_at TIMESTAMP,
          entered_by INTEGER,
          started_at TIMESTAMP,
          finished_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tournoi_id, match_number)
        )
      `, [], (err) => err ? reject(err) : resolve());
    });
  } catch (e) {
    console.error('[loadBarrage] defensive CREATE TABLE failed:', e.message);
  }

  // 1. Tournament (with Quilles columns)
  const tournament = await new Promise((resolve, reject) => {
    db.get(
      `SELECT tournoi_id, nom, mode, categorie, debut, lieu, organization_id,
              tournament_format, tournament_type, tour_number,
              distance_matrix_id, fixed_distance, nb_tables
         FROM tournoi_ext
        WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [tournoiId, orgId],
      (err, r) => err ? reject(err) : resolve(r)
    );
  });
  if (!tournament) return { error: 'not_found' };

  // 2. Skip barrage entirely for non-Quilles tournaments
  if (!isQuillesMode(tournament.mode)) {
    return { applicable: false, reason: 'carambole', tournament };
  }

  // 3. Load poule context to know if poules are done
  const pouleCtx = await loadPouleMatches(db, orgId, tournoiId);
  if (pouleCtx.error) return pouleCtx;

  const allPoulesDone = (pouleCtx.poules || []).every(p =>
    (p.matches || []).every(m => m.is_played)
  );

  // 4. Get LBIF config to know if barrage applies
  const totalPlayers = await new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*)::int AS n FROM convocation_poules WHERE tournoi_id = $1`,
      [tournoiId],
      (err, r) => err ? reject(err) : resolve(r?.n || 0)
    );
  });

  let lbifCfg;
  try {
    lbifCfg = await getBracketConfig(totalPlayers, { db });
  } catch (e) {
    return { applicable: false, reason: 'lbif_config_error', error: e.message, tournament };
  }

  // LBIF règlement exceptions : N ∈ {12, 23, 24} → no barrage
  if (!lbifCfg.has_barrage) {
    return {
      applicable: false,
      reason: 'lbif_no_barrage',
      lbif: lbifCfg,
      tournament,
      message: `Pas de barrage prévu par LBIF pour ${totalPlayers} joueurs. Les ${lbifCfg.qualified_per_poule * lbifCfg.nb_poules} qualifiés des poules vont direct au tableau final.`
    };
  }

  // 5. Compute qualified players from poules (top 2 per poule)
  const qualifiedFromPoules = [];
  for (const poule of pouleCtx.poules || []) {
    const classement = poule.classement || [];
    const top = classement.slice(0, lbifCfg.qualified_per_poule);
    for (const c of top) {
      qualifiedFromPoules.push({
        licence: c.licence,
        licence_normalized: String(c.licence || '').replace(/\s+/g, ''),
        player_name: c.player_name,
        club: c.club,
        match_points: c.match_points,
        points_scored: c.points_scored || c.points || 0,
        poule_number: poule.number
      });
    }
  }

  // 7. Load direct qualifs (out-of-poule)
  const direct_qualifs = await new Promise((resolve, reject) => {
    db.all(
      `SELECT cp.licence, cp.player_name, cp.club
         FROM convocation_poules cp
        WHERE cp.tournoi_id = $1
          AND COALESCE(cp.is_direct_qualif, FALSE) = TRUE
        ORDER BY cp.player_order`,
      [tournoiId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });

  // 8. Load saved barrage matches (loaded BEFORE the exempts/barragistes
  // split so the split can be historically grounded — see step 6).
  const savedMatches = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, match_number, table_number, p1_licence, p2_licence,
              p1_points, p1_points_subis, p2_points, p2_points_subis,
              referee_name, referee_licence,
              entered_at, started_at, finished_at
         FROM ddj_barrage_matches
        WHERE tournoi_id = $1
        ORDER BY match_number`,
      [tournoiId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });

  // 6. Split into exempts vs. barragistes.
  // V 2.0.834 — If barrage matches already exist, DERIVE the split from
  // them (anyone who appears in a saved match IS a barragiste, anyone who
  // qualified from poules but is NOT in a saved match is an exempt). This
  // is robust to any rerank algorithm change that happens between barrage
  // setup and bracket build (e.g. V 2.0.832 making the tie-break
  // deterministic shifted which players landed in each bucket — without
  // this fix the displayed exempts list disagreed with the saved matches).
  // If no barrage matches yet, fall back to the current rerank's split.
  let exempts, barragistes;
  const _normLic = (s) => String(s || '').replace(/\s+/g, '');
  if (savedMatches.length > 0) {
    const barragePlayedSet = new Set();
    for (const m of savedMatches) {
      if (m.p1_licence) barragePlayedSet.add(_normLic(m.p1_licence));
      if (m.p2_licence) barragePlayedSet.add(_normLic(m.p2_licence));
    }
    const exemptCandidates = qualifiedFromPoules.filter(p => !barragePlayedSet.has(_normLic(p.licence)));
    const barragistesCandidates = qualifiedFromPoules.filter(p => barragePlayedSet.has(_normLic(p.licence)));
    // Keep the same rerank for display ordering within each bucket.
    exempts = computeReclassementSerpentin(exemptCandidates);
    barragistes = computeReclassementSerpentin(barragistesCandidates);
  } else {
    const reranked = computeReclassementSerpentin(qualifiedFromPoules);
    exempts = reranked.slice(0, lbifCfg.nb_exempts_barrage);
    barragistes = reranked.slice(lbifCfg.nb_exempts_barrage,
      lbifCfg.nb_exempts_barrage + lbifCfg.nb_barragistes);
  }

  // 9. Resolve distance for barrage phase
  let distance = null;
  try {
    const resolved = await resolveDistance(tournament, lbifCfg.nb_poules, { db, phase: 'barrage' });
    distance = resolved.distance;
  } catch (e) { /* non-fatal */ }

  return {
    applicable: true,
    can_start: allPoulesDone,
    started: savedMatches.length > 0,
    all_done: savedMatches.length > 0 && savedMatches.every(m => m.p1_points != null && m.p2_points != null),
    tournament: { id: tournament.tournoi_id, nom: tournament.nom, mode: tournament.mode,
                  categorie: tournament.categorie, debut: tournament.debut, lieu: tournament.lieu },
    lbif: lbifCfg,
    game_params: { distance, reprises: null },
    barragistes,
    exempts,
    direct_qualifs,
    matches: savedMatches,
    expected_matches_count: Math.floor(lbifCfg.nb_barragistes / 2)
  };
}

// GET /competitions/:id/barrage
router.get('/competitions/:id/barrage', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });
  try {
    const ctx = await loadBarrage(db, orgId, tournoiId);
    if (ctx.error === 'not_found') return res.status(404).json({ error: 'Tournoi introuvable' });
    res.json(ctx);
  } catch (err) {
    console.error('[DdJ] /barrage GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /competitions/:id/barrage/setup
// Computes the appariements (1v8, 2v7, 3v6, 4v5 cross-pairing) and inserts
// the matches into ddj_barrage_matches. Idempotent : re-run after any
// poule result update clears + recreates the matches (unless any match
// already has scores, in which case it refuses to avoid data loss).
router.post('/competitions/:id/barrage/setup', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });
  try {
    const ctx = await loadBarrage(db, orgId, tournoiId);
    if (ctx.error) return res.status(404).json({ error: ctx.error });
    if (!ctx.applicable) {
      return res.status(409).json({ error: ctx.message || `Phase de barrage non applicable: ${ctx.reason}` });
    }
    if (!ctx.can_start) {
      return res.status(409).json({ error: 'Toutes les poules doivent être terminées avant de lancer le barrage' });
    }
    // Refuse if any match already has scores (would overwrite results)
    const anyScored = ctx.matches.some(m => m.p1_points != null || m.p2_points != null);
    if (anyScored) {
      return res.status(409).json({
        error: 'Des scores ont déjà été saisis. Reset (DELETE) avant de re-setup.'
      });
    }

    // Cross-pairing : top vs bottom (1v8, 2v7, 3v6, 4v5)
    const barragistes = ctx.barragistes;
    if (barragistes.length === 0) {
      return res.status(409).json({ error: 'Aucun barragiste — vérifier la composition' });
    }
    if (barragistes.length % 2 !== 0) {
      return res.status(400).json({
        error: `Nb barragistes impair (${barragistes.length}) — incohérence LBIF. Vérifier la matrice.`
      });
    }

    // Wipe existing matches (no scores → safe)
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM ddj_barrage_matches WHERE tournoi_id = $1`, [tournoiId],
        (err) => err ? reject(err) : resolve());
    });

    const nMatches = barragistes.length / 2;
    for (let i = 0; i < nMatches; i++) {
      const p1 = barragistes[i];
      const p2 = barragistes[barragistes.length - 1 - i];
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ddj_barrage_matches
             (tournoi_id, match_number, p1_licence, p2_licence)
           VALUES ($1, $2, $3, $4)`,
          [tournoiId, i + 1, p1.licence, p2.licence],
          (err) => err ? reject(err) : resolve()
        );
      });
    }

    res.json({ success: true, matches_count: nMatches });
  } catch (err) {
    console.error('[DdJ] /barrage/setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /competitions/:id/barrage — save a single match result
// Body: { match_number, p1_points, p2_points, p1_points_subis?, p2_points_subis?,
//         table_number?, referee_name?, referee_licence? }
router.put('/competitions/:id/barrage', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });
  const b = req.body || {};
  const matchNumber = parseInt(b.match_number, 10);
  if (!Number.isFinite(matchNumber) || matchNumber < 1) {
    return res.status(400).json({ error: 'match_number requis' });
  }
  const fields = ['p1_points', 'p2_points', 'p1_points_subis', 'p2_points_subis'];
  const parsed = {};
  for (const f of fields) {
    const v = b[f];
    if (v === null || v === undefined || v === '') { parsed[f] = null; continue; }
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${f} doit être un entier ≥ 0 ou null` });
    parsed[f] = n;
  }
  // Symmetric derivation for Quilles: if p1_points_subis not provided, use p2_points
  if (parsed.p1_points_subis == null && parsed.p2_points != null) parsed.p1_points_subis = parsed.p2_points;
  if (parsed.p2_points_subis == null && parsed.p1_points != null) parsed.p2_points_subis = parsed.p1_points;

  // V 2.0.828 — Server-side max validation against the current Distance.
  // Distance is editable up until the DdJ starts, so we re-resolve it on
  // every save (phase=barrage) instead of trusting any cached value.
  try {
    const { isQuillesMode, getBracketConfig, resolveDistance } = require('../utils/quilles-helpers');
    const t = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, mode, tournament_format, tournament_type, tour_number,
                distance_matrix_id, fixed_distance, nb_tables, organization_id
           FROM tournoi_ext WHERE tournoi_id = $1
            AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId], (e, r) => e ? reject(e) : resolve(r)
      );
    });
    if (t && isQuillesMode(t.mode)) {
      const totalPlayers = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*)::int AS n FROM convocation_poules WHERE tournoi_id = $1`,
          [tournoiId], (e, r) => e ? reject(e) : resolve(r?.n || 0));
      });
      const cfg = await getBracketConfig(totalPlayers, { db });
      const resolved = await resolveDistance(t, cfg.nb_poules, { db, phase: 'barrage' });
      const maxDist = resolved && resolved.distance;
      if (maxDist) {
        for (const k of ['p1_points', 'p2_points']) {
          if (parsed[k] != null && parsed[k] > maxDist) {
            return res.status(400).json({
              error: `${k} = ${parsed[k]} dépasse la distance autorisée (${maxDist} pts)`
            });
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal: if distance cannot be resolved, fall through. Client-side
    // check + the column type still bound the value.
    console.warn('[barrage PUT] distance validation skipped:', e.message);
  }

  try {
    // Verify tournament + ensure match exists
    const match = await new Promise((resolve, reject) => {
      db.get(
        `SELECT bm.id, bm.p1_licence, bm.p2_licence
           FROM ddj_barrage_matches bm
           JOIN tournoi_ext te ON bm.tournoi_id = te.tournoi_id
          WHERE bm.tournoi_id = $1 AND bm.match_number = $2
            AND ($3::int IS NULL OR te.organization_id = $3)`,
        [tournoiId, matchNumber, orgId],
        (err, r) => err ? reject(err) : resolve(r)
      );
    });
    if (!match) return res.status(404).json({ error: 'Match de barrage introuvable — lancer /barrage/setup d\'abord' });

    const tableNumber = b.table_number != null && b.table_number !== ''
      ? parseInt(b.table_number, 10) || null : null;
    const refereeName = (b.referee_name || '').trim() || null;
    const refereeLicence = (b.referee_licence || '').trim() || null;

    await new Promise((resolve, reject) => {
      db.run(
        // V 2.0.828 — Explicit ::int / ::text casts on every parameter to
        // avoid Postgres "could not determine data type of parameter $N"
        // when nullable values are passed (CLAUDE.md cast rule). $2 was
        // also referenced inside CASE WHEN $2 IS NOT NULL — without a
        // cast Postgres failed to infer the type and returned a 500.
        `UPDATE ddj_barrage_matches SET
           table_number = COALESCE($1::int, table_number),
           p1_points = $2::int,
           p1_points_subis = $3::int,
           p2_points = $4::int,
           p2_points_subis = $5::int,
           referee_name = COALESCE($6::text, referee_name),
           referee_licence = COALESCE($7::text, referee_licence),
           entered_at = CURRENT_TIMESTAMP,
           entered_by = $8::int,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
           finished_at = CASE WHEN $2::int IS NOT NULL AND $4::int IS NOT NULL
                              THEN CURRENT_TIMESTAMP ELSE finished_at END
         WHERE tournoi_id = $9::int AND match_number = $10::int`,
        [tableNumber, parsed.p1_points, parsed.p1_points_subis,
         parsed.p2_points, parsed.p2_points_subis,
         refereeName, refereeLicence, req.user.userId || null,
         tournoiId, matchNumber],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[DdJ] /barrage PUT error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /competitions/:id/barrage/reset — wipe all barrage matches
router.post('/competitions/:id/barrage/reset', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });
  try {
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id FROM tournoi_ext WHERE tournoi_id = $1
           AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, r) => err ? reject(err) : resolve(r)
      );
    });
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM ddj_barrage_matches WHERE tournoi_id = $1`, [tournoiId],
        (err) => err ? reject(err) : resolve());
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[DdJ] /barrage/reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Manual seed reordering for the bracket (post-poules ranking)
// ----------------------------------------------------------------

// POST /competitions/:id/bracket-seeds — body: { licences: ["123A", "456B", ...] }
// Replaces the override (or creates it). Bracket recomputes the SF pairings
// from the new order on next /bracket fetch.
router.post('/competitions/:id/bracket-seeds', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const tournoiId = parseInt(req.params.id, 10);
  const licences = Array.isArray(req.body?.licences) ? req.body.licences : null;
  if (!Number.isFinite(tournoiId) || !licences || licences.length === 0) {
    return res.status(400).json({ error: 'tournoi_id et licences[] requis' });
  }
  try {
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM ddj_bracket_seed_overrides WHERE tournoi_id = $1`,
        [tournoiId], (err) => err ? reject(err) : resolve());
    });
    for (let i = 0; i < licences.length; i++) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ddj_bracket_seed_overrides (tournoi_id, seed_position, licence)
           VALUES ($1, $2, $3)`,
          [tournoiId, i + 1, licences[i]],
          (err) => err ? reject(err) : resolve()
        );
      });
    }
    res.json({ ok: true, count: licences.length });
  } catch (err) {
    console.error('[DdJ] POST bracket-seeds error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /competitions/:id/bracket-seeds — clear override, revert to auto
router.delete('/competitions/:id/bracket-seeds', authenticateToken, requireDdJ, (req, res) => {
  const db = getDb();
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'tournoi_id invalide' });
  }
  db.run(`DELETE FROM ddj_bracket_seed_overrides WHERE tournoi_id = $1`,
    [tournoiId], (err) => {
      if (err) {
        console.error('[DdJ] DELETE bracket-seeds error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ ok: true });
    });
});

// POST /competitions/:id/reset-bracket — V 2.0.540
// Escape hatch for re-simulation: wipes saved bracket matches, consolante
// matches AND the seed override for a tournament, while keeping the poule
// matches intact. Lets the DdJ rerun Étape 4/5 from scratch under the new
// rules without losing the pointage and poule scores.
router.post('/competitions/:id/reset-bracket', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'tournoi_id invalide' });
  }
  // Multi-tenant guard: confirm tournament belongs to this org
  try {
    const t = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });

    const runDelete = (sql) => new Promise((resolve, reject) => {
      db.run(sql, [tournoiId], function (err) {
        if (err) return reject(err);
        resolve(this && this.changes != null ? this.changes : 0);
      });
    });
    const bracketDeleted = await runDelete(`DELETE FROM ddj_bracket_matches WHERE tournoi_id = $1`);
    const consolanteDeleted = await runDelete(`DELETE FROM ddj_consolante_matches WHERE tournoi_id = $1`);
    const overrideDeleted = await runDelete(`DELETE FROM ddj_bracket_seed_overrides WHERE tournoi_id = $1`);

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO activity_logs
             (organization_id, action, action_type, entity_type, entity_id, user_id, details, source)
           VALUES ($1, 'ddj_bracket_reset', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [orgId, tournoiId, req.user.userId || null,
            JSON.stringify({ bracketDeleted, consolanteDeleted, overrideDeleted })],
          (err) => err ? reject(err) : resolve()
        );
      });
    } catch (_) { /* non-blocking */ }

    res.json({ ok: true, bracketDeleted, consolanteDeleted, overrideDeleted });
  } catch (err) {
    console.error('[DdJ] /reset-bracket error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /competitions/:id/reset-all — V 2.0.548
// Total wipe of every DdJ trace for a tournament. Wipes:
//   - ddj_poule_matches, ddj_bracket_matches, ddj_consolante_matches
//   - ddj_bracket_seed_overrides
//   - convocation_poules (poule compositions — will be re-created when
//     the admin re-runs the poule generation + sends convocations)
//   - tournament_results + tournaments row created at finalize time
//     (looked up via category_id + tournament_number + season — same
//     compound key the finalize endpoint uses).
//   - resets inscriptions.statut='inscrit' / forfait=0 so the next
//     pointage starts from a clean slate.
// The tournoi_ext row + the inscriptions themselves are preserved, so
// the admin only has to redo: poules generation → convocations → DdJ.
router.post('/competitions/:id/reset-all', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'tournoi_id invalide' });
  }
  try {
    // Fetch tournoi_ext to resolve category + tournament_number + season for
    // the matching `tournaments` row created at finalize.
    const t = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, mode, categorie, debut, tournament_number, organization_id
         FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });

    const runDelete = (sql, params = [tournoiId]) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve(this && this.changes != null ? this.changes : 0);
      });
    });

    const pouleDeleted      = await runDelete(`DELETE FROM ddj_poule_matches      WHERE tournoi_id = $1`);
    const bracketDeleted    = await runDelete(`DELETE FROM ddj_bracket_matches    WHERE tournoi_id = $1`);
    const consolanteDeleted = await runDelete(`DELETE FROM ddj_consolante_matches WHERE tournoi_id = $1`);
    const overrideDeleted   = await runDelete(`DELETE FROM ddj_bracket_seed_overrides WHERE tournoi_id = $1`);
    const convocDeleted     = await runDelete(`DELETE FROM convocation_poules     WHERE tournoi_id = $1`);

    // Resolve the finalized tournaments row (same lookup as /finalize) and
    // wipe it + its results. Best-effort: if the lookup fails (e.g. no
    // category_id match because category was renamed), we skip silently.
    let tournamentResultsDeleted = 0;
    let tournamentRowDeleted = 0;
    let rankingsRefreshed = false;
    let resolvedCategoryId = null;
    let resolvedSeason = null;
    try {
      // V 2.0.551 — Categories table has `level`, not `name`. The previous
      // SELECT silently matched nothing → reset never wiped tournaments
      // or tournament_results, so old finalized data kept polluting the
      // rankings table after each "reset".
      const categoryRow = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM categories
           WHERE UPPER(REPLACE(game_type, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
             AND UPPER(level) = UPPER($2)
             AND ($3::int IS NULL OR organization_id = $3)
           LIMIT 1`,
          [t.mode || '', t.categorie || '', orgId],
          (err, row) => err ? reject(err) : resolve(row)
        );
      });
      if (categoryRow && t.tournament_number) {
        resolvedCategoryId = categoryRow.id;
        resolvedSeason = appSettings.getCurrentSeason
          ? await appSettings.getCurrentSeason(t.debut ? new Date(t.debut) : new Date(), orgId)
          : (() => {
              const d = t.debut ? new Date(t.debut) : new Date();
              const y = d.getFullYear();
              return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
            })();
        const tRow = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id FROM tournaments
             WHERE category_id = $1 AND tournament_number = $2 AND season = $3
               AND ($4::int IS NULL OR organization_id = $4)`,
            [resolvedCategoryId, t.tournament_number, resolvedSeason, orgId],
            (err, row) => err ? reject(err) : resolve(row)
          );
        });
        if (tRow) {
          tournamentResultsDeleted = await runDelete(
            `DELETE FROM tournament_results WHERE tournament_id = $1`,
            [tRow.id]
          );
          tournamentRowDeleted = await runDelete(
            `DELETE FROM tournaments WHERE id = $1`,
            [tRow.id]
          );
        }
      }
    } catch (e) {
      console.warn('[DdJ] /reset-all tournaments wipe skipped:', e.message);
    }

    // V 2.0.549 — Refresh the rankings table so the DdJ serpentin (which
    // reads `rankings`) doesn't keep using stale season-rank rows from
    // earlier finalize cycles. recalculateRankings rebuilds from whatever
    // tournament_results still exist for the (category, season) pair, so:
    //   - if the user reset only T1 but T2 still has results → rankings
    //     gets rebuilt with T2 alone (correct)
    //   - if both T1 and T2 are reset → rankings becomes empty for the
    //     category/season → DdJ falls through to FFB moyenne, which is
    //     what the convocation page also uses for journées TQ1.
    if (resolvedCategoryId && resolvedSeason) {
      try {
        const tournamentsRouter = require('./tournaments');
        const recalcRankings = tournamentsRouter.recalculateRankings;
        if (typeof recalcRankings === 'function') {
          await new Promise((resolve) => {
            recalcRankings(resolvedCategoryId, resolvedSeason, () => resolve());
          });
          rankingsRefreshed = true;
        }
      } catch (e) {
        console.warn('[DdJ] /reset-all rankings refresh skipped:', e.message);
      }
    }

    // Reset inscriptions to "inscrit" so a fresh pointage can run cleanly.
    const inscriptionsReset = await runDelete(
      `UPDATE inscriptions SET statut = 'inscrit', forfait = 0
       WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [tournoiId, orgId]
    );

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO activity_logs
             (organization_id, action, action_type, entity_type, entity_id, user_id, details, source)
           VALUES ($1, 'ddj_full_reset', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [orgId, tournoiId, req.user.userId || null,
            JSON.stringify({
              pouleDeleted, bracketDeleted, consolanteDeleted, overrideDeleted,
              convocDeleted, tournamentResultsDeleted, tournamentRowDeleted,
              inscriptionsReset, rankingsRefreshed
            })],
          (err) => err ? reject(err) : resolve()
        );
      });
    } catch (_) { /* non-blocking */ }

    res.json({
      ok: true,
      pouleDeleted, bracketDeleted, consolanteDeleted, overrideDeleted,
      convocDeleted, tournamentResultsDeleted, tournamentRowDeleted,
      inscriptionsReset, rankingsRefreshed
    });
  } catch (err) {
    console.error('[DdJ] /reset-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /competitions/:id/clear-season-results — V 2.0.552
// Targeted cleanup for the case where the rankings table has stale data
// from earlier test cycles (old finalize calls) but the DdJ scores for
// the current cycle are still being entered and MUST be preserved.
//
// Resolves the (category_id, season) for this tournament and wipes ALL
// finalized data within that scope:
//   - tournament_results for every tournament in this category/season
//   - the tournaments rows themselves
// Then calls recalculateRankings to flush the rankings table to empty.
//
// Crucially does NOT touch any DdJ data: poule/bracket/consolante matches,
// seed overrides, convocation poules, inscriptions all stay intact. The
// admin can re-run finalize on whichever tournaments they want, and the
// rankings table will be rebuilt from those finalize calls only.
router.post('/competitions/:id/clear-season-results', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'tournoi_id invalide' });
  }
  try {
    const t = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, mode, categorie, debut, organization_id
         FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });

    const categoryRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM categories
         WHERE UPPER(REPLACE(game_type, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
           AND UPPER(level) = UPPER($2)
           AND ($3::int IS NULL OR organization_id = $3)
         LIMIT 1`,
        [t.mode || '', t.categorie || '', orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!categoryRow) {
      return res.status(400).json({
        error: `Catégorie introuvable : ${t.mode} / ${t.categorie}`
      });
    }
    const season = appSettings.getCurrentSeason
      ? await appSettings.getCurrentSeason(t.debut ? new Date(t.debut) : new Date(), orgId)
      : (() => {
          const d = t.debut ? new Date(t.debut) : new Date();
          const y = d.getFullYear();
          return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
        })();

    const runDelete = (sql, params) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve(this && this.changes != null ? this.changes : 0);
      });
    });

    // Find all tournaments in this category/season (T1, T2, T3, finale...)
    const tournamentRows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, tournament_number FROM tournaments
         WHERE category_id = $1 AND season = $2
           AND ($3::int IS NULL OR organization_id = $3)`,
        [categoryRow.id, season, orgId],
        (err, rs) => err ? reject(err) : resolve(rs || [])
      );
    });

    let resultsDeleted = 0;
    let tournamentsDeleted = 0;
    for (const tr of tournamentRows) {
      resultsDeleted += await runDelete(
        `DELETE FROM tournament_results WHERE tournament_id = $1`,
        [tr.id]
      );
      tournamentsDeleted += await runDelete(
        `DELETE FROM tournaments WHERE id = $1`,
        [tr.id]
      );
    }

    // V 2.0.553 — Explicit rankings wipe. recalculateRankings normally deletes
    // its own rankings rows before re-inserting, BUT it resolves the orgId by
    // reading `tournaments.organization_id` — which we just emptied. With
    // orgId=null the cleanup filter became overly permissive on one path and
    // overly restrictive on another, leaving aggregate rows (Pts, Total Top 2,
    // Moy.G saison) orphaned in the rankings table.
    // We do the wipe here directly with the org we already have, which is
    // both safer and complete.
    const rankingsDeleted = await runDelete(
      `DELETE FROM rankings WHERE category_id = $1 AND season = $2
        AND ($3::int IS NULL OR organization_id = $3)`,
      [categoryRow.id, season, orgId]
    );

    let rankingsRefreshed = false;
    try {
      const tournamentsRouter = require('./tournaments');
      const recalcRankings = tournamentsRouter.recalculateRankings;
      if (typeof recalcRankings === 'function') {
        await new Promise((resolve) => {
          recalcRankings(categoryRow.id, season, () => resolve());
        });
        rankingsRefreshed = true;
      }
    } catch (e) {
      console.warn('[DdJ] /clear-season-results rankings refresh skipped:', e.message);
    }

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO activity_logs
             (organization_id, action, action_type, entity_type, entity_id, user_id, details, source)
           VALUES ($1, 'ddj_clear_season_results', 'success', 'category', $2, $3, $4, 'directeur_jeu')`,
          [orgId, categoryRow.id, req.user.userId || null,
            JSON.stringify({
              category_id: categoryRow.id,
              season,
              tournamentsDeleted,
              resultsDeleted,
              rankingsDeleted,
              rankingsRefreshed
            })],
          (err) => err ? reject(err) : resolve()
        );
      });
    } catch (_) { /* non-blocking */ }

    res.json({
      ok: true,
      category_id: categoryRow.id,
      season,
      tournaments_scanned: tournamentRows.length,
      tournamentsDeleted,
      resultsDeleted,
      rankingsDeleted,
      rankingsRefreshed
    });
  } catch (err) {
    console.error('[DdJ] /clear-season-results error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/directeur-jeu/competitions/:id/bracket
router.get('/competitions/:id/bracket', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    const result = await loadBracket(db, orgId, tournoiId);
    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }
    res.json(result);
  } catch (err) {
    console.error('[DdJ] /bracket GET error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du bracket' });
  }
});

// PUT /api/directeur-jeu/competitions/:id/bracket
// Body: { phase, p1_points, p1_reprises, p1_serie, p2_points, p2_reprises, p2_serie, table_number? }
// UPSERTs the bracket match. Validates that:
//   - phase is one of SF1/SF2/F/PF
//   - both upstream SFs (for F and PF) are already played
//   - scores respect game_params max (same as Step 3)
router.put('/competitions/:id/bracket', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  const b = req.body || {};
  const phase = String(b.phase || '').toUpperCase();
  // V 2.0.830 — Sprint 2 LBIF Phase 5: phase whitelist extended to cover
  // Quilles brackets (QF1-4, EIGHTH1-8). Carambole phases still accepted.
  if (!/^(EIGHTH[1-8]|QF[1-4]|SF[12]|F|PF)$/.test(phase)) {
    return res.status(400).json({ error: 'Phase invalide' });
  }

  // V 2.0.797 — Sprint 2 D.4: p1_points_subis / p2_points_subis added for
  // Quilles matches in the bracket (same shape as the poule PUT in D.3).
  const scoreFields = [
    'p1_points', 'p1_reprises', 'p1_serie', 'p1_points_subis',
    'p2_points', 'p2_reprises', 'p2_serie', 'p2_points_subis'
  ];
  const parsed = {};
  for (const f of scoreFields) {
    const v = b[f];
    if (v === null || v === undefined || v === '') {
      parsed[f] = null;
    } else {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `${f} doit être un entier positif ou null` });
      }
      parsed[f] = n;
    }
  }

  try {
    // Reload bracket state so we know which players the phase is for
    const ctx = await loadBracket(db, orgId, tournoiId);
    if (ctx.error === 'not_found') {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }
    if (!ctx.can_start) {
      return res.status(400).json({ error: 'Toutes les poules doivent être terminées avant la phase finale' });
    }
    const match = ctx.phases.find(p => p.phase === phase);
    if (!match) {
      return res.status(400).json({ error: 'Phase inconnue' });
    }
    if (!match.can_enter) {
      return res.status(400).json({
        error: phase === 'F' || phase === 'PF'
          ? 'Les demi-finales doivent être terminées avant cette phase'
          : 'Match pas encore prêt'
      });
    }

    // Max validation
    const gp = ctx.game_params || {};
    if (gp.distance != null) {
      if (parsed.p1_points != null && parsed.p1_points > gp.distance)
        return res.status(400).json({ error: `Points J1 supérieurs à la distance (${gp.distance})` });
      if (parsed.p2_points != null && parsed.p2_points > gp.distance)
        return res.status(400).json({ error: `Points J2 supérieurs à la distance (${gp.distance})` });
    }
    if (gp.reprises != null) {
      if (parsed.p1_reprises != null && parsed.p1_reprises > gp.reprises)
        return res.status(400).json({ error: `Reprises J1 supérieures au maximum (${gp.reprises})` });
      if (parsed.p2_reprises != null && parsed.p2_reprises > gp.reprises)
        return res.status(400).json({ error: `Reprises J2 supérieures au maximum (${gp.reprises})` });
    }

    const tableNumber = b.table_number != null && b.table_number !== ''
      ? parseInt(b.table_number, 10) || null
      : null;

    // V 2.0.842 — Meilleure série required to finalize (carambole only).
    // Same guard as the poule save. ctx.tournament holds the mode.
    {
      const willFinish = isMatchTrulyFinished(parsed, gp);
      if (willFinish) {
        let isQuilles = false;
        try {
          const { isQuillesMode } = require('../utils/quilles-helpers');
          isQuilles = isQuillesMode(ctx.tournament ? ctx.tournament.mode : '');
        } catch (_) { /* treat as carambole */ }
        if (!isQuilles && (parsed.p1_serie == null || parsed.p2_serie == null)) {
          return res.status(400).json({
            error: 'Meilleure série obligatoire pour clôturer le match. Renseignez-la pour les deux joueurs (ou enregistrez un score intermédiaire pour l\'instant).'
          });
        }
      }
    }

    // V3: optional referee fields + started_at/finished_at lifecycle.
    const refereeName = (b.referee_name || '').trim() || null;
    const refereeLicence = (b.referee_licence || '').trim() || null;

    // UPSERT
    // V 2.0.797 — p1_points_subis / p2_points_subis added for Quilles bracket
    // matches. Null for carambole bracket matches.
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_bracket_matches
           (tournoi_id, phase, table_number,
            p1_licence, p2_licence,
            p1_points, p1_reprises, p1_serie, p1_points_subis,
            p2_points, p2_reprises, p2_serie, p2_points_subis,
            entered_at, entered_by,
            referee_name, referee_licence,
            started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 CURRENT_TIMESTAMP, $14, $15, $16,
                 CURRENT_TIMESTAMP,
                 CASE WHEN $17::bool THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT (tournoi_id, phase)
         DO UPDATE SET
           table_number = COALESCE(EXCLUDED.table_number, ddj_bracket_matches.table_number),
           p1_licence = EXCLUDED.p1_licence,
           p2_licence = EXCLUDED.p2_licence,
           p1_points = EXCLUDED.p1_points,
           p1_reprises = EXCLUDED.p1_reprises,
           p1_serie = EXCLUDED.p1_serie,
           p1_points_subis = EXCLUDED.p1_points_subis,
           p2_points = EXCLUDED.p2_points,
           p2_reprises = EXCLUDED.p2_reprises,
           p2_serie = EXCLUDED.p2_serie,
           p2_points_subis = EXCLUDED.p2_points_subis,
           entered_at = CURRENT_TIMESTAMP,
           entered_by = EXCLUDED.entered_by,
           referee_name = EXCLUDED.referee_name,
           referee_licence = EXCLUDED.referee_licence,
           started_at = COALESCE(ddj_bracket_matches.started_at, CURRENT_TIMESTAMP),
           -- V 2.0.829 — Conditional finished_at (see helper top of file).
           finished_at = CASE WHEN $17::bool THEN CURRENT_TIMESTAMP ELSE NULL END`,
        [
          tournoiId, phase, tableNumber,
          match.p1.licence, match.p2.licence,
          parsed.p1_points, parsed.p1_reprises, parsed.p1_serie, parsed.p1_points_subis,
          parsed.p2_points, parsed.p2_reprises, parsed.p2_serie, parsed.p2_points_subis,
          req.user.userId || null,
          refereeName, refereeLicence,
          isMatchTrulyFinished(parsed, gp)
        ],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Activity log
    try {
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO activity_logs
             (user_name, action_type, action_status, target_type, target_id, target_name, details, app_source)
           VALUES ($1, 'ddj_bracket_saved', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [
            req.user.username || 'DdJ',
            tournoiId,
            `Tournoi ${tournoiId} / ${phase}`,
            JSON.stringify({ phase, ...parsed })
          ],
          () => resolve()
        );
      });
    } catch (e) { /* non-fatal */ }

    // Reload and return full bracket state so UI reflects cascade
    // (e.g. saving SF1 populates F's p1 slot)
    const reload = await loadBracket(db, orgId, tournoiId);
    res.json({ success: true, bracket: reload });
  } catch (err) {
    console.error('[DdJ] /bracket PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du match' });
  }
});

// ============================================================================
// Step 5 — Matchs de classement (Consolante)
// ============================================================================
//
// Non-qualifiers (those who didn't make the Tableau final) play a second
// single-elimination bracket to determine overall places 5 → N. This mirrors
// the "Consolante" sheet in the CDB 93-94 Excel FDM.
//
// Bracket size is dynamic based on non-qualifier count:
//   N=2       → bracket of 2 (F only)
//   N=3-4     → bracket of 4 (SF1, SF2, F)
//   N=5-8     → bracket of 8 (QF1-4, SF1-2, F)
//   N=9-16    → bracket of 16 (R16_1-8, QF1-4, SF1-2, F)
// Top seeds get BYEs when N < bracket size (auto-advance, no score needed).
//
// NO petite finale in the consolante: SF/QF/R16 losers are ex-aequo and
// departed by poule criteria (match_points, moyenne).
//
// Final overall places (added to the 1-4 from the Tableau final):
//   F winner  → place 5
//   F loser   → place 6
//   SF losers → places 7-8   (ex-aequo, tiebreak on poule perf)
//   QF losers → places 9-12  (ex-aequo)
//   R16 losers → places 13-20 (ex-aequo)
//
// Like loadBracket, the consolante STRUCTURE is derived at read-time — only
// match SCORES live in ddj_consolante_matches. Edits to upstream phases
// cascade via staleness flags.
// ============================================================================

// Standard knockout pairings (1-indexed seed positions). Top seeds at
// extremes — the "classic" 1 vs 2 matchup only occurs in the Finale.
const CONSOLANTE_PAIRINGS = {
  2:  [[1, 2]],
  4:  [[1, 4], [2, 3]],
  8:  [[1, 8], [4, 5], [3, 6], [2, 7]],
  16: [[1, 16], [8, 9], [4, 13], [5, 12], [3, 14], [6, 11], [2, 15], [7, 10]]
};

// Phase names per bracket size.
// round1 = first round (length = size / 2)
// later  = all subsequent rounds (length = size / 2 - 1), in cascade order,
//          i.e. winners of later[i*2] and later[i*2+1] feed into the next
//          slot. Final phase is always 'F' (last element).
const CONSOLANTE_PHASES = {
  2:  { round1: ['F'], later: [] },
  4:  { round1: ['SF1', 'SF2'], later: ['F'] },
  8:  { round1: ['QF1', 'QF2', 'QF3', 'QF4'], later: ['SF1', 'SF2', 'F'] },
  16: {
    round1: ['R16_1', 'R16_2', 'R16_3', 'R16_4', 'R16_5', 'R16_6', 'R16_7', 'R16_8'],
    later: ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'F']
  }
};

// V 2.0.543 — FFB-style label per consolante phase, e.g. "Places 05-06",
// "Place 07", "Places 09-12". Size = bracket size, n = non-qualifier count.
// Falls back to internal phase name for unrecognised combinations.
function consolanteFFBLabel(phase, size, n) {
  const fmt = (a, b) => a === b
    ? `Place ${String(a).padStart(2, '0')}`
    : `Places ${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  if (phase === 'F') return fmt(5, 6);
  if (size === 4) {
    if (phase === 'SF1' || phase === 'SF2') {
      const losers = Math.max(0, n - 2);
      return losers >= 2 ? fmt(7, 8) : fmt(7, 7);
    }
  }
  if (size === 8) {
    if (phase === 'SF1' || phase === 'SF2') return fmt(7, 8);
    if (/^QF[1-4]$/.test(phase)) {
      const losers = Math.max(0, n - 4);
      const last = 9 + losers - 1;
      return losers >= 2 ? fmt(9, last) : fmt(9, 9);
    }
  }
  if (size === 16) {
    if (phase === 'SF1' || phase === 'SF2') return fmt(7, 8);
    if (/^QF[1-4]$/.test(phase)) return fmt(9, 12);
    if (/^R16_/.test(phase)) {
      const losers = Math.max(0, n - 8);
      const last = 13 + losers - 1;
      return losers >= 2 ? fmt(13, last) : fmt(13, 13);
    }
  }
  return phase;
}

function pickConsolanteSize(n) {
  if (n < 2) return 0;
  if (n <= 2) return 2;
  if (n <= 4) return 4;
  if (n <= 8) return 8;
  return 16; // cap: if N > 16, extra non-qualifiers are dropped (shouldn't happen)
}

/**
 * Seeds the consolante first round from the ordered non_qualifiers list.
 * Returns { size, slots, round1Pairs } where slots are indexed by seed-1
 * (nulls = BYE auto-advance for top seeds when N < size).
 */
function computeConsolanteSeeding(non_qualifiers) {
  const size = pickConsolanteSize(non_qualifiers.length);
  if (size === 0) return { size: 0, slots: [], round1Pairs: [] };
  const slots = Array.from({ length: size }, (_, i) => non_qualifiers[i] || null);
  const pairings = CONSOLANTE_PAIRINGS[size];
  const phases = CONSOLANTE_PHASES[size].round1;
  const round1Pairs = pairings.map((pair, idx) => ({
    phase: phases[idx],
    p1: slots[pair[0] - 1],
    p2: slots[pair[1] - 1]
  }));
  return { size, slots, round1Pairs };
}

/**
 * Given a phase node (with resolved p1/p2 + scores), returns
 * { winner, loser, is_played, is_bye } or null if not determinable.
 * Handles BYE auto-advance (one side null).
 */
function deriveConsolanteOutcome(m) {
  if (!m) return null;
  if (!m.p1 && !m.p2) return null;
  if (!m.p1) return { winner: m.p2, loser: null, is_played: true, is_bye: true };
  if (!m.p2) return { winner: m.p1, loser: null, is_played: true, is_bye: true };
  if (m.p1_points == null || m.p2_points == null) return null;
  if (m.p1_points === m.p2_points) return null; // draws invalid
  return m.p1_points > m.p2_points
    ? { winner: m.p1, loser: m.p2, is_played: true, is_bye: false }
    : { winner: m.p2, loser: m.p1, is_played: true, is_bye: false };
}

async function loadConsolante(db, orgId, tournoiId) {
  const bracketCtx = await loadBracket(db, orgId, tournoiId);
  if (bracketCtx.error) return bracketCtx;

  // V 2.0.543 — CDB 93-94 confirmed (27/04/2026): the consolante is seeded
  // by PURE PERFORMANCE (match_points → moyenne → meilleure série), NOT by
  // poule rank. Sportingly: the best non-qualifier deserves the bye, the
  // weakest plays the most matches. Bracket selection still uses poule rank
  // (V 2.0.538), only consolante seeding differs.
  const non_qualifiers = (bracketCtx.non_qualifiers || []).slice().sort((a, b) => {
    if ((b.match_points || 0) !== (a.match_points || 0)) return (b.match_points || 0) - (a.match_points || 0);
    if ((b.moyenne || 0) !== (a.moyenne || 0)) return (b.moyenne || 0) - (a.moyenne || 0);
    if ((b.best_serie || 0) !== (a.best_serie || 0)) return (b.best_serie || 0) - (a.best_serie || 0);
    return String(a.licence || '').localeCompare(String(b.licence || ''));
  });
  const { size, round1Pairs } = computeConsolanteSeeding(non_qualifiers);
  const canStart = !!bracketCtx.can_start && size >= 2;

  // Fetch saved rows
  // V 2.0.698 — pull started_at / finished_at for the "Match commencé" UX
  // V 2.0.797 — Sprint 2 D.4: p1_points_subis / p2_points_subis added to
  // the consolante SELECT (Quilles-only fields).
  const savedRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, phase, table_number, p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie, p1_points_subis,
              p2_points, p2_reprises, p2_serie, p2_points_subis,
              referee_name, referee_licence,
              entered_at, started_at, finished_at
         FROM ddj_consolante_matches
        WHERE tournoi_id = $1`,
      [tournoiId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });
  const savedByPhase = new Map(savedRows.map(r => [r.phase, r]));

  const findNonQual = (lic) => {
    if (!lic) return null;
    const n = String(lic).replace(/\s+/g, '');
    return non_qualifiers.find(q => q.licence_normalized === n) || null;
  };

  const buildPhase = (phase, p1, p2, depends_on = null) => {
    const saved = savedByPhase.get(phase) || null;
    const m = {
      phase,
      depends_on,
      p1: p1 || null,
      p2: p2 || null,
      can_enter: !!(p1 && p2),
      has_bye: (!!p1 && !p2) || (!p1 && !!p2),
      table_number: saved ? saved.table_number : null,
      p1_points: saved ? saved.p1_points : null,
      p1_reprises: saved ? saved.p1_reprises : null,
      p1_serie: saved ? saved.p1_serie : null,
      p1_points_subis: saved ? saved.p1_points_subis : null,
      p2_points: saved ? saved.p2_points : null,
      p2_reprises: saved ? saved.p2_reprises : null,
      p2_serie: saved ? saved.p2_serie : null,
      p2_points_subis: saved ? saved.p2_points_subis : null,
      // V 2.0.707 — expose persisted referee for UI pre-fill
      referee_name: saved ? saved.referee_name : null,
      referee_licence: saved ? saved.referee_licence : null,
      // V 2.0.840 — truly-finished test (see helper top of file).
      is_played: !!(saved
        && saved.p1_points != null
        && saved.p2_points != null
        && isMatchTrulyFinished(
            { p1_points: saved.p1_points, p1_reprises: saved.p1_reprises,
              p2_points: saved.p2_points, p2_reprises: saved.p2_reprises },
            bracketCtx.game_params)),
      entered_at: saved ? saved.entered_at : null,
      started_at: saved ? saved.started_at : null,
      finished_at: saved ? saved.finished_at : null,
      stale: false
    };
    if (m.has_bye) m.is_played = true;
    if (m.is_played && !m.has_bye) {
      const mp = computeMatchPoints(m.p1_points, m.p2_points, bracketCtx.settings || {});
      m.p1_match_points = mp ? mp.p1_mp : null;
      m.p2_match_points = mp ? mp.p2_mp : null;
      m.outcome = mp ? mp.outcome : null;
    } else {
      m.p1_match_points = null;
      m.p2_match_points = null;
      m.outcome = null;
    }
    if (saved && p1 && p2) {
      const expected = [p1.licence_normalized, p2.licence_normalized].sort().join('|');
      const actual = [
        String(saved.p1_licence || '').replace(/\s+/g, ''),
        String(saved.p2_licence || '').replace(/\s+/g, '')
      ].sort().join('|');
      m.stale = expected !== actual;
    }
    return m;
  };

  if (!canStart || size === 0) {
    return {
      tournament: bracketCtx.tournament,
      game_params: bracketCtx.game_params,
      bracket_final_places: bracketCtx.final_places || null,
      can_start: canStart,
      bracket_can_start: bracketCtx.can_start,
      non_qualifiers,
      consolante_size: size,
      phases: [],
      final_places: null
    };
  }

  // Build phases round by round with cascade
  const phases = [];
  const phaseMap = new Map();

  for (const { phase, p1, p2 } of round1Pairs) {
    const ph = buildPhase(phase, p1, p2);
    // V 2.0.547 — A bye phase doesn't determine any place: the bye player
    // advances to the next round (often the consolante final). Stamping a
    // "Place 07" label on it was misleading. We label it "Tour préliminaire
    // (exempt)" instead so the FFB place semantics stay accurate.
    ph.ffb_label = ph.has_bye
      ? 'Tour préliminaire (exempt)'
      : consolanteFFBLabel(phase, size, non_qualifiers.length);
    phases.push(ph);
    phaseMap.set(phase, ph);
  }

  const laterPhases = CONSOLANTE_PHASES[size].later.slice();
  let prevRound = CONSOLANTE_PHASES[size].round1.slice();
  let laterIdx = 0;
  while (prevRound.length >= 2) {
    const nextRound = [];
    for (let i = 0; i < prevRound.length; i += 2) {
      const upA = phaseMap.get(prevRound[i]);
      const upB = phaseMap.get(prevRound[i + 1]);
      const outA = deriveConsolanteOutcome(upA);
      const outB = deriveConsolanteOutcome(upB);
      const w1 = outA && outA.winner ? findNonQual(outA.winner.licence) || outA.winner : null;
      const w2 = outB && outB.winner ? findNonQual(outB.winner.licence) || outB.winner : null;
      const phaseName = laterPhases[laterIdx++];
      const ph = buildPhase(phaseName, w1, w2, [prevRound[i], prevRound[i + 1]]);
      ph.ffb_label = ph.has_bye
        ? 'Tour préliminaire (exempt)'
        : consolanteFFBLabel(phaseName, size, non_qualifiers.length);
      phases.push(ph);
      phaseMap.set(phaseName, ph);
      nextRound.push(phaseName);
    }
    prevRound = nextRound;
  }

  // V 2.0.711 — auto-assign tables, excluding those used by the bracket
  // so bracket and matchs de classement run in parallel without
  // claiming the same billard. Pass via the new options object.
  if (canStart) {
    const bracketTables = (bracketCtx.phases || [])
      .map(ph => ph.table_number)
      .filter(Boolean);
    await autoAssignPhaseTables(
      db, tournoiId, 'ddj_consolante_matches', phases,
      { excludeTables: [...new Set(bracketTables)] }
    );
  }

  // Compute final overall places (5+) from completed phases
  let finalPlaces = null;
  const finalPhase = phaseMap.get('F');
  if (finalPhase && finalPhase.is_played && !finalPhase.has_bye) {
    const f_out = deriveConsolanteOutcome(finalPhase);
    if (f_out && f_out.winner && f_out.loser) {
      const ranked = [];
      ranked.push({ place: 5, licence: f_out.winner.licence, name: f_out.winner.player_name });
      ranked.push({ place: 6, licence: f_out.loser.licence, name: f_out.loser.player_name });

      const collectLosers = (phaseNames) => {
        const losers = [];
        for (const name of phaseNames) {
          const ph = phaseMap.get(name);
          if (!ph) continue;
          const out = deriveConsolanteOutcome(ph);
          if (out && out.loser) losers.push(out.loser);
        }
        losers.sort((a, b) =>
          (b.match_points || 0) - (a.match_points || 0) ||
          (b.moyenne || 0) - (a.moyenne || 0) ||
          (b.best_serie || 0) - (a.best_serie || 0)
        );
        return losers;
      };

      const sfLosers = collectLosers(['SF1', 'SF2']);
      sfLosers.forEach((p, i) => ranked.push({
        place: 7 + i, licence: p.licence, name: p.player_name      }));

      const qfLosers = collectLosers(['QF1', 'QF2', 'QF3', 'QF4']);
      qfLosers.forEach((p, i) => ranked.push({
        place: 9 + i, licence: p.licence, name: p.player_name      }));

      const r16Losers = collectLosers(['R16_1', 'R16_2', 'R16_3', 'R16_4', 'R16_5', 'R16_6', 'R16_7', 'R16_8']);
      r16Losers.forEach((p, i) => ranked.push({
        place: 13 + i, licence: p.licence, name: p.player_name      }));

      finalPlaces = ranked;
    }
  }

  return {
    tournament: bracketCtx.tournament,
    game_params: bracketCtx.game_params,
    bracket_final_places: bracketCtx.final_places || null,
    can_start: canStart,
    bracket_can_start: bracketCtx.can_start,
    non_qualifiers,
    consolante_size: size,
    phases,
    final_places: finalPlaces
  };
}

// GET /api/directeur-jeu/competitions/:id/consolante
router.get('/competitions/:id/consolante', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  try {
    const result = await loadConsolante(db, orgId, tournoiId);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[DdJ] /consolante GET error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement de la consolante' });
  }
});

// PUT /api/directeur-jeu/competitions/:id/consolante
// Body: { phase, table_number, p1_points, p1_reprises, p1_serie,
//         p2_points, p2_reprises, p2_serie }
router.put('/competitions/:id/consolante', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  // V 2.0.797 — Sprint 2 D.4: p1_points_subis / p2_points_subis added for
  // Quilles consolante matches.
  const {
    phase, table_number,
    p1_points, p1_reprises, p1_serie, p1_points_subis,
    p2_points, p2_reprises, p2_serie, p2_points_subis
  } = req.body || {};

  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  if (!phase) {
    return res.status(400).json({ error: 'Phase manquante' });
  }
  if (p1_points != null && p2_points != null && p1_points === p2_points) {
    return res.status(400).json({ error: 'Pas de match nul dans la consolante' });
  }

  try {
    const ctx = await loadConsolante(db, orgId, tournoiId);
    if (ctx.error) return res.status(ctx.status || 500).json({ error: ctx.error });
    if (!ctx.can_start) {
      return res.status(409).json({ error: "La consolante n'est pas encore accessible" });
    }
    const target = ctx.phases.find(p => p.phase === phase);
    if (!target) return res.status(400).json({ error: `Phase ${phase} inconnue` });
    if (target.has_bye) {
      return res.status(409).json({ error: 'Cette phase est un bye (auto-avance)' });
    }
    if (!target.can_enter) {
      return res.status(409).json({ error: 'Les joueurs de cette phase ne sont pas encore connus' });
    }

    // V 2.0.842 — Meilleure série required to finalize (carambole only).
    {
      const parsedForCheck = {
        p1_points: p1_points ?? null, p1_reprises: p1_reprises ?? null,
        p2_points: p2_points ?? null, p2_reprises: p2_reprises ?? null
      };
      const willFinish = isMatchTrulyFinished(parsedForCheck, ctx.game_params || null);
      if (willFinish) {
        let isQuilles = false;
        try {
          const { isQuillesMode } = require('../utils/quilles-helpers');
          isQuilles = isQuillesMode(ctx.tournament ? ctx.tournament.mode : '');
        } catch (_) { /* treat as carambole */ }
        if (!isQuilles && (p1_serie == null || p2_serie == null)) {
          return res.status(400).json({
            error: 'Meilleure série obligatoire pour clôturer le match. Renseignez-la pour les deux joueurs (ou enregistrez un score intermédiaire pour l\'instant).'
          });
        }
      }
    }

    // V3: optional referee fields + started_at/finished_at lifecycle.
    const refereeName = (req.body && req.body.referee_name || '').trim() || null;
    const refereeLicence = (req.body && req.body.referee_licence || '').trim() || null;

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_consolante_matches
           (tournoi_id, phase, table_number, p1_licence, p2_licence,
            p1_points, p1_reprises, p1_serie, p1_points_subis,
            p2_points, p2_reprises, p2_serie, p2_points_subis,
            entered_at, entered_by,
            referee_name, referee_licence,
            started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 CURRENT_TIMESTAMP, $14, $15, $16,
                 CURRENT_TIMESTAMP,
                 CASE WHEN $17::bool THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT (tournoi_id, phase) DO UPDATE SET
           table_number = COALESCE(EXCLUDED.table_number, ddj_consolante_matches.table_number),
           p1_licence   = EXCLUDED.p1_licence,
           p2_licence   = EXCLUDED.p2_licence,
           p1_points    = EXCLUDED.p1_points,
           p1_reprises  = EXCLUDED.p1_reprises,
           p1_serie     = EXCLUDED.p1_serie,
           p1_points_subis = EXCLUDED.p1_points_subis,
           p2_points    = EXCLUDED.p2_points,
           p2_reprises  = EXCLUDED.p2_reprises,
           p2_serie     = EXCLUDED.p2_serie,
           p2_points_subis = EXCLUDED.p2_points_subis,
           entered_at   = CURRENT_TIMESTAMP,
           entered_by   = EXCLUDED.entered_by,
           referee_name = EXCLUDED.referee_name,
           referee_licence = EXCLUDED.referee_licence,
           started_at  = COALESCE(ddj_consolante_matches.started_at, CURRENT_TIMESTAMP),
           -- V 2.0.829 — Conditional finished_at (see helper top of file).
           finished_at = CASE WHEN $17::bool THEN CURRENT_TIMESTAMP ELSE NULL END`,
        [
          tournoiId, phase, table_number || null,
          target.p1.licence, target.p2.licence,
          p1_points ?? null, p1_reprises ?? null, p1_serie ?? null, p1_points_subis ?? null,
          p2_points ?? null, p2_reprises ?? null, p2_serie ?? null, p2_points_subis ?? null,
          req.user.userId || null,
          refereeName, refereeLicence,
          isMatchTrulyFinished(
            {
              p1_points: p1_points ?? null, p1_reprises: p1_reprises ?? null,
              p2_points: p2_points ?? null, p2_reprises: p2_reprises ?? null
            },
            ctx.game_params || null
          )
        ],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Activity log
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO activity_logs
             (organization_id, action, action_type, entity_type, entity_id, user_id, details, source)
           VALUES ($1, 'ddj_consolante_saved', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [orgId, tournoiId, req.user.userId || null,
            JSON.stringify({ phase, p1_points, p2_points })],
          (err) => err ? reject(err) : resolve()
        );
      });
    } catch (_) { /* non-blocking */ }

    const reload = await loadConsolante(db, orgId, tournoiId);
    res.json({ success: true, consolante: reload });
  } catch (err) {
    console.error('[DdJ] /consolante PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du match de classement' });
  }
});

// ============================================================================
// Step 6 — Récapitulatif (consolidated read-only view)
// ============================================================================
//
// Aggregates the outputs of Steps 3, 4 and 5 into a single payload so the
// front-end can render a printable "feuille de competition" and feed the
// eventual E2i export. All data comes from existing loaders — this endpoint
// does not persist anything new.
//
// Response shape (all sections are always present; check can_start flags for
// progress gating):
//   {
//     tournament, game_params,
//     poules: [{ number, size, players, matches, classement, all_matches_played }, ...],
//     bracket: { can_start, qualifiers, non_qualifiers, phases, final_places },
//     consolante: { can_start, consolante_size, phases, final_places },
//     overall_classement: [{ place, licence, name }, ...]  // 1 -> N combined
//   }
// ============================================================================
router.get('/competitions/:id/recap', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  try {
    // loadConsolante internally fetches bracket + poule data, but we also
    // need the raw poule matches + classement that only loadPouleMatches
    // exposes directly — so we call both. They hit the same tables, minimal
    // overhead; cleaner than leaking intermediate state through loadBracket.
    const pouleCtx = await loadPouleMatches(db, orgId, tournoiId);
    if (pouleCtx.error) {
      return res.status(pouleCtx.status || 500).json({ error: pouleCtx.error });
    }
    const bracketCtx = await loadBracket(db, orgId, tournoiId);
    if (bracketCtx.error) {
      return res.status(bracketCtx.status || 500).json({ error: bracketCtx.error });
    }
    // V 2.0.838 — Quilles LBIF has no consolante (per chap 1.1.3). Skip
    // loadConsolante entirely and return an empty shell. This avoids any
    // edge case in loadConsolante's flow when fed a Quilles bracket (which
    // has zero non_qualifiers — by design, since barrage losers are
    // eliminated). Previously, loadConsolante did early-return on empty
    // non_qualifiers but something in the path still threw, causing the
    // recap 500.
    let consolanteCtx;
    const isQuilles = (() => {
      try {
        const { isQuillesMode } = require('../utils/quilles-helpers');
        return isQuillesMode(pouleCtx.tournament && pouleCtx.tournament.mode);
      } catch (_) { return false; }
    })();
    if (isQuilles) {
      consolanteCtx = {
        tournament: pouleCtx.tournament,
        game_params: pouleCtx.game_params,
        can_start: false,
        bracket_can_start: bracketCtx.can_start,
        non_qualifiers: [],
        consolante_size: 0,
        phases: [],
        final_places: null
      };
    } else {
      consolanteCtx = await loadConsolante(db, orgId, tournoiId);
      if (consolanteCtx.error) {
        return res.status(consolanteCtx.status || 500).json({ error: consolanteCtx.error });
      }
    }

    // Overall classement: bracket 1-4 + consolante 5+
    // V 2.0.865 / V 2.0.866 — "No-bracket" tournaments use the poule
    // classement as the final standings. Covers carambole N <
    // single_poule_threshold AND Quilles N < 12 (LBIF règlement,
    // single_poule_fallback). Without this, overall is empty and the
    // validation modal shows "0 joueur(s) seront enregistrés".
    const _noBracket = pouleCtx.mode === 'single_poule'
                    || bracketCtx.mode === 'single_poule'
                    || (bracketCtx.bracket_size === 0 && (!bracketCtx.phases || bracketCtx.phases.length === 0));
    const overall = _noBracket
      ? (((pouleCtx.poules || [])[0]?.classement) || []).map((row, idx) => ({
          place: idx + 1,
          licence: row.licence,
          name: row.player_name
        }))
      : [
          ...((bracketCtx.final_places) || []),
          ...((consolanteCtx.final_places) || [])
        ];

    // FFB-style ranking — cumulative match-points/moyenne/série across all
    // phases (poules + bracket + consolante), but ORDERED by phase number
    // (V 2.0.539). CDB 93-94 rule confirmed 27/04/2026: a finale loser
    // outranks a SF loser even if the SF loser has more cumulative points,
    // because the phase reached weighs more than raw performance. Concretely
    // we use overall_classement (places 1-N built from F/PF/Consolante) as
    // primary key, then poule rank, then performance as tiebreak for any
    // players that didn't reach a finalized phase yet.
    const ffbClassement = await buildFFBRanking(db, tournoiId, pouleCtx);
    const placeByLicence = new Map();
    for (const op of overall) {
      placeByLicence.set(String(op.licence || '').replace(/\s+/g, ''), op.place);
    }
    for (const row of ffbClassement) {
      const k = String(row.licence || '').replace(/\s+/g, '');
      row.final_place = placeByLicence.get(k) || null;
    }
    ffbClassement.sort((a, b) => {
      const aHas = a.final_place != null, bHas = b.final_place != null;
      if (aHas && bHas) return a.final_place - b.final_place;
      if (aHas) return -1;
      if (bHas) return 1;
      // Both still without a final place (tournament not finalized) —
      // fall back to performance.
      if (b.match_points !== a.match_points) return b.match_points - a.match_points;
      if (b.moyenne !== a.moyenne) return b.moyenne - a.moyenne;
      return (b.best_serie || 0) - (a.best_serie || 0);
    });
    ffbClassement.forEach((p, i) => { p.rank = i + 1; });

    // V 2.0.844 — Sprint 2 LBIF Phase 6B: compute the LBIF classement par
    // points for Quilles tournaments. Each player gets a "position" key
    // ('1st'|'2nd'|'semi'|'quarter'|'eighth'|'barrage'|'poule_3rd_*'),
    // looked up against the lbif_points table (V 2.0.843 schema; per-org
    // override + platform default). Carambole tournaments get null so the
    // frontend can skip rendering the section.
    let lbifClassement = null;
    if (isQuilles) {
      try {
        lbifClassement = await buildLbifClassement(db, orgId, tournoiId, {
          pouleCtx, bracketCtx
        });
      } catch (e) {
        console.error('[recap] buildLbifClassement failed:', e.message);
        // Don't break the recap if the LBIF classement throws — log + skip.
      }
    }

    res.json({
      tournament: pouleCtx.tournament,
      game_params: pouleCtx.game_params,
      poules: pouleCtx.poules || [],
      bracket: {
        can_start: bracketCtx.can_start,
        bracket_size: bracketCtx.bracket_size,
        qualifiers: bracketCtx.qualifiers || [],
        non_qualifiers: bracketCtx.non_qualifiers || [],
        phases: bracketCtx.phases || [],
        final_places: bracketCtx.final_places || null
      },
      consolante: {
        can_start: consolanteCtx.can_start,
        consolante_size: consolanteCtx.consolante_size,
        phases: consolanteCtx.phases || [],
        final_places: consolanteCtx.final_places || null
      },
      overall_classement: overall,
      ffb_classement: ffbClassement,
      lbif_classement: lbifClassement
    });
  } catch (err) {
    // V 2.0.863 — Reverted the V 2.0.837 diagnostic detail/stack payload.
    // Was added to debug the Quilles recap 500s mid-Phase-6; recap has
    // been stable since V 2.0.838 + V 2.0.856. Stack details belong in
    // Railway logs (still printed via console.error below), not in the
    // HTTP response.
    console.error('[DdJ] /recap error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du récapitulatif' });
  }
});

/**
 * Build a FFB-style cumulative ranking from all match results across the 3
 * phases (poules, bracket, consolante).
 *
 * For each player, sums:
 *   - match_points (win=2 / draw=1 / loss=0)
 *   - matches_played (only matches with scores entered)
 *   - wins, draws (for taux victoire)
 *   - total_points (somme des points scorés)
 *   - total_reprises
 *   - best_serie (max across all phases)
 *
 * Sorted by (match_points desc, moyenne desc, best_serie desc) — FFB standard.
 */
async function buildFFBRanking(db, tournoiId, pouleCtx, options = {}) {
  const settings = (pouleCtx && pouleCtx.game_params) || {};
  // V 2.0.536 — `phases` filter restricts which match tables are aggregated.
  // Default = all phases (recap view). Pass ['poule'] for the intermediate
  // post-poule table on the bracket page.
  const phases = options.phases || ['poule', 'bracket', 'consolante'];

  const fetchAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );

  const SELECT_COLS = `p1_licence, p2_licence, p1_points, p1_reprises, p1_serie,
              p2_points, p2_reprises, p2_serie`;
  const phaseTables = {
    poule: 'ddj_poule_matches',
    bracket: 'ddj_bracket_matches',
    consolante: 'ddj_consolante_matches'
  };
  const matchSets = await Promise.all(
    phases.map(ph =>
      fetchAll(`SELECT ${SELECT_COLS} FROM ${phaseTables[ph]} WHERE tournoi_id = $1`, [tournoiId])
    )
  );
  const allMatches = matchSets.flat();

  // Aggregate per player
  const stats = new Map(); // licence -> { ... }
  const ensure = (lic) => {
    const k = String(lic || '').replace(/\s+/g, '');
    if (!stats.has(k)) {
      stats.set(k, {
        licence: lic,
        matches_played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        match_points: 0,
        total_points: 0,
        total_reprises: 0,
        best_serie: 0
      });
    }
    return stats.get(k);
  };

  for (const m of allMatches) {
    const mp = computeMatchPoints(m.p1_points, m.p2_points, settings);
    if (!mp) continue; // not played → skip
    const s1 = ensure(m.p1_licence);
    const s2 = ensure(m.p2_licence);
    s1.matches_played += 1;
    s2.matches_played += 1;
    s1.match_points += mp.p1_mp;
    s2.match_points += mp.p2_mp;
    s1.total_points += (m.p1_points || 0);
    s2.total_points += (m.p2_points || 0);
    s1.total_reprises += (m.p1_reprises || 0);
    s2.total_reprises += (m.p2_reprises || 0);
    if ((m.p1_serie || 0) > s1.best_serie) s1.best_serie = m.p1_serie;
    if ((m.p2_serie || 0) > s2.best_serie) s2.best_serie = m.p2_serie;
    if (mp.outcome === 'p1_win') { s1.wins += 1; s2.losses += 1; }
    else if (mp.outcome === 'p2_win') { s2.wins += 1; s1.losses += 1; }
    else { s1.draws += 1; s2.draws += 1; }
  }

  // Resolve player names + clubs from convocation_poules (the canonical source
  // for poule rosters in DdJ). Falls back to player_name from the same table.
  const players = await fetchAll(
    `SELECT cp.licence,
            COALESCE(p.last_name || ' ' || p.first_name, cp.player_name) AS name,
            cp.club
     FROM convocation_poules cp
     LEFT JOIN players p ON REPLACE(p.licence, ' ', '') = REPLACE(cp.licence, ' ', '')
     WHERE cp.tournoi_id = $1`,
    [tournoiId]
  );
  const meta = new Map();
  players.forEach(p => meta.set(String(p.licence || '').replace(/\s+/g, ''), p));

  // Build output array
  const arr = [...stats.values()].map(s => {
    const m = meta.get(String(s.licence || '').replace(/\s+/g, '')) || {};
    const moyenne = s.total_reprises > 0 ? s.total_points / s.total_reprises : 0;
    const winRate = s.matches_played > 0 ? Math.round((s.wins / s.matches_played) * 100) : 0;
    return {
      licence: s.licence,
      name: m.name || s.licence,
      club: m.club || null,
      matches_played: s.matches_played,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      match_points: s.match_points,
      win_rate: winRate,
      total_points: s.total_points,
      total_reprises: s.total_reprises,
      moyenne: Math.round(moyenne * 1000) / 1000,
      best_serie: s.best_serie || 0
    };
  });

  // FFB sort: match_points desc, moyenne desc, best_serie desc
  arr.sort((a, b) => {
    if (b.match_points !== a.match_points) return b.match_points - a.match_points;
    if (b.moyenne !== a.moyenne) return b.moyenne - a.moyenne;
    return (b.best_serie || 0) - (a.best_serie || 0);
  });

  // Add 1-based rank
  arr.forEach((p, i) => { p.rank = i + 1; });
  return arr;
}

// ============================================================================
// V 2.0.844 — Sprint 2 LBIF Phase 6B: buildLbifClassement
// ============================================================================
//
// Computes each player's LBIF "position" key + the corresponding points from
// the lbif_points table. The position is derived from the player's actual
// outcome in the tournament:
//
//   - Final placement (bracket.final_places): 1 → '1st', 2 → '2nd',
//     3 or 4 → 'semi'.
//   - Bracket participants who didn't reach the SF: derive from the deepest
//     bracket phase they entered. Lost in QF → 'quarter'. Lost in EIGHTH →
//     'eighth'.
//   - Players who played the barrage but didn't make the bracket → 'barrage'.
//   - Players eliminated at poule stage (didn't make top-2):
//       * with >= 1 win  → 'poule_3rd_1win'
//       * with 0 wins    → 'poule_3rd_0win'
//
// Returns an ordered array (highest points first) of:
//   { licence, name, club, position, position_label, points }
//
// Per LBIF règlement chap 1.1.1.G / 3.1.G (identical for 5Q + 9Q).
// ============================================================================

const _LBIF_POSITION_LABELS = {
  '1st':            'Vainqueur',
  '2nd':            'Finaliste',
  'semi':           '1/2 finaliste',
  'quarter':        '1/4 de finale',
  'eighth':         '1/8 de finale',
  'barrage':        'Barrage',
  'poule_3rd_1win': '3e poule (1 victoire)',
  'poule_3rd_0win': '3e poule (0 victoire)'
};

async function buildLbifClassement(db, orgId, tournoiId, { pouleCtx, bracketCtx }) {
  const { getLbifPointsForOrg } = require('../utils/quilles-helpers');
  const pointsMap = await getLbifPointsForOrg(db, orgId);
  // V 2.0.852 — normLic now strips whitespace AND uppercases. Without the
  // uppercase, a player whose licence is stored with different casing in
  // convocation_poules vs ddj_bracket_matches (rare but possible — e.g.
  // legacy data, manual entry) was silently dropped from the classement
  // because summary.get(licence) returned undefined. Observed in
  // production: David BERTRAND vanished from the LBIF classement despite
  // having lost QF1 (= 11 pts owed).
  const normLic = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

  // 1. Gather every player who took part (poule players + qualifiés d'office)
  const playerRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT licence, player_name, club, poule_number,
              COALESCE(is_direct_qualif, FALSE) AS is_direct_qualif
         FROM convocation_poules
        WHERE tournoi_id = $1`,
      [tournoiId], (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });
  if (!playerRows.length) return [];

  // 2. Build a per-licence summary: poule stats + bracket-deepest-phase
  const summary = new Map(); // normLic → object
  for (const r of playerRows) {
    summary.set(normLic(r.licence), {
      licence: r.licence,
      name: r.player_name,
      club: r.club,
      poule_number: r.poule_number,
      is_direct_qualif: !!r.is_direct_qualif,
      poule_wins: 0,
      poule_qualified: false,   // top-N of poule
      barrage_played: false,
      barrage_won: false,
      bracket_phase_lost: null, // 'EIGHTH' | 'QF' | 'SF' | 'F' | 'PF' | null
      bracket_phase_won: null,  // 'F' (= 1st) | 'PF' (= 3rd) | null
      final_place: null,
      position: null,
      points: 0
    });
  }

  // 3. Poule stats — qualified set + wins for the 3rd-of-poule subcategory
  for (const poule of pouleCtx.poules || []) {
    const top = (poule.classement || []).slice(0, 2); // LBIF qualifies top-2
    const topSet = new Set(top.map(c => normLic(c.licence)));
    for (const c of poule.classement || []) {
      const s = summary.get(normLic(c.licence));
      if (!s) continue;
      s.poule_wins = c.wins || 0;
      s.poule_qualified = topSet.has(normLic(c.licence));
    }
  }

  // 4. Barrage outcomes (from ddj_barrage_matches via direct query — avoid
  //    re-running loadBarrage which is heavy).
  const barrageRows = await new Promise((resolve) => {
    db.all(
      `SELECT p1_licence, p2_licence, p1_points, p2_points
         FROM ddj_barrage_matches WHERE tournoi_id = $1`,
      [tournoiId], (err, rs) => resolve(err ? [] : (rs || []))
    );
  });
  for (const m of barrageRows) {
    const k1 = normLic(m.p1_licence), k2 = normLic(m.p2_licence);
    const s1 = summary.get(k1), s2 = summary.get(k2);
    if (s1) s1.barrage_played = true;
    if (s2) s2.barrage_played = true;
    if (m.p1_points != null && m.p2_points != null) {
      if (m.p1_points > m.p2_points && s1) s1.barrage_won = true;
      else if (m.p2_points > m.p1_points && s2) s2.barrage_won = true;
    }
  }

  // 5. Bracket outcomes — walk phases and tag each player's deepest result.
  // Phase ordering matters: we want the DEEPEST phase reached, so iterate
  // in reverse depth order (F + PF first, then SF, QF, EIGHTH).
  const phaseDepth = (ph) => {
    if (ph === 'F' || ph === 'PF') return 5;
    if (ph === 'SF1' || ph === 'SF2') return 4;
    if (ph && ph.startsWith('QF')) return 3;
    if (ph && ph.startsWith('EIGHTH')) return 2;
    return 0;
  };
  const phaseFamily = (ph) => {
    if (ph === 'F') return 'F';
    if (ph === 'PF') return 'PF';
    if (ph === 'SF1' || ph === 'SF2') return 'SF';
    if (ph && ph.startsWith('QF')) return 'QF';
    if (ph && ph.startsWith('EIGHTH')) return 'EIGHTH';
    return null;
  };
  // V 2.0.853 — PREFER saved licences over the resolved player objects.
  // Critical alignment fix: ph.p1_points / ph.p2_points are read from
  // saved.p1_points / saved.p2_points, which means they correspond to
  // saved.p1_licence / saved.p2_licence — NOT necessarily to ph.p1.licence /
  // ph.p2.licence, which my seedPairs logic can order differently.
  //
  // Observed in production V 2.0.852: QF1 saved row had p1=Eric (99 pts),
  // p2=David (93 pts), but seedPairs put David as ph.p1. Using ph.p1.licence
  // with ph.p1_points = 99 made my code mark David as the QF1 winner.
  // Eric kept his '1st' position via final_place, but David got no position
  // and was silently dropped from the LBIF classement.
  //
  // V 2.0.851 was the previous fallback (the other direction) — still in
  // place for the case where saved data is genuinely missing.
  const phaseLicences = (ph) => ({
    p1: ph.p1_licence_saved || (ph.p1 && ph.p1.licence) || null,
    p2: ph.p2_licence_saved || (ph.p2 && ph.p2.licence) || null
  });
  // V 2.0.856 — DON'T gate on ph.is_played here. That flag uses the strict
  // isMatchTrulyFinished helper, which for Quilles requires someone to reach
  // the distance (e.g. 100 pts). Real production case (tournament 404 QF1):
  // Eric scored 99 vs David's 93. Neither hit 100, so is_played = false,
  // QF1 was dropped from sortedPhases, David never got tagged as QF1 loser
  // → silently missing from the LBIF classement. But everyone (the DdJ, the
  // downstream SF1/F/PF saved rows) treated Eric as the QF1 winner.
  //
  // For the LBIF classement walk we only need: both scores present + not
  // a tie. The saved-licence fallback (V 2.0.851) handles the player IDs.
  const sortedPhases = (bracketCtx.phases || [])
    .filter(ph => {
      if (ph.p1_points == null || ph.p2_points == null) return false;
      if (ph.p1_points === ph.p2_points) return false; // can't determine winner
      const lics = phaseLicences(ph);
      return !!(lics.p1 && lics.p2);
    })
    .sort((a, b) => phaseDepth(b.phase) - phaseDepth(a.phase));

  // V 2.0.852 — Defensive auto-add: if a bracket participant somehow isn't
  // in the summary (e.g. licence mismatch between tables, or a stale
  // convocation_poules row), synthesise a minimal entry from the phase's
  // player object so they still get their position + points. Without this,
  // they would silently vanish from the LBIF classement.
  const ensureInSummary = (normLicKey, sourcePlayer) => {
    if (summary.has(normLicKey)) return summary.get(normLicKey);
    if (!normLicKey) return null;
    const synth = {
      licence: (sourcePlayer && sourcePlayer.licence) || normLicKey,
      name: (sourcePlayer && sourcePlayer.player_name) || 'Joueur',
      club: (sourcePlayer && sourcePlayer.club) || null,
      poule_number: (sourcePlayer && sourcePlayer.poule_number) || null,
      is_direct_qualif: false,
      poule_wins: 0,
      poule_qualified: false,
      barrage_played: false,
      barrage_won: false,
      bracket_phase_lost: null,
      bracket_phase_won: null,
      final_place: null,
      position: null,
      points: 0
    };
    summary.set(normLicKey, synth);
    return synth;
  };

  for (const ph of sortedPhases) {
    const family = phaseFamily(ph.phase);
    if (!family) continue;
    const lics = phaseLicences(ph);
    const p1k = normLic(lics.p1), p2k = normLic(lics.p2);
    // V 2.0.853 — Match source player by licence (since ph.p1 / ph.p2 may
    // be in different order than the saved row). Falls back to either
    // player object if no match — name will be a generic 'Joueur' for the
    // synthetic entry, but the points still get credited correctly.
    const findInPhase = (norm) => {
      if (ph.p1 && normLic(ph.p1.licence) === norm) return ph.p1;
      if (ph.p2 && normLic(ph.p2.licence) === norm) return ph.p2;
      return null;
    };
    const s1 = ensureInSummary(p1k, findInPhase(p1k));
    const s2 = ensureInSummary(p2k, findInPhase(p2k));
    // Winner / loser by points
    let winnerSummary = null, loserSummary = null;
    if (ph.p1_points > ph.p2_points) { winnerSummary = s1; loserSummary = s2; }
    else if (ph.p2_points > ph.p1_points) { winnerSummary = s2; loserSummary = s1; }
    // F: winner = 1st, loser = 2nd. PF: winner = 3rd, loser = 4th.
    // Other phases: only the LOSER's depth matters (winners advance further).
    if (family === 'F') {
      if (winnerSummary && !winnerSummary.bracket_phase_won) winnerSummary.bracket_phase_won = 'F';
      if (loserSummary  && !loserSummary.bracket_phase_lost) loserSummary.bracket_phase_lost  = 'F';
    } else if (family === 'PF') {
      if (winnerSummary && !winnerSummary.bracket_phase_won) winnerSummary.bracket_phase_won = 'PF';
      if (loserSummary  && !loserSummary.bracket_phase_lost) loserSummary.bracket_phase_lost  = 'PF';
    } else {
      // Loser of SF/QF/EIGHTH stops here; winner continues (handled by deeper phase already processed).
      if (loserSummary && !loserSummary.bracket_phase_lost) loserSummary.bracket_phase_lost = family;
    }
  }

  // 6. Final places straight from bracketCtx.final_places (authoritative).
  for (const fp of (bracketCtx.final_places || [])) {
    const s = summary.get(normLic(fp.licence));
    if (s) s.final_place = fp.place;
  }

  // V 2.0.854 — Defensive bracket-qualifier pass.
  // Every player listed in bracketCtx.qualifiers MUST end up with a non-null
  // position. If a qualifier somehow isn't in summary yet (rare: e.g. their
  // convocation_poules row went missing, or a normalisation edge case lost
  // the lookup), synthesise an entry now. Then re-walk the bracket phases
  // ONLY for those qualifiers, so they pick up their bracket_phase_lost tag.
  // This is a belt-and-suspenders guard against the V 2.0.852/853 fixes
  // not catching every case (observed in production: David BERTRAND,
  // direct qualif, QF1 loser, silently dropped from the classement).
  for (const q of (bracketCtx.qualifiers || [])) {
    const qNorm = normLic(q.licence);
    if (!qNorm) continue;
    if (!summary.has(qNorm)) {
      summary.set(qNorm, {
        licence: q.licence,
        name: q.player_name || 'Joueur',
        club: q.club || null,
        poule_number: q.poule_number || null,
        is_direct_qualif: q.source === 'direct',
        poule_wins: 0,
        poule_qualified: q.source === 'exempt' || q.source === 'barrage_winner',
        barrage_played: q.source === 'barrage_winner',
        barrage_won: q.source === 'barrage_winner',
        bracket_phase_lost: null,
        bracket_phase_won: null,
        final_place: null,
        position: null,
        points: 0
      });
    }
    // Re-tag from saved bracket phases — covers the case where the first
    // walk missed this player (whatever the reason). Idempotent: skips if
    // bracket_phase_lost / bracket_phase_won already set.
    const s = summary.get(qNorm);
    if (!s.bracket_phase_lost && !s.bracket_phase_won && s.final_place == null) {
      for (const ph of sortedPhases) {
        const lics = phaseLicences(ph);
        const isP1 = normLic(lics.p1) === qNorm;
        const isP2 = normLic(lics.p2) === qNorm;
        if (!isP1 && !isP2) continue;
        if (ph.p1_points == null || ph.p2_points == null) continue;
        const won = (isP1 && ph.p1_points > ph.p2_points) || (isP2 && ph.p2_points > ph.p1_points);
        const family = phaseFamily(ph.phase);
        if (won) {
          if (!s.bracket_phase_won && (family === 'F' || family === 'PF')) s.bracket_phase_won = family;
        } else {
          if (!s.bracket_phase_lost) { s.bracket_phase_lost = family; break; } // deepest = earliest in sortedPhases
        }
      }
    }
  }

  // 7. Map each player's outcome to an LBIF position key.
  for (const s of summary.values()) {
    if (s.final_place === 1) s.position = '1st';
    else if (s.final_place === 2) s.position = '2nd';
    else if (s.final_place === 3 || s.final_place === 4) s.position = 'semi';
    else if (s.bracket_phase_lost === 'SF') s.position = 'semi';
    else if (s.bracket_phase_lost === 'QF') s.position = 'quarter';
    else if (s.bracket_phase_lost === 'EIGHTH') s.position = 'eighth';
    else if (s.barrage_played && !s.barrage_won) s.position = 'barrage';
    else if (!s.poule_qualified && !s.is_direct_qualif) {
      s.position = s.poule_wins >= 1 ? 'poule_3rd_1win' : 'poule_3rd_0win';
    } else {
      // Edge case: qualifié d'office or exempt whose bracket result is missing.
      // Skip (position null) so the row doesn't appear in the classement until
      // the tournament finishes. Avoids assigning random points mid-event.
      s.position = null;
    }
    s.points = s.position ? (pointsMap[s.position] || 0) : 0;
  }

  // 8. Build the output array — ordered by points desc, then poule_wins desc,
  //    then name for deterministic tie-break.
  const out = [...summary.values()]
    .filter(s => s.position) // omit unresolved (mid-tournament safety)
    .map(s => ({
      licence: s.licence,
      name: s.name,
      club: s.club,
      poule_number: s.poule_number || null,
      position: s.position,
      position_label: _LBIF_POSITION_LABELS[s.position] || s.position,
      points: s.points,
      final_place: s.final_place
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      // Final places (1-4) come first within their points bucket
      const ap = a.final_place || 99, bp = b.final_place || 99;
      if (ap !== bp) return ap - bp;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  out.forEach((p, i) => { p.rank = i + 1; });
  return out;
}

// ============================================================================
// Step 6b — Export CSV (format FFB)
// ============================================================================
//
// Produces the semicolon-separated CSV expected by the FFB match-import flow
// used by CDB 93-94. Reference sample header (20 columns):
//   No Phase;Date match;Billard;Poule;Licence J1;Joueur 1;Pts J1;Rep J1;Ser J1;
//   Pts Match J1;Moy J1;Licence J2;Joueur 2;Pts J2;Rep J2;Ser J2;Pts Match J2;
//   Moy J2;NOMBD;Mode de jeu
//
// Chronological phase ordering (as seen in the CDB 93-94 sample):
//   1 = Poule matches
//   2 = Classement 09-10 (our Consolante R16 losers)
//   3 = G 9-10 - P 7-8     (our Consolante QF level)
//   4 = G 7-8 - P5-6       (our Consolante SF level)
//   5 = Classement 05 - 06 (our Consolante Finale)
//   6 = Demi-finales       (our Bracket SF1/SF2)
//   7 = Petite finale      (our Bracket PF)
//   8 = Finale             (our Bracket F)
//
// Data shape per row: only PLAYED matches are included (no scheduled-but-empty,
// no BYEs). Moyenne is comma-decimal with trailing zeros stripped. Licence
// is passed through as-is (no spaces by our normalization convention).
//
// Columns Billard / NOMBD (table type e.g. "2m80") are left empty for now —
// this is venue-specific and we don't currently capture it in our data model.
// Adding a per-org setting is a future improvement; users can fill the column
// post-export in Excel if needed.
// ============================================================================

const CSV_HEADER_FFB = [
  'No Phase', 'Date match', 'Billard', 'Poule',
  'Licence J1', 'Joueur 1', 'Pts J1', 'Rep J1', 'Ser J1', 'Pts Match J1', 'Moy J1',
  'Licence J2', 'Joueur 2', 'Pts J2', 'Rep J2', 'Ser J2', 'Pts Match J2', 'Moy J2',
  'NOMBD', 'Mode de jeu'
].join(';');

// Map our internal mode strings to the FFB-facing labels seen in the sample.
const MODE_LABEL_FFB = {
  'LIBRE': 'Libre',
  'BANDE': '1 Bande',
  '1BANDE': '1 Bande',
  '3BANDES': '3 Bandes',
  '3 BANDES': '3 Bandes',
  'CADRE': 'Cadre'
};
function formatModeFFB(mode) {
  if (!mode) return '';
  const key = String(mode).toUpperCase().replace(/\s+/g, '');
  // Try normalized key first, then with space preserved
  return MODE_LABEL_FFB[key] || MODE_LABEL_FFB[String(mode).toUpperCase()] || String(mode);
}

function formatMoyenneFFB(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const val = Number(n);
  let s = val.toFixed(2).replace('.', ',');
  s = s.replace(/0+$/, '').replace(/,$/, '');
  return s === '' ? '0' : s;
}

function formatDateFFB(dateInput) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Player name: FFB sample shows "LASTNAME FIRSTNAME" (uppercase). Our stored
// player_name is typically "First Last" or may already be uppercase. We
// uppercase as a safe normalization — if it comes from the qualifier/non_qual
// row it might be "First Last"; match-level player objects vary too.
function formatPlayerNameFFB(name) {
  if (!name) return '';
  return String(name).toUpperCase();
}

function csvCell(v) {
  // Replace any inline semicolons with commas; also strip newlines just in case.
  return String(v ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ').trim();
}

function matchRow(phaseNo, date, poule, p1, p2, m, mode) {
  // Compute moyennes from raw data (don't rely on saved field to be up to date)
  const moy1 = p1 && m.p1_points != null && m.p1_reprises > 0 ? m.p1_points / m.p1_reprises : null;
  const moy2 = p2 && m.p2_points != null && m.p2_reprises > 0 ? m.p2_points / m.p2_reprises : null;

  // Match points: use the precomputed field if the poule engine set it;
  // otherwise derive knockout result (2 / 0).
  let mp1 = m.p1_match_points;
  let mp2 = m.p2_match_points;
  if (mp1 == null || mp2 == null) {
    if (m.p1_points > m.p2_points) { mp1 = 2; mp2 = 0; }
    else if (m.p2_points > m.p1_points) { mp1 = 0; mp2 = 2; }
    else { mp1 = 1; mp2 = 1; }
  }

  const cells = [
    phaseNo, date, '', poule, // Billard column intentionally blank
    p1?.licence || '',
    formatPlayerNameFFB(p1?.player_name),
    m.p1_points ?? '', m.p1_reprises ?? '', m.p1_serie ?? '',
    mp1 ?? '', formatMoyenneFFB(moy1),
    p2?.licence || '',
    formatPlayerNameFFB(p2?.player_name),
    m.p2_points ?? '', m.p2_reprises ?? '', m.p2_serie ?? '',
    mp2 ?? '', formatMoyenneFFB(moy2),
    '',                      // NOMBD blank (same as Billard)
    formatModeFFB(mode)
  ];
  return cells.map(csvCell).join(';');
}

// Poule number → letter label: 1 → A, 2 → B, ..., 26 → Z, 27 → AA
function pouleLabel(n) {
  if (!Number.isFinite(n) || n < 1) return '?';
  let label = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    x = Math.floor((x - 1) / 26);
  }
  return 'POULE ' + label;
}

// Consolante phase → (phase number, label) mapping.
// R16 losers fight at level 2, QF at 3, SF at 4, Finale at 5.
function consolanteExportMeta(phaseCode) {
  if (phaseCode === 'F') return { no: 5, label: 'Classement 05 - 06' };
  if (phaseCode === 'SF1') return { no: 4, label: 'Classement — Demi-finale 1 (consolante)' };
  if (phaseCode === 'SF2') return { no: 4, label: 'Classement — Demi-finale 2 (consolante)' };
  if (/^QF[1-4]$/.test(phaseCode)) return { no: 3, label: `Classement — Quart ${phaseCode.slice(2)} (consolante)` };
  if (/^R16_[1-8]$/.test(phaseCode)) return { no: 2, label: `Classement — 1/8 ${phaseCode.slice(4)} (consolante)` };
  return null;
}

router.get('/competitions/:id/export-csv', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }
  try {
    const pouleCtx = await loadPouleMatches(db, orgId, tournoiId);
    if (pouleCtx.error) return res.status(pouleCtx.status || 500).json({ error: pouleCtx.error });
    const bracketCtx = await loadBracket(db, orgId, tournoiId);
    const consolanteCtx = await loadConsolante(db, orgId, tournoiId);

    const t = pouleCtx.tournament;
    const matchDate = formatDateFFB(t.debut);
    const mode = t.mode;
    const rows = [];

    // Phase 1: poule matches
    // Note: poule matches use flat fields (m.p1_licence, m.p1_name) while
    // bracket/consolante use nested objects (m.p1.licence). We normalize here
    // so matchRow() sees a uniform { licence, player_name } shape.
    for (const poule of (pouleCtx.poules || [])) {
      const label = pouleLabel(poule.number);
      for (const m of (poule.matches || [])) {
        if (!m.is_played) continue;
        const p1Obj = { licence: m.p1_licence, player_name: m.p1_name };
        const p2Obj = { licence: m.p2_licence, player_name: m.p2_name };
        rows.push(matchRow(1, matchDate, label, p1Obj, p2Obj, m, mode));
      }
    }

    // Phases 2-5: consolante matches
    if (consolanteCtx && !consolanteCtx.error && consolanteCtx.phases) {
      for (const ph of consolanteCtx.phases) {
        if (!ph.is_played || ph.has_bye) continue;
        const meta = consolanteExportMeta(ph.phase);
        if (!meta) continue;
        rows.push(matchRow(meta.no, matchDate, meta.label, ph.p1, ph.p2, ph, mode));
      }
    }

    // Phases 6-8: bracket matches
    if (bracketCtx && !bracketCtx.error && bracketCtx.phases) {
      const BRACKET_META = {
        SF1: { no: 6, label: 'Demi-Finale 1 (01-04)' },
        SF2: { no: 6, label: 'Demi-Finale 2 (02-03)' },
        PF:  { no: 7, label: 'PETITE FINALE' },
        F:   { no: 8, label: 'FINALE' }
      };
      // Emit in semantic order (SF1, SF2, PF, F) so the file reads naturally
      for (const code of ['SF1', 'SF2', 'PF', 'F']) {
        const ph = bracketCtx.phases.find(p => p.phase === code);
        if (!ph || !ph.is_played) continue;
        rows.push(matchRow(BRACKET_META[code].no, matchDate, BRACKET_META[code].label, ph.p1, ph.p2, ph, mode));
      }
    }

    // Prepend UTF-8 BOM so Excel opens it with correct accents. CRLF line endings.
    const csv = '\ufeff' + CSV_HEADER_FFB + '\r\n' + rows.join('\r\n') + (rows.length ? '\r\n' : '');

    const safeName = (t.nom || `tournoi_${tournoiId}`).replace(/[\/\\:*?"<>|]/g, '_');
    const filename = `matchs_competition_${safeName}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[DdJ] /export-csv error:', err);
    res.status(500).json({ error: "Erreur lors de l'export CSV" });
  }
});

// ============================================================================
// Step 7 — Finalisation : intègre les résultats au moteur de classement
// ============================================================================
//
// Mirrors the CSV /import pipeline so the DdJ workflow plugs into the same
// downstream machinery (positions, bonuses, season rankings) used by
// admin-imported results. Idempotent: re-finalizing wipes & re-inserts.
//
// Per-player aggregation across ALL their played matches (poule + bracket
// + consolante; byes excluded since no score was entered):
//   points       = Σ p[i]_points
//   reprises     = Σ p[i]_reprises
//   match_points = Σ p[i]_match_points (uses precomputed value where
//                  available, falls back to 2/0 derivation in knockouts)
//   serie        = max p[i]_serie
//   moyenne      = points / reprises (weighted)
//   position     = final overall place from bracket (1-4) + consolante (5+)
//
// Tournament linkage uses the same (category_id, tournament_number, season)
// composite key as /import — no new column on `tournaments` needed.
// ============================================================================

const tournamentsRouter = require('./tournaments');
const {
  recalculatePositions: recalcPositions,
  recomputeAllBonuses: recalcBonuses,
  recalculateRankings: recalcRankings
} = tournamentsRouter;

router.post('/competitions/:id/finalize', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    // V 2.0.857 — Defensive migration. The V 2.0.799 hotfix that adds
    // p1_points_subis / p2_points_subis to the three match tables didn't
    // apply on production for one of them (observed: "column
    // p1_points_subis does not exist" on /finalize). Run idempotent
    // ALTER TABLE here so the column is guaranteed before any SELECT.
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `DO $$ BEGIN
             IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ddj_poule_matches') THEN
               ALTER TABLE ddj_poule_matches ADD COLUMN IF NOT EXISTS p1_points_subis INTEGER;
               ALTER TABLE ddj_poule_matches ADD COLUMN IF NOT EXISTS p2_points_subis INTEGER;
             END IF;
             IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ddj_bracket_matches') THEN
               ALTER TABLE ddj_bracket_matches ADD COLUMN IF NOT EXISTS p1_points_subis INTEGER;
               ALTER TABLE ddj_bracket_matches ADD COLUMN IF NOT EXISTS p2_points_subis INTEGER;
             END IF;
             IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ddj_consolante_matches') THEN
               ALTER TABLE ddj_consolante_matches ADD COLUMN IF NOT EXISTS p1_points_subis INTEGER;
               ALTER TABLE ddj_consolante_matches ADD COLUMN IF NOT EXISTS p2_points_subis INTEGER;
             END IF;
           END $$;`,
          [], (err) => err ? reject(err) : resolve()
        );
      });
    } catch (e) {
      console.warn('[/finalize] defensive points_subis migration failed:', e.message);
    }

    // ---- Load full state ---------------------------------------------------
    const pouleCtx = await loadPouleMatches(db, orgId, tournoiId);
    if (pouleCtx.error) return res.status(pouleCtx.status || 500).json({ error: pouleCtx.error });
    const bracketCtx = await loadBracket(db, orgId, tournoiId);
    if (bracketCtx.error) return res.status(bracketCtx.status || 500).json({ error: bracketCtx.error });
    const consolanteCtx = await loadConsolante(db, orgId, tournoiId);
    if (consolanteCtx.error) return res.status(consolanteCtx.status || 500).json({ error: consolanteCtx.error });

    // ---- Validate completion ----------------------------------------------
    const allPoulesDone = pouleCtx.poules.length > 0 && pouleCtx.poules.every(p => p.all_matches_played);
    if (!allPoulesDone) {
      return res.status(409).json({ error: 'Tous les matchs de poule doivent être terminés avant de valider.' });
    }
    // V 2.0.865 / V 2.0.866 — "No-bracket" detection covers three real cases:
    //   1. Carambole N < single_poule_threshold (default 6) → pouleCtx.mode='single_poule'
    //   2. Quilles N < 12 → bracketCtx.bracket_size = 0 (LBIF single_poule_fallback)
    //   3. Quilles bracketCtx.mode === 'single_poule' (legacy edge case)
    // In any of these, the single poule's classement IS the final standings.
    // We only require the poule matches to be done (checked above). For the
    // standard multi-poule + bracket flow, the bracket + consolante gates
    // still apply unchanged.
    const isSinglePoule = pouleCtx.mode === 'single_poule'
                       || bracketCtx.mode === 'single_poule'
                       || (bracketCtx.bracket_size === 0 && (!bracketCtx.phases || bracketCtx.phases.length === 0));
    if (!isSinglePoule) {
      if (!bracketCtx.final_places || bracketCtx.final_places.length === 0) {
        return res.status(409).json({ error: 'Le tableau final doit être terminé (Finale + Petite finale).' });
      }
      // Consolante is required only if there ARE non-qualifiers (size >= 2).
      if (consolanteCtx.consolante_size >= 2 && !consolanteCtx.final_places) {
        return res.status(409).json({ error: 'La consolante doit être terminée (matchs de classement).' });
      }
    }

    // ---- Aggregate per-player stats ---------------------------------------
    const t = pouleCtx.tournament;
    // V 2.0.865 — For single-poule mode, derive places from the poule
    // classement order (1st of classement = place 1, etc.) instead of from
    // bracket/consolante which are empty. Without this, no player gets a
    // position assigned and the season ranking can't sort them.
    const overallPlaces = isSinglePoule
      ? ((pouleCtx.poules || [])[0]?.classement || []).map((row, idx) => ({
          place: idx + 1,
          licence: row.licence,
          name: row.player_name
        }))
      : [
          ...(bracketCtx.final_places || []),
          ...(consolanteCtx.final_places || [])
        ];
    const placeByLicence = new Map();
    overallPlaces.forEach(p => {
      const key = String(p.licence || '').replace(/\s+/g, '');
      if (key) placeByLicence.set(key, p.place);
    });

    // V 2.0.798 — Sprint 2 D.5: detect Quilles tournament once, then propagate
    // through the aggregation. Quilles matches accumulate points_subis
    // (the opponent's score / loser's plafond) and have no reprises.
    const { isQuillesMode: _isQ } = require('../utils/quilles-helpers');
    const tournamentIsQuilles = _isQ(pouleCtx.tournament && pouleCtx.tournament.mode);

    const statsByLic = new Map();
    const ensure = (licNorm, name) => {
      if (!statsByLic.has(licNorm)) {
        statsByLic.set(licNorm, {
          licence: licNorm,
          player_name: name || '',
          points: 0, reprises: 0, match_points: 0, best_serie: 0, matches_played: 0,
          // V 2.0.798 — Quilles: cumulative opponent scores (sum of "points subis")
          points_subis: 0,
          // MPART: best per-match average across all matches played by the player.
          // Different from MGP = total_points / total_reprises (the overall avg).
          best_match_moyenne: 0,
          // Position within the player's poule (1, 2, 3...). Filled in a
          // post-pass below, since we need the full poule classement to know.
          poule_rank: null
        });
      } else if (name && !statsByLic.get(licNorm).player_name) {
        statsByLic.get(licNorm).player_name = name;
      }
      return statsByLic.get(licNorm);
    };

    // Add a played match's stats. mp1/mp2 may be null in knockouts (then we
    // derive from points: winner=2, loser=0, no draws expected in KO).
    const addMatch = (lic1, name1, lic2, name2, m, isKnockout) => {
      const k1 = String(lic1 || '').replace(/\s+/g, '');
      const k2 = String(lic2 || '').replace(/\s+/g, '');
      if (!k1 || !k2) return;
      if (m.p1_points == null || m.p2_points == null) return;
      const s1 = ensure(k1, name1);
      const s2 = ensure(k2, name2);
      s1.points += m.p1_points || 0;
      s2.points += m.p2_points || 0;
      // V 2.0.798 — Quilles: accumulate points_subis. Carambole matches don't
      // populate the column, so we fall back to the opponent's points (same
      // semantically as the symmetric derivation in D.3/D.4).
      s1.points_subis += (m.p1_points_subis != null ? m.p1_points_subis : (m.p2_points || 0));
      s2.points_subis += (m.p2_points_subis != null ? m.p2_points_subis : (m.p1_points || 0));
      s1.reprises += m.p1_reprises || 0;
      s2.reprises += m.p2_reprises || 0;
      s1.best_serie = Math.max(s1.best_serie, m.p1_serie || 0);
      s2.best_serie = Math.max(s2.best_serie, m.p2_serie || 0);
      // MPART (meilleure partie / best per-match moyenne): track max across
      // each individual match's points/reprises. Skipped silently if reprises=0.
      if (m.p1_reprises > 0) {
        s1.best_match_moyenne = Math.max(s1.best_match_moyenne, m.p1_points / m.p1_reprises);
      }
      if (m.p2_reprises > 0) {
        s2.best_match_moyenne = Math.max(s2.best_match_moyenne, m.p2_points / m.p2_reprises);
      }
      let mp1 = m.p1_match_points;
      let mp2 = m.p2_match_points;
      if (mp1 == null || mp2 == null) {
        if (m.p1_points > m.p2_points) { mp1 = 2; mp2 = 0; }
        else if (m.p2_points > m.p1_points) { mp1 = 0; mp2 = 2; }
        else { mp1 = 1; mp2 = 1; }
      }
      s1.match_points += mp1;
      s2.match_points += mp2;
      s1.matches_played++;
      s2.matches_played++;
    };

    // V 2.0.857 — Quilles: relax is_played gate (matches the V 2.0.856 fix
    // for LBIF classement). For Quilles, a match counts as played whenever
    // both scores are present and differ — no need to hit the distance.
    // Carambole keeps strict is_played semantics.
    const isPlayedForFinalize = (m) => {
      if (tournamentIsQuilles) {
        return m.p1_points != null && m.p2_points != null && m.p1_points !== m.p2_points;
      }
      return !!m.is_played;
    };
    // Poule matches (flat shape: m.p1_licence / m.p1_name)
    for (const poule of (pouleCtx.poules || [])) {
      for (const m of (poule.matches || [])) {
        if (!isPlayedForFinalize(m)) continue;
        addMatch(m.p1_licence, m.p1_name, m.p2_licence, m.p2_name, m, false);
      }
    }
    // Bracket matches (nested shape: m.p1.licence)
    for (const ph of (bracketCtx.phases || [])) {
      if (!isPlayedForFinalize(ph)) continue;
      addMatch(ph.p1?.licence, ph.p1?.player_name, ph.p2?.licence, ph.p2?.player_name, ph, true);
    }
    // Consolante matches (skip byes — no score was entered)
    for (const ph of (consolanteCtx.phases || [])) {
      if (!isPlayedForFinalize(ph) || ph.has_bye) continue;
      addMatch(ph.p1?.licence, ph.p1?.player_name, ph.p2?.licence, ph.p2?.player_name, ph, true);
    }

    if (statsByLic.size === 0) {
      return res.status(409).json({ error: 'Aucun match joué — rien à finaliser.' });
    }

    // Post-pass: assign poule_rank to each player based on their position
    // in their poule classement (already computed at Step 3 with the FFB
    // tiebreak chain: match_points → moyenne → best_serie → h2h → licence).
    for (const poule of (pouleCtx.poules || [])) {
      (poule.classement || []).forEach((row, idx) => {
        const lic = String(row.licence || row.licence_normalized || '').replace(/\s+/g, '');
        const stats = statsByLic.get(lic);
        if (stats) stats.poule_rank = idx + 1;
      });
    }

    // ---- Resolve category + season ----------------------------------------
    let categoryRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM categories
         WHERE UPPER(REPLACE(game_type, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
           AND UPPER(level) = UPPER($2)
           AND ($3::int IS NULL OR organization_id = $3)
         LIMIT 1`,
        [t.mode || '', t.categorie || '', orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    // V 2.0.858 — Quilles tournaments don't have FFB levels (everyone plays
    // OPEN regardless of classification). The categories table is seeded
    // for carambole disciplines only — Quilles categories don't exist by
    // default. Auto-provision the row on first finalize so the user doesn't
    // have to pre-configure anything. Idempotent: subsequent finalizes
    // will find the row.
    if (!categoryRow && tournamentIsQuilles) {
      const displayName = `${(t.mode || '').toUpperCase()} ${(t.categorie || 'OPEN').toUpperCase()}`.trim();
      try {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO categories (game_type, level, display_name, is_active, organization_id)
             VALUES ($1, $2, $3, TRUE, $4)
             ON CONFLICT (game_type, level, organization_id) DO NOTHING`,
            [(t.mode || '').toUpperCase(), (t.categorie || 'OPEN').toUpperCase(), displayName, orgId],
            (err) => err ? reject(err) : resolve()
          );
        });
        categoryRow = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id FROM categories
             WHERE UPPER(REPLACE(game_type, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
               AND UPPER(level) = UPPER($2)
               AND ($3::int IS NULL OR organization_id = $3)
             LIMIT 1`,
            [t.mode || '', t.categorie || '', orgId],
            (err, row) => err ? reject(err) : resolve(row)
          );
        });
      } catch (e) {
        console.error('[/finalize] Quilles category auto-create failed:', e.message);
      }
    }
    if (!categoryRow) {
      return res.status(400).json({
        error: `Catégorie introuvable dans la table categories : ${t.mode} / ${t.categorie}`
      });
    }
    const categoryId = categoryRow.id;
    // V 2.0.542 — `tournament_number` MUST come from tournoi_ext (T1=1, T2=2,
    // T3=3, finale=4...). Previous fallback to 1 silently overwrote the T1
    // tournaments row when finalizing T2 of the same category/season, because
    // the UPSERT key is (category_id, tournament_number, season).
    if (!t.tournament_number) {
      return res.status(500).json({
        error: 'Numéro de tournoi (T1/T2/T3) introuvable sur tournoi_ext — finalisation annulée pour éviter d\'écraser un autre tournoi.'
      });
    }
    const tournamentNumber = t.tournament_number;
    const season = appSettings.getCurrentSeason
      ? await appSettings.getCurrentSeason(t.debut ? new Date(t.debut) : new Date(), orgId)
      : (() => {
          // Fallback: rough September-cutoff if helper isn't available
          const d = t.debut ? new Date(t.debut) : new Date();
          const y = d.getFullYear();
          return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
        })();

    // ---- UPSERT tournaments row -------------------------------------------
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO tournaments (category_id, tournament_number, season, tournament_date, organization_id, location)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (category_id, tournament_number, season) DO UPDATE SET
           tournament_date = EXCLUDED.tournament_date,
           location = COALESCE(EXCLUDED.location, tournaments.location),
           import_date = CURRENT_TIMESTAMP`,
        [categoryId, tournamentNumber, season, t.debut || null, orgId, t.lieu || null],
        (err) => err ? reject(err) : resolve()
      );
    });
    const tournamentRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM tournaments WHERE category_id=$1 AND tournament_number=$2 AND season=$3`,
        [categoryId, tournamentNumber, season],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournamentRow) {
      return res.status(500).json({ error: 'Impossible de créer/retrouver le tournoi interne.' });
    }
    const tournamentId = tournamentRow.id;

    // ---- Wipe & re-insert tournament_results (idempotent) -----------------
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM tournament_results WHERE tournament_id=$1`, [tournamentId],
        (err) => err ? reject(err) : resolve());
    });

    // Ensure each player exists in `players` (CSV import does the same — DdJ
    // typically operates on already-known players, but we guard anyway).
    for (const stats of statsByLic.values()) {
      const parts = (stats.player_name || '').split(' ');
      const lastName = parts[0] || '';
      const firstName = parts.slice(1).join(' ') || '';
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO players (licence, first_name, last_name, club, is_active)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (licence) DO NOTHING`,
          [stats.licence, firstName, lastName, 'Club inconnu'],
          () => resolve() // non-blocking — duplicate is fine
        );
      });
    }

    // V 2.0.857 — For Quilles: compute LBIF position points per player and
    // override match_points with the LBIF value. The season ranking can then
    // sum cumulative LBIF points (25/20/15/11/8/5/3/1) across tournaments
    // exactly like LBIF règlement chap 1.1.1.G / 3.1.G. Without this,
    // tournament_results.match_points would hold the raw poule-match points
    // which don't reflect the tournament outcome at all.
    let lbifPtsByLic = new Map();
    if (tournamentIsQuilles) {
      try {
        const lbifList = await buildLbifClassement(db, orgId, tournoiId, { pouleCtx, bracketCtx });
        for (const row of (lbifList || [])) {
          const k = String(row.licence || '').replace(/\s+/g, '').toUpperCase();
          if (k) lbifPtsByLic.set(k, row.points || 0);
        }
      } catch (e) {
        console.warn('[/finalize] buildLbifClassement failed, falling back to raw match_points:', e.message);
      }
    }

    let inserted = 0;
    for (const stats of statsByLic.values()) {
      // V 2.0.798 — Sprint 2 D.5: for Quilles, store points_subis (cumulative
      // opponent score) and null out reprises/serie/moyenne which don't apply.
      // Carambole still computes moyenne = points / reprises as before.
      const moyenne = tournamentIsQuilles
        ? null
        : (stats.reprises > 0 ? (stats.points / stats.reprises) : 0);
      const reprisesValue = tournamentIsQuilles ? null : stats.reprises;
      const serieValue = tournamentIsQuilles ? null : stats.best_serie;
      const meilleurePartie = tournamentIsQuilles ? null : (stats.best_match_moyenne || null);
      const position = placeByLicence.get(stats.licence) || 0;
      // V 2.0.857 — Quilles: store LBIF position points as match_points so
      // the season ranking aggregates the correct cumulative total. Fall
      // back to raw match_points if buildLbifClassement couldn't resolve.
      const matchPointsForStore = tournamentIsQuilles
        ? (lbifPtsByLic.has(stats.licence) ? lbifPtsByLic.get(stats.licence) : stats.match_points)
        : stats.match_points;
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO tournament_results
             (tournament_id, licence, player_name, position, match_points,
              moyenne, serie, points, reprises, poule_rank, meilleure_partie,
              points_subis)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [tournamentId, stats.licence, stats.player_name, position,
            matchPointsForStore, moyenne, serieValue, stats.points,
            reprisesValue, stats.poule_rank, meilleurePartie,
            tournamentIsQuilles ? stats.points_subis : null],
          (err) => err ? reject(err) : resolve()
        );
      });
      inserted++;
    }

    // ---- Chain ranking recalculation --------------------------------------
    // V 2.0.554 — DO NOT call recalcPositions here. That helper sorts by
    // (match_points DESC, moyenne DESC) and overwrites the position field,
    // which destroys the FFB phase-weighted positions we JUST stored: a
    // bracket semifinalist who lost the petite finale (place 4) but has
    // higher PM/moyenne than a bracket semifinalist who won the petite
    // finale (place 3) would jump to place 3 because of the naive sort.
    // Concrete T1 Bande R2 case where this surfaced (27/04/2026): LEMONIER
    // went to consolante (place 5) but had higher MGP than STOLL (place 3
    // via bracket); recalcPositions promoted him to 3rd, breaking the
    // alignment with E2i. Bonuses + rankings recalcs after this point
    // already preserve existing positions when bracket data is detected.
    // V 2.0.860 — For Quilles, skip recalcBonuses (it'd add phantom +1
    // bonuses from the moyenne thresholds — since Quilles moyenne is 0,
    // every player would fall in the lowest tier) but DO run recalcRankings.
    // The standard rankings query does SUM(tr.match_points), and Quilles
    // stores LBIF points (25/20/15/...) as match_points (V 2.0.857), so the
    // season ranking aggregates the right thing. avg_moyenne / best_serie
    // come out 0/null for Quilles — harmless because the ORDER BY uses
    // total_match_points DESC as the primary key.
    if (tournamentIsQuilles) {
      await new Promise((resolve) => {
        recalcRankings(categoryId, season, () => resolve());
      });
      console.log('[/finalize] Quilles tournament — recalcRankings run, recalcBonuses skipped');
    } else {
      await new Promise((resolve) => {
        recalcBonuses(categoryId, season, orgId, () => {
          recalcRankings(categoryId, season, () => resolve());
        });
      });
    }

    // ---- Audit log --------------------------------------------------------
    try {
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO activity_logs
             (organization_id, action, action_type, entity_type, entity_id, user_id, details, source)
           VALUES ($1, 'ddj_finalize', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
          [orgId, tournamentId, req.user.userId || null,
            JSON.stringify({ tournoi_ext_id: tournoiId, players: inserted, season, category_id: categoryId })],
          () => resolve()
        );
      });
    } catch (_) { /* non-blocking */ }

    res.json({
      success: true,
      tournament_id: tournamentId,
      players_count: inserted,
      season,
      redirect_url: `tournament-results.html?id=${tournamentId}`
    });
  } catch (err) {
    console.error('[DdJ] /finalize error:', err);
    res.status(500).json({ error: 'Erreur lors de la finalisation : ' + (err.message || 'inconnue') });
  }
});

// ============================================================================
// DEV-ONLY: seed spread moyennes for a tournament's convoked players
// ============================================================================
//
// Purpose: unblock Step 2 (Génération des poules) testing on a demo CDB where
// the players were seeded without FFB classifications. Without moyennes, the
// serpentine fallback from V 2.0.448 lands on "insertion order" which doesn't
// let us visually verify the strong-vs-weak distribution across poules.
//
// Behavior: for the tournament :id, walk the convocation_poules list IN ORDER
// and assign each player a linearly-descending moyenne (e.g. 9 players →
// 2.50, 2.35, 2.20, ..., 1.30). UPSERT into player_ffb_classifications for
// the given game_mode + current season so `/api/players/ffb-moyennes` can
// consume it.
//
// Idempotent: re-running overwrites with the same values. Non-destructive on
// tournaments that already had moyennes — but it DOES overwrite, so only use
// on demo/test tournaments.
//
// Gate: admin-only + query-string secret. Delete this endpoint when demo
// seeding is no longer needed (tracked as "temporary" per CLAUDE.md pattern).
// ============================================================================
router.post('/dev/seed-moyennes/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  const secret = req.query.secret;

  // Soft-gate: require role=admin AND a secret. Not production-grade security
  // (the secret is shared), but sufficient to deter accidental hits.
  if (req.user.role !== 'admin' && !req.user.admin) {
    return res.status(403).json({ error: 'Réservé aux administrateurs' });
  }
  if (secret !== 'seed-demo-moyennes-2026') {
    return res.status(403).json({ error: 'Secret manquant ou invalide' });
  }
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    // Read the tournament + its mode + current season
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, nom, mode, categorie, debut
         FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }

    // Resolve the game_mode_id from the tournament's mode string.
    // Handles whitespace variants ("3 BANDES" vs "3BANDES") per the project rule.
    const gameMode = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, code FROM game_modes
         WHERE UPPER(REPLACE(code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
         LIMIT 1`,
        [tournament.mode],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!gameMode) {
      return res.status(400).json({ error: `Mode de jeu introuvable : ${tournament.mode}` });
    }

    // Determine the current season from the tournament date. Use the shared
    // helper so the seed writes to the same season the GET endpoint will read
    // (respects per-org season_start_month and current_season_override).
    const d = tournament.debut ? new Date(tournament.debut) : new Date();
    const season = await appSettings.getCurrentSeason(d, orgId);

    // Pull the convoked licences in the canonical DdJ order
    const convoked = await new Promise((resolve, reject) => {
      db.all(
        `SELECT licence, player_name
         FROM convocation_poules
         WHERE tournoi_id = $1
         ORDER BY player_order NULLS LAST, licence`,
        [tournoiId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });
    if (convoked.length === 0) {
      return res.status(404).json({ error: 'Aucun joueur convoqué pour ce tournoi' });
    }

    // Generate linearly-descending moyennes from 2.50 down to 1.00.
    // Clamped so even a single-player tournament still gets a sane value.
    const top = 2.50;
    const bottom = 1.00;
    const n = convoked.length;
    const step = n > 1 ? (top - bottom) / (n - 1) : 0;

    const seeded = [];
    for (let i = 0; i < n; i++) {
      const moyenne = Number((top - step * i).toFixed(3));
      const licence = convoked[i].licence;

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO player_ffb_classifications (licence, game_mode_id, season, moyenne_ffb, updated_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (licence, game_mode_id, season)
           DO UPDATE SET moyenne_ffb = EXCLUDED.moyenne_ffb, updated_at = CURRENT_TIMESTAMP`,
          [licence, gameMode.id, season, moyenne],
          (err) => err ? reject(err) : resolve()
        );
      });

      seeded.push({ licence, player_name: convoked[i].player_name, moyenne });
    }

    res.json({
      success: true,
      tournament: { id: tournoiId, nom: tournament.nom, mode: tournament.mode, season },
      game_mode: gameMode.code,
      seeded_count: seeded.length,
      seeded
    });
  } catch (err) {
    console.error('[DdJ dev/seed-moyennes] error:', err);
    res.status(500).json({ error: 'Erreur lors du seeding' });
  }
});

// ============================================================
// V 2.0.595 — DdJ V3 evolution endpoints (May 2026)
// ============================================================

// ----- DdJ session : table_count + DdJ identity -----
//
// One row per (tournoi_id) day. Stores the number of physical billiards
// available + the DdJ's name and FFB licence. Used by:
//   - the score pages (auto-display the DdJ name)
//   - the tables-status endpoint (knows how many tables to enumerate)
//   - the public TV feed
//
// Pre-fill behaviour: if the same user has previously run a DdJ session,
// GET returns last name/licence used so the DdJ doesn't re-type them.

router.get('/competitions/:id/ddj-session', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    // Verify the tournament belongs to caller's org
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });

    const session = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, table_count, table_numbers, ddj_user_id, ddj_name, ddj_licence,
                started_at, ended_at
           FROM ddj_session
          WHERE tournoi_id = $1`,
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    // Parse table_numbers JSON (legacy rows have it null → fall back to 1..N)
    if (session) {
      session.table_numbers = parseTableNumbers(session.table_numbers, session.table_count);
    }

    // If no session yet, propose pre-fill from this user's last session
    let prefill = null;
    if (!session) {
      prefill = await new Promise((resolve, reject) => {
        db.get(
          `SELECT ddj_name, ddj_licence, table_numbers
             FROM ddj_session
            WHERE ddj_user_id = $1
            ORDER BY started_at DESC
            LIMIT 1`,
          [req.user.userId],
          (err, row) => err ? reject(err) : resolve(row || null)
        );
      });
      if (prefill && prefill.table_numbers) {
        try { prefill.table_numbers = JSON.parse(prefill.table_numbers); } catch (_) { prefill.table_numbers = null; }
      }
    }

    res.json({ session: session || null, prefill });
  } catch (err) {
    console.error('[DdJ ddj-session GET] error:', err);
    res.status(500).json({ error: 'Erreur lors de la lecture de la session DdJ' });
  }
});

router.post('/competitions/:id/ddj-session', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  const b = req.body || {};
  const tableCount = parseInt(b.table_count, 10);
  const ddjName = (b.ddj_name || '').trim();
  const ddjLicence = (b.ddj_licence || '').trim() || null;

  if (!Number.isFinite(tableCount) || tableCount < 1 || tableCount > 20) {
    return res.status(400).json({ error: 'Nombre de tables invalide (1-20)' });
  }
  if (!ddjName) {
    return res.status(400).json({ error: 'Nom du Directeur de Jeu requis' });
  }

  // V 2.0.695 — Custom physical table numbers (e.g. [6,7,8,9] for clubs
  // whose tables aren't numbered 1..N). Optional — if missing, the back
  // end stores NULL and clients fall back to [1..tableCount].
  let tableNumbersJson = null;
  if (Array.isArray(b.table_numbers) && b.table_numbers.length > 0) {
    const ints = b.table_numbers.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n > 0 && n < 1000);
    if (ints.length !== tableCount) {
      return res.status(400).json({ error: 'Le nombre de numéros de tables doit correspondre au nombre de tables' });
    }
    // Reject duplicates — same table number twice doesn't make physical sense.
    if (new Set(ints).size !== ints.length) {
      return res.status(400).json({ error: 'Les numéros de tables doivent être uniques' });
    }
    tableNumbersJson = JSON.stringify(ints);
  }

  try {
    // Verify the tournament belongs to caller's org
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id FROM tournoi_ext
         WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });

    // UPSERT — 1 session per tournament. Re-saving updates table_count
    // and DdJ identity (can happen if the DdJ realises they got the
    // count wrong, or hands over to another DdJ mid-day).
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_session
           (tournoi_id, table_count, table_numbers, ddj_user_id, ddj_name, ddj_licence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tournoi_id) DO UPDATE SET
           table_count = EXCLUDED.table_count,
           table_numbers = EXCLUDED.table_numbers,
           ddj_user_id = EXCLUDED.ddj_user_id,
           ddj_name = EXCLUDED.ddj_name,
           ddj_licence = EXCLUDED.ddj_licence`,
        [tournoiId, tableCount, tableNumbersJson, req.user.userId || null, ddjName, ddjLicence],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({
      ok: true,
      table_count: tableCount,
      table_numbers: tableNumbersJson ? JSON.parse(tableNumbersJson) : parseTableNumbers(null, tableCount),
      ddj_name: ddjName,
      ddj_licence: ddjLicence
    });
  } catch (err) {
    console.error('[DdJ ddj-session POST] error:', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde de la session DdJ' });
  }
});

// ----- Tables status : computed on-the-fly from the 3 match tables -----
//
// Returns one entry per physical table (1..table_count from ddj_session),
// with status = 'busy' if a match is currently in progress on it,
// otherwise 'free'. Polled by the DdJ dashboard drawer (and the public
// TV feed).

router.get('/competitions/:id/tables-status', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) {
    return res.status(400).json({ error: 'ID tournoi invalide' });
  }

  try {
    // Org check + load table_count + table_numbers from session
    const session = await new Promise((resolve, reject) => {
      db.get(
        `SELECT s.table_count, s.table_numbers
           FROM ddj_session s
           JOIN tournoi_ext t ON t.tournoi_id = s.tournoi_id
          WHERE s.tournoi_id = $1
            AND ($2::int IS NULL OR t.organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!session) {
      return res.json({ table_count: 0, table_numbers: [], tables: [] });
    }
    const tableNumbers = parseTableNumbers(session.table_numbers, session.table_count);

    // Find all matches currently in progress (started, not finished)
    // across the 3 tables. Same shape for each, UNIONed.
    const inProgress = await new Promise((resolve, reject) => {
      db.all(
        `SELECT 'poule'      AS phase_kind, table_number, p1_licence, p2_licence,
                started_at, poule_number::text AS phase_label, match_number AS phase_index
           FROM ddj_poule_matches
          WHERE tournoi_id = $1 AND started_at IS NOT NULL AND finished_at IS NULL
            AND table_number IS NOT NULL
         UNION ALL
         SELECT 'bracket'    AS phase_kind, table_number, p1_licence, p2_licence,
                started_at, phase::text AS phase_label, NULL::int AS phase_index
           FROM ddj_bracket_matches
          WHERE tournoi_id = $1 AND started_at IS NOT NULL AND finished_at IS NULL
            AND table_number IS NOT NULL
         UNION ALL
         SELECT 'consolante' AS phase_kind, table_number, p1_licence, p2_licence,
                started_at, phase::text AS phase_label, NULL::int AS phase_index
           FROM ddj_consolante_matches
          WHERE tournoi_id = $1 AND started_at IS NOT NULL AND finished_at IS NULL
            AND table_number IS NOT NULL`,
        [tournoiId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // Index by table_number
    const byTable = new Map();
    for (const m of inProgress) byTable.set(m.table_number, m);

    // Iterate over the *actual* physical table numbers (e.g. [6,7,8,9]),
    // not 1..N — so the response order matches the DdJ's mental model.
    const tables = tableNumbers.map((n) => {
      const m = byTable.get(n);
      return {
        table_number: n,
        status: m ? 'busy' : 'free',
        match: m ? {
          phase_kind: m.phase_kind,
          phase_label: String(m.phase_label),
          p1_licence: m.p1_licence,
          p2_licence: m.p2_licence,
          started_at: m.started_at
        } : null
      };
    });

    res.json({ table_count: session.table_count, table_numbers: tableNumbers, tables });
  } catch (err) {
    console.error('[DdJ tables-status] error:', err);
    res.status(500).json({ error: 'Erreur lors du calcul du statut des tables' });
  }
});

// ----- Referee search : autocomplete over org's player base -----
//
// Used by the score-entry form. The DdJ types a name fragment or
// a licence prefix and we suggest matching players (limit 10).
// Selecting a suggestion fills both referee_name and referee_licence
// on the form.

router.get('/referees/search', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  try {
    // ILIKE on first_name, last_name (concatenated either order),
    // OR on licence prefix. Excludes test accounts.
    const pattern = `%${q}%`;
    const liccPattern = `${q.replace(/\s+/g, '')}%`;
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT licence, first_name, last_name, club
           FROM players
          WHERE ($1::int IS NULL OR organization_id = $1)
            AND is_active = 1
            AND UPPER(licence) NOT LIKE 'TEST%'
            AND (
                  (first_name || ' ' || last_name) ILIKE $2
               OR (last_name || ' ' || first_name) ILIKE $2
               OR REPLACE(licence, ' ', '') ILIKE $3
                )
          ORDER BY last_name, first_name
          LIMIT 10`,
        [orgId, pattern, liccPattern],
        (err, rs) => err ? reject(err) : resolve(rs || [])
      );
    });

    res.json({
      results: rows.map(r => ({
        licence: r.licence,
        name: `${r.first_name} ${r.last_name}`.trim(),
        club: r.club || null
      }))
    });
  } catch (err) {
    console.error('[DdJ referees/search] error:', err);
    res.status(500).json({ error: 'Erreur lors de la recherche d\'arbitres' });
  }
});

// ----- Match start endpoints (V3) -----
//
// Lightweight POST endpoints called by the front-end when the DdJ
// taps a match to open the scoring page. They create the underlying
// row with started_at=NOW(), p1/p2 licences and table_number set,
// but scores still NULL — making the match "in progress" so the
// table flips to "busy" on the dashboard.
//
// Idempotent: if the match was already started (or already finished),
// we just update the table_number and never overwrite an existing
// started_at.

// V 2.0.697 — Auto-assign physical tables to poules.
//
// After the DdJ has set up the session (table_count + table_numbers) and
// the poules have been generated (étape 2), the DdJ is offered an option
// to auto-assign tables: Poule A → table_numbers[0], Poule B → table_numbers[1],
// etc. This UPSERTs every match in every poule with just its table_number
// set (no scores, no started_at), so when the matchs page loads, every
// match already shows "Match 1 · Table 6".
//
// Idempotent: re-calling overwrites the assignment (useful if the DdJ
// changes the table count or rearranges poules later).
router.post('/competitions/:id/auto-assign-tables', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });

  try {
    // Load session to get the actual table numbers
    const session = await new Promise((resolve, reject) => {
      db.get(
        `SELECT s.table_count, s.table_numbers
           FROM ddj_session s
           JOIN tournoi_ext t ON t.tournoi_id = s.tournoi_id
          WHERE s.tournoi_id = $1
            AND ($2::int IS NULL OR t.organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    if (!session) return res.status(404).json({ error: 'Session DdJ introuvable — configurez d\'abord la journée.' });
    const tableNumbers = parseTableNumbers(session.table_numbers, session.table_count);

    // Reload the schedule via loadPouleMatches: it gives us the canonical
    // poule list + each match's player licences (via convocation_poules).
    const ctx = await loadPouleMatches(db, orgId, tournoiId);
    if (ctx.error) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (!ctx.poules || ctx.poules.length === 0) {
      return res.status(409).json({ error: 'Les poules ne sont pas encore générées.' });
    }

    // Cycle through table numbers if there are more poules than tables.
    let assigned = 0;
    for (let i = 0; i < ctx.poules.length; i++) {
      const poule = ctx.poules[i];
      const tableNum = tableNumbers[i % tableNumbers.length];
      for (const match of poule.matches || []) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO ddj_poule_matches
               (tournoi_id, poule_number, match_number, table_number,
                p1_licence, p2_licence)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tournoi_id, poule_number, match_number)
             DO UPDATE SET
               table_number = EXCLUDED.table_number`,
            [tournoiId, poule.number, match.match_number, tableNum,
             match.p1_licence, match.p2_licence],
            (err) => err ? reject(err) : resolve()
          );
        });
        assigned++;
      }
    }

    res.json({ ok: true, assigned, table_numbers: tableNumbers });
  } catch (err) {
    console.error('[DdJ auto-assign-tables] error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'allocation automatique' });
  }
});

router.post('/competitions/:id/poule-matches/start', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });

  const b = req.body || {};
  const pn = parseInt(b.poule_number, 10);
  const mn = parseInt(b.match_number, 10);
  const tableNumber = b.table_number != null && b.table_number !== ''
    ? parseInt(b.table_number, 10) || null
    : null;
  if (!Number.isFinite(pn) || !Number.isFinite(mn)) {
    return res.status(400).json({ error: 'poule_number et match_number requis' });
  }

  try {
    const ctx = await loadPouleMatches(db, orgId, tournoiId);
    if (ctx.error) return res.status(404).json({ error: 'Tournoi introuvable' });
    const poule = ctx.poules.find(p => p.number === pn);
    if (!poule) return res.status(400).json({ error: 'Poule inconnue' });
    const match = poule.matches.find(m => m.match_number === mn);
    if (!match) return res.status(400).json({ error: 'Match inconnu' });

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_poule_matches
           (tournoi_id, poule_number, match_number, table_number,
            p1_licence, p2_licence, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT (tournoi_id, poule_number, match_number)
         DO UPDATE SET
           table_number = COALESCE(EXCLUDED.table_number, ddj_poule_matches.table_number),
           started_at = COALESCE(ddj_poule_matches.started_at, CURRENT_TIMESTAMP)`,
        [tournoiId, pn, mn, tableNumber, match.p1_licence, match.p2_licence],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DdJ poule-matches/start] error:', err);
    res.status(500).json({ error: 'Erreur lors du démarrage du match' });
  }
});

// POST /api/directeur-jeu/competitions/:id/poule-matches/cancel
// Resets a started-but-unfinished poule match back to "À jouer" (clears started_at).
// Safe: only acts when scores have not been entered yet.
router.post('/competitions/:id/poule-matches/cancel', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });

  const b = req.body || {};
  const pn = parseInt(b.poule_number, 10);
  const mn = parseInt(b.match_number, 10);
  if (!Number.isFinite(pn) || !Number.isFinite(mn)) {
    return res.status(400).json({ error: 'poule_number et match_number requis' });
  }

  try {
    // Only cancel if the match is started but NOT finished (no scores)
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE ddj_poule_matches
         -- V 2.0.829 — clear finished_at too so a stray
         -- "marked finished without scores" row is fully reset
         -- when the DdJ cancels the start.
         SET started_at = NULL,
             finished_at = NULL
         WHERE tournoi_id = $1
           AND poule_number = $2
           AND match_number = $3
           AND started_at IS NOT NULL
           AND (p1_points IS NULL AND p2_points IS NULL)`,
        [tournoiId, pn, mn],
        function (err) { err ? reject(err) : resolve(this); }
      );
    });
    if (result.changes === 0) {
      return res.status(400).json({
        error: 'Match introuvable, non démarré, ou déjà avec des scores'
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[DdJ poule-matches/cancel] error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'annulation du démarrage' });
  }
});

router.post('/competitions/:id/bracket/start', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });

  const b = req.body || {};
  const phase = String(b.phase || '').toUpperCase();
  // V 2.0.830 — Sprint 2 LBIF Phase 5: phase whitelist extended to cover
  // Quilles brackets (QF1-4, EIGHTH1-8). Carambole phases still accepted.
  if (!/^(EIGHTH[1-8]|QF[1-4]|SF[12]|F|PF)$/.test(phase)) {
    return res.status(400).json({ error: 'Phase invalide' });
  }
  const tableNumber = b.table_number != null && b.table_number !== ''
    ? parseInt(b.table_number, 10) || null
    : null;

  try {
    const ctx = await loadBracket(db, orgId, tournoiId);
    if (ctx.error === 'not_found') return res.status(404).json({ error: 'Tournoi introuvable' });
    const match = ctx.phases && ctx.phases.find(p => p.phase === phase);
    if (!match || !match.can_enter) return res.status(409).json({ error: 'Match pas encore prêt' });

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_bracket_matches
           (tournoi_id, phase, table_number, p1_licence, p2_licence, started_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (tournoi_id, phase)
         DO UPDATE SET
           table_number = COALESCE(EXCLUDED.table_number, ddj_bracket_matches.table_number),
           started_at = COALESCE(ddj_bracket_matches.started_at, CURRENT_TIMESTAMP)`,
        [tournoiId, phase, tableNumber, match.p1.licence, match.p2.licence],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DdJ bracket/start] error:', err);
    res.status(500).json({ error: 'Erreur lors du démarrage du match' });
  }
});

router.post('/competitions/:id/consolante/start', authenticateToken, requireDdJ, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;
  const tournoiId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tournoiId)) return res.status(400).json({ error: 'ID tournoi invalide' });

  const b = req.body || {};
  const phase = String(b.phase || '').toUpperCase();
  const tableNumber = b.table_number != null && b.table_number !== ''
    ? parseInt(b.table_number, 10) || null
    : null;

  try {
    const ctx = await loadConsolante(db, orgId, tournoiId);
    if (ctx.error === 'not_found') return res.status(404).json({ error: 'Tournoi introuvable' });
    const match = ctx.phases && ctx.phases.find(p => p.phase === phase);
    if (!match || !match.can_enter) return res.status(409).json({ error: 'Match pas encore prêt' });

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_consolante_matches
           (tournoi_id, phase, table_number, p1_licence, p2_licence, started_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (tournoi_id, phase)
         DO UPDATE SET
           table_number = COALESCE(EXCLUDED.table_number, ddj_consolante_matches.table_number),
           started_at = COALESCE(ddj_consolante_matches.started_at, CURRENT_TIMESTAMP)`,
        [tournoiId, phase, tableNumber, match.p1.licence, match.p2.licence],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DdJ consolante/start] error:', err);
    res.status(500).json({ error: 'Erreur lors du démarrage du match' });
  }
});

// ============================================================================
// V 2.0.713 — Admin-only: wipe ALL scores for a tournament
// ============================================================================
//
// Useful in dev / re-test scenarios: an admin can reset a tournament to
// "poules already generated, no scores yet" without manual SQL. Deletes
// every row in the 4 ddj_*_matches tables for the tournoi, and any seed
// override. Keeps:
//   - ddj_session       (day config: tables, DdJ name, etc.)
//   - convocation_poules (poule lineup — admin can still re-seed if wanted)
//
// Strict admin-only (requireAdmin); the frontend hides the trigger
// button for non-admins, and the middleware enforces it server-side.
// ============================================================================
router.post('/competitions/:id/reset-all-scores',
  authenticateToken, requireAdmin, async (req, res) => {
    const db = getDb();
    const orgId = req.user.organizationId || null;
    const tournoiId = parseInt(req.params.id, 10);
    if (!Number.isFinite(tournoiId)) {
      return res.status(400).json({ error: 'ID tournoi invalide' });
    }

    try {
      // Org check — make sure the admin can only reset tournois in their CDB
      const t = await new Promise((resolve, reject) => {
        db.get(
          `SELECT tournoi_id FROM tournoi_ext
            WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
          [tournoiId, orgId],
          (err, row) => err ? reject(err) : resolve(row)
        );
      });
      if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });

      // Wipe in dependency order. seed_overrides reference bracket structure;
      // bracket / consolante reference players from poules; poule_matches
      // are independent. All scoped to tournoi_id — no cascading deletes
      // beyond this competition.
      const tables = [
        'ddj_bracket_seed_overrides',
        'ddj_consolante_matches',
        'ddj_bracket_matches',
        'ddj_poule_matches'
      ];
      for (const tbl of tables) {
        await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM ${tbl} WHERE tournoi_id = $1`,
            [tournoiId],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      // Audit trail — admin actions of this magnitude must be logged.
      try {
        await new Promise((resolve) => {
          db.run(
            `INSERT INTO activity_logs
               (user_name, action_type, action_status, target_type, target_id, target_name, details, app_source)
             VALUES ($1, 'ddj_scores_wiped', 'success', 'tournament', $2, $3, $4, 'directeur_jeu')`,
            [
              req.user.username || 'admin',
              tournoiId,
              `Tournoi ${tournoiId}`,
              JSON.stringify({ wiped_tables: tables })
            ],
            () => resolve()
          );
        });
      } catch (e) { /* non-fatal */ }

      res.json({ ok: true, message: 'Tous les scores ont été effacés.' });
    } catch (err) {
      console.error('[DdJ reset-all-scores] error:', err);
      res.status(500).json({ error: 'Erreur lors de la suppression des scores' });
    }
  }
);

module.exports = router;
// V 2.0.704 — expose loaders for the public TV feed (dj-public.js).
// They accept orgId=null to skip the org filter (the public route does
// its own org check via tournoi_ext).
module.exports.loadPouleMatches = loadPouleMatches;
module.exports.loadBracket = loadBracket;
module.exports.loadConsolante = loadConsolante;
// V 2.0.826 — exposed to dj-public feed so the TV can show barrage matches
module.exports.loadBarrage = loadBarrage;
