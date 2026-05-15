/**
 * Poule Configuration Utility
 *
 * Computes poule compositions algorithmically based on player count
 * and per-org setting `allow_poule_of_2`.
 *
 * Algorithm:
 *   - Preferred poule size: 3
 *   - num_poules = floor(N / 3)
 *   - Remainder 0: all poules of 3
 *   - Remainder 1: last poule becomes 4
 *   - Remainder 2:
 *       allow_poule_of_2=false → last poule becomes 5
 *       allow_poule_of_2=true  → extra poule of 2 added
 */

/**
 * Compute the number of billiard tables needed for a set of poule sizes.
 * 1 table for poules ≤ 3, ceil(size/2) for larger poules.
 * @param {number[]} pouleSizes
 * @returns {number}
 */
function computeTablesNeeded(pouleSizes) {
  return pouleSizes.reduce((total, size) => {
    if (size <= 3) return total + 1;
    // For a round-robin of n players, the maximum simultaneous matches per round
    // is floor(n/2) — using ceil overestimates for odd n (e.g. 5 → 2, not 3).
    return total + Math.floor(size / 2);
  }, 0);
}

/**
 * Format poule sizes into a human-readable French description.
 * @param {number[]} poules - Array of poule sizes
 * @returns {string}
 */
function formatPouleDescription(poules) {
  if (!poules || poules.length === 0) return 'Pas assez de joueurs';
  if (poules.length === 1) return `1 poule : ${poules[0]}`;
  return `${poules.length} poules : ${poules.join(' + ')}`;
}

/**
 * Compute poule configuration for a given number of players.
 * @param {number} numPlayers - Total players to distribute
 * @param {boolean} allowPouleOf2 - Whether 2-player poules are permitted
 * @returns {{ poules: number[], tables: number, minPlayers: number, description: string }}
 */
function computePouleConfiguration(numPlayers, allowPouleOf2 = false) {
  const minPlayers = allowPouleOf2 ? 2 : 3;

  if (numPlayers < minPlayers) {
    return { poules: [], tables: 0, minPlayers, description: 'Pas assez de joueurs' };
  }

  // Special case: exactly 2 players (only when allowed)
  if (numPlayers === 2 && allowPouleOf2) {
    const poules = [2];
    return { poules, tables: computeTablesNeeded(poules), minPlayers, description: formatPouleDescription(poules) };
  }

  const numPoules = Math.floor(numPlayers / 3);
  const remainder = numPlayers % 3;
  const poules = Array(numPoules).fill(3);

  if (remainder === 1) {
    if (allowPouleOf2) {
      // Replace last poule of 3 with two poules of 2 (e.g. 4 → [2, 2], 7 → [3, 2, 2])
      poules[poules.length - 1] = 2;
      poules.push(2);
    } else {
      // One poule becomes 4 (e.g. 7 → [3, 4])
      poules[poules.length - 1] = 4;
    }
  } else if (remainder === 2) {
    if (allowPouleOf2) {
      // Add an extra poule of 2 (e.g. 8 → [3, 3, 2])
      poules.push(2);
    } else {
      // Last poule absorbs +2 → becomes 5 (e.g. 8 → [3, 5])
      poules[poules.length - 1] = 5;
    }
  }

  return {
    poules,
    tables: computeTablesNeeded(poules),
    minPlayers,
    description: formatPouleDescription(poules)
  };
}

/**
 * Get poule configuration for a player count, respecting org settings.
 * Async wrapper that reads the org's allow_poule_of_2 and single_poule_threshold settings.
 *
 * V 2.0.747 — When numPlayers < single_poule_threshold, a single poule is forced
 * regardless of allow_poule_of_2 (e.g. 5 players → [5], not [3, 2]).
 *
 * V 2.0.789 — Optional `mode` argument selects the per-mode override for
 * Quilles (allow_poule_of_2_5q / allow_poule_of_2_9q). The LBIF règlement
 * may differ between the two disciplines, hence the split. Carambole modes
 * (or absence of mode) keep the global allow_poule_of_2.
 *
 * @param {number} numPlayers
 * @param {number|null} orgId
 * @param {string} [mode] - tournament mode ('5Q' / '9Q' / carambole)
 * @returns {Promise<{ poules: number[], tables: number, minPlayers: number, description: string }>}
 */
async function getPouleConfigForOrg(numPlayers, orgId, mode) {
  const appSettings = require('./app-settings');

  // Determine the allow_poule_of_2 setting key based on mode
  const modeUpper = String(mode || '').toUpperCase();
  let allowKey = 'allow_poule_of_2';
  if (modeUpper === '5Q' || modeUpper === '5 QUILLES') allowKey = 'allow_poule_of_2_5q';
  else if (modeUpper === '9Q' || modeUpper === '9 QUILLES') allowKey = 'allow_poule_of_2_9q';

  const [rawAllow, rawThreshold] = await Promise.all([
    orgId
      ? appSettings.getOrgSetting(orgId, allowKey)
      : appSettings.getSetting(allowKey),
    orgId
      ? appSettings.getOrgSetting(orgId, 'single_poule_threshold')
      : appSettings.getSetting('single_poule_threshold')
  ]);

  const allowPouleOf2 = rawAllow === 'true';
  const singlePouleThreshold = parseInt(rawThreshold) || 6;

  // Force a single poule when below the threshold — overrides allow_poule_of_2
  if (numPlayers > 0 && numPlayers < singlePouleThreshold) {
    const poules = [numPlayers];
    return {
      poules,
      tables: computeTablesNeeded(poules),
      minPlayers: allowPouleOf2 ? 2 : 3,
      description: formatPouleDescription(poules)
    };
  }

  return computePouleConfiguration(numPlayers, allowPouleOf2);
}

module.exports = {
  computePouleConfiguration,
  computeTablesNeeded,
  formatPouleDescription,
  getPouleConfigForOrg
};
