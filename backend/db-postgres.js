const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// PostgreSQL connection — explicit pool sizing.
// Audit Phase 4 finding W8 (April 2026): pg default is 10 connections, which is
// tight under concurrent load (4 admins + 4 schedulers + public endpoints).
// max=20 matches Railway's PostgreSQL connection limit comfortably (default 100).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err.message);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
    initializeDatabase();
  }
});

// Initialize database schema
async function initializeDatabase() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Admin table (legacy - kept for backwards compatibility)
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ============= MULTI-CDB ORGANIZATIONS =============

    // Organizations table — one per CDB (must be before users table)
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        short_name VARCHAR(20) NOT NULL UNIQUE,
        slug VARCHAR(50) NOT NULL UNIQUE,
        ffb_cdb_code VARCHAR(10),
        ffb_ligue_numero VARCHAR(10),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: increase short_name column size from 20 to 100 characters (April 2026)
    await client.query(`ALTER TABLE organizations ALTER COLUMN short_name TYPE VARCHAR(100)`);

    // Migration: add welcome_email_sent_at column
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMP`);

    // Per-CDB settings (mirrors app_settings pattern but scoped per org)
    await client.query(`
      CREATE TABLE IF NOT EXISTS organization_settings (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, key)
      )
    `);

    // Users table with roles
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    // Add email and password reset columns to users
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS receive_tournament_alerts BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ffb_ligue_numero VARCHAR(10)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMP`);

    // Players table
    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        licence TEXT PRIMARY KEY,
        club TEXT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        rank_libre TEXT,
        rank_cadre TEXT,
        rank_bande TEXT,
        rank_3bandes TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add email and telephone columns to players (migration for inscription validation)
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS telephone TEXT`);
    // Add player_app_role column for Player App admin management (joueur/admin)
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS player_app_role VARCHAR(20) DEFAULT NULL`);
    // Add player_app_user column to track Player App users (boolean)
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS player_app_user BOOLEAN DEFAULT FALSE`);

    // Widen ffb_rankings columns to support longer codes like "14.1 CONTINU" (migration - February 2026)
    await client.query(`ALTER TABLE ffb_rankings ALTER COLUMN code TYPE VARCHAR(20)`);
    await client.query(`ALTER TABLE ffb_rankings ALTER COLUMN display_name TYPE VARCHAR(100)`);
    await client.query(`ALTER TABLE ffb_rankings ALTER COLUMN tier TYPE VARCHAR(50)`);

    // Migrate tier short codes to full names (February 2026)
    await client.query(`UPDATE ffb_rankings SET tier = 'NATIONAL' WHERE tier = 'N'`);
    await client.query(`UPDATE ffb_rankings SET tier = 'REGIONAL' WHERE tier = 'R'`);
    await client.query(`UPDATE ffb_rankings SET tier = 'DEPARTEMENTAL' WHERE tier = 'D'`);
    await client.query(`UPDATE ffb_rankings SET tier = 'NON CLASSE' WHERE tier = 'NC'`);

    // Add GDPR consent columns to players table (migration - January 2026)
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gdpr_consent_date TIMESTAMP`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gdpr_consent_version VARCHAR(10)`);

    // FFB enrichment columns for players table (migration - February 2026)
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ffb_club_numero VARCHAR(10)`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS sexe VARCHAR(2)`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ffb_categorie VARCHAR(30)`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discipline VARCHAR(30)`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS arbitre VARCHAR(20)`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS date_licence DATE`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS nationalite VARCHAR(50)`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ffb_last_sync TIMESTAMP`);
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);

    // Migrations that depend on player_accounts - check if table exists first
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'player_accounts'
      )
    `);

    if (tableCheck.rows[0].exists) {
      // Migrate existing admins from player_accounts.is_admin to players.player_app_role
      await client.query(`
        UPDATE players p
        SET player_app_role = 'admin'
        FROM player_accounts pa
        WHERE REPLACE(p.licence, ' ', '') = REPLACE(pa.licence, ' ', '')
          AND pa.is_admin = true
          AND (p.player_app_role IS NULL OR p.player_app_role != 'admin')
      `);

      // Migrate existing player_accounts to mark them as Player App users
      await client.query(`
        UPDATE players p
        SET player_app_user = TRUE
        FROM player_accounts pa
        WHERE REPLACE(p.licence, ' ', '') = REPLACE(pa.licence, ' ', '')
          AND p.player_app_user = FALSE
      `);

      // Sync GDPR consent from player_accounts to players table
      // (Player App stores GDPR in player_accounts, but exports read from players)
      const gdprSyncResult = await client.query(`
        UPDATE players p
        SET gdpr_consent_date = pa.gdpr_consent_date,
            gdpr_consent_version = pa.gdpr_consent_version
        FROM player_accounts pa
        WHERE REPLACE(p.licence, ' ', '') = REPLACE(pa.licence, ' ', '')
          AND pa.gdpr_consent_date IS NOT NULL
          AND p.gdpr_consent_date IS NULL
      `);
      if (gdprSyncResult.rowCount > 0) {
        console.log(`[Migration] Synced GDPR consent for ${gdprSyncResult.rowCount} players from player_accounts`);
      }
    } else {
      console.log('Skipping player_accounts migration (table does not exist yet)');
    }

    // Set player_app_role = 'joueur' for players who are Player App users but have no role
    // This consolidates player_app_user boolean into player_app_role
    await client.query(`
      UPDATE players
      SET player_app_role = 'joueur'
      WHERE player_app_user = TRUE
        AND (player_app_role IS NULL OR player_app_role = '')
    `);

    // Ensure Rallet and Hui Bon Hoa are admins
    await client.query(`
      UPDATE players
      SET player_app_role = 'admin'
      WHERE UPPER(last_name) LIKE '%RALLET%' OR UPPER(last_name) LIKE '%HUI BON HOA%'
    `);

    // Populate players email/telephone from inscriptions (batch migration)
    // Check if inscriptions table exists first (it's created later in initialization)
    const inscriptionsCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'inscriptions'
      )
    `);

    if (inscriptionsCheck.rows[0].exists) {
      // Uses most recent inscription for each player
      await client.query(`
        UPDATE players p
        SET email = i.email
        FROM (
          SELECT DISTINCT ON (REPLACE(licence, ' ', ''))
            REPLACE(licence, ' ', '') as clean_licence,
            email
          FROM inscriptions
          WHERE email IS NOT NULL AND email != ''
          ORDER BY REPLACE(licence, ' ', ''), timestamp DESC
        ) i
        WHERE REPLACE(p.licence, ' ', '') = i.clean_licence
          AND (p.email IS NULL OR p.email = '')
      `);

      await client.query(`
        UPDATE players p
        SET telephone = i.telephone
        FROM (
          SELECT DISTINCT ON (REPLACE(licence, ' ', ''))
            REPLACE(licence, ' ', '') as clean_licence,
            telephone
          FROM inscriptions
          WHERE telephone IS NOT NULL AND telephone != ''
          ORDER BY REPLACE(licence, ' ', ''), timestamp DESC
        ) i
        WHERE REPLACE(p.licence, ' ', '') = i.clean_licence
          AND (p.telephone IS NULL OR p.telephone = '')
      `);
    } else {
      console.log('Skipping inscriptions migration (table does not exist yet)');
    }

    // Categories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        game_type TEXT NOT NULL,
        level TEXT NOT NULL,
        display_name TEXT NOT NULL,
        UNIQUE(game_type, level)
      )
    `);

    // Tournaments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id SERIAL PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        tournament_number INTEGER NOT NULL,
        season TEXT NOT NULL,
        import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tournament_date TIMESTAMP,
        location TEXT,
        UNIQUE(category_id, tournament_number, season)
      )
    `);

    // Add location column if it doesn't exist (migration)
    await client.query(`
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS location TEXT
    `);

    // Add location_2 column to tournaments for split tournaments (migration - February 2026)
    await client.query(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS location_2 TEXT`);

    // Add results_email_sent columns (migration for tracking email status)
    await client.query(`
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS results_email_sent BOOLEAN DEFAULT FALSE
    `);
    await client.query(`
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS results_email_sent_at TIMESTAMP
    `);

    // Add wp_results_post_id column for WordPress results publishing (migration - March 2026)
    await client.query(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS wp_results_post_id INTEGER`);

    // Mark all existing tournaments as results sent (one-time migration for existing data)
    // Only runs if NO tournaments have been marked as sent yet (first deployment)
    const sentCheck = await client.query(`SELECT COUNT(*) as cnt FROM tournaments WHERE results_email_sent = TRUE`);
    if (parseInt(sentCheck.rows[0].cnt) === 0) {
      console.log('Migration: Marking all existing tournaments as results sent');
      await client.query(`
        UPDATE tournaments
        SET results_email_sent = TRUE, results_email_sent_at = CURRENT_TIMESTAMP
        WHERE results_email_sent IS NULL OR results_email_sent = FALSE
      `);
    }

    // Tournament results table
    await client.query(`
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
      )
    `);

    // Add position column if it doesn't exist (migration)
    await client.query(`
      ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0
    `);

    // Add bonus_points column (scoring rules feature)
    await client.query(`
      ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS bonus_points INTEGER DEFAULT 0
    `);

    // Rankings table
    await client.query(`
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
      )
    `);

    // Add total_bonus_points column to rankings (scoring rules feature)
    await client.query(`
      ALTER TABLE rankings ADD COLUMN IF NOT EXISTS total_bonus_points INTEGER DEFAULT 0
    `);

    // Add bonus_detail JSON column to tournament_results and rankings
    await client.query(`ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS bonus_detail TEXT`);
    await client.query(`ALTER TABLE rankings ADD COLUMN IF NOT EXISTS bonus_detail TEXT`);

    // Journées Qualificatives ranking columns
    await client.query(`ALTER TABLE rankings ADD COLUMN IF NOT EXISTS position_points_detail TEXT`); // JSON: {"1": 10, "2": 8, "3": 6}
    await client.query(`ALTER TABLE rankings ADD COLUMN IF NOT EXISTS average_bonus INTEGER DEFAULT 0`); // Tiered bonus 0-3

    // Clubs table
    await client.query(`
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
      )
    `);

    // Add new columns to clubs if they don't exist (migration)
    const clubColumns = ['street', 'city', 'zip_code', 'phone', 'email', 'calendar_code', 'president'];
    for (const col of clubColumns) {
      try {
        await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      } catch (e) {
        // Column might already exist
      }
    }

    // Add club officials columns (migration - February 2026)
    // President email and Responsable sportif for club dashboard access in Player App
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS president_email VARCHAR(255)`);
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS responsable_sportif_name VARCHAR(255)`);
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS responsable_sportif_email VARCHAR(255)`);
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS responsable_sportif_licence VARCHAR(50)`);
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);

    // Add club logo binary storage columns (migration - March 2026)
    // Stores logo in database so it persists across Railway deployments
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logo_data BYTEA`);
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logo_content_type TEXT`);

    // Initialize default calendar codes for existing clubs
    const defaultCalendarCodes = [
      { name_pattern: '%COURBEVOIE%', code: 'A' },
      { name_pattern: '%BOIS%COLOMBES%', code: 'B' },
      { name_pattern: '%CHATILLON%', code: 'C' },
      { name_pattern: '%Châtillon%', code: 'C' },
      { name_pattern: '%CLAMART%', code: 'D' },
      { name_pattern: '%CLICH%', code: 'E' }
    ];
    for (const mapping of defaultCalendarCodes) {
      await client.query(`
        UPDATE clubs SET calendar_code = $1
        WHERE (name ILIKE $2 OR display_name ILIKE $2) AND calendar_code IS NULL
      `, [mapping.code, mapping.name_pattern]);
    }

    // Migrate existing club logos from filesystem to database (one-time, idempotent)
    try {
      const fs = require('fs');
      const path = require('path');
      const clubsWithLogos = await client.query(
        `SELECT id, logo_filename FROM clubs WHERE logo_filename IS NOT NULL AND logo_data IS NULL`
      );
      if (clubsWithLogos.rows.length > 0) {
        const frontendPath = fs.existsSync(path.join(__dirname, 'frontend'))
          ? path.join(__dirname, 'frontend')
          : path.join(__dirname, '../frontend');
        for (const club of clubsWithLogos.rows) {
          const filePath = path.join(frontendPath, 'images', 'clubs', club.logo_filename);
          if (fs.existsSync(filePath)) {
            const fileData = fs.readFileSync(filePath);
            const ext = path.extname(club.logo_filename).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
            await client.query(
              `UPDATE clubs SET logo_data = $1, logo_content_type = $2 WHERE id = $3`,
              [fileData, contentType, club.id]
            );
            console.log(`[MIGRATION] Club logo migrated to DB: ${club.logo_filename}`);
          }
        }
      }
    } catch (migrationErr) {
      console.error('[MIGRATION] Club logo migration error (non-fatal):', migrationErr.message);
    }

    // Club aliases table - maps variant names to canonical club names
    await client.query(`
      CREATE TABLE IF NOT EXISTS club_aliases (
        id SERIAL PRIMARY KEY,
        alias TEXT NOT NULL UNIQUE,
        canonical_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add email column to club_aliases for club reminder emails
    await client.query(`ALTER TABLE club_aliases ADD COLUMN IF NOT EXISTS email TEXT`);

    // Club season stats snapshot table - stores end-of-season dashboard stats per club
    await client.query(`
      CREATE TABLE IF NOT EXISTS club_season_stats (
        id SERIAL PRIMARY KEY,
        club_id INTEGER NOT NULL REFERENCES clubs(id),
        season VARCHAR(20) NOT NULL,
        total_players INTEGER DEFAULT 0,
        active_players INTEGER DEFAULT 0,
        total_inscriptions INTEGER DEFAULT 0,
        mode_distribution JSONB DEFAULT '{}',
        competitions_hosted INTEGER DEFAULT 0,
        tournament_podiums INTEGER DEFAULT 0,
        finale_medals INTEGER DEFAULT 0,
        finalists_count INTEGER DEFAULT 0,
        snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(club_id, season)
      )
    `);

    // External tournament definitions table (from CDBHS external DB)
    await client.query(`
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
      )
    `);

    // Add convocation_sent_at column to tournoi_ext (migration - January 2026)
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS convocation_sent_at TIMESTAMP`);

    // Add status column to tournoi_ext (migration - January 2026)
    // Values: 'active' (default), 'cancelled'
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);

    // Add notify_on_changes column to tournoi_ext (migration - January 2026)
    // Controls whether date/location changes trigger automatic email notifications
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS notify_on_changes BOOLEAN DEFAULT TRUE`);

    // Add lieu_2 column to tournoi_ext for split tournaments (migration - February 2026)
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS lieu_2 TEXT`);

    // Add tournament_number column to tournoi_ext (migration - March 2026)
    // Direct integer matching tournament_types.tournament_number — replaces fragile nom parsing
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS tournament_number INTEGER`);
    // Backfill existing entries from nom patterns (one-time, only fills NULLs)
    await client.query(`
      UPDATE tournoi_ext SET tournament_number = CASE
        WHEN UPPER(nom) LIKE 'T1 %' OR UPPER(nom) = 'T1' OR UPPER(nom) LIKE 'TOURNOI 1%' OR UPPER(nom) LIKE 'TQ1%' THEN 1
        WHEN UPPER(nom) LIKE 'T2 %' OR UPPER(nom) = 'T2' OR UPPER(nom) LIKE 'TOURNOI 2%' OR UPPER(nom) LIKE 'TQ2%' THEN 2
        WHEN UPPER(nom) LIKE 'T3 %' OR UPPER(nom) = 'T3' OR UPPER(nom) LIKE 'TOURNOI 3%' OR UPPER(nom) LIKE 'TQ3%' THEN 3
        WHEN UPPER(nom) LIKE '%FINALE%' OR UPPER(nom) LIKE 'FD%' THEN 4
        ELSE NULL
      END
      WHERE tournament_number IS NULL
    `);

    // Backfill tournaments.location from tournoi_ext.lieu for CDB9394 (org_id=6) — March 2026
    // Only fills NULL locations. Starts from tournament's own category to avoid org_id mismatch.
    // Uses REPLACE for mode comparison to handle "3 BANDES" vs "3BANDES" differences.
    const backfillResult = await client.query(`
      UPDATE tournaments t
      SET location = sub.lieu, location_2 = sub.lieu_2
      FROM (
        SELECT DISTINCT ON (t2.id) t2.id AS tournament_id, te.lieu, te.lieu_2
        FROM tournaments t2
        JOIN categories c ON c.id = t2.category_id
        JOIN tournoi_ext te
          ON UPPER(REPLACE(te.mode, ' ', '')) = UPPER(REPLACE(c.game_type, ' ', ''))
          AND (UPPER(te.categorie) = UPPER(c.level)
               OR UPPER(c.level) = ANY(string_to_array(UPPER(te.categorie), '-')))
          AND te.tournament_number = t2.tournament_number
          AND te.organization_id = 6
          AND te.lieu IS NOT NULL
        WHERE t2.organization_id = 6
          AND t2.location IS NULL
        ORDER BY t2.id, te.debut DESC
      ) sub
      WHERE t.id = sub.tournament_id
    `);
    if (backfillResult.rowCount > 0) {
      console.log(`[MIGRATION] Backfilled location for ${backfillResult.rowCount} CDB9394 tournaments`);
    }

    // Split tournament support (migration - March 2026)
    // Parent/child model: parent holds inscriptions, children represent physical events at different locations
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS is_split BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS parent_tournoi_id INTEGER REFERENCES tournoi_ext(tournoi_id)`);
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS split_label VARCHAR(5)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tournoi_ext_parent ON tournoi_ext(parent_tournoi_id) WHERE parent_tournoi_id IS NOT NULL`);

    // WordPress publication tracking (migration - March 2026)
    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS wp_post_id INTEGER`);

    // Drop redundant fin column (migration - April 2026)
    // The fin column was always equal to debut, causing confusion in timeline calculations
    // All code references removed in V 2.0.334-335
    try {
      await client.query(`ALTER TABLE tournoi_ext DROP COLUMN IF EXISTS fin`);
      console.log('Migration: Dropped tournoi_ext.fin column');
    } catch (err) {
      // Column might not exist or already dropped - safe to ignore
      console.log('Migration: tournoi_ext.fin column already dropped or does not exist');
    }

    // Tournament parameter overrides table (migration - February 2026)
    // Allows per-tournament customization of Distance and Reprises values
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_parameter_overrides (
        id SERIAL PRIMARY KEY,
        tournoi_id INTEGER NOT NULL REFERENCES tournoi_ext(tournoi_id) ON DELETE CASCADE,
        distance INTEGER NOT NULL,
        distance_type TEXT DEFAULT 'normale',
        reprises INTEGER NOT NULL,
        validated_at TIMESTAMP,
        validated_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournoi_id)
      )
    `);

    // Player inscriptions table (from CDBHS external DB)
    await client.query(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add convocation details columns to inscriptions (migration)
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_poule VARCHAR(10)`);
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_lieu VARCHAR(255)`);
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_adresse TEXT`);
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_heure VARCHAR(10)`);
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_notes TEXT`);
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_phone VARCHAR(50)`);

    // Add source column to track inscription origin (ionos import vs player_app)
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ionos'`);

    // Add statut column to track inscription status (inscrit, désinscrit)
    // Note: forfait is separate - used only after official convocation is sent
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'inscrit'`);

    // Split tournament: track which sub-tournament (A/B) a player is assigned to
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS assigned_split VARCHAR(5)`);

    // Add unique constraint on (normalized licence, tournoi_id) to prevent duplicates
    // This ensures a player can only be inscribed once per tournament regardless of source
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_licence_tournoi
      ON inscriptions (REPLACE(UPPER(licence), ' ', ''), tournoi_id)
    `);

    // Fix inscription convoque status based on tournament date
    // 1. PAST tournaments (debut <= today): all players should be convoque=1 (they played)
    const fixPastResult = await client.query(`
      UPDATE inscriptions i
      SET convoque = 1
      FROM tournoi_ext t
      WHERE i.tournoi_id = t.tournoi_id
        AND t.debut <= CURRENT_DATE
        AND i.convoque = 0
    `);
    if (fixPastResult.rowCount > 0) {
      console.log(`[Migration] Fixed ${fixPastResult.rowCount} past tournament inscriptions: set convoque=1`);
    }

    // 2. FUTURE tournaments with convocation SENT: set convoque=1
    //    (record exists in convocation_poules means convocation was sent)
    const fixConvokedResult = await client.query(`
      UPDATE inscriptions i
      SET convoque = 1
      WHERE i.convoque = 0
        AND EXISTS (
          SELECT 1 FROM convocation_poules cp
          WHERE cp.tournoi_id = i.tournoi_id
            AND REPLACE(UPPER(cp.licence), ' ', '') = REPLACE(UPPER(i.licence), ' ', '')
        )
    `);
    if (fixConvokedResult.rowCount > 0) {
      console.log(`[Migration] Fixed ${fixConvokedResult.rowCount} inscriptions with convocation sent: set convoque=1`);
    }

    // 3. FUTURE tournaments without convocation: Player App inscriptions should be convoque=0
    const fixFutureResult = await client.query(`
      UPDATE inscriptions i
      SET convoque = 0
      FROM tournoi_ext t
      WHERE i.tournoi_id = t.tournoi_id
        AND t.debut > CURRENT_DATE
        AND i.source = 'player_app'
        AND i.convoque = 1
        AND NOT EXISTS (
          SELECT 1 FROM convocation_poules cp
          WHERE cp.tournoi_id = i.tournoi_id
            AND REPLACE(UPPER(cp.licence), ' ', '') = REPLACE(UPPER(i.licence), ' ', '')
        )
    `);
    if (fixFutureResult.rowCount > 0) {
      console.log(`[Migration] Fixed ${fixFutureResult.rowCount} future Player App inscriptions: set convoque=0`);
    }

    // Calendar storage table
    await client.query(`
      CREATE TABLE IF NOT EXISTS calendar (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        file_data BYTEA NOT NULL,
        uploaded_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // (Seasonal Calendar Generator schema moved to POST-COMMIT block to avoid rolling back the main transaction)

    // Invitation PDF storage table (persists across deployments)
    await client.query(`
      CREATE TABLE IF NOT EXISTS invitation_pdf (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        file_data BYTEA NOT NULL,
        uploaded_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Organization logo storage table (for emails)
    await client.query(`
      CREATE TABLE IF NOT EXISTS organization_logo (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        file_data BYTEA NOT NULL,
        uploaded_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Mode mapping table - maps IONOS mode names to internal game_type
    await client.query(`
      CREATE TABLE IF NOT EXISTS mode_mapping (
        id SERIAL PRIMARY KEY,
        ionos_mode TEXT NOT NULL UNIQUE,
        game_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Category mapping table - maps IONOS category names to internal category IDs
    await client.query(`
      CREATE TABLE IF NOT EXISTS category_mapping (
        id SERIAL PRIMARY KEY,
        ionos_categorie TEXT NOT NULL,
        game_type TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ionos_categorie, game_type)
      )
    `);

    // Import history table - tracks all file imports from IONOS
    await client.query(`
      CREATE TABLE IF NOT EXISTS import_history (
        id SERIAL PRIMARY KEY,
        file_type TEXT NOT NULL,
        import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        record_count INTEGER DEFAULT 0,
        filename TEXT,
        imported_by TEXT
      )
    `);

    // Game parameters table - stores rules for each mode/category combination
    await client.query(`
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
      )
    `);

    // Email templates table - stores configurable email content
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        template_key TEXT NOT NULL UNIQUE,
        subject_template TEXT NOT NULL,
        body_template TEXT NOT NULL,
        outro_template TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add outro_template column if it doesn't exist (for existing deployments)
    await client.query(`
      ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS outro_template TEXT
    `);

    // Player contacts table - centralized contact information
    await client.query(`
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
      )
    `);

    // Email campaigns table - history of sent emails
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        template_key TEXT,
        recipients_count INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft',
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        campaign_type TEXT,
        mode TEXT,
        category TEXT,
        tournament_id INTEGER,
        sent_by TEXT,
        test_mode BOOLEAN DEFAULT FALSE
      )
    `);

    // Add new columns if they don't exist (for existing deployments)
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT`);
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS mode TEXT`);
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS category TEXT`);
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS tournament_id INTEGER`);
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sent_by TEXT`);
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS test_mode BOOLEAN DEFAULT FALSE`);

    // Scheduled emails table - for future email sending
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_emails (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        template_key TEXT,
        image_url TEXT,
        recipient_ids TEXT NOT NULL,
        scheduled_at TIMESTAMP NOT NULL,
        status TEXT DEFAULT 'pending',
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        email_type TEXT,
        mode TEXT,
        category TEXT,
        tournament_id INTEGER,
        outro_text TEXT,
        cc_email TEXT,
        custom_data TEXT,
        created_by TEXT
      )
    `);

    // Add columns if they don't exist (migration)
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS image_url TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS email_type TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS mode TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS category TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS tournament_id INTEGER`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS outro_text TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS cc_email TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS custom_data TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS created_by TEXT`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS test_mode BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS test_email TEXT`);

    // Tournament relance tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_relances (
        id SERIAL PRIMARY KEY,
        tournoi_id INTEGER NOT NULL,
        relance_sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_by TEXT,
        recipients_count INTEGER DEFAULT 0,
        UNIQUE(tournoi_id)
      )
    `);

    // Password reset codes table (replaces in-memory storage for security)
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT FALSE
      )
    `);
    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reset_codes_email ON password_reset_codes(email)
    `);

    // Migration: add organization_id to password_reset_codes for multi-CDB isolation
    await client.query(`
      ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reset_codes_org_email ON password_reset_codes(organization_id, email)
    `);

    // Inscription email logs table - history of inscription/désinscription emails
    await client.query(`
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
      )
    `);

    // Player accounts table (for Espace Joueur app)
    await client.query(`
      CREATE TABLE IF NOT EXISTS player_accounts (
        id SERIAL PRIMARY KEY,
        licence VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        email_verified BOOLEAN DEFAULT true,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      )
    `);

    // Add GDPR consent columns to player_accounts (migration - January 2026)
    await client.query(`ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS gdpr_consent_date TIMESTAMP`);
    await client.query(`ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS gdpr_consent_version VARCHAR(10)`);

    // Add push notification preference to player_accounts (migration - March 2026)
    await client.query(`ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT true`);

    // Add organization_id to player_accounts for multi-CDB support (migration)
    await client.query(`ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);

    // Push subscriptions table (for Web Push notifications)
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        player_account_id INTEGER REFERENCES player_accounts(id) ON DELETE CASCADE,
        organization_id INTEGER REFERENCES organizations(id),
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Index for faster lookups by player and org
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_player ON push_subscriptions(player_account_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_org ON push_subscriptions(organization_id)
    `);

    // Announcements table (for Player App notifications)
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'info',
        is_active BOOLEAN DEFAULT TRUE,
        expires_at TIMESTAMP,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add test_licence and target_licence columns for announcements (migration)
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS test_licence VARCHAR(20)`);
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_licence VARCHAR(20)`);

    // Add filter columns for announcements (migration - Feb 2026)
    // Stores JSON arrays for filtering by mode, ranking, or club
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_modes TEXT`);
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_rankings TEXT`);
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_clubs TEXT`);

    // Add target_type column for announcements (filtering by player app installation)
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_type VARCHAR(20) DEFAULT 'all'`);

    // ============================================================
    // Player App News / Communication Module (April 2026)
    // For CDBs without a WordPress site — integrated CMS in Player App
    // Activated per-org via organization_settings.news_delivery_mode = 'player_app'
    // ============================================================

    // Content sections — hierarchical menus/sub-menus tree
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_sections (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        parent_id INTEGER REFERENCES content_sections(id) ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_sections_org ON content_sections(organization_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_sections_parent ON content_sections(parent_id)
    `);

    // Content pages — articles (news, events, results, documents)
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_pages (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        section_id INTEGER REFERENCES content_sections(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        content_html TEXT NOT NULL DEFAULT '',
        excerpt VARCHAR(500),
        content_type VARCHAR(20) DEFAULT 'actualite',
        status VARCHAR(20) DEFAULT 'draft',
        is_featured BOOLEAN DEFAULT FALSE,
        is_pinned BOOLEAN DEFAULT FALSE,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_pages_org ON content_pages(organization_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_pages_section ON content_pages(section_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_pages_status ON content_pages(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_pages_featured ON content_pages(is_featured) WHERE is_featured = TRUE
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_pages_pinned ON content_pages(is_pinned) WHERE is_pinned = TRUE
    `);

    // Migration (April 2026): add cover_image column for thumbnail previews
    // in the Player App news feed. The thumbnail is generated client-side
    // at save time (~400px wide JPEG base64) so it stays small and no
    // server-side image processing is needed.
    await client.query(`ALTER TABLE content_pages ADD COLUMN IF NOT EXISTS cover_image TEXT`);

    // Migration (April 2026): auto-generated article tracking.
    // These columns let us distinguish articles created by the admin (manual)
    // from articles produced by the auto-publisher service, and give us a
    // stable key to detect duplicates — so a results re-import, a tournament
    // UPDATE replay, or a scheduler retry never creates a second copy of the
    // same article for the same source event.
    //
    // source_type  — event family (e.g. 'RESULTS', 'FINALE_QUALIFICATION',
    //                'NEW_TOURNAMENT'). Free-form string so new event types
    //                can be added without a schema change.
    // source_ref_id — numeric id of the originating row (tournament id for
    //                RESULTS / FINALE_QUALIFICATION, tournoi_ext.tournoi_id
    //                for NEW_TOURNAMENT). NULL for manual articles.
    await client.query(`ALTER TABLE content_pages ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE content_pages ADD COLUMN IF NOT EXISTS source_type VARCHAR(50)`);
    await client.query(`ALTER TABLE content_pages ADD COLUMN IF NOT EXISTS source_ref_id INTEGER`);

    // Partial unique index: enforces idempotency for auto-generated articles
    // only. Manual articles are unaffected (they leave source_type NULL and
    // are filtered out by the WHERE clause). The triple (org, type, ref) is
    // what we look up in the auto-publisher before inserting.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_pages_auto_source
        ON content_pages(organization_id, source_type, source_ref_id)
        WHERE auto_generated = TRUE
    `);

    // Content links — cross-links between articles (related content)
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_links (
        id SERIAL PRIMARY KEY,
        source_page_id INTEGER NOT NULL REFERENCES content_pages(id) ON DELETE CASCADE,
        target_page_id INTEGER NOT NULL REFERENCES content_pages(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_page_id, target_page_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_links_source ON content_links(source_page_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_links_target ON content_links(target_page_id)
    `);

    // Survey campaigns table (satisfaction surveys for Player App)
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_campaigns (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'draft',
        category_1_label VARCHAR(255) NOT NULL,
        category_2_label VARCHAR(255) NOT NULL,
        category_3_label VARCHAR(255) NOT NULL,
        category_4_label VARCHAR(255) NOT NULL,
        category_5_label VARCHAR(255) NOT NULL,
        organization_id INTEGER REFERENCES organizations(id),
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        activated_at TIMESTAMP,
        closed_at TIMESTAMP,
        starts_at TIMESTAMP,
        ends_at TIMESTAMP
      )
    `);

    // Migration: add starts_at/ends_at to survey_campaigns if missing
    await client.query(`ALTER TABLE survey_campaigns ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP`);
    await client.query(`ALTER TABLE survey_campaigns ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP`);

    // Survey responses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_responses (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES survey_campaigns(id) ON DELETE CASCADE,
        player_licence VARCHAR(50) NOT NULL,
        player_name TEXT,
        rating_1 INTEGER NOT NULL CHECK (rating_1 BETWEEN 1 AND 5),
        rating_2 INTEGER NOT NULL CHECK (rating_2 BETWEEN 1 AND 5),
        rating_3 INTEGER NOT NULL CHECK (rating_3 BETWEEN 1 AND 5),
        rating_4 INTEGER NOT NULL CHECK (rating_4 BETWEEN 1 AND 5),
        rating_5 INTEGER NOT NULL CHECK (rating_5 BETWEEN 1 AND 5),
        overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
        comment TEXT,
        organization_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(campaign_id, player_licence)
      )
    `);

    // Survey dismissals table (tracks players who dismissed the survey)
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_dismissals (
        campaign_id INTEGER NOT NULL REFERENCES survey_campaigns(id) ON DELETE CASCADE,
        player_licence VARCHAR(50) NOT NULL,
        dismiss_count INTEGER DEFAULT 1,
        last_dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (campaign_id, player_licence)
      )
    `);

    // Convocation poules table - stores full poule composition when convocations are sent
    await client.query(`
      CREATE TABLE IF NOT EXISTS convocation_poules (
        id SERIAL PRIMARY KEY,
        tournoi_id INTEGER NOT NULL REFERENCES tournoi_ext(tournoi_id),
        poule_number INTEGER NOT NULL,
        licence VARCHAR(50) NOT NULL,
        player_name VARCHAR(255),
        club VARCHAR(255),
        location_name VARCHAR(255),
        location_address TEXT,
        start_time VARCHAR(10),
        player_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournoi_id, poule_number, licence)
      )
    `);
    // Index for faster lookups by tournament
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_convocation_poules_tournoi ON convocation_poules(tournoi_id)
    `);

    // Convocation files archive table (stores PDF versions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS convocation_files (
        id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES categories(id),
        tournament_num INTEGER NOT NULL,
        season VARCHAR(20) NOT NULL,
        tournoi_ext_id INTEGER REFERENCES tournoi_ext(tournoi_id),
        pdf_data BYTEA NOT NULL,
        filename TEXT NOT NULL,
        file_size INTEGER,
        is_sent BOOLEAN DEFAULT FALSE,
        sent_at TIMESTAMP,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `);

    // Index for efficient history queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_convocation_files_lookup
        ON convocation_files(category_id, tournament_num, season)
    `);

    // Game modes reference table (Modes de jeu)
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_modes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        display_name VARCHAR(50) NOT NULL,
        color VARCHAR(10) DEFAULT '#1F4788',
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FFB rankings reference table (Classements FFB)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ffb_rankings (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        display_name VARCHAR(100) NOT NULL,
        tier VARCHAR(20) NOT NULL,
        level_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // DEPRECATED: poule_configurations table kept for backward compatibility.
    // Poule compositions are now auto-computed by backend/utils/poule-config.js
    await client.query(`
      CREATE TABLE IF NOT EXISTS poule_configurations (
        id SERIAL PRIMARY KEY,
        num_players INTEGER NOT NULL UNIQUE,
        poule_sizes JSONB NOT NULL,
        tables_needed INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Scoring rules table - configurable tournament scoring system
    await client.query(`
      CREATE TABLE IF NOT EXISTS scoring_rules (
        id SERIAL PRIMARY KEY,
        rule_type TEXT NOT NULL,
        condition_key TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        display_order INTEGER DEFAULT 0,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(rule_type, condition_key)
      )
    `);

    // Add structured expression columns to scoring_rules (rule engine) - must be AFTER CREATE TABLE
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS field_1 TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS operator_1 TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS value_1 TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS logical_op TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS field_2 TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS operator_2 TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS value_2 TEXT`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS column_label TEXT`);

    // Backfill existing MOYENNE_BONUS rules with structured expressions
    await client.query(`
      UPDATE scoring_rules SET field_1 = 'MOYENNE', operator_1 = '>', value_1 = 'MOYENNE_MAXI', column_label = 'Bonus Moy.'
      WHERE rule_type = 'MOYENNE_BONUS' AND condition_key = 'ABOVE_MAX' AND field_1 IS NULL
    `);
    await client.query(`
      UPDATE scoring_rules SET field_1 = 'MOYENNE', operator_1 = '>=', value_1 = 'MOYENNE_MINI',
        logical_op = 'AND', field_2 = 'MOYENNE', operator_2 = '<=', value_2 = 'MOYENNE_MAXI', column_label = 'Bonus Moy.'
      WHERE rule_type = 'MOYENNE_BONUS' AND condition_key = 'IN_RANGE' AND field_1 IS NULL
    `);
    await client.query(`
      UPDATE scoring_rules SET field_1 = 'MOYENNE', operator_1 = '<', value_1 = 'MOYENNE_MINI', column_label = 'Bonus Moy.'
      WHERE rule_type = 'MOYENNE_BONUS' AND condition_key = 'BELOW_MIN' AND field_1 IS NULL
    `);

    // Admin activity logs table - tracks admin/viewer actions in Tournament App
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(100) NOT NULL,
        user_role VARCHAR(20),
        action_type VARCHAR(50) NOT NULL,
        action_details TEXT,
        target_type VARCHAR(50),
        target_id VARCHAR(100),
        target_name VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Index for faster queries by date and user
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_activity_logs(created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_logs_user ON admin_activity_logs(user_id)
    `);

    // Player App activity logs table (shared with Player App)
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        licence VARCHAR(50),
        user_email VARCHAR(255),
        user_name VARCHAR(255),
        action_type VARCHAR(50) NOT NULL,
        action_status VARCHAR(20) DEFAULT 'success',
        target_type VARCHAR(50),
        target_id INTEGER,
        target_name VARCHAR(255),
        details JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        app_source VARCHAR(20) DEFAULT 'player_app',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_licence ON activity_logs(licence)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC)`);

    // Test mode log — records every email/push that was blocked by the per-org
    // test mode toggle (organization_settings.email_test_mode_enabled='true').
    // Purpose: during CDB onboarding / validation campaigns, admins can audit
    // "what *would* have been sent" without actually disturbing players.
    // Admin-facing communications are never logged here — only player-bound
    // traffic that was suppressed.
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_test_mode_log (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        channel VARCHAR(20) NOT NULL,             -- 'email' | 'push'
        recipient VARCHAR(255),                   -- email address or licence
        recipient_kind VARCHAR(20) NOT NULL,      -- 'player' (always, for now)
        recipient_name VARCHAR(255),              -- display name when available
        subject TEXT,                             -- email subject / push title
        email_type VARCHAR(50),                   -- convocation | results | relance | ...
        triggered_by_user_id INTEGER,             -- admin who initiated the action
        context JSONB,                            -- {tournoi_id, template_key, ...}
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_test_mode_log_org ON email_test_mode_log(organization_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_test_mode_log_type ON email_test_mode_log(email_type)`);

    // Player invitations table - tracks invitations sent to players to join the Player App
    await client.query(`
      CREATE TABLE IF NOT EXISTS player_invitations (
        id SERIAL PRIMARY KEY,
        player_contact_id INTEGER NOT NULL REFERENCES player_contacts(id),
        licence VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        club VARCHAR(255),
        sent_at TIMESTAMP DEFAULT NOW(),
        sent_by_user_id INTEGER,
        sent_by_username VARCHAR(100),
        has_signed_up BOOLEAN DEFAULT FALSE,
        signed_up_at TIMESTAMP,
        resend_count INTEGER DEFAULT 0,
        last_resent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Create indexes for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_player_invitations_licence ON player_invitations(REPLACE(licence, ' ', ''))
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_player_invitations_email ON player_invitations(email)
    `);

    // Enrollment requests table - players request to enroll in competitions they're not officially registered for
    await client.query(`
      CREATE TABLE IF NOT EXISTS enrollment_requests (
        id SERIAL PRIMARY KEY,
        licence VARCHAR(50) NOT NULL,
        player_name VARCHAR(255),
        player_email VARCHAR(255),
        player_club VARCHAR(255),
        game_mode_id INTEGER NOT NULL REFERENCES game_modes(id),
        game_mode_name VARCHAR(50),
        current_ranking VARCHAR(10),
        requested_ranking VARCHAR(10) NOT NULL,
        tournament_number INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        processed_by VARCHAR(100)
      )
    `);
    // Create indexes for enrollment_requests
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollment_requests_licence ON enrollment_requests(REPLACE(licence, ' ', ''))
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollment_requests_status ON enrollment_requests(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollment_requests_game_mode ON enrollment_requests(game_mode_id)
    `);
    console.log('enrollment_requests table ready');

    // Import profiles table - stores configurable CSV column mappings for each import type
    await client.query(`
      CREATE TABLE IF NOT EXISTS import_profiles (
        id SERIAL PRIMARY KEY,
        import_type VARCHAR(50) NOT NULL UNIQUE,
        delimiter VARCHAR(5) DEFAULT ';',
        has_header BOOLEAN DEFAULT true,
        column_mappings JSONB NOT NULL,
        transformations JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Initialize default import profiles if table is empty
    const importProfilesCount = await client.query('SELECT COUNT(*) as count FROM import_profiles');
    if (importProfilesCount.rows[0].count == 0) {
      // Players default mapping (current FFB format)
      const playersMapping = {
        licence: { column: 0, type: 'string' },
        club: { column: 1, type: 'string' },
        prenom: { column: 2, type: 'string' },
        nom: { column: 3, type: 'string' },
        rank_libre: { column: 4, type: 'string' },
        rank_bande: { column: 5, type: 'string' },
        rank_3bandes: { column: 6, type: 'string' },
        rank_cadre: { column: 8, type: 'string' },
        is_active: { column: 10, type: 'boolean' }
      };
      await client.query(
        `INSERT INTO import_profiles (import_type, delimiter, has_header, column_mappings)
         VALUES ($1, $2, $3, $4)`,
        ['players', ';', true, JSON.stringify(playersMapping)]
      );

      // Tournaments default mapping (current format)
      const tournamentsMapping = {
        classement: { column: 0, type: 'number' },
        licence: { column: 1, type: 'string' },
        joueur: { column: 2, type: 'string' },
        pts_match: { column: 4, type: 'number' },
        moyenne: { column: 6, type: 'decimal' },
        reprises: { column: 8, type: 'number' },
        serie: { column: 9, type: 'number' },
        points: { column: 12, type: 'number' }
      };
      await client.query(
        `INSERT INTO import_profiles (import_type, delimiter, has_header, column_mappings)
         VALUES ($1, $2, $3, $4)`,
        ['tournaments', ';', true, JSON.stringify(tournamentsMapping)]
      );

      // Inscriptions default mapping (named columns - IONOS format)
      const inscriptionsMapping = {
        inscription_id: { column: 'INSCRIPTION_ID', type: 'number' },
        tournoi_id: { column: 'TOURNOI_ID', type: 'number' },
        licence: { column: 'LICENCE', type: 'string' },
        joueur_id: { column: 'JOUEUR_ID', type: 'number' },
        email: { column: 'EMAIL', type: 'string' },
        telephone: { column: 'TELEPHONE', type: 'string' },
        timestamp: { column: 'TIMESTAMP', type: 'string' },
        convoque: { column: 'CONVOQUE', type: 'number' },
        forfait: { column: 'FORFAIT', type: 'number' },
        commentaire: { column: 'COMMENTAIRE', type: 'string' }
      };
      await client.query(
        `INSERT INTO import_profiles (import_type, delimiter, has_header, column_mappings)
         VALUES ($1, $2, $3, $4)`,
        ['inscriptions', ';', true, JSON.stringify(inscriptionsMapping)]
      );

      console.log('Default import profiles initialized');
    }

    // ============= FFB INTEGRATION TABLES =============

    // FFB Ligues — 16 regional leagues
    await client.query(`
      CREATE TABLE IF NOT EXISTS ffb_ligues (
        numero VARCHAR(10) PRIMARY KEY,
        nom TEXT,
        raw_data JSONB,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FFB CDBs — ~88 departmental committees (inferred from clubs/licences)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ffb_cdbs (
        code VARCHAR(10) PRIMARY KEY,
        ligue_numero VARCHAR(10) REFERENCES ffb_ligues(numero),
        nom TEXT,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FFB Clubs — 590 national clubs
    await client.query(`
      CREATE TABLE IF NOT EXISTS ffb_clubs (
        numero VARCHAR(10) PRIMARY KEY,
        ligue_numero VARCHAR(10) REFERENCES ffb_ligues(numero),
        cdb_code VARCHAR(10) REFERENCES ffb_cdbs(code),
        nom TEXT,
        sigle TEXT,
        code_postal VARCHAR(10),
        ville TEXT,
        email TEXT,
        tel TEXT,
        nb_car_310 INTEGER DEFAULT 0,
        nb_car_280 INTEGER DEFAULT 0,
        nb_car_autres INTEGER DEFAULT 0,
        nb_bb INTEGER DEFAULT 0,
        nb_snook INTEGER DEFAULT 0,
        nb_amer INTEGER DEFAULT 0,
        type_salle TEXT,
        access_handicap TEXT,
        raw_data JSONB,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffb_clubs_cdb ON ffb_clubs(cdb_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffb_clubs_ligue ON ffb_clubs(ligue_numero)`);

    // FFB Licences — 20,280 national licences
    await client.query(`
      CREATE TABLE IF NOT EXISTS ffb_licences (
        licence VARCHAR(20) PRIMARY KEY,
        ligue_numero VARCHAR(10),
        cdb_code VARCHAR(10),
        num_club VARCHAR(10) REFERENCES ffb_clubs(numero),
        prenom TEXT,
        nom TEXT,
        date_de_naissance DATE,
        sexe VARCHAR(2),
        categorie VARCHAR(30),
        discipline VARCHAR(30),
        arbitre VARCHAR(20),
        date_licence DATE,
        nationalite TEXT,
        email TEXT,
        raw_data JSONB,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffb_licences_cdb ON ffb_licences(cdb_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffb_licences_club ON ffb_licences(num_club)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffb_licences_nom ON ffb_licences(UPPER(nom), UPPER(prenom))`);

    // Club FFB Mapping — links app clubs to FFB clubs (1:1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS club_ffb_mapping (
        id SERIAL PRIMARY KEY,
        club_id INTEGER REFERENCES clubs(id) UNIQUE,
        ffb_club_numero VARCHAR(10) REFERENCES ffb_clubs(numero) UNIQUE,
        mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        mapped_by TEXT
      )
    `);

    // FFB Import Log — audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS ffb_import_log (
        id SERIAL PRIMARY KEY,
        file_type TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        filename TEXT,
        record_count INTEGER DEFAULT 0,
        new_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        errors JSONB,
        imported_by TEXT,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duration_ms INTEGER
      )
    `);

    // ============= FFB LIGUES ENRICHMENT (logo, contacts) =============
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS logo_data BYTEA`);
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS logo_content_type TEXT`);
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS logo_filename TEXT`);
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS email TEXT`);
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS telephone TEXT`);
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS website TEXT`);
    await client.query(`ALTER TABLE ffb_ligues ADD COLUMN IF NOT EXISTS address TEXT`);

    // ============= MULTI-ORG: ADD organization_id TO DATA TABLES =============

    await client.query(`ALTER TABLE tournoi_ext ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE rankings ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE player_invitations ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE admin_activity_logs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE enrollment_requests ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE organization_logo ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE game_parameters ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE player_contacts ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_player_accounts_org ON player_accounts(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_player_contacts_org ON player_contacts(organization_id)`);

    // Indexes for org-scoped queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tournoi_ext_org ON tournoi_ext(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tournaments_org ON tournaments(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rankings_org ON rankings(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_announcements_org ON announcements(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inscriptions_org ON inscriptions(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_campaigns_org ON email_campaigns(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_emails_org ON scheduled_emails(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_player_invitations_org ON player_invitations(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_categories_org ON categories(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_enrollment_requests_org ON enrollment_requests(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_org ON activity_logs(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scoring_rules_org ON scoring_rules(organization_id)`);

    // ============= PERFORMANCE: composite indexes for hot-path queries =============
    // Audit Phase 4 finding C2 (April 2026). These replace full-table scans on
    // tables that grow with every season. Measured impact on rankings page:
    // 5-15 s → sub-second at current volume; stays fast as CDBs onboard.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rankings_cat_season_org ON rankings(category_id, season, organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inscriptions_tournoi_licence ON inscriptions(tournoi_id, licence)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tournament_results_tournoi_licence ON tournament_results(tournament_id, licence)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_player_org ON push_subscriptions(player_account_id, organization_id)`);
    // Audit Phase 4 finding I16 — email campaigns history sorted by date
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_campaigns_sent ON email_campaigns(sent_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_parameters_org ON game_parameters(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates(organization_id)`);

    // ============= SEED CDBHS AS ORGANIZATION #1 =============

    // Create CDBHS as the first organization (idempotent)
    await client.query(`
      INSERT INTO organizations (id, name, short_name, slug, ffb_cdb_code, ffb_ligue_numero)
      VALUES (1, 'Comité Départemental de Billard des Hauts-de-Seine', 'CDBHS', 'cdbhs', '92', '11')
      ON CONFLICT (id) DO NOTHING
    `);

    // Rename legacy admin to admin92 and ensure super admin (one-time migration)
    await client.query(`UPDATE users SET username = 'admin92' WHERE username = 'admin' AND organization_id = 1`);
    await client.query(`UPDATE users SET is_super_admin = true WHERE username = 'admin92' AND organization_id = 1`);

    // Assign all existing data to org #1 if not yet assigned
    await client.query(`UPDATE users SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE players SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE clubs SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE tournoi_ext SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE tournaments SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE rankings SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE announcements SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE inscriptions SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE email_campaigns SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE scheduled_emails SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE player_invitations SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE admin_activity_logs SET organization_id = 1 WHERE organization_id IS NULL`);

    // CRITICAL FIX (April 2026): Clean up contaminated super admin logs
    // Super admin logs should always have organization_id = NULL (global logs)
    // This fixes the bug where admin92 (super admin) created logs with wrong org_id
    await client.query(`
      UPDATE admin_activity_logs
      SET organization_id = NULL
      WHERE user_id IN (SELECT id FROM users WHERE is_super_admin = true)
    `);
    console.log('[Migration] Cleaned up super admin logs - set organization_id to NULL');

    // CRITICAL FIX (April 2026): Fix contaminated regular user logs
    // Regular users' logs should match their user.organization_id
    // This fixes cases like admin94 (org 6) having logs in org 1
    await client.query(`
      UPDATE admin_activity_logs aal
      SET organization_id = u.organization_id
      FROM users u
      WHERE aal.user_id = u.id
        AND u.is_super_admin = false
        AND aal.organization_id != u.organization_id
    `);
    console.log('[Migration] Fixed contaminated regular user logs - aligned with user org_id');

    // Assign enrollment_requests org from player's org
    await client.query(`
      UPDATE enrollment_requests er
      SET organization_id = p.organization_id
      FROM players p
      WHERE REPLACE(er.licence, ' ', '') = REPLACE(p.licence, ' ', '')
        AND p.organization_id IS NOT NULL
        AND (er.organization_id IS NULL OR er.organization_id != p.organization_id)
    `);
    await client.query(`UPDATE enrollment_requests SET organization_id = 1 WHERE organization_id IS NULL`);
    // Assign activity_logs org from player's org (not blindly to org 1)
    await client.query(`
      UPDATE activity_logs al
      SET organization_id = p.organization_id
      FROM players p
      WHERE REPLACE(al.licence, ' ', '') = REPLACE(p.licence, ' ', '')
        AND p.organization_id IS NOT NULL
        AND (al.organization_id IS NULL OR al.organization_id != p.organization_id)
    `);
    await client.query(`UPDATE organization_logo SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE categories SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE scoring_rules SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE game_parameters SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE email_templates SET organization_id = 1 WHERE organization_id IS NULL`);
    // Backfill player_accounts org from players table (by licence match)
    await client.query(`
      UPDATE player_accounts pa
      SET organization_id = p.organization_id
      FROM players p
      WHERE REPLACE(pa.licence, ' ', '') = REPLACE(p.licence, ' ', '')
        AND p.organization_id IS NOT NULL
        AND (pa.organization_id IS NULL OR pa.organization_id != p.organization_id)
    `);
    await client.query(`UPDATE player_accounts SET organization_id = 1 WHERE organization_id IS NULL`);
    await client.query(`UPDATE player_contacts SET organization_id = 1 WHERE organization_id IS NULL`);

    // Calendar and inscription_email_logs org-scoping
    await client.query(`ALTER TABLE calendar ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_org ON calendar(organization_id)`);
    await client.query(`UPDATE calendar SET organization_id = 1 WHERE organization_id IS NULL`);

    await client.query(`ALTER TABLE inscription_email_logs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inscription_email_logs_org ON inscription_email_logs(organization_id)`);
    await client.query(`UPDATE inscription_email_logs SET organization_id = 1 WHERE organization_id IS NULL`);

    // Update unique constraints to include organization_id (Phase C)
    await client.query(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_game_type_level_key`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS categories_game_type_level_org_key ON categories(game_type, level, organization_id)`);
    await client.query(`ALTER TABLE game_parameters DROP CONSTRAINT IF EXISTS game_parameters_mode_categorie_key`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS game_parameters_mode_categorie_org_key ON game_parameters(mode, categorie, organization_id)`);
    // Try both possible constraint names (auto-generated name varies by DB)
    await client.query(`ALTER TABLE scoring_rules DROP CONSTRAINT IF EXISTS scoring_rules_rule_type_condition_key_key`);
    await client.query(`DROP INDEX IF EXISTS scoring_rules_rule_type_condition_key_key`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS scoring_rules_rule_type_condition_key_org_key ON scoring_rules(rule_type, condition_key, organization_id)`);
    await client.query(`ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_template_key_key`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS email_templates_template_key_org_key ON email_templates(template_key, organization_id)`);

    // ============= PLAYER ACCOUNTS: composite UNIQUE with organization_id =============
    // Original schema (db-postgres.js:936-937) declared licence and email as column-level
    // UNIQUE, which is GLOBAL across all organizations. This prevents a player who is
    // licensed in two CDBs (e.g. CDBHS + CDB9394) from creating an account in each one.
    // We drop those global constraints and replace them with composite UNIQUE indexes
    // keyed on (licence, organization_id) and (LOWER(email), organization_id).
    // organization_id is already backfilled to 1 for all historical CDBHS accounts above.
    await client.query(`ALTER TABLE player_accounts DROP CONSTRAINT IF EXISTS player_accounts_licence_key`);
    await client.query(`ALTER TABLE player_accounts DROP CONSTRAINT IF EXISTS player_accounts_email_key`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_accounts_licence_org ON player_accounts(licence, organization_id)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_accounts_email_org ON player_accounts(LOWER(email), organization_id)`);

    // ============= TOURNAMENT TYPES ORG-SCOPING =============
    // Add organization_id and is_finale columns
    await client.query(`ALTER TABLE tournament_types ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE tournament_types ADD COLUMN IF NOT EXISTS is_finale BOOLEAN DEFAULT FALSE`);
    // Set is_finale for existing FINALE rows
    await client.query(`UPDATE tournament_types SET is_finale = TRUE WHERE UPPER(code) = 'FINALE' AND is_finale = FALSE`);
    // Assign existing rows to org #1
    await client.query(`UPDATE tournament_types SET organization_id = 1 WHERE organization_id IS NULL`);
    // Update unique constraint: tournament_number must be unique per org (not globally)
    await client.query(`ALTER TABLE tournament_types DROP CONSTRAINT IF EXISTS tournament_types_tournament_number_key`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS tournament_types_number_org_key ON tournament_types(tournament_number, organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tournament_types_org ON tournament_types(organization_id)`);
    // Seed default tournament types for all active orgs that don't have any yet
    const ttOrgs = await client.query(`SELECT id FROM organizations WHERE is_active = true`);
    for (const org of ttOrgs.rows) {
      const ttCheck = await client.query(`SELECT COUNT(*) as count FROM tournament_types WHERE organization_id = $1`, [org.id]);
      if (parseInt(ttCheck.rows[0].count) === 0) {
        const ttDefaults = [
          [1, 'T1', 'Tournoi 1', true, false],
          [2, 'T2', 'Tournoi 2', true, false],
          [3, 'T3', 'Tournoi 3', true, false],
          [4, 'FINALE', 'Finale Départementale', false, true]
        ];
        for (const [num, code, name, ranking, finale] of ttDefaults) {
          await client.query(
            `INSERT INTO tournament_types (tournament_number, code, display_name, include_in_ranking, is_finale, organization_id)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [num, code, name, ranking, finale, org.id]
          );
        }
      }
    }

    // Migrate CDB-specific settings from app_settings to organization_settings for org #1
    const orgSettingsKeys = [
      'organization_name', 'organization_short_name',
      'primary_color', 'secondary_color', 'accent_color', 'background_color', 'background_secondary_color',
      'email_communication', 'email_convocations', 'email_noreply', 'email_sender_name', 'summary_email',
      'season_cutoff_month', 'enable_csv_imports', 'privacy_policy', 'header_logo_size'
    ];
    for (const key of orgSettingsKeys) {
      await client.query(`
        INSERT INTO organization_settings (organization_id, key, value)
        SELECT 1, key, value FROM app_settings WHERE key = $1
        ON CONFLICT (organization_id, key) DO NOTHING
      `, [key]);
    }

    // Ensure all orgs have their short_name correctly set in organization_settings
    // Always sync from organizations table (authoritative source)
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      SELECT o.id, 'organization_short_name', o.short_name
      FROM organizations o
      WHERE o.short_name IS NOT NULL
      ON CONFLICT (organization_id, key) DO UPDATE
        SET value = EXCLUDED.value
        WHERE organization_settings.value != EXCLUDED.value
    `);
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      SELECT o.id, 'organization_name', o.name
      FROM organizations o
      WHERE o.name IS NOT NULL
      ON CONFLICT (organization_id, key) DO UPDATE
        SET value = EXCLUDED.value
        WHERE organization_settings.value != EXCLUDED.value
    `);

    // Seed player_app_url for CDBHS (org #1) with explicit ?org=cdbhs slug
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      VALUES (1, 'player_app_url', 'https://cdbhs-player-app-production.up.railway.app/?org=cdbhs')
      ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value
    `);

    // Seed external inscription settings for CDBHS (org #1)
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      VALUES (1, 'external_inscription_enabled', 'true')
      ON CONFLICT (organization_id, key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      VALUES (1, 'external_inscription_url', 'https://cdbhs.net')
      ON CONFLICT (organization_id, key) DO NOTHING
    `);

    // Backfill qualification & scoring defaults for ALL existing orgs (idempotent, DO NOTHING on conflict)
    const qualificationDefaults = [
      ['qualification_mode', 'standard'],
      ['best_of_count', '0'],
      ['journees_count', '3'],
      ['bracket_size', '4'],
      ['average_bonus_tiers', 'false'],
      ['bonus_moyenne_enabled', 'false'],
      ['bonus_moyenne_type', 'normal'],
      ['push_notifications_test_mode', 'false'],
      ['push_test_licences', ''],
    ];
    for (const [key, value] of qualificationDefaults) {
      await client.query(`
        INSERT INTO organization_settings (organization_id, key, value)
        SELECT id, $1, $2 FROM organizations
        ON CONFLICT (organization_id, key) DO NOTHING
      `, [key, value]);
    }

    // Seed default welcome email template for CDB onboarding
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      VALUES (1, 'cdb_welcome_subject', 'Bienvenue sur la Plateforme Gestion des Tournois CDB - {organization_short_name}')
      ON CONFLICT (organization_id, key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO organization_settings (organization_id, key, value)
      VALUES (1, 'cdb_welcome_body', '<p>Bonjour {admin_name},</p><p>Nous avons le plaisir de vous informer que votre espace de gestion des compétitions pour le <strong>{organization_name}</strong> est désormais opérationnel.</p><p><strong>Votre URL de connexion :</strong> <a href="{login_url}">{login_url}</a><br><strong>Votre identifiant :</strong> {username}<br><strong>Votre mot de passe</strong> vous sera communiqué par SMS.</p><p>{player_count} joueurs ont été pré-chargés dans votre base depuis le fichier FFB.</p><p>Lors de votre première connexion, nous vous invitons à :</p><ol><li>Personnaliser les paramètres de votre comité (couleurs, logo, emails)</li><li>Vérifier la liste des joueurs importés</li><li>Configurer vos clubs</li><li>Créer votre premier tournoi</li></ol><p>Pour toute question, n''hésitez pas à nous contacter.</p><p>Cordialement,<br>L''équipe Plateforme Gestion des Tournois CDB</p>')
      ON CONFLICT (organization_id, key) DO NOTHING
    `);

    // ============= SEED CDB DEMO AS ORGANIZATION #2 =============

    // Create CDB Démo (idempotent)
    await client.query(`
      INSERT INTO organizations (id, name, short_name, slug)
      VALUES (2, 'Comité Départemental de Billard - Démonstration', 'CDB Démo', 'demo')
      ON CONFLICT (id) DO NOTHING
    `);

    // Reset organizations sequence to max id (needed after explicit id inserts)
    await client.query(`SELECT setval(pg_get_serial_sequence('organizations', 'id'), COALESCE((SELECT MAX(id) FROM organizations), 1))`);

    // Create demo admin user if not exists
    const demoAdminExists = await client.query(`SELECT id FROM users WHERE username = 'demo'`);
    if (demoAdminExists.rows.length === 0) {
      const bcryptDemo = require('bcrypt');
      const demoHash = await bcryptDemo.hash('demo123', 10);
      await client.query(
        `INSERT INTO users (username, password_hash, email, role, organization_id, is_active)
         VALUES ('demo', $1, 'demo@example.com', 'admin', 2, 1)`,
        [demoHash]
      );
      console.log('Demo admin created successfully');
    }

    // Create demo clubs for org #2 (idempotent)
    const demoCLubs = [
      ['ACADEMIE BILLARD CLICHY', 'Académie Billard Clichy', 'Clichy'],
      ['BILLARD CLUB BOULOGNE', 'Billard Club Boulogne', 'Boulogne-Billancourt'],
      ['CERCLE BILLARD NEUILLY', 'Cercle Billard Neuilly', 'Neuilly-sur-Seine'],
      ['ASSOCIATION BILLARD LEVALLOIS', 'Association Billard Levallois', 'Levallois-Perret'],
      ['BILLARD CLUB COLOMBES', 'Billard Club Colombes', 'Colombes'],
      ['ENTENTE BILLARD NANTERRE', 'Entente Billard Nanterre', 'Nanterre'],
      ['BILLARD CLUB RUEIL', 'Billard Club Rueil', 'Rueil-Malmaison'],
      ['ACADEMIE CARAMBOLE ASNIERES', 'Académie Carambole Asnières', 'Asnières-sur-Seine']
    ];
    for (const [name, displayName, city] of demoCLubs) {
      await client.query(`
        INSERT INTO clubs (name, display_name, city, organization_id)
        SELECT $1, $2, $3, 2 WHERE NOT EXISTS (SELECT 1 FROM clubs WHERE name = $1 AND organization_id = 2)
      `, [name, displayName, city]);
    }

    // Copy categories from org #1 to org #2 (if not already copied)
    const demoCatCount = await client.query(`SELECT COUNT(*) as count FROM categories WHERE organization_id = 2`);
    if (parseInt(demoCatCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO categories (game_type, level, display_name, is_active, organization_id)
        SELECT game_type, level, display_name, is_active, 2
        FROM categories WHERE organization_id = 1
      `);
      console.log('Demo categories copied from CDBHS');
    }

    // Copy game_parameters from org #1 to org #2 (if not already copied)
    const demoParamCount = await client.query(`SELECT COUNT(*) as count FROM game_parameters WHERE organization_id = 2`);
    if (parseInt(demoParamCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO game_parameters (mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi, organization_id)
        SELECT mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi, 2
        FROM game_parameters WHERE organization_id = 1
      `);
      console.log('Demo game parameters copied from CDBHS');
    }

    // Create 80 demo players for org #2 (idempotent - skip if already exist)
    const demoPlayerCount = await client.query(`SELECT COUNT(*) as count FROM players WHERE organization_id = 2 AND licence LIKE 'DEMO%'`);
    if (parseInt(demoPlayerCount.rows[0].count) === 0) {
      const firstNames = ['Jean','Pierre','Michel','Philippe','Alain','Bernard','Jacques','Daniel',
        'Patrick','Serge','Christian','Claude','Marc','Laurent','Stephane','Thierry',
        'Francois','Eric','Pascal','Olivier','Nicolas','David','Christophe','Didier',
        'Bruno','Robert','Gilles','Andre','Gerard','Yves','Paul','Henri',
        'Marie','Isabelle','Catherine','Nathalie','Sophie','Sandrine','Valerie','Christine'];
      const lastNames = ['MARTIN','BERNARD','THOMAS','PETIT','ROBERT','RICHARD','DURAND','DUBOIS',
        'MOREAU','LAURENT','SIMON','MICHEL','LEFEBVRE','LEROY','ROUX','DAVID',
        'BERTRAND','MOREL','FOURNIER','GIRARD','BONNET','DUPONT','LAMBERT','FONTAINE',
        'ROUSSEAU','VINCENT','MULLER','LEFEVRE','FAURE','ANDRE','MERCIER','BLANC'];
      const rankings = ['N2','N3','R1','R2','R3','R4','D1','D2','D3'];
      const clubNames = demoCLubs.map(c => c[0]);
      const usedNames = new Set();

      for (let i = 0; i < 80; i++) {
        let fn, ln;
        do {
          fn = firstNames[Math.floor(Math.random() * firstNames.length)];
          ln = lastNames[Math.floor(Math.random() * lastNames.length)];
        } while (usedNames.has(`${fn} ${ln}`));
        usedNames.add(`${fn} ${ln}`);

        const licence = `DEMO${String(i + 1).padStart(4, '0')}`;
        const club = clubNames[Math.floor(Math.random() * clubNames.length)];
        const rk = () => rankings[Math.floor(Math.random() * rankings.length)];

        await client.query(
          `INSERT INTO players (licence, first_name, last_name, club, rank_libre, rank_cadre, rank_bande, rank_3bandes, email, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 2)`,
          [licence, fn, ln, club, rk(), rk(), rk(), rk(), `${fn.toLowerCase()}.${ln.toLowerCase()}@demo.com`]
        );
      }
      console.log('80 demo players created for CDB Démo');
    }

    // Demo org settings (colors)
    const demoSettings = [
      ['organization_name', 'Comité Départemental de Billard - Démonstration'],
      ['organization_short_name', 'CDB Démo'],
      ['primary_color', '#e65100'],
      ['secondary_color', '#ff9800']
    ];
    for (const [key, value] of demoSettings) {
      await client.query(`
        INSERT INTO organization_settings (organization_id, key, value)
        VALUES (2, $1, $2) ON CONFLICT (organization_id, key) DO NOTHING
      `, [key, value]);
    }

    await client.query('COMMIT');
    console.log('Main schema transaction committed successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database schema (ROLLBACK):', err);
    client.release();
    return; // Stop here — do not run post-commit seeds if schema failed
  }

  // ============= POST-COMMIT OPERATIONS =============
  // These run outside the main transaction so errors here
  // can NEVER trigger a ROLLBACK on committed schema/data.
  try {

    // ============================================================
    // Seasonal Calendar Generator schema (post-commit, isolated)
    // Doc: MECANISME-CALENDRIER-SAISONNIER.html
    // ============================================================
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_brief (
          id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          season TEXT NOT NULL,
          qualif_day TEXT NOT NULL CHECK (qualif_day IN ('saturday','sunday')),
          final_day TEXT NOT NULL CHECK (final_day IN ('saturday','sunday')),
          first_weekend DATE NOT NULL,
          blackout_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
          active_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
          active_hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
          final_attribution TEXT NOT NULL DEFAULT 'manual' CHECK (final_attribution IN ('manual','winner_tbd')),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','published','archived')),
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(organization_id, season)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_constraints (
          id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          rule_type TEXT NOT NULL,
          parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
          strictness TEXT NOT NULL CHECK (strictness IN ('hard','soft')),
          weight INTEGER DEFAULT 1,
          enabled BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_constraints_org ON calendar_constraints(organization_id) WHERE enabled = TRUE`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ligue_final_dates (
          id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          season TEXT NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          final_date DATE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(organization_id, season, category_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ligue_final_dates_lookup ON ligue_final_dates(organization_id, season)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_draft (
          id SERIAL PRIMARY KEY,
          brief_id INTEGER NOT NULL REFERENCES calendar_brief(id) ON DELETE CASCADE,
          weekend_date DATE NOT NULL,
          mode TEXT NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          tournament_type TEXT NOT NULL,
          host_club_id INTEGER REFERENCES clubs(id),
          pts_rep TEXT,
          locked_by_user BOOLEAN DEFAULT FALSE,
          conflict_flags JSONB DEFAULT '[]'::jsonb,
          tournoi_ext_id INTEGER REFERENCES tournoi_ext(tournoi_id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_draft_brief ON calendar_draft(brief_id)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_sync_log (
          id SERIAL PRIMARY KEY,
          brief_id INTEGER NOT NULL REFERENCES calendar_brief(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          draft_id INTEGER,
          tournoi_ext_id INTEGER,
          details JSONB DEFAULT '{}'::jsonb,
          performed_by INTEGER REFERENCES users(id),
          performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_sync_log_brief ON calendar_sync_log(brief_id)`);

      await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS preferred_start_time TEXT`);
      console.log('[Migration] Seasonal Calendar Generator schema ready');
    } catch (calendarErr) {
      console.error('[Migration] Seasonal Calendar Generator schema FAILED (non-fatal):', calendarErr.message);
    }

    // Initialize default admin (legacy)
    const adminResult = await client.query('SELECT COUNT(*) as count FROM admin');
    if (adminResult.rows[0].count == 0) {
      const defaultPassword = 'admin123';
      const hash = await bcrypt.hash(defaultPassword, 12);
      await client.query('INSERT INTO admin (password_hash) VALUES ($1)', [hash]);
      console.log('Default admin password created');
      console.log('Please change it after first login!');
    }

    // Initialize default admin user in users table
    const usersResult = await client.query('SELECT COUNT(*) as count FROM users');
    if (usersResult.rows[0].count == 0) {
      const defaultPassword = 'admin123';
      const hash = await bcrypt.hash(defaultPassword, 12);
      await client.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        ['admin', hash, 'admin']
      );
      console.log('Default admin user created successfully');
      console.log('Please change it after first login!');
    }

    // Initialize categories
    const catResult = await client.query('SELECT COUNT(*) as count FROM categories');
    if (catResult.rows[0].count == 0) {
      const categories = [
        { game_type: 'LIBRE', level: 'N3', display_name: 'LIBRE - NATIONALE 3' },
        { game_type: 'LIBRE', level: 'R1', display_name: 'LIBRE - REGIONALE 1' },
        { game_type: 'LIBRE', level: 'R2', display_name: 'LIBRE - REGIONALE 2' },
        { game_type: 'LIBRE', level: 'R3', display_name: 'LIBRE - REGIONALE 3' },
        { game_type: 'LIBRE', level: 'R4', display_name: 'LIBRE - REGIONALE 4' },
        { game_type: 'CADRE', level: 'N3', display_name: 'CADRE - NATIONALE 3' },
        { game_type: 'CADRE', level: 'R1', display_name: 'CADRE - REGIONALE 1' },
        { game_type: 'BANDE', level: 'N3', display_name: 'BANDE - NATIONALE 3' },
        { game_type: 'BANDE', level: 'R1', display_name: 'BANDE - REGIONALE 1' },
        { game_type: 'BANDE', level: 'R2', display_name: 'BANDE - REGIONALE 2' },
        { game_type: '3BANDES', level: 'N3', display_name: '3 BANDES - NATIONALE 3' },
        { game_type: '3BANDES', level: 'R1', display_name: '3 BANDES - REGIONALE 1' },
        { game_type: '3BANDES', level: 'R2', display_name: '3 BANDES - REGIONALE 2' }
      ];

      for (const cat of categories) {
        await client.query(
          'INSERT INTO categories (game_type, level, display_name, organization_id) VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING',
          [cat.game_type, cat.level, cat.display_name]
        );
      }
      console.log('Categories initialized');
    }

    // Migration: Rename LIBRE N3GC to LIBRE N3 (one-time fix)
    await client.query(`
      UPDATE categories
      SET level = 'N3', display_name = 'LIBRE - NATIONALE 3'
      WHERE game_type = 'LIBRE' AND level = 'N3GC'
    `);
    // Ensure LIBRE N3 exists
    await client.query(`
      INSERT INTO categories (game_type, level, display_name, organization_id)
      VALUES ('LIBRE', 'N3', 'LIBRE - NATIONALE 3', 1)
      ON CONFLICT DO NOTHING
    `);

    // Add is_active and updated_at columns to categories (migration)
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

    // Add rank_column to game_modes to map mode to player rank column
    await client.query(`ALTER TABLE game_modes ADD COLUMN IF NOT EXISTS rank_column VARCHAR(30)`);
    // Update existing game_modes with their rank_column values
    await client.query(`UPDATE game_modes SET rank_column = 'rank_libre' WHERE UPPER(code) LIKE '%LIBRE%' AND rank_column IS NULL`);
    await client.query(`UPDATE game_modes SET rank_column = 'rank_cadre' WHERE UPPER(code) LIKE '%CADRE%' AND rank_column IS NULL`);
    await client.query(`UPDATE game_modes SET rank_column = 'rank_bande' WHERE (UPPER(code) = 'BANDE' OR UPPER(code) = '1BANDE') AND rank_column IS NULL`);
    await client.query(`UPDATE game_modes SET rank_column = 'rank_3bandes' WHERE (UPPER(code) LIKE '%3BANDES%' OR UPPER(code) LIKE '%3 BANDES%') AND rank_column IS NULL`);

    // FIX: Restore BANDE tournaments by specific IDs (from IONOS export)
    // These tournament IDs were incorrectly migrated to 3 BANDES
    await client.query(`
      UPDATE tournoi_ext
      SET mode = 'BANDE'
      WHERE tournoi_id IN (272, 301, 308, 316, 317, 318, 330, 332, 333, 336, 340, 345)
    `);

    // Initialize game_modes reference data
    const gameModeResult = await client.query('SELECT COUNT(*) as count FROM game_modes');
    if (gameModeResult.rows[0].count == 0) {
      const gameModes = [
        { code: 'LIBRE', display_name: 'Libre', color: '#1F4788', display_order: 1, rank_column: 'rank_libre' },
        { code: 'BANDE', display_name: 'Bande', color: '#28a745', display_order: 2, rank_column: 'rank_bande' },
        { code: '3BANDES', display_name: '3 Bandes', color: '#dc3545', display_order: 3, rank_column: 'rank_3bandes' },
        { code: 'CADRE', display_name: 'Cadre', color: '#6f42c1', display_order: 4, rank_column: 'rank_cadre' }
      ];
      for (const mode of gameModes) {
        await client.query(
          'INSERT INTO game_modes (code, display_name, color, display_order, rank_column) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [mode.code, mode.display_name, mode.color, mode.display_order, mode.rank_column]
        );
      }
      console.log('Game modes initialized');
    }

    // Create player_rankings table for dynamic game mode rankings
    // This table replaces the hardcoded rank_libre, rank_cadre, rank_bande, rank_3bandes columns
    await client.query(`
      CREATE TABLE IF NOT EXISTS player_rankings (
        id SERIAL PRIMARY KEY,
        licence TEXT NOT NULL REFERENCES players(licence) ON DELETE CASCADE,
        game_mode_id INTEGER NOT NULL REFERENCES game_modes(id) ON DELETE CASCADE,
        ranking TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(licence, game_mode_id)
      )
    `);

    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_player_rankings_licence ON player_rankings(licence)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_player_rankings_game_mode ON player_rankings(game_mode_id)
    `);

    // Create player_ffb_classifications table for self-entered FFB classification averages
    // Stores one average per player per discipline per season
    await client.query(`
      CREATE TABLE IF NOT EXISTS player_ffb_classifications (
        id SERIAL PRIMARY KEY,
        licence TEXT NOT NULL REFERENCES players(licence) ON DELETE CASCADE,
        game_mode_id INTEGER NOT NULL REFERENCES game_modes(id) ON DELETE CASCADE,
        season TEXT NOT NULL,
        moyenne_ffb REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(licence, game_mode_id, season)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ffb_class_licence ON player_ffb_classifications(licence)
    `);

    // Add classement column to player_ffb_classifications (per-discipline classification level)
    await client.query(`ALTER TABLE player_ffb_classifications ADD COLUMN IF NOT EXISTS classement TEXT DEFAULT NULL`);

    // Backfill classement from player_rankings for existing rows where classement is NULL
    await client.query(`
      UPDATE player_ffb_classifications pfc
      SET classement = pr.ranking
      FROM player_rankings pr
      WHERE REPLACE(pfc.licence, ' ', '') = REPLACE(pr.licence, ' ', '')
        AND pfc.game_mode_id = pr.game_mode_id
        AND pfc.classement IS NULL
        AND pr.ranking IS NOT NULL
        AND pr.ranking != ''
        AND UPPER(pr.ranking) != 'NC'
    `);

    // --- Journées Qualificatives (Phase 1) ---
    // Note: serpentine seeding uses player_ffb_classifications.moyenne_ffb (per discipline/season)

    // New column on tournament_results for position-based season points
    await client.query(`ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS position_points INTEGER DEFAULT 0`);

    // Position-to-points lookup (configurable per org, with player_count dimension)
    await client.query(`
      CREATE TABLE IF NOT EXISTS position_points (
        id SERIAL PRIMARY KEY,
        position INTEGER NOT NULL,
        points INTEGER NOT NULL,
        player_count INTEGER NOT NULL DEFAULT 0,
        organization_id INTEGER REFERENCES organizations(id),
        UNIQUE(player_count, position, organization_id)
      )
    `);

    // Migration: add player_count column if table was created before this change
    await client.query(`ALTER TABLE position_points ADD COLUMN IF NOT EXISTS player_count INTEGER NOT NULL DEFAULT 0`);

    // Migration: update unique constraint to include player_count
    // Drop old constraint if it exists (position, organization_id) and create new one
    try {
      await client.query(`ALTER TABLE position_points DROP CONSTRAINT IF EXISTS position_points_position_organization_id_key`);
    } catch (e) { /* constraint may not exist */ }
    try {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'position_points_unique_pc_pos_org'
          ) THEN
            ALTER TABLE position_points ADD CONSTRAINT position_points_unique_pc_pos_org
              UNIQUE(player_count, position, organization_id);
          END IF;
        END $$;
      `);
    } catch (e) { /* constraint may already exist from CREATE TABLE */ }

    // Bracket match results (SF, F, PF, classification rounds)
    await client.query(`
      CREATE TABLE IF NOT EXISTS bracket_matches (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
        phase TEXT NOT NULL,
        match_order INTEGER NOT NULL,
        match_label TEXT,
        player1_licence TEXT NOT NULL,
        player1_name TEXT,
        player2_licence TEXT,
        player2_name TEXT,
        player1_points INTEGER DEFAULT 0,
        player1_reprises INTEGER DEFAULT 0,
        player2_points INTEGER DEFAULT 0,
        player2_reprises INTEGER DEFAULT 0,
        winner_licence TEXT,
        resulting_place INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bracket_matches_tournament ON bracket_matches(tournament_id)
    `);

    // --- Import CSV Matchs E2i ---

    // Tournament matches table — stores individual match results from E2i CSV imports
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_matches (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        phase_number INTEGER NOT NULL,
        match_date DATE,
        table_name TEXT,
        poule_name TEXT NOT NULL,
        player1_licence TEXT NOT NULL,
        player1_name TEXT,
        player1_points INTEGER DEFAULT 0,
        player1_reprises INTEGER DEFAULT 0,
        player1_serie INTEGER DEFAULT 0,
        player1_match_points INTEGER DEFAULT 0,
        player1_moyenne REAL DEFAULT 0,
        player2_licence TEXT NOT NULL,
        player2_name TEXT,
        player2_points INTEGER DEFAULT 0,
        player2_reprises INTEGER DEFAULT 0,
        player2_serie INTEGER DEFAULT 0,
        player2_match_points INTEGER DEFAULT 0,
        player2_moyenne REAL DEFAULT 0,
        game_mode TEXT,
        organization_id INTEGER REFERENCES organizations(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournament_id)
    `);

    // Split tournament: track which sub-tournament (A/B) a match came from
    await client.query(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS sub_tournament TEXT`);

    // ------------------------------------------------------------------
    // DdJ Step 3 — per-poule match results, captured on tournament day
    // by the Directeur de Jeu. Keyed to tournoi_ext (external tournament
    // definition) rather than tournaments (internal post-import) because
    // the DdJ operates BEFORE results land in the admin app — the E2i
    // export generated from this table is what populates tournaments/
    // tournament_results downstream.
    //
    // Full-score capture (per the v1 proposition): points, reprises,
    // meilleure série. This gives the FFB auto-tiebreak rule
    // (moyenne first, then best serie) instead of requiring DdJ manual
    // arbitration, and produces a complete E2i file at step 6.
    //
    // NULL score columns = match scheduled but not yet played. The
    // outcome (p1_win / p2_win / draw) is DERIVED from the points,
    // not stored, so there's no way for a saved match to have
    // inconsistent state.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS ddj_poule_matches (
        id SERIAL PRIMARY KEY,
        tournoi_id INTEGER NOT NULL REFERENCES tournoi_ext(tournoi_id) ON DELETE CASCADE,
        poule_number INTEGER NOT NULL,
        match_number INTEGER NOT NULL,
        table_number INTEGER,
        p1_licence TEXT NOT NULL,
        p2_licence TEXT NOT NULL,
        p1_points INTEGER,
        p1_reprises INTEGER,
        p1_serie INTEGER,
        p2_points INTEGER,
        p2_reprises INTEGER,
        p2_serie INTEGER,
        entered_at TIMESTAMP,
        entered_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournoi_id, poule_number, match_number)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ddj_poule_matches_tournoi ON ddj_poule_matches(tournoi_id)`);

    // ------------------------------------------------------------------
    // DdJ Step 4 — bracket (phase finale) match results.
    //
    // Qualifiers and the bracket structure (who meets whom) are DERIVED
    // at read-time from the poule classements — no snapshot in this
    // table. Only the match scores live here. That way, if the DdJ goes
    // back and re-saves a poule match, the bracket recomputes naturally.
    //
    // phase values: 'SF1', 'SF2', 'F', 'PF'
    //   SF1  = seed 1 vs seed 4
    //   SF2  = seed 2 vs seed 3
    //   F    = finale (SF winners) → 1st / 2nd
    //   PF   = petite finale (SF losers) → 3rd / 4th
    //
    // bracket_size=4 only for MVP. When we support larger brackets
    // (QF included), we'll add more phases here.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS ddj_bracket_matches (
        id SERIAL PRIMARY KEY,
        tournoi_id INTEGER NOT NULL REFERENCES tournoi_ext(tournoi_id) ON DELETE CASCADE,
        phase VARCHAR(10) NOT NULL,
        table_number INTEGER,
        p1_licence TEXT NOT NULL,
        p2_licence TEXT NOT NULL,
        p1_points INTEGER,
        p1_reprises INTEGER,
        p1_serie INTEGER,
        p2_points INTEGER,
        p2_reprises INTEGER,
        p2_serie INTEGER,
        entered_at TIMESTAMP,
        entered_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournoi_id, phase)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ddj_bracket_matches_tournoi ON ddj_bracket_matches(tournoi_id)`);

    // ------------------------------------------------------------------
    // ddj_consolante_matches — Step 5 of the DdJ workflow
    // Stores match scores for the "Matchs de classement (Consolante)"
    // single-elimination bracket played by non-qualifiers to determine
    // overall places 5 to N. Structure mirrors ddj_bracket_matches.
    // Phase values: F, SF1, SF2, QF1..QF4, R16_1..R16_8
    // Bracket size is dynamic (2, 4, 8, or 16) based on non-qualifier count.
    // No petite finale in the consolante — SF/QF/R16 losers are ex-aequo,
    // departed by poule criteria (match points, moyenne).
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS ddj_consolante_matches (
        id SERIAL PRIMARY KEY,
        tournoi_id INTEGER NOT NULL REFERENCES tournoi_ext(tournoi_id) ON DELETE CASCADE,
        phase VARCHAR(10) NOT NULL,
        table_number INTEGER,
        p1_licence TEXT NOT NULL,
        p2_licence TEXT NOT NULL,
        p1_points INTEGER,
        p1_reprises INTEGER,
        p1_serie INTEGER,
        p2_points INTEGER,
        p2_reprises INTEGER,
        p2_serie INTEGER,
        entered_at TIMESTAMP,
        entered_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournoi_id, phase)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ddj_consolante_matches_tournoi ON ddj_consolante_matches(tournoi_id)`);

    // New columns on tournament_results for match-based imports
    await client.query(`ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS meilleure_partie REAL`);
    await client.query(`ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS poule_rank INTEGER`);
    await client.query(`ALTER TABLE tournament_results ADD COLUMN IF NOT EXISTS parties_menees INTEGER`);

    // Stage-level scoring configuration (which scoring mechanisms apply at each competition stage)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stage_scoring_config (
        id SERIAL PRIMARY KEY,
        stage_code TEXT NOT NULL,
        match_points INTEGER DEFAULT 0,
        average_bonus INTEGER DEFAULT 0,
        level_bonus INTEGER DEFAULT 0,
        participation_bonus INTEGER DEFAULT 0,
        ranking_points BOOLEAN DEFAULT FALSE,
        organization_id INTEGER REFERENCES organizations(id),
        UNIQUE(stage_code, organization_id)
      )
    `);

    // Per-player scoring detail per competition stage (manual bonus entry)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stage_player_scores (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        licence TEXT NOT NULL,
        stage_code TEXT NOT NULL,
        match_points INTEGER DEFAULT 0,
        average_bonus INTEGER DEFAULT 0,
        level_bonus INTEGER DEFAULT 0,
        participation_bonus INTEGER DEFAULT 0,
        UNIQUE(tournament_id, licence, stage_code)
      )
    `);

    // Add scoring validation columns to tournaments (migration)
    await client.query(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS scoring_validated BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS scoring_validated_at TIMESTAMP`);

    // Migrate existing player rankings from hardcoded columns to player_rankings table
    // This runs only once - checks if player_rankings is empty and players have rank data
    const playerRankingsCount = await client.query('SELECT COUNT(*) as count FROM player_rankings');
    if (playerRankingsCount.rows[0].count == 0) {
      console.log('Migrating player rankings to player_rankings table...');

      // Get all game modes with their rank_column mapping
      const gameModesForMigration = await client.query(
        'SELECT id, code, rank_column FROM game_modes WHERE rank_column IS NOT NULL'
      );

      // For each game mode, insert rankings from the old column
      for (const mode of gameModesForMigration.rows) {
        const rankColumn = mode.rank_column;

        // Insert rankings for all players who have a value in this rank column
        await client.query(`
          INSERT INTO player_rankings (licence, game_mode_id, ranking)
          SELECT licence, $1, ${rankColumn}
          FROM players
          WHERE ${rankColumn} IS NOT NULL AND ${rankColumn} != ''
          ON CONFLICT (licence, game_mode_id) DO NOTHING
        `, [mode.id]);

        const insertedCount = await client.query(`
          SELECT COUNT(*) as count FROM player_rankings WHERE game_mode_id = $1
        `, [mode.id]);

        console.log(`  - ${mode.code}: migrated ${insertedCount.rows[0].count} rankings from ${rankColumn}`);
      }

      console.log('Player rankings migration completed');
    }

    // Initialize ffb_rankings reference data
    const rankingResult = await client.query('SELECT COUNT(*) as count FROM ffb_rankings');
    if (rankingResult.rows[0].count == 0) {
      const rankings = [
        // National
        { code: 'N1', display_name: 'Nationale 1', tier: 'NATIONAL', level_order: 1 },
        { code: 'N2', display_name: 'Nationale 2', tier: 'NATIONAL', level_order: 2 },
        { code: 'N3', display_name: 'Nationale 3', tier: 'NATIONAL', level_order: 3 },
        // Regional
        { code: 'R1', display_name: 'Régionale 1', tier: 'REGIONAL', level_order: 4 },
        { code: 'R2', display_name: 'Régionale 2', tier: 'REGIONAL', level_order: 5 },
        { code: 'R3', display_name: 'Régionale 3', tier: 'REGIONAL', level_order: 6 },
        { code: 'R4', display_name: 'Régionale 4', tier: 'REGIONAL', level_order: 7 },
        // Departemental
        { code: 'D1', display_name: 'Départementale 1', tier: 'DEPARTEMENTAL', level_order: 8 },
        { code: 'D2', display_name: 'Départementale 2', tier: 'DEPARTEMENTAL', level_order: 9 },
        { code: 'D3', display_name: 'Départementale 3', tier: 'DEPARTEMENTAL', level_order: 10 },
        { code: 'D4', display_name: 'Départementale 4', tier: 'DEPARTEMENTAL', level_order: 11 },
        // Non classé
        { code: 'NC', display_name: 'Non Classé', tier: 'NON CLASSE', level_order: 99 }
      ];
      for (const rank of rankings) {
        await client.query(
          'INSERT INTO ffb_rankings (code, display_name, tier, level_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [rank.code, rank.display_name, rank.tier, rank.level_order]
        );
      }
      console.log('FFB rankings initialized');
    }

    // Seed default poule configurations (3-20 players)
    const pouleConfigs = [
      { num_players: 3,  poule_sizes: [3],             tables_needed: 1 },
      { num_players: 4,  poule_sizes: [4],             tables_needed: 2 },
      { num_players: 5,  poule_sizes: [5],             tables_needed: 2 },
      { num_players: 6,  poule_sizes: [3, 3],          tables_needed: 2 },
      { num_players: 7,  poule_sizes: [3, 4],          tables_needed: 3 },
      { num_players: 8,  poule_sizes: [3, 5],          tables_needed: 3 },
      { num_players: 9,  poule_sizes: [3, 3, 3],       tables_needed: 3 },
      { num_players: 10, poule_sizes: [3, 3, 4],       tables_needed: 4 },
      { num_players: 11, poule_sizes: [3, 3, 5],       tables_needed: 4 },
      { num_players: 12, poule_sizes: [3, 3, 3, 3],    tables_needed: 4 },
      { num_players: 13, poule_sizes: [3, 3, 3, 4],    tables_needed: 5 },
      { num_players: 14, poule_sizes: [3, 3, 3, 5],    tables_needed: 5 },
      { num_players: 15, poule_sizes: [3, 3, 3, 3, 3], tables_needed: 5 },
      { num_players: 16, poule_sizes: [3, 3, 3, 3, 4], tables_needed: 6 },
      { num_players: 17, poule_sizes: [3, 3, 3, 3, 5], tables_needed: 6 },
      { num_players: 18, poule_sizes: [3, 3, 3, 3, 3, 3], tables_needed: 6 },
      { num_players: 19, poule_sizes: [3, 3, 3, 3, 3, 4], tables_needed: 7 },
      { num_players: 20, poule_sizes: [3, 3, 3, 3, 3, 5], tables_needed: 7 }
    ];
    for (const config of pouleConfigs) {
      await client.query(
        'INSERT INTO poule_configurations (num_players, poule_sizes, tables_needed) VALUES ($1, $2, $3) ON CONFLICT (num_players) DO NOTHING',
        [config.num_players, JSON.stringify(config.poule_sizes), config.tables_needed]
      );
    }
    console.log('Poule configurations initialized');

    // Seed default scoring rules
    const scoringRules = [
      // Base V/D/L scoring (display-only, no structured expression - field_1 is null)
      { rule_type: 'BASE_VDL', condition_key: 'VICTORY', points: 2, display_order: 1, description: 'Victoire',
        field_1: null, operator_1: null, value_1: null, logical_op: null, field_2: null, operator_2: null, value_2: null, column_label: null },
      { rule_type: 'BASE_VDL', condition_key: 'DRAW', points: 1, display_order: 2, description: 'Match nul',
        field_1: null, operator_1: null, value_1: null, logical_op: null, field_2: null, operator_2: null, value_2: null, column_label: null },
      { rule_type: 'BASE_VDL', condition_key: 'LOSS', points: 0, display_order: 3, description: 'Défaite',
        field_1: null, operator_1: null, value_1: null, logical_op: null, field_2: null, operator_2: null, value_2: null, column_label: null },
      // Moyenne bonus (evaluatable structured rules)
      { rule_type: 'MOYENNE_BONUS', condition_key: 'ABOVE_MAX', points: 0, display_order: 1,
        description: 'Moyenne supérieure au maximum de la catégorie',
        field_1: 'MOYENNE', operator_1: '>', value_1: 'MOYENNE_MAXI',
        logical_op: null, field_2: null, operator_2: null, value_2: null, column_label: 'Bonus Moy.' },
      { rule_type: 'MOYENNE_BONUS', condition_key: 'IN_RANGE', points: 0, display_order: 2,
        description: 'Moyenne dans la fourchette de la catégorie',
        field_1: 'MOYENNE', operator_1: '>=', value_1: 'MOYENNE_MINI',
        logical_op: 'AND', field_2: 'MOYENNE', operator_2: '<=', value_2: 'MOYENNE_MAXI', column_label: 'Bonus Moy.' },
      { rule_type: 'MOYENNE_BONUS', condition_key: 'BELOW_MIN', points: 0, display_order: 3,
        description: 'Moyenne inférieure au minimum de la catégorie',
        field_1: 'MOYENNE', operator_1: '<', value_1: 'MOYENNE_MINI',
        logical_op: null, field_2: null, operator_2: null, value_2: null, column_label: 'Bonus Moy.' }
    ];
    for (const rule of scoringRules) {
      await client.query(
        `INSERT INTO scoring_rules (rule_type, condition_key, points, display_order, description,
          field_1, operator_1, value_1, logical_op, field_2, operator_2, value_2, column_label, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
         ON CONFLICT (rule_type, condition_key, organization_id) DO NOTHING`,
        [rule.rule_type, rule.condition_key, rule.points, rule.display_order, rule.description,
         rule.field_1, rule.operator_1, rule.value_1, rule.logical_op, rule.field_2, rule.operator_2, rule.value_2, rule.column_label]
      );
    }
    console.log('Scoring rules initialized');

    // Initialize mode mappings (IONOS mode names -> internal game_type)
    const modeMappings = [
      // LIBRE variations
      { ionos_mode: 'Libre', game_type: 'LIBRE' },
      { ionos_mode: 'LIBRE', game_type: 'LIBRE' },
      { ionos_mode: 'libre', game_type: 'LIBRE' },
      // CADRE variations
      { ionos_mode: 'Cadre', game_type: 'CADRE' },
      { ionos_mode: 'CADRE', game_type: 'CADRE' },
      { ionos_mode: 'cadre', game_type: 'CADRE' },
      // BANDE variations (1 bande)
      { ionos_mode: 'Bande', game_type: 'BANDE' },
      { ionos_mode: 'BANDE', game_type: 'BANDE' },
      { ionos_mode: 'bande', game_type: 'BANDE' },
      { ionos_mode: '1 Bande', game_type: 'BANDE' },
      { ionos_mode: '1 BANDE', game_type: 'BANDE' },
      { ionos_mode: '1 bande', game_type: 'BANDE' },
      { ionos_mode: '1Bande', game_type: 'BANDE' },
      { ionos_mode: '1BANDE', game_type: 'BANDE' },
      // 3 BANDES variations
      { ionos_mode: '3 Bandes', game_type: '3BANDES' },
      { ionos_mode: '3 BANDES', game_type: '3BANDES' },
      { ionos_mode: '3 bandes', game_type: '3BANDES' },
      { ionos_mode: '3Bandes', game_type: '3BANDES' },
      { ionos_mode: '3BANDES', game_type: '3BANDES' },
      { ionos_mode: '3bandes', game_type: '3BANDES' }
    ];

    for (const mapping of modeMappings) {
      await client.query(
        'INSERT INTO mode_mapping (ionos_mode, game_type) VALUES ($1, $2) ON CONFLICT (ionos_mode) DO NOTHING',
        [mapping.ionos_mode, mapping.game_type]
      );
    }
    console.log('Mode mappings initialized');

    // Initialize category mappings
    // First, get all existing categories
    const categoriesResult = await client.query('SELECT id, game_type, level FROM categories');
    const categories = categoriesResult.rows;

    // Define IONOS category variations for each internal level
    // Note: N3GC, N3 GC etc. are variations that should map to N3 (not separate categories)
    const categoryVariations = {
      // National levels - N3 includes all GC variations for LIBRE
      'N1': ['N1', 'N 1', 'n1', 'NATIONALE 1', 'Nationale 1'],
      'N2': ['N2', 'N 2', 'n2', 'NATIONALE 2', 'Nationale 2'],
      'N3': ['N3', 'N 3', 'n3', 'NATIONALE 3', 'Nationale 3', 'N3GC', 'N3 GC', 'N 3 GC', 'N3-GC', 'NATIONALE 3 GC', 'n3gc', 'N3 gc'],
      // Regional levels
      'R1': ['R1', 'R 1', 'r1', 'REGIONALE 1', 'Regionale 1', 'Régionale 1'],
      'R2': ['R2', 'R 2', 'r2', 'REGIONALE 2', 'Regionale 2', 'Régionale 2'],
      'R3': ['R3', 'R 3', 'r3', 'REGIONALE 3', 'Regionale 3', 'Régionale 3'],
      'R4': ['R4', 'R 4', 'r4', 'REGIONALE 4', 'Regionale 4', 'Régionale 4'],
      // Departmental levels
      'D1': ['D1', 'D 1', 'd1', 'DEPARTEMENTALE 1', 'Departementale 1', 'Départementale 1'],
      'D2': ['D2', 'D 2', 'd2', 'DEPARTEMENTALE 2', 'Departementale 2', 'Départementale 2'],
      'D3': ['D3', 'D 3', 'd3', 'DEPARTEMENTALE 3', 'Departementale 3', 'Départementale 3']
    };

    for (const category of categories) {
      const baseLevel = category.level.toUpperCase().replace(/\s+/g, ' ').trim();
      const variations = categoryVariations[baseLevel] || [baseLevel];

      for (const variation of variations) {
        await client.query(
          `INSERT INTO category_mapping (ionos_categorie, game_type, category_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (ionos_categorie, game_type) DO UPDATE SET category_id = $3`,
          [variation, category.game_type, category.id]
        );
      }
    }

    // Fix: Ensure ALL N3 variations (including N3GC) map to LIBRE N3
    const libreN3 = categories.find(c => c.game_type === 'LIBRE' && c.level === 'N3');
    if (libreN3) {
      const allN3Variations = ['N3', 'N 3', 'n3', 'NATIONALE 3', 'Nationale 3', 'N3GC', 'N3 GC', 'N 3 GC', 'N3-GC', 'NATIONALE 3 GC', 'n3gc', 'N3 gc'];
      for (const variation of allN3Variations) {
        await client.query(
          `INSERT INTO category_mapping (ionos_categorie, game_type, category_id)
           VALUES ($1, 'LIBRE', $2)
           ON CONFLICT (ionos_categorie, game_type) DO UPDATE SET category_id = $2`,
          [variation, libreN3.id]
        );
      }
      console.log('LIBRE N3 mappings updated - all N3/N3GC variations now map to LIBRE N3');
    }
    console.log('Category mappings initialized');

    // Initialize game parameters (if empty)
    const gameParamsResult = await client.query('SELECT COUNT(*) as count FROM game_parameters');
    if (gameParamsResult.rows[0].count == 0) {
      const gameParams = [
        // LIBRE
        { mode: 'LIBRE', categorie: 'N3', coin: 'GC', distance_normale: 150, distance_reduite: null, reprises: 25, moyenne_mini: 6.000, moyenne_maxi: 8.990 },
        { mode: 'LIBRE', categorie: 'R1', coin: 'PC', distance_normale: 120, distance_reduite: null, reprises: 30, moyenne_mini: 4.000, moyenne_maxi: 5.990 },
        { mode: 'LIBRE', categorie: 'R2', coin: 'PC', distance_normale: 80, distance_reduite: null, reprises: 30, moyenne_mini: 2.300, moyenne_maxi: 3.990 },
        { mode: 'LIBRE', categorie: 'R3', coin: 'PC', distance_normale: 60, distance_reduite: null, reprises: 30, moyenne_mini: 1.200, moyenne_maxi: 2.290 },
        { mode: 'LIBRE', categorie: 'R4', coin: 'PC', distance_normale: 40, distance_reduite: null, reprises: 40, moyenne_mini: 0.000, moyenne_maxi: 1.200 },
        // CADRE
        { mode: 'CADRE', categorie: 'N3', coin: 'PC', distance_normale: 120, distance_reduite: null, reprises: 25, moyenne_mini: 4.500, moyenne_maxi: 7.490 },
        { mode: 'CADRE', categorie: 'R1', coin: 'PC', distance_normale: 80, distance_reduite: null, reprises: 25, moyenne_mini: 0.000, moyenne_maxi: 4.490 },
        // BANDE
        { mode: 'BANDE', categorie: 'N3', coin: 'PC', distance_normale: 60, distance_reduite: null, reprises: 30, moyenne_mini: 1.800, moyenne_maxi: 2.570 },
        { mode: 'BANDE', categorie: 'R1', coin: 'PC', distance_normale: 50, distance_reduite: null, reprises: 30, moyenne_mini: 1.100, moyenne_maxi: 1.790 },
        { mode: 'BANDE', categorie: 'R2', coin: 'PC', distance_normale: 30, distance_reduite: null, reprises: 30, moyenne_mini: 0.000, moyenne_maxi: 1.090 },
        // 3 BANDES
        { mode: '3BANDES', categorie: 'N3', coin: 'PC', distance_normale: 25, distance_reduite: 20, reprises: 60, moyenne_mini: 0.400, moyenne_maxi: 0.580 },
        { mode: '3BANDES', categorie: 'R1', coin: 'PC', distance_normale: 20, distance_reduite: 15, reprises: 60, moyenne_mini: 0.250, moyenne_maxi: 0.399 },
        { mode: '3BANDES', categorie: 'R2', coin: 'PC', distance_normale: 15, distance_reduite: null, reprises: 60, moyenne_mini: 0.000, moyenne_maxi: 0.250 }
      ];

      for (const param of gameParams) {
        await client.query(
          `INSERT INTO game_parameters (mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1) ON CONFLICT (mode, categorie, organization_id) DO NOTHING`,
          [param.mode, param.categorie, param.coin, param.distance_normale, param.distance_reduite, param.reprises, param.moyenne_mini, param.moyenne_maxi]
        );
      }
      console.log('Game parameters initialized');
    }

    // Initialize default email templates
    const emailTemplateResult = await client.query('SELECT COUNT(*) as count FROM email_templates');
    if (emailTemplateResult.rows[0].count == 0) {
      const defaultBodyTemplate = `Bonjour {player_name},

Le CDBHS a le plaisir de vous convier au tournoi suivant.

Veuillez trouver en attachement votre convocation detaillee avec la composition de toutes les poules du tournoi.

En cas d'empechement, merci d'informer des que possible l'equipe en charge du sportif a l'adresse ci-dessous.

Vous aurez noté un changement significatif quant au processus d'invitation et sommes a votre ecoute si vous avez des remarques ou des suggestions.

Nous vous souhaitons une excellente competition.

Cordialement,
Comite Departemental Billard Hauts-de-Seine`;

      await client.query(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
         VALUES ($1, $2, $3, 1) ON CONFLICT (template_key, organization_id) DO NOTHING`,
        ['convocation', 'Convocation {category} - {tournament} - {date}', defaultBodyTemplate]
      );

      // General email template
      const generalBodyTemplate = `Bonjour {player_name},

{message}

Cordialement,
Comite Departemental Billard Hauts-de-Seine`;

      await client.query(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
         VALUES ($1, $2, $3, 1) ON CONFLICT (template_key, organization_id) DO NOTHING`,
        ['general', 'Information CDBHS', generalBodyTemplate]
      );

      // Information template
      const infoBodyTemplate = `Bonjour {player_name},

Nous souhaitons vous informer de la nouvelle suivante:

{message}

Pour toute question, n'hesitez pas a nous contacter.

Cordialement,
Comite Departemental Billard Hauts-de-Seine`;

      await client.query(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
         VALUES ($1, $2, $3, 1) ON CONFLICT (template_key, organization_id) DO NOTHING`,
        ['information', 'Information importante - CDBHS', infoBodyTemplate]
      );

      // Reminder template
      const rappelBodyTemplate = `Bonjour {player_name},

Ceci est un rappel concernant:

{message}

Merci de votre attention.

Cordialement,
Comite Departemental Billard Hauts-de-Seine`;

      await client.query(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
         VALUES ($1, $2, $3, 1) ON CONFLICT (template_key, organization_id) DO NOTHING`,
        ['rappel', 'Rappel - CDBHS', rappelBodyTemplate]
      );

      // Results template (for tournament results email)
      const resultsBodyTemplate = `Bonjour {player_name},

Veuillez trouver ci-joint les résultats du tournoi {tournament}.

{message}

Cordialement,
Comité Départemental Billard Hauts-de-Seine`;

      await client.query(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
         VALUES ($1, $2, $3, 1) ON CONFLICT (template_key, organization_id) DO NOTHING`,
        ['results', 'Résultats {category} - {tournament}', resultsBodyTemplate]
      );

      // CC Email setting template (stores the default CC email address)
      await client.query(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
         VALUES ($1, $2, $3, 1) ON CONFLICT (template_key, organization_id) DO NOTHING`,
        ['results_cc_email', 'cdbhs92@gmail.com', '']
      );

      console.log('Default email templates initialized');
    }

    // Ensure results and cc_email templates exist (added later, need to be inserted separately)
    await client.query(
      `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
       VALUES ('results', 'Résultats {category} - {tournament}', 'Bonjour {player_name},\n\nVeuillez trouver ci-joint les résultats du tournoi {tournament}.\n\n{message}\n\nCordialement,\nComité Départemental Billard Hauts-de-Seine', 1)
       ON CONFLICT (template_key, organization_id) DO NOTHING`
    );
    await client.query(
      `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
       VALUES ('results_cc_email', 'cdbhs92@gmail.com', '', 1)
       ON CONFLICT (template_key, organization_id) DO NOTHING`
    );

    // Club reminder template
    const clubReminderBody = `Bonjour,

Votre club {club_name} accueille prochainement une compétition du CDBHS.

DÉTAILS DE LA COMPÉTITION:
- Compétition: {category} - {tournament}
- Date: {date}
- Horaire: {time}
- Participants: {num_players} joueur(s)
- Tables nécessaires: {num_tables} table(s)

RAPPELS IMPORTANTS:
- Maître de jeu: Merci de prévoir la présence d'un maître de jeu pour encadrer la compétition
- Arbitrage: Si vous avez des arbitres disponibles, merci de nous le signaler. Sinon, l'autoarbitrage sera mis en place
- Résultats FFB: Les résultats devront être saisis sur le site de la FFB à l'issue de la compétition
- Rafraîchissements: Merci de prévoir des rafraîchissements pour les joueurs

Pour toute question, contactez-nous à l'adresse: cdbhs92@gmail.com

Sportivement,
Le CDBHS`;
    await client.query(
      `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
       VALUES ('club_reminder', 'Rappel Organisation - {category} {tournament}', $1, 1)
       ON CONFLICT (template_key, organization_id) DO NOTHING`,
      [clubReminderBody]
    );

    // Inscription confirmation template (sent by Player App)
    const inscriptionConfirmationBody = `Bonjour {player_name},

Votre inscription a bien été enregistrée pour la compétition suivante :

Compétition : {tournament_name}
Mode : {mode} - {category}
Date : {tournament_date}
Lieu : {location}

Vous recevrez une convocation avec les détails (horaires, poules) quelques jours avant la compétition.

En cas d'empêchement, merci de vous désinscrire via l'application ou de nous prévenir par email.

Sportivement,
{organization_name}`;
    await client.query(
      `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
       VALUES ('inscription_confirmation', 'Confirmation d''inscription - {tournament_name}', $1, 1)
       ON CONFLICT (template_key, organization_id) DO NOTHING`,
      [inscriptionConfirmationBody]
    );

    // Inscription cancellation template (sent by Player App)
    const inscriptionCancellationBody = `Bonjour {player_name},

Nous avons bien pris en compte votre désinscription du tournoi suivant :

Tournoi : {tournament_name}
Mode : {mode}
Catégorie : {category}
Date : {tournament_date}
Lieu : {location}

Si cette désinscription est une erreur, veuillez contacter le comité via "Contact" ou par email à {organization_email}.

Sportivement,
{organization_name}`;
    await client.query(
      `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id)
       VALUES ('inscription_cancellation', 'Confirmation de désinscription - {mode} {category}', $1, 1)
       ON CONFLICT (template_key, organization_id) DO NOTHING`,
      [inscriptionCancellationBody]
    );

    // Initialize default clubs (5 clubs in CDBHS)
    const clubResult = await client.query('SELECT COUNT(*) as count FROM clubs');
    if (clubResult.rows[0].count == 0) {
      const defaultClubs = [
        { name: 'A DE BILLARD COURBEVOIE LA DEFENSE', display_name: 'A DE BILLARD COURBEVOIE LA DEFENSE', logo_filename: 'cdbhs/A_DE_BILLARD_COURBEVOIE_LA_DEFENSE.png' },
        { name: 'BILLARD BOIS COLOMBES', display_name: 'BILLARD BOIS COLOMBES', logo_filename: 'cdbhs/BILLARD_BOIS_COLOMBES.png' },
        { name: 'BILLARD CLUB CLICHOIS', display_name: 'BILLARD CLUB CLICHOIS', logo_filename: 'cdbhs/BILLARD_CLUB_CLICHOIS.png' },
        { name: 'BILLARD CLUB LA GARENNE CLAMART', display_name: 'BILLARD CLUB LA GARENNE CLAMART', logo_filename: 'cdbhs/BILLARD_CLUB_LA_GARENNE_CLAMART.png' },
        { name: 'S C M C BILLARD CLUB', display_name: 'S C M C BILLARD CLUB', logo_filename: 'cdbhs/S_C_M_C_BILLARD_CLUB.png' }
      ];

      for (const club of defaultClubs) {
        await client.query(
          'INSERT INTO clubs (name, display_name, logo_filename) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [club.name, club.display_name, club.logo_filename]
        );
      }
      console.log('Default clubs initialized');
    }

    // Initialize default club aliases for all 5 clubs (handles common spelling variations from IONOS/FFB)
    const defaultAliases = [
      // 1. A DE BILLARD COURBEVOIE LA DEFENSE variations
      { alias: 'A DE BILLARD COURBEVOIE LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'A. DE BILLARD COURBEVOIE LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'A. DE BILLARD COURBEVOIE-LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'A DE BILLARD COURBEVOIE-LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'A.DE BILLARD COURBEVOIE LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'A.DE BILLARD COURBEVOIE-LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'COURBEVOIE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },
      { alias: 'COURBEVOIE LA DEFENSE', canonical: 'A DE BILLARD COURBEVOIE LA DEFENSE' },

      // 2. BILLARD BOIS COLOMBES variations
      { alias: 'BILLARD BOIS COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'BILLARD BOIS-COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'BOIS COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'BOIS-COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'BC BOIS COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'BC BOIS-COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'L.B.I.E. BOIS COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },
      { alias: 'LBIE BOIS COLOMBES', canonical: 'BILLARD BOIS COLOMBES' },

      // 3. BILLARD CLUB CLICHOIS variations
      { alias: 'BILLARD CLUB CLICHOIS', canonical: 'BILLARD CLUB CLICHOIS' },
      { alias: 'BC CLICHOIS', canonical: 'BILLARD CLUB CLICHOIS' },
      { alias: 'CLICHOIS', canonical: 'BILLARD CLUB CLICHOIS' },
      { alias: 'CLICHY', canonical: 'BILLARD CLUB CLICHOIS' },
      { alias: 'BILLARD CLICHY', canonical: 'BILLARD CLUB CLICHOIS' },
      { alias: 'B.C. CLICHOIS', canonical: 'BILLARD CLUB CLICHOIS' },
      { alias: 'BCC', canonical: 'BILLARD CLUB CLICHOIS' },

      // 4. BILLARD CLUB LA GARENNE CLAMART variations
      { alias: 'BILLARD CLUB LA GARENNE CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'BILLARD CLUB LA GARENNE-CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'BC LA GARENNE CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'BC LA GARENNE-CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'LA GARENNE CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'LA GARENNE-CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'GARENNE CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'CLAMART', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },
      { alias: 'LA GARENNE', canonical: 'BILLARD CLUB LA GARENNE CLAMART' },

      // 5. S C M C BILLARD CLUB (Châtillon) variations
      { alias: 'S C M C BILLARD CLUB', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'SCMC BILLARD CLUB', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'S.C.M.C. BILLARD CLUB', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'S.C.M.C BILLARD CLUB', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'SCMC', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'S C M C', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'S.C.M.C.', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'S.C.M.C', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'CHATILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'CHÂTILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'Châtillon', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'Chatillon', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'BILLARD CLUB CHATILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'BILLARD CLUB CHÂTILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'BILLARD CLUB DE CHÂTILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'BILLARD CLUB DE CHATILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'BC CHATILLON', canonical: 'S C M C BILLARD CLUB' },
      { alias: 'BC CHÂTILLON', canonical: 'S C M C BILLARD CLUB' }
    ];

    for (const { alias, canonical } of defaultAliases) {
      await client.query(
        'INSERT INTO club_aliases (alias, canonical_name) VALUES ($1, $2) ON CONFLICT (alias) DO UPDATE SET canonical_name = $2',
        [alias, canonical]
      );
    }
    console.log('Default club aliases initialized');

    // Migration: Ensure club_aliases.canonical_name references valid clubs.name
    // First, update any canonical_name that doesn't match clubs.name to the closest match
    const alignAliasesResult = await client.query(`
      UPDATE club_aliases ca
      SET canonical_name = c.name
      FROM clubs c
      WHERE UPPER(REPLACE(REPLACE(REPLACE(ca.canonical_name, ' ', ''), '.', ''), '-', ''))
          = UPPER(REPLACE(REPLACE(REPLACE(c.name, ' ', ''), '.', ''), '-', ''))
        AND ca.canonical_name != c.name
    `);
    if (alignAliasesResult.rowCount > 0) {
      console.log(`Aligned ${alignAliasesResult.rowCount} club_aliases canonical names to clubs table`);
    }

    // Migration: Normalize club names in players to use clubs.name (via club_aliases)
    // Uses club_aliases to find the canonical name, which must exist in clubs table
    const normalizeClubsResult = await client.query(`
      UPDATE players p
      SET club = c.name
      FROM club_aliases ca
      INNER JOIN clubs c ON ca.canonical_name = c.name
      WHERE UPPER(REPLACE(REPLACE(REPLACE(p.club, ' ', ''), '.', ''), '-', ''))
          = UPPER(REPLACE(REPLACE(REPLACE(ca.alias, ' ', ''), '.', ''), '-', ''))
        AND p.club != c.name
        AND p.club IS NOT NULL
    `);
    if (normalizeClubsResult.rowCount > 0) {
      console.log(`Normalized ${normalizeClubsResult.rowCount} club names in players table`);
    }

    // Also try direct match against clubs table for any clubs without aliases
    const directNormalizeResult = await client.query(`
      UPDATE players p
      SET club = c.name
      FROM clubs c
      WHERE UPPER(REPLACE(REPLACE(REPLACE(p.club, ' ', ''), '.', ''), '-', ''))
          = UPPER(REPLACE(REPLACE(REPLACE(c.name, ' ', ''), '.', ''), '-', ''))
        AND p.club != c.name
        AND p.club IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM club_aliases ca2
          WHERE UPPER(REPLACE(REPLACE(REPLACE(p.club, ' ', ''), '.', ''), '-', ''))
              = UPPER(REPLACE(REPLACE(REPLACE(ca2.alias, ' ', ''), '.', ''), '-', ''))
        )
    `);
    if (directNormalizeResult.rowCount > 0) {
      console.log(`Direct-normalized ${directNormalizeResult.rowCount} club names in players table`);
    }

    // Normalize player_contacts to use clubs.name (via club_aliases)
    const normalizeContactsResult = await client.query(`
      UPDATE player_contacts pc
      SET club = c.name
      FROM club_aliases ca
      INNER JOIN clubs c ON ca.canonical_name = c.name
      WHERE UPPER(REPLACE(REPLACE(REPLACE(pc.club, ' ', ''), '.', ''), '-', ''))
          = UPPER(REPLACE(REPLACE(REPLACE(ca.alias, ' ', ''), '.', ''), '-', ''))
        AND pc.club != c.name
        AND pc.club IS NOT NULL
    `);
    if (normalizeContactsResult.rowCount > 0) {
      console.log(`Normalized ${normalizeContactsResult.rowCount} club names in player_contacts table`);
    }

    // Direct match for player_contacts without aliases
    const directContactsResult = await client.query(`
      UPDATE player_contacts pc
      SET club = c.name
      FROM clubs c
      WHERE UPPER(REPLACE(REPLACE(REPLACE(pc.club, ' ', ''), '.', ''), '-', ''))
          = UPPER(REPLACE(REPLACE(REPLACE(c.name, ' ', ''), '.', ''), '-', ''))
        AND pc.club != c.name
        AND pc.club IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM club_aliases ca2
          WHERE UPPER(REPLACE(REPLACE(REPLACE(pc.club, ' ', ''), '.', ''), '-', ''))
              = UPPER(REPLACE(REPLACE(REPLACE(ca2.alias, ' ', ''), '.', ''), '-', ''))
        )
    `);
    if (directContactsResult.rowCount > 0) {
      console.log(`Direct-normalized ${directContactsResult.rowCount} club names in player_contacts table`);
    }

    // Clean up org-specific settings that may have leaked into global app_settings
    try {
      const orgSpecificKeys = ['qualification_mode', 'bonus_moyenne_enabled', 'bonus_moyenne_type', 'bonus_moyenne_scope', 'position_points_degradation'];
      const delResult = await client.query(
        `DELETE FROM app_settings WHERE key = ANY($1::text[])`,
        [orgSpecificKeys]
      );
      if (delResult.rowCount > 0) {
        console.log(`Cleaned ${delResult.rowCount} org-specific settings from global app_settings table`);
      }
    } catch (cleanupErr) {
      console.error('Error cleaning global app_settings:', cleanupErr);
    }

    // Migration: Prepend org slug subfolder to club logo_filename (for multi-CDB logo isolation)
    // Idempotent: skips rows that already contain a '/' (already migrated)
    try {
      const logoMigrationResult = await client.query(`
        UPDATE clubs c
        SET logo_filename = o.slug || '/' || c.logo_filename
        FROM organizations o
        WHERE c.organization_id = o.id
          AND c.logo_filename IS NOT NULL
          AND c.logo_filename NOT LIKE '%/%'
      `);
      if (logoMigrationResult.rowCount > 0) {
        console.log(`Migrated ${logoMigrationResult.rowCount} club logo filenames to org subfolders`);
      }
    } catch (logoMigErr) {
      console.error('Error migrating club logo filenames:', logoMigErr);
    }

    // Reset stale position_points for standard-mode orgs
    try {
      const resetResult = await client.query(`
        UPDATE tournament_results SET position_points = 0
        WHERE position_points > 0
          AND tournament_id IN (
            SELECT t.id FROM tournaments t
            WHERE t.organization_id IS NOT NULL
              AND t.organization_id NOT IN (
                SELECT os.organization_id FROM organization_settings os
                WHERE os.key = 'qualification_mode' AND os.value = 'journees'
              )
          )
      `);
      if (resetResult.rowCount > 0) {
        console.log(`Reset ${resetResult.rowCount} stale position_points for standard-mode orgs`);
      }
    } catch (resetErr) {
      console.error('Error resetting stale position_points:', resetErr);
    }

  } catch (err) {
    // Post-commit error — NO ROLLBACK here (transaction already committed)
    console.error('Error in post-commit initialization (schema is safe):', err);
  } finally {
    client.release();
  }
}

// Wrapper to make PostgreSQL API compatible with SQLite
const db = {
  // Direct query method (Promise-based, returns { rows })
  query: (query, params) => pool.query(query, params),

  // For SELECT queries that return multiple rows
  all: (query, params, callback) => {
    // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
    let pgQuery = query;
    let pgParams = params;
    let paramIndex = 1;
    pgQuery = query.replace(/\?/g, () => `$${paramIndex++}`);

    pool.query(pgQuery, pgParams)
      .then(result => callback(null, result.rows))
      .catch(err => callback(err));
  },

  // For SELECT queries that return a single row
  get: (query, params, callback) => {
    let pgQuery = query;
    let paramIndex = 1;
    pgQuery = query.replace(/\?/g, () => `$${paramIndex++}`);

    pool.query(pgQuery, params)
      .then(result => callback(null, result.rows[0]))
      .catch(err => callback(err));
  },

  // For INSERT/UPDATE/DELETE queries
  run: (query, params, callback) => {
    let pgQuery = query;
    let paramIndex = 1;
    pgQuery = query.replace(/\?/g, () => `$${paramIndex++}`);

    pool.query(pgQuery, params)
      .then(result => {
        if (callback) {
          // Call callback with 'this' context containing lastID and changes
          const context = {
            lastID: result.rows[0]?.id,
            changes: result.rowCount
          };
          callback.call(context, null);
        }
      })
      .catch(err => {
        if (callback) callback(err);
      });
  },

  // For prepared statements (serialize operations)
  serialize: (callback) => {
    callback();
  },

  // For prepared statements
  prepare: (query) => {
    // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
    let paramIndex = 1;
    const pgQuery = query.replace(/\?/g, () => `$${paramIndex++}`);

    const statement = {
      run: (...args) => {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const params = args;

        pool.query(pgQuery, params)
          .then(result => {
            if (callback) {
              // Call callback with 'this' context containing lastID and changes
              const context = {
                lastID: result.rows[0]?.id,
                changes: result.rowCount
              };
              callback.call(context, null);
            }
          })
          .catch(err => {
            if (callback) callback(err);
          });
      },

      finalize: (callback) => {
        // In PostgreSQL, there's nothing to finalize for a prepared statement
        // Just call the callback immediately
        if (callback) {
          setImmediate(callback);
        }
      }
    };

    return statement;
  }
};

module.exports = db;
