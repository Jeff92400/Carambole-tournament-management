/**
 * Seasonal Calendar Generator — Phase 5a
 *
 * Deterministic greedy engine that places tournaments on weekends.
 *
 * Inputs:
 *   - brief: { season, qualif_day, final_day, first_weekend, blackout_dates[],
 *              active_categories[], active_hosts[], host_blackouts[],
 *              final_attribution }
 *   - constraints: [ { rule_type, parameters, strictness, weight, enabled } ]
 *   - ligueFinals: { [categoryId]: 'YYYY-MM-DD' }
 *   - categories: [ { id, game_type, level, display_name } ]
 *   - clubs: [ { id, display_name } ]
 *
 * Outputs:
 *   - placements: [ { category_id, tournament_type, host_id, weekend_date,
 *                      qualif_date, final_date } ]
 *   - conflicts: [ { category_id, category_label, tournament_type, reason } ]
 */

const DAY_INDEX = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 0
};

const MODE_DISPLAY_ORDER = ['Libre', 'Cadre', 'Bande', '3 Bandes'];
// Levels canonical order (lowest # = highest level). For PLACEMENT we sort
// descending (highest # first, e.g. R5 placed before N3).
const LEVEL_RANK = {
  N1: 1, N2: 2, N3: 3,
  R1: 4, R2: 5, R3: 6, R4: 7, R5: 8,
  D1: 9, D2: 10, D3: 11,
  NC: 99
};

function levelRank(level) {
  if (!level) return 50;
  // Strip "GC" or other suffixes
  const key = String(level).toUpperCase().replace(/\s+/g, '').replace(/GC$/, '');
  return LEVEL_RANK[key] ?? 50;
}

function modeRank(mode) {
  const idx = MODE_DISPLAY_ORDER.findIndex(m => m.toLowerCase() === String(mode || '').toLowerCase());
  return idx === -1 ? 99 : idx;
}

// Order categories for PLACEMENT (cascade-friendly):
//   - mode in canonical order
//   - within each mode, level descending (R5 first, N3 last)
function orderCategoriesForPlacement(cats) {
  return [...cats].sort((a, b) => {
    const ma = modeRank(a.game_type);
    const mb = modeRank(b.game_type);
    if (ma !== mb) return ma - mb;
    return levelRank(b.level) - levelRank(a.level); // descending
  });
}

// Order categories for DISPLAY (canonical CDBHS order: highest level first)
function orderCategoriesForDisplay(cats) {
  return [...cats].sort((a, b) => {
    const ma = modeRank(a.game_type);
    const mb = modeRank(b.game_type);
    if (ma !== mb) return ma - mb;
    return levelRank(a.level) - levelRank(b.level); // ascending (N3 before R1)
  });
}

function toISODateString(s) {
  // Normalize any input (Date object, ISO string, "YYYY-MM-DDT...", etc.) to "YYYY-MM-DD"
  if (s == null) return null;
  if (s instanceof Date) {
    if (isNaN(s.getTime())) return null;
    return s.toISOString().slice(0, 10);
  }
  const str = String(s);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Fallback: try Date parsing
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseISODate(s) {
  const iso = toISODateString(s);
  if (!iso) return null;
  return new Date(iso + 'T00:00:00Z');
}
function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function weekDiff(dateA, dateB) {
  const ms = Math.abs(parseISODate(dateA) - parseISODate(dateB));
  return Math.round(ms / (7 * 24 * 3600 * 1000));
}

// Generate weekends from first_weekend to ~1 year later.
// A "weekend" carries both the qualif date and the final date based on brief.
function computeWeekends(brief) {
  const startD = parseISODate(brief.first_weekend);
  if (!startD) throw new Error('first_weekend invalide ou manquant dans le brief');
  const qualifDayIdx = DAY_INDEX[brief.qualif_day] ?? 6;
  const finalDayIdx = DAY_INDEX[brief.final_day] ?? 6;

  // Align startD to the qualif day of that week
  const startDow = startD.getUTCDay();
  let alignDelta = qualifDayIdx - startDow;
  if (alignDelta < 0) alignDelta += 7;
  const firstQualif = addDays(startD, alignDelta);

  // We use Saturday-of-the-week as the canonical "weekend_date" key for grouping
  const blackouts = new Set((brief.blackout_dates || []).map(toISODateString).filter(Boolean));

  const weekends = [];
  const cursor = new Date(firstQualif.getTime());
  for (let i = 0; i < 52; i++) {
    const qualifDate = new Date(cursor.getTime());
    // Compute final date in same week (always within the same Mon-Sun week)
    const dow = qualifDate.getUTCDay();
    const mondayOfWeek = addDays(qualifDate, -((dow + 6) % 7));
    let finalDayOffset = (finalDayIdx + 6) % 7; // distance from Monday
    const finalDate = addDays(mondayOfWeek, finalDayOffset);
    const weekendKey = fmtISO(addDays(mondayOfWeek, 5)); // Saturday as canonical key

    const qualifISO = fmtISO(qualifDate);
    const finalISO = fmtISO(finalDate);

    weekends.push({
      weekend_date: weekendKey,
      qualif_date: qualifISO,
      final_date: finalISO,
      qualif_blackout: blackouts.has(qualifISO),
      final_blackout: blackouts.has(finalISO)
    });

    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weekends;
}

// Index constraints by rule_type (only enabled ones)
function indexConstraints(constraints) {
  const map = {};
  for (const c of (constraints || [])) {
    if (c.enabled === false) continue;
    map[c.rule_type] = c;
  }
  return map;
}

// Get a constraint param with a fallback
function param(c, key, dflt) {
  if (!c) return dflt;
  const p = c.parameters || {};
  return p[key] !== undefined ? p[key] : dflt;
}

// Hard date-level checks (independent of host)
function isDateAllowed({
  cat, ttype, date, isFinale, brief, cmap, ligueFinals, alreadyPlaced
}) {
  // 1. Blackout
  const blackouts = new Set((brief.blackout_dates || []).map(toISODateString).filter(Boolean));
  if (blackouts.has(date)) return { ok: false, reason: 'date en blackout' };

  // 2. season_start_after
  const startAfter = toISODateString(param(cmap.season_start_after, 'first_weekend', brief.first_weekend));
  if (startAfter && date < startAfter) {
    return { ok: false, reason: 'avant le premier week-end' };
  }

  // 2 bis. season_end_before — last possible competition weekend (built-in, brief-driven)
  const endBefore = toISODateString(brief.last_weekend);
  if (endBefore && date > endBefore) {
    return { ok: false, reason: 'après le dernier week-end de compétition' };
  }

  // 2 ter. LOOK-AHEAD personal deadline: ensure remaining tournaments of this
  // category can still fit before the season cap (and before ligue final if any).
  if (endBefore) {
    const minWeeksSame = param(cmap.min_weeks_between_tournaments_same_category, 'min_weeks', 3);
    const minWeeksT3F = param(cmap.min_weeks_between_t3_and_final, 'min_weeks', 2);
    const remainingWeeks = ({
      T1: 2 * minWeeksSame + minWeeksT3F, // T2, T3, then Finale
      T2: 1 * minWeeksSame + minWeeksT3F, // T3, then Finale
      T3: minWeeksT3F,                    // Finale
      Finale: 0
    })[ttype] ?? 0;
    if (remainingWeeks > 0) {
      const personalDeadline = addDays(parseISODate(endBefore), -7 * remainingWeeks);
      if (parseISODate(date) > personalDeadline) {
        return { ok: false, reason: `trop tard pour caser les ${remainingWeeks / minWeeksSame | 0}+ tournoi(s) restant(s) avant la date butoir` };
      }
    }
  }
  // Same look-ahead for ligue final (Finale must precede it, T3 must precede Finale, etc.)
  if (ligueFinals && ligueFinals[cat.id]) {
    const ligueDate = toISODateString(ligueFinals[cat.id]);
    if (ligueDate) {
      const minWeeksLigue = param(cmap.min_weeks_between_cdb_and_ligue_final, 'min_weeks', 2);
      const minWeeksT3F = param(cmap.min_weeks_between_t3_and_final, 'min_weeks', 2);
      const minWeeksSame = param(cmap.min_weeks_between_tournaments_same_category, 'min_weeks', 3);
      const remainingFromLigue = ({
        T1: 2 * minWeeksSame + minWeeksT3F + minWeeksLigue,
        T2: 1 * minWeeksSame + minWeeksT3F + minWeeksLigue,
        T3: minWeeksT3F + minWeeksLigue,
        Finale: minWeeksLigue
      })[ttype] ?? 0;
      if (remainingFromLigue > 0) {
        const ligueDeadline = addDays(parseISODate(ligueDate), -7 * remainingFromLigue);
        if (parseISODate(date) > ligueDeadline) {
          return { ok: false, reason: `trop tard avant la finale ligue (${ligueDate})` };
        }
      }
    }
  }

  // 3. min_weeks_between_tournaments_same_category
  const minWeeksSame = param(cmap.min_weeks_between_tournaments_same_category, 'min_weeks', 3);
  const previousSameCat = alreadyPlaced.filter(p => p.category_id === cat.id);
  for (const prev of previousSameCat) {
    const prevDate = prev.qualif_date || prev.final_date;
    if (weekDiff(date, prevDate) < minWeeksSame) {
      return { ok: false, reason: `< ${minWeeksSame} sem. depuis ${prev.tournament_type}` };
    }
  }

  // 4. min_weeks_between_t3_and_final (only when placing Finale)
  if (ttype === 'Finale') {
    const minWeeksT3 = param(cmap.min_weeks_between_t3_and_final, 'min_weeks', 2);
    const t3 = previousSameCat.find(p => p.tournament_type === 'T3');
    if (t3) {
      const t3Date = t3.qualif_date || t3.final_date;
      if (weekDiff(date, t3Date) < minWeeksT3) {
        return { ok: false, reason: `< ${minWeeksT3} sem. depuis T3` };
      }
      if (parseISODate(date) <= parseISODate(t3Date)) {
        return { ok: false, reason: 'Finale placée avant T3' };
      }
    }
  }

  // 4 bis. Cascade rule (T1 only): T1 of a weaker category must be strictly
  // before T1 of a stronger category within the same mode.
  // Weaker = higher LEVEL_RANK number (R4=7 > R3=6 > R2=5 > R1=4 > N3=3)
  if (ttype === 'T1') {
    const myRank = levelRank(cat.level);
    const myMode = String(cat.game_type || '').toLowerCase();
    const weakerT1sSameMode = alreadyPlaced.filter(p =>
      p.tournament_type === 'T1' &&
      String(p._mode || '').toLowerCase() === myMode &&
      p._levelRank > myRank // strictly weaker than current
    );
    for (const prev of weakerT1sSameMode) {
      const prevDate = prev.qualif_date || prev.final_date;
      if (parseISODate(date) <= parseISODate(prevDate)) {
        return { ok: false, reason: `cascade T1 : doit être après ${prev._categoryLabel || 'catégorie inférieure'}` };
      }
    }
  }

  // 5. Strict ordering T1 < T2 < T3 < Finale within same category
  const ORDER_RANK = { T1: 1, T2: 2, T3: 3, Finale: 4 };
  for (const prev of previousSameCat) {
    if (ORDER_RANK[prev.tournament_type] < ORDER_RANK[ttype]) {
      const prevDate = prev.qualif_date || prev.final_date;
      if (parseISODate(date) <= parseISODate(prevDate)) {
        return { ok: false, reason: `${ttype} placé avant ${prev.tournament_type}` };
      }
    }
  }

  // 6. Finale before ligue final (if defined)
  if (ttype === 'Finale' && ligueFinals && ligueFinals[cat.id]) {
    const minWeeksLigue = param(cmap.min_weeks_between_cdb_and_ligue_final, 'min_weeks', 2);
    const ligueDate = toISODateString(ligueFinals[cat.id]);
    if (!ligueDate) return { ok: true };
    if (parseISODate(date) >= parseISODate(ligueDate)) {
      return { ok: false, reason: 'après finale ligue' };
    }
    if (weekDiff(date, ligueDate) < minWeeksLigue) {
      return { ok: false, reason: `< ${minWeeksLigue} sem. avant finale ligue` };
    }
  }

  return { ok: true };
}

// Hard host-level checks
function isHostAllowed({ host, date, weekendDate, brief, alreadyPlaced }) {
  if (!host) return { ok: true }; // null host = winner_tbd Finale

  // host_blackouts (per-club unavailability windows)
  const hostBlackouts = (brief.host_blackouts || []).filter(hb => Number(hb.host_id) === Number(host.id));
  for (const hb of hostBlackouts) {
    const start = toISODateString(hb.start_date);
    const end = toISODateString(hb.end_date);
    if (!start || !end) continue;
    if (date >= start && date <= end) {
      return { ok: false, reason: `${host.display_name} indispo (${start} → ${end})` };
    }
  }

  // host_no_double_booking: same host on same weekend
  const sameWE = alreadyPlaced.find(p => p.host_id === host.id && p.weekend_date === weekendDate);
  if (sameWE) {
    return { ok: false, reason: `${host.display_name} déjà occupé ce week-end` };
  }

  return { ok: true };
}

// Soft scoring (lower = better)
function scoreSoft({ cat, ttype, host, date, weekendDate, alreadyPlaced, cmap, brief }) {
  let score = 0;

  // host_balanced_load: prefer hosts with fewer tournaments so far
  if (host && cmap.host_balanced_load) {
    const loadW = cmap.host_balanced_load.weight ?? 5;
    const hostLoad = alreadyPlaced.filter(p => p.host_id === host.id).length;
    score += loadW * hostLoad;
  }

  // host_no_consecutive_weekends: penalize if host had tournament in adjacent WE
  if (host && cmap.host_no_consecutive_weekends) {
    const w = cmap.host_no_consecutive_weekends.weight ?? 3;
    const adjacent = alreadyPlaced.some(p =>
      p.host_id === host.id &&
      Math.abs(weekDiff(p.weekend_date, weekendDate)) === 1
    );
    if (adjacent) score += w * 10;
  }

  // weekend_spread: penalize crowded weekends (quadratic)
  if (cmap.weekend_spread) {
    const w = cmap.weekend_spread.weight ?? 5;
    const sameWE = alreadyPlaced.filter(p => p.weekend_date === weekendDate).length;
    score += w * sameWE * sameWE;
  }

  // mode_spread_evenly: penalize clustering of same mode in adjacent weekends
  if (cmap.mode_spread_evenly) {
    const w = cmap.mode_spread_evenly.weight ?? 2;
    const sameMode = alreadyPlaced.filter(p => p._mode === cat.game_type);
    for (const p of sameMode) {
      const d = weekDiff(p.weekend_date, weekendDate);
      if (d === 0) score += w * 5;
      else if (d === 1) score += w * 2;
    }
  }

  // T1 strategy — start as early as possible (respecting cascade already enforced as hard).
  if (ttype === 'T1') {
    const startISO = toISODateString(brief.first_weekend);
    if (startISO) {
      const offsetWeeks = weekDiff(date, startISO);
      score += 50 * offsetWeeks; // strong push toward earliest valid WE
    }
  } else {
    // T2/T3/Finale strategy — uniform ideal gap derived from T1 date, so that
    // Finale doesn't always converge to the season edge.
    // idealGap = (last_weekend - T1date) / 3   (3 transitions: T1→T2, T2→T3, T3→Finale)
    // Each category's Finale ends up at ~T1 + 3 × idealGap, naturally spread
    // because T1s themselves are spread across the cascade.
    const sameCat = alreadyPlaced.filter(p => p.category_id === cat.id);
    const t1 = sameCat.find(p => p.tournament_type === 'T1');
    const last = sameCat[sameCat.length - 1];
    const seasonEnd = toISODateString(brief.last_weekend);
    if (t1 && last && seasonEnd) {
      const t1Date = t1.qualif_date || t1.final_date;
      const lastDate = last.qualif_date || last.final_date;
      const totalSpan = Math.max(0, weekDiff(t1Date, seasonEnd));
      const idealGap = Math.max(3, totalSpan / 3);
      const actualGap = weekDiff(date, lastDate);
      const deviation = Math.abs(actualGap - idealGap);
      score += 30 * deviation;
    }
  }

  // Earliness tie-break (very small, deterministic)
  score += parseISODate(date).getTime() / 1e15;

  return score;
}

function placeOne({ cat, ttype, weekends, hosts, brief, cmap, ligueFinals, alreadyPlaced }) {
  const isFinale = ttype === 'Finale';
  const candidates = [];
  const reasonCounts = {}; // { reason: count } for diagnostics
  const bumpReason = (r) => { reasonCounts[r] = (reasonCounts[r] || 0) + 1; };

  for (const wk of weekends) {
    const date = isFinale ? wk.final_date : wk.qualif_date;
    const blackedOut = isFinale ? wk.final_blackout : wk.qualif_blackout;
    if (blackedOut) { bumpReason('week-end blackout'); continue; }

    const dateCheck = isDateAllowed({ cat, ttype, date, isFinale, brief, cmap, ligueFinals, alreadyPlaced });
    if (!dateCheck.ok) {
      bumpReason(dateCheck.reason);
      continue;
    }

    // Hard check: max tournaments per weekend (any host)
    const maxPerWE = param(cmap.max_tournaments_per_weekend, 'max', null);
    if (maxPerWE != null) {
      const sameWE = alreadyPlaced.filter(p => p.weekend_date === wk.weekend_date).length;
      if (sameWE >= maxPerWE) {
        bumpReason(`${maxPerWE} tournois déjà sur ce WE (max atteint)`);
        continue;
      }
    }

    if (isFinale && brief.final_attribution === 'winner_tbd') {
      candidates.push({
        date, weekendDate: wk.weekend_date, host: null,
        score: scoreSoft({ cat, ttype, host: null, date, weekendDate: wk.weekend_date, alreadyPlaced, cmap, brief })
      });
    } else {
      let anyHostOK = false;
      for (const host of hosts) {
        const hostCheck = isHostAllowed({ host, date, weekendDate: wk.weekend_date, brief, alreadyPlaced });
        if (!hostCheck.ok) continue;
        anyHostOK = true;
        candidates.push({
          date, weekendDate: wk.weekend_date, host,
          score: scoreSoft({ cat, ttype, host, date, weekendDate: wk.weekend_date, alreadyPlaced, cmap, brief })
        });
      }
      if (!anyHostOK) bumpReason('aucun club hôte disponible (tous occupés ou indisponibles)');
    }
  }

  if (!candidates.length) {
    const totalRejected = Object.values(reasonCounts).reduce((a, b) => a + b, 0);
    const sortedReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
    const summary = sortedReasons.map(([r, n]) => `${n}× ${r}`).join(' · ');
    const reason = totalRejected
      ? `${totalRejected} créneau(x) testé(s), tous rejetés : ${summary}`
      : 'Aucun créneau disponible (saison vide ?)';
    return { placement: null, reason };
  }

  candidates.sort((a, b) => a.score - b.score || a.date.localeCompare(b.date));
  const best = candidates[0];

  return {
    placement: {
      category_id: cat.id,
      tournament_type: ttype,
      host_id: best.host?.id || null,
      host_name: best.host?.display_name || null,
      weekend_date: best.weekendDate,
      qualif_date: isFinale ? null : best.date,
      final_date: isFinale ? best.date : null,
      _mode: cat.game_type,
      _levelRank: levelRank(cat.level),
      _categoryLabel: cat.display_name
    }
  };
}

function generateCalendar({ brief, constraints, ligueFinals, categories, clubs }) {
  const cmap = indexConstraints(constraints);
  const weekends = computeWeekends(brief);
  const activeCats = categories.filter(c => (brief.active_categories || []).includes(c.id));
  const orderedCats = orderCategoriesForPlacement(activeCats);
  const activeHosts = clubs.filter(c => (brief.active_hosts || []).includes(c.id));

  const placements = [];
  const conflicts = [];
  const tournamentTypes = ['T1', 'T2', 'T3', 'Finale'];

  for (const cat of orderedCats) {
    for (const ttype of tournamentTypes) {
      const result = placeOne({
        cat, ttype, weekends, hosts: activeHosts, brief, cmap, ligueFinals, alreadyPlaced: placements
      });
      if (result.placement) {
        placements.push(result.placement);
      } else {
        conflicts.push({
          category_id: cat.id,
          category_label: cat.display_name,
          tournament_type: ttype,
          reason: result.reason
        });
      }
    }
  }

  return {
    placements: placements.map(p => {
      const { _mode, _levelRank, _categoryLabel, ...rest } = p;
      return rest;
    }),
    conflicts,
    stats: {
      total_categories: activeCats.length,
      total_placed: placements.length,
      total_expected: activeCats.length * 4,
      total_conflicts: conflicts.length
    }
  };
}

module.exports = {
  generateCalendar,
  orderCategoriesForDisplay,
  orderCategoriesForPlacement,
  // Exposed for tests
  _internals: {
    levelRank, modeRank, computeWeekends, weekDiff
  }
};
