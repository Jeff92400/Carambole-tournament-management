// upcoming-tournaments.js — "Tournois à venir" nav button + modal with filters
(function () {
  var modal = null;
  var allRows = [];
  var gameModes = [];
  var categories = [];

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = d.getFullYear();
    return day + '/' + month + '/' + year;
  }


  function doFetch(url) {
    var fetchFn = window.authFetch || function (u) { return fetch(u, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } }); };
    return fetchFn(url);
  }

  function createModal() {
    var overlay = document.createElement('div');
    overlay.id = 'upcoming-tournaments-overlay';
    overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;justify-content:center;align-items:center;';

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;width:90%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid #e0e0e0;flex-shrink:0;';
    header.innerHTML = '<h3 style="margin:0;font-size:18px;color:var(--color-primary, #1F4788);">Tournois à venir</h3>';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.style.cssText = 'background:none;border:none;font-size:28px;cursor:pointer;color:#666;line-height:1;padding:0 4px;';
    closeBtn.onclick = closeModal;
    header.appendChild(closeBtn);

    // Filters bar
    var filters = document.createElement('div');
    filters.id = 'upcoming-tournaments-filters';
    filters.style.cssText = 'padding:12px 24px;border-bottom:1px solid #e0e0e0;display:flex;gap:12px;align-items:center;flex-shrink:0;flex-wrap:wrap;';

    var selectStyle = 'padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;min-width:160px;';

    // Mode select
    var modeSelect = document.createElement('select');
    modeSelect.id = 'upcoming-filter-mode';
    modeSelect.style.cssText = selectStyle;
    modeSelect.innerHTML = '<option value="">Tous les modes</option>';
    modeSelect.onchange = applyFilters;
    filters.appendChild(modeSelect);

    // Categorie select
    var catSelect = document.createElement('select');
    catSelect.id = 'upcoming-filter-categorie';
    catSelect.style.cssText = selectStyle;
    catSelect.innerHTML = '<option value="">Toutes les catégories</option>';
    catSelect.onchange = applyFilters;
    filters.appendChild(catSelect);

    // Body
    var body = document.createElement('div');
    body.id = 'upcoming-tournaments-body';
    body.style.cssText = 'padding:16px 24px;overflow-y:auto;flex:1;';

    box.appendChild(header);
    box.appendChild(filters);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.style.display === 'flex') closeModal();
    });

    modal = { overlay: overlay, body: body, modeSelect: modeSelect, catSelect: catSelect };
  }

  function openModal() {
    if (!modal) createModal();
    modal.overlay.style.display = 'flex';
    modal.body.innerHTML = '<p style="text-align:center;color:#666;padding:30px 0;">Chargement...</p>';
    loadData();
  }

  function closeModal() {
    if (modal) modal.overlay.style.display = 'none';
  }

  function loadData() {
    Promise.all([
      doFetch('/api/inscriptions/tournoi/calendar').then(function (r) { if (!r.ok) throw new Error('Erreur ' + r.status); return r.json(); }),
      gameModes.length ? Promise.resolve(gameModes) : doFetch('/api/reference-data/game-modes?active_only=true').then(function (r) { return r.ok ? r.json() : []; }),
      categories.length ? Promise.resolve(categories) : doFetch('/api/reference-data/categories').then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (results) {
      allRows = results[0] || [];
      gameModes = results[1] || [];
      categories = results[2] || [];
      populateFilters();
      applyFilters();
    }).catch(function (err) {
      modal.body.innerHTML = '<p style="text-align:center;color:#dc3545;padding:30px 0;">Erreur lors du chargement des tournois.<br><small>' + err.message + '</small></p>';
    });
  }

  function populateFilters() {
    // Populate mode select
    var savedMode = modal.modeSelect.value;
    modal.modeSelect.innerHTML = '<option value="">Tous les modes</option>' +
      gameModes.map(function (m) { return '<option value="' + m.display_name + '">' + m.display_name + '</option>'; }).join('');
    modal.modeSelect.value = savedMode;

    // Populate categorie select — filter by selected mode if any
    updateCategorieOptions();
  }

  function updateCategorieOptions() {
    var selectedMode = modal.modeSelect.value;
    var savedCat = modal.catSelect.value;

    var filtered = categories;
    if (selectedMode) {
      filtered = categories.filter(function (c) {
        return (c.game_type || '').toUpperCase() === selectedMode.toUpperCase() ||
               (c.game_mode_name || '').toUpperCase() === selectedMode.toUpperCase();
      });
    }

    // Deduplicate by level
    var seen = {};
    var uniqueLevels = [];
    filtered.forEach(function (c) {
      var lev = c.level || c.display_name;
      if (!seen[lev]) {
        seen[lev] = true;
        uniqueLevels.push({ level: lev, display_name: c.display_name });
      }
    });

    modal.catSelect.innerHTML = '<option value="">Toutes les catégories</option>' +
      uniqueLevels.map(function (c) { return '<option value="' + c.level + '">' + c.display_name + '</option>'; }).join('');

    // Restore selection if still valid
    if (savedCat) {
      var stillExists = uniqueLevels.some(function (c) { return c.level === savedCat; });
      modal.catSelect.value = stillExists ? savedCat : '';
    }
  }

  function applyFilters() {
    var selectedMode = modal.modeSelect.value;
    updateCategorieOptions();
    var selectedCat = modal.catSelect.value;

    var filtered = allRows.filter(function (t) {
      if (selectedMode && (t.mode || '').toUpperCase() !== selectedMode.toUpperCase()) return false;
      if (selectedCat && (t.categorie || '').toUpperCase() !== selectedCat.toUpperCase()) return false;
      return true;
    });

    renderTable(filtered);
  }

  function renderTable(rows) {
    if (!rows || rows.length === 0) {
      modal.body.innerHTML = '<p style="text-align:center;color:#666;padding:30px 0;">Aucun tournoi à venir.</p>';
      return;
    }

    var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;">';
    html += '<thead><tr style="background:linear-gradient(135deg, var(--color-secondary, #667eea), var(--color-secondary-dark, #5a6fd6));color:#fff;">';
    html += '<th style="padding:10px 12px;text-align:left;white-space:nowrap;">Date</th>';
    html += '<th style="padding:10px 12px;text-align:left;">Nom</th>';
    html += '<th style="padding:10px 12px;text-align:left;">Mode</th>';
    html += '<th style="padding:10px 12px;text-align:left;">Catégorie</th>';
    html += '<th style="padding:10px 12px;text-align:left;">Lieu</th>';
    html += '<th style="padding:10px 12px;text-align:center;">Inscrits</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      var bgColor = i % 2 === 0 ? '#fff' : '#f8f9fa';
      html += '<tr style="background:' + bgColor + ';border-bottom:1px solid #eee;">';
      html += '<td style="padding:8px 12px;white-space:nowrap;">' + formatDate(t.debut) + '</td>';
      html += '<td style="padding:8px 12px;">' + (t.nom || '') + '</td>';
      html += '<td style="padding:8px 12px;">' + (t.mode || '') + '</td>';
      html += '<td style="padding:8px 12px;">' + (t.categorie || '') + '</td>';
      html += '<td style="padding:8px 12px;">' + (t.lieu || t.lieu_2 || '') + '</td>';
      html += '<td style="padding:8px 12px;text-align:center;font-weight:600;">' + (t.inscrit_count || 0) + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    html += '<p style="text-align:right;color:#999;font-size:12px;margin-top:10px;">' + rows.length + ' tournoi' + (rows.length > 1 ? 's' : '') + '</p>';
    modal.body.innerHTML = html;
  }

  function injectButton() {
    var navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;

    var helpLink = navLinks.querySelector('a[href*="guide-utilisateur"]');
    var insertBefore = helpLink || document.getElementById('logoutBtn');
    if (!insertBefore) return;

    var btn = document.createElement('a');
    btn.href = '#';
    btn.textContent = 'Tournois à venir';
    btn.className = 'nav-tooltip';
    btn.setAttribute('data-tooltip', 'Voir tous les tournois à venir');
    btn.style.cssText = 'font-size:14px;cursor:pointer;';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });

    navLinks.insertBefore(btn, insertBefore);

    // Hide "Classements" nav link for admin — accessible via quick actions & tournament pages
    var role = localStorage.getItem('userRole');
    if (role === 'admin') {
      var classementsLink = navLinks.querySelector('a[href="rankings.html"]');
      if (classementsLink) classementsLink.style.display = 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
