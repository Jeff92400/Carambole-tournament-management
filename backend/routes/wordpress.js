const express = require('express');
const { authenticateToken } = require('./auth');
const appSettings = require('../utils/app-settings');
const { logAdminAction, ACTION_TYPES } = require('../utils/admin-logger');

const router = express.Router();

// ─── Helper: Build WP Authorization header ───────────────────────────────────
function wpAuthHeader(username, appPassword) {
  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
  return `Basic ${credentials}`;
}

// ─── Helper: Call WordPress REST API ──────────────────────────────────────────
async function wpFetch(siteUrl, path, { method = 'GET', body, username, appPassword } = {}) {
  const url = `${siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2${path}`;
  const headers = {
    'Authorization': wpAuthHeader(username, appPassword),
    'Content-Type': 'application/json',
    'User-Agent': 'CaramboleTournamentApp/1.0'
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data?.message || data?.code || `HTTP ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.wpCode = data?.code;
    throw error;
  }

  return data;
}

// ─── Helper: Get WP settings for an org ───────────────────────────────────────
async function getWpSettings(orgId) {
  const keys = ['wp_site_url', 'wp_username', 'wp_app_password', 'wp_default_status', 'wp_enabled'];
  const settings = await appSettings.getOrgSettingsBatch(orgId, keys);
  return {
    siteUrl: settings.wp_site_url || '',
    username: settings.wp_username || '',
    appPassword: settings.wp_app_password || '',
    defaultStatus: settings.wp_default_status || 'draft',
    enabled: settings.wp_enabled === 'true'
  };
}

// ─── Helper: Find or create a WP category ─────────────────────────────────────
async function findOrCreateCategory(siteUrl, username, appPassword, slug, name, parentId) {
  const params = new URLSearchParams({ slug, per_page: '1' });
  const existing = await wpFetch(siteUrl, `/categories?${params}`, { username, appPassword });

  if (existing.length > 0) {
    return existing[0];
  }

  // Create category
  const body = { name, slug };
  if (parentId) body.parent = parentId;
  return wpFetch(siteUrl, '/categories', { method: 'POST', body, username, appPassword });
}

// ─── Helper: Build season category hierarchy ──────────────────────────────────
// Creates: "2025-2026" (parent) > "Convocations 2025-2026" (child)
async function getOrCreateSeasonCategory(siteUrl, username, appPassword, season, type) {
  // Parent category: the season itself (e.g., "2025-2026")
  const seasonSlug = season.replace(/\s/g, '-').toLowerCase();
  const parentCat = await findOrCreateCategory(siteUrl, username, appPassword, seasonSlug, season);

  // Child category: e.g., "Convocations 2025-2026"
  const typeLabels = {
    convocations: 'Convocations',
    resultats: 'Résultats'
  };
  const label = typeLabels[type] || type;
  const childName = `${label} ${season}`;
  const childSlug = `${type}-${seasonSlug}`;
  return findOrCreateCategory(siteUrl, username, appPassword, childSlug, childName, parentCat.id);
}

// ─── Helper: Generate convocation HTML content ────────────────────────────────
function buildConvocationHtml({ tournament, poules, locations, gameParams, specialNote, publicPageUrl }) {
  const parts = [];

  // Header info
  const date = tournament.date || '';
  const categoryName = tournament.categoryName || '';
  const tournamentLabel = tournament.label || '';

  parts.push(`<p><strong>${categoryName} — ${tournamentLabel}</strong></p>`);

  // Location(s)
  if (locations && locations.length > 0) {
    for (const loc of locations) {
      const locParts = [loc.name];
      if (loc.street) locParts.push(loc.street);
      if (loc.zip_code && loc.city) locParts.push(`${loc.zip_code} ${loc.city}`);
      else if (loc.city) locParts.push(loc.city);

      const timeStr = loc.startTime ? ` à ${loc.startTime}` : '';
      const locLabel = locations.length > 1 ? ` (Lieu ${loc.locationNum || ''})` : '';
      parts.push(`<p>📍 ${locParts.join(', ')}${locLabel}${timeStr ? ` — ⏰ ${timeStr}` : ''}</p>`);
    }
  }

  // Game parameters
  if (gameParams) {
    const paramParts = [];
    if (gameParams.distance) paramParts.push(`Distance : ${gameParams.distance} pts`);
    if (gameParams.reprises) paramParts.push(`Reprises : ${gameParams.reprises}`);
    if (paramParts.length > 0) {
      parts.push(`<p>🎯 ${paramParts.join(' | ')}</p>`);
    }
  }

  // Special note
  if (specialNote) {
    parts.push(`<div style="background: #fff3cd; padding: 10px 15px; border-left: 4px solid #ffc107; margin: 15px 0;"><strong>ℹ️ Note :</strong> ${specialNote}</div>`);
  }

  parts.push('<hr>');

  // Poules
  if (poules && poules.length > 0) {
    for (const poule of poules) {
      const pouleNum = poule.number || poule.pouleNumber || '';
      parts.push(`<h3>Poule ${pouleNum}</h3>`);

      if (poule.players && poule.players.length > 0) {
        parts.push('<table style="border-collapse: collapse; width: 100%; margin-bottom: 15px;">');
        parts.push('<thead><tr style="background: #f0f0f0;">');
        parts.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Joueur</th>');
        parts.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Club</th>');
        parts.push('</tr></thead><tbody>');

        for (const player of poule.players) {
          const name = `${player.last_name || ''} ${player.first_name || ''}`.trim();
          const club = player.club || '';
          parts.push(`<tr><td style="padding: 8px; border: 1px solid #ddd;">${name}</td>`);
          parts.push(`<td style="padding: 8px; border: 1px solid #ddd;">${club}</td></tr>`);
        }

        parts.push('</tbody></table>');
      }
    }
  }

  // Link to public page
  if (publicPageUrl) {
    parts.push(`<p>👉 <a href="${publicPageUrl}">Voir les détails sur la plateforme</a></p>`);
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Test WordPress connection ────────────────────────────────────────────────
router.post('/test-connection', authenticateToken, async (req, res) => {
  const orgId = req.user.organizationId || null;

  try {
    const wp = await getWpSettings(orgId);

    if (!wp.siteUrl || !wp.username || !wp.appPassword) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète. Renseignez l\'URL, l\'identifiant et le mot de passe application.' });
    }

    // Test by fetching current user info
    const user = await wpFetch(wp.siteUrl, '/users/me', { username: wp.username, appPassword: wp.appPassword });

    // Also test category listing to verify permissions
    await wpFetch(wp.siteUrl, '/categories?per_page=1', { username: wp.username, appPassword: wp.appPassword });

    res.json({
      success: true,
      message: `Connexion réussie ! Connecté en tant que "${user.name}" sur ${wp.siteUrl}`,
      user: { name: user.name, slug: user.slug }
    });
  } catch (error) {
    console.error('[WordPress] Connection test failed:', error.message);
    let msg = 'Échec de la connexion WordPress.';
    if (error.status === 401 || error.status === 403) {
      msg += ' Identifiants invalides ou permissions insuffisantes.';
    } else if (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND')) {
      msg += ' URL du site introuvable.';
    } else {
      msg += ` ${error.message}`;
    }
    res.status(400).json({ error: msg });
  }
});

// ─── List WordPress categories ────────────────────────────────────────────────
router.get('/categories', authenticateToken, async (req, res) => {
  const orgId = req.user.organizationId || null;

  try {
    const wp = await getWpSettings(orgId);
    if (!wp.siteUrl || !wp.username || !wp.appPassword) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète.' });
    }

    const categories = await wpFetch(wp.siteUrl, '/categories?per_page=100', { username: wp.username, appPassword: wp.appPassword });

    res.json(categories.map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent: c.parent,
      count: c.count
    })));
  } catch (error) {
    console.error('[WordPress] Failed to list categories:', error.message);
    res.status(500).json({ error: 'Erreur lors de la récupération des catégories WordPress.' });
  }
});

// ─── Publish convocation to WordPress ─────────────────────────────────────────
router.post('/publish-convocation', authenticateToken, async (req, res) => {
  const db = require('../db-loader');
  const orgId = req.user.organizationId || null;

  try {
    const wp = await getWpSettings(orgId);

    if (!wp.enabled) {
      return res.status(400).json({ error: 'Publication WordPress désactivée. Activez-la dans Paramètres > Site Web.' });
    }
    if (!wp.siteUrl || !wp.username || !wp.appPassword) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète.' });
    }

    const { tournoiId, tournament, poules, locations, gameParams, specialNote, season } = req.body;

    if (!tournoiId || !tournament || !poules || !season) {
      return res.status(400).json({ error: 'Données de convocation manquantes (tournoiId, tournament, poules, season requis).' });
    }

    // Build public page URL
    const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
    // Fetch org slug
    const org = await new Promise((resolve, reject) => {
      db.get('SELECT slug FROM organizations WHERE id = $1', [orgId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    const orgSlug = org?.slug || 'cdbhs';
    const publicPageUrl = `${baseUrl}/public/${orgSlug}/tournament/${tournoiId}`;

    // Build HTML content
    const htmlContent = buildConvocationHtml({
      tournament,
      poules,
      locations,
      gameParams,
      specialNote,
      publicPageUrl
    });

    // Find or create the season category
    const category = await getOrCreateSeasonCategory(
      wp.siteUrl, wp.username, wp.appPassword,
      season, 'convocations'
    );

    // Build post title
    const dateStr = tournament.date || '';
    const title = `Convocation — ${tournament.categoryName || ''} ${tournament.label || ''} — ${dateStr}`.trim();

    // Check if we already published for this tournament (wp_post_id)
    const existingPost = await new Promise((resolve, reject) => {
      db.get(
        'SELECT wp_post_id FROM tournoi_ext WHERE tournoi_id = $1',
        [tournoiId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    let wpPost;
    let isUpdate = false;

    if (existingPost?.wp_post_id) {
      // Update existing post
      isUpdate = true;
      const now = new Date();
      const updateNote = `<div style="background: #d4edda; padding: 8px 12px; border-left: 4px solid #28a745; margin-bottom: 15px;"><strong>🔄 Mise à jour du ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>`;

      wpPost = await wpFetch(wp.siteUrl, `/posts/${existingPost.wp_post_id}`, {
        method: 'PUT',
        body: {
          title,
          content: updateNote + htmlContent,
          categories: [category.id],
          status: wp.defaultStatus
        },
        username: wp.username,
        appPassword: wp.appPassword
      });
    } else {
      // Create new post
      wpPost = await wpFetch(wp.siteUrl, '/posts', {
        method: 'POST',
        body: {
          title,
          content: htmlContent,
          categories: [category.id],
          status: wp.defaultStatus
        },
        username: wp.username,
        appPassword: wp.appPassword
      });

      // Store the WP post ID in tournoi_ext
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE tournoi_ext SET wp_post_id = $1 WHERE tournoi_id = $2',
          [wpPost.id, tournoiId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // Log the action
    logAdminAction({
      req,
      action: ACTION_TYPES.PUBLISH_WEBSITE || 'publish_website',
      details: `${isUpdate ? 'Mise à jour' : 'Publication'} WordPress: ${title}`,
      targetType: 'tournament',
      targetId: tournoiId,
      targetName: title
    });

    res.json({
      success: true,
      isUpdate,
      postId: wpPost.id,
      postUrl: wpPost.link || `${wp.siteUrl}/?p=${wpPost.id}`,
      message: isUpdate
        ? 'Article WordPress mis à jour avec succès.'
        : 'Article publié sur WordPress avec succès.'
    });

  } catch (error) {
    console.error('[WordPress] Publish convocation failed:', error.message);

    let msg = 'Échec de la publication WordPress.';
    if (error.status === 401 || error.status === 403) {
      msg += ' Identifiants invalides ou permissions insuffisantes.';
    } else {
      msg += ` ${error.message}`;
    }

    res.status(500).json({ error: msg });
  }
});

// ─── Get publish status for a tournament ──────────────────────────────────────
router.get('/status/:tournoiId', authenticateToken, async (req, res) => {
  const db = require('../db-loader');
  const tournoiId = req.params.tournoiId;

  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        'SELECT wp_post_id FROM tournoi_ext WHERE tournoi_id = $1',
        [tournoiId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    res.json({
      published: !!row?.wp_post_id,
      wpPostId: row?.wp_post_id || null
    });
  } catch (error) {
    console.error('[WordPress] Status check failed:', error.message);
    res.status(500).json({ error: 'Erreur lors de la vérification du statut.' });
  }
});

module.exports = router;
