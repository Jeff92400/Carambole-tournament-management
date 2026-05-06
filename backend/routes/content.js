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
              p.attachments, p.external_url,
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
      related_page_ids = [],
      // V 2.0.734 (Phase 2) — optional external URL (e.g. cdbhs.fr counterpart).
      external_url = null,
      // V 2.0.734 (Phase 2) — admin opted into broadcasting a push notif
      // when this article is published. Ignored on draft saves.
      notify_push = false
    } = req.body || {};

    // Validate external_url: must be https or null. Reject everything else
    // so we never end up with javascript: or http: links rendered in the
    // Player App "Lire la suite" CTA. Empty string is normalized to null.
    if (external_url !== null && external_url !== undefined) {
      const trimmed = String(external_url).trim();
      if (trimmed === '') {
        external_url = null;
      } else if (!/^https:\/\//i.test(trimmed) || trimmed.length > 500) {
        return res.status(400).json({
          error: 'Lien externe invalide. URLs en https:// uniquement, max 500 caractères.'
        });
      } else {
        external_url = trimmed;
      }
    }

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
          published_at, cover_image, external_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, section_id, title, excerpt, content_type, status,
                 is_featured, is_pinned, published_at, created_at, updated_at,
                 external_url`,
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
        cover_image,
        external_url
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

    // V 2.0.734 (Phase 2) — Fire-and-forget push to all subscribed players
    // when the admin opted in AND the article is published right away.
    // Drafts never trigger pushes (saved for later, no audience yet).
    if (notify_push && status === 'published') {
      maybeBroadcastArticleNotification(created, excerpt, orgId).catch(err => {
        console.error('[content] broadcast push (POST) failed:', err.message);
      });
    } else if (status === 'published' && content_type === 'resultat') {
      // V 2.0.274 (Phase 3 Étape E) — Even without notify_push, a result
      // article still pushes to players who flipped the per-player opt-in
      // in their Profil. Skipped automatically when notify_push is true
      // (the broadcast above already covered everyone).
      maybeBroadcastResultArticleToOptedIn(created, excerpt, orgId).catch(err => {
        console.error('[content] broadcast results-optin (POST) failed:', err.message);
      });
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
      related_page_ids,
      // V 2.0.734 (Phase 2) — external URL (cdbhs.fr counterpart, etc.)
      external_url,
      // V 2.0.734 (Phase 2) — admin opted into broadcasting a push notif
      // on this update. Only fires when the article reaches 'published'.
      notify_push = false
    } = req.body || {};

    if (content_type && !VALID_CONTENT_TYPES.includes(content_type)) {
      return res.status(400).json({ error: 'Type de contenu invalide' });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }
    // Validate external_url. Same rules as POST: https only, max 500 chars,
    // empty string normalized to null. undefined = "leave existing column
    // value untouched", null/'' = "clear the link".
    let normalizedExternalUrl;
    if (external_url !== undefined) {
      if (external_url === null || String(external_url).trim() === '') {
        normalizedExternalUrl = null;
      } else {
        const trimmed = String(external_url).trim();
        if (!/^https:\/\//i.test(trimmed) || trimmed.length > 500) {
          return res.status(400).json({
            error: 'Lien externe invalide. URLs en https:// uniquement, max 500 caractères.'
          });
        }
        normalizedExternalUrl = trimmed;
      }
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
    if (external_url !== undefined) { sets.push(`external_url = $${idx++}`); params.push(normalizedExternalUrl); }
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
              is_featured, is_pinned, published_at, created_at, updated_at,
              external_url
         FROM content_pages WHERE id = $1`,
      [id]
    );

    // V 2.0.734 (Phase 2) — Fire push notification only when the admin
    // opted in AND this update transitions the article TO 'published'
    // (or republishes it after edits). Edits to an already-published
    // article also re-fire when the admin re-checks the box, allowing
    // a "resend notification" workflow if needed.
    if (notify_push && updated.status === 'published') {
      maybeBroadcastArticleNotification(updated, updated.excerpt, orgId).catch(err => {
        console.error('[content] broadcast push (PUT) failed:', err.message);
      });
    } else if (
      updated.status === 'published' &&
      updated.content_type === 'resultat' &&
      existing.status !== 'published'
    ) {
      // V 2.0.274 (Phase 3 Étape E) — Result article transitioning to
      // published without notify_push: fire push only to the opted-in
      // subset. The `existing.status !== 'published'` guard avoids
      // re-pushing on subsequent edits of an already-published article.
      maybeBroadcastResultArticleToOptedIn(updated, updated.excerpt, orgId).catch(err => {
        console.error('[content] broadcast results-optin (PUT) failed:', err.message);
      });
    }

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

    // V 2.0.589 — If the client passes attachments in the request body,
    // persist them alongside the regenerate so unsaved photo uploads
    // are not lost when the admin clicks Régénérer instead of Publier.
    const hasAttachments = req.body && Array.isArray(req.body.attachments);
    const attachmentsJson = hasAttachments ? JSON.stringify(req.body.attachments) : null;

    await dbRun(
      `UPDATE content_pages
          SET title = $1,
              excerpt = $2,
              content_html = $3,
              season = COALESCE($4, season),
              game_mode = COALESCE($5, game_mode),
              game_category = COALESCE($6, game_category),
              attachments = COALESCE($7::jsonb, attachments),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $8`,
      [rendered.title, rendered.excerpt, rendered.contentHtml, meta.season, meta.gameMode, meta.gameCategory, attachmentsJson, id]
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
// V 2.0.590 — Backfill route: re-organise existing auto-generated
// articles into mode-matching sub-folders within their current parent.
// Logic mirrors the live auto-publisher routing (Phase D, V 2.0.581):
//   - Only auto_generated articles are touched.
//   - Only articles whose current section has direct children are
//     candidates (the section is a "parent" with sub-folders).
//   - We compare the article's game_mode against each child's name with
//     case + space insensitive normalisation. First match wins.
//   - Manual articles or articles already in leaf folders are skipped.
//
// Idempotent: re-running it produces zero further moves.
router.post('/reroute-auto-articles', authenticateToken, requireContentEditor, async (req, res) => {
  try {
    const orgId = req.user.organizationId || null;
    const norm = s => (s || '').toUpperCase().replace(/\s+/g, '');

    // Pull all auto-generated articles with their current section_id and mode.
    const articles = await dbAll(
      `SELECT id, section_id, game_mode FROM content_pages
        WHERE auto_generated = TRUE
          AND game_mode IS NOT NULL
          AND ($1::int IS NULL OR organization_id = $1)`,
      [orgId]
    );

    // Cache children per parent section to avoid N+1 queries.
    const childrenCache = new Map();
    async function childrenOf(parentId) {
      if (childrenCache.has(parentId)) return childrenCache.get(parentId);
      const rows = await dbAll(
        `SELECT id, name FROM content_sections
          WHERE parent_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [parentId, orgId]
      );
      childrenCache.set(parentId, rows);
      return rows;
    }

    let moved = 0;
    const detail = [];
    for (const a of articles) {
      if (!a.section_id) continue;
      const children = await childrenOf(a.section_id);
      if (children.length === 0) continue; // leaf folder, leave alone
      const target = children.find(c => norm(c.name) === norm(a.game_mode));
      if (!target) continue;
      if (target.id === a.section_id) continue; // already correct (defensive)
      await dbRun(
        `UPDATE content_pages SET section_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [target.id, a.id]
      );
      moved++;
      detail.push({ id: a.id, mode: a.game_mode, into: target.name });
    }

    console.log(`[content] reroute-auto-articles org=${orgId} moved=${moved}`);
    res.json({ success: true, moved, total_candidates: articles.length, detail });
  } catch (err) {
    console.error('[content] reroute-auto-articles error:', err);
    res.status(500).json({ error: err.message });
  }
});

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

// V 2.0.734 (Phase 2) — Broadcast a push notification to every player in
// the org who has push enabled, using the CONTENT_ARTICLE_PUBLISHED
// template. Fire-and-forget — caller does NOT await this. Errors are
// swallowed (and logged) so they never fail the parent request.
//
// The deep-link URL uses the ?page=news&article=<id> convention from
// Phase 1c so a tap on the notification opens the article detail.
async function maybeBroadcastArticleNotification(article, excerpt, orgId) {
  try {
    if (!article || !article.id || !orgId) {
      console.log('[content broadcast] missing article id or orgId, skipping');
      return;
    }

    const { buildNotification } = require('../notification-messages');
    const { sendPushToPlayers } = require('./push');

    // Pull every push-subscribed licence in this org. Using the same query
    // as GET /api/push/subscribed-licences so the audience matches what the
    // admin sees in the bulk-send UI.
    const recipients = await dbAll(
      `SELECT DISTINCT pa.licence
         FROM player_accounts pa
         INNER JOIN push_subscriptions ps ON ps.player_account_id = pa.id
        WHERE ($1::int IS NULL OR pa.organization_id = $1)
          AND pa.push_enabled = true`,
      [orgId]
    );
    const licences = (recipients || []).map(r => r.licence).filter(Boolean);

    if (licences.length === 0) {
      console.log(`[content broadcast] no push-subscribed players for org ${orgId}, skipping`);
      return;
    }

    const notification = buildNotification('CONTENT_ARTICLE_PUBLISHED', {
      title: article.title,
      excerpt: excerpt || article.excerpt || null,
      articleId: article.id
    });

    const result = await sendPushToPlayers(licences, orgId, notification);
    console.log(
      `[content broadcast] article ${article.id} (org ${orgId}): ` +
      `pushed to ${result.total_sent}/${licences.length} player(s)`
    );
  } catch (err) {
    console.error('[content broadcast] error:', err.message);
    // Swallow — never fail the parent request because of a push issue.
  }
}

// V 2.0.274 (Phase 3 Étape E) — Broadcast push to the opted-in subset only.
// Used when an article of type 'resultat' is published WITHOUT the admin's
// notify_push flag — the broadcast matrix says "results don't notify by
// default", but engaged players who flipped push_results_optin = true in
// their Profil page do want the immediate notification. Fire-and-forget.
async function maybeBroadcastResultArticleToOptedIn(article, excerpt, orgId) {
  try {
    if (!article || !article.id || !orgId) return;

    const { buildNotification } = require('../notification-messages');
    const { sendPushToPlayers } = require('./push');

    // Same query as the standard broadcast, plus the opt-in filter. The
    // additional condition shrinks the audience to engaged players only.
    const recipients = await dbAll(
      `SELECT DISTINCT pa.licence
         FROM player_accounts pa
         INNER JOIN push_subscriptions ps ON ps.player_account_id = pa.id
        WHERE ($1::int IS NULL OR pa.organization_id = $1)
          AND pa.push_enabled = true
          AND pa.push_results_optin = true`,
      [orgId]
    );
    const licences = (recipients || []).map(r => r.licence).filter(Boolean);

    if (licences.length === 0) {
      console.log(
        `[content broadcast results-optin] no opted-in players for org ${orgId}, skipping`
      );
      return;
    }

    const notification = buildNotification('CONTENT_ARTICLE_PUBLISHED', {
      title: article.title,
      excerpt: excerpt || article.excerpt || null,
      articleId: article.id
    });

    const result = await sendPushToPlayers(licences, orgId, notification);
    console.log(
      `[content broadcast results-optin] article ${article.id} (org ${orgId}): ` +
      `pushed to ${result.total_sent}/${licences.length} opted-in player(s)`
    );
  } catch (err) {
    console.error('[content broadcast results-optin] error:', err.message);
  }
}

module.exports = router;
// V 2.0.274 (Phase 3 Étape E) — Expose the opted-in broadcaster so
// news-auto-publisher.js can fire it after auto-creating a 'resultat'
// article (CSV import path that bypasses the POST endpoint).
module.exports.maybeBroadcastResultArticleToOptedIn = maybeBroadcastResultArticleToOptedIn;
