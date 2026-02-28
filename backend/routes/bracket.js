/**
 * bracket.js — Bracket & classification engine for Journées Qualificatives
 *
 * Competition day flow:
 *   Poules (morning) → Top bracket SF/F/PF → Classification matches → Final positions
 *
 * Endpoints:
 *   GET  /:tournamentId           — Get bracket state (all matches)
 *   POST /:tournamentId/generate  — Generate bracket + classification from poule results
 *   PUT  /:tournamentId/match/:matchId — Save individual match result
 *   POST /:tournamentId/finalize  — Compute final positions, assign position_points
 */

const express = require('express');
const router = express.Router();
const db = require('../db-loader');
const { authenticateToken } = require('./auth');
const appSettings = require('../utils/app-settings');

// Shared functions from tournaments.js
const tournamentsRouter = require('./tournaments');
const { recomputeAllBonuses, recalculateRankings, getPositionPointsLookup } = tournamentsRouter;

// ── DB helpers ──────────────────────────────────────────────
function dbAllAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
function dbGetAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbRunAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}

// ── Phases ──────────────────────────────────────────────────
const PHASE = { SF: 'SF', F: 'F', PF: 'PF', CL1: 'CL1', CL2: 'CL2' };

// ============================================================
// GET /:tournamentId — Get bracket state
// ============================================================
router.get('/:tournamentId', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    const tournament = await dbGetAsync(
      'SELECT id, category_id, season, tournament_number FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) return res.status(404).json({ error: 'Tournoi non trouvé' });

    const matches = await dbAllAsync(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY phase, match_order',
      [tournamentId]
    );

    // Get poule results for context
    const results = await dbAllAsync(
      `SELECT licence, player_name, match_points, points, reprises, serie, position, poule_rank
       FROM tournament_results WHERE tournament_id = $1
       ORDER BY match_points DESC,
         CASE WHEN reprises > 0 THEN CAST(points AS REAL) / reprises ELSE 0 END DESC,
         serie DESC`,
      [tournamentId]
    );

    const bracketSize = parseInt(await appSettings.getOrgSetting(orgId, 'bracket_size')) || 4;
    const singlePouleThreshold = parseInt(await appSettings.getOrgSetting(orgId, 'single_poule_threshold')) || 6;

    res.json({
      tournament,
      matches,
      results,
      settings: { bracketSize, singlePouleThreshold },
      mode: results.length < singlePouleThreshold ? 'single_poule' : 'bracket',
    });
  } catch (error) {
    console.error('[BRACKET] Error getting bracket:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /:tournamentId/generate — Generate bracket + classification
// ============================================================
router.post('/:tournamentId/generate', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    // Validate tournament
    const tournament = await dbGetAsync(
      'SELECT id, category_id, season, tournament_number FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) return res.status(404).json({ error: 'Tournoi non trouvé' });

    // Check journées mode
    const qualMode = await appSettings.getOrgSetting(orgId, 'qualification_mode');
    if (qualMode !== 'journees') {
      return res.status(400).json({ error: 'Mode de qualification non compatible (standard)' });
    }

    // Settings
    const bracketSize = parseInt(await appSettings.getOrgSetting(orgId, 'bracket_size')) || 4;
    const singlePouleThreshold = parseInt(await appSettings.getOrgSetting(orgId, 'single_poule_threshold')) || 6;
    const classementR2 = (await appSettings.getOrgSetting(orgId, 'classement_round_2')) !== 'false';

    // Get poule results ranked by tiebreaker: match_points DESC, moyenne DESC, serie DESC
    const results = await dbAllAsync(
      `SELECT licence, player_name, match_points, points, reprises, serie
       FROM tournament_results WHERE tournament_id = $1
       ORDER BY match_points DESC,
         CASE WHEN reprises > 0 THEN CAST(points AS REAL) / reprises ELSE 0 END DESC,
         serie DESC`,
      [tournamentId]
    );

    if (results.length === 0) {
      return res.status(400).json({ error: 'Aucun résultat de poule pour ce tournoi' });
    }

    const playerCount = results.length;

    // Single poule: no bracket needed — positions come directly from poule ranking
    if (playerCount < singlePouleThreshold) {
      // Just assign positions from poule ranking
      for (let i = 0; i < results.length; i++) {
        await dbRunAsync(
          'UPDATE tournament_results SET position = $1 WHERE tournament_id = $2 AND REPLACE(licence, \' \', \'\') = REPLACE($3, \' \', \'\')',
          [i + 1, tournamentId, results[i].licence]
        );
      }
      return res.json({
        mode: 'single_poule',
        playerCount,
        message: `Moins de ${singlePouleThreshold} joueurs — poule unique, positions assignées directement`,
        positions: results.map((r, i) => ({ position: i + 1, licence: r.licence, playerName: r.player_name })),
      });
    }

    // ── Build bracket matches ──────────────────────────────
    // Delete existing bracket matches for this tournament
    await dbRunAsync('DELETE FROM bracket_matches WHERE tournament_id = $1', [tournamentId]);

    const qualified = results.slice(0, bracketSize);
    const nonQualified = results.slice(bracketSize);
    const insertedMatches = [];

    // Semi-finals: 1st vs last-qualified, 2nd vs 3rd
    const sfPairs = [];
    if (bracketSize >= 4) {
      sfPairs.push([0, 3]); // SF1: seed 1 vs seed 4
      sfPairs.push([1, 2]); // SF2: seed 2 vs seed 3
    } else if (bracketSize >= 2) {
      sfPairs.push([0, 1]); // SF1: seed 1 vs seed 2
    }

    for (let i = 0; i < sfPairs.length; i++) {
      const [idx1, idx2] = sfPairs[i];
      const result = await dbRunAsync(
        `INSERT INTO bracket_matches (tournament_id, phase, match_order, match_label,
          player1_licence, player1_name, player2_licence, player2_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tournamentId, PHASE.SF, i + 1, `Demi-finale ${i + 1}`,
          qualified[idx1].licence, qualified[idx1].player_name,
          qualified[idx2].licence, qualified[idx2].player_name]
      );
      insertedMatches.push({ id: result.lastID, phase: PHASE.SF, matchOrder: i + 1 });
    }

    // Finale (players TBD — filled when SF results are in)
    const fResult = await dbRunAsync(
      `INSERT INTO bracket_matches (tournament_id, phase, match_order, match_label,
        player1_licence, player1_name, player2_licence, player2_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tournamentId, PHASE.F, 1, 'Finale', '', 'Vainqueur DF1', '', 'Vainqueur DF2']
    );
    insertedMatches.push({ id: fResult.lastID, phase: PHASE.F, matchOrder: 1 });

    // Petite Finale (players TBD)
    if (bracketSize >= 4) {
      const pfResult = await dbRunAsync(
        `INSERT INTO bracket_matches (tournament_id, phase, match_order, match_label,
          player1_licence, player1_name, player2_licence, player2_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tournamentId, PHASE.PF, 1, 'Petite Finale', '', 'Perdant DF1', '', 'Perdant DF2']
      );
      insertedMatches.push({ id: pfResult.lastID, phase: PHASE.PF, matchOrder: 1 });
    }

    // ── Classification matches (R1) ────────────────────────
    // Non-qualified players paired bottom-up for adjacent positions
    // Example: 7 non-qualified → pairs: (last vs second-to-last), etc.
    // Each match determines two adjacent positions
    const nq = nonQualified.length;
    const clMatches = [];
    let matchNum = 0;

    // Pair from bottom: worst vs next-worst
    for (let i = nq - 1; i >= 1; i -= 2) {
      matchNum++;
      const posHigh = bracketSize + (nq - i);     // higher position (better)
      const posLow = bracketSize + (nq - i) + 1;  // lower position (worse)

      const result = await dbRunAsync(
        `INSERT INTO bracket_matches (tournament_id, phase, match_order, match_label,
          player1_licence, player1_name, player2_licence, player2_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tournamentId, PHASE.CL1, matchNum,
          `Classement pour ${posHigh}e-${posLow}e place`,
          nonQualified[i].licence, nonQualified[i].player_name,
          nonQualified[i - 1].licence, nonQualified[i - 1].player_name]
      );
      clMatches.push({
        id: result.lastID, phase: PHASE.CL1, matchOrder: matchNum,
        posHigh, posLow,
      });
    }

    // If odd number of non-qualified, first player gets a bye (highest classification position)
    let byePlayer = null;
    if (nq % 2 === 1) {
      byePlayer = {
        licence: nonQualified[0].licence,
        playerName: nonQualified[0].player_name,
        position: bracketSize + 1,
      };
    }

    // ── Classification R2 (optional) ───────────────────────
    // R2 pairs losers from adjacent R1 matches for further refinement
    // Generated after R1 results are in — just note the setting
    const hasR2 = classementR2 && clMatches.length >= 2;

    // Fetch all generated matches
    const allMatches = await dbAllAsync(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY phase, match_order',
      [tournamentId]
    );

    console.log(`[BRACKET] Generated bracket for tournament ${tournamentId}: ${allMatches.length} matches, ${playerCount} players (${bracketSize} in bracket, ${nq} in classification${byePlayer ? ', 1 bye' : ''})`);

    res.json({
      mode: 'bracket',
      playerCount,
      bracketSize,
      matches: allMatches,
      qualified: qualified.map((r, i) => ({
        seed: i + 1, licence: r.licence, playerName: r.player_name,
        matchPoints: r.match_points,
        moyenne: r.reprises > 0 ? Math.round((r.points / r.reprises) * 1000) / 1000 : 0,
      })),
      byePlayer,
      hasR2,
    });

  } catch (error) {
    console.error('[BRACKET] Error generating bracket:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PUT /:tournamentId/match/:matchId — Save match result
// ============================================================
router.put('/:tournamentId/match/:matchId', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const matchId = parseInt(req.params.matchId);
    const orgId = req.user.organizationId || null;

    // Validate tournament
    const tournament = await dbGetAsync(
      'SELECT id, category_id, season FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) return res.status(404).json({ error: 'Tournoi non trouvé' });

    // Get the match
    const match = await dbGetAsync(
      'SELECT * FROM bracket_matches WHERE id = $1 AND tournament_id = $2',
      [matchId, tournamentId]
    );
    if (!match) return res.status(404).json({ error: 'Match non trouvé' });

    const { player1_points, player1_reprises, player2_points, player2_reprises, winner } = req.body;

    // Determine winner licence
    let winnerLicence;
    if (winner) {
      winnerLicence = winner;
    } else {
      // Auto-determine from points (higher points wins in billiard)
      winnerLicence = (player1_points || 0) >= (player2_points || 0)
        ? match.player1_licence
        : match.player2_licence;
    }

    // Update match
    await dbRunAsync(
      `UPDATE bracket_matches SET
        player1_points = $1, player1_reprises = $2,
        player2_points = $3, player2_reprises = $4,
        winner_licence = $5
       WHERE id = $6`,
      [player1_points || 0, player1_reprises || 0,
        player2_points || 0, player2_reprises || 0,
        winnerLicence, matchId]
    );

    // If this was a semi-final, check if both SFs are done → populate F and PF
    if (match.phase === PHASE.SF) {
      await populateFinalsIfReady(tournamentId);
    }

    // If this was a CL1 match and R2 is enabled, check if all CL1 done → generate CL2
    if (match.phase === PHASE.CL1) {
      await generateCL2IfReady(tournamentId, orgId);
    }

    const updatedMatch = await dbGetAsync('SELECT * FROM bracket_matches WHERE id = $1', [matchId]);
    res.json(updatedMatch);

  } catch (error) {
    console.error('[BRACKET] Error saving match result:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * After both semi-finals have results, fill in the Finale and Petite Finale players.
 */
async function populateFinalsIfReady(tournamentId) {
  const sfs = await dbAllAsync(
    'SELECT * FROM bracket_matches WHERE tournament_id = $1 AND phase = $2 ORDER BY match_order',
    [tournamentId, PHASE.SF]
  );

  // Need all SFs to have winners
  if (sfs.some(sf => !sf.winner_licence)) return;

  const sf1 = sfs[0];
  const sf2 = sfs[1];
  if (!sf1 || !sf2) return;

  const sf1Winner = sf1.winner_licence;
  const sf1Loser = sf1.winner_licence === sf1.player1_licence ? sf1.player2_licence : sf1.player1_licence;
  const sf1WinnerName = sf1.winner_licence === sf1.player1_licence ? sf1.player1_name : sf1.player2_name;
  const sf1LoserName = sf1.winner_licence === sf1.player1_licence ? sf1.player2_name : sf1.player1_name;

  const sf2Winner = sf2.winner_licence;
  const sf2Loser = sf2.winner_licence === sf2.player1_licence ? sf2.player2_licence : sf2.player1_licence;
  const sf2WinnerName = sf2.winner_licence === sf2.player1_licence ? sf2.player1_name : sf2.player2_name;
  const sf2LoserName = sf2.winner_licence === sf2.player1_licence ? sf2.player2_name : sf2.player1_name;

  // Finale: SF1 winner vs SF2 winner
  await dbRunAsync(
    `UPDATE bracket_matches SET
      player1_licence = $1, player1_name = $2,
      player2_licence = $3, player2_name = $4
     WHERE tournament_id = $5 AND phase = $6`,
    [sf1Winner, sf1WinnerName, sf2Winner, sf2WinnerName, tournamentId, PHASE.F]
  );

  // Petite Finale: SF1 loser vs SF2 loser
  await dbRunAsync(
    `UPDATE bracket_matches SET
      player1_licence = $1, player1_name = $2,
      player2_licence = $3, player2_name = $4
     WHERE tournament_id = $5 AND phase = $6`,
    [sf1Loser, sf1LoserName, sf2Loser, sf2LoserName, tournamentId, PHASE.PF]
  );

  console.log(`[BRACKET] Populated Finale and Petite Finale for tournament ${tournamentId}`);
}

/**
 * After all CL1 matches have results, generate CL2 matches if enabled.
 * CL2 pairs losers from adjacent CL1 matches.
 */
async function generateCL2IfReady(tournamentId, orgId) {
  const classementR2 = (await appSettings.getOrgSetting(orgId, 'classement_round_2')) !== 'false';
  if (!classementR2) return;

  const cl1Matches = await dbAllAsync(
    'SELECT * FROM bracket_matches WHERE tournament_id = $1 AND phase = $2 ORDER BY match_order',
    [tournamentId, PHASE.CL1]
  );

  // All CL1 must have results
  if (cl1Matches.some(m => !m.winner_licence)) return;

  // Check if CL2 already generated
  const existingCL2 = await dbGetAsync(
    'SELECT 1 FROM bracket_matches WHERE tournament_id = $1 AND phase = $2 LIMIT 1',
    [tournamentId, PHASE.CL2]
  );
  if (existingCL2) return;

  // Pair losers from adjacent CL1 matches
  const losers = cl1Matches.map(m => {
    const isP1Winner = m.winner_licence === m.player1_licence;
    return {
      licence: isP1Winner ? m.player2_licence : m.player1_licence,
      name: isP1Winner ? m.player2_name : m.player1_name,
      clMatchOrder: m.match_order,
    };
  });

  let cl2Num = 0;
  for (let i = 0; i + 1 < losers.length; i += 2) {
    cl2Num++;
    await dbRunAsync(
      `INSERT INTO bracket_matches (tournament_id, phase, match_order, match_label,
        player1_licence, player1_name, player2_licence, player2_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tournamentId, PHASE.CL2, cl2Num,
        `Classement R2 - Match ${cl2Num}`,
        losers[i].licence, losers[i].name,
        losers[i + 1].licence, losers[i + 1].name]
    );
  }

  if (cl2Num > 0) {
    console.log(`[BRACKET] Generated ${cl2Num} CL2 matches for tournament ${tournamentId}`);
  }
}

// ============================================================
// POST /:tournamentId/finalize — Compute final positions
// ============================================================
router.post('/:tournamentId/finalize', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    // Validate tournament
    const tournament = await dbGetAsync(
      'SELECT id, category_id, season, tournament_number FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) return res.status(404).json({ error: 'Tournoi non trouvé' });

    const allMatches = await dbAllAsync(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY phase, match_order',
      [tournamentId]
    );

    if (allMatches.length === 0) {
      return res.status(400).json({ error: 'Aucun match de tableau généré' });
    }

    // Check all required matches have results
    const requiredPhases = [PHASE.SF, PHASE.F, PHASE.PF, PHASE.CL1];
    const unfinished = allMatches.filter(m =>
      requiredPhases.includes(m.phase) && !m.winner_licence &&
      m.player1_licence && m.player2_licence // skip placeholder matches
    );
    // CL2 is optional — don't block finalize if CL2 not done
    if (unfinished.length > 0) {
      return res.status(400).json({
        error: 'Tous les matchs obligatoires doivent avoir un résultat',
        unfinished: unfinished.map(m => ({ id: m.id, label: m.match_label, phase: m.phase })),
      });
    }

    // ── Extract final positions ────────────────────────────
    const positionMap = {}; // licence → final position

    // Bracket positions (1-4)
    const finale = allMatches.find(m => m.phase === PHASE.F);
    const petiteFinale = allMatches.find(m => m.phase === PHASE.PF);

    if (finale && finale.winner_licence) {
      positionMap[finale.winner_licence] = 1;
      const finaleLoser = finale.winner_licence === finale.player1_licence
        ? finale.player2_licence : finale.player1_licence;
      positionMap[finaleLoser] = 2;
    }

    if (petiteFinale && petiteFinale.winner_licence) {
      positionMap[petiteFinale.winner_licence] = 3;
      const pfLoser = petiteFinale.winner_licence === petiteFinale.player1_licence
        ? petiteFinale.player2_licence : petiteFinale.player1_licence;
      positionMap[pfLoser] = 4;
    }

    // Classification positions (5+)
    const bracketSize = parseInt(await appSettings.getOrgSetting(orgId, 'bracket_size')) || 4;

    // Get all tournament results to know total player count
    const allResults = await dbAllAsync(
      `SELECT licence, match_points, points, reprises, serie
       FROM tournament_results WHERE tournament_id = $1
       ORDER BY match_points DESC,
         CASE WHEN reprises > 0 THEN CAST(points AS REAL) / reprises ELSE 0 END DESC,
         serie DESC`,
      [tournamentId]
    );
    const totalPlayers = allResults.length;
    const nonQualified = allResults.slice(bracketSize);
    const nq = nonQualified.length;

    // CL1 matches: each match determines two positions
    const cl1Matches = allMatches
      .filter(m => m.phase === PHASE.CL1)
      .sort((a, b) => a.match_order - b.match_order);

    // Assign positions from classification matches
    // Match order 1 determines the two lowest positions, match order N determines higher positions
    let currentLowPos = totalPlayers; // start from the bottom

    for (const cl of cl1Matches) {
      if (cl.winner_licence) {
        const loserLicence = cl.winner_licence === cl.player1_licence
          ? cl.player2_licence : cl.player1_licence;
        positionMap[loserLicence] = currentLowPos;
        positionMap[cl.winner_licence] = currentLowPos - 1;
      }
      currentLowPos -= 2;
    }

    // Bye player: if odd number of non-qualified, the best gets the highest remaining position
    if (nq % 2 === 1 && nonQualified.length > 0) {
      const byeLicence = nonQualified[0].licence;
      if (!positionMap[byeLicence]) {
        positionMap[byeLicence] = bracketSize + 1;
      }
    }

    // CL2 refinements (if exists): swap positions for losers of adjacent CL1 matches
    const cl2Matches = allMatches.filter(m => m.phase === PHASE.CL2);
    for (const cl2 of cl2Matches) {
      if (cl2.winner_licence) {
        const loserLicence = cl2.winner_licence === cl2.player1_licence
          ? cl2.player2_licence : cl2.player1_licence;
        // Winner of CL2 gets the higher of the two positions
        const pos1 = positionMap[cl2.winner_licence] || 999;
        const pos2 = positionMap[loserLicence] || 999;
        positionMap[cl2.winner_licence] = Math.min(pos1, pos2);
        positionMap[loserLicence] = Math.max(pos1, pos2);
      }
    }

    // ── Update tournament_results with final positions ─────
    const updates = [];
    for (const [licence, position] of Object.entries(positionMap)) {
      await dbRunAsync(
        'UPDATE tournament_results SET position = $1 WHERE tournament_id = $2 AND REPLACE(licence, \' \', \'\') = REPLACE($3, \' \', \'\')',
        [position, tournamentId, licence]
      );
      // Also update bracket_matches resulting_place
      await dbRunAsync(
        `UPDATE bracket_matches SET resulting_place = $1
         WHERE tournament_id = $2 AND winner_licence = $3 AND phase IN ($4, $5)`,
        [position, tournamentId, licence, PHASE.F, PHASE.PF]
      );
      updates.push({ licence, position });
    }

    // ── Assign position_points from lookup table ───────────
    const lookup = await getPositionPointsLookup(orgId, totalPlayers);
    const degradation = await appSettings.getOrgSetting(orgId, 'position_points_degradation');

    for (const [licence, position] of Object.entries(positionMap)) {
      let pp;
      if (degradation === 'last_player' && position === totalPlayers && totalPlayers > 0) {
        pp = lookup[position + 1] || 0;
      } else {
        pp = lookup[position] || 0;
      }
      await dbRunAsync(
        'UPDATE tournament_results SET position_points = $1 WHERE tournament_id = $2 AND REPLACE(licence, \' \', \'\') = REPLACE($3, \' \', \'\')',
        [pp, tournamentId, licence]
      );
    }

    // ── Recompute bonuses + rankings ───────────────────────
    await new Promise((resolve, reject) => {
      recomputeAllBonuses(tournament.category_id, tournament.season, orgId, (err) => {
        if (err) reject(err); else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      recalculateRankings(tournament.category_id, tournament.season, (err) => {
        if (err) reject(err); else resolve();
      }, orgId);
    });

    console.log(`[BRACKET] Finalized tournament ${tournamentId}: ${updates.length} positions assigned`);

    res.json({
      success: true,
      positions: updates.sort((a, b) => a.position - b.position),
      totalPlayers,
    });

  } catch (error) {
    console.error('[BRACKET] Error finalizing:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
