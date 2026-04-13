const express = require('express');
const router = express.Router();
const { authenticateToken, requireDdJ } = require('./auth');
const getDb = () => require('../db-loader');

// GET /api/directeur-jeu/competitions
// Returns tournaments for today + recent days for the DdJ's organization
router.get('/competitions', authenticateToken, requireDdJ, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;

  // Get today's date in Paris timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

  // Also get date 7 days ago for history
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const historyStart = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

  const query = `
    SELECT t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu, t.lieu_2,
           t.is_split, t.tournament_number, t.status,
           COUNT(DISTINCT cp.licence) as convoque_count,
           COUNT(DISTINCT CASE WHEN i.forfait = 1 THEN i.licence END) as forfait_count,
           COUNT(DISTINCT CASE WHEN i.inscription_id IS NOT NULL
             AND (i.forfait IS NULL OR i.forfait != 1)
             AND (i.statut IS NULL OR i.statut NOT IN ('désinscrit', 'indisponible'))
             THEN i.licence END) as inscrit_count
    FROM tournoi_ext t
    LEFT JOIN convocation_poules cp ON t.tournoi_id = cp.tournoi_id
    LEFT JOIN inscriptions i ON t.tournoi_id = i.tournoi_id
    WHERE DATE(t.debut) BETWEEN $1 AND $2
      AND ($3::int IS NULL OR t.organization_id = $3)
      AND t.parent_tournoi_id IS NULL
      AND LOWER(COALESCE(t.status, 'active')) != 'cancelled'
    GROUP BY t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.lieu, t.lieu_2,
             t.is_split, t.tournament_number, t.status
    ORDER BY t.debut DESC, t.mode, t.categorie
  `;

  db.all(query, [historyStart, today, orgId], (err, rows) => {
    if (err) {
      console.error('[DdJ] Error fetching competitions:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    // Split into today vs history
    const todayStr = today;
    const competitions = (rows || []).map(row => {
      const rowDate = row.debut instanceof Date
        ? row.debut.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
        : String(row.debut).split('T')[0];
      return {
        ...row,
        is_today: rowDate === todayStr
      };
    });

    res.json(competitions);
  });
});

module.exports = router;
