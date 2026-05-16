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
  // Carambole (default) — 7 steps with Classement (consolante)
  const STEP_URLS = [
    'directeur-de-jeu.html',                 // 0 - Sélection (landing, no compId)
    'directeur-de-jeu-pointage.html',        // 1 - Pointage
    'directeur-de-jeu-poules.html',          // 2 - Poules
    'directeur-de-jeu-matchs.html',          // 3 - Matchs de poule
    'directeur-de-jeu-bracket.html',         // 4 - Tableau final
    'directeur-de-jeu-classement.html',      // 5 - Classement (Consolante)
    'directeur-de-jeu-recap.html'            // 6 - Récapitulatif
  ];
  const STEP_LABELS = [
    'Sélection',
    'Pointage',
    'Poules',
    'Matchs de poule',
    'Tableau final',
    'Classement',
    'Récapitulatif'
  ];

  // V 2.0.825 — Quilles LBIF variant : Barrage replaces Classement.
  // Activate by adding data-mode="quilles" on the .ddj-steps element.
  // 7 steps: Sélection → Pointage → Poules → Matchs poules → Barrage →
  // Tableau final → Récap (no consolante per LBIF règlement).
  const STEP_URLS_QUILLES = [
    'directeur-de-jeu.html',                 // 0 - Sélection
    'directeur-de-jeu-pointage.html',        // 1 - Pointage
    'directeur-de-jeu-poules.html',          // 2 - Poules
    'directeur-de-jeu-matchs.html',          // 3 - Matchs de poule
    'directeur-de-jeu-barrage.html',         // 4 - Barrage (LBIF only)
    'directeur-de-jeu-bracket.html',         // 5 - Tableau final
    'directeur-de-jeu-recap.html'            // 6 - Récapitulatif
  ];
  const STEP_LABELS_QUILLES = [
    'Sélection',
    'Pointage',
    'Poules',
    'Matchs de poule',
    'Barrage',
    'Tableau final',
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
    // V 2.0.825 — Quilles variant detected via data-mode="quilles" on .ddj-steps
    const stepsContainer = document.querySelector('.ddj-steps');
    const isQuilles = stepsContainer && stepsContainer.getAttribute('data-mode') === 'quilles';
    const URLS = isQuilles ? STEP_URLS_QUILLES : STEP_URLS;
    const LABELS = isQuilles ? STEP_LABELS_QUILLES : STEP_LABELS;

    const dots = document.querySelectorAll('.ddj-steps .dot');

    dots.forEach((dot, idx) => {
      const label = LABELS[idx] || '';
      dot.setAttribute('data-step-name', label);
      dot.setAttribute('title', label); // native fallback + accessibility

      // Visible label under the active dot
      if (dot.classList.contains('active') && label) {
        const tag = document.createElement('div');
        tag.className = 'ddj-active-label';
        tag.textContent = label;
        dot.appendChild(tag);
      }

      const url = URLS[idx];
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

  /**
   * V 2.0.745 — Called by pages once they know the DdJ mode.
   * In 'single_poule' mode, steps 4 (Tableau final) and 5 (Classement)
   * are greyed out and made non-clickable; clicking either redirects
   * directly to the Récapitulatif page instead.
   */
  window.ddjSetMode = function ddjSetMode(mode) {
    if (mode !== 'single_poule') return;
    const compId = new URLSearchParams(window.location.search).get('compId');
    const dots = document.querySelectorAll('.ddj-steps .dot');
    [4, 5].forEach(idx => {
      const dot = dots[idx];
      if (!dot) return;
      dot.style.opacity = '0.3';
      dot.style.cursor = 'not-allowed';
      dot.title = 'Non applicable — poule unique';
      dot.setAttribute('data-step-name', (STEP_LABELS[idx] || '') + ' (non applicable)');
      // Replace the node to strip previous click/keyboard listeners
      const fresh = dot.cloneNode(true);
      fresh.style.opacity = '0.3';
      fresh.style.cursor = 'not-allowed';
      dot.parentNode.replaceChild(fresh, dot);
    });
  };
})();
