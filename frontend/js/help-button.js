// help-button.js — Floating help button linking to the user guide
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
    'settings-bareme.html': '#param-bareme',
    'settings-reference.html': '#param-reference',
    'classifications-ffb.html': '#param-classifications',
    'clubs.html': '#param-clubs',
    'players-list.html': '#presentation',
    'activity-logs.html': '#param-logs',
    'admin-activity-logs.html': '#param-logs',
    'privacy-policy-editor.html': '#param-confidentialite',
    'tournament-bracket.html': '#competitions',
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

  var btn = document.createElement('a');
  btn.href = 'guide-utilisateur.html' + anchor;
  btn.target = '_blank';
  btn.title = 'Aide';
  btn.textContent = '?';
  btn.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'z-index:10000',
    'width:44px',
    'height:44px',
    'border-radius:50%',
    'background:var(--color-primary, #1F4788)',
    'color:#fff',
    'font-size:22px',
    'font-weight:bold',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'text-decoration:none',
    'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
    'cursor:pointer',
    'transition:transform 0.2s, box-shadow 0.2s'
  ].join(';');

  btn.addEventListener('mouseenter', function () {
    btn.style.transform = 'scale(1.1)';
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
  });
  btn.addEventListener('mouseleave', function () {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
  });

  document.body.appendChild(btn);
})();
