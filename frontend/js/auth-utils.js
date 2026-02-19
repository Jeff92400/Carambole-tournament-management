// Authentication utility functions for Tournament Management App

// SA stale org check: detect when SA has a leftover non-CDBHS session from a previous browser session
// sessionStorage.orgChosen is set during login or SA impersonation and clears when the browser closes
(function() {
  const isSA = localStorage.getItem('isSuperAdmin') === 'true';
  const storedOrgId = localStorage.getItem('organizationId');
  const orgExplicitlyChosen = sessionStorage.getItem('orgChosen');
  const currentPage = window.location.pathname.split('/').pop();

  // Only redirect on regular pages (not SA pages, not login)
  if (isSA && storedOrgId && storedOrgId !== '1' && !orgExplicitlyChosen
      && !currentPage.startsWith('super-admin') && currentPage !== 'login.html') {
    // Stale SA impersonation session — clear and redirect to login
    localStorage.removeItem('token');
    localStorage.removeItem('sa_token');
    localStorage.removeItem('organizationId');
    localStorage.removeItem('userRole');
    localStorage.removeItem('username');
    localStorage.removeItem('userClub');
    localStorage.removeItem('userClubId');
    localStorage.removeItem('isSuperAdmin');
    window.location.href = '/login.html';
  }
})();

// Intercept all fetch responses to handle 401 errors globally
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    // Only check API calls (not external resources)
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.startsWith('/api/') && response.status === 401) {
      console.log('[Auth] API returned 401, session expired');
      // Don't redirect for login endpoints
      if (!url.includes('/auth/login') && !url.includes('/auth/forgot')) {
        handleSessionExpired();
      }
    }
    // Note: 403 means "forbidden" (insufficient role), NOT session expired.
    // Do not redirect on 403 — let the caller handle it gracefully.

    return response;
  };
})();

/**
 * Wrapper for authenticated API calls with automatic 401 handling
 * @param {string} url - The API URL to fetch
 * @param {object} options - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>} - The fetch response
 */
async function authFetch(url, options = {}) {
  const token = localStorage.getItem('token');

  if (!token) {
    console.log('[Auth] No token found, redirecting to login');
    handleSessionExpired();
    throw new Error('Session expirée');
  }

  // Add authorization header
  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };

  const response = await fetch(url, options);

  // Handle server-side token invalidation (401 only)
  if (response.status === 401) {
    console.log('[Auth] Server rejected token (401), redirecting to login...');
    handleSessionExpired();
    throw new Error('Session expirée');
  }
  // 403 = forbidden (role insufficient), not session expired — let caller handle

  return response;
}

/**
 * Handle session expiration - redirect to login with message
 */
function handleSessionExpired() {
  // Check if this was a SA session before clearing
  const wasSuperAdmin = localStorage.getItem('isSuperAdmin') === 'true';
  const hadSaToken = !!localStorage.getItem('sa_token');

  // Clear stored credentials
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('role');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userClub');
  localStorage.removeItem('userClubId');
  localStorage.removeItem('organizationId');
  localStorage.removeItem('orgSlug');
  localStorage.removeItem('sa_token');

  // Store message for login page to display
  sessionStorage.setItem('sessionExpiredMessage', 'Votre session a expiré. Veuillez vous reconnecter.');

  // SA users get the neutral SA login screen
  if (wasSuperAdmin || hadSaToken) {
    window.location.href = '/login.html?sa=1';
  } else {
    window.location.href = '/login.html';
  }
}

/**
 * Check if user is authenticated, redirect to login if not
 * Call this at the start of protected pages
 * @returns {boolean} - True if authenticated
 */
function requireAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    console.log('[Auth] No token found, redirecting to login');
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

/**
 * Get current user info from localStorage
 * @returns {object|null} - User object with username and role
 */
function getCurrentUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;

  return {
    username: localStorage.getItem('username'),
    role: localStorage.getItem('role')
  };
}

/**
 * Logout user and redirect to login
 */
function logout() {
  // Check if this is a SA session before clearing
  const wasSuperAdmin = localStorage.getItem('isSuperAdmin') === 'true';
  const hadSaToken = !!localStorage.getItem('sa_token');

  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('role');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userClub');
  localStorage.removeItem('userClubId');
  localStorage.removeItem('isSuperAdmin');
  localStorage.removeItem('organizationId');
  localStorage.removeItem('orgSlug');
  localStorage.removeItem('sa_token');

  // SA users get the neutral SA login screen
  if (wasSuperAdmin || hadSaToken) {
    window.location.href = '/login.html?sa=1';
  } else {
    window.location.href = '/login.html';
  }
}

/**
 * Return to Super Admin from an impersonated CDB session.
 * Restores the SA token and navigates to SA pages.
 */
function returnToSuperAdmin() {
  const saToken = localStorage.getItem('sa_token');
  if (!saToken) {
    // No SA token stored — just navigate (SA pages will verify access)
    window.location.href = 'super-admin.html';
    return;
  }
  // Restore SA token
  localStorage.setItem('token', saToken);
  localStorage.removeItem('sa_token');
  localStorage.removeItem('organizationId');
  localStorage.setItem('userRole', 'admin');
  localStorage.setItem('isSuperAdmin', 'true');
  window.location.href = 'super-admin-cdbs.html';
}

// ============================================
// Automatic version check system
// ============================================

/**
 * Show update notification toast
 */
function showUpdateToast() {
  // Check if toast already exists
  if (document.getElementById('update-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'update-toast';
  toast.innerHTML = `
    <div style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                background: #1F4788; color: white; padding: 15px 25px; border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000;
                display: flex; align-items: center; gap: 15px; font-family: Arial, sans-serif;">
      <span>Nouvelle version disponible</span>
      <button onclick="window.location.reload()"
              style="background: white; color: #1F4788; border: none; padding: 8px 16px;
                     border-radius: 4px; cursor: pointer; font-weight: bold;">
        Actualiser
      </button>
      <button onclick="document.getElementById('update-toast').remove()"
              style="background: transparent; color: white; border: none; cursor: pointer;
                     font-size: 18px; padding: 0 5px;">&times;</button>
    </div>
  `;
  document.body.appendChild(toast);
}

/**
 * Check app version against server
 */
async function checkAppVersion() {
  try {
    const response = await fetch('/api/version');
    if (!response.ok) return;

    const data = await response.json();
    const serverVersion = data.version;
    const storedVersion = localStorage.getItem('tournamentAppVersion');

    console.log(`[App] Version check - Server: ${serverVersion}, Stored: ${storedVersion}`);

    if (!storedVersion) {
      // First visit, store the version
      localStorage.setItem('tournamentAppVersion', serverVersion);
    } else if (storedVersion !== serverVersion) {
      // Version changed, show update toast
      console.log('[App] New version available!');
      localStorage.setItem('tournamentAppVersion', serverVersion);
      showUpdateToast();
    }
  } catch (error) {
    console.error('[App] Version check failed:', error);
  }
}

// Check version on load and every hour (only if authenticated)
if (localStorage.getItem('token')) {
  checkAppVersion();
  setInterval(checkAppVersion, 60 * 60 * 1000); // 1 hour
}

// ============================================
// Role-based navbar filtering
// ============================================

/**
 * Apply role-based visibility to navbar items.
 * - Admin: sees everything
 * - Club: sees only Accueil, Joueurs, Classements, Inscriptions, Déconnexion
 * - Viewer: sees everything except admin-only items
 *
 * Call this after DOM is loaded on pages with navbars.
 */
function applyRoleBasedNav() {
  const userRole = localStorage.getItem('userRole');

  if (userRole === 'admin' || userRole === 'lecteur') {
    // Admin and lecteur see everything, including admin-only
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  } else {
    // Non-admin: hide admin-only
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }

  // Lecteur: show everything but disable all write actions
  if (userRole === 'lecteur') {
    document.body.classList.add('role-lecteur');
    // Hide elements explicitly marked as not for lecteur
    document.querySelectorAll('.not-lecteur').forEach(el => el.style.display = 'none');
  }

  if (userRole === 'club') {
    // Club role: hide items marked not-club
    document.querySelectorAll('.not-club').forEach(el => el.style.display = 'none');
    // Show items marked club-visible
    document.querySelectorAll('.club-visible').forEach(el => el.style.display = '');

    // If on a page that club shouldn't access, redirect to dashboard
    const restrictedPages = ['generate-poules.html', 'calendar.html', 'emailing.html',
      'settings.html', 'settings-admin.html', 'import-players.html', 'import-inscriptions.html',
      'import-tournament.html', 'import-tournois.html', 'import-external.html', 'import-config.html',
      'player-accounts.html', 'player-invitations.html', 'enrollment-requests.html',
      'activity-logs.html', 'admin-activity-logs.html', 'privacy-policy-editor.html',
      'settings-reference.html', 'statistiques.html', 'clubs.html',
      'inscriptions-list.html'];
    const currentPage = window.location.pathname.split('/').pop();
    if (restrictedPages.includes(currentPage)) {
      window.location.href = 'dashboard.html';
      return;
    }
  }
}
