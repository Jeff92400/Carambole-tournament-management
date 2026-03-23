# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**CDBHS Tournament Management System** - A French billiards tournament management application for the Comité Départemental de Billard des Hauts-de-Seine. Manages player registrations, tournament results, rankings across 13 categories, and email communications.

**Production URL:** https://cdbhs-tournament-management-production.up.railway.app
**Related App:** Player App (Espace Joueur) in separate repo `cdbhs-player-app` - shares the same PostgreSQL database

## Deployment Workflow

### Environment

| Branch | Environment | URL |
|--------|-------------|-----|
| `main` | Production | https://cdbhs-tournament-management-production.up.railway.app |

**IMPORTANT:** Push all changes directly to `main`. Do NOT use the `staging` branch.

The demo app (`carambole-competition-app-demo.up.railway.app`) exists but is **frozen** — it has its own separate database with stale demo data and should NOT receive updates.

### Process

```bash
# Make changes on main branch
git add <files>
git commit -m "Feature description"
git push origin main
```
→ Auto-deploys to Production

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

**Current Version:** V 2.0.314 03/26

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
- **Email:** Resend API (free plan — single verified domain `cdbhs.net`)
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
| `wordpress.js` | WordPress XML-RPC connector for publishing convocations |

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
| `public-tournament.html` | Public tournament page (no auth, org-branded) |

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

## Resend Email Configuration

**Plan:** Free (1 custom domain, 100 emails/day, 3,000 emails/month)
**Verified domain:** `cdbhs.net` — all CDB sender addresses must use this domain.

### How It Works
- All CDBs share the same `RESEND_API_KEY` (single Railway env var)
- Each CDB has per-org sender addresses in `organization_settings` (`email_communication`, `email_convocations`, `email_noreply`)
- Sender **name** is org-specific (e.g., "CDB9493"), sender **address** must be `*@cdbhs.net`
- `platform_email_domain` in Super Admin → Paramètres must be set to `cdbhs.net`
- New CDBs auto-get `{slug}@cdbhs.net` addresses during creation

### Multi-Domain Upgrade
To give each CDB a branded sender domain (e.g., `cdb9493@ffbcarambole-gestion.fr`):
1. Upgrade Resend to **Pro plan ($20/month)** — supports multiple custom domains
2. Add the new domain in Resend → Domains → "+ Add domain"
3. Configure DNS records (DKIM CNAME + SPF) at the domain registrar
4. Wait for verification, then update the CDB's email settings

### Troubleshooting
- Resend API returns 200 (success) even if the sender domain is unverified — emails are silently dropped
- If emails aren't arriving: check that the sender address uses a **verified** domain in Resend
- Check verified domains at: https://resend.com/domains

## Development Notes

- **User Guide Maintenance:** The source of truth is `frontend/guide-utilisateur.html` (served in the app). It MUST be updated whenever a **new feature** is implemented (new page, new setting, changed functionality). Add/update the relevant sections, update the glossary if new terms are introduced, and keep the same structure and writing style (French, formal, step-by-step). Include the guide update in the same commit as the feature. Bug fixes do NOT require guide updates. **After every guide update, sync the two other copies:** copy `frontend/guide-utilisateur.html` → `GUIDE-UTILISATEUR-COMPLET.html` (root), and regenerate `GUIDE-UTILISATEUR-COMPLET.md` from the HTML content. Always include these synced files in the same commit.
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
- **Safari CORS is extremely strict:** Safari's Intelligent Tracking Prevention (ITP) blocks cross-origin resources even with proper CORS headers. If images/resources work in Chrome but not Safari, the solution is to **proxy them through the consuming app's backend** rather than loading cross-origin. Example: Player App proxies club logos via `/api/player/club-logo/:filename` instead of loading directly from Tournament App. This is a recurring issue - always test in Safari!
- **Club logos: dual storage (filesystem + database).** Logos are uploaded to `frontend/images/clubs/{orgSlug}/filename.png` (filesystem) AND stored as `BYTEA` in `clubs.logo_data` + `clubs.logo_content_type` columns. The `/images/clubs/*` middleware in `server.js` checks the filesystem first; if the file is missing (e.g., after a Railway deployment), it serves from the database. This ensures logos survive Railway's ephemeral filesystem. **Important:** All `SELECT` queries on `clubs` must explicitly list columns and exclude `logo_data` to avoid bloating JSON responses.
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

### Copyright Mark
`branding.js` injects a "JR ©" mark in the top-right corner of all screens (fixed position, `z-index: 9999`). The login page also has a static "JR ©" below the version text.

### Adding to New Pages
Include branding.js after styles.css:
```html
<link rel="stylesheet" href="css/styles.css">
<script src="js/branding.js"></script>
```

## Dynamic Selectors (CRITICAL)

**All dropdown/select options must load dynamically from the database.** Never hardcode reference data like game modes, FFB rankings, categories, tournament rounds, etc.

### WARNING: NEVER HARDCODE OPTIONS

This rule applies to ALL selectors, filters, and dropdowns across the entire application:
- **Game modes** (Libre, Cadre, Bande, 3 Bandes) - load from `game_modes` table
- **FFB rankings** (N1, N2, N3, R1-R5, D1-D3) - load from `ffb_rankings` table
- **Categories** (Libre N2, Cadre 47/2 R3, etc.) - load from `categories` table
- **Clubs** - load from `clubs` table

**Common mistake:** Writing `<option value="CADRE">Cadre</option>` directly in HTML. This WILL break when category names change (e.g., "Cadre" → "Cadre 47/2").

**Correct approach:** Empty `<select>` tags populated via JavaScript calling the API endpoints listed below.

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

## WordPress Connector (Site Web Publishing)

Convocation and results articles can be published directly to a CDB's WordPress website from within the app. Uses XML-RPC API (`xmlrpc.php`) — the REST API is locked by security plugins on some WP installations.

### Architecture

- **Custom XML-RPC client** in `backend/routes/wordpress.js` — no external npm dependency
- XML-RPC methods used: `wp.getUsersBlogs` (test), `wp.getTerms` (list categories), `wp.newTerm` (create category), `wp.newPost` (create), `wp.editPost` (update), `wp.deletePost` (delete)
- **Category hierarchy**: auto-creates `Saison {season}` > `Convocations {season}` and `Saison {season}` > `Résultats {season}` (graceful fallback if user lacks permission — publishes without category)
- **Convocation tracking**: `tournoi_ext.wp_post_id` tracks published convocation posts — updates existing post instead of creating duplicates
- **Results tracking**: `tournaments.wp_results_post_id` tracks published results posts
- **Results article style**: engaging French sports journalism with podium mentions (including clubs), full results table, season rankings, next tournament info, and special sections for T3 qualification and finale
- **Public tournament page**: `/public/:orgSlug/tournament/:id` — standalone page (no auth) showing tournament info + poule compositions, linked from WP articles

### Per-Organization Settings (organization_settings)

| Key | Description |
|-----|-------------|
| `wp_site_url` | WordPress site URL (e.g., `https://cdbhs.net`) |
| `wp_username` | WordPress username |
| `wp_app_password` | WordPress Application Password |
| `wp_default_status` | Default post status: `draft` or `publish` |
| `wp_enabled` | Enable/disable WP publishing (`true`/`false`) |

### API Endpoints (`/api/wordpress/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/test-connection` | Test WP credentials via `wp.getUsersBlogs` |
| GET | `/categories` | List WP categories |
| POST | `/publish-convocation` | Create/update convocation post from frontend data |
| POST | `/publish-from-saved/:tournoiId` | Create/update convocation post from saved DB data (standalone) |
| GET | `/status/:tournoiId` | Check if tournament has a WP convocation post |
| DELETE | `/delete/:tournoiId` | Delete WP convocation post + clear `wp_post_id` |
| POST | `/publish-results` | Create/update results article (sports reporting style) |
| GET | `/results-status/:tournamentId` | Check if tournament has a WP results post |
| DELETE | `/delete-results/:tournamentId` | Delete WP results post + clear `wp_results_post_id` |

### Database Columns

- `tournoi_ext.wp_post_id INTEGER` — tracks WP post for convocations
- `tournaments.wp_results_post_id INTEGER` — tracks WP post for results

### Frontend Integration

**Convocations (generate-poules.html):**
- **Step 4**: "Publier également sur le site web" checkbox — publishes alongside email send
- **Standalone publish button**: "Publier sur le site web (sans envoyer d'emails)" — available after poules are generated
- **Tournament cards**: "Publier sur le site" / "Mettre à jour le site" button when WP is enabled and convocations have been sent
- **Delete button**: removes article from WordPress
- **Test mode**: publishes as draft with `[TEST]` title prefix and red warning banner in content
- **Status indicator**: shows existing post info with link to WP article

**Results (emailing.html):**
- **Résultats Tournoi tab**: Checkbox + standalone "Publier sur le site web" button, triggered alongside results email send
- **Résultats Finale tab**: Same checkbox + standalone button pattern for finale results
- Results articles include: podium with clubs, full results table, season rankings, next tournament info, T3 qualification section, finale champion text

### Files

| File | Purpose |
|------|---------|
| `backend/routes/wordpress.js` | XML-RPC client, all WP endpoints (convocations + results) |
| `frontend/generate-poules.html` | WP convocation publish UI (checkbox, buttons, status) |
| `frontend/emailing.html` | WP results publish UI (both regular + finale tabs) |
| `frontend/settings-admin.html` | WP connector settings panel (Organisation tab) |
| `frontend/public-tournament.html` | Public tournament page (no auth) |
| `backend/server.js` | Public page route + public API endpoint |

## Email Template Variables

**Policy:** ALL template variables must be available for ALL email templates (convocations, relances, campaigns, results). When adding new variables, add them to every email template location.

### Available Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{first_name}` | Player's first name | Jean |
| `{last_name}` | Player's last name | Dupont |
| `{player_name}` | Full name | Jean Dupont |
| `{club}` | Player's club | BC Paris |
| `{category}` | Competition category | Libre N2 |
| `{tournament}` | Tournament label | T1, T2, Finale |
| `{date}` | Tournament date | 15/03/2026 |
| `{tournament_date}` | Tournament date (relances) | 15/03/2026 |
| `{tournament_lieu}` | Tournament location | Salle Charenton |
| `{time}` | Start time | 14H00 |
| `{location}` | Location name | Salle Charenton |
| `{poule}` | Poule number | 1 |
| `{distance}` | Game distance (points) | 80 |
| `{reprises}` | Number of reprises | 25 |
| `{deadline_date}` | Registration deadline | 08/03/2026 |
| `{organization_name}` | Full org name | Comité Départemental... |
| `{organization_short_name}` | Short org name | CDBHS |
| `{organization_email}` | Contact email | contact@cdbhs.net |

### Adding New Variables

When adding a new template variable:
1. Add to `backend/routes/email.js` - convocation templateVariables (~line 1331)
2. Add to `backend/routes/emailing.js` - relance replaceVar calls (~line 4915)
3. Add to this documentation table
4. Variables not applicable to a context will be empty strings

## Structured Rule Engine (Scoring Rules)

The scoring system uses a generic expression evaluator for bonus points. Rules are stored in `scoring_rules` with structured columns:

### Database Columns (scoring_rules)
- `field_1`, `operator_1`, `value_1` — First condition (e.g., MOYENNE > MOYENNE_MAXI)
- `logical_op` — AND / OR / NULL
- `field_2`, `operator_2`, `value_2` — Optional second condition
- `column_label` — Display label (e.g., "Bonus Moy.")

### Available Fields
| Code | Description | Source |
|------|-------------|--------|
| `MOYENNE` | Player's average | `result.points / result.reprises` |
| `NB_JOUEURS` | Number of players | `COUNT(*)` on tournament_results |
| `MATCH_POINTS` | Match points | `result.match_points` |
| `SERIE` | Best series | `result.serie` |

### Reference Values
- `MOYENNE_MAXI` → from `game_parameters.moyenne_maxi`
- `MOYENNE_MINI` → from `game_parameters.moyenne_mini`

### Backend Functions (tournaments.js)
- `resolveField()`, `resolveValue()`, `evaluateOp()`, `evaluateRule()` — Generic evaluation engine
- `computeBonusPoints()` — Evaluates all structured rules per player result
- `computeBonusMoyenne()` — Computes MOYENNE_BONUS from game_parameters thresholds (Normal or Par paliers)
- `assignPositionPointsIfJournees()` — Computes position from match results (match_points desc, moyenne desc) and assigns position_points from lookup table (journées mode only)
- `recomputeAllBonuses()` — Recomputes ALL tournaments in a category: Step 1 position points, Step 2 barème, Step 3 bonus moyenne
- Results stored as `bonus_points` (total) + `bonus_detail` (JSON breakdown per rule_type)
- **Import flow:** After CSV import, calls `recomputeAllBonuses()` for the entire category (not just the imported tournament), then `recalculateRankings()`

### Bonus Moyenne
- Per-org toggle: `bonus_moyenne_enabled` + `bonus_moyenne_type` (normal/tiered) in `organization_settings`
- **Normal:** < mini → 0, mini–maxi → +tier1, > maxi → +tier2
- **Par paliers:** < mini → 0, mini–middle → +tier1, middle–maxi → +tier2, ≥ maxi → +tier3 (where middle = (mini+maxi)/2)
- Tier values configurable: `scoring_avg_tier_1/2/3` (defaults: 1, 2, 3)
- Thresholds from `game_parameters.moyenne_mini/moyenne_maxi` per mode+category
- **CRITICAL:** `game_parameters.mode` stores values like `'3BANDES'` (no space) while `categories.game_type` stores `'3 Bandes'` (with space). ALL queries MUST use `UPPER(REPLACE(mode, ' ', ''))` pattern for matching.
- Computed on-the-fly in results API (`GET /:id/results`) AND persisted via fire-and-forget
- API responses include `bonusMoyenneInfo` object (type, mini, middle, maxi, tiers) for frontend info card
- Info card displayed on tournament results and rankings pages showing bonus conditions

### Dynamic Bonus Columns
- Tournament results and rankings API responses include `bonusColumns` metadata
- Frontend renders dynamic columns from `bonus_detail` JSON (not hardcoded)
- Excel exports also use dynamic columns
- **Backward compatibility:** Old results with `bonus_points` but no `bonus_detail` get legacy fallback `{"MOYENNE_BONUS": bonus_points}`

### Frontend (settings-admin.html — barème section)
- Barème blocks integrated into settings-admin.html under the stage scoring grid
- Structured expression builder with dropdowns (field, operator, value)
- Rules displayed as readable French text
- `/api/scoring-fields` endpoint provides metadata for dropdowns

## UI Design System

### Glassmorphism Navbar
All pages use a modern floating navbar with depth effects:
- `backdrop-filter: blur(12px)` with semi-transparent background
- Multi-layer shadows (outer depth + colored glow + inset highlight)
- Nav links in tinted container with border and inset shadow
- Gradient logout button

### Consistent Page Branding (app-branding.js)
Every page navbar shows: **Logo → Org Name → Subtitle → Page Title**

**Pattern:** Each page's `<h2>` contains:
```html
<span id="app-org-name" data-page-title="Page Name">CDB</span>
```

`app-branding.js` reads `data-page-title` and injects:
1. Organization short name (from API)
2. `<span class="navbar-subtitle">Gestion des compétitions<br>départementales FFB</span>`
3. `<span class="navbar-page-title">Page Name</span>` (if data-page-title exists)

**Dashboard** has no `data-page-title` (shows only org name + subtitle).

### 3D Shadow Treatment
Applied globally via `frontend/css/styles.css`:
- **Cards:** `box-shadow` with hover lift effect (`translateY(-3px)`)
- **Buttons:** Gradient backgrounds, colored glow shadows, cubic-bezier transitions
- **Form inputs:** Inset shadow, focus glow ring
- **Stat cards:** Deep shadows with hover lift (dashboard compact-stat)

### CSS Classes
- `.navbar-subtitle` — Small gray text below org name (10px)
- `.navbar-page-title` — Primary-colored page name below subtitle (12px)

## Multi-Organization (Multi-CDB) Architecture

The app supports multiple billiards committees (CDBs) sharing a single deployment. Each CDB has isolated data via `organization_id` on all data tables.

### How It Works

1. **Organizations table:** Each CDB has a row in `organizations` with `slug`, `name`, `is_active`
2. **Admin JWT:** Contains `organizationId` — all CRUD operations auto-scope to the admin's org
3. **Data isolation:** All queries on org-scoped tables filter by `organization_id`
4. **Player App:** Uses `?org=<slug>` URL parameter to resolve org context pre-login, then JWT post-login

### Org-Scoped Tables

All these tables have an `organization_id` column with nullable filter pattern `($N::int IS NULL OR organization_id = $N)`:

| Table | Scoped via |
|-------|-----------|
| `players` | Direct `organization_id` column |
| `clubs` | Direct `organization_id` column |
| `users` | Direct `organization_id` column |
| `tournoi_ext` | Direct `organization_id` column |
| `inscriptions` | Direct `organization_id` column |
| `tournaments` | Direct `organization_id` column |
| `rankings` | Direct `organization_id` column |
| `announcements` | Direct `organization_id` column |
| `email_campaigns` | Direct `organization_id` column |
| `scheduled_emails` | Direct `organization_id` column |
| `player_invitations` | Direct `organization_id` column |
| `activity_logs` | Direct `organization_id` column |
| `categories` | Direct `organization_id` column |
| `scoring_rules` | Direct `organization_id` column |
| `game_parameters` | Direct `organization_id` column |
| `email_templates` | Direct `organization_id` column |

### Tables NOT Org-Scoped (by design)

| Table | Reason |
|-------|--------|
| `tournament_results` | Scoped via `tournament_id` JOIN |
| `convocation_poules` | Scoped via `tournoi_id` JOIN |
| `convocation_files` | Scoped via `tournoi_ext_id` JOIN to `tournoi_ext.organization_id` |
| `tournament_relances` | Scoped via `tournoi_ext_id` JOIN |
| `player_contacts` | Shared contact directory |
| `club_aliases` | Shared normalization |

### Access Pattern in Route Handlers

```javascript
// Every authenticated route handler:
const orgId = req.user.organizationId || null;

// INSERTs include organization_id:
INSERT INTO tournoi_ext (..., organization_id) VALUES (..., $N)

// SELECTs/UPDATEs/DELETEs filter by org:
WHERE ... AND ($N::int IS NULL OR organization_id = $N)
```

### Organization Settings

Per-org settings stored in `organization_settings` table (key-value per org_id). Falls back to `app_settings` for missing keys. Manages: colors, logo, org name, contact email, etc.

## Super Admin Level

The super admin (`is_super_admin = true` on user) has a dedicated set of pages for platform-wide management. These are separate from the CDB-level admin pages.

### Super Admin Pages

| Page | Purpose |
|------|---------|
| `super-admin.html` | Tableau de bord — FFB file KPIs, platform stats, CDB enrolments table |
| `super-admin-cdbs.html` | CDB management — create/delete orgs, FFB player seeding, FFB sync, send welcome email to admin |
| `super-admin-ligues.html` | Ligue management |
| `super-admin-ffb.html` | Données FFB — FFB data browser |
| `super-admin-ffb-browser.html` | FFB Fichiers — import FFB CSV files (Ligues, Clubs, Licences) |
| `super-admin-users.html` | Utilisateurs — manage all platform users across CDBs |
| `super-admin-settings.html` | Paramètres — platform email domain + welcome email template |

### Super Admin Versioning

**Current SA Version:** SA 1.0.3

Separate version from the CDB app (`V 2.0.x`). Displayed bottom-right on all SA pages. Increment on each SA-level deployment.

### Super Admin Features

- **CDB creation workflow:** Select FFB CDB from picklist → auto-fill org info → search FFB licencié for admin → create org + admin user + seed email settings
- **FFB player seeding:** Import players from FFB licence file into a CDB's player table
- **FFB player sync:** Compare CDB players against FFB file and show diffs before applying
- **Platform email domain:** Configurable domain (e.g., `carambole-gestion.fr`) for new CDB email addresses (`{slug}@{domain}`)
- **Welcome email template:** Quill editor for CDB admin welcome email with variable replacement
- **CDB navbar dropdown:** All SA pages have a CDB dropdown in the navbar to navigate to a specific CDB's dashboard
- **Player App SA login:** SA can log into any CDB's Player App using their username+password. The login impersonates the CDB admin's player profile (licence, name, club, rankings) for realistic testing. See Player App CLAUDE.md "Super Admin Login" section for details.
- **CDB creation seeds Player App URL:** `player_app_url` is auto-seeded in `organization_settings` during CDB creation (e.g., `https://cdbhs-player-app-production.up.railway.app/?org={slug}`). Available as `{player_app_url}` variable in the welcome email template.

### Super Admin API Routes

All routes in `backend/routes/super-admin.js` under `/api/super-admin/`:
- `GET /dashboard` — platform-wide KPIs
- `GET|POST /organizations` — list/create CDBs
- `DELETE /organizations/:id` — delete CDB and all its data
- `PUT /organizations/:id/toggle-active` — activate/deactivate CDB
- `GET /organizations/:id/seed-preview` — preview FFB players to import
- `POST /organizations/:id/seed-players` — import FFB players
- `GET /organizations/:id/sync-preview` — preview FFB sync diffs
- `POST /organizations/:id/sync-players` — apply FFB sync
- `GET|PUT /platform-settings` — platform email domain
- `GET|PUT /email-templates/cdb_welcome` — welcome email template CRUD
- `POST /email-templates/cdb_welcome/test` — send test welcome email
- `POST /organizations/:id/send-welcome` — send welcome to CDB admin
- `GET /ffb-cdbs` — list FFB CDBs for picklist
- `GET /ffb-licences/search` — search FFB licencés by CDB code

## Modes de Qualification pour les Finales

> **STATUS: READY TO IMPLEMENT (V2)** — Specs revised after call with CDB 93+94 representative on Feb 18, 2026. Key correction: scoring is POSITION-BASED, not cumulative match points. Functional description V2 sent to CDB 93 & 94 for validation (`~/Documents/Mode-Journees-Qualificatives-Description.html`). Technical plan at `~/.claude/plans/structured-hugging-blossom.md`. **Do NOT implement until user gives explicit GO.**

The app supports multiple qualification modes per CDB. Controlled by per-org setting `qualification_mode`.

### Mode 1: "3 Tournois Qualificatifs" (current — CDB92)

The current and fully implemented model:
- **3 seasonal tournaments** (TQ1, TQ2, TQ3) per category, each on a separate date
- **Rankings accumulate** match points across TQ1 + TQ2 + TQ3
- **Finale qualification:** Top-ranked players after TQ3 are invited to the Finale Départementale
- **Finale:** Separate event, single poule (round-robin), does NOT count in seasonal ranking

### Mode 2: "Journées Qualificatives" (CDB 93 & 94)

**Competition day flow:** Poules (morning) → Top bracket semi-finals/finale/petite finale → Classification matches (afternoon)
- **Poules:** 3 players preferred, 2 allowed. Serpentine distribution
  - TQ1: serpentine based on `players.moyenne_generale` (FFB average, imported at season start)
  - TQ2-3: serpentine based on ongoing season ranking (position-based points)
- **Top bracket (configurable size, default 4):** SF1: 1st vs 4th, SF2: 2nd vs 3rd → Finale + Petite Finale → Places 1-4
- **Classification matches:** Non-qualified players paired bottom-up. R1 mandatory, R2 optional. → Places 5 to N
- **< 6 players:** Single round-robin poule, no bracket
- **Position-based scoring:** Each finishing position maps to a configurable number of points via `position_points` lookup table
- **Mixed categories bonus:** When categories merged (e.g., R3+R4), lower-ranked player gets +1 point PER MATCH (regular TQs only, not finale)
- **Season ranking:** Best `best_of_count` (default 2) POSITION-BASED SCORES out of `journees_count` (default 3) TQs
- **Tiered average bonus on season ranking:**
  - Uses `game_parameters.moyenne_mini` and `moyenne_maxi` (already exist)
  - Middle = (mini + maxi) / 2
  - Average < mini → 0, mini to middle → +1, middle to maxi → +2, > maxi → +3
  - Average calculated from the 2 best tournament results
- **Finale de District:** Single round-robin poule (all qualified players play each other), NO bracket/classification. Same as CDB92 finale format. No mixed-category bonus
- **Vocabulary:** Both modes use "Tournoi Qualificatif" (TQ1, TQ2, TQ3). Finale = "Finale de District" in Mode 2

### Player File Changes

- **New column `players.moyenne_generale`** (REAL, nullable): stores FFB average for serpentine seeding at season start
- Source: imported from player CSV/FFB file, or entered manually by admin
- Used by serpentine when no season ranking exists yet (TQ1)
- FFB standard files do NOT contain this field — CDB must provide it separately

### Still TBD (waiting for CDB 93+94)

1. **Position-to-points lookup table** — What points does 1st, 2nd, 3rd... get?
2. **Bracket qualification formula from poules** — "match points + something" — what is the something?
3. **Serpentine seeding** — Exact field name for moyenne in player file?

### Configurable Settings (per organization)

| Setting Key | Default | Description |
|-------------|---------|-------------|
| `qualification_mode` | `standard` | `standard` = 3 Tournois, `journees` = Journées Qualificatives |
| `journees_count` | `3` | Number of qualification tournaments per season |
| `best_of_count` | `2` | Best N position-based scores for season ranking |
| `bracket_size` | `4` | Players in top bracket (regular TQs) |
| `allow_poule_of_2` | `false` | Allow 2-player poules (play twice) |
| `single_poule_threshold` | `6` | Below this → single round-robin, no bracket |
| `classement_round_2` | `true` | Enable 2nd round of classification matches |
| `mixed_category_bonus` | `false` | Enable +1 point/match for lower-ranked player in merged categories |
| `average_bonus_tiers` | `true` | Tiered average bonus (0/1/2/3 based on min/middle/max) |
| `qualification_threshold` | `9` | (existing) Player count threshold for finale qualification |
| `qualification_small` | `4` | (existing) Qualified count if players < threshold |
| `qualification_large` | `6` | (existing) Qualified count if players >= threshold |

### New Database Tables

**`position_points`** — Maps finishing position → season points (configurable per org)
```sql
CREATE TABLE position_points (
  id SERIAL PRIMARY KEY, position INTEGER NOT NULL, points INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  UNIQUE(position, organization_id)
);
```

**`bracket_matches`** — Individual match results for bracket + classification phases
```sql
CREATE TABLE bracket_matches (
  id SERIAL PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  phase TEXT NOT NULL, match_order INTEGER NOT NULL, match_label TEXT,
  player1_licence TEXT NOT NULL, player1_name TEXT, player2_licence TEXT, player2_name TEXT,
  player1_points INTEGER DEFAULT 0, player1_reprises INTEGER DEFAULT 0,
  player2_points INTEGER DEFAULT 0, player2_reprises INTEGER DEFAULT 0,
  winner_licence TEXT, resulting_place INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Altered tables:**
- `players` → ADD `moyenne_generale REAL` (FFB average for serpentine seeding)
- `tournament_results` → ADD `position_points INTEGER DEFAULT 0` (position-based season points)

### New Route: `backend/routes/bracket.js`

- `GET /api/bracket/:tournamentId/setup` — Computes qualifiers, generates bracket
- `POST /api/bracket/:tournamentId/results` — Saves bracket match results
- `GET /api/bracket/:tournamentId/classement` — Generates classification pairings
- `POST /api/bracket/:tournamentId/classement` — Saves classification results
- `POST /api/bracket/:tournamentId/finalize` — Computes final positions, assigns position_points

### Implementation Phases

**Phase 1 — Infrastructure & Settings**
1. Add `moyenne_generale` to `players`, `position_points` column to `tournament_results`
2. Create `position_points` and `bracket_matches` tables
3. Add all settings to `organization_settings` defaults
4. UI: mode settings section + position-to-points editor in `settings-admin.html`
5. Import `moyenne_generale` from player file during FFB seeding

**Phase 2 — Poules of 2 & Serpentine Evolution**
1. Poule distribution: support 2-player poules in `inscriptions.js`
2. Serpentine: use `moyenne_generale` for TQ1, ongoing ranking for TQ2-3
3. No impact on Mode 1

**Phase 3 — Bracket & Classification Engine** (new `bracket.js`)
1. Generic algorithmic engine for any N players
2. Bracket qualification from poule results
3. Classification pairing (bottom-up, optional R2)
4. Position-to-points assignment + mixed-category bonus
5. Frontend: results entry form

**Phase 4 — Season Ranking & Finale**
1. `recalculateRankings()` branches by `qualification_mode`
2. Mode journées: best N position scores + tiered average bonus (0/1/2/3)
3. Frontend: rankings with kept/dropped scores
4. Finale de District: single round-robin poule (reuses existing finale logic from CDB92)
5. Email labels: "Tournoi Qualificatif 1/2/3" + "Finale de District"

### Files Impacted

| File | Type | Change |
|------|------|--------|
| `backend/db-postgres.js` | MODIFY | New tables, new columns, migrations |
| `backend/routes/bracket.js` | NEW | Bracket + classification engine |
| `backend/routes/tournaments.js` | MODIFY | `recalculateRankings()` → branch by mode, tiered bonus |
| `backend/routes/inscriptions.js` | MODIFY | Poule distribution (2-player), serpentine evolution |
| `backend/routes/settings.js` | MODIFY | New settings endpoints |
| `backend/routes/super-admin.js` | MODIFY | Default settings, moyenne_generale seeding |
| `backend/routes/emailing.js` | MODIFY | Labels "TQ1/TQ2/TQ3" + "Finale District" |
| `frontend/settings-admin.html` | MODIFY | Mode settings + position-points editor |
| `frontend/rankings.html` | MODIFY | Position-points columns, kept/dropped indication |
| `frontend/tournament-results.html` | MODIFY | Bracket + classification entry form |

### What Does NOT Change

- **Mode "3 Tournois" (CDB92)** — zero impact, works exactly as before
- **Existing tables** — `tournaments`, `tournament_results`, `rankings` keep their structure
- **Inscriptions** — same workflow (CSV, player_app, manual)
- **Convocations** — same serpentine + email system
- **Player App** — no changes
- **Multi-CDB isolation** — organization_id scoping unchanged
- **~75% of codebase** — reused as-is

## See Also

- `backend/CLAUDE.md` - Detailed backend documentation
- `frontend/CLAUDE.md` - Detailed frontend documentation

## Calendar Season Generation (`backend/routes/calendar.js`)

Auto-generates all `tournoi_ext` entries for a season from the CDBHS Excel calendar file. 3-step wizard in `frontend/settings.html`: Upload → Preview → Import.

### Excel Format (CDBHS)
- Row 5: "S" label in col E, then Saturday dates (Date objects) in cols F+
- Row 6: "D" label in col E, then Sunday dates in cols F+
- Rows 7-19: Data rows — col B = mode, col C = category, col D = Pts/Rep, cols F+ = tournament markers (T1/T2/T3/FD)
- Row 20+: Legend/footer (parser stops at "LEGENDE" or "COULEU")

### Club Location Resolution (TODO — not yet implemented)

**Strategy: color first, letter fallback.**

**1. Color-based detection (primary):** The Excel encodes the hosting club via cell background color. ExcelJS reads `cell.fill.fgColor.argb`. Requires a per-org **color-to-club mapping** (configurable in settings, since each CDB has different clubs/colors).

CDBHS color mapping (from legend rows 22-27):
- `FF974806` = Bois-Colombes
- `FF00B0F0` = Châtillon
- `FFFABF8F` = Clamart
- `FF00B050` = Clichy
- `FF0070C0` = Courbevoie
- Finales (FD): white/no fill or `FFFF0000` (red) — location TBD

**2. Letter code fallback:** If a cell has no recognized color (or color mapping not configured), fall back to letter codes in the cell text: `T1/A` → club A, `T2/B` → club B. Uses `clubs.calendar_code` column.

**Validation rules:**
- If any tournament cell has an unrecognized color AND no letter code → **stop the process**, show which cells couldn't be resolved, and ask the user to fix the Excel or configure the mapping. Never generate tournaments with missing locations silently.
- Finales (FD) are exempt — location TBD is acceptable for finales.

**User flow (4-step wizard):**
1. **Upload** — Select season + Excel file
2. **Color validation** (new step) — Parse Excel, extract all unique colors from tournament cells, show proposed color→club mapping (colored squares + club names). Admin validates or corrects each mapping before proceeding. Previously saved mappings are pre-filled. If unknown colors are found, admin must assign them a club or the process stops.
3. **Preview** — Full tournament table with dates, modes, categories, locations (now resolved)
4. **Import** — Create/update `tournoi_ext` entries

**Implementation plan:**
- New table or `organization_settings` entries: `calendar_color_mapping` (JSON: `{"FF974806": "Bois-Colombes", ...}`)
- Step 2 backend endpoint: `POST /calendar/import-season/detect-colors` — returns unique colors + count of cells per color + suggested club (from saved mapping)
- Step 2 frontend: show colored squares with club dropdown, save mapping on confirm
- Parser: read cell fill color → lookup in validated color mapping → if no match, try letter code → if no match, reject
- Auto-detect option: parse the legend area of the Excel to suggest color mappings

### Current Status
- Parser works for CDBHS format (52 tournaments extracted from 2025-2026 calendar)
- Locations are "Non défini" — pending color + letter detection
- `exceljs` dependency is in `package.json`
- Modal instructions in `settings.html` still reference "T1/A" format — update when color detection is implemented
- Target: ready and 100% accurate before 2026-27 season start

## URL Strategy & Custom Domains

**CONTEXT (March 22, 2026):** Originally developed for CDBHS with "cdbhs" in URLs. As we expand to other CDBs, we need a neutral branding strategy.

### Current Railway Services

| Service | Current URL | Users/Players |
|---------|-------------|---------------|
| **Tournament Management** | `cdbhs-tournament-management-production.up.railway.app` | 4 admins (including owner) |
| **Player App** | `cdbhs-player-app-production.up.railway.app` | 57 installed PWAs (as of March 2026) |
| **Demo** | `carambole-competition-app-demo.up.railway.app` | Training/testing |

### Recommended Strategy: Keep + Add Neutral Domains

**Decision rationale:** With 57 players having installed the Player App PWA, forcing a URL change would require all players to reinstall. Instead, keep existing URLs operational indefinitely and add neutral custom domains as aliases.

**For Player App:**
- **Keep** `cdbhs-player-app-production.up.railway.app` active (no disruption to installed PWAs)
- **Add** neutral custom domain (e.g., `joueurs-carambole.app`, `inscription-carambole.fr`) pointing to the same Railway service
- Both URLs serve the same backend
- CDBHS players: no impact
- New CDBs: get the neutral URL

**For Tournament Management:**
- **Change** to neutral URL (low impact — 4 admins, easy to communicate)
- Suggested neutral domains: `admin-carambole.app`, `tournois-carambole.fr`, `gestion-carambole.app`
- Update bookmarks for 3 other admins

**For Demo:**
- Already neutral (`carambole-competition-app-demo.up.railway.app`)
- Optional: add custom domain for cleaner branding

### Implementation Steps

1. **Purchase custom domains** (~$12-15/year each)
   - Suggested registrar: OVH, Gandi, Namecheap
   - Recommended: `.fr` for French branding, `.app` for modern feel
   - Estimated cost: ~$25-30/year for 2 domains

2. **Add custom domains in Railway** (included in plan, no extra cost)
   - Railway dashboard → Service → Settings → Custom Domains
   - Add CNAME record at domain registrar pointing to Railway
   - Both old and new URLs work simultaneously

3. **Update documentation & communication**
   - Update `CLAUDE.md` with new URLs
   - Update Player App `organization_settings.player_app_url` for new CDBs
   - Send email to CDBHS admins about Tournament Management URL change

### Payment & Cost Management

**Current status (March 2026):** Owner is paying personally for Railway hosting.

**Action items before end of season (June 2026):**
- Clarify who will pay for custom domains (per-CDB or centralized?)
- Clarify who will pay for Railway hosting at scale (when multiple CDBs are onboarded)
- Potential models:
  - **Centralized:** Platform owner pays, CDBs contribute via annual subscription
  - **Per-CDB:** Each CDB pays for their own custom domain + share of hosting
  - **Hybrid:** Platform provides `.up.railway.app` URLs free, CDBs pay for custom domains if desired

**Reminder:** Re-evaluate cost structure and payment model during off-season (July-August 2026) before scaling to additional CDBs.

### Railway Projects Naming Convention

Once neutral domains are in place, consider renaming Railway projects for clarity:
- `Carambole-Tournament Management` → `Carambole-Admin-App` or `FFB-Tournois-Platform`
- `Player App Carambole` → `Carambole-Player-App` (already neutral)
- `CDB-demo-App` → `Carambole-Demo` (already neutral)

**Note:** Renaming Railway projects does NOT affect deployment or URLs. Internal naming only.

## Future Work / Roadmap

- **CRITICAL - Mode/game_type refactoring:** Remove ALL hardcoded mode values ('LIBRE', 'BANDE', '3BANDES', 'CADRE') and replace with dynamic lookups from `game_modes` table. This is causing recurring bugs due to inconsistent values ('3 BANDES' vs '3BANDES'). Files with hardcoded modes:
  - `backend/routes/players.js` (lines 171-174, 322-325) - CSV column mappings
  - `backend/routes/inscriptions.js` (lines 2826-2833) - mode normalization map
  - `backend/routes/emailing.js` (lines 4173-4176) - rank column mapping
  - `backend/routes/player-invitations.js` (lines 214-217) - rank column mapping
  - `backend/routes/calendar.js` (lines 534-537) - Excel parsing
  - `backend/routes/settings.js` (lines 135-138) - ORDER BY sorting

  **Solution:** Always load `game_modes` table with `rank_column` field and use it for all mode-to-rank mappings. The `game_modes.code` should be the canonical format used everywhere.

- **~~Email address consolidation~~** *(DONE Feb 2026)*: All hardcoded `cdbhs92@gmail.com` fallbacks removed from backend routes and frontend. Email is now loaded dynamically from `organization_settings` via `appSettings.getOrgSetting()`. Only the org #1 database seed (`db-postgres.js`, `settings.js`) still references it — correct by design. The `@cdbhs.net` sender address fallbacks remain in code but are dead code: new CDBs get their addresses auto-generated from the platform domain (`carambole-gestion.fr`) during creation in super-admin, and CDBHS values are in the database.

- **DOCUMENTATION UPDATE (SCHEDULED: March 22, 2026 at 08:58):** Update all documentation files to reflect new push notification features implemented in March 2026.

  **Changes to document:**
  - **Push Notifications feature** (March 2026):
    - Tournament Management App: Com joueurs → Notifs tab for bulk push notifications
    - Notification destination selector (Page d'accueil, Vos compétitions, Inscriptions, Stats, etc.)
    - History panel with delete functionality (button + swipe-to-delete on mobile)
    - Player App: Bell icon notification center with swipe-to-delete
    - Backend: DELETE endpoint for notification history
    - Full URLs for hash navigation in notifications

  **Files to update:**
  1. **`frontend/guide-utilisateur.html`** - User guide served in the app
     - Add new section: "Envoyer des notifications push aux joueurs"
     - Location: After "Gestion des emails" section
     - Cover: accessing Com joueurs → Notifs, selecting recipients, composing notifications, viewing history, deleting notifications

  2. **`GUIDE-UTILISATEUR-COMPLET.html`** (root) - Copy of user guide
     - Sync from `frontend/guide-utilisateur.html` after updates

  3. **`GUIDE-UTILISATEUR-COMPLET.md`** (root) - Markdown version
     - Regenerate from updated HTML content

  4. **Player App documentation** (`cdbhs-player-app/CLAUDE.md`)
     - Update "Notification Center" section with swipe-to-delete functionality
     - Document DELETE `/api/player/push/notifications/:id` endpoint

  **Process:**
  - Update `frontend/guide-utilisateur.html` first (primary source of truth)
  - Sync changes to `GUIDE-UTILISATEUR-COMPLET.html` (root)
  - Regenerate `GUIDE-UTILISATEUR-COMPLET.md` from HTML
  - Update Player App CLAUDE.md
  - Include all 4 files in the same commit

- **EMAIL TEMPLATE VARIABLES REFACTORING (REMINDER: June 26, 2026):** Centralize all email template variables into a single source of truth. Currently variables are scattered across multiple locations causing maintenance issues and inconsistencies.

  **Current problem:**
  - `buildUniversalVariables()` in email.js defines some variables
  - Each email endpoint adds its own specific variables
  - Frontend HTML hardcodes variable lists in each template editor (8+ places)
  - CLAUDE.md documents variables separately
  - Adding a new variable requires changes in 5+ files

  **Proposed solution:**
  1. Create `backend/utils/email-variables.js` module with single source of truth:
     ```javascript
     const EMAIL_VARIABLES = {
       player: [
         { key: 'first_name', description: 'Prénom du joueur' },
         { key: 'last_name', description: 'Nom du joueur' },
         // ...
       ],
       tournament: [
         { key: 'tournament', description: 'Numéro (T1, T2, T3, Finale)' },
         { key: 'tournament_name', description: 'Nom complet du tournoi' },
         // ...
       ],
       organization: [
         { key: 'organization_name', description: 'Nom complet' },
         // ...
       ]
     };
     ```
  2. Add API endpoint `GET /api/email/available-variables` to serve variable definitions
  3. Frontend loads variables dynamically from API instead of hardcoding in HTML
  4. All email sending functions use the centralized `replaceAllVariables()` function
  5. Optional: Store in `email_template_variables` table for admin-editable descriptions

  **Files to refactor:**
  - `backend/routes/email.js` - buildUniversalVariables, all email endpoints
  - `backend/routes/emailing.js` - replaceVar calls in send-results, relances, etc.
  - `frontend/emailing.html` - 8+ template editor variable lists

- **Customizable KPI Dashboard (widget selector):** Replace the current hardcoded dashboard stats with a dynamic KPI engine where each CDB picks 9-15 indicators from a catalog of ~65 KPIs. Interactive mockup: `mockup-dashboard-kpis.html`.

  **KPI Catalog (8 domains):** Joueurs (14), Compétitions (10), Inscriptions (12), Catégories (7), Clubs (6), Engagement (8), Tendances (3), Classements (4).

  **Storage:** `organization_settings` key `dashboard_kpis` = JSON array of selected KPI IDs. Default = current 9 existing KPIs.

  **Backend:**
  - `GET /api/dashboard/kpis` — compute values for selected KPIs only
  - `GET /api/dashboard/kpi-catalog` — full catalog with metadata (name, desc, category, theme)
  - `PUT /api/dashboard/kpis` — save CDB's selection
  - KPI engine: single function mapping each KPI ID → SQL query, executed only for selected KPIs

  **Frontend:** Dynamic widget rendering in 3-column grid, "Personnaliser le tableau de bord" button opens selector modal with collapsible categories, checkboxes, "Existant/Nouveau" badges, selection counter.

  **Phased rollout:**
  | Phase | Scope | Effort |
  |-------|-------|--------|
  | Phase 1 | 15 existing KPIs → dynamic rendering + selector UI | ~2 days |
  | Phase 2 | +20 new single-query KPIs (taux, ratios, counts) | ~3 days |
  | Phase 3 | +15 cross-season KPIs (N vs N-1 comparisons) | ~2 days |
  | Phase 4 | +15 advanced KPIs (charts, engagement tracking) | ~3 days |

- **Push Notifications for Player App (Web Push) — IN PROGRESS:** Send native mobile notifications to players without them opening the app. Uses the Web Push API + existing Service Worker — completely free (no SMS cost).

  **Use cases:**
  - Convocation sent → push "Vous avez été convoqué pour 3 Bandes R1 du 21/03"
  - Relance → push "Rappel : inscrivez-vous avant le 15/03 pour Libre N2"
  - Results published → push "Les résultats du tournoi Cadre 47/2 sont disponibles"
  - New announcement → push notification with announcement title

  **iOS caveat:** Only works if PWA is added to home screen (since iOS 16.4). Android works everywhere.

  **Implementation Status:**

  ### ✅ PHASE 1 — VAPID Keys & npm Package (COMPLETED — March 16, 2026)
  - Generated VAPID keys:
    - Public: `BN1LA9Kgw4ZZZuLyRynB3LlONnCKNRItfvZf56Xcw7iNw3NVZAnYBM4P824iVU3bRMjWwCC7lhdQ2QkSy4eTkc0`
    - Private: `IOjFLoJCqsY-fK5bkX-5cdiD5zb60jgYpmrQ8ybP6AY`
  - **⚠️ ACTION REQUIRED:** Add to Railway env vars as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
  - Installed `web-push` npm package
  - Commit: `8e79f7a`

  ### ✅ PHASE 2 — Database Schema (COMPLETED — March 16, 2026)
  - Added `push_enabled BOOLEAN DEFAULT true` to `player_accounts` table
  - Added `organization_id INTEGER` to `player_accounts` table
  - Created `push_subscriptions` table:
    ```sql
    CREATE TABLE push_subscriptions (
      id SERIAL PRIMARY KEY,
      player_account_id INTEGER REFERENCES player_accounts(id) ON DELETE CASCADE,
      organization_id INTEGER REFERENCES organizations(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ```
  - Created indexes on `player_account_id` and `organization_id`
  - File: `backend/db-postgres.js` (lines 935-961)
  - Commit: `8e79f7a`

  ### ⏸️ PHASE 3 — Backend API Routes (PENDING — ~1 day)
  - Create `backend/routes/push.js`:
    - `POST /api/player/push/subscribe` — save push subscription
    - `POST /api/player/push/unsubscribe` — remove subscription
    - `DELETE /api/player/push/subscription/:id` — delete by ID
    - `GET /api/player/push/status` — check if player has active subscription
  - Create helper function `sendPushToPlayer(licence, orgId, {title, body, url})` in push.js
  - Auto-cleanup expired subscriptions (410 Gone responses)

  ### ⏸️ PHASE 4 — Player App Frontend (PENDING — ~0.5 day)
  - Permission prompt on first login: "Autoriser les notifications ?"
  - Service Worker `pushManager.subscribe()` using VAPID public key
  - Save subscription to backend via `POST /api/player/push/subscribe`
  - Settings toggle: "Recevoir les notifications push" (updates `player_accounts.push_enabled`)
  - Service Worker push event handler:
    ```javascript
    self.addEventListener('push', event => {
      const data = event.data.json();
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/images/icon-192.png',
        badge: '/images/badge-72.png',
        data: { url: data.url }
      });
    });
    self.addEventListener('notificationclick', event => {
      event.notification.close();
      clients.openWindow(event.notification.data.url);
    });
    ```

  ### ⏸️ PHASE 5 — Integration with Email Flows (PENDING — ~1-2 days)
  - After sending convocation email → trigger push for convoqued players (`backend/routes/email.js`)
  - After sending relance email → trigger push for non-registered players (`backend/routes/emailing.js`)
  - After publishing results → trigger push for participants (`backend/routes/tournaments.js`)
  - After creating announcement → trigger push for all players in org (`backend/routes/announcements.js`)
  - Fire-and-forget pattern (email success not dependent on push success)

  ### ⏸️ PHASE 6 — Admin Controls (PENDING — ~0.5 day)
  - Test/preview push notification from `emailing.html` before sending campaign
  - View push subscription stats per org in settings or dashboard
  - Manual push notification sender (admin can send custom push to all players)

  ### ⏸️ PHASE 7 — Cleanup & Monitoring (PENDING — ~0.5 day)
  - Scheduled job to delete subscriptions older than 90 days with no `last_used_at` update
  - Subscription stats in Super Admin dashboard (total subscriptions per CDB)
  - Error logging for failed push sends

  **Total effort remaining:** ~3-4 days for Phases 3-7

  **Key decisions:**
  - Push is opt-in (browser permission + app toggle)
  - Notifications are org-scoped (player only gets pushes from their CDB)
  - Failed pushes (expired subscriptions) are auto-cleaned from `push_subscriptions`
  - Admin can preview/test push from emailing page before sending to all

  ### ✅ PHASE 3 — Backend API Routes (COMPLETED — March 17, 2026)
  - Created `backend/routes/push.js` with endpoints:
    - `POST /api/player/push/subscribe` - save push subscription
    - `POST /api/player/push/unsubscribe` - remove subscription
    - `DELETE /api/player/push/subscription/:id` - delete by ID
    - `GET /api/player/push/status` - check subscription status
    - `POST /api/player/push/toggle` - toggle push_enabled preference
  - Helper functions:
    - `sendPushToPlayer(licence, orgId, notification)` - send to single player
    - `sendPushToPlayers(licences, orgId, notification)` - send to multiple
  - Features:
    - VAPID configuration from env vars (added to Railway)
    - Auto-cleanup of expired subscriptions (410 Gone)
    - Player authentication required for all endpoints
    - Organization-scoped subscriptions
  - Mounted routes in `server.js` at `/api/player/push`
  - Commits: `acc35c5`, `10e48f2`, `948d37c`
  - Status: ✅ Deployed and working

  ### 📋 NOTIFICATION TYPES (planned)

  **Permission Flow:**
  - Two permission layers: Browser native permission + App-level toggle
  - Browser shows "Allow notifications?" popup on first Player App visit
  - Players can toggle in Player App → Settings → "Recevoir les notifications push"
  - Opt-in by default (players must actively grant permission)
  - iOS: Only works if PWA is added to home screen
  - Android: Works everywhere

  **Notification List by Priority:**

  | Priority | Notification Type | When Triggered | Content |
  |----------|------------------|----------------|---------|
  | **HIGH** | Convocation | Admin sends from `generate-poules.html` | "Vous avez été convoqué pour [Mode] [Catégorie] du [Date]" → Link to tournament details |
  | **HIGH** | Relance | Player hasn't registered, deadline approaching | "Rappel : inscrivez-vous avant le [Date] pour [Mode] [Catégorie]" → Link to registration |
  | **HIGH** | Results Published | Admin publishes results | "Les résultats du tournoi [Mode] [Catégorie] sont disponibles" → Link to results |
  | **MEDIUM** | Announcements | Admin creates announcement | Announcement title + message → Link to announcements |
  | **MEDIUM** | Finale Qualification | Player qualifies after T3 | "Félicitations ! Vous êtes qualifié pour la Finale [Mode] [Catégorie]" → Link to rankings |
  | **LOW** | Rankings Updated | After tournament results | "Les classements de la saison [2024-2025] ont été mis à jour" → Link to rankings |
  | **LOW** | Registration Confirmation | Player registers via app | "Inscription confirmée pour [Mode] [Catégorie] du [Date]" → Link to registrations |
  | **LOW** | Tournament Changes | Tournament cancelled/rescheduled | "Modification : Le tournoi [Mode] [Catégorie] est [annulé/reporté]" → Link to calendar |

  **Implementation Priority:**
  - Phase 5: Convocation, Relance, Results (high-frequency, high-value)
  - Phase 6: Announcements, Finale Qualification (medium)
  - Phase 7: Rankings, Registration Confirmation, Tournament Changes (low)

- **Player historical analytics (multi-season stats):** All tournament data (`tournament_results`, `rankings`) is retained permanently across seasons and scoped by `organization_id`. Season averages are computed on-the-fly (`SUM(points)/SUM(reprises)` from `tournament_results`) — not stored as a snapshot. This means we can build rich player analytics over time:
  - Average (moyenne) progression per mode across seasons
  - Participation trends (tournaments played per season, regularity)
  - Ranking evolution (position in category year over year)
  - Best serie progression
  - Cross-CDB stats at Ligue or FFB level (all orgs share the same database)

  **Data volume at scale (90 CDBs + 16 Ligues):** Under 1M rows after 10 years across all tables — no performance or storage concern for PostgreSQL. Queries are indexed by `season` and `organization_id`.

  **No schema changes needed** — the data model already supports this. Implementation is purely queries + UI (likely in Player App stats tab).

- **CHATBOT & LIVE CHAT - PLAYER APP (REMINDER: June 15, 2026):** Hybrid chat system for the Player App — AI chatbot (Claude Haiku 4.5) for autonomous answers + live admin chat for human support.

  **Architecture:** Polling-based (REST, every 5s when chat open). No WebSocket for v1. Both apps share the same PostgreSQL tables. Widget on Player App, support page on Tournament App.

  **Database — 2 new tables:**
  ```sql
  chat_conversations (
    id SERIAL PRIMARY KEY,
    player_licence TEXT NOT NULL,
    player_name TEXT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    mode TEXT NOT NULL DEFAULT 'ai',           -- 'ai' | 'admin'
    status TEXT NOT NULL DEFAULT 'open',       -- 'open' | 'waiting' | 'closed'
    assigned_admin_id INTEGER REFERENCES users(id),
    unread_player INTEGER DEFAULT 0,
    unread_admin INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
  );
  chat_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL,                 -- 'player' | 'admin' | 'ai'
    sender_name TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

  **Conversation flow:**
  1. Player opens chat -> conversation created in `ai` mode
  2. AI answers using player context (upcoming tournaments, inscriptions, rankings, org info)
  3. Player clicks "Parler a un administrateur" -> status becomes `waiting`
  4. Admin sees notification badge in Tournament App navbar -> takes over conversation
  5. Both sides poll for new messages
  6. Admin closes conversation when resolved

  **Phase 1 — Database (~30min):** Tables + migrations in `db-postgres.js`

  **Phase 2 — AI Chatbot, Player App (~4-5h):**
  - New `routes/chatbot.js`: `POST /chat/start`, `POST /chat/send`, `GET /chat/messages`, `POST /chat/request-admin`, `POST /chat/close`
  - System prompt with player context (name, club, tournaments, rankings, org info)
  - Claude Haiku 4.5 via Anthropic API (`ANTHROPIC_API_KEY` env var on Railway)
  - Rate limit: 20 msg/player/hour, 50 msg max per conversation
  - Frontend: `chat-widget.js` + `chat-widget.css` — floating button, chat panel, message bubbles
  - Polling: 5s when open, 30s when closed (for badge)

  **Phase 3 — Admin Support, Tournament App (~4-5h):**
  - New `routes/chat-support.js`: `GET /conversations`, `GET /:id/messages`, `POST /reply`, `POST /assign`, `POST /close`, `GET /unread-count`
  - New `chat-support.html`: two-column layout (conversation list + message thread)
  - Navbar badge on all pages (poll every 60s) — admin-only visibility
  - All endpoints org-scoped via `organization_id`

  **Phase 4 — Settings & polish (~2h):**
  - New org settings: `chatbot_enabled` (default false), `chatbot_ai_enabled` (default true), `chatbot_welcome_message`, `chatbot_auto_close_hours` (default 48)
  - Scheduler: auto-close inactive conversations
  - Guide utilisateur update

  **Total estimated effort: ~11-12h**

  **Prerequisites:** Anthropic API key, `ANTHROPIC_API_KEY` on Railway. Cost: < 5 EUR/month with Haiku 4.5.

  **Decisions still open:**
  - Conversation retention duration (before deletion)?
  - Multiple admins can respond or one per CDB?
  - Email notification to admin when player requests human support?
