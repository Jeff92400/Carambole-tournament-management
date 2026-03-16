#!/usr/bin/env node
/**
 * Script to check club_aliases table and identify potential issues
 * Run with: node backend/scripts/check-club-aliases.js
 */

const db = require('../db-loader');

console.log('🔍 Analyzing club_aliases table...\n');

// Query 1: Get all club aliases
const query1 = `
  SELECT
    id,
    alias,
    canonical_name
  FROM club_aliases
  ORDER BY canonical_name, alias
`;

db.all(query1, [], (err, aliases) => {
  if (err) {
    console.error('❌ Error fetching aliases:', err.message);
    process.exit(1);
  }

  console.log(`📊 Total aliases: ${aliases.length}\n`);

  // Group by canonical name to find potential issues
  const grouped = {};
  aliases.forEach(row => {
    if (!grouped[row.canonical_name]) {
      grouped[row.canonical_name] = [];
    }
    grouped[row.canonical_name].push(row.alias);
  });

  console.log('📋 Aliases grouped by canonical name:\n');
  Object.entries(grouped).forEach(([canonical, aliasArray]) => {
    console.log(`${canonical}:`);
    aliasArray.forEach(alias => {
      console.log(`  → ${alias}`);
    });
    console.log('');
  });

  // Query 2: Check podium stats with club resolution
  const query2 = `
    SELECT
      p.club as original_club,
      COALESCE(ca.canonical_name, p.club) as resolved_club,
      COUNT(*) as podium_count
    FROM tournament_results tr
    JOIN tournaments t ON tr.tournament_id = t.id
    LEFT JOIN players p ON REPLACE(tr.licence, ' ', '') = REPLACE(p.licence, ' ', '')
    LEFT JOIN club_aliases ca ON UPPER(REPLACE(REPLACE(REPLACE(COALESCE(p.club, ''), ' ', ''), '.', ''), '-', ''))
                                = UPPER(REPLACE(REPLACE(REPLACE(ca.alias, ' ', ''), '.', ''), '-', ''))
    WHERE t.season = '2025-2026'
      AND tr.position IN (1, 2, 3)
      AND p.club IS NOT NULL
      AND p.club != ''
    GROUP BY p.club, COALESCE(ca.canonical_name, p.club)
    ORDER BY podium_count DESC
  `;

  console.log('\n🏅 Podium attribution analysis (2025-2026):\n');

  db.all(query2, [], (err2, podiums) => {
    if (err2) {
      console.error('❌ Error fetching podiums:', err2.message);
      process.exit(1);
    }

    // Group by resolved club
    const resolvedGroups = {};
    podiums.forEach(row => {
      if (!resolvedGroups[row.resolved_club]) {
        resolvedGroups[row.resolved_club] = {
          total: 0,
          originalClubs: []
        };
      }
      resolvedGroups[row.resolved_club].total += row.podium_count;
      resolvedGroups[row.resolved_club].originalClubs.push({
        name: row.original_club,
        count: row.podium_count
      });
    });

    // Sort by total podiums
    const sorted = Object.entries(resolvedGroups)
      .sort((a, b) => b[1].total - a[1].total);

    sorted.forEach(([resolvedClub, data]) => {
      console.log(`\n${resolvedClub} - Total: ${data.total} podiums`);
      if (data.originalClubs.length > 1 || data.originalClubs[0].name !== resolvedClub) {
        console.log('  ⚠️  Grouping detected:');
        data.originalClubs.forEach(orig => {
          console.log(`    • ${orig.name}: ${orig.count} podiums`);
        });
      }
    });

    console.log('\n\n✅ Analysis complete!');
    process.exit(0);
  });
});
