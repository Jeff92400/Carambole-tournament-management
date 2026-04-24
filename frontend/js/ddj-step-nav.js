/**
 * DdJ step indicator navigation + labels/tooltips
 * ----------------------------------------------------------------------------
 * Wires the 7-dot step indicator at the top of every DdJ workflow page:
 *  - Each dot is clickable (routes to its page with ?compId=N)
 *  - Hover shows a CSS tooltip with the step label (faster & more visible
 *    than the native `title` attribute)
 *  - The ACTIVE step shows its label in plain text below the dots so users
 *    always know where they are without hovering
 *
 * Host page markup:
 *   <div class="ddj-steps">
 *     <div class="dot [done|active]"></div>  (×7)
 *   </div>
 *
 * Active dot stays non-clickable (no self-reload).
 * ----------------------------------------------------------------------------
 */
(function () {
  const STEP_URLS = [
    'directeur-de-jeu.html',                 // 0 - Sélection (landing, no compId)
    'directeur-de-jeu-pointage.html',        // 1 - Pointage
    'directeur-de-jeu-poules.html',          // 2 - Poules
    'directeur-de-jeu-matchs.html',          // 3 - Matchs de poule
    'directeur-de-jeu-bracket.html',         // 4 - Tableau final
    'directeur-de-jeu-classement.html',      // 5 - Classement (Consolante)
    'directeur-de-jeu-recap.html'            // 6 - Récapitulatif
  ];

  // Short labels for tooltip + visible active label.
  const STEP_LABELS = [
    'Sélection',
    'Pointage',
    'Poules',
    'Matchs de poule',
    'Tableau final',
    'Classement',
    'Récapitulatif'
  ];

  // Inject CSS once (tooltip + active label styling).
  function injectStyles() {
    if (document.getElementById('ddj-step-nav-styles')) return;
    const style = document.createElement('style');
    style.id = 'ddj-step-nav-styles';
    style.textContent = `
      .ddj-steps { position: relative; padding-bottom: 22px; }
      .ddj-steps .dot { position: relative; }

      /* Hover tooltip — appears above the dot, instant, clearly visible */
      .ddj-steps .dot::after {
        content: attr(data-step-name);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        background: #1a1a1a;
        color: #fff;
        padding: 4px 9px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease, transform 0.12s ease;
        z-index: 100;
        letter-spacing: 0.2px;
      }
      .ddj-steps .dot::before {
        content: '';
        position: absolute;
        bottom: calc(100% + 3px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        border: 5px solid transparent;
        border-top-color: #1a1a1a;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease, transform 0.12s ease;
        z-index: 100;
      }
      .ddj-steps .dot:hover::after,
      .ddj-steps .dot:focus::after,
      .ddj-steps .dot:hover::before,
      .ddj-steps .dot:focus::before {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* Visible label under the active dot — no hover required */
      .ddj-steps .ddj-active-label {
        position: absolute;
        top: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        color: var(--color-primary, #1F4788);
        font-weight: 700;
        white-space: nowrap;
        pointer-events: none;
        letter-spacing: 0.3px;
      }
    `;
    document.head.appendChild(style);
  }

  function wireDdjSteps() {
    injectStyles();
    const compId = new URLSearchParams(window.location.search).get('compId');
    const dots = document.querySelectorAll('.ddj-steps .dot');

    dots.forEach((dot, idx) => {
      const label = STEP_LABELS[idx] || '';
      dot.setAttribute('data-step-name', label);
      dot.setAttribute('title', label); // native fallback + accessibility

      // Visible label under the active dot
      if (dot.classList.contains('active') && label) {
        const tag = document.createElement('div');
        tag.className = 'ddj-active-label';
        tag.textContent = label;
        dot.appendChild(tag);
      }

      const url = STEP_URLS[idx];
      if (!url) return;
      if (dot.classList.contains('active')) return; // current page — no self-nav

      dot.style.cursor = 'pointer';
      dot.setAttribute('role', 'button');
      dot.setAttribute('tabindex', '0');
      const go = () => {
        if (idx === 0 || !compId) {
          window.location.href = url;
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
