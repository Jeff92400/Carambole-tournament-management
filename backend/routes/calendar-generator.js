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

    // Build workbook
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Calendrier Saisonnier — Kayros';
    wb.created = new Date();

    // Sheet 1 — Calendar grid (Excel-style)
    const ws = wb.addWorksheet(`Calendrier ${brief.season}`, {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
    });
    const headerRow = ['Catégorie', ...weekends.map(d => {
      const dt = new Date(d + 'T00:00:00Z');
      return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
    })];
    ws.addRow(headerRow);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getColumn(1).width = 22;
    for (let i = 2; i <= headerRow.length; i++) ws.getColumn(i).width = 11;

    cats.forEach(c => {
      const row = [c.label];
      weekends.forEach(we => {
        const cell = grid[c.id]?.[we];
        if (cell) row.push(`${cell.type}${cell.host_name ? ' / ' + abbreviate(cell.host_name) : ''}`);
        else row.push('');
      });
      const added = ws.addRow(row);
      // Color cells by host
      weekends.forEach((we, idx) => {
        const cell = grid[c.id]?.[we];
        if (cell?.host_id && hostColor.has(cell.host_id)) {
          added.getCell(idx + 2).fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: hostColor.get(cell.host_id) }
          };
          added.getCell(idx + 2).alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    // Sheet 2 — List view (one row per tournament)
    const wsList = wb.addWorksheet('Liste des tournois');
    wsList.addRow(['Date WE', 'Mode', 'Catégorie', 'Type', 'Club hôte']);
    wsList.getRow(1).font = { bold: true };
    wsList.columns = [
      { width: 12 }, { width: 10 }, { width: 24 }, { width: 8 }, { width: 32 }
    ];
    draft.forEach(r => {
      wsList.addRow([
        r.weekend_date || '',
        r.game_type || '',
        r.category_label || '',
        r.tournament_type || '',
        r.host_name || (r.tournament_type === 'Finale' ? 'TBD' : '')
      ]);
    });

    // Sheet 3 — Legend
    const wsLeg = wb.addWorksheet('Légende clubs');
    wsLeg.addRow(['Club', 'Couleur']);
    wsLeg.getRow(1).font = { bold: true };
    wsLeg.getColumn(1).width = 32;
    wsLeg.getColumn(2).width = 12;
    [...hostMap.entries()].forEach(([id, name]) => {
      const r = wsLeg.addRow([name, '']);
      const colorCell = r.getCell(2);
      colorCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hostColor.get(id) } };
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
