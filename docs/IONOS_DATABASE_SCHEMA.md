# CDBHS Database Schema - IONOS API Reference

**Generated:** January 8, 2026
**For:** IONOS Database Manager - REST API Update

---

## Overview

This document describes the complete database schema for the CDBHS Tournament Management system. The database contains 22 tables organized into functional groups.

---

## 1. Core Tables

### players
Master table for all billiard players.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| licence | TEXT | PRIMARY KEY | FFB licence number |
| club | TEXT | | Player's club name |
| first_name | TEXT | NOT NULL | First name |
| last_name | TEXT | NOT NULL | Last name |
| rank_libre | TEXT | | FFB ranking - Libre |
| rank_cadre | TEXT | | FFB ranking - Cadre |
| rank_bande | TEXT | | FFB ranking - Bande |
| rank_3bandes | TEXT | | FFB ranking - 3 Bandes |
| email | TEXT | | Player email |
| telephone | TEXT | | Player phone |
| player_app_role | VARCHAR(20) | DEFAULT NULL | Role in Player App (joueur/admin) |
| is_active | INTEGER | DEFAULT 1 | Active status |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### tournoi_ext
External tournament definitions (from CDBHS/IONOS).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| tournoi_id | INTEGER | PRIMARY KEY | Tournament ID |
| nom | TEXT | NOT NULL | Tournament name |
| mode | TEXT | NOT NULL | Game mode (LIBRE, BANDE, 3BANDES, CADRE) |
| categorie | TEXT | NOT NULL | Category level |
| taille | INTEGER | | Pool size |
| debut | DATE | | Start date |
| fin | DATE | | End date |
| grand_coin | INTEGER | DEFAULT 0 | Grand coin flag |
| taille_cadre | TEXT | | Cadre size (47/2, 71/2, etc.) |
| lieu | TEXT | | Location |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### inscriptions
Player registrations for tournaments.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| inscription_id | INTEGER | PRIMARY KEY | Registration ID |
| joueur_id | INTEGER | | Player ID (legacy) |
| tournoi_id | INTEGER | FK → tournoi_ext | Tournament reference |
| timestamp | TIMESTAMP | NOT NULL | Registration timestamp |
| email | TEXT | | Player email at registration |
| telephone | TEXT | | Player phone at registration |
| licence | TEXT | | Player licence |
| convoque | INTEGER | DEFAULT 0 | Convocation sent (0/1) |
| forfait | INTEGER | DEFAULT 0 | Forfait declared (0/1) |
| commentaire | TEXT | | Comments |
| source | VARCHAR(20) | DEFAULT 'ionos' | Origin (ionos/player_app) |
| convocation_poule | VARCHAR(10) | | Assigned pool number |
| convocation_lieu | VARCHAR(255) | | Venue name |
| convocation_adresse | TEXT | | Venue full address |
| convocation_heure | VARCHAR(10) | | Start time |
| convocation_notes | TEXT | | Special notes |
| convocation_phone | VARCHAR(50) | | Venue phone |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### clubs
Club information and locations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| name | TEXT | NOT NULL UNIQUE | Canonical club name |
| display_name | TEXT | NOT NULL | Display name |
| logo_filename | TEXT | | Logo file reference |
| street | TEXT | | Street address |
| city | TEXT | | City |
| zip_code | TEXT | | Postal code |
| phone | TEXT | | Phone number |
| email | TEXT | | Email address |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### club_aliases
Maps variant club names to canonical names.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| alias | TEXT | NOT NULL UNIQUE | Variant name |
| canonical_name | TEXT | NOT NULL | Standard club name |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

## 2. Results & Rankings Tables

### categories
Game type and level definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| game_type | TEXT | NOT NULL | Game type (libre, cadre, bande, 3bandes) |
| level | TEXT | NOT NULL | Level (serie1, serie2, etc.) |
| display_name | TEXT | NOT NULL | Display name |
| | | UNIQUE(game_type, level) | |

---

### tournaments
Internal tournament records with results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| category_id | INTEGER | FK → categories(id) | Category reference |
| tournament_number | INTEGER | NOT NULL | Tournament number in season |
| season | TEXT | NOT NULL | Season (e.g., "2025-2026") |
| import_date | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Import date |
| tournament_date | TIMESTAMP | | Tournament date |
| location | TEXT | | Location |
| results_email_sent | BOOLEAN | DEFAULT FALSE | Results email sent flag |
| results_email_sent_at | TIMESTAMP | | Results email timestamp |
| | | UNIQUE(category_id, tournament_number, season) | |

---

### tournament_results
Individual player results per tournament.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| tournament_id | INTEGER | FK → tournaments(id) | Tournament reference |
| licence | TEXT | FK → players(licence) | Player reference |
| player_name | TEXT | | Player name (denormalized) |
| position | INTEGER | DEFAULT 0 | Final position |
| match_points | INTEGER | DEFAULT 0 | Match points earned |
| moyenne | REAL | DEFAULT 0 | Average |
| serie | INTEGER | DEFAULT 0 | Best series |
| points | INTEGER | DEFAULT 0 | Points scored |
| reprises | INTEGER | DEFAULT 0 | Number of innings |
| | | UNIQUE(tournament_id, licence) | |

---

### rankings
Season rankings by category.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| category_id | INTEGER | FK → categories(id) | Category reference |
| season | TEXT | NOT NULL | Season |
| licence | TEXT | FK → players(licence) | Player reference |
| total_match_points | INTEGER | DEFAULT 0 | Total match points |
| avg_moyenne | REAL | DEFAULT 0 | Average moyenne |
| best_serie | INTEGER | DEFAULT 0 | Best series |
| rank_position | INTEGER | | Ranking position |
| tournament_1_points | INTEGER | DEFAULT 0 | Tournament 1 points |
| tournament_2_points | INTEGER | DEFAULT 0 | Tournament 2 points |
| tournament_3_points | INTEGER | DEFAULT 0 | Tournament 3 points |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update |
| | | UNIQUE(category_id, season, licence) | |

---

## 3. Configuration Tables

### game_parameters
Game rules per mode/category.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| mode | TEXT | NOT NULL | Game mode |
| categorie | TEXT | NOT NULL | Category |
| coin | TEXT | DEFAULT 'PC' | Coin type (PC/GC) |
| distance_normale | INTEGER | NOT NULL | Normal distance |
| distance_reduite | INTEGER | | Reduced distance |
| reprises | INTEGER | NOT NULL | Number of innings |
| moyenne_mini | DECIMAL(6,3) | NOT NULL | Minimum average |
| moyenne_maxi | DECIMAL(6,3) | NOT NULL | Maximum average |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update |
| | | UNIQUE(mode, categorie) | |

---

### mode_mapping
Maps IONOS mode names to internal game types.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| ionos_mode | TEXT | NOT NULL UNIQUE | IONOS mode name |
| game_type | TEXT | NOT NULL | Internal game type |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### category_mapping
Maps IONOS categories to internal category IDs.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| ionos_categorie | TEXT | NOT NULL | IONOS category name |
| game_type | TEXT | NOT NULL | Game type |
| category_id | INTEGER | FK → categories(id) | Internal category |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |
| | | UNIQUE(ionos_categorie, game_type) | |

---

## 4. User Management Tables

### users
Admin application users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| username | TEXT | NOT NULL UNIQUE | Username |
| password_hash | TEXT | NOT NULL | Bcrypt password hash |
| role | TEXT | DEFAULT 'viewer' | Role (admin/editor/viewer) |
| email | TEXT | | Email address |
| is_active | INTEGER | DEFAULT 1 | Active status |
| receive_tournament_alerts | BOOLEAN | DEFAULT FALSE | Receive alerts |
| reset_token | TEXT | | Password reset token |
| reset_token_expiry | TIMESTAMP | | Token expiry |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |
| last_login | TIMESTAMP | | Last login |

---

### player_accounts
Player App user accounts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| licence | VARCHAR(50) | NOT NULL UNIQUE | Player licence |
| email | VARCHAR(255) | NOT NULL UNIQUE | Email (login) |
| password_hash | VARCHAR(255) | NOT NULL | Bcrypt password hash |
| email_verified | BOOLEAN | DEFAULT TRUE | Email verified |
| is_admin | BOOLEAN | DEFAULT FALSE | Admin flag |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation date |
| last_login | TIMESTAMP | | Last login |

---

### player_contacts
Centralized contact management.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| licence | TEXT | UNIQUE | Player licence |
| first_name | TEXT | | First name |
| last_name | TEXT | | Last name |
| club | TEXT | | Club |
| email | TEXT | | Email |
| telephone | TEXT | | Phone |
| rank_libre | TEXT | | Ranking - Libre |
| rank_cadre | TEXT | | Ranking - Cadre |
| rank_bande | TEXT | | Ranking - Bande |
| rank_3bandes | TEXT | | Ranking - 3 Bandes |
| statut | TEXT | DEFAULT 'Actif' | Status |
| comments | TEXT | | Comments |
| email_optin | INTEGER | DEFAULT 1 | Email opt-in |
| last_contacted | TIMESTAMP | | Last contact date |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update |

---

### password_reset_codes
Password reset verification codes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| email | TEXT | NOT NULL | Email address |
| code | TEXT | NOT NULL | Reset code |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |
| used | BOOLEAN | DEFAULT FALSE | Code used flag |

**Index:** `idx_reset_codes_email` on `email`

---

## 5. Email System Tables

### email_templates
Configurable email templates.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| template_key | TEXT | NOT NULL UNIQUE | Template identifier |
| subject_template | TEXT | NOT NULL | Subject with placeholders |
| body_template | TEXT | NOT NULL | Body with placeholders |
| outro_template | TEXT | | Outro/signature template |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update |

---

### email_campaigns
History of sent email campaigns.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| subject | TEXT | NOT NULL | Email subject |
| body | TEXT | NOT NULL | Email body |
| template_key | TEXT | | Template used |
| campaign_type | TEXT | | Type (convocation, relance, etc.) |
| mode | TEXT | | Game mode |
| category | TEXT | | Category |
| tournament_id | INTEGER | | Tournament reference |
| recipients_count | INTEGER | DEFAULT 0 | Total recipients |
| sent_count | INTEGER | DEFAULT 0 | Successfully sent |
| failed_count | INTEGER | DEFAULT 0 | Failed sends |
| status | TEXT | DEFAULT 'draft' | Status |
| sent_by | TEXT | | Sender username |
| test_mode | BOOLEAN | DEFAULT FALSE | Test mode flag |
| sent_at | TIMESTAMP | | Send timestamp |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### scheduled_emails
Scheduled future emails.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| subject | TEXT | NOT NULL | Email subject |
| body | TEXT | NOT NULL | Email body |
| template_key | TEXT | | Template used |
| image_url | TEXT | | Attached image URL |
| recipient_ids | TEXT | NOT NULL | JSON array of recipient IDs |
| scheduled_at | TIMESTAMP | NOT NULL | Scheduled send time |
| status | TEXT | DEFAULT 'pending' | Status |
| email_type | TEXT | | Email type |
| mode | TEXT | | Game mode |
| category | TEXT | | Category |
| tournament_id | INTEGER | | Tournament reference |
| outro_text | TEXT | | Outro text |
| cc_email | TEXT | | CC email address |
| custom_data | TEXT | | Custom JSON data |
| created_by | TEXT | | Creator username |
| test_mode | BOOLEAN | DEFAULT FALSE | Test mode flag |
| test_email | TEXT | | Test recipient email |
| sent_at | TIMESTAMP | | Actual send time |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

### inscription_email_logs
Audit log for inscription-related emails.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| email_type | TEXT | NOT NULL | Type (inscription/desinscription) |
| player_email | TEXT | NOT NULL | Recipient email |
| player_name | TEXT | | Player name |
| tournament_name | TEXT | | Tournament name |
| mode | TEXT | | Game mode |
| category | TEXT | | Category |
| tournament_date | TEXT | | Tournament date |
| location | TEXT | | Location |
| status | TEXT | DEFAULT 'sent' | Send status |
| error_message | TEXT | | Error if failed |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Send timestamp |

---

### tournament_relances
Tracks relance (reminder) emails per tournament.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| tournoi_id | INTEGER | NOT NULL UNIQUE | Tournament ID |
| relance_sent_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Send timestamp |
| sent_by | TEXT | | Sender username |
| recipients_count | INTEGER | DEFAULT 0 | Number of recipients |

---

## 6. Other Tables

### calendar
Stores uploaded calendar PDF files.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| filename | TEXT | NOT NULL | Original filename |
| content_type | TEXT | NOT NULL | MIME type |
| file_data | BYTEA | NOT NULL | Binary file data |
| uploaded_by | TEXT | | Uploader username |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Upload date |

---

### import_history
Audit log for data imports.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| file_type | TEXT | NOT NULL | Type (players/tournois/inscriptions) |
| import_date | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Import date |
| record_count | INTEGER | DEFAULT 0 | Records imported |
| filename | TEXT | | Source filename |
| imported_by | TEXT | | Importer username |

---

### admin (Legacy)
Legacy admin table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| password_hash | TEXT | NOT NULL | Bcrypt password hash |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation date |

---

## Key Relationships

```
players.licence ←──── tournament_results.licence
players.licence ←──── rankings.licence
players.licence ←──── inscriptions.licence
players.licence ←──── player_accounts.licence

tournoi_ext.tournoi_id ←──── inscriptions.tournoi_id

categories.id ←──── tournaments.category_id
categories.id ←──── rankings.category_id
categories.id ←──── category_mapping.category_id

tournaments.id ←──── tournament_results.tournament_id
```

---

## Changes Since Initial Setup

1. **inscriptions**: Added `convocation_poule`, `convocation_lieu`, `convocation_adresse`, `convocation_heure`, `convocation_notes`, `convocation_phone`, `source`
2. **players**: Added `email`, `telephone`, `player_app_role`
3. **tournaments**: Added `results_email_sent`, `results_email_sent_at`
4. **email_campaigns**: Added `campaign_type`, `mode`, `category`, `tournament_id`, `sent_by`, `test_mode`
5. **scheduled_emails**: Added `image_url`, `email_type`, `mode`, `category`, `tournament_id`, `outro_text`, `cc_email`, `custom_data`, `created_by`, `test_mode`, `test_email`
