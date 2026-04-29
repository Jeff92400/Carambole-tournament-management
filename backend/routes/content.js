// ============================================================
// Player App News / Communication Module — content routes
// CRUD for content_sections, content_pages, content_links
//
// All endpoints are org-scoped via req.user.organizationId.
// Admin + viewer can write (V 2.0.576+); reads still require authentication
// (the Player App has its own public read endpoint, mounted elsewhere).
//
// Created: April 2026 — for CDBs without a WordPress site
// ============================================================

const express = require('express');
// V 2.0.576 — requireContentEditor allows admin + viewer to manage
// articles. A future per-CDB setting will replace the hardcoded role
// list (spawn-task: per-CDB article publication rights config).
const { authenticateToken, requireAdmin, requireContentEditor } = require('./auth');

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
router.post('/sections', authenticateToken, requireContentEditor, async (req, res) => {
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
router.put('/sections/:id', authenticateToken, requireContentEditor, async (req, res) => {
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
router.delete('/sections/:id', authenticateToken, requireContentEditor, async (req, res) => {
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
    // V 2.0.581 — New filters: season, mode, category, archived. NULL
    // values in those columns mean "always visible" so manual articles
    // are never filtered out.
    const {
      status, section_id, content_type, featured, pinned,
      season, game_mode, game_category, archived
    } = req.query;

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

    // Season / mode / category — NULL columns are kept (manual articles).
    if (season) {
      where.push(`(p.season IS NULL OR p.season = $${idx++})`);
      params.push(season);
    }
    if (game_mode) {
      where.push(`(p.game_mode IS NULL OR p.game_mode = $${idx++})`);
      params.push(game_mode);
    }
    if (game_category) {
      where.push(`(p.game_category IS NULL OR p.game_category = $${idx++})`);
      params.push(game_category);
    }
    // Archived: default false. Pass archived=true to include archived
    // articles, archived=only to fetch only archived.
    if (archived === 'only') {
      where.push(`p.archived = TRUE`);
    } else if (archived !== 'true') {
      where.push(`(p.archived IS NULL OR p.archived = FALSE)`);
    }

    const rows = await dbAll(
      `SELECT p.id, p.section_id, s.name AS section_name, s.icon AS section_icon,
              p.title, p.excerpt, p.content_type, p.status,
              p.is_featured, p.is_pinned,
              p.auto_generated, p.source_type,
              p.season, p.game_mode, p.game_category, p.archived,
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
              p.auto_generated, p.source_type, p.source_ref_id,
              p.attachments,
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

// V 2.0.561 — Resolve a fallback section_id for an org when an article
// is created without one. Returns the lowest-id existing section. The
// startup migration in db-postgres.js seeds "Général" for orgs that
// have zero sections, so this normally finds at least one.
async function resolveFallbackSectionId(orgId) {
  const row = await dbGet(
    `SELECT id FROM content_sections
      WHERE ($1::int IS NULL OR organization_id = $1)
      ORDER BY id ASC LIMIT 1`,
    [orgId]
  );
  return row ? row.id : null;
}

// POST /api/content/pages — create an article
router.post('/pages', authenticateToken, requireContentEditor, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    let {
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

    // V 2.0.561 — Every article must land in a folder. If the caller
    // didn't pick one (older API clients, auto-publisher with no
    // mapping), route to the org's first section (typically "Général").
    if (!section_id) {
      section_id = await resolveFallbackSectionId(orgId);
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
router.put('/pages/:id', authenticateToken, requireContentEditor, async (req, res) => {
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
    // V 2.0.582 — Attachments stored as JSONB. Accept arrays only;
    // anything else gets coerced to an empty array. Each entry must
    // have label + filename + content_type + data_base64.
    if (req.body && req.body.attachments !== undefined) {
      const arr = Array.isArray(req.body.attachments) ? req.body.attachments : [];
      sets.push(`attachments = $${idx++}::jsonb`);
      params.push(JSON.stringify(arr));
    }

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

// V 2.0.564 — POST /api/content/pages/:id/regenerate
// Re-runs the auto-publisher template against the live data of the
// underlying source (tournament for RESULTS) and overwrites the
// article body/title/excerpt. Useful when admins:
//   1) want to refresh an existing auto-article after tweaking the
//      template (e.g., V 2.0.563 added the season ranking table —
//      pre-existing articles need a regenerate to pick it up)
//   2) want to "preview" the new template without re-importing
// Only auto-generated RESULTS articles are supported for now; extend
// to FINALE_QUALIFICATION + NEW_TOURNAMENT when admins ask for it.
router.post('/pages/:id/regenerate', authenticateToken, requireContentEditor, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const id = parseInt(req.params.id, 10);

    const page = await dbGet(
      `SELECT id, auto_generated, source_type, source_ref_id, organization_id, status
         FROM content_pages
        WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
      [id, orgId]
    );
    if (!page) return res.status(404).json({ error: 'Article introuvable' });
    if (!page.auto_generated) {
      return res.status(400).json({
        error: 'Cet article n\'est pas auto-généré et ne peut pas être régénéré automatiquement.'
      });
    }
    if (page.source_type !== 'RESULTS') {
      return res.status(400).json({
        error: `Régénération non encore supportée pour le type "${page.source_type}".`
      });
    }
    if (!page.source_ref_id) {
      return res.status(400).json({ error: 'source_ref_id manquant — impossible de régénérer.' });
    }

    const { renderResultsArticleForTournament, fetchEventFilterMetadata } = require('../utils/news-auto-publisher');
    const rendered = await renderResultsArticleForTournament(orgId, page.source_ref_id);
    // V 2.0.581 — Backfill filter metadata when regenerating, so older
    // articles get season/mode/category populated as soon as the admin
    // touches Régénérer.
    const meta = await fetchEventFilterMetadata(page.source_type, page.source_ref_id);

    await dbRun(
      `UPDATE content_pages
          SET title = $1,
              excerpt = $2,
              content_html = $3,
              season = COALESCE($4, season),
              game_mode = COALESCE($5, game_mode),
              game_category = COALESCE($6, game_category),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $7`,
      [rendered.title, rendered.excerpt, rendered.contentHtml, meta.season, meta.gameMode, meta.gameCategory, id]
    );

    res.json({
      success: true,
      title: rendered.title,
      excerpt: rendered.excerpt,
      content_html: rendered.contentHtml
    });
  } catch (err) {
    console.error('[content] regenerate page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/content/pages/:id — delete an article (and its cross-links)
router.delete('/pages/:id', authenticateToken, requireContentEditor, async (req, res) => {
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
