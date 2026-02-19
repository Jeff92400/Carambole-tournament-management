const express = require('express');
const multer = require('multer');
const { authenticateToken, requireAdmin } = require('./auth');
const appSettings = require('../utils/app-settings');

const router = express.Router();

// Configure multer for logo uploads (memory storage for database)
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Seuls les fichiers image sont acceptés'));
  }
});

// Get database connection
const getDb = () => require('../db-loader');

// ==================== PUBLIC ENDPOINTS (NO AUTH) ====================

// Get branding colors (public - needed for login page)
// Supports ?org=slug for per-CDB branding resolution
router.get('/branding/colors', async (req, res) => {
  const db = getDb();
  const appSettings = require('../utils/app-settings');
  const orgSlug = req.query.org;

  const colorKeys = [
    'primary_color',
    'secondary_color',
    'accent_color',
    'background_color',
    'background_secondary_color',
    'organization_short_name',
    'header_logo_size',
    'player_app_url'
  ];

  // If org slug provided, resolve to org ID and use org-specific settings
  if (orgSlug) {
    try {
      const org = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM organizations WHERE slug = $1 AND is_active = TRUE', [orgSlug], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (org) {
        const settings = await appSettings.getOrgSettingsBatch(org.id, colorKeys);
        return res.json(settings);
      }
    } catch (e) {
      console.error('Error resolving org slug for branding:', e);
    }
  }

  // Fallback: global app_settings (backward compatible)
  const placeholders = colorKeys.map((_, i) => `$${i + 1}`).join(',');

  db.all(
    `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`,
    colorKeys,
    (err, rows) => {
      if (err) {
        console.error('Error fetching branding colors:', err);
        return res.status(500).json({ error: err.message });
      }

      const colors = {
        primary_color: '#1F4788',
        secondary_color: '#667eea',
        accent_color: '#ffc107',
        background_color: '#f8f9fa',
        background_secondary_color: '#f5f5f5',
        organization_short_name: null,
        header_logo_size: '48'
      };

      for (const row of rows || []) {
        if (row.value) colors[row.key] = row.value;
      }

      res.json(colors);
    }
  );
});

// Public endpoint for CSV import feature toggle (optionally org-aware via JWT)
router.get('/branding/csv-imports', async (req, res) => {
  try {
    // Try to extract org context from JWT if provided
    let orgId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        orgId = decoded.organizationId || null;
      } catch (e) { /* ignore invalid token — fall back to global */ }
    }

    if (orgId) {
      const value = await appSettings.getOrgSetting(orgId, 'enable_csv_imports');
      return res.json({ enable_csv_imports: value || '1' });
    }

    // No org context — read global setting
    const db = getDb();
    db.get(
      `SELECT value FROM app_settings WHERE key = $1`,
      ['enable_csv_imports'],
      (err, row) => {
        if (err) {
          console.error('Error fetching CSV import setting:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ enable_csv_imports: row?.value || '1' });
      }
    );
  } catch (error) {
    console.error('Error in csv-imports endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUTHENTICATED ENDPOINTS ====================

// Get all game parameters (with display_name from game_modes)
router.get('/game-parameters', authenticateToken, async (req, res) => {
  const db = getDb();

  try {
    // First get game modes mapping
    const gameModes = await new Promise((resolve, reject) => {
      db.all('SELECT code, display_name, display_order FROM game_modes', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Function to find matching game mode
    // Handles cases like: mode="CADRE" matching code="CADRE 42/2"
    function findGameMode(paramMode, gameModes) {
      const normalizedParamMode = paramMode.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');

      for (const gm of gameModes) {
        const normalizedCode = gm.code.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
        const normalizedDisplayName = gm.display_name.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');

        // Exact match
        if (normalizedCode === normalizedParamMode || normalizedDisplayName === normalizedParamMode) {
          return gm;
        }
        // Code starts with param mode (e.g., "CADRE422" starts with "CADRE")
        if (normalizedCode.startsWith(normalizedParamMode)) {
          return gm;
        }
        // Display name starts with param mode
        if (normalizedDisplayName.startsWith(normalizedParamMode)) {
          return gm;
        }
      }
      return null;
    }

    // Get game parameters
    const orgId = req.user.organizationId || null;
    const params = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM game_parameters WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY
          CASE mode
            WHEN 'LIBRE' THEN 1
            WHEN 'CADRE' THEN 2
            WHEN 'BANDE' THEN 3
            WHEN '3BANDES' THEN 4
          END,
          CASE categorie
            WHEN 'N3' THEN 1
            WHEN 'R1' THEN 2
            WHEN 'R2' THEN 3
            WHEN 'R3' THEN 4
            WHEN 'R4' THEN 5
          END`,
        [orgId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Enrich params with mode display names
    const enrichedParams = params.map(param => {
      const matchedMode = findGameMode(param.mode, gameModes);
      return {
        ...param,
        mode_display_name: matchedMode ? matchedMode.display_name : param.mode,
        display_order: matchedMode ? matchedMode.display_order : 999
      };
    });

    res.json(enrichedParams);
  } catch (error) {
    console.error('Error fetching game parameters:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get game parameters for a specific mode/category
router.get('/game-parameters/:mode/:categorie', authenticateToken, (req, res) => {
  const db = getDb();
  const { mode, categorie } = req.params;
  const orgId = req.user.organizationId || null;

  // Normalize: uppercase and remove spaces (DB stores '3BANDES' not '3 BANDES')
  const normalizedMode = decodeURIComponent(mode).toUpperCase().replace(/\s+/g, '');
  const normalizedCategorie = decodeURIComponent(categorie).toUpperCase();

  db.get(
    'SELECT * FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = $1 AND UPPER(categorie) = $2 AND ($3::int IS NULL OR organization_id = $3)',
    [normalizedMode, normalizedCategorie, orgId],
    (err, row) => {
      if (err) {
        console.error('Error fetching game parameter:', err);
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Parameter not found' });
      }
      res.json(row);
    }
  );
});

// Create or update game parameter (admin only)
router.post('/game-parameters', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const { mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi } = req.body;
  const orgId = req.user.organizationId || null;

  if (!mode || !categorie || !coin || !distance_normale || !reprises || moyenne_mini === undefined || moyenne_maxi === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    `INSERT INTO game_parameters (mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi, organization_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (mode, categorie, organization_id) DO UPDATE SET
       coin = EXCLUDED.coin,
       distance_normale = EXCLUDED.distance_normale,
       distance_reduite = EXCLUDED.distance_reduite,
       reprises = EXCLUDED.reprises,
       moyenne_mini = EXCLUDED.moyenne_mini,
       moyenne_maxi = EXCLUDED.moyenne_maxi,
       updated_at = CURRENT_TIMESTAMP`,
    [mode.toUpperCase(), categorie.toUpperCase(), coin, distance_normale, distance_reduite || null, reprises, moyenne_mini, moyenne_maxi, orgId],
    function(err) {
      if (err) {
        console.error('Error saving game parameter:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({
        success: true,
        message: 'Game parameter saved',
        id: this.lastID
      });
    }
  );
});

// Update game parameter (admin only)
router.put('/game-parameters/:id', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi } = req.body;
  const orgId = req.user.organizationId || null;

  db.run(
    `UPDATE game_parameters SET
       coin = $1,
       distance_normale = $2,
       distance_reduite = $3,
       reprises = $4,
       moyenne_mini = $5,
       moyenne_maxi = $6,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $7 AND ($8::int IS NULL OR organization_id = $8)`,
    [coin, distance_normale, distance_reduite || null, reprises, moyenne_mini, moyenne_maxi, id, orgId],
    function(err) {
      if (err) {
        console.error('Error updating game parameter:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Parameter not found' });
      }
      res.json({ success: true, message: 'Game parameter updated' });
    }
  );
});

// Delete game parameter (admin only)
router.delete('/game-parameters/:id', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  db.run(
    'DELETE FROM game_parameters WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
    [id, orgId],
    function(err) {
      if (err) {
        console.error('Error deleting game parameter:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Parameter not found' });
      }
      res.json({ success: true, message: 'Game parameter deleted' });
    }
  );
});

// ============= TOURNAMENT PARAMETER OVERRIDES =============

// Get tournament parameter override (or defaults if no override exists)
router.get('/tournament-overrides/:tournoiId', authenticateToken, async (req, res) => {
  const db = getDb();
  const { tournoiId } = req.params;

  try {
    // First, get the tournament to know its mode/categorie
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        'SELECT tournoi_id, mode, categorie FROM tournoi_ext WHERE tournoi_id = $1',
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouve' });
    }

    // Get default game parameters for this mode/categorie (normalize spaces)
    const orgId = req.user.organizationId || null;
    const defaults = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)',
        [tournament.mode, tournament.categorie, orgId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    // Check for existing override
    const override = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM tournament_parameter_overrides WHERE tournoi_id = $1',
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (override) {
      res.json({
        distance: override.distance,
        distance_type: override.distance_type,
        reprises: override.reprises,
        isOverride: true,
        validated_at: override.validated_at,
        validated_by: override.validated_by,
        defaults: defaults ? {
          distance_normale: defaults.distance_normale,
          distance_reduite: defaults.distance_reduite,
          reprises: defaults.reprises
        } : null
      });
    } else if (defaults) {
      res.json({
        distance: defaults.distance_normale,
        distance_type: 'normale',
        reprises: defaults.reprises,
        isOverride: false,
        validated_at: null,
        validated_by: null,
        defaults: {
          distance_normale: defaults.distance_normale,
          distance_reduite: defaults.distance_reduite,
          reprises: defaults.reprises
        }
      });
    } else {
      res.status(404).json({ error: 'Aucun parametre trouve pour ce mode/categorie' });
    }
  } catch (error) {
    console.error('Error fetching tournament override:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update tournament parameter override
router.put('/tournament-overrides/:tournoiId', authenticateToken, async (req, res) => {
  const db = getDb();
  const { tournoiId } = req.params;
  const { distance, distance_type, reprises } = req.body;
  const username = req.user?.username || 'unknown';

  if (!distance || !reprises) {
    return res.status(400).json({ error: 'Distance et reprises sont requis' });
  }

  try {
    // Verify tournament exists
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        'SELECT tournoi_id FROM tournoi_ext WHERE tournoi_id = $1',
        [tournoiId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouve' });
    }

    // Upsert the override
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO tournament_parameter_overrides (tournoi_id, distance, distance_type, reprises, validated_at, validated_by)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
         ON CONFLICT (tournoi_id) DO UPDATE SET
           distance = EXCLUDED.distance,
           distance_type = EXCLUDED.distance_type,
           reprises = EXCLUDED.reprises,
           validated_at = CURRENT_TIMESTAMP,
           validated_by = EXCLUDED.validated_by`,
        [tournoiId, distance, distance_type || 'custom', reprises, username],
        function(err) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });

    res.json({
      success: true,
      message: 'Parametres valides et enregistres',
      validated_at: new Date().toISOString(),
      validated_by: username
    });
  } catch (error) {
    console.error('Error saving tournament override:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete tournament parameter override (revert to defaults)
router.delete('/tournament-overrides/:tournoiId', authenticateToken, async (req, res) => {
  const db = getDb();
  const { tournoiId } = req.params;

  try {
    const result = await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM tournament_parameter_overrides WHERE tournoi_id = $1',
        [tournoiId],
        function(err) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });

    res.json({
      success: true,
      message: 'Parametres reinitialises aux valeurs par defaut'
    });
  } catch (error) {
    console.error('Error deleting tournament override:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============= APP SETTINGS =============

// Initialize app_settings table if not exists
const initAppSettings = async () => {
  const db = getDb();
  return new Promise((resolve) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, [], async (err) => {
      if (err) console.error('Error creating app_settings table:', err);

      // Default settings to initialize
      const defaultSettings = [
        // Legacy settings
        ['summary_email', 'cdbhs92@gmail.com'],
        ['email_scheduler_hour', '6'],

        // Organization settings
        ['organization_name', 'Comité Départemental de Billard des Hauts-de-Seine'],
        ['organization_short_name', 'CDBHS'],

        // Branding settings
        ['primary_color', '#1F4788'],
        ['secondary_color', '#667EEA'],
        ['accent_color', '#FFC107'],
        ['background_color', '#FFFFFF'],
        ['background_secondary_color', '#F5F5F5'],

        // Email settings
        ['email_communication', 'communication@cdbhs.net'],
        ['email_convocations', 'convocations@cdbhs.net'],
        ['email_noreply', 'noreply@cdbhs.net'],
        ['email_sender_name', 'CDBHS'],

        // Season settings
        ['season_cutoff_month', '8'], // September (0-indexed: 8 = September)

        // Ranking settings
        ['qualification_threshold', '9'],
        ['qualification_small', '4'],
        ['qualification_large', '6'],

        // Privacy policy (default placeholder)
        ['privacy_policy', ''],

        // Time thresholds (in days)
        ['threshold_simulation_disabled', '7'],      // Days before tournament when simulation is disabled
        ['threshold_relance_start', '7'],            // Days before tournament when relance window starts
        ['threshold_relance_end', '14'],             // Days before tournament when relance window ends
        ['threshold_relance_search', '28'],          // Days window for searching tournaments to relance
        ['threshold_registration_deadline', '7'],    // Days before tournament for registration deadline in emails
        ['threshold_stale_import_warning', '7'],     // Days after which import data is considered stale
        ['threshold_urgent_alert', '7'],             // Days threshold for urgent (red) alerts on dashboard
        ['threshold_display_competitions', '28'],    // Days ahead to display competitions in "Compétitions à venir"

        // Feature toggles
        ['enable_csv_imports', '1'],                 // Enable/disable CSV import functionality (1=enabled, 0=disabled)

        // FFB Integration settings
        ['ffb_cdb_code', ''],                        // This instance's CDB code (e.g., "92")
        ['ffb_ligue_numero', ''],                    // This instance's ligue (e.g., "11")
        ['ffb_ftp_host', ''],
        ['ffb_ftp_port', '21'],
        ['ffb_ftp_username', ''],
        ['ffb_ftp_password', ''],
        ['ffb_ftp_path', '/'],
        ['ffb_auto_sync_enabled', '0'],
        ['ffb_sync_mode', 'manual'],                 // 'manual' or 'ftp'
        ['ffb_last_sync_date', '']
      ];

      // Insert default values using INSERT OR IGNORE / ON CONFLICT
      for (const [key, value] of defaultSettings) {
        await new Promise((res) => {
          db.run(
            `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
            [key, value],
            () => res()
          );
        });
      }

      resolve();
    });
  });
};

// Initialize tournament_types table
const initTournamentTypes = async () => {
  const db = getDb();
  return new Promise((resolve) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tournament_types (
        id SERIAL PRIMARY KEY,
        tournament_number INTEGER NOT NULL UNIQUE,
        code TEXT NOT NULL,
        display_name TEXT NOT NULL,
        include_in_ranking BOOLEAN DEFAULT TRUE
      )
    `, [], async (err) => {
      if (err) console.error('Error creating tournament_types table:', err);

      // Default tournament types
      const defaultTypes = [
        [1, 'T1', 'Tournoi 1', true],
        [2, 'T2', 'Tournoi 2', true],
        [3, 'T3', 'Tournoi 3', true],
        [4, 'FINALE', 'Finale Départementale', false]
      ];

      for (const [num, code, displayName, includeInRanking] of defaultTypes) {
        await new Promise((res) => {
          db.run(
            `INSERT INTO tournament_types (tournament_number, code, display_name, include_in_ranking)
             VALUES ($1, $2, $3, $4) ON CONFLICT (tournament_number) DO NOTHING`,
            [num, code, displayName, includeInRanking],
            () => res()
          );
        });
      }

      resolve();
    });
  });
};

// Get a setting by key (org-aware: returns org-specific if user has organizationId)
router.get('/app/:key', authenticateToken, async (req, res) => {
  const { key } = req.params;

  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      const value = await appSettings.getOrgSetting(orgId, key);
      return res.json({ key, value });
    }

    // Fallback: global app_settings
    const db = getDb();
    await initAppSettings();
    db.get(
      'SELECT * FROM app_settings WHERE key = $1',
      [key],
      (err, row) => {
        if (err) {
          console.error('Error fetching setting:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json(row || { key, value: null });
      }
    );
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a setting (admin only, org-aware)
router.put('/app/:key', authenticateToken, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      // Write to organization_settings
      await appSettings.setOrgSetting(orgId, key, value);
      return res.json({ success: true, message: 'Setting updated' });
    }

    // Fallback: global app_settings
    const db = getDb();
    await initAppSettings();
    db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [key, value],
      function(err) {
        if (err) {
          console.error('Error updating setting:', err);
          return res.status(500).json({ error: err.message });
        }
        appSettings.clearCache();
        res.json({ success: true, message: 'Setting updated' });
      }
    );
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all app settings at once (org-aware)
router.get('/app-all', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      // Returns org-specific settings merged with global and defaults
      const settings = await appSettings.getOrgSettings(orgId);
      return res.json(settings);
    }

    // Fallback: global app_settings
    const db = getDb();
    await initAppSettings();
    db.all(
      'SELECT key, value FROM app_settings',
      [],
      (err, rows) => {
        if (err) {
          console.error('Error fetching all settings:', err);
          return res.status(500).json({ error: err.message });
        }
        const settings = {};
        (rows || []).forEach(row => {
          settings[row.key] = row.value;
        });
        res.json(settings);
      }
    );
  } catch (error) {
    console.error('Error fetching all settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update multiple settings at once (admin only, org-aware)
router.put('/app-bulk', authenticateToken, requireAdmin, async (req, res) => {
  const settings = req.body; // Object with key-value pairs

  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      for (const [key, value] of Object.entries(settings)) {
        await appSettings.setOrgSetting(orgId, key, value);
      }
      return res.json({ success: true, message: 'Settings updated' });
    }

    // Fallback: global app_settings
    const db = getDb();
    await initAppSettings();
    for (const [key, value] of Object.entries(settings)) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [key, value],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }
    appSettings.clearCache();
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============= TOURNAMENT TYPES =============

// Get all tournament types
router.get('/tournament-types', authenticateToken, async (req, res) => {
  const db = getDb();

  await initTournamentTypes();

  db.all(
    'SELECT * FROM tournament_types ORDER BY tournament_number',
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching tournament types:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// Update a tournament type (admin only)
router.put('/tournament-types/:id', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { code, display_name, include_in_ranking } = req.body;

  await initTournamentTypes();

  db.run(
    `UPDATE tournament_types SET code = $1, display_name = $2, include_in_ranking = $3 WHERE id = $4`,
    [code, display_name, include_in_ranking, id],
    function(err) {
      if (err) {
        console.error('Error updating tournament type:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tournament type not found' });
      }
      res.json({ success: true, message: 'Tournament type updated' });
    }
  );
});

// ============= EMAIL TEMPLATES =============

// Get email template by key
router.get('/email-template/:key', authenticateToken, (req, res) => {
  const db = getDb();
  const { key } = req.params;
  const orgId = req.user.organizationId || null;

  db.get(
    'SELECT * FROM email_templates WHERE template_key = $1 AND ($2::int IS NULL OR organization_id = $2)',
    [key, orgId],
    (err, row) => {
      if (err) {
        console.error('Error fetching email template:', err);
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        // Return default template if not found (uses organization variables for customization)
        return res.json({
          template_key: key,
          subject_template: 'Convocation {category} - {tournament} - {date}',
          body_template: `Bonjour {player_name},

Le {organization_short_name} a le plaisir de vous convier au tournoi suivant.

Veuillez trouver en attachement votre convocation detaillee avec la composition de toutes les poules du tournoi.

En cas d'empechement, merci d'informer des que possible l'equipe en charge du sportif a l'adresse ci-dessous.

Vous aurez noté un changement significatif quant au processus d'invitation et sommes a votre ecoute si vous avez des remarques ou des suggestions.

Nous vous souhaitons une excellente competition.

Cordialement,
{organization_name}`
        });
      }
      res.json(row);
    }
  );
});

// Update email template (admin only)
router.put('/email-template/:key', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const { key } = req.params;
  const { subject_template, body_template } = req.body;
  const orgId = req.user.organizationId || null;

  if (!subject_template || !body_template) {
    return res.status(400).json({ error: 'Subject and body templates are required' });
  }

  db.run(
    `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (template_key, organization_id) DO UPDATE SET
       subject_template = EXCLUDED.subject_template,
       body_template = EXCLUDED.body_template,
       updated_at = CURRENT_TIMESTAMP`,
    [key, subject_template, body_template, orgId],
    function(err) {
      if (err) {
        console.error('Error updating email template:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, message: 'Email template updated' });
    }
  );
});

// Save current template as default (copies current to {key}_default)
router.post('/email-template/:key/save-as-default', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const { key } = req.params;
  const defaultKey = `${key}_default`;
  const orgId = req.user.organizationId || null;

  try {
    // First, get the current template
    const currentTemplate = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM email_templates WHERE template_key = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [key, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!currentTemplate) {
      return res.status(404).json({ error: 'Template not found. Please save the template first.' });
    }

    // Save as default (using the _default suffix)
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO email_templates (template_key, subject_template, body_template, organization_id, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (template_key, organization_id) DO UPDATE SET
           subject_template = EXCLUDED.subject_template,
           body_template = EXCLUDED.body_template,
           updated_at = CURRENT_TIMESTAMP`,
        [defaultKey, currentTemplate.subject_template, currentTemplate.body_template, orgId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true, message: 'Template saved as default' });
  } catch (err) {
    console.error('Error saving template as default:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get default template (returns {key}_default if exists, otherwise null)
router.get('/email-template/:key/default', authenticateToken, (req, res) => {
  const db = getDb();
  const { key } = req.params;
  const defaultKey = `${key}_default`;
  const orgId = req.user.organizationId || null;

  db.get(
    'SELECT * FROM email_templates WHERE template_key = $1 AND ($2::int IS NULL OR organization_id = $2)',
    [defaultKey, orgId],
    (err, row) => {
      if (err) {
        console.error('Error fetching default email template:', err);
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        // No custom default saved
        return res.json({ hasCustomDefault: false });
      }
      res.json({
        hasCustomDefault: true,
        template_key: key,
        subject_template: row.subject_template,
        body_template: row.body_template,
        updated_at: row.updated_at
      });
    }
  );
});

// ============= CATEGORY MAPPINGS =============

// Get all category mappings
router.get('/category-mappings', authenticateToken, (req, res) => {
  const db = getDb();

  db.all(
    `SELECT cm.*, c.level, c.display_name
     FROM category_mapping cm
     LEFT JOIN categories c ON cm.category_id = c.id
     ORDER BY cm.game_type, cm.ionos_categorie`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching category mappings:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// Get category mappings grouped by game_type and category
router.get('/category-mappings/grouped', authenticateToken, (req, res) => {
  const db = getDb();

  db.all(
    `SELECT cm.*, c.level, c.display_name
     FROM category_mapping cm
     LEFT JOIN categories c ON cm.category_id = c.id
     ORDER BY cm.game_type, c.level, cm.ionos_categorie`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching category mappings:', err);
        return res.status(500).json({ error: err.message });
      }

      // Group by game_type and category
      const grouped = {};
      (rows || []).forEach(row => {
        const key = `${row.game_type}-${row.category_id}`;
        if (!grouped[key]) {
          grouped[key] = {
            game_type: row.game_type,
            category_id: row.category_id,
            level: row.level,
            display_name: row.display_name,
            variations: []
          };
        }
        grouped[key].variations.push({
          id: row.id,
          ionos_categorie: row.ionos_categorie
        });
      });

      res.json(Object.values(grouped));
    }
  );
});

// Add a new category mapping (admin only)
router.post('/category-mappings', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const { ionos_categorie, game_type, category_id } = req.body;

  if (!ionos_categorie || !game_type || !category_id) {
    return res.status(400).json({ error: 'ionos_categorie, game_type, and category_id are required' });
  }

  db.run(
    `INSERT INTO category_mapping (ionos_categorie, game_type, category_id)
     VALUES ($1, $2, $3)`,
    [ionos_categorie.trim(), game_type.toUpperCase(), category_id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint') || err.message.includes('unique constraint')) {
          return res.status(409).json({ error: 'This mapping already exists' });
        }
        console.error('Error adding category mapping:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, id: this.lastID, message: 'Category mapping added' });
    }
  );
});

// Delete a category mapping (admin only)
router.delete('/category-mappings/:id', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  db.run(
    'DELETE FROM category_mapping WHERE id = $1',
    [id],
    function(err) {
      if (err) {
        console.error('Error deleting category mapping:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Mapping not found' });
      }
      res.json({ success: true, message: 'Category mapping deleted' });
    }
  );
});

// Get all categories (for dropdown)
router.get('/categories', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;

  db.all(
    `SELECT * FROM categories WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY game_type, level`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching categories:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// Lookup category by IONOS values (used during matching)
router.get('/category-mappings/lookup', authenticateToken, (req, res) => {
  const db = getDb();
  const { ionos_categorie, game_type } = req.query;

  if (!ionos_categorie || !game_type) {
    return res.status(400).json({ error: 'ionos_categorie and game_type are required' });
  }

  db.get(
    `SELECT cm.*, c.level, c.display_name
     FROM category_mapping cm
     JOIN categories c ON cm.category_id = c.id
     WHERE UPPER(cm.ionos_categorie) = UPPER($1) AND UPPER(cm.game_type) = UPPER($2)`,
    [ionos_categorie.trim(), game_type.trim()],
    (err, row) => {
      if (err) {
        console.error('Error looking up category mapping:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(row || null);
    }
  );
});

// ==================== Organization Logo ====================

// Get logo info
router.get('/organization-logo', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user?.organizationId || null;

  db.get('SELECT id, filename, content_type, LENGTH(file_data) as size, created_at FROM organization_logo WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 1', [orgId], (err, row) => {
    if (err) {
      console.error('Error checking logo:', err);
      return res.status(500).json({ error: 'Erreur lors de la vérification du logo' });
    }

    if (row) {
      res.json({
        exists: true,
        filename: row.filename,
        size: row.size,
        lastModified: row.created_at,
        url: '/api/settings/organization-logo/download'
      });
    } else {
      res.json({ exists: false });
    }
  });
});

// Download/view logo (org-scoped via JWT if available, else returns default org logo)
router.get('/organization-logo/download', (req, res) => {
  const db = getDb();

  // Determine org: from ?org= query param (public pages) or JWT (authenticated pages)
  let orgId = null;
  const orgSlugParam = req.query.org;
  if (orgSlugParam) {
    // Resolve slug to org ID (sync via nested query)
    db.get('SELECT id FROM organizations WHERE slug = $1', [orgSlugParam], (err, orgRow) => {
      if (err || !orgRow) {
        return res.status(404).json({ error: 'Organisation non trouvée' });
      }
      fetchLogo(orgRow.id);
    });
    return; // async path
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      orgId = decoded.organizationId || null;
    } catch (e) {
      // Token invalid or expired — fall through to default
    }
  }
  fetchLogo(orgId);

  function fetchLogo(resolvedOrgId) {
  const query = resolvedOrgId
    ? 'SELECT * FROM organization_logo WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1'
    : 'SELECT * FROM organization_logo ORDER BY created_at DESC LIMIT 1';
  const params = resolvedOrgId ? [resolvedOrgId] : [];

  db.get(query, params, (err, row) => {
    if (err) {
      console.error('Error fetching logo:', err);
      return res.status(500).json({ error: 'Erreur' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Logo non trouvé' });
    }

    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

    const fileData = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
    res.send(fileData);
  });
  } // end fetchLogo
});

// Upload logo (admin only)
router.post('/organization-logo', authenticateToken, requireAdmin, logoUpload.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni' });
  }

  const db = getDb();
  const { originalname, mimetype, buffer } = req.file;
  const uploadedBy = req.user?.username || 'admin';

  const orgId = req.user?.organizationId || null;

  // Delete existing logo for this org and insert new one
  db.run('DELETE FROM organization_logo WHERE ($1::int IS NULL OR organization_id = $1)', [orgId], (err) => {
    if (err) {
      console.error('Error deleting old logo:', err);
    }

    db.run(
      'INSERT INTO organization_logo (filename, content_type, file_data, uploaded_by, organization_id) VALUES ($1, $2, $3, $4, $5)',
      [originalname, mimetype, buffer, uploadedBy, orgId],
      function(err) {
        if (err) {
          console.error('Error saving logo:', err);
          return res.status(500).json({ error: 'Erreur lors de l\'enregistrement du logo' });
        }

        appSettings.clearCache();

        res.json({
          success: true,
          message: 'Logo téléversé avec succès',
          filename: originalname,
          size: req.file.size
        });
      }
    );
  });
});

// Delete logo (admin only)
router.delete('/organization-logo', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user?.organizationId || null;

  db.run('DELETE FROM organization_logo WHERE ($1::int IS NULL OR organization_id = $1)', [orgId], function(err) {
    if (err) {
      console.error('Error deleting logo:', err);
      return res.status(500).json({ error: 'Erreur lors de la suppression du logo' });
    }

    appSettings.clearCache();

    res.json({ success: true, message: 'Logo supprimé' });
  });
});

// ==================== SEASON STATS SNAPSHOT ====================

// Promise wrappers for callback-style db
function dbAll(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
function dbGet(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbRun(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => err ? reject(err) : resolve());
  });
}

/**
 * POST /snapshot-season-stats
 * Snapshot all club dashboard stats for a given season into club_season_stats table.
 * Admin only. Idempotent (upserts on club_id + season).
 */
router.post('/snapshot-season-stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const season = req.body.season || await appSettings.getCurrentSeason();
    const { start: seasonStart, end: seasonEnd } = await appSettings.getSeasonDateRange(season);

    console.log(`[Snapshot] Starting season stats snapshot for ${season} (${seasonStart} → ${seasonEnd})`);

    // Get all clubs
    const clubs = await dbAll(db, 'SELECT id, name, display_name, city FROM clubs', []);

    let snapshotCount = 0;
    const errors = [];

    for (const club of clubs) {
      try {
        // 1. Count total players
        const playersRows = await dbAll(db,
          `SELECT licence FROM players
           WHERE UPPER(REPLACE(club, ' ', '')) LIKE UPPER(REPLACE($1, ' ', '')) || '%'`,
          [club.display_name]
        );
        const totalPlayers = playersRows.length;
        const playerLicences = playersRows.map(p => p.licence?.replace(/\s/g, ''));

        // 2. Count inscriptions per player
        const inscRows = await dbAll(db,
          `SELECT REPLACE(i.licence, ' ', '') as licence, COUNT(*) as cnt
           FROM inscriptions i
           JOIN tournoi_ext t ON i.tournoi_id = t.tournoi_id
           WHERE t.debut >= $1 AND t.debut <= $2
             AND (i.statut IS NULL OR i.statut != 'désinscrit')
             AND (i.forfait IS NULL OR i.forfait = 0)
           GROUP BY REPLACE(i.licence, ' ', '')`,
          [seasonStart, seasonEnd]
        );
        const inscriptionCounts = {};
        inscRows.forEach(r => { inscriptionCounts[r.licence] = parseInt(r.cnt); });

        let activePlayers = 0;
        let totalInscriptions = 0;
        playerLicences.forEach(lic => {
          const cnt = inscriptionCounts[lic] || 0;
          if (cnt > 0) activePlayers++;
          totalInscriptions += cnt;
        });

        // 3. Mode distribution
        const modeRows = await dbAll(db,
          `SELECT UPPER(t.mode) as mode, COUNT(DISTINCT REPLACE(i.licence, ' ', '')) as player_count
           FROM inscriptions i
           JOIN tournoi_ext t ON i.tournoi_id = t.tournoi_id
           WHERE t.debut >= $1 AND t.debut <= $2
             AND (i.statut IS NULL OR i.statut != 'désinscrit')
             AND (i.forfait IS NULL OR i.forfait = 0)
             AND REPLACE(i.licence, ' ', '') IN (
               SELECT REPLACE(p.licence, ' ', '') FROM players p
               WHERE UPPER(REPLACE(p.club, ' ', '')) LIKE UPPER(REPLACE($3, ' ', '')) || '%'
             )
           GROUP BY UPPER(t.mode)`,
          [seasonStart, seasonEnd, club.display_name]
        );
        const modeDistribution = {};
        modeRows.forEach(r => { modeDistribution[r.mode] = parseInt(r.player_count); });

        // 4. Competitions hosted (via club_aliases)
        const clubMatchValues = [club.city, club.name, club.display_name].filter(Boolean).map(v => v.toUpperCase());
        const aliasRows = await dbAll(db,
          `SELECT UPPER(alias) as alias FROM club_aliases WHERE UPPER(canonical_name) = UPPER($1)`,
          [club.name || club.display_name]
        );
        aliasRows.forEach(r => clubMatchValues.push(r.alias));
        const uniqueMatchValues = [...new Set(clubMatchValues)];

        let competitionsHosted = 0;
        if (uniqueMatchValues.length > 0) {
          const placeholders = uniqueMatchValues.map((_, i) => `$${i + 2}`).join(', ');
          const hostedRow = await dbGet(db,
            `SELECT COUNT(*) as count FROM tournaments
             WHERE season = $1
               AND (UPPER(location) IN (${placeholders})
                    OR UPPER(location_2) IN (${placeholders}))`,
            [season, ...uniqueMatchValues]
          );
          competitionsHosted = parseInt(hostedRow?.count || 0);
        }

        // 5. Tournament results → podiums + finale medals
        const resultsRows = await dbAll(db,
          `SELECT tr.licence, tr.position, t.tournament_number
           FROM tournament_results tr
           LEFT JOIN tournaments t ON tr.tournament_id = t.id
           WHERE t.season = $1
           ORDER BY tr.position`,
          [season]
        );

        const playerResults = {};
        resultsRows.forEach(r => {
          const lic = r.licence?.replace(/\s/g, '');
          if (!playerResults[lic]) playerResults[lic] = [];
          playerResults[lic].push({
            position: r.position,
            isFinale: r.tournament_number === 4
          });
        });

        let tournamentPodiums = 0;
        let finaleMedals = 0;
        playerLicences.forEach(lic => {
          const results = playerResults[lic] || [];
          tournamentPodiums += results.filter(r => r.position <= 3 && !r.isFinale).length;
          finaleMedals += results.filter(r => r.position <= 3 && r.isFinale).length;
        });

        // 6. Finalists count (qualified + finale results, deduplicated by licence)
        let finalistsCount = 0;
        try {
          const finaleResultsRows = await dbAll(db,
            `SELECT DISTINCT REPLACE(tr.licence, ' ', '') as licence
             FROM tournament_results tr
             JOIN tournaments t ON tr.tournament_id = t.id
             WHERE t.season = $1 AND t.tournament_number = 4
               AND REPLACE(tr.licence, ' ', '') IN (
                 SELECT REPLACE(p.licence, ' ', '') FROM players p
                 WHERE UPPER(REPLACE(p.club, ' ', '')) LIKE UPPER(REPLACE($2, ' ', '')) || '%'
               )`,
            [season, club.display_name]
          );

          const eligibleRows = await dbAll(db,
            `WITH category_counts AS (
               SELECT category_id, COUNT(*) as total_players,
                      CASE WHEN COUNT(*) < 9 THEN 4 ELSE 6 END as qualified_count
               FROM rankings
               WHERE season = $1
               GROUP BY category_id
             )
             SELECT DISTINCT REPLACE(r.licence, ' ', '') as licence
             FROM rankings r
             JOIN category_counts cc ON cc.category_id = r.category_id
             WHERE r.season = $1
               AND r.rank_position <= cc.qualified_count
               AND EXISTS (
                 SELECT 1 FROM tournaments t3
                 JOIN tournament_results tr3 ON tr3.tournament_id = t3.id
                 WHERE t3.category_id = r.category_id
                   AND t3.season = $1
                   AND t3.tournament_number = 3
               )
               AND REPLACE(r.licence, ' ', '') IN (
                 SELECT REPLACE(pl.licence, ' ', '') FROM players pl
                 WHERE UPPER(REPLACE(pl.club, ' ', '')) LIKE UPPER(REPLACE($2, ' ', '')) || '%'
               )`,
            [season, club.display_name]
          );

          // Deduplicate: a player in both finale results and eligible counts once
          const finalistLicences = new Set();
          finaleResultsRows.forEach(r => finalistLicences.add(r.licence));
          eligibleRows.forEach(r => finalistLicences.add(r.licence));
          finalistsCount = finalistLicences.size;
        } catch (finErr) {
          console.error(`[Snapshot] Error computing finalists for ${club.display_name}:`, finErr.message);
        }

        // UPSERT
        await dbRun(db,
          `INSERT INTO club_season_stats
            (club_id, season, total_players, active_players, total_inscriptions,
             mode_distribution, competitions_hosted, tournament_podiums,
             finale_medals, finalists_count, snapshot_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           ON CONFLICT (club_id, season) DO UPDATE SET
             total_players = EXCLUDED.total_players,
             active_players = EXCLUDED.active_players,
             total_inscriptions = EXCLUDED.total_inscriptions,
             mode_distribution = EXCLUDED.mode_distribution,
             competitions_hosted = EXCLUDED.competitions_hosted,
             tournament_podiums = EXCLUDED.tournament_podiums,
             finale_medals = EXCLUDED.finale_medals,
             finalists_count = EXCLUDED.finalists_count,
             snapshot_at = NOW()`,
          [club.id, season, totalPlayers, activePlayers, totalInscriptions,
           JSON.stringify(modeDistribution), competitionsHosted, tournamentPodiums,
           finaleMedals, finalistsCount]
        );

        snapshotCount++;
      } catch (clubErr) {
        console.error(`[Snapshot] Error for club ${club.display_name}:`, clubErr.message);
        errors.push({ club: club.display_name, error: clubErr.message });
      }
    }

    console.log(`[Snapshot] Done: ${snapshotCount}/${clubs.length} clubs snapshotted for ${season}`);
    res.json({
      success: true,
      season,
      clubs_snapshotted: snapshotCount,
      total_clubs: clubs.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[Snapshot] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
