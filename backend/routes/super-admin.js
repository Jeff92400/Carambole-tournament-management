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

// GET /api/super-admin/dashboard — FFB file data + CDB enrolments
router.get('/dashboard', async (req, res) => {
  try {
    // FFB file data
    const ffbLiguesExists = await tableExists('ffb_ligues');
    const ffbClubsExists = await tableExists('ffb_clubs');
    const ffbLicencesExists = await tableExists('ffb_licences');
    const ffbCdbsExists = await tableExists('ffb_cdbs');
    const ffbImportLogExists = await tableExists('ffb_import_log');

    const [ffbLiguesCount, ffbCdbsCount, ffbClubsCount, ffbLicencesCount] = await Promise.all([
      ffbLiguesExists ? safeCount(`SELECT COUNT(*) as count FROM ffb_ligues`) : Promise.resolve(0),
      ffbCdbsExists ? safeCount(`SELECT COUNT(*) as count FROM ffb_cdbs`) : Promise.resolve(0),
      ffbClubsExists ? safeCount(`SELECT COUNT(*) as count FROM ffb_clubs`) : Promise.resolve(0),
      ffbLicencesExists ? safeCount(`SELECT COUNT(*) as count FROM ffb_licences`) : Promise.resolve(0)
    ]);

    // Last FFB import info
    let lastImport = null;
    if (ffbImportLogExists) {
      lastImport = await dbGet(
        `SELECT file_type, filename, record_count, imported_at FROM ffb_import_log ORDER BY imported_at DESC LIMIT 1`
      );
    }

    // CDB enrolments — progressive list ordered by creation, with ligue name
    const enrolments = await dbAll(`
      SELECT o.id, o.name, o.short_name, o.slug, o.ffb_cdb_code, o.ffb_ligue_numero, o.is_active, o.created_at,
        l.nom as ligue_nom,
        (SELECT COUNT(*) FROM players p WHERE p.organization_id = o.id AND UPPER(p.licence) NOT LIKE 'TEST%') as player_count,
        (SELECT COUNT(*) FROM clubs c WHERE c.organization_id = o.id) as club_count,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id AND u.is_active = 1) as user_count
      FROM organizations o
      LEFT JOIN ffb_ligues l ON o.ffb_ligue_numero = l.numero
      ORDER BY o.id
    `);

    // Platform aggregates (across all enrolled CDBs)
    const tournamentCount = await safeCount(`SELECT COUNT(*) as count FROM tournoi_ext WHERE organization_id IS NOT NULL`);
    const platform = {
      cdbs: enrolments.filter(e => e.is_active).length,
      players: enrolments.reduce((sum, e) => sum + parseInt(e.player_count || 0), 0),
      clubs: enrolments.reduce((sum, e) => sum + parseInt(e.club_count || 0), 0),
      users: enrolments.reduce((sum, e) => sum + parseInt(e.user_count || 0), 0),
      tournaments: tournamentCount
    };

    res.json({
      ffb_file: {
        ligues: ffbLiguesCount,
        cdbs: ffbCdbsCount,
        clubs: ffbClubsCount,
        licences: ffbLicencesCount,
        last_import: lastImport
      },
      platform,
      enrolments
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

// GET /api/super-admin/ffb-licences/search — Search FFB licences by name for a CDB
router.get('/ffb-licences/search', async (req, res) => {
  const { cdb_code, q } = req.query;
  if (!cdb_code || !q || q.length < 2) {
    return res.json([]);
  }

  try {
    const search = `%${q.toUpperCase()}%`;
    const results = await dbAll(`
      SELECT licence, prenom, nom, email,
        raw_data->>'Tel_fixe' as tel_fixe,
        raw_data->>'Tel_port' as tel_port,
        categorie, discipline, num_club
      FROM ffb_licences
      WHERE cdb_code = $1
        AND (UPPER(nom) LIKE $2 OR UPPER(prenom) LIKE $2 OR licence LIKE $2)
      ORDER BY nom, prenom
      LIMIT 20
    `, [cdb_code, search]);
    res.json(results);
  } catch (error) {
    console.error('Error searching FFB licences:', error);
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

// POST /api/super-admin/ligue-admins — Create a ligue admin user
router.post('/ligue-admins', async (req, res) => {
  const { username, email, password, ffb_ligue_numero } = req.body;

  if (!username || !password || !ffb_ligue_numero) {
    return res.status(400).json({ error: 'Champs requis: username, password, ffb_ligue_numero' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  try {
    // Validate ligue exists
    const ligue = await dbGet(`SELECT numero, nom FROM ffb_ligues WHERE numero = $1`, [ffb_ligue_numero]);
    if (!ligue) {
      return res.status(404).json({ error: 'Ligue introuvable' });
    }

    // Check username uniqueness
    const existing = await dbGet(`SELECT id FROM users WHERE username = $1`, [username]);
    if (existing) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await dbRun(
      `INSERT INTO users (username, password_hash, email, role, is_active, ffb_ligue_numero)
       VALUES ($1, $2, $3, 'ligue_admin', 1, $4)`,
      [username, passwordHash, email || null, ffb_ligue_numero]
    );

    logAdminAction({
      req,
      action: ACTION_TYPES.USER_CREATED,
      targetType: 'user',
      targetId: result.lastID,
      details: `Admin ligue créé: ${username} pour ligue ${ligue.nom} (${ffb_ligue_numero})`
    });

    res.status(201).json({
      success: true,
      message: `Admin ligue créé pour ${ligue.nom}`,
      user: { id: result.lastID, username, role: 'ligue_admin', ffb_ligue_numero, ligue_nom: ligue.nom }
    });
  } catch (error) {
    console.error('Error creating ligue admin:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'admin ligue' });
  }
});

// GET /api/super-admin/ligue-admins — List ligue admin users
router.get('/ligue-admins', async (req, res) => {
  try {
    const admins = await dbAll(`
      SELECT u.id, u.username, u.email, u.ffb_ligue_numero, u.is_active, u.last_login, u.created_at,
             l.nom as ligue_nom
      FROM users u
      LEFT JOIN ffb_ligues l ON u.ffb_ligue_numero = l.numero
      WHERE u.role = 'ligue_admin'
      ORDER BY l.nom, u.username
    `);
    res.json(admins);
  } catch (error) {
    console.error('Error listing ligue admins:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// PUT /api/super-admin/ligue-admins/:id/toggle-active — Activate/deactivate a ligue admin
router.put('/ligue-admins/:id/toggle-active', async (req, res) => {
  const { id } = req.params;

  try {
    const user = await dbGet(`SELECT id, username, is_active, role FROM users WHERE id = $1 AND role = 'ligue_admin'`, [id]);
    if (!user) return res.status(404).json({ error: 'Admin ligue non trouvé' });

    const newState = !user.is_active;
    await dbRun(`UPDATE users SET is_active = $1 WHERE id = $2`, [newState, id]);

    logAdminAction({
      req,
      action: ACTION_TYPES.USER_UPDATED,
      targetType: 'user',
      targetId: id,
      details: `Admin ligue "${user.username}" ${newState ? 'activé' : 'désactivé'}`
    });

    res.json({ success: true, is_active: newState, message: `Admin ligue ${newState ? 'activé' : 'désactivé'}` });
  } catch (error) {
    console.error('Error toggling ligue admin:', error);
    res.status(500).json({ error: 'Erreur' });
  }
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

    // Seed default organization settings (FFB colors = "not yet customized" signal)
    const defaultOrgSettings = [
      ['organization_name', name],
      ['organization_short_name', short_name],
      ['primary_color', '#C41E3A'],
      ['secondary_color', '#1F4788'],
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

    // Seed default categories (copy from org #1)
    const refCategories = await dbAll(`SELECT game_type, level, display_name, is_active FROM categories WHERE organization_id = 1`);
    for (const cat of refCategories) {
      await dbRun(
        `INSERT INTO categories (game_type, level, display_name, is_active, organization_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [cat.game_type, cat.level, cat.display_name, cat.is_active, orgId]
      );
    }

    // Seed default game parameters (copy from org #1)
    const refGameParams = await dbAll(`SELECT mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi FROM game_parameters WHERE organization_id = 1`);
    for (const gp of refGameParams) {
      await dbRun(
        `INSERT INTO game_parameters (mode, categorie, coin, distance_normale, distance_reduite, reprises, moyenne_mini, moyenne_maxi, organization_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [gp.mode, gp.categorie, gp.coin, gp.distance_normale, gp.distance_reduite, gp.reprises, gp.moyenne_mini, gp.moyenne_maxi, orgId]
      );
    }

    // Seed default scoring rules (copy from org #1)
    const refScoringRules = await dbAll(`SELECT rule_type, condition_key, points, display_order, description, is_active, field_1, operator_1, value_1, logical_op, field_2, operator_2, value_2, column_label FROM scoring_rules WHERE organization_id = 1`);
    for (const sr of refScoringRules) {
      await dbRun(
        `INSERT INTO scoring_rules (rule_type, condition_key, points, display_order, description, is_active, field_1, operator_1, value_1, logical_op, field_2, operator_2, value_2, column_label, organization_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING`,
        [sr.rule_type, sr.condition_key, sr.points, sr.display_order, sr.description, sr.is_active, sr.field_1, sr.operator_1, sr.value_1, sr.logical_op, sr.field_2, sr.operator_2, sr.value_2, sr.column_label, orgId]
      );
    }

    // Seed default email templates (copy from org #1)
    const refTemplates = await dbAll(`SELECT template_key, subject_template, body_template, outro_template FROM email_templates WHERE organization_id = 1`);
    for (const tpl of refTemplates) {
      await dbRun(
        `INSERT INTO email_templates (template_key, subject_template, body_template, outro_template, organization_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [tpl.template_key, tpl.subject_template, tpl.body_template, tpl.outro_template, orgId]
      );
    }

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

// DELETE /api/super-admin/organizations/:id — Fully delete a CDB and all its data
router.delete('/organizations/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const org = await dbGet(`SELECT id, short_name, name FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });

    // Safety: prevent deleting org id=1 (primary CDB)
    if (parseInt(id) === 1) {
      return res.status(403).json({ error: 'Impossible de supprimer l\'organisation principale' });
    }

    // Cascade delete all org-scoped data in dependency order
    const tables = [
      'player_accounts',
      'player_contacts',
      'activity_logs',
      'player_invitations',
      'scheduled_emails',
      'email_campaigns',
      'announcements',
      'inscriptions',
      'rankings',
      'tournaments',
      'tournoi_ext',
      'scoring_rules',
      'game_parameters',
      'email_templates',
      'categories',
      'players',
      'clubs',
      'users',
      'organization_settings',
      'organization_logo'
    ];

    const counts = {};
    for (const table of tables) {
      try {
        const result = await dbRun(
          `DELETE FROM ${table} WHERE organization_id = $1`,
          [id]
        );
        counts[table] = result.rowCount || 0;
      } catch (err) {
        // Table might not exist or have no organization_id column — skip
        counts[table] = 0;
      }
    }

    // Delete the organization itself
    await dbRun(`DELETE FROM organizations WHERE id = $1`, [id]);

    // Log the action
    try {
      await logAdminAction({
        req,
        action: ACTION_TYPES.DELETE,
        target_type: 'organization',
        target_id: id,
        details: `Organisation "${org.short_name}" (${org.name}) supprimée avec toutes ses données`
      });
    } catch (logErr) {
      // Don't fail if logging fails
    }

    res.json({
      success: true,
      message: `Organisation "${org.short_name}" supprimée`,
      deleted: counts
    });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
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

    // Sample data from request body (from create form) or defaults
    const sampleData = req.body || {};

    // Use test email from request, or fall back to super admin's email
    let recipientEmail = sampleData.test_email;
    if (!recipientEmail) {
      const superAdmin = await dbGet(`SELECT email FROM users WHERE id = $1`, [req.user.userId]);
      recipientEmail = superAdmin?.email;
    }
    if (!recipientEmail) {
      return res.status(400).json({ error: 'Veuillez saisir une adresse email de test' });
    }

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
      to: [recipientEmail],
      subject: `[TEST] ${subject}`,
      html: body
    });

    res.json({ success: true, message: `Email de test envoyé à ${recipientEmail}` });
  } catch (error) {
    console.error('Error sending test welcome email:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi: ' + error.message });
  }
});

// POST /api/super-admin/organizations/:id/send-welcome-test — Send test email (for existing org)
router.post('/organizations/:id/send-welcome-test', async (req, res) => {
  const { id } = req.params;

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ error: 'RESEND_API_KEY non configurée' });
    }

    const org = await dbGet(`SELECT * FROM organizations WHERE id = $1`, [id]);
    if (!org) return res.status(404).json({ error: 'Organisation non trouvée' });

    // Use test email from request, or fall back to super admin's email
    const sampleData = req.body || {};
    let recipientEmail = sampleData.test_email;
    if (!recipientEmail) {
      const superAdmin = await dbGet(`SELECT email FROM users WHERE id = $1`, [req.user.userId]);
      recipientEmail = superAdmin?.email;
    }
    if (!recipientEmail) {
      return res.status(400).json({ error: 'Veuillez saisir une adresse email de test' });
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

    // Send test email
    const resend = new Resend(process.env.RESEND_API_KEY);
    const senderEmail = await appSettings.getSetting('email_noreply') || 'noreply@cdbhs.net';
    const senderName = await appSettings.getSetting('email_sender_name') || 'CDB Tournois';

    await resend.emails.send({
      from: `${senderName} <${senderEmail}>`,
      to: [recipientEmail],
      subject: `[TEST] ${subject}`,
      html: body
    });

    res.json({ success: true, message: `Email de test envoyé à ${recipientEmail}` });
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
