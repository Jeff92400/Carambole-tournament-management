// frontend/js/quilles-banner.js
//
// V 2.0.790 — Sprint 2 D.1: Shared Quilles banner renderer for the DdJ pages.
// All 7 DdJ pages (pointage, poules, matchs, bracket, classement, recap +
// the dashboard) call renderQuillesBanner(tournament) after loading their
// tournament context. When the tournament is Quilles (mode = 5Q or 9Q),
// a fixed LBIF-themed banner is injected at the top of the page; for
// carambole tournaments the function is a no-op.
//
// The banner is idempotent: calling it multiple times replaces the existing
// banner instead of stacking.

(function () {
  'use strict';

  const BANNER_ID = 'quillesBanner';

  // Localised labels for tournament_type codes (mirrors the seeded values
  // in quilles_tournament_types). Falls back to the raw code if unknown.
  const TYPE_LABELS = {
    regional: 'Régional',
    qualif_n1: 'Qualificatif N1',
    finale_ligue: 'Finale de Ligue'
  };

  function _isQuillesMode(mode) {
    const m = String(mode || '').toUpperCase().trim();
    return m === '5Q' || m === '9Q' || m === '5 QUILLES' || m === '9 QUILLES';
  }

  function _normaliseMode(mode) {
    const m = String(mode || '').toUpperCase().trim();
    if (m === '5Q' || m === '5 QUILLES') return '5Q';
    if (m === '9Q' || m === '9 QUILLES') return '9Q';
    return null;
  }

  function _modeLabel(mode) {
    return _normaliseMode(mode) === '5Q' ? '5 Quilles' : '9 Quilles';
  }

  function _tourLabel(tournament) {
    const n = tournament.tour_number || tournament.tournament_number;
    if (!n) return '';
    const isFinaleType = tournament.tournament_type === 'finale_ligue';
    return isFinaleType ? 'Finale de Ligue' : `TR${n}`;
  }

  function _typeLabel(tournament) {
    const code = tournament.tournament_type;
    if (!code) return '';
    return TYPE_LABELS[code] || code;
  }

  /**
   * Render the LBIF banner if the tournament is Quilles; otherwise removes
   * any existing banner. Safe to call on every render() pass.
   *
   * @param {object} tournament - tournoi_ext-like row (must include `mode`,
   *   optional `tournament_type`, `tour_number`, `tournament_number`)
   */
  function renderQuillesBanner(tournament) {
    // Remove existing banner if any
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();

    if (!tournament || !_isQuillesMode(tournament.mode)) return;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = [
      'background: linear-gradient(135deg, #c8102e 0%, #8b0000 100%)',
      'color: white',
      'padding: 10px 16px',
      'border-radius: 8px',
      'margin-bottom: 14px',
      'box-shadow: 0 2px 6px rgba(200, 16, 46, 0.3)',
      'display: flex',
      'align-items: center',
      'gap: 12px',
      'font-size: 14px',
      'font-weight: 600',
      'letter-spacing: 0.3px'
    ].join('; ');

    const iconHtml = `<img src="images/quilles/quilles-icon.png" alt="Quilles" style="height: 28px; width: 28px; border-radius: 4px; flex-shrink: 0; object-fit: cover;" onerror="this.style.display='none';">`;

    const mode = _modeLabel(tournament.mode);
    const tour = _tourLabel(tournament);
    const type = _typeLabel(tournament);
    const parts = [mode];
    if (tour) parts.push(tour);
    if (type && type !== tour) parts.push(type);
    const label = parts.join(' — ');

    banner.innerHTML = `
      ${iconHtml}
      <span style="font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">LBIF</span>
      <span style="opacity: 0.7;">·</span>
      <span>${label}</span>
    `;

    // Try preferred anchors in order; fall back to body prepend.
    const anchors = [
      document.querySelector('.ddj-tournament-header'),
      document.querySelector('.tournament-header'),
      document.querySelector('main'),
      document.querySelector('.container'),
      document.body
    ];
    const anchor = anchors.find(el => el);
    if (anchor && anchor.firstChild) anchor.insertBefore(banner, anchor.firstChild);
    else if (anchor) anchor.appendChild(banner);
  }

  // Expose globally
  window.renderQuillesBanner = renderQuillesBanner;
  window.isQuillesMode = _isQuillesMode;
})();
