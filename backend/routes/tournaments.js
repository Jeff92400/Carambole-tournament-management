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

// ==================== Journées Qualificatives helpers ====================

/**
 * Detect phase name from FFB filename.
 * Pattern: classement_phase_POULES.csv, classement_phase_Finale.csv, etc.
 */
function detectPhaseFromFilename(filename) {
  const match = filename.match(/classement_phase_(.+)\.csv$/i);
  if (match) return match[1].replace(/_/g, ' ').trim();

  const lower = filename.toLowerCase();
  if (lower.includes('poule')) return 'POULES';
  if (lower.includes('petite')) return 'Petite finale';
  if (lower.includes('finale') && !lower.includes('demi')) return 'Finale';
  if (lower.includes('demi')) return 'Demi-finales';
  if (lower.includes('classement')) return 'CLASSEMENTS';

  return filename.replace(/\.csv$/i, '');
}

/**
 * Normalize a phase key for comparison (lowercase, no accents, underscores).
 */
function normalizePhaseKey(phaseName) {
  return phaseName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_\s]+/g, '_')
    .trim();
}

/**
 * Find a phase key in phaseData by keyword, optionally excluding certain keywords.
 */
function findPhaseKey(phaseData, keyword, excludeKeywords = []) {
  for (const key of Object.keys(phaseData)) {
    const lower = normalizePhaseKey(key);
    if (lower.includes(keyword) && !excludeKeywords.some(ex => lower.includes(ex))) {
      return key;
    }
  }
  return null;
}

/**
 * Determine final positions (1 to N) from all phase CSVs.
 * phaseData: { phaseName: [parsedRecords], ... }
 * Returns: { licence: position, ... }
 */
function computeJourneePositions(phaseData) {
  const positions = {}; // licence -> position

  // Find the POULES phase
  const poulesKey = findPhaseKey(phaseData, 'poule');
  const poulesRecords = poulesKey ? phaseData[poulesKey] : [];
  const playerCount = poulesRecords.length;

  // Case 1: < 6 players — POULES classement IS the final position
  if (playerCount < 6) {
    for (const record of poulesRecords) {
      positions[record.licence] = record.classement;
    }
    return positions;
  }

  // Case 2: 6+ players — extract positions from bracket/classification phases

  // Finale: classt 1 = 1st place, classt 2 = 2nd place
  const finaleKey = findPhaseKey(phaseData, 'finale', ['demi', 'petite']);
  if (finaleKey) {
    for (const record of phaseData[finaleKey]) {
      if (record.classement === 1) positions[record.licence] = 1;
      if (record.classement === 2) positions[record.licence] = 2;
    }
  }

  // Petite finale: classt 1 = 3rd, classt 2 = 4th
  const petiteFinaleKey = findPhaseKey(phaseData, 'petite');
  if (petiteFinaleKey) {
    for (const record of phaseData[petiteFinaleKey]) {
      if (record.classement === 1) positions[record.licence] = 3;
      if (record.classement === 2) positions[record.licence] = 4;
    }
  }

  // Classification phases: parse position numbers from phase name
  // Examples: "G9-10 - P7-8" -> positions 7,8 ; "G7-8 - P5-6" -> positions 5,6
  for (const [phaseName, records] of Object.entries(phaseData)) {
    const normalized = normalizePhaseKey(phaseName);
    // Skip known phases
    if (normalized.includes('finale') || normalized.includes('demi') ||
        normalized.includes('petite') || normalized === 'poules' ||
        normalized === 'classements') continue;

    // Try to extract position range: look for P followed by digits (e.g., P5-6, P7-8)
    const posMatch = phaseName.match(/P(\d+)\s*[-–]\s*(\d+)/i);
    if (posMatch) {
      const pos1 = parseInt(posMatch[1]);
      const pos2 = parseInt(posMatch[2]);
      const betterPos = Math.min(pos1, pos2);
      const worsePos = Math.max(pos1, pos2);

      for (const record of records) {
        if (!positions[record.licence]) {
          if (record.classement === 1) positions[record.licence] = betterPos;
          if (record.classement === 2) positions[record.licence] = worsePos;
        }
      }
      continue;
    }

    // Fallback: try any digit pair in the name (e.g., "G9-10")
    const digitMatch = phaseName.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (digitMatch) {
      const pos1 = parseInt(digitMatch[1]);
      const pos2 = parseInt(digitMatch[2]);
      const betterPos = Math.min(pos1, pos2);
      const worsePos = Math.max(pos1, pos2);

      for (const record of records) {
        if (!positions[record.licence]) {
          if (record.classement === 1) positions[record.licence] = betterPos;
          if (record.classement === 2) positions[record.licence] = worsePos;
        }
      }
    }
  }

  // Fallback: players not assigned from bracket/classification get sequential positions
  const assignedLicences = new Set(Object.keys(positions));
  const highestAssigned = Object.values(positions).length > 0
    ? Math.max(...Object.values(positions))
    : 0;

  const unassigned = poulesRecords
    .filter(r => !assignedLicences.has(r.licence))
    .sort((a, b) => a.classement - b.classement);

  let nextPosition = highestAssigned + 1;
  for (const record of unassigned) {
    positions[record.licence] = nextPosition++;
  }

  return positions;
}

/**
 * Look up position_points for an org and return a mapping { position: points }.
 */
async function getPositionPointsLookup(orgId) {
  const rows = await dbAllAsync(
    'SELECT position, points FROM position_points WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY position ASC',
    [orgId]
  );
  const lookup = {};
  for (const row of rows) {
    lookup[row.position] = row.points;
  }
  return lookup;
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

                    // Compute bonus points then recalculate rankings
                    const orgId = req.user.organizationId || null;
                    computeBonusPoints(finalTournamentId, categoryId, orgId, () => {
                    recalculateRankings(categoryId, season, () => {
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

                      res.json({
                        message: 'Tournament imported successfully',
                        tournamentId: finalTournamentId,
                        imported,
                        errors: errors.length > 0 ? errors : undefined
                      });
                    });
                    }); // close computeBonusPoints
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

// ==================== Journées Qualificatives Import ====================

/**
 * POST /validate-journee
 * Accept multiple CSV files, parse all, check for unknown players across ALL files.
 */
router.post('/validate-journee', authenticateToken, upload.array('files', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    let columnMapping;
    try {
      const profileConfig = await getColumnMapping('tournaments');
      columnMapping = profileConfig?.mappings || DEFAULT_TOURNAMENT_MAPPING;
    } catch (err) {
      columnMapping = DEFAULT_TOURNAMENT_MAPPING;
    }

    const orgId = req.user.organizationId || null;
    const unknownPlayers = [];
    const checkedLicences = new Set();

    for (const file of req.files) {
      const records = await readCSVRecords(file.path);
      const parsed = parseRecordsWithMapping(records, columnMapping);

      for (const player of parsed) {
        if (checkedLicences.has(player.licence)) continue;
        checkedLicences.add(player.licence);

        const existsQuery = `
          SELECT licence, first_name, last_name
          FROM players
          WHERE (REPLACE(licence, ' ', '') = ?
             OR (UPPER(first_name || ' ' || last_name) = UPPER(?)
                 OR UPPER(last_name || ' ' || first_name) = UPPER(?)))
            AND (?::int IS NULL OR organization_id = ?)
        `;

        const existing = await dbGetAsync(existsQuery, [player.licence, player.playerName, player.playerName, orgId, orgId]);

        if (!existing) {
          const nameParts = player.playerName.split(' ');
          const lastName = nameParts[0] || '';
          const firstName = nameParts.slice(1).join(' ') || '';

          unknownPlayers.push({
            licence: player.licence,
            firstName,
            lastName,
            fullName: player.playerName
          });
        }
      }
    }

    // Clean up all uploaded files
    for (const file of req.files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    if (unknownPlayers.length > 0) {
      return res.json({ status: 'validation_required', unknownPlayers });
    } else {
      return res.json({ status: 'ready', message: 'All players exist, ready to import' });
    }

  } catch (error) {
    for (const file of req.files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /import-journee
 * Import multiple CSV files for a Journée Qualificative.
 * Uses POULES file for base stats, bracket/classification files for final positions.
 */
router.post('/import-journee', authenticateToken, upload.array('files', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const { categoryId, tournamentNumber, season, tournamentDate } = req.body;

  if (!categoryId || !tournamentNumber || !season) {
    for (const file of req.files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
    return res.status(400).json({ error: 'Category, tournament number, and season required' });
  }

  try {
    // Load column mapping
    let columnMapping;
    try {
      const profileConfig = await getColumnMapping('tournaments');
      columnMapping = profileConfig?.mappings || DEFAULT_TOURNAMENT_MAPPING;
    } catch (err) {
      columnMapping = DEFAULT_TOURNAMENT_MAPPING;
    }

    const orgId = req.user.organizationId || null;

    // Phase 1: Parse all files and detect phases
    const phaseData = {};
    const detectedPhases = [];

    for (const file of req.files) {
      const phaseName = detectPhaseFromFilename(file.originalname);
      const records = await readCSVRecords(file.path);
      const parsed = parseRecordsWithMapping(records, columnMapping);
      phaseData[phaseName] = parsed;
      detectedPhases.push({ phase: phaseName, playerCount: parsed.length, filename: file.originalname });
    }

    // Find POULES file — required
    const poulesKey = findPhaseKey(phaseData, 'poule');
    if (!poulesKey) {
      for (const file of req.files) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
      return res.status(400).json({ error: 'Le fichier POULES est obligatoire' });
    }

    const poulesRecords = phaseData[poulesKey];

    // Phase 2: Create or update tournament
    await dbRunAsync(
      `INSERT INTO tournaments (category_id, tournament_number, season, tournament_date, organization_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(category_id, tournament_number, season) DO UPDATE SET
         tournament_date = $4,
         import_date = CURRENT_TIMESTAMP`,
      [categoryId, tournamentNumber, season, tournamentDate, orgId]
    );

    const tournamentRow = await dbGetAsync(
      'SELECT id FROM tournaments WHERE category_id = $1 AND tournament_number = $2 AND season = $3',
      [categoryId, tournamentNumber, season]
    );
    const tournamentId = tournamentRow.id;

    // Phase 3: Delete existing results + reset scoring state on re-import
    await dbRunAsync('DELETE FROM tournament_results WHERE tournament_id = $1', [tournamentId]);
    await dbRunAsync('DELETE FROM stage_player_scores WHERE tournament_id = $1', [tournamentId]);
    await dbRunAsync('UPDATE tournaments SET scoring_validated = FALSE, scoring_validated_at = NULL WHERE id = $1', [tournamentId]);

    // Phase 4: Ensure all players exist
    for (const record of poulesRecords) {
      const nameParts = record.playerName.split(' ');
      const lastName = nameParts[0] || '';
      const firstName = nameParts.slice(1).join(' ') || '';

      await dbRunAsync(
        `INSERT INTO players (licence, first_name, last_name, club, is_active, organization_id)
         VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (licence) DO NOTHING`,
        [record.licence, firstName, lastName, 'Club inconnu', orgId]
      );
    }

    // Phase 5: Compute final positions from all phase files
    const finalPositions = computeJourneePositions(phaseData);

    // Phase 6: Look up position_points
    const posPointsLookup = await getPositionPointsLookup(orgId);

    // Phase 7: Insert tournament_results from POULES file with final positions
    let imported = 0;
    const errors = [];

    for (const record of poulesRecords) {
      const position = finalPositions[record.licence] || 0;
      const positionPoints = posPointsLookup[position] || 0;

      try {
        await dbRunAsync(
          `INSERT INTO tournament_results (tournament_id, licence, player_name, position, match_points, moyenne, serie, points, reprises, position_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [tournamentId, record.licence, record.playerName, position, record.matchPoints, record.moyenne, record.serie, record.points, record.reprises, positionPoints]
        );
        imported++;
      } catch (err) {
        errors.push({ licence: record.licence, error: err.message });
      }
    }

    // Phase 8: Compute bonus points + recalculate rankings
    // Check if stage scoring config has manual bonus columns (level_bonus or participation_bonus)
    const stageScoringRows = await dbAllAsync(
      'SELECT * FROM stage_scoring_config WHERE ($1::int IS NULL OR organization_id = $1)',
      [orgId]
    );
    const hasManualBonuses = stageScoringRows.some(r => r.level_bonus > 0 || r.participation_bonus > 0);

    if (hasManualBonuses) {
      // Manual bonuses exist → run auto bonus rules but SKIP ranking recalculation
      // Admin must use scoring-detail page to finalize and trigger rankings
      await new Promise((resolve) => {
        computeBonusPoints(tournamentId, categoryId, orgId, () => {
          resolve();
        });
      });
    } else {
      // No manual bonuses → full auto pipeline (no regression for standard mode)
      await new Promise((resolve) => {
        computeBonusPoints(tournamentId, categoryId, orgId, () => {
          recalculateRankings(categoryId, season, () => {
            resolve();
          });
        });
      });
    }

    // Clean up uploaded files
    for (const file of req.files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // Log action
    logAdminAction({
      req,
      action: ACTION_TYPES.IMPORT_TOURNAMENT,
      details: `Import journée qualificative ${tournamentNumber}, saison ${season}, ${imported} joueurs, ${detectedPhases.length} phases`,
      targetType: 'tournament',
      targetId: tournamentId,
      targetName: `TQ${tournamentNumber} - ${season}`
    });

    // Build positions array for frontend display
    const positionsArray = [];
    for (const record of poulesRecords) {
      const pos = finalPositions[record.licence] || 0;
      positionsArray.push({
        licence: record.licence,
        playerName: record.playerName,
        position: pos,
        positionPoints: posPointsLookup[pos] || 0
      });
    }
    positionsArray.sort((a, b) => (a.position || 999) - (b.position || 999));

    // Check if mixed-category bonus is enabled for this org
    const mixedCategoryBonus = (await appSettings.getOrgSetting(orgId, 'mixed_category_bonus')) === 'true';

    res.json({
      message: 'Journée qualificative importée avec succès',
      tournamentId,
      imported,
      phases: detectedPhases.map(p => p.phase || p),
      phasesCount: detectedPhases.length,
      positions: positionsArray,
      mixedCategoryBonus,
      hasManualBonuses,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    for (const file of req.files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
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
function computeBonusPoints(tournamentId, categoryId, orgId, callback) {
  // 1. Load ALL active structured rules (field_1 IS NOT NULL skips display-only BASE_VDL)
  db.all(
    "SELECT * FROM scoring_rules WHERE is_active = true AND field_1 IS NOT NULL AND ($1::int IS NULL OR organization_id = $1) ORDER BY rule_type, display_order",
    [orgId],
    (err, rules) => {
      if (err || !rules || rules.length === 0) {
        console.log('[BONUS] No evaluatable scoring rules found, skipping');
        return callback(null);
      }

      // Skip if all points are 0
      if (rules.every(r => r.points === 0)) {
        console.log('[BONUS] All scoring rule points are 0, skipping');
        return callback(null);
      }

      // 2. Get game_parameters for reference values
      db.get(
        `SELECT c.display_name as category_name, c.game_type, c.level,
                gp.moyenne_mini, gp.moyenne_maxi
         FROM categories c
         LEFT JOIN game_parameters gp ON UPPER(gp.mode) = UPPER(c.game_type) AND UPPER(gp.categorie) = UPPER(c.level) AND gp.organization_id = c.organization_id
         WHERE c.id = ?`,
        [categoryId],
        (err, catInfo) => {
          if (err) {
            console.warn('[BONUS] Could not load category info:', err);
            return callback(null);
          }

          const referenceValues = {};
          if (catInfo) {
            if (catInfo.moyenne_mini !== null && catInfo.moyenne_mini !== undefined)
              referenceValues.MOYENNE_MINI = parseFloat(catInfo.moyenne_mini);
            if (catInfo.moyenne_maxi !== null && catInfo.moyenne_maxi !== undefined)
              referenceValues.MOYENNE_MAXI = parseFloat(catInfo.moyenne_maxi);
          }

          console.log(`[BONUS] Category ${catInfo ? catInfo.category_name : categoryId}: refs=${JSON.stringify(referenceValues)}, ${rules.length} rules`);

          // 3. Get tournament context (nb_joueurs)
          db.get(
            'SELECT COUNT(*) as nb_joueurs FROM tournament_results WHERE tournament_id = ?',
            [tournamentId],
            (err, countRow) => {
              const tournamentContext = { nb_joueurs: countRow ? countRow.nb_joueurs : 0 };

              // 4. Get all player results
              db.all(
                'SELECT id, licence, points, reprises, match_points, serie FROM tournament_results WHERE tournament_id = ?',
                [tournamentId],
                (err, results) => {
                  if (err || !results || results.length === 0) {
                    console.log('[BONUS] No results to process');
                    return callback(null);
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
                          console.log(`[BONUS] Applied bonus to ${updateCount}/${results.length} results for tournament ${tournamentId}`);
                          callback(null);
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
    const averageBonusEnabled = (await appSettings.getOrgSetting(orgId, 'average_bonus_tiers')) === 'true';
    const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
    const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
    const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;

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

    // Get all player results with position_points, grouped by tournament
    const results = await dbAllAsync(
      `SELECT
         REPLACE(tr.licence, ' ', '') as licence,
         tr.player_name,
         t.tournament_number,
         tr.position_points,
         tr.points,
         tr.reprises,
         tr.match_points,
         tr.serie
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
      playerData[r.licence].tournaments[r.tournament_number] = {
        positionPoints: r.position_points || r.match_points || 0,
        points: r.points || 0,
        reprises: r.reprises || 0,
        matchPoints: r.match_points || 0,
        serie: r.serie || 0,
      };
    }

    // Get game_parameters for this category (for moyenne bonus tiers)
    const category = await dbGetAsync('SELECT game_type, level FROM categories WHERE id = ?', [categoryId]);
    let moyenneMini = 0, moyenneMaxi = 999;
    if (category) {
      const gp = await dbGetAsync(
        'SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(mode) = UPPER(?) AND UPPER(categorie) = UPPER(?)',
        [category.game_type, category.level]
      );
      if (gp) {
        moyenneMini = parseFloat(gp.moyenne_mini) || 0;
        moyenneMaxi = parseFloat(gp.moyenne_maxi) || 999;
      }
    }
    const moyenneMiddle = (moyenneMini + moyenneMaxi) / 2;

    // Compute season ranking for each player
    const rankings = [];
    for (const [licence, data] of Object.entries(playerData)) {
      const tournamentNumbers = Object.keys(data.tournaments).map(Number).sort();
      const positionScores = tournamentNumbers.map(tn => ({
        tournamentNumber: tn,
        positionPoints: data.tournaments[tn].positionPoints,
      }));

      // Sort by position points DESC to pick best N
      const sortedScores = [...positionScores].sort((a, b) => b.positionPoints - a.positionPoints);
      const keptScores = sortedScores.slice(0, bestOfCount);
      const totalPositionPoints = keptScores.reduce((sum, s) => sum + s.positionPoints, 0);

      // Build detail JSON: { "1": 10, "2": 8 } (tournament_number: points)
      const ppDetail = {};
      for (const s of positionScores) {
        ppDetail[s.tournamentNumber] = s.positionPoints;
      }

      // Compute average from the best N tournaments' points/reprises
      const keptTournamentNumbers = new Set(keptScores.map(s => s.tournamentNumber));
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

      // Tiered average bonus (only if enabled in org settings)
      let averageBonus = 0;
      if (averageBonusEnabled) {
        if (avgMoyenne >= moyenneMaxi) {
          averageBonus = tier3;
        } else if (avgMoyenne >= moyenneMiddle) {
          averageBonus = tier2;
        } else if (avgMoyenne >= moyenneMini) {
          averageBonus = tier1;
        }
      }

      const totalScore = totalPositionPoints + averageBonus;

      // Per-tournament points for T1/T2/T3 columns (reuse existing ranking columns)
      const t1 = data.tournaments[1]?.positionPoints || null;
      const t2 = data.tournaments[2]?.positionPoints || null;
      const t3 = data.tournaments[3]?.positionPoints || null;

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
  const rankingNumbers = await getRankingTournamentNumbers(orgId);
  db.all(
    `SELECT id FROM tournaments WHERE category_id = ? AND season = ? AND tournament_number IN (${rankingNumbers.join(',')})`,
    [categoryId, season],
    (err, tournaments) => {
      if (err || !tournaments || tournaments.length === 0) {
        return callback(null);
      }
      let completed = 0;
      tournaments.forEach(t => {
        computeBonusPoints(t.id, categoryId, orgId, () => {
          completed++;
          if (completed === tournaments.length) callback(null);
        });
      });
    }
  );
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
router.get('/:id/results', authenticateToken, (req, res) => {
  const tournamentId = req.params.id;
  console.log('Getting tournament results for ID:', tournamentId);

  // Get tournament info
  db.get(
    `SELECT t.*, c.display_name, c.game_type, c.level,
            COALESCE(tt.is_finale, FALSE) as is_finale,
            tt.display_name as type_display_name
     FROM tournaments t
     JOIN categories c ON t.category_id = c.id
     LEFT JOIN tournament_types tt ON t.tournament_number = tt.tournament_number
       AND (t.organization_id IS NULL OR tt.organization_id = t.organization_id)
     WHERE t.id = ?`,
    [tournamentId],
    (err, tournament) => {
      if (err) {
        console.error('Error fetching tournament:', err);
        return res.status(500).json({ error: err.message });
      }

      if (!tournament) {
        console.log('Tournament not found for ID:', tournamentId);
        return res.status(404).json({ error: 'Tournament not found' });
      }

      console.log('Tournament found:', tournament);

      // Get tournament results with club name, player first/last name, and email
      db.all(
        `SELECT tr.*, p.club as club_name,
                COALESCE(pc.first_name, p.first_name) as first_name,
                COALESCE(pc.last_name, p.last_name) as last_name,
                c.logo_filename as club_logo,
                pc.email
         FROM tournament_results tr
         LEFT JOIN players p ON REPLACE(tr.licence, ' ', '') = REPLACE(p.licence, ' ', '')
         LEFT JOIN player_contacts pc ON REPLACE(tr.licence, ' ', '') = REPLACE(pc.licence, ' ', '')
         LEFT JOIN clubs c ON REPLACE(REPLACE(REPLACE(UPPER(COALESCE(pc.club, p.club)), ' ', ''), '.', ''), '-', '') = REPLACE(REPLACE(REPLACE(UPPER(c.name), ' ', ''), '.', ''), '-', '')
         WHERE tr.tournament_id = ?
         ORDER BY tr.position ASC`,
        [tournamentId],
        (err, results) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          // Extract bonus column metadata from results' bonus_detail
          const seenTypes = new Set();
          let hasLegacyBonus = false;
          (results || []).forEach(r => {
            if (r.bonus_detail) {
              try {
                const detail = JSON.parse(r.bonus_detail);
                Object.keys(detail).forEach(k => { if (detail[k] > 0) seenTypes.add(k); });
              } catch (e) {}
            }
            // Backward compat: results with bonus_points but no bonus_detail (pre-rule-engine)
            if (!r.bonus_detail && r.bonus_points > 0) hasLegacyBonus = true;
          });

          // Backfill legacy results: inject bonus_detail from bonus_points
          if (hasLegacyBonus && seenTypes.size === 0) {
            seenTypes.add('MOYENNE_BONUS');
            (results || []).forEach(r => {
              if (!r.bonus_detail && r.bonus_points > 0) {
                r.bonus_detail = JSON.stringify({ MOYENNE_BONUS: r.bonus_points });
              }
            });
          }

          if (seenTypes.size > 0) {
            // Get column labels from scoring_rules
            const orgId = req.user.organizationId || null;
            const typesArr = [...seenTypes];
            const placeholders = typesArr.map((_, i) => `$${i + 1}`).join(',');
            const orgParam = typesArr.length + 1;
            db.all(
              `SELECT DISTINCT rule_type, column_label FROM scoring_rules WHERE rule_type IN (${placeholders}) AND column_label IS NOT NULL AND ($${orgParam}::int IS NULL OR organization_id = $${orgParam})`,
              [...typesArr, orgId],
              (err, labelRows) => {
                const labelMap = {};
                (labelRows || []).forEach(r => { labelMap[r.rule_type] = r.column_label; });
                res.json({
                  tournament, results,
                  bonusColumns: [...seenTypes].map(rt => ({ ruleType: rt, label: labelMap[rt] || rt }))
                });
              }
            );
          } else {
            res.json({ tournament, results, bonusColumns: [] });
          }
        }
      );
    }
  );
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
       WHERE UPPER(gp.mode) = UPPER($1) AND UPPER(gp.categorie) = UPPER($2)
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
    const matchPointsLoss = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_match_points_loss')) || 0;

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

    // 7. Position points lookup
    const positionPointsLookup = await getPositionPointsLookup(orgId);

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
        matchPointsWin: stageConfigWithNames.find(s => s.stage_code === 'POULES')?.match_points || 0,
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

module.exports = router;
