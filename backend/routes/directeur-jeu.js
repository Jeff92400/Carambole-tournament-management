const express = require('express');
const router = express.Router();
const { authenticateToken, requireDdJ } = require('./auth');
const appSettings = require('../utils/app-settings');
const { getPouleConfigForOrg } = require('../utils/poule-config');
const getDb = () => require('../db-loader');

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
        // Moyenne exposed as moyenne_generale (legacy field name the front-
        // end already renders). Actual value comes from the
        // player_ffb_classifications table, joined on (licence, mode, season).
        // Null when this player has no FFB classification for this mode+season
        // yet — front end renders "—" via formatMoyenne().
        moyenne_generale: p.moyenne_ffb,
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
  const tournament = await new Promise((resolve, reject) => {
    db.get(
      `SELECT tournoi_id, nom, mode, categorie, debut
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
         -- Exclude forfaits (statut='forfait' OR forfait=1). COALESCE so
         -- players with no inscription row (rare) default to "present".
         AND COALESCE(i.statut, 'inscrit') != 'forfait'
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

    // Compute poule sizes using the org's allow_poule_of_2 setting
    const pouleConfig = await getPouleConfigForOrg(sorted.length, orgId);
    if (!pouleConfig.poules || pouleConfig.poules.length === 0) {
      return res.status(400).json({
        error: `Pas assez de joueurs présents (${sorted.length} / min ${pouleConfig.minPlayers})`
      });
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
  const { poules } = req.body || {};

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
    const snapshotRows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT REPLACE(licence, ' ', '') AS lic_norm,
                location_name, location_address, start_time
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
          db.run(
            `INSERT INTO convocation_poules
               (tournoi_id, poule_number, licence, player_name, club,
                location_name, location_address, start_time, player_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              tournoiId,
              pouleNumber,
              rawLicence,
              displayName,
              pl.club || null,
              snap.location_name || null,
              snap.location_address || null,
              snap.start_time || null,
              idx + 1
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
        totalInserted++;
      }
    }

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
      players_count: totalInserted
    });
  } catch (err) {
    console.error('[DdJ] /poules PUT error:', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des poules' });
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

module.exports = router;
