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
├── js/club-utils.js    # Shared club logo utilities
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
All authenticated pages follow this pattern:
```javascript
const API_URL = '/api';
const token = localStorage.getItem('token');

// Redirect if not authenticated
if (!token) {
  window.location.href = 'login.html';
}

// API calls include Bearer token
fetch(`${API_URL}/endpoint`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Role-Based UI
- Admin-only elements use class `admin-only`
- JS checks `localStorage.getItem('userRole')` to show/hide
- Roles: `admin`, `editor`, `viewer`

### Shared Utilities (js/club-utils.js)
- `loadClubsFromDatabase()` - Fetches clubs on page load
- `getClubLogoHTML(clubName, options)` - Returns HTML with logo + name
- `getClubInfo(clubName)` - Returns `{logo, displayName}`
- `normalizeClubName(name)` - Normalizes for matching

### CSS Conventions
- Primary color: `#1F4788` (CDBHS blue)
- Gradient: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- Button variants: `.btn`, `.btn-success`, `.btn-danger`
- Cards: `.card` class for content sections
- Navigation: `.navbar`, `.nav-links`, `.nav-tooltip`

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
