#!/usr/bin/env node
/**
 * Investigate why Courbevoie dominates all statistics
 * Run via Railway shell: node backend/scripts/investigate-courbevoie.js
 */

const db = require('../db-loader');

console.log('🔍 Investigating Courbevoie statistics...\n');

// Query 1: Check all clubs in players table
console.log('📊 Query 1: Clubs in players table\n');
db.all(`
  SELECT
    club,
    COUNT(DISTINCT licence) as player_count
  FROM players
  WHERE club IS NOT NULL AND club != ''
  GROUP BY club
  ORDER BY player_count DESC
  LIMIT 15
`, [], (err, rows) => {
  if (err) {
    console.error('❌ Error:', err.message);
  } else if (rows.length === 0) {
    console.log('⚠️  No players found with clubs\n');
  } else {
    console.log('Top clubs by player count:');
    rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.club}: ${row.player_count} players`);
    });
    console.log('\n');
  }

  // Query 2: Check podiums by club for 2025-2026
  console.log('🏅 Query 2: Podiums by club (2025-2026)\n');
  db.all(`
    SELECT
      p.club,
      c.game_type,
      COUNT(CASE WHEN tr.position = 1 THEN 1 END) as gold,
      COUNT(CASE WHEN tr.position = 2 THEN 1 END) as silver,
      COUNT(CASE WHEN tr.position = 3 THEN 1 END) as bronze,
      COUNT(*) as total_podiums
    FROM tournament_results tr
    JOIN tournaments t ON tr.tournament_id = t.id
    JOIN categories c ON t.category_id = c.id
    LEFT JOIN players p ON REPLACE(tr.licence, ' ', '') = REPLACE(p.licence, ' ', '')
    WHERE t.season = '2025-2026'
      AND tr.position IN (1, 2, 3)
    GROUP BY p.club, c.game_type
    ORDER BY c.game_type, total_podiums DESC
  `, [], (err2, rows2) => {
    if (err2) {
      console.error('❌ Error:', err2.message);
    } else if (rows2.length === 0) {
      console.log('⚠️  No podiums found\n');
    } else {
      console.log('Podiums by club and game type:');

      // Group by game type
      const byGameType = {};
      rows2.forEach(row => {
        if (!byGameType[row.game_type]) {
          byGameType[row.game_type] = [];
        }
        byGameType[row.game_type].push(row);
      });

      Object.entries(byGameType).forEach(([gameType, clubs]) => {
        console.log(`\n  ${gameType}:`);
        clubs.slice(0, 5).forEach((club, i) => {
          if (club.club) {
            console.log(`    ${i + 1}. ${club.club}: 🥇${club.gold} 🥈${club.silver} 🥉${club.bronze} (Total: ${club.total_podiums})`);
          }
        });
      });
      console.log('\n');
    }

    // Query 3: Check specific Courbevoie players
    console.log('🎯 Query 3: Courbevoie players\n');
    db.all(`
      SELECT
        licence,
        first_name,
        last_name,
        club
      FROM players
      WHERE UPPER(club) LIKE '%COURBEVOIE%'
      LIMIT 20
    `, [], (err3, rows3) => {
      if (err3) {
        console.error('❌ Error:', err3.message);
      } else if (rows3.length === 0) {
        console.log('⚠️  No Courbevoie players found in players table\n');
      } else {
        console.log(`Found ${rows3.length} Courbevoie players:`);
        rows3.forEach(player => {
          console.log(`  - ${player.first_name} ${player.last_name} (${player.licence}): ${player.club}`);
        });
        console.log('\n');
      }

      // Query 4: Sample tournament results
      console.log('📋 Query 4: Sample podium results (2025-2026)\n');
      db.all(`
        SELECT
          tr.licence,
          tr.player_name,
          p.club,
          tr.position,
          c.display_name as category,
          t.tournament_number
        FROM tournament_results tr
        JOIN tournaments t ON tr.tournament_id = t.id
        JOIN categories c ON t.category_id = c.id
        LEFT JOIN players p ON REPLACE(tr.licence, ' ', '') = REPLACE(p.licence, ' ', '')
        WHERE t.season = '2025-2026'
          AND tr.position IN (1, 2, 3)
        ORDER BY RANDOM()
        LIMIT 20
      `, [], (err4, rows4) => {
        if (err4) {
          console.error('❌ Error:', err4.message);
        } else if (rows4.length === 0) {
          console.log('⚠️  No tournament results found\n');
        } else {
          console.log('Random sample of podium results:');
          rows4.forEach(result => {
            const position = ['🥇', '🥈', '🥉'][result.position - 1] || result.position;
            console.log(`  ${position} ${result.player_name} (${result.licence}) - ${result.club || 'NO CLUB'} - ${result.category} T${result.tournament_number}`);
          });
          console.log('\n');
        }

        console.log('✅ Investigation complete!\n');
        process.exit(0);
      });
    });
  });
});
