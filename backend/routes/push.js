const express = require('express');
const router = express.Router();
const webPush = require('web-push');
const jwt = require('jsonwebtoken');
const db = require('../db-loader');

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
 * @returns {Promise<{success: boolean, sent: number, failed: number}>}
 */
async function sendPushToPlayer(licence, orgId, notification) {
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
 * POST /api/push/test
 * Test endpoint to send a push notification to a specific player
 * Admin-only, for testing before Phase 5 rollout
 */
router.post('/test', async (req, res) => {
  const { licence, title, body, url } = req.body;

  if (!licence) {
    return res.status(400).json({ error: 'Player licence required' });
  }

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body required' });
  }

  try {
    // Get organization ID from the authenticated user (req.user.organizationId)
    // For now, use org ID 1 (CDBHS) as default for testing
    const orgId = req.user?.organizationId || 1;

    console.log(`[Push Test] Sending to licence: ${licence}, org: ${orgId}`);
    console.log(`[Push Test] Payload: ${title} / ${body} / ${url || '/'}`);

    const result = await sendPushToPlayer(licence, orgId, {
      title: title,
      body: body,
      url: url || '/'
    });

    console.log(`[Push Test] Result: sent=${result.sent}, failed=${result.failed}, error=${result.error || 'none'}`);

    if (result.success) {
      res.json({
        success: true,
        message: `Notification sent to ${result.sent} device(s)`,
        sent: result.sent,
        failed: result.failed
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to send notification',
        sent: result.sent,
        failed: result.failed
      });
    }

  } catch (error) {
    console.error('Test push error:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Export router and helper functions
module.exports = router;
module.exports.sendPushToPlayer = sendPushToPlayer;
module.exports.sendPushToPlayers = sendPushToPlayers;
