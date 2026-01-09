-- ============================================================================
-- CDBHS Database Schema - SQL DDL
-- Generated: January 8, 2026
-- For: IONOS Database Manager - REST API Update
-- ============================================================================

-- ============================================================================
-- 1. CORE TABLES
-- ============================================================================

-- Players master table
CREATE TABLE IF NOT EXISTS players (
    licence TEXT PRIMARY KEY,
    club TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    rank_libre TEXT,
    rank_cadre TEXT,
    rank_bande TEXT,
    rank_3bandes TEXT,
    email TEXT,
    telephone TEXT,
    player_app_role VARCHAR(20) DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- External tournament definitions (from CDBHS/IONOS)
CREATE TABLE IF NOT EXISTS tournoi_ext (
    tournoi_id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    mode TEXT NOT NULL,
    categorie TEXT NOT NULL,
    taille INTEGER,
    debut DATE,
    fin DATE,
    grand_coin INTEGER DEFAULT 0,
    taille_cadre TEXT,
    lieu TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Player inscriptions/registrations
CREATE TABLE IF NOT EXISTS inscriptions (
    inscription_id INTEGER PRIMARY KEY,
    joueur_id INTEGER,
    tournoi_id INTEGER REFERENCES tournoi_ext(tournoi_id),
    timestamp TIMESTAMP NOT NULL,
    email TEXT,
    telephone TEXT,
    licence TEXT,
    convoque INTEGER DEFAULT 0,
    forfait INTEGER DEFAULT 0,
    commentaire TEXT,
    source VARCHAR(20) DEFAULT 'ionos',
    convocation_poule VARCHAR(10),
    convocation_lieu VARCHAR(255),
    convocation_adresse TEXT,
    convocation_heure VARCHAR(10),
    convocation_notes TEXT,
    convocation_phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Clubs information
CREATE TABLE IF NOT EXISTS clubs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    logo_filename TEXT,
    street TEXT,
    city TEXT,
    zip_code TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Club name aliases
CREATE TABLE IF NOT EXISTS club_aliases (
    id SERIAL PRIMARY KEY,
    alias TEXT NOT NULL UNIQUE,
    canonical_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. RESULTS & RANKINGS TABLES
-- ============================================================================

-- Game categories
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    game_type TEXT NOT NULL,
    level TEXT NOT NULL,
    display_name TEXT NOT NULL,
    UNIQUE(game_type, level)
);

-- Internal tournaments (with results)
CREATE TABLE IF NOT EXISTS tournaments (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    tournament_number INTEGER NOT NULL,
    season TEXT NOT NULL,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tournament_date TIMESTAMP,
    location TEXT,
    results_email_sent BOOLEAN DEFAULT FALSE,
    results_email_sent_at TIMESTAMP,
    UNIQUE(category_id, tournament_number, season)
);

-- Tournament results per player
CREATE TABLE IF NOT EXISTS tournament_results (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
    licence TEXT NOT NULL REFERENCES players(licence),
    player_name TEXT,
    position INTEGER DEFAULT 0,
    match_points INTEGER DEFAULT 0,
    moyenne REAL DEFAULT 0,
    serie INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    reprises INTEGER DEFAULT 0,
    UNIQUE(tournament_id, licence)
);

-- Season rankings
CREATE TABLE IF NOT EXISTS rankings (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    season TEXT NOT NULL,
    licence TEXT NOT NULL REFERENCES players(licence),
    total_match_points INTEGER DEFAULT 0,
    avg_moyenne REAL DEFAULT 0,
    best_serie INTEGER DEFAULT 0,
    rank_position INTEGER,
    tournament_1_points INTEGER DEFAULT 0,
    tournament_2_points INTEGER DEFAULT 0,
    tournament_3_points INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, season, licence)
);

-- ============================================================================
-- 3. CONFIGURATION TABLES
-- ============================================================================

-- Game parameters/rules
CREATE TABLE IF NOT EXISTS game_parameters (
    id SERIAL PRIMARY KEY,
    mode TEXT NOT NULL,
    categorie TEXT NOT NULL,
    coin TEXT NOT NULL DEFAULT 'PC',
    distance_normale INTEGER NOT NULL,
    distance_reduite INTEGER,
    reprises INTEGER NOT NULL,
    moyenne_mini DECIMAL(6,3) NOT NULL,
    moyenne_maxi DECIMAL(6,3) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mode, categorie)
);

-- Mode mapping (IONOS → internal)
CREATE TABLE IF NOT EXISTS mode_mapping (
    id SERIAL PRIMARY KEY,
    ionos_mode TEXT NOT NULL UNIQUE,
    game_type TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Category mapping (IONOS → internal)
CREATE TABLE IF NOT EXISTS category_mapping (
    id SERIAL PRIMARY KEY,
    ionos_categorie TEXT NOT NULL,
    game_type TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ionos_categorie, game_type)
);

-- ============================================================================
-- 4. USER MANAGEMENT TABLES
-- ============================================================================

-- Admin application users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    email TEXT,
    is_active INTEGER DEFAULT 1,
    receive_tournament_alerts BOOLEAN DEFAULT FALSE,
    reset_token TEXT,
    reset_token_expiry TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Player App accounts
CREATE TABLE IF NOT EXISTS player_accounts (
    id SERIAL PRIMARY KEY,
    licence VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT TRUE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- Player contacts (centralized)
CREATE TABLE IF NOT EXISTS player_contacts (
    id SERIAL PRIMARY KEY,
    licence TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    club TEXT,
    email TEXT,
    telephone TEXT,
    rank_libre TEXT,
    rank_cadre TEXT,
    rank_bande TEXT,
    rank_3bandes TEXT,
    statut TEXT DEFAULT 'Actif',
    comments TEXT,
    email_optin INTEGER DEFAULT 1,
    last_contacted TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password reset codes
CREATE TABLE IF NOT EXISTS password_reset_codes (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_reset_codes_email ON password_reset_codes(email);

-- Legacy admin table
CREATE TABLE IF NOT EXISTS admin (
    id SERIAL PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. EMAIL SYSTEM TABLES
-- ============================================================================

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    template_key TEXT NOT NULL UNIQUE,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    outro_template TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email campaigns history
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    template_key TEXT,
    campaign_type TEXT,
    mode TEXT,
    category TEXT,
    tournament_id INTEGER,
    recipients_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    sent_by TEXT,
    test_mode BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled emails
CREATE TABLE IF NOT EXISTS scheduled_emails (
    id SERIAL PRIMARY KEY,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    template_key TEXT,
    image_url TEXT,
    recipient_ids TEXT NOT NULL,
    scheduled_at TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'pending',
    email_type TEXT,
    mode TEXT,
    category TEXT,
    tournament_id INTEGER,
    outro_text TEXT,
    cc_email TEXT,
    custom_data TEXT,
    created_by TEXT,
    test_mode BOOLEAN DEFAULT FALSE,
    test_email TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inscription email logs
CREATE TABLE IF NOT EXISTS inscription_email_logs (
    id SERIAL PRIMARY KEY,
    email_type TEXT NOT NULL,
    player_email TEXT NOT NULL,
    player_name TEXT,
    tournament_name TEXT,
    mode TEXT,
    category TEXT,
    tournament_date TEXT,
    location TEXT,
    status TEXT DEFAULT 'sent',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournament relance tracking
CREATE TABLE IF NOT EXISTS tournament_relances (
    id SERIAL PRIMARY KEY,
    tournoi_id INTEGER NOT NULL UNIQUE,
    relance_sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_by TEXT,
    recipients_count INTEGER DEFAULT 0
);

-- ============================================================================
-- 6. OTHER TABLES
-- ============================================================================

-- Calendar PDF storage
CREATE TABLE IF NOT EXISTS calendar (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    file_data BYTEA NOT NULL,
    uploaded_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Import history/audit
CREATE TABLE IF NOT EXISTS import_history (
    id SERIAL PRIMARY KEY,
    file_type TEXT NOT NULL,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    record_count INTEGER DEFAULT 0,
    filename TEXT,
    imported_by TEXT
);

-- ============================================================================
-- FOREIGN KEY RELATIONSHIPS SUMMARY
-- ============================================================================
--
-- inscriptions.tournoi_id → tournoi_ext.tournoi_id
-- tournaments.category_id → categories.id
-- tournament_results.tournament_id → tournaments.id
-- tournament_results.licence → players.licence
-- rankings.category_id → categories.id
-- rankings.licence → players.licence
-- category_mapping.category_id → categories.id
--
-- ============================================================================
