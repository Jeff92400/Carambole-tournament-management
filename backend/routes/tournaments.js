const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse');
const path = require('path');
const fs = require('fs');
const db = require('../db-loader');
const { authenticateToken } = require('./auth');
const { logAdminAction, ACTION_TYPES } = require('../utils/admin-logger');
const { getColumnMapping } = require('./import-config');
const appSettings = require('../utils/app-settings');
const { getRankingTournamentNumbers, getFinaleTournamentNumber, getTournamentLabel } = require('./settings');

/**
 * Default column mapping for tournament results imports
 * Used when no import profile is configured
 */
const DEFAULT_TOURNAMENT_MAPPING = {
  classement: { column: 0, type: 'number' },
  licence: { column: 1, type: 'string' },
  joueur: { column: 2, type: 'string' },
  pts_match: { column: 4, type: 'number' },
  moyenne: { column: 6, type: 'decimal' },
  reprises: { column: 8, type: 'number' },
  serie: { column: 9, type: 'number' },
  points: { column: 12, type: 'number' }
};

/**
 * Helper to get value from record using mapping configuration
 */
function getMappedValue(record, mapping, fieldName, defaultValue = null) {
  if (!mapping || !mapping[fieldName]) {
    return defaultValue;
  }

  const fieldConfig = mapping[fieldName];
  const colIndex = typeof fieldConfig.column === 'number' ? fieldConfig.column : parseInt(fieldConfig.column);

  if (isNaN(colIndex) || colIndex < 0 || colIndex >= record.length) {
    return defaultValue;
  }

  let value = record[colIndex];
  if (value === undefined || value === null) {
    return defaultValue;
  }

  // Clean the value
  value = value.replace(/"/g, '').trim();

  // Apply type conversion
  if (fieldConfig.type === 'number') {
    const num = parseInt(value);
    return isNaN(num) ? (defaultValue !== null ? defaultValue : 0) : num;
  } else if (fieldConfig.type === 'decimal') {
    const num = parseFloat(value.replace(',', '.'));
    return isNaN(num) ? (defaultValue !== null ? defaultValue : 0) : num;
  } else if (fieldConfig.type === 'boolean') {
    return value === '1' || value.toLowerCase() === 'true';
  }

  return value || defaultValue;
}

const router = express.Router();

// ==================== Promisified DB helpers ====================

function dbAllAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function dbGetAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRunAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) { err ? reject(err) : resolve(this); });
  });
}

// ==================== Reusable CSV parsing ====================

/**
 * Fix and parse a CSV file into raw record arrays.
 * Handles FFB format quirks (outer quotes, double-double-quotes).
 */
async function readCSVRecords(filePath) {
  let fileContent = fs.readFileSync(filePath, 'utf-8');

  const lines = fileContent.split('\n');
  const fixedLines = lines.map(line => {
    line = line.trim();
    if (!line) return line;
    if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1);
    }
    line = line.replace(/""/g, '"');
    return line;
  });

  fileContent = fixedLines.join('\n');
  const records = [];

  const parser = parse(fileContent, {
    delimiter: ';',
    skip_empty_lines: true,
    quote: '"',
    escape: '"',
    relax_column_count: true
  });

  for await (const record of parser) {
    records.push(record);
  }

  return records;
}

/**
 * Parse raw CSV records into structured objects using column mapping.
 * Skips header rows. Returns array of { classement, licence, playerName, matchPoints, moyenne, reprises, serie, points }.
 */
function parseRecordsWithMapping(records, columnMapping) {
  const parsed = [];
  for (const record of records) {
    if (record[0]?.includes('Classt') || record[0]?.includes('Licence')) continue;

    const licence = getMappedValue(record, columnMapping, 'licence', '')?.replace(/ /g, '');
    const playerName = getMappedValue(record, columnMapping, 'joueur', '');
    if (!licence || !playerName) continue;

    parsed.push({
      classement: getMappedValue(record, columnMapping, 'classement', 0),
      licence,
      playerName,
      matchPoints: getMappedValue(record, columnMapping, 'pts_match', 0),
      moyenne: getMappedValue(record, columnMapping, 'moyenne', 0),
      reprises: getMappedValue(record, columnMapping, 'reprises', 0),
      serie: getMappedValue(record, columnMapping, 'serie', 0),
      points: getMappedValue(record, columnMapping, 'points', 0),
    });
  }
  return parsed;
}

/**
 * Look up position_points for an org and return a mapping { position: points }.
 * Supports player_count dimension: tries exact match, then closest >= match, then fallback to player_count=0.
 */
async function getPositionPointsLookup(orgId, playerCount) {
  let rows;

  if (playerCount && playerCount > 0) {
    // Try exact match on player_count first
    rows = await dbAllAsync(
      'SELECT position, points FROM position_points WHERE ($1::int IS NULL OR organization_id = $1) AND player_count = $2 ORDER BY position ASC',
      [orgId, playerCount]
    );

    // Fallback: closest player_count that is >= actual count
    if (!rows || rows.length === 0) {
      rows = await dbAllAsync(
        'SELECT position, points, player_count FROM position_points WHERE ($1::int IS NULL OR organization_id = $1) AND player_count >= $2 ORDER BY player_count ASC, position ASC LIMIT 30',
        [orgId, playerCount]
      );
      if (rows && rows.length > 0) {
        const targetCount = rows[0].player_count;
        rows = rows.filter(r => r.player_count === targetCount);
      }
    }
  }

  // Final fallback: rows with player_count=0 (backward compat) or any rows for this org
  if (!rows || rows.length === 0) {
    rows = await dbAllAsync(
      'SELECT position, points FROM position_points WHERE ($1::int IS NULL OR organization_id = $1) AND (player_count = 0 OR player_count IS NULL) ORDER BY position ASC',
      [orgId]
    );
  }

  // Last resort: all rows for the org (ignoring player_count)
  if (!rows || rows.length === 0) {
    rows = await dbAllAsync(
      'SELECT position, points FROM position_points WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY position ASC',
      [orgId]
    );
  }

  const lookup = {};
  for (const row of rows) {
    lookup[row.position] = row.points;
  }
  return lookup;
}

/**
 * For journées orgs, assign position_points to tournament results.
 * If bracket-derived positions exist (import-matches with classification phases),
 * preserves those positions and only applies the position_points lookup.
 * Otherwise, computes positions from match_points sorting.
 * No-op for standard orgs.
 */
async function assignPositionPointsIfJournees(tournamentId, orgId) {
  if (!orgId) return;
  const qualMode = await appSettings.getOrgSetting(orgId, 'qualification_mode');
  if (qualMode !== 'journees') return;

  // Check if positions were set by bracket engine (import-matches or bracket.js)
  // Detect data from either tournament_matches (E2i import) or bracket_matches (app bracket engine)
  let hasBracketData = false;
  try {
    const matchRow = await dbGetAsync(
      'SELECT 1 FROM tournament_matches WHERE tournament_id = $1 LIMIT 1',
      [tournamentId]
    );
    hasBracketData = !!matchRow;
  } catch (e) { /* table may not exist yet */ }
  if (!hasBracketData) {
    try {
      const bracketRow = await dbGetAsync(
        'SELECT 1 FROM bracket_matches WHERE tournament_id = $1 AND winner_licence IS NOT NULL LIMIT 1',
        [tournamentId]
      );
      hasBracketData = !!bracketRow;
    } catch (e) { /* table may not exist yet */ }
  }

  let results;
  if (hasBracketData) {
    // Bracket-derived positions: USE existing position values, just apply position_points
    results = await dbAllAsync(
      'SELECT id, position FROM tournament_results WHERE tournament_id = $1 ORDER BY position ASC',
      [tournamentId]
    );
    console.log(`[POS-PTS] Tournament ${tournamentId}: bracket data detected, preserving ${results.length} existing positions`);
  } else {
    // Simple import: compute position from match_points sort (existing logic)
    results = await dbAllAsync(
      'SELECT id, match_points, points, reprises FROM tournament_results WHERE tournament_id = $1',
      [tournamentId]
    );
    // Sort by match_points desc, then moyenne desc (same logic as frontend display)
    results.sort((a, b) => {
      if (b.match_points !== a.match_points) return b.match_points - a.match_points;
      const avgA = a.reprises > 0 ? a.points / a.reprises : 0;
      const avgB = b.reprises > 0 ? b.points / b.reprises : 0;
      return avgB - avgA;
    });
    // Assign positions from sort order
    results.forEach((r, i) => { r.position = i + 1; });
    console.log(`[POS-PTS] Tournament ${tournamentId}: no bracket data, computed positions from match_points sort for ${results.length} players`);
  }

  const nbPlayers = results.length;
  const lookup = await getPositionPointsLookup(orgId, nbPlayers);
  if (Object.keys(lookup).length === 0) {
    console.warn(`[POS-PTS] No position_points configured for org ${orgId} (players=${nbPlayers}), skipping assignment for tournament ${tournamentId}`);
    return;
  }
  console.log(`[POS-PTS] Assigning position points for tournament ${tournamentId}, players=${nbPlayers}, lookup keys: [${Object.keys(lookup).join(',')}]`);

  // Check degradation setting: last player gets points of position N+1
  const degradation = await appSettings.getOrgSetting(orgId, 'position_points_degradation');

  for (let i = 0; i < results.length; i++) {
    const position = results[i].position;
    let pp;
    if (degradation === 'last_player' && position === nbPlayers && nbPlayers > 0) {
      pp = lookup[position + 1] || 0;
    } else {
      pp = lookup[position] || 0;
    }

    if (hasBracketData) {
      // Only update position_points, preserve existing position
      await dbRunAsync(
        'UPDATE tournament_results SET position_points = $1 WHERE id = $2',
        [pp, results[i].id]
      );
    } else {
      // Update both position and position_points
      await dbRunAsync(
        'UPDATE tournament_results SET position_points = $1, position = $2 WHERE id = $3',
        [pp, position, results[i].id]
      );
    }
  }
}

// Get organization logo as buffer from database (for Excel exports)
async function getOrganizationLogoBuffer() {
  return new Promise((resolve) => {
    db.get('SELECT file_data, content_type FROM organization_logo ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
      if (err || !row) {
        // Fallback to static French billiard icon
        const fallbackPath = path.join(__dirname, '../../frontend/images/FrenchBillard-Icon-small.png');
        if (fs.existsSync(fallbackPath)) {
          resolve(fs.readFileSync(fallbackPath));
        } else {
          resolve(null);
        }
        return;
      }
      const buffer = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
      resolve(buffer);
    });
  });
}

// Configure multer for file uploads with security restrictions
let upload;
try {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  upload = multer({
    dest: uploadsDir,
    limits: {
      fileSize: 5 * 1024 * 1024 // 5MB max
    },
    fileFilter: (req, file, cb) => {
      // Only allow CSV files
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      if (ext === '.csv') {
        cb(null, true);
      } else {
        cb(new Error('Seuls les fichiers CSV sont acceptés'), false);
      }
    }
  });
  console.log('Multer configured successfully, uploads dir:', uploadsDir);
} catch (error) {
  console.error('Error configuring multer:', error);
  // Create a dummy upload middleware
  upload = { single: () => (req, res, next) => next() };
}

// Get all categories
// Use INITCAP to normalize game_type display (e.g., "LIBRE" -> "Libre")
router.get('/categories', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.all('SELECT id, INITCAP(game_type) as game_type, level, display_name FROM categories WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY INITCAP(game_type), level', [orgId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Validate tournament CSV and check for unknown players
router.post('/validate', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    let fileContent = fs.readFileSync(req.file.path, 'utf-8');

    // Fix CSV format
    const lines = fileContent.split('\n');
    const fixedLines = lines.map(line => {
      line = line.trim();
      if (!line) return line;
      if (line.startsWith('"') && line.endsWith('"')) {
        line = line.slice(1, -1);
      }
      line = line.replace(/""/g, '"');
      return line;
    });

    fileContent = fixedLines.join('\n');
    const records = [];

    const parser = parse(fileContent, {
      delimiter: ';',
      skip_empty_lines: true,
      quote: '"',
      escape: '"',
      relax_column_count: true
    });

    for await (const record of parser) {
      records.push(record);
    }

    // Check for unknown players
    const unknownPlayers = [];
    const checkedLicences = new Set();

    for (const record of records) {
      try {
        if (record[0]?.includes('Classt') || record[0]?.includes('Licence')) continue;

        const licence = record[1]?.replace(/"/g, '').replace(/ /g, '').trim();
        const playerName = record[2]?.replace(/"/g, '').trim();

        if (!licence || !playerName) continue;
        if (checkedLicences.has(licence)) continue;

        checkedLicences.add(licence);

        // Check if player exists by licence OR name
        const existsQuery = `
          SELECT licence, first_name, last_name
          FROM players
          WHERE REPLACE(licence, ' ', '') = ?
             OR (UPPER(first_name || ' ' || last_name) = UPPER(?)
                 OR UPPER(last_name || ' ' || first_name) = UPPER(?))
        `;

        await new Promise((resolve) => {
          db.get(existsQuery, [licence, playerName, playerName], (err, player) => {
            if (err) {
              console.error('Error checking player:', err);
              resolve();
              return;
            }

            if (!player) {
              // Player doesn't exist
              const nameParts = playerName.split(' ');
              const lastName = nameParts[0] || '';
              const firstName = nameParts.slice(1).join(' ') || '';

              unknownPlayers.push({
                licence,
                firstName,
                lastName,
                fullName: playerName
              });
            }
            resolve();
          });
        });
      } catch (err) {
        console.error('Error parsing record:', err);
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if (unknownPlayers.length > 0) {
      return res.json({
        status: 'validation_required',
        unknownPlayers
      });
    } else {
      return res.json({
        status: 'ready',
        message: 'All players exist, ready to import'
      });
    }

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Batch create players
router.post('/create-players', authenticateToken, async (req, res) => {
  const { players } = req.body;

  if (!players || !Array.isArray(players)) {
    return res.status(400).json({ error: 'Players array required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO players (licence, first_name, last_name, club, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (licence) DO UPDATE SET
        club = EXCLUDED.club
    `);

    let created = 0;
    let createError = null;

    for (const player of players) {
      await new Promise((resolve) => {
        stmt.run(player.licence, player.firstName, player.lastName, player.club, (err) => {
          if (err && !createError) {
            createError = err;
            console.error('Error creating player:', err);
          } else {
            created++;
          }
          resolve();
        });
      });
    }

    stmt.finalize((err) => {
      if (err || createError) {
        return res.status(500).json({ error: 'Error creating players' });
      }
      res.json({ message: `${created} players created successfully` });
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if tournament exists (for warning before overwrite)
router.get('/check-exists', authenticateToken, (req, res) => {
  const { categoryId, tournamentNumber, season } = req.query;

  if (!categoryId || !tournamentNumber || !season) {
    return res.status(400).json({ error: 'Category ID, tournament number, and season required' });
  }

  const query = `
    SELECT t.id, t.tournament_date, t.import_date, c.display_name,
           COUNT(tr.id) as player_count
    FROM tournaments t
    JOIN categories c ON t.category_id = c.id
    LEFT JOIN tournament_results tr ON tr.tournament_id = t.id
    WHERE t.category_id = $1 AND t.tournament_number = $2 AND t.season = $3
    GROUP BY t.id, t.tournament_date, t.import_date, c.display_name
  `;

  db.get(query, [categoryId, tournamentNumber, season], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (row) {
      res.json({
        exists: true,
        tournament: {
          id: row.id,
          categoryName: row.display_name,
          tournamentNumber: tournamentNumber,
          season: season,
          tournamentDate: row.tournament_date,
          importDate: row.import_date,
          playerCount: row.player_count
        }
      });
    } else {
      res.json({ exists: false });
    }
  });
});

// Import tournament results from CSV
router.post('/import', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { categoryId, tournamentNumber, season, tournamentDate } = req.body;

  if (!categoryId || !tournamentNumber || !season) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Category, tournament number, and season required' });
  }

  try {
    // Load configurable column mapping, fall back to defaults
    let columnMapping;
    try {
      const profileConfig = await getColumnMapping('tournaments');
      columnMapping = profileConfig?.mappings || DEFAULT_TOURNAMENT_MAPPING;
      console.log(`Using ${profileConfig ? 'configured' : 'default'} column mapping for tournaments import`);
    } catch (err) {
      console.log('Error loading tournament column mapping, using defaults:', err.message);
      columnMapping = DEFAULT_TOURNAMENT_MAPPING;
    }

    let fileContent = fs.readFileSync(req.file.path, 'utf-8');

    // Fix CSV format: remove outer quotes and fix double quotes
    // Format: "field1,""field2"",""field3""" becomes field1,"field2","field3"
    const lines = fileContent.split('\n');
    const fixedLines = lines.map(line => {
      line = line.trim();
      if (!line) return line;

      // Remove outer quotes if present
      if (line.startsWith('"') && line.endsWith('"')) {
        line = line.slice(1, -1);
      }

      // Replace double double-quotes with single quotes
      line = line.replace(/""/g, '"');

      return line;
    });

    fileContent = fixedLines.join('\n');
    const records = [];

    const parser = parse(fileContent, {
      delimiter: ';',
      skip_empty_lines: true,
      quote: '"',
      escape: '"',
      relax_column_count: true
    });

    for await (const record of parser) {
      records.push(record);
    }

    // Start transaction
    db.serialize(() => {
      const orgId = req.user.organizationId || null;

      // Create or get tournament
      db.run(
        `INSERT INTO tournaments (category_id, tournament_number, season, tournament_date, organization_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(category_id, tournament_number, season) DO UPDATE SET
           tournament_date = ?,
           import_date = CURRENT_TIMESTAMP
         RETURNING id`,
        [categoryId, tournamentNumber, season, tournamentDate, orgId, tournamentDate],
        function(err) {
          if (err) {
            fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: err.message });
          }

          const tournamentId = this.lastID;

          // If UPDATE was triggered, get the existing tournament ID
          db.get(
            'SELECT id FROM tournaments WHERE category_id = ? AND tournament_number = ? AND season = ?',
            [categoryId, tournamentNumber, season],
            (err, row) => {
              if (err) {
                fs.unlinkSync(req.file.path);
                return res.status(500).json({ error: err.message });
              }

              const finalTournamentId = row ? row.id : tournamentId;

              // Delete existing results for this tournament
              db.run('DELETE FROM tournament_results WHERE tournament_id = ?', [finalTournamentId], (err) => {
                if (err) {
                  fs.unlinkSync(req.file.path);
                  return res.status(500).json({ error: err.message });
                }

                // Insert tournament results
                let imported = 0;
                let errors = [];

                // First, ensure all players exist in the players table
                const playerStmt = db.prepare(`
                  INSERT INTO players (licence, first_name, last_name, club, is_active)
                  VALUES (?, ?, ?, ?, 1)
                  ON CONFLICT (licence) DO NOTHING
                `);

                // Parse and create players first
                let playerInsertCount = 0;
                let playerInsertTotal = 0;
                let playerInsertError = null;

                for (const record of records) {
                  try {
                    // Skip header row
                    if (record[0]?.includes('Classt') || record[0]?.includes('Licence')) continue;

                    const licence = record[1]?.replace(/"/g, '').replace(/ /g, '').trim(); // Remove spaces
                    const playerName = record[2]?.replace(/"/g, '').trim();

                    if (!licence || !playerName) continue;

                    // Split player name into first and last name
                    // Tournament CSV format: "LASTNAME FIRSTNAME"
                    const nameParts = playerName.split(' ');
                    const lastName = nameParts[0] || '';
                    const firstName = nameParts.slice(1).join(' ') || '';

                    playerInsertTotal++;

                    // Note: Tournament CSV doesn't include club info
                    // Club will be set when importing JOUEURS.csv separately
                    playerStmt.run(licence, firstName, lastName, 'Club inconnu', (err) => {
                      if (err && !playerInsertError) {
                        playerInsertError = err;
                        console.error('Error creating player:', err);
                      }
                      playerInsertCount++;

                      // Check if all player inserts are done
                      if (playerInsertCount === playerInsertTotal) {
                        // All players created, now finalize and insert tournament results
                        playerStmt.finalize((finalizeErr) => {
                          if (finalizeErr) {
                            console.error('Error finalizing player statement:', finalizeErr);
                          }
                          insertTournamentResults();
                        });
                      }
                    });
                  } catch (err) {
                    console.error('Error parsing player record:', err);
                  }
                }

                // If no players to insert, skip directly to tournament results
                if (playerInsertTotal === 0) {
                  playerStmt.finalize(() => {
                    insertTournamentResults();
                  });
                }

                function insertTournamentResults() {

                  // Now insert tournament results
                  const stmt = db.prepare(`
                    INSERT INTO tournament_results (tournament_id, licence, player_name, position, match_points, moyenne, serie, points, reprises)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `);

                  for (const record of records) {
                    try {
                      // Skip header row
                      if (record[0]?.includes('Classt') || record[0]?.includes('Licence')) continue;

                      // Parse CSV format using configurable column mapping
                      // Default column layout:
                      // Column A (index 0): Position/Classement
                      // Column B (index 1): Licence
                      // Column C (index 2): Joueur
                      // Column E (index 4): Pts match (match points)
                      // Column G (index 6): Moyenne (3.10)
                      // Column I (index 8): Reprises
                      // Column J (index 9): Série
                      // Column M (index 12): Points (R) - game points
                      const position = getMappedValue(record, columnMapping, 'classement', 0);
                      const licence = getMappedValue(record, columnMapping, 'licence', '')?.replace(/ /g, ''); // Remove spaces
                      const playerName = getMappedValue(record, columnMapping, 'joueur', '');
                      const matchPoints = getMappedValue(record, columnMapping, 'pts_match', 0);
                      const moyenne = getMappedValue(record, columnMapping, 'moyenne', 0);
                      const reprises = getMappedValue(record, columnMapping, 'reprises', 0);
                      const serie = getMappedValue(record, columnMapping, 'serie', 0);
                      const points = getMappedValue(record, columnMapping, 'points', 0);

                      if (!licence || !playerName) continue;

                      stmt.run(finalTournamentId, licence, playerName, position, matchPoints, moyenne, serie, points, reprises, (err) => {
                        if (err) {
                          errors.push({ licence, error: err.message });
                        } else {
                          imported++;
                        }
                      });
                    } catch (err) {
                      errors.push({ record: record[0], error: err.message });
                    }
                  }

                  stmt.finalize((err) => {
                    if (err) {
                      fs.unlinkSync(req.file.path);
                      return res.status(500).json({ error: 'Error finalizing import' });
                    }

                    const orgId = req.user.organizationId || null;

                    // Recompute ALL bonuses for the category (position points + barème + bonus moyenne)
                    // This handles ALL tournaments, not just the newly imported one — ensures
                    // previously imported tournaments also get updated position_points and bonuses
                    recomputeAllBonuses(categoryId, season, orgId, async () => {
                      recalculateRankings(categoryId, season, async () => {
                        // Clean up uploaded file
                        fs.unlinkSync(req.file.path);

                        // Log tournament import
                        logAdminAction({
                          req,
                          action: ACTION_TYPES.IMPORT_TOURNAMENT,
                          details: `Import tournoi ${tournamentNumber}, saison ${season}, ${imported} joueurs`,
                          targetType: 'tournament',
                          targetId: finalTournamentId,
                          targetName: `T${tournamentNumber} - ${season}`
                        });

                        // Check if org uses any bonus (moyenne or barème scoring rules)
                        // so frontend knows whether to offer immediate result sending
                        let hasBonuses = false;
                        try {
                          const bonusMoyenne = orgId ? (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) : '';
                          if (bonusMoyenne === 'true') {
                            hasBonuses = true;
                          } else {
                            const activeRules = await dbAllAsync(
                              "SELECT 1 FROM scoring_rules WHERE is_active = true AND field_1 IS NOT NULL AND rule_type != 'MOYENNE_BONUS' AND points > 0 AND ($1::int IS NULL OR organization_id = $1) LIMIT 1",
                              [orgId]
                            );
                            hasBonuses = activeRules && activeRules.length > 0;
                          }
                        } catch (e) {
                          console.error('[IMPORT] Error checking bonus settings:', e);
                        }

                        res.json({
                          message: 'Tournament imported successfully',
                          tournamentId: finalTournamentId,
                          imported,
                          hasBonuses,
                          errors: errors.length > 0 ? errors : undefined
                        });
                      });
                    });
                  });
                } // Close insertTournamentResults function
              });
            }
          );
        }
      );
    });

  } catch (error) {
    // Clean up uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// ==================== Tournament Date Lookup ====================

/**
 * GET /lookup-date
 * Look up the planned date from tournoi_ext for a given mode + categorie + tournament number.
 */
router.get('/lookup-date', authenticateToken, async (req, res) => {
  const { mode, categorie, tournamentNumber } = req.query;
  if (!mode || !categorie || !tournamentNumber) {
    return res.status(400).json({ error: 'mode, categorie, and tournamentNumber are required' });
  }

  try {
    const orgId = req.user.organizationId || null;
    const nomPattern = `T${tournamentNumber} %`;

    const row = await dbGetAsync(
      `SELECT debut FROM tournoi_ext
       WHERE UPPER(mode) = UPPER($1)
         AND UPPER(categorie) = UPPER($2)
         AND nom LIKE $3
         AND ($4::int IS NULL OR organization_id = $4)
         AND (status IS NULL OR status = 'active')
       ORDER BY debut DESC
       LIMIT 1`,
      [mode, categorie, nomPattern, orgId]
    );

    if (row && row.debut) {
      // Return date in YYYY-MM-DD format for the date input
      const dateStr = new Date(row.debut).toISOString().split('T')[0];
      return res.json({ found: true, date: dateStr });
    }

    res.json({ found: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Mixed-category bonus ====================

/**
 * GET /tournaments/:tournamentId/category-bonus
 * Returns players for this tournament with match count and FFB ranking for bonus entry.
 */
router.get('/:tournamentId/category-bonus', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;

    // Verify tournament belongs to org
    const tournament = await dbGetAsync(
      'SELECT id FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const players = await dbAllAsync(`
      SELECT tr.licence, tr.player_name, tr.position, tr.match_points,
             tr.bonus_points, tr.bonus_detail,
             p.rank_libre, p.rank_cadre, p.rank_bande, p.rank_3bandes,
             c.game_type, c.level
      FROM tournament_results tr
      LEFT JOIN players p ON REPLACE(p.licence, ' ', '') = REPLACE(tr.licence, ' ', '')
      LEFT JOIN tournaments t ON t.id = tr.tournament_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE tr.tournament_id = $1
      ORDER BY tr.position ASC
    `, [tournamentId]);

    // Determine each player's FFB ranking for the tournament's game mode
    const result = players.map(p => {
      let playerRank = '';
      const gameType = (p.game_type || '').toUpperCase();
      if (gameType.includes('LIBRE')) playerRank = p.rank_libre || '';
      else if (gameType.includes('CADRE')) playerRank = p.rank_cadre || '';
      else if (gameType.includes('BANDE') && !gameType.includes('3')) playerRank = p.rank_bande || '';
      else if (gameType.includes('3')) playerRank = p.rank_3bandes || '';

      // Parse nb matchs from match_points or use a default
      // In POULES CSV, "Nbre matchs" is col 3 — not currently imported
      // Use position as proxy: all players play the same number of matches in round-robin
      return {
        licence: p.licence,
        playerName: p.player_name,
        position: p.position,
        matchPoints: p.match_points,
        ffbRanking: playerRank,
        categoryLevel: p.level || '',
        bonusPoints: p.bonus_points || 0,
        bonusDetail: p.bonus_detail ? JSON.parse(p.bonus_detail) : {},
      };
    });

    res.json(result);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /tournaments/:tournamentId/category-bonus
 * Save mixed-category bonus points for players.
 * Body: { bonuses: [{ licence, bonus_points }] }
 */
router.post('/:tournamentId/category-bonus', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.tournamentId);
    const orgId = req.user.organizationId || null;
    const { bonuses } = req.body;

    if (!bonuses || !Array.isArray(bonuses)) {
      return res.status(400).json({ error: 'bonuses array required' });
    }

    // Verify tournament belongs to org
    const tournament = await dbGetAsync(
      'SELECT id, category_id, season FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Update each player's bonus
    for (const { licence, bonus_points } of bonuses) {
      if (!licence || bonus_points === undefined) continue;

      // Get existing bonus_detail
      const existing = await dbGetAsync(
        'SELECT bonus_points, bonus_detail FROM tournament_results WHERE tournament_id = $1 AND REPLACE(licence, \' \', \'\') = $2',
        [tournamentId, licence.replace(/ /g, '')]
      );

      if (!existing) continue;

      // Merge MIXED_CATEGORY into existing bonus_detail
      let detail = {};
      try { detail = existing.bonus_detail ? JSON.parse(existing.bonus_detail) : {}; } catch (e) { /* */ }
      detail.MIXED_CATEGORY = parseInt(bonus_points) || 0;

      // Recalculate total bonus = sum of all detail values
      const totalBonus = Object.values(detail).reduce((sum, v) => sum + (parseInt(v) || 0), 0);

      await dbRunAsync(
        `UPDATE tournament_results SET bonus_points = $1, bonus_detail = $2
         WHERE tournament_id = $3 AND REPLACE(licence, ' ', '') = $4`,
        [totalBonus, JSON.stringify(detail), tournamentId, licence.replace(/ /g, '')]
      );
    }

    // Recalculate rankings after bonus update
    await new Promise((resolve) => {
      recalculateRankings(tournament.category_id, tournament.season, () => {
        resolve();
      });
    });

    res.json({ message: 'Bonus catégories mixtes enregistrés', updated: bonuses.length });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Scoring Rule Engine ---

// Resolve a field code to its numeric value
function resolveField(fieldCode, playerResult, tournamentContext) {
  switch (fieldCode) {
    case 'MOYENNE':
      return playerResult.reprises > 0 ? playerResult.points / playerResult.reprises : 0;
    case 'NB_JOUEURS':
      return tournamentContext.nb_joueurs || 0;
    case 'MATCH_POINTS':
      return playerResult.match_points || 0;
    case 'SERIE':
      return playerResult.serie || 0;
    case 'POSITION':
      return playerResult.position || 0;
    case 'PARTIES_MENEES':
      return playerResult.parties_menees || 0;
    case 'MPART':
      return playerResult.meilleure_partie || 0;
    default:
      console.warn(`[SCORING] Unknown field: ${fieldCode}`);
      return 0;
  }
}

// Resolve a value string: either a number or a reference keyword
function resolveValue(valueStr, referenceValues) {
  if (referenceValues.hasOwnProperty(valueStr)) {
    return referenceValues[valueStr];
  }
  const num = parseFloat(valueStr);
  return isNaN(num) ? 0 : num;
}

// Evaluate: left OP right
function evaluateOp(left, op, right) {
  switch (op) {
    case '>':  return left > right;
    case '>=': return left >= right;
    case '<':  return left < right;
    case '<=': return left <= right;
    case '=':  return Math.abs(left - right) < 0.0001;
    default: return false;
  }
}

// Evaluate a single structured rule for a given player
function evaluateRule(rule, playerResult, tournamentContext, referenceValues) {
  if (!rule.field_1) return false;

  const left1 = resolveField(rule.field_1, playerResult, tournamentContext);
  const right1 = resolveValue(rule.value_1, referenceValues);
  const cond1 = evaluateOp(left1, rule.operator_1, right1);

  if (!rule.logical_op || !rule.field_2) {
    return cond1;
  }

  const left2 = resolveField(rule.field_2, playerResult, tournamentContext);
  const right2 = resolveValue(rule.value_2, referenceValues);
  const cond2 = evaluateOp(left2, rule.operator_2, right2);

  if (rule.logical_op === 'AND') return cond1 && cond2;
  if (rule.logical_op === 'OR')  return cond1 || cond2;
  return false;
}

// Compute bonus points for tournament results using the generic rule engine
/**
 * Compute bonus moyenne per tournament. Merges MOYENNE_BONUS into existing bonus_detail
 * (preserving other bonuses from barème rules).
 * Two types:
 *   - "normal": > maxi → +2 | between mini and maxi → +1 | below → 0
 *   - "tiered": < mini → 0 | mini–middle → tier1 | middle–maxi → tier2 | ≥ maxi → tier3
 * When bonus_moyenne_enabled is false: clears MOYENNE_BONUS from bonus_detail.
 */
async function computeBonusMoyenne(tournamentId, categoryId, orgId, callback) {
  try {
    const rawSetting = orgId ? (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) : '';
    const enabled = rawSetting === 'true';
    console.log(`[BONUS-MOY] computeBonusMoyenne called: tournamentId=${tournamentId}, categoryId=${categoryId}, orgId=${orgId}, setting='${rawSetting}', enabled=${enabled}`);

    // Get all player results with existing bonus_detail
    const results = await dbAllAsync(
      'SELECT id, licence, points, reprises, bonus_detail FROM tournament_results WHERE tournament_id = $1',
      [tournamentId]
    );

    if (!results || results.length === 0) {
      console.log(`[BONUS-MOY] No results for tournament ${tournamentId}, skipping`);
      return callback(null);
    }

    // Load bonus type and tier values
    const bonusType = enabled ? ((await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type')) || 'normal') : null;
    const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
    const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
    const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;

    // Get game_parameters for this category — use defaults (0/999) if not configured (same as recalculateRankingsJournees)
    let moyenneMini = 0, moyenneMaxi = 999, moyenneMiddle = 499.5;
    if (enabled) {
      const category = await dbGetAsync(
        'SELECT id, game_type, level, organization_id FROM categories WHERE id = $1',
        [categoryId]
      );
      console.log(`[BONUS-MOY] Category: id=${categoryId}, game_type=${category?.game_type}, level=${category?.level}, org_id=${category?.organization_id}`);

      if (category) {
        const gp = await dbGetAsync(
          'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)',
          [category.game_type, category.level, category.organization_id || orgId]
        );
        console.log(`[BONUS-MOY] game_parameters query result: ${JSON.stringify(gp)}`);

        if (gp && gp.moyenne_mini != null) moyenneMini = parseFloat(gp.moyenne_mini);
        if (gp && gp.moyenne_maxi != null) moyenneMaxi = parseFloat(gp.moyenne_maxi);
        moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;
        console.log(`[BONUS-MOY] Thresholds: type=${bonusType}, mini=${moyenneMini}, middle=${moyenneMiddle.toFixed(3)}, maxi=${moyenneMaxi}, tiers=[${tier1},${tier2},${tier3}]`);
      } else {
        console.log(`[BONUS-MOY] Category ${categoryId} not found`);
        return callback(null);
      }
    }

    let updateCount = 0;
    for (const result of results) {
      // Parse existing bonus_detail (from barème rules)
      let detail = {};
      try { detail = JSON.parse(result.bonus_detail || '{}'); } catch (e) { detail = {}; }

      if (!enabled) {
        // Remove MOYENNE_BONUS but keep other bonuses
        delete detail.MOYENNE_BONUS;
      } else {
        const moyenne = result.reprises > 0 ? result.points / result.reprises : 0;
        let bonus = 0;

        if (bonusType === 'tiered') {
          // Par paliers: < mini → 0, mini–middle → tier1, middle–maxi → tier2, ≥ maxi → tier3
          if (moyenne >= moyenneMaxi) {
            bonus = tier3;
          } else if (moyenne >= moyenneMiddle) {
            bonus = tier2;
          } else if (moyenne >= moyenneMini) {
            bonus = tier1;
          }
        } else {
          // Normal: > maxi → tier2, between min and max → tier1, below → 0
          if (moyenne > moyenneMaxi) {
            bonus = tier2;
          } else if (moyenne >= moyenneMini) {
            bonus = tier1;
          }
        }

        if (bonus > 0) {
          detail.MOYENNE_BONUS = bonus;
        } else {
          delete detail.MOYENNE_BONUS;
        }
      }

      const totalBonus = Object.values(detail).reduce((a, b) => a + b, 0);
      await dbRunAsync(
        'UPDATE tournament_results SET bonus_points = $1, bonus_detail = $2 WHERE id = $3',
        [totalBonus, JSON.stringify(detail), result.id]
      );
      if (detail.MOYENNE_BONUS && detail.MOYENNE_BONUS > 0) updateCount++;
    }

    console.log(`[BONUS-MOY] Applied bonus moyenne to ${updateCount}/${results.length} results for tournament ${tournamentId}`);
    callback(null);
  } catch (error) {
    console.error('[BONUS-MOY] Error computing bonus moyenne:', error);
    callback(null); // Don't fail the import
  }
}

function computeBonusPoints(tournamentId, categoryId, orgId, callback) {
  // 1. Load ALL active structured rules, excluding MOYENNE_BONUS (handled by computeBonusMoyenne)
  db.all(
    "SELECT * FROM scoring_rules WHERE is_active = true AND field_1 IS NOT NULL AND rule_type != 'MOYENNE_BONUS' AND ($1::int IS NULL OR organization_id = $1) ORDER BY rule_type, display_order",
    [orgId],
    (err, rules) => {
      if (err || !rules || rules.length === 0) {
        // No barème rules → go straight to bonus moyenne
        computeBonusMoyenne(tournamentId, categoryId, orgId, callback);
        return;
      }

      // Skip if all points are 0
      if (rules.every(r => r.points === 0)) {
        console.log('[BONUS] All scoring rule points are 0, skipping barème');
        computeBonusMoyenne(tournamentId, categoryId, orgId, callback);
        return;
      }

      // 2. Get game_parameters for reference values (using JOIN — same as original working code)
      db.get(
        `SELECT c.display_name as category_name, c.game_type, c.level,
                gp.moyenne_mini, gp.moyenne_maxi
         FROM categories c
         LEFT JOIN game_parameters gp ON UPPER(REPLACE(gp.mode, ' ', '')) = UPPER(REPLACE(c.game_type, ' ', '')) AND UPPER(gp.categorie) = UPPER(c.level) AND gp.organization_id = c.organization_id
         WHERE c.id = ?`,
        [categoryId],
        (err, catInfo) => {
          if (err) {
            console.warn('[BONUS] Could not load category info:', err);
            return computeBonusMoyenne(tournamentId, categoryId, orgId, callback);
          }

          const referenceValues = {};
          if (catInfo) {
            if (catInfo.moyenne_mini !== null && catInfo.moyenne_mini !== undefined)
              referenceValues.MOYENNE_MINI = parseFloat(catInfo.moyenne_mini);
            if (catInfo.moyenne_maxi !== null && catInfo.moyenne_maxi !== undefined)
              referenceValues.MOYENNE_MAXI = parseFloat(catInfo.moyenne_maxi);
          }

          console.log(`[BONUS] Category ${catInfo ? catInfo.category_name : categoryId}: refs=${JSON.stringify(referenceValues)}, ${rules.length} rules`);

          // Warn if rules reference thresholds that are not configured
          if (Object.keys(referenceValues).length === 0) {
            const needsRefs = rules.some(r =>
              ['MOYENNE_MAXI', 'MOYENNE_MINI'].includes(r.value_1) || ['MOYENNE_MAXI', 'MOYENNE_MINI'].includes(r.value_2)
            );
            if (needsRefs) {
              console.warn(`[BONUS] WARNING: Rules reference MOYENNE_MAXI/MOYENNE_MINI but game_parameters not configured for category ${catInfo?.category_name || categoryId}. Configure Paramètres de jeu (moyenne mini/maxi).`);
            }
          }

          // 3. Get tournament context (nb_joueurs)
          db.get(
            'SELECT COUNT(*) as nb_joueurs FROM tournament_results WHERE tournament_id = ?',
            [tournamentId],
            (err, countRow) => {
              const tournamentContext = { nb_joueurs: countRow ? countRow.nb_joueurs : 0 };

              // 4. Get all player results
              db.all(
                'SELECT id, licence, points, reprises, match_points, serie, position, parties_menees, meilleure_partie FROM tournament_results WHERE tournament_id = ?',
                [tournamentId],
                (err, results) => {
                  if (err || !results || results.length === 0) {
                    console.log('[BONUS] No results to process');
                    return computeBonusMoyenne(tournamentId, categoryId, orgId, callback);
                  }

                  // Group rules by rule_type
                  const ruleTypes = [...new Set(rules.map(r => r.rule_type))];
                  let completed = 0;
                  let updateCount = 0;

                  results.forEach(result => {
                    let totalBonus = 0;
                    const bonusDetail = {};

                    ruleTypes.forEach(ruleType => {
                      const typeRules = rules.filter(r => r.rule_type === ruleType);

                      // First match wins within a rule_type (mutually exclusive conditions)
                      for (const rule of typeRules) {
                        // Skip rules referencing values we don't have
                        const needsRef = [rule.value_1, rule.value_2].some(
                          v => v === 'MOYENNE_MAXI' || v === 'MOYENNE_MINI'
                        );
                        if (needsRef && Object.keys(referenceValues).length === 0) continue;

                        if (evaluateRule(rule, result, tournamentContext, referenceValues)) {
                          if (rule.points > 0) {
                            bonusDetail[ruleType] = (bonusDetail[ruleType] || 0) + rule.points;
                            totalBonus += rule.points;
                            console.log(`[BONUS] ${result.licence}: ${ruleType} matched → +${rule.points}`);
                          }
                          break; // First match wins
                        }
                      }
                    });

                    db.run(
                      'UPDATE tournament_results SET bonus_points = ?, bonus_detail = ? WHERE id = ?',
                      [totalBonus, JSON.stringify(bonusDetail), result.id],
                      (err) => {
                        completed++;
                        if (!err && totalBonus > 0) updateCount++;
                        if (completed === results.length) {
                          console.log(`[BONUS] Applied barème bonus to ${updateCount}/${results.length} results for tournament ${tournamentId}`);
                          // Chain bonus moyenne (merges into existing bonus_detail)
                          computeBonusMoyenne(tournamentId, categoryId, orgId, callback);
                        }
                      }
                    );
                  });
                }
              );
            }
          );
        }
      );
    }
  );
}

// Recalculate rankings for a category and season (dispatcher)
function recalculateRankings(categoryId, season, callback) {
  // Resolve orgId from tournament data, then check qualification mode
  db.get(
    'SELECT DISTINCT organization_id FROM tournaments WHERE category_id = ? AND season = ? AND organization_id IS NOT NULL LIMIT 1',
    [categoryId, season],
    (err, row) => {
      const orgId = row ? row.organization_id : null;
      if (orgId) {
        appSettings.getOrgSetting(orgId, 'qualification_mode').then(mode => {
          if (mode === 'journees') {
            recalculateRankingsJournees(categoryId, season, callback, orgId);
          } else {
            recalculateRankingsStandard(categoryId, season, callback, orgId);
          }
        }).catch(() => {
          recalculateRankingsStandard(categoryId, season, callback, orgId);
        });
      } else {
        recalculateRankingsStandard(categoryId, season, callback, null);
      }
    }
  );
}

// Helper: promisified db calls for async functions
function dbAllAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
function dbGetAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbRunAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) { err ? reject(err) : resolve(this); });
  });
}

// ==================== JOURNÉES QUALIFICATIVES RANKING ====================
async function recalculateRankingsJournees(categoryId, season, callback, orgId) {
  try {
    console.log(`[RANKING-J] Starting journées recalculation for category ${categoryId}, season ${season}, org ${orgId}`);

    // Get org settings
    const bestOfCount = parseInt(await appSettings.getOrgSetting(orgId, 'best_of_count')) || 2;
    const journeesCount = parseInt(await appSettings.getOrgSetting(orgId, 'journees_count')) || 3;
    const bonusMoyenneEnabled = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) === 'true';
    const averageBonusEnabled = (await appSettings.getOrgSetting(orgId, 'average_bonus_tiers')) === 'true';
    const bonusMoyenneType = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type')) || 'normal';
    const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
    const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
    const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;

    // When bonus moyenne is already applied at tournament level (affects position → position_points),
    // skip the season-level average bonus to avoid double-counting
    const applySeasonBonus = averageBonusEnabled && !bonusMoyenneEnabled;

    // Get all tournaments for this category/season (excluding finale = tournament_number 4)
    const tournaments = await dbAllAsync(
      `SELECT id, tournament_number FROM tournaments
       WHERE category_id = $1 AND season = $2 AND tournament_number <= $3
       AND ($4::int IS NULL OR organization_id = $4)
       ORDER BY tournament_number`,
      [categoryId, season, journeesCount, orgId]
    );

    if (tournaments.length === 0) {
      console.log(`[RANKING-J] No tournaments found, skipping`);
      return callback(null);
    }

    // Get all player results with position_points + bonus, grouped by tournament
    const results = await dbAllAsync(
      `SELECT
         REPLACE(tr.licence, ' ', '') as licence,
         tr.player_name,
         t.tournament_number,
         tr.position_points,
         tr.points,
         tr.reprises,
         tr.match_points,
         tr.serie,
         tr.bonus_points,
         tr.bonus_detail
       FROM tournament_results tr
       JOIN tournaments t ON tr.tournament_id = t.id
       WHERE t.category_id = $1 AND t.season = $2 AND t.tournament_number <= $3
       AND ($4::int IS NULL OR t.organization_id = $4)`,
      [categoryId, season, journeesCount, orgId]
    );

    if (results.length === 0) {
      console.log(`[RANKING-J] No results found`);
      return callback(null);
    }

    // Group results by player
    const playerData = {};
    for (const r of results) {
      if (!playerData[r.licence]) {
        playerData[r.licence] = { playerName: r.player_name, tournaments: {} };
      }
      // Extract MOYENNE_BONUS from bonus_detail JSON (per-tournament average bonus)
      let moyenneBonus = 0;
      if (r.bonus_detail) {
        try {
          const detail = JSON.parse(r.bonus_detail);
          moyenneBonus = detail.MOYENNE_BONUS || 0;
        } catch (e) { /* ignore parse errors */ }
      }
      const positionPts = r.position_points || 0;
      playerData[r.licence].tournaments[r.tournament_number] = {
        positionPoints: positionPts,
        bonus: moyenneBonus,
        score: positionPts + moyenneBonus,
        points: r.points || 0,
        reprises: r.reprises || 0,
        matchPoints: r.match_points || 0,
        serie: r.serie || 0,
      };
    }

    // Get game_parameters for this category (for moyenne bonus tiers)
    const category = await dbGetAsync('SELECT game_type, level, organization_id FROM categories WHERE id = ?', [categoryId]);
    let moyenneMini = 0, moyenneMaxi = 999;
    if (category) {
      const gp = await dbGetAsync(
        'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE(?, \' \', \'\')) AND UPPER(categorie) = UPPER(?) AND ($3::int IS NULL OR organization_id = $3)',
        [category.game_type, category.level, category.organization_id || orgId]
      );
      if (gp) {
        moyenneMini = parseFloat(gp.moyenne_mini) || 0;
        moyenneMaxi = parseFloat(gp.moyenne_maxi) || 999;
      }
    }
    const moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;

    // Fetch FFB moyenne for each player (for display in ranking)
    let gameModeId = null;
    if (category) {
      const gm = await dbGetAsync(
        'SELECT id FROM game_modes WHERE UPPER(REPLACE(display_name, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\'))',
        [category.game_type]
      );
      if (gm) gameModeId = gm.id;
    }
    const ffbMoyennes = {};
    if (gameModeId) {
      const ffbRows = await dbAllAsync(
        'SELECT REPLACE(licence, \' \', \'\') as licence, moyenne_ffb FROM player_ffb_classifications WHERE game_mode_id = $1 AND season = $2',
        [gameModeId, season]
      );
      for (const row of ffbRows) {
        ffbMoyennes[row.licence] = row.moyenne_ffb;
      }
    }

    // Compute season ranking for each player
    const rankings = [];
    for (const [licence, data] of Object.entries(playerData)) {
      const tournamentNumbers = Object.keys(data.tournaments).map(Number).sort();
      const positionScores = tournamentNumbers.map(tn => ({
        tournamentNumber: tn,
        score: data.tournaments[tn].score,
        positionPoints: data.tournaments[tn].positionPoints,
        bonus: data.tournaments[tn].bonus,
      }));

      // Sort by score DESC (position_points + bonus) to pick best N
      const sortedScores = [...positionScores].sort((a, b) => b.score - a.score);
      const keptScores = sortedScores.slice(0, bestOfCount);
      const totalPositionPoints = keptScores.reduce((sum, s) => sum + s.score, 0);
      const keptTournamentNumbers = new Set(keptScores.map(s => s.tournamentNumber));

      // Build rich detail JSON for frontend display
      const ppDetail = {
        tournaments: {},
        kept: keptScores.map(s => s.tournamentNumber),
      };
      for (const tn of tournamentNumbers) {
        const t = data.tournaments[tn];
        ppDetail.tournaments[tn] = {
          score: t.score,
          pts_clt: t.positionPoints,
          bonus: t.bonus,
          moy: t.reprises > 0 ? Math.round((t.points / t.reprises) * 1000) / 1000 : 0,
          pts: t.points,
          rep: t.reprises,
          pm: t.matchPoints,
          ms: t.serie,
        };
      }

      // Compute average from the best N tournaments' points/reprises
      let totalPoints = 0, totalReprises = 0, bestSerie = 0;
      for (const tn of tournamentNumbers) {
        const t = data.tournaments[tn];
        if (keptTournamentNumbers.has(tn)) {
          totalPoints += t.points;
          totalReprises += t.reprises;
        }
        if (t.serie > bestSerie) bestSerie = t.serie;
      }
      const avgMoyenne = totalReprises > 0 ? totalPoints / totalReprises : 0;
      ppDetail.seasonPts = totalPoints;
      ppDetail.seasonRep = totalReprises;
      ppDetail.moyGen = ffbMoyennes[licence] || null;

      // Average bonus (only if enabled AND bonus moyenne not already applied at tournament level)
      let averageBonus = 0;
      if (applySeasonBonus) {
        if (bonusMoyenneType === 'tiered') {
          // Par paliers: < mini → 0, mini–middle → tier1, middle–maxi → tier2, ≥ maxi → tier3
          if (avgMoyenne >= moyenneMaxi) {
            averageBonus = tier3;
          } else if (avgMoyenne >= moyenneMiddle) {
            averageBonus = tier2;
          } else if (avgMoyenne >= moyenneMini) {
            averageBonus = tier1;
          }
        } else {
          // Normal: > maxi → tier2, between min and max → tier1, below → 0
          if (avgMoyenne > moyenneMaxi) {
            averageBonus = tier2;
          } else if (avgMoyenne >= moyenneMini) {
            averageBonus = tier1;
          }
        }
      }

      const totalScore = totalPositionPoints + averageBonus;

      // Per-tournament scores for T1/T2/T3 columns (position_points + bonus)
      const t1 = data.tournaments[1]?.score ?? null;
      const t2 = data.tournaments[2]?.score ?? null;
      const t3 = data.tournaments[3]?.score ?? null;

      rankings.push({
        licence,
        playerName: data.playerName,
        totalScore,
        totalPositionPoints,
        averageBonus,
        avgMoyenne,
        bestSerie,
        t1, t2, t3,
        ppDetail: JSON.stringify(ppDetail),
        totalPoints,
        totalReprises,
      });
    }

    // Sort by total score DESC, then average DESC, then best serie DESC
    rankings.sort((a, b) => b.totalScore - a.totalScore || b.avgMoyenne - a.avgMoyenne || b.bestSerie - a.bestSerie);

    // Delete existing rankings
    await dbRunAsync('DELETE FROM rankings WHERE category_id = ? AND season = ?', [categoryId, season]);

    // Insert new rankings
    for (let i = 0; i < rankings.length; i++) {
      const r = rankings[i];
      await dbRunAsync(
        `INSERT INTO rankings (
          category_id, season, licence, total_match_points, avg_moyenne, best_serie,
          rank_position, tournament_1_points, tournament_2_points, tournament_3_points,
          total_bonus_points, organization_id, position_points_detail, average_bonus
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          categoryId, season, r.licence,
          r.totalScore,        // reuse total_match_points for total score
          r.avgMoyenne,
          r.bestSerie,
          i + 1,               // rank_position
          r.t1, r.t2, r.t3,
          r.averageBonus,      // reuse total_bonus_points for average bonus
          orgId,
          r.ppDetail,
          r.averageBonus,
        ]
      );
    }

    console.log(`[RANKING-J] Completed: ${rankings.length} players ranked`);
    callback(null);
  } catch (error) {
    console.error(`[RANKING-J] Error:`, error);
    callback(error);
  }
}

// ==================== STANDARD RANKING (3 Tournois) ====================
async function recalculateRankingsStandard(categoryId, season, callback, orgId) {
  console.log(`[RANKING] Starting recalculation for category ${categoryId}, season ${season}`);

  // Get ranking tournament numbers dynamically (excludes finale)
  const rankingNumbers = await getRankingTournamentNumbers(orgId);
  const rankingNumbersSQL = rankingNumbers.join(',');

  // Build CASE WHEN clauses dynamically for per-tournament point columns
  const caseClauses = rankingNumbers.map((num, i) =>
    `MAX(CASE WHEN t.tournament_number = ${num} THEN tr.match_points + COALESCE(tr.bonus_points, 0) ELSE NULL END) as t${i + 1}_points`
  ).join(',\n      ');

  // Get all tournament results for this category and season
  // Exclude finale from ranking calculation
  // Ranking order: 1) match points DESC, 2) cumulative moyenne DESC, 3) best serie DESC
  const query = `
    SELECT
      REPLACE(tr.licence, ' ', '') as licence,
      MAX(tr.player_name) as player_name,
      SUM(tr.match_points) + SUM(COALESCE(tr.bonus_points, 0)) as total_match_points,
      SUM(COALESCE(tr.bonus_points, 0)) as total_bonus_points,
      SUM(tr.points) as total_points,
      SUM(tr.reprises) as total_reprises,
      CASE
        WHEN SUM(tr.reprises) > 0 THEN CAST(SUM(tr.points) AS FLOAT) / CAST(SUM(tr.reprises) AS FLOAT)
        ELSE 0
      END as avg_moyenne,
      MAX(tr.serie) as best_serie,
      ${caseClauses},
      MAX(t.organization_id) as org_id
    FROM tournament_results tr
    JOIN tournaments t ON tr.tournament_id = t.id
    WHERE t.category_id = ? AND t.season = ? AND t.tournament_number IN (${rankingNumbersSQL})
    GROUP BY REPLACE(tr.licence, ' ', '')
    ORDER BY total_match_points DESC, avg_moyenne DESC, best_serie DESC
  `;

  db.all(query, [categoryId, season], (err, results) => {
    if (err) {
      console.error(`[RANKING] Error calculating rankings for category ${categoryId}:`, err);
      return callback(err);
    }

    console.log(`[RANKING] Found ${results.length} players to rank for category ${categoryId}`);

    if (results.length === 0) {
      console.log(`[RANKING] No players found, skipping ranking update`);
      return callback(null);
    }

    // Log top 3 for verification
    console.log(`[RANKING] Top 3: ${results.slice(0, 3).map(r => `${r.licence}(${r.total_match_points}pts)`).join(', ')}`);

    // Delete existing rankings
    db.run('DELETE FROM rankings WHERE category_id = ? AND season = ?', [categoryId, season], function(err) {
      if (err) {
        console.error(`[RANKING] Error deleting old rankings:`, err);
        return callback(err);
      }

      console.log(`[RANKING] Deleted ${this.changes} old ranking entries`);

      // Insert new rankings with positions
      const stmt = db.prepare(`
        INSERT INTO rankings (
          category_id, season, licence, total_match_points, avg_moyenne, best_serie,
          rank_position, tournament_1_points, tournament_2_points, tournament_3_points, total_bonus_points, organization_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let insertCount = 0;
      let successCount = 0;
      let insertErrors = [];

      results.forEach((result, index) => {
        stmt.run(
          categoryId,
          season,
          result.licence,
          result.total_match_points,
          result.avg_moyenne,
          result.best_serie,
          index + 1,
          result.t1_points,
          result.t2_points,
          result.t3_points,
          result.total_bonus_points || 0,
          result.org_id || null,
          (err) => {
            insertCount++;

            if (err) {
              insertErrors.push({ licence: result.licence, error: err.message });
              console.error(`[RANKING] Error inserting ranking for ${result.licence}:`, err.message);
            } else {
              successCount++;
            }

            // After all inserts are done, finalize and verify
            if (insertCount === results.length) {
              stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                  console.error(`[RANKING] Error finalizing:`, finalizeErr);
                }

                // Verification log
                console.log(`[RANKING] Completed: ${successCount}/${results.length} players inserted successfully`);

                if (insertErrors.length > 0) {
                  console.error(`[RANKING] Failed insertions:`, insertErrors);
                }

                // Verify count in database
                db.get('SELECT COUNT(*) as count FROM rankings WHERE category_id = ? AND season = ?',
                  [categoryId, season], (err, row) => {
                    if (!err && row) {
                      console.log(`[RANKING] Verification: ${row.count} entries in rankings table`);
                      if (row.count !== results.length) {
                        console.error(`[RANKING] WARNING: Expected ${results.length} but found ${row.count} in database!`);
                      }
                    }

                    // Aggregate bonus_detail per player across tournaments
                    db.all(
                      `SELECT REPLACE(tr.licence, ' ', '') as licence, tr.bonus_detail
                       FROM tournament_results tr
                       JOIN tournaments t ON tr.tournament_id = t.id
                       WHERE t.category_id = ? AND t.season = ? AND t.tournament_number IN (${rankingNumbersSQL})
                       AND tr.bonus_detail IS NOT NULL`,
                      [categoryId, season],
                      (err, detailRows) => {
                        if (!err && detailRows && detailRows.length > 0) {
                          const playerDetails = {};
                          detailRows.forEach(dr => {
                            const lic = dr.licence;
                            if (!playerDetails[lic]) playerDetails[lic] = {};
                            try {
                              const detail = JSON.parse(dr.bonus_detail);
                              for (const [ruleType, pts] of Object.entries(detail)) {
                                playerDetails[lic][ruleType] = (playerDetails[lic][ruleType] || 0) + pts;
                              }
                            } catch (e) { /* ignore */ }
                          });

                          let detailUpdates = 0;
                          const entries = Object.entries(playerDetails);
                          if (entries.length === 0) {
                            return callback(insertErrors.length > 0 ? new Error(`${insertErrors.length} insertions failed`) : finalizeErr);
                          }
                          entries.forEach(([licence, detail]) => {
                            db.run(
                              'UPDATE rankings SET bonus_detail = ? WHERE category_id = ? AND season = ? AND licence = ?',
                              [JSON.stringify(detail), categoryId, season, licence],
                              () => {
                                detailUpdates++;
                                if (detailUpdates === entries.length) {
                                  console.log(`[RANKING] Updated bonus_detail for ${detailUpdates} players`);
                                  callback(insertErrors.length > 0 ? new Error(`${insertErrors.length} insertions failed`) : finalizeErr);
                                }
                              }
                            );
                          });
                        } else {
                          callback(insertErrors.length > 0 ? new Error(`${insertErrors.length} insertions failed`) : finalizeErr);
                        }
                      }
                    );
                  }
                );
              });
            }
          }
        );
      });
    });
  });
}

// Recompute bonus points for all tournaments in a category/season
async function recomputeAllBonuses(categoryId, season, orgId, callback) {
  try {
    const rankingNumbers = await getRankingTournamentNumbers(orgId);
    if (!rankingNumbers || rankingNumbers.length === 0) {
      console.log(`[BONUS] No ranking tournament numbers for org ${orgId}, skipping recompute`);
      return callback(null);
    }
    console.log(`[BONUS] Recomputing bonuses for category ${categoryId}, season ${season}, org ${orgId}, tournamentNumbers=[${rankingNumbers.join(',')}]`);

    const tournaments = await dbAllAsync(
      `SELECT id FROM tournaments WHERE category_id = $1 AND season = $2 AND tournament_number IN (${rankingNumbers.join(',')})`,
      [categoryId, season]
    );

    if (!tournaments || tournaments.length === 0) {
      console.log(`[BONUS] No tournaments found for category ${categoryId}, season ${season}`);
      return callback(null);
    }
    console.log(`[BONUS] Found ${tournaments.length} tournaments to recompute: [${tournaments.map(t => t.id).join(',')}]`);

    // Step 1: Re-assign position points for each tournament (fixes TQs imported before settings were configured)
    for (const t of tournaments) {
      try {
        await assignPositionPointsIfJournees(t.id, orgId);
      } catch (ppErr) {
        console.error(`[BONUS] Error assigning position points for tournament ${t.id}:`, ppErr);
      }
    }

    // Step 2: Compute barème bonus points (sequential, one tournament at a time)
    for (const t of tournaments) {
      await new Promise((resolve) => {
        computeBonusPoints(t.id, categoryId, orgId, resolve);
      });
    }

    // Step 3: Explicitly apply bonus moyenne as a separate pass (safety net — the callback chain
    // from computeBonusPoints to computeBonusMoyenne may not execute reliably because
    // computeBonusMoyenne is async but called from a callback context)
    for (const t of tournaments) {
      await new Promise((resolve) => {
        computeBonusMoyenne(t.id, categoryId, orgId, resolve);
      });
    }

    // Verify: check if MOYENNE_BONUS was written
    for (const t of tournaments) {
      const sample = await dbGetAsync(
        'SELECT bonus_detail FROM tournament_results WHERE tournament_id = $1 AND bonus_detail IS NOT NULL LIMIT 1',
        [t.id]
      );
      if (sample) {
        try {
          const detail = JSON.parse(sample.bonus_detail);
          console.log(`[BONUS] Verification for tournament ${t.id}: bonus_detail=${JSON.stringify(detail)}`);
        } catch (e) {}
      } else {
        console.log(`[BONUS] Verification for tournament ${t.id}: no bonus_detail found`);
      }
    }

    callback(null);
  } catch (error) {
    console.error(`[BONUS] Error in recomputeAllBonuses:`, error);
    callback(null);
  }
}

// Recalculate rankings for a category/season (without reimporting)
router.post('/recalculate-rankings', authenticateToken, (req, res) => {
  const { categoryId, season } = req.body;

  if (!categoryId || !season) {
    return res.status(400).json({ error: 'categoryId and season required' });
  }

  // Recompute bonuses first (in case scoring rules changed), then recalculate rankings
  const orgId = req.user.organizationId || null;
  recomputeAllBonuses(categoryId, season, orgId, () => {
  recalculateRankings(categoryId, season, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Get count of ranked players to return to frontend
    db.get('SELECT COUNT(*) as count FROM rankings WHERE category_id = ? AND season = ?',
      [categoryId, season], (countErr, row) => {
        const playersRanked = row ? row.count : 0;
        res.json({
          message: 'Rankings recalculated successfully',
          playersRanked: playersRanked
        });
      });
  });
  }); // close recomputeAllBonuses
});

// Get all tournaments
router.get('/', authenticateToken, (req, res) => {
  console.log('GET /api/tournaments called, season:', req.query.season);
  const { season } = req.query;
  const orgId = req.user.organizationId || null;

  let query = `
    SELECT
      t.id,
      t.tournament_number,
      t.season,
      t.tournament_date,
      t.import_date,
      t.location,
      t.location_2,
      t.results_email_sent,
      t.results_email_sent_at,
      c.id as category_id,
      c.game_type,
      c.level,
      c.display_name,
      COUNT(tr.id) as player_count,
      COALESCE(tt.is_finale, FALSE) as is_finale,
      tt.display_name as type_display_name
    FROM tournaments t
    JOIN categories c ON t.category_id = c.id
    LEFT JOIN tournament_results tr ON tr.tournament_id = t.id
    LEFT JOIN tournament_types tt ON t.tournament_number = tt.tournament_number
      AND ($1::int IS NULL OR tt.organization_id = $1)
    WHERE ($1::int IS NULL OR t.organization_id = $1)
  `;

  const params = [orgId];
  if (season) {
    query += ' AND t.season = $2';
    params.push(season);
  }

  query += ' GROUP BY t.id, t.tournament_number, t.season, t.tournament_date, t.import_date, t.location, t.location_2, t.results_email_sent, t.results_email_sent_at, c.id, c.game_type, c.level, c.display_name, tt.is_finale, tt.display_name ORDER BY t.import_date DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching tournaments:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log('Tournaments fetched successfully:', rows.length, 'tournaments');
    res.json(rows);
  });
});

// Mark ALL tournaments as results sent (bulk action for migration)
// IMPORTANT: This must be defined BEFORE routes with :id parameter
router.post('/mark-all-results-sent', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.run(
    `UPDATE tournaments SET results_email_sent = $1, results_email_sent_at = CURRENT_TIMESTAMP WHERE (results_email_sent IS NULL OR NOT results_email_sent) AND ($2::int IS NULL OR organization_id = $2)`,
    [true, orgId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, message: `${this.changes} tournaments marked as results sent` });
    }
  );
});

// Get tournament results by ID
router.get('/:id/results', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const orgId = req.user.organizationId || null;

    // Get tournament info
    const tournament = await dbGetAsync(
      `SELECT t.*, c.display_name, c.game_type, c.level,
              COALESCE(tt.is_finale, FALSE) as is_finale,
              tt.display_name as type_display_name
       FROM tournaments t
       JOIN categories c ON t.category_id = c.id
       LEFT JOIN tournament_types tt ON t.tournament_number = tt.tournament_number
         AND (t.organization_id IS NULL OR tt.organization_id = t.organization_id)
       WHERE t.id = $1`,
      [tournamentId]
    );

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Get tournament results
    const results = await dbAllAsync(
      `SELECT tr.*, p.club as club_name,
              COALESCE(pc.first_name, p.first_name) as first_name,
              COALESCE(pc.last_name, p.last_name) as last_name,
              c.logo_filename as club_logo,
              pc.email
       FROM tournament_results tr
       LEFT JOIN players p ON REPLACE(tr.licence, ' ', '') = REPLACE(p.licence, ' ', '')
       LEFT JOIN player_contacts pc ON REPLACE(tr.licence, ' ', '') = REPLACE(pc.licence, ' ', '')
       LEFT JOIN clubs c ON REPLACE(REPLACE(REPLACE(UPPER(COALESCE(pc.club, p.club)), ' ', ''), '.', ''), '-', '') = REPLACE(REPLACE(REPLACE(UPPER(c.name), ' ', ''), '.', ''), '-', '')
       WHERE tr.tournament_id = $1
       ORDER BY tr.position ASC`,
      [tournamentId]
    );

    // ── Compute bonus moyenne ON THE FLY ──
    const bonusDiag = { orgId, enabled: false };
    try {
      const rawSetting = orgId ? (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) : '';
      bonusDiag.rawSetting = rawSetting;
      bonusDiag.enabled = rawSetting === 'true';

      if (bonusDiag.enabled && results && results.length > 0) {
        const bonusType = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type')) || 'normal';
        const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
        const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
        const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;
        bonusDiag.bonusType = bonusType;
        bonusDiag.tiers = [tier1, tier2, tier3];

        // Load game_parameters (same pattern as recalculateRankingsJournees which WORKS)
        const cat = await dbGetAsync(
          'SELECT game_type, level, organization_id FROM categories WHERE id = $1',
          [tournament.category_id]
        );
        bonusDiag.category = cat ? { game_type: cat.game_type, level: cat.level, org: cat.organization_id } : null;

        if (cat) {
          const gp = await dbGetAsync(
            'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)',
            [cat.game_type, cat.level, cat.organization_id || orgId]
          );
          bonusDiag.gameParams = gp ? { mini: gp.moyenne_mini, maxi: gp.moyenne_maxi } : 'defaults (0/999)';

          // Same defaults as recalculateRankingsJournees — compute even without game_parameters
          const moyenneMini = (gp && gp.moyenne_mini != null) ? parseFloat(gp.moyenne_mini) : 0;
          const moyenneMaxi = (gp && gp.moyenne_maxi != null) ? parseFloat(gp.moyenne_maxi) : 999;
          const moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;
          bonusDiag.thresholds = { mini: moyenneMini, middle: moyenneMiddle, maxi: moyenneMaxi };
          let applied = 0;

            for (const r of results) {
              let detail = {};
              try { detail = JSON.parse(r.bonus_detail || '{}'); } catch (e) { detail = {}; }

              const moyenne = r.reprises > 0 ? r.points / r.reprises : 0;
              let bonus = 0;

              if (bonusType === 'tiered') {
                if (moyenne >= moyenneMaxi) bonus = tier3;
                else if (moyenne >= moyenneMiddle) bonus = tier2;
                else if (moyenne >= moyenneMini) bonus = tier1;
              } else {
                if (moyenne > moyenneMaxi) bonus = tier2;
                else if (moyenne >= moyenneMini) bonus = tier1;
              }

              if (bonus > 0) {
                detail.MOYENNE_BONUS = bonus;
                applied++;
              } else {
                delete detail.MOYENNE_BONUS;
              }

              r.bonus_detail = JSON.stringify(detail);
              r.bonus_points = Object.values(detail).reduce((a, b) => a + b, 0);

              // Persist to DB (fire-and-forget)
              dbRunAsync(
                'UPDATE tournament_results SET bonus_points = $1, bonus_detail = $2 WHERE id = $3',
                [r.bonus_points, r.bonus_detail, r.id]
              ).catch(() => {});
            }
            bonusDiag.applied = applied;
            bonusDiag.total = results.length;
        }
      }
    } catch (bonusErr) {
      bonusDiag.error = bonusErr.message;
      console.error('[RESULTS] Error computing bonus moyenne:', bonusErr);
    }

    // ── Extract bonus column metadata ──
    const seenTypes = new Set();
    let hasLegacyBonus = false;
    (results || []).forEach(r => {
      if (r.bonus_detail) {
        try {
          const detail = JSON.parse(r.bonus_detail);
          Object.keys(detail).forEach(k => { if (detail[k] > 0) seenTypes.add(k); });
        } catch (e) {}
      }
      if (!r.bonus_detail && r.bonus_points > 0) hasLegacyBonus = true;
    });

    if (hasLegacyBonus && seenTypes.size === 0) {
      seenTypes.add('MOYENNE_BONUS');
      (results || []).forEach(r => {
        if (!r.bonus_detail && r.bonus_points > 0) {
          r.bonus_detail = JSON.stringify({ MOYENNE_BONUS: r.bonus_points });
        }
      });
    }

    // Get column labels
    let bonusColumns = [];
    if (seenTypes.size > 0) {
      const defaultLabels = { MOYENNE_BONUS: 'Bonus Moy.' };
      const typesArr = [...seenTypes];
      const placeholders = typesArr.map((_, i) => `$${i + 1}`).join(',');
      const orgParam = typesArr.length + 1;
      const labelRows = await dbAllAsync(
        `SELECT DISTINCT rule_type, column_label FROM scoring_rules WHERE rule_type IN (${placeholders}) AND column_label IS NOT NULL AND ($${orgParam}::int IS NULL OR organization_id = $${orgParam})`,
        [...typesArr, orgId]
      );
      const labelMap = {};
      (labelRows || []).forEach(r => { labelMap[r.rule_type] = r.column_label; });
      bonusColumns = typesArr.map(rt => ({ ruleType: rt, label: labelMap[rt] || defaultLabels[rt] || rt }));
    }

    // ── Build bonusMoyenneInfo for frontend info card ──
    let bonusMoyenneInfo = null;
    if (bonusDiag.enabled && bonusDiag.thresholds) {
      const t = bonusDiag.thresholds;
      bonusMoyenneInfo = {
        enabled: true,
        type: bonusDiag.bonusType || 'normal',
        mini: t.mini,
        middle: t.middle,
        maxi: t.maxi,
        tiers: bonusDiag.tiers || [1, 2, 3]
      };
    }

    // ── Compute position_points on the fly (journées mode) ──
    try {
      const qualMode = orgId ? (await appSettings.getOrgSetting(orgId, 'qualification_mode')) : null;
      if (qualMode === 'journees' && results && results.length > 0) {
        const nbPlayers = results.length;
        const lookup = await getPositionPointsLookup(orgId, nbPlayers);
        if (Object.keys(lookup).length > 0) {
          // Check if bracket data exists (positions already set by import-matches)
          let hasBracket = false;
          try {
            const mRow = await dbGetAsync('SELECT 1 FROM tournament_matches WHERE tournament_id = $1 LIMIT 1', [tournamentId]);
            hasBracket = !!mRow;
          } catch (e) { /* table may not exist */ }

          const degradation = await appSettings.getOrgSetting(orgId, 'position_points_degradation');

          if (hasBracket) {
            // Use existing positions from results (bracket-derived)
            for (const r of results) {
              const pos = r.position || 0;
              let pp;
              if (degradation === 'last_player' && pos === nbPlayers && nbPlayers > 0) {
                pp = lookup[pos + 1] || 0;
              } else {
                pp = lookup[pos] || 0;
              }
              r.position_points = pp;
              dbRunAsync('UPDATE tournament_results SET position_points = $1 WHERE id = $2', [pp, r.id]).catch(() => {});
            }
          } else {
            // Sort by match_points desc + moyenne desc to determine positions
            const sorted = [...results].sort((a, b) => {
              if (b.match_points !== a.match_points) return b.match_points - a.match_points;
              const avgA = a.reprises > 0 ? a.points / a.reprises : 0;
              const avgB = b.reprises > 0 ? b.points / b.reprises : 0;
              return avgB - avgA;
            });
            for (let i = 0; i < sorted.length; i++) {
              const position = i + 1;
              let pp;
              if (degradation === 'last_player' && position === nbPlayers && nbPlayers > 0) {
                pp = lookup[position + 1] || 0;
              } else {
                pp = lookup[position] || 0;
              }
              sorted[i].position_points = pp;
              dbRunAsync('UPDATE tournament_results SET position_points = $1 WHERE id = $2', [pp, sorted[i].id]).catch(() => {});
            }
          }
        }
      }
    } catch (ppErr) {
      console.error('[RESULTS] Error computing position points:', ppErr);
    }

    // Check if tournament has individual match data
    let hasMatchData = false;
    let matchCount = 0;
    try {
      const matchRow = await dbGetAsync(
        'SELECT COUNT(*) as cnt FROM tournament_matches WHERE tournament_id = $1',
        [tournamentId]
      );
      matchCount = matchRow ? parseInt(matchRow.cnt) : 0;
      hasMatchData = matchCount > 0;
    } catch (e) { /* table may not exist yet */ }

    // ── Recompute match-level fields from tournament_matches if missing in results ──
    // This handles the case where results were imported via standard CSV but match data exists
    if (hasMatchData && results && results.length > 0) {
      const needsRecompute = results.some(r => !r.poule_rank && !r.parties_menees && !r.meilleure_partie);
      if (needsRecompute) {
        try {
          const matches = await dbAllAsync(
            'SELECT * FROM tournament_matches WHERE tournament_id = $1',
            [tournamentId]
          );
          if (matches && matches.length > 0) {
            // Aggregate match data per player (global stats for parties_menees and MPART)
            const playerMatchData = {};
            for (const m of matches) {
              for (const side of ['player1', 'player2']) {
                const licence = m[`${side}_licence`];
                if (!licence) continue;
                const points = parseFloat(m[`${side}_points`]) || 0;
                const reprises = parseFloat(m[`${side}_reprises`]) || 0;
                const matchMoyenne = reprises > 0 ? points / reprises : 0;

                const matchPts = parseFloat(m[`${side}_match_points`]) || 0;
                if (!playerMatchData[licence]) {
                  playerMatchData[licence] = { parties_menees: 0, best_single_moyenne: 0 };
                }
                const pd = playerMatchData[licence];
                pd.parties_menees++;
                // MPART: only from WON matches (match_points > 0)
                if (matchPts > 0 && matchMoyenne > pd.best_single_moyenne) pd.best_single_moyenne = matchMoyenne;
              }
            }

            // Group matches by poule name and compute per-poule stats for REGULAR poules only
            const matchesByPoule = {};
            for (const m of matches) {
              const poule = m.poule_name || 'POULE A';
              if (!matchesByPoule[poule]) matchesByPoule[poule] = [];
              matchesByPoule[poule].push(m);
            }

            const pouleRankMap = {}; // licence → { poule_rank, poule_name }
            for (const [pouleName, pouleMatches] of Object.entries(matchesByPoule)) {
              if (isClassificationPoule(pouleName)) continue; // Skip classification phases
              const playerMap = {};
              for (const m of pouleMatches) {
                for (const side of ['player1', 'player2']) {
                  const licence = m[`${side}_licence`];
                  if (!licence) continue;
                  const matchPts = parseFloat(m[`${side}_match_points`]) || 0;
                  const points = parseFloat(m[`${side}_points`]) || 0;
                  const reprises = parseFloat(m[`${side}_reprises`]) || 0;
                  const serie = parseFloat(m[`${side}_serie`]) || 0;
                  if (!playerMap[licence]) {
                    playerMap[licence] = { licence, total_match_points: 0, total_points: 0, total_reprises: 0, max_serie: 0 };
                  }
                  playerMap[licence].total_match_points += matchPts;
                  playerMap[licence].total_points += points;
                  playerMap[licence].total_reprises += reprises;
                  playerMap[licence].max_serie = Math.max(playerMap[licence].max_serie, serie);
                }
              }
              const players = Object.values(playerMap);
              sortByPerformance(players);
              players.forEach((p, i) => {
                pouleRankMap[p.licence] = { poule_rank: i + 1, poule_name: pouleName };
              });
            }

            // Merge into results and persist
            for (const r of results) {
              const licence = r.licence.replace(/ /g, '');
              const md = playerMatchData[licence] || playerMatchData[r.licence];
              const pr = pouleRankMap[licence] || pouleRankMap[r.licence];
              if (pr && !r.poule_rank) r.poule_rank = pr.poule_rank;
              if (md) {
                if (!r.parties_menees && md.parties_menees) r.parties_menees = md.parties_menees;
                if (!r.meilleure_partie && md.best_single_moyenne) r.meilleure_partie = parseFloat(md.best_single_moyenne.toFixed(4));
              }
              // Fire-and-forget persist
              dbRunAsync(
                'UPDATE tournament_results SET poule_rank = $1, parties_menees = $2, meilleure_partie = $3 WHERE id = $4',
                [r.poule_rank || 0, r.parties_menees || 0, r.meilleure_partie || 0, r.id]
              ).catch(() => {});
            }
            console.log(`[RESULTS] Recomputed match-level fields for ${Object.keys(pouleRankMap).length} players from ${matches.length} matches`);
          }
        } catch (recomputeErr) {
          console.error('[RESULTS] Error recomputing match-level fields:', recomputeErr);
        }
      }
    }

    res.json({ tournament, results, bonusColumns, bonusMoyenneInfo, hasMatchData, matchCount, _bonusDiag: bonusDiag });
  } catch (error) {
    console.error('[RESULTS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export tournament results to Excel
router.get('/:id/export', authenticateToken, async (req, res) => {
  const tournamentId = req.params.id;
  const ExcelJS = require('exceljs');

  // Get tournament info
  db.get(
    `SELECT t.*, c.display_name, c.game_type, c.level
     FROM tournaments t
     JOIN categories c ON t.category_id = c.id
     WHERE t.id = ?`,
    [tournamentId],
    async (err, tournament) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }

      // Get tournament results with club name and logo
      db.all(
        `SELECT tr.*, p.club as club_name, c.logo_filename as club_logo
         FROM tournament_results tr
         LEFT JOIN players p ON tr.licence = p.licence
         LEFT JOIN clubs c ON REPLACE(REPLACE(REPLACE(UPPER(p.club), ' ', ''), '.', ''), '-', '') = REPLACE(REPLACE(REPLACE(UPPER(c.name), ' ', ''), '.', ''), '-', '')
         WHERE tr.tournament_id = ?
         ORDER BY tr.position ASC`,
        [tournamentId],
        async (err, results) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          try {
            const orgId = req.user.organizationId || null;

            // ── Compute bonus moyenne ON THE FLY for Excel export too ──
            try {
              const bonusEnabled = orgId ? ((await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) === 'true') : false;
              if (bonusEnabled && results && results.length > 0) {
                const bonusType = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type')) || 'normal';
                const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
                const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
                const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;
                const cat = await dbGetAsync('SELECT game_type, level, organization_id FROM categories WHERE id = $1', [tournament.category_id]);
                let gp = null;
                if (cat) {
                  gp = await dbGetAsync(
                    'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)',
                    [cat.game_type, cat.level, cat.organization_id || orgId]
                  );
                }
                const moyenneMini = (gp && gp.moyenne_mini != null) ? parseFloat(gp.moyenne_mini) : 0;
                const moyenneMaxi = (gp && gp.moyenne_maxi != null) ? parseFloat(gp.moyenne_maxi) : 999;
                const moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;
                for (const r of results) {
                  let detail = {};
                  try { detail = JSON.parse(r.bonus_detail || '{}'); } catch (e) { detail = {}; }
                  const moyenne = r.reprises > 0 ? r.points / r.reprises : 0;
                  let bonus = 0;
                  if (bonusType === 'tiered') {
                    if (moyenne >= moyenneMaxi) bonus = tier3;
                    else if (moyenne >= moyenneMiddle) bonus = tier2;
                    else if (moyenne >= moyenneMini) bonus = tier1;
                  } else {
                    if (moyenne > moyenneMaxi) bonus = tier2;
                    else if (moyenne >= moyenneMini) bonus = tier1;
                  }
                  if (bonus > 0) detail.MOYENNE_BONUS = bonus;
                  else delete detail.MOYENNE_BONUS;
                  r.bonus_detail = JSON.stringify(detail);
                  r.bonus_points = Object.values(detail).reduce((a, b) => a + b, 0);
                }
              }
            } catch (bonusErr) {
              console.error('[EXPORT] Error computing bonus moyenne on the fly:', bonusErr);
            }

            // Parse bonus_detail to find dynamic bonus columns
            const seenTypes = new Set();
            let hasLegacyBonus = false;
            (results || []).forEach(r => {
              if (r.bonus_detail) {
                try {
                  const detail = JSON.parse(r.bonus_detail);
                  Object.keys(detail).forEach(k => { if (detail[k] > 0) seenTypes.add(k); });
                } catch(e) {}
              }
              if (!r.bonus_detail && r.bonus_points > 0) hasLegacyBonus = true;
            });

            // Backfill legacy results for Excel export
            if (hasLegacyBonus && seenTypes.size === 0) {
              seenTypes.add('MOYENNE_BONUS');
              (results || []).forEach(r => {
                if (!r.bonus_detail && r.bonus_points > 0) {
                  r.bonus_detail = JSON.stringify({ MOYENNE_BONUS: r.bonus_points });
                }
              });
            }

            let bonusColumns = [];
            if (seenTypes.size > 0) {
              const orgId = req.user.organizationId || null;
              const typesArr = [...seenTypes];
              const placeholders = typesArr.map((_, i) => `$${i + 1}`).join(',');
              const orgParam = typesArr.length + 1;
              const labelRows = await new Promise((resolve, reject) => {
                db.all(
                  `SELECT DISTINCT rule_type, column_label FROM scoring_rules WHERE rule_type IN (${placeholders}) AND column_label IS NOT NULL AND ($${orgParam}::int IS NULL OR organization_id = $${orgParam})`,
                  [...typesArr, orgId],
                  (err, rows) => { if (err) reject(err); else resolve(rows || []); }
                );
              });
              const labelMap = {};
              labelRows.forEach(r => { labelMap[r.rule_type] = r.column_label; });
              bonusColumns = [...seenTypes].map(rt => ({ ruleType: rt, label: labelMap[rt] || rt }));
            }

            const hasBonusCols = bonusColumns.length > 0;
            // Base cols: Position, Licence, Joueur, Club, Logo, Pts Match = 6
            // + bonus columns + Total (if bonus) + Points, Reprises, Moyenne, Meilleure Série = 4
            const totalExcelCols = 10 + bonusColumns.length + (hasBonusCols ? 1 : 0);
            const lastCol = String.fromCharCode(64 + totalExcelCols);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Résultats');

            // Add organization logo
            try {
              const logoBuffer = await getOrganizationLogoBuffer();
              if (logoBuffer) {
                const imageId = workbook.addImage({
                  buffer: logoBuffer,
                  extension: 'png',
                });
                worksheet.addImage(imageId, {
                  tl: { col: 0, row: 0 },
                  ext: { width: 80, height: 45 }
                });
              }
            } catch (err) {
              console.log('Logo not found for Excel:', err.message);
            }

            // Title - Row 1
            worksheet.mergeCells(`B1:${lastCol}1`);
            worksheet.getCell('B1').value = `RÉSULTATS ${tournament.display_name.toUpperCase()}`;
            worksheet.getCell('B1').font = { size: 18, bold: true, color: { argb: 'FF1F4788' } };
            worksheet.getCell('B1').alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.getCell('B1').fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE7F3FF' }
            };
            worksheet.getCell('A1').fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE7F3FF' }
            };
            worksheet.getRow(1).height = 35;

            // Subtitle - Row 2
            worksheet.mergeCells(`A2:${lastCol}2`);
            const tournamentDate = tournament.tournament_date
              ? new Date(tournament.tournament_date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
              : '';
            const finaleNumber = await getFinaleTournamentNumber(tournament.organization_id);
            const isFinale = tournament.tournament_number === finaleNumber;
            const tournamentLabel = await getTournamentLabel(tournament.tournament_number, tournament.organization_id) || (isFinale ? 'Finale Départementale' : `Tournoi ${tournament.tournament_number}`);
            worksheet.getCell('A2').value = `${tournamentLabel} • Saison ${tournament.season}${tournamentDate ? ' • ' + tournamentDate : ''}`;
            worksheet.getCell('A2').font = { size: 11, italic: true, color: { argb: 'FF666666' } };
            worksheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.getRow(2).height = 20;

            // Add podium section for finale
            if (isFinale && results.length >= 3) {
              // Podium section in Row 3
              worksheet.mergeCells(`A3:${lastCol}3`);
              worksheet.getCell('A3').value = '🏆 PODIUM DE LA FINALE 🏆';
              worksheet.getCell('A3').font = { size: 14, bold: true, color: { argb: 'FFFFD700' } };
              worksheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
              worksheet.getCell('A3').fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4788' }
              };
              worksheet.getRow(3).height = 25;

              // Podium positions - Rows 4-6
              const medals = ['🥇', '🥈', '🥉'];
              const podiumColors = ['FFFFD700', 'FFC0C0C0', 'FFCD7F32'];
              const positions = ['1er', '2ème', '3ème'];

              for (let i = 0; i < 3; i++) {
                const row = 4 + i;
                const result = results[i];
                const moyenne = result.reprises > 0 ? (result.points / result.reprises).toFixed(3) : '0.000';
                const clubName = result.club_name || 'N/A';

                worksheet.mergeCells(`A${row}:${lastCol}${row}`);
                worksheet.getCell(`A${row}`).value = `${medals[i]} ${positions[i]} - ${result.player_name} • ${result.match_points} pts • Moy: ${moyenne} • Meilleure Série: ${result.serie} • ${clubName}`;
                worksheet.getCell(`A${row}`).font = { size: 12, bold: true };
                worksheet.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
                worksheet.getCell(`A${row}`).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: podiumColors[i] }
                };
                worksheet.getRow(row).height = 30;
              }

              // Add separator
              worksheet.getRow(7).height = 5;
            }

            // Headers - Row 4 for regular, Row 8 for finale
            const headerRow = isFinale ? 8 : 4;
            const headerValues = [
              'Position',
              'Licence',
              'Joueur',
              'Club',
              '', // Empty header for logo column
              'Pts Match'
            ];
            if (hasBonusCols) {
              bonusColumns.forEach(col => headerValues.push(col.label));
              headerValues.push('Total');
            }
            headerValues.push('Points', 'Reprises', 'Moyenne', 'Meilleure Série');
            worksheet.getRow(headerRow).values = headerValues;

            // Style headers
            worksheet.getRow(headerRow).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            worksheet.getRow(headerRow).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF1F4788' }
            };
            worksheet.getRow(headerRow).alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.getRow(headerRow).height = 28;
            worksheet.getRow(headerRow).border = {
              bottom: { style: 'medium', color: { argb: 'FF1F4788' } }
            };

            // Data
            results.forEach((result, index) => {
              const moyenne = result.reprises > 0
                ? (result.points / result.reprises).toFixed(3)
                : '0.000';

              const bonusDetail = (() => { try { return JSON.parse(result.bonus_detail || '{}'); } catch(e) { return {}; } })();
              const totalBonus = Object.values(bonusDetail).reduce((s, v) => s + (v || 0), 0);

              const rowValues = [
                index + 1,
                result.licence,
                result.player_name,
                result.club_name || 'N/A',
                '', // Empty cell for logo
                result.match_points
              ];
              if (hasBonusCols) {
                bonusColumns.forEach(col => rowValues.push(bonusDetail[col.ruleType] || 0));
                rowValues.push(result.match_points + totalBonus);
              }
              rowValues.push(result.points, result.reprises, moyenne, result.serie);

              const excelRow = worksheet.addRow(rowValues);

              // Podium colors for top 3
              if (index === 0) {
                // Gold
                excelRow.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFFD700' }
                };
                excelRow.font = { bold: true, size: 11 };
                excelRow.getCell(1).value = '🥇 1';
              } else if (index === 1) {
                // Silver
                excelRow.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFC0C0C0' }
                };
                excelRow.font = { bold: true, size: 11 };
                excelRow.getCell(1).value = '🥈 2';
              } else if (index === 2) {
                // Bronze
                excelRow.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFCD7F32' }
                };
                excelRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
                excelRow.getCell(1).value = '🥉 3';
              } else {
                // Alternate row colors
                if (index % 2 === 0) {
                  excelRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF8F9FA' }
                  };
                } else {
                  excelRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFFF' }
                  };
                }
              }

              // Center alignment for numeric columns and logo column
              const totalCols = totalExcelCols;
              for (let col = 1; col <= totalCols; col++) {
                if (![2, 3, 4].includes(col)) {
                  excelRow.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
                }
              }

              // Left alignment for licence, player name, and club
              [2, 3, 4].forEach(col => {
                excelRow.getCell(col).alignment = { horizontal: 'left', vertical: 'middle' };
              });

              excelRow.height = 22;

              // Add club logo in dedicated logo column if available
              if (result.club_logo) {
                const clubLogoPath = path.join(__dirname, '../../frontend/images/clubs', result.club_logo);
                if (fs.existsSync(clubLogoPath)) {
                  try {
                    const logoImageId = workbook.addImage({
                      filename: clubLogoPath,
                      extension: result.club_logo.split('.').pop(),
                    });

                    // Position logo in dedicated Logo column (column E)
                    const rowNumber = excelRow.number;
                    worksheet.addImage(logoImageId, {
                      tl: { col: 4.1, row: rowNumber - 1 + 0.15 },
                      ext: { width: 18, height: 18 }
                    });
                  } catch (err) {
                    console.log(`Could not add club logo for ${result.player_name}:`, err.message);
                  }
                }
              }
            });

            // Column widths
            const colWidths = [
              { width: 12 },  // Position
              { width: 15 },  // Licence
              { width: 30 },  // Joueur
              { width: 35 },  // Club
              { width: 4 },   // Logo
              { width: 12 }   // Pts Match
            ];
            if (hasBonusCols) {
              bonusColumns.forEach(() => colWidths.push({ width: 12 })); // Bonus columns
              colWidths.push({ width: 10 }); // Total
            }
            colWidths.push(
              { width: 12 },  // Points
              { width: 12 },  // Reprises
              { width: 12 },  // Moyenne
              { width: 16 }   // Meilleure Série
            );
            worksheet.columns = colWidths;

            // Borders for all data cells
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber >= 4) {
                row.eachCell((cell) => {
                  cell.border = {
                    top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                    left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                    bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                    right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
                  };
                });
              }
            });

            // Send file
            res.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );

            // Format date as dd_mm_yyyy
            const dateStr = tournament.tournament_date
              ? new Date(tournament.tournament_date).toLocaleDateString('fr-FR').replace(/\//g, '_')
              : '';

            // Determine tournament label (T1, T2, T3, or Finale)
            const filenameTournamentLabel = isFinale ? 'Finale' : `T${tournament.tournament_number}`;

            // Create filename: "T1, Bande R2, 15_10_2025.xlsx"
            const filename = `${filenameTournamentLabel}, ${tournament.display_name}, ${dateStr}.xlsx`;

            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${filename}"`
            );

            // Log export action
            logAdminAction({
              req,
              action: ACTION_TYPES.EXPORT_DATA,
              details: `Export Excel: ${filename}`,
              targetType: 'tournament',
              targetId: tournamentId,
              targetName: `${filenameTournamentLabel} - ${tournament.display_name}`
            });

            await workbook.xlsx.write(res);
            res.end();

          } catch (error) {
            console.error('Excel export error:', error);
            res.status(500).json({ error: error.message });
          }
        }
      );
    }
  );
});

// Delete tournament
router.delete('/:id', authenticateToken, (req, res) => {
  const tournamentId = req.params.id;

  // First get tournament info for recalculating rankings
  db.get('SELECT category_id, season FROM tournaments WHERE id = ?', [tournamentId], (err, tournament) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Delete tournament results first (foreign key constraint)
    db.run('DELETE FROM tournament_results WHERE tournament_id = ?', [tournamentId], (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Delete tournament
      db.run('DELETE FROM tournaments WHERE id = ?', [tournamentId], (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Recalculate rankings for this category and season
        recalculateRankings(tournament.category_id, tournament.season, (err) => {
          if (err) {
            return res.status(500).json({ error: 'Tournament deleted but rankings recalculation failed' });
          }

          res.json({ message: 'Tournament deleted successfully' });
        });
      });
    });
  });
});

// Recalculate ALL rankings for all categories and seasons (admin utility)
router.post('/recalculate-all-rankings', authenticateToken, async (req, res) => {
  try {
    // Get all unique category/season combinations
    const query = `
      SELECT DISTINCT t.category_id, t.season
      FROM tournaments t
      ORDER BY t.season DESC, t.category_id
    `;

    db.all(query, [], async (err, combinations) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      let recalculated = 0;
      let errors = [];

      const orgId = req.user.organizationId || null;
      for (const combo of combinations) {
        await new Promise((resolve) => {
          recomputeAllBonuses(combo.category_id, combo.season, orgId, () => {
            recalculateRankings(combo.category_id, combo.season, (err) => {
              if (err) {
                errors.push({ categoryId: combo.category_id, season: combo.season, error: err.message });
              } else {
                recalculated++;
              }
              resolve();
            });
          });
        });
      }

      res.json({
        message: `Recalculated rankings for ${recalculated} category/season combinations`,
        recalculated,
        errors: errors.length > 0 ? errors : undefined
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recompute all bonuses + rankings for current season (triggered when bonus settings change)
router.post('/recompute-all-bonuses', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const orgId = req.user.organizationId || null;
    const season = await appSettings.getCurrentSeason();

    // Get all categories for this org with tournaments in current season
    const categories = await dbAllAsync(
      `SELECT DISTINCT t.category_id, t.season
       FROM tournaments t
       WHERE t.season = $1 AND ($2::int IS NULL OR t.organization_id = $2)`,
      [season, orgId]
    );

    let recomputed = 0;
    const errors = [];
    const warnings = [];

    // Check if bonus moyenne or scoring rules need game_parameters thresholds
    const bonusMoyenneEnabled = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) === 'true';
    const scoringRules = await dbAllAsync(
      "SELECT DISTINCT rule_type, value_1, value_2 FROM scoring_rules WHERE is_active = true AND field_1 IS NOT NULL AND ($1::int IS NULL OR organization_id = $1)",
      [orgId]
    );
    const rulesNeedThresholds = bonusMoyenneEnabled || scoringRules.some(r =>
      ['MOYENNE_MAXI', 'MOYENNE_MINI'].includes(r.value_1) || ['MOYENNE_MAXI', 'MOYENNE_MINI'].includes(r.value_2)
    );

    for (const cat of categories) {
      // Check if game_parameters are configured for this category
      if (rulesNeedThresholds) {
        const catRow = await dbGetAsync('SELECT display_name, game_type, level, organization_id FROM categories WHERE id = $1', [cat.category_id]);
        if (catRow) {
          const gp = await dbGetAsync(
            'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)',
            [catRow.game_type, catRow.level, catRow.organization_id || orgId]
          );
          if (!gp || gp.moyenne_mini == null || gp.moyenne_maxi == null) {
            warnings.push(`${catRow.display_name} : paramètres de jeu (moyenne min/max) non configurés — le bonus moyenne ne peut pas être calculé`);
          }
        }
      }

      await new Promise((resolve) => {
        recomputeAllBonuses(cat.category_id, cat.season, orgId, () => {
          recalculateRankings(cat.category_id, cat.season, (err) => {
            if (err) {
              errors.push({ categoryId: cat.category_id, error: err.message });
            } else {
              recomputed++;
            }
            resolve();
          });
        });
      });
    }

    // Include diagnostic info
    const diagSettings = {
      bonus_moyenne_enabled: await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled'),
      bonus_moyenne_type: await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type'),
      scoring_avg_tier_1: await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1'),
      scoring_avg_tier_2: await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2'),
      scoring_avg_tier_3: await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3'),
    };

    // Post-recompute verification: check if MOYENNE_BONUS was written to tournament_results
    const verification = [];
    for (const cat of categories) {
      const tournamentsForCat = await dbAllAsync(
        `SELECT t.id, t.tournament_number,
                COUNT(tr.id) as total_results,
                COUNT(CASE WHEN tr.bonus_detail LIKE '%MOYENNE_BONUS%' THEN 1 END) as with_bonus
         FROM tournaments t
         LEFT JOIN tournament_results tr ON tr.tournament_id = t.id
         WHERE t.category_id = $1 AND t.season = $2 AND ($3::int IS NULL OR t.organization_id = $3)
         GROUP BY t.id, t.tournament_number
         ORDER BY t.tournament_number`,
        [cat.category_id, cat.season, orgId]
      );
      for (const t of tournamentsForCat) {
        // Get a sample bonus_detail for debugging
        const sample = await dbGetAsync(
          'SELECT bonus_detail, points, reprises FROM tournament_results WHERE tournament_id = $1 AND bonus_detail IS NOT NULL LIMIT 1',
          [t.id]
        );
        verification.push({
          tournamentId: t.id,
          tournamentNumber: t.tournament_number,
          totalResults: t.total_results,
          withMoyenneBonus: t.with_bonus,
          sampleBonusDetail: sample?.bonus_detail || null,
          sampleMoyenne: sample && sample.reprises > 0 ? (sample.points / sample.reprises).toFixed(3) : null,
        });
      }
    }

    res.json({
      message: `Bonus recalculés pour ${recomputed} catégories`,
      recomputed,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      diagnostic: { orgId, season, settings: diagSettings, categoriesProcessed: categories.length },
      verification,
    });
  } catch (error) {
    console.error('[BONUS] Error in recompute-all-bonuses:', error);
    res.status(500).json({ error: error.message });
  }
});

// Diagnostic endpoint: check bonus moyenne prerequisites
router.get('/bonus-diagnostic', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const season = await appSettings.getCurrentSeason();

    // Check settings
    const bonusMoyenneEnabled = await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled');
    const bonusMoyenneType = await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type');
    const avgBonusTiers = await appSettings.getOrgSetting(orgId, 'average_bonus_tiers');
    const tier1 = await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1');
    const tier2 = await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2');
    const tier3 = await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3');

    // Check categories with tournaments
    const categories = await dbAllAsync(
      `SELECT DISTINCT c.id, c.game_type, c.level, c.display_name, c.organization_id
       FROM categories c
       JOIN tournaments t ON t.category_id = c.id
       WHERE t.season = $1 AND ($2::int IS NULL OR t.organization_id = $2)`,
      [season, orgId]
    );

    // Check game_parameters matching for each category
    const categoryDiag = [];
    for (const cat of categories) {
      const gpJoin = await dbGetAsync(
        `SELECT gp.id, gp.mode, gp.categorie, gp.organization_id, gp.moyenne_mini, gp.moyenne_maxi
         FROM categories c
         LEFT JOIN game_parameters gp ON UPPER(REPLACE(gp.mode, ' ', '')) = UPPER(REPLACE(c.game_type, ' ', '')) AND UPPER(gp.categorie) = UPPER(c.level) AND gp.organization_id = c.organization_id
         WHERE c.id = $1`,
        [cat.id]
      );
      const gpDirect = await dbGetAsync(
        `SELECT id, mode, categorie, organization_id, moyenne_mini, moyenne_maxi
         FROM game_parameters
         WHERE UPPER(REPLACE(mode, ' ', '')) = UPPER(REPLACE($1, ' ', '')) AND UPPER(categorie) = UPPER($2) AND organization_id = $3`,
        [cat.game_type, cat.level, cat.organization_id]
      );
      // Check for sample tournament results
      const sampleResults = await dbAllAsync(
        `SELECT tr.id, tr.licence, tr.points, tr.reprises, tr.bonus_detail, tr.bonus_points,
                CASE WHEN tr.reprises > 0 THEN ROUND(CAST(tr.points AS NUMERIC) / tr.reprises, 3) ELSE 0 END as computed_moyenne
         FROM tournament_results tr
         JOIN tournaments t ON tr.tournament_id = t.id
         WHERE t.category_id = $1 AND t.season = $2
         LIMIT 3`,
        [cat.id, season]
      );
      categoryDiag.push({
        category: { id: cat.id, game_type: cat.game_type, level: cat.level, display_name: cat.display_name, organization_id: cat.organization_id },
        gpJoinResult: gpJoin ? { moyenne_mini: gpJoin.moyenne_mini, moyenne_maxi: gpJoin.moyenne_maxi, gp_org_id: gpJoin.organization_id } : null,
        gpDirectQuery: gpDirect ? { id: gpDirect.id, mode: gpDirect.mode, categorie: gpDirect.categorie, org_id: gpDirect.organization_id, moyenne_mini: gpDirect.moyenne_mini, moyenne_maxi: gpDirect.moyenne_maxi } : null,
        joinMatches: !!(gpJoin && gpJoin.moyenne_mini != null),
        sampleResults: sampleResults.map(r => ({
          licence: r.licence, points: r.points, reprises: r.reprises, moyenne: r.computed_moyenne,
          bonus_detail: r.bonus_detail, bonus_points: r.bonus_points
        }))
      });
    }

    res.json({
      orgId,
      season,
      settings: {
        bonus_moyenne_enabled: bonusMoyenneEnabled,
        bonus_moyenne_type: bonusMoyenneType,
        average_bonus_tiers: avgBonusTiers,
        scoring_avg_tier_1: tier1,
        scoring_avg_tier_2: tier2,
        scoring_avg_tier_3: tier3,
        enabled_check: bonusMoyenneEnabled === 'true'
      },
      categories: categoryDiag
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update tournament (location, date, etc.)
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { location, location_2, tournament_date, results_email_sent } = req.body;

  // Build update query dynamically
  const updates = [];
  const params = [];

  if (location !== undefined) {
    updates.push('location = ?');
    params.push(location);
  }
  if (location_2 !== undefined) {
    updates.push('location_2 = ?');
    params.push(location_2);
  }
  if (tournament_date !== undefined) {
    updates.push('tournament_date = ?');
    params.push(tournament_date);
  }
  if (results_email_sent !== undefined) {
    updates.push('results_email_sent = ?');
    params.push(results_email_sent);
    if (results_email_sent) {
      updates.push('results_email_sent_at = CURRENT_TIMESTAMP');
    } else {
      updates.push('results_email_sent_at = NULL');
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const orgId = req.user.organizationId || null;
  params.push(id);
  if (orgId) {
    params.push(orgId);
  }

  db.run(
    `UPDATE tournaments SET ${updates.join(', ')} WHERE id = ?${orgId ? ' AND organization_id = ?' : ''}`,
    params,
    function(err) {
      if (err) {
        console.error('Error updating tournament:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      res.json({ success: true, message: 'Tournament updated successfully' });
    }
  );
});

// Get tournaments with unsent results (for dashboard reminder)
router.get('/unsent-results', authenticateToken, (req, res) => {
  // Get current season
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const season = currentMonth >= 8 ? `${currentYear}-${currentYear + 1}` : `${currentYear - 1}-${currentYear}`;
  const orgId = req.user.organizationId || null;

  db.all(`
    SELECT t.*, c.display_name, c.game_type, c.level,
           (SELECT COUNT(*) FROM tournament_results WHERE tournament_id = t.id) as participant_count
    FROM tournaments t
    JOIN categories c ON t.category_id = c.id
    WHERE t.season = $1
      AND (t.results_email_sent IS NULL OR NOT t.results_email_sent)
      AND (SELECT COUNT(*) FROM tournament_results WHERE tournament_id = t.id) > 0
      AND ($2::int IS NULL OR t.organization_id = $2)
    ORDER BY t.tournament_date DESC
  `, [season, orgId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Mark tournament results as sent (manual action from UI)
router.post('/:id/mark-results-sent', authenticateToken, (req, res) => {
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  db.run(
    `UPDATE tournaments SET results_email_sent = $1, results_email_sent_at = CURRENT_TIMESTAMP WHERE id = $2 AND ($3::int IS NULL OR organization_id = $3)`,
    [true, id, orgId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      res.json({ success: true, message: 'Tournament marked as results sent' });
    }
  );
});

// Mark tournament results as NOT sent (undo action)
router.post('/:id/mark-results-unsent', authenticateToken, (req, res) => {
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  db.run(
    `UPDATE tournaments SET results_email_sent = $1, results_email_sent_at = NULL WHERE id = $2 AND ($3::int IS NULL OR organization_id = $3)`,
    [false, id, orgId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      res.json({ success: true, message: 'Tournament marked as results not sent' });
    }
  );
});

// Recompute position_points + bonus + rankings for an existing tournament (admin only)
// Useful after configuration changes (e.g., position points table updated, bonus rules added)
router.post('/:id/recompute', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const tournamentId = req.params.id;
  const orgId = req.user.organizationId || null;

  try {
    const tournament = await dbGetAsync(
      'SELECT id, category_id, season FROM tournaments WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournamentId, orgId]
    );

    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    // Re-run position_points assignment (no-op for standard mode)
    await assignPositionPointsIfJournees(tournamentId, orgId);

    // Re-run bonus computation (barème rules)
    await new Promise((resolve, reject) => {
      computeBonusPoints(tournamentId, tournament.category_id, orgId, (err) => {
        if (err) reject(err); else resolve();
      });
    });

    // Safety net: explicitly apply bonus moyenne
    await new Promise((resolve) => {
      computeBonusMoyenne(tournamentId, tournament.category_id, orgId, resolve);
    });

    // Recalculate season rankings
    await new Promise((resolve, reject) => {
      recalculateRankings(tournament.category_id, tournament.season, (err) => {
        if (err) reject(err); else resolve();
      });
    });

    console.log(`[RECOMPUTE] Tournament ${tournamentId} recomputed successfully (cat=${tournament.category_id}, season=${tournament.season})`);
    res.json({ success: true, message: 'Recalcul terminé (points de position + bonus + classements)' });
  } catch (error) {
    console.error('[RECOMPUTE] Error:', error);
    res.status(500).json({ error: 'Erreur lors du recalcul: ' + error.message });
  }
});

// Recalculate moyenne for all tournament results (admin only)
// moyenne = points / reprises
router.post('/recalculate-moyennes', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get all results with points and reprises > 0
    const results = await new Promise((resolve, reject) => {
      db.all(`
        SELECT id, points, reprises, moyenne
        FROM tournament_results
        WHERE reprises > 0 AND points > 0
      `, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    let updated = 0;
    let errors = [];

    for (const result of results) {
      const calculatedMoyenne = parseFloat((result.points / result.reprises).toFixed(3));

      // Only update if different (with small tolerance for floating point)
      if (Math.abs(calculatedMoyenne - result.moyenne) > 0.001) {
        try {
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE tournament_results SET moyenne = $1 WHERE id = $2`,
              [calculatedMoyenne, result.id],
              function(err) {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          updated++;
        } catch (err) {
          errors.push({ id: result.id, error: err.message });
        }
      }
    }

    res.json({
      success: true,
      message: `Recalculated moyennes for tournament results`,
      total_checked: results.length,
      updated: updated,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error recalculating moyennes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recalculate moyenne for a specific tournament (admin only)
router.post('/:id/recalculate-moyennes', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { id } = req.params;

  try {
    // Get all results for this tournament with points and reprises > 0
    const results = await new Promise((resolve, reject) => {
      db.all(`
        SELECT id, points, reprises, moyenne, player_name
        FROM tournament_results
        WHERE tournament_id = $1 AND reprises > 0 AND points > 0
      `, [id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    let updated = 0;
    let details = [];

    for (const result of results) {
      const calculatedMoyenne = parseFloat((result.points / result.reprises).toFixed(3));
      const oldMoyenne = result.moyenne;

      // Only update if different (with small tolerance for floating point)
      if (Math.abs(calculatedMoyenne - oldMoyenne) > 0.001) {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE tournament_results SET moyenne = $1 WHERE id = $2`,
            [calculatedMoyenne, result.id],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        details.push({
          player: result.player_name,
          old: oldMoyenne,
          new: calculatedMoyenne
        });
        updated++;
      }
    }

    res.json({
      success: true,
      message: `Recalculated moyennes for tournament ${id}`,
      total_checked: results.length,
      updated: updated,
      details: details.length > 0 ? details : undefined
    });

  } catch (error) {
    console.error('Error recalculating moyennes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== Scoring Detail ====================

/**
 * GET /tournaments/:id/scoring-detail
 * Returns all data needed for the tournament scoring detail page:
 * tournament info, stage config, players with computed average bonus,
 * bracket matches, saved scores, game parameters, position points lookup.
 */
router.get('/:id/scoring-detail', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id);
    const orgId = req.user.organizationId || null;

    // 1. Tournament info
    const tournament = await dbGetAsync(
      `SELECT t.id, t.category_id, t.tournament_number, t.season, t.scoring_validated, t.scoring_validated_at,
              c.display_name as category_name, c.game_type, c.level
       FROM tournaments t
       JOIN categories c ON c.id = t.category_id
       WHERE t.id = $1 AND ($2::int IS NULL OR t.organization_id = $2)`,
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    // 2. Stage scoring config for this org
    const stageConfig = await dbAllAsync(
      `SELECT stage_code, match_points, average_bonus, level_bonus, participation_bonus, ranking_points
       FROM stage_scoring_config
       WHERE ($1::int IS NULL OR organization_id = $1)
       ORDER BY id ASC`,
      [orgId]
    );

    // Build display names for stages
    const stageDisplayNames = {
      'POULES': 'Poules',
      'SF': 'Demi-finales',
      'F': 'Finale',
      'PF': 'Petite Finale',
      'C_R1': 'Classement R1',
      'C_R2': 'Classement R2'
    };
    const stageConfigWithNames = stageConfig.map(sc => ({
      ...sc,
      displayName: stageDisplayNames[sc.stage_code] || sc.stage_code
    }));

    // 3. Game parameters (moyenne_mini, moyenne_maxi) for the category
    const gameParams = await dbGetAsync(
      `SELECT gp.moyenne_mini, gp.moyenne_maxi
       FROM game_parameters gp
       WHERE UPPER(REPLACE(gp.mode, ' ', '')) = UPPER(REPLACE($1, ' ', ''))  AND UPPER(gp.categorie) = UPPER($2)
         AND ($3::int IS NULL OR gp.organization_id = $3)`,
      [tournament.game_type, tournament.level, orgId]
    );
    const moyenneMini = gameParams ? parseFloat(gameParams.moyenne_mini) || 0 : 0;
    const moyenneMaxi = gameParams ? parseFloat(gameParams.moyenne_maxi) || 0 : 0;
    const moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;

    // 4. Players from tournament_results with computed average bonus
    const players = await dbAllAsync(
      `SELECT tr.licence, tr.player_name, tr.match_points, tr.moyenne, tr.position,
              tr.position_points, tr.points, tr.reprises, tr.serie,
              tr.bonus_points, tr.bonus_detail,
              pfc.moyenne_ffb
       FROM tournament_results tr
       LEFT JOIN player_ffb_classifications pfc
         ON pfc.licence = tr.licence
         AND pfc.game_mode_id = (SELECT id FROM game_modes WHERE UPPER(code) = UPPER($2) LIMIT 1)
         AND pfc.season = $3
       WHERE tr.tournament_id = $1
       ORDER BY tr.position ASC NULLS LAST, tr.match_points DESC`,
      [tournamentId, tournament.game_type, tournament.season]
    );

    // Load configurable tier values
    const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
    const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
    const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;

    // Read V/D/N from scoring_rules BASE_VDL (source of truth) with legacy fallback
    const vdlRules = await dbAllAsync(
      `SELECT condition_key, points FROM scoring_rules
       WHERE rule_type = 'BASE_VDL' AND ($1::int IS NULL OR organization_id = $1)
       ORDER BY display_order`,
      [orgId]
    );
    const vdlMap = {};
    for (const r of vdlRules) vdlMap[r.condition_key] = r.points;

    const matchPointsLoss = vdlMap['LOSS'] ?? (parseInt(await appSettings.getOrgSetting(orgId, 'scoring_match_points_loss')) || 0);
    const matchPointsDraw = vdlMap['DRAW'] ?? (parseInt(await appSettings.getOrgSetting(orgId, 'scoring_match_points_draw')) || 1);
    const matchPointsWinFromVDL = vdlMap['VICTORY'];

    // Compute average bonus per player
    const playersWithBonus = players.map(p => {
      let computedAverageBonus = 0;
      const avg = p.reprises > 0 ? p.points / p.reprises : 0;
      if (moyenneMaxi > 0) {
        if (avg >= moyenneMaxi) {
          computedAverageBonus = tier3;
        } else if (avg >= moyenneMiddle) {
          computedAverageBonus = tier2;
        } else if (avg >= moyenneMini) {
          computedAverageBonus = tier1;
        }
      }
      return {
        licence: p.licence,
        player_name: p.player_name,
        match_points: p.match_points || 0,
        moyenne: p.moyenne,
        position: p.position,
        position_points: p.position_points || 0,
        points: p.points || 0,
        reprises: p.reprises || 0,
        serie: p.serie || 0,
        moyenne_ffb: p.moyenne_ffb,
        computed_average_bonus: computedAverageBonus
      };
    });

    // 5. Bracket matches for this tournament
    const bracketMatches = await dbAllAsync(
      `SELECT phase, match_order, match_label, player1_licence, player1_name,
              player2_licence, player2_name, winner_licence, resulting_place
       FROM bracket_matches
       WHERE tournament_id = $1
       ORDER BY phase, match_order`,
      [tournamentId]
    );

    // 6. Saved stage_player_scores
    const savedScores = await dbAllAsync(
      `SELECT licence, stage_code, match_points, average_bonus, level_bonus, participation_bonus
       FROM stage_player_scores
       WHERE tournament_id = $1`,
      [tournamentId]
    );

    // 7. Position points lookup (pass player count for 2D lookup)
    const positionPointsLookup = await getPositionPointsLookup(orgId, playersWithBonus.length);

    res.json({
      tournament: {
        id: tournament.id,
        category_name: tournament.category_name,
        game_type: tournament.game_type,
        level: tournament.level,
        tournament_number: tournament.tournament_number,
        season: tournament.season,
        scoring_validated: tournament.scoring_validated || false,
        scoring_validated_at: tournament.scoring_validated_at
      },
      stageConfig: stageConfigWithNames,
      players: playersWithBonus,
      bracketMatches,
      savedScores,
      gameParameters: { moyenne_mini: moyenneMini, moyenne_maxi: moyenneMaxi, moyenne_middle: moyenneMiddle },
      scoringRules: {
        matchPointsWin: matchPointsWinFromVDL ?? (stageConfigWithNames.find(s => s.stage_code === 'POULES')?.match_points || 0),
        matchPointsDraw: matchPointsDraw,
        matchPointsLoss: matchPointsLoss,
        avgTier1: tier1,
        avgTier2: tier2,
        avgTier3: tier3
      },
      positionPointsLookup
    });

  } catch (error) {
    console.error('Error loading scoring detail:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /tournaments/:id/scoring-detail
 * Save (draft or validate) stage player scores.
 * Body: { scores: [{ licence, stage_code, match_points, average_bonus, level_bonus, participation_bonus }], validate: boolean }
 */
router.put('/:id/scoring-detail', authenticateToken, async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id);
    const orgId = req.user.organizationId || null;
    const { scores, validate } = req.body;

    // Verify tournament exists and belongs to org
    const tournament = await dbGetAsync(
      `SELECT t.id, t.category_id, t.season
       FROM tournaments t
       WHERE t.id = $1 AND ($2::int IS NULL OR t.organization_id = $2)`,
      [tournamentId, orgId]
    );
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }

    // UPSERT all scores
    for (const score of scores) {
      await dbRunAsync(
        `INSERT INTO stage_player_scores (tournament_id, licence, stage_code, match_points, average_bonus, level_bonus, participation_bonus)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tournament_id, licence, stage_code)
         DO UPDATE SET match_points = $4, average_bonus = $5, level_bonus = $6, participation_bonus = $7`,
        [tournamentId, score.licence, score.stage_code,
         parseInt(score.match_points) || 0,
         parseInt(score.average_bonus) || 0,
         parseInt(score.level_bonus) || 0,
         parseInt(score.participation_bonus) || 0]
      );
    }

    if (validate) {
      // Aggregate bonuses per player across all stages
      const aggregated = await dbAllAsync(
        `SELECT licence,
                SUM(average_bonus) as total_average_bonus,
                SUM(level_bonus) as total_level_bonus,
                SUM(participation_bonus) as total_participation_bonus
         FROM stage_player_scores
         WHERE tournament_id = $1
         GROUP BY licence`,
        [tournamentId]
      );

      // Update tournament_results with aggregated bonus data
      for (const agg of aggregated) {
        const totalBonus = (agg.total_average_bonus || 0) + (agg.total_level_bonus || 0) + (agg.total_participation_bonus || 0);
        const bonusDetail = {};
        if (agg.total_average_bonus > 0) bonusDetail['AVERAGE_BONUS'] = agg.total_average_bonus;
        if (agg.total_level_bonus > 0) bonusDetail['LEVEL_BONUS'] = agg.total_level_bonus;
        if (agg.total_participation_bonus > 0) bonusDetail['PARTICIPATION_BONUS'] = agg.total_participation_bonus;

        await dbRunAsync(
          `UPDATE tournament_results
           SET bonus_points = $1, bonus_detail = $2
           WHERE tournament_id = $3 AND licence = $4`,
          [totalBonus, JSON.stringify(bonusDetail), tournamentId, agg.licence]
        );
      }

      // Mark tournament as scoring validated
      await dbRunAsync(
        `UPDATE tournaments SET scoring_validated = TRUE, scoring_validated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [tournamentId]
      );

      // Recalculate rankings
      await new Promise((resolve, reject) => {
        recalculateRankings(tournament.category_id, tournament.season, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logAdminAction({
        req,
        action: ACTION_TYPES.IMPORT_TOURNAMENT,
        details: `Scoring détaillé validé pour tournoi #${tournamentId}`,
        targetType: 'tournament',
        targetId: tournamentId,
        targetName: `TQ${tournament.tournament_number || ''}`
      });

      res.json({ success: true, message: 'Scoring validé et classements recalculés', validated: true });
    } else {
      res.json({ success: true, message: 'Brouillon enregistré', validated: false });
    }

  } catch (error) {
    console.error('Error saving scoring detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CSV Matchs E2i Import ====================

/**
 * Default column mapping for E2i match CSV format (semicolon, 20 columns):
 * No Phase;Date match;Billard;Poule;Licence J1;Joueur 1;Pts J1;Rep J1;Ser J1;Pts Match J1;Moy J1;Licence J2;Joueur 2;Pts J2;Rep J2;Ser J2;Pts Match J2;Moy J2;NOMBD;Mode de jeu
 */
/**
 * Repair Excel-mangled poule names: "05-Jun" → "05-06", "07-Aug" → "07-08", etc.
 * Excel auto-converts "05-06" to a date (May-June). This reverses that corruption.
 */
const MONTH_TO_NUM = {
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
  'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
  'janv': '01', 'févr': '02', 'mars': '03', 'avr': '04', 'mai': '05', 'juin': '06',
  'juil': '07', 'août': '08', 'sept': '09', 'juil.': '07', 'août.': '08'
};

function repairExcelPouleName(name) {
  if (!name) return name;
  // Match patterns like "05-Jun", "07-Aug", "09-Oct" (Excel date mangling)
  const match = name.match(/^(\d{1,2})-([A-Za-zéû.]+)$/);
  if (match) {
    const num = MONTH_TO_NUM[match[2].toLowerCase()];
    if (num) return `${match[1].padStart(2, '0')}-${num}`;
  }
  return name;
}

const DEFAULT_MATCH_MAPPING = {
  phase_number: { column: 0, type: 'number' },
  match_date: { column: 1, type: 'string' },
  table_name: { column: 2, type: 'string' },
  poule_name: { column: 3, type: 'string' },
  player1_licence: { column: 4, type: 'string' },
  player1_name: { column: 5, type: 'string' },
  player1_points: { column: 6, type: 'number' },
  player1_reprises: { column: 7, type: 'number' },
  player1_serie: { column: 8, type: 'number' },
  player1_match_points: { column: 9, type: 'number' },
  player1_moyenne: { column: 10, type: 'decimal' },
  player2_licence: { column: 11, type: 'string' },
  player2_name: { column: 12, type: 'string' },
  player2_points: { column: 13, type: 'number' },
  player2_reprises: { column: 14, type: 'number' },
  player2_serie: { column: 15, type: 'number' },
  player2_match_points: { column: 16, type: 'number' },
  player2_moyenne: { column: 17, type: 'decimal' },
  nombd: { column: 18, type: 'string' },
  game_mode: { column: 19, type: 'string' }
};

/**
 * Parse a single E2i match CSV file into match objects.
 * @param {string} filePath - Path to the CSV file
 * @returns {Array} Array of parsed match objects
 */
async function parseMatchCSV(filePath) {
  const records = await readCSVRecords(filePath);
  const matches = [];

  for (const record of records) {
    // Skip header rows
    const first = (record[0] || '').trim();
    if (first.includes('No Phase') || first.includes('Phase') && (record[3] || '').includes('Poule')) continue;
    if (!record[4] && !record[11]) continue; // No licences = skip

    const p1Licence = getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_licence', '')?.replace(/ /g, '');
    const p2Licence = getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_licence', '')?.replace(/ /g, '');
    if (!p1Licence || !p2Licence) continue;

    // Parse date (format: DD/MM/YYYY or YYYY-MM-DD)
    let matchDate = null;
    const dateStr = getMappedValue(record, DEFAULT_MATCH_MAPPING, 'match_date', '');
    if (dateStr) {
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          matchDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      } else {
        matchDate = dateStr; // Already ISO format
      }
    }

    matches.push({
      phase_number: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'phase_number', 1),
      match_date: matchDate,
      table_name: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'table_name', ''),
      poule_name: repairExcelPouleName(getMappedValue(record, DEFAULT_MATCH_MAPPING, 'poule_name', '')),
      player1_licence: p1Licence,
      player1_name: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_name', ''),
      player1_points: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_points', 0),
      player1_reprises: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_reprises', 0),
      player1_serie: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_serie', 0),
      player1_match_points: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_match_points', 0),
      player1_moyenne: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player1_moyenne', 0),
      player2_licence: p2Licence,
      player2_name: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_name', ''),
      player2_points: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_points', 0),
      player2_reprises: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_reprises', 0),
      player2_serie: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_serie', 0),
      player2_match_points: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_match_points', 0),
      player2_moyenne: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'player2_moyenne', 0),
      game_mode: getMappedValue(record, DEFAULT_MATCH_MAPPING, 'game_mode', '')
    });
  }

  return matches;
}

/**
 * Aggregate individual matches into per-player tournament results.
 * Returns an array of player stats objects.
 */
function aggregateMatchResults(matches) {
  const playerMap = {};

  for (const match of matches) {
    // Process both players in each match
    for (const side of ['player1', 'player2']) {
      const licence = match[`${side}_licence`];
      const name = match[`${side}_name`];
      const points = match[`${side}_points`] || 0;
      const reprises = match[`${side}_reprises`] || 0;
      const serie = match[`${side}_serie`] || 0;
      const matchPts = match[`${side}_match_points`] || 0;
      const moyenne = reprises > 0 ? points / reprises : 0;

      if (!playerMap[licence]) {
        playerMap[licence] = {
          licence,
          name,
          poule_name: match.poule_name,
          parties_menees: 0,
          total_points: 0,
          total_reprises: 0,
          max_serie: 0,
          total_match_points: 0,
          best_single_moyenne: 0,   // MPART
          match_moyennes: []         // For computing MPART
        };
      }

      const player = playerMap[licence];
      player.parties_menees++;
      player.total_points += points;
      player.total_reprises += reprises;
      player.max_serie = Math.max(player.max_serie, serie);
      player.total_match_points += matchPts;

      // Track best single-match moyenne (MPART) — only from WON matches (match_points > 0)
      if (matchPts > 0 && moyenne > player.best_single_moyenne) {
        player.best_single_moyenne = moyenne;
      }
    }
  }

  return Object.values(playerMap);
}

/**
 * Helper: detect if a poule name represents a classification/bracket phase.
 */
function isClassificationPoule(pouleName) {
  const upper = pouleName.toUpperCase();
  return upper.includes('CLASSEMENT') || upper.includes('DEMI-FINALE') || upper.includes('DEMI FINALE') ||
      upper.includes('FINALE') || upper.includes('PETITE FINALE') ||
      upper.includes('SEMI-FINAL') || upper.includes('BARRAGE') ||
      upper.includes('PLACE ') ||
      /^G\s*\d+-\d+/.test(pouleName) || /^\d{2}-\d{2}$/.test(pouleName);
}

/**
 * Helper: sort players by match_points DESC then moyenne DESC then best serie DESC.
 * Supports custom key names for sorting by global vs local stats.
 */
function sortByPerformance(players, mpKey = 'total_match_points', ptsKey = 'total_points', repKey = 'total_reprises') {
  // Derive serie key from MP key prefix (e.g., '_globalMatchPoints' → '_globalSerie', or default 'max_serie')
  const serieKey = mpKey.startsWith('_global') ? '_globalSerie' : 'max_serie';
  players.sort((a, b) => {
    if ((b[mpKey] || 0) !== (a[mpKey] || 0)) return (b[mpKey] || 0) - (a[mpKey] || 0);
    const avgA = (a[repKey] || 0) > 0 ? (a[ptsKey] || 0) / a[repKey] : 0;
    const avgB = (b[repKey] || 0) > 0 ? (b[ptsKey] || 0) / b[repKey] : 0;
    if (avgB !== avgA) return avgB - avgA;
    // Tiebreaker: best serie
    if ((b[serieKey] || b.max_serie || 0) !== (a[serieKey] || a.max_serie || 0)) {
      return (b[serieKey] || b.max_serie || 0) - (a[serieKey] || a.max_serie || 0);
    }
    return 0;
  });
}

/**
 * Compute poule rankings and overall tournament ranking from aggregated player stats.
 * Uses raw matches to properly separate regular poules from classification/bracket phases.
 * @param {Array} playerStats - Aggregated per-player stats from aggregateMatchResults()
 * @param {Array} allMatches - Raw parsed match objects (optional, for proper poule detection)
 * @returns {Array} playerStats with poule_rank and final_position added
 */
function computeMatchRankings(playerStats, allMatches) {
  // ── If no raw matches available, fall back to legacy grouping ──
  if (!allMatches || allMatches.length === 0) {
    // Legacy: group by playerStats.poule_name (old behavior for backward compat)
    const poules = {};
    for (const p of playerStats) {
      const poule = p.poule_name || 'POULE A';
      if (!poules[poule]) poules[poule] = [];
      poules[poule].push(p);
    }
    for (const players of Object.values(poules)) {
      sortByPerformance(players);
      players.forEach((p, i) => { p.poule_rank = i + 1; });
    }
    const maxRank = Math.max(0, ...playerStats.map(p => p.poule_rank || 0));
    let position = 1;
    for (let rank = 1; rank <= maxRank; rank++) {
      const atThisRank = playerStats.filter(p => p.poule_rank === rank);
      sortByPerformance(atThisRank);
      for (const p of atThisRank) { p.final_position = position++; }
    }
    return playerStats;
  }

  // ── Step 1: Group RAW MATCHES by poule name ──
  const matchesByPoule = {};
  for (const match of allMatches) {
    const poule = match.poule_name || 'POULE A';
    if (!matchesByPoule[poule]) matchesByPoule[poule] = [];
    matchesByPoule[poule].push(match);
  }

  // ── Step 2: Classify each poule as regular or classification ──
  const regularPouleNames = [];
  const classificationPouleNames = [];
  for (const pouleName of Object.keys(matchesByPoule)) {
    if (isClassificationPoule(pouleName)) {
      classificationPouleNames.push(pouleName);
    } else {
      regularPouleNames.push(pouleName);
    }
  }

  // ── Step 3: Compute per-player stats WITHIN each regular poule only ──
  // This ensures poule ranking uses only poule-phase match points (not bracket/classification)
  const regularPouleStats = {}; // { pouleName: [{ licence, match_points, total_points, total_reprises, max_serie }] }
  for (const pouleName of regularPouleNames) {
    const matches = matchesByPoule[pouleName];
    const playerMap = {};
    for (const match of matches) {
      for (const side of ['player1', 'player2']) {
        const licence = match[`${side}_licence`];
        if (!licence) continue;
        const points = parseFloat(match[`${side}_points`]) || 0;
        const reprises = parseFloat(match[`${side}_reprises`]) || 0;
        const serie = parseFloat(match[`${side}_serie`]) || 0;
        const matchPts = parseFloat(match[`${side}_match_points`]) || 0;
        if (!playerMap[licence]) {
          playerMap[licence] = { licence, total_match_points: 0, total_points: 0, total_reprises: 0, max_serie: 0 };
        }
        playerMap[licence].total_match_points += matchPts;
        playerMap[licence].total_points += points;
        playerMap[licence].total_reprises += reprises;
        playerMap[licence].max_serie = Math.max(playerMap[licence].max_serie, serie);
      }
    }
    regularPouleStats[pouleName] = Object.values(playerMap);
  }

  // ── Step 4: Rank within each regular poule ──
  for (const players of Object.values(regularPouleStats)) {
    sortByPerformance(players);
    players.forEach((p, i) => { p.poule_rank = i + 1; });
  }

  // ── Step 5: Set poule_rank on playerStats from regular poule ranking ──
  for (const [pouleName, players] of Object.entries(regularPouleStats)) {
    for (const rp of players) {
      const ps = playerStats.find(p => p.licence === rp.licence);
      if (ps) {
        ps.poule_rank = rp.poule_rank;
        ps.poule_name = pouleName; // Ensure player is associated with their regular poule
      }
    }
  }

  // ── Step 6: Build classification poule player data from raw classification matches ──
  if (classificationPouleNames.length > 0) {
    const classificationPoules = {};
    for (const pouleName of classificationPouleNames) {
      const matches = matchesByPoule[pouleName];
      const playerMap = {};
      for (const match of matches) {
        for (const side of ['player1', 'player2']) {
          const licence = match[`${side}_licence`];
          if (!licence) continue;
          const points = parseFloat(match[`${side}_points`]) || 0;
          const reprises = parseFloat(match[`${side}_reprises`]) || 0;
          const serie = parseFloat(match[`${side}_serie`]) || 0;
          const matchPts = parseFloat(match[`${side}_match_points`]) || 0;
          if (!playerMap[licence]) {
            playerMap[licence] = { licence, total_match_points: 0, total_points: 0, total_reprises: 0, max_serie: 0 };
          }
          playerMap[licence].total_match_points += matchPts;
          playerMap[licence].total_points += points;
          playerMap[licence].total_reprises += reprises;
          playerMap[licence].max_serie = Math.max(playerMap[licence].max_serie, serie);
        }
      }
      classificationPoules[pouleName] = Object.values(playerMap);
    }

    // Extract final positions using phase-aware algorithm
    // Pass playerStats so classification can sort by total tournament match_points (not just classification-phase MP)
    const classificationPositions = extractClassificationPositions(classificationPoules, regularPouleStats, matchesByPoule, playerStats);

    // Assign positions from classification results
    for (const cp of classificationPositions) {
      const player = playerStats.find(p => p.licence === cp.licence);
      if (player) {
        player.final_position = cp.position;
      }
    }

    // Players NOT in any classification match get remaining positions
    const assignedPositions = new Set(classificationPositions.map(cp => cp.position));
    const unranked = playerStats.filter(p => !p.final_position);
    sortByPerformance(unranked);
    // Find next available position
    let nextPos = 1;
    for (const p of unranked) {
      while (assignedPositions.has(nextPos)) nextPos++;
      p.final_position = nextPos;
      assignedPositions.add(nextPos);
      nextPos++;
    }
  } else {
    // No classification poules — rank by interleaving poule positions
    // 1st of each poule, then 2nds, then 3rds...
    // Within same poule rank: sort by MGP DESC
    const maxRank = Math.max(0, ...playerStats.map(p => p.poule_rank || 0));
    let position = 1;
    for (let rank = 1; rank <= maxRank; rank++) {
      const atThisRank = playerStats.filter(p => p.poule_rank === rank);
      sortByPerformance(atThisRank);
      for (const p of atThisRank) {
        p.final_position = position++;
      }
    }
  }

  return playerStats;
}

/**
 * Extract final classification from bracket/classification poules.
 * Uses phase numbers from raw matches to resolve conflicts when multiple rounds
 * cover the same position range (later phases override earlier ones).
 * Within each position pair, sorts by TOTAL tournament match points (not just
 * the classification-phase match points), matching CDB 93-94 behavior.
 *
 * @param {Object} classificationPoules - { pouleName: [{ licence, total_match_points, ... }] }
 * @param {Object} regularPoules - { pouleName: [{ licence, ... }] } (unused but kept for signature compat)
 * @param {Object} matchesByPoule - { pouleName: [rawMatch, ...] } for phase number extraction
 * @param {Array} playerStats - Global per-player aggregated stats (for total tournament match_points)
 * @returns {Array} Sorted array of { licence, position }
 */
function extractClassificationPositions(classificationPoules, regularPoules, matchesByPoule, playerStats) {
  // Collect all position assignments with their phase number for priority resolution
  const allAssignments = []; // { licence, position, phase }

  for (const [pouleName, players] of Object.entries(classificationPoules)) {
    const upper = pouleName.toUpperCase();

    // Determine phase number for this poule (max phase from its matches)
    const pouleMatches = (matchesByPoule && matchesByPoule[pouleName]) || [];
    const phaseNum = pouleMatches.length > 0
      ? Math.max(...pouleMatches.map(m => m.phase_number || 0))
      : 0;

    // Skip DEMI-FINALE / DEMI FINALES — positions determined by FINALE and PETITE FINALE
    if (upper.includes('DEMI-FINALE') || upper.includes('DEMI FINALE') || upper.includes('SEMI-FINAL')) {
      continue;
    }

    let posStart = null;

    // "PETITE FINALE" = positions 3-4 (check BEFORE finale to avoid false match)
    if (upper.includes('PETITE FINALE')) {
      posStart = 3;
    }
    // "FINALE" (exact or with suffix like "(2)") = positions 1-2
    // Must NOT match "PETITE FINALE" (already handled above) or "DEMI-FINALE" (skipped above)
    else if (upper === 'FINALE' || /^FINALE\b/.test(upper)) {
      posStart = 1;
    }
    // E2i format: "G7-8 - P5-6" → positions from P part
    else if (/G\s*\d+-\d+\s*-\s*P\s*(\d+)-(\d+)/i.test(pouleName)) {
      const match = pouleName.match(/G\s*\d+-\d+\s*-\s*P\s*(\d+)-(\d+)/i);
      posStart = parseInt(match[1]);
    }
    // "Classement XX-YY" or "Classement 09-10"
    else if (/[Cc]lassement\s+(\d+)\s*-\s*(\d+)/.test(pouleName)) {
      const match = pouleName.match(/[Cc]lassement\s+(\d+)\s*-\s*(\d+)/);
      posStart = parseInt(match[1]);
    }
    // "PLACE NN-NN" (e.g., "PLACE 05-06", "PLACE 07-08")
    else if (/PLACE\s+(\d+)\s*-\s*(\d+)/i.test(pouleName)) {
      const match = pouleName.match(/PLACE\s+(\d+)\s*-\s*(\d+)/i);
      posStart = parseInt(match[1]);
    }
    // "CLASSEMENT (J05-J06) - Place 05" or "CLASSEMENT (Places 06-07)" — extract Place/Places NN(-NN)
    else if (/Places?\s+(\d+)\s*-\s*(\d+)/i.test(pouleName)) {
      const match = pouleName.match(/Places?\s+(\d+)\s*-\s*(\d+)/i);
      posStart = parseInt(match[1]);
    }
    else if (/Place\s+(\d+)/i.test(pouleName)) {
      // Single position: "CLASSEMENT (J07-J08) - Place 08" → position 8
      // In this case, the winner gets posStart-1 and loser gets posStart (or just loser gets posStart)
      // Actually for a 2-player match, winner = posStart - 1, loser = posStart? No...
      // "Place 08" means determining who gets place 8 → loser = 8, winner goes to next round
      // But we can't know without more context. Treat as single position for loser, skip winner.
      // Actually let's treat it as posStart-1 and posStart range
      const match = pouleName.match(/Place\s+(\d+)/i);
      const pos = parseInt(match[1]);
      // For single-position classification: winner gets pos-1, loser gets pos
      posStart = pos - 1;
    }
    // Numeric "NN-NN" pattern (e.g., "05-06", "07-08") — intermediate round positions
    else if (/^(\d{2})-(\d{2})$/.test(pouleName)) {
      const match = pouleName.match(/^(\d{2})-(\d{2})$/);
      posStart = parseInt(match[1]);
    }

    if (posStart === null) continue;

    // Sort players within this classification poule by TOTAL tournament match points
    // (not just this classification match's MP). The classification match determines
    // which position pair you compete for; total tournament PM determines exact order.
    if (playerStats && playerStats.length > 0) {
      // Enrich each player with their global tournament stats for sorting
      for (const p of players) {
        const global = playerStats.find(ps => ps.licence === p.licence);
        if (global) {
          p._globalMatchPoints = global.total_match_points || 0;
          p._globalPoints = global.total_points || 0;
          p._globalReprises = global.total_reprises || 0;
          p._globalSerie = global.max_serie || 0;
        }
      }
      sortByPerformance(players, '_globalMatchPoints', '_globalPoints', '_globalReprises');
    } else {
      sortByPerformance(players);
    }

    players.forEach((p, i) => {
      allAssignments.push({ licence: p.licence, position: posStart + i, phase: phaseNum });
    });
  }

  // ── Resolve conflicts: process from HIGHEST phase to LOWEST ──
  // For each player, keep only the assignment from the highest (latest) phase.
  // For each position, keep only the assignment from the highest phase.

  // Sort by phase DESC so we process latest phases first
  allAssignments.sort((a, b) => b.phase - a.phase);

  const assignedPlayers = new Set();    // licences already assigned
  const assignedPositions = new Map();  // position → { licence, phase }
  const finalAssignments = [];

  for (const a of allAssignments) {
    // Skip if this player already has a position from a later phase
    if (assignedPlayers.has(a.licence)) continue;
    // Skip if this position already taken by a player from a later phase
    if (assignedPositions.has(a.position)) continue;

    finalAssignments.push({ licence: a.licence, position: a.position });
    assignedPlayers.add(a.licence);
    assignedPositions.set(a.position, a);
  }

  // Sort by position
  finalAssignments.sort((a, b) => a.position - b.position);
  return finalAssignments;
}

/**
 * POST /import-matches
 * Import multiple E2i match CSV files for a tournament.
 * Parses matches, aggregates per-player stats, computes rankings,
 * stores in tournament_matches + tournament_results, then chains bonus/ranking pipeline.
 */
router.post('/import-matches', authenticateToken, upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'Aucun fichier CSV uploadé' });
  }

  const { categoryId, tournamentNumber, season, tournamentDate } = req.body;
  if (!categoryId || !tournamentNumber || !season) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Catégorie, numéro de tournoi et saison requis' });
  }

  const orgId = req.user.organizationId || null;

  try {
    // 1. Parse all CSV files into matches
    let allMatches = [];
    const fileInfo = [];
    for (const file of files) {
      const matches = await parseMatchCSV(file.path);
      const poules = [...new Set(matches.map(m => m.poule_name))];
      fileInfo.push({ filename: file.originalname, matchCount: matches.length, poules });
      allMatches = allMatches.concat(matches);
    }

    if (allMatches.length === 0) {
      cleanupFiles(files);
      return res.status(400).json({ error: 'Aucun match trouvé dans les fichiers CSV' });
    }

    console.log(`[IMPORT-MATCHES] Parsed ${allMatches.length} matches from ${files.length} files for category ${categoryId}, T${tournamentNumber}, season ${season}`);

    // 2. Create or get tournament
    const upsertResult = await dbRunAsync(
      `INSERT INTO tournaments (category_id, tournament_number, season, tournament_date, organization_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(category_id, tournament_number, season) DO UPDATE SET
         tournament_date = $4,
         import_date = CURRENT_TIMESTAMP
       RETURNING id`,
      [categoryId, tournamentNumber, season, tournamentDate || null, orgId]
    );

    let tournamentId;
    if (upsertResult && upsertResult.lastID) {
      tournamentId = upsertResult.lastID;
    }
    // Fallback: query for the tournament
    if (!tournamentId) {
      const row = await dbGetAsync(
        'SELECT id FROM tournaments WHERE category_id = $1 AND tournament_number = $2 AND season = $3',
        [categoryId, tournamentNumber, season]
      );
      tournamentId = row ? row.id : null;
    }

    if (!tournamentId) {
      cleanupFiles(files);
      return res.status(500).json({ error: 'Impossible de créer/trouver le tournoi' });
    }

    // 3. Delete existing matches and results for this tournament
    await dbRunAsync('DELETE FROM tournament_matches WHERE tournament_id = $1', [tournamentId]);
    await dbRunAsync('DELETE FROM tournament_results WHERE tournament_id = $1', [tournamentId]);

    // 4. Ensure all players exist
    const allLicences = new Set();
    for (const match of allMatches) {
      allLicences.add(match.player1_licence);
      allLicences.add(match.player2_licence);
    }

    for (const match of allMatches) {
      for (const side of ['player1', 'player2']) {
        const licence = match[`${side}_licence`];
        const fullName = match[`${side}_name`] || '';
        const nameParts = fullName.split(' ');
        const lastName = nameParts[0] || '';
        const firstName = nameParts.slice(1).join(' ') || '';

        await dbRunAsync(
          `INSERT INTO players (licence, first_name, last_name, club, is_active, organization_id)
           VALUES ($1, $2, $3, 'Club inconnu', 1, $4)
           ON CONFLICT (licence) DO NOTHING`,
          [licence, firstName, lastName, orgId]
        );
      }
    }

    // 5. Insert all matches into tournament_matches
    for (const match of allMatches) {
      await dbRunAsync(
        `INSERT INTO tournament_matches (
          tournament_id, phase_number, match_date, table_name, poule_name,
          player1_licence, player1_name, player1_points, player1_reprises, player1_serie, player1_match_points, player1_moyenne,
          player2_licence, player2_name, player2_points, player2_reprises, player2_serie, player2_match_points, player2_moyenne,
          game_mode, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          tournamentId, match.phase_number, match.match_date, match.table_name, match.poule_name,
          match.player1_licence, match.player1_name, match.player1_points, match.player1_reprises, match.player1_serie, match.player1_match_points, match.player1_moyenne,
          match.player2_licence, match.player2_name, match.player2_points, match.player2_reprises, match.player2_serie, match.player2_match_points, match.player2_moyenne,
          match.game_mode, orgId
        ]
      );
    }

    // 6. Aggregate matches into per-player stats
    const playerStats = aggregateMatchResults(allMatches);
    const rankedStats = computeMatchRankings(playerStats, allMatches);

    // 7. Insert tournament_results
    for (const player of rankedStats) {
      const mgp = player.total_reprises > 0 ? player.total_points / player.total_reprises : 0;
      await dbRunAsync(
        `INSERT INTO tournament_results (
          tournament_id, licence, player_name, position, match_points, moyenne,
          serie, points, reprises, meilleure_partie, poule_rank, parties_menees
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tournamentId,
          player.licence,
          player.name,
          player.final_position || 0,
          player.total_match_points,
          parseFloat(mgp.toFixed(4)),
          player.max_serie,
          player.total_points,
          player.total_reprises,
          parseFloat(player.best_single_moyenne.toFixed(4)),
          player.poule_rank || 0,
          player.parties_menees
        ]
      );
    }

    console.log(`[IMPORT-MATCHES] Inserted ${rankedStats.length} player results for tournament ${tournamentId}`);

    // 8. Chain: position points → bonuses → rankings
    await new Promise((resolve) => {
      recomputeAllBonuses(categoryId, season, orgId, async () => {
        recalculateRankings(categoryId, season, () => {
          resolve();
        });
      });
    });

    // Cleanup uploaded files
    cleanupFiles(files);

    // Log action
    logAdminAction({
      req,
      action: ACTION_TYPES.IMPORT_TOURNAMENT,
      details: `Import CSV matchs E2i: T${tournamentNumber}, saison ${season}, ${allMatches.length} matchs, ${rankedStats.length} joueurs`,
      targetType: 'tournament',
      targetId: tournamentId,
      targetName: `T${tournamentNumber} - ${season}`
    });

    // Check bonus configuration
    let hasBonuses = false;
    try {
      const bonusMoyenne = orgId ? (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) : '';
      if (bonusMoyenne === 'true') {
        hasBonuses = true;
      } else {
        const activeRules = await dbAllAsync(
          "SELECT 1 FROM scoring_rules WHERE is_active = true AND field_1 IS NOT NULL AND rule_type != 'MOYENNE_BONUS' AND points > 0 AND ($1::int IS NULL OR organization_id = $1) LIMIT 1",
          [orgId]
        );
        hasBonuses = activeRules && activeRules.length > 0;
      }
    } catch (e) {
      console.error('[IMPORT-MATCHES] Error checking bonus settings:', e);
    }

    res.json({
      message: 'Import des matchs réussi',
      tournamentId,
      imported: rankedStats.length,
      matchCount: allMatches.length,
      fileInfo,
      hasBonuses,
      poules: [...new Set(allMatches.map(m => m.poule_name))]
    });

  } catch (error) {
    console.error('[IMPORT-MATCHES] Error:', error);
    cleanupFiles(files);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /import-matches/preview
 * Preview the results of importing E2i match CSV files (without persisting).
 */
router.post('/import-matches/preview', authenticateToken, upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'Aucun fichier CSV uploadé' });
  }

  try {
    let allMatches = [];
    const fileInfo = [];
    for (const file of files) {
      const matches = await parseMatchCSV(file.path);
      const poules = [...new Set(matches.map(m => m.poule_name))];
      fileInfo.push({ filename: file.originalname, matchCount: matches.length, poules });
      allMatches = allMatches.concat(matches);
    }

    cleanupFiles(files);

    if (allMatches.length === 0) {
      return res.status(400).json({ error: 'Aucun match trouvé dans les fichiers CSV' });
    }

    // Aggregate and rank
    const playerStats = aggregateMatchResults(allMatches);
    const rankedStats = computeMatchRankings(playerStats, allMatches);

    // Enrich with player info from DB (club, first_name, last_name)
    const orgId = req.user.organizationId || null;
    for (const player of rankedStats) {
      const dbPlayer = await dbGetAsync(
        'SELECT first_name, last_name, club FROM players WHERE REPLACE(licence, \' \', \'\') = $1 AND ($2::int IS NULL OR organization_id = $2)',
        [player.licence, orgId]
      );
      if (dbPlayer) {
        player.first_name = dbPlayer.first_name;
        player.last_name = dbPlayer.last_name;
        player.club = dbPlayer.club;
      } else {
        // Parse name from CSV
        const nameParts = (player.name || '').split(' ');
        player.last_name = nameParts[0] || '';
        player.first_name = nameParts.slice(1).join(' ') || '';
        player.club = '';
        player.unknown = true;
      }
    }

    // Compute position points (preview only — not persisted)
    const { categoryId } = req.body;
    let positionPointsLookup = {};
    if (orgId && categoryId) {
      const qualMode = await appSettings.getOrgSetting(orgId, 'qualification_mode');
      if (qualMode === 'journees') {
        const nbPlayers = rankedStats.length;
        positionPointsLookup = await getPositionPointsLookup(orgId, nbPlayers);

        // Apply degradation if configured
        const degradation = await appSettings.getOrgSetting(orgId, 'position_points_degradation');

        for (const player of rankedStats) {
          const pos = player.final_position;
          if (degradation === 'last_player' && pos === nbPlayers && nbPlayers > 0) {
            // Last player gets points of position N+1
            player.position_points = positionPointsLookup[pos + 1] || 0;
          } else {
            player.position_points = positionPointsLookup[pos] || 0;
          }
        }
      }
    }

    // Compute bonus preview (same as on-the-fly in results)
    let bonusMoyenneInfo = null;
    if (orgId && categoryId) {
      const rawSetting = await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled');
      if (rawSetting === 'true') {
        const bonusType = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type')) || 'normal';
        const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
        const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
        const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;

        const cat = await dbGetAsync('SELECT game_type, level, organization_id FROM categories WHERE id = $1', [categoryId]);
        if (cat) {
          const gp = await dbGetAsync(
            'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)',
            [cat.game_type, cat.level, cat.organization_id || orgId]
          );
          const moyenneMini = (gp && gp.moyenne_mini != null) ? parseFloat(gp.moyenne_mini) : 0;
          const moyenneMaxi = (gp && gp.moyenne_maxi != null) ? parseFloat(gp.moyenne_maxi) : 999;
          const moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;

          bonusMoyenneInfo = { type: bonusType, mini: moyenneMini, middle: moyenneMiddle, maxi: moyenneMaxi, tiers: [tier1, tier2, tier3] };

          for (const player of rankedStats) {
            const mgp = player.total_reprises > 0 ? player.total_points / player.total_reprises : 0;
            let bonus = 0;
            if (bonusType === 'tiered') {
              if (mgp >= moyenneMaxi) bonus = tier3;
              else if (mgp >= moyenneMiddle) bonus = tier2;
              else if (mgp >= moyenneMini) bonus = tier1;
            } else {
              if (mgp > moyenneMaxi) bonus = tier2;
              else if (mgp >= moyenneMini) bonus = tier1;
            }
            player.bonus_moyenne = bonus;
          }
        }
      }
    }

    // Sort by final_position for display
    rankedStats.sort((a, b) => (a.final_position || 999) - (b.final_position || 999));

    // Build preview table data
    const preview = rankedStats.map(p => {
      const mgp = p.total_reprises > 0 ? p.total_points / p.total_reprises : 0;
      const posPoints = p.position_points || 0;
      const bonus = p.bonus_moyenne || 0;
      return {
        final_position: p.final_position,
        licence: p.licence,
        last_name: p.last_name || '',
        first_name: p.first_name || '',
        club: p.club || '',
        poule_name: p.poule_name,
        poule_rank: p.poule_rank,
        position_points: posPoints,
        bonus_moyenne: bonus,
        total_points_clt: posPoints + bonus,
        parties_menees: p.parties_menees,
        points: p.total_points,
        reprises: p.total_reprises,
        max_serie: p.max_serie,
        mgp: parseFloat(mgp.toFixed(3)),
        mpart: parseFloat(p.best_single_moyenne.toFixed(3)),
        match_points: p.total_match_points,
        unknown: p.unknown || false
      };
    });

    res.json({
      preview,
      matchCount: allMatches.length,
      playerCount: rankedStats.length,
      fileInfo,
      poules: [...new Set(allMatches.map(m => m.poule_name))],
      bonusMoyenneInfo,
      unknownPlayers: preview.filter(p => p.unknown)
    });

  } catch (error) {
    console.error('[IMPORT-MATCHES-PREVIEW] Error:', error);
    cleanupFiles(files);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /:id/matches
 * Retrieve individual match records for a tournament.
 */
router.get('/:id/matches', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const matches = await dbAllAsync(
      `SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY poule_name, phase_number, id`,
      [tournamentId]
    );
    res.json(matches || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Helper to cleanup uploaded files */
function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (e) {
      console.error('Error cleaning up file:', e);
    }
  }
}

// Export helper functions for bracket.js
router.recomputeAllBonuses = recomputeAllBonuses;
router.recalculateRankings = recalculateRankings;
router.getPositionPointsLookup = getPositionPointsLookup;

module.exports = router;
