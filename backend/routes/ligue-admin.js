const express = require('express');
const db = require('../db-loader');
const { authenticateToken, requireLigueAdmin } = require('./auth');

const router = express.Router();

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

// GET /api/ligue-admin/dashboard — Ligue overview with stats + CDB list
router.get('/dashboard', async (req, res) => {
  try {
    const ligueNumero = req.user.ligueNumero;
    if (!ligueNumero) {
      return res.status(400).json({ error: 'Aucune ligue associée à ce compte' });
    }

    // Ligue info
    const ligue = await dbGet(
      `SELECT numero, nom FROM ffb_ligues WHERE numero = $1`,
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

    // Map mode to rank column
    const rankColumns = {
      'LIBRE': 'rank_libre',
      'BANDE': 'rank_bande',
      '3BANDES': 'rank_3bandes',
      'CADRE': 'rank_cadre'
    };

    const rankCol = rankColumns[mode.toUpperCase()];
    if (!rankCol) {
      return res.status(400).json({ error: 'Mode invalide. Valeurs: LIBRE, BANDE, 3BANDES, CADRE' });
    }

    // Get top players sorted by ranking level (N1 best → NC worst)
    const players = await dbAll(`
      SELECT p.first_name, p.last_name, p.licence, p.${rankCol} as ranking,
             o.short_name as cdb_name, o.ffb_cdb_code,
             COALESCE(fr.level_order, 99) as level_order
      FROM players p
      JOIN organizations o ON p.organization_id = o.id
      LEFT JOIN ffb_rankings fr ON p.${rankCol} = fr.code
      WHERE o.ffb_ligue_numero = $1
        AND UPPER(p.licence) NOT LIKE 'TEST%'
        AND p.${rankCol} IS NOT NULL
        AND p.${rankCol} != ''
        AND p.${rankCol} != 'NC'
      ORDER BY COALESCE(fr.level_order, 99) ASC, p.last_name ASC
      LIMIT $2
    `, [ligueNumero, limit]);

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

module.exports = router;
