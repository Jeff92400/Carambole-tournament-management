// help-button.js — Help link in navbar linking to the user guide
(function () {
  const PAGE_ANCHORS = {
    'dashboard.html': '#dashboard',
    'rankings.html': '#classements',
    'player-history.html': '#historique-joueur',
    'generate-poules.html': '#generer-poules',
    'tournament-results.html': '#resultats',
    'import-external.html': '#resultats-externes',
    'tournaments-list.html': '#liste-tournois',
    'tournois-list.html': '#liste-tournois',
    'calendar.html': '#calendrier',
    'emailing.html': '#composer-email',
    'player-invitations.html': '#invitations',
    'inscriptions-list.html': '#inscriptions-list',
    'inscriptions-viewer.html': '#inscriptions-list',
    'settings.html': '#parametres',
    'settings-admin.html': '#param-organisation',
    'settings-reference.html': '#param-reference',
    'classifications-ffb.html': '#param-classifications',
    'clubs.html': '#param-clubs',
    'players-list.html': '#presentation',
    'activity-logs.html': '#param-logs',
    'admin-activity-logs.html': '#param-logs',
    'privacy-policy-editor.html': '#param-confidentialite',

    'tournament-scoring.html': '#resultats',
    'statistiques.html': '#presentation',
    'ligue-dashboard.html': '#dashboard',
    'player-accounts.html': '#invitations',
    'enrollment-requests.html': '#inscriptions-list',
    'import-inscriptions.html': '#inscriptions-list',
    'import-players.html': '#presentation',
    'import-tournament.html': '#resultats',
    'import-tournois.html': '#liste-tournois',
    'import-config.html': '#parametres'
  };

  var page = window.location.pathname.split('/').pop() || '';
  var anchor = PAGE_ANCHORS[page] || '#presentation';

  function injectHelpLink() {
    var navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;

    var logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;

    var link = document.createElement('a');
    link.href = 'guide-utilisateur.html' + anchor;
    link.target = '_blank';
    link.title = 'Guide utilisateur';
    link.textContent = '?';
    link.className = 'nav-tooltip';
    link.setAttribute('data-tooltip', 'Guide utilisateur');
    link.style.cssText = 'font-weight:bold;font-size:15px;';

    navLinks.insertBefore(link, logoutBtn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHelpLink);
  } else {
    injectHelpLink();
  }
})();
