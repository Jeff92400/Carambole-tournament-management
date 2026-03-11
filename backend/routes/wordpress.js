const express = require('express');
const { authenticateToken } = require('./auth');
const appSettings = require('../utils/app-settings');
const { logAdminAction, ACTION_TYPES } = require('../utils/admin-logger');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// WordPress XML-RPC Client
// The REST API on cdbhs.net is locked by a security plugin.
// XML-RPC (xmlrpc.php) is available and supports posts + categories.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helper: Build XML-RPC request body ───────────────────────────────────────
function xmlrpcCall(method, params) {
  const escapeXml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function toXmlValue(val) {
    if (val === null || val === undefined) return '<string></string>';
    if (typeof val === 'boolean') return `<boolean>${val ? 1 : 0}</boolean>`;
    if (typeof val === 'number' && Number.isInteger(val)) return `<int>${val}</int>`;
    if (typeof val === 'number') return `<double>${val}</double>`;
    if (typeof val === 'string') return `<string>${escapeXml(val)}</string>`;
    if (Array.isArray(val)) {
      return '<array><data>' + val.map(v => `<value>${toXmlValue(v)}</value>`).join('') + '</data></array>';
    }
    if (typeof val === 'object') {
      const members = Object.entries(val).map(([k, v]) =>
        `<member><name>${escapeXml(k)}</name><value>${toXmlValue(v)}</value></member>`
      ).join('');
      return `<struct>${members}</struct>`;
    }
    return `<string>${escapeXml(String(val))}</string>`;
  }

  const paramsXml = params.map(p => `<param><value>${toXmlValue(p)}</value></param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${paramsXml}</params></methodCall>`;
}

// ─── Helper: Parse XML-RPC response ───────────────────────────────────────────
function parseXmlRpcResponse(xml) {
  // Check for fault
  const faultMatch = xml.match(/<fault>[\s\S]*?<string>([\s\S]*?)<\/string>/);
  if (faultMatch) {
    throw new Error(faultMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }

  // Simple recursive XML-RPC value parser
  function parseValue(str) {
    // String
    let m = str.match(/^<string>([\s\S]*?)<\/string>$/);
    if (m) return m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

    // Int
    m = str.match(/^<(?:int|i4)>([-\d]+)<\/(?:int|i4)>$/);
    if (m) return parseInt(m[1], 10);

    // Boolean
    m = str.match(/^<boolean>([01])<\/boolean>$/);
    if (m) return m[1] === '1';

    // Double
    m = str.match(/^<double>([\d.+-]+)<\/double>$/);
    if (m) return parseFloat(m[1]);

    // Array
    if (str.startsWith('<array>')) {
      const values = [];
      const valueRegex = /<value>([\s\S]*?)<\/value>/g;
      const dataContent = str.match(/<data>([\s\S]*?)<\/data>/);
      if (dataContent) {
        let vm;
        while ((vm = valueRegex.exec(dataContent[1])) !== null) {
          values.push(parseValue(vm[1].trim()));
        }
      }
      return values;
    }

    // Struct
    if (str.startsWith('<struct>')) {
      const obj = {};
      const memberRegex = /<member>\s*<name>([\s\S]*?)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g;
      let mm;
      while ((mm = memberRegex.exec(str)) !== null) {
        obj[mm[1].trim()] = parseValue(mm[2].trim());
      }
      return obj;
    }

    // Plain text (no type tag = string in XML-RPC)
    return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  // Extract the top-level value from params
  const paramMatch = xml.match(/<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>\s*<\/params>/);
  if (!paramMatch) {
    // Some responses wrap differently
    const valueMatch = xml.match(/<value>([\s\S]*?)<\/value>/);
    if (valueMatch) return parseValue(valueMatch[1].trim());
    throw new Error('Réponse XML-RPC invalide');
  }

  return parseValue(paramMatch[1].trim());
}

// ─── Helper: Call WordPress XML-RPC ───────────────────────────────────────────
async function wpXmlRpc(siteUrl, method, params) {
  const url = `${siteUrl.replace(/\/+$/, '')}/xmlrpc.php`;
  const body = xmlrpcCall(method, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'User-Agent': 'CaramboleTournamentApp/1.0'
    },
    body
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
  }

  return parseXmlRpcResponse(text);
}

// ─── Helper: Get WP settings for an org ───────────────────────────────────────
async function getWpSettings(orgId) {
  const keys = ['wp_site_url', 'wp_username', 'wp_app_password', 'wp_default_status', 'wp_enabled'];
  const settings = await appSettings.getOrgSettingsBatch(orgId, keys);
  return {
    siteUrl: settings.wp_site_url || '',
    username: settings.wp_username || '',
    password: settings.wp_app_password || '',
    defaultStatus: settings.wp_default_status || 'draft',
    enabled: settings.wp_enabled === 'true'
  };
}

// ─── Helper: Find a category by slug, or create it ────────────────────────────
async function findOrCreateCategory(siteUrl, username, password, slug, name, parentId) {
  // wp.getTerms(blog_id, username, password, taxonomy, filter)
  const terms = await wpXmlRpc(siteUrl, 'wp.getTerms', [
    0, username, password, 'category', { search: slug }
  ]);

  // Search for exact slug match
  if (Array.isArray(terms)) {
    const found = terms.find(t => t.slug === slug);
    if (found) return { id: parseInt(found.term_id, 10), name: found.name, slug: found.slug };
  }

  // Create category: wp.newTerm(blog_id, username, password, content)
  const content = { name, taxonomy: 'category', slug };
  if (parentId) content.parent = parentId;
  const termId = await wpXmlRpc(siteUrl, 'wp.newTerm', [0, username, password, content]);

  return { id: parseInt(termId, 10), name, slug };
}

// ─── Helper: Build season category hierarchy ──────────────────────────────────
async function getOrCreateSeasonCategory(siteUrl, username, password, season, type) {
  const seasonSlug = season.replace(/\s/g, '-').toLowerCase();
  const parentCat = await findOrCreateCategory(siteUrl, username, password, seasonSlug, season);

  const typeLabels = { convocations: 'Convocations', resultats: 'Résultats' };
  const label = typeLabels[type] || type;
  const childName = `${label} ${season}`;
  const childSlug = `${type}-${seasonSlug}`;
  return findOrCreateCategory(siteUrl, username, password, childSlug, childName, parentCat.id);
}

// ─── Helper: Generate convocation HTML content ────────────────────────────────
function buildConvocationHtml({ tournament, poules, locations, gameParams, specialNote, publicPageUrl }) {
  const parts = [];

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

    if (!wp.siteUrl || !wp.username || !wp.password) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète. Renseignez l\'URL, l\'identifiant et le mot de passe.' });
    }

    // Test with wp.getUsersBlogs — simplest auth check
    const blogs = await wpXmlRpc(wp.siteUrl, 'wp.getUsersBlogs', [wp.username, wp.password]);

    if (!blogs || blogs.length === 0) {
      return res.status(400).json({ error: 'Connexion réussie mais aucun blog trouvé.' });
    }

    const blogName = blogs[0]?.blogName || blogs[0]?.blogname || wp.siteUrl;

    // Also test category access
    await wpXmlRpc(wp.siteUrl, 'wp.getTerms', [0, wp.username, wp.password, 'category', { number: 1 }]);

    res.json({
      success: true,
      message: `Connexion réussie ! Site : "${blogName}"`,
      blog: { name: blogName, url: blogs[0]?.url || wp.siteUrl }
    });
  } catch (error) {
    console.error('[WordPress] Connection test failed:', error.message);
    let msg = 'Échec de la connexion WordPress.';
    if (error.message.includes('Incorrect username or password') || error.message.includes('identifiant')) {
      msg += ' Identifiants invalides.';
    } else if (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND')) {
      msg += ' URL du site introuvable.';
    } else if (error.message.includes('XML-RPC services are disabled')) {
      msg += ' Les services XML-RPC sont désactivés sur ce site WordPress.';
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
    if (!wp.siteUrl || !wp.username || !wp.password) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète.' });
    }

    const terms = await wpXmlRpc(wp.siteUrl, 'wp.getTerms', [
      0, wp.username, wp.password, 'category', { number: 100 }
    ]);

    res.json((terms || []).map(t => ({
      id: parseInt(t.term_id, 10),
      name: t.name,
      slug: t.slug,
      parent: parseInt(t.parent || 0, 10),
      count: parseInt(t.count || 0, 10)
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
    if (!wp.siteUrl || !wp.username || !wp.password) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète.' });
    }

    const { tournoiId, tournament, poules, locations, gameParams, specialNote, season } = req.body;

    if (!tournoiId || !tournament || !poules || !season) {
      return res.status(400).json({ error: 'Données de convocation manquantes (tournoiId, tournament, poules, season requis).' });
    }

    // Build public page URL
    const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
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
      tournament, poules, locations, gameParams, specialNote, publicPageUrl
    });

    // Find or create the season category
    const category = await getOrCreateSeasonCategory(
      wp.siteUrl, wp.username, wp.password, season, 'convocations'
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

    let wpPostId;
    let isUpdate = false;
    let postUrl = '';

    if (existingPost?.wp_post_id) {
      // Update existing post: wp.editPost(blog_id, username, password, post_id, content)
      isUpdate = true;
      const now = new Date();
      const updateNote = `<div style="background: #d4edda; padding: 8px 12px; border-left: 4px solid #28a745; margin-bottom: 15px;"><strong>🔄 Mise à jour du ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>`;

      await wpXmlRpc(wp.siteUrl, 'wp.editPost', [
        0, wp.username, wp.password, existingPost.wp_post_id,
        {
          post_title: title,
          post_content: updateNote + htmlContent,
          terms: { category: [category.id] },
          post_status: wp.defaultStatus
        }
      ]);
      wpPostId = existingPost.wp_post_id;
      postUrl = `${wp.siteUrl}/?p=${wpPostId}`;
    } else {
      // Create new post: wp.newPost(blog_id, username, password, content)
      wpPostId = await wpXmlRpc(wp.siteUrl, 'wp.newPost', [
        0, wp.username, wp.password,
        {
          post_title: title,
          post_content: htmlContent,
          post_type: 'post',
          post_status: wp.defaultStatus,
          terms: { category: [category.id] }
        }
      ]);

      wpPostId = parseInt(wpPostId, 10);
      postUrl = `${wp.siteUrl}/?p=${wpPostId}`;

      // Store the WP post ID in tournoi_ext
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE tournoi_ext SET wp_post_id = $1 WHERE tournoi_id = $2',
          [wpPostId, tournoiId],
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
      postId: wpPostId,
      postUrl,
      message: isUpdate
        ? 'Article WordPress mis à jour avec succès.'
        : 'Article publié sur WordPress avec succès.'
    });

  } catch (error) {
    console.error('[WordPress] Publish convocation failed:', error.message);

    let msg = 'Échec de la publication WordPress.';
    if (error.message.includes('Incorrect username') || error.message.includes('identifiant')) {
      msg += ' Identifiants invalides.';
    } else {
      msg += ` ${error.message}`;
    }

    res.status(500).json({ error: msg });
  }
});

// ─── Publish from saved convocation data (no email send) ──────────────────────
router.post('/publish-from-saved/:tournoiId', authenticateToken, async (req, res) => {
  const db = require('../db-loader');
  const orgId = req.user.organizationId || null;
  const tournoiId = req.params.tournoiId;
  const { season } = req.body;

  try {
    const wp = await getWpSettings(orgId);

    if (!wp.enabled) {
      return res.status(400).json({ error: 'Publication WordPress désactivée.' });
    }
    if (!wp.siteUrl || !wp.username || !wp.password) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète.' });
    }

    // Fetch tournament info
    const tournament = await new Promise((resolve, reject) => {
      db.get(
        `SELECT tournoi_id, nom, mode, categorie, debut, lieu, lieu_2, wp_post_id, tournament_number
         FROM tournoi_ext WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [tournoiId, orgId],
        (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi introuvable.' });
    }

    // Fetch saved poules
    const pouleRows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT poule_number, player_name, club, location_name, location_address, start_time, player_order
         FROM convocation_poules WHERE tournoi_id = $1 ORDER BY poule_number, player_order`,
        [tournoiId],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    if (pouleRows.length === 0) {
      return res.status(400).json({ error: 'Aucune composition de poules sauvegardée pour ce tournoi. Envoyez d\'abord les convocations.' });
    }

    // Group into poules
    const poulesMap = {};
    for (const row of pouleRows) {
      if (!poulesMap[row.poule_number]) {
        poulesMap[row.poule_number] = {
          number: row.poule_number,
          players: []
        };
      }
      // Split player_name into last_name / first_name for the HTML builder
      const nameParts = (row.player_name || '').split(' ');
      poulesMap[row.poule_number].players.push({
        last_name: nameParts[0] || '',
        first_name: nameParts.slice(1).join(' ') || '',
        club: row.club || ''
      });
    }
    const poules = Object.values(poulesMap);

    // Build locations from poule data
    const locationSet = new Map();
    for (const row of pouleRows) {
      if (row.location_name && !locationSet.has(row.location_name)) {
        locationSet.set(row.location_name, {
          name: row.location_name,
          street: row.location_address || '',
          city: '',
          startTime: row.start_time || ''
        });
      }
    }
    const locations = Array.from(locationSet.values());

    // Fetch game params override
    const gameParams = await new Promise((resolve, reject) => {
      db.get(
        'SELECT distance, reprises FROM tournament_parameter_overrides WHERE tournoi_id = $1',
        [tournoiId],
        (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });

    // Build public page URL
    const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
    const org = await new Promise((resolve, reject) => {
      db.get('SELECT slug FROM organizations WHERE id = $1', [orgId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    const orgSlug = org?.slug || 'cdbhs';
    const publicPageUrl = `${baseUrl}/public/${orgSlug}/tournament/${tournoiId}`;

    // Format date
    const dateStr = tournament.debut
      ? new Date(tournament.debut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';

    const tournamentLabel = `T${tournament.tournament_number || ''}`;

    // Build HTML
    const htmlContent = buildConvocationHtml({
      tournament: { categoryName: tournament.categorie, label: tournamentLabel, date: dateStr },
      poules,
      locations,
      gameParams: gameParams || null,
      specialNote: null,
      publicPageUrl
    });

    // Determine season
    const effectiveSeason = season || (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
    })();

    // Find or create category
    const category = await getOrCreateSeasonCategory(
      wp.siteUrl, wp.username, wp.password, effectiveSeason, 'convocations'
    );

    const title = `Convocation — ${tournament.categorie} ${tournamentLabel} — ${dateStr}`.trim();

    let wpPostId;
    let isUpdate = false;
    let postUrl = '';

    if (tournament.wp_post_id) {
      isUpdate = true;
      const now = new Date();
      const updateNote = `<div style="background: #d4edda; padding: 8px 12px; border-left: 4px solid #28a745; margin-bottom: 15px;"><strong>🔄 Mise à jour du ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>`;

      await wpXmlRpc(wp.siteUrl, 'wp.editPost', [
        0, wp.username, wp.password, tournament.wp_post_id,
        { post_title: title, post_content: updateNote + htmlContent, terms: { category: [category.id] }, post_status: wp.defaultStatus }
      ]);
      wpPostId = tournament.wp_post_id;
      postUrl = `${wp.siteUrl}/?p=${wpPostId}`;
    } else {
      wpPostId = await wpXmlRpc(wp.siteUrl, 'wp.newPost', [
        0, wp.username, wp.password,
        { post_title: title, post_content: htmlContent, post_type: 'post', post_status: wp.defaultStatus, terms: { category: [category.id] } }
      ]);
      wpPostId = parseInt(wpPostId, 10);
      postUrl = `${wp.siteUrl}/?p=${wpPostId}`;

      await new Promise((resolve, reject) => {
        db.run('UPDATE tournoi_ext SET wp_post_id = $1 WHERE tournoi_id = $2', [wpPostId, tournoiId], (err) => {
          if (err) reject(err); else resolve();
        });
      });
    }

    logAdminAction({
      req,
      action: ACTION_TYPES.PUBLISH_WEBSITE || 'publish_website',
      details: `${isUpdate ? 'Mise à jour' : 'Publication'} WordPress (standalone): ${title}`,
      targetType: 'tournament',
      targetId: tournoiId,
      targetName: title
    });

    res.json({ success: true, isUpdate, postId: wpPostId, postUrl, message: isUpdate ? 'Article mis à jour.' : 'Article publié.' });

  } catch (error) {
    console.error('[WordPress] Publish from saved failed:', error.message);
    res.status(500).json({ error: `Échec de la publication. ${error.message}` });
  }
});

// ─── Get publish status for a tournament ──────────────────────────────────────
router.get('/status/:tournoiId', authenticateToken, async (req, res) => {
  const db = require('../db-loader');
  const orgId = req.user.organizationId || null;
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

    const wp = await getWpSettings(orgId);

    res.json({
      published: !!row?.wp_post_id,
      wpPostId: row?.wp_post_id || null,
      siteUrl: wp.siteUrl || ''
    });
  } catch (error) {
    console.error('[WordPress] Status check failed:', error.message);
    res.status(500).json({ error: 'Erreur lors de la vérification du statut.' });
  }
});

// ─── Delete a WordPress post ──────────────────────────────────────────────────
router.delete('/delete/:tournoiId', authenticateToken, async (req, res) => {
  const db = require('../db-loader');
  const orgId = req.user.organizationId || null;
  const tournoiId = req.params.tournoiId;

  try {
    const wp = await getWpSettings(orgId);
    if (!wp.siteUrl || !wp.username || !wp.password) {
      return res.status(400).json({ error: 'Configuration WordPress incomplète.' });
    }

    // Get the WP post ID
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

    if (!row?.wp_post_id) {
      return res.status(404).json({ error: 'Aucun article WordPress associé à ce tournoi.' });
    }

    // Delete post via XML-RPC: wp.deletePost(blog_id, username, password, post_id)
    await wpXmlRpc(wp.siteUrl, 'wp.deletePost', [0, wp.username, wp.password, row.wp_post_id]);

    // Clear the wp_post_id in our database
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE tournoi_ext SET wp_post_id = NULL WHERE tournoi_id = $1',
        [tournoiId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logAdminAction({
      req,
      action: ACTION_TYPES.PUBLISH_WEBSITE || 'publish_website',
      details: `Suppression article WordPress pour tournoi ${tournoiId}`,
      targetType: 'tournament',
      targetId: tournoiId,
      targetName: `Post WP #${row.wp_post_id}`
    });

    res.json({ success: true, message: 'Article WordPress supprimé.' });

  } catch (error) {
    console.error('[WordPress] Delete failed:', error.message);
    res.status(500).json({ error: `Échec de la suppression. ${error.message}` });
  }
});

module.exports = router;
