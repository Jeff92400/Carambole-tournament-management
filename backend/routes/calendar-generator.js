/**
 * Seasonal Calendar Generator — Phase 2 (backend brief)
 *
 * Endpoints CRUD pour le brief de saison + dates des finales de ligue.
 * Doc: MECANISME-CALENDRIER-SAISONNIER.html
 *
 * Routes ultérieures (Phase 4+) ajoutées dans ce même fichier :
 *   - /constraints (CRUD règles)
 *   - /generate, /draft, /publish (Phase 5-7)
 */

const express = require('express');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();
const getDb = () => require('../db-loader');

// ----------------------------------------------------------------
// Brief de saison
// ----------------------------------------------------------------

// GET /brief?season=2026-2027 — retrieve brief for a season (or null)
router.get('/brief', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const { season } = req.query;

  if (!season) return res.status(400).json({ error: 'season query parameter required' });

  db.get(
    `SELECT * FROM calendar_brief WHERE organization_id = $1 AND season = $2`,
    [orgId, season],
    (err, row) => {
      if (err) {
        console.error('[calendar-generator] GET /brief error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(row || null);
    }
  );
});

// GET /briefs — list all briefs for the org
router.get('/briefs', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;

  db.all(
    `SELECT id, season, status, created_at, updated_at
     FROM calendar_brief
     WHERE organization_id = $1
     ORDER BY season DESC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('[calendar-generator] GET /briefs error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// POST /brief — create a new brief
router.post('/brief', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const userId = req.user.userId;
  const {
    season,
    qualif_day,
    final_day,
    first_weekend,
    blackout_dates,
    active_categories,
    active_hosts,
    final_attribution
  } = req.body;

  if (!season || !qualif_day || !final_day || !first_weekend) {
    return res.status(400).json({ error: 'Missing required fields: season, qualif_day, final_day, first_weekend' });
  }

  db.run(
    `INSERT INTO calendar_brief
       (organization_id, season, qualif_day, final_day, first_weekend,
        blackout_dates, active_categories, active_hosts, final_attribution, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
     RETURNING id`,
    [
      orgId,
      season,
      qualif_day,
      final_day,
      first_weekend,
      JSON.stringify(blackout_dates || []),
      JSON.stringify(active_categories || []),
      JSON.stringify(active_hosts || []),
      final_attribution || 'manual',
      userId
    ],
    function(err, result) {
      if (err) {
        console.error('[calendar-generator] POST /brief error:', err);
        if (err.code === '23505') {
          return res.status(409).json({ error: 'Un brief existe déjà pour cette saison' });
        }
        return res.status(500).json({ error: err.message });
      }
      const id = result?.rows?.[0]?.id || this?.lastID;
      res.status(201).json({ id, message: 'Brief créé' });
    }
  );
});

// PUT /brief/:id — update existing brief
router.put('/brief/:id', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.params.id, 10);
  const {
    qualif_day,
    final_day,
    first_weekend,
    blackout_dates,
    active_categories,
    active_hosts,
    final_attribution,
    status
  } = req.body;

  db.run(
    `UPDATE calendar_brief
     SET qualif_day = COALESCE($1, qualif_day),
         final_day = COALESCE($2, final_day),
         first_weekend = COALESCE($3, first_weekend),
         blackout_dates = COALESCE($4::jsonb, blackout_dates),
         active_categories = COALESCE($5::jsonb, active_categories),
         active_hosts = COALESCE($6::jsonb, active_hosts),
         final_attribution = COALESCE($7, final_attribution),
         status = COALESCE($8, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $9 AND organization_id = $10`,
    [
      qualif_day || null,
      final_day || null,
      first_weekend || null,
      blackout_dates ? JSON.stringify(blackout_dates) : null,
      active_categories ? JSON.stringify(active_categories) : null,
      active_hosts ? JSON.stringify(active_hosts) : null,
      final_attribution || null,
      status || null,
      briefId,
      orgId
    ],
    function(err) {
      if (err) {
        console.error('[calendar-generator] PUT /brief error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Brief mis à jour' });
    }
  );
});

// DELETE /brief/:id — delete a brief (cascade deletes drafts and sync logs)
router.delete('/brief/:id', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.params.id, 10);

  db.run(
    `DELETE FROM calendar_brief WHERE id = $1 AND organization_id = $2`,
    [briefId, orgId],
    function(err) {
      if (err) {
        console.error('[calendar-generator] DELETE /brief error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Brief supprimé' });
    }
  );
});

// ----------------------------------------------------------------
// Dates des finales de ligue
// ----------------------------------------------------------------

// GET /ligue-finals?season=2026-2027 — list ligue final dates for a season
router.get('/ligue-finals', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const { season } = req.query;

  if (!season) return res.status(400).json({ error: 'season query parameter required' });

  db.all(
    `SELECT lfd.id, lfd.season, lfd.category_id, lfd.final_date,
            c.game_type AS mode, c.level, c.display_name AS category_name
     FROM ligue_final_dates lfd
     JOIN categories c ON c.id = lfd.category_id
     WHERE lfd.organization_id = $1 AND lfd.season = $2
     ORDER BY lfd.final_date ASC`,
    [orgId, season],
    (err, rows) => {
      if (err) {
        console.error('[calendar-generator] GET /ligue-finals error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// POST /ligue-finals — bulk replace ligue final dates for a season
// Body: { season: "2026-2027", entries: [{ category_id, final_date }, ...] }
router.post('/ligue-finals', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const { season, entries } = req.body;

  if (!season || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'Missing season or entries array' });
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM ligue_final_dates WHERE organization_id = $1 AND season = $2`,
        [orgId, season],
        (err) => err ? reject(err) : resolve()
      );
    });

    for (const entry of entries) {
      if (!entry.category_id || !entry.final_date) continue;
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ligue_final_dates (organization_id, season, category_id, final_date)
           VALUES ($1, $2, $3, $4)`,
          [orgId, season, entry.category_id, entry.final_date],
          (err) => err ? reject(err) : resolve()
        );
      });
    }

    res.json({ message: 'Dates des finales de ligue enregistrées', count: entries.length });
  } catch (err) {
    console.error('[calendar-generator] POST /ligue-finals error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /ligue-finals/:id
router.delete('/ligue-finals/:id', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const id = parseInt(req.params.id, 10);

  db.run(
    `DELETE FROM ligue_final_dates WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
    function(err) {
      if (err) {
        console.error('[calendar-generator] DELETE /ligue-finals error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Date supprimée' });
    }
  );
});

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

// GET /reference-data — convenience endpoint returning categories + clubs + tournament types
// Used by the Step 1 UI to populate dropdowns/checkboxes
router.get('/reference-data', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;

  Promise.all([
    new Promise((resolve, reject) => {
      db.all(
        `SELECT id, game_type AS mode, level, display_name AS name
         FROM categories
         WHERE organization_id = $1 OR organization_id IS NULL
         ORDER BY game_type, level`,
        [orgId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    }),
    new Promise((resolve, reject) => {
      db.all(
        `SELECT id, display_name, city, preferred_start_time FROM clubs WHERE organization_id = $1 ORDER BY display_name`,
        [orgId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    })
  ])
    .then(([categories, clubs]) => res.json({ categories, clubs }))
    .catch(err => {
      console.error('[calendar-generator] GET /reference-data error:', err);
      res.status(500).json({ error: err.message });
    });
});

// ----------------------------------------------------------------
// Club preferred start time (inline edit from Step 1)
// ----------------------------------------------------------------

// PATCH /clubs/:id/start-time — update a club's preferred_start_time
// Body: { value: 'morning' | 'afternoon' | 'full_day' | null }
router.patch('/clubs/:id/start-time', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const clubId = parseInt(req.params.id, 10);
  const { value } = req.body;

  const allowed = ['morning', 'afternoon', 'full_day', null, ''];
  if (!allowed.includes(value)) {
    return res.status(400).json({ error: 'Invalid value (allowed: morning, afternoon, full_day, null)' });
  }

  db.run(
    `UPDATE clubs SET preferred_start_time = $1 WHERE id = $2 AND organization_id = $3`,
    [value || null, clubId, orgId],
    function(err) {
      if (err) {
        console.error('[calendar-generator] PATCH /clubs/:id/start-time error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Préférence horaire enregistrée' });
    }
  );
});

module.exports = router;
