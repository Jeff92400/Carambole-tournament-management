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
 * into the poule's player order. Simple lexicographic order — fine for
 * poules of 2-5 (which is the realistic range for a CDB competition).
 */
function roundRobinSchedule(numPlayers) {
  const out = [];
  let m = 1;
  for (let i = 1; i <= numPlayers; i++) {
    for (let j = i + 1; j <= numPlayers; j++) {
      out.push({ match_number: m++, p1_idx: i, p2_idx: j });
    }
  }
  return out;
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
  const tournament = await new Promise((resolve, reject) => {
    db.get(
      `SELECT tournoi_id, nom, mode, categorie, debut, lieu
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

  // Load poule composition ordered canonically
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
       ORDER BY cp.poule_number, cp.player_order NULLS LAST, cp.licence`,
      [tournoiId, orgId],
      (err, rs) => err ? reject(err) : resolve(rs || [])
    );
  });

  // Saved matches (may be empty if DdJ hasn't entered anything yet)
  const savedRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, poule_number, match_number, table_number,
              p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie,
              p2_points, p2_reprises, p2_serie,
              entered_at
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
    const schedule = roundRobinSchedule(playersArr.length);
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
        p2_points: saved ? saved.p2_points : null,
        p2_reprises: saved ? saved.p2_reprises : null,
        p2_serie: saved ? saved.p2_serie : null,
        entered_at: saved ? saved.entered_at : null,
        is_played: saved && saved.p1_points != null && saved.p2_points != null
      };
      // Convenience: derive match points + outcome for UI
      const mp = computeMatchPoints(m.p1_points, m.p2_points, settings);
      m.p1_match_points = mp ? mp.p1_mp : null;
      m.p2_match_points = mp ? mp.p2_mp : null;
      m.outcome = mp ? mp.outcome : null;
      return m;
    });

    const classement = buildPouleClassement(playersArr, matches, settings);

    poules.push({
      number: pn,
      size: playersArr.length,
      players: playersArr,
      matches,
      classement,
      all_matches_played: matches.every(m => m.is_played),
      ties_exist: classement.some(c => c.has_tie_below)
    });
  }

  return { tournament, poules, settings, game_params: gameParams };
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
  const scoreFields = ['p1_points', 'p1_reprises', 'p1_serie', 'p2_points', 'p2_reprises', 'p2_serie'];
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

    // UPSERT the match
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_poule_matches
           (tournoi_id, poule_number, match_number, table_number,
            p1_licence, p2_licence,
            p1_points, p1_reprises, p1_serie,
            p2_points, p2_reprises, p2_serie,
            entered_at, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, $13)
         ON CONFLICT (tournoi_id, poule_number, match_number)
         DO UPDATE SET
           table_number = EXCLUDED.table_number,
           p1_points = EXCLUDED.p1_points,
           p1_reprises = EXCLUDED.p1_reprises,
           p1_serie = EXCLUDED.p1_serie,
           p2_points = EXCLUDED.p2_points,
           p2_reprises = EXCLUDED.p2_reprises,
           p2_serie = EXCLUDED.p2_serie,
           entered_at = CURRENT_TIMESTAMP,
           entered_by = EXCLUDED.entered_by`,
        [
          tournoiId, pn, mn, tableNumber,
          match.p1_licence, match.p2_licence,
          parsed.p1_points, parsed.p1_reprises, parsed.p1_serie,
          parsed.p2_points, parsed.p2_reprises, parsed.p2_serie,
          req.user.userId || null
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
  pool.sort((a, b) => {
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

  const allPoulesPlayed = ctx.poules.every(p => p.all_matches_played);
  const { qualifiers, non_qualifiers } = computeBracketSeeding(ctx.poules, BRACKET_SIZE);

  // Fetch any saved bracket match rows
  const savedRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, phase, table_number, p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie,
              p2_points, p2_reprises, p2_serie,
              entered_at
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
      p2_points: saved ? saved.p2_points : null,
      p2_reprises: saved ? saved.p2_reprises : null,
      p2_serie: saved ? saved.p2_serie : null,
      is_played: !!(saved && saved.p1_points != null && saved.p2_points != null),
      entered_at: saved ? saved.entered_at : null
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

  return {
    tournament: ctx.tournament,
    game_params: ctx.game_params,
    settings: ctx.settings,
    bracket_size: BRACKET_SIZE,
    can_start: canStart,
    qualifiers,
    non_qualifiers,
    phases,
    final_places: finalPlaces
  };
}

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
  if (!['SF1', 'SF2', 'F', 'PF'].includes(phase)) {
    return res.status(400).json({ error: 'Phase invalide' });
  }

  const scoreFields = ['p1_points', 'p1_reprises', 'p1_serie', 'p2_points', 'p2_reprises', 'p2_serie'];
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

    // UPSERT
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_bracket_matches
           (tournoi_id, phase, table_number,
            p1_licence, p2_licence,
            p1_points, p1_reprises, p1_serie,
            p2_points, p2_reprises, p2_serie,
            entered_at, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, $12)
         ON CONFLICT (tournoi_id, phase)
         DO UPDATE SET
           table_number = EXCLUDED.table_number,
           p1_licence = EXCLUDED.p1_licence,
           p2_licence = EXCLUDED.p2_licence,
           p1_points = EXCLUDED.p1_points,
           p1_reprises = EXCLUDED.p1_reprises,
           p1_serie = EXCLUDED.p1_serie,
           p2_points = EXCLUDED.p2_points,
           p2_reprises = EXCLUDED.p2_reprises,
           p2_serie = EXCLUDED.p2_serie,
           entered_at = CURRENT_TIMESTAMP,
           entered_by = EXCLUDED.entered_by`,
        [
          tournoiId, phase, tableNumber,
          match.p1.licence, match.p2.licence,
          parsed.p1_points, parsed.p1_reprises, parsed.p1_serie,
          parsed.p2_points, parsed.p2_reprises, parsed.p2_serie,
          req.user.userId || null
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

  const non_qualifiers = bracketCtx.non_qualifiers || [];
  const { size, round1Pairs } = computeConsolanteSeeding(non_qualifiers);
  const canStart = !!bracketCtx.can_start && size >= 2;

  // Fetch saved rows
  const savedRows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, phase, table_number, p1_licence, p2_licence,
              p1_points, p1_reprises, p1_serie,
              p2_points, p2_reprises, p2_serie, entered_at
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
      p2_points: saved ? saved.p2_points : null,
      p2_reprises: saved ? saved.p2_reprises : null,
      p2_serie: saved ? saved.p2_serie : null,
      is_played: !!(saved && saved.p1_points != null && saved.p2_points != null),
      entered_at: saved ? saved.entered_at : null,
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
      phases.push(ph);
      phaseMap.set(phaseName, ph);
      nextRound.push(phaseName);
    }
    prevRound = nextRound;
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
  const {
    phase, table_number,
    p1_points, p1_reprises, p1_serie,
    p2_points, p2_reprises, p2_serie
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

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ddj_consolante_matches
           (tournoi_id, phase, table_number, p1_licence, p2_licence,
            p1_points, p1_reprises, p1_serie,
            p2_points, p2_reprises, p2_serie,
            entered_at, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, $12)
         ON CONFLICT (tournoi_id, phase) DO UPDATE SET
           table_number = EXCLUDED.table_number,
           p1_licence   = EXCLUDED.p1_licence,
           p2_licence   = EXCLUDED.p2_licence,
           p1_points    = EXCLUDED.p1_points,
           p1_reprises  = EXCLUDED.p1_reprises,
           p1_serie     = EXCLUDED.p1_serie,
           p2_points    = EXCLUDED.p2_points,
           p2_reprises  = EXCLUDED.p2_reprises,
           p2_serie     = EXCLUDED.p2_serie,
           entered_at   = CURRENT_TIMESTAMP,
           entered_by   = EXCLUDED.entered_by`,
        [
          tournoiId, phase, table_number || null,
          target.p1.licence, target.p2.licence,
          p1_points ?? null, p1_reprises ?? null, p1_serie ?? null,
          p2_points ?? null, p2_reprises ?? null, p2_serie ?? null,
          req.user.userId || null
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
