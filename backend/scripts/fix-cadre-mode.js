// Execute fix via Node.js with DATABASE_URL
const { Client } = require('pg');

async function fixCadreMode() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Execute the UPDATE
    const result = await client.query(
      "UPDATE game_parameters SET mode = 'Cadre 42/2' WHERE mode = 'CADRE' AND organization_id = 1"
    );
    console.log(`✓ Updated ${result.rowCount} rows`);

    // Verify
    const verify = await client.query(
      "SELECT id, mode, categorie, moyenne_mini, moyenne_maxi FROM game_parameters WHERE organization_id = 1 ORDER BY id"
    );
    console.log('\nCurrent game_parameters for organization_id = 1:');
    console.table(verify.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

fixCadreMode();
