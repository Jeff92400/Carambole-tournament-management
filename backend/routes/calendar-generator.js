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
const appSettings = require('../utils/app-settings');

const router = express.Router();
const getDb = () => require('../db-loader');

// V 2.0.593 — Per-org feature flag. Every endpoint below is gated by a
// router-level middleware that runs AFTER authenticateToken. We use a
// param-style middleware injected on the request object via a tiny
// gate function, then routes call `requireCalendarGenerator` directly
// in their middleware chain.
async function requireCalendarGenerator(req, res, next) {
  try {
    const orgId = req.user && req.user.organizationId;
    if (!orgId) return res.status(403).json({ error: 'Org context manquant' });
    const enabled = await appSettings.getOrgSetting(orgId, 'calendar_generator_enabled');
    if (String(enabled).toLowerCase() === 'true') return next();
    return res.status(403).json({ error: 'Le générateur de calendrier n\'est pas activé pour cette CDB.' });
  } catch (err) {
    console.error('[calendar-generator] feature flag check failed:', err.message);
    return res.status(500).json({ error: 'Vérification feature flag échouée' });
  }
}

// Public endpoint: lets the frontend check whether the wizard should be
// surfaced for the current admin without throwing 403 noise.
router.get('/feature-status', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user && req.user.organizationId;
    if (!orgId) return res.json({ enabled: false });
    const enabled = await appSettings.getOrgSetting(orgId, 'calendar_generator_enabled');
    res.json({ enabled: String(enabled).toLowerCase() === 'true' });
  } catch (err) {
    res.json({ enabled: false });
  }
});

// ----------------------------------------------------------------
// Brief de saison
// ----------------------------------------------------------------

// GET /brief?season=2026-2027 — retrieve brief for a season (or null)
router.get('/brief', authenticateToken, requireCalendarGenerator, (req, res) => {
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
router.get('/briefs', authenticateToken, requireCalendarGenerator, (req, res) => {
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
router.post('/brief', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
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
    final_attribution,
    host_blackouts,
    last_weekend
  } = req.body;

  if (!season || !qualif_day || !final_day || !first_weekend) {
    return res.status(400).json({ error: 'Missing required fields: season, qualif_day, final_day, first_weekend' });
  }

  db.run(
    `INSERT INTO calendar_brief
       (organization_id, season, qualif_day, final_day, first_weekend,
        blackout_dates, active_categories, active_hosts, final_attribution, host_blackouts, last_weekend, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11, $12)
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
      JSON.stringify(host_blackouts || []),
      last_weekend || null,
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
router.put('/brief/:id', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
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
    host_blackouts,
    last_weekend,
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
         host_blackouts = COALESCE($8::jsonb, host_blackouts),
         last_weekend = COALESCE($9::date, last_weekend),
         status = COALESCE($10, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $11 AND organization_id = $12`,
    [
      qualif_day || null,
      final_day || null,
      first_weekend || null,
      blackout_dates ? JSON.stringify(blackout_dates) : null,
      active_categories ? JSON.stringify(active_categories) : null,
      active_hosts ? JSON.stringify(active_hosts) : null,
      final_attribution || null,
      host_blackouts ? JSON.stringify(host_blackouts) : null,
      last_weekend || null,
      status || null,
      briefId,
      orgId
    ],
    function(err) {
      if (err) {
        console.error('[calendar-generator] PUT /brief error:', err);
        return res.status(500).json({ error: err.message });
      }
      // V 2.0.605 — sync auto-derived rules with the brief.
      // season_start_after.first_weekend and blackout_weekend.dates
      // are now driven by the brief, but we also keep the rule
      // parameters in sync so any legacy reader sees the same value.
      // Fire-and-forget — failure here doesn't break brief save.
      syncAutoDerivedRulesFromBrief(getDb(), orgId, {
        first_weekend: first_weekend || null,
        blackout_dates: blackout_dates || null
      }).catch(e => console.warn('[calendar-generator] auto-rule sync failed:', e.message));
      res.json({ message: 'Brief mis à jour' });
    }
  );
});

// Helper — push brief values into the two auto-derived rules' parameters
// so the DB stays consistent. Idempotent: silently noops if rules don't
// exist for this org (they will once admin opens Step 2 once).
async function syncAutoDerivedRulesFromBrief(db, orgId, briefValues) {
  const updates = [];
  if (briefValues.first_weekend !== undefined && briefValues.first_weekend !== null) {
    updates.push({ rule_type: 'season_start_after', params: { first_weekend: briefValues.first_weekend } });
  }
  if (briefValues.blackout_dates !== undefined && briefValues.blackout_dates !== null) {
    updates.push({ rule_type: 'blackout_weekend', params: { dates: Array.isArray(briefValues.blackout_dates) ? briefValues.blackout_dates : [] } });
  }
  for (const u of updates) {
    await new Promise((resolve) => {
      db.run(
        `UPDATE calendar_constraints
            SET parameters = $1::jsonb, updated_at = CURRENT_TIMESTAMP
          WHERE organization_id = $2 AND rule_type = $3`,
        [JSON.stringify(u.params), orgId, u.rule_type],
        () => resolve()
      );
    });
  }
}

// DELETE /brief/:id — delete a brief (cascade deletes drafts and sync logs)
router.delete('/brief/:id', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
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
router.get('/ligue-finals', authenticateToken, requireCalendarGenerator, (req, res) => {
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
router.post('/ligue-finals', authenticateToken, requireCalendarGenerator, requireAdmin, async (req, res) => {
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
router.delete('/ligue-finals/:id', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
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
router.get('/reference-data', authenticateToken, requireCalendarGenerator, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;

  Promise.all([
    new Promise((resolve, reject) => {
      db.all(
        `SELECT id, game_type AS mode, level, display_name AS name
         FROM categories
         WHERE (organization_id = $1 OR organization_id IS NULL)
           AND COALESCE(is_active, TRUE) = TRUE
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
// Calendar Constraints — Phase 4a (rules library CRUD)
// ----------------------------------------------------------------

// Catalogue V1 des types de règles (utilisé pour validation + seed defaults).
// Le frontend a sa propre copie dans calendar-rules-catalog.js pour les libellés.
const RULES_CATALOG = {
  // Règles dures
  blackout_weekend:                          { strictness: 'hard', defaultParams: { dates: [] } },
  tournament_day_rule:                       { strictness: 'hard', defaultParams: { tournament_type: '*', day: 'saturday' } },
  season_start_after:                        { strictness: 'hard', defaultParams: { first_weekend: null } },
  final_before_ligue_final:                  { strictness: 'hard', defaultParams: {} }, // auto via ligue_final_dates
  min_weeks_between_cdb_and_ligue_final:     { strictness: 'hard', defaultParams: { min_weeks: 2 } },
  min_weeks_between_tournaments_same_category: { strictness: 'hard', defaultParams: { min_weeks: 3 } },
  min_weeks_between_t3_and_final:            { strictness: 'hard', defaultParams: { min_weeks: 2 } },
  host_no_double_booking:                    { strictness: 'hard', defaultParams: {} }, // implicit
  max_tournaments_per_weekend:               { strictness: 'hard', defaultParams: { max: 4 } },
  // Règles molles
  host_balanced_load:                        { strictness: 'soft', defaultWeight: 5, defaultParams: { tolerance: 1 } },
  host_no_consecutive_weekends:              { strictness: 'soft', defaultWeight: 3, defaultParams: { scope: 'all_hosts' } },
  category_upgrade_cascade:                  { strictness: 'soft', defaultWeight: 4, defaultParams: { apply_to_modes: ['*'] } },
  mode_spread_evenly:                        { strictness: 'soft', defaultWeight: 2, defaultParams: { mode: '*' } },
  weekend_spread:                            { strictness: 'soft', defaultWeight: 5, defaultParams: {} }
};

// Liste des règles à pré-créer pour un nouveau CDB (instances par défaut)
const DEFAULT_RULE_INSTANCES = [
  'final_before_ligue_final',
  'min_weeks_between_cdb_and_ligue_final',
  'min_weeks_between_tournaments_same_category',
  'min_weeks_between_t3_and_final',
  'host_no_double_booking',
  'max_tournaments_per_weekend',
  'host_balanced_load',
  'host_no_consecutive_weekends',
  'category_upgrade_cascade',
  'mode_spread_evenly',
  'weekend_spread'
];

// GET /constraints — list rule instances for the current org
router.get('/constraints', authenticateToken, requireCalendarGenerator, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  db.all(
    `SELECT id, rule_type, parameters, strictness, weight, enabled, created_at, updated_at
     FROM calendar_constraints
     WHERE organization_id = $1
     ORDER BY strictness DESC, id ASC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('[calendar-generator] GET /constraints error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// POST /constraints — add a rule instance
router.post('/constraints', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const { rule_type, parameters, strictness, weight, enabled } = req.body;

  if (!rule_type || !RULES_CATALOG[rule_type]) {
    return res.status(400).json({ error: `Unknown rule_type. Allowed: ${Object.keys(RULES_CATALOG).join(', ')}` });
  }
  const meta = RULES_CATALOG[rule_type];
  const finalStrictness = strictness || meta.strictness;
  const finalParams = { ...(meta.defaultParams || {}), ...(parameters || {}) };
  const finalWeight = (weight !== undefined ? weight : (meta.defaultWeight || 1));

  db.run(
    `INSERT INTO calendar_constraints (organization_id, rule_type, parameters, strictness, weight, enabled)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING id`,
    [orgId, rule_type, JSON.stringify(finalParams), finalStrictness, finalWeight, enabled !== false],
    function(err, result) {
      if (err) {
        console.error('[calendar-generator] POST /constraints error:', err);
        return res.status(500).json({ error: err.message });
      }
      const id = result?.rows?.[0]?.id || this?.lastID;
      res.status(201).json({ id, message: 'Règle ajoutée' });
    }
  );
});

// PATCH /constraints/:id — update parameters / weight / enabled
router.patch('/constraints/:id', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const id = parseInt(req.params.id, 10);
  const { parameters, weight, enabled, strictness } = req.body;

  db.run(
    `UPDATE calendar_constraints
     SET parameters = COALESCE($1::jsonb, parameters),
         weight = COALESCE($2, weight),
         enabled = COALESCE($3, enabled),
         strictness = COALESCE($4, strictness),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 AND organization_id = $6`,
    [
      parameters ? JSON.stringify(parameters) : null,
      weight !== undefined ? weight : null,
      enabled !== undefined ? enabled : null,
      strictness || null,
      id,
      orgId
    ],
    function(err) {
      if (err) {
        console.error('[calendar-generator] PATCH /constraints error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Règle mise à jour' });
    }
  );
});

// DELETE /constraints/:id
router.delete('/constraints/:id', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const id = parseInt(req.params.id, 10);
  db.run(
    `DELETE FROM calendar_constraints WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
    function(err) {
      if (err) {
        console.error('[calendar-generator] DELETE /constraints error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Règle supprimée' });
    }
  );
});

// POST /constraints/seed-defaults — pre-fill the V1 default library for the org
// Idempotent: only inserts rule_types that don't already exist for the org.
router.post('/constraints/seed-defaults', authenticateToken, requireCalendarGenerator, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  try {
    const existing = await new Promise((resolve, reject) => {
      db.all(
        `SELECT rule_type FROM calendar_constraints WHERE organization_id = $1`,
        [orgId],
        (err, rows) => err ? reject(err) : resolve((rows || []).map(r => r.rule_type))
      );
    });
    const toInsert = DEFAULT_RULE_INSTANCES.filter(t => !existing.includes(t));
    for (const ruleType of toInsert) {
      const meta = RULES_CATALOG[ruleType];
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO calendar_constraints (organization_id, rule_type, parameters, strictness, weight, enabled)
           VALUES ($1, $2, $3::jsonb, $4, $5, TRUE)`,
          [orgId, ruleType, JSON.stringify(meta.defaultParams || {}), meta.strictness, meta.defaultWeight || 1],
          (err) => err ? reject(err) : resolve()
        );
      });
    }
    res.json({ message: 'Bibliothèque pré-remplie', inserted: toInsert.length, skipped: existing.length });
  } catch (err) {
    console.error('[calendar-generator] POST /constraints/seed-defaults error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Club preferred start time (inline edit from Step 1)
// ----------------------------------------------------------------

// PATCH /clubs/:id/start-time — update a club's preferred_start_time
// Body: { value: 'morning' | 'afternoon' | 'full_day' | null }
router.patch('/clubs/:id/start-time', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
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

// ----------------------------------------------------------------
// AI: Natural language → structured rule (Phase 4b)
// ----------------------------------------------------------------

// POST /constraints/from-natural-language — translate a French sentence into a draft rule
// Body: { text: "Clichy ne doit jamais accueillir deux week-ends d'affilée" }
// Response: { rule_type, parameters, strictness, weight, explanation, confidence }
// Note: This is a DRAFT — admin must validate before saving via POST /constraints.
router.post('/constraints/from-natural-language', authenticateToken, requireCalendarGenerator, requireAdmin, async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'Texte requis (au moins 5 caractères).' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'Texte trop long (500 caractères max).' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Service IA non configuré (ANTHROPIC_API_KEY manquante).' });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Load clubs list to ground host names if mentioned
    const db = getDb();
    const orgId = req.user.organizationId;
    const clubs = await new Promise((resolve) => {
      db.all(
        `SELECT id, display_name FROM clubs
         WHERE ($1::int IS NULL OR organization_id = $1)
         ORDER BY display_name`,
        [orgId],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
    const clubsList = clubs.map(c => `- ${c.display_name} (id=${c.id})`).join('\n');

    const catalogJson = JSON.stringify(RULES_CATALOG, null, 2);

    const systemPrompt = `Tu es un assistant qui traduit des phrases en français (description d'une contrainte de planification d'un calendrier de tournois de billard) en une règle structurée JSON.

CATALOGUE DE RÈGLES DISPONIBLES :
${catalogJson}

CLUBS DE CE CDB (utiliser display_name exact UNIQUEMENT si l'utilisateur cite explicitement le club) :
${clubsList || '(aucun)'}

Tu dois retourner UNIQUEMENT un objet JSON valide (pas de markdown, pas d'explication hors JSON) avec cette structure :
{
  "rule_type": "<une clé EXACTE du catalogue>",
  "parameters": { ... paramètres dont les CLÉS sont EXACTEMENT celles de defaultParams de la règle choisie ... },
  "strictness": "hard" | "soft",
  "weight": <nombre 1-10, requis uniquement si strictness=soft>,
  "explanation": "<phrase courte en français expliquant ta traduction>",
  "confidence": "high" | "medium" | "low"
}

RÈGLES STRICTES (à respecter sans exception) :
1. Les clés de "parameters" doivent être EXACTEMENT celles présentes dans defaultParams de la règle choisie. N'invente JAMAIS une clé qui n'y figure pas.
2. Ne change PAS la valeur de "strictness" — utilise celle déclarée dans le catalogue pour la règle choisie.
3. Si la phrase mentionne un concept (ex. "max N tournois par mois", "uniquement le matin", "seulement pour la R1") qui n'a PAS de règle correspondante dans le catalogue, retourne OBLIGATOIREMENT :
   { "error": "Aucune règle correspondante", "explanation": "<explique ce qui manque>" }
4. Ne cite JAMAIS un club si l'utilisateur ne l'a pas explicitement nommé dans sa phrase.
5. Si la phrase est trop ambiguë pour choisir une règle, retourne :
   { "error": "Phrase trop ambiguë", "explanation": "<demande de reformulation>" }
6. CAS PARTICULIER — Indisponibilité d'un club sur une période (ex. "Clichy indispo en décembre", "Courbevoie fermé du X au Y") : ce n'est PAS une règle logique mais une donnée propre à la saison. Retourne OBLIGATOIREMENT :
   { "error": "À saisir dans le Brief", "explanation": "Cette indisponibilité se gère dans l'Étape 1 — Brief, section « Indisponibilités par club »." }

Mieux vaut renvoyer une erreur claire que d'inventer une règle bricolée.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: text.trim() }]
    });

    const raw = (message.content?.[0]?.text || '').trim();
    let parsed;
    try {
      // Strip optional ```json fences just in case
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'Réponse IA non parsable', raw });
    }

    if (parsed.error) {
      return res.status(200).json(parsed);
    }
    if (!parsed.rule_type || !RULES_CATALOG[parsed.rule_type]) {
      return res.status(502).json({ error: 'rule_type invalide retourné par l\'IA', received: parsed });
    }

    // Filter out any parameter keys not declared in defaultParams of the chosen rule
    const meta = RULES_CATALOG[parsed.rule_type];
    const allowedKeys = Object.keys(meta.defaultParams || {});
    const incomingParams = parsed.parameters || {};
    const cleanedParams = {};
    const droppedKeys = [];
    for (const k of Object.keys(incomingParams)) {
      if (allowedKeys.includes(k)) cleanedParams[k] = incomingParams[k];
      else droppedKeys.push(k);
    }
    parsed.parameters = cleanedParams;
    if (droppedKeys.length) {
      parsed.warning = `Clés ignorées (hors catalogue) : ${droppedKeys.join(', ')}`;
      console.warn('[calendar-generator] AI returned out-of-catalog keys for', parsed.rule_type, ':', droppedKeys);
    }
    // Force strictness to catalog declaration (AI cannot override)
    parsed.strictness = meta.strictness;

    res.json(parsed);
  } catch (err) {
    console.error('[calendar-generator] POST /constraints/from-natural-language error:', err);
    res.status(500).json({ error: err.message || 'Erreur IA' });
  }
});

// ----------------------------------------------------------------
// Step 2 — "Quand tombe… ?" date assistant
// Path B (deterministic): GET /holidays?year=YYYY  → fériés français + fêtes calculées
// Path A (LLM fallback) : POST /ask-date          → free-text via Claude Haiku
// In both cases the response includes the (samedi, dimanche) of the ISO
// week containing the resolved date, so the front-end can offer "Exclure
// ce week-end" with one click.
// ----------------------------------------------------------------

// Anonymous Gregorian (Meeus) — returns a UTC Date for Easter Sunday of `year`
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUTC(d, n) {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function ymd(d) { return d.toISOString().slice(0, 10); }

// Returns the (Sat, Sun) of the ISO week (Mon-Sun) containing dateStr.
function weekendForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  // ISO weekday: Mon=1..Sun=7
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = addDaysUTC(d, 1 - isoDow);
  const saturday = addDaysUTC(monday, 5);
  const sunday = addDaysUTC(monday, 6);
  return { saturday: ymd(saturday), sunday: ymd(sunday) };
}

// Last Sunday of a given month (year, month 0-indexed)
function lastSundayOfMonth(year, month) {
  // First day of next month, then walk backward to Sunday
  const firstNext = new Date(Date.UTC(year, month + 1, 1));
  const lastDay = addDaysUTC(firstNext, -1);
  const dow = lastDay.getUTCDay(); // Sun=0
  return addDaysUTC(lastDay, -dow);
}
// Nth Sunday of a given month
function nthSundayOfMonth(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1));
  const dow = first.getUTCDay();
  const offsetToFirstSunday = (7 - dow) % 7;
  return addDaysUTC(first, offsetToFirstSunday + 7 * (n - 1));
}

// Compute the canonical list of French public + folkloric holidays for a year.
function frenchHolidays(year) {
  const easter = easterSunday(year);
  const easterMonday = addDaysUTC(easter, 1);
  const ascension = addDaysUTC(easter, 39);
  const pentecost = addDaysUTC(easter, 49);
  const pentecostMonday = addDaysUTC(easter, 50);

  // Mother's Day (FR): last Sunday of May, BUT if it falls on Pentecost
  // Sunday → push to first Sunday of June.
  let mothersDay = lastSundayOfMonth(year, 4); // May = 4
  if (ymd(mothersDay) === ymd(pentecost)) {
    mothersDay = nthSundayOfMonth(year, 5, 1); // first Sunday of June
  }
  const fathersDay = nthSundayOfMonth(year, 5, 3); // 3rd Sunday of June
  const grandmothersDay = nthSundayOfMonth(year, 2, 1); // 1st Sunday of March

  return [
    { key: 'jour_an',           label: 'Jour de l\'An',                date: ymd(new Date(Date.UTC(year, 0, 1))) },
    { key: 'paques',            label: 'Pâques',                       date: ymd(easter) },
    { key: 'paques_lundi',      label: 'Lundi de Pâques',              date: ymd(easterMonday) },
    { key: 'fete_travail',      label: 'Fête du Travail (1er mai)',    date: ymd(new Date(Date.UTC(year, 4, 1))) },
    { key: 'victoire_1945',     label: 'Victoire 1945 (8 mai)',        date: ymd(new Date(Date.UTC(year, 4, 8))) },
    { key: 'ascension',         label: 'Ascension',                    date: ymd(ascension) },
    { key: 'fete_meres',        label: 'Fête des Mères',               date: ymd(mothersDay) },
    { key: 'pentecote',         label: 'Pentecôte',                    date: ymd(pentecost) },
    { key: 'pentecote_lundi',   label: 'Lundi de Pentecôte',           date: ymd(pentecostMonday) },
    { key: 'fete_peres',        label: 'Fête des Pères',               date: ymd(fathersDay) },
    { key: 'fete_grands_meres', label: 'Fête des Grand-Mères',         date: ymd(grandmothersDay) },
    { key: 'fete_nationale',    label: 'Fête Nationale (14 juillet)',  date: ymd(new Date(Date.UTC(year, 6, 14))) },
    { key: 'assomption',        label: 'Assomption (15 août)',         date: ymd(new Date(Date.UTC(year, 7, 15))) },
    { key: 'toussaint',         label: 'Toussaint (1er novembre)',     date: ymd(new Date(Date.UTC(year, 10, 1))) },
    { key: 'armistice',         label: 'Armistice (11 novembre)',      date: ymd(new Date(Date.UTC(year, 10, 11))) },
    { key: 'noel',              label: 'Noël (25 décembre)',           date: ymd(new Date(Date.UTC(year, 11, 25))) }
  ].map(h => ({ ...h, weekend: weekendForDate(h.date) }));
}

// GET /holidays?year=2027 — list of French holidays + their associated weekend
router.get('/holidays', authenticateToken, requireCalendarGenerator, (req, res) => {
  const year = parseInt(req.query.year, 10);
  if (!year || year < 1900 || year > 2200) {
    return res.status(400).json({ error: 'year requis (1900-2200)' });
  }
  try {
    res.json({ year, holidays: frenchHolidays(year) });
  } catch (err) {
    console.error('[calendar-generator] GET /holidays error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /ask-date — free-text French question → resolved date + linked weekend
// Body: { question: "Quel est le jour de Pâques en 2027 ?" }
// Response: { date, label, year, confidence, explanation, weekend: {saturday, sunday} }
//        OR { error: "...", explanation: "..." } when the model can't resolve.
router.post('/ask-date', authenticateToken, requireCalendarGenerator, requireAdmin, async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== 'string' || question.trim().length < 3) {
    return res.status(400).json({ error: 'Question requise (au moins 3 caractères).' });
  }
  if (question.length > 300) {
    return res.status(400).json({ error: 'Question trop longue (300 caractères max).' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Service IA non configuré (ANTHROPIC_API_KEY manquante).' });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const todayIso = new Date().toISOString().slice(0, 10);

    const systemPrompt = `Tu es un assistant qui résout en français des questions sur des dates (jours fériés, fêtes folkloriques françaises, événements récurrents, dates précises).

Date d'aujourd'hui (référence) : ${todayIso}

Tu dois retourner UNIQUEMENT un objet JSON valide (pas de markdown, pas de texte hors JSON) avec cette structure :
{
  "date": "YYYY-MM-DD",
  "label": "<libellé court de l'événement, ex: 'Pâques 2027'>",
  "year": <année extraite>,
  "confidence": "high" | "medium" | "low",
  "explanation": "<phrase courte qui justifie la date trouvée>"
}

RÈGLES :
1. Si l'utilisateur ne précise pas l'année, déduis-la du contexte (saison sportive en cours = septembre→août). Si vraiment ambigu, prends l'année prochaine la plus proche.
2. Si la question concerne plusieurs dates (ex. "vacances scolaires") ou une période, réponds avec la DATE DE DÉBUT et précise dans "explanation" qu'il s'agit du début de la période.
3. Si tu ne peux pas répondre avec certitude (date qui dépend de la zone, événement non identifiable), retourne :
   { "error": "Date introuvable", "explanation": "<raison courte>" }
4. Pâques, Ascension, Pentecôte, Fête des Mères, Fête des Pères : utilise les règles canoniques françaises (Computus pour Pâques ; Ascension = Pâques + 39 jours ; Fête des Mères = dernier dimanche de mai ou 1er dimanche de juin si Pentecôte ; Fête des Pères = 3e dimanche de juin).
5. Pour des dates fixes (14 juillet, 25 décembre…), réponds directement.

Réponds avec JSON valide uniquement.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: question.trim() }]
    });

    const raw = (message.content?.[0]?.text || '').trim();
    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'Réponse IA non parsable', raw });
    }

    if (parsed.error) {
      return res.status(200).json(parsed);
    }
    if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
      return res.status(502).json({ error: 'Date invalide retournée par l\'IA', received: parsed });
    }

    parsed.weekend = weekendForDate(parsed.date);
    res.json(parsed);
  } catch (err) {
    console.error('[calendar-generator] POST /ask-date error:', err);
    res.status(500).json({ error: err.message || 'Erreur IA' });
  }
});

// ----------------------------------------------------------------
// Phase 5a — Deterministic generation
// ----------------------------------------------------------------

const { generateCalendar } = require('../utils/calendar-engine');

// Helper: load full context for the engine (brief + constraints + ligue + categories + clubs)
function loadEngineContext(orgId, briefId, cb) {
  const db = getDb();
  db.get(
    `SELECT * FROM calendar_brief WHERE id = $1 AND organization_id = $2`,
    [briefId, orgId],
    (err, brief) => {
      if (err) return cb(err);
      if (!brief) return cb(new Error('Brief introuvable'));

      // Parse JSONB fields if stored as text
      ['blackout_dates', 'active_categories', 'active_hosts', 'host_blackouts'].forEach(k => {
        if (typeof brief[k] === 'string') {
          try { brief[k] = JSON.parse(brief[k]); } catch (_) { brief[k] = []; }
        }
        if (!Array.isArray(brief[k])) brief[k] = [];
      });

      db.all(
        `SELECT id, rule_type, parameters, strictness, weight, enabled
         FROM calendar_constraints WHERE organization_id = $1`,
        [orgId],
        (err2, constraints) => {
          if (err2) return cb(err2);
          (constraints || []).forEach(c => {
            if (typeof c.parameters === 'string') {
              try { c.parameters = JSON.parse(c.parameters); } catch (_) { c.parameters = {}; }
            }
          });

          db.all(
            `SELECT category_id, final_date FROM ligue_final_dates
             WHERE organization_id = $1 AND season = $2`,
            [orgId, brief.season],
            (err3, ligueRows) => {
              if (err3) return cb(err3);
              const ligueFinals = {};
              (ligueRows || []).forEach(r => {
                if (!r.final_date) return;
                const d = r.final_date instanceof Date
                  ? r.final_date.toISOString().slice(0, 10)
                  : String(r.final_date).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
                if (d) ligueFinals[r.category_id] = d;
              });

              db.all(
                `SELECT id, game_type, level, display_name FROM categories
                 WHERE (organization_id = $1 OR organization_id IS NULL)
                   AND COALESCE(is_active, TRUE) = TRUE`,
                [orgId],
                (err4, categories) => {
                  if (err4) return cb(err4);

                  db.all(
                    `SELECT id, display_name FROM clubs
                     WHERE ($1::int IS NULL OR organization_id = $1)`,
                    [orgId],
                    (err5, clubs) => {
                      if (err5) return cb(err5);
                      cb(null, { brief, constraints: constraints || [], ligueFinals, categories: categories || [], clubs: clubs || [] });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
}

// POST /generate — body: { brief_id }
// Runs the engine, replaces calendar_draft for that brief, returns result.
router.post('/generate', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.body?.brief_id, 10);
  const overrides = req.body?.constraint_overrides || {}; // { rule_type: { parameters?: {}, weight?: N, enabled?: bool } }
  const respectLocks = req.body?.respect_locks === true;
  if (!briefId) return res.status(400).json({ error: 'brief_id requis' });

  loadEngineContext(orgId, briefId, (err, ctx) => {
    if (err) {
      console.error('[calendar-generator] /generate context error:', err);
      return res.status(500).json({ error: err.message });
    }

    // Merge ephemeral overrides into constraints (does NOT persist)
    if (overrides && typeof overrides === 'object') {
      for (const ruleType of Object.keys(overrides)) {
        const ov = overrides[ruleType];
        let existing = ctx.constraints.find(c => c.rule_type === ruleType);
        if (!existing) {
          // Synthesize an ephemeral instance from catalog defaults
          const meta = RULES_CATALOG[ruleType];
          if (!meta) continue;
          existing = {
            rule_type: ruleType,
            parameters: { ...(meta.defaultParams || {}) },
            strictness: meta.strictness,
            weight: meta.defaultWeight ?? 1,
            enabled: true
          };
          ctx.constraints.push(existing);
        }
        if (ov.parameters) existing.parameters = { ...(existing.parameters || {}), ...ov.parameters };
        if (ov.weight !== undefined) existing.weight = ov.weight;
        if (ov.enabled !== undefined) existing.enabled = ov.enabled;
      }
    }

    const db = getDb();

    // Helper to load locked placements then run the engine
    const loadLockedThenGenerate = () => new Promise((resolve, reject) => {
      if (!respectLocks) return resolve([]);
      db.all(
        `SELECT cd.category_id, cd.tournament_type, cd.weekend_date,
                cd.host_club_id AS host_id,
                cl.display_name AS host_name
         FROM calendar_draft cd
         LEFT JOIN clubs cl ON cl.id = cd.host_club_id
         WHERE cd.brief_id = $1 AND cd.locked_by_user = TRUE`,
        [briefId],
        (e, rows) => {
          if (e) return reject(e);
          (rows || []).forEach(r => {
            if (r.weekend_date instanceof Date) r.weekend_date = r.weekend_date.toISOString().slice(0, 10);
            else if (typeof r.weekend_date === 'string') {
              const m = r.weekend_date.match(/^\d{4}-\d{2}-\d{2}/);
              r.weekend_date = m ? m[0] : null;
            }
          });
          resolve(rows || []);
        }
      );
    });

    loadLockedThenGenerate().then(lockedPlacements => {
      let result;
      try {
        result = generateCalendar({ ...ctx, lockedPlacements });
      } catch (e) {
        console.error('[calendar-generator] engine error:', e);
        return res.status(500).json({ error: 'Erreur moteur : ' + e.message });
      }

      // Persist: keep locks if respect_locks, wipe everything otherwise
      const lockedKeySet = new Set(lockedPlacements.map(lp => `${lp.category_id}|${lp.tournament_type}`));
      const deleteSql = respectLocks
        ? `DELETE FROM calendar_draft WHERE brief_id = $1 AND locked_by_user = FALSE`
        : `DELETE FROM calendar_draft WHERE brief_id = $1`;

      db.run(deleteSql, [briefId], (delErr) => {
        if (delErr) console.warn('[calendar-generator] DELETE draft warning:', delErr.message);

        // Filter out placements that already exist as locks (don't double-insert)
        const toInsert = result.placements.filter(p =>
          !lockedKeySet.has(`${p.category_id}|${p.tournament_type}`)
        );

        const inserts = toInsert.map(p => new Promise((resolve) => {
          db.run(
            `INSERT INTO calendar_draft
               (brief_id, weekend_date, mode, category_id, tournament_type,
                host_club_id, conflict_flags, locked_by_user)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, FALSE)`,
            [briefId, p.weekend_date, ctx.categories.find(c => c.id === p.category_id)?.game_type || null,
             p.category_id, p.tournament_type, p.host_id, JSON.stringify([])],
            () => resolve()
          );
        }));

        Promise.all(inserts).then(() => {
          res.json({
            ...result,
            placements: result.placements.map(p => ({
              ...p,
              category_label: ctx.categories.find(c => c.id === p.category_id)?.display_name || `cat#${p.category_id}`,
              host_name: ctx.clubs.find(c => c.id === p.host_id)?.display_name || null
            })),
            locked_count: lockedPlacements.length
          });
        });
      });
    }).catch(e => {
      console.error('[calendar-generator] generate error:', e);
      res.status(500).json({ error: e.message });
    });
  });
});

// PATCH /draft/:id — manually edit one placement (date / host / lock / comment)
router.patch('/draft/:id', authenticateToken, requireCalendarGenerator, requireAdmin, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const id = parseInt(req.params.id, 10);
  const { weekend_date, host_club_id, locked_by_user, manual_comment } = req.body || {};
  db.run(
    `UPDATE calendar_draft cd
     SET weekend_date  = COALESCE($1::date, cd.weekend_date),
         host_club_id  = CASE WHEN $2::int IS NULL AND $7::bool THEN NULL ELSE COALESCE($2, cd.host_club_id) END,
         locked_by_user = COALESCE($3::bool, cd.locked_by_user),
         manual_comment = COALESCE($4, cd.manual_comment),
         modified_at = CURRENT_TIMESTAMP
     FROM calendar_brief cb
     WHERE cd.id = $5 AND cb.id = cd.brief_id AND cb.organization_id = $6`,
    [
      weekend_date || null,
      host_club_id != null ? host_club_id : null,
      locked_by_user != null ? locked_by_user : null,
      manual_comment != null ? manual_comment : null,
      id,
      orgId,
      host_club_id === null  // explicit null host (TBD)
    ],
    (err) => {
      if (err) {
        console.error('[calendar-generator] PATCH /draft error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ ok: true });
    }
  );
});

// GET /draft?brief_id=X — fetch persisted draft
router.get('/draft', authenticateToken, requireCalendarGenerator, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.query.brief_id, 10);
  if (!briefId) return res.status(400).json({ error: 'brief_id requis' });

  db.all(
    `SELECT cd.id, cd.weekend_date, cd.tournament_type, cd.host_club_id,
            cd.locked_by_user, cd.manual_comment, cd.modified_at, cd.created_at,
            cd.category_id,
            c.display_name AS category_label, c.game_type, c.level,
            cl.display_name AS host_name
     FROM calendar_draft cd
     JOIN calendar_brief cb ON cb.id = cd.brief_id
     LEFT JOIN categories c ON c.id = cd.category_id
     LEFT JOIN clubs cl ON cl.id = cd.host_club_id
     WHERE cd.brief_id = $1 AND cb.organization_id = $2
     ORDER BY cd.weekend_date ASC, c.display_name ASC`,
    [briefId, orgId],
    (err, rows) => {
      if (err) {
        console.error('[calendar-generator] GET /draft error:', err);
        return res.status(500).json({ error: err.message });
      }
      // Normalize dates
      (rows || []).forEach(r => {
        if (r.weekend_date instanceof Date) r.weekend_date = r.weekend_date.toISOString().slice(0, 10);
        else if (r.weekend_date) {
          const m = String(r.weekend_date).match(/^\d{4}-\d{2}-\d{2}/);
          r.weekend_date = m ? m[0] : null;
        }
      });
      res.json(rows || []);
    }
  );
});

// V 2.0.607 — GET /published-grid?brief_id=X
//   Returns placements shaped exactly like the wizard's `result.placements`
//   array, but sourced from the **published** tournoi_ext rows (read-only
//   "Saison publiée" view). Mirrors the date-range scoping used by
//   /publish/preview so adjacent late/early rows still match.
//
//   Response shape:
//   {
//     placements: [{ category_id, weekend_date, tournament_type,
//                    host_id, host_name, tournoi_ext_id,
//                    _draft_id: null,            // never editable
//                    _locked: false,
//                    _is_ligue_final: bool,
//                    _is_published: true }, ...],
//     summary:    { total, with_host, tbd },
//     brief:      { id, season }
//   }
router.get('/published-grid', authenticateToken, requireCalendarGenerator, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.query.brief_id, 10);
  if (!briefId) return res.status(400).json({ error: 'brief_id requis' });

  const fetchAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const fetchOne = (sql, params) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );

  try {
    const brief = await fetchOne(
      `SELECT id, season, first_weekend, last_weekend
         FROM calendar_brief
        WHERE id = $1 AND organization_id = $2`,
      [briefId, orgId]
    );
    if (!brief) return res.status(404).json({ error: 'Brief introuvable' });

    // Wider window (±60 days) — same logic as /publish/preview.
    const seasonStart = brief.first_weekend
      ? new Date(new Date(brief.first_weekend).getTime() - 60 * 86400000).toISOString().slice(0, 10)
      : `${brief.season.split('-')[0]}-01-01`;
    const seasonEnd = brief.last_weekend
      ? new Date(new Date(brief.last_weekend).getTime() + 60 * 86400000).toISOString().slice(0, 10)
      : `${brief.season.split('-')[1]}-12-31`;

    // Pull all tournoi_ext rows for this org in the season window.
    const rows = await fetchAll(
      `SELECT t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu,
              t.tournament_number,
              c.id   AS category_id,
              c.display_name AS category_label,
              c.game_type, c.level,
              cl.id  AS host_id,
              cl.display_name AS host_name
         FROM tournoi_ext t
         LEFT JOIN categories c
                ON UPPER(c.game_type) = UPPER(t.mode)
               AND UPPER(c.level)     = UPPER(t.categorie)
               AND c.organization_id = t.organization_id
         LEFT JOIN clubs cl
                ON UPPER(TRIM(cl.display_name)) = UPPER(TRIM(t.lieu))
               AND cl.organization_id = t.organization_id
        WHERE t.organization_id = $1
          AND t.debut BETWEEN $2 AND $3
        ORDER BY t.debut ASC, c.display_name ASC`,
      [orgId, seasonStart, seasonEnd]
    );

    // Reverse mapping: tournament_number → tournament_type label.
    const NUMBER_TO_TYPE = { 1: 'T1', 2: 'T2', 3: 'T3', 4: 'Finale', 5: 'LIGUE_FINALE' };

    const placements = rows
      .filter(r => r.category_id != null) // skip rows we can't map to a category
      .map(r => {
        const ttype = NUMBER_TO_TYPE[parseInt(r.tournament_number, 10)] || null;
        const isLF = ttype === 'LIGUE_FINALE';
        const debutStr = r.debut instanceof Date
          ? r.debut.toISOString().slice(0, 10)
          : (String(r.debut || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null);
        return {
          category_id: r.category_id,
          weekend_date: debutStr,
          tournament_type: ttype,
          host_id: isLF ? null : r.host_id,
          host_name: isLF ? 'Ligue' : (r.host_name || r.lieu || null),
          tournoi_ext_id: r.tournoi_id,
          _draft_id: null,        // never editable in this view
          _locked: false,
          _is_ligue_final: isLF,
          _is_published: true
        };
      })
      .filter(p => p.tournament_type && p.weekend_date);

    const summary = {
      total: placements.length,
      with_host: placements.filter(p => p.host_id).length,
      tbd: placements.filter(p => !p.host_id && !p._is_ligue_final).length
    };
    res.json({
      brief: { id: brief.id, season: brief.season },
      placements,
      summary
    });
  } catch (err) {
    console.error('[calendar-generator] /published-grid error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /draft/export?brief_id=X — download the draft as a .xlsx file
router.get('/draft/export', authenticateToken, requireCalendarGenerator, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.query.brief_id, 10);
  if (!briefId) return res.status(400).json({ error: 'brief_id requis' });

  // Load brief + draft + lookups
  const fetchAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const fetchOne = (sql, params) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );

  try {
    const brief = await fetchOne(
      `SELECT id, season, first_weekend, last_weekend FROM calendar_brief WHERE id = $1 AND organization_id = $2`,
      [briefId, orgId]
    );
    if (!brief) return res.status(404).json({ error: 'Brief introuvable' });

    const draft = await fetchAll(
      `SELECT cd.weekend_date, cd.tournament_type,
              c.id AS category_id, c.display_name AS category_label,
              c.game_type, c.level,
              cl.id AS host_id, cl.display_name AS host_name
       FROM calendar_draft cd
       LEFT JOIN categories c ON c.id = cd.category_id
       LEFT JOIN clubs cl ON cl.id = cd.host_club_id
       WHERE cd.brief_id = $1
       ORDER BY cd.weekend_date ASC`,
      [briefId]
    );

    // Append ligue finals from the brief as virtual draft rows so the
    // export shows the full season (CDB + Ligue) like the wizard's
    // Vue Calendrier. They use tournament_type='FL', host_name=null,
    // and a dedicated colour in the type legend.
    const ligueFinalRowsRaw = await fetchAll(
      `SELECT lfd.final_date AS weekend_date,
              c.id            AS category_id,
              c.display_name  AS category_label,
              c.game_type,
              c.level
         FROM ligue_final_dates lfd
         JOIN calendar_brief cb ON cb.organization_id = lfd.organization_id AND cb.season = lfd.season
         LEFT JOIN categories c ON c.id = lfd.category_id
        WHERE cb.id = $1 AND cb.organization_id = $2 AND lfd.final_date IS NOT NULL`,
      [briefId, orgId]
    ).catch(() => []);
    ligueFinalRowsRaw.forEach(r => {
      draft.push({
        weekend_date: r.weekend_date,
        tournament_type: 'FL',
        category_id: r.category_id,
        category_label: r.category_label,
        game_type: r.game_type,
        level: r.level,
        host_id: null,
        host_name: null,
        is_ligue_final: true
      });
    });

    // Helper to normalize PG DATE / Date / ISO string → 'YYYY-MM-DD'
    const isoDate = (s) => {
      if (s == null) return null;
      if (s instanceof Date) return isNaN(s.getTime()) ? null : s.toISOString().slice(0, 10);
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };
    draft.forEach(r => { r.weekend_date = isoDate(r.weekend_date); });
    // Re-sort because we appended at the end
    draft.sort((a, b) => (a.weekend_date || '').localeCompare(b.weekend_date || ''));

    // Order categories canonically (display order)
    const MODE_ORDER = ['Libre', 'Cadre', 'Bande', '3 Bandes'];
    const LR = { N1: 1, N2: 2, N3: 3, R1: 4, R2: 5, R3: 6, R4: 7, R5: 8, D1: 9, D2: 10, D3: 11, NC: 99 };
    const lvlRank = (lvl) => {
      const k = String(lvl || '').toUpperCase().replace(/\s+/g, '').replace(/GC$/, '');
      return LR[k] ?? 50;
    };
    const modeRank = (m) => {
      const i = MODE_ORDER.findIndex(x => x.toLowerCase() === String(m || '').toLowerCase());
      return i === -1 ? 99 : i;
    };

    // Unique categories present in draft
    const catMap = new Map();
    draft.forEach(r => {
      if (r.category_id && !catMap.has(r.category_id)) {
        catMap.set(r.category_id, { id: r.category_id, label: r.category_label, mode: r.game_type, level: r.level });
      }
    });
    const cats = [...catMap.values()].sort((a, b) => {
      const ma = modeRank(a.mode), mb = modeRank(b.mode);
      if (ma !== mb) return ma - mb;
      return lvlRank(a.level) - lvlRank(b.level);
    });

    // Unique hosts (for color mapping)
    const hostMap = new Map();
    draft.forEach(r => {
      if (r.host_id && !hostMap.has(r.host_id)) {
        hostMap.set(r.host_id, r.host_name);
      }
    });

    // V 2.0.612 — full season enumeration (every Saturday Sept→June),
    // matches the HTML view. Empty weekends remain visible as blank
    // columns (same UX as the legacy CDBHS XL).
    const enumerateSaturdaysISO = (startISO, endISO) => {
      if (!startISO || !endISO) return [];
      const start = new Date(startISO + 'T00:00:00Z');
      const end   = new Date(endISO   + 'T00:00:00Z');
      if (isNaN(start) || isNaN(end) || start > end) return [];
      const cur = new Date(start);
      while (cur.getUTCDay() !== 6) cur.setUTCDate(cur.getUTCDate() + 1);
      const out = [];
      while (cur <= end) {
        out.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
      return out;
    };
    let winStart = brief.first_weekend ? isoDate(brief.first_weekend) : null;
    let winEnd   = brief.last_weekend  ? isoDate(brief.last_weekend)  : null;
    if ((!winStart || !winEnd) && brief.season) {
      const m = String(brief.season).match(/^(\d{4})-(\d{4})$/);
      if (m) {
        if (!winStart) winStart = `${m[1]}-09-01`;
        if (!winEnd)   winEnd   = `${m[2]}-06-30`;
      }
    }
    let weekends = enumerateSaturdaysISO(winStart, winEnd);
    // Defensive fallback + include any placement date sitting outside
    // the enumerated window so the cell is still visible.
    const placementDates = [...new Set(draft.map(r => r.weekend_date).filter(Boolean))];
    if (weekends.length === 0) {
      weekends = placementDates.sort();
    } else {
      const set = new Set(weekends);
      placementDates.forEach(d => { if (!set.has(d)) set.add(d); });
      weekends = [...set].sort();
    }

    // Index: { catId: { weekend: { type, host_id, host_name } } }
    const grid = {};
    draft.forEach(r => {
      if (!r.weekend_date) return;
      if (!grid[r.category_id]) grid[r.category_id] = {};
      grid[r.category_id][r.weekend_date] = { type: r.tournament_type, host_id: r.host_id, host_name: r.host_name };
    });

    // Build workbook with rich formatting
    const ExcelJS = require('exceljs');
    const { getOrganizationLogoBuffer } = require('../utils/logo-loader');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Calendrier de la Saison — Kayros';
    wb.created = new Date();

    // Load organization logo (or fallback billiard icon)
    let logoImageId = null;
    try {
      const logoBuffer = await getOrganizationLogoBuffer(orgId);
      if (logoBuffer) {
        logoImageId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
      }
    } catch (e) {
      console.warn('[calendar-generator] logo load skipped:', e.message);
    }

    // Org short name for the title (best-effort lookup)
    let orgName = '';
    try {
      const orgRow = await fetchOne(
        `SELECT COALESCE(short_name, name) AS label FROM organizations WHERE id = $1`,
        [orgId]
      );
      orgName = orgRow?.label || '';
    } catch (_) {}

    // ===== Helpers =====
    const BORDER_THIN = { style: 'thin', color: { argb: 'FFB0B0B0' } };
    const ALL_BORDERS = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
    // V 2.0.612 — palette aligned with the HTML view (poster-quality).
    const TYPE_COLORS = {
      'T1':     'FFD4EDDA', // mint     → dark green text
      'T2':     'FFD4E6F7', // sky      → dark blue
      'T3':     'FFFCE4D3', // peach    → dark orange
      'Finale': 'FFE6DCF2', // lavender → dark purple
      'FL':     'FFFFE5B8'  // orange   → ligue final
    };
    const TYPE_TEXT_COLORS = {
      'T1':     'FF1B5E20',
      'T2':     'FF0D47A1',
      'T3':     'FFBF360C',
      'Finale': 'FF4A148C',
      'FL':     'FF8A4A00'
    };
    const HEADER_BG = 'FF6B3AA3';     // purple
    const HEADER_TEXT_COLOR = 'FFFFFFFF';
    const ALT_ROW_BG = 'FFF7F7F7';
    const MONTH_NAMES_FR = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const monthLabel = (iso) => {
      const d = new Date(iso + 'T00:00:00Z');
      return `${MONTH_NAMES_FR[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
    };

    // ===== Sheet 1: Calendar grid (visual, print-ready) =====
    // V 2.0.612 — frozen split now covers 4 header rows
    // (title + month band + Sat dates + Sun dates).
    const ws = wb.addWorksheet(`Calendrier ${brief.season}`, {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 8, // A3
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
      },
      properties: { defaultRowHeight: 22 }
    });

    const totalCols = 1 + weekends.length;

    // Row 1: Title (taller to accommodate logo)
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    const titleParts = [`Calendrier saison ${brief.season}`];
    if (orgName) titleParts.push(orgName);
    titleCell.value = '   ' + titleParts.join('  —  ');
    titleCell.font = { bold: true, size: 18, color: { argb: HEADER_TEXT_COLOR } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    ws.getRow(1).height = 48;

    // Embed logo at top-left over the title row (covers ~ first 1.5 cells)
    if (logoImageId !== null) {
      ws.addImage(logoImageId, {
        tl: { col: 0.05, row: 0.10 },
        ext: { width: 56, height: 56 }
      });
    }

    // Row 2: Month header (merged across same month)
    const row2 = ws.getRow(2);
    row2.height = 22;
    ws.getCell(2, 1).value = '';
    ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    ws.getCell(2, 1).border = ALL_BORDERS;
    let monthStart = 2;
    let currentMonth = monthLabel(weekends[0]);
    weekends.forEach((we, idx) => {
      const col = idx + 2;
      const m = monthLabel(we);
      if (m !== currentMonth) {
        if (monthStart < col - 1) ws.mergeCells(2, monthStart, 2, col - 1);
        else ws.mergeCells(2, monthStart, 2, monthStart); // single-cell merge no-op
        const c = ws.getCell(2, monthStart);
        c.value = currentMonth;
        c.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
        c.border = ALL_BORDERS;
        monthStart = col;
        currentMonth = m;
      }
    });
    // Last month range
    if (monthStart <= totalCols) {
      if (monthStart < totalCols) ws.mergeCells(2, monthStart, 2, totalCols);
      const c = ws.getCell(2, monthStart);
      c.value = currentMonth;
      c.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      c.border = ALL_BORDERS;
    }

    // V 2.0.614 — Per-weekend month parity + left-border flag for the
    // first column of each new month. Drives alternating column tints
    // and stronger month dividers throughout the grid (matches the
    // HTML view and the legacy CDBHS XL).
    const monthParity = {};
    const newMonth = {};
    {
      let parity = 0;
      let lastKey = null;
      weekends.forEach((we, i) => {
        const d = new Date(we + 'T00:00:00Z');
        const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
        const isNew = lastKey !== null && k !== lastKey;
        if (isNew) parity = 1 - parity;
        lastKey = k;
        monthParity[we] = parity;
        newMonth[i] = isNew;
      });
    }
    const MONTH_TINT_A = 'FFFFFFFF'; // white
    const MONTH_TINT_B = 'FFF0ECF6'; // very light purple
    const BORDER_MONTH = { style: 'medium', color: { argb: 'FF5A3094' } };

    // V 2.0.612 — Row 3: Saturday dates ("S NN"), Row 4: Sunday dates ("D NN").
    // The "Catégorie" label spans rows 3+4 on the left.
    ws.mergeCells(3, 1, 4, 1);
    const catHeader = ws.getCell(3, 1);
    catHeader.value = 'Catégorie';
    catHeader.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
    catHeader.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    catHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    catHeader.border = ALL_BORDERS;

    const HEADER_BG_LIGHT = 'FF7D52B8'; // Sunday row — lighter purple
    const row3 = ws.getRow(3); row3.height = 22;
    const row4 = ws.getRow(4); row4.height = 22;
    weekends.forEach((we, idx) => {
      const col = idx + 2;
      const sat = new Date(we + 'T00:00:00Z');
      const sun = new Date(sat); sun.setUTCDate(sat.getUTCDate() + 1);

      // V 2.0.614 — first-of-month columns get a thick purple left border.
      const headerBorder = newMonth[idx]
        ? { ...ALL_BORDERS, left: BORDER_MONTH }
        : ALL_BORDERS;

      const cSat = ws.getCell(3, col);
      cSat.value = `S ${String(sat.getUTCDate()).padStart(2, '0')}`;
      cSat.font = { bold: true, color: { argb: HEADER_TEXT_COLOR }, size: 10 };
      cSat.alignment = { horizontal: 'center', vertical: 'middle' };
      cSat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cSat.border = headerBorder;

      const cSun = ws.getCell(4, col);
      cSun.value = `D ${String(sun.getUTCDate()).padStart(2, '0')}`;
      cSun.font = { color: { argb: HEADER_TEXT_COLOR }, size: 10 };
      cSun.alignment = { horizontal: 'center', vertical: 'middle' };
      cSun.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_LIGHT } };
      cSun.border = headerBorder;
    });

    // Column widths
    ws.getColumn(1).width = 26;
    for (let i = 2; i <= totalCols; i++) ws.getColumn(i).width = 8;

    // V 2.0.612 — data rows start at row 5 (header is now 4 rows tall).
    // Cells coloured by ROUND TYPE (not host). Mode dividers: thin
    // bottom border between same-mode levels, thick purple when the
    // mode changes (Libre → Bande → 3 Bandes → Cadre).
    const BORDER_THICK = { style: 'medium', color: { argb: 'FF6B3AA3' } };
    cats.forEach((c, rowIdx) => {
      const next = cats[rowIdx + 1];
      const modeWillChange = !!next && (String(c.mode || '').toLowerCase() !== String(next.mode || '').toLowerCase());
      const isLast = rowIdx === cats.length - 1;
      const bottomBorder = (isLast || modeWillChange) ? BORDER_THICK : BORDER_THIN;
      const rowBorders = { top: BORDER_THIN, bottom: bottomBorder, left: BORDER_THIN, right: BORDER_THIN };

      const r = ws.getRow(5 + rowIdx);
      r.height = 30;
      const labelCell = r.getCell(1);
      labelCell.value = c.label;
      labelCell.font = { bold: true, size: 11 };
      labelCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      labelCell.border = rowBorders;
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

      weekends.forEach((we, idx) => {
        const col = idx + 2;
        const cell = r.getCell(col);
        const placement = grid[c.id]?.[we];
        // V 2.0.614 — first-of-month columns get a thick purple left border;
        // also keep mode-change bottom borders.
        cell.border = newMonth[idx]
          ? { ...rowBorders, left: BORDER_MONTH }
          : rowBorders;
        if (placement) {
          const typeLabel = placement.type;
          let hostAbbr = '';
          if (typeLabel === 'FL')                  hostAbbr = 'Ligue';
          else if (placement.host_name)             hostAbbr = abbreviate(placement.host_name);
          else if (typeLabel === 'Finale')          hostAbbr = 'TBD';
          cell.value = hostAbbr ? `${typeLabel}\n${hostAbbr}` : typeLabel;
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.font = {
            bold: true,
            size: 10,
            color: { argb: TYPE_TEXT_COLORS[typeLabel] || 'FF222222' }
          };
          if (TYPE_COLORS[typeLabel]) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TYPE_COLORS[typeLabel] } };
          }
        } else {
          // Alternating monthly tint for empty cells.
          const tint = monthParity[we] === 1 ? MONTH_TINT_B : MONTH_TINT_A;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
        }
      });
    });

    // V 2.0.612 — Type legend first (since cells are now coloured by
    // round type, not by host). Filled pastel pills with matching
    // text colour, mirroring the HTML view.
    const typeLegendRow = 5 + cats.length + 2;
    const tlTitle = ws.getCell(typeLegendRow, 1);
    tlTitle.value = 'Légende tournois';
    tlTitle.font = { bold: true, size: 13, color: { argb: HEADER_BG } };
    tlTitle.alignment = { vertical: 'middle' };
    const TYPE_LEGEND_LABELS = { T1: 'T1 — Tournoi 1', T2: 'T2 — Tournoi 2', T3: 'T3 — Tournoi 3', Finale: 'F — Finale', FL: 'FL — Finale Ligue' };
    let tCol = 2;
    Object.entries(TYPE_COLORS).forEach(([type, bg]) => {
      // Each pill spans 3 columns so the label is readable.
      ws.mergeCells(typeLegendRow, tCol, typeLegendRow, tCol + 2);
      const sw = ws.getCell(typeLegendRow, tCol);
      sw.value = TYPE_LEGEND_LABELS[type] || type;
      sw.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      sw.font = { bold: true, size: 11, color: { argb: TYPE_TEXT_COLORS[type] || 'FF222222' } };
      sw.alignment = { horizontal: 'center', vertical: 'middle' };
      sw.border = ALL_BORDERS;
      tCol += 4; // 3 merged + 1 gap
    });
    ws.getRow(typeLegendRow).height = 22;

    // Host legend — textual abbreviation map (no longer colour-coded).
    const hostLegendRow = typeLegendRow + 2;
    const hlTitle = ws.getCell(hostLegendRow, 1);
    hlTitle.value = 'Clubs hôtes';
    hlTitle.font = { bold: true, size: 13, color: { argb: HEADER_BG } };
    hlTitle.alignment = { vertical: 'middle' };
    const hostAbbrPairs = [...hostMap.entries()]
      .map(([id, name]) => [abbreviate(name), name])
      .sort((a, b) => a[0].localeCompare(b[0]));
    hostAbbrPairs.forEach(([ab, name], idx) => {
      const r = ws.getRow(hostLegendRow + 1 + idx);
      r.height = 20;
      const cAb = r.getCell(2);
      cAb.value = ab;
      cAb.font = { bold: true, size: 11, color: { argb: HEADER_BG } };
      cAb.alignment = { horizontal: 'center', vertical: 'middle' };
      cAb.border = ALL_BORDERS;
      ws.mergeCells(hostLegendRow + 1 + idx, 3, hostLegendRow + 1 + idx, 8);
      const cName = r.getCell(3);
      cName.value = name;
      cName.alignment = { vertical: 'middle', indent: 1 };
      cName.font = { size: 11 };
      cName.border = ALL_BORDERS;
    });

    // ===== Sheet 2: List of tournaments (sortable, with auto-filter) =====
    const wsList = wb.addWorksheet('Liste des tournois', {
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });
    const listHeader = wsList.addRow(['Date WE', 'Mode', 'Catégorie', 'Type', 'Club hôte']);
    listHeader.eachCell(cell => {
      cell.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.border = ALL_BORDERS;
    });
    listHeader.height = 22;
    wsList.columns = [
      { width: 14 }, { width: 12 }, { width: 26 }, { width: 10 }, { width: 34 }
    ];
    draft.forEach((r, idx) => {
      let hostLabel;
      if (r.tournament_type === 'FL') hostLabel = 'TBD (Ligue)';
      else if (r.host_name) hostLabel = r.host_name;
      else if (r.tournament_type === 'Finale') hostLabel = 'TBD';
      else hostLabel = '';
      const row = wsList.addRow([
        r.weekend_date || '',
        r.game_type || '',
        r.category_label || '',
        r.tournament_type || '',
        hostLabel
      ]);
      row.eachCell((cell, colNumber) => {
        cell.border = ALL_BORDERS;
        cell.alignment = { vertical: 'middle' };
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_BG } };
        if (colNumber === 4 && TYPE_COLORS[cell.value]) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TYPE_COLORS[cell.value] } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { bold: true };
        }
      });
    });
    // Auto-filter
    wsList.autoFilter = { from: 'A1', to: `E${draft.length + 1}` };
    wsList.views = [{ state: 'frozen', ySplit: 1 }];

    // ===== Sheet 3: Légende clubs (separate, large) =====
    // V 2.0.612 — Sheet 3: textual abbreviation map (no colour coding).
    const wsLeg = wb.addWorksheet('Clubs hôtes');
    const legHeader = wsLeg.addRow(['Abréviation', 'Nom du club']);
    legHeader.eachCell(c => {
      c.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      c.border = ALL_BORDERS;
    });
    legHeader.height = 22;
    wsLeg.getColumn(1).width = 14;
    wsLeg.getColumn(2).width = 40;
    hostAbbrPairs.forEach(([ab, name]) => {
      const r = wsLeg.addRow([ab, name]);
      r.height = 22;
      r.eachCell((c, col) => {
        c.border = ALL_BORDERS;
        c.alignment = { vertical: 'middle', indent: 1, horizontal: col === 1 ? 'center' : 'left' };
        c.font = col === 1
          ? { bold: true, size: 11, color: { argb: HEADER_BG } }
          : { size: 11 };
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Calendrier ${brief.season}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[calendar-generator] /draft/export error:', err);
    res.status(500).json({ error: err.message });
  }
});

function abbreviate(name) {
  if (!name) return '';
  // Take first letters of each significant word, max 4 chars
  const words = String(name).split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return name.slice(0, 4).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
}

// ----------------------------------------------------------------
// Phase 7 — Publish
// ----------------------------------------------------------------
//
// Maps calendar_draft.tournament_type → tournoi_ext.tournament_number,
// matching the heuristic used in the legacy import (db-postgres.js
// line 525-534). Keep in lock-step with that mapping.
// LIGUE_FINALE = 5 is reserved for ligue-organized finals (visible to
// players as informational tournoi_ext rows; not subject to inscriptions).
const TOURNAMENT_TYPE_TO_NUMBER = { T1: 1, T2: 2, T3: 3, FINALE: 4, LIGUE_FINALE: 5 };

function tournamentNameForRow(row) {
  // Build the human-friendly name: e.g. "T1 Bande R2", "Finale Cadre 42/2 R1",
  // "Finale Ligue 3 Bandes R2".
  const cat = (row.category_label || `${row.game_type || ''} ${row.level || ''}`).trim();
  let prefix;
  if (row.tournament_type === 'FINALE') prefix = 'Finale';
  else if (row.tournament_type === 'LIGUE_FINALE') prefix = 'Finale Ligue';
  else prefix = row.tournament_type;
  return `${prefix} ${cat}`.trim();
}

// Loads the ligue-final dates declared in the brief and returns them as
// virtual draft rows (same shape as calendar_draft rows used by /publish).
// These are inserted into tournoi_ext at publish time with lieu='TBD'.
async function fetchLigueFinalRows(db, briefId, orgId) {
  const fetchAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const rows = await fetchAll(
    `SELECT lfd.id           AS lfd_id,
            lfd.final_date   AS weekend_date,
            lfd.category_id,
            c.display_name   AS category_label,
            c.game_type,
            c.level
       FROM ligue_final_dates lfd
       JOIN calendar_brief cb ON cb.organization_id = lfd.organization_id AND cb.season = lfd.season
       LEFT JOIN categories c ON c.id = lfd.category_id
      WHERE cb.id = $1 AND cb.organization_id = $2 AND lfd.final_date IS NOT NULL
      ORDER BY lfd.final_date ASC`,
    [briefId, orgId]
  );
  return rows.map(r => ({
    id: `lf-${r.lfd_id}`,           // virtual draft id; never written to calendar_draft
    weekend_date: r.weekend_date instanceof Date
      ? r.weekend_date.toISOString().slice(0, 10)
      : (String(r.weekend_date || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null),
    tournament_type: 'LIGUE_FINALE',
    host_club_id: null,
    category_id: r.category_id,
    tournoi_ext_id: null,
    category_label: r.category_label,
    game_type: r.game_type,
    level: r.level,
    host_name: null,
    host_city: null,
    _virtual: true                  // marker so /publish doesn't UPDATE calendar_draft
  }));
}

// GET /publish/preview?brief_id=X
//   Returns the per-row classification (safe / sensitive / blocked) without
//   making any DB changes. The frontend uses this to render the Step 6
//   summary table BEFORE the admin clicks "Publier".
//
// Classification rules:
//   - blocked   → a tournoi_ext row with same (org, season, mode, categorie,
//                  tournament_number) already exists AND has tournament_results
//   - sensitive → same match exists AND has inscriptions (but no results)
//   - safe      → no existing tournoi_ext row, OR row exists but is empty
//
// The match key is (organization_id, season, UPPER(mode), UPPER(categorie),
// tournament_number). We use case-insensitive matching for safety since
// data sources sometimes uppercase the mode.
router.get('/publish/preview', authenticateToken, requireCalendarGenerator, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.query.brief_id, 10);
  if (!briefId) return res.status(400).json({ error: 'brief_id requis' });

  const fetchAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const fetchOne = (sql, params) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );

  try {
    const brief = await fetchOne(
      `SELECT id, season, status, first_weekend, last_weekend FROM calendar_brief WHERE id = $1 AND organization_id = $2`,
      [briefId, orgId]
    );
    if (!brief) return res.status(404).json({ error: 'Brief introuvable' });
    // Date range for matching existing tournoi_ext rows. Pads ±60 days
    // around the brief window so adjacent late/early tournaments still
    // match (rare but cheap).
    const seasonStart = brief.first_weekend
      ? new Date(new Date(brief.first_weekend).getTime() - 60 * 86400000).toISOString().slice(0, 10)
      : `${brief.season.split('-')[0]}-01-01`;
    const seasonEnd = brief.last_weekend
      ? new Date(new Date(brief.last_weekend).getTime() + 60 * 86400000).toISOString().slice(0, 10)
      : `${brief.season.split('-')[1]}-12-31`;

    const draft = await fetchAll(
      `SELECT cd.id, cd.weekend_date, cd.tournament_type, cd.host_club_id,
              cd.category_id, cd.tournoi_ext_id,
              c.display_name AS category_label, c.game_type, c.level,
              cl.display_name AS host_name
         FROM calendar_draft cd
         JOIN calendar_brief cb ON cb.id = cd.brief_id
         LEFT JOIN categories c  ON c.id  = cd.category_id
         LEFT JOIN clubs cl      ON cl.id = cd.host_club_id
        WHERE cd.brief_id = $1 AND cb.organization_id = $2
        ORDER BY cd.weekend_date ASC`,
      [briefId, orgId]
    );

    // Ligue finals from the brief — surfaced as virtual rows so the
    // publish step can emit them as tournoi_ext entries with lieu='TBD'.
    const ligueFinalRows = await fetchLigueFinalRows(db, briefId, orgId).catch(() => []);
    const allRows = [...draft, ...ligueFinalRows];

    const items = [];
    for (const row of allRows) {
      const tnum = TOURNAMENT_TYPE_TO_NUMBER[row.tournament_type] || null;
      const mode = row.game_type || '';
      const categorie = row.level || '';

      // Look up an existing tournoi_ext row for the same identity tuple.
      // tournoi_ext has no `saison` column — we scope by debut date range
      // pulled from the brief (first_weekend / last_weekend, falling back
      // to a wide window when missing).
      const existing = await fetchOne(
        `SELECT t.tournoi_id,
                (SELECT COUNT(*) FROM inscriptions i WHERE i.tournoi_id = t.tournoi_id) AS insc_count,
                (SELECT COUNT(*) FROM tournament_results tr
                   JOIN tournaments tt ON tt.id = tr.tournament_id
                  WHERE tt.tournoi_ext_id = t.tournoi_id) AS result_count
           FROM tournoi_ext t
          WHERE t.organization_id = $1
            AND UPPER(t.mode) = UPPER($2)
            AND UPPER(t.categorie) = UPPER($3)
            AND t.tournament_number = $4
            AND t.debut BETWEEN $5 AND $6`,
        [orgId, mode, categorie, tnum, seasonStart, seasonEnd]
      ).catch(() => null);

      let classification = 'safe';
      let existingId = null;
      if (existing) {
        existingId = existing.tournoi_id;
        const r = parseInt(existing.result_count, 10) || 0;
        const i = parseInt(existing.insc_count, 10) || 0;
        if (r > 0) classification = 'blocked';
        else if (i > 0) classification = 'sensitive';
        else classification = 'safe'; // exists but empty → can be updated in place
      }

      items.push({
        draft_id: row.id,
        tournoi_ext_id: existingId,
        weekend_date: row.weekend_date instanceof Date
          ? row.weekend_date.toISOString().slice(0, 10)
          : (String(row.weekend_date || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null),
        tournament_type: row.tournament_type,
        category_label: row.category_label || `${mode} ${categorie}`.trim(),
        host_name: row.tournament_type === 'LIGUE_FINALE' ? 'TBD' : (row.host_name || ''),
        is_ligue_final: row.tournament_type === 'LIGUE_FINALE',
        classification,
        action: existingId ? (classification === 'blocked' ? 'skip' : 'update') : 'create'
      });
    }

    const summary = {
      safe:      items.filter(i => i.classification === 'safe').length,
      sensitive: items.filter(i => i.classification === 'sensitive').length,
      blocked:   items.filter(i => i.classification === 'blocked').length,
      total:     items.length
    };
    res.json({ brief, items, summary });
  } catch (err) {
    console.error('[calendar-generator] /publish/preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /publish
//   Body: { brief_id, force_sensitive?: boolean }
//   - force_sensitive=true: also publishes sensitive rows (admin opt-in)
//   - blocked rows are always skipped
//
// For each "create" or "update" action:
//   - INSERT or UPDATE the tournoi_ext row
//   - Update calendar_draft.tournoi_ext_id with the resulting id
//   - Log to calendar_sync_log
//   - Fire NEW_TOURNAMENT auto-publisher (fire-and-forget; idempotent
//     via partial unique index on (org, source_type, source_ref_id))
//
// At the end, set calendar_brief.status = 'published'.
router.post('/publish', authenticateToken, requireCalendarGenerator, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.body.brief_id, 10);
  const forceSensitive = req.body.force_sensitive === true;
  if (!briefId) return res.status(400).json({ error: 'brief_id requis' });

  const dbAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
  );
  const dbGet = (sql, params) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );
  const dbRun = (sql, params) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); })
  );

  try {
    const brief = await dbGet(
      `SELECT id, season, first_weekend, last_weekend FROM calendar_brief WHERE id = $1 AND organization_id = $2`,
      [briefId, orgId]
    );
    if (!brief) return res.status(404).json({ error: 'Brief introuvable' });
    const seasonStart = brief.first_weekend
      ? new Date(new Date(brief.first_weekend).getTime() - 60 * 86400000).toISOString().slice(0, 10)
      : `${brief.season.split('-')[0]}-01-01`;
    const seasonEnd = brief.last_weekend
      ? new Date(new Date(brief.last_weekend).getTime() + 60 * 86400000).toISOString().slice(0, 10)
      : `${brief.season.split('-')[1]}-12-31`;

    // Pull draft rows to publish
    const draft = await dbAll(
      `SELECT cd.id, cd.weekend_date, cd.tournament_type, cd.host_club_id,
              cd.category_id, cd.tournoi_ext_id,
              c.display_name AS category_label, c.game_type, c.level,
              cl.display_name AS host_name, cl.city AS host_city
         FROM calendar_draft cd
         LEFT JOIN categories c ON c.id = cd.category_id
         LEFT JOIN clubs cl     ON cl.id = cd.host_club_id
        WHERE cd.brief_id = $1
        ORDER BY cd.weekend_date ASC`,
      [briefId]
    );

    // Append ligue finals as virtual rows (lieu='TBD', no host).
    const ligueFinalRows = await fetchLigueFinalRows(db, briefId, orgId).catch(() => []);
    const allRows = [...draft, ...ligueFinalRows];

    let createdCount = 0, updatedCount = 0, skippedCount = 0;
    const rowErrors = []; // diagnostic: per-row failures, returned to client
    const outcomes  = []; // per-row final state, returned so the frontend
                          // can flip the action labels to past tense.
    // V 2.0.599 — calendar publish is intentionally side-effect-free:
    // it touches tournoi_ext only, never news articles or push
    // notifications. Calendar creation is iterative; the season is
    // announced separately through normal channels (email + push + WP)
    // when admins are ready.
    let nextTournoiId = ((await dbGet(`SELECT MAX(tournoi_id) AS max_id FROM tournoi_ext`))?.max_id || 0);

    for (const row of allRows) {
      const tnum = TOURNAMENT_TYPE_TO_NUMBER[row.tournament_type] || null;
      const mode = row.game_type || '';
      const categorie = row.level || '';
      const lieu = row.tournament_type === 'LIGUE_FINALE'
        ? 'TBD'
        : (row.host_name || '') + (row.host_city ? ` (${row.host_city})` : '');
      const debut = row.weekend_date instanceof Date
        ? row.weekend_date.toISOString().slice(0, 10)
        : String(row.weekend_date || '').slice(0, 10);
      const nom = tournamentNameForRow(row);

      try {

      // Re-classify per row to be safe (preview may be stale).
      // tournoi_ext has no `saison` column — match by date range pulled
      // from the brief window (same heuristic as /publish/preview).
      const existing = await dbGet(
        `SELECT t.tournoi_id,
                (SELECT COUNT(*) FROM inscriptions i WHERE i.tournoi_id = t.tournoi_id) AS insc_count,
                (SELECT COUNT(*) FROM tournament_results tr
                   JOIN tournaments tt ON tt.id = tr.tournament_id
                  WHERE tt.tournoi_ext_id = t.tournoi_id) AS result_count
           FROM tournoi_ext t
          WHERE t.organization_id = $1
            AND UPPER(t.mode) = UPPER($2)
            AND UPPER(t.categorie) = UPPER($3)
            AND t.tournament_number = $4
            AND t.debut BETWEEN $5 AND $6`,
        [orgId, mode, categorie, tnum, seasonStart, seasonEnd]
      ).catch(() => null);

      const hasResults = existing ? (parseInt(existing.result_count, 10) || 0) > 0 : false;
      const hasInsc    = existing ? (parseInt(existing.insc_count, 10) || 0) > 0 : false;

      if (existing && hasResults) {
        skippedCount++;
        outcomes.push({ draft_id: row._virtual ? null : row.id, status: 'skipped' });
        await dbRun(
          `INSERT INTO calendar_sync_log (organization_id, brief_id, action, tournoi_ext_id, change_type, summary, triggered_by)
           VALUES ($1, $2, 'skip', $3, 'blocked', $4, $5)`,
          [orgId, briefId, existing.tournoi_id, `${nom} — résultats existants, non touché`, req.user.userId || null]
        );
        continue;
      }
      if (existing && hasInsc && !forceSensitive) {
        skippedCount++;
        outcomes.push({ draft_id: row._virtual ? null : row.id, status: 'skipped' });
        await dbRun(
          `INSERT INTO calendar_sync_log (organization_id, brief_id, action, tournoi_ext_id, change_type, summary, triggered_by)
           VALUES ($1, $2, 'skip', $3, 'sensitive', $4, $5)`,
          [orgId, briefId, existing.tournoi_id, `${nom} — inscriptions existantes, force_sensitive non activé`, req.user.userId || null]
        );
        continue;
      }

      let resultingId;
      if (existing) {
        // UPDATE in place — preserves tournoi_id and any downstream FK.
        resultingId = existing.tournoi_id;
        await dbRun(
          `UPDATE tournoi_ext
              SET nom = $1, debut = $2, lieu = $3, taille = NULL
            WHERE tournoi_id = $4`,
          [nom, debut, lieu, resultingId]
        );
        updatedCount++;
        outcomes.push({ draft_id: row._virtual ? null : row.id, status: 'updated' });
        await dbRun(
          `INSERT INTO calendar_sync_log (organization_id, brief_id, action, tournoi_ext_id, change_type, summary, triggered_by)
           VALUES ($1, $2, 'update', $3, $4, $5, $6)`,
          [orgId, briefId, resultingId, hasInsc ? 'sensitive' : 'safe', `${nom} — mis à jour`, req.user.userId || null]
        );
      } else {
        // INSERT new tournoi_ext row.
        nextTournoiId++;
        resultingId = nextTournoiId;
        await dbRun(
          `INSERT INTO tournoi_ext
             (tournoi_id, nom, mode, categorie, taille, debut, lieu, tournament_number, organization_id)
           VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)`,
          [resultingId, nom, mode, categorie, debut, lieu, tnum, orgId]
        );
        createdCount++;
        outcomes.push({ draft_id: row._virtual ? null : row.id, status: 'created' });
        await dbRun(
          `INSERT INTO calendar_sync_log (organization_id, brief_id, action, tournoi_ext_id, change_type, summary, triggered_by)
           VALUES ($1, $2, 'create', $3, 'safe', $4, $5)`,
          [orgId, briefId, resultingId, `${nom} — créé`, req.user.userId || null]
        );
      }

      // Bind draft row → tournoi_ext for traceability. Skip for virtual
      // rows (ligue finals) which never lived in calendar_draft.
      if (!row._virtual) {
        await dbRun(
          `UPDATE calendar_draft SET tournoi_ext_id = $1 WHERE id = $2`,
          [resultingId, row.id]
        );
      }
      } catch (rowErr) {
        // Per-row failure should not abort the whole publish — log it
        // and surface a structured error to the frontend so the admin
        // can see exactly which row blew up and why.
        const ctx = `${nom} (${row.tournament_type}, ${mode}/${categorie}, ${debut}, tnum=${tnum}, ligue=${row._virtual ? 'yes' : 'no'})`;
        console.error('[calendar-generator] /publish row failed:', ctx, rowErr.message, rowErr.stack);
        rowErrors.push({ row: ctx, error: rowErr.message });
      }
    }

    // Mark brief as published.
    await dbRun(
      `UPDATE calendar_brief SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [briefId]
    );

    // V 2.0.599 — NO automatic player-facing side effects from this
    // endpoint. Calendar creation is iterative and purely a database
    // operation; the season is announced separately by admins through
    // their normal channels (email + push + WordPress) when ready.
    // The previous NEW_TOURNAMENT auto-article dispatch was removed.

    res.json({
      success: rowErrors.length === 0,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors: rowErrors,
      outcomes,                 // per-row final state for the frontend
      brief_id: briefId
    });
  } catch (err) {
    console.error('[calendar-generator] /publish error:', err.message, err.stack);
    res.status(500).json({ error: err.message, stack: (err.stack || '').split('\n').slice(0, 4).join(' | ') });
  }
});

module.exports = router;
