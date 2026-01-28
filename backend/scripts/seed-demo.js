/**
 * Demo Data Seed Script
 *
 * Populates the database with fictional demo data for training purposes.
 * Run with: node backend/scripts/seed-demo.js
 *
 * WARNING: This will clear existing data in the target database!
 */

const bcrypt = require('bcrypt');

// Get database connection
const db = require('../db-loader');

// Demo configuration
const DEMO_ADMIN = {
  username: 'demo',
  password: 'demo123',
  email: 'demo@example.com',
  role: 'admin'
};

// Demo branding (orange theme to distinguish from production)
const DEMO_BRANDING = {
  organization_name: 'Comite Departemental de Billard - DEMO',
  organization_short_name: 'CDBHS DEMO',
  primary_color: '#E67E22',      // Orange instead of blue
  secondary_color: '#F39C12',
  accent_color: '#3498DB',
  background_color: '#FFFFFF',
  background_secondary_color: '#FDF2E9'
};

// Sample clubs
const DEMO_CLUBS = [
  { name: 'ACADEMIE BILLARD CLICHY', code: 'ABC', ville: 'Clichy' },
  { name: 'BILLARD CLUB BOULOGNE', code: 'BCB', ville: 'Boulogne-Billancourt' },
  { name: 'CERCLE BILLARD NEUILLY', code: 'CBN', ville: 'Neuilly-sur-Seine' },
  { name: 'ASSOCIATION BILLARD LEVALLOIS', code: 'ABL', ville: 'Levallois-Perret' },
  { name: 'BILLARD CLUB COLOMBES', code: 'BCC', ville: 'Colombes' },
  { name: 'ENTENTE BILLARD NANTERRE', code: 'EBN', ville: 'Nanterre' },
  { name: 'BILLARD CLUB RUEIL', code: 'BCR', ville: 'Rueil-Malmaison' },
  { name: 'ACADEMIE CARAMBOLE ASNIERES', code: 'ACA', ville: 'Asnieres-sur-Seine' }
];

// Sample player names (fictional)
const FIRST_NAMES = [
  'Jean', 'Pierre', 'Michel', 'Philippe', 'Alain', 'Bernard', 'Jacques', 'Daniel',
  'Patrick', 'Serge', 'Christian', 'Claude', 'Marc', 'Laurent', 'Stephane', 'Thierry',
  'Francois', 'Eric', 'Pascal', 'Olivier', 'Nicolas', 'David', 'Christophe', 'Didier',
  'Bruno', 'Robert', 'Gilles', 'Andre', 'Gerard', 'Yves', 'Paul', 'Henri',
  'Marie', 'Isabelle', 'Catherine', 'Nathalie', 'Sophie', 'Sandrine', 'Valerie', 'Christine'
];

const LAST_NAMES = [
  'MARTIN', 'BERNARD', 'THOMAS', 'PETIT', 'ROBERT', 'RICHARD', 'DURAND', 'DUBOIS',
  'MOREAU', 'LAURENT', 'SIMON', 'MICHEL', 'LEFEBVRE', 'LEROY', 'ROUX', 'DAVID',
  'BERTRAND', 'MOREL', 'FOURNIER', 'GIRARD', 'BONNET', 'DUPONT', 'LAMBERT', 'FONTAINE',
  'ROUSSEAU', 'VINCENT', 'MULLER', 'LEFEVRE', 'FAURE', 'ANDRE', 'MERCIER', 'BLANC'
];

// FFB ranking levels
const FFB_RANKINGS = ['N1', 'N2', 'N3', 'R1', 'R2', 'R3', 'R4', 'R5', 'D1', 'D2', 'D3'];

// Game modes
const GAME_MODES = ['LIBRE', 'CADRE 47/2', 'BANDE', '3 BANDES'];

// Category levels for tournaments
const CATEGORY_LEVELS = ['N3', 'R1', 'R2', 'R3', 'R4'];

// Helper functions
function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateLicence(index) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const num = String(100000 + index).slice(1);
  return `D${num}${letters[index % letters.length]}`;
}

function generateMoyenne(ranking) {
  const baseRanges = {
    'N1': [3.0, 5.0], 'N2': [2.0, 3.5], 'N3': [1.5, 2.5],
    'R1': [1.0, 2.0], 'R2': [0.8, 1.5], 'R3': [0.6, 1.2],
    'R4': [0.4, 1.0], 'R5': [0.3, 0.8], 'D1': [0.2, 0.6],
    'D2': [0.15, 0.4], 'D3': [0.1, 0.3]
  };
  const [min, max] = baseRanges[ranking] || [0.5, 1.0];
  return (min + Math.random() * (max - min)).toFixed(3);
}

// Get current season
function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

// Promise wrapper for db.run
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Promise wrapper for db.get
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Promise wrapper for db.all
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Main seed function
async function seedDemoData() {
  console.log('='.repeat(60));
  console.log('DEMO DATA SEED SCRIPT');
  console.log('='.repeat(60));
  console.log('');

  const season = getCurrentSeason();
  console.log(`Current season: ${season}`);
  console.log('');

  try {
    // 1. Create demo admin user
    console.log('1. Creating demo admin user...');
    const hashedPassword = await bcrypt.hash(DEMO_ADMIN.password, 10);

    await dbRun(`DELETE FROM users WHERE username = $1`, [DEMO_ADMIN.username]);
    await dbRun(
      `INSERT INTO users (username, password, email, role, is_active) VALUES ($1, $2, $3, $4, true)`,
      [DEMO_ADMIN.username, hashedPassword, DEMO_ADMIN.email, DEMO_ADMIN.role]
    );
    console.log(`   Created admin: ${DEMO_ADMIN.username} / ${DEMO_ADMIN.password}`);
    console.log('');

    // 2. Set demo branding
    console.log('2. Setting demo branding...');
    for (const [key, value] of Object.entries(DEMO_BRANDING)) {
      await dbRun(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [key, value]
      );
      console.log(`   ${key}: ${value}`);
    }
    console.log('');

    // 3. Create clubs
    console.log('3. Creating demo clubs...');
    await dbRun(`DELETE FROM clubs WHERE name LIKE '%DEMO%' OR name IN (${DEMO_CLUBS.map((_, i) => `$${i + 1}`).join(',')})`,
      DEMO_CLUBS.map(c => c.name));

    for (const club of DEMO_CLUBS) {
      await dbRun(
        `INSERT INTO clubs (name, code, ville, is_active) VALUES ($1, $2, $3, true)
         ON CONFLICT (name) DO UPDATE SET code = EXCLUDED.code, ville = EXCLUDED.ville`,
        [club.name, club.code, club.ville]
      );
    }
    console.log(`   Created ${DEMO_CLUBS.length} clubs`);
    console.log('');

    // 4. Create demo players
    console.log('4. Creating demo players...');
    const players = [];
    const usedNames = new Set();

    for (let i = 0; i < 80; i++) {
      let firstName, lastName, fullName;
      do {
        firstName = randomElement(FIRST_NAMES);
        lastName = randomElement(LAST_NAMES);
        fullName = `${firstName} ${lastName}`;
      } while (usedNames.has(fullName));
      usedNames.add(fullName);

      const club = randomElement(DEMO_CLUBS);
      const licence = generateLicence(i);
      const ranking = randomElement(FFB_RANKINGS);

      players.push({
        licence,
        nom: lastName,
        prenom: firstName,
        club: club.name,
        ranking_libre: ranking,
        ranking_cadre: randomElement(FFB_RANKINGS),
        ranking_bande: randomElement(FFB_RANKINGS),
        ranking_3bandes: randomElement(FFB_RANKINGS),
        moyenne_libre: generateMoyenne(ranking),
        moyenne_cadre: generateMoyenne(randomElement(FFB_RANKINGS)),
        moyenne_bande: generateMoyenne(randomElement(FFB_RANKINGS)),
        moyenne_3bandes: generateMoyenne(randomElement(FFB_RANKINGS)),
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.com`
      });
    }

    // Clear existing demo players and insert new ones
    await dbRun(`DELETE FROM players WHERE licence LIKE 'D%'`);

    for (const p of players) {
      await dbRun(
        `INSERT INTO players (licence, nom, prenom, club, ranking_libre, ranking_cadre, ranking_bande, ranking_3bandes,
         moyenne_libre, moyenne_cadre, moyenne_bande, moyenne_3bandes, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [p.licence, p.nom, p.prenom, p.club, p.ranking_libre, p.ranking_cadre, p.ranking_bande, p.ranking_3bandes,
         p.moyenne_libre, p.moyenne_cadre, p.moyenne_bande, p.moyenne_3bandes, p.email]
      );
    }
    console.log(`   Created ${players.length} players`);
    console.log('');

    // 5. Create demo tournaments (external)
    console.log('5. Creating demo tournaments...');

    // Clear existing demo tournaments
    await dbRun(`DELETE FROM inscriptions WHERE tournoi_id IN (SELECT tournoi_id FROM tournoi_ext WHERE season = $1)`, [season]);
    await dbRun(`DELETE FROM tournoi_ext WHERE season = $1`, [season]);

    const tournaments = [];
    const now = new Date();
    let tournoiId = 1;

    // Create T1, T2, T3 and Finale for each mode/category combination
    for (const mode of ['LIBRE', 'BANDE', '3 BANDES']) {
      for (const categorie of ['N3', 'R1', 'R2']) {
        const locations = DEMO_CLUBS.map(c => c.ville);

        // T1 - 2 months ago (completed)
        const t1Date = new Date(now);
        t1Date.setMonth(t1Date.getMonth() - 2);
        t1Date.setDate(randomInt(1, 28));

        // T2 - 1 month ago (completed)
        const t2Date = new Date(now);
        t2Date.setMonth(t2Date.getMonth() - 1);
        t2Date.setDate(randomInt(1, 28));

        // T3 - in 2 weeks (upcoming)
        const t3Date = new Date(now);
        t3Date.setDate(t3Date.getDate() + randomInt(10, 20));

        // Finale - in 5 weeks (upcoming)
        const finaleDate = new Date(now);
        finaleDate.setDate(finaleDate.getDate() + randomInt(30, 40));

        const tournamentSet = [
          { nom: 'Tournoi 1', date: t1Date, completed: true },
          { nom: 'Tournoi 2', date: t2Date, completed: true },
          { nom: 'Tournoi 3', date: t3Date, completed: false },
          { nom: 'Finale Departementale', date: finaleDate, completed: false }
        ];

        for (const t of tournamentSet) {
          tournaments.push({
            tournoi_id: tournoiId++,
            nom: t.nom,
            mode,
            categorie,
            debut: t.date.toISOString().split('T')[0],
            lieu: randomElement(locations),
            season,
            completed: t.completed
          });
        }
      }
    }

    for (const t of tournaments) {
      await dbRun(
        `INSERT INTO tournoi_ext (tournoi_id, nom, mode, categorie, debut, lieu, season)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu, t.season]
      );
    }
    console.log(`   Created ${tournaments.length} tournaments`);
    console.log('');

    // 6. Create demo inscriptions
    console.log('6. Creating demo inscriptions...');
    let inscriptionCount = 0;

    for (const tournament of tournaments) {
      // Get players with appropriate ranking for this category
      const eligiblePlayers = players.filter(p => {
        const ranking = tournament.mode === 'LIBRE' ? p.ranking_libre :
                       tournament.mode === 'BANDE' ? p.ranking_bande :
                       tournament.mode === '3 BANDES' ? p.ranking_3bandes : p.ranking_libre;

        // Simplified eligibility - just pick random subset
        return true;
      });

      // Select random players for this tournament
      const numInscriptions = tournament.nom.includes('Finale') ? randomInt(4, 8) : randomInt(8, 16);
      const shuffled = eligiblePlayers.sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(numInscriptions, shuffled.length));

      for (const player of selected) {
        const forfait = tournament.completed && Math.random() < 0.1 ? 1 : 0; // 10% forfait rate for past tournaments

        await dbRun(
          `INSERT INTO inscriptions (tournoi_id, licence, nom, prenom, club, email, source, forfait, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'demo', $7, CURRENT_TIMESTAMP)`,
          [tournament.tournoi_id, player.licence, player.nom, player.prenom, player.club, player.email, forfait]
        );
        inscriptionCount++;
      }
    }
    console.log(`   Created ${inscriptionCount} inscriptions`);
    console.log('');

    // 7. Summary
    console.log('='.repeat(60));
    console.log('DEMO DATA SEED COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log(`  - Admin account: ${DEMO_ADMIN.username} / ${DEMO_ADMIN.password}`);
    console.log(`  - Clubs: ${DEMO_CLUBS.length}`);
    console.log(`  - Players: ${players.length}`);
    console.log(`  - Tournaments: ${tournaments.length}`);
    console.log(`  - Inscriptions: ${inscriptionCount}`);
    console.log(`  - Branding: Orange theme with "CDBHS DEMO" name`);
    console.log('');
    console.log('The demo environment is ready for training!');
    console.log('');

  } catch (error) {
    console.error('Error seeding demo data:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the seed
seedDemoData();
