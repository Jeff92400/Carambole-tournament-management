// ============================================================
// News Auto-Publisher (April 2026)
//
// Turns tournament events (results imported, finale qualification set,
// new tournament created) into articles in the Player App news feed —
// without any admin typing. The same triggers that already fire push
// notifications call into this module as a dual output: push for the
// ephemeral alert, article for the persistent, searchable content.
//
// Design rules:
//   1. Never throw. Every call is fire-and-forget from a caller that
//      MUST NOT fail because the news feed hiccuped. Errors are logged
//      and swallowed. The return value is diagnostic only.
//   2. Idempotent. A second call with the same (orgId, eventType,
//      sourceRefId) is a no-op thanks to the partial unique index on
//      content_pages. A results re-import or an admin retry will not
//      produce duplicate articles.
//   3. Opt-in per org. If the org is not in 'player_app' news mode,
//      nothing is published. Per-event settings then decide between
//      'auto' (immediate publish), 'draft' (admin reviews first) or
//      'off' (skip entirely).
//   4. Only depends on data already in scope at the call site. We do
//      small lookups for podium enrichment, but if those fail we still
//      produce a minimal article rather than no article at all.
// ============================================================

const db = require('../db-postgres');
const appSettings = require('./app-settings');

// ---------- Constants ----------

// Event-type → section name mapping. Section is auto-created on first
// publish if the org doesn't have it yet. Names are in French because
// they're visible to end users on the "Infos" tab.
const EVENT_SECTION_MAP = {
  RESULTS:              'Résultats',
  FINALE_QUALIFICATION: 'Résultats',
  NEW_TOURNAMENT:       'Compétitions'
};

// Per-event default for the auto-publish mode when no org setting
// exists yet. Factual/low-risk events default to 'auto'; anything that
// an admin might want to annotate before sending defaults to 'draft'.
const EVENT_DEFAULT_MODE = {
  RESULTS:              'auto',
  FINALE_QUALIFICATION: 'auto',
  NEW_TOURNAMENT:       'draft'
};

// Maps event type → the organization_settings key that overrides the
// default mode above. Kept in one place so the admin UI and the engine
// always agree on the key names.
const EVENT_SETTING_KEY = {
  RESULTS:              'news_auto_publish_results',
  FINALE_QUALIFICATION: 'news_auto_publish_qualification',
  NEW_TOURNAMENT:       'news_auto_publish_new_tournament'
};

// content_pages.content_type values — must match VALID_CONTENT_TYPES
// in backend/routes/content.js. 'resultat' for anything about a past
// result, 'evenement' for forward-looking happenings.
const EVENT_CONTENT_TYPE = {
  RESULTS:              'resultat',
  FINALE_QUALIFICATION: 'resultat',
  NEW_TOURNAMENT:       'evenement'
};

// ---------- Helpers ----------

// Read news_delivery_mode for the org. Falls back to 'wordpress' (the
// legacy CDBHS behavior) on any failure, which means the auto-publisher
// will short-circuit — safe default.
async function getNewsDeliveryMode(orgId) {
  try {
    if (!orgId) return 'wordpress';
    const mode = await appSettings.getOrgSetting(orgId, 'news_delivery_mode');
    return mode || 'wordpress';
  } catch (err) {
    console.error('[news-auto-publisher] failed to read news_delivery_mode:', err.message);
    return 'wordpress';
  }
}

// Resolve the per-event publish mode ('auto' | 'draft' | 'off') for an
// org, honoring the per-event override stored in organization_settings
// and falling back to EVENT_DEFAULT_MODE on any miss.
async function resolveEventMode(orgId, eventType) {
  const defaultMode = EVENT_DEFAULT_MODE[eventType] || 'off';
  if (!orgId) return defaultMode;

  const settingKey = EVENT_SETTING_KEY[eventType];
  if (!settingKey) return defaultMode;

  try {
    const value = await appSettings.getOrgSetting(orgId, settingKey);
    if (value === 'auto' || value === 'draft' || value === 'off') return value;
    return defaultMode;
  } catch (err) {
    console.error(`[news-auto-publisher] failed to read ${settingKey}:`, err.message);
    return defaultMode;
  }
}

// Look up or create the target section for an event. Returns the
// section id, or null if resolution failed (in which case the article
// will be published without a section — still visible under "Toutes").
async function resolveOrCreateSection(orgId, sectionName) {
  if (!orgId || !sectionName) return null;
  try {
    const existing = await db.query(
      `SELECT id FROM content_sections
        WHERE organization_id = $1 AND name = $2
        ORDER BY id ASC LIMIT 1`,
      [orgId, sectionName]
    );
    if (existing.rows[0]) return existing.rows[0].id;

    // Section doesn't exist yet for this org — create it at the end
    // of the root list (parent_id NULL, sort_order = current max + 1).
    const maxSort = await db.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS max FROM content_sections
        WHERE organization_id = $1 AND parent_id IS NULL`,
      [orgId]
    );
    const nextSort = (maxSort.rows[0]?.max || 0) + 1;

    const created = await db.query(
      `INSERT INTO content_sections (organization_id, name, parent_id, sort_order)
       VALUES ($1, $2, NULL, $3)
       RETURNING id`,
      [orgId, sectionName, nextSort]
    );
    console.log(`[news-auto-publisher] created section "${sectionName}" (id=${created.rows[0].id}) for org ${orgId}`);
    return created.rows[0].id;
  } catch (err) {
    console.error(`[news-auto-publisher] failed to resolve/create section "${sectionName}":`, err.message);
    return null;
  }
}

// Build the Player App deeplink base used by the "voir" CTAs inside
// auto-articles. Falls back to the production URL if no per-org
// override is configured.
async function getPlayerAppBaseUrl(orgId) {
  try {
    if (!orgId) return 'https://cdbhs-player-app-production.up.railway.app';
    const url = await appSettings.getOrgSetting(orgId, 'player_app_url');
    return url || 'https://cdbhs-player-app-production.up.railway.app';
  } catch (err) {
    return 'https://cdbhs-player-app-production.up.railway.app';
  }
}

// Build a Player App deeplink for a specific page. The Player App
// deep-link mechanism is a ?page=<name> query parameter consumed by
// the handleDeepLink IIFE at startup — NOT a hash fragment (the app
// has no hashchange listener, so #foo does nothing). The base URL
// stored in organization_settings typically already contains
// ?org=<slug>, so we must detect that and use & instead of ? for the
// second parameter. Valid pages: tournaments, inscriptions, stats,
// calendar, profile, contact.
function buildPlayerAppDeeplink(baseUrl, page) {
  if (!baseUrl) return `?page=${page}`;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}page=${page}`;
}

// Minimal HTML escaping for the few fields we interpolate into the
// article body (player names, club names, tournament labels). The rest
// of the body is template-authored and trusted.
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format a Date (or ISO string) as "samedi 15 juin 2026". Returns the
// original string on failure so we never block an article on a bad date.
function formatLongDate(value) {
  if (!value) return '';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch {
    return String(value);
  }
}

// Reusable "see it in the app" button. Matches the Player App primary
// color and sits inline inside the article body so it works both in the
// Infos list (stripped) and in the detail view.
function ctaButton(href, label) {
  return `<p style="text-align:center;margin:18px 0;">
    <a href="${esc(href)}" style="display:inline-block;background:#1F4788;color:#ffffff;padding:10px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">${esc(label)} →</a>
  </p>`;
}

// ---------- Enrichment queries ----------

// Fetch top-3 podium with names + club for the RESULTS template. Best
// effort: if the query fails we return an empty array and the template
// degrades to a short factual line.
async function fetchPodium(tournamentId) {
  try {
    const result = await db.query(
      `SELECT tr.position, tr.licence, tr.points, tr.reprises,
              p.first_name, p.last_name, p.club AS club_name
         FROM tournament_results tr
         LEFT JOIN players p ON p.licence = tr.licence
        WHERE tr.tournament_id = $1 AND tr.position IS NOT NULL
        ORDER BY tr.position ASC
        LIMIT 3`,
      [tournamentId]
    );
    return result.rows || [];
  } catch (err) {
    console.error('[news-auto-publisher] fetchPodium failed:', err.message);
    return [];
  }
}

// Count total participants in a tournament (used as a human-friendly
// "N joueurs ont participé" line).
async function fetchParticipantCount(tournamentId) {
  try {
    const result = await db.query(
      `SELECT COUNT(*)::int AS total FROM tournament_results WHERE tournament_id = $1`,
      [tournamentId]
    );
    return result.rows[0]?.total || 0;
  } catch {
    return 0;
  }
}

// ---------- Templates ----------

// Each template returns { title, excerpt, contentHtml }. Called after
// the per-event mode has been resolved and the section created, so the
// template itself has zero side effects — pure string assembly.

function renderResultsArticle(ctx) {
  const {
    tournamentLabel, categoryName, tournamentDate,
    podium, totalPlayers, deeplink
  } = ctx;

  const winner = podium[0];
  const winnerName = winner
    ? `${winner.first_name || ''} ${winner.last_name || ''}`.trim() || 'un joueur'
    : 'un joueur';

  const title = `Résultats ${tournamentLabel} — ${categoryName}`;

  const excerpt = winner
    ? `${winnerName} s'impose au ${tournamentLabel} ${categoryName}${totalPlayers ? ` devant ${Math.max(totalPlayers - 1, 0)} autres joueurs` : ''}. Découvrez le classement complet.`
    : `Les résultats du ${tournamentLabel} ${categoryName} sont disponibles. Découvrez le classement complet.`;

  const podiumHtml = podium.length > 0
    ? `<ol style="padding-left:22px;line-height:1.8;">
         ${podium.map(p => {
           const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.licence;
           const club = p.club_name ? ` <span style="color:#6b7280;">— ${esc(p.club_name)}</span>` : '';
           const medal = p.position === 1 ? '🥇 ' : p.position === 2 ? '🥈 ' : p.position === 3 ? '🥉 ' : '';
           return `<li><strong>${medal}${esc(name)}</strong>${club}</li>`;
         }).join('')}
       </ol>`
    : '';

  const dateLine = tournamentDate
    ? `<p>Compétition jouée le <strong>${esc(tournamentDate)}</strong>.</p>`
    : '';

  const countLine = totalPlayers > 0
    ? `<p style="color:#6b7280;font-size:14px;">${totalPlayers} joueur${totalPlayers > 1 ? 's' : ''} ont participé à cette compétition.</p>`
    : '';

  const contentHtml = `
    <p>Le <strong>${esc(tournamentLabel)}</strong> en catégorie <strong>${esc(categoryName)}</strong> vient de se terminer.</p>
    ${podium.length > 0 ? '<h3>Podium</h3>' : ''}
    ${podiumHtml}
    ${dateLine}
    ${countLine}
    ${ctaButton(deeplink, 'Voir tous les résultats')}
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px;">
      Article généré automatiquement par l'application.
    </p>
  `.trim();

  return { title, excerpt, contentHtml };
}

function renderFinaleQualificationArticle(ctx) {
  const { categoryName, qualifiedPlayers, finaleDate, deeplink } = ctx;

  const count = qualifiedPlayers.length;
  const title = `🏆 Qualifiés pour la Finale ${categoryName}`;

  const excerpt = `${count} joueur${count > 1 ? 's' : ''} se ${count > 1 ? 'sont' : "s'est"} qualifié${count > 1 ? 's' : ''} pour la Finale de District ${categoryName}${finaleDate ? ` — ${finaleDate}` : ''}. Félicitations !`;

  const listHtml = qualifiedPlayers.length > 0
    ? `<ol style="padding-left:22px;line-height:1.8;">
         ${qualifiedPlayers.map(p => {
           const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.licence;
           return `<li><strong>${esc(name)}</strong></li>`;
         }).join('')}
       </ol>`
    : '';

  const dateLine = finaleDate
    ? `<p>📅 Finale de District prévue le <strong>${esc(finaleDate)}</strong>.</p>`
    : '<p>📅 Date de la Finale de District à confirmer.</p>';

  const contentHtml = `
    <p>À l'issue du dernier tournoi qualificatif, <strong>${count} joueur${count > 1 ? 's sont qualifiés' : ' est qualifié'}</strong> pour la Finale de District <strong>${esc(categoryName)}</strong>.</p>
    <h3>Qualifiés</h3>
    ${listHtml}
    ${dateLine}
    <p>Félicitations à tous les qualifiés et bonne chance pour la finale !</p>
    ${ctaButton(deeplink, 'Voir le classement')}
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px;">
      Article généré automatiquement par l'application.
    </p>
  `.trim();

  return { title, excerpt, contentHtml };
}

function renderNewTournamentArticle(ctx) {
  const {
    tournamentName, categoryLabel, tournamentDate,
    location, closingDate, deeplink
  } = ctx;

  const title = `Inscriptions ouvertes : ${tournamentName}`;

  const excerpt = `Les inscriptions pour le ${tournamentName}${categoryLabel ? ` (${categoryLabel})` : ''} sont ouvertes${closingDate ? ` jusqu'au ${closingDate}` : ''}.`;

  const dateLine = tournamentDate
    ? `<p>📅 Date : <strong>${esc(tournamentDate)}</strong></p>`
    : '';
  const locationLine = location
    ? `<p>📍 Lieu : <strong>${esc(location)}</strong></p>`
    : '';
  const closingLine = closingDate
    ? `<p>⏰ Date limite d'inscription : <strong>${esc(closingDate)}</strong></p>`
    : '';

  const contentHtml = `
    <p>Le comité ouvre les inscriptions pour le <strong>${esc(tournamentName)}</strong>${categoryLabel ? ` en catégorie <strong>${esc(categoryLabel)}</strong>` : ''}.</p>
    ${dateLine}
    ${locationLine}
    ${closingLine}
    <p>Rendez-vous dans l'Espace Joueur pour vous inscrire.</p>
    ${ctaButton(deeplink, "S'inscrire")}
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px;">
      Article généré automatiquement par l'application.
    </p>
  `.trim();

  return { title, excerpt, contentHtml };
}

// ---------- Main entry point ----------

// publishAutoArticle(eventType, orgId, payload, options) — safe,
// idempotent, fire-and-forget. Returns a small diagnostic object;
// callers can ignore it entirely.
//
// eventType  : 'RESULTS' | 'FINALE_QUALIFICATION' | 'NEW_TOURNAMENT'
// orgId      : organization id (nullable — if null, nothing happens)
// payload    : shape depends on eventType, see switch below
// options    : { forceStatus: 'draft' | 'published' } — override the
//              resolved per-event mode. Used by callers that need to
//              decouple the "create the article" moment from the
//              "publish it" moment (e.g. results save creates a draft,
//              player-com send promotes it to published).
async function publishAutoArticle(eventType, orgId, payload, options = {}) {
  try {
    if (!orgId) return { skipped: 'no_org' };
    if (!EVENT_SECTION_MAP[eventType]) return { skipped: 'unknown_event_type' };

    // Hard gate: only orgs in 'player_app' news mode get auto-articles.
    const deliveryMode = await getNewsDeliveryMode(orgId);
    if (deliveryMode !== 'player_app') return { skipped: 'news_mode_not_player_app' };

    // Soft gate: per-event opt-out.
    const mode = await resolveEventMode(orgId, eventType);
    if (mode === 'off') return { skipped: 'event_disabled' };

    // Idempotency check — the partial unique index is the real guard,
    // but checking first gives us a clean "already exists" result
    // instead of noisy unique-violation errors in the logs.
    const sourceRefId = payload?.sourceRefId || null;
    if (sourceRefId != null) {
      const existing = await db.query(
        `SELECT id, status FROM content_pages
          WHERE organization_id = $1
            AND auto_generated = TRUE
            AND source_type = $2
            AND source_ref_id = $3
          LIMIT 1`,
        [orgId, eventType, sourceRefId]
      );
      if (existing.rows[0]) {
        return { skipped: 'already_exists', articleId: existing.rows[0].id };
      }
    }

    // Build the deeplink base + resolve section.
    const playerAppUrl = await getPlayerAppBaseUrl(orgId);
    const sectionName = EVENT_SECTION_MAP[eventType];
    const sectionId = await resolveOrCreateSection(orgId, sectionName);
    const contentType = EVENT_CONTENT_TYPE[eventType] || 'actualite';

    // Render the template for this event type. If a template throws,
    // we log and bail — no article is better than a broken article.
    let rendered;
    try {
      if (eventType === 'RESULTS') {
        // Enrich with podium + participant count.
        const [podium, totalPlayers] = await Promise.all([
          fetchPodium(payload.tournamentId),
          fetchParticipantCount(payload.tournamentId)
        ]);
        rendered = renderResultsArticle({
          tournamentLabel: payload.tournamentLabel || 'tournoi',
          categoryName: payload.categoryName || '',
          tournamentDate: payload.tournamentDate || '',
          podium,
          totalPlayers,
          deeplink: buildPlayerAppDeeplink(playerAppUrl, 'stats')
        });
      } else if (eventType === 'FINALE_QUALIFICATION') {
        rendered = renderFinaleQualificationArticle({
          categoryName: payload.categoryName || '',
          qualifiedPlayers: payload.qualifiedPlayers || [],
          finaleDate: payload.finaleDate || '',
          deeplink: buildPlayerAppDeeplink(playerAppUrl, 'stats')
        });
      } else if (eventType === 'NEW_TOURNAMENT') {
        rendered = renderNewTournamentArticle({
          tournamentName: payload.tournamentName || 'Nouveau tournoi',
          categoryLabel: payload.categoryLabel || '',
          tournamentDate: payload.tournamentDate || '',
          location: payload.location || '',
          closingDate: payload.closingDate || '',
          deeplink: buildPlayerAppDeeplink(playerAppUrl, 'tournaments')
        });
      } else {
        return { skipped: 'unknown_event_type' };
      }
    } catch (renderErr) {
      console.error(`[news-auto-publisher] render failed for ${eventType}:`, renderErr.message);
      return { error: 'render_failed', message: renderErr.message };
    }

    // forceStatus (if provided) overrides the resolved mode — this is
    // how /import-matches asks for a draft even when the org setting
    // says 'auto', so that the player-com send step can flip it to
    // published later (correct causality: participants notified first,
    // public news published after).
    let resolvedStatus;
    if (options.forceStatus === 'draft' || options.forceStatus === 'published') {
      resolvedStatus = options.forceStatus;
    } else {
      resolvedStatus = mode === 'auto' ? 'published' : 'draft';
    }
    const shouldPublish = resolvedStatus === 'published';
    const status = resolvedStatus;
    const publishedAt = shouldPublish ? new Date() : null;

    // INSERT. The partial unique index on (org, source_type, source_ref_id)
    // defends against races where two concurrent import requests both
    // pass the pre-check. On conflict we log and treat it as a no-op.
    try {
      const result = await db.query(
        `INSERT INTO content_pages
           (organization_id, section_id, title, content_html, excerpt,
            content_type, status, is_featured, is_pinned, author_user_id,
            published_at, cover_image, auto_generated, source_type, source_ref_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, FALSE, NULL, $8, NULL, TRUE, $9, $10)
         RETURNING id`,
        [
          orgId,
          sectionId,
          rendered.title,
          rendered.contentHtml,
          rendered.excerpt,
          contentType,
          status,
          publishedAt,
          eventType,
          sourceRefId
        ]
      );
      const articleId = result.rows[0]?.id;
      console.log(`[news-auto-publisher] ${status} article id=${articleId} (${eventType}, org=${orgId}, ref=${sourceRefId})`);
      return { created: true, articleId, status };
    } catch (insertErr) {
      // Unique violation on the partial index — another call beat us to it.
      if (insertErr.code === '23505') {
        return { skipped: 'race_already_exists' };
      }
      console.error(`[news-auto-publisher] insert failed for ${eventType}:`, insertErr.message);
      return { error: 'insert_failed', message: insertErr.message };
    }
  } catch (err) {
    console.error(`[news-auto-publisher] unexpected error for ${eventType}:`, err.message);
    return { error: 'unexpected', message: err.message };
  }
}

// promoteDraftOrCreate(eventType, orgId, payload) — called by the
// player-com send step (emailing.js /send-results). Semantics:
//
//   1. If the org is not in 'player_app' news mode, skip (safe for
//      WordPress-only orgs like CDBHS).
//   2. If per-event mode is 'off', skip. 'draft' means the admin wants
//      manual control — do not auto-promote, just leave the existing
//      draft alone.
//   3. If per-event mode is 'auto', promote: look up the existing
//      auto_generated article for (org, eventType, sourceRefId). If
//      found in draft status, UPDATE to 'published'. If found already
//      published, no-op (idempotent). If not found at all, create it
//      fresh as 'published' — this handles the edge case where the
//      setting was 'off' when results were saved but is now 'auto'.
//
// Returns a diagnostic object; never throws.
async function promoteDraftOrCreate(eventType, orgId, payload) {
  try {
    if (!orgId) return { skipped: 'no_org' };
    if (!EVENT_SECTION_MAP[eventType]) return { skipped: 'unknown_event_type' };

    const deliveryMode = await getNewsDeliveryMode(orgId);
    if (deliveryMode !== 'player_app') return { skipped: 'news_mode_not_player_app' };

    const mode = await resolveEventMode(orgId, eventType);
    if (mode === 'off') return { skipped: 'event_disabled' };
    if (mode === 'draft') return { skipped: 'manual_publish_mode' };

    const sourceRefId = payload?.sourceRefId || null;
    if (sourceRefId == null) return { skipped: 'no_source_ref_id' };

    // Look for an existing draft from the save-step hook.
    const existing = await db.query(
      `SELECT id, status FROM content_pages
        WHERE organization_id = $1
          AND auto_generated = TRUE
          AND source_type = $2
          AND source_ref_id = $3
        LIMIT 1`,
      [orgId, eventType, sourceRefId]
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.status === 'published') {
        return { skipped: 'already_published', articleId: row.id };
      }
      // Flip draft -> published.
      await db.query(
        `UPDATE content_pages
            SET status = 'published', published_at = $1
          WHERE id = $2`,
        [new Date(), row.id]
      );
      console.log(`[news-auto-publisher] promoted article id=${row.id} to published (${eventType}, org=${orgId}, ref=${sourceRefId})`);
      return { promoted: true, articleId: row.id };
    }

    // No existing draft — fall back to creating the article fresh as
    // 'published'. Reuses the main entry point with forceStatus so the
    // template + section + idempotency logic stays in one place.
    console.log(`[news-auto-publisher] no draft found, creating fresh published article (${eventType}, org=${orgId}, ref=${sourceRefId})`);
    return await publishAutoArticle(eventType, orgId, payload, { forceStatus: 'published' });
  } catch (err) {
    console.error(`[news-auto-publisher] promoteDraftOrCreate error for ${eventType}:`, err.message);
    return { error: 'unexpected', message: err.message };
  }
}

module.exports = {
  publishAutoArticle,
  promoteDraftOrCreate,
  // Exported for tests / admin UI preview only.
  _internals: {
    EVENT_SECTION_MAP,
    EVENT_DEFAULT_MODE,
    EVENT_SETTING_KEY,
    resolveEventMode,
    resolveOrCreateSection
  }
};
