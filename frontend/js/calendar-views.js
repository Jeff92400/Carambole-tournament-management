// calendar-views.js — shared rendering for the 3 calendar views (Seasonal / Compact / Hosts)
// Used by calendar-generator.html (Step 3) and calendar.html (calendar hub).
//
// Public API:
//   CalendarViews.render(containers, result, referenceData)
//     containers = { seasonal: el, compact: el, hosts: el, viewSelector: el? }
//     result     = { placements: [...], conflicts?, stats? }
//     referenceData = { categories: [{id, mode|game_type, level, display_name|name}] }
//   CalendarViews.switchView(containers, viewName)
//   CalendarViews.escapeHtml(s)
//   CalendarViews.fmtDateFR(iso)
//
// Cells with a `_draft_id` field on the placement are flagged editable
// (the consumer wires the click handler via `containers.onCellClick`).

(function () {
  const MODE_DISPLAY_ORDER = ['Libre', 'Cadre', 'Bande', '3 Bandes'];
  const LEVEL_DISPLAY_RANK = { N1: 1, N2: 2, N3: 3, R1: 4, R2: 5, R3: 6, R4: 7, R5: 8, D1: 9, D2: 10, D3: 11, NC: 99 };
  const HOST_PALETTE = ['#fce4d6', '#d9e1f2', '#e2efda', '#fff2cc', '#e4dfec', '#ddebf7', '#fce4d6', '#e7e6e6'];

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
  function buildHostColorMap(placements) {
    const map = new Map();
    placements.forEach(p => {
      if (p.host_id && !map.has(p.host_id)) {
        map.set(p.host_id, HOST_PALETTE[map.size % HOST_PALETTE.length]);
      }
    });
    return map;
  }

  function categoryName(c) {
    return c?.name || c?.display_name || '';
  }

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

  function renderViewSeasonal(container, result, referenceData, opts = {}) {
    const colors = buildHostColorMap(result.placements);
    const allCatIds = new Set(result.placements.map(p => p.category_id));
    const cats = (referenceData.categories || []).filter(c => allCatIds.has(c.id));
    cats.sort((a, b) => {
      const ma = dispModeRank(a.mode || a.game_type);
      const mb = dispModeRank(b.mode || b.game_type);
      if (ma !== mb) return ma - mb;
      return dispLevelRank(a.level) - dispLevelRank(b.level);
    });
    const weekends = [...new Set(result.placements.map(p => p.weekend_date))].sort();
    const grid = {};
    result.placements.forEach(p => {
      if (!grid[p.category_id]) grid[p.category_id] = {};
      grid[p.category_id][p.weekend_date] = p;
    });
    const headerCells = weekends.map(we => {
      const d = new Date(we + 'T00:00:00Z');
      return `<th style="padding: 4px 6px; font-size: 11px; min-width: 56px; white-space: nowrap;">${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })}</th>`;
    }).join('');

    const rows = cats.map(c => {
      const cells = weekends.map(we => {
        const p = grid[c.id]?.[we];
        if (!p) return `<td style="padding: 4px 6px; background: #fafafa;"></td>`;
        const bg = p.host_id ? colors.get(p.host_id) : '#fff';
        const lockedBorder = p._locked ? 'border: 2px solid #c47b00;' : '';
        const editable = p._draft_id ? 'cursor: pointer;' : '';
        const tip = `${categoryName(c)} ${p.tournament_type}\n${fmtDateFR(p.qualif_date || p.final_date || p.weekend_date)}\n${p.host_name || 'TBD'}${p._comment ? '\n💬 ' + p._comment : ''}${p._draft_id ? '\n(clic pour modifier)' : ''}`;
        const lockIcon = p._locked ? '🔒 ' : '';
        const commentIcon = p._comment ? '💬' : '';
        return `<td class="cv-cell-editable" data-draft-id="${p._draft_id || ''}" data-cat-id="${c.id}" style="padding: 4px 6px; background: ${bg}; text-align: center; font-size: 11px; ${lockedBorder} ${editable}" title="${escapeHtml(tip)}">
          <div style="font-weight: 700;">${lockIcon}${p.tournament_type === 'Finale' ? 'F' : p.tournament_type}${commentIcon}</div>
          <div style="font-size: 9px; color: #555;">${escapeHtml(abbreviateHost(p.host_name) || (p.host_id == null ? 'TBD' : ''))}</div>
        </td>`;
      }).join('');
      return `<tr><td style="padding: 6px 10px; font-weight: 600; position: sticky; left: 0; background: #fff; z-index: 1; border-right: 2px solid #ccc;">${escapeHtml(categoryName(c))}</td>${cells}</tr>`;
    }).join('');

    const legend = [...colors.entries()].map(([id, color]) => {
      const p = result.placements.find(pp => pp.host_id === id);
      return `<span style="display:inline-block; padding: 4px 10px; background: ${color}; border-radius: 4px; font-size: 12px; margin: 0 4px 4px 0;">${escapeHtml(p?.host_name || '?')}</span>`;
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
              <th style="padding: 6px 10px; text-align: left; position: sticky; left: 0; background: #6b3aa3; z-index: 3; min-width: 160px;">Catégorie</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top: 10px;">
        <strong style="font-size: 13px; color: #555;">Légende clubs :</strong> ${legend}
      </div>
    `;

    if (opts.onCellClick) {
      container.querySelectorAll('.cv-cell-editable[data-draft-id]:not([data-draft-id=""])').forEach(td => {
        td.addEventListener('click', () => opts.onCellClick(parseInt(td.dataset.draftId, 10)));
      });
    }
  }

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
