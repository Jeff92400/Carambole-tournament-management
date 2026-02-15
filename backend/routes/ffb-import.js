const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { parse } = require('csv-parse');
const db = require('../db-loader');
const { authenticateToken, requireSuperAdmin } = require('./auth');

const router = express.Router();

// All routes require super admin
router.use(authenticateToken, requireSuperAdmin);

// Multer config for CSV uploads
const upload = multer({
  dest: '/tmp',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max (licences file is large)
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers CSV sont acceptés'), false);
    }
  }
});

// Helper: parse DD/MM/YYYY → YYYY-MM-DD
function parseDateFR(str) {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Helper: promisified db.run
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

// Helper: promisified db.get
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Helper: promisified db.all
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Helper: parse CSV file into array of objects
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];
    const content = fs.readFileSync(filePath, 'utf-8');

    const parser = parse(content, {
      delimiter: ';',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });

    parser.on('data', (record) => records.push(record));
    parser.on('error', (err) => reject(err));
    parser.on('end', () => resolve(records));
  });
}

// Helper: log import results
async function logImport(fileType, source, filename, stats, importedBy, durationMs, errors) {
  try {
    await dbRun(
      `INSERT INTO ffb_import_log (file_type, source, filename, record_count, new_count, updated_count, error_count, errors, imported_by, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [fileType, source, filename, stats.total, stats.created, stats.updated, stats.errors,
       errors.length > 0 ? JSON.stringify(errors.slice(0, 100)) : null, importedBy, durationMs]
    );
  } catch (e) {
    console.error('Error logging FFB import:', e);
  }
}

// ============= IMPORT LIGUES =============
// POST /api/ffb/import/ligues
router.post('/import/ligues', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });

  const startTime = Date.now();
  const stats = { total: 0, created: 0, updated: 0, errors: 0 };
  const errors = [];

  try {
    const records = await parseCSV(req.file.path);
    stats.total = records.length;

    for (const row of records) {
      try {
        const numero = (row['Numero'] || '').trim();
        const nom = (row['Nom'] || '').trim();
        if (!numero) { stats.errors++; continue; }

        // Collect all other columns as raw_data
        const rawData = { ...row };
        delete rawData['Numero'];
        delete rawData['Nom'];

        const existing = await dbGet(`SELECT numero FROM ffb_ligues WHERE numero = $1`, [numero]);
        if (existing) {
          await dbRun(
            `UPDATE ffb_ligues SET nom = $1, raw_data = $2, updated_at = CURRENT_TIMESTAMP WHERE numero = $3`,
            [nom, JSON.stringify(rawData), numero]
          );
          stats.updated++;
        } else {
          await dbRun(
            `INSERT INTO ffb_ligues (numero, nom, raw_data) VALUES ($1, $2, $3)`,
            [numero, nom, JSON.stringify(rawData)]
          );
          stats.created++;
        }
      } catch (e) {
        stats.errors++;
        errors.push({ row: row['Numero'], error: e.message });
      }
    }

    await logImport('ligues', 'manual', req.file.originalname, stats, req.user.username, Date.now() - startTime, errors);
    fs.unlinkSync(req.file.path);

    res.json({ success: true, ...stats, duration_ms: Date.now() - startTime });
  } catch (error) {
    console.error('FFB ligues import error:', error);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Erreur lors de l\'import: ' + error.message });
  }
});

// ============= IMPORT CLUBS =============
// POST /api/ffb/import/clubs
router.post('/import/clubs', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });

  const startTime = Date.now();
  const stats = { total: 0, created: 0, updated: 0, errors: 0 };
  const cdbsCreated = new Set();
  const errors = [];

  try {
    const records = await parseCSV(req.file.path);
    stats.total = records.length;

    for (const row of records) {
      try {
        const numero = (row['Numero'] || '').trim();
        const ligueNumero = (row['Ligue'] || '').trim();
        const cdbCode = (row['CDB'] || '').trim();
        const nom = (row['Nom'] || '').trim();
        const sigle = (row['Sigle'] || '').trim();
        const codePostal = (row['Code_postal'] || '').trim();
        const ville = (row['Ville'] || '').trim();
        const email = (row['Email'] || '').trim();
        const tel = (row['Tel'] || '').trim();
        const nbCar310 = parseInt(row['Nb_car_310']) || 0;
        const nbCar280 = parseInt(row['Nb_car_280']) || 0;
        const nbCarAutres = parseInt(row['Nb_car_autres']) || 0;
        const nbBb = parseInt(row['Nb_bb']) || 0;
        const nbSnook = parseInt(row['Nb_snook']) || 0;
        const nbAmer = parseInt(row['Nb_amer']) || 0;
        const typeSalle = (row['Type_salle'] || '').trim();
        const accessHandicap = (row['Access_handicap'] || '').trim();

        if (!numero) { stats.errors++; continue; }

        // Auto-create CDB if not exists
        if (cdbCode && ligueNumero && !cdbsCreated.has(cdbCode)) {
          try {
            // Ensure ligue exists first
            const ligueExists = await dbGet(`SELECT numero FROM ffb_ligues WHERE numero = $1`, [ligueNumero]);
            if (!ligueExists) {
              await dbRun(`INSERT INTO ffb_ligues (numero, nom) VALUES ($1, $2) ON CONFLICT (numero) DO NOTHING`, [ligueNumero, '']);
            }
            await dbRun(
              `INSERT INTO ffb_cdbs (code, ligue_numero) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET ligue_numero = $2, updated_at = CURRENT_TIMESTAMP`,
              [cdbCode, ligueNumero]
            );
            cdbsCreated.add(cdbCode);
          } catch (e) {
            // Ignore CDB creation errors
          }
        }

        // Collect raw_data
        const rawData = { ...row };
        ['Numero','Ligue','CDB','Nom','Sigle','Code_postal','Ville','Email','Tel',
         'Nb_car_310','Nb_car_280','Nb_car_autres','Nb_bb','Nb_snook','Nb_amer',
         'Type_salle','Access_handicap'].forEach(k => delete rawData[k]);

        const existing = await dbGet(`SELECT numero FROM ffb_clubs WHERE numero = $1`, [numero]);
        if (existing) {
          await dbRun(
            `UPDATE ffb_clubs SET ligue_numero=$1, cdb_code=$2, nom=$3, sigle=$4, code_postal=$5,
             ville=$6, email=$7, tel=$8, nb_car_310=$9, nb_car_280=$10, nb_car_autres=$11,
             nb_bb=$12, nb_snook=$13, nb_amer=$14, type_salle=$15, access_handicap=$16,
             raw_data=$17, updated_at=CURRENT_TIMESTAMP WHERE numero=$18`,
            [ligueNumero, cdbCode, nom, sigle, codePostal, ville, email, tel,
             nbCar310, nbCar280, nbCarAutres, nbBb, nbSnook, nbAmer,
             typeSalle, accessHandicap, JSON.stringify(rawData), numero]
          );
          stats.updated++;
        } else {
          await dbRun(
            `INSERT INTO ffb_clubs (numero, ligue_numero, cdb_code, nom, sigle, code_postal, ville,
             email, tel, nb_car_310, nb_car_280, nb_car_autres, nb_bb, nb_snook, nb_amer,
             type_salle, access_handicap, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [numero, ligueNumero, cdbCode, nom, sigle, codePostal, ville, email, tel,
             nbCar310, nbCar280, nbCarAutres, nbBb, nbSnook, nbAmer,
             typeSalle, accessHandicap, JSON.stringify(rawData)]
          );
          stats.created++;
        }
      } catch (e) {
        stats.errors++;
        errors.push({ row: row['Numero'], error: e.message });
      }
    }

    await logImport('clubs', 'manual', req.file.originalname, stats, req.user.username, Date.now() - startTime, errors);
    fs.unlinkSync(req.file.path);

    res.json({ success: true, ...stats, cdbs_created: cdbsCreated.size, duration_ms: Date.now() - startTime });
  } catch (error) {
    console.error('FFB clubs import error:', error);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Erreur lors de l\'import: ' + error.message });
  }
});

// ============= IMPORT LICENCES =============
// POST /api/ffb/import/licences
router.post('/import/licences', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });

  const startTime = Date.now();
  const stats = { total: 0, created: 0, updated: 0, errors: 0 };
  const errors = [];

  try {
    const records = await parseCSV(req.file.path);
    stats.total = records.length;

    for (const row of records) {
      try {
        const licence = (row['Licence'] || '').trim();
        const ligueNumero = (row['Ligue'] || '').trim();
        const cdbCode = (row['CDB'] || '').trim();
        const numClub = (row['Num_Club'] || '').trim();
        const prenom = (row['Prenom'] || '').trim();
        const nom = (row['Nom'] || '').trim();
        const dateNaissance = parseDateFR(row['Date_de_naissance']);
        const sexe = (row['Sexe'] || '').trim();
        const categorie = (row['Categorie'] || '').trim();
        const discipline = (row['Discipline'] || '').trim();
        const arbitre = (row['Arbitre'] || '').trim();
        const dateLicence = parseDateFR(row['Date_licence']);
        const nationalite = (row['Nationalite'] || '').trim();
        const email = (row['Email'] || '').trim();

        if (!licence) { stats.errors++; continue; }

        // Collect raw_data
        const rawData = { ...row };
        ['Licence','Ligue','CDB','Num_Club','Prenom','Nom','Date_de_naissance','Sexe',
         'Categorie','Discipline','Arbitre','Date_licence','Nationalite','Email'].forEach(k => delete rawData[k]);

        // Pad numClub to match ffb_clubs.numero format (5 digits with leading zeros)
        const numClubPadded = numClub ? numClub.padStart(5, '0') : null;

        // Check if club exists — use padded version, fallback to original
        let clubRef = null;
        if (numClubPadded) {
          const clubExists = await dbGet(`SELECT numero FROM ffb_clubs WHERE numero = $1`, [numClubPadded]);
          if (clubExists) {
            clubRef = numClubPadded;
          } else {
            // Try original (unpadded)
            const clubExistsOrig = await dbGet(`SELECT numero FROM ffb_clubs WHERE numero = $1`, [numClub]);
            if (clubExistsOrig) clubRef = numClub;
          }
        }

        const existing = await dbGet(`SELECT licence FROM ffb_licences WHERE licence = $1`, [licence]);
        if (existing) {
          await dbRun(
            `UPDATE ffb_licences SET ligue_numero=$1, cdb_code=$2, num_club=$3, prenom=$4, nom=$5,
             date_de_naissance=$6, sexe=$7, categorie=$8, discipline=$9, arbitre=$10,
             date_licence=$11, nationalite=$12, email=$13, raw_data=$14, updated_at=CURRENT_TIMESTAMP
             WHERE licence=$15`,
            [ligueNumero, cdbCode, clubRef, prenom, nom, dateNaissance, sexe, categorie,
             discipline, arbitre, dateLicence, nationalite, email, JSON.stringify(rawData), licence]
          );
          stats.updated++;
        } else {
          await dbRun(
            `INSERT INTO ffb_licences (licence, ligue_numero, cdb_code, num_club, prenom, nom,
             date_de_naissance, sexe, categorie, discipline, arbitre, date_licence, nationalite, email, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [licence, ligueNumero, cdbCode, clubRef, prenom, nom, dateNaissance, sexe, categorie,
             discipline, arbitre, dateLicence, nationalite, email, JSON.stringify(rawData)]
          );
          stats.created++;
        }
      } catch (e) {
        stats.errors++;
        errors.push({ row: row['Licence'], error: e.message });
      }
    }

    await logImport('licences', 'manual', req.file.originalname, stats, req.user.username, Date.now() - startTime, errors);
    fs.unlinkSync(req.file.path);

    res.json({ success: true, ...stats, duration_ms: Date.now() - startTime });
  } catch (error) {
    console.error('FFB licences import error:', error);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Erreur lors de l\'import: ' + error.message });
  }
});

// ============= STATUS & HISTORY =============

// GET /api/ffb/status — Counts per table, last import
router.get('/status', async (req, res) => {
  try {
    const [ligues, cdbs, clubs, licences] = await Promise.all([
      dbGet(`SELECT COUNT(*) as count FROM ffb_ligues`),
      dbGet(`SELECT COUNT(*) as count FROM ffb_cdbs`),
      dbGet(`SELECT COUNT(*) as count FROM ffb_clubs`),
      dbGet(`SELECT COUNT(*) as count FROM ffb_licences`)
    ]);

    const lastImport = await dbGet(
      `SELECT file_type, filename, record_count, new_count, updated_count, error_count, imported_at, duration_ms
       FROM ffb_import_log ORDER BY imported_at DESC LIMIT 1`
    );

    res.json({
      counts: {
        ligues: parseInt(ligues?.count) || 0,
        cdbs: parseInt(cdbs?.count) || 0,
        clubs: parseInt(clubs?.count) || 0,
        licences: parseInt(licences?.count) || 0
      },
      last_import: lastImport || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ffb/import/history — Import log entries
router.get('/import/history', async (req, res) => {
  try {
    const logs = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, file_type, source, filename, record_count, new_count, updated_count, error_count, imported_by, imported_at, duration_ms
         FROM ffb_import_log ORDER BY imported_at DESC LIMIT 50`,
        [],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= BROWSE FFB DATA =============

// GET /api/ffb/cdbs — List all FFB CDBs with counts (for browser filters)
router.get('/cdbs', async (req, res) => {
  try {
    const cdbs = await dbAll(`
      SELECT c.code, c.ligue_numero, l.nom as ligue_nom,
        (SELECT COUNT(*) FROM ffb_licences fl WHERE fl.cdb_code = c.code) as licence_count,
        (SELECT COUNT(*) FROM ffb_clubs fc WHERE fc.cdb_code = c.code) as club_count
      FROM ffb_cdbs c
      LEFT JOIN ffb_ligues l ON c.ligue_numero = l.numero
      ORDER BY l.nom, c.code
    `);
    res.json(cdbs);
  } catch (error) {
    console.error('Error listing FFB CDBs:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ffb/ligues — List all ligues with counts
router.get('/ligues', async (req, res) => {
  try {
    const ligues = await dbAll(`
      SELECT l.numero, l.nom,
        (SELECT COUNT(*) FROM ffb_clubs c WHERE c.ligue_numero = l.numero) as club_count,
        (SELECT COUNT(*) FROM ffb_licences fl WHERE fl.ligue_numero = l.numero) as licence_count
      FROM ffb_ligues l
      ORDER BY l.nom
    `);
    res.json(ligues);
  } catch (error) {
    console.error('Error listing ligues:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ffb/clubs — List clubs with filters
router.get('/clubs', async (req, res) => {
  const { ligue, cdb, q } = req.query;
  try {
    let where = [];
    let params = [];
    let idx = 1;

    if (ligue) { where.push(`c.ligue_numero = $${idx++}`); params.push(ligue); }
    if (cdb) { where.push(`c.cdb_code = $${idx++}`); params.push(cdb); }
    if (q && q.length >= 2) {
      where.push(`(UPPER(c.nom) LIKE $${idx} OR UPPER(c.ville) LIKE $${idx} OR c.numero LIKE $${idx})`);
      params.push(`%${q.toUpperCase()}%`);
      idx++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const clubs = await dbAll(`
      SELECT c.numero, c.nom, c.sigle, c.ville, c.code_postal, c.cdb_code, c.email, c.tel,
        c.nb_car_310, c.nb_car_280, c.nb_car_autres,
        l.nom as ligue_nom,
        (SELECT COUNT(*) FROM ffb_licences fl WHERE fl.num_club = c.numero) as licence_count
      FROM ffb_clubs c
      LEFT JOIN ffb_ligues l ON c.ligue_numero = l.numero
      ${whereClause}
      ORDER BY c.nom
      LIMIT 200
    `, params);
    res.json(clubs);
  } catch (error) {
    console.error('Error listing clubs:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ffb/licences — List licences with filters (paginated)
router.get('/licences', async (req, res) => {
  const { cdb, club, categorie, discipline, q, page = 1 } = req.query;
  const limit = 50;
  const offset = (Math.max(1, parseInt(page)) - 1) * limit;

  try {
    let where = [];
    let params = [];
    let idx = 1;

    if (cdb) { where.push(`fl.cdb_code = $${idx++}`); params.push(cdb); }
    if (club) { where.push(`fl.num_club = $${idx++}`); params.push(club); }
    if (categorie) { where.push(`fl.categorie = $${idx++}`); params.push(categorie); }
    if (discipline) { where.push(`fl.discipline = $${idx++}`); params.push(discipline); }
    if (q && q.length >= 2) {
      where.push(`(UPPER(fl.nom) LIKE $${idx} OR UPPER(fl.prenom) LIKE $${idx} OR fl.licence LIKE $${idx})`);
      params.push(`%${q.toUpperCase()}%`);
      idx++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // Count total
    const countRow = await dbGet(`SELECT COUNT(*) as count FROM ffb_licences fl ${whereClause}`, params);
    const total = parseInt(countRow?.count || 0);

    // Fetch page
    const licences = await dbAll(`
      SELECT fl.licence, fl.prenom, fl.nom, fl.sexe, fl.date_de_naissance, fl.categorie,
        fl.discipline, fl.num_club, fl.email, fl.cdb_code, fl.nationalite, fl.arbitre,
        fl.raw_data->>'Tel_port' as tel_port,
        fl.raw_data->>'Tel_fixe' as tel_fixe,
        fc.nom as club_nom, fc.ville as club_ville
      FROM ffb_licences fl
      LEFT JOIN ffb_clubs fc ON fl.num_club = fc.numero
      ${whereClause}
      ORDER BY fl.nom, fl.prenom
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limit, offset]);

    res.json({ data: licences, total, page: parseInt(page), pages: Math.ceil(total / limit), limit });
  } catch (error) {
    console.error('Error listing licences:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ffb/licences/filter-options — Get distinct values for filter dropdowns
router.get('/licences/filter-options', async (req, res) => {
  const { cdb } = req.query;
  try {
    const categories = await dbAll(
      `SELECT DISTINCT categorie FROM ffb_licences WHERE categorie IS NOT NULL AND categorie != '' ${cdb ? 'AND cdb_code = $1' : ''} ORDER BY categorie`,
      cdb ? [cdb] : []
    );
    const disciplines = await dbAll(
      `SELECT DISTINCT discipline FROM ffb_licences WHERE discipline IS NOT NULL AND discipline != '' ${cdb ? 'AND cdb_code = $1' : ''} ORDER BY discipline`,
      cdb ? [cdb] : []
    );
    // Clubs for selected CDB
    let clubs = [];
    if (cdb) {
      clubs = await dbAll(
        `SELECT numero, nom FROM ffb_clubs WHERE cdb_code = $1 ORDER BY nom`,
        [cdb]
      );
    }
    res.json({
      categories: categories.map(r => r.categorie),
      disciplines: disciplines.map(r => r.discipline),
      clubs
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============= SYNC PLAYERS FROM FFB LICENCES =============

// GET /api/ffb/sync/preview — Preview what will be synced (dry run)
router.get('/sync/preview', async (req, res) => {
  try {
    // Find players that have a matching FFB licence
    const matched = await dbAll(
      `SELECT p.licence, p.first_name, p.last_name, p.club, p.ffb_last_sync,
              fl.num_club AS ffb_club_numero, fl.date_de_naissance, fl.sexe,
              fl.categorie AS ffb_categorie, fl.discipline, fl.arbitre,
              fl.date_licence, fl.nationalite
       FROM players p
       INNER JOIN ffb_licences fl ON REPLACE(p.licence, ' ', '') = REPLACE(fl.licence, ' ', '')
       WHERE UPPER(p.licence) NOT LIKE 'TEST%'
       ORDER BY p.last_name, p.first_name`
    );

    // Find players with no FFB match
    const unmatched = await dbAll(
      `SELECT p.licence, p.first_name, p.last_name, p.club
       FROM players p
       LEFT JOIN ffb_licences fl ON REPLACE(p.licence, ' ', '') = REPLACE(fl.licence, ' ', '')
       WHERE fl.licence IS NULL AND UPPER(p.licence) NOT LIKE 'TEST%'
       ORDER BY p.last_name, p.first_name`
    );

    const alreadySynced = matched.filter(p => p.ffb_last_sync !== null).length;
    const neverSynced = matched.filter(p => p.ffb_last_sync === null).length;

    res.json({
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      already_synced: alreadySynced,
      never_synced: neverSynced,
      matched: matched.slice(0, 50), // First 50 for preview
      unmatched: unmatched.slice(0, 20) // First 20 unmatched
    });
  } catch (error) {
    console.error('FFB sync preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ffb/sync/players — Execute sync: enrich players from ffb_licences
router.post('/sync/players', async (req, res) => {
  const startTime = Date.now();
  const stats = { total: 0, updated: 0, already_current: 0, errors: 0 };
  const errors = [];

  try {
    // Find all matching player-licence pairs
    const matches = await dbAll(
      `SELECT p.licence AS player_licence, fl.licence AS ffb_licence,
              fl.num_club, fl.date_de_naissance, fl.sexe,
              fl.categorie, fl.discipline, fl.arbitre,
              fl.date_licence, fl.nationalite
       FROM players p
       INNER JOIN ffb_licences fl ON REPLACE(p.licence, ' ', '') = REPLACE(fl.licence, ' ', '')
       WHERE UPPER(p.licence) NOT LIKE 'TEST%'`
    );

    stats.total = matches.length;

    for (const m of matches) {
      try {
        await dbRun(
          `UPDATE players SET
            ffb_club_numero = $1,
            date_of_birth = $2,
            sexe = $3,
            ffb_categorie = $4,
            discipline = $5,
            arbitre = $6,
            date_licence = $7,
            nationalite = $8,
            ffb_last_sync = CURRENT_TIMESTAMP
           WHERE licence = $9`,
          [
            m.num_club || null,
            m.date_de_naissance || null,
            m.sexe || null,
            m.categorie || null,
            m.discipline || null,
            m.arbitre || null,
            m.date_licence || null,
            m.nationalite || null,
            m.player_licence
          ]
        );
        stats.updated++;
      } catch (e) {
        stats.errors++;
        errors.push({ licence: m.player_licence, error: e.message });
      }
    }

    // Update app setting for last sync date
    await dbRun(
      `UPDATE app_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'ffb_last_sync_date'`,
      [new Date().toISOString()]
    );

    // Log this sync
    await logImport('sync_players', 'manual', 'ffb_licences→players', stats, req.user.username, Date.now() - startTime, errors);

    res.json({
      success: true,
      ...stats,
      duration_ms: Date.now() - startTime
    });
  } catch (error) {
    console.error('FFB sync players error:', error);
    res.status(500).json({ error: 'Erreur lors de la synchronisation: ' + error.message });
  }
});

module.exports = router;
