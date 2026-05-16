// backend/utils/quilles-helpers.js
//
// V 2.0.788 — Sprint 2 C: Quilles helpers
//
// resolveDistance(tournamentRow, nbPoules, opts)
//   Determines the playing distance (points to win a match) for a Quilles
//   tournament. Used by:
//     - the DdJ workflow when generating poules and writing match templates
//     - the score-entry form (read-only display of the agreed distance)
//   For 9Q: always fixed_distance (with fallback to the org default setting).
//   For 5Q: fixed_distance overrides; otherwise looked up in
//   distance_matrices.matrix_data[nb_tables][nb_poules].
//
// computeQuillesClassement(orgId, season, mode, opts)
//   Builds the season-long Quilles ranking for an org (best N tournament
//   scores out of total played). Returns an ordered array of player rows.
//   Schema-tolerant: works even when tournament_results has zero Quilles
//   rows yet (Sprint 2 E will populate them).

const appSettings = require('./app-settings');

const QUILLES_MODES = ['5Q', '9Q'];

function _normaliseMode(mode) {
  if (!mode) return null;
  const m = String(mode).toUpperCase().trim();
  if (m === '5Q' || m === '5 QUILLES' || m === '5QUILLES') return '5Q';
  if (m === '9Q' || m === '9 QUILLES' || m === '9QUILLES') return '9Q';
  return null;
}

function isQuillesMode(mode) {
  return _normaliseMode(mode) !== null;
}

// ----------------------------------------------------------------------------
// resolveDistance
// ----------------------------------------------------------------------------

/**
 * Resolves the playing distance for a Quilles tournament.
 *
 * V 2.0.815 — Sprint 2 D1 (LBIF Phase 1): phase-aware matrix lookup.
 * matrix_data[tables][poules] can now be either:
 *   - an integer (legacy flat format) → same distance for all phases
 *   - an object { default: int, qualif?: int, barrage?: int, eighth?: int,
 *     quarter?: int, semi?: int, final?: int } → per-phase override + default
 * The lookup tries opts.phase first, then 'default', then any numeric value
 * found in the object (defensive fallback).
 *
 * @param {object} tournament - tournoi_ext row, must include at least:
 *   { mode, fixed_distance, distance_matrix_id, nb_tables, organization_id }
 * @param {number|null} nbPoules - number of poules in the tournament.
 *   Required for 5Q matrix lookup; ignored for 9Q.
 * @param {object} opts
 * @param {object} opts.db - db-loader (required, async)
 * @param {string} [opts.phase] - 'qualif' | 'barrage' | 'eighth' | 'quarter'
 *   | 'semi' | 'final'. Used only when matrix_data cell is an object.
 *   Defaults to 'default' (top-level fallback).
 * @returns {Promise<{distance: number|null, source: string, warning?: string, phase?: string}>}
 *   source ∈ 'fixed' | 'matrix' | 'matrix_phase' | 'matrix_default'
 *         | 'org_default' | 'unresolved'
 */
async function resolveDistance(tournament, nbPoules, opts = {}) {
  const db = opts.db || require('../db-loader');
  if (!tournament) {
    return { distance: null, source: 'unresolved', warning: 'tournament is null' };
  }

  const mode = _normaliseMode(tournament.mode);
  if (!mode) {
    return { distance: null, source: 'unresolved', warning: `non-Quilles mode: ${tournament.mode}` };
  }

  // 1. fixed_distance always wins (admin override). Used as the primary value
  //    for 9Q; for 5Q it's an optional override (e.g. introductory tournament).
  if (tournament.fixed_distance != null && Number.isFinite(tournament.fixed_distance)) {
    return { distance: tournament.fixed_distance, source: 'fixed' };
  }

  // 2. For 9Q without fixed_distance, fall back to the org default setting
  //    (quilles_9q_default_distance, V 2.0.774). Should never happen if the
  //    create-tournament form is used (it pre-fills the field), but the
  //    calendar generator may insert rows without an explicit distance.
  if (mode === '9Q') {
    const orgId = tournament.organization_id || null;
    const defaultStr = await appSettings.getOrgSetting(orgId, 'quilles_9q_default_distance');
    const def = parseInt(defaultStr, 10);
    if (Number.isFinite(def) && def > 0) {
      return { distance: def, source: 'org_default' };
    }
    return { distance: 400, source: 'org_default', warning: 'no org default, using LBIF baseline 400' };
  }

  // 3. For 5Q without fixed_distance: look up the matrix.
  if (!tournament.distance_matrix_id) {
    return { distance: null, source: 'unresolved', warning: '5Q tournament has no distance_matrix_id' };
  }
  if (!Number.isFinite(tournament.nb_tables) || tournament.nb_tables <= 0) {
    return { distance: null, source: 'unresolved', warning: '5Q tournament has no nb_tables' };
  }
  if (!Number.isFinite(nbPoules) || nbPoules <= 0) {
    return { distance: null, source: 'unresolved', warning: 'nbPoules required for 5Q matrix lookup' };
  }

  const matrix = await new Promise((resolve, reject) => {
    db.get(
      `SELECT matrix_data FROM distance_matrices WHERE id = $1`,
      [tournament.distance_matrix_id],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  if (!matrix || !matrix.matrix_data) {
    return { distance: null, source: 'unresolved', warning: `matrix #${tournament.distance_matrix_id} not found` };
  }

  // matrix_data is a JSONB: { [nb_tables]: { [nb_poules]: distance } }
  // pg returns it as object; SQLite-compat would give a string — handle both.
  let data = matrix.matrix_data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch (e) {
      return { distance: null, source: 'unresolved', warning: 'matrix_data is not valid JSON' };
    }
  }

  const tablesKey = String(tournament.nb_tables);
  const poulesKey = String(nbPoules);
  const cell = data?.[tablesKey]?.[poulesKey];

  // V 2.0.815 — D1: phase-aware lookup.
  // Case 1: cell is a positive integer (legacy flat format) → return as-is.
  if (Number.isFinite(cell) && cell > 0) {
    return { distance: cell, source: 'matrix' };
  }

  // Case 2: cell is an object → look up by phase, then default, then any numeric.
  if (cell && typeof cell === 'object') {
    const phase = opts.phase;
    // Validate phase against the known set so a typo can't silently swallow a config.
    const KNOWN_PHASES = new Set(['qualif', 'barrage', 'eighth', 'quarter', 'semi', 'final']);
    if (phase && KNOWN_PHASES.has(phase) && Number.isFinite(cell[phase]) && cell[phase] > 0) {
      return { distance: cell[phase], source: 'matrix_phase', phase };
    }
    if (Number.isFinite(cell.default) && cell.default > 0) {
      return { distance: cell.default, source: 'matrix_default', phase: phase || 'default' };
    }
    // Defensive fallback: take the first positive integer found in the object.
    for (const k of Object.keys(cell)) {
      if (Number.isFinite(cell[k]) && cell[k] > 0) {
        return {
          distance: cell[k],
          source: 'matrix_fallback',
          phase: k,
          warning: `no '${phase || 'default'}' for tables=${tablesKey} poules=${poulesKey} — used '${k}' instead`
        };
      }
    }
  }

  return {
    distance: null,
    source: 'unresolved',
    warning: `no cell for tables=${tablesKey} poules=${poulesKey}${opts.phase ? ` phase=${opts.phase}` : ''}`
  };
}

// ----------------------------------------------------------------------------
// computeQuillesClassement
// ----------------------------------------------------------------------------

/**
 * Computes the season-long Quilles ranking for a given org + mode.
 *
 * Players accumulate points from each tournament they finished. The season
 * ranking keeps the BEST N results out of all played (configurable via
 * best_of_count org setting; defaults to 2-of-3 like carambole "journées"
 * mode). When fewer than N tournaments were played, all results count.
 *
 * NB: Sprint 2 E (score entry) will populate tournament_results with Quilles
 * scoring (points + points_subis). Until then, this helper returns an empty
 * array but the SQL shape is settled so the moment results exist, ranking
 * lights up.
 *
 * @param {number|null} orgId
 * @param {string} season - e.g. "2025-2026"
 * @param {string} mode - '5Q' or '9Q'
 * @param {object} opts
 * @param {object} opts.db - db-loader (required, async)
 * @param {number} [opts.bestOf] - explicit best-of count (overrides org setting)
 * @returns {Promise<Array<{
 *   licence, player_name, club_name,
 *   tournaments_played, kept_count,
 *   total_points, best_results: Array<{tournoi_id, tour_number, points}>
 * }>>}
 */
async function computeQuillesClassement(orgId, season, mode, opts = {}) {
  const db = opts.db || require('../db-loader');
  const normMode = _normaliseMode(mode);
  if (!normMode) throw new Error(`Invalid Quilles mode: ${mode}`);

  // Best-of count: explicit > org setting > default 2
  let bestOf = opts.bestOf;
  if (!Number.isFinite(bestOf)) {
    const settingStr = await appSettings.getOrgSetting(orgId, 'best_of_count');
    bestOf = parseInt(settingStr, 10);
  }
  if (!Number.isFinite(bestOf) || bestOf <= 0) bestOf = 2;

  // Pull all Quilles tournament_results for the season + mode.
  // tournament_results stores points per match; for Quilles we aggregate to
  // a single line per (tournament, player) since each player plays a
  // bracket within a single day.
  const rows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT tr.licence,
              tr.player_name,
              tr.club_name,
              tr.points,
              te.tournoi_id,
              te.tour_number,
              te.nom AS tournament_name
         FROM tournament_results tr
         INNER JOIN tournaments t ON tr.tournament_id = t.id
         INNER JOIN tournoi_ext te ON t.tournoi_ext_id = te.tournoi_id
        WHERE te.mode = $1
          AND t.season = $2
          AND ($3::int IS NULL OR te.organization_id = $3)
          AND UPPER(tr.licence) NOT LIKE 'TEST%'
        ORDER BY tr.licence, tr.points DESC`,
      [normMode, season, orgId],
      (err, r) => err ? reject(err) : resolve(r || [])
    );
  });

  // Group by licence, keep best N.
  const byLicence = new Map();
  for (const r of rows) {
    if (!byLicence.has(r.licence)) {
      byLicence.set(r.licence, {
        licence: r.licence,
        player_name: r.player_name,
        club_name: r.club_name,
        all_results: []
      });
    }
    byLicence.get(r.licence).all_results.push({
      tournoi_id: r.tournoi_id,
      tour_number: r.tour_number,
      tournament_name: r.tournament_name,
      points: r.points || 0
    });
  }

  const ranking = [];
  for (const entry of byLicence.values()) {
    const sorted = entry.all_results.slice().sort((a, b) => b.points - a.points);
    const kept = sorted.slice(0, bestOf);
    const total = kept.reduce((sum, x) => sum + (x.points || 0), 0);
    ranking.push({
      licence: entry.licence,
      player_name: entry.player_name,
      club_name: entry.club_name,
      tournaments_played: entry.all_results.length,
      kept_count: kept.length,
      best_of: bestOf,
      total_points: total,
      best_results: kept,
      all_results: sorted
    });
  }

  // Sort by total points DESC, tie-break by tournaments_played DESC then licence.
  ranking.sort((a, b) => {
    if (b.total_points !== a.total_points) return b.total_points - a.total_points;
    if (b.tournaments_played !== a.tournaments_played) return b.tournaments_played - a.tournaments_played;
    return (a.licence || '').localeCompare(b.licence || '');
  });

  // Assign rank positions with ex-aequo handling.
  let pos = 0;
  let lastTotal = null;
  let lastPos = 0;
  for (let i = 0; i < ranking.length; i++) {
    pos++;
    if (ranking[i].total_points !== lastTotal) {
      ranking[i].rank_position = pos;
      lastPos = pos;
    } else {
      ranking[i].rank_position = lastPos;
    }
    lastTotal = ranking[i].total_points;
  }

  return ranking;
}

// ----------------------------------------------------------------------------
// V 2.0.816 — Sprint 2 LBIF Phase 2: backend helpers
// ----------------------------------------------------------------------------

/**
 * Returns the LBIF bracket configuration for a given player count.
 *
 * Implements decision D3: if N is outside [12, 46], either falls back to
 * single_poule mode (N<12) or throws (N>46).
 *
 * @param {number} nbPlayers
 * @param {object} opts
 * @param {object} opts.db - db-loader (required)
 * @returns {Promise<object>} bracket config row, or a synthetic
 *   single_poule fallback row for N<12. Shape:
 *   { nb_players, nb_poules, nb_direct_qualif, qualified_per_poule,
 *     has_barrage, bracket_start, bracket_size,
 *     nb_barragistes, nb_exempts_barrage, integrer_exempts_qualif,
 *     mode: 'lbif' | 'single_poule_fallback' }
 * @throws {Error} if N > 46 (LBIF règlement doesn't cover, requires manual extension)
 */
async function getBracketConfig(nbPlayers, opts = {}) {
  const db = opts.db || require('../db-loader');
  const n = parseInt(nbPlayers, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`nbPlayers invalide: ${nbPlayers}`);
  }

  // D3: N > 46 → refuse explicitly (LBIF règlement doesn't cover)
  if (n > 46) {
    const err = new Error(`Configuration LBIF non disponible pour ${n} joueurs (matrice couvre 12-46). Étendez la matrice avec JC dans Données de Référence → 🎯 Quilles LBIF.`);
    err.code = 'LBIF_MATRIX_OVERFLOW';
    throw err;
  }

  // D3: N < 12 → fallback single_poule (1 poule intégrale round-robin)
  if (n < 12) {
    return {
      nb_players: n,
      nb_poules: 1,
      nb_direct_qualif: 0,
      qualified_per_poule: n, // all players go to "bracket" (= nobody, since it's already a single poule)
      has_barrage: false,
      bracket_start: 'semi',
      bracket_size: 0,
      nb_barragistes: 0,
      nb_exempts_barrage: 0,
      integrer_exempts_qualif: false,
      mode: 'single_poule_fallback',
      _warning: `N=${n} < 12 (seuil LBIF) → mode single_poule activé (1 poule intégrale, pas de bracket)`
    };
  }

  // Standard path: lookup the seeded matrix
  const row = await new Promise((resolve, reject) => {
    db.get(
      `SELECT nb_players, nb_poules, nb_direct_qualif, qualified_per_poule,
              has_barrage, bracket_start, bracket_size,
              nb_barragistes, nb_exempts_barrage, integrer_exempts_qualif,
              notes
         FROM quilles_bracket_configs
        WHERE nb_players = $1`,
      [n],
      (err, r) => err ? reject(err) : resolve(r)
    );
  });

  if (!row) {
    const err = new Error(`Configuration LBIF manquante pour ${n} joueurs. Vérifiez la table quilles_bracket_configs (devrait être seedée par la migration V 2.0.814).`);
    err.code = 'LBIF_MATRIX_MISSING';
    throw err;
  }

  return { ...row, mode: 'lbif' };
}

// ----------------------------------------------------------------------------
// resolveLbifPoints
// ----------------------------------------------------------------------------

// LBIF Code Sportif chap 1.1.1.G + 3.1.G — points attribués par tournoi
// (identique pour 5Q et 9Q). Identifie la "position" du joueur dans le tournoi.
const LBIF_POINTS_MAP = {
  '1st':            25,  // Vainqueur
  '2nd':            20,  // Finaliste
  'semi':           15,  // 1/2 finaliste (perdant de demi-finale)
  'quarter':        11,  // 1/4 de finale (perdant de quart)
  'eighth':          8,  // 1/8 de finale (perdant de huitième)
  'barrage':         5,  // Éliminé en barrage
  'poule_3rd_1win':  3,  // 3ème de poule avec 1 victoire
  'poule_3rd_0win':  1   // 3ème de poule avec 0 victoire
};

/**
 * Returns the LBIF points for a given position in a Quilles tournament.
 *
 * @param {string} position - one of LBIF_POINTS_MAP keys
 * @returns {number} 0 if position unknown
 */
function resolveLbifPoints(position) {
  return LBIF_POINTS_MAP[position] || 0;
}

/**
 * Maps an internal DdJ "final_place" + context to an LBIF position label
 * that can be passed to resolveLbifPoints.
 *
 * @param {object} ctx
 * @param {number} ctx.final_place - 1, 2, 3, 4, ... (1-based)
 * @param {boolean} ctx.qualified_for_bracket - true if reached the bracket
 *   (either via exempt, barrage win, or direct qualification)
 * @param {boolean} ctx.went_to_barrage - true if played at least one barrage match
 * @param {string|null} ctx.bracket_phase_reached - 'eighth' | 'quarter' | 'semi' | 'final'
 *   (the deepest bracket phase the player entered)
 * @param {boolean} ctx.eliminated_in_poule - true if eliminated at poule stage (3rd of poule)
 * @param {number} ctx.poule_match_wins - number of wins in poule (only used when eliminated_in_poule)
 * @returns {string} LBIF position key (key of LBIF_POINTS_MAP)
 */
function mapPlaceToLbifPosition(ctx) {
  if (ctx.final_place === 1) return '1st';
  if (ctx.final_place === 2) return '2nd';
  if (ctx.final_place === 3 || ctx.final_place === 4) return 'semi';

  if (ctx.qualified_for_bracket) {
    // Reached bracket but didn't make the SF
    if (ctx.bracket_phase_reached === 'quarter' || (ctx.final_place >= 5 && ctx.final_place <= 8)) return 'quarter';
    if (ctx.bracket_phase_reached === 'eighth' || (ctx.final_place >= 9 && ctx.final_place <= 16)) return 'eighth';
    return 'eighth'; // safe default for "qualified but eliminated early"
  }

  if (ctx.went_to_barrage) return 'barrage';

  // Eliminated at poule stage (3rd of poule)
  if (ctx.eliminated_in_poule) {
    return (ctx.poule_match_wins && ctx.poule_match_wins > 0) ? 'poule_3rd_1win' : 'poule_3rd_0win';
  }

  return 'poule_3rd_0win'; // safe default
}

// ----------------------------------------------------------------------------
// computeReclassementSerpentin
// ----------------------------------------------------------------------------

/**
 * Reclassifies players for the serpentin distribution between phases.
 * Implements decision D2: Points match → Total points marqués → tirage au sort.
 *
 * Used between poules → barrage, and between barrage → bracket.
 *
 * @param {Array<{licence, player_name, match_points, points_scored, ...}>} players
 * @param {object} opts
 * @param {function} [opts.rng] - random source for tie-break (defaults to Math.random)
 * @returns {Array} same players, sorted by LBIF criteria (best first), each with
 *   added field `serpentin_rank` (1-based).
 */
function computeReclassementSerpentin(players, opts = {}) {
  const rng = opts.rng || Math.random;
  // Stable sort by 2 criteria, with random tie-break for the rest.
  // We attach a random key to each player BEFORE the sort so the tie-break
  // is deterministic within a single call (and the random can be seeded for tests).
  const enriched = players.map(p => ({
    ...p,
    _tieBreak: rng()
  }));

  enriched.sort((a, b) => {
    // 1. Points match descending
    const aMp = a.match_points || 0;
    const bMp = b.match_points || 0;
    if (bMp !== aMp) return bMp - aMp;
    // 2. Total points marqués descending (D2)
    const aPts = a.points_scored || a.points || 0;
    const bPts = b.points_scored || b.points || 0;
    if (bPts !== aPts) return bPts - aPts;
    // 3. Random tie-break (LBIF règlement implicite)
    return a._tieBreak - b._tieBreak;
  });

  return enriched.map((p, idx) => {
    // Strip the tie-break key from the output (internal-only)
    const { _tieBreak, ...rest } = p;
    return { ...rest, serpentin_rank: idx + 1 };
  });
}

// ----------------------------------------------------------------------------
// distributeSerpentin
// ----------------------------------------------------------------------------

/**
 * Distributes ranked players into N poules using the serpentin algorithm.
 * Example: 12 players in 4 poules:
 *   rank 1 → poule 1, rank 2 → poule 2, rank 3 → poule 3, rank 4 → poule 4,
 *   rank 5 → poule 4, rank 6 → poule 3, rank 7 → poule 2, rank 8 → poule 1,
 *   rank 9 → poule 1, ... (snake pattern)
 *
 * @param {Array} rankedPlayers - players already sorted by computeReclassementSerpentin
 * @param {number} nbPoules
 * @returns {Array<Array>} poules[i] = array of players for poule i+1
 */
function distributeSerpentin(rankedPlayers, nbPoules) {
  if (!Array.isArray(rankedPlayers) || nbPoules < 1) return [];
  const poules = Array.from({ length: nbPoules }, () => []);
  let direction = 1; // 1 = forward, -1 = backward
  let pouleIdx = 0;

  for (let i = 0; i < rankedPlayers.length; i++) {
    poules[pouleIdx].push(rankedPlayers[i]);
    // Advance with serpentine direction
    if (direction === 1) {
      if (pouleIdx === nbPoules - 1) { direction = -1; }
      else { pouleIdx++; }
    } else {
      if (pouleIdx === 0) { direction = 1; }
      else { pouleIdx--; }
    }
  }
  return poules;
}

module.exports = {
  QUILLES_MODES,
  isQuillesMode,
  resolveDistance,
  computeQuillesClassement,
  // V 2.0.816 — Phase 2 helpers
  getBracketConfig,
  resolveLbifPoints,
  mapPlaceToLbifPosition,
  computeReclassementSerpentin,
  distributeSerpentin,
  LBIF_POINTS_MAP,
  // Exposed for tests
  _normaliseMode
};
