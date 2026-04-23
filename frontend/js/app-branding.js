// App Branding Utilities - Dynamic logo and organization name loading

const DEFAULT_LOGO_PATH = 'images/FrenchBillard-Icon-small.png';
const DEFAULT_ORG_NAME = 'CDB';

/**
 * Initialize app branding (favicon + header)
 * Call this on page load for authenticated pages
 */
async function initAppBranding() {
  try {
    // Try to load organization logo, fallback to default
    const logoUrl = await getOrganizationLogoUrl();

    // Update favicon with cache-busting
    updateFavicon(logoUrl);

    // Update header icon if element exists
    const headerIcon = document.getElementById('app-header-icon');
    if (headerIcon) {
      headerIcon.src = logoUrl;
      headerIcon.onerror = function() {
        this.src = DEFAULT_LOGO_PATH;
      };

      // Apply dynamic logo size from settings
      const logoSize = await getHeaderLogoSize();
      headerIcon.style.width = logoSize + 'px';
      headerIcon.style.height = logoSize + 'px';
    }

    // Update organization name if element exists
    const orgNameEl = document.getElementById('app-org-name');
    if (orgNameEl) {
      const orgName = await getOrganizationShortName();
      const pageTitle = orgNameEl.getAttribute('data-page-title');
      let html = (orgName || DEFAULT_ORG_NAME) +
        '<span class="navbar-subtitle">Gestion des compétitions<br>départementales FFB</span>';
      if (pageTitle) {
        html += '<span class="navbar-page-title">' + pageTitle + '</span>';
      }
      orgNameEl.innerHTML = html;
    }
    // If SA is impersonating a CDB, show a floating "Retour Plateforme" button
    if (sessionStorage.getItem('sa_token')) {
      injectSAReturnButton();
    }

    // Inject DdJ nav link for admins if module is enabled
    const userRole = sessionStorage.getItem('userRole');
    if (userRole === 'admin') {
      injectDdJNavLink();
    }

    // Show persistent test-mode banner if the org has communications test mode on.
    // Important: this runs on every admin page (dashboard, emailing, generate-poules...)
    // so admins cannot forget it's active while sending convocations.
    injectTestModeBanner();
  } catch (error) {
    console.log('[Branding] Error loading branding, using defaults:', error);
    updateFavicon(DEFAULT_LOGO_PATH);
  }
}

/**
 * Fetch the test-mode flag and show/hide the persistent banner.
 * Exposed on window so settings-admin.html can refresh it after toggling.
 */
async function injectTestModeBanner() {
  try {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    const resp = await fetch('/api/settings/org-settings-batch?keys=email_test_mode_enabled', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const enabled = data.email_test_mode_enabled === 'true';
    renderTestModeBanner(enabled);
  } catch (e) {
    // Non-fatal — banner is optional.
  }
}
window.refreshTestModeBanner = injectTestModeBanner;

function renderTestModeBanner(enabled) {
  const existing = document.getElementById('test-mode-banner');
  if (!enabled) {
    if (existing) existing.remove();
    document.body.style.paddingTop = '';
    return;
  }
  if (existing) return; // already rendered

  const banner = document.createElement('div');
  banner.id = 'test-mode-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9998;
    background: repeating-linear-gradient(45deg, #c62828, #c62828 12px, #b71c1c 12px, #b71c1c 24px);
    color: white; padding: 8px 16px; font-size: 13px; font-weight: 600;
    text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    display: flex; align-items: center; justify-content: center; gap: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  `;
  banner.innerHTML = `
    <span style="font-size: 16px;">🧪</span>
    <span>MODE TEST ACTIVÉ — Aucun email ni notification push n'est envoyé aux joueurs</span>
    <a href="settings-admin.html#organisation" style="color: white; text-decoration: underline; margin-left: 8px;">Paramètres</a>
  `;
  document.body.appendChild(banner);
  // Push page content down so the banner doesn't overlap the navbar.
  document.body.style.paddingTop = '36px';
}

/**
 * Inject a floating "Retour Plateforme" button for SA impersonation mode
 */
function injectSAReturnButton() {
  if (document.getElementById('sa-return-btn')) return; // already injected
  const btn = document.createElement('div');
  btn.id = 'sa-return-btn';
  btn.innerHTML = `
    <button onclick="returnToSuperAdmin()" style="
      position: fixed; bottom: 20px; left: 20px; z-index: 10000;
      background: linear-gradient(135deg, #dc3545, #c82333);
      color: white; border: none; padding: 10px 18px;
      border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 13px;
      box-shadow: 0 4px 12px rgba(220,53,69,0.4);
      display: flex; align-items: center; gap: 6px;
    ">
      <span style="font-size: 16px;">&#x2190;</span> Retour Plateforme
    </button>
  `;
  document.body.appendChild(btn);
}

/**
 * Inject "Directeur de Jeu" nav link (if module enabled).
 *
 * Placement rule: since V 2.0.457 the admin nav is a 5-bucket mega-menu,
 * so DdJ goes INSIDE the Compétitions dropdown panel (semantically it's a
 * tournament-day workflow). If the page hasn't been migrated to the mega-
 * menu yet (very unlikely now), we fall back to the legacy flat-sibling
 * placement to stay safe.
 */
async function injectDdJNavLink() {
  try {
    // Check if DdJ module is enabled for this org
    const token = sessionStorage.getItem('token');
    if (!token) return;
    const resp = await fetch('/api/settings/org-settings-batch?keys=enable_ddj_module', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.enable_ddj_module !== 'true') return;

    const navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;

    // Don't inject if already present (idempotent)
    if (navLinks.querySelector('a[href="directeur-de-jeu.html"]')) return;

    // Preferred placement (mega-menu, V 2.0.457+): inside the Compétitions
    // dropdown panel, as the last sub-item.
    const compBtn = navLinks.querySelector('.nav-dropdown-btn[href="generate-poules.html"]');
    if (compBtn) {
      const dropdown = compBtn.closest('.nav-dropdown');
      const panel = dropdown && dropdown.querySelector('.nav-dropdown-content');
      if (panel) {
        const link = document.createElement('a');
        link.href = 'directeur-de-jeu.html';
        link.className = 'admin-only';
        link.innerHTML = '<span class="nav-icon">🎮</span>Directeur de Jeu';
        panel.appendChild(link);
        return;
      }
    }

    // Legacy fallback: flat sibling after the Compétitions link.
    const compLink = navLinks.querySelector('a[href="generate-poules.html"]');
    if (!compLink) return;
    const ddjLink = document.createElement('a');
    ddjLink.href = 'directeur-de-jeu.html';
    ddjLink.className = 'admin-only nav-tooltip';
    ddjLink.setAttribute('data-tooltip', 'Gestion des compétitions du jour (Directeur de Jeu)');
    ddjLink.textContent = 'DdJ';
    compLink.insertAdjacentElement('afterend', ddjLink);
  } catch (e) {
    // Silently fail — DdJ link is optional
  }
}

/**
 * Get header logo size from settings
 */
async function getHeaderLogoSize() {
  try {
    const token = sessionStorage.getItem('token');
    if (!token) return 48; // Default size

    const response = await fetch('/api/settings/app/header_logo_size', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      const data = await response.json();
      return parseInt(data.value) || 48;
    }
  } catch (error) {
    console.log('[Branding] Could not fetch logo size:', error);
  }

  return 48; // Default size
}

/**
 * Get organization logo URL, returns default if not available
 */
async function getOrganizationLogoUrl() {
  try {
    const token = sessionStorage.getItem('token');
    const response = await fetch('/api/settings/organization-logo', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (response.ok) {
      const data = await response.json();
      if (data.url) {
        // Add cache-busting timestamp
        const cacheBuster = data.lastModified ? new Date(data.lastModified).getTime() : Date.now();
        const separator = data.url.includes('?') ? '&' : '?';
        return data.url + separator + 'v=' + cacheBuster;
      }
    }
  } catch (error) {
    console.log('[Branding] Could not fetch org logo:', error);
  }

  return DEFAULT_LOGO_PATH;
}

/**
 * Get organization short name from settings
 */
async function getOrganizationShortName() {
  try {
    const token = sessionStorage.getItem('token');
    if (!token) return null;

    const response = await fetch('/api/settings/app/organization_short_name', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      const data = await response.json();
      return data.value || null;
    }
  } catch (error) {
    console.log('[Branding] Could not fetch org name:', error);
  }

  return null;
}

/**
 * Update the page favicon
 */
function updateFavicon(url) {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = url;
}

/**
 * Initialize branding for public pages (no auth required)
 * Uses /logo.png public endpoint for dynamic logo
 * Also fetches organization name from public branding endpoint
 * @param {string} orgSlug - optional org slug from URL param (e.g., 'cdb94')
 */
async function initPublicBranding(orgSlug) {
  const headerIcon = document.getElementById('app-header-icon');

  // Fetch organization name and colors from branding endpoint (with org slug if provided)
  const brandingUrl = '/api/settings/branding/colors' + (orgSlug ? '?org=' + encodeURIComponent(orgSlug) : '');
  try {
    const response = await fetch(brandingUrl);
    if (response.ok) {
      const data = await response.json();
      const orgNameEl = document.getElementById('app-org-name');
      if (orgNameEl && data.organization_short_name) {
        orgNameEl.textContent = data.organization_short_name;
      }

      // Apply logo size from settings
      if (headerIcon && data.header_logo_size) {
        const logoSize = parseInt(data.header_logo_size) || 48;
        headerIcon.style.width = logoSize + 'px';
        headerIcon.style.height = logoSize + 'px';
      }
    }
  } catch (error) {
    console.log('[Branding] Could not fetch branding for public page:', error);
  }

  // Logo: use org-specific logo via download endpoint (supports ?org= for public pages)
  const logoUrl = '/api/settings/organization-logo/download' + (orgSlug ? '?org=' + encodeURIComponent(orgSlug) : '') + (orgSlug ? '&' : '?') + 'v=' + Date.now();
  updateFavicon(logoUrl);

  if (headerIcon) {
    headerIcon.src = logoUrl;
    headerIcon.onerror = function() {
      this.src = DEFAULT_LOGO_PATH;
      // Also reset favicon to default if org logo fails
      updateFavicon(DEFAULT_LOGO_PATH);
    };
  }
}

// Auto-initialize on DOM ready if token exists
document.addEventListener('DOMContentLoaded', function() {
  const token = sessionStorage.getItem('token');
  if (token) {
    // Authenticated page - load dynamic branding
    initAppBranding();
  }
  // Public pages should call initPublicBranding() manually if needed
});
