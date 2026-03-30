// Verify what's in game_parameters
const { Client } = require('pg');

async function verify() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();

    // Check all game_parameters
    const all = await client.query(
      "SELECT id, mode, categorie, moyenne_mini, moyenne_maxi, organization_id FROM game_parameters ORDER BY id"
    );
    console.log('\n=== ALL game_parameters ===');
    console.table(all.rows);

    // Check Cadre specifically
    const cadre = await client.query(
      "SELECT id, mode, categorie, moyenne_mini, moyenne_maxi, organization_id FROM game_parameters WHERE mode LIKE '%Cadre%' OR mode LIKE '%CADRE%' OR mode LIKE '%cadre%'"
    );
    console.log('\n=== CADRE game_parameters ===');
    console.table(cadre.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

verify();
