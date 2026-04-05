/**
 * Admin Activity Logs Routes
 *
 * GET /api/admin-logs - Get admin activity logs with filters
 * GET /api/admin-logs/stats - Get quick statistics
 * GET /api/admin-logs/action-types - Get list of action types
 */

const express = require('express');
const router = express.Router();
const db = require('../db-loader');
const { authenticateToken, requireAdmin } = require('./auth');

// Middleware: admin or lecteur (read-only admin access)
// Admin and lecteur can view logs
function requireAdminOrLecteur(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'lecteur' || req.user.admin) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied' });
}

/**
 * DEBUG ENDPOINT - GET /api/admin-logs/debug-auth
 * Returns current user's auth info for troubleshooting
 */
router.get('/debug-auth', authenticateToken, (req, res) => {
  res.json({
    userId: req.user.userId,
    username: req.user.username,
    role: req.user.role,
    organizationId: req.user.organizationId,
    isSuperAdmin: req.user.isSuperAdmin,
    clubId: req.user.clubId,
    ligueNumero: req.user.ligueNumero
  });
});

/**
 * GET /api/admin-logs
 * Get admin activity logs with optional filters
 */
router.get('/', authenticateToken, requireAdminOrLecteur, (req, res) => {
  const {
    startDate,
    endDate,
    actionType,
    username,
    organizationId,
    limit = 100,
    offset = 0
  } = req.query;

  const isSuperAdmin = req.user.isSuperAdmin;

  // DEBUG: Log full user object
  console.log('[ADMIN-LOGS DEBUG] req.user:', JSON.stringify(req.user, null, 2));
  console.log('[ADMIN-LOGS DEBUG] isSuperAdmin:', isSuperAdmin);
  console.log('[ADMIN-LOGS DEBUG] organizationId query param:', organizationId);

  // Super admin can specify org via query param, regular admin always uses their own
  let targetOrgId;
  if (isSuperAdmin && organizationId !== undefined) {
    // Super admin with explicit org filter
    targetOrgId = organizationId === '' ? null : parseInt(organizationId);
  } else if (!isSuperAdmin) {
    // Regular admin MUST have an organization
    if (!req.user.organizationId) {
      return res.status(403).json({ error: 'Organization ID required for non-super-admin users' });
    }
    targetOrgId = req.user.organizationId;
  } else {
    // Super admin without filter = show all (null)
    targetOrgId = null;
  }

  console.log('[ADMIN-LOGS DEBUG] targetOrgId:', targetOrgId);

  let query = `
    SELECT
      id,
      user_id,
      username,
      user_role,
      action_type,
      action_details,
      target_type,
      target_id,
      target_name,
      ip_address,
      created_at
    FROM admin_activity_logs
    WHERE ($1::int IS NULL OR organization_id = $1)
  `;
  const params = [targetOrgId];
  let paramIndex = 2;

  if (startDate) {
    query += ` AND created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND created_at <= $${paramIndex}`;
    // Frontend already includes time portion (T23:59:59), don't add it again
    params.push(endDate);
    paramIndex++;
  }

  if (actionType) {
    const actionTypes = actionType.split(',').map(t => t.trim());
    query += ` AND action_type = ANY($${paramIndex})`;
    params.push(actionTypes);
    paramIndex++;
  }

  if (username) {
    query += ` AND username ILIKE $${paramIndex}`;
    params.push(`%${username}%`);
    paramIndex++;
  }

  // Get total count for pagination
  const countQuery = query.replace(
    /SELECT[\s\S]*?FROM/,
    'SELECT COUNT(*) as total FROM'
  );

  console.log('[ADMIN-LOGS DEBUG] Count query:', countQuery);
  console.log('[ADMIN-LOGS DEBUG] Count params:', JSON.stringify(params));

  db.get(countQuery, params, (err, countResult) => {
    if (err) {
      console.error('Error counting admin logs:', err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
    }

    const total = parseInt(countResult?.total || 0);
    console.log('[ADMIN-LOGS DEBUG] Total count:', total);

    // Add ordering and pagination
    const finalQuery = query + ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const finalParams = [...params, parseInt(limit), parseInt(offset)];

    console.log('[ADMIN-LOGS DEBUG] Final query:', finalQuery);
    console.log('[ADMIN-LOGS DEBUG] Final params:', JSON.stringify(finalParams));

    db.all(finalQuery, finalParams, (err, logs) => {
      if (err) {
        console.error('Error fetching admin logs:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
      }

      console.log('[ADMIN-LOGS DEBUG] Returned logs count:', logs?.length);
      console.log('[ADMIN-LOGS DEBUG] First 3 logs org_ids:', logs?.slice(0, 3).map(l => ({ username: l.username, user_id: l.user_id })));

      res.json({
        logs: logs || [],
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    });
  });
});

/**
 * GET /api/admin-logs/stats
 * Get quick statistics for dashboard
 */
router.get('/stats', authenticateToken, requireAdminOrLecteur, (req, res) => {
  // Regular admins MUST have an organization
  if (!req.user.isSuperAdmin && !req.user.organizationId) {
    return res.status(403).json({ error: 'Organization ID required' });
  }
  const orgId = req.user.organizationId || null;
  // Last 7 days stats
  db.get(`
    SELECT
      COUNT(*) FILTER (WHERE action_type = 'LOGIN_SUCCESS' AND created_at >= NOW() - INTERVAL '7 days') as logins,
      COUNT(*) FILTER (WHERE action_type LIKE 'IMPORT%' AND created_at >= NOW() - INTERVAL '7 days') as imports,
      COUNT(*) FILTER (WHERE action_type LIKE 'SEND%' AND created_at >= NOW() - INTERVAL '7 days') as emails,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as total_actions
    FROM admin_activity_logs
    WHERE ($1::int IS NULL OR organization_id = $1)
  `, [orgId], (err, stats) => {
    if (err) {
      console.error('Error fetching admin logs stats:', err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }

    // Active users
    db.all(`
      SELECT DISTINCT username, user_role, MAX(created_at) as last_activity
      FROM admin_activity_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND ($1::int IS NULL OR organization_id = $1)
      GROUP BY username, user_role
      ORDER BY last_activity DESC
    `, [orgId], (err, activeUsers) => {
      if (err) {
        console.error('Error fetching active users:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
      }

      res.json({
        logins: parseInt(stats?.logins || 0),
        imports: parseInt(stats?.imports || 0),
        emails: parseInt(stats?.emails || 0),
        totalActions: parseInt(stats?.total_actions || 0),
        activeUsers: activeUsers || []
      });
    });
  });
});

/**
 * GET /api/admin-logs/action-types
 * Get list of distinct action types for filtering
 */
router.get('/action-types', authenticateToken, requireAdminOrLecteur, (req, res) => {
  // Regular admins MUST have an organization
  if (!req.user.isSuperAdmin && !req.user.organizationId) {
    return res.status(403).json({ error: 'Organization ID required' });
  }
  const orgId = req.user.organizationId || null;
  db.all(`
    SELECT DISTINCT action_type, COUNT(*) as count
    FROM admin_activity_logs
    WHERE ($1::int IS NULL OR organization_id = $1)
    GROUP BY action_type
    ORDER BY count DESC
  `, [orgId], (err, actionTypes) => {
    if (err) {
      console.error('Error fetching action types:', err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des types d\'actions' });
    }

    res.json(actionTypes || []);
  });
});

/**
 * GET /api/admin-logs/usernames
 * Get list of distinct usernames for filtering
 */
router.get('/usernames', authenticateToken, requireAdminOrLecteur, (req, res) => {
  const { organizationId } = req.query;
  const isSuperAdmin = req.user.isSuperAdmin;

  // Super admin can specify org, regular admin always uses their own
  let targetOrgId;
  if (isSuperAdmin && organizationId !== undefined) {
    targetOrgId = organizationId === '' ? null : parseInt(organizationId);
  } else if (!isSuperAdmin) {
    if (!req.user.organizationId) {
      return res.status(403).json({ error: 'Organization ID required' });
    }
    targetOrgId = req.user.organizationId;
  } else {
    targetOrgId = null;
  }

  db.all(`
    SELECT DISTINCT username, COUNT(*) as count
    FROM admin_activity_logs
    WHERE ($1::int IS NULL OR organization_id = $1)
      AND username IS NOT NULL
      AND username != ''
    GROUP BY username
    ORDER BY username ASC
  `, [targetOrgId], (err, usernames) => {
    if (err) {
      console.error('Error fetching usernames:', err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
    }

    res.json(usernames || []);
  });
});

/**
 * POST /api/admin-logs/preview-delete
 * Preview how many logs would be deleted with given criteria (admin only)
 *
 * Body params (all optional):
 * - startDate: Filter from this date
 * - endDate: Filter to this date
 * - actionType: Filter by action type (comma-separated)
 * - username: Filter by username
 * - organizationId: Super admin can specify org to preview (regular admin always uses their org)
 */
router.post('/preview-delete', authenticateToken, requireAdmin, (req, res) => {
  const { startDate, endDate, actionType, username, organizationId } = req.body || {};
  const isSuperAdmin = req.user.isSuperAdmin;

  // Super admin can specify org, regular admin always uses their own
  let targetOrgId;
  if (isSuperAdmin && organizationId !== undefined) {
    targetOrgId = organizationId;
  } else if (!isSuperAdmin) {
    if (!req.user.organizationId) {
      return res.status(403).json({ error: 'Organization ID required' });
    }
    targetOrgId = req.user.organizationId;
  } else {
    targetOrgId = null;
  }

  let query = 'SELECT COUNT(*) as count FROM admin_activity_logs WHERE ($1::int IS NULL OR organization_id = $1)';
  const params = [targetOrgId];
  let paramIndex = 2;

  if (startDate) {
    query += ` AND created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND created_at <= $${paramIndex}`;
    // Frontend already includes time portion (T23:59:59), don't add it again
    params.push(endDate);
    paramIndex++;
  }

  if (actionType) {
    const actionTypes = actionType.split(',').map(t => t.trim());
    query += ` AND action_type = ANY($${paramIndex})`;
    params.push(actionTypes);
    paramIndex++;
  }

  if (username) {
    query += ` AND username ILIKE $${paramIndex}`;
    params.push(`%${username}%`);
    paramIndex++;
  }

  db.get(query, params, (err, result) => {
    if (err) {
      console.error('Preview delete error:', err);
      return res.status(500).json({ error: 'Failed to preview deletion' });
    }

    const count = parseInt(result?.count || 0);

    res.json({
      count,
      criteria: {
        startDate: startDate || null,
        endDate: endDate || null,
        actionType: actionType || null,
        username: username || null,
        organizationId: targetOrgId
      }
    });
  });
});

/**
 * DELETE /api/admin-logs
 * Clear admin logs (admin only)
 * Supports optional filters: date range, action type, username
 *
 * Body params (all optional):
 * - startDate: Delete from this date
 * - endDate: Delete to this date
 * - actionType: Delete by action type (comma-separated for multiple)
 * - username: Delete by username (partial match)
 * - organizationId: Super admin can specify org to delete from (regular admin always uses their org)
 */
router.delete('/', authenticateToken, requireAdmin, (req, res) => {
  const { startDate, endDate, actionType, username, organizationId } = req.body || {};
  const isSuperAdmin = req.user.isSuperAdmin;

  // CRITICAL: Super admin can specify org, regular admin ALWAYS uses their own org (prevent cross-CDB deletion)
  let targetOrgId;
  if (isSuperAdmin && organizationId !== undefined) {
    targetOrgId = organizationId;
  } else if (!isSuperAdmin) {
    if (!req.user.organizationId) {
      return res.status(403).json({ error: 'Organization ID required' });
    }
    targetOrgId = req.user.organizationId;
  } else {
    targetOrgId = null;
  }

  let query = 'DELETE FROM admin_activity_logs WHERE ($1::int IS NULL OR organization_id = $1)';
  const params = [targetOrgId];
  let paramIndex = 2;

  if (startDate) {
    query += ` AND created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND created_at <= $${paramIndex}`;
    // Frontend already includes time portion (T23:59:59), don't add it again
    params.push(endDate);
    paramIndex++;
  }

  if (actionType) {
    const actionTypes = actionType.split(',').map(t => t.trim());
    query += ` AND action_type = ANY($${paramIndex})`;
    params.push(actionTypes);
    paramIndex++;
  }

  if (username) {
    query += ` AND username ILIKE $${paramIndex}`;
    params.push(`%${username}%`);
    paramIndex++;
  }

  db.run(query, params, function(err) {
    if (err) {
      console.error('Clear admin logs error:', err);
      return res.status(500).json({ error: 'Failed to clear admin logs' });
    }

    const criteriaInfo = [
      startDate ? `depuis ${startDate}` : null,
      endDate ? `jusqu'à ${endDate}` : null,
      actionType ? `type: ${actionType}` : null,
      username ? `username: ${username}` : null,
      targetOrgId ? `org: ${targetOrgId}` : 'all orgs'
    ].filter(Boolean).join(', ');

    console.log(`[ADMIN-LOGS] Deleted by ${req.user.username}: ${this.changes} rows (${criteriaInfo})`);

    res.json({
      success: true,
      message: 'Les logs ont été supprimés',
      deleted: this.changes || 0
    });
  });
});

module.exports = router;
