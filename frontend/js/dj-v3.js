/* =========================================================================
   V 2.0.595 — DdJ V3 shared frontend module
   =========================================================================

   One file, used by all 7 DdJ pages, plus the entry-point `directeur-de-jeu.html`.
   Exposes a single global namespace `window.DjV3` with:

     - DjV3.init(tournoiId)            -> bootstraps session + drawer
     - DjV3.openSessionModal()         -> manual re-open of the config dialog
     - DjV3.openTablesDrawer()         -> manual open of the table status drawer
     - DjV3.guideMessage(text, level)  -> show a guidance banner ("Match Table 2 terminé…")
     - DjV3.refereeAutocomplete(input1, input2)
                                       -> wires a name field + licence field with autocomplete
     - DjV3.startMatch(phase, args)    -> POST .../start before the score page opens
     - DjV3.session                    -> the loaded session (or null)
     - DjV3.tables                     -> last-known table state array

   Why a shared module?
   -------------------
   - Avoids duplicating the drawer / autocomplete / messages markup 7×
   - Single fetch path for each new V3 endpoint -> easier to evolve later
   - Pages just need `<script src="js/dj-v3.js"></script>` + `DjV3.init(tournoiId)`

   No build step (project convention): plain ES2017+ JS, no imports.
   Auth: relies on the existing `authFetch` helper from auth.js (already
   loaded on every DdJ page).
   ========================================================================= */

(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------
  const state = {
    tournoiId: null,
    session: null,        // { tournoi_id, table_count, ddj_user_id, ddj_name, ddj_licence }
    tables: [],           // [{ table_number, status, match }]
    pollHandle: null,
    drawerOpen: false
  };

  // -------------------------------------------------------------------------
  // CSS — injected once on init. Keeps each page lean.
  // -------------------------------------------------------------------------
  const CSS = `
    /* V 2.0.694 — persistent session info bar (replaces the unreliable
       navbar badge). Sits below the step indicator on every DdJ page. */
    .djv3-session-bar {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 10px;
      padding: 10px 16px;
      margin: 12px auto;
      max-width: 900px;
      background: linear-gradient(90deg, #fff5e6, #fef3c7);
      border: 1px solid #fde68a;
      border-radius: 8px;
      font-size: 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .djv3-session-bar.configured {
      background: linear-gradient(90deg, #e8f4fd, #f0f9ff);
      border-color: #bae6fd;
    }
    .djv3-session-bar .djv3-sb-info {
      display: flex; align-items: center; gap: 10px;
      color: #1a5276; flex: 1; min-width: 200px;
    }
    .djv3-session-bar .djv3-sb-icon { height: 20px; width: 20px; flex-shrink: 0; }
    .djv3-session-bar .djv3-sb-text { line-height: 1.3; }
    .djv3-session-bar .djv3-sb-busy { color: #d97706; font-weight: 600; }
    .djv3-session-bar.configured .djv3-sb-busy { color: #b45309; }
    .djv3-session-bar .djv3-sb-actions { display: flex; gap: 8px; }
    .djv3-session-bar .djv3-sb-btn {
      padding: 6px 14px; border: 0; border-radius: 5px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: filter 0.12s;
    }
    .djv3-session-bar .djv3-sb-btn:hover { filter: brightness(1.08); }
    .djv3-session-bar .djv3-sb-btn-primary { background: #1a5276; color: white; }
    .djv3-session-bar .djv3-sb-btn-secondary { background: #fff; color: #1a5276; border: 1px solid #cbd5e1; }

    /* Legacy badge — kept for backwards-compat but visually neutral now */
    .djv3-badge { display: none; }

    /* V 2.0.696 — Planning du jour */
    .djv3-pl-section { margin-top: 18px; }
    .djv3-pl-section:first-of-type { margin-top: 6px; }
    .djv3-pl-title {
      font-size: 14px; text-transform: uppercase; letter-spacing: 0.6px;
      color: #1a5276; margin: 0 0 8px 0; padding-bottom: 4px;
      border-bottom: 2px solid #2e86c1;
    }
    .djv3-pl-poule { margin-bottom: 10px; }
    .djv3-pl-poule-h {
      font-weight: 700; color: #1a5276; font-size: 14px;
      padding: 6px 0; margin-bottom: 4px;
    }
    .djv3-pl-poule-h .djv3-pl-table { font-weight: 500; color: #888; font-size: 13px; }
    .djv3-pl-match {
      display: grid;
      grid-template-columns: 50px 50px 1fr auto auto;
      gap: 8px; align-items: center;
      padding: 6px 8px; border-bottom: 1px solid #f0f0f0;
      font-size: 13px;
    }
    .djv3-pl-match:last-child { border-bottom: 0; }
    .djv3-pl-mn { font-weight: 700; color: #555; }
    .djv3-pl-table-tag {
      background: #e8f4fd; color: #1a5276;
      padding: 2px 8px; border-radius: 10px;
      font-size: 12px; font-weight: 700;
      text-align: center;
    }
    .djv3-pl-players { color: #333; font-weight: 500; }
    .djv3-pl-score { color: #1a5276; font-weight: 700; min-width: 40px; text-align: right; }
    .djv3-pl-pill {
      padding: 2px 8px; border-radius: 10px;
      font-size: 11px; font-weight: 700; white-space: nowrap;
    }
    .djv3-pl-pill.done       { background: #d4edda; color: #155724; }
    .djv3-pl-pill.in-progress { background: #fff3cd; color: #856404; }
    .djv3-pl-pill.pending    { background: #e9ecef; color: #6c757d; }
    .djv3-pl-empty {
      text-align: center; color: #888; font-style: italic;
      padding: 14px; background: #fafafa; border-radius: 6px;
    }
    .djv3-pl-empty-sub { padding: 8px; font-size: 13px; }
    @media (max-width: 600px) {
      .djv3-pl-match {
        grid-template-columns: 50px 50px 1fr;
        grid-template-areas: "mn table players" ". score status";
        row-gap: 4px;
      }
      .djv3-pl-mn      { grid-area: mn; }
      .djv3-pl-table-tag { grid-area: table; }
      .djv3-pl-players { grid-area: players; }
      .djv3-pl-score   { grid-area: score; text-align: left; }
      .djv3-pl-pill    { grid-area: status; justify-self: end; }
    }

    .djv3-modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 9000;
      display: flex; align-items: center; justify-content: center;
    }
    .djv3-modal {
      background: white; border-radius: 12px; padding: 24px; width: min(440px, 92vw);
      max-height: 85vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .djv3-modal h3 { color: #1a5276; margin-top: 0; }
    .djv3-modal label { display: block; font-size: 12px; font-weight: 600; color: #555; margin: 12px 0 4px; }
    .djv3-modal input[type=text], .djv3-modal input[type=number] {
      width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;
    }
    .djv3-modal .djv3-modal-actions { margin-top: 18px; display: flex; gap: 10px; justify-content: flex-end; }
    .djv3-modal button {
      padding: 10px 18px; border: 0; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .djv3-modal .djv3-btn-primary { background: #1a5276; color: white; }
    .djv3-modal .djv3-btn-secondary { background: #e0e0e0; color: #333; }

    .djv3-drawer-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 9500;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 80px 16px 16px 16px;
      overflow-y: auto;
    }
    /* V 2.0.695 — Centered modal-style overlay (was top-anchored, which
       overlapped the MODE TEST banner and the navbar on mobile/PC). */
    .djv3-drawer {
      position: relative;
      background: white; padding: 20px 24px;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      max-height: calc(100vh - 100px); overflow-y: auto;
      z-index: 9501;
      width: min(640px, 100%);
      animation: djv3-slidein 0.2s ease-out;
    }
    @keyframes djv3-slidein {
      from { transform: translateY(-20px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    .djv3-drawer h3 { margin-top: 0; color: #1a5276; display: flex; justify-content: space-between; align-items: center; }
    .djv3-drawer h3 .djv3-close { cursor: pointer; font-size: 20px; color: #999; user-select: none; }
    .djv3-tables-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    .djv3-table-card {
      border: 2px solid #e0e0e0; border-radius: 8px; padding: 12px; text-align: center;
    }
    .djv3-table-card.busy  { border-color: #e74c3c; background: #fef5f4; }
    .djv3-table-card.free  { border-color: #27ae60; background: #f1f9f3; }
    .djv3-table-card .djv3-tnum { font-size: 16px; font-weight: 700; color: #1a5276; }
    .djv3-table-card .djv3-tstatus { font-size: 11px; text-transform: uppercase; font-weight: 600; margin-top: 2px; }
    .djv3-table-card.busy .djv3-tstatus { color: #e74c3c; }
    .djv3-table-card.free .djv3-tstatus { color: #27ae60; }
    .djv3-table-card .djv3-tmatch { font-size: 12px; color: #555; margin-top: 6px; line-height: 1.3; }

    .djv3-guide-banner {
      position: fixed; left: 16px; right: 16px; top: 70px;
      padding: 12px 16px; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      font-size: 14px; font-weight: 600; color: white;
      z-index: 7000; animation: djv3-slidein 0.3s ease-out;
      display: flex; align-items: flex-start; gap: 10px;
    }
    .djv3-guide-banner.action  { background: linear-gradient(135deg, #f39c12, #e67e22); }
    .djv3-guide-banner.success { background: linear-gradient(135deg, #27ae60, #229954); }
    .djv3-guide-banner.info    { background: linear-gradient(135deg, #2e86c1, #1a5276); }
    .djv3-guide-banner.warning { background: linear-gradient(135deg, #f1c40f, #d4a017); color: #4a3c00; }
    .djv3-guide-banner .djv3-close { margin-left: auto; cursor: pointer; opacity: 0.8; }

    .djv3-autocomplete { position: relative; }
    .djv3-autocomplete-list {
      position: absolute; left: 0; right: 0; top: 100%;
      background: white; border: 1px solid #ddd; border-radius: 6px;
      max-height: 240px; overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      z-index: 100;
    }
    .djv3-autocomplete-item {
      padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
    }
    .djv3-autocomplete-item:hover { background: #f0f4ff; }
    .djv3-autocomplete-item .djv3-ac-name { font-weight: 600; color: #1a5276; }
    .djv3-autocomplete-item .djv3-ac-meta { font-size: 12px; color: #888; }
  `;

  function injectCss() {
    if (document.getElementById('djv3-css')) return;
    const style = document.createElement('style');
    style.id = 'djv3-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // Persistent session info bar — injected just under the step indicator,
  // visible on every DdJ page from étape 1 onwards. Replaces the navbar
  // badge (which was unreliable because the existing DdJ pages don't have
  // a uniform navbar anchor).
  //
  // Bar content:
  //   🎯 4 tables · 1 occupée · DdJ : Sylvain Vullien   [État]  [Modifier]
  //
  // Tap on the bar (anywhere except the buttons) → no-op.
  // Tap "État"     → opens the table-status drawer.
  // Tap "Modifier" → re-opens the configuration modal.
  // -------------------------------------------------------------------------
  function ensureSessionBar() {
    let bar = document.getElementById('djv3-session-bar');
    if (bar) return bar;
    // Inject after the step indicator if present, otherwise at top of body.
    const stepIndicator = document.querySelector('.ddj-steps');
    bar = document.createElement('div');
    bar.id = 'djv3-session-bar';
    bar.className = 'djv3-session-bar';
    bar.innerHTML = `
      <div class="djv3-sb-info">
        <img src="images/FrenchBillard-Icon-small.png" alt="" class="djv3-sb-icon">
        <span class="djv3-sb-text">Session non configurée</span>
      </div>
      <div class="djv3-sb-actions">
        <button type="button" class="djv3-sb-btn djv3-sb-btn-secondary" data-action="planning">📋 Planning</button>
        <button type="button" class="djv3-sb-btn djv3-sb-btn-secondary" data-action="drawer">État</button>
        <button type="button" class="djv3-sb-btn djv3-sb-btn-primary" data-action="edit">Modifier</button>
      </div>
    `;
    if (stepIndicator && stepIndicator.parentNode) {
      stepIndicator.parentNode.insertBefore(bar, stepIndicator.nextSibling);
    } else {
      // Fallback: insert at the very top of the main content if any.
      const fallback = document.getElementById('mainContent') || document.body.firstElementChild || document.body;
      if (fallback === document.body) document.body.insertBefore(bar, document.body.firstChild);
      else fallback.parentNode.insertBefore(bar, fallback);
    }
    bar.querySelector('[data-action="planning"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openPlanningModal();
    });
    bar.querySelector('[data-action="drawer"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openTablesDrawer();
    });
    bar.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openSessionModal();
    });
    return bar;
  }

  function updateSessionBar() {
    const bar = document.getElementById('djv3-session-bar');
    if (!bar) return;
    const text = bar.querySelector('.djv3-sb-text');
    if (!state.session) {
      text.innerHTML = '<strong>Session non configurée</strong> — tap "Modifier" pour démarrer';
      bar.classList.remove('configured');
      return;
    }
    const busy = state.tables.filter(t => t.status === 'busy').length;
    const total = state.session.table_count;
    text.innerHTML = `<strong>${total} table${total > 1 ? 's' : ''}</strong> · <span class="djv3-sb-busy">${busy} occupée${busy > 1 ? 's' : ''}</span> · DdJ : <strong>${escapeHtml(state.session.ddj_name)}</strong>`;
    bar.classList.add('configured');
  }

  // Backwards-compat shims for existing call sites (no-op now that the
  // navbar badge has been replaced by the session bar).
  function ensureBadge() { ensureSessionBar(); }
  function updateBadge() { updateSessionBar(); }

  // -------------------------------------------------------------------------
  // Tables drawer
  // -------------------------------------------------------------------------
  function openTablesDrawer() {
    if (state.drawerOpen) return;
    state.drawerOpen = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'djv3-drawer-backdrop';
    backdrop.id = 'djv3-drawer-backdrop';
    backdrop.addEventListener('click', (e) => {
      // Only close if click is on backdrop itself, not on the drawer
      if (e.target === backdrop) closeTablesDrawer();
    });

    const drawer = document.createElement('div');
    drawer.className = 'djv3-drawer';
    drawer.id = 'djv3-drawer';
    drawer.innerHTML = renderDrawerHtml();
    backdrop.appendChild(drawer);

    document.body.appendChild(backdrop);

    drawer.querySelector('.djv3-close').addEventListener('click', closeTablesDrawer);
  }

  function closeTablesDrawer() {
    const b = document.getElementById('djv3-drawer-backdrop');
    if (b) b.remove();
    state.drawerOpen = false;
  }

  // -------------------------------------------------------------------------
  // V 2.0.696 — "Planning du jour" modal
  //
  // Aggregates matches from the 3 phases (poules, bracket, consolante) into
  // one read-only view. Useful when:
  //   - A player asks the DdJ "when is my match?"
  //   - The DdJ wants to check the day's progress at a glance
  //   - Switching between étapes 4 and 5 in parallel (delta A workflow)
  //
  // Data source: 3 existing GET endpoints called in parallel.
  // We tolerate failures (e.g. bracket not yet startable returns 200 with
  // can_start=false; consolante similarly) — the modal just shows what's
  // available and labels missing sections clearly.
  // -------------------------------------------------------------------------
  async function openPlanningModal() {
    if (!state.tournoiId) return;

    // Show a loading shell immediately so the click feels responsive.
    let backdrop = document.getElementById('djv3-planning-backdrop');
    if (backdrop) return; // already open
    backdrop = document.createElement('div');
    backdrop.id = 'djv3-planning-backdrop';
    backdrop.className = 'djv3-drawer-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePlanningModal();
    });
    const modal = document.createElement('div');
    modal.id = 'djv3-planning';
    modal.className = 'djv3-drawer';
    modal.innerHTML = `<h3>📋 Planning du jour <span class="djv3-close">×</span></h3>
                       <p style="color:#888;text-align:center;padding:30px;">Chargement…</p>`;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    modal.querySelector('.djv3-close').addEventListener('click', closePlanningModal);

    // Fetch the 3 phases in parallel; ignore failures gracefully.
    const base = `/api/directeur-jeu/competitions/${state.tournoiId}`;
    const safe = (p) => p.then(r => r && r.ok ? r.json() : null).catch(() => null);
    const [poulesData, bracketData, consoData] = await Promise.all([
      safe(authFetch(`${base}/poule-matches`)),
      safe(authFetch(`${base}/bracket`)),
      safe(authFetch(`${base}/consolante`))
    ]);

    modal.innerHTML = renderPlanningHtml(poulesData, bracketData, consoData);
    modal.querySelector('.djv3-close').addEventListener('click', closePlanningModal);
  }

  function closePlanningModal() {
    const b = document.getElementById('djv3-planning-backdrop');
    if (b) b.remove();
  }

  function renderPlanningHtml(poulesData, bracketData, consoData) {
    let html = `<h3>📋 Planning du jour <span class="djv3-close">×</span></h3>`;

    // ----- Phase 1 : poules -----
    if (poulesData && Array.isArray(poulesData.poules) && poulesData.poules.length > 0) {
      html += `<div class="djv3-pl-section"><h4 class="djv3-pl-title">Poules</h4>`;
      for (const poule of poulesData.poules) {
        const tableLbl = poule.table_number ? `Table ${poule.table_number}` : 'Table non assignée';
        const pouleLetter = String.fromCharCode(64 + poule.number);
        html += `<div class="djv3-pl-poule">
          <div class="djv3-pl-poule-h">Poule ${pouleLetter} <span class="djv3-pl-table">· ${escapeHtml(tableLbl)}</span></div>`;
        for (const m of (poule.matches || [])) {
          html += renderPlanningMatchRow(m, poule.table_number);
        }
        html += `</div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="djv3-pl-empty">Poules pas encore générées.</div>`;
    }

    // ----- Phase 2 : tableau final -----
    if (bracketData && bracketData.bracket && bracketData.bracket.can_start && Array.isArray(bracketData.bracket.phases)) {
      html += `<div class="djv3-pl-section"><h4 class="djv3-pl-title">Tableau final</h4>`;
      for (const ph of bracketData.bracket.phases) {
        if (!ph.can_enter && !ph.is_played) continue; // skip phases whose players aren't known yet
        html += renderPlanningPhaseRow(ph, 'bracket');
      }
      html += `</div>`;
    } else {
      html += `<div class="djv3-pl-section"><h4 class="djv3-pl-title">Tableau final</h4>
        <div class="djv3-pl-empty djv3-pl-empty-sub">Disponible une fois les poules terminées.</div></div>`;
    }

    // ----- Phase 3 : consolante -----
    if (consoData && consoData.consolante && consoData.consolante.can_start && Array.isArray(consoData.consolante.phases)) {
      html += `<div class="djv3-pl-section"><h4 class="djv3-pl-title">Matchs de classement (Consolante)</h4>`;
      for (const ph of consoData.consolante.phases) {
        if (!ph.can_enter && !ph.is_played) continue;
        if (ph.bye) continue; // skip auto-advance byes (no actual match played)
        html += renderPlanningPhaseRow(ph, 'consolante');
      }
      html += `</div>`;
    } else {
      html += `<div class="djv3-pl-section"><h4 class="djv3-pl-title">Matchs de classement (Consolante)</h4>
        <div class="djv3-pl-empty djv3-pl-empty-sub">Disponible une fois les poules terminées.</div></div>`;
    }

    return html;
  }

  function statusBadge(matchObj) {
    if (matchObj.is_played) return `<span class="djv3-pl-pill done">✓ Terminé</span>`;
    const partial = (matchObj.p1_points != null) || (matchObj.p2_points != null);
    if (partial) return `<span class="djv3-pl-pill in-progress">⏳ En cours</span>`;
    return `<span class="djv3-pl-pill pending">À jouer</span>`;
  }

  function renderPlanningMatchRow(m, fallbackTable) {
    const t = m.table_number || fallbackTable;
    const tableTxt = t ? `T${t}` : '—';
    const score = m.is_played ? `${m.p1_points}–${m.p2_points}` : '';
    return `<div class="djv3-pl-match">
      <span class="djv3-pl-mn">M${m.match_number}</span>
      <span class="djv3-pl-table-tag">${escapeHtml(tableTxt)}</span>
      <span class="djv3-pl-players">${escapeHtml(m.p1_name || '')} vs ${escapeHtml(m.p2_name || '')}</span>
      <span class="djv3-pl-score">${score}</span>
      ${statusBadge(m)}
    </div>`;
  }

  function renderPlanningPhaseRow(ph, kind) {
    const label = ph.label || ph.phase || '';
    const t = ph.table_number;
    const tableTxt = t ? `T${t}` : '—';
    const p1Name = (ph.p1 && ph.p1.player_name) || '';
    const p2Name = (ph.p2 && ph.p2.player_name) || '';
    const score = ph.is_played ? `${ph.p1_points}–${ph.p2_points}` : '';
    return `<div class="djv3-pl-match">
      <span class="djv3-pl-mn">${escapeHtml(label)}</span>
      <span class="djv3-pl-table-tag">${escapeHtml(tableTxt)}</span>
      <span class="djv3-pl-players">${escapeHtml(p1Name)} vs ${escapeHtml(p2Name)}</span>
      <span class="djv3-pl-score">${score}</span>
      ${statusBadge(ph)}
    </div>`;
  }

  function renderDrawerHtml() {
    if (!state.session) {
      return `<h3>État des tables <span class="djv3-close">×</span></h3>
              <p style="color:#888;">Aucune session DdJ active. Cliquez sur "Configurer session" pour démarrer.</p>
              <button class="djv3-btn-primary" style="padding:10px 18px;border:0;border-radius:6px;color:white;background:#1a5276;cursor:pointer;font-weight:600;"
                onclick="DjV3.openSessionModal()">⚙️ Configurer la session DdJ</button>`;
    }
    // V 2.0.697 — Defensive fallback: if state.tables is empty (e.g. the
    // tables-status endpoint failed silently or returned an unexpected
    // shape), still show the configured tables as "free" so the DdJ has
    // a usable view instead of an empty drawer.
    let renderTables = state.tables || [];
    if (renderTables.length === 0 && state.session) {
      const fallbackNumbers = (state.session.table_numbers && state.session.table_numbers.length)
        ? state.session.table_numbers
        : Array.from({ length: state.session.table_count || 0 }, (_, i) => i + 1);
      renderTables = fallbackNumbers.map(n => ({ table_number: n, status: 'free', match: null }));
    }
    const cards = renderTables.map(t => {
      const matchHtml = t.match
        ? `<div class="djv3-tmatch">${escapeHtml(t.match.phase_kind)} · ${escapeHtml(t.match.phase_label)}<br>${formatTime(t.match.started_at)}</div>`
        : '<div class="djv3-tmatch">prête</div>';
      return `<div class="djv3-table-card ${t.status}">
                <div class="djv3-tnum">Table ${t.table_number}</div>
                <div class="djv3-tstatus">${t.status === 'busy' ? 'Occupée' : 'Libre'}</div>
                ${matchHtml}
              </div>`;
    }).join('');
    const busy = state.tables.filter(t => t.status === 'busy').length;
    return `<h3>État des tables (${busy}/${state.session.table_count}) <span class="djv3-close">×</span></h3>
            <p style="color:#888;font-size:13px;margin:0 0 8px;">Directeur de Jeu : <strong>${escapeHtml(state.session.ddj_name)}</strong></p>
            <div class="djv3-tables-grid">${cards}</div>
            <p style="margin-top:14px;font-size:12px;color:#888;">Mise à jour automatique toutes les 10 secondes.</p>`;
  }

  // -------------------------------------------------------------------------
  // Session modal — first-time setup or update
  // -------------------------------------------------------------------------
  function openSessionModal(prefill) {
    const existing = document.getElementById('djv3-modal');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'djv3-modal-backdrop';
    backdrop.id = 'djv3-modal';

    const modal = document.createElement('div');
    modal.className = 'djv3-modal';
    modal.addEventListener('click', e => e.stopPropagation());

    const initName    = (state.session && state.session.ddj_name)    || (prefill && prefill.ddj_name)    || '';
    const initLicence = (state.session && state.session.ddj_licence) || (prefill && prefill.ddj_licence) || '';
    const initCount   = (state.session && state.session.table_count) || 4;
    // V 2.0.695 — actual physical table numbers (clubs may have e.g. [6,7,8,9])
    const initNumbers = (state.session && state.session.table_numbers)
      || (prefill && prefill.table_numbers)
      || Array.from({ length: initCount }, (_, i) => i + 1);

    modal.innerHTML = `
      <h3>⚙️ Configuration de la journée</h3>
      <p style="color:#666;font-size:13px;">Saisissez le nombre de tables disponibles, leur numéro physique dans le club, et votre identité de Directeur de Jeu.</p>
      <label>Nombre de tables disponibles</label>
      <input type="number" id="djv3-tc" min="1" max="20" value="${initCount}" />
      <label style="margin-top:14px;">Numéros physiques des tables dans votre club</label>
      <p style="color:#666;font-size:12px;margin:0 0 6px 0;">Si vos billards sont numérotés 6, 7, 8, 9 par exemple, indiquez-le ici. Sinon, laissez 1, 2, 3, 4.</p>
      <div id="djv3-tn-grid" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>
      <label>Nom du Directeur de Jeu</label>
      <input type="text" id="djv3-name" value="${escapeAttr(initName)}" placeholder="Jean DUPONT" />
      <label>N° de licence FFB (optionnel)</label>
      <input type="text" id="djv3-licence" value="${escapeAttr(initLicence)}" placeholder="9412345" />
      <div class="djv3-modal-actions">
        <button class="djv3-btn-secondary" id="djv3-cancel">Annuler</button>
        <button class="djv3-btn-primary" id="djv3-save">Enregistrer</button>
      </div>
    `;
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', () => backdrop.remove());
    document.body.appendChild(backdrop);

    // V 2.0.695 — Build the table-number inputs grid and re-render it
    // whenever the count changes. Existing inputs preserve their values
    // so the DdJ doesn't lose what they typed when bumping the count up.
    function renderTableNumbersGrid() {
      const tcEl = document.getElementById('djv3-tc');
      const tc = Math.max(1, Math.min(20, parseInt(tcEl.value, 10) || 1));
      const grid = document.getElementById('djv3-tn-grid');
      // Read current values from existing inputs (so we don't reset what
      // the user already typed when the count just changed by 1).
      const current = Array.from(grid.querySelectorAll('input')).map(i => parseInt(i.value, 10));
      const next = [];
      for (let i = 0; i < tc; i++) {
        if (Number.isFinite(current[i])) next.push(current[i]);
        else if (Number.isFinite(initNumbers[i])) next.push(initNumbers[i]);
        else next.push(i + 1);
      }
      grid.innerHTML = next.map((v, i) => `
        <div style="display:flex;align-items:center;gap:4px;background:#f0f4fa;padding:4px 8px;border-radius:6px;">
          <span style="font-size:12px;color:#666;font-weight:600;">T${i + 1} →</span>
          <input type="number" min="1" max="999" value="${v}"
                 class="djv3-tn-input" data-idx="${i}"
                 style="width:60px;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:14px;text-align:center;">
        </div>
      `).join('');
    }
    renderTableNumbersGrid();
    document.getElementById('djv3-tc').addEventListener('input', renderTableNumbersGrid);

    document.getElementById('djv3-cancel').addEventListener('click', () => backdrop.remove());
    document.getElementById('djv3-save').addEventListener('click', async () => {
      const tc = parseInt(document.getElementById('djv3-tc').value, 10);
      const name = document.getElementById('djv3-name').value.trim();
      const lic  = document.getElementById('djv3-licence').value.trim();
      if (!Number.isFinite(tc) || tc < 1) return alert('Nombre de tables invalide');
      if (!name) return alert('Nom du DdJ requis');

      // Read the actual physical table numbers from the grid.
      const tableNumbers = Array.from(document.querySelectorAll('.djv3-tn-input'))
        .map(i => parseInt(i.value, 10))
        .filter(n => Number.isFinite(n) && n > 0);
      if (tableNumbers.length !== tc) {
        return alert('Veuillez renseigner un numéro pour chaque table.');
      }
      if (new Set(tableNumbers).size !== tableNumbers.length) {
        return alert('Les numéros de tables doivent être uniques (pas deux fois le même).');
      }

      try {
        const r = await authFetch(`/api/directeur-jeu/competitions/${state.tournoiId}/ddj-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_count: tc, table_numbers: tableNumbers, ddj_name: name, ddj_licence: lic })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          return alert(err.error || 'Erreur sauvegarde session');
        }
        backdrop.remove();
        await loadSession();
        await loadTablesStatus();
        guideMessage(`Session démarrée. ${tc} tables : ${tableNumbers.join(', ')}.`, 'success');

        // V 2.0.697 — After the session is saved, propose to auto-assign
        // the configured tables to the poules. The DdJ can opt out and do
        // it manually in étape 2 (Poules) instead.
        offerAutoAssignTables(tableNumbers);
      } catch (e) {
        console.error(e);
        alert('Erreur réseau');
      }
    });
  }

  // V 2.0.697 — Confirmation dialog: auto-assign poules → tables, or do it manually?
  function offerAutoAssignTables(tableNumbers) {
    const backdrop = document.createElement('div');
    backdrop.className = 'djv3-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'djv3-modal';
    modal.addEventListener('click', e => e.stopPropagation());
    modal.innerHTML = `
      <h3>📋 Allocation des tables aux poules</h3>
      <p style="color:#444;margin:10px 0 16px 0;">Voulez-vous une <strong>allocation automatique</strong> des tables aux poules (Poule A → Table ${tableNumbers[0]}, Poule B → Table ${tableNumbers[1] || tableNumbers[0]}, etc.) ou souhaitez-vous le faire <strong>manuellement</strong> sur l'écran des poules ?</p>
      <p style="color:#888;font-size:13px;margin-bottom:18px;">L'allocation manuelle reste possible à tout moment depuis l'étape 2 (Poules).</p>
      <div class="djv3-modal-actions">
        <button class="djv3-btn-secondary" id="djv3-aa-manual">Manuelle</button>
        <button class="djv3-btn-primary" id="djv3-aa-auto">Allocation auto</button>
      </div>
    `;
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', () => backdrop.remove());
    document.body.appendChild(backdrop);

    document.getElementById('djv3-aa-manual').addEventListener('click', () => backdrop.remove());
    document.getElementById('djv3-aa-auto').addEventListener('click', async () => {
      try {
        const r = await authFetch(`/api/directeur-jeu/competitions/${state.tournoiId}/auto-assign-tables`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          if (r.status === 409) {
            alert(err.error || 'Les poules ne sont pas encore générées. Vous pourrez relancer l\'allocation auto plus tard depuis le bouton Modifier.');
          } else {
            alert(err.error || 'Erreur allocation auto');
          }
          backdrop.remove();
          return;
        }
        const data = await r.json();
        backdrop.remove();
        guideMessage(`Allocation auto effectuée : ${data.assigned} matchs sur les tables ${tableNumbers.join(', ')}.`, 'success');
        await loadTablesStatus();
      } catch (e) {
        console.error('auto-assign error', e);
        alert('Erreur réseau');
        backdrop.remove();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Guide messages — toast banners
  // -------------------------------------------------------------------------
  function guideMessage(text, level) {
    const lvl = ['action', 'success', 'info', 'warning'].includes(level) ? level : 'info';
    // Remove any prior banner so they don't stack indefinitely.
    document.querySelectorAll('.djv3-guide-banner').forEach(n => n.remove());
    const div = document.createElement('div');
    div.className = `djv3-guide-banner ${lvl}`;
    div.innerHTML = `<span style="flex:1">${escapeHtml(text)}</span><span class="djv3-close">×</span>`;
    div.querySelector('.djv3-close').addEventListener('click', () => div.remove());
    document.body.appendChild(div);
    // Auto-dismiss after 8s for non-action messages.
    if (lvl !== 'action') {
      setTimeout(() => { if (div.parentNode) div.remove(); }, 8000);
    }
  }

  // -------------------------------------------------------------------------
  // Referee autocomplete
  // -------------------------------------------------------------------------
  function refereeAutocomplete(nameInputId, licenceInputId) {
    const nameInput = document.getElementById(nameInputId);
    const licInput  = document.getElementById(licenceInputId);
    if (!nameInput) return;

    // Wrap the name input in a positioned container so we can hang the
    // suggestion list off it.
    if (!nameInput.parentElement.classList.contains('djv3-autocomplete')) {
      const wrap = document.createElement('div');
      wrap.className = 'djv3-autocomplete';
      nameInput.parentNode.insertBefore(wrap, nameInput);
      wrap.appendChild(nameInput);
    }
    const wrap = nameInput.parentElement;

    let timer = null;
    let listEl = null;

    function clearList() {
      if (listEl) { listEl.remove(); listEl = null; }
    }
    function showList(results) {
      clearList();
      if (!results || results.length === 0) return;
      listEl = document.createElement('div');
      listEl.className = 'djv3-autocomplete-list';
      listEl.innerHTML = results.map((r, i) =>
        `<div class="djv3-autocomplete-item" data-i="${i}">
           <div class="djv3-ac-name">${escapeHtml(r.name)}</div>
           <div class="djv3-ac-meta">Lic. ${escapeHtml(r.licence)}${r.club ? ' · ' + escapeHtml(r.club) : ''}</div>
         </div>`
      ).join('');
      wrap.appendChild(listEl);
      listEl.querySelectorAll('.djv3-autocomplete-item').forEach((el, i) => {
        el.addEventListener('click', () => {
          const r = results[i];
          nameInput.value = r.name;
          if (licInput) licInput.value = r.licence;
          clearList();
        });
      });
    }

    nameInput.addEventListener('input', () => {
      const q = nameInput.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 2) { clearList(); return; }
      timer = setTimeout(async () => {
        try {
          const r = await authFetch(`/api/directeur-jeu/referees/search?q=${encodeURIComponent(q)}`);
          if (!r.ok) return;
          const data = await r.json();
          showList(data.results || []);
        } catch (e) { /* swallow */ }
      }, 200);
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) clearList();
    });
  }

  // -------------------------------------------------------------------------
  // Match start helper — call before opening the score page
  // -------------------------------------------------------------------------
  async function startMatch(phase, args) {
    // phase in {'poule', 'bracket', 'consolante'}
    // args: poule -> { poule_number, match_number, table_number }
    //       bracket / consolante -> { phase, table_number }
    const path = phase === 'poule'
      ? 'poule-matches/start'
      : `${phase}/start`;
    try {
      await authFetch(`/api/directeur-jeu/competitions/${state.tournoiId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      });
      await loadTablesStatus();
    } catch (e) { console.error('startMatch', e); }
  }

  // -------------------------------------------------------------------------
  // Network helpers
  // -------------------------------------------------------------------------
  async function loadSession() {
    try {
      const r = await authFetch(`/api/directeur-jeu/competitions/${state.tournoiId}/ddj-session`);
      if (!r.ok) return null;
      const data = await r.json();
      state.session = data.session || null;
      // If no session yet, surface the modal once with prefill (last user session)
      if (!state.session && data.prefill) {
        // Don't block — user can dismiss and go back later
        openSessionModal(data.prefill);
      } else if (!state.session) {
        openSessionModal(null);
      }
      updateBadge();
      return data;
    } catch (e) { console.error('loadSession', e); return null; }
  }

  async function loadTablesStatus() {
    if (!state.session) return;
    try {
      const r = await authFetch(`/api/directeur-jeu/competitions/${state.tournoiId}/tables-status`);
      if (!r.ok) return;
      const data = await r.json();
      state.tables = data.tables || [];
      updateBadge();
      // Refresh the drawer in place if open
      if (state.drawerOpen) {
        const d = document.getElementById('djv3-drawer');
        if (d) d.innerHTML = renderDrawerHtml();
        const close = d && d.querySelector('.djv3-close');
        if (close) close.addEventListener('click', closeTablesDrawer);
      }
    } catch (e) { console.error('loadTablesStatus', e); }
  }

  // -------------------------------------------------------------------------
  // Polling — refresh table status every 10s
  // -------------------------------------------------------------------------
  function startPolling() {
    if (state.pollHandle) return;
    state.pollHandle = setInterval(loadTablesStatus, 10000);
  }

  // -------------------------------------------------------------------------
  // Public init
  // -------------------------------------------------------------------------
  async function init(tournoiId) {
    if (!tournoiId || !Number.isFinite(parseInt(tournoiId, 10))) {
      console.warn('[DjV3] init: invalid tournoiId', tournoiId);
      return;
    }
    state.tournoiId = parseInt(tournoiId, 10);
    injectCss();
    ensureBadge();
    await loadSession();
    await loadTablesStatus();
    startPolling();
  }

  // -------------------------------------------------------------------------
  // Tiny utils — kept private to avoid namespace pollution
  // -------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  // -------------------------------------------------------------------------
  // Expose namespace
  // -------------------------------------------------------------------------
  window.DjV3 = {
    init,
    openSessionModal,
    openTablesDrawer,
    closeTablesDrawer,
    openPlanningModal,
    closePlanningModal,
    guideMessage,
    refereeAutocomplete,
    startMatch,
    get session() { return state.session; },
    get tables() { return state.tables; }
  };
})();
