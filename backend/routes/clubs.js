const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db-loader');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Configure multer for logo uploads (org-aware subfolders)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const orgId = req.user ? req.user.organizationId : null;
    if (orgId) {
      db.get('SELECT slug FROM organizations WHERE id = $1', [orgId], (err, row) => {
        const orgSlug = row ? row.slug : 'default';
        req._orgSlug = orgSlug;
        const uploadDir = path.join(__dirname, '../../frontend/images/clubs', orgSlug);
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      });
    } else {
      const uploadDir = path.join(__dirname, '../../frontend/images/clubs');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    }
  },
  filename: function (req, file, cb) {
    // Generate filename: remove spaces and special chars
    const filename = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '_');
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Get all clubs (exclude logo_data binary to avoid bloating JSON response)
router.get('/', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.all('SELECT id, name, display_name, logo_filename, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, organization_id, created_at FROM clubs WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY name', [orgId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// ==================== CLUB ALIASES ====================
// NOTE: These routes MUST be defined BEFORE /:id to avoid route conflicts

// Get all aliases
router.get('/aliases/list', authenticateToken, (req, res) => {
  db.all('SELECT * FROM club_aliases ORDER BY alias', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Get all aliases with club info
router.get('/aliases/with-clubs', authenticateToken, (req, res) => {
  db.all(`
    SELECT ca.*, c.display_name, c.logo_filename
    FROM club_aliases ca
    LEFT JOIN clubs c ON UPPER(REPLACE(REPLACE(REPLACE(ca.canonical_name, ' ', ''), '.', ''), '-', ''))
                       = UPPER(REPLACE(REPLACE(REPLACE(c.name, ' ', ''), '.', ''), '-', ''))
    ORDER BY ca.alias
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Add new alias
router.post('/aliases', authenticateToken, (req, res) => {
  const { alias, canonical_name } = req.body;

  if (!alias || !canonical_name) {
    return res.status(400).json({ error: 'Alias and canonical_name are required' });
  }

  db.run(
    'INSERT INTO club_aliases (alias, canonical_name) VALUES ($1, $2)',
    [alias.trim(), canonical_name.trim()],
    function(err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'This alias already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({
        id: this.lastID,
        alias: alias.trim(),
        canonical_name: canonical_name.trim()
      });
    }
  );
});

// Delete alias
router.delete('/aliases/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM club_aliases WHERE id = $1', [req.params.id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Alias deleted' });
  });
});

// Resolve club name - returns canonical name if alias exists
router.get('/resolve/:name', authenticateToken, (req, res) => {
  const clubName = req.params.name;

  // First check if it's an alias
  db.get(
    'SELECT canonical_name FROM club_aliases WHERE UPPER(REPLACE(REPLACE(REPLACE(alias, \' \', \'\'), \'.\', \'\'), \'-\', \'\')) = UPPER(REPLACE(REPLACE(REPLACE($1, \' \', \'\'), \'.\', \'\'), \'-\', \'\'))',
    [clubName],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({
        original: clubName,
        resolved: row ? row.canonical_name : clubName,
        isAlias: !!row
      });
    }
  );
});

// ==================== END CLUB ALIASES ====================

// Get club by ID (exclude logo_data binary)
router.get('/:id', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.get('SELECT id, name, display_name, logo_filename, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, organization_id, created_at FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [req.params.id, orgId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Club not found' });
    }
    res.json(row);
  });
});

// Add new club
router.post('/', authenticateToken, upload.single('logo'), (req, res) => {
  const { name, display_name, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code } = req.body;
  const logo_filename = req.file
    ? (req._orgSlug ? `${req._orgSlug}/${req.file.filename}` : req.file.filename)
    : null;

  // Read logo binary for database persistence (survives Railway deployments)
  let logoData = null;
  let logoContentType = null;
  if (req.file) {
    try {
      logoData = fs.readFileSync(req.file.path);
      logoContentType = req.file.mimetype || 'image/png';
    } catch (readErr) {
      console.error('Warning: could not read uploaded logo for DB storage:', readErr.message);
    }
  }

  if (!name || !display_name) {
    return res.status(400).json({ error: 'Name and display name are required' });
  }

  const orgId = req.user?.organizationId || null;
  db.run(
    'INSERT INTO clubs (name, display_name, logo_filename, logo_data, logo_content_type, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [name, display_name, logo_filename, logoData, logoContentType, street || null, city || null, zip_code || null, phone || null, email || null, president || null, president_email || null, responsable_sportif_name || null, responsable_sportif_email || null, responsable_sportif_licence || null, calendar_code || null, orgId],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Club name already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({
        id: this.lastID,
        name,
        display_name,
        logo_filename,
        street,
        city,
        zip_code,
        phone,
        email,
        president,
        president_email,
        responsable_sportif_name,
        responsable_sportif_email,
        responsable_sportif_licence,
        calendar_code
      });
    }
  );
});

// Update club
router.put('/:id', authenticateToken, upload.single('logo'), (req, res) => {
  const { name, display_name, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code } = req.body;
  const clubId = req.params.id;

  // Get current club data (exclude logo_data binary)
  const orgId = req.user.organizationId || null;
  db.get('SELECT id, name, display_name, logo_filename, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, organization_id, created_at FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [clubId, orgId], (err, club) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    const newLogoFilename = req.file
      ? (req._orgSlug ? `${req._orgSlug}/${req.file.filename}` : req.file.filename)
      : club.logo_filename;

    // Read logo binary for database persistence (survives Railway deployments)
    let newLogoData = null;
    let newLogoContentType = null;
    if (req.file) {
      try {
        newLogoData = fs.readFileSync(req.file.path);
        newLogoContentType = req.file.mimetype || 'image/png';
      } catch (readErr) {
        console.error('Warning: could not read uploaded logo for DB storage:', readErr.message);
      }
    }

    const newName = name || club.name;
    const newDisplayName = display_name || club.display_name;
    const newStreet = street !== undefined ? street : club.street;
    const newCity = city !== undefined ? city : club.city;
    const newZipCode = zip_code !== undefined ? zip_code : club.zip_code;
    const newPhone = phone !== undefined ? phone : club.phone;
    const newEmail = email !== undefined ? email : club.email;
    const newPresident = president !== undefined ? president : club.president;
    const newPresidentEmail = president_email !== undefined ? (president_email || null) : club.president_email;
    const newResponsableName = responsable_sportif_name !== undefined ? (responsable_sportif_name || null) : club.responsable_sportif_name;
    const newResponsableEmail = responsable_sportif_email !== undefined ? (responsable_sportif_email || null) : club.responsable_sportif_email;
    const newResponsableLicence = responsable_sportif_licence !== undefined ? (responsable_sportif_licence || null) : club.responsable_sportif_licence;
    const newCalendarCode = calendar_code !== undefined ? (calendar_code || null) : club.calendar_code;

    // Build UPDATE — include logo_data only when a new file was uploaded
    const updateQuery = newLogoData
      ? 'UPDATE clubs SET name = $1, display_name = $2, logo_filename = $3, logo_data = $4, logo_content_type = $5, street = $6, city = $7, zip_code = $8, phone = $9, email = $10, president = $11, president_email = $12, responsable_sportif_name = $13, responsable_sportif_email = $14, responsable_sportif_licence = $15, calendar_code = $16 WHERE id = $17 AND ($18::int IS NULL OR organization_id = $18)'
      : 'UPDATE clubs SET name = $1, display_name = $2, logo_filename = $3, street = $4, city = $5, zip_code = $6, phone = $7, email = $8, president = $9, president_email = $10, responsable_sportif_name = $11, responsable_sportif_email = $12, responsable_sportif_licence = $13, calendar_code = $14 WHERE id = $15 AND ($16::int IS NULL OR organization_id = $16)';
    const updateParams = newLogoData
      ? [newName, newDisplayName, newLogoFilename, newLogoData, newLogoContentType, newStreet, newCity, newZipCode, newPhone, newEmail, newPresident, newPresidentEmail, newResponsableName, newResponsableEmail, newResponsableLicence, newCalendarCode, clubId, orgId]
      : [newName, newDisplayName, newLogoFilename, newStreet, newCity, newZipCode, newPhone, newEmail, newPresident, newPresidentEmail, newResponsableName, newResponsableEmail, newResponsableLicence, newCalendarCode, clubId, orgId];

    db.run(updateQuery, updateParams,
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Club name already exists' });
          }
          return res.status(500).json({ error: err.message });
        }

        // Delete old logo if a new one was uploaded
        if (req.file && club.logo_filename && club.logo_filename !== newLogoFilename) {
          const oldLogoPath = path.join(__dirname, '../../frontend/images/clubs', club.logo_filename);
          if (fs.existsSync(oldLogoPath)) {
            fs.unlinkSync(oldLogoPath);
          }
        }

        res.json({
          id: clubId,
          name: newName,
          display_name: newDisplayName,
          logo_filename: newLogoFilename,
          street: newStreet,
          city: newCity,
          zip_code: newZipCode,
          phone: newPhone,
          email: newEmail,
          president: newPresident,
          president_email: newPresidentEmail,
          responsable_sportif_name: newResponsableName,
          responsable_sportif_email: newResponsableEmail,
          responsable_sportif_licence: newResponsableLicence,
          calendar_code: newCalendarCode
        });
      }
    );
  });
});

// Delete club
router.delete('/:id', authenticateToken, (req, res) => {
  const clubId = req.params.id;

  // Get club data to delete logo file
  const orgId = req.user.organizationId || null;
  db.get('SELECT id, logo_filename FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [clubId, orgId], (err, club) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    db.run('DELETE FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [clubId, orgId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Delete logo file if exists
      if (club.logo_filename) {
        const logoPath = path.join(__dirname, '../../frontend/images/clubs', club.logo_filename);
        if (fs.existsSync(logoPath)) {
          fs.unlinkSync(logoPath);
        }
      }

      res.json({ success: true, message: 'Club deleted' });
    });
  });
});

module.exports = router;
