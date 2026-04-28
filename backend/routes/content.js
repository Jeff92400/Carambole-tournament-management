// ============================================================
// Player App News / Communication Module — content routes
// CRUD for content_sections, content_pages, content_links
//
// All endpoints are org-scoped via req.user.organizationId.
// Admin-only for writes; reads still require authentication
// (the Player App has its own public read endpoint, mounted elsewhere).
//
// Created: April 2026 — for CDBs without a WordPress site
// ============================================================

const express = require('express');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

const getDb = () => require('../db-loader');

// ---------- Promise helpers around the db-loader callback API ----------
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

// Allowed values — kept in one place to avoid scattered literals
const VALID_CONTENT_TYPES = ['actualite', 'evenement', 'resultat', 'document'];
const VALID_STATUSES = ['draft', 'published'];

// ============================================================
// SECTIONS — hierarchical menu tree
// ============================================================

// GET /api/content/sections — list all sections for the current org (flat)
// Curated list of app pages a section can link to (Option B, V 2.0.560).
// Keep in sync with the dropdown in content-admin.html and the
// navigateToPage(...) targets in the Player App.
const VALID_LINK_TARGETS = [
  'tournaments', 'inscriptions', 'stats', 'calendar', 'profile', 'contact'
];
const VALID_LINK_TYPES = ['section', 'page'];

router.get('/sections', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const rows = await dbAll(
      `SELECT id, name, parent_id, sort_order, icon, link_type, link_target, created_at, updated_at
         FROM content_sections
        WHERE ($1::int IS NULL OR organization_id = $1)
        ORDER BY COALESCE(parent_id, 0), sort_order, name`,
      [orgId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[content] list sections error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/sections — create a section
router.post('/sections', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const {
      name, parent_id = null, sort_order = 0, icon = null,
      link_type = 'section', link_target = null
    } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Le nom de la section est requis' });
    }

    // If parent_id is provided, ensure it belongs to the same org
    if (parent_id) {
      const parent = await dbGet(
        `SELECT id FROM content_sections
          WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [parent_id, orgId]
      );
      if (!parent) {
        return res.status(400).json({ error: 'Section parente introuvable' });
      }
    }

    // Normalize icon: empty string → null, trim, cap at VARCHAR(8) limit.
    const iconValue = icon && String(icon).trim() ? String(icon).trim().slice(0, 8) : null;

    // Validate link_type / link_target. A 'page' section MUST have a
    // link_target from the curated list; a 'section' section MUST have
    // link_target = NULL (we ignore any submitted value).
    const lt = String(link_type || 'section').trim();
    if (!VALID_LINK_TYPES.includes(lt)) {
      return res.status(400).json({ error: `link_type invalide (autorisés : ${VALID_LINK_TYPES.join(', ')})` });
    }
    let ltVal = null;
    if (lt === 'page') {
      if (!link_target || !VALID_LINK_TARGETS.includes(String(link_target))) {
        return res.status(400).json({ error: `link_target requis et doit être l'un de : ${VALID_LINK_TARGETS.join(', ')}` });
      }
      ltVal = String(link_target);
    }

    const row = await dbGet(
      `INSERT INTO content_sections (organization_id, name, parent_id, sort_order, icon, link_type, link_target)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, parent_id, sort_order, icon, link_type, link_target, created_at, updated_at`,
      [orgId, String(name).trim(), parent_id, Number(sort_order) || 0, iconValue, lt, ltVal]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('[content] create section error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/content/sections/:id — update a section
router.put('/sections/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const id = parseInt(req.params.id, 10);
    const { name, parent_id, sort_order, icon, link_type, link_target } = req.body || {};

    // Ensure section belongs to the current org
    const existing = await dbGet(
      `SELECT id FROM content_sections
        WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [id, orgId]
    );
    if (!existing) return res.status(404).json({ error: 'Section introuvable' });

    // Prevent a section from being its own ancestor (simple self-check)
    if (parent_id && Number(parent_id) === id) {
      return res.status(400).json({ error: 'Une section ne peut pas être son propre parent' });
    }

    // Validate link_type / link_target if provided. We treat them as a
    // pair: if either is in the request body, both go through validation.
    let lt;       // resolved link_type ('section' / 'page' / undefined)
    let ltTarget; // resolved link_target string or null
    if (link_type !== undefined || link_target !== undefined) {
      lt = String(link_type ?? 'section').trim();
      if (!VALID_LINK_TYPES.includes(lt)) {
        return res.status(400).json({ error: `link_type invalide (autorisés : ${VALID_LINK_TYPES.join(', ')})` });
      }
      if (lt === 'page') {
        if (!link_target || !VALID_LINK_TARGETS.includes(String(link_target))) {
          return res.status(400).json({ error: `link_target requis et doit être l'un de : ${VALID_LINK_TARGETS.join(', ')}` });
        }
        ltTarget = String(link_target);
      } else {
        ltTarget = null; // 'section' → always clear the target
      }
    }

    // Build a dynamic UPDATE so we only touch columns actually provided.
    const sets = [];
    const params = [];
    let pi = 1;
    if (name !== undefined) { sets.push(`name = $${pi++}`); params.push(String(name).trim()); }
    if (parent_id !== undefined) { sets.push(`parent_id = $${pi++}`); params.push(parent_id); }
    if (sort_order !== undefined) { sets.push(`sort_order = $${pi++}`); params.push(Number(sort_order) || 0); }
    if (icon !== undefined) {
      if (icon === null || String(icon).trim() === '') {
        sets.push(`icon = NULL`);
      } else {
        sets.push(`icon = $${pi++}`);
        params.push(String(icon).trim().slice(0, 8));
      }
    }
    if (lt !== undefined) {
      sets.push(`link_type = $${pi++}`);
      params.push(lt);
      if (ltTarget === null) {
        sets.push(`link_target = NULL`);
      } else {
        sets.push(`link_target = $${pi++}`);
        params.push(ltTarget);
      }
    }
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    await dbRun(
      `UPDATE content_sections SET ${sets.join(', ')} WHERE id = $${pi}`,
      params
    );

    const row = await dbGet(
      `SELECT id, name, parent_id, sort_order, icon, link_type, link_target, created_at, updated_at
         FROM content_sections WHERE id = $1`,
      [id]
    );
    res.json(row);
  } catch (err) {
    console.error('[content] update section error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/content/sections/:id — delete a section
// Children are cascade-deleted (FK ON DELETE CASCADE).
// Articles in this section get section_id = NULL (FK ON DELETE SET NULL).
router.delete('/sections/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const id = parseInt(req.params.id, 10);

    const existing = await dbGet(
      `SELECT id FROM content_sections
        WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [id, orgId]
    );
    if (!existing) return res.status(404).json({ error: 'Section introuvable' });

    await dbRun(`DELETE FROM content_sections WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[content] delete section error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PAGES — articles
// ============================================================

// GET /api/content/pages — list articles (optional filters)
// Query params: status, section_id, content_type, featured, pinned
router.get('/pages', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const { status, section_id, content_type, featured, pinned } = req.query;

    const where = [`($1::int IS NULL OR p.organization_id = $1)`];
    const params = [orgId];
    let idx = 2;

    if (status) {
      where.push(`p.status = $${idx++}`);
      params.push(status);
    }
    if (section_id) {
      where.push(`p.section_id = $${idx++}`);
      params.push(parseInt(section_id, 10));
    }
    if (content_type) {
      where.push(`p.content_type = $${idx++}`);
      params.push(content_type);
    }
    if (featured === 'true') where.push(`p.is_featured = TRUE`);
    if (pinned === 'true') where.push(`p.is_pinned = TRUE`);

    const rows = await dbAll(
      `SELECT p.id, p.section_id, s.name AS section_name,
              p.title, p.excerpt, p.content_type, p.status,
              p.is_featured, p.is_pinned,
              p.author_user_id, u.username AS author_name,
              p.published_at, p.created_at, p.updated_at
         FROM content_pages p
         LEFT JOIN content_sections s ON s.id = p.section_id
         LEFT JOIN users u ON u.id = p.author_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.is_pinned DESC,
                 COALESCE(p.published_at, p.created_at) DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[content] list pages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content/pages/:id — fetch one article with body + linked articles
router.get('/pages/:id', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const id = parseInt(req.params.id, 10);

    const page = await dbGet(
      `SELECT p.id, p.section_id, s.name AS section_name,
              p.title, p.excerpt, p.content_html, p.content_type, p.status,
              p.is_featured, p.is_pinned, p.cover_image,
              p.author_user_id, u.username AS author_name,
              p.published_at, p.created_at, p.updated_at
         FROM content_pages p
         LEFT JOIN content_sections s ON s.id = p.section_id
         LEFT JOIN users u ON u.id = p.author_user_id
        WHERE p.id = $1
          AND ($2::int IS NULL OR p.organization_id = $2)`,
      [id, orgId]
    );
    if (!page) return res.status(404).json({ error: 'Article introuvable' });

    const relatedLinks = await dbAll(
      `SELECT cl.target_page_id AS id, tp.title, tp.excerpt, tp.content_type
         FROM content_links cl
         JOIN content_pages tp ON tp.id = cl.target_page_id
        WHERE cl.source_page_id = $1
          AND ($2::int IS NULL OR tp.organization_id = $2)`,
      [id, orgId]
    );

    page.related_links = relatedLinks;
    res.json(page);
  } catch (err) {
    console.error('[content] get page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/pages — create an article
router.post('/pages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const {
      section_id = null,
      title,
      content_html = '',
      excerpt = null,
      content_type = 'actualite',
      status = 'draft',
      is_featured = false,
      is_pinned = false,
      cover_image = null,
      related_page_ids = []
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Le titre est requis' });
    }
    if (!VALID_CONTENT_TYPES.includes(content_type)) {
      return res.status(400).json({ error: 'Type de contenu invalide' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const publishedAt = status === 'published' ? new Date() : null;

    const created = await dbGet(
      `INSERT INTO content_pages
         (organization_id, section_id, title, content_html, excerpt,
          content_type, status, is_featured, is_pinned, author_user_id,
          published_at, cover_image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, section_id, title, excerpt, content_type, status,
                 is_featured, is_pinned, published_at, created_at, updated_at`,
      [
        orgId,
        section_id,
        String(title).trim(),
        content_html,
        excerpt,
        content_type,
        status,
        !!is_featured,
        !!is_pinned,
        req.user.userId || null,
        publishedAt,
        cover_image
      ]
    );

    // Insert cross-links (if any). Only accept targets in the same org.
    if (Array.isArray(related_page_ids) && related_page_ids.length > 0) {
      for (const targetId of related_page_ids) {
        const target = await dbGet(
          `SELECT id FROM content_pages
            WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
          [targetId, orgId]
        );
        if (target) {
          await dbRun(
            `INSERT INTO content_links (source_page_id, target_page_id)
                  VALUES ($1, $2)
             ON CONFLICT (source_page_id, target_page_id) DO NOTHING`,
            [created.id, targetId]
          );
        }
      }
    }

    res.status(201).json(created);
  } catch (err) {
    console.error('[content] create page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/content/pages/:id — update an article
router.put('/pages/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const id = parseInt(req.params.id, 10);

    const existing = await dbGet(
      `SELECT id, status FROM content_pages
        WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [id, orgId]
    );
    if (!existing) return res.status(404).json({ error: 'Article introuvable' });

    const {
      section_id,
      title,
      content_html,
      excerpt,
      content_type,
      status,
      is_featured,
      is_pinned,
      cover_image,
      related_page_ids
    } = req.body || {};

    if (content_type && !VALID_CONTENT_TYPES.includes(content_type)) {
      return res.status(400).json({ error: 'Type de contenu invalide' });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    // If transitioning draft → published, stamp published_at
    let publishedAtExpr = 'published_at';
    const params = [];
    let idx = 1;

    const sets = [];
    if (section_id !== undefined) { sets.push(`section_id = $${idx++}`); params.push(section_id); }
    if (title !== undefined)      { sets.push(`title = $${idx++}`); params.push(String(title).trim()); }
    if (content_html !== undefined) { sets.push(`content_html = $${idx++}`); params.push(content_html); }
    if (excerpt !== undefined)    { sets.push(`excerpt = $${idx++}`); params.push(excerpt); }
    if (content_type !== undefined) { sets.push(`content_type = $${idx++}`); params.push(content_type); }
    if (status !== undefined) {
      sets.push(`status = $${idx++}`); params.push(status);
      if (status === 'published' && existing.status !== 'published') {
        publishedAtExpr = 'CURRENT_TIMESTAMP';
      }
    }
    if (is_featured !== undefined) { sets.push(`is_featured = $${idx++}`); params.push(!!is_featured); }
    if (is_pinned !== undefined)   { sets.push(`is_pinned = $${idx++}`); params.push(!!is_pinned); }
    if (cover_image !== undefined) { sets.push(`cover_image = $${idx++}`); params.push(cover_image); }

    sets.push(`published_at = ${publishedAtExpr}`);
    sets.push(`updated_at = CURRENT_TIMESTAMP`);

    params.push(id);
    await dbRun(
      `UPDATE content_pages SET ${sets.join(', ')} WHERE id = $${idx}`,
      params
    );

    // Replace cross-links if provided
    if (Array.isArray(related_page_ids)) {
      await dbRun(`DELETE FROM content_links WHERE source_page_id = $1`, [id]);
      for (const targetId of related_page_ids) {
        const target = await dbGet(
          `SELECT id FROM content_pages
            WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
          [targetId, orgId]
        );
        if (target) {
          await dbRun(
            `INSERT INTO content_links (source_page_id, target_page_id)
                  VALUES ($1, $2)
             ON CONFLICT (source_page_id, target_page_id) DO NOTHING`,
            [id, targetId]
          );
        }
      }
    }

    const updated = await dbGet(
      `SELECT id, section_id, title, excerpt, content_type, status,
              is_featured, is_pinned, published_at, created_at, updated_at
         FROM content_pages WHERE id = $1`,
      [id]
    );
    res.json(updated);
  } catch (err) {
    console.error('[content] update page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/content/pages/:id — delete an article (and its cross-links)
router.delete('/pages/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const id = parseInt(req.params.id, 10);

    const existing = await dbGet(
      `SELECT id FROM content_pages
        WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [id, orgId]
    );
    if (!existing) return res.status(404).json({ error: 'Article introuvable' });

    // content_links have ON DELETE CASCADE, so they clean up automatically
    await dbRun(`DELETE FROM content_pages WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[content] delete page error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
