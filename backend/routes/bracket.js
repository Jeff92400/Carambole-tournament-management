const express = require('express');
const db = require('../db-loader');
const { authenticateToken, requireAdmin } = require('./auth');
const appSettings = require('../utils/app-settings');

const router = express.Router();

// ==================== HELPER: promisified db calls ====================

function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) { err ? reject(err) : resolve(this); });
  });
}

// ==================== ALGORITHMIC ENGINE ====================

/**
 * Determine how many poules and their sizes for a given player count.
 * Journées mode prefers poules of 3; poules of 2 used only when needed.
 * Returns { poules: [3, 3, 2, ...], qualificationRule: string }
 */
function computePouleDistribution(numPlayers) {
  if (numPlayers <= 5) {
    return { poules: [numPlayers], qualificationRule: 'single_poule' };
  }

  // Journées mode configs (FFB standard)
  const configs = {
    6:  { poules: [3, 3],          qualificationRule: 'top2_each' },
    7:  { poules: [3, 2, 2],      qualificationRule: 'all_1st_best_2nd' },
    8:  { poules: [3, 3, 2],      qualificationRule: 'all_1st_best_2nd' },
    9:  { poules: [3, 3, 3],      qualificationRule: 'all_1st_best_2nd' },
    10: { poules: [3, 3, 2, 2],   qualificationRule: 'all_1st' },
    11: { poules: [3, 3, 3, 2],   qualificationRule: 'all_1st' },
    12: { poules: [3, 3, 3, 3],   qualificationRule: 'all_1st' },
    13: { poules: [3, 3, 3, 2, 2], qualificationRule: 'best_4_overall' },
    14: { poules: [3, 3, 3, 3, 2], qualificationRule: 'best_4_overall' },
    15: { poules: [3, 3, 3, 3, 3], qualificationRule: 'best_4_overall' },
  };

  if (configs[numPlayers]) return configs[numPlayers];

  // For 16+ players: fill poules of 3, remainder become poules of 2
  const poulesOf3 = Math.floor(numPlayers / 3);
  const remainder = numPlayers % 3;
  const poules = Array(poulesOf3).fill(3);
  if (remainder === 2) poules.push(2);
  if (remainder === 1) { poules[poules.length - 1] = 2; poules.push(2); }
  return { poules, qualificationRule: 'best_4_overall' };
}

/**
 * Compute the 4 qualifiers from poule standings.
 * pouleStandings: array of { pouleNumber, standings: [{ licence, playerName, matchPoints, points, reprises, serie }] }
 * Each standings array is sorted by matchPoints DESC within its poule.
 */
function computeQualifiers(pouleStandings, qualificationRule) {
  if (qualificationRule === 'single_poule') {
    // No bracket needed — poule standings ARE the final result
    return { qualifiers: [], isSinglePoule: true, finalStandings: pouleStandings[0].standings };
  }

  let qualifiers = [];

  if (qualificationRule === 'top2_each') {
    // 6 players (2×3): 1st + 2nd of each poule
    for (const poule of pouleStandings) {
      qualifiers.push(...poule.standings.slice(0, 2));
    }
  } else if (qualificationRule === 'all_1st_best_2nd') {
    // 7-9 players: all 1st + best 2nd
    const firsts = pouleStandings.map(p => p.standings[0]);
    const seconds = pouleStandings
      .map(p => p.standings[1])
      .filter(Boolean)
      .sort((a, b) => b.matchPoints - a.matchPoints || b.points - a.points);
    qualifiers = [...firsts, seconds[0]];
  } else if (qualificationRule === 'all_1st') {
    // 10-12 players: all 1st of each poule (4 poules)
    qualifiers = pouleStandings.map(p => p.standings[0]);
  } else if (qualificationRule === 'best_4_overall') {
    // 13+ players: best 4 across all poules (by poule standing then cross-poule comparison)
    const firsts = pouleStandings.map(p => p.standings[0]);
    const seconds = pouleStandings
      .map(p => p.standings[1])
      .filter(Boolean);
    const allCandidates = [...firsts, ...seconds]
      .sort((a, b) => b.matchPoints - a.matchPoints || b.points - a.points);
    qualifiers = allCandidates.slice(0, 4);
  }

  // Sort qualifiers by performance for seeding (1st seed = best)
  qualifiers.sort((a, b) => b.matchPoints - a.matchPoints || b.points - a.points);

  // Assign seed numbers
  qualifiers = qualifiers.slice(0, 4).map((q, i) => ({ ...q, seed: i + 1 }));

  // Non-qualified players
  const qualifierLicences = new Set(qualifiers.map(q => q.licence));
  const nonQualified = [];
  for (const poule of pouleStandings) {
    for (const player of poule.standings) {
      if (!qualifierLicences.has(player.licence)) {
        nonQualified.push(player);
      }
    }
  }
  // Sort non-qualified by match points DESC for classification seeding
  nonQualified.sort((a, b) => b.matchPoints - a.matchPoints || b.points - a.points);

  return { qualifiers, nonQualified, isSinglePoule: false };
}

/**
 * Generate bracket matches (SF + F + PF).
 * Returns array of match objects ready for display/saving.
 */
function generateBracket(qualifiers) {
  if (qualifiers.length < 4) return [];

  const [seed1, seed2, seed3, seed4] = qualifiers;

  return [
    {
      phase: 'SF',
      matchOrder: 1,
      matchLabel: 'Demi-finale 1 : 1er vs 4ème',
      player1Licence: seed1.licence,
      player1Name: seed1.playerName,
      player2Licence: seed4.licence,
      player2Name: seed4.playerName,
    },
    {
      phase: 'SF',
      matchOrder: 2,
      matchLabel: 'Demi-finale 2 : 2ème vs 3ème',
      player1Licence: seed2.licence,
      player1Name: seed2.playerName,
      player2Licence: seed3.licence,
      player2Name: seed3.playerName,
    },
    {
      phase: 'F',
      matchOrder: 1,
      matchLabel: 'Finale (1ère - 2ème place)',
      player1Licence: null, // filled after SF results
      player1Name: null,
      player2Licence: null,
      player2Name: null,
    },
    {
      phase: 'PF',
      matchOrder: 1,
      matchLabel: 'Petite finale (3ème - 4ème place)',
      player1Licence: null,
      player1Name: null,
      player2Licence: null,
      player2Name: null,
    },
  ];
}

/**
 * Generate classification matches for non-qualified players.
 * Pairs from bottom up: (N-1, N), (N-3, N-2), etc.
 * If odd count: best non-qualified gets a bye in R1.
 * Returns { round1: [...matches], round2: [...matches] }
 */
function generateClassification(nonQualified, enableRound2 = true) {
  if (nonQualified.length <= 1) {
    // 0 or 1 player: no classification matches needed
    return { round1: [], round2: [] };
  }

  const players = [...nonQualified]; // copy, sorted by performance DESC
  const round1 = [];
  let hasBye = false;
  let byePlayer = null;

  // If odd number, best non-qualified gets a bye
  if (players.length % 2 !== 0) {
    byePlayer = players.shift();
    hasBye = true;
  }

  // Pair from bottom up: last two, then next two up, etc.
  // Players are sorted best-to-worst, so pair from the end
  const pairs = [];
  for (let i = players.length - 1; i >= 1; i -= 2) {
    pairs.unshift({ upper: players[i - 1], lower: players[i] });
  }

  // Create R1 matches
  // Starting place = 5 (positions 1-4 are bracket)
  let placeCounter = 5;
  if (hasBye) placeCounter++; // bye player takes position 5

  pairs.forEach((pair, idx) => {
    round1.push({
      phase: 'C_R1',
      matchOrder: idx + 1,
      matchLabel: `Classement ${placeCounter + idx * 2}-${placeCounter + idx * 2 + 1}`,
      player1Licence: pair.upper.licence,
      player1Name: pair.upper.playerName,
      player2Licence: pair.lower.licence,
      player2Name: pair.lower.playerName,
    });
  });

  // R2: cross-matches between adjacent pairs (loser of upper pair vs winner of lower pair)
  // Only if enableRound2 and there are 2+ pairs
  const round2 = [];
  if (enableRound2 && pairs.length >= 2) {
    for (let i = 0; i < pairs.length - 1; i++) {
      round2.push({
        phase: 'C_R2',
        matchOrder: i + 1,
        matchLabel: `Classement croisé`,
        player1Licence: null, // loser of pair[i] — filled after R1 results
        player1Name: null,
        player2Licence: null, // winner of pair[i+1] — filled after R1 results
        player2Name: null,
      });
    }
  }

  return { round1, round2, byePlayer };
}

/**
 * Assign final positions after all matches are complete.
 * bracketResults: { sf1Winner, sf1Loser, sf2Winner, sf2Loser, finaleWinner, finaleLoser, pfWinner, pfLoser }
 * classificationResults: ordered list from classification engine
 * Returns: [{ licence, playerName, position, positionPoints }]
 */
async function assignPositions(positions, orgId) {
  // Load position-to-points mapping
  const pointsMap = await dbAll(
    'SELECT position, points FROM position_points WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY position ASC',
    [orgId]
  );
  const pointsLookup = {};
  for (const row of pointsMap) {
    pointsLookup[row.position] = row.points;
  }

  // Assign points to each position
  return positions.map(p => ({
    ...p,
    positionPoints: pointsLookup[p.position] || 0,
  }));
}

// ==================== API ENDPOINTS ====================

/**
 * GET /api/bracket/:tournamentId/setup
 * Compute qualifiers from tournament_results (poule results) and generate bracket structure.
 */
router.get('/:tournamentId/setup', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    // Verify tournament exists and belongs to org
    const tournament = await dbGet(
      'SELECT * FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    // Get poule data from convocation_poules (links via tournoi_ext)
    // First find the tournoi_ext that matches this tournament
    const tournoiExt = await dbGet(
      `SELECT te.tournoi_id FROM tournoi_ext te
       JOIN categories c ON UPPER(te.mode) = UPPER(c.game_type) AND UPPER(te.categorie) = UPPER(c.name)
       WHERE c.id = $1 AND te.organization_id = $2
       ORDER BY te.debut DESC LIMIT 1`,
      [tournament.category_id, orgId]
    );

    // Get tournament results (these are the poule results)
    const results = await dbAll(
      `SELECT tr.licence, tr.player_name, tr.match_points, tr.points, tr.reprises, tr.serie
       FROM tournament_results tr
       WHERE tr.tournament_id = $1
       ORDER BY tr.match_points DESC, tr.points DESC`,
      [tournamentId]
    );

    if (results.length === 0) {
      return res.status(400).json({ error: 'Aucun résultat de poules trouvé pour ce tournoi' });
    }

    // If we have convocation_poules data, use it to reconstruct poule groupings
    let pouleStandings = [];

    if (tournoiExt) {
      const pouleData = await dbAll(
        'SELECT poule_number, licence FROM convocation_poules WHERE tournoi_id = $1 ORDER BY poule_number, player_order',
        [tournoiExt.tournoi_id]
      );

      if (pouleData.length > 0) {
        // Group results by poule
        const pouleMap = {};
        for (const pd of pouleData) {
          if (!pouleMap[pd.poule_number]) pouleMap[pd.poule_number] = new Set();
          pouleMap[pd.poule_number].add(pd.licence.replace(/\s/g, ''));
        }

        // Build standings per poule
        for (const [pouleNum, licences] of Object.entries(pouleMap)) {
          const standings = results
            .filter(r => licences.has(r.licence.replace(/\s/g, '')))
            .map(r => ({
              licence: r.licence,
              playerName: r.player_name,
              matchPoints: r.match_points,
              points: r.points,
              reprises: r.reprises,
              serie: r.serie,
            }))
            .sort((a, b) => b.matchPoints - a.matchPoints || b.points - a.points);

          pouleStandings.push({ pouleNumber: parseInt(pouleNum), standings });
        }
      }
    }

    // Fallback: if no poule data, treat all as one big poule
    if (pouleStandings.length === 0) {
      pouleStandings = [{
        pouleNumber: 1,
        standings: results.map(r => ({
          licence: r.licence,
          playerName: r.player_name,
          matchPoints: r.match_points,
          points: r.points,
          reprises: r.reprises,
          serie: r.serie,
        })),
      }];
    }

    // Determine qualification rule based on total player count
    const totalPlayers = results.length;
    const { qualificationRule } = computePouleDistribution(totalPlayers);

    // Compute qualifiers
    const qualification = computeQualifiers(pouleStandings, qualificationRule);

    if (qualification.isSinglePoule) {
      return res.json({
        tournamentId,
        totalPlayers,
        mode: 'single_poule',
        finalStandings: qualification.finalStandings,
        message: 'Moins de 6 joueurs : poule unique, pas de tableau',
      });
    }

    // Generate bracket
    const bracket = generateBracket(qualification.qualifiers);

    // Get org setting for classification R2
    const enableR2 = await appSettings.getOrgSetting(orgId, 'classement_round_2');
    const classification = generateClassification(
      qualification.nonQualified,
      enableR2 !== '0' && enableR2 !== 'false'
    );

    // Check if bracket matches already exist for this tournament
    const existingMatches = await dbAll(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY phase, match_order',
      [tournamentId]
    );

    res.json({
      tournamentId,
      totalPlayers,
      mode: 'bracket',
      qualifiers: qualification.qualifiers,
      nonQualified: qualification.nonQualified,
      bracket,
      classification,
      existingMatches,
      pouleStandings,
    });
  } catch (error) {
    console.error('Error in bracket setup:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/bracket/:tournamentId/results
 * Save bracket and classification match results.
 * Body: { matches: [{ phase, matchOrder, player1Licence, player1Name, player2Licence, player2Name,
 *          player1Points, player1Reprises, player2Points, player2Reprises, winnerLicence, matchLabel }] }
 */
router.post('/:tournamentId/results', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;
    const { matches } = req.body;

    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ error: 'matches doit être un tableau non vide' });
    }

    // Verify tournament belongs to org
    const tournament = await dbGet(
      'SELECT * FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    // Delete existing matches for this tournament (replace all)
    await dbRun('DELETE FROM bracket_matches WHERE tournament_id = $1', [tournamentId]);

    // Insert all matches
    for (const m of matches) {
      await dbRun(
        `INSERT INTO bracket_matches
          (tournament_id, phase, match_order, match_label,
           player1_licence, player1_name, player2_licence, player2_name,
           player1_points, player1_reprises, player2_points, player2_reprises,
           winner_licence, resulting_place)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          tournamentId,
          m.phase,
          m.matchOrder,
          m.matchLabel || null,
          m.player1Licence,
          m.player1Name || null,
          m.player2Licence || null,
          m.player2Name || null,
          m.player1Points || 0,
          m.player1Reprises || 0,
          m.player2Points || 0,
          m.player2Reprises || 0,
          m.winnerLicence || null,
          m.resultingPlace || null,
        ]
      );
    }

    res.json({ success: true, message: `${matches.length} matches enregistrés` });
  } catch (error) {
    console.error('Error saving bracket results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/bracket/:tournamentId/finalize
 * Compute final positions from bracket + classification results.
 * Updates tournament_results.position and tournament_results.position_points.
 */
router.post('/:tournamentId/finalize', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    // Verify tournament belongs to org
    const tournament = await dbGet(
      'SELECT * FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    // Get all bracket matches
    const matches = await dbAll(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY phase, match_order',
      [tournamentId]
    );

    if (matches.length === 0) {
      return res.status(400).json({ error: 'Aucun match de tableau trouvé' });
    }

    // Build position assignments from match results
    const positions = [];

    // Extract bracket positions (F, PF)
    const finale = matches.find(m => m.phase === 'F');
    const petiteFinale = matches.find(m => m.phase === 'PF');

    if (finale && finale.winner_licence) {
      const finaleLicences = [finale.player1_licence, finale.player2_licence];
      positions.push({
        licence: finale.winner_licence,
        playerName: finale.winner_licence === finale.player1_licence ? finale.player1_name : finale.player2_name,
        position: 1,
      });
      const finaleLoser = finaleLicences.find(l => l !== finale.winner_licence);
      if (finaleLoser) {
        positions.push({
          licence: finaleLoser,
          playerName: finaleLoser === finale.player1_licence ? finale.player1_name : finale.player2_name,
          position: 2,
        });
      }
    }

    if (petiteFinale && petiteFinale.winner_licence) {
      const pfLicences = [petiteFinale.player1_licence, petiteFinale.player2_licence];
      positions.push({
        licence: petiteFinale.winner_licence,
        playerName: petiteFinale.winner_licence === petiteFinale.player1_licence ? petiteFinale.player1_name : petiteFinale.player2_name,
        position: 3,
      });
      const pfLoser = pfLicences.find(l => l !== petiteFinale.winner_licence);
      if (pfLoser) {
        positions.push({
          licence: pfLoser,
          playerName: pfLoser === petiteFinale.player1_licence ? petiteFinale.player1_name : petiteFinale.player2_name,
          position: 4,
        });
      }
    }

    // Extract classification positions from resulting_place
    const classificationMatches = matches.filter(m => m.phase.startsWith('C_'));
    for (const cm of classificationMatches) {
      if (cm.resulting_place && cm.winner_licence) {
        // Winner gets the better place
        const loserLicence = cm.player1_licence === cm.winner_licence ? cm.player2_licence : cm.player1_licence;
        const loserName = cm.player1_licence === cm.winner_licence ? cm.player2_name : cm.player1_name;
        const winnerName = cm.player1_licence === cm.winner_licence ? cm.player1_name : cm.player2_name;

        // Check if winner already has a position assigned
        if (!positions.find(p => p.licence === cm.winner_licence)) {
          positions.push({
            licence: cm.winner_licence,
            playerName: winnerName,
            position: cm.resulting_place,
          });
        }
        if (loserLicence && !positions.find(p => p.licence === loserLicence)) {
          positions.push({
            licence: loserLicence,
            playerName: loserName,
            position: cm.resulting_place + 1,
          });
        }
      }
    }

    // Assign position points
    const withPoints = await assignPositions(positions, orgId);

    // Update tournament_results with final positions and position_points
    let updatedCount = 0;
    for (const p of withPoints) {
      const result = await dbRun(
        `UPDATE tournament_results
         SET position = $1, position_points = $2
         WHERE tournament_id = $3 AND REPLACE(licence, ' ', '') = REPLACE($4, ' ', '')`,
        [p.position, p.positionPoints, tournamentId, p.licence]
      );
      if (result && result.changes > 0) updatedCount++;
    }

    // Also assign positions for players not in bracket/classification (if any remain)
    // These get the next positions after all classified players
    const assignedLicences = new Set(withPoints.map(p => p.licence.replace(/\s/g, '')));
    const unassigned = await dbAll(
      `SELECT licence, player_name FROM tournament_results
       WHERE tournament_id = $1 AND (position IS NULL OR position = 0)`,
      [tournamentId]
    );

    let nextPosition = Math.max(...withPoints.map(p => p.position), 0) + 1;
    for (const u of unassigned) {
      if (!assignedLicences.has(u.licence.replace(/\s/g, ''))) {
        const pts = await assignPositions([{ licence: u.licence, playerName: u.player_name, position: nextPosition }], orgId);
        await dbRun(
          `UPDATE tournament_results SET position = $1, position_points = $2
           WHERE tournament_id = $3 AND REPLACE(licence, ' ', '') = REPLACE($4, ' ', '')`,
          [nextPosition, pts[0].positionPoints, tournamentId, u.licence]
        );
        nextPosition++;
        updatedCount++;
      }
    }

    res.json({
      success: true,
      message: `${updatedCount} positions finalisées`,
      positions: withPoints,
    });
  } catch (error) {
    console.error('Error finalizing bracket:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/bracket/:tournamentId/matches
 * Retrieve saved bracket matches for a tournament.
 */
router.get('/:tournamentId/matches', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    // Verify tournament belongs to org
    const tournament = await dbGet(
      'SELECT * FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    const matches = await dbAll(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY phase, match_order',
      [tournamentId]
    );

    res.json(matches);
  } catch (error) {
    console.error('Error fetching bracket matches:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
