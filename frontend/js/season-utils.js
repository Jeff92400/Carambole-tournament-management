/**
 * Season utilities — shared helper for dynamic season handling.
 *
 * Purpose: never hardcode a season string like '2025-2026' in frontend code.
 * Every dropdown/filter/label that mentions a season must derive it from here.
 *
 * Backend source of truth: GET /api/settings/current-season
 *   Returns { currentSeason, override, isOverridden }
 *   Respects the per-org `current_season_override` and `season_start_month` settings.
 *
 * Fallback (if fetch fails): client-side computation based on month >= 9
 *   (matches the default season_start_month of September).
 *
 * Caching: the result is cached for the page lifetime (no TTL needed — the season
 * only changes once a year).
 */

(function (global) {
  let cachedSeason = null;
  let fetchPromise = null;

  function computeLocalSeason(date) {
    const d = date || new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1-indexed
    return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }

  async function getCurrentSeason() {
    if (cachedSeason) return cachedSeason;
    if (fetchPromise) return fetchPromise;

    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;

    fetchPromise = (async () => {
      try {
        if (!token) throw new Error('no-token');
        const resp = await fetch('/api/settings/current-season', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error('http-' + resp.status);
        const data = await resp.json();
        cachedSeason = data.currentSeason || computeLocalSeason();
        return cachedSeason;
      } catch (err) {
        // Fallback: client-side computation (does not respect org override)
        cachedSeason = computeLocalSeason();
        return cachedSeason;
      } finally {
        fetchPromise = null;
      }
    })();

    return fetchPromise;
  }

  /**
   * Build a rolling list of seasons around the current one.
   * @param {string} currentSeason - e.g. "2025-2026"
   * @param {number} yearsBack - how many past seasons to include (default 1)
   * @param {number} yearsForward - how many future seasons to include (default 2)
   * @returns {string[]} e.g. ["2024-2025", "2025-2026", "2026-2027", "2027-2028"]
   */
  function buildSeasonList(currentSeason, yearsBack, yearsForward) {
    const back = (yearsBack == null) ? 1 : yearsBack;
    const forward = (yearsForward == null) ? 2 : yearsForward;
    const startYear = parseInt(currentSeason.split('-')[0], 10);
    const list = [];
    for (let y = startYear - back; y <= startYear + forward; y++) {
      list.push(`${y}-${y + 1}`);
    }
    return list;
  }

  /**
   * Populate a <select> element with a rolling season list.
   * @param {HTMLSelectElement} selectEl
   * @param {string} currentSeason
   * @param {object} opts - { yearsBack, yearsForward, selected, minSeason }
   */
  function populateSeasonSelect(selectEl, currentSeason, opts) {
    opts = opts || {};
    let list = buildSeasonList(currentSeason, opts.yearsBack, opts.yearsForward);
    if (opts.minSeason) {
      list = list.filter(s => s >= opts.minSeason);
    }
    const selected = opts.selected || currentSeason;
    selectEl.innerHTML = list.map(s =>
      `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`
    ).join('');
  }

  // Export
  global.SeasonUtils = {
    getCurrentSeason: getCurrentSeason,
    computeLocalSeason: computeLocalSeason,
    buildSeasonList: buildSeasonList,
    populateSeasonSelect: populateSeasonSelect
  };
})(typeof window !== 'undefined' ? window : this);
