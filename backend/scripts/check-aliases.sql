-- Query 1: Check all club aliases
SELECT
  id,
  alias,
  canonical_name
FROM club_aliases
ORDER BY canonical_name, alias;

-- Query 2: Check which clubs have the most podiums (with alias resolution)
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
ORDER BY podium_count DESC;

-- Query 3: Check if Courbevoie alias is causing issues
SELECT
  alias,
  canonical_name,
  UPPER(REPLACE(REPLACE(REPLACE(alias, ' ', ''), '.', ''), '-', '')) as normalized_alias
FROM club_aliases
WHERE UPPER(canonical_name) LIKE '%COURBEVOIE%'
   OR UPPER(alias) LIKE '%COURBEVOIE%';

-- Query 4: Find all distinct club names in players table
SELECT DISTINCT club, COUNT(*) as player_count
FROM players
WHERE club IS NOT NULL AND club != ''
GROUP BY club
ORDER BY player_count DESC;
