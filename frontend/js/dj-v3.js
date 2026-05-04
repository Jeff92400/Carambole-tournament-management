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
      position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 8000;
    }
    .djv3-drawer {
      position: fixed; top: 0; left: 0; right: 0;
      background: white; padding: 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      max-height: 85vh; overflow-y: auto;
      z-index: 8001;
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
    backdrop.addEventListener('click', closeTablesDrawer);

    const drawer = document.createElement('div');
    drawer.className = 'djv3-drawer';
    drawer.id = 'djv3-drawer';
    drawer.addEventListener('click', (e) => e.stopPropagation());
    drawer.innerHTML = renderDrawerHtml();

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    drawer.querySelector('.djv3-close').addEventListener('click', closeTablesDrawer);
  }

  function closeTablesDrawer() {
    const d = document.getElementById('djv3-drawer');
    const b = document.getElementById('djv3-drawer-backdrop');
    if (d) d.remove();
    if (b) b.remove();
    state.drawerOpen = false;
  }

  function renderDrawerHtml() {
    if (!state.session) {
      return `<h3>État des tables <span class="djv3-close">×</span></h3>
              <p style="color:#888;">Aucune session DdJ active. Cliquez sur "Configurer session" pour démarrer.</p>
              <button class="djv3-btn-primary" style="padding:10px 18px;border:0;border-radius:6px;color:white;background:#1a5276;cursor:pointer;font-weight:600;"
                onclick="DjV3.openSessionModal()">⚙️ Configurer la session DdJ</button>`;
    }
    const cards = (state.tables || []).map(t => {
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

    modal.innerHTML = `
      <h3>⚙️ Configuration de la journée</h3>
      <p style="color:#666;font-size:13px;">Saisissez le nombre de tables disponibles + votre identité de Directeur de Jeu.</p>
      <label>Nombre de tables disponibles</label>
      <input type="number" id="djv3-tc" min="1" max="20" value="${initCount}" />
      <label>Nom du Directeur de Jeu</label>
      <input type="text" id="djv3-name" value="${escapeAttr(initName)}" placeholder="Sylvain Vullien" />
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

    document.getElementById('djv3-cancel').addEventListener('click', () => backdrop.remove());
    document.getElementById('djv3-save').addEventListener('click', async () => {
      const tc = parseInt(document.getElementById('djv3-tc').value, 10);
      const name = document.getElementById('djv3-name').value.trim();
      const lic  = document.getElementById('djv3-licence').value.trim();
      if (!Number.isFinite(tc) || tc < 1) return alert('Nombre de tables invalide');
      if (!name) return alert('Nom du DdJ requis');
      try {
        const r = await authFetch(`/api/directeur-jeu/competitions/${state.tournoiId}/ddj-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_count: tc, ddj_name: name, ddj_licence: lic })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          return alert(err.error || 'Erreur sauvegarde session');
        }
        backdrop.remove();
        await loadSession();
        await loadTablesStatus();
        guideMessage(`Session démarrée. ${tc} tables disponibles.`, 'success');
      } catch (e) {
        console.error(e);
        alert('Erreur réseau');
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
    guideMessage,
    refereeAutocomplete,
    startMatch,
    get session() { return state.session; },
    get tables() { return state.tables; }
  };
})();
