const express = require('express');
const router = express.Router();
const webPush = require('web-push');
const jwt = require('jsonwebtoken');
const db = require('../db-loader');

// Player App URL for proxying push notification requests
const PLAYER_APP_URL = process.env.PLAYER_APP_URL || 'https://cdbhs-player-app-production.up.railway.app';

// Middleware to authenticate Player App JWT tokens
// NOTE: This expects Player App tokens in the Authorization header
// Player App uses the same JWT_SECRET as the Tournament Management app
function authenticatePlayerToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, player) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.player = player; // Should contain { licence, organizationId, ... }
    next();
  });
}

// Configure VAPID keys from environment variables
// Trim to remove any whitespace, line breaks, or quotes
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim().replace(/['"]/g, '');
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim().replace(/['"]/g, '');

if (!vapidPublicKey || !vapidPrivateKey) {
  console.warn('⚠️ VAPID keys not configured - push notifications will not work');
  console.warn(`   Public key: ${vapidPublicKey ? 'present' : 'missing'}`);
  console.warn(`   Private key: ${vapidPrivateKey ? 'present' : 'missing'}`);
} else {
  try {
    webPush.setVapidDetails(
      'mailto:noreply@cdbhs.net',
      vapidPublicKey,
      vapidPrivateKey
    );
    console.log('✅ Web Push configured with VAPID keys');
  } catch (error) {
    console.error('❌ Failed to configure VAPID keys:', error.message);
    console.error(`   Public key length: ${vapidPublicKey.length} chars`);
    console.error(`   Public key starts with: ${vapidPublicKey.substring(0, 20)}...`);
    console.error(`   Public key ends with: ...${vapidPublicKey.substring(vapidPublicKey.length - 20)}`);
    console.error('   Push notifications will not work until VAPID keys are fixed');
  }
}

/**
 * POST /api/player/push/subscribe
 * Save a push subscription for a player
 * Requires Player App authentication
 */
router.post('/subscribe', authenticatePlayerToken, async (req, res) => {
  const { subscription } = req.body;
  const licence = req.player.licence;
  const orgId = req.player.organizationId;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    // Get player_account_id from licence
    const playerAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM player_accounts WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [licence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!playerAccount) {
      return res.status(404).json({ error: 'Player account not found' });
    }

    // Check if subscription already exists (update last_used_at if so)
    const existingSub = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM push_subscriptions WHERE endpoint = $1',
        [subscription.endpoint],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (existingSub) {
      // Update last_used_at
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
          [existingSub.id],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      return res.json({ success: true, message: 'Subscription updated', id: existingSub.id });
    }

    // Insert new subscription
    const result = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO push_subscriptions (player_account_id, organization_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          playerAccount.id,
          orgId,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth
        ],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });

    res.json({ success: true, message: 'Subscription saved', id: result.id });

  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

/**
 * POST /api/player/push/unsubscribe
 * Remove push subscription for current player
 * Requires Player App authentication
 */
router.post('/unsubscribe', authenticatePlayerToken, async (req, res) => {
  const { endpoint } = req.body;
  const licence = req.player.licence;
  const orgId = req.player.organizationId;

  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint required' });
  }

  try {
    // Get player_account_id
    const playerAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM player_accounts WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [licence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!playerAccount) {
      return res.status(404).json({ error: 'Player account not found' });
    }

    // Delete subscription
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM push_subscriptions WHERE endpoint = $1 AND player_account_id = $2',
        [endpoint, playerAccount.id],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, message: 'Subscription removed' });

  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

/**
 * DELETE /api/player/push/subscription/:id
 * Delete a specific subscription by ID
 * Requires Player App authentication
 */
router.delete('/subscription/:id', authenticatePlayerToken, async (req, res) => {
  const subscriptionId = req.params.id;
  const licence = req.player.licence;
  const orgId = req.player.organizationId;

  try {
    // Get player_account_id
    const playerAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM player_accounts WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [licence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!playerAccount) {
      return res.status(404).json({ error: 'Player account not found' });
    }

    // Delete subscription (only if owned by this player)
    const result = await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM push_subscriptions WHERE id = $1 AND player_account_id = $2',
        [subscriptionId, playerAccount.id],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    if (result === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json({ success: true, message: 'Subscription deleted' });

  } catch (error) {
    console.error('Delete subscription error:', error);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

/**
 * GET /api/player/push/status
 * Check if current player has an active push subscription
 * Requires Player App authentication
 */
router.get('/status', authenticatePlayerToken, async (req, res) => {
  const licence = req.player.licence;
  const orgId = req.player.organizationId;

  try {
    // Get player_account_id and push_enabled status
    const playerAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, push_enabled FROM player_accounts WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [licence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!playerAccount) {
      return res.status(404).json({ error: 'Player account not found' });
    }

    // Check if player has any active subscriptions
    const subscriptions = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, endpoint, created_at, last_used_at FROM push_subscriptions WHERE player_account_id = $1',
        [playerAccount.id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      push_enabled: playerAccount.push_enabled === true || playerAccount.push_enabled === 1,
      has_subscription: subscriptions.length > 0,
      subscription_count: subscriptions.length,
      subscriptions: subscriptions
    });

  } catch (error) {
    console.error('Get push status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * POST /api/player/push/toggle
 * Toggle push_enabled preference for current player
 * Requires Player App authentication
 */
router.post('/toggle', authenticatePlayerToken, async (req, res) => {
  const { enabled } = req.body;
  const licence = req.player.licence;
  const orgId = req.player.organizationId;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  try {
    // Update push_enabled
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE player_accounts SET push_enabled = $1 WHERE REPLACE(licence, \' \', \'\') = $2 AND ($3::int IS NULL OR organization_id = $3)',
        [enabled, licence.replace(/\s/g, ''), orgId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, push_enabled: enabled });

  } catch (error) {
    console.error('Toggle push error:', error);
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

/**
 * HELPER FUNCTION: Send push notification to a specific player
 * @param {string} licence - Player's licence number
 * @param {number} orgId - Organization ID
 * @param {object} notification - { title, body, url }
 * @param {object} options - { skipAdminCopy: boolean } - Skip sending copy to admin
 * @returns {Promise<{success: boolean, sent: number, failed: number}>}
 */
async function sendPushToPlayer(licence, orgId, notification, options = {}) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('⚠️ VAPID keys not configured - skipping push notification');
    return { success: false, sent: 0, failed: 0, error: 'VAPID not configured' };
  }

  try {
    // Get player account
    const playerAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, push_enabled FROM player_accounts WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [licence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!playerAccount) {
      return { success: false, sent: 0, failed: 0, error: 'Player not found' };
    }

    // Check if push is enabled for this player
    if (playerAccount.push_enabled !== true && playerAccount.push_enabled !== 1) {
      return { success: false, sent: 0, failed: 0, error: 'Push disabled by player' };
    }

    // Get all subscriptions for this player
    const subscriptions = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE player_account_id = $1',
        [playerAccount.id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    if (subscriptions.length === 0) {
      return { success: false, sent: 0, failed: 0, error: 'No subscriptions found' };
    }

    // Prepare notification payload
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url || '/',
      icon: '/images/FrenchBillard-Icon-small.png',
      badge: '/images/FrenchBillard-Icon-small.png'
    });

    let sent = 0;
    let failed = 0;

    // Send to all subscriptions
    for (const sub of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        const result = await webPush.sendNotification(pushSubscription, payload);
        sent++;

        console.log(`✅ Push sent successfully to subscription ${sub.id}`);
        console.log(`   FCM Response Status: ${result.statusCode}`);
        console.log(`   FCM Response Body: ${result.body || 'empty'}`);

        // Update last_used_at
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
            [sub.id],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

      } catch (error) {
        failed++;
        console.error(`❌ Push send error for subscription ${sub.id}:`);
        console.error(`   Status: ${error.statusCode || 'N/A'}`);
        console.error(`   Message: ${error.message}`);
        console.error(`   Body: ${error.body || 'N/A'}`);
        console.error(`   Endpoint: ${sub.endpoint.substring(0, 50)}...`);

        // If subscription is expired (410 Gone), delete it
        if (error.statusCode === 410) {
          console.log(`🗑️ Removing expired subscription ${sub.id}`);
          await new Promise((resolve, reject) => {
            db.run(
              'DELETE FROM push_subscriptions WHERE id = $1',
              [sub.id],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
      }
    }

    // Store notification in history if at least one was sent successfully
    if (sent > 0) {
      try {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO push_notification_history (player_account_id, organization_id, title, body, url)
             VALUES ($1, $2, $3, $4, $5)`,
            [playerAccount.id, orgId, notification.title, notification.body, notification.url || '/'],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        console.log(`[Push History] Stored notification for player ${licence}`);
      } catch (historyError) {
        console.error('[Push History] Failed to store notification:', historyError.message);
        // Don't fail the whole operation if history storage fails
      }
    }

    // Send copy to admin if enabled (fire-and-forget, skip if this IS the admin copy)
    if (!options.skipAdminCopy && sent > 0) {
      sendAdminCopyIfEnabled(orgId, licence, notification).catch(err => {
        console.error('[ADMIN COPY] Failed to send admin copy:', err.message);
      });
    }

    return { success: sent > 0, sent, failed };

  } catch (error) {
    console.error('sendPushToPlayer error:', error);
    return { success: false, sent: 0, failed: 0, error: error.message };
  }
}

/**
 * HELPER FUNCTION: Send push notification to multiple players
 * @param {string[]} licences - Array of licence numbers
 * @param {number} orgId - Organization ID
 * @param {object} notification - { title, body, url }
 * @returns {Promise<{success: boolean, total_sent: number, total_failed: number}>}
 */
async function sendPushToPlayers(licences, orgId, notification) {
  let totalSent = 0;
  let totalFailed = 0;

  for (const licence of licences) {
    const result = await sendPushToPlayer(licence, orgId, notification);
    totalSent += result.sent;
    totalFailed += result.failed;
  }

  return {
    success: totalSent > 0,
    total_sent: totalSent,
    total_failed: totalFailed
  };
}

/**
 * GET /api/push/debug/:licence
 * Debug endpoint to check push subscription details for a player
 */
router.get('/debug/:licence', async (req, res) => {
  const licence = req.params.licence;
  const orgId = req.user?.organizationId || 1;

  try {
    // Get player account
    const playerAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, push_enabled FROM player_accounts WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [licence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!playerAccount) {
      return res.json({ found: false, error: 'Player account not found' });
    }

    // Get subscriptions
    const subscriptions = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, endpoint, p256dh, auth, created_at, last_used_at FROM push_subscriptions WHERE player_account_id = $1',
        [playerAccount.id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      found: true,
      player_account_id: playerAccount.id,
      push_enabled: playerAccount.push_enabled,
      subscription_count: subscriptions.length,
      subscriptions: subscriptions.map(sub => ({
        id: sub.id,
        endpoint_preview: sub.endpoint.substring(0, 50) + '...',
        created_at: sub.created_at,
        last_used_at: sub.last_used_at
      })),
      vapid_configured: !!vapidPublicKey && !!vapidPrivateKey
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});
/**
 * PROXY ENDPOINTS - Forward push notification requests to Player App
 * These avoid CORS issues by making same-origin requests from the frontend
 */

/**
 * POST /api/push/test (PROXY)
 * Proxy test notification request to Player App
 * No auth required - this is called from test-push.html admin page
 */
router.post('/test', async (req, res) => {
  try {
    const { licence, title, body, url } = req.body;

    console.log('[Push Proxy] Forwarding test notification to Player App');
    console.log(`[Push Proxy] Licence: ${licence}, Title: ${title}`);

    // Forward to Player App
    const response = await fetch(`${PLAYER_APP_URL}/api/player/push/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ licence, title, body, url })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Push Proxy] Player App error:', data);
      return res.status(response.status).json(data);
    }

    console.log('[Push Proxy] Success:', data);
    res.json(data);

  } catch (error) {
    console.error('[Push Proxy] Error:', error);
    res.status(500).json({ error: 'Failed to forward push notification', details: error.message });
  }
});

/**
 * GET /api/push/debug/:licence (PROXY)
 * Proxy debug info request to Player App
 * No auth required - this is called from test-push.html admin page
 */
router.get('/debug/:licence', async (req, res) => {
  try {
    const { licence } = req.params;

    console.log('[Push Proxy] Forwarding debug request to Player App for licence:', licence);

    // Forward to Player App
    const response = await fetch(`${PLAYER_APP_URL}/api/player/push/debug/${licence}`);
    const data = await response.json();

    if (!response.ok) {
      console.error('[Push Proxy] Player App error:', data);
      return res.status(response.status).json(data);
    }

    res.json(data);

  } catch (error) {
    console.error('[Push Proxy] Error:', error);
    res.status(500).json({ error: 'Failed to fetch debug info', details: error.message });
  }
});

/**
 * POST /api/push/bulk
 * Send bulk notification to multiple players (admin only)
 * Body: { licences: [], title, body, url }
 */
router.post('/bulk', async (req, res) => {
  try {
    const { licences, title, body, url } = req.body;
    const orgId = req.user?.organizationId || 1;

    // Validation
    if (!Array.isArray(licences) || licences.length === 0) {
      return res.status(400).json({ error: 'Aucun joueur sélectionné' });
    }

    if (!title || !body) {
      return res.status(400).json({ error: 'Titre et message requis' });
    }

    console.log(`[BULK PUSH] Sending to ${licences.length} players for org ${orgId}`);
    console.log(`[BULK PUSH] Title: ${title}`);
    console.log(`[BULK PUSH] Body: ${body}`);

    // Construct full URL - if url starts with #, prepend Player App base URL
    let fullUrl = url || '/';
    if (fullUrl.startsWith('#')) {
      fullUrl = `${PLAYER_APP_URL}/${fullUrl}`;
    } else if (fullUrl === '') {
      fullUrl = PLAYER_APP_URL;
    }

    console.log(`[BULK PUSH] Full URL: ${fullUrl}`);

    // Send to all players
    const notification = {
      title,
      body,
      url: fullUrl
    };

    const result = await sendPushToPlayers(licences, orgId, notification);

    console.log(`[BULK PUSH] Sent: ${result.total_sent}, Failed: ${result.total_failed}`);

    res.json({
      success: true,
      total_sent: result.total_sent,
      total_failed: result.total_failed,
      message: `Notification envoyée à ${result.total_sent} joueur(s)`
    });

  } catch (error) {
    console.error('[BULK PUSH] Error:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi des notifications' });
  }
});

/**
 * GET /api/push/history
 * Get notification history for admin view (Tournament Management app)
 */
router.get('/history', async (req, res) => {
  try {
    const orgId = req.user?.organizationId || 1;
    const limit = parseInt(req.query.limit) || 50;

    // Get recent notifications from history table
    // Group by notification content to show unique sends
    const notifications = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          title,
          body,
          url,
          COUNT(DISTINCT player_account_id) as sent_count,
          MAX(sent_at) as sent_at,
          'specific' as recipient_type,
          COUNT(DISTINCT player_account_id) as recipient_count
         FROM push_notification_history
         WHERE organization_id = $1
         GROUP BY title, body, url
         ORDER BY MAX(sent_at) DESC
         LIMIT $2`,
        [orgId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json(notifications);

  } catch (error) {
    console.error('[PUSH HISTORY] Error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement de l\'historique' });
  }
});

/**
 * DELETE /api/push/history
 * Delete notification(s) from history by title, body, and url
 * Deletes all entries matching the group (same notification sent to multiple players)
 */
router.delete('/history', async (req, res) => {
  try {
    const orgId = req.user?.organizationId || 1;
    const { title, body, url } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Le titre et le message sont requis' });
    }

    // Delete all entries matching this notification group
    const result = await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM push_notification_history
         WHERE organization_id = $1
           AND title = $2
           AND body = $3
           AND ($4::text IS NULL OR url = $4)`,
        [orgId, title, body, url || null],
        function(err) {
          if (err) reject(err);
          else resolve({ deleted_count: this.changes });
        }
      );
    });

    console.log(`[PUSH HISTORY] Deleted ${result.deleted_count} notification(s) for org ${orgId}`);
    res.json({
      success: true,
      deleted_count: result.deleted_count,
      message: `${result.deleted_count} entrée(s) supprimée(s)`
    });

  } catch (error) {
    console.error('[PUSH HISTORY DELETE] Error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'historique' });
  }
});

/**
 * HELPER FUNCTION: Send copy of notification to admin if enabled
 * @param {number} orgId - Organization ID
 * @param {string} playerLicence - Player licence who received the notification
 * @param {object} notification - { title, body, url }
 */
async function sendAdminCopyIfEnabled(orgId, playerLicence, notification) {
  try {
    const appSettings = require('../utils/app-settings');

    // Check if admin copy is enabled
    const isEnabled = await appSettings.getOrgSetting(orgId, 'push_admin_copy_enabled');

    if (isEnabled !== 'true' && isEnabled !== true) {
      return; // Feature disabled
    }

    // Get the admin's licence from organization settings or users table
    const adminLicence = await appSettings.getOrgSetting(orgId, 'push_admin_licence');

    if (!adminLicence) {
      console.log('[ADMIN COPY] No admin licence configured for org', orgId);
      return;
    }

    // Get player name for the copy notification
    const player = await new Promise((resolve, reject) => {
      db.get(
        'SELECT first_name, last_name FROM players WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [playerLicence.replace(/\s/g, ''), orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const playerName = player ? `${player.first_name} ${player.last_name}` : playerLicence;

    // Modify notification for admin
    const adminNotification = {
      title: `[Copie Admin] ${notification.title}`,
      body: `📬 Notification envoyée à ${playerName}\n\n${notification.body}`,
      url: notification.url
    };

    // Send to admin with skipAdminCopy flag to prevent infinite loop
    console.log(`[ADMIN COPY] Sending copy to admin (licence: ${adminLicence})`);
    await sendPushToPlayer(adminLicence, orgId, adminNotification, { skipAdminCopy: true });

  } catch (error) {
    console.error('[ADMIN COPY] Error:', error.message);
    // Don't throw - this is fire-and-forget
  }
}

// Export router and helper functions
module.exports = router;
module.exports.sendPushToPlayer = sendPushToPlayer;
module.exports.sendPushToPlayers = sendPushToPlayers;
