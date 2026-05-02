const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db-loader');
const { authenticateToken, requireAdmin } = require('./auth');

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
  db.all('SELECT id, name, display_name, logo_filename, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, calendar_color, calendar_abbrev, organization_id, created_at FROM clubs WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY name', [orgId], (err, rows) => {
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
// V 2.0.654 — IMPORTANT: list-style GET routes must be declared BEFORE
// /:id otherwise Express matches them as { id: 'ffb-match-dates' } and
// the SQL fails with "invalid input syntax for type integer".
router.get('/ffb-match-dates', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.all(
    `SELECT cf.id, cf.club_id, cf.slot, cf.match_date, cf.label,
            cl.display_name AS club_name
       FROM club_ffb_match_dates cf
       JOIN clubs cl ON cl.id = cf.club_id
      WHERE ($1::int IS NULL OR cf.organization_id = $1)
      ORDER BY cl.display_name ASC, cf.slot ASC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('[clubs/ffb-match-dates] list error:', err);
        return res.status(500).json({ error: err.message });
      }
      (rows || []).forEach(r => {
        if (r.match_date instanceof Date) r.match_date = r.match_date.toISOString().slice(0, 10);
        else if (r.match_date) r.match_date = String(r.match_date).slice(0, 10);
      });
      res.json(rows || []);
    }
  );
});

router.get('/:id', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  // V 2.0.654 — guard against non-integer ids (Express matches sibling
  // /clubs/<word> paths against this handler and would crash the SQL).
  const clubIdInt = parseInt(req.params.id, 10);
  if (!Number.isFinite(clubIdInt)) {
    return res.status(404).json({ error: 'Club not found' });
  }
  db.get('SELECT id, name, display_name, logo_filename, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, calendar_color, calendar_abbrev, organization_id, created_at FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [clubIdInt, orgId], (err, row) => {
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
      const newClubId = this.lastID;

      // V 2.0.636 — auto-style the new club so the calendar grid shows
      // it nicely out of the box. Reads sibling clubs in the same org
      // to avoid colour/abbrev collisions. Best-effort, never blocks
      // the create.
      const respond = (autoStyle) => res.json({
        id: newClubId,
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
        calendar_code,
        calendar_color:  autoStyle?.calendar_color  || null,
        calendar_abbrev: autoStyle?.calendar_abbrev || null
      });

      db.all(
        `SELECT id, display_name, calendar_color, calendar_abbrev, calendar_code
           FROM clubs
          WHERE id <> $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [newClubId, orgId],
        (sErr, siblings) => {
          if (sErr) {
            console.warn('[clubs] auto-style: sibling fetch failed:', sErr.message);
            return respond(null);
          }
          // V 2.0.638 — read the org's chosen palette so the auto-style
          // matches what the admin picked in Settings → Calendrier.
          db.get(
            `SELECT value FROM organization_settings
              WHERE key = 'club_calendar_palette'
                AND ($1::int IS NULL OR organization_id = $1)`,
            [orgId],
            (pErr, pRow) => {
              const palette = (pRow && pRow.value) || 'pastel';
              try {
                const { computeForNewClub } = require('../utils/club-calendar-defaults');
                const auto = computeForNewClub(
                  { id: newClubId, display_name, calendar_code: calendar_code || null },
                  siblings || [],
                  { palette }
                );
                if (!auto.calendar_color && !auto.calendar_abbrev) return respond(null);
                db.run(
                  `UPDATE clubs SET calendar_color = $1, calendar_abbrev = $2 WHERE id = $3`,
                  [auto.calendar_color, auto.calendar_abbrev, newClubId],
                  (uErr) => {
                    if (uErr) {
                      console.warn('[clubs] auto-style UPDATE failed:', uErr.message);
                      return respond(null);
                    }
                    respond(auto);
                  }
                );
              } catch (e) {
                console.warn('[clubs] auto-style helper failed:', e.message);
                respond(null);
              }
            }
          );
        }
      );
    }
  );
});

// Update club
router.put('/:id', authenticateToken, upload.single('logo'), (req, res) => {
  const { name, display_name, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code } = req.body;
  const clubId = req.params.id;

  // Get current club data (exclude logo_data binary)
  const orgId = req.user.organizationId || null;
  db.get('SELECT id, name, display_name, logo_filename, street, city, zip_code, phone, email, president, president_email, responsable_sportif_name, responsable_sportif_email, responsable_sportif_licence, calendar_code, calendar_color, calendar_abbrev, organization_id, created_at FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [clubId, orgId], (err, club) => {
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

// V 2.0.638 — Palette choice for the per-CDB calendar grid styling (Q2).
// Reads/writes the `club_calendar_palette` row in organization_settings.
// PUT accepts an optional `apply: true` flag to re-fill any club whose
// abbrev/color is missing using the new palette (existing admin choices
// are still preserved — only NULL gaps get touched).
router.get('/calendar-palette', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  const { PALETTES } = require('../utils/club-calendar-defaults');
  db.get(
    `SELECT value FROM organization_settings
      WHERE key = 'club_calendar_palette'
        AND ($1::int IS NULL OR organization_id = $1)`,
    [orgId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        palette: (row && row.value) || 'pastel',
        available: Object.keys(PALETTES),
        swatches: PALETTES
      });
    }
  );
});

router.put('/calendar-palette', authenticateToken, async (req, res) => {
  const orgId = req.user.organizationId || null;
  const { palette, apply } = req.body || {};
  const { PALETTES, computeDefaults } = require('../utils/club-calendar-defaults');
  if (!palette || !PALETTES[palette]) {
    return res.status(400).json({ error: 'palette inconnue', available: Object.keys(PALETTES) });
  }
  const dbRun = (sql, p) => new Promise((ok, ko) =>
    db.run(sql, p, function (e) { e ? ko(e) : ok(this); }));
  const dbAll = (sql, p) => new Promise((ok, ko) =>
    db.all(sql, p, (e, r) => e ? ko(e) : ok(r || [])));
  try {
    // Upsert the org-scoped setting.
    await dbRun(
      `INSERT INTO organization_settings (organization_id, key, value)
       VALUES ($1, 'club_calendar_palette', $2)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [orgId, palette]
    );
    let filledCount = 0;
    if (apply) {
      // Fill gaps for this org with the new palette.
      const clubs = await dbAll(
        `SELECT id, display_name, calendar_color, calendar_abbrev, calendar_code
           FROM clubs
          WHERE ($1::int IS NULL OR organization_id = $1)`,
        [orgId]
      );
      const updates = computeDefaults(clubs, { palette });
      for (const u of updates) {
        await dbRun(
          `UPDATE clubs SET calendar_color = $1, calendar_abbrev = $2 WHERE id = $3`,
          [u.calendar_color, u.calendar_abbrev, u.id]
        );
        filledCount++;
      }
    }
    res.json({ palette, applied_to_clubs: filledCount });
  } catch (err) {
    console.error('[clubs] PUT /calendar-palette error:', err);
    res.status(500).json({ error: err.message });
  }
});

// V 2.0.630 — Calendar grid styling (PATCH).
// Lightweight endpoint to set the per-club color + abbreviation used by
// the annual calendar grid views. Kept separate from the main PUT to
// avoid threading two more fields through the existing 16-column update
// (which already deals with multipart logo upload).
//
// Body: { calendar_color?: string|null, calendar_abbrev?: string|null }
//   - calendar_color   : "#RRGGBB" or "#RRGGBBAA"; null clears it
//   - calendar_abbrev  : 1–8 chars; null clears it (caller is expected
//                        to validate length on the UI side)
router.patch('/:id/calendar-style', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  const clubId = parseInt(req.params.id, 10);
  if (!clubId) return res.status(400).json({ error: 'invalid id' });

  const { calendar_color, calendar_abbrev } = req.body || {};

  // Light validation: hex color shape; abbrev length cap.
  let color = calendar_color;
  if (color !== undefined && color !== null && color !== '') {
    if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(color))) {
      return res.status(400).json({ error: 'calendar_color doit être au format #RRGGBB ou #RRGGBBAA' });
    }
  } else {
    color = null;
  }
  let abbrev = calendar_abbrev;
  if (abbrev !== undefined && abbrev !== null && abbrev !== '') {
    abbrev = String(abbrev).trim();
    if (abbrev.length > 8) {
      return res.status(400).json({ error: 'calendar_abbrev limité à 8 caractères' });
    }
  } else {
    abbrev = null;
  }

  db.run(
    `UPDATE clubs
        SET calendar_color = $1, calendar_abbrev = $2
      WHERE id = $3
        AND ($4::int IS NULL OR organization_id = $4)`,
    [color, abbrev, clubId, orgId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this || !this.changes) {
        return res.status(404).json({ error: 'Club introuvable' });
      }
      res.json({ id: clubId, calendar_color: color, calendar_abbrev: abbrev });
    }
  );
});

// Delete club (admin only — destructive action)
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
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

// V 2.0.654 — GET moved earlier in the file (before /:id) to avoid the
// route-collision 500. PUT and DELETE below stay here — their /:id/...
// patterns are not shadowed by /:id.

router.put('/:id/ffb-match-dates', authenticateToken, requireAdmin, (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  const orgId = req.user.organizationId || null;
  const { slot, match_date, label } = req.body || {};
  const slotInt = parseInt(slot, 10);
  if (![1, 2].includes(slotInt)) {
    return res.status(400).json({ error: 'slot doit être 1 ou 2' });
  }
  const dateStr = String(match_date || '').trim();
  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'match_date doit être au format YYYY-MM-DD' });
  }
  // Verify the club belongs to this org.
  db.get(
    'SELECT id FROM clubs WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)',
    [clubId, orgId],
    (err, club) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!club) return res.status(404).json({ error: 'Club introuvable' });

      // Upsert on (club_id, slot)
      db.run(
        `INSERT INTO club_ffb_match_dates (club_id, organization_id, slot, match_date, label, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (club_id, slot)
         DO UPDATE SET match_date = EXCLUDED.match_date,
                       label = EXCLUDED.label,
                       updated_at = CURRENT_TIMESTAMP`,
        [clubId, orgId, slotInt, dateStr || null, label || null],
        function(uErr) {
          if (uErr) {
            console.error('[clubs/ffb-match-dates] upsert error:', uErr);
            return res.status(500).json({ error: uErr.message });
          }
          res.json({ success: true });
        }
      );
    }
  );
});

router.delete('/:id/ffb-match-dates/:slot', authenticateToken, requireAdmin, (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  const slotInt = parseInt(req.params.slot, 10);
  const orgId = req.user.organizationId || null;
  if (![1, 2].includes(slotInt)) {
    return res.status(400).json({ error: 'slot doit être 1 ou 2' });
  }
  db.run(
    `DELETE FROM club_ffb_match_dates
       WHERE club_id = $1 AND slot = $2
         AND ($3::int IS NULL OR organization_id = $3)`,
    [clubId, slotInt, orgId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

module.exports = router;
