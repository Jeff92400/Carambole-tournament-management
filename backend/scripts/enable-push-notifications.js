/**
 * Enable push notifications for all players
 * Sets push_notification_test_licences to [] for general activation
 *
 * Usage: railway run node backend/scripts/enable-push-notifications.js
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  console.error('Run with: railway run node backend/scripts/enable-push-notifications.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    console.log('Enabling push notifications for all players...');

    // Set push_notification_test_licences to empty array for org 1 (general activation)
    await pool.query(
      `INSERT INTO organization_settings (organization_id, key, value)
       VALUES (1, 'push_notification_test_licences', '[]')
       ON CONFLICT (organization_id, key)
       DO UPDATE SET value = '[]'`
    );

    console.log('✅ Push notifications enabled for all players (organization_id = 1)');

    // Verify
    const check = await pool.query(
      `SELECT value FROM organization_settings
       WHERE organization_id = 1 AND key = 'push_notification_test_licences'`
    );
    console.log('Current value:', check.rows[0]?.value);
    console.log('isGeneralActivation:', check.rows[0]?.value === '[]');

    await pool.end();
    console.log('\n✅ Done! Bell icon will now appear for all players.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
})();
