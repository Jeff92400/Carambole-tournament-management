const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  console.error(`FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Server cannot start without these variables in production mode.');
  process.exit(1);
}

// Ensure database directory exists for SQLite (when running locally)
if (!process.env.DATABASE_URL) {
  const dbDir = path.join(__dirname, '../database');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// Use database loader - automatically selects PostgreSQL or SQLite
const db = require('./db-loader');

// App settings helper for dynamic configuration
const appSettings = require('./utils/app-settings');

const authRoutes = require('./routes/auth');
const playersRoutes = require('./routes/players');
const tournamentsRoutes = require('./routes/tournaments');
const rankingsRoutes = require('./routes/rankings');
const calendarRoutes = require('./routes/calendar');
const clubsRoutes = require('./routes/clubs');
const backupRoutes = require('./routes/backup');
const inscriptionsRoutes = require('./routes/inscriptions');
const emailRoutes = require('./routes/email');
const settingsRoutes = require('./routes/settings');
const emailingRoutes = require('./routes/emailing');
const statisticsRoutes = require('./routes/statistics');
const playerAccountsRoutes = require('./routes/player-accounts');
const activityLogsRoutes = require('./routes/activity-logs');
const announcementsRoutes = require('./routes/announcements');
const contentRoutes = require('./routes/content');
const referenceDataRoutes = require('./routes/reference-data');
const adminLogsRoutes = require('./routes/admin-logs');
const playerInvitationsRoutes = require('./routes/player-invitations');
const importConfigRoutes = require('./routes/import-config');
const enrollmentRequestsRoutes = require('./routes/enrollment-requests');
const superAdminRoutes = require('./routes/super-admin');
const ligueAdminRoutes = require('./routes/ligue-admin');
const ffbImportRoutes = require('./routes/ffb-import');
const bracketRoutes = require('./routes/bracket');
const rsvpRoutes = require('./routes/rsvp');
const { buildRsvpButtonsHtml } = require('./routes/rsvp');
const surveysRoutes = require('./routes/surveys');
const wordpressRoutes = require('./routes/wordpress');
const pushRoutes = require('./routes/push');
const testModeRoutes = require('./routes/test-mode');
const directeurJeuRoutes = require('./routes/directeur-jeu');


const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Railway - required for rate limiting to work correctly
// Without this, all requests appear to come from Railway's internal proxy IP
app.set('trust proxy', true);

console.log('Railway deployment - using PORT:', PORT);

// Security Middleware
// Helmet - Sets security-related HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.sheetjs.com", "https://cdn.jsdelivr.net", "https://cdn.quilljs.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline onclick handlers
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.quilljs.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdn.quilljs.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false // Allow images from external sources
}));

// CORS - Configure allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:3000',
      'https://cdbhs-tournament-management-production.up.railway.app'
    ];

// CORS — fails closed. We only allow any-origin in explicitly-marked
// development environments (NODE_ENV === 'development'). If NODE_ENV is unset
// or set to anything else (including 'production' or undefined), only the
// explicit allowlist applies. Prevents an accidentally-unset env var from
// opening CORS wide in a production deployment.
const isDevEnv = process.env.NODE_ENV === 'development';
if (isDevEnv) {
  console.warn('[CORS] Development mode: any origin is allowed. Do NOT use NODE_ENV=development in production.');
}
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || isDevEnv) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: { error: 'Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: { trustProxy: false } // Disable validation - we trust Railway's proxy
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute per IP
  message: { error: 'Trop de requêtes. Veuillez réessayer dans quelques instants.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false } // Disable validation - we trust Railway's proxy
});

// Bulk email / mass-send limiter — defends Resend's daily quota (free plan = 100/day
// per domain) from being burned by a compromised admin session or a runaway UI.
// Applies to bulk-invite, batch resend, mass campaign send, etc.
const bulkEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 bulk triggers per hour per IP — each bulk can still fan out to many recipients
  message: { error: 'Trop d\'envois groupés. Veuillez patienter une heure avant de réessayer.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files
// Check if frontend folder exists in current directory (Railway) or parent directory (local)
const frontendPath = fs.existsSync(path.join(__dirname, 'frontend'))
  ? path.join(__dirname, 'frontend')
  : path.join(__dirname, '../frontend');

// Allow cross-origin access for club images (used by Player App)
// Safari requires explicit CORS headers
// Also serves logos from database when file doesn't exist on filesystem (Railway ephemeral storage)
app.use('/images/clubs', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check if file exists on filesystem — if yes, let express.static handle it
  const filePath = path.join(frontendPath, 'images', 'clubs', req.path);
  if (fs.existsSync(filePath)) {
    return next();
  }

  // File not on filesystem — try serving from database (logo_data column)
  const logoFilename = req.path.replace(/^\//, ''); // Remove leading /
  if (!logoFilename) {
    return next();
  }
  db.get(
    'SELECT logo_data, logo_content_type FROM clubs WHERE logo_filename = $1 AND logo_data IS NOT NULL LIMIT 1',
    [logoFilename],
    (err, row) => {
      if (err || !row || !row.logo_data) {
        return next(); // Fall through to express.static (will 404)
      }
      res.set('Content-Type', row.logo_content_type || 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(row.logo_data);
    }
  );
});

app.use(express.static(frontendPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Public endpoint for organization logo (needed for emails)
// Must allow cross-origin access for email clients (Outlook, Gmail, etc.)
app.get('/logo.png', (req, res) => {
  const db = require('./db-loader');
  // Support ?org= query param for org-specific logo
  const orgSlug = req.query.org;
  if (orgSlug) {
    db.get(
      `SELECT ol.file_data, ol.content_type FROM organization_logo ol
       JOIN organizations o ON ol.organization_id = o.id
       WHERE o.slug = $1 AND o.is_active = TRUE
       ORDER BY ol.created_at DESC LIMIT 1`,
      [orgSlug],
      (err, row) => {
        if (err || !row) {
          return res.status(404).send('Logo not found');
        }
        res.setHeader('Content-Type', row.content_type || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const fileData = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
        res.send(fileData);
      }
    );
    return;
  }
  // Fallback: return org #1 logo (backward compatible for existing email links)
  db.get('SELECT file_data, content_type FROM organization_logo WHERE organization_id = 1 ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
    if (err || !row) {
      return res.status(404).send('Logo not found');
    }
    res.setHeader('Content-Type', row.content_type || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // Override helmet's restrictive CORP header to allow email clients to load the image
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const fileData = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
    res.send(fileData);
  });
});

// Public endpoint for ligue logos (no auth required — logos are not sensitive)
app.get('/ligue-logo/:numero', (req, res) => {
  const db = require('./db-loader');
  db.get(
    `SELECT logo_data, logo_content_type FROM ffb_ligues WHERE numero = $1`,
    [req.params.numero],
    (err, row) => {
      if (err || !row || !row.logo_data) {
        return res.status(404).send('Logo not found');
      }
      res.setHeader('Content-Type', row.logo_content_type || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      const fileData = Buffer.isBuffer(row.logo_data) ? row.logo_data : Buffer.from(row.logo_data);
      res.send(fileData);
    }
  );
});

// API Routes with rate limiting
// Apply strict rate limit only to login/password endpoints, general limit for other auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password-token', authLimiter);
app.use('/api/auth/reset-with-code', authLimiter);
app.use('/api/auth', apiLimiter, authRoutes); // General limit for other auth routes (/me, /users)
app.use('/api/players', apiLimiter, playersRoutes);
app.use('/api/tournaments', apiLimiter, tournamentsRoutes);
app.use('/api/rankings', apiLimiter, rankingsRoutes);
app.use('/api/calendar', apiLimiter, calendarRoutes);
app.use('/api/clubs', apiLimiter, clubsRoutes);
app.use('/api/backup', apiLimiter, backupRoutes);
app.use('/api/inscriptions', apiLimiter, inscriptionsRoutes);
app.use('/api/email', apiLimiter, emailRoutes);
app.use('/api/settings', apiLimiter, settingsRoutes);
app.use('/api/emailing', apiLimiter, emailingRoutes);
app.use('/api/statistics', apiLimiter, statisticsRoutes);
app.use('/api/player-accounts', apiLimiter, playerAccountsRoutes);
app.use('/api/activity-logs', apiLimiter, activityLogsRoutes);
app.use('/api/announcements', apiLimiter, announcementsRoutes);
app.use('/api/content', apiLimiter, contentRoutes);
app.use('/api/reference-data', apiLimiter, referenceDataRoutes);
app.use('/api/admin-logs', apiLimiter, adminLogsRoutes);
// Bulk/mass-send endpoints within player-invitations get the stricter bulkEmailLimiter
// on top of the general apiLimiter. Triggers that fan out to many recipients are
// capped at 20/hour per IP to protect the Resend quota.
app.use('/api/player-invitations/bulk-invite', bulkEmailLimiter);
app.use('/api/player-invitations/resend-batch', bulkEmailLimiter);
app.use('/api/player-invitations/send-notification-reminder', bulkEmailLimiter);
app.use('/api/player-invitations', apiLimiter, playerInvitationsRoutes);
app.use('/api/import-config', apiLimiter, importConfigRoutes);
app.use('/api/enrollment-requests', apiLimiter, enrollmentRequestsRoutes);
app.use('/api/super-admin', apiLimiter, superAdminRoutes);
app.use('/api/ligue-admin', apiLimiter, ligueAdminRoutes);
app.use('/api/ffb', apiLimiter, ffbImportRoutes);
app.use('/api/bracket', apiLimiter, bracketRoutes);
app.use('/api/rsvp', apiLimiter, rsvpRoutes);
app.use('/api/surveys', apiLimiter, surveysRoutes);
app.use('/api/wordpress', apiLimiter, wordpressRoutes);
app.use('/api/player/push', apiLimiter, pushRoutes);
app.use('/api/push', apiLimiter, pushRoutes); // Admin test endpoint
app.use('/api/test-mode', apiLimiter, testModeRoutes);
app.use('/api/directeur-jeu', apiLimiter, directeurJeuRoutes);


// App version endpoint (for automatic update detection)
// INCREMENT THIS VERSION when deploying updates you want users to see
const APP_VERSION = '2026.01.13.1';
app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'cdbhs-tournament-management',
    timestamp: new Date().toISOString()
  });
});

// ─── Public tournament page (no auth required) ─────────────────────────────
app.get('/public/:orgSlug/tournament/:id', (req, res) => {
  res.sendFile(path.join(frontendPath, 'public-tournament.html'));
});

// ─── Public API: tournament data for public page (no auth) ──────────────────
app.get('/api/public/:orgSlug/tournament/:id', async (req, res) => {
  const dbLoader = require('./db-loader');
  const { orgSlug, id } = req.params;

  try {
    // Resolve org from slug
    const org = await new Promise((resolve, reject) => {
      dbLoader.get(
        'SELECT id, name FROM organizations WHERE slug = $1 AND is_active = true',
        [orgSlug],
        (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });
    if (!org) return res.status(404).json({ error: 'Organisation introuvable.' });

    // Fetch tournament
    const tournament = await new Promise((resolve, reject) => {
      dbLoader.get(
        `SELECT tournoi_id, nom, mode, categorie, debut, lieu, lieu_2, status,
                tournament_number, is_split, split_label
         FROM tournoi_ext
         WHERE tournoi_id = $1 AND organization_id = $2`,
        [id, org.id],
        (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable.' });

    // Fetch poules (if convocations have been sent)
    const poules = await new Promise((resolve, reject) => {
      dbLoader.all(
        `SELECT poule_number, licence, player_name, club, location_name,
                location_address, start_time, player_order
         FROM convocation_poules
         WHERE tournoi_id = $1
         ORDER BY poule_number, player_order`,
        [id],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    // Group poules
    const poulesGrouped = {};
    for (const row of poules) {
      if (!poulesGrouped[row.poule_number]) {
        poulesGrouped[row.poule_number] = {
          number: row.poule_number,
          location: row.location_name,
          address: row.location_address,
          startTime: row.start_time,
          players: []
        };
      }
      poulesGrouped[row.poule_number].players.push({
        name: row.player_name,
        club: row.club
      });
    }

    // Fetch org branding
    const brandingKeys = ['organization_name', 'organization_short_name', 'primary_color', 'secondary_color'];
    const branding = {};
    for (const key of brandingKeys) {
      const setting = await new Promise((resolve, reject) => {
        dbLoader.get(
          'SELECT value FROM organization_settings WHERE organization_id = $1 AND key = $2',
          [org.id, key],
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      });
      branding[key] = setting?.value || '';
    }

    // Fetch game parameters override
    const paramOverride = await new Promise((resolve, reject) => {
      dbLoader.get(
        'SELECT distance, reprises FROM tournament_parameter_overrides WHERE tournoi_id = $1',
        [id],
        (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });

    res.json({
      tournament,
      poules: Object.values(poulesGrouped),
      branding,
      gameParams: paramOverride || null
    });
  } catch (error) {
    console.error('[Public] Tournament fetch error:', error.message);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// Serve frontend pages
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});

// Helper to check if campaign was already sent manually
async function checkIfAlreadySentManually(db, emailType, mode, category, tournamentId) {
  return new Promise((resolve, reject) => {
    let query = `SELECT id FROM email_campaigns
                 WHERE campaign_type = $1
                   AND status IN ('completed', 'sending')
                   AND (test_mode = FALSE OR test_mode IS NULL)`;
    const params = [emailType];
    let paramIndex = 2;

    if (mode) {
      query += ` AND (mode = $${paramIndex++} OR mode IS NULL)`;
      params.push(mode);
    }
    if (category) {
      query += ` AND (category = $${paramIndex++} OR category IS NULL)`;
      params.push(category);
    }
    if (tournamentId) {
      query += ` AND tournament_id = $${paramIndex++}`;
      params.push(tournamentId);
    }

    query += ' LIMIT 1';

    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

// Process templated scheduled emails (relance, results, finale)
async function processTemplatedScheduledEmail(db, resend, scheduled, delay) {
  const emailType = scheduled.email_type;
  console.log(`[Email Scheduler] Processing templated email ${scheduled.id} (${emailType})`);

  // Get org-specific settings for qualification thresholds and email branding
  const schedOrgId = scheduled.organization_id || null;
  const settingsKeys = [
    'primary_color', 'email_communication', 'email_sender_name',
    'organization_name', 'organization_short_name', 'summary_email',
    'player_app_url', 'qualification_threshold', 'qualification_small', 'qualification_large',
    'rsvp_email_enabled'
  ];
  const emailSettings = schedOrgId
    ? await appSettings.getOrgSettingsBatch(schedOrgId, settingsKeys)
    : await appSettings.getSettingsBatch(settingsKeys);
  const qualificationSettings = {
    threshold: parseInt(emailSettings.qualification_threshold) || 9,
    small: parseInt(emailSettings.qualification_small) || 4,
    large: parseInt(emailSettings.qualification_large) || 6
  };

  let recipients = [];
  let templateVariables = {};

  // Fetch recipients based on email type
  if (emailType.startsWith('relance_')) {
    // Parse custom data for template
    const customData = scheduled.custom_data ? JSON.parse(scheduled.custom_data) : {};

    // Look up category from database for proper display_name
    const mode = (scheduled.mode || '').toUpperCase();
    const categoryLevel = (scheduled.category || '').toUpperCase();

    const categoryRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM categories WHERE UPPER(game_type) = $1 AND (UPPER(level) = $2 OR UPPER(level) LIKE $3) AND ($4::int IS NULL OR organization_id = $4)`,
        [mode, categoryLevel, categoryLevel + '%', schedOrgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const categoryDisplayName = categoryRow?.display_name || `${scheduled.mode} ${scheduled.category}`;

    // For relance_finale, get qualified players with their rankings
    if (emailType === 'relance_finale') {
      // Check that convocation has been sent before allowing relance finale
      const convocationSent = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id, sent_at FROM email_campaigns
           WHERE campaign_type = 'finale_convocation'
           AND UPPER(mode) = $1
           AND (UPPER(category) = $2 OR UPPER(category) LIKE $3)
           AND status = 'completed'
           AND (test_mode = false OR test_mode IS NULL)
           AND ($4::int IS NULL OR organization_id = $4)
           ORDER BY sent_at DESC LIMIT 1`,
          [mode, categoryLevel, categoryLevel + '%', schedOrgId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!convocationSent) {
        console.log(`[Email Scheduler] Skipping relance_finale for ${mode} ${categoryLevel}: convocation not sent yet`);
        await new Promise((resolve) => {
          db.run(`UPDATE scheduled_emails SET status = 'failed', error_message = 'Convocation non envoyée' WHERE id = $1`, [scheduled.id], () => resolve());
        });
        return;
      }

      // Get current season
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const season = currentMonth >= 8 ? `${currentYear}-${currentYear + 1}` : `${currentYear - 1}-${currentYear}`;

      // Fetch ranked players
      const allRankings = await new Promise((resolve, reject) => {
        db.all(
          `SELECT r.*,
                  pc.id as contact_id, pc.first_name, pc.last_name, pc.email, pc.club,
                  COALESCE(pc.first_name || ' ' || pc.last_name, r.licence) as player_name
           FROM rankings r
           LEFT JOIN player_contacts pc ON REPLACE(r.licence, ' ', '') = REPLACE(pc.licence, ' ', '')
           WHERE r.season = $1 AND r.category_id = $2
           ORDER BY r.rank_position ASC`,
          [season, categoryRow?.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const qualifiedCount = allRankings.length < qualificationSettings.threshold
        ? qualificationSettings.small
        : qualificationSettings.large;
      recipients = allRankings.filter(r => r.rank_position <= qualifiedCount && r.email);

      // Fetch finale info from tournoi_ext if not in customData
      let finaleDate = customData.finale_date || '';
      let finaleLieu = customData.finale_lieu || '';

      if (!finaleDate || !finaleLieu) {
        const finale = await new Promise((resolve, reject) => {
          db.get(
            `SELECT * FROM tournoi_ext
             WHERE UPPER(mode) = $1
             AND (UPPER(categorie) = $2 OR UPPER(categorie) LIKE $3)
             AND debut >= $4
             AND ($5::int IS NULL OR organization_id = $5)
             ORDER BY debut ASC LIMIT 1`,
            [mode, categoryLevel, categoryLevel + '%', new Date().toISOString().split('T')[0], schedOrgId],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        });

        if (finale) {
          if (!finaleDate && finale.debut) {
            finaleDate = new Date(finale.debut).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          }
          if (!finaleLieu && finale.lieu) {
            finaleLieu = finale.lieu;
          }
        }
      }

      // Auto-calculate deadline (7 days before finale) if not provided
      let deadlineDate = customData.deadline_date || '';
      if (!deadlineDate && finaleDate) {
        const finaleMatch = finaleDate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (finaleMatch) {
          const [_, day, month, year] = finaleMatch;
          const finaleDateTime = new Date(year, month - 1, day);
          finaleDateTime.setDate(finaleDateTime.getDate() - 7);
          deadlineDate = finaleDateTime.toLocaleDateString('fr-FR');
        }
      }

      templateVariables = {
        category: categoryDisplayName,
        qualified_count: qualifiedCount.toString(),
        finale_date: finaleDate,
        finale_lieu: finaleLieu,
        deadline_date: deadlineDate
      };
    } else {
      // For T2/T3 relances, get contacts scoped to org
      recipients = await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM player_contacts WHERE email IS NOT NULL AND email LIKE '%@%' AND ($1::int IS NULL OR organization_id = $1)`,
          [schedOrgId],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Compute season for T1/ouverture templates
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const scheduledSeason = currentMonth >= 8 ? `${currentYear}-${currentYear + 1}` : `${currentYear - 1}-${currentYear}`;

      templateVariables = {
        category: categoryDisplayName,
        season: customData.season || scheduledSeason,
        mode: scheduled.mode || '',
        tournament_date: customData.tournament_date || '',
        tournament_lieu: customData.tournament_lieu || '',
        finale_date: customData.finale_date || '',
        finale_lieu: customData.finale_lieu || '',
        deadline_date: customData.deadline_date || ''
      };
    }

  } else if (emailType === 'tournament_results' && scheduled.tournament_id) {
    // Get tournament participants
    const tournament = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM tournaments WHERE id = $1`, [scheduled.tournament_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!tournament) throw new Error('Tournament not found');

    const results = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tr.*, pc.email, pc.first_name, pc.last_name
         FROM tournament_results tr
         LEFT JOIN player_contacts pc ON REPLACE(tr.licence, ' ', '') = REPLACE(pc.licence, ' ', '')
         WHERE tr.tournament_id = $1`,
        [scheduled.tournament_id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    recipients = results.filter(r => r.email && r.email.includes('@'));
    templateVariables = {
      tournament_name: tournament.display_name || tournament.name,
      tournament_date: tournament.tournament_date ? new Date(tournament.tournament_date).toLocaleDateString('fr-FR') : ''
    };

  } else if (emailType === 'finale_convocation' && scheduled.tournament_id) {
    // Get finale finalists - simplified version
    const finale = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM tournoi_ext WHERE tournoi_id = $1`, [scheduled.tournament_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!finale) throw new Error('Finale not found');

    // Get contacts for this mode/category (org-scoped)
    recipients = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM player_contacts WHERE email IS NOT NULL AND email LIKE '%@%' AND ($1::int IS NULL OR organization_id = $1)`,
        [schedOrgId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    templateVariables = {
      finale_date: finale.debut ? new Date(finale.debut).toLocaleDateString('fr-FR') : '',
      finale_lieu: finale.lieu || ''
    };
  }

  // Handle test mode - send only to test email
  const isTestMode = scheduled.test_mode === true || scheduled.test_mode === 1;
  if (isTestMode && scheduled.test_email) {
    console.log(`[Email Scheduler] TEST MODE - sending to ${scheduled.test_email} instead of ${recipients.length} recipients`);
    // Use a single fake recipient with test email
    recipients = [{
      email: scheduled.test_email,
      first_name: 'Test',
      last_name: 'User',
      club: 'Test Club'
    }];
  }

  if (recipients.length === 0) {
    console.log(`[Email Scheduler] No recipients for scheduled email ${scheduled.id}`);
    await new Promise((resolve) => {
      db.run(`UPDATE scheduled_emails SET status = 'completed', sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [scheduled.id], () => resolve());
    });
    return;
  }

  console.log(`[Email Scheduler] Sending to ${recipients.length} recipients`);

  let sentCount = 0;
  let failedCount = 0;

  // Parse customData once for RSVP buttons
  const rsvpCustomData = scheduled.custom_data ? JSON.parse(scheduled.custom_data) : {};
  const rsvpTournoiExtId = rsvpCustomData.tournoi_ext_id || null;

  // Get email settings once (before the loop)
  const primaryColor = emailSettings.primary_color || '#1F4788';
  const senderName = emailSettings.email_sender_name || 'CDBHS';
  const senderEmail = emailSettings.email_communication || 'communication@cdbhs.net';
  const replyToEmail = emailSettings.summary_email || '';
  const orgName = emailSettings.organization_name || 'Comité Départemental Billard Hauts-de-Seine';
  const orgShortName = emailSettings.organization_short_name || 'CDBHS';
  const playerAppUrl = emailSettings.player_app_url || 'https://cdbhs-player-app-production.up.railway.app';
  const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
  const templatedOrgSlug = await appSettings.getOrgSlug(schedOrgId);
  const logoUrl = appSettings.buildLogoUrl(baseUrl, templatedOrgSlug);

  for (const recipient of recipients) {
    try {
      // Check if recipient has a Player App account
      const recipientLicence = recipient.licence || '';
      const hasAppAccount = await new Promise((resolve, reject) => {
        db.get(
          `SELECT 1 FROM player_accounts WHERE REPLACE(licence, ' ', '') = REPLACE($1, ' ', '')`,
          [recipientLicence],
          (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
          }
        );
      });

      // Build inscription method HTML based on account status
      let inscriptionMethodHtml;

      // In TEST MODE: show both versions for preview
      if (isTestMode) {
        inscriptionMethodHtml = `
          <div style="border: 2px dashed #ff9800; padding: 15px; margin: 20px 0; background: #fff3e0;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #e65100;">⚠️ MODE TEST - Aperçu des 2 versions :</p>

            <div style="background: #e8f5e9; padding: 10px; border-radius: 8px; margin-bottom: 15px;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #2e7d32; font-weight: bold;">✅ Version joueur AVEC compte Espace Joueur :</p>
              <div style="text-align: center;">
                <a href="${playerAppUrl}/?page=tournaments" target="_blank" style="display: inline-block; background: ${primaryColor}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  📱 S'inscrire via l'Espace Joueur
                </a>
              </div>
            </div>

            <div style="background: #ffebee; padding: 10px; border-radius: 8px;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #c62828; font-weight: bold;">❌ Version joueur SANS compte Espace Joueur :</p>
              <div style="margin: 0; padding: 15px; background: #fff; border-left: 4px solid ${primaryColor};">
                <p style="margin: 0;">Confirmez votre inscription sur <a href="https://cdbhs.net" target="_blank" style="color: ${primaryColor}; font-weight: bold;">cdbhs.net</a> ou en répondant à cet email.</p>
              </div>
            </div>
          </div>`;
      } else if (hasAppAccount) {
        // Player has app account - show button to go directly to competitions
        inscriptionMethodHtml = `<div style="text-align: center; margin: 20px 0;">
          <a href="${playerAppUrl}/?page=tournaments" target="_blank" style="display: inline-block; background: ${primaryColor}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            📱 S'inscrire via l'Espace Joueur
          </a>
        </div>`;
      } else {
        // Player doesn't have app account - show cdbhs.net option
        inscriptionMethodHtml = `<div style="margin: 15px 0; padding: 15px; background: #fff; border-left: 4px solid ${primaryColor};">
          <p style="margin: 0;">Confirmez votre inscription sur <a href="https://cdbhs.net" target="_blank" style="color: ${primaryColor}; font-weight: bold;">cdbhs.net</a> ou en répondant à cet email.</p>
        </div>`;
      }

      // Add RSVP one-click buttons if tournoi_ext_id is in customData AND setting enabled for this CDB
      if (rsvpTournoiExtId && emailSettings.rsvp_email_enabled === 'true') {
        const rsvpHtml = buildRsvpButtonsHtml(recipientLicence, rsvpTournoiExtId, schedOrgId, baseUrl, primaryColor);
        inscriptionMethodHtml = rsvpHtml + inscriptionMethodHtml;
      }

      // Replace template variables
      let emailBody = (scheduled.body || '')
        .replace(/\{player_name\}/g, `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim())
        .replace(/\{first_name\}/g, recipient.first_name || '')
        .replace(/\{last_name\}/g, recipient.last_name || '')
        .replace(/\{club\}/g, recipient.club || '')
        .replace(/\{category\}/g, templateVariables.category || '')
        .replace(/\{rank_position\}/g, recipient.rank_position?.toString() || '')
        .replace(/\{total_points\}/g, recipient.total_match_points?.toString() || '')
        .replace(/\{qualified_count\}/g, templateVariables.qualified_count || '')
        .replace(/\{tournament_date\}/g, templateVariables.tournament_date || '')
        .replace(/\{tournament_lieu\}/g, templateVariables.tournament_lieu || '')
        .replace(/\{finale_date\}/g, templateVariables.finale_date || '')
        .replace(/\{finale_lieu\}/g, templateVariables.finale_lieu || '')
        .replace(/\{deadline_date\}/g, templateVariables.deadline_date || '')
        .replace(/\{ffb_ranking\}/g, recipient.ffb_ranking || '')
        .replace(/\{season\}/g, templateVariables.season || '')
        .replace(/\{mode\}/g, templateVariables.mode || '')
        .replace(/\{inscription_method\}/g, inscriptionMethodHtml);

      let emailSubject = (scheduled.subject || '')
        .replace(/\{category\}/g, templateVariables.category || '')
        .replace(/\{tournament_date\}/g, templateVariables.tournament_date || '');

      const outroText = scheduled.outro_text || '';
      const imageHtml = scheduled.image_url ? `<div style="text-align: center; margin: 20px 0;"><img src="${scheduled.image_url}" alt="Image" style="max-width: 100%; height: auto; border-radius: 8px;"></div>` : '';

      await resend.emails.send({
        from: `${senderName} <${senderEmail}>`,
        replyTo: replyToEmail,
        to: [recipient.email],
        cc: scheduled.cc_email ? [scheduled.cc_email] : undefined,
        subject: emailSubject,
        html: `<div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
          <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
            <img src="${logoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
            <h1 style="margin: 0; font-size: 24px;">${orgName}</h1>
          </div>
          <div style="padding: 20px; background: #f8f9fa;">
            ${imageHtml}
            ${emailBody.replace(/\n/g, '<br>')}
            ${outroText ? `<br><br>${outroText.replace(/\n/g, '<br>')}` : ''}
          </div>
          <div style="background: ${primaryColor}; color: white; padding: 10px; text-align: center; font-size: 12px;">${orgShortName} - ${replyToEmail}</div>
        </div>`
      });

      sentCount++;
      await delay(1500);
    } catch (error) {
      console.error(`[Email Scheduler] Error sending to ${recipient.email}:`, error.message);
      failedCount++;
    }
  }

  // Update status
  await new Promise((resolve, reject) => {
    db.run(`UPDATE scheduled_emails SET status = 'completed', sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [scheduled.id], function(err) {
      if (err) {
        console.error(`[Email Scheduler] Error updating status for ${scheduled.id}:`, err.message);
        reject(err);
      } else {
        console.log(`[Email Scheduler] Status updated to 'completed' for ${scheduled.id}, rows affected: ${this.changes}`);
        resolve();
      }
    });
  });

  // Create campaign record
  await new Promise((resolve) => {
    db.run(
      `INSERT INTO email_campaigns (subject, body, template_key, recipients_count, sent_count, failed_count, status, sent_at, campaign_type, mode, category, tournament_id, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', CURRENT_TIMESTAMP, $7, $8, $9, $10, $11)`,
      [scheduled.subject, scheduled.body, scheduled.template_key, recipients.length, sentCount, failedCount, scheduled.email_type, scheduled.mode, scheduled.category, scheduled.tournament_id, scheduled.created_by || 'scheduled'],
      () => resolve()
    );
  });

  console.log(`[Email Scheduler] Completed ${scheduled.id}: ${sentCount} sent, ${failedCount} failed`);
}

// Tournament alerts - check for upcoming tournaments and notify opted-in users
async function checkTournamentAlerts() {
  const { Resend } = require('resend');
  const db = require('./db-loader');

  if (!process.env.RESEND_API_KEY) {
    console.log('[Tournament Alerts] Skipped - no RESEND_API_KEY');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    console.log('[Tournament Alerts] Checking for upcoming tournaments...');

    // Get Paris time
    const now = new Date();
    const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const currentHour = parisNow.getHours();

    // Only send alerts once per day, at 9 AM Paris time
    if (currentHour !== 9) {
      console.log(`[Tournament Alerts] Skipping - current hour is ${currentHour}, alerts sent at 9 AM`);
      return;
    }

    // Check if we already sent an alert today (prevent duplicates on server restart)
    const todayStart = new Date(parisNow);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(parisNow);
    todayEnd.setHours(23, 59, 59, 999);

    const lastAlertSent = await new Promise((resolve, reject) => {
      db.get(`
        SELECT sent_at FROM email_campaigns
        WHERE campaign_type = 'tournament_alert'
          AND sent_at >= $1 AND sent_at <= $2
        LIMIT 1
      `, [todayStart.toISOString(), todayEnd.toISOString()], (err, row) => {
        if (err) {
          console.error('[Tournament Alerts] Error checking last alert:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (lastAlertSent) {
      console.log(`[Tournament Alerts] Already sent today at ${lastAlertSent.sent_at}, skipping`);
      return;
    }

    console.log('[Tournament Alerts] No alert sent today, proceeding...');

    // Insert a placeholder record FIRST to prevent duplicate sends on concurrent restarts
    // Use org_id=1 as default (this is a lock record, not org-specific)
    await new Promise((resolve) => {
      db.run(`
        INSERT INTO email_campaigns (subject, body, template_key, recipients_count, sent_count, failed_count, status, sent_at, campaign_type, organization_id)
        VALUES ('Tournament Alert - Pending', 'Pending', 'tournament_alert', 0, 0, 0, 'pending', CURRENT_TIMESTAMP, 'tournament_alert', 1)
      `, [], () => resolve());
    });

    const today = new Date();
    const twoWeeksFromNow = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Get users opted-in for alerts with valid email (include their org)
    const usersToNotify = await new Promise((resolve, reject) => {
      db.all(`
        SELECT id, username, email, organization_id FROM users
        WHERE receive_tournament_alerts = true AND email IS NOT NULL AND email != '' AND is_active = 1
      `, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    if (usersToNotify.length === 0) {
      console.log('[Tournament Alerts] No users opted-in for tournament alerts');
      return;
    }

    // Group users by org
    const usersByOrg = {};
    for (const user of usersToNotify) {
      const orgId = user.organization_id || 'none';
      if (!usersByOrg[orgId]) usersByOrg[orgId] = [];
      usersByOrg[orgId].push(user);
    }

    const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
    let totalSent = 0;

    // Process each org independently
    for (const [orgId, orgUsers] of Object.entries(usersByOrg)) {
      const orgIdNum = orgId === 'none' ? null : parseInt(orgId);

      // Get org-specific branding
      const emailSettings = orgIdNum
        ? await appSettings.getOrgSettingsBatch(orgIdNum, [
            'primary_color', 'email_convocations', 'email_sender_name',
            'organization_short_name', 'summary_email'
          ])
        : await appSettings.getSettingsBatch([
            'primary_color', 'email_convocations', 'email_sender_name',
            'organization_short_name', 'summary_email'
          ]);

      // Get upcoming tournaments for this org only (exclude finales - they have their own relance system)
      const tournamentsNeeding = await new Promise((resolve, reject) => {
        db.all(`
          SELECT t.*
          FROM tournoi_ext t
          LEFT JOIN tournament_relances r ON t.tournoi_id = r.tournoi_id
          WHERE t.debut >= $1 AND t.debut <= $2 AND r.tournoi_id IS NULL
            AND LOWER(t.nom) NOT LIKE '%finale%'
            AND ($3::int IS NULL OR t.organization_id = $3)
          ORDER BY t.debut ASC
        `, [today.toISOString().split('T')[0], twoWeeksFromNow.toISOString().split('T')[0], orgIdNum], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      if (tournamentsNeeding.length === 0) {
        console.log(`[Tournament Alerts] No tournaments needing relances for org ${orgId}`);
        continue;
      }

      console.log(`[Tournament Alerts] Org ${orgId}: ${tournamentsNeeding.length} tournament(s), ${orgUsers.length} user(s)`);

      // Build tournament list HTML
      const tournamentListHtml = tournamentsNeeding.map(t => {
        const dateObj = new Date(t.debut);
        const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const daysLeft = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
        const lieuStr = t.lieu ? ` - <span style="color: #17a2b8;">${t.lieu}</span>` : '';

        return `
          <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #ffc107;">
            <strong style="color: #333;">${t.nom}</strong><br>
            <span style="color: #666;">${t.mode} ${t.categorie} - ${dateStr}${lieuStr}</span><br>
            <span style="color: ${daysLeft <= 7 ? '#dc3545' : '#856404'}; font-weight: bold;">
              Dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}
            </span>
          </div>
        `;
      }).join('');

      const primaryColor = emailSettings.primary_color || '#1F4788';
      const senderName = emailSettings.email_sender_name || 'CDBHS';
      const senderEmail = emailSettings.email_convocations || 'convocations@cdbhs.net';
      const orgShortName = emailSettings.organization_short_name || 'CDBHS';
      const replyToEmail = emailSettings.summary_email || '';

      for (const user of orgUsers) {
        try {
          await resend.emails.send({
            from: `${senderName} <${senderEmail}>`,
            to: user.email,
            replyTo: replyToEmail,
            subject: `⚠️ ${tournamentsNeeding.length} tournoi(s) à relancer - ${orgShortName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; font-size: 24px;">Rappel Tournois ${orgShortName}</h1>
                </div>
                <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px;">
                  <p>Bonjour ${user.username},</p>
                  <p>Les tournois suivants approchent et les <strong>relances n'ont pas encore été envoyées</strong> :</p>
                  ${tournamentListHtml}
                  <p style="margin-top: 20px;">
                    <a href="${baseUrl}/dashboard.html" style="background: #28a745; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; display: inline-block;">
                      Accéder au tableau de bord
                    </a>
                  </p>
                  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                  <p style="color: #666; font-size: 12px;">
                    Vous recevez cet email car vous avez activé les alertes de tournois dans vos paramètres.
                    <br>Pour vous désabonner, modifiez vos paramètres sur ${baseUrl}/settings.html
                  </a>
                  </p>
                </div>
              </div>
            `
          });

          console.log(`[Tournament Alerts] Email sent to ${user.email} (org ${orgId})`);
          totalSent++;
        } catch (error) {
          console.error(`[Tournament Alerts] Error sending to ${user.email}:`, error.message);
        }
      }
    }

    // Clean up the pending record:
    //   - If at least one alert email was sent, UPDATE it to 'completed' for auditability
    //   - If nothing was sent (no tournaments in window, or no eligible recipients), DELETE
    //     it so the history is not polluted with zero-count ghost entries.
    // The pending row is still useful as a concurrency lock during execution — it only
    // becomes noise after the run is over with no actual sends.
    await new Promise((resolve) => {
      if (totalSent > 0) {
        db.run(`
          UPDATE email_campaigns
          SET subject = $1, body = $2, recipients_count = $3, sent_count = $3, status = 'completed'
          WHERE campaign_type = 'tournament_alert' AND status = 'pending'
        `, [`Rappel Tournois - multi-org`, 'Auto-generated tournament alert', totalSent], () => resolve());
      } else {
        db.run(`
          DELETE FROM email_campaigns
          WHERE campaign_type = 'tournament_alert' AND status = 'pending'
        `, [], () => resolve());
      }
    });

    console.log(`[Tournament Alerts] Completed - ${totalSent} email(s) sent${totalSent === 0 ? ' (pending record deleted to avoid ghost entry)' : ''}`);

  } catch (error) {
    console.error('[Tournament Alerts] Error:', error.message);
  }
}

// Email scheduler - check and send scheduled emails
// Exposed globally for manual triggering via API
async function processScheduledEmails() {
  const { Resend } = require('resend');
  const db = require('./db-loader');

  console.log('[Email Scheduler] Starting processScheduledEmails...');

  if (!process.env.RESEND_API_KEY) {
    console.log('[Email Scheduler] No RESEND_API_KEY configured');
    return { status: 'error', message: 'No RESEND_API_KEY configured' };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Get dynamic settings for email branding
  const emailSettings = await appSettings.getSettingsBatch([
    'primary_color', 'email_communication', 'email_sender_name',
    'organization_name', 'organization_short_name', 'summary_email'
  ]);

  try {
    // Get all pending emails
    const allPending = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM scheduled_emails WHERE status = 'pending'`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    console.log(`[Email Scheduler] Found ${allPending.length} pending email(s)`);

    if (allPending.length === 0) {
      return { status: 'ok', message: 'No pending emails', pending: 0, due: 0, processed: 0 };
    }

    // Get current Paris time
    const now = new Date();
    const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    console.log(`[Email Scheduler] Paris time: ${parisNow.toLocaleString('fr-FR')}`);

    // Filter emails that are due (scheduled_at <= now Paris time)
    const scheduledEmails = allPending.filter(email => {
      // Handle scheduled_at as Date object or string
      let scheduledDate;
      if (email.scheduled_at instanceof Date) {
        scheduledDate = email.scheduled_at;
      } else if (typeof email.scheduled_at === 'string') {
        const scheduledStr = email.scheduled_at.replace('Z', '').replace('.000', '');
        scheduledDate = new Date(scheduledStr);
      } else {
        console.log(`[Email Scheduler] Email ${email.id}: invalid scheduled_at type: ${typeof email.scheduled_at}`);
        return false;
      }
      const isDue = scheduledDate <= parisNow;
      console.log(`[Email Scheduler] Email ${email.id}: scheduled=${scheduledDate.toLocaleString('fr-FR')}, now=${parisNow.toLocaleString('fr-FR')}, isDue=${isDue}`);
      return isDue;
    });

    if (scheduledEmails.length === 0) {
      console.log('[Email Scheduler] No emails due yet');
      return { status: 'ok', message: 'No emails due yet', pending: allPending.length, due: 0, processed: 0 };
    }

    console.log(`[Email Scheduler] Processing ${scheduledEmails.length} scheduled email(s)`);

    for (const scheduled of scheduledEmails) {
      const isTestMode = scheduled.test_mode === true || scheduled.test_mode === 1;

      // Check if this email type was already sent manually (block if so) - but NOT for test mode
      if (scheduled.email_type && !isTestMode) {
        const alreadySent = await checkIfAlreadySentManually(
          db,
          scheduled.email_type,
          scheduled.mode,
          scheduled.category,
          scheduled.tournament_id
        );

        if (alreadySent) {
          // Block this scheduled email
          await new Promise((resolve) => {
            db.run(
              `UPDATE scheduled_emails SET status = 'blocked' WHERE id = $1`,
              [scheduled.id],
              () => resolve()
            );
          });
          console.log(`[Email Scheduler] Blocked scheduled email ${scheduled.id} (${scheduled.email_type}) - already manually sent`);
          continue;
        }
      }

      const recipientIds = JSON.parse(scheduled.recipient_ids || '[]');

      // For templated emails (relance, results, finale), recipients need to be fetched dynamically
      if (scheduled.email_type && recipientIds.length === 0) {
        try {
          await processTemplatedScheduledEmail(db, resend, scheduled, delay);
        } catch (error) {
          console.error(`[Email Scheduler] Error processing templated email ${scheduled.id}:`, error.message);
          await new Promise((resolve) => {
            db.run(`UPDATE scheduled_emails SET status = 'failed' WHERE id = $1`, [scheduled.id], () => resolve());
          });
        }
        continue;
      }

      // Get recipients for custom emails
      const placeholders = recipientIds.map((_, i) => `$${i + 1}`).join(',');
      const recipients = await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM player_contacts WHERE id IN (${placeholders})`,
          recipientIds,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      let sentCount = 0;
      const customBaseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
      const customOrgSlug = await appSettings.getOrgSlug(scheduled.organization_id);
      const customLogoUrl = appSettings.buildLogoUrl(customBaseUrl, customOrgSlug);

      for (const recipient of recipients) {
        if (!recipient.email || !recipient.email.includes('@')) continue;

        try {
          const emailBody = scheduled.body
            .replace(/\{player_name\}/g, `${recipient.first_name} ${recipient.last_name}`)
            .replace(/\{first_name\}/g, recipient.first_name || '')
            .replace(/\{last_name\}/g, recipient.last_name || '')
            .replace(/\{club\}/g, recipient.club || '');

          const emailSubject = scheduled.subject
            .replace(/\{player_name\}/g, `${recipient.first_name} ${recipient.last_name}`)
            .replace(/\{first_name\}/g, recipient.first_name || '')
            .replace(/\{last_name\}/g, recipient.last_name || '');

          // Build optional image HTML
          const imageHtml = scheduled.image_url ? `<div style="text-align: center; margin: 20px 0;"><img src="${scheduled.image_url}" alt="Image" style="max-width: 100%; height: auto; border-radius: 8px;"></div>` : '';

          const primaryColor = emailSettings.primary_color || '#1F4788';
          const senderName = emailSettings.email_sender_name || 'CDBHS';
          const senderEmail = emailSettings.email_communication || 'communication@cdbhs.net';
          const orgName = emailSettings.organization_name || 'Comité Départemental de Billard des Hauts-de-Seine';
          const orgShortName = emailSettings.organization_short_name || 'CDBHS';
          const replyToEmail = emailSettings.summary_email || '';

          await resend.emails.send({
            from: `${senderName} <${senderEmail}>`,
            to: [recipient.email],
            replyTo: replyToEmail,
            subject: emailSubject,
            html: `<div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
              <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
                <img src="${customLogoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
                <h1 style="margin: 0; font-size: 24px;">${orgName}</h1>
              </div>
              <div style="padding: 20px; background: #f8f9fa;">${imageHtml}${emailBody.replace(/\n/g, '<br>')}</div>
              <div style="background: ${primaryColor}; color: white; padding: 10px; text-align: center; font-size: 12px;">${orgShortName} - ${replyToEmail}</div>
            </div>`
          });

          sentCount++;
          await delay(1500);
        } catch (error) {
          console.error(`[Email Scheduler] Error sending to ${recipient.email}:`, error.message);
        }
      }

      // Update scheduled email status
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE scheduled_emails SET status = 'completed', sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [scheduled.id],
          function(err) {
            if (err) {
              console.error(`[Email Scheduler] Error updating status for ${scheduled.id}:`, err.message);
              reject(err);
            } else {
              console.log(`[Email Scheduler] Status updated to 'completed' for ${scheduled.id}, rows affected: ${this.changes}`);
              resolve();
            }
          }
        );
      });

      console.log(`[Email Scheduler] Sent ${sentCount}/${recipientIds.length} emails for scheduled ID ${scheduled.id}`);
    }

    return { status: 'ok', message: `Processed ${scheduledEmails.length} email(s)`, pending: allPending.length, due: scheduledEmails.length, processed: scheduledEmails.length };

  } catch (error) {
    console.error('[Email Scheduler] Error:', error.message, error.stack);
    return { status: 'error', message: error.message, stack: error.stack };
  }
}

// Expose for manual triggering via API
global.processScheduledEmails = processScheduledEmails;

// Start server
app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  let localIP = 'localhost';

  // Find the local network IP
  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log(`
╔════════════════════════════════════════════╗
║  French Billiard Ranking System           ║
║  Server running on:                       ║
║  - Local: http://localhost:${PORT}            ║
║  - Network: http://${localIP}:${PORT}${' '.repeat(Math.max(0, 10 - localIP.length))} ║
╚════════════════════════════════════════════╝
  `);

  // Start email scheduler - check every 5 minutes and process any past-due emails
  setInterval(async () => {
    await processScheduledEmails();
  }, 300000); // Check every 5 minutes (300000ms)
  console.log('[Email Scheduler] Started - checking for scheduled emails every 5 minutes');

  // Also run once immediately on startup (after 30 seconds to let DB settle)
  setTimeout(() => processScheduledEmails(), 30000);

  // Tournament alerts scheduler - check every hour for upcoming tournaments
  setInterval(async () => {
    await checkTournamentAlerts();
  }, 3600000); // Check every hour (3600000ms)
  console.log('[Tournament Alerts] Started - checking for upcoming tournaments every hour');

  // Also run tournament alerts check on startup (after 60 seconds)
  setTimeout(() => checkTournamentAlerts(), 60000);

  // Automatic push notification reminders - check daily for tournaments with deadline tomorrow
  async function checkAutomaticReminders() {
    const db = require('./db-loader');
    const { buildNotification } = require('./notification-messages');
    const { sendPushToPlayers } = require('./routes/push');

    console.log('[Automatic Reminders] Starting daily check...');

    try {
      // The inscription deadline for a tournament is `debut - 7 days` (hardcoded in
      // the Player App adapters). A reminder should fire the day BEFORE the deadline,
      // so we need to look at tournaments whose `debut` is in 8 days from today.
      //
      // Before the V2.0.395 fix, this scheduler was looking at `debut = tomorrow`
      // (tournament day, not deadline day), so it was effectively a no-op most of
      // the time — players are already registered or not by then, and the deadline
      // has already passed. See CLAUDE.md "Known Issues" for history.
      const now = new Date();
      const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const deadlineTomorrow = new Date(parisNow);
      deadlineTomorrow.setDate(deadlineTomorrow.getDate() + 8); // 7 days before tournament + 1

      const targetDateStr = deadlineTomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
      console.log(`[Automatic Reminders] Checking for tournaments with inscription deadline tomorrow (tournament date: ${targetDateStr})`);

      // Find all tournaments starting in 8 days (inscription closes tomorrow),
      // excluding finales (they have their own relance system).
      const tournaments = await new Promise((resolve, reject) => {
        db.all(
          `SELECT tournoi_id, nom, mode, categorie, debut, organization_id
           FROM tournoi_ext
           WHERE DATE(debut) = $1
             AND (status IS NULL OR status = 'active')
             AND LOWER(nom) NOT LIKE '%finale%'`,
          [targetDateStr],
          (err, rows) => err ? reject(err) : resolve(rows || [])
        );
      });

      if (tournaments.length === 0) {
        console.log('[Automatic Reminders] No tournaments with inscription deadline tomorrow');
        return;
      }

      console.log(`[Automatic Reminders] Found ${tournaments.length} tournament(s) with deadline tomorrow`);

      // Build player-to-tournaments map (deduplicated)
      const playerTournaments = new Map(); // licence → [tournaments]

      for (const tournament of tournaments) {
        try {
          // Get category to determine eligible players
          const category = await new Promise((resolve, reject) => {
            db.get(
              `SELECT id, game_type, level FROM categories
               WHERE UPPER(game_type) = UPPER($1) AND level = $2
                 AND ($3::int IS NULL OR organization_id = $3)
               LIMIT 1`,
              [tournament.mode, tournament.categorie, tournament.organization_id],
              (err, row) => err ? reject(err) : resolve(row)
            );
          });

          if (!category) {
            console.log(`[Automatic Reminders] Tournament ${tournament.tournoi_id}: category not found, skipping`);
            continue;
          }

          // Get eligible players for this category (not registered yet)
          const eligiblePlayers = await new Promise((resolve, reject) => {
            db.all(
              `SELECT DISTINCT p.licence
               FROM players p
               INNER JOIN categories c ON c.id = $1
               WHERE ($2::int IS NULL OR p.organization_id = $2)
                 AND UPPER(p.licence) NOT LIKE 'TEST%'
                 AND p.licence NOT IN (
                   SELECT licence FROM inscriptions
                   WHERE tournoi_id = $3
                     AND (forfait IS NULL OR forfait != 1)
                     AND (statut IS NULL OR statut NOT IN ('désinscrit', 'indisponible'))
                 )
                 AND (
                   (UPPER(c.game_type) = 'LIBRE' AND p.rank_libre IS NOT NULL)
                   OR (UPPER(c.game_type) = 'CADRE' AND p.rank_cadre IS NOT NULL)
                   OR (UPPER(c.game_type) = 'BANDE' AND p.rank_bande IS NOT NULL)
                   OR (UPPER(c.game_type) = '3 BANDES' AND p.rank_3bandes IS NOT NULL)
                 )`,
              [category.id, tournament.organization_id, tournament.tournoi_id],
              (err, rows) => err ? reject(err) : resolve(rows || [])
            );
          });

          // Add tournament to each eligible player's list
          eligiblePlayers.forEach(player => {
            if (!playerTournaments.has(player.licence)) {
              playerTournaments.set(player.licence, []);
            }
            playerTournaments.get(player.licence).push({
              tournoi_id: tournament.tournoi_id,
              nom: tournament.nom,
              mode: tournament.mode,
              categorie: tournament.categorie,
              debut: tournament.debut,
              organization_id: tournament.organization_id
            });
          });

          console.log(`[Automatic Reminders] Tournament ${tournament.tournoi_id}: ${eligiblePlayers.length} eligible unregistered player(s)`);

        } catch (tournamentError) {
          console.error(`[Automatic Reminders] Error processing tournament ${tournament.tournoi_id}:`, tournamentError.message);
          // Continue with next tournament
        }
      }

      // Send ONE notification per player listing all their eligible tournaments
      let totalSent = 0;
      for (const [licence, tournaments] of playerTournaments.entries()) {
        try {
          // Group by organization (should all be same, but be safe)
          const orgId = tournaments[0].organization_id;

          const tournamentName = tournaments.length === 1
            ? `${tournaments[0].nom} - ${tournaments[0].mode} ${tournaments[0].categorie}`
            : `${tournaments.length} tournois`;

          const closingDate = new Date(tournaments[0].debut).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          const notification = buildNotification('REMINDER_LAST_DAY', {
            tournoiName: tournamentName,
            closingDate: closingDate
          });

          const result = await sendPushToPlayers([licence], orgId, notification);
          totalSent += result.total_sent;

        } catch (playerError) {
          console.error(`[Automatic Reminders] Error sending to player ${licence}:`, playerError.message);
        }
      }

      console.log(`[Automatic Reminders] Total notifications sent: ${totalSent} to ${playerTournaments.size} player(s)`);

      console.log('[Automatic Reminders] Daily check completed');

    } catch (error) {
      console.error('[Automatic Reminders] Error:', error.message);
    }
  }

  // Automatic reminder scheduler - runs daily at 9 AM Paris time
  // ✅ Category filtering (only eligible players)
  // ✅ Deduplication (one notification per player, listing all tournaments)
  setInterval(async () => {
    const now = new Date();
    const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const hour = parisNow.getHours();
    if (hour === 9) {
      await checkAutomaticReminders();
    }
  }, 3600000); // Check every hour
  console.log('[Automatic Reminders] Scheduler enabled - runs daily at 9 AM Paris time');

  // =========================================================================
  // Auto-indisponible scheduler for finale qualifiers (opt-in per org)
  // =========================================================================
  // When enabled, N days before a finale the system marks every qualified
  // player who hasn't registered (neither inscribed nor explicitly renounced)
  // as 'indisponible' with source='auto'. This closes the "silent absentees"
  // gap and gives the admin a deterministic roster before the finale day.
  //
  // Opt-in via per-org settings:
  //   - finale_auto_indisponible_enabled (bool, default false)
  //   - finale_auto_indisponible_days_before (int, default 3)
  //
  // A recap email is sent to summary_email after each run.
  // =========================================================================
  async function checkFinaleAutoIndisponible() {
    const db = require('./db-loader');
    try {
      const now = new Date();
      const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      console.log('[Finale Auto-Indisponible] Daily check started');

      // Get list of organizations with this feature enabled
      const enabledOrgs = await new Promise((resolve, reject) => {
        db.all(
          `SELECT DISTINCT organization_id
             FROM organization_settings
            WHERE setting_key = 'finale_auto_indisponible_enabled'
              AND LOWER(setting_value) = 'true'`,
          [],
          (err, rows) => err ? reject(err) : resolve(rows || [])
        );
      });

      if (enabledOrgs.length === 0) {
        console.log('[Finale Auto-Indisponible] No org opted in, skipping');
        return;
      }

      for (const { organization_id: orgId } of enabledOrgs) {
        try {
          // Read per-org target J-N (how many days before finale to trigger)
          const daysBeforeRow = await new Promise((resolve) => {
            db.get(
              `SELECT setting_value FROM organization_settings
                WHERE organization_id = $1 AND setting_key = 'finale_auto_indisponible_days_before'`,
              [orgId],
              (err, row) => resolve(row)
            );
          });
          const daysBefore = parseInt(daysBeforeRow?.setting_value, 10) || 3;

          const target = new Date(parisNow);
          target.setDate(target.getDate() + daysBefore);
          const targetDateStr = target.toISOString().split('T')[0];

          // Find all finales for this org happening exactly in N days
          const finales = await new Promise((resolve, reject) => {
            db.all(
              `SELECT tournoi_id, nom, mode, categorie, debut, organization_id
                 FROM tournoi_ext
                WHERE DATE(debut) = $1
                  AND (status IS NULL OR status = 'active')
                  AND LOWER(nom) LIKE '%finale%'
                  AND organization_id = $2`,
              [targetDateStr, orgId],
              (err, rows) => err ? reject(err) : resolve(rows || [])
            );
          });

          if (finales.length === 0) {
            console.log(`[Finale Auto-Indisponible] org=${orgId}: no finale on ${targetDateStr}, skipping`);
            continue;
          }

          // Read qualification thresholds for this org
          const qRows = await new Promise((resolve) => {
            db.all(
              `SELECT setting_key, setting_value FROM organization_settings
                WHERE organization_id = $1 AND setting_key IN ('qualification_threshold', 'qualification_small', 'qualification_large')`,
              [orgId],
              (err, rows) => resolve(rows || [])
            );
          });
          const qMap = Object.fromEntries(qRows.map(r => [r.setting_key, r.setting_value]));
          const qThreshold = parseInt(qMap.qualification_threshold, 10) || 9;
          const qSmall = parseInt(qMap.qualification_small, 10) || 4;
          const qLarge = parseInt(qMap.qualification_large, 10) || 6;

          const markedPerFinale = [];

          for (const finale of finales) {
            // Resolve category
            const mode = (finale.mode || '').toUpperCase().replace(/\s+/g, '');
            const level = (finale.categorie || '').toUpperCase();
            const category = await new Promise((resolve) => {
              db.get(
                `SELECT id FROM categories
                  WHERE UPPER(REPLACE(game_type, ' ', '')) = $1
                    AND UPPER(level) = $2
                    AND ($3::int IS NULL OR organization_id = $3)
                  LIMIT 1`,
                [mode, level, orgId],
                (err, row) => resolve(row)
              );
            });
            if (!category) continue;

            // Derive season from finale date
            const finaleDate = new Date(finale.debut);
            const year = finaleDate.getFullYear();
            const month = finaleDate.getMonth();
            const season = month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;

            // Get rankings for this category + season
            const rankings = await new Promise((resolve) => {
              db.all(
                `SELECT r.licence, r.rank_position, p.first_name, p.last_name
                   FROM rankings r
                   LEFT JOIN players p ON REPLACE(r.licence, ' ', '') = REPLACE(p.licence, ' ', '')
                  WHERE r.category_id = $1 AND r.season = $2 AND r.organization_id = $3
                  ORDER BY r.rank_position ASC`,
                [category.id, season, orgId],
                (err, rows) => resolve(rows || [])
              );
            });
            const numFinalists = rankings.length >= qThreshold ? qLarge : qSmall;
            const finalists = rankings.slice(0, numFinalists);

            // Get active inscriptions for this finale
            const active = await new Promise((resolve) => {
              db.all(
                `SELECT licence FROM inscriptions
                  WHERE tournoi_id = $1
                    AND (forfait IS NULL OR forfait != 1)
                    AND (statut IS NULL OR statut NOT IN ('désinscrit', 'indisponible'))
                    AND organization_id = $2`,
                [finale.tournoi_id, orgId],
                (err, rows) => resolve(rows || [])
              );
            });
            const activeLicences = new Set(active.map(i => (i.licence || '').replace(/\s/g, '')));

            // Pending = qualified - active
            const pending = finalists
              .filter(r => !activeLicences.has((r.licence || '').replace(/\s/g, '')))
              .map(r => ({
                licence: (r.licence || '').replace(/\s/g, ''),
                name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.licence,
                rank_position: r.rank_position
              }));

            if (pending.length === 0) {
              console.log(`[Finale Auto-Indisponible] org=${orgId} finale=${finale.tournoi_id}: no pending finalists, nothing to do`);
              continue;
            }

            // Mark each pending player as indisponible (UPSERT pattern: if they
            // have any inscription row for this finale, update it; otherwise
            // INSERT a new one with statut='indisponible').
            for (const p of pending) {
              try {
                const existing = await new Promise((resolve) => {
                  db.get(
                    `SELECT inscription_id, statut FROM inscriptions
                      WHERE tournoi_id = $1
                        AND REPLACE(licence, ' ', '') = $2
                        AND organization_id = $3
                      LIMIT 1`,
                    [finale.tournoi_id, p.licence, orgId],
                    (err, row) => resolve(row)
                  );
                });
                if (existing) {
                  await new Promise((resolve) => {
                    db.run(
                      `UPDATE inscriptions
                          SET statut = 'indisponible', source = 'auto'
                        WHERE inscription_id = $1`,
                      [existing.inscription_id],
                      () => resolve()
                    );
                  });
                } else {
                  await new Promise((resolve) => {
                    db.run(
                      `INSERT INTO inscriptions (inscription_id, tournoi_id, licence, timestamp, source, statut, organization_id)
                       VALUES ((SELECT COALESCE(MAX(inscription_id), 0) + 1 FROM inscriptions), $1, $2, CURRENT_TIMESTAMP, 'auto', 'indisponible', $3)`,
                      [finale.tournoi_id, p.licence, orgId],
                      () => resolve()
                    );
                  });
                }
              } catch (e) {
                console.error(`[Finale Auto-Indisponible] Failed to mark ${p.licence}:`, e.message);
              }
            }

            markedPerFinale.push({
              finale,
              players: pending
            });
          }

          // Send admin recap email
          if (markedPerFinale.length > 0) {
            try {
              const appSettings = require('./utils/app-settings');
              const emailSettings = await appSettings.getOrgSettingsBatch(orgId, [
                'email_convocations', 'email_sender_name', 'summary_email', 'organization_name', 'primary_color'
              ]);
              const adminEmail = emailSettings.summary_email;
              if (adminEmail) {
                const { Resend } = require('resend');
                const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
                if (resend) {
                  const primaryColor = emailSettings.primary_color || '#1F4788';
                  const orgName = emailSettings.organization_name || emailSettings.email_sender_name || 'CDB';
                  const senderName = emailSettings.email_sender_name || 'CDB';
                  const senderEmail = emailSettings.email_convocations || 'noreply@cdbhs.net';

                  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                  const blocks = markedPerFinale.map(entry => {
                    const f = entry.finale;
                    const dateStr = new Date(f.debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                    const rows = entry.players
                      .sort((a, b) => (a.rank_position || 99) - (b.rank_position || 99))
                      .map(p => `<li><strong>${esc(p.name)}</strong> (${p.rank_position}${p.rank_position === 1 ? 'er' : 'ème'}) — licence ${esc(p.licence)}</li>`)
                      .join('');
                    return `
                      <div style="background: white; border-left: 4px solid ${primaryColor}; padding: 12px 16px; margin-bottom: 14px;">
                        <h3 style="margin: 0 0 6px 0; color: ${primaryColor};">${esc(f.nom)} — ${esc(f.mode)} ${esc(f.categorie)}</h3>
                        <p style="margin: 0 0 8px 0; color: #666; font-size: 13px;">📅 ${dateStr}</p>
                        <p style="margin: 0 0 4px 0;"><strong>${entry.players.length}</strong> qualifié(s) marqué(s) indisponibles (pas d'inscription avant J-${daysBefore}) :</p>
                        <ul style="margin: 4px 0 0 20px; padding: 0;">${rows}</ul>
                      </div>`;
                  }).join('');

                  await resend.emails.send({
                    from: `${senderName} <${senderEmail}>`,
                    to: adminEmail,
                    subject: `📬 ${orgName} — Finalistes marqués indisponibles (J-${daysBefore})`,
                    html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: ${primaryColor}; color: white; padding: 18px; text-align: center;">
                          <h1 style="margin: 0; font-size: 20px;">📬 Récapitulatif administrateur</h1>
                          <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Finalistes auto-marqués indisponibles</p>
                        </div>
                        <div style="padding: 20px; background: #f8f9fa;">
                          <p>Les joueurs ci-dessous étaient qualifiés pour une finale dans ${daysBefore} jour(s) mais ne s'étaient pas inscrits. Ils ont été automatiquement marqués comme <strong>indisponibles</strong> (source : <code>auto</code>).</p>
                          ${blocks}
                          <p style="font-size: 12px; color: #666; margin-top: 16px;">Paramètre : <code>finale_auto_indisponible_enabled=true</code>, <code>finale_auto_indisponible_days_before=${daysBefore}</code>. Modifiable dans Paramètres &gt; Organisation.</p>
                        </div>
                      </div>
                    `
                  });
                  console.log(`[Finale Auto-Indisponible] Admin recap sent to ${adminEmail} for org=${orgId}`);
                }
              }
            } catch (mailErr) {
              console.error('[Finale Auto-Indisponible] Admin recap email failed:', mailErr.message);
            }
          }

          const totalMarked = markedPerFinale.reduce((s, e) => s + e.players.length, 0);
          console.log(`[Finale Auto-Indisponible] org=${orgId}: marked ${totalMarked} player(s) across ${markedPerFinale.length} finale(s)`);
        } catch (orgErr) {
          console.error(`[Finale Auto-Indisponible] org=${orgId} error:`, orgErr.message);
        }
      }

      console.log('[Finale Auto-Indisponible] Daily check completed');
    } catch (error) {
      console.error('[Finale Auto-Indisponible] Fatal error:', error.message);
    }
  }

  // Scheduler: runs daily at 9 AM Paris time (same cadence as other schedulers)
  setInterval(async () => {
    const now = new Date();
    const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    if (parisNow.getHours() === 9) {
      await checkFinaleAutoIndisponible();
    }
  }, 3600000); // Check every hour
  console.log('[Finale Auto-Indisponible] Scheduler enabled - runs daily at 9 AM Paris time (opt-in per org)');

  // Survey scheduler - auto-activate scheduled surveys and auto-close expired ones
  async function processSurveySchedule() {
    try {
      // Activate scheduled surveys whose start date has passed
      db.run(
        `UPDATE survey_campaigns SET status = 'active', activated_at = CURRENT_TIMESTAMP
         WHERE status = 'scheduled' AND starts_at <= CURRENT_TIMESTAMP`,
        [],
        function(err) {
          if (err) console.error('[Survey Scheduler] Error activating:', err.message);
          else if (this.changes > 0) console.log(`[Survey Scheduler] Activated ${this.changes} survey(s)`);
        }
      );

      // Close active surveys whose end date has passed
      db.run(
        `UPDATE survey_campaigns SET status = 'closed', closed_at = CURRENT_TIMESTAMP
         WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= CURRENT_TIMESTAMP`,
        [],
        function(err) {
          if (err) console.error('[Survey Scheduler] Error closing:', err.message);
          else if (this.changes > 0) console.log(`[Survey Scheduler] Closed ${this.changes} expired survey(s)`);
        }
      );
    } catch (error) {
      console.error('[Survey Scheduler] Error:', error.message);
    }
  }

  setInterval(processSurveySchedule, 300000); // Check every 5 minutes
  console.log('[Survey Scheduler] Started - checking every 5 minutes');
  setTimeout(processSurveySchedule, 35000); // Run on startup after 35s

  // Reset token cleanup scheduler — wipes expired password-reset tokens from
  // the users table so they don't accumulate indefinitely (security hygiene).
  // Runs daily at 3 AM Paris time (low-traffic window).
  async function cleanupExpiredResetTokens() {
    try {
      const db = require('./db-loader');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET reset_token = NULL, reset_token_expiry = NULL
           WHERE reset_token IS NOT NULL AND reset_token_expiry < NOW()`,
          [],
          function (err) {
            if (err) return reject(err);
            if (this.changes > 0) {
              console.log(`[Reset Token Cleanup] Wiped ${this.changes} expired token(s) from users`);
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('[Reset Token Cleanup] Error:', error.message);
    }
  }
  setInterval(async () => {
    const now = new Date();
    const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    if (parisNow.getHours() === 3) {
      await cleanupExpiredResetTokens();
    }
  }, 3600000); // check every hour, execute only at 3 AM
  setTimeout(cleanupExpiredResetTokens, 60000); // run once 60s after startup
  console.log('[Reset Token Cleanup] Scheduler enabled - runs daily at 3 AM Paris time');

  // Auto-sync contacts on startup (after a short delay to ensure DB is ready)
  setTimeout(async () => {
    try {
      const { syncContacts } = require('./routes/emailing');
      await syncContacts();
      console.log('[Contacts] Auto-sync completed on startup');
    } catch (error) {
      console.error('[Contacts] Auto-sync failed:', error.message);
    }
  }, 5000);
});

module.exports = app;
