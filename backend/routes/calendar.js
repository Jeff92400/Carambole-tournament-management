const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('../db-loader');
const { authenticateToken, requireAdmin, JWT_SECRET } = require('./auth');
const appSettings = require('../utils/app-settings');
const logger = require('../utils/logger');

// Club code mapping - loaded dynamically from database
// Fallback hardcoded values (used if DB not available)
const FALLBACK_CLUB_MAPPING = {
  'A': 'Courbevoie',
  'B': 'Bois-Colombes',
  'C': 'Châtillon',
  'D': 'Clamart',
  'E': 'Clichy',
  '?': null  // Unknown location for finals
};

// Load club codes from database
async function loadClubMapping(orgId) {
  return new Promise((resolve) => {
    db.all(`SELECT calendar_code, display_name FROM clubs WHERE calendar_code IS NOT NULL AND calendar_code != '' AND ($1::int IS NULL OR organization_id = $1)`, [orgId || null], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        logger.log('[Calendar] Using fallback club mapping');
        resolve(FALLBACK_CLUB_MAPPING);
        return;
      }

      const mapping = { '?': null };
      for (const row of rows) {
        mapping[row.calendar_code.toUpperCase()] = row.display_name;
      }
      logger.log('[Calendar] Loaded club mapping from DB:', Object.keys(mapping).filter(k => k !== '?').join(', '));
      resolve(mapping);
    });
  });
}

// Category mapping from display names to codes
const CATEGORY_MAPPING = {
  'NATIONALE 3 GC': 'N3',
  'NATIONALE 3': 'N3',
  'REGIONALE 1': 'R1',
  'REGIONALE 2': 'R2',
  'REGIONALE 3': 'R3',
  'REGIONALE 4': 'R4',
  'N3 GC': 'N3',
  'N3': 'N3',
  'R1': 'R1',
  'R2': 'R2',
  'R3': 'R3',
  'R4': 'R4'
};

// Tournament type to name mapping
const TOURNAMENT_NAME_MAPPING = {
  'T1': 'Tournoi 1',
  'T2': 'Tournoi 2',
  'T3': 'Tournoi 3',
  'F': 'Finale Départementale'
};

const TOURNAMENT_NUMBER_MAPPING = {
  'T1': 1, 'T2': 2, 'T3': 3, 'F': 4
};

const router = express.Router();

// Configure multer for memory storage (we'll save to database)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Excel files are allowed'), false);
    }
  }
});

// Middleware to authenticate via query param or header (for iframe loading)
function authenticateTokenFlexible(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Upload calendar (admin only).
// The server ALWAYS renames the file to a normalized name:
//   Calendrier {organization_short_name} {season}.{ext}
// This guarantees that the frontend's filename-based season detection and
// stale-calendar warning work reliably regardless of how the admin named
// their source file.
router.post('/upload', authenticateToken, requireAdmin, upload.single('calendar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier téléversé' });
  }

  const { originalname, mimetype, buffer } = req.file;
  const uploadedBy = req.user.username || 'admin';
  const orgId = req.user.organizationId || null;

  // Validate season (required, must match YYYY-YYYY with a 1-year gap)
  const rawSeason = (req.body.season || '').trim();
  const seasonMatch = rawSeason.match(/^(\d{4})-(\d{4})$/);
  if (!seasonMatch) {
    return res.status(400).json({ error: 'Saison invalide (format attendu : YYYY-YYYY, ex : 2026-2027)' });
  }
  const startYear = parseInt(seasonMatch[1], 10);
  const endYear = parseInt(seasonMatch[2], 10);
  if (endYear !== startYear + 1) {
    return res.status(400).json({ error: 'Saison invalide (les deux années doivent se suivre, ex : 2026-2027)' });
  }
  const season = rawSeason;

  // Extract extension from the original filename (preserve .xlsx / .pdf / .xls)
  const extMatch = originalname.match(/\.(pdf|xlsx|xls)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'xlsx';

  // Resolve organization short name for the normalized filename
  let orgShortName = 'CDB';
  try {
    const shortName = orgId
      ? await appSettings.getOrgSetting(orgId, 'organization_short_name')
      : await appSettings.getSetting('organization_short_name');
    if (shortName && shortName.trim()) {
      orgShortName = shortName.trim();
    }
  } catch (e) {
    console.warn('[Calendar upload] Could not resolve organization_short_name, using fallback "CDB"');
  }

  // Build normalized filename
  const normalizedFilename = `Calendrier ${orgShortName} ${season}.${ext}`;

  // V 2.0.644 — delete only the previous file of the SAME extension so
  // that an Excel and a PDF can coexist for the same (org, season). The
  // broadcast endpoint prefers the Excel (per-club colours), the public
  // viewer keeps the most recent upload.
  const sameExtPattern = `%.${ext}`;
  db.run(
    `DELETE FROM calendar
       WHERE ($1::int IS NULL OR organization_id = $1)
         AND season = $2
         AND LOWER(filename) LIKE $3`,
    [orgId, season, sameExtPattern],
    (err) => {
      if (err) {
        console.error('Error deleting old calendar:', err);
      }

    db.run(
      'INSERT INTO calendar (filename, content_type, file_data, uploaded_by, organization_id, season) VALUES ($1, $2, $3, $4, $5, $6)',
      [normalizedFilename, mimetype, buffer, uploadedBy, orgId, season],
      function(err) {
        if (err) {
          console.error('Error saving calendar:', err);
          return res.status(500).json({ error: 'Erreur lors de l\'enregistrement du calendrier' });
        }

        logger.log(`[Calendar upload] Stored as "${normalizedFilename}" (source: "${originalname}") for org ${orgId}`);
        res.json({
          message: 'Calendar uploaded successfully',
          filename: normalizedFilename,
          originalFilename: originalname
        });
      }
    );
  });
});

// View calendar (all authenticated users) — optional ?season=YYYY-YYYY
router.get('/view', authenticateTokenFlexible, (req, res) => {
  const orgId = req.user.organizationId || null;
  const season = (req.query.season || '').trim() || null;
  const sql = season
    ? 'SELECT * FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) AND season = $2 ORDER BY created_at DESC LIMIT 1'
    : 'SELECT * FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 1';
  const params = season ? [orgId, season] : [orgId];
  db.get(sql, params, (err, row) => {
    if (err) {
      console.error('Error fetching calendar:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);

    // Handle both Buffer and raw data
    const fileData = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
    res.send(fileData);
  });
});

// Download calendar — optional ?season=YYYY-YYYY
router.get('/download', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  const season = (req.query.season || '').trim() || null;
  const sql = season
    ? 'SELECT * FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) AND season = $2 ORDER BY created_at DESC LIMIT 1'
    : 'SELECT * FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 1';
  const params = season ? [orgId, season] : [orgId];
  db.get(sql, params, (err, row) => {
    if (err) {
      console.error('Error fetching calendar:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);

    const fileData = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
    res.send(fileData);
  });
});

// Public calendar access (no authentication required - for Player App)
// Enable CORS for this public endpoint
router.options('/public', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Disposition');
  res.status(204).end();
});

router.head('/public', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Disposition');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  db.get('SELECT content_type, filename FROM calendar ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
    if (err || !row) {
      return res.status(404).end();
    }
    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);
    res.status(200).end();
  });
});

router.get('/public', async (req, res) => {
  // CORS headers for cross-origin access from Player App
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Disposition');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  // Resolve org from query param for public access
  let orgId = null;
  if (req.query.org) {
    try {
      const orgResult = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM organizations WHERE slug = $1 AND is_active = TRUE', [req.query.org], (err, row) => err ? reject(err) : resolve(row));
      });
      orgId = orgResult?.id || null;
    } catch (e) { /* ignore */ }
  }

  db.get('SELECT * FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 1', [orgId], (err, row) => {
    if (err) {
      console.error('Error fetching calendar:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!row) {
      return res.status(404).send('<html><body style="font-family: Arial; text-align: center; padding: 50px;"><h2>Calendrier non disponible</h2><p>Le calendrier n\'a pas encore été publié.</p></body></html>');
    }

    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);

    const fileData = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
    res.send(fileData);
  });
});

// List available seasons (calendars uploaded for this org)
router.get('/seasons', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.all(
    `SELECT DISTINCT season FROM calendar
     WHERE ($1::int IS NULL OR organization_id = $1) AND season IS NOT NULL
     ORDER BY season DESC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('Error listing calendar seasons:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json((rows || []).map(r => r.season));
    }
  );
});

// Check if calendar exists — optional ?season=YYYY-YYYY
router.get('/info', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  const season = (req.query.season || '').trim() || null;
  const sql = season
    ? 'SELECT id, filename, content_type, uploaded_by, created_at, season FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) AND season = $2 ORDER BY created_at DESC LIMIT 1'
    : 'SELECT id, filename, content_type, uploaded_by, created_at, season FROM calendar WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 1';
  const params = season ? [orgId, season] : [orgId];
  db.get(sql, params, (err, row) => {
    if (err) {
      console.error('Error fetching calendar info:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!row) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      filename: row.filename,
      contentType: row.content_type,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.created_at,
      season: row.season || null
    });
  });
});

// ============================================================
// SEASON TOURNAMENT GENERATION FROM EXCEL CALENDAR
// ============================================================

// Get current club codes mapping (for display in UI)
router.get('/club-codes', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const mapping = await loadClubMapping(orgId);
    // Convert to array format for easier display
    const codes = Object.entries(mapping)
      .filter(([code]) => code !== '?')
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
    res.json(codes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Configure multer for Excel import
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'), false);
    }
  }
});

// Parse Excel calendar and generate tournaments (preview mode)
router.post('/import-season/preview', authenticateToken, requireAdmin, importUpload.single('calendar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const season = req.body.season || '2026-2027';
    const seasonPrefix = season.replace('-', '').substring(2, 6); // "2627" from "2026-2027"

    // Load club mapping from database
    const orgId = req.user.organizationId || null;
    const clubMapping = await loadClubMapping(orgId);

    const tournaments = await parseExcelCalendar(req.file.buffer, season, seasonPrefix, clubMapping);

    res.json({
      success: true,
      season,
      tournaments,
      count: tournaments.length,
      message: `Found ${tournaments.length} tournaments to import`
    });
  } catch (error) {
    console.error('Error parsing calendar:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import tournaments from Excel calendar (actual import)
router.post('/import-season/execute', authenticateToken, requireAdmin, importUpload.single('calendar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const season = req.body.season || '2026-2027';
    const seasonPrefix = season.replace('-', '').substring(2, 6); // "2627" from "2026-2027"

    // Load club mapping from database
    const orgId = req.user.organizationId || null;
    const clubMapping = await loadClubMapping(orgId);

    const tournaments = await parseExcelCalendar(req.file.buffer, season, seasonPrefix, clubMapping);

    let imported = 0;
    let updated = 0;
    let errors = [];

    for (const tournament of tournaments) {
      try {
        await new Promise((resolve, reject) => {
          db.run(`
            INSERT INTO tournoi_ext (tournoi_id, nom, mode, categorie, taille, debut, lieu, tournament_number, organization_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT(tournoi_id) DO UPDATE SET
              nom = EXCLUDED.nom,
              mode = EXCLUDED.mode,
              categorie = EXCLUDED.categorie,
              taille = EXCLUDED.taille,
              debut = EXCLUDED.debut,
              lieu = EXCLUDED.lieu,
              tournament_number = EXCLUDED.tournament_number,
              organization_id = EXCLUDED.organization_id
          `, [
            tournament.tournoi_id,
            tournament.nom,
            tournament.mode,
            tournament.categorie,
            tournament.taille,
            tournament.debut,
            tournament.lieu,
            tournament.tournament_number,
            orgId
          ], function(err) {
            if (err) {
              reject(err);
            } else {
              if (this.changes > 0) updated++;
              else imported++;
              resolve();
            }
          });
        });
      } catch (err) {
        errors.push({ tournoi_id: tournament.tournoi_id, error: err.message });
      }
    }

    res.json({
      success: true,
      season,
      imported,
      updated,
      total: tournaments.length,
      errors,
      message: `Successfully processed ${tournaments.length} tournaments (${imported} new, ${updated} updated)`
    });
  } catch (error) {
    console.error('Error importing calendar:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get tournaments for a specific season
router.get('/season-tournaments/:season', authenticateToken, (req, res) => {
  const season = req.params.season;
  const seasonPrefix = season.replace('-', '').substring(2, 6); // "2627" from "2026-2027"
  const orgId = req.user.organizationId || null;

  db.all(`
    SELECT * FROM tournoi_ext
    WHERE CAST(tournoi_id AS TEXT) LIKE $1
      AND ($2::int IS NULL OR organization_id = $2)
    ORDER BY debut, mode, categorie
  `, [`${seasonPrefix}%`, orgId], (err, rows) => {
    if (err) {
      console.error('Error fetching season tournaments:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Delete all tournaments for a specific season (careful!)
router.delete('/season-tournaments/:season', authenticateToken, requireAdmin, (req, res) => {
  const season = req.params.season;
  const seasonPrefix = season.replace('-', '').substring(2, 6);
  const orgId = req.user.organizationId || null;

  db.run(`
    DELETE FROM tournoi_ext
    WHERE CAST(tournoi_id AS TEXT) LIKE $1
      AND ($2::int IS NULL OR organization_id = $2)
  `, [`${seasonPrefix}%`, orgId], function(err) {
    if (err) {
      console.error('Error deleting season tournaments:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json({
      success: true,
      deleted: this.changes,
      message: `Deleted ${this.changes} tournaments for season ${season}`
    });
  });
});

// Parse Excel calendar file
// Supports two formats:
// 1. CDBHS format: S/D rows with full Date objects, cells = "T1", "T2", "FD"
// 2. Extended format: cells = "T1/A", "T2/B", "F/?" with club codes
async function parseExcelCalendar(buffer, season, seasonPrefix, clubMapping) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheet found in Excel file');
  }

  const tournaments = [];
  let tournamentCounter = 1;

  // Step 1: Find S (Saturday) and D (Sunday) rows by scanning all columns
  let saturdayRow = null;
  let sundayRow = null;
  let sdColumn = null; // Column where S/D labels are

  for (let rowNum = 1; rowNum <= 15; rowNum++) {
    const row = worksheet.getRow(rowNum);
    for (let colNum = 1; colNum <= 10; colNum++) {
      const val = getCellValue(row.getCell(colNum));
      if (!val) continue;
      const trimmed = val.toString().trim();
      if (trimmed === 'S' && !saturdayRow) {
        saturdayRow = rowNum;
        sdColumn = colNum;
      } else if (trimmed === 'D' && saturdayRow && !sundayRow) {
        sundayRow = rowNum;
      }
    }
    if (saturdayRow && sundayRow) break;
  }

  if (!saturdayRow || !sundayRow) {
    throw new Error('Impossible de trouver les lignes de dates (S/D) dans le fichier Excel');
  }

  // Step 2: Build date mapping — columns after sdColumn contain dates
  const dateColumns = {}; // colIndex -> { saturday: Date, sunday: Date }
  const satRow = worksheet.getRow(saturdayRow);
  const sunRow = worksheet.getRow(sundayRow);
  const dateStartCol = sdColumn + 1;

  for (let colNum = dateStartCol; colNum <= 80; colNum++) {
    const satCell = satRow.getCell(colNum);
    const sunCell = sunRow.getCell(colNum);

    const satDate = extractDate(satCell);
    const sunDate = extractDate(sunCell);

    if (satDate || sunDate) {
      dateColumns[colNum] = {};
      if (satDate) dateColumns[colNum].saturday = satDate;
      if (sunDate) dateColumns[colNum].sunday = sunDate;
    }
  }

  if (Object.keys(dateColumns).length === 0) {
    throw new Error('Aucune date trouvée dans les lignes S/D');
  }

  // Step 3: Find data start row (first row after sundayRow with a mode name)
  let dataStartRow = null;
  for (let rowNum = sundayRow + 1; rowNum <= sundayRow + 5; rowNum++) {
    const row = worksheet.getRow(rowNum);
    for (let colNum = 1; colNum <= 3; colNum++) {
      const val = getCellValue(row.getCell(colNum));
      if (val && hasModeName(val.toString())) {
        dataStartRow = rowNum;
        break;
      }
    }
    // Also check if col C has a category (mode may be on col B without col A having a mode)
    if (!dataStartRow) {
      const col3 = getCellValue(row.getCell(3));
      if (col3 && CATEGORY_MAPPING[col3.toString().toUpperCase().trim()]) {
        dataStartRow = rowNum;
      }
    }
    if (dataStartRow) break;
  }

  if (!dataStartRow) {
    dataStartRow = sundayRow + 1;
  }

  // Step 4: Parse data rows
  let currentMode = null;

  for (let rowNum = dataStartRow; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);

    // Check columns 1 and 2 for mode names
    for (let colNum = 1; colNum <= 2; colNum++) {
      const val = getCellValue(row.getCell(colNum));
      if (val) {
        const detected = detectMode(val.toString());
        if (detected) currentMode = detected;
      }
    }

    // Get category from column 3 (or column 2 if mode is in column 1)
    let category = null;
    const col3Value = getCellValue(row.getCell(3));
    if (col3Value) {
      category = resolveCategory(col3Value.toString());
    }
    // Fallback: check column 2 if column 3 is empty or has no category
    if (!category) {
      const col2Value = getCellValue(row.getCell(2));
      if (col2Value) {
        category = resolveCategory(col2Value.toString());
      }
    }

    // Get Pts/Rep (taille) from column 4
    let taille = null;
    const col4Value = getCellValue(row.getCell(4));
    if (col4Value) {
      const ptsRepMatch = col4Value.toString().match(/(\d+)/);
      if (ptsRepMatch) taille = parseInt(ptsRepMatch[1]);
    }

    if (!currentMode || !category) continue;

    // Stop if we hit the legend/footer area
    const col2Check = getCellValue(row.getCell(2));
    if (col2Check) {
      const upper = col2Check.toString().toUpperCase().trim();
      if (upper.includes('LEGENDE') || upper.includes('COULEU')) break;
    }

    // Scan tournament cells in date columns
    for (const colNumStr of Object.keys(dateColumns)) {
      const colNum = parseInt(colNumStr);
      const cellValue = getCellValue(row.getCell(colNum));
      if (!cellValue) continue;

      const upperValue = cellValue.toString().toUpperCase().trim();

      // Skip LBIF entries, previous-year references, and summary rows
      if (upperValue === 'L' || upperValue.startsWith('LBIF')) continue;
      if (upperValue.match(/^F?\d{4}/)) continue; // e.g. "F2024", "2025"

      // Parse tournament type:
      //   "T1", "T2", "T3" — standard tournaments
      //   "T1/A", "T2/B" — with club code
      //   "FD", "F", "F/?" — finale départementale
      const match = upperValue.match(/^(T[123]|FD|F)(?:\/([A-Z?]))?$/i);
      if (!match) continue;

      let tournamentType = match[1].toUpperCase();
      const clubCode = match[2] ? match[2].toUpperCase() : null;

      // Normalize FD → F
      const isFinal = (tournamentType === 'F' || tournamentType === 'FD');
      if (tournamentType === 'FD') tournamentType = 'F';

      // Get the date — Saturday for TQ, Sunday for Finals (fallback to Saturday)
      const dateInfo = dateColumns[colNum];
      if (!dateInfo) continue;

      const tournamentDate = isFinal
        ? (dateInfo.sunday || dateInfo.saturday)
        : (dateInfo.saturday || dateInfo.sunday);
      if (!tournamentDate) continue;

      // Generate tournament ID
      const tournoi_id = parseInt(seasonPrefix + String(tournamentCounter).padStart(3, '0'));
      tournamentCounter++;

      const nom = TOURNAMENT_NAME_MAPPING[tournamentType] || tournamentType;
      const lieu = clubCode ? (clubMapping[clubCode] || null) : null;
      const debut = formatDateStr(tournamentDate);

      tournaments.push({
        tournoi_id,
        nom,
        mode: currentMode,
        categorie: category,
        taille,
        debut,
        lieu,
        tournament_number: TOURNAMENT_NUMBER_MAPPING[tournamentType] || null,
        _type: tournamentType,
        _club_code: clubCode,
        _is_finale: isFinal
      });
    }
  }

  // Sort by date, then mode, then category
  tournaments.sort((a, b) => {
    if (a.debut !== b.debut) return a.debut.localeCompare(b.debut);
    if (a.mode !== b.mode) return a.mode.localeCompare(b.mode);
    return a.categorie.localeCompare(b.categorie);
  });

  // Re-assign IDs after sorting for sequential numbering
  tournaments.forEach((t, index) => {
    t.tournoi_id = parseInt(seasonPrefix + String(index + 1).padStart(3, '0'));
  });

  return tournaments;
}

// Helper: Extract a Date from a cell (handles Date objects, date strings, and ExcelJS date values)
function extractDate(cell) {
  if (!cell || !cell.value) return null;
  const val = cell.value;

  // Direct Date object
  if (val instanceof Date) return val;

  // ExcelJS formula result that is a Date
  if (typeof val === 'object') {
    if (val.result instanceof Date) return val.result;
    if (val.result && !isNaN(new Date(val.result).getTime())) return new Date(val.result);
  }

  // String that looks like a date
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && val.match(/\d{4}/)) return d;
  }

  return null;
}

// Helper: Check if a string contains a game mode name
function hasModeName(str) {
  const upper = str.toUpperCase().trim();
  return upper.includes('LIBRE') || upper.includes('CADRE') ||
         upper === 'BANDE' || upper.includes('3 BANDES') || upper.includes('3BANDES');
}

// Helper: Detect game mode from a cell value string
function detectMode(str) {
  const upper = str.toUpperCase().trim();
  if (upper.includes('3 BANDES') || upper.includes('3BANDES')) return '3 BANDES';
  if (upper === 'BANDE') return 'BANDE';
  if (upper.includes('CADRE')) return 'CADRE';
  if (upper.includes('LIBRE')) return 'LIBRE';
  return null;
}

// Helper: Resolve category from display name
function resolveCategory(str) {
  const upper = str.toUpperCase().trim();
  const direct = CATEGORY_MAPPING[upper];
  if (direct) return direct;

  // Partial matching
  if (upper.includes('NATIONALE 3')) return 'N3';
  if (upper.includes('REGIONALE 1') || upper.includes('RÉGIONALE 1')) return 'R1';
  if (upper.includes('REGIONALE 2') || upper.includes('RÉGIONALE 2')) return 'R2';
  if (upper.includes('REGIONALE 3') || upper.includes('RÉGIONALE 3')) return 'R3';
  if (upper.includes('REGIONALE 4') || upper.includes('RÉGIONALE 4')) return 'R4';
  if (upper.includes('REGIONALE 5') || upper.includes('RÉGIONALE 5')) return 'R5';
  if (upper.includes('DEPARTEMENTALE') || upper.includes('DÉPARTEMENTALE')) {
    if (upper.includes('1')) return 'D1';
    if (upper.includes('2')) return 'D2';
    if (upper.includes('3')) return 'D3';
  }
  return null;
}

// Helper: Get cell value as string
function getCellValue(cell) {
  if (!cell || !cell.value) return null;

  if (typeof cell.value === 'object') {
    if (cell.value.text) return cell.value.text;
    if (cell.value.result) return cell.value.result;
    if (cell.value.richText) {
      return cell.value.richText.map(rt => rt.text).join('');
    }
  }

  return cell.value.toString();
}

// Helper: Format date as YYYY-MM-DD
function formatDateStr(date) {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// V 2.0.640 — POST /api/calendar/announce
//   On-demand broadcast of a season's calendar. Two independent channels,
//   each gated by its own boolean flag in the request body:
//
//     1. email_clubs     — emails the calendar's Excel/PDF file as an
//                          attachment to all clubs (deduplicated union of
//                          email + president_email + responsable_sportif_email),
//                          with an admin-supplied custom message.
//
//     2. notify_players  — creates an in-app announcement for the org's
//                          Player App. First time for this season →
//                          "disponible - cliquez ici" with link to the
//                          Player App's Calendrier tab. Subsequent times →
//                          "mis à jour" without link.
//
//   Body: { season: 'YYYY-YYYY', email_clubs: bool, notify_players: bool,
//           custom_message?: string }
//   Returns: { email_recipients_count, announcement_id, was_first_announcement }
router.post('/announce', authenticateToken, requireAdmin, async (req, res) => {
  const orgId = req.user.organizationId || null;
  const { season, email_clubs, notify_players, custom_message,
          test_mode, test_email } = req.body || {};

  if (!season || !/^\d{4}-\d{4}$/.test(String(season))) {
    return res.status(400).json({ error: 'Saison invalide (YYYY-YYYY)' });
  }
  if (!email_clubs && !notify_players) {
    return res.status(400).json({ error: 'Sélectionnez au moins un canal (email ou notification)' });
  }
  // V 2.0.643 — test mode: send ONE email to a chosen address, skip the
  // Player App announcement entirely. Mirrors the test-mode UX used in
  // convocations / relances / results.
  const isTest = !!test_mode;
  const testAddress = isTest ? String(test_email || '').trim() : '';
  if (isTest && email_clubs) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testAddress)) {
      return res.status(400).json({ error: 'Adresse email de test invalide' });
    }
  }

  const dbGet = (sql, p) => new Promise((ok, ko) =>
    db.get(sql, p, (e, r) => e ? ko(e) : ok(r)));
  const dbAll = (sql, p) => new Promise((ok, ko) =>
    db.all(sql, p, (e, r) => e ? ko(e) : ok(r || [])));
  const dbRun = (sql, p) => new Promise((ok, ko) =>
    db.run(sql, p, function (e) { e ? ko(e) : ok(this); }));

  const result = {
    email_recipients_count: 0,
    email_recipients: [],
    email_errors: 0,
    announcement_id: null,
    was_first_announcement: null,
    test_mode: isTest
  };

  // ---- Channel 1: email the calendar file to all clubs ------------------
  if (email_clubs) {
    // V 2.0.644 — prefer the latest Excel (.xlsx/.xls) over the PDF when
    // both are available for the season. The Excel preserves the per-club
    // colour coding produced by the wizard; the PDF is a flat preview and
    // would arrive without colours.
    let calendarFile = await dbGet(
      `SELECT filename, content_type, file_data
         FROM calendar
        WHERE ($1::int IS NULL OR organization_id = $1)
          AND season = $2
          AND (LOWER(filename) LIKE '%.xlsx' OR LOWER(filename) LIKE '%.xls')
        ORDER BY created_at DESC LIMIT 1`,
      [orgId, season]
    );
    if (!calendarFile) {
      // Fallback: any file (typically the PDF) so the feature still works
      // when only a PDF was uploaded.
      calendarFile = await dbGet(
        `SELECT filename, content_type, file_data
           FROM calendar
          WHERE ($1::int IS NULL OR organization_id = $1) AND season = $2
          ORDER BY created_at DESC LIMIT 1`,
        [orgId, season]
      );
    }
    if (!calendarFile) {
      return res.status(404).json({
        error: `Aucun calendrier téléversé pour la saison ${season}. Téléversez-le d'abord.`
      });
    }

    // V 2.0.643 — test mode short-circuits the recipients lookup: a
    // single email to the admin-supplied address with a [TEST] banner.
    let recipients;
    if (isTest) {
      recipients = [{ club_name: '(Test)', address: testAddress }];
    } else {
      // Build the recipients list (dedup union of the 3 club email fields).
      const clubs = await dbAll(
        `SELECT id, display_name, email, president_email, responsable_sportif_email
           FROM clubs
          WHERE ($1::int IS NULL OR organization_id = $1)`,
        [orgId]
      );
      const seen = new Set();
      recipients = [];
      for (const c of clubs) {
        for (const addr of [c.email, c.president_email, c.responsable_sportif_email]) {
          if (!addr) continue;
          const lower = String(addr).trim().toLowerCase();
          if (!lower || seen.has(lower) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lower)) continue;
          seen.add(lower);
          recipients.push({ club_name: c.display_name, address: addr.trim() });
        }
      }
    }
    result.email_recipients = recipients.map(r => r.address);
    result.email_recipients_count = recipients.length;

    if (recipients.length > 0) {
      const { sendEmail, buildFromAddress, getEmailTemplateSettings } = require('../utils/email-helpers');
      const emailSettings = await getEmailTemplateSettings(orgId);
      const fromAddress = buildFromAddress(emailSettings, 'communication');
      const orgShortName = (orgId
        ? await appSettings.getOrgSetting(orgId, 'organization_short_name')
        : await appSettings.getSetting('organization_short_name')) || 'CDB';
      const primaryColor = (orgId
        ? await appSettings.getOrgSetting(orgId, 'primary_color')
        : await appSettings.getSetting('primary_color')) || '#1F4788';
      // V 2.0.643 — branded header with the CDB logo, mirroring the
      // pattern used by every other email (convocations, results,
      // relances, etc.).
      const orgSlug = orgId
        ? (await appSettings.getOrgSetting(orgId, 'org_slug')) || ''
        : '';
      const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
      const logoUrl = appSettings.buildLogoUrl(baseUrl, orgSlug);

      const safeMessage = String(custom_message || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      const subject = (isTest ? '[TEST] ' : '') + `Calendrier ${orgShortName} — saison ${season}`;
      const fileBuffer = calendarFile.file_data;
      const attachment = {
        filename: calendarFile.filename,
        content: Buffer.isBuffer(fileBuffer) ? fileBuffer.toString('base64') : Buffer.from(fileBuffer).toString('base64')
      };

      const testBanner = isTest
        ? `<div style="background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:10px 14px;border-radius:6px;margin:0 0 16px;font-size:13px;">
             🧪 <strong>Mode test</strong> — ceci est un envoi de test, aucun club n'a reçu cet email. Destinataire unique : ${testAddress}.
           </div>`
        : '';

      // One email per recipient (avoids leaking the recipient list in the To header).
      for (const r of recipients) {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
            <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
              <img src="${logoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
              <h1 style="margin: 0; font-size: 22px;">${orgShortName}</h1>
              <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">📅 CALENDRIER ${season}</p>
            </div>
            <div style="padding: 20px; background: #f8f9fa;">
              ${testBanner}
              <p style="color: #333; line-height: 1.5; margin: 0 0 12px;">Bonjour ${r.club_name || ''},</p>
              ${safeMessage ? `<div style="color: #333; line-height: 1.6; padding: 4px 0 12px;">${safeMessage}</div>` : ''}
              <p style="color: #555; line-height: 1.5; font-size: 14px;">
                Vous trouverez le calendrier de la saison ${season} en pièce jointe (<strong>${calendarFile.filename}</strong>).
              </p>
              <p style="color: #888; font-size: 12px; margin-top: 24px; text-align: center;">
                ${orgShortName}
              </p>
            </div>
          </div>
        `;
        try {
          await sendEmail(
            {
              from: fromAddress,
              to: r.address,
              subject,
              html,
              attachments: [attachment]
            },
            {
              recipientKind: 'admin', // club address — not a player
              orgId,
              recipientName: r.club_name,
              emailType: 'calendar_announce',
              triggeredByUserId: req.user.userId || null,
              context: { season, club_name: r.club_name }
            }
          );
        } catch (emailErr) {
          console.error(`[calendar/announce] email to ${r.address} failed:`, emailErr.message);
          result.email_errors++;
        }
      }
    }
  }

  // ---- Channel 2: in-app announcement for the Player App ---------------
  // V 2.0.643 — test mode skips the announcement entirely (we don't want
  // to spam real Player App users during a dry-run).
  if (notify_players && !isTest) {
    // Detect whether we've already announced this season's calendar so we
    // can pick the right wording. We tag our announcements with a stable
    // marker string in the message body so detection survives even if the
    // admin changed the title later.
    const MARK = `[calendar-announce:${season}]`;
    const existing = await dbGet(
      `SELECT id FROM announcements
        WHERE ($1::int IS NULL OR organization_id = $1)
          AND message LIKE $2
        LIMIT 1`,
      [orgId, `%${MARK}%`]
    );
    result.was_first_announcement = !existing;

    // Build the Player App URL pointing at the Calendrier tab.
    const playerAppUrl = (orgId
      ? await appSettings.getOrgSetting(orgId, 'player_app_url')
      : await appSettings.getSetting('player_app_url')) || '';
    // Append #calendar so the app lands on the calendar tab on open.
    // The Player App reads the hash on load to focus the right tab.
    const calendarLink = playerAppUrl ? `${playerAppUrl}#calendar` : '';

    const title = result.was_first_announcement
      ? `Calendrier ${season} disponible`
      : `Calendrier ${season} mis à jour`;
    let message;
    if (result.was_first_announcement && calendarLink) {
      message = `Le calendrier des compétitions de la saison qui commence est disponible — <a href="${calendarLink}">cliquez ici</a>. ${MARK}`;
    } else if (result.was_first_announcement) {
      message = `Le calendrier des compétitions de la saison qui commence est disponible. ${MARK}`;
    } else {
      message = `Le calendrier des compétitions a été mis à jour. ${MARK}`;
    }

    const inserted = await dbRun(
      `INSERT INTO announcements
         (title, message, type, is_active, expires_at, created_by, organization_id, target_type)
       VALUES ($1, $2, 'info', TRUE, NULL, $3, $4, 'all')`,
      [title, message, req.user.username || 'admin', orgId]
    );
    result.announcement_id = inserted.lastID || null;
  }

  res.json({ success: true, ...result });
});

module.exports = router;
