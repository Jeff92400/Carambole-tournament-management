// calendar-views.js — shared rendering for the calendar views (Seasonal / Compact / Hosts)
// Used by calendar-generator.html (Step 3) and calendar.html (calendar hub).
//
// V 2.0.616 — Seasonal view fully aligned with the wizard's Saison-publiée look:
//   round-coloured cells (T1/T2/T3/F/FL pastel + matching dark accent text),
//   full season enumeration (every Saturday Sept→June),
//   Sat/Sun dual rows ("S NN" / "D NN"),
//   alternating monthly column tints + 3px purple month dividers,
//   thin row dividers (1px) between same-mode levels, thick (2px) on mode change,
//   filled round-legend pills + textual host abbreviation list.
//
// Public API:
//   CalendarViews.render(containers, result, referenceData, opts)
//     containers = { seasonal, compact, hosts, viewSelector? }
//     result     = { placements: [...], conflicts?, brief? }
//     referenceData = { categories: [{id, mode|game_type, level, display_name|name}] }
//     opts       = { showEditHint, onCellClick }
//   CalendarViews.switchView(containers, viewName)

(function () {
  const MODE_DISPLAY_ORDER = ['Libre', 'Cadre', 'Bande', '3 Bandes'];
  const LEVEL_DISPLAY_RANK = { N1: 1, N2: 2, N3: 3, R1: 4, R2: 5, R3: 6, R4: 7, R5: 8, D1: 9, D2: 10, D3: 11, NC: 99 };

  // Round-type palette (cell bg / border / accent text). Mirrors the
  // wizard exactly so the two visual tracks stay in sync.
  const ROUND_COLOURS = {
    T1: { bg: '#d4edda', border: '#7bc596', text: '#1b5e20' },
    T2: { bg: '#d4e6f7', border: '#7fb3e0', text: '#0d47a1' },
    T3: { bg: '#fce4d3', border: '#e8a877', text: '#bf360c' },
    F:  { bg: '#e6dcf2', border: '#b39bd9', text: '#4a148c' },
    FL: { bg: 'repeating-linear-gradient(135deg, #fff4e0, #fff4e0 6px, #ffe5b8 6px, #ffe5b8 12px)',
          border: '#c47b00', text: '#8a4a00' }
  };
  const MONTH_TINTS = ['#ffffff', '#f0ecf6'];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDateFR(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
  }
  function dispLevelRank(lvl) {
    const k = String(lvl || '').toUpperCase().replace(/\s+/g, '').replace(/GC$/, '');
    return LEVEL_DISPLAY_RANK[k] ?? 50;
  }
  function dispModeRank(m) {
    const i = MODE_DISPLAY_ORDER.findIndex(x => x.toLowerCase() === String(m || '').toLowerCase());
    return i === -1 ? 99 : i;
  }
  function abbreviateHost(name) {
    if (!name) return '';
    const w = String(name).split(/\s+/).filter(x => x.length > 1);
    if (!w.length) return name.slice(0, 4).toUpperCase();
    if (w.length === 1) return w[0].slice(0, 4).toUpperCase();
    return w.map(x => x[0]).join('').slice(0, 5).toUpperCase();
  }
  function categoryName(c) {
    return c?.name || c?.display_name || '';
  }

  // Round helpers — handle the `Finale` / `LIGUE_FINALE` aliases.
  function roundKey(t) {
    if (!t) return null;
    if (t === 'LIGUE_FINALE') return 'FL';
    if (t === 'Finale')       return 'F';
    return t;
  }
  function roundCellBg(t)     { const k = roundKey(t); return (k && ROUND_COLOURS[k]) ? ROUND_COLOURS[k].bg : '#fff'; }
  function roundColour(t)     { const k = roundKey(t); return (k && ROUND_COLOURS[k]) ? ROUND_COLOURS[k].text : '#222'; }
  function roundLabel(t)      { return roundKey(t) || ''; }

  // Enumerate every Saturday between two ISO dates (inclusive).
  function enumerateSaturdays(startISO, endISO) {
    if (!startISO || !endISO) return [];
    const start = new Date(startISO + 'T00:00:00Z');
    const end   = new Date(endISO   + 'T00:00:00Z');
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const cur = new Date(start);
    while (cur.getUTCDay() !== 6) cur.setUTCDate(cur.getUTCDate() + 1);
    const out = [];
    while (cur <= end) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
    return out;
  }

  // Resolve the season window for the column axis. Prefers brief dates;
  // falls back to Sept 1 → June 30 of the season inferred from the
  // earliest placement; final fallback is the union of placement dates.
  function resolveSeasonWindow(brief, placements) {
    const dates = [...new Set((placements || []).map(p => p.weekend_date).filter(Boolean))].sort();
    let start = brief && brief.first_weekend ? String(brief.first_weekend).slice(0, 10) : null;
    let end   = brief && brief.last_weekend  ? String(brief.last_weekend).slice(0, 10)  : null;
    if (!start || !end) {
      let y1 = null;
      if (brief && brief.season) {
        const m = String(brief.season).match(/^(\d{4})-(\d{4})$/);
        if (m) y1 = parseInt(m[1], 10);
      }
      if (y1 == null && dates.length) {
        const first = new Date(dates[0] + 'T00:00:00Z');
        y1 = first.getUTCMonth() >= 8 ? first.getUTCFullYear() : first.getUTCFullYear() - 1;
      }
      if (y1 != null) {
        if (!start) start = `${y1}-09-01`;
        if (!end)   end   = `${y1 + 1}-06-30`;
      }
    }
    if (!start && dates.length) start = dates[0];
    if (!end   && dates.length) end   = dates[dates.length - 1];
    return { start, end };
  }

  // Map each weekend ISO → 0/1 alternating with each new month.
  function buildMonthParityMap(weekends) {
    const map = {};
    let parity = 0;
    let lastKey = null;
    (weekends || []).forEach(we => {
      const d = new Date(we + 'T00:00:00Z');
      const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (lastKey !== null && k !== lastKey) parity = 1 - parity;
      lastKey = k;
      map[we] = parity;
    });
    return map;
  }

  function renderRoundLegend(includeFL) {
    const pill = (key, label) => {
      const c = ROUND_COLOURS[key];
      return `<span style="display:inline-block; padding: 4px 12px; border-radius: 14px; font-size: 12px; font-weight: 800; margin: 0 4px 4px 0; color: ${c.text}; border: 1.5px solid ${c.border}; background: ${c.bg};">${label}</span>`;
    };
    let html = '';
    html += pill('T1', 'T1 &nbsp;Tournoi 1');
    html += pill('T2', 'T2 &nbsp;Tournoi 2');
    html += pill('T3', 'T3 &nbsp;Tournoi 3');
    html += pill('F',  'F &nbsp;&nbsp;Finale');
    if (includeFL) html += pill('FL', 'FL &nbsp;Finale Ligue');
    return html;
  }

  function renderHostLegendText(placements) {
    const seen = new Map();
    (placements || []).forEach(p => {
      if (!p.host_name || p._is_ligue_final) return;
      const ab = abbreviateHost(p.host_name);
      if (ab && !seen.has(ab)) seen.set(ab, p.host_name);
    });
    if (seen.size === 0) return '<span style="font-size: 12px; color: #888; font-style: italic;">Aucun club hôte renseigné.</span>';
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ab, name]) =>
        `<span style="display:inline-block; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 0 6px 4px 0; background: #f4f1fa; border: 1px solid #dcd4ec; color: #3a2e5e;"><strong>${escapeHtml(ab)}</strong> = ${escapeHtml(name)}</span>`
      ).join('');
  }

  // ---------- Vue Compacte (unchanged) ----------
  function renderViewCompact(container, result, referenceData) {
    const byCatType = {};
    result.placements.forEach(p => {
      if (!byCatType[p.category_id]) byCatType[p.category_id] = {};
      byCatType[p.category_id][p.tournament_type] = p;
    });
    const allCatIds = new Set([
      ...result.placements.map(p => p.category_id),
      ...((result.conflicts || []).map(c => c.category_id))
    ]);
    const cats = (referenceData.categories || []).filter(c => allCatIds.has(c.id));
    cats.sort((a, b) => {
      const ma = dispModeRank(a.mode || a.game_type);
      const mb = dispModeRank(b.mode || b.game_type);
      if (ma !== mb) return ma - mb;
      return dispLevelRank(a.level) - dispLevelRank(b.level);
    });
    const rows = cats.map(c => {
      const cells = ['T1', 'T2', 'T3', 'Finale'].map(tt => {
        const p = byCatType[c.id]?.[tt];
        if (!p) return `<td style="padding: 6px 10px; color: #c00; background: #fff5f5;">—</td>`;
        const date = p.qualif_date || p.final_date || p.weekend_date;
        const host = p.host_name || (p.host_id == null ? '<em style="color:#888;">TBD</em>' : `#${p.host_id}`);
        return `<td style="padding: 6px 10px;"><div style="font-weight: 600;">${fmtDateFR(date)}</div><div style="font-size: 11px; color: #666;">${host}</div></td>`;
      }).join('');
      return `<tr><td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(categoryName(c))}</td>${cells}</tr>`;
    }).join('');
    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="ligue-table" style="width: 100%;">
          <thead>
            <tr><th>Catégorie</th><th>T1</th><th>T2</th><th>T3</th><th>Finale</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" style="color:#888;">Aucun résultat.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  // ---------- Vue Calendrier (V 2.0.616 — poster-quality) ----------
  function renderViewSeasonal(container, result, referenceData, opts = {}) {
    const placements = result.placements || [];
    const allCatIds = new Set(placements.map(p => p.category_id));
    const cats = (referenceData.categories || []).filter(c => allCatIds.has(c.id));
    cats.sort((a, b) => {
      const ma = dispModeRank(a.mode || a.game_type);
      const mb = dispModeRank(b.mode || b.game_type);
      if (ma !== mb) return ma - mb;
      return dispLevelRank(a.level) - dispLevelRank(b.level);
    });

    // Full season enumeration — every Saturday between brief.first_weekend
    // and brief.last_weekend (or Sept 1 → June 30 fallback).
    const win = resolveSeasonWindow(result.brief, placements);
    let weekends = enumerateSaturdays(win.start, win.end);
    const placementDates = [...new Set(placements.map(p => p.weekend_date).filter(Boolean))];
    if (weekends.length === 0) {
      weekends = placementDates.sort();
    } else {
      const set = new Set(weekends);
      placementDates.forEach(d => { if (!set.has(d)) set.add(d); });
      weekends = [...set].sort();
    }

    const grid = {};
    placements.forEach(p => {
      if (!grid[p.category_id]) grid[p.category_id] = {};
      grid[p.category_id][p.weekend_date] = p;
    });
    const monthParityMap = buildMonthParityMap(weekends);
    const hasLF = placements.some(p => p._is_ligue_final || p.tournament_type === 'LIGUE_FINALE');

    // Month bands.
    const monthGroups = [];
    weekends.forEach(we => {
      const d = new Date(we + 'T00:00:00Z');
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      if (!monthGroups.length || monthGroups[monthGroups.length - 1].key !== key) {
        monthGroups.push({ key, label, count: 1 });
      } else {
        monthGroups[monthGroups.length - 1].count++;
      }
    });
    const monthBandCells = monthGroups.map((g, idx) => {
      const tint = idx % 2 === 0 ? '#5a3094' : '#7d52b8';
      return `<th colspan="${g.count}" style="padding: 5px 6px; font-size: 11px; font-weight: 700; background: ${tint}; color: white; text-transform: capitalize; border-right: 2px solid white; letter-spacing: 0.3px;">${escapeHtml(g.label)}</th>`;
    }).join('');

    // Sat / Sun dual rows.
    const satRow = weekends.map((we, i) => {
      const d = new Date(we + 'T00:00:00Z');
      const prev = i > 0 ? new Date(weekends[i - 1] + 'T00:00:00Z') : null;
      const monthChange = prev && prev.getUTCMonth() !== d.getUTCMonth();
      const leftBorder = monthChange ? 'border-left: 3px solid #5a3094;' : '';
      return `<th style="padding: 3px 6px; font-size: 11px; min-width: 56px; white-space: nowrap; background: #6b3aa3; color: white; ${leftBorder}"><span style="opacity: 0.7; font-weight: 500;">S</span> ${String(d.getUTCDate()).padStart(2,'0')}</th>`;
    }).join('');
    const sunRow = weekends.map((we, i) => {
      const d = new Date(we + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      const prev = i > 0 ? new Date(weekends[i - 1] + 'T00:00:00Z') : null;
      const sat = new Date(weekends[i] + 'T00:00:00Z');
      const monthChange = prev && prev.getUTCMonth() !== sat.getUTCMonth();
      const leftBorder = monthChange ? 'border-left: 3px solid #5a3094;' : '';
      return `<th style="padding: 3px 6px; font-size: 11px; min-width: 56px; white-space: nowrap; background: #7d52b8; color: white; font-weight: 500; ${leftBorder}"><span style="opacity: 0.7;">D</span> ${String(d.getUTCDate()).padStart(2,'0')}</th>`;
    }).join('');

    // Data rows.
    let prevMode = null;
    const rows = cats.map((c, ci) => {
      const curMode = c.game_type || c.mode || '';
      const modeChange = prevMode !== null && prevMode !== curMode;
      prevMode = curMode;
      const rowBorder = ci === 0
        ? ''
        : (modeChange ? 'border-top: 2px solid #6b3aa3;' : 'border-top: 1px solid #e0e0e0;');
      const cells = weekends.map((we, i) => {
        const prev = i > 0 ? new Date(weekends[i - 1] + 'T00:00:00Z') : null;
        const cur = new Date(we + 'T00:00:00Z');
        const monthChange = prev && prev.getUTCMonth() !== cur.getUTCMonth();
        const leftBorder = monthChange ? 'border-left: 3px solid #5a3094;' : '';
        const monthBg = MONTH_TINTS[monthParityMap[we] || 0];
        const p = grid[c.id]?.[we];
        if (!p) return `<td style="padding: 4px 6px; background: ${monthBg}; ${leftBorder}"></td>`;

        // Ligue final cells keep the diagonal-stripe orange treatment.
        if (p._is_ligue_final || p.tournament_type === 'LIGUE_FINALE') {
          const tipLF = `Finale Ligue ${categoryName(c)}\n${fmtDateFR(p.weekend_date)}\nLieu : TBD (à renseigner par la Ligue)`;
          return `<td style="padding: 4px 6px; background: ${ROUND_COLOURS.FL.bg}; text-align: center; font-size: 11px; border: 1.5px solid ${ROUND_COLOURS.FL.border}; ${leftBorder}" title="${escapeHtml(tipLF)}">
            <div style="font-weight: 800; color: ${ROUND_COLOURS.FL.text};">FL</div>
            <div style="font-size: 9px; color: ${ROUND_COLOURS.FL.text};">Ligue</div>
          </td>`;
        }

        const bg = roundCellBg(p.tournament_type);
        const lockedRing = p._locked ? 'box-shadow: inset 0 0 0 2px #c47b00;' : '';
        const editable = p._draft_id ? 'cursor: pointer;' : '';
        const tip = `${categoryName(c)} ${p.tournament_type}\n${fmtDateFR(p.qualif_date || p.final_date || p.weekend_date)}\n${p.host_name || 'TBD'}${p._comment ? '\n💬 ' + p._comment : ''}${p._draft_id ? '\n(clic pour modifier)' : ''}`;
        const lockIcon = p._locked ? '🔒 ' : '';
        const commentIcon = p._comment ? '💬' : '';
        return `<td class="cv-cell-editable" data-draft-id="${p._draft_id || ''}" data-cat-id="${c.id}" style="padding: 4px 6px; background: ${bg}; text-align: center; font-size: 11px; ${lockedRing} ${leftBorder} ${editable}" title="${escapeHtml(tip)}">
          <div style="font-weight: 800; font-size: 12px; color: ${roundColour(p.tournament_type)}; line-height: 1.1;">${lockIcon}${roundLabel(p.tournament_type)}${commentIcon}</div>
          <div style="font-size: 9px; color: #444; font-weight: 600; margin-top: 2px;">${escapeHtml(abbreviateHost(p.host_name) || (p.host_id == null ? 'TBD' : ''))}</div>
        </td>`;
      }).join('');
      return `<tr style="${rowBorder}"><td style="padding: 6px 10px; font-weight: 600; position: sticky; left: 0; background: #fff; z-index: 1; border-right: 2px solid #ccc; ${rowBorder}">${escapeHtml(categoryName(c))}</td>${cells}</tr>`;
    }).join('');

    const editHint = opts.showEditHint
      ? `<div style="font-size: 13px; color: #2c5530; background: #e8f5e9; border: 1px solid #a5d6a7; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px;">
          ✏️ <strong>Modification manuelle</strong> : cliquez sur n'importe quelle cellule remplie pour <strong>changer la date, le club hôte, ajouter un commentaire</strong> ou verrouiller la case 🔒.
        </div>`
      : '';

    container.innerHTML = `
      ${editHint}
      <div style="overflow-x: auto; max-width: 100%; border: 1px solid #ddd; border-radius: 4px;">
        <table style="border-collapse: collapse; min-width: 100%;">
          <thead style="background: linear-gradient(135deg, #6b3aa3, #5a3094); color: white; position: sticky; top: 0; z-index: 2;">
            <tr>
              <th rowspan="3" style="padding: 6px 10px; text-align: left; position: sticky; left: 0; background: #6b3aa3; z-index: 3; min-width: 160px; vertical-align: middle;">Catégorie</th>
              ${monthBandCells}
            </tr>
            <tr>${satRow}</tr>
            <tr>${sunRow}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top: 12px;">
        <strong style="font-size: 13px; color: #555;">Légende tournois :</strong>
        ${renderRoundLegend(hasLF)}
      </div>
      <div style="margin-top: 6px;">
        <strong style="font-size: 13px; color: #555;">Clubs hôtes :</strong>
        ${renderHostLegendText(placements)}
      </div>
    `;

    if (opts.onCellClick) {
      container.querySelectorAll('.cv-cell-editable[data-draft-id]:not([data-draft-id=""])').forEach(td => {
        td.addEventListener('click', () => opts.onCellClick(parseInt(td.dataset.draftId, 10)));
      });
    }
  }

  // ---------- Vue Hôtes (unchanged) ----------
  function renderViewHosts(container, result) {
    const placedWithHost = result.placements.filter(p => p.host_id);
    if (!placedWithHost.length) {
      container.innerHTML = '<p style="color: #888;">Aucun tournoi avec club hôte assigné.</p>';
      return;
    }
    const byHost = {};
    const monthsSet = new Set();
    placedWithHost.forEach(p => {
      const m = String(p.weekend_date).slice(0, 7);
      monthsSet.add(m);
      if (!byHost[p.host_id]) byHost[p.host_id] = { name: p.host_name, months: {} };
      if (!byHost[p.host_id].months[m]) byHost[p.host_id].months[m] = [];
      byHost[p.host_id].months[m].push(p);
    });
    const months = [...monthsSet].sort();
    const monthLabel = (m) => {
      const [y, mm] = m.split('-');
      return new Date(+y, +mm - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    };
    const hosts = Object.entries(byHost).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const rows = hosts.map(([id, h]) => {
      const cells = months.map(m => {
        const items = h.months[m] || [];
        const total = items.length;
        const list = items.map(p => `<div style="font-size: 10px; padding: 1px 4px; background: #eee; border-radius: 3px; margin-bottom: 2px;">${escapeHtml(p.category_label || '')} ${p.tournament_type}</div>`).join('');
        return `<td style="padding: 4px; vertical-align: top; background: ${total > 2 ? '#fff5e6' : '#fff'};">
          ${total ? `<div style="font-size: 11px; font-weight: 600; color: #6b3aa3;">${total} tournoi(s)</div>${list}` : ''}
        </td>`;
      }).join('');
      const totalForHost = Object.values(h.months).reduce((a, arr) => a + arr.length, 0);
      return `<tr><td style="padding: 6px 10px; font-weight: 600; vertical-align: top;">${escapeHtml(h.name)}<div style="font-size: 11px; color: #888;">${totalForHost} au total</div></td>${cells}</tr>`;
    }).join('');
    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="ligue-table" style="min-width: 100%;">
          <thead>
            <tr><th>Club hôte</th>${months.map(m => `<th>${monthLabel(m)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function render(containers, result, referenceData, opts = {}) {
    if (containers.compact) renderViewCompact(containers.compact, result, referenceData);
    if (containers.seasonal) renderViewSeasonal(containers.seasonal, result, referenceData, opts);
    if (containers.hosts) renderViewHosts(containers.hosts, result);
  }

  function switchView(containers, name) {
    const map = { seasonal: containers.seasonal, compact: containers.compact, hosts: containers.hosts };
    Object.entries(map).forEach(([key, el]) => {
      if (el) el.style.display = (key === name) ? 'block' : 'none';
    });
    if (containers.viewSelector) {
      containers.viewSelector.querySelectorAll('[data-view]').forEach(btn => {
        const active = btn.dataset.view === name;
        btn.style.background = active ? '#6b3aa3' : 'white';
        btn.style.color = active ? 'white' : '#333';
      });
    }
  }

  window.CalendarViews = {
    render, switchView, renderViewCompact, renderViewSeasonal, renderViewHosts,
    escapeHtml, fmtDateFR
  };
})();
