/**
 * Script to manually add convocation details for testing
 * Run from cdbhs-tournament-management folder: node /tmp/update_convocation.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:tFNAQKoZUZmcQZqZpwOanqfXLZuTVKiE@crossover.proxy.rlwy.net:47067/railway',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

async function main() {
  console.log('Connecting to database...');

  try {
    // Check if columns exist
    const colCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'inscriptions'
      AND column_name LIKE 'convocation%'
    `);

    if (colCheck.rows.length === 0) {
      console.log('Columns do not exist yet. Adding them...');
      await pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_poule VARCHAR(10)`);
      await pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_lieu VARCHAR(255)`);
      await pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_adresse TEXT`);
      await pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_heure VARCHAR(10)`);
      await pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS convocation_notes TEXT`);
      console.log('Columns added!');
    } else {
      console.log('Convocation columns exist:', colCheck.rows.map(r => r.column_name));
    }

    // Find an inscription to update (prefer one already marked convoque)
    const inscriptions = await pool.query(`
      SELECT i.inscription_id, i.licence, i.tournoi_id, i.convoque, t.nom, t.debut
      FROM inscriptions i
      LEFT JOIN tournoi_ext t ON i.tournoi_id = t.tournoi_id
      ORDER BY t.debut DESC
      LIMIT 10
    `);

    console.log('\nRecent inscriptions:');
    inscriptions.rows.forEach((r, i) => {
      console.log(`${i+1}. ID=${r.inscription_id} licence=${r.licence} convoque=${r.convoque} tournoi=${r.nom || r.tournoi_id}`);
    });

    if (inscriptions.rows.length > 0) {
      // Pick first inscription and update with test data
      const target = inscriptions.rows[0];
      console.log(`\nUpdating inscription ${target.inscription_id} with test convocation data...`);

      await pool.query(`
        UPDATE inscriptions
        SET convoque = 1,
            convocation_poule = $1,
            convocation_lieu = $2,
            convocation_adresse = $3,
            convocation_heure = $4,
            convocation_notes = $5
        WHERE inscription_id = $6
      `, [
        'A',
        'Billard Club de Châtillon',
        '15 rue de la Mairie 92320 Châtillon',
        '14:00',
        'Test - Veuillez arriver 15 minutes avant',
        target.inscription_id
      ]);

      console.log('Done! Updated inscription_id=' + target.inscription_id);
      console.log('Now check the Player App inscriptions page.');
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
