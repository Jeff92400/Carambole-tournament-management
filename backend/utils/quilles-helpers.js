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

module.exports = {
  QUILLES_MODES,
  isQuillesMode,
  resolveDistance,
  computeQuillesClassement,
  // Exposed for tests
  _normaliseMode
};
