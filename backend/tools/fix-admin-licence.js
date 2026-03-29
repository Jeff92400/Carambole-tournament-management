/**
 * Fix the admin licence in organization_settings
 * The licence was saved as 1700229G instead of 170229G
 */

const db = require('../db-loader');

(async () => {
  try {
    console.log('🔧 Fixing admin licence in organization_settings...\n');

    // Check current value
    const current = await db.query(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = 1 AND setting_key = 'push_admin_licence'`
    );

    console.log(`Current value: ${current.rows[0]?.setting_value || 'NOT SET'}`);

    // Update to correct value
    await db.query(
      `UPDATE organization_settings
       SET setting_value = $1
       WHERE organization_id = 1 AND setting_key = 'push_admin_licence'`,
      ['170229G']
    );

    console.log(`✅ Updated to: 170229G\n`);

    // Verify
    const verify = await db.query(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = 1 AND setting_key = 'push_admin_licence'`
    );

    console.log(`Verified value: ${verify.rows[0]?.setting_value}`);
    console.log('\n✅ Done! Admin copy should now work.');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
