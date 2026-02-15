const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db-loader');
const appSettings = require('../utils/app-settings');
const { authenticateToken, requireSuperAdmin } = require('./auth');
const { logAdminAction, ACTION_TYPES } = require('../utils/admin-logger');
const { Resend } = require('resend');

const router = express.Router();

// All routes require super admin
router.use(authenticateToken, requireSuperAdmin);

// Helper: check if a table exists
function tableExists(tableName) {
  return new Promise((resolve) => {
    db.get(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [tableName],
      (err, row) => {
        if (err) return resolve(false);
        resolve(row && row.exists);
      }
    );
  });
}

// Helper: safe count from a table (returns 0 if table doesn't exist)
function safeCount(query, params = []) {
  return new Promise((resolve) => {
    db.get(query, params, (err, row) => {
      if (err) return resolve(0);
      resolve(row ? parseInt(row.count) || 0 : 0);
    });
  });
}

// GET /api/super-admin/dashboard — Platform overview KPIs
router.get('/dashboard', async (req, res) => {
  try {
    const currentSeason = await appSettings.getCurrentSeason();

    // Platform stats
    const ffbCdbsExists = await tableExists('ffb_cdbs');
    const [totalUsers, totalAdmins, totalPlayers, totalClubs, totalPlayerAccounts, totalCdbs] = await Promise.all([
      safeCount(`SELECT COUNT(*) as count FROM users WHERE is_active = 1`),
      safeCount(`SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND role = 'admin'`),
      safeCount(`SELECT COUNT(*) as count FROM players WHERE UPPER(licence) NOT LIKE 'TEST%'`),
      safeCount(`SELECT COUNT(*) as count FROM clubs`),
      safeCount(`SELECT COUNT(*) as count FROM player_accounts`),
      ffbCdbsExists ? safeCount(`SELECT COUNT(*) as count FROM ffb_cdbs`) : Promise.resolve(1) // 1 = current CDB before FFB tables exist
    ]);

    // FFB status
    const cdbCode = await appSettings.getSetting('ffb_cdb_code');
    const lastSync = await appSettings.getSetting('ffb_last_sync_date');

    const ffbLiguesExists = await tableExists('ffb_ligues');
    const ffbClubsExists = await tableExists('ffb_clubs');
    const ffbLicencesExists = await tableExists('ffb_licences');
    const ffbImportLogExists = await tableExists('ffb_import_log');
    const clubFfbMappingExists = await tableExists('club_ffb_mapping');

    let ffbLicencesCount = 0;
    let ffbClubsCount = 0;
    if (ffbLicencesExists) {
      ffbLicencesCount = await safeCount(`SELECT COUNT(*) as count FROM ffb_licences`);
    }
    if (ffbClubsExists) {
      ffbClubsCount = await safeCount(`SELECT COUNT(*) as count FROM ffb_clubs`);
    }

    let ffbStatus = 'not_configured';
    if (cdbCode) {
      ffbStatus = lastSync ? 'synced' : 'configured';
    }

    // System stats
    const lastEmailSent = await new Promise((resolve) => {
      db.get(`SELECT sent_at FROM email_campaigns WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1`, [], (err, row) => {
        resolve(row ? row.sent_at : null);
      });
    });
    const pendingScheduled = await safeCount(`SELECT COUNT(*) as count FROM scheduled_emails WHERE status = 'pending'`);

    const uptimeSeconds = process.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptime = days > 0 ? `${days}j ${hours}h` : `${hours}h`;

    // Implementation progress — auto-detect phases
    const hasImportRecords = ffbImportLogExists ? await safeCount(`SELECT COUNT(*) as count FROM ffb_import_log`) > 0 : false;
    const hasSyncedPlayers = await safeCount(`SELECT COUNT(*) as count FROM players WHERE ffb_last_sync IS NOT NULL`) > 0;
    const hasClubMapping = clubFfbMappingExists ? await safeCount(`SELECT COUNT(*) as count FROM club_ffb_mapping`) > 0 : false;
    const syncMode = await appSettings.getSetting('ffb_sync_mode');

    res.json({
      platform: {
        total_cdbs: totalCdbs,
        total_users: totalUsers,
        total_admins: totalAdmins,
        total_players: totalPlayers,
        total_clubs: totalClubs,
        total_player_accounts: totalPlayerAccounts
      },
      ffb: {
        status: ffbStatus,
        cdb_code: cdbCode || null,
        last_sync: lastSync || null,
        ffb_licences_count: ffbLicencesCount,
        ffb_clubs_count: ffbClubsCount
      },
      system: {
        uptime,
        last_email_sent: lastEmailSent,
        pending_scheduled_emails: pendingScheduled
      },
      implementation_progress: {
        phase_A_db_schema: ffbLiguesExists && ffbClubsExists && ffbLicencesExists,
        phase_B_import: hasImportRecords,
        phase_C_sync: hasSyncedPlayers,
        phase_D_club_mapping: hasClubMapping,
        phase_E_frontend: await tableExists('ffb_licences'), // proxy: if tables exist, frontend likely exists
        phase_F_ftp: syncMode === 'ftp'
      }
    });
  } catch (error) {
    console.error('Super admin dashboard error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement du dashboard' });
  }
});

// GET /api/super-admin/ffb-cdbs — List FFB CDBs for picklist (excludes already-created orgs)
router.get('/ffb-cdbs', async (req, res) => {
  try {
    const cdbs = await dbAll(`
      SELECT c.code, c.ligue_numero, l.nom as ligue_nom,
        (SELECT COUNT(*) FROM ffb_licences fl WHERE fl.cdb_code = c.code) as licence_count,
        (SELECT COUNT(*) FROM ffb_clubs fc WHERE fc.cdb_code = c.code) as club_count
      FROM ffb_cdbs c
      LEFT JOIN ffb_ligues l ON c.ligue_numero = l.numero
      WHERE c.code NOT IN (SELECT ffb_cdb_code FROM organizations WHERE ffb_cdb_code IS NOT NULL)
      ORDER BY l.nom, c.code
    `);
    res.json(cdbs);
  } catch (error) {
    console.error('Error listing FFB CDBs:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// GET /api/super-admin/users — List all users
router.get('/users', (req, res) => {
  db.all(
    `SELECT id, username, email, role, is_active, is_super_admin, club_id, last_login, created_at FROM users ORDER BY id`,
    [],
    (err, users) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.status(500).json({ error: 'Erreur base de données' });
      }
      res.json(users || []);
    }
  );
});

// PUT /api/super-admin/users/:id/super-admin — Grant/revoke super admin
router.put('/users/:id/super-admin', (req, res) => {
  const { id } = req.params;
  const { is_super_admin } = req.body;

  if (typeof is_super_admin !== 'boolean') {
    return res.status(400).json({ error: 'is_super_admin doit être un booléen' });
  }

  // Prevent removing your own super admin
  if (parseInt(id) === req.user.userId && !is_super_admin) {
    return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre accès Super Admin' });
  }

  db.run(
    `UPDATE users SET is_super_admin = $1 WHERE id = $2`,
    [is_super_admin, id],
    function(err) {
      if (err) {
        console.error('Error updating super admin status:', err);
        return res.status(500).json({ error: 'Erreur base de données' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      logAdminAction({
        req,
        action: ACTION_TYPES.USER_UPDATED,
        targetType: 'user',
        targetId: id,
        details: `Super Admin ${is_super_admin ? 'accordé' : 'retiré'} pour utilisateur #${id}`
      });

      res.json({ success: true, message: `Super Admin ${is_super_admin ? 'accordé' : 'retiré'}` });
    }
  );
});

// GET /api/super-admin/health — System health check
router.get('/health', async (req, res) => {
  try {
    // Test DB connection
    const dbOk = await new Promise((resolve) => {
      db.get('SELECT 1 as ok', [], (err) => resolve(!err));
    });

    const uptimeSeconds = process.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    res.json({
      status: dbOk ? 'healthy' : 'degraded',
      database: dbOk ? 'connected' : 'error',
      uptime: `${days}j ${hours}h ${minutes}m`,
      uptime_seconds: Math.floor(uptimeSeconds),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
        heap_used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
      },
      node_version: process.version
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// ==================== Promise helpers ====================
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
  });
}

// ==================== ORGANIZATIONS (CDB Management) ====================

// GET /api/super-admin/organizations — List all CDBs
router.get('/organizations', async (req, res) => {
  try {
    const orgs = await dbAll(`
      SELECT o.*,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) as user_count,
        (SELECT COUNT(*) FROM players p WHERE p.organization_id = o.id AND UPPER(p.licence) NOT LIKE 'TEST%') as player_count,
        (SELECT COUNT(*) FROM clubs c WHERE c.organization_id = o.id) as club_count
      FROM organizations o
      ORDER BY o.id
    `);
    res.json(orgs);
  } catch (error) {
    console.error('Error listing organizations:', error);
    res.status(500).json({ error: 'Erreur lors du chargement des organisations' });
  }
});

// POST /api/super-admin/organizations — Create new CDB + admin user
router.post('/organizations', async (req, res) => {
  const { name, short_name, slug, ffb_cdb_code, ffb_ligue_numero, admin_username, admin_email, admin_password } = req.body;

  if (!name || !short_name || !slug || !admin_username || !admin_password) {
    return res.status(400).json({ error: 'Champs requis: name, short_name, slug, admin_username, admin_password' });
  }

  try {
    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'Le slug ne doit contenir que des lettres minuscules, chiffres et tirets' });
    }

    // Check unique constraints
    const existing = await dbGet(
      `SELECT id FROM organizations WHERE slug = $1 OR short_name = $2`,
      [slug, short_name]
    );
    if (existing) {
      return res.status(409).json({ error: 'Un CDB avec ce slug ou nom court existe déjà' });
    }

    const existingUser = await dbGet(`SELECT id FROM users WHERE username = $1`, [admin_username]);
    if (existingUser) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    }

    // Create organization
    const orgResult = await dbRun(
      `INSERT INTO organizations (name, short_name, slug, ffb_cdb_code, ffb_ligue_numero)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, short_name, slug, ffb_cdb_code || null, ffb_ligue_numero || null]
    );
    const orgId = orgResult.lastID;

    // Seed default organization settings
    const defaultOrgSettings = [
      ['organization_name', name],
      ['organization_short_name', short_name],
      ['primary_color', '#1F4788'],
      ['secondary_color', '#667EEA'],
      ['accent_color', '#FFC107'],
      ['background_color', '#FFFFFF'],
      ['background_secondary_color', '#F5F5F5'],
      ['email_communication', admin_email || ''],
      ['email_convocations', admin_email || ''],
      ['email_noreply', admin_email || ''],
      ['email_sender_name', short_name]
    ];

    for (const [key, value] of defaultOrgSettings) {
      await dbRun(
        `INSERT INTO organization_settings (organization_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [orgId, key, value]
      );
    }

    // Create admin user
    const passwordHash = await bcrypt.hash(admin_password, 10);
    await dbRun(
      `INSERT INTO users (username, password_hash, email, role, is_active, organization_id)
       VALUES ($1, $2, $3, 'admin', 1, $4)`,
      [admin_username, passwordHash, admin_email || null, orgId]
    );

    logAdminAction({
      req,
      action: ACTION_TYPES.USER_CREATED || 'user_created',
      targetType: 'organization',
      targetId: orgId,
      details: `Organisation "${short_name}" créée avec admin "${admin_username}"`
    });

    res.json({
      success: true,
      organization: {
        id: orgId,
        name,
        short_name,
        slug,
        ffb_cdb_code,
        ffb_ligue_numero
      },
      login_url: `/login.html?org=${slug}`,
      message: `Organisation "${short_name}" créée avec succès`
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'organisation: ' + error.message });
  }
});

// PUT /api/super-admin/organizations/:id — Update CDB info
router.put('/organizations/:id', async (req, res) => {
  const { id } = req.params;
  const { name, short_name, ffb_cdb_code, ffb_ligue_numero } = req.body;

  try {
    await dbRun(
      `UPDATE organizations SET
        name = COALESCE($1, name),
        short_name = COALESCE($2, short_name),
        ffb_cdb_code = COALESCE($3, ffb_cdb_code),
        ffb_ligue_numero = COALESCE($4, ffb_ligue_numero),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [name || null, short_name || null, ffb_cdb_code || null, ffb_ligue_numero || null, id]
    );

    // Also update org settings if name/short_name changed
    if (name) await appSettings.setOrgSetting(parseInt(id), 'organization_name', name);
    if (short_name) await appSettings.setOrgSetting(parseInt(id), 'organization_short_name', short_name);

    res.json({ success: true, message: 'Organisation mise à jour' });
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// PUT /api/super-admin/organizations/:id/toggle-active — Activate/deactivate
router.put('/organizations/:id/toggle-active', async (req, res) => {
  const { id } = req.params;

  try {
    const org = await dbGet(`SELECT id, is_active, short_name FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });

    const newState = !org.is_active;
    await dbRun(`UPDATE organizations SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newState, id]);

    logAdminAction({
      req,
      action: ACTION_TYPES.USER_UPDATED || 'user_updated',
      targetType: 'organization',
      targetId: id,
      details: `Organisation "${org.short_name}" ${newState ? 'activée' : 'désactivée'}`
    });

    res.json({ success: true, is_active: newState, message: `Organisation ${newState ? 'activée' : 'désactivée'}` });
  } catch (error) {
    console.error('Error toggling organization:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// ==================== PLAYER SEEDING FROM FFB ====================

// GET /api/super-admin/organizations/:id/seed-preview — Preview FFB licences for this CDB
router.get('/organizations/:id/seed-preview', async (req, res) => {
  const { id } = req.params;

  try {
    const org = await dbGet(`SELECT id, short_name, ffb_cdb_code FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });
    if (!org.ffb_cdb_code) return res.status(400).json({ error: 'Code CDB FFB non configuré pour cette organisation' });

    // Count FFB licences for this CDB code
    const countRow = await dbGet(
      `SELECT COUNT(*) as count FROM ffb_licences WHERE cdb_code = $1`,
      [org.ffb_cdb_code]
    );
    const totalFfb = parseInt(countRow?.count || 0);

    // Count already imported players for this org
    const existingRow = await dbGet(
      `SELECT COUNT(*) as count FROM players WHERE organization_id = $1 AND UPPER(licence) NOT LIKE 'TEST%'`,
      [id]
    );
    const existingPlayers = parseInt(existingRow?.count || 0);

    // Get a preview of first 10 licences
    const preview = await dbAll(
      `SELECT licence, prenom, nom, categorie, discipline FROM ffb_licences WHERE cdb_code = $1 ORDER BY nom, prenom LIMIT 10`,
      [org.ffb_cdb_code]
    );

    res.json({
      organization: org.short_name,
      ffb_cdb_code: org.ffb_cdb_code,
      ffb_licences_count: totalFfb,
      existing_players: existingPlayers,
      preview
    });
  } catch (error) {
    console.error('Error previewing seed:', error);
    res.status(500).json({ error: 'Erreur lors de la prévisualisation' });
  }
});

// POST /api/super-admin/organizations/:id/seed-players — Seed players from FFB licences
router.post('/organizations/:id/seed-players', async (req, res) => {
  const { id } = req.params;

  try {
    const org = await dbGet(`SELECT id, short_name, ffb_cdb_code FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });
    if (!org.ffb_cdb_code) return res.status(400).json({ error: 'Code CDB FFB non configuré pour cette organisation' });

    // Get all FFB licences for this CDB
    const ffbLicences = await dbAll(
      `SELECT fl.*, fc.nom_court as club_name
       FROM ffb_licences fl
       LEFT JOIN ffb_clubs fc ON fl.num_club = fc.numero
       WHERE fl.cdb_code = $1`,
      [org.ffb_cdb_code]
    );

    if (ffbLicences.length === 0) {
      return res.json({ success: true, message: 'Aucune licence FFB trouvée', created: 0, updated: 0 });
    }

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const fl of ffbLicences) {
      try {
        // Check if player already exists (by licence)
        const existing = await dbGet(
          `SELECT licence FROM players WHERE REPLACE(licence, ' ', '') = REPLACE($1, ' ', '')`,
          [fl.licence]
        );

        if (existing) {
          // Update: set organization_id and enrich with FFB data
          await dbRun(
            `UPDATE players SET
              organization_id = $1,
              date_of_birth = COALESCE($2, date_of_birth),
              sexe = COALESCE($3, sexe),
              ffb_categorie = COALESCE($4, ffb_categorie),
              discipline = COALESCE($5, discipline),
              nationalite = COALESCE($6, nationalite),
              ffb_club_numero = COALESCE($7, ffb_club_numero),
              ffb_last_sync = CURRENT_TIMESTAMP
             WHERE REPLACE(licence, ' ', '') = REPLACE($8, ' ', '')`,
            [id, fl.date_de_naissance, fl.sexe, fl.categorie, fl.discipline, fl.nationalite, fl.num_club, fl.licence]
          );
          updated++;
        } else {
          // Create new player
          const clubName = fl.club_name || '';
          await dbRun(
            `INSERT INTO players (licence, first_name, last_name, club, date_of_birth, sexe, ffb_categorie, discipline, nationalite, ffb_club_numero, email, organization_id, ffb_last_sync)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)`,
            [fl.licence, fl.prenom || '', fl.nom || '', clubName, fl.date_de_naissance, fl.sexe, fl.categorie, fl.discipline, fl.nationalite, fl.num_club, fl.email || null, id]
          );
          created++;
        }
      } catch (playerErr) {
        console.error(`Error seeding player ${fl.licence}:`, playerErr.message);
        errors++;
      }
    }

    logAdminAction({
      req,
      action: ACTION_TYPES.USER_CREATED || 'user_created',
      targetType: 'organization',
      targetId: id,
      details: `Joueurs importés pour ${org.short_name}: ${created} créés, ${updated} mis à jour, ${errors} erreurs`
    });

    res.json({
      success: true,
      organization: org.short_name,
      total_ffb: ffbLicences.length,
      created,
      updated,
      errors,
      message: `${created} joueurs créés, ${updated} mis à jour`
    });
  } catch (error) {
    console.error('Error seeding players:', error);
    res.status(500).json({ error: 'Erreur lors de l\'import des joueurs: ' + error.message });
  }
});

// ==================== WELCOME EMAIL ====================

// GET /api/super-admin/email-templates/cdb_welcome — Get welcome template
router.get('/email-templates/cdb_welcome', async (req, res) => {
  try {
    const subject = await dbGet(
      `SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_subject'`
    );
    const body = await dbGet(
      `SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_body'`
    );

    res.json({
      subject: subject?.value || 'Bienvenue sur la Plateforme Gestion des Tournois CDB - {organization_short_name}',
      body: body?.value || ''
    });
  } catch (error) {
    console.error('Error fetching welcome template:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// PUT /api/super-admin/email-templates/cdb_welcome — Update welcome template
router.put('/email-templates/cdb_welcome', async (req, res) => {
  const { subject, body } = req.body;

  try {
    if (subject !== undefined) {
      await dbRun(
        `INSERT INTO organization_settings (organization_id, key, value, updated_at)
         VALUES (1, 'cdb_welcome_subject', $1, CURRENT_TIMESTAMP)
         ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [subject]
      );
    }
    if (body !== undefined) {
      await dbRun(
        `INSERT INTO organization_settings (organization_id, key, value, updated_at)
         VALUES (1, 'cdb_welcome_body', $1, CURRENT_TIMESTAMP)
         ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [body]
      );
    }
    res.json({ success: true, message: 'Template mis à jour' });
  } catch (error) {
    console.error('Error updating welcome template:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// POST /api/super-admin/email-templates/cdb_welcome/test — Send test email with sample data (no org needed)
router.post('/email-templates/cdb_welcome/test', async (req, res) => {
  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ error: 'RESEND_API_KEY non configurée' });
    }

    // Get super admin email
    const superAdmin = await dbGet(`SELECT email FROM users WHERE id = $1`, [req.user.userId]);
    if (!superAdmin?.email) {
      return res.status(400).json({ error: 'Votre compte n\'a pas d\'adresse email configurée' });
    }

    // Sample data from request body (from create form) or defaults
    const sampleData = req.body || {};

    // Get template
    const subjectRow = await dbGet(`SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_subject'`);
    const bodyRow = await dbGet(`SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_body'`);

    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    const sampleSlug = sampleData.slug || 'cdb-exemple';

    const variables = {
      admin_name: sampleData.admin_username || 'admin_exemple',
      organization_name: sampleData.name || 'Comité Départemental de Billard Exemple',
      organization_short_name: sampleData.short_name || 'CDB00',
      login_url: `${baseUrl}/login.html?org=${sampleSlug}`,
      username: sampleData.admin_username || 'admin_exemple',
      player_count: sampleData.player_count || '250'
    };

    let subject = subjectRow?.value || 'Bienvenue - {organization_short_name}';
    let body = bodyRow?.value || '';

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      subject = subject.replace(regex, value);
      const htmlRegex = new RegExp(`\\{(<[^>]*>)*${key}(<[^>]*>)*\\}`, 'gi');
      body = body.replace(htmlRegex, value);
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const senderEmail = await appSettings.getSetting('email_noreply') || 'noreply@cdbhs.net';
    const senderName = await appSettings.getSetting('email_sender_name') || 'CDB Tournois';

    await resend.emails.send({
      from: `${senderName} <${senderEmail}>`,
      to: [superAdmin.email],
      subject: `[TEST] ${subject}`,
      html: body
    });

    res.json({ success: true, message: `Email de test envoyé à ${superAdmin.email}` });
  } catch (error) {
    console.error('Error sending test welcome email:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi: ' + error.message });
  }
});

// POST /api/super-admin/organizations/:id/send-welcome-test — Send test email to super admin (for existing org)
router.post('/organizations/:id/send-welcome-test', async (req, res) => {
  const { id } = req.params;

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ error: 'RESEND_API_KEY non configurée' });
    }

    const org = await dbGet(`SELECT * FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });

    // Get super admin email
    const superAdmin = await dbGet(`SELECT email FROM users WHERE id = $1`, [req.user.userId]);
    if (!superAdmin?.email) {
      return res.status(400).json({ error: 'Votre compte n\'a pas d\'adresse email configurée' });
    }

    // Get admin user for this org
    const orgAdmin = await dbGet(`SELECT username, email FROM users WHERE organization_id = $1 AND role = 'admin' LIMIT 1`, [id]);

    // Count players
    const playerCount = await dbGet(
      `SELECT COUNT(*) as count FROM players WHERE organization_id = $1 AND UPPER(licence) NOT LIKE 'TEST%'`,
      [id]
    );

    // Get template
    const subjectRow = await dbGet(`SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_subject'`);
    const bodyRow = await dbGet(`SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_body'`);

    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    const loginUrl = `${baseUrl}/login.html?org=${org.slug}`;

    // Replace variables
    const variables = {
      admin_name: orgAdmin?.username || 'Admin',
      organization_name: org.name,
      organization_short_name: org.short_name,
      login_url: loginUrl,
      username: orgAdmin?.username || 'admin',
      player_count: String(parseInt(playerCount?.count || 0))
    };

    let subject = subjectRow?.value || 'Bienvenue - {organization_short_name}';
    let body = bodyRow?.value || '';

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      subject = subject.replace(regex, value);
      // Handle HTML-wrapped variables like {<strong>admin_name</strong>}
      const htmlRegex = new RegExp(`\\{(<[^>]*>)*${key}(<[^>]*>)*\\}`, 'gi');
      body = body.replace(htmlRegex, value);
    }

    // Send test email to super admin
    const resend = new Resend(process.env.RESEND_API_KEY);
    const senderEmail = await appSettings.getSetting('email_noreply') || 'noreply@cdbhs.net';
    const senderName = await appSettings.getSetting('email_sender_name') || 'CDB Tournois';

    await resend.emails.send({
      from: `${senderName} <${senderEmail}>`,
      to: [superAdmin.email],
      subject: `[TEST] ${subject}`,
      html: body
    });

    res.json({ success: true, message: `Email de test envoyé à ${superAdmin.email}` });
  } catch (error) {
    console.error('Error sending test welcome email:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi: ' + error.message });
  }
});

// POST /api/super-admin/organizations/:id/send-welcome — Send welcome email to CDB admin
router.post('/organizations/:id/send-welcome', async (req, res) => {
  const { id } = req.params;

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ error: 'RESEND_API_KEY non configurée' });
    }

    const org = await dbGet(`SELECT * FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });

    // Get admin user for this org
    const orgAdmin = await dbGet(`SELECT username, email FROM users WHERE organization_id = $1 AND role = 'admin' LIMIT 1`, [id]);
    if (!orgAdmin?.email) {
      return res.status(400).json({ error: 'L\'administrateur de cette organisation n\'a pas d\'adresse email' });
    }

    // Count players
    const playerCount = await dbGet(
      `SELECT COUNT(*) as count FROM players WHERE organization_id = $1 AND UPPER(licence) NOT LIKE 'TEST%'`,
      [id]
    );

    // Get template
    const subjectRow = await dbGet(`SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_subject'`);
    const bodyRow = await dbGet(`SELECT value FROM organization_settings WHERE organization_id = 1 AND key = 'cdb_welcome_body'`);

    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    const loginUrl = `${baseUrl}/login.html?org=${org.slug}`;

    // Replace variables
    const variables = {
      admin_name: orgAdmin.username,
      organization_name: org.name,
      organization_short_name: org.short_name,
      login_url: loginUrl,
      username: orgAdmin.username,
      player_count: String(parseInt(playerCount?.count || 0))
    };

    let subject = subjectRow?.value || 'Bienvenue - {organization_short_name}';
    let body = bodyRow?.value || '';

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      subject = subject.replace(regex, value);
      const htmlRegex = new RegExp(`\\{(<[^>]*>)*${key}(<[^>]*>)*\\}`, 'gi');
      body = body.replace(htmlRegex, value);
    }

    // Send email to CDB admin
    const resend = new Resend(process.env.RESEND_API_KEY);
    const senderEmail = await appSettings.getSetting('email_noreply') || 'noreply@cdbhs.net';
    const senderName = await appSettings.getSetting('email_sender_name') || 'CDB Tournois';

    await resend.emails.send({
      from: `${senderName} <${senderEmail}>`,
      to: [orgAdmin.email],
      subject,
      html: body
    });

    logAdminAction({
      req,
      action: ACTION_TYPES.USER_UPDATED || 'user_updated',
      targetType: 'organization',
      targetId: id,
      details: `Email de bienvenue envoyé à ${orgAdmin.email} pour ${org.short_name}`
    });

    res.json({ success: true, message: `Email de bienvenue envoyé à ${orgAdmin.email}` });
  } catch (error) {
    console.error('Error sending welcome email:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi: ' + error.message });
  }
});

module.exports = router;
