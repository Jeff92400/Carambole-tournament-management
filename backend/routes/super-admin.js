const express = require('express');
const db = require('../db-loader');
const appSettings = require('../utils/app-settings');
const { authenticateToken, requireSuperAdmin } = require('./auth');
const { logAdminAction, ACTION_TYPES } = require('../utils/admin-logger');

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

module.exports = router;
