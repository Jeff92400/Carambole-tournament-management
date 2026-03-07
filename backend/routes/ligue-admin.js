const express = require('express');
const multer = require('multer');
const db = require('../db-loader');
const { authenticateToken, requireLigueAdmin } = require('./auth');
const appSettings = require('../utils/app-settings');

const router = express.Router();
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// All routes require ligue admin or super admin
router.use(authenticateToken, requireLigueAdmin);

// Helper: promisified db calls
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// GET /api/ligue-admin/dashboard — Ligue overview with stats + CDB list
router.get('/dashboard', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    // Ligue info
    const ligue = await dbGet(
      `SELECT numero, nom, email, telephone, website, address,
              CASE WHEN logo_data IS NOT NULL THEN true ELSE false END as has_logo
       FROM ffb_ligues WHERE numero = $1`,
      [ligueNumero]
    );

    // CDBs in this ligue with counts
    const cdbs = await dbAll(`
      SELECT o.id, o.name, o.short_name, o.slug, o.ffb_cdb_code, o.is_active, o.created_at,
        (SELECT COUNT(*) FROM players p WHERE p.organization_id = o.id AND UPPER(p.licence) NOT LIKE 'TEST%') as player_count,
        (SELECT COUNT(*) FROM clubs c WHERE c.organization_id = o.id) as club_count,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id AND u.is_active = 1) as user_count,
        (SELECT COUNT(*) FROM tournoi_ext te WHERE te.organization_id = o.id) as tournament_count
      FROM organizations o
      WHERE o.ffb_ligue_numero = $1
      ORDER BY o.short_name
    `, [ligueNumero]);

    // Aggregate stats
    const stats = {
      cdbs: cdbs.filter(c => c.is_active).length,
      players: cdbs.reduce((sum, c) => sum + parseInt(c.player_count || 0), 0),
      clubs: cdbs.reduce((sum, c) => sum + parseInt(c.club_count || 0), 0),
      tournaments: cdbs.reduce((sum, c) => sum + parseInt(c.tournament_count || 0), 0)
    };

    res.json({ ligue, stats, cdbs });
  } catch (error) {
    console.error('Ligue dashboard error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement du dashboard ligue' });
  }
});

// GET /api/ligue-admin/cdb-comparison — CDB activity comparison within the ligue
router.get('/cdb-comparison', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    const cdbs = await dbAll(`
      SELECT o.id, o.short_name, o.ffb_cdb_code, o.is_active,
        (SELECT COUNT(*) FROM players p WHERE p.organization_id = o.id AND UPPER(p.licence) NOT LIKE 'TEST%') as player_count,
        (SELECT COUNT(*) FROM clubs c WHERE c.organization_id = o.id) as club_count,
        (SELECT COUNT(*) FROM tournoi_ext te WHERE te.organization_id = o.id) as tournament_count,
        COALESCE((
          SELECT ROUND(AVG(sub.cnt), 1)
          FROM (
            SELECT COUNT(*) as cnt
            FROM inscriptions i
            JOIN tournoi_ext te ON i.tournoi_id = te.tournoi_id
            WHERE te.organization_id = o.id
            GROUP BY i.tournoi_id
          ) sub
        ), 0) as avg_inscriptions
      FROM organizations o
      WHERE o.ffb_ligue_numero = $1
      ORDER BY (SELECT COUNT(*) FROM players p WHERE p.organization_id = o.id AND UPPER(p.licence) NOT LIKE 'TEST%') DESC
    `, [ligueNumero]);

    res.json(cdbs);
  } catch (error) {
    console.error('Ligue CDB comparison error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement de la comparaison' });
  }
});

// GET /api/ligue-admin/top-players — Top players across CDBs in the ligue, by game mode
router.get('/top-players', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    const mode = req.query.mode || 'LIBRE';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const season = req.query.season || await appSettings.getCurrentSeason();

    // Resolve game_mode_id from mode code
    const gameMode = await dbGet(
      `SELECT id FROM game_modes WHERE UPPER(code) = UPPER($1)`,
      [mode]
    );
    if (!gameMode) {
      return res.status(400).json({ error: 'Mode invalide' });
    }

    // Get top players from player_ffb_classifications (per-discipline classement)
    const players = await dbAll(`
      SELECT p.first_name, p.last_name, p.licence, pfc.classement as ranking,
             o.short_name as cdb_name, o.ffb_cdb_code,
             COALESCE(fr.level_order, 99) as level_order
      FROM player_ffb_classifications pfc
      JOIN players p ON pfc.licence = p.licence
      JOIN organizations o ON p.organization_id = o.id
      LEFT JOIN ffb_rankings fr ON pfc.classement = fr.code
      WHERE o.ffb_ligue_numero = $1
        AND pfc.game_mode_id = $2
        AND pfc.season = $3
        AND UPPER(p.licence) NOT LIKE 'TEST%'
        AND pfc.classement IS NOT NULL
        AND pfc.classement != ''
        AND UPPER(pfc.classement) != 'NC'
      ORDER BY COALESCE(fr.level_order, 99) ASC, p.last_name ASC
      LIMIT $4
    `, [ligueNumero, gameMode.id, season, limit]);

    res.json(players);
  } catch (error) {
    console.error('Ligue top players error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement des meilleurs joueurs' });
  }
});

// GET /api/ligue-admin/game-modes — Available game modes for tabs
router.get('/game-modes', async (req, res) => {
  try {
    const modes = await dbAll(
      `SELECT code, display_name, color, display_order FROM game_modes WHERE is_active = true ORDER BY display_order`
    );
    res.json(modes);
  } catch (error) {
    console.error('Error fetching game modes:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// GET /api/ligue-admin/ligue-logo — Serve the ligue logo for the current ligue admin
router.get('/ligue-logo', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(404).json({ error: 'Pas de ligue associée' });
    }

    const ligue = await dbGet(
      `SELECT logo_data, logo_content_type FROM ffb_ligues WHERE numero = $1`,
      [ligueNumero]
    );

    if (!ligue || !ligue.logo_data) {
      return res.status(404).json({ error: 'Pas de logo' });
    }

    res.setHeader('Content-Type', ligue.logo_content_type || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(ligue.logo_data);
  } catch (error) {
    console.error('Error serving ligue logo:', error);
    res.status(500).json({ error: 'Erreur' });
  }
});

// PUT /api/ligue-admin/ligue-info — Update own ligue contact info
router.put('/ligue-info', logoUpload.single('logo'), async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    const { email, telephone, website, address } = req.body;

    await dbRun(
      `UPDATE ffb_ligues SET email = $1, telephone = $2, website = $3, address = $4, updated_at = CURRENT_TIMESTAMP WHERE numero = $5`,
      [email || null, telephone || null, website || null, address || null, ligueNumero]
    );

    if (req.file) {
      await dbRun(
        `UPDATE ffb_ligues SET logo_data = $1, logo_content_type = $2, logo_filename = $3, updated_at = CURRENT_TIMESTAMP WHERE numero = $4`,
        [req.file.buffer, req.file.mimetype, req.file.originalname, ligueNumero]
      );
    }

    res.json({ success: true, message: 'Informations mises à jour' });
  } catch (error) {
    console.error('Error updating ligue info:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /api/ligue-admin/ligue-logo — Remove own ligue logo
router.delete('/ligue-logo', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    await dbRun(
      `UPDATE ffb_ligues SET logo_data = NULL, logo_content_type = NULL, logo_filename = NULL, updated_at = CURRENT_TIMESTAMP WHERE numero = $1`,
      [ligueNumero]
    );

    res.json({ success: true, message: 'Logo supprimé' });
  } catch (error) {
    console.error('Error deleting ligue logo:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du logo' });
  }
});

// GET /api/ligue-admin/upcoming-tournaments — Cross-CDB upcoming tournaments
router.get('/upcoming-tournaments', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    const tournaments = await dbAll(`
      SELECT te.tournoi_id, te.debut, te.nom, te.mode, te.categorie, te.lieu,
             o.short_name as cdb_name,
             COUNT(i.inscription_id) as inscription_count
      FROM tournoi_ext te
      JOIN organizations o ON te.organization_id = o.id
      LEFT JOIN inscriptions i ON i.tournoi_id = te.tournoi_id AND i.forfait != 1
      WHERE o.ffb_ligue_numero = $1 AND te.debut >= CURRENT_DATE
      GROUP BY te.tournoi_id, te.debut, te.nom, te.mode, te.categorie, te.lieu, o.short_name
      ORDER BY te.debut ASC
      LIMIT 50
    `, [ligueNumero]);

    res.json(tournaments);
  } catch (error) {
    console.error('Ligue upcoming tournaments error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement des prochains tournois' });
  }
});

// GET /api/ligue-admin/season-stats — Season activity stats per CDB
router.get('/season-stats', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    const season = req.query.season || await appSettings.getCurrentSeason();
    const { start, end } = await appSettings.getSeasonDateRange(season);

    const stats = await dbAll(`
      SELECT o.short_name,
        COUNT(DISTINCT te.tournoi_id) as tournament_count,
        COUNT(i.inscription_id) as inscription_count,
        ROUND(100.0 * SUM(CASE WHEN i.convoque = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(i.inscription_id), 0), 1) as convocation_rate,
        ROUND(100.0 * SUM(CASE WHEN i.forfait = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(i.inscription_id), 0), 1) as forfait_rate
      FROM organizations o
      LEFT JOIN tournoi_ext te ON te.organization_id = o.id AND te.debut BETWEEN $2 AND $3
      LEFT JOIN inscriptions i ON i.tournoi_id = te.tournoi_id
      WHERE o.ffb_ligue_numero = $1
      GROUP BY o.id, o.short_name
      ORDER BY o.short_name
    `, [ligueNumero, start, end]);

    res.json({ season, stats });
  } catch (error) {
    console.error('Ligue season stats error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement des statistiques' });
  }
});

// GET /api/ligue-admin/mode-distribution — Tournament mode distribution for the season
router.get('/mode-distribution', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    const season = req.query.season || await appSettings.getCurrentSeason();
    const { start, end } = await appSettings.getSeasonDateRange(season);

    const distribution = await dbAll(`
      SELECT te.mode, COUNT(*) as count
      FROM tournoi_ext te
      JOIN organizations o ON te.organization_id = o.id
      WHERE o.ffb_ligue_numero = $1 AND te.debut BETWEEN $2 AND $3
      GROUP BY te.mode
      ORDER BY count DESC
    `, [ligueNumero, start, end]);

    res.json(distribution);
  } catch (error) {
    console.error('Ligue mode distribution error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement de la répartition' });
  }
});

module.exports = router;
