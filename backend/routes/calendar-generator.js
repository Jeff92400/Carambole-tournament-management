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
router.get('/constraints', authenticateToken, (req, res) => {
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
router.post('/constraints', authenticateToken, requireAdmin, (req, res) => {
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
router.patch('/constraints/:id', authenticateToken, requireAdmin, (req, res) => {
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
router.delete('/constraints/:id', authenticateToken, requireAdmin, (req, res) => {
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
router.post('/constraints/seed-defaults', authenticateToken, requireAdmin, async (req, res) => {
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

// ----------------------------------------------------------------
// AI: Natural language → structured rule (Phase 4b)
// ----------------------------------------------------------------

// POST /constraints/from-natural-language — translate a French sentence into a draft rule
// Body: { text: "Clichy ne doit jamais accueillir deux week-ends d'affilée" }
// Response: { rule_type, parameters, strictness, weight, explanation, confidence }
// Note: This is a DRAFT — admin must validate before saving via POST /constraints.
router.post('/constraints/from-natural-language', authenticateToken, requireAdmin, async (req, res) => {
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
6. CAS PARTICULIER — Indisponibilité d'un club sur une période (ex. "Clichy indispo en décembre", "Courbevoie fermé du X au Y") : ce n'est PAS une règle logique mais une donnée saisonnière. Retourne OBLIGATOIREMENT :
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
router.post('/generate', authenticateToken, requireAdmin, (req, res) => {
  const orgId = req.user.organizationId;
  const briefId = parseInt(req.body?.brief_id, 10);
  const overrides = req.body?.constraint_overrides || {}; // { rule_type: { parameters?: {}, weight?: N, enabled?: bool } }
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

    let result;
    try {
      result = generateCalendar(ctx);
    } catch (e) {
      console.error('[calendar-generator] engine error:', e);
      return res.status(500).json({ error: 'Erreur moteur : ' + e.message });
    }

    // Persist draft (delete existing, insert new) — best-effort, non-fatal
    const db = getDb();
    db.run(`DELETE FROM calendar_draft WHERE brief_id = $1`, [briefId], (delErr) => {
      if (delErr) console.warn('[calendar-generator] DELETE draft warning:', delErr.message);

      // Insert each placement
      const inserts = result.placements.map(p => new Promise((resolve) => {
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
          // Add display labels for the frontend
          placements: result.placements.map(p => ({
            ...p,
            category_label: ctx.categories.find(c => c.id === p.category_id)?.display_name || `cat#${p.category_id}`,
            host_name: ctx.clubs.find(c => c.id === p.host_id)?.display_name || null
          }))
        });
      });
    });
  });
});

// PATCH /draft/:id — manually edit one placement (date / host / lock / comment)
router.patch('/draft/:id', authenticateToken, requireAdmin, (req, res) => {
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
router.get('/draft', authenticateToken, (req, res) => {
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

// GET /draft/export?brief_id=X — download the draft as a .xlsx file
router.get('/draft/export', authenticateToken, async (req, res) => {
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
      `SELECT id, season FROM calendar_brief WHERE id = $1 AND organization_id = $2`,
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

    // Color palette (mild backgrounds)
    const PALETTE = ['FFFCE4D6', 'FFD9E1F2', 'FFE2EFDA', 'FFFFF2CC', 'FFE4DFEC', 'FFDDEBF7', 'FFFCE4D6', 'FFE7E6E6'];
    const hostColor = new Map();
    [...hostMap.keys()].forEach((id, idx) => hostColor.set(id, PALETTE[idx % PALETTE.length]));

    // Unique weekend dates in chronological order
    const weekends = [...new Set(draft.map(r => r.weekend_date).filter(Boolean))].sort();

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
    wb.creator = 'Calendrier Saisonnier — Kayros';
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
    const TYPE_COLORS = {
      'T1':     'FFE2EFDA', // light green
      'T2':     'FFFFF2CC', // light yellow
      'T3':     'FFFCE4D6', // light orange
      'Finale': 'FFF8CBAD'  // light red/coral
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
    const ws = wb.addWorksheet(`Calendrier ${brief.season}`, {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
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
    const titleParts = ['Calendrier saisonnier'];
    if (orgName) titleParts.push(orgName);
    titleParts.push(`Saison ${brief.season}`);
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

    // Row 3: Week-end dates
    const row3 = ws.getRow(3);
    row3.height = 24;
    const r3Header = ws.getCell(3, 1);
    r3Header.value = 'Catégorie';
    r3Header.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
    r3Header.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    r3Header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    r3Header.border = ALL_BORDERS;
    weekends.forEach((we, idx) => {
      const col = idx + 2;
      const dt = new Date(we + 'T00:00:00Z');
      const c = ws.getCell(3, col);
      c.value = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      c.font = { bold: true, color: { argb: HEADER_TEXT_COLOR }, size: 10 };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      c.border = ALL_BORDERS;
    });

    // Column widths
    ws.getColumn(1).width = 26;
    for (let i = 2; i <= totalCols; i++) ws.getColumn(i).width = 8;

    // Data rows
    cats.forEach((c, rowIdx) => {
      const r = ws.getRow(4 + rowIdx);
      r.height = 28;
      const labelCell = r.getCell(1);
      labelCell.value = c.label;
      labelCell.font = { bold: true, size: 11 };
      labelCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      labelCell.border = ALL_BORDERS;
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowIdx % 2 === 0 ? 'FFFFFFFF' : ALT_ROW_BG } };

      weekends.forEach((we, idx) => {
        const col = idx + 2;
        const cell = r.getCell(col);
        const placement = grid[c.id]?.[we];
        cell.border = ALL_BORDERS;
        if (placement) {
          // Two-line cell: type / abbreviated host
          const typeLabel = placement.type;
          const hostAbbr = placement.host_name ? abbreviate(placement.host_name) : (placement.type === 'Finale' ? 'TBD' : '');
          cell.value = hostAbbr ? `${typeLabel}\n${hostAbbr}` : typeLabel;
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.font = { bold: true, size: 10 };
          // Mix host color (background) and tournament-type color (light tint via top stripe? simulate via cell color)
          // Use HOST color as primary background (ties to legend), and rely on TEXT styling for type
          if (placement.host_id && hostColor.has(placement.host_id)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hostColor.get(placement.host_id) } };
          } else if (TYPE_COLORS[typeLabel]) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TYPE_COLORS[typeLabel] } };
          }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowIdx % 2 === 0 ? 'FFFFFFFF' : ALT_ROW_BG } };
        }
      });
    });

    // Footer with legend below table
    const legendStartRow = 4 + cats.length + 2;
    const legendTitle = ws.getCell(legendStartRow, 1);
    legendTitle.value = 'Légende clubs';
    legendTitle.font = { bold: true, size: 12, color: { argb: HEADER_BG } };
    let legCol = 2;
    [...hostMap.entries()].forEach(([id, name]) => {
      const swatch = ws.getCell(legendStartRow, legCol);
      swatch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hostColor.get(id) } };
      swatch.border = ALL_BORDERS;
      swatch.value = '';
      const lbl = ws.getCell(legendStartRow, legCol + 1);
      lbl.value = name;
      lbl.alignment = { vertical: 'middle' };
      lbl.font = { size: 10 };
      legCol += 2;
    });

    // Type legend below
    const typeLegendRow = legendStartRow + 2;
    const tlTitle = ws.getCell(typeLegendRow, 1);
    tlTitle.value = 'Type';
    tlTitle.font = { bold: true, size: 12, color: { argb: HEADER_BG } };
    let tCol = 2;
    Object.entries(TYPE_COLORS).forEach(([type, color]) => {
      const sw = ws.getCell(typeLegendRow, tCol);
      sw.value = type;
      sw.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      sw.font = { bold: true, size: 10 };
      sw.alignment = { horizontal: 'center', vertical: 'middle' };
      sw.border = ALL_BORDERS;
      tCol += 1;
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
      const row = wsList.addRow([
        r.weekend_date || '',
        r.game_type || '',
        r.category_label || '',
        r.tournament_type || '',
        r.host_name || (r.tournament_type === 'Finale' ? 'TBD' : '')
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
    const wsLeg = wb.addWorksheet('Légende clubs');
    const legHeader = wsLeg.addRow(['Club', 'Couleur']);
    legHeader.eachCell(c => {
      c.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      c.border = ALL_BORDERS;
    });
    legHeader.height = 22;
    wsLeg.getColumn(1).width = 36;
    wsLeg.getColumn(2).width = 18;
    [...hostMap.entries()].forEach(([id, name]) => {
      const r = wsLeg.addRow([name, '']);
      r.height = 24;
      r.eachCell((c, col) => {
        c.border = ALL_BORDERS;
        c.alignment = { vertical: 'middle', indent: 1 };
        c.font = { size: 11 };
        if (col === 2) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hostColor.get(id) } };
        }
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

module.exports = router;
