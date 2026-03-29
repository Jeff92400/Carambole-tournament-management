/**
 * Quick script to check push subscription status for a licence
 * Usage: node backend/tools/check-subscription.js <licence>
 */

const db = require('../db-loader');

const licence = process.argv[2] || '170229G';
const orgId = 1;

console.log(`🔍 Checking push subscription for licence: ${licence}`);
console.log('================================================\n');

(async () => {
  try {
    // Get player account
    const accountResult = await db.query(
      `SELECT id, licence, email, push_enabled, created_at
       FROM player_accounts
       WHERE REPLACE(licence, ' ', '') = $1
         AND ($2::int IS NULL OR organization_id = $2)`,
      [licence.replace(/\s/g, ''), orgId]
    );

    if (!accountResult.rows[0]) {
      console.log('❌ No player account found for this licence');
      process.exit(1);
    }

    const account = accountResult.rows[0];
    console.log('✅ Player Account Found:');
    console.log(`   ID: ${account.id}`);
    console.log(`   Licence: ${account.licence}`);
    console.log(`   Email: ${account.email}`);
    console.log(`   Push Enabled: ${account.push_enabled ? '✅ Yes' : '❌ No'}`);
    console.log(`   Created: ${account.created_at}\n`);

    // Get push subscriptions
    const subsResult = await db.query(
      `SELECT id, endpoint, created_at, last_used_at
       FROM push_subscriptions
       WHERE player_account_id = $1
       ORDER BY created_at DESC`,
      [account.id]
    );

    console.log(`📱 Push Subscriptions: ${subsResult.rows.length}`);

    if (subsResult.rows.length === 0) {
      console.log('   ⚠️  No active subscriptions - player needs to click 🔔 in Player App\n');
    } else {
      subsResult.rows.forEach((sub, i) => {
        console.log(`\n   Subscription #${i + 1}:`);
        console.log(`   - ID: ${sub.id}`);
        console.log(`   - Created: ${sub.created_at}`);
        console.log(`   - Last Used: ${sub.last_used_at || 'Never'}`);
        console.log(`   - Endpoint: ${sub.endpoint.substring(0, 60)}...`);
      });
      console.log('');
    }

    // Summary
    if (account.push_enabled && subsResult.rows.length > 0) {
      console.log('✅ STATUS: Ready to receive push notifications');
    } else if (!account.push_enabled) {
      console.log('⚠️  STATUS: Push notifications disabled in account settings');
    } else {
      console.log('⚠️  STATUS: No subscriptions - player needs to activate in Player App');
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
