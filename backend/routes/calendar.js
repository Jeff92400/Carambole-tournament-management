const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('../db-loader');
const { authenticateToken, requireAdmin, JWT_SECRET } = require('./auth');

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
        console.log('[Calendar] Using fallback club mapping');
        resolve(FALLBACK_CLUB_MAPPING);
        return;
      }

      const mapping = { '?': null };
      for (const row of rows) {
        mapping[row.calendar_code.toUpperCase()] = row.display_name;
      }
      console.log('[Calendar] Loaded club mapping from DB:', Object.keys(mapping).filter(k => k !== '?').join(', '));
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

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Upload calendar (admin only)
router.post('/upload', authenticateToken, requireAdmin, upload.single('calendar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { originalname, mimetype, buffer } = req.file;
  const uploadedBy = req.user.username || 'admin';

  // Delete existing calendar and insert new one
  db.run('DELETE FROM calendar', [], (err) => {
    if (err) {
      console.error('Error deleting old calendar:', err);
    }

    db.run(
      'INSERT INTO calendar (filename, content_type, file_data, uploaded_by) VALUES ($1, $2, $3, $4)',
      [originalname, mimetype, buffer, uploadedBy],
      function(err) {
        if (err) {
          console.error('Error saving calendar:', err);
          return res.status(500).json({ error: 'Error saving calendar file' });
        }

        res.json({
          message: 'Calendar uploaded successfully',
          filename: originalname
        });
      }
    );
  });
});

// View calendar (all authenticated users)
router.get('/view', authenticateTokenFlexible, (req, res) => {
  db.get('SELECT * FROM calendar ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
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

// Download calendar
router.get('/download', authenticateToken, (req, res) => {
  db.get('SELECT * FROM calendar ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
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

router.get('/public', (req, res) => {
  // CORS headers for cross-origin access from Player App
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Disposition');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  db.get('SELECT * FROM calendar ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
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

// Check if calendar exists
router.get('/info', authenticateToken, (req, res) => {
  db.get('SELECT id, filename, content_type, uploaded_by, created_at FROM calendar ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
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
      uploadedAt: row.created_at
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
            INSERT INTO tournoi_ext (tournoi_id, nom, mode, categorie, taille, debut, fin, lieu, organization_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT(tournoi_id) DO UPDATE SET
              nom = EXCLUDED.nom,
              mode = EXCLUDED.mode,
              categorie = EXCLUDED.categorie,
              taille = EXCLUDED.taille,
              debut = EXCLUDED.debut,
              fin = EXCLUDED.fin,
              lieu = EXCLUDED.lieu,
              organization_id = EXCLUDED.organization_id
          `, [
            tournament.tournoi_id,
            tournament.nom,
            tournament.mode,
            tournament.categorie,
            tournament.taille,
            tournament.debut,
            tournament.fin,
            tournament.lieu,
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
async function parseExcelCalendar(buffer, season, seasonPrefix, clubMapping) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheet found in Excel file');
  }

  const tournaments = [];
  let tournamentCounter = 1;

  // Find the header rows with dates
  // Row structure (based on the calendar image):
  // Row 1: Title
  // Row 2: Empty or headers
  // Row 3: Headers with months + "S" row (Samedi dates)
  // Row 4: "D" row (Dimanche dates)
  // Row 5+: Data rows with MODE | CATEGORY | Pts/Rep | tournament cells

  // First, find the structure by scanning rows
  let saturdayRow = null;
  let sundayRow = null;
  let dataStartRow = null;
  let dateColumns = {}; // colIndex -> { saturday: Date, sunday: Date }

  // Scan first 10 rows to find structure
  for (let rowNum = 1; rowNum <= 10; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const firstCellValue = getCellValue(row.getCell(1));
    const fourthCellValue = getCellValue(row.getCell(4));

    if (firstCellValue === 'S' || fourthCellValue === 'S') {
      saturdayRow = rowNum;
    } else if (firstCellValue === 'D' || fourthCellValue === 'D') {
      sundayRow = rowNum;
    } else if (firstCellValue && (
      firstCellValue.toUpperCase().includes('LIBRE') ||
      firstCellValue.toUpperCase().includes('CADRE') ||
      firstCellValue.toUpperCase().includes('BANDE')
    )) {
      dataStartRow = rowNum;
      break;
    }
  }

  if (!saturdayRow || !sundayRow) {
    throw new Error('Could not find date header rows (S/D) in Excel file');
  }

  // Parse the date columns
  // The dates are in format: day numbers under month headers
  // We need to find month headers and associate day numbers with full dates
  const monthNames = {
    'SEPTEMBRE': 8, 'OCTOBRE': 9, 'NOVEMBRE': 10, 'DECEMBRE': 11, 'DÉCEMBRE': 11,
    'JANVIER': 0, 'FEVRIER': 1, 'FÉVRIER': 1, 'MARS': 2, 'AVRIL': 3, 'MAI': 4, 'JUIN': 5
  };

  // Find month headers in the row above saturday row or in saturday row itself
  const headerRow = worksheet.getRow(saturdayRow - 1);
  const satRow = worksheet.getRow(saturdayRow);
  const sunRow = worksheet.getRow(sundayRow);

  let currentMonth = null;
  let currentYear = null;
  const startYear = parseInt('20' + seasonPrefix.substring(0, 2)); // 2026
  const endYear = parseInt('20' + seasonPrefix.substring(2, 4));   // 2027

  // Scan columns to build date mapping
  for (let colNum = 4; colNum <= 60; colNum++) {
    // Check for month header
    const headerValue = getCellValue(headerRow.getCell(colNum));
    if (headerValue) {
      const upperHeader = headerValue.toString().toUpperCase().trim();
      for (const [monthName, monthIndex] of Object.entries(monthNames)) {
        if (upperHeader.includes(monthName)) {
          currentMonth = monthIndex;
          // Year depends on month: Sept-Dec = startYear, Jan-June = endYear
          currentYear = monthIndex >= 8 ? startYear : endYear;
          break;
        }
      }
    }

    // Get Saturday and Sunday dates
    const satValue = getCellValue(satRow.getCell(colNum));
    const sunValue = getCellValue(sunRow.getCell(colNum));

    if (currentMonth !== null && currentYear !== null) {
      if (satValue && !isNaN(parseInt(satValue))) {
        const day = parseInt(satValue);
        dateColumns[colNum] = dateColumns[colNum] || {};
        dateColumns[colNum].saturday = new Date(currentYear, currentMonth, day);
      }
      if (sunValue && !isNaN(parseInt(sunValue))) {
        const day = parseInt(sunValue);
        dateColumns[colNum] = dateColumns[colNum] || {};
        dateColumns[colNum].sunday = new Date(currentYear, currentMonth, day);
      }
    }
  }

  // Now parse the data rows
  let currentMode = null;

  for (let rowNum = dataStartRow || 5; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const col1Value = getCellValue(row.getCell(1));
    const col2Value = getCellValue(row.getCell(2));
    const col3Value = getCellValue(row.getCell(3));

    // Check if this row has a mode (LIBRE, CADRE, BANDE, 3 BANDES)
    if (col1Value) {
      const upperCol1 = col1Value.toString().toUpperCase().trim();
      if (upperCol1.includes('LIBRE')) currentMode = 'LIBRE';
      else if (upperCol1.includes('CADRE')) currentMode = 'CADRE';
      else if (upperCol1 === 'BANDE') currentMode = 'BANDE';
      else if (upperCol1.includes('3 BANDES') || upperCol1.includes('3BANDES')) currentMode = '3 BANDES';
    }

    // Get category from column 2
    let category = null;
    if (col2Value) {
      const upperCol2 = col2Value.toString().toUpperCase().trim();
      category = CATEGORY_MAPPING[upperCol2] || null;

      // Try partial matching
      if (!category) {
        if (upperCol2.includes('NATIONALE 3')) category = 'N3';
        else if (upperCol2.includes('REGIONALE 1')) category = 'R1';
        else if (upperCol2.includes('REGIONALE 2')) category = 'R2';
        else if (upperCol2.includes('REGIONALE 3')) category = 'R3';
        else if (upperCol2.includes('REGIONALE 4')) category = 'R4';
      }
    }

    // Get Pts/Rep (taille) from column 3
    let taille = null;
    if (col3Value) {
      const ptsRepMatch = col3Value.toString().match(/(\d+)/);
      if (ptsRepMatch) {
        taille = parseInt(ptsRepMatch[1]);
      }
    }

    if (!currentMode || !category) continue;

    // Scan tournament cells
    for (let colNum = 4; colNum <= 60; colNum++) {
      const cellValue = getCellValue(row.getCell(colNum));
      if (!cellValue) continue;

      const upperValue = cellValue.toString().toUpperCase().trim();

      // Skip LBIF entries (just calendar placeholders)
      if (upperValue === 'L' || upperValue.startsWith('LBIF')) continue;

      // Skip previous year references
      if (upperValue.includes('2024') || upperValue.includes('2025')) continue;

      // Parse tournament type and club: "T1/A", "T2/C", "F/?", etc.
      const match = upperValue.match(/^(T[123]|F)(?:\/([A-E?]))?$/i);
      if (!match) continue;

      const tournamentType = match[1].toUpperCase();
      const clubCode = match[2] ? match[2].toUpperCase() : null;

      // Get the date (Saturday for T1/T2/T3, Sunday for Finals)
      const dateInfo = dateColumns[colNum];
      if (!dateInfo) continue;

      const isFinal = tournamentType === 'F';
      const tournamentDate = isFinal ? dateInfo.sunday : dateInfo.saturday;
      if (!tournamentDate) continue;

      // Generate tournament ID: 2627XXX
      const tournoi_id = parseInt(seasonPrefix + String(tournamentCounter).padStart(3, '0'));
      tournamentCounter++;

      // Get tournament name
      const nom = TOURNAMENT_NAME_MAPPING[tournamentType] || tournamentType;

      // Get location from club mapping
      const lieu = clubCode ? (clubMapping[clubCode] || null) : null;

      // Format date as YYYY-MM-DD
      const debut = formatDate(tournamentDate);

      tournaments.push({
        tournoi_id,
        nom,
        mode: currentMode,
        categorie: category,
        taille,
        debut,
        fin: debut, // Same day
        lieu,
        // Extra info for preview
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

  // Re-assign IDs after sorting to have sequential IDs
  tournaments.forEach((t, index) => {
    t.tournoi_id = parseInt(seasonPrefix + String(index + 1).padStart(3, '0'));
  });

  return tournaments;
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
function formatDate(date) {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = router;
