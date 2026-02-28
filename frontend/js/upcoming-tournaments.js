// upcoming-tournaments.js — "A venir" nav button + modal showing upcoming tournaments
(function () {
  var modal = null;

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = d.getFullYear();
    return day + '/' + month + '/' + year;
  }

  function formatStatut(statut) {
    if (!statut) return '<span style="color:#28a745;">Ouvert</span>';
    var s = statut.toLowerCase();
    if (s === 'annulé') return '<span style="color:#dc3545;">Annulé</span>';
    if (s === 'clôturé' || s === 'cloture') return '<span style="color:#6c757d;">Clôturé</span>';
    if (s === 'complet') return '<span style="color:#ffc107;">Complet</span>';
    return '<span>' + statut + '</span>';
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

    // Body
    var body = document.createElement('div');
    body.id = 'upcoming-tournaments-body';
    body.style.cssText = 'padding:16px 24px;overflow-y:auto;flex:1;';

    box.appendChild(header);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.style.display === 'flex') closeModal();
    });

    modal = { overlay: overlay, body: body };
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
    var fetchFn = window.authFetch || function (url) { return fetch(url, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } }); };
    fetchFn('/api/inscriptions/tournoi/calendar')
      .then(function (r) {
        if (!r.ok) throw new Error('Erreur ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        renderTable(rows);
      })
      .catch(function (err) {
        modal.body.innerHTML = '<p style="text-align:center;color:#dc3545;padding:30px 0;">Erreur lors du chargement des tournois.<br><small>' + err.message + '</small></p>';
      });
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
    html += '<th style="padding:10px 12px;text-align:center;">Statut</th>';
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
      html += '<td style="padding:8px 12px;text-align:center;">' + formatStatut(t.statut) + '</td>';
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
    btn.textContent = 'A venir';
    btn.className = 'nav-tooltip';
    btn.setAttribute('data-tooltip', 'Tournois à venir');
    btn.style.cssText = 'font-size:14px;cursor:pointer;';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });

    navLinks.insertBefore(btn, insertBefore);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
