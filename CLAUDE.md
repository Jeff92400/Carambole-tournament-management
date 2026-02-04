# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**CDBHS Tournament Management System** - A French billiards tournament management application for the Comité Départemental de Billard des Hauts-de-Seine. Manages player registrations, tournament results, rankings across 13 categories, and email communications.

**Production URL:** https://cdbhs-tournament-management-production.up.railway.app
**Related App:** Player App (Espace Joueur) in separate repo `cdbhs-player-app` - shares the same PostgreSQL database

## Deployment Workflow

### Environments

| Branch | Environment | URL | Purpose |
|--------|-------------|-----|---------|
| `staging` | Demo | https://carambole-competition-app-demo.up.railway.app | Pre-prod testing & user training |
| `main` | Production | https://cdbhs-tournament-management-production.up.railway.app | Live system |

### Process

1. **Develop & Test on Demo first:**
   ```bash
   git checkout staging
   # Make changes...
   git add .
   git commit -m "Feature description"
   git push origin staging
   ```
   → Auto-deploys to Demo app

2. **Test on Demo** - Verify feature works correctly

3. **Deploy to Production** (after testing OK):
   ```bash
   git checkout main
   git merge staging
   git push origin main
   ```
   → Auto-deploys to Production

4. **Update version number** in `frontend/login.html` before production deploy

### Rollback

If issues in production:
```bash
git revert HEAD
git push origin main
```

Or revert to specific commit:
```bash
git checkout <commit-hash> -- path/to/file
git commit -m "Rollback: description"
git push origin main
```

## Versioning

**Current Version:** V 2.0.156 02/26

Version is displayed at the bottom of the login screen (`frontend/login.html`).

### Format
`V 2.0.xx mm/yy`
- `2.0` = Major.Minor version (increment minor for significant features)
- `xx` = Patch number (increment for each deployment)
- `mm/yy` = Month/Year of deployment

### Update Process
**IMPORTANT:** Increment the patch number (xx) with each deployment.
- Location: `frontend/login.html` - look for the version div near the bottom
- Example: `V 2.0.0 01/26` → `V 2.0.1 01/26` → `V 2.0.2 02/26`

## Commands

```bash
# Start development (from project root)
cd backend && npm install && npm start

# Or use the root package.json
npm run build   # Install backend dependencies
npm start       # Start server on port 3000
```

## Tech Stack

- **Backend:** Node.js 18+, Express.js, PostgreSQL (Railway)
- **Frontend:** Vanilla HTML/CSS/JS (no build process)
- **Email:** Resend API
- **Auth:** JWT + bcrypt
- **Deployment:** Railway with Nixpacks

## Architecture

```
cdbhs-tournament-management/
├── backend/
│   ├── server.js           # Express entry point, schedulers
│   ├── db-loader.js        # Auto-selects PostgreSQL/SQLite
│   ├── db-postgres.js      # PostgreSQL adapter (production)
│   ├── db.js               # SQLite adapter (local dev)
│   └── routes/             # API route modules
├── frontend/
│   ├── *.html              # Page files (dashboard, rankings, etc.)
│   ├── css/styles.css      # Single shared stylesheet
│   └── js/                 # Shared utilities (auth, clubs)
└── database/               # Local SQLite storage (dev only)
```

## Key Routes (backend/routes/)

| Route | Purpose |
|-------|---------|
| `auth.js` | JWT authentication, password reset |
| `tournaments.js` | Tournament results, CSV import |
| `inscriptions.js` | Player registrations (IONOS + Player App sources) |
| `email.js` | Convocations, results emails via Resend |
| `emailing.js` | Mass campaigns, scheduled emails |
| `rankings.js` | Season rankings calculation |
| `clubs.js` | Club management with aliases |
| `player-accounts.js` | Player App account management |
| `announcements.js` | Global announcements for Player App |
| `player-invitations.js` | Invitation emails for Player App registration |

## Key Frontend Pages

| Page | Purpose |
|------|---------|
| `dashboard.html` | Main hub with stats and alerts |
| `generate-poules.html` | Tournament pools/convocations |
| `rankings.html` | Season rankings by category |
| `emailing.html` | Mass email campaigns |
| `inscriptions-list.html` | Player registrations |
| `player-invitations.html` | Player App invitation management |
| `settings-admin.html` | System administration |

## Database

**Production:** PostgreSQL on Railway (`DATABASE_URL` env var)
**Local dev:** SQLite in `database/billard.db`

Key tables:
- `players` - FFB-licensed players with rankings
- `categories` - 13 competition categories
- `tournoi_ext` / `inscriptions` - External tournaments and registrations
- `convocation_poules` - Stored poule compositions (shared with Player App)
- `player_accounts` - Player App authentication
- `player_invitations` - Tracks invitations sent to players for Player App registration
- `game_parameters` - Default Distance/Reprises per mode+category for the season
- `tournament_parameter_overrides` - Per-tournament overrides for Distance/Reprises

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret
- `RESEND_API_KEY` - Email sending
- `BASE_URL` - Public URL of the app (e.g., `https://mon-comite.up.railway.app`). **Critical for emails**: logos and links in convocations use this URL. Without it, defaults to production URL.

Optional:
- `PORT` - Server port (default 3000)
- `ALLOWED_ORIGINS` - CORS origins

## Development Notes

- All text is in **French**
- Dates: Paris timezone, displayed as DD/MM/YYYY
- Season format: `YYYY-YYYY+1` (e.g., "2024-2025"), configurable start month via `app_settings.season_start_month` (default: 9 = September)
- **Dynamic branding colors:** Colors are loaded from `app_settings` table and applied via CSS variables. See "Branding System" section below.
- Licence numbers normalized by removing spaces
- CSV imports use semicolon delimiter
- **Billiard icon:** Never use the American 8-ball emoji (🎱). Always use the French billiard icon image instead: `<img src="images/FrenchBillard-Icon-small.png" alt="" style="height: 24px; width: 24px; vertical-align: middle;">`
- **Test data exclusion:** ALWAYS exclude test accounts from counts and lists. Test accounts have licences starting with "TEST" (case-insensitive). Use `WHERE UPPER(licence) NOT LIKE 'TEST%'` in queries.
- **No hardcoding reference data:** NEVER hardcode values like game modes, FFB rankings, clubs, or categories. Always load them dynamically from the reference tables (`game_modes`, `ffb_rankings`, `clubs`, `categories`) via the API (`/api/reference-data/*`). See "Dynamic Selectors" section below.
- **Helmet security headers:** The helmet middleware sets restrictive headers by default. For public endpoints that need to be accessed by external services (email clients, embeds, etc.), you must override specific headers. Common issue: `Cross-Origin-Resource-Policy: same-origin` blocks email clients from loading images. Fix by adding `res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');` to the endpoint.
- **Case-insensitive mode/game_type queries:** ALWAYS use `UPPER()` for case-insensitive comparisons when querying `mode_mapping`, `game_parameters`, or any table that stores game modes/types. Frontend may pass "Libre" (INITCAP) while tables store "LIBRE" (uppercase). Example: `WHERE UPPER(game_type) = UPPER($1)` instead of `WHERE game_type = $1`. This applies to all mode, game_type, and categorie comparisons across `inscriptions.js`, `emailing.js`, and other routes.

## Inscription Sources

- `'ionos'` - CSV import from IONOS system
- `'player_app'` - Self-registration via Player App
- `'manual'` - Admin added via dashboard

**Note:** IONOS will be decommissioned next year; Player App will become the sole source.

## Branding System

The app supports dynamic branding for multi-organization deployment.

### Color Settings (app_settings table)
| Key | Default | Used For |
|-----|---------|----------|
| `primary_color` | #1F4788 | Headers, navbar, buttons, links |
| `secondary_color` | #667eea | Gradients, hover states |
| `accent_color` | #ffc107 | Alerts, warnings, badges |
| `background_color` | #f8f9fa | Email body, page backgrounds |
| `background_secondary_color` | #f5f5f5 | Alternating rows, cards |

### How It Works
1. **CSS Variables:** `frontend/css/styles.css` defines `:root` variables with defaults
2. **branding.js:** Loaded on every page, fetches `/api/settings/branding/colors` and updates CSS variables
3. **Email templates:** Backend routes fetch colors via `appSettings.getSetting('primary_color')`

### Files
- `frontend/js/branding.js` - Fetches colors, updates CSS variables (5-min cache)
- `frontend/css/styles.css` - CSS variables in `:root` section
- `backend/routes/settings.js` - Public `/branding/colors` endpoint

### Adding to New Pages
Include branding.js after styles.css:
```html
<link rel="stylesheet" href="css/styles.css">
<script src="js/branding.js"></script>
```

## Dynamic Selectors (CRITICAL)

**All dropdown/select options must load dynamically from the database.** Never hardcode reference data like game modes, FFB rankings, categories, tournament rounds, etc.

### Rollback Point
- **Tag:** `pre-dynamic-selectors-v2.0.144`
- **Date:** February 2026
- **Purpose:** Rollback point before dynamic selectors refactoring

### Reference Data Tables & Endpoints

| Data Type | Database Table | API Endpoint |
|-----------|---------------|--------------|
| Game Modes | `game_modes` | `/api/reference-data/game-modes` |
| FFB Rankings | `ffb_rankings` | `/api/reference-data/ffb-rankings` |
| Categories | `categories` | `/api/reference-data/categories` |
| Clubs | `clubs` | `/api/clubs` |
| Announcement Types | `announcement_types` | `/api/reference-data/announcement-types` |
| Contact Statuses | `contact_statuses` | `/api/reference-data/contact-statuses` |
| Inscription Sources | `inscription_sources` | `/api/reference-data/inscription-sources` |
| Tournament Rounds | `tournament_rounds` | `/api/reference-data/tournament-rounds` |
| User Roles | `user_roles` | `/api/reference-data/user-roles` |

### Implementation Pattern
```javascript
// Load reference data on page init
async function loadGameModes() {
  const response = await authFetch('/api/reference-data/game-modes');
  const modes = await response.json();
  const select = document.getElementById('gameModeSelect');
  select.innerHTML = '<option value="">-- Sélectionner --</option>' +
    modes.map(m => `<option value="${m.code}">${m.display_name}</option>`).join('');
}
```

## Per-Tournament Game Parameter Overrides

Organizers can override default **Distance** and **Reprises** values for specific tournaments (T1, T2, T3, Finale).

### How It Works
1. Default values come from `game_parameters` table (per mode+category for the season)
2. In `generate-poules.html`, Distance and Reprises are now editable
3. User must click "Valider les parametres" before sending convocations
4. Overrides are stored in `tournament_parameter_overrides` table (one per tournament)
5. For finale relances in `emailing.html`, a game params section appears requiring validation

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/settings/tournament-overrides/:tournoiId` | Get override or defaults |
| PUT | `/api/settings/tournament-overrides/:tournoiId` | Save/validate override |
| DELETE | `/api/settings/tournament-overrides/:tournoiId` | Reset to defaults |

### Database Table
```sql
tournament_parameter_overrides (
  id, tournoi_id, distance, distance_type, reprises,
  validated_at, validated_by, created_at
)
```

## See Also

- `backend/CLAUDE.md` - Detailed backend documentation
- `frontend/CLAUDE.md` - Detailed frontend documentation

## TODO / Future Work

- **Email address consolidation:** Replace all hardcoded `cdbhs92@gmail.com` references across email flows with the `summary_email` setting from Organization settings (`app_settings` table). Files to update include: `backend/routes/emailing.js`, `backend/routes/email.js`, `backend/routes/inscriptions.js`, `frontend/emailing.html`, `frontend/generate-poules.html`, and others. The notification email should always be loaded dynamically from the database.
