# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CDBHS Tournament Management frontend - Admin dashboard for French billiards tournament management. Vanilla HTML/CSS/JS with no build process.

## Architecture

### No Build System
- Static HTML files served directly by Express backend
- No npm, no bundler, no transpilation
- Edit HTML/CSS/JS files directly - changes are immediate

### File Structure
```
frontend/
├── css/styles.css      # Single shared stylesheet
├── js/
│   ├── auth-utils.js   # Authentication utilities (401 handling)
│   └── club-utils.js   # Shared club logo utilities
├── images/
│   ├── clubs/          # Club logo PNGs
│   └── billiard-icon.png
└── *.html              # Page files
```

### Key Pages
| Page | Purpose |
|------|---------|
| `login.html` | Authentication entry point |
| `dashboard.html` | Main hub with stats, quick actions, alerts |
| `rankings.html` | Season rankings by category |
| `generate-poules.html` | Tournament pools/convocations management |
| `tournaments-list.html` | Completed tournaments (internal T1/T2/T3) |
| `tournois-list.html` | External tournaments from IONOS |
| `inscriptions-list.html` | Player registrations management |
| `emailing.html` | Mass email campaigns, templates |
| `settings.html` / `settings-admin.html` | User and system settings |
| `player-accounts.html` | Player App account management |

### Authentication Pattern
All authenticated pages include `auth-utils.js` and follow this pattern:
```html
<script src="js/auth-utils.js"></script>
<script>
  const API_URL = '/api';

  // Redirect if not authenticated
  if (!requireAuth()) {
    throw new Error('Not authenticated');
  }
  const token = localStorage.getItem('token');

  // API calls include Bearer token
  fetch(`${API_URL}/endpoint`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
</script>
```

### Auth Utilities (js/auth-utils.js)
- **Global 401 interceptor**: Automatically catches 401/403 on all `/api/` calls and redirects to login
- `requireAuth()` - Checks token exists, redirects to login if not
- `authFetch(url, options)` - Fetch wrapper that adds Authorization header
- `handleSessionExpired()` - Clears storage, sets message, redirects to login
- `getCurrentUser()` - Returns `{username, role}` from localStorage
- `logout()` - Clears auth and redirects to login

**Session expired flow**: When any API returns 401/403, user sees "Votre session a expiré" on login page.

### Role-Based UI

**Two complementary mechanisms coexist:**

1. **Element-class gating (legacy + ongoing)** — per-element visibility via CSS classes:
   - `.admin-only` → shown only to `admin` (and historically `lecteur`). Hidden otherwise via inline JS in each page (`applyRoleBasedNav` in `js/auth-utils.js`).
   - `.club-visible` → shown only to `club` role (starts `display:none`, JS reveals).
   - `.not-club` / `.not-lecteur` → hidden for those specific roles.
   - `.non-admin-only` → hidden when user IS admin. Used for e.g. the top-level Statistiques link that admins reach via the Settings page instead.

2. **Body-role tagging (V 2.0.453+)** — `auth-utils.js` adds `body.role-<userRole>` on every authenticated page before `DOMContentLoaded`. CSS can then target role-specific rules without per-page JS:
   ```css
   body.role-admin .non-admin-only { display: none !important; }
   body.role-lecteur .not-lecteur  { display: none !important; }
   body.role-club   .club-hint      { display: block; }
   ```
   Prefer this for new role-specific styling — no flash of wrong content, no 30-file JS edits.

**Actual roles in production** (see `backend/routes/auth.js:703`): `admin`, `viewer`, `lecteur`, `club`, `ligue_admin`, `directeur_jeu`. (The old list "admin / editor / viewer" was outdated.)

### Mega-menu nav (V 2.0.457+)

All 33 CDB admin pages share the same 5-bucket navbar structure:

```
🏠 Accueil  │  🏆 Compétitions ▾  │  📊 Données ▾  │  📧 Com joueurs  │  ⚙️ Paramètres ▾  │  🚪
```

- Dropdowns use the existing `.nav-dropdown` / `.nav-dropdown-btn` / `.nav-dropdown-content` CSS (in `css/styles.css`). No new styling.
- Each page marks its bucket's dropdown button `.active` so users know where they are. See `/tmp/rollout-megamenu.js` (the one-shot script used for the rollout) for the page→bucket mapping.
- Super Admin pages (`super-admin*.html`) and `ligue-dashboard.html` keep their own nav — do NOT apply the CDB mega-menu there.
- The DdJ link is injected dynamically by `js/app-branding.js` (`injectDdJNavLink`) into the Compétitions dropdown panel when `enable_ddj_module=true` for the org.

### Shared Utilities (js/club-utils.js)
- `loadClubsFromDatabase()` - Fetches clubs on page load
- `getClubLogoHTML(clubName, options)` - Returns HTML with logo + name
- `getClubInfo(clubName)` - Returns `{logo, displayName}`
- `normalizeClubName(name)` - Normalizes for matching

### CSS Conventions
- **Colors are dynamic** - use CSS variables: `var(--color-primary)`, `var(--color-secondary)`, etc.
- Default primary: `#1F4788`, secondary: `#667eea`, accent: `#ffc107`
- Gradient: `linear-gradient(135deg, var(--color-secondary) 0%, var(--color-secondary-dark) 100%)`
- Button variants: `.btn`, `.btn-success`, `.btn-danger`
- Cards: `.card` class for content sections
- Navigation: `.navbar`, `.nav-links`, `.nav-tooltip`
- **branding.js** loads colors from API and updates CSS variables on page load

### Common Patterns

**Show/hide messages:**
```javascript
document.getElementById('errorMessage').textContent = 'Error text';
document.getElementById('errorMessage').style.display = 'block';
```

**Table rendering:**
```javascript
tbody.innerHTML = data.map(item => `
  <tr>
    <td>${item.field}</td>
  </tr>
`).join('');
```

**Image fallback:**
```html
<img src="path.png" onerror="this.style.display='none'">
```

## Development Notes

- All text is in French
- Dates displayed in French format (DD/MM/YYYY)
- Season format displayed as "2024-2025"
- Club logos are PNGs in `images/clubs/`, matched by normalized name
- **Billiard icon:** Never use the American 8-ball emoji (🎱). This is a French billiards app (carambole). Always use the French billiard icon:
  ```html
  <img src="images/FrenchBillard-Icon-small.png" alt="" style="height: 24px; width: 24px; vertical-align: middle;">
  ```
