const express = require('express');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

// Get database connection
const getDb = () => require('../db-loader');

// Get audience count (number of Player App users, excluding test accounts)
router.get('/audience-count', authenticateToken, (req, res) => {
  const db = getDb();

  db.get(
    `SELECT COUNT(*) as count
     FROM player_accounts pa
     LEFT JOIN players p ON REPLACE(pa.licence, ' ', '') = REPLACE(p.licence, ' ', '')
     WHERE p.player_app_role IS NULL OR p.player_app_role != 'test'`,
    [],
    (err, row) => {
      if (err) {
        console.error('Error fetching audience count:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ count: row?.count || 0 });
    }
  );
});

// Get filtered audience count based on mode/ranking/club criteria
// Logic: (category criteria) OR (club criteria)
// - Category = mode AND ranking (if both specified)
// - Clubs = separate OR group
// - If both category and clubs selected: matches category OR matches clubs
router.post('/filtered-audience-count', authenticateToken, async (req, res) => {
  const db = getDb();
  const { target_modes, target_rankings, target_clubs } = req.body;

  try {
    // Base condition: exclude test accounts
    const baseCondition = `(p.player_app_role IS NULL OR p.player_app_role != 'test')`;
    let params = [];
    let paramIndex = 1;

    // Load mode -> rank_column mapping from game_modes table
    const gameModes = await new Promise((resolve, reject) => {
      db.all('SELECT code, rank_column FROM game_modes WHERE rank_column IS NOT NULL', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const modeToColumn = {};
    for (const gm of gameModes) {
      modeToColumn[gm.code.toUpperCase()] = gm.rank_column;
    }

    // Build category condition (mode AND ranking)
    let categoryConditions = [];

    // Mode filter: player has ranking (not NC) in any of the target modes
    if (target_modes && target_modes.length > 0) {
      const modeConditions = target_modes.map(mode => {
        const m = mode.toUpperCase();
        const rankColumn = modeToColumn[m];
        if (rankColumn) {
          return `(p.${rankColumn} IS NOT NULL AND p.${rankColumn} != 'NC')`;
        }
        return 'FALSE';
      }).filter(c => c !== 'FALSE');

      if (modeConditions.length > 0) {
        categoryConditions.push(`(${modeConditions.join(' OR ')})`);
      }
    }

    // Ranking filter: player has any of the target rankings in any mode
    if (target_rankings && target_rankings.length > 0) {
      const rankPlaceholders = target_rankings.map(() => `$${paramIndex++}`).join(', ');
      categoryConditions.push(`(
        p.rank_libre IN (${rankPlaceholders}) OR
        p.rank_cadre IN (${rankPlaceholders}) OR
        p.rank_bande IN (${rankPlaceholders}) OR
        p.rank_3bandes IN (${rankPlaceholders})
      )`);
      // Add ranking params 4 times (once for each rank column)
      params.push(...target_rankings, ...target_rankings, ...target_rankings, ...target_rankings);
    }

    // Build club condition
    let clubCondition = null;
    if (target_clubs && target_clubs.length > 0) {
      const clubConditions = target_clubs.map(() => `UPPER(p.club) LIKE UPPER($${paramIndex++})`);
      clubCondition = `(${clubConditions.join(' OR ')})`;
      params.push(...target_clubs.map(c => `%${c}%`));
    }

    // Combine conditions with OR logic between category group and club group
    let filterCondition;
    const hasCategory = categoryConditions.length > 0;
    const hasClubs = clubCondition !== null;

    if (hasCategory && hasClubs) {
      // Both: (category match) OR (club match)
      const categoryGroup = categoryConditions.join(' AND ');
      filterCondition = `((${categoryGroup}) OR ${clubCondition})`;
    } else if (hasCategory) {
      // Category only
      filterCondition = `(${categoryConditions.join(' AND ')})`;
    } else if (hasClubs) {
      // Clubs only
      filterCondition = clubCondition;
    } else {
      // No filters - return total count
      filterCondition = 'TRUE';
    }

    const query = `
      SELECT COUNT(DISTINCT pa.licence) as count
      FROM player_accounts pa
      JOIN players p ON REPLACE(pa.licence, ' ', '') = REPLACE(p.licence, ' ', '')
      WHERE ${baseCondition} AND ${filterCondition}
    `;

    const result = await new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    res.json({ count: result?.count || 0 });
  } catch (err) {
    console.error('Error fetching filtered audience count:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all announcements (includes inactive)
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();

  db.all(
    `SELECT * FROM announcements ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching announcements:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// Get active announcements (public - for Player App)
// If licence query param is provided, also show test/targeted/filtered announcements for that licence
router.get('/active', async (req, res) => {
  const db = getDb();
  const { licence } = req.query;

  // Normalize licence (remove spaces)
  const normalizedLicence = licence ? licence.replace(/\s+/g, '') : null;

  try {
    // Load game modes mapping (code -> rank_column)
    const gameModes = await new Promise((resolve, reject) => {
      db.all('SELECT code, rank_column FROM game_modes WHERE rank_column IS NOT NULL', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    const modeToColumn = {};
    for (const gm of gameModes) {
      modeToColumn[gm.code.toUpperCase()] = gm.rank_column;
    }

    // First, get player data if licence provided (for filter matching)
    let playerData = null;
    if (normalizedLicence) {
      playerData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT licence, club, rank_libre, rank_cadre, rank_bande, rank_3bandes
           FROM players WHERE REPLACE(licence, ' ', '') = $1`,
          [normalizedLicence],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
    }

    // Get all active announcements
    const announcements = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, title, message, type, created_at, test_licence, target_licence,
                target_modes, target_rankings, target_clubs
         FROM announcements
         WHERE is_active = TRUE
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         ORDER BY created_at DESC`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Filter announcements based on targeting
    const filteredAnnouncements = announcements.filter(ann => {
      // Test announcement - only show to test licence
      if (ann.test_licence) {
        return normalizedLicence && ann.test_licence.replace(/\s+/g, '') === normalizedLicence;
      }

      // Single player target
      if (ann.target_licence) {
        return normalizedLicence && ann.target_licence.replace(/\s+/g, '') === normalizedLicence;
      }

      // Filter by mode/ranking/club
      // Logic: (category criteria) OR (club criteria)
      const hasFilters = ann.target_modes || ann.target_rankings || ann.target_clubs;
      if (hasFilters) {
        if (!playerData) return false; // No player data, can't match filters

        // Check category criteria (mode AND ranking)
        let matchesCategory = true;

        // Check mode filter (using dynamic game_modes mapping)
        if (ann.target_modes) {
          const modes = JSON.parse(ann.target_modes);
          // Player matches if they have a ranking in any of the target modes
          const playerHasMode = modes.some(m => {
            const rankColumn = modeToColumn[m.toUpperCase()];
            if (!rankColumn) return false;
            const playerRank = playerData[rankColumn];
            return playerRank && playerRank !== 'NC';
          });
          matchesCategory = matchesCategory && playerHasMode;
        }

        // Check ranking filter (check all rank columns dynamically)
        if (ann.target_rankings) {
          const rankings = JSON.parse(ann.target_rankings);
          // Get all player rankings from all mode columns
          const playerRankings = Object.values(modeToColumn)
            .map(col => playerData[col])
            .filter(r => r && r !== 'NC');
          matchesCategory = matchesCategory && rankings.some(r => playerRankings.includes(r));
        }

        // Check club filter separately
        let matchesClub = false;
        if (ann.target_clubs) {
          const clubs = JSON.parse(ann.target_clubs);
          matchesClub = clubs.some(c =>
            playerData.club && playerData.club.toUpperCase().includes(c.toUpperCase())
          );
        }

        // Determine match based on which filters are present
        const hasCategoryFilter = ann.target_modes || ann.target_rankings;
        const hasClubFilter = ann.target_clubs;

        if (hasCategoryFilter && hasClubFilter) {
          // Both: match if category OR club
          return matchesCategory || matchesClub;
        } else if (hasCategoryFilter) {
          // Category only
          return matchesCategory;
        } else if (hasClubFilter) {
          // Club only
          return matchesClub;
        }

        return false;
      }

      // No targeting - show to everyone
      return true;
    });

    res.json(filteredAnnouncements);
  } catch (err) {
    console.error('Error fetching active announcements:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create announcement
router.post('/', authenticateToken, (req, res) => {
  const db = getDb();
  const { title, message, type, expires_at, test_licence, target_licence, target_modes, target_rankings, target_clubs } = req.body;
  const created_by = req.user?.username || 'admin';

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  const announcementType = type || 'info';
  // Normalize licences if provided
  const normalizedTestLicence = test_licence ? test_licence.replace(/\s+/g, '') : null;
  const normalizedTargetLicence = target_licence ? target_licence.replace(/\s+/g, '') : null;

  // Store filter arrays as JSON strings
  const modesJson = target_modes && target_modes.length > 0 ? JSON.stringify(target_modes) : null;
  const rankingsJson = target_rankings && target_rankings.length > 0 ? JSON.stringify(target_rankings) : null;
  const clubsJson = target_clubs && target_clubs.length > 0 ? JSON.stringify(target_clubs) : null;

  db.run(
    `INSERT INTO announcements (title, message, type, expires_at, created_by, test_licence, target_licence, target_modes, target_rankings, target_clubs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [title, message, announcementType, expires_at || null, created_by, normalizedTestLicence, normalizedTargetLicence, modesJson, rankingsJson, clubsJson],
    function(err) {
      if (err) {
        console.error('Error creating announcement:', err);
        return res.status(500).json({ error: err.message });
      }
      let msg = 'Announcement created';
      if (normalizedTestLicence) msg = `Announcement test created for ${normalizedTestLicence}`;
      else if (normalizedTargetLicence) msg = `Personal message sent to ${normalizedTargetLicence}`;
      else if (modesJson || rankingsJson || clubsJson) msg = `Announcement created for filtered audience`;

      res.json({
        success: true,
        message: msg,
        id: this.lastID
      });
    }
  );
});

// Update announcement
router.put('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { title, message, type, is_active, expires_at } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  db.run(
    `UPDATE announcements
     SET title = $1, message = $2, type = $3, is_active = $4, expires_at = $5
     WHERE id = $6`,
    [title, message, type || 'info', is_active !== false, expires_at || null, id],
    function(err) {
      if (err) {
        console.error('Error updating announcement:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Announcement not found' });
      }
      res.json({ success: true, message: 'Announcement updated' });
    }
  );
});

// Toggle announcement active status
router.patch('/:id/toggle', authenticateToken, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  db.run(
    `UPDATE announcements SET is_active = NOT is_active WHERE id = $1`,
    [id],
    function(err) {
      if (err) {
        console.error('Error toggling announcement:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Announcement not found' });
      }
      res.json({ success: true, message: 'Announcement status toggled' });
    }
  );
});

// Delete announcement
router.delete('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  db.run(
    'DELETE FROM announcements WHERE id = $1',
    [id],
    function(err) {
      if (err) {
        console.error('Error deleting announcement:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Announcement not found' });
      }
      res.json({ success: true, message: 'Announcement deleted' });
    }
  );
});

// Purge announcements (bulk delete based on criteria)
router.post('/purge', authenticateToken, async (req, res) => {
  const db = getDb();
  const { criteria, dateFrom, dateTo } = req.body;

  // criteria: 'expired', 'inactive', 'date_range', 'all_inactive_and_expired'
  if (!criteria) {
    return res.status(400).json({ error: 'Criteria required' });
  }

  let query = '';
  let params = [];

  try {
    switch (criteria) {
      case 'expired':
        // Delete all expired announcements (expires_at < now)
        query = 'DELETE FROM announcements WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP';
        break;

      case 'inactive':
        // Delete all inactive announcements
        query = 'DELETE FROM announcements WHERE is_active = FALSE';
        break;

      case 'all_inactive_and_expired':
        // Delete both inactive and expired
        query = `DELETE FROM announcements WHERE is_active = FALSE OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)`;
        break;

      case 'date_range':
        // Delete announcements created between two dates
        if (!dateFrom || !dateTo) {
          return res.status(400).json({ error: 'dateFrom and dateTo required for date_range criteria' });
        }
        query = 'DELETE FROM announcements WHERE created_at >= $1 AND created_at <= $2';
        params = [dateFrom, dateTo + ' 23:59:59'];
        break;

      default:
        return res.status(400).json({ error: 'Invalid criteria' });
    }

    // First count how many will be deleted
    const countQuery = query.replace('DELETE FROM', 'SELECT COUNT(*) as count FROM');
    const countResult = await new Promise((resolve, reject) => {
      db.get(countQuery, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const toDeleteCount = countResult?.count || 0;

    if (toDeleteCount === 0) {
      return res.json({ success: true, deleted: 0, message: 'Aucune annonce correspondant aux critères' });
    }

    // Execute deletion
    await new Promise((resolve, reject) => {
      db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });

    console.log(`Purged ${toDeleteCount} announcements with criteria: ${criteria}`);
    res.json({
      success: true,
      deleted: toDeleteCount,
      message: `${toDeleteCount} annonce(s) supprimée(s)`
    });

  } catch (err) {
    console.error('Error purging announcements:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
