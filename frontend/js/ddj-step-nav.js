/**
 * DdJ step indicator navigation
 * ----------------------------------------------------------------------------
 * Wires the 7-dot step indicator at the top of every DdJ workflow page into
 * navigation links. Each dot routes to its corresponding page (carrying the
 * current ?compId=N). If a dot has no target (e.g. Export E2i not yet built)
 * it stays non-clickable.
 *
 * Expected markup on the host page:
 *   <div class="ddj-steps">
 *     <div class="dot [done|active]" title="Sélection"></div>
 *     <div class="dot [done|active]" title="Pointage"></div>
 *     <div class="dot [done|active]" title="Poules"></div>
 *     <div class="dot [done|active]" title="Matchs poules"></div>
 *     <div class="dot [done|active]" title="Tableau final"></div>
 *     <div class="dot [done|active]" title="Classement"></div>
 *     <div class="dot [done|active]" title="Export E2i"></div>
 *   </div>
 *
 * Dots on the CURRENT page (.active) stay non-clickable to avoid a noisy
 * self-reload, but visual affordance (cursor) hints on hover elsewhere.
 * ----------------------------------------------------------------------------
 */
(function () {
  function wireDdjSteps() {
    const compId = new URLSearchParams(window.location.search).get('compId');
    // Ordered list matching the 7 dots. null = not navigable yet.
    const STEP_URLS = [
      'directeur-de-jeu.html',                   // 0 - Sélection (landing, no compId)
      'directeur-de-jeu-pointage.html',          // 1 - Pointage
      'directeur-de-jeu-poules.html',            // 2 - Poules
      'directeur-de-jeu-matchs.html',            // 3 - Matchs poules
      'directeur-de-jeu-bracket.html',           // 4 - Tableau final
      'directeur-de-jeu-classement.html',        // 5 - Classement (Consolante)
      null                                       // 6 - Export E2i (bientôt)
    ];

    const dots = document.querySelectorAll('.ddj-steps .dot');
    dots.forEach((dot, idx) => {
      const url = STEP_URLS[idx];
      if (!url) {
        dot.title = (dot.title || '') + ' — arrive prochainement';
        return;
      }
      if (dot.classList.contains('active')) {
        // Current page — no self-nav
        return;
      }
      dot.style.cursor = 'pointer';
      dot.setAttribute('role', 'button');
      dot.setAttribute('tabindex', '0');
      const go = () => {
        if (idx === 0 || !compId) {
          window.location.href = url; // Sélection doesn't take compId
        } else {
          window.location.href = url + '?compId=' + encodeURIComponent(compId);
        }
      };
      dot.addEventListener('click', go);
      dot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      // Subtle hover affordance — tooltip already tells what the step is
      dot.addEventListener('mouseenter', () => {
        dot.style.transform = 'scale(1.25)';
        dot.style.transition = 'transform 0.15s';
      });
      dot.addEventListener('mouseleave', () => {
        dot.style.transform = '';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireDdjSteps);
  } else {
    wireDdjSteps();
  }
})();
