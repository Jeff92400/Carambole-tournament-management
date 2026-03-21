#!/usr/bin/env node
/**
 * Temporary investigation script for Bande R1 discrepancies.
 * Run via Railway shell: node backend/scripts/investigate-bande-r1.js
 * DELETE after investigation.
 */
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. Find CDB 93-94 org
  const orgs = await client.query("SELECT id, slug, name FROM organizations WHERE slug LIKE '%93%' OR name LIKE '%93%'");
  const orgId = orgs.rows[0]?.id;
  console.log(`\n=== ORG: ${orgs.rows[0]?.name} (id=${orgId}) ===`);

  // 2. Find Bande R1 category
  const cats = await client.query(
    "SELECT id, game_type, level FROM categories WHERE UPPER(REPLACE(game_type, ' ', '')) LIKE '%BANDE%' AND UPPER(level) = 'R1' AND organization_id = $1 AND UPPER(REPLACE(game_type, ' ', '')) NOT LIKE '%3%'",
    [orgId]
  );
  const catId = cats.rows[0]?.id;
  console.log(`=== CATEGORY: ${cats.rows[0]?.game_type} ${cats.rows[0]?.level} (id=${catId}) ===`);

  // 3. Tournaments this season
  const tourneys = await client.query(
    "SELECT id, tournament_number, season, date, location FROM tournaments WHERE category_id = $1 AND season = '2025-2026' ORDER BY tournament_number",
    [catId]
  );
  console.log('\n=== TOURNAMENTS ===');
  tourneys.rows.forEach(r => console.log(`  T${r.tournament_number}: id=${r.id}, date=${r.date}, loc=${r.location}`));

  const LICENCES = ['012774I', '156543F', '154522J']; // CHAMPY, ALVES, PIVONET
  const NAMES = { '012774I': 'CHAMPY', '156543F': 'ALVES', '154522J': 'PIVONET' };

  // 4. Tournament results for target players
  console.log('\n=== TOURNAMENT RESULTS ===');
  for (const t of tourneys.rows) {
    console.log(`\n--- T${t.tournament_number} (tournament_id=${t.id}) ---`);
    const results = await client.query(
      `SELECT licence, player_name, position, position_points, points, reprises, match_points, bonus_points, bonus_detail, serie
       FROM tournament_results
       WHERE tournament_id = $1 AND REPLACE(licence, ' ', '') IN ($2, $3, $4)
       ORDER BY position`,
      [t.id, ...LICENCES]
    );
    if (results.rows.length === 0) {
      console.log('  No results for target players');
      continue;
    }
    for (const r of results.rows) {
      const lic = r.licence.replace(/ /g, '');
      const moy = r.reprises > 0 ? (r.points / r.reprises).toFixed(3) : '0';
      console.log(`  ${NAMES[lic] || lic}: pos=${r.position}, pos_pts=${r.position_points}, pts=${r.points}, rep=${r.reprises}, moy=${moy}, match_pts=${r.match_points}, bonus=${r.bonus_points}, detail=${r.bonus_detail}, serie=${r.serie}`);
    }
  }

  // 5. All results for these tournaments (to see full standings)
  console.log('\n=== FULL STANDINGS (position + position_points) ===');
  for (const t of tourneys.rows) {
    console.log(`\n--- T${t.tournament_number} (id=${t.id}) ---`);
    const allResults = await client.query(
      `SELECT licence, player_name, position, position_points, points, reprises, match_points, bonus_points, bonus_detail
       FROM tournament_results WHERE tournament_id = $1 ORDER BY position`,
      [t.id]
    );
    for (const r of allResults.rows) {
      const moy = r.reprises > 0 ? (r.points / r.reprises).toFixed(3) : '0';
      const marker = LICENCES.includes(r.licence.replace(/ /g, '')) ? ' <<<' : '';
      console.log(`  #${r.position}: ${r.player_name} (${r.licence}) pos_pts=${r.position_points}, pts=${r.points}, rep=${r.reprises}, moy=${moy}, mp=${r.match_points}, bonus=${r.bonus_points}, detail=${r.bonus_detail}${marker}`);
    }
  }

  // 6. Position points lookup
  console.log('\n=== POSITION POINTS TABLE ===');
  const pp = await client.query(
    "SELECT position, points, player_count FROM position_points WHERE organization_id = $1 ORDER BY player_count, position",
    [orgId]
  );
  pp.rows.forEach(r => console.log(`  player_count=${r.player_count}, pos=${r.position} => ${r.points} pts`));

  // 7. Match-level data for target players (poule + bracket)
  console.log('\n=== MATCH DATA (tournament_matches) ===');
  for (const t of tourneys.rows) {
    console.log(`\n--- T${t.tournament_number} (id=${t.id}) ---`);
    const matches = await client.query(
      `SELECT poule_name, player1_licence, player1_points, player1_reprises, player2_licence, player2_points, player2_reprises, match_points_p1, match_points_p2
       FROM tournament_matches
       WHERE tournament_id = $1
         AND (REPLACE(player1_licence, ' ', '') IN ($2, $3, $4) OR REPLACE(player2_licence, ' ', '') IN ($2, $3, $4))
       ORDER BY poule_name, id`,
      [t.id, ...LICENCES]
    );
    if (matches.rows.length === 0) {
      console.log('  No matches found');
      continue;
    }
    for (const m of matches.rows) {
      console.log(`  ${m.poule_name}: ${m.player1_licence} (${m.player1_points}/${m.player1_reprises}, mp=${m.match_points_p1}) vs ${m.player2_licence} (${m.player2_points}/${m.player2_reprises}, mp=${m.match_points_p2})`);
    }
  }

  // 8. Rankings for this category/season
  console.log('\n=== SEASON RANKINGS ===');
  const rankings = await client.query(
    `SELECT licence, rank_position, total_match_points, average, best_serie,
            tournament_1_points, tournament_2_points, tournament_3_points,
            average_bonus, position_points_detail
     FROM rankings
     WHERE category_id = $1 AND season = '2025-2026'
     ORDER BY rank_position`,
    [catId]
  );
  for (const r of rankings.rows) {
    const marker = LICENCES.includes(r.licence?.replace(/ /g, '')) ? ' <<<' : '';
    console.log(`  #${r.rank_position}: ${r.licence} total=${r.total_match_points}, avg=${r.average}, serie=${r.best_serie}, T1=${r.tournament_1_points}, T2=${r.tournament_2_points}, T3=${r.tournament_3_points}, avg_bonus=${r.average_bonus}, detail=${r.position_points_detail}${marker}`);
  }

  // 9. Org settings for bonus
  console.log('\n=== BONUS SETTINGS ===');
  const settings = await client.query(
    "SELECT key, value FROM organization_settings WHERE organization_id = $1 AND key IN ('bonus_moyenne_enabled', 'bonus_moyenne_type', 'bonus_moyenne_scope', 'qualification_mode', 'best_of_count', 'scoring_avg_tier_1', 'scoring_avg_tier_2', 'scoring_avg_tier_3')",
    [orgId]
  );
  settings.rows.forEach(r => console.log(`  ${r.key} = ${r.value}`));

  // 10. Game parameters for Bande R1
  console.log('\n=== GAME PARAMETERS (Bande R1) ===');
  const gp = await client.query(
    "SELECT mode, categorie, moyenne_mini, moyenne_maxi, distance, reprises FROM game_parameters WHERE organization_id = $1 AND UPPER(REPLACE(mode, ' ', '')) LIKE '%BANDE%' AND UPPER(REPLACE(mode, ' ', '')) NOT LIKE '%3%' AND UPPER(categorie) = 'R1'",
    [orgId]
  );
  gp.rows.forEach(r => console.log(`  ${r.mode} ${r.categorie}: mini=${r.moyenne_mini}, maxi=${r.moyenne_maxi}, dist=${r.distance}, rep=${r.reprises}`));

  await client.end();
  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
