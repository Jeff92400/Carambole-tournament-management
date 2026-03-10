const express = require('express');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Get database connection
const getDb = () => require('../db-loader');

// Default category labels
const DEFAULT_CATEGORY_LABELS = [
  'Inscription aux tournois',
  'Résultats et classements',
  'Convocations et poules',
  'Navigation et ergonomie',
  'Communication par email'
];

// List all campaigns for org, ordered by created_at DESC
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const orgId = req.user.organizationId || null;

  db.all(
    `SELECT sc.*,
            (SELECT COUNT(*) FROM survey_responses sr WHERE sr.campaign_id = sc.id) as response_count
     FROM survey_campaigns sc
     WHERE ($1::int IS NULL OR sc.organization_id = $1)
     ORDER BY sc.created_at DESC`,
    [orgId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching survey campaigns:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// Create campaign
router.post('/', authenticateToken, (req, res) => {
  const db = getDb();
  const {
    title,
    description,
    category_1_label,
    category_2_label,
    category_3_label,
    category_4_label,
    category_5_label
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Le titre est requis' });
  }

  const created_by = req.user?.username || 'admin';
  const orgId = req.user.organizationId || null;

  const labels = [
    category_1_label || DEFAULT_CATEGORY_LABELS[0],
    category_2_label || DEFAULT_CATEGORY_LABELS[1],
    category_3_label || DEFAULT_CATEGORY_LABELS[2],
    category_4_label || DEFAULT_CATEGORY_LABELS[3],
    category_5_label || DEFAULT_CATEGORY_LABELS[4]
  ];

  db.run(
    `INSERT INTO survey_campaigns (title, description, category_1_label, category_2_label, category_3_label, category_4_label, category_5_label, organization_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [title, description || null, labels[0], labels[1], labels[2], labels[3], labels[4], orgId, created_by],
    function(err) {
      if (err) {
        console.error('Error creating survey campaign:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({
        success: true,
        message: 'Enquête créée',
        id: this.lastID
      });
    }
  );
});

// Update campaign (only if draft)
router.put('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  try {
    // Check campaign exists and is draft
    const campaign = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, status FROM survey_campaigns WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Enquête non trouvée' });
    }

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return res.status(400).json({ error: 'Seules les enquêtes en brouillon ou programmées peuvent être modifiées' });
    }

    const {
      title,
      description,
      category_1_label,
      category_2_label,
      category_3_label,
      category_4_label,
      category_5_label
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Le titre est requis' });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE survey_campaigns
         SET title = $1, description = $2, category_1_label = $3, category_2_label = $4, category_3_label = $5, category_4_label = $6, category_5_label = $7
         WHERE id = $8 AND ($9::int IS NULL OR organization_id = $9)`,
        [
          title,
          description || null,
          category_1_label || DEFAULT_CATEGORY_LABELS[0],
          category_2_label || DEFAULT_CATEGORY_LABELS[1],
          category_3_label || DEFAULT_CATEGORY_LABELS[2],
          category_4_label || DEFAULT_CATEGORY_LABELS[3],
          category_5_label || DEFAULT_CATEGORY_LABELS[4],
          id,
          orgId
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, message: 'Enquête mise à jour' });
  } catch (err) {
    console.error('Error updating survey campaign:', err);
    res.status(500).json({ error: err.message });
  }
});

// Activate campaign with start/end dates
router.patch('/:id/activate', authenticateToken, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const orgId = req.user.organizationId || null;
  const { starts_at, ends_at } = req.body || {};

  if (!starts_at || !ends_at) {
    return res.status(400).json({ error: 'Les dates de début et de fin sont requises' });
  }

  const startDate = new Date(starts_at);
  const endDate = new Date(ends_at);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Dates invalides' });
  }

  if (endDate <= startDate) {
    return res.status(400).json({ error: 'La date de fin doit être postérieure à la date de début' });
  }

  try {
    // Check campaign exists and is draft
    const campaign = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, status FROM survey_campaigns WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Enquête non trouvée' });
    }

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return res.status(400).json({ error: 'Seules les enquêtes en brouillon ou programmées peuvent être activées' });
    }

    // Check no other active/scheduled campaign overlaps for this org
    const overlapping = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, title FROM survey_campaigns
         WHERE status IN ('active', 'scheduled') AND id != $1
           AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (overlapping) {
      return res.status(400).json({
        error: `Une autre enquête est déjà active ou programmée : "${overlapping.title}". Fermez-la avant d'en activer une nouvelle.`
      });
    }

    // If start date is now or in the past, activate immediately; otherwise schedule
    const now = new Date();
    const newStatus = startDate <= now ? 'active' : 'scheduled';
    const activatedAt = newStatus === 'active' ? 'CURRENT_TIMESTAMP' : 'NULL';

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE survey_campaigns
         SET status = $1, activated_at = ${activatedAt}, starts_at = $2, ends_at = $3
         WHERE id = $4 AND ($5::int IS NULL OR organization_id = $5)`,
        [newStatus, starts_at, ends_at, id, orgId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    const msg = newStatus === 'active'
      ? 'Enquête activée'
      : `Enquête programmée du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')}`;

    res.json({ success: true, message: msg, status: newStatus });
  } catch (err) {
    console.error('Error activating survey campaign:', err);
    res.status(500).json({ error: err.message });
  }
});

// Close campaign
router.patch('/:id/close', authenticateToken, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  try {
    const campaign = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, status FROM survey_campaigns WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Enquête non trouvée' });
    }

    if (campaign.status !== 'active' && campaign.status !== 'scheduled') {
      return res.status(400).json({ error: 'Seules les enquêtes actives ou programmées peuvent être fermées' });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE survey_campaigns SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, message: 'Enquête fermée' });
  } catch (err) {
    console.error('Error closing survey campaign:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete campaign (only if draft, no responses)
router.delete('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  try {
    const campaign = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, status FROM survey_campaigns WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Enquête non trouvée' });
    }

    if (campaign.status === 'active') {
      return res.status(400).json({ error: 'Clôturez le sondage avant de le supprimer' });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM survey_campaigns WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, message: 'Enquête supprimée' });
  } catch (err) {
    console.error('Error deleting survey campaign:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get campaign results
router.get('/:id/results', authenticateToken, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const orgId = req.user.organizationId || null;

  try {
    // Get campaign info
    const campaign = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM survey_campaigns WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)`,
        [id, orgId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Enquête non trouvée' });
    }

    // Get all responses excluding TEST licences
    const responses = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM survey_responses
         WHERE campaign_id = $1
           AND UPPER(player_licence) NOT LIKE 'TEST%'
         ORDER BY created_at DESC`,
        [id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const responseCount = responses.length;

    // Compute averages per category and overall
    let averages = {
      rating_1: 0,
      rating_2: 0,
      rating_3: 0,
      rating_4: 0,
      rating_5: 0,
      overall_rating: 0
    };

    // Compute distribution per category (count per star 1-5)
    const ratingFields = ['rating_1', 'rating_2', 'rating_3', 'rating_4', 'rating_5', 'overall_rating'];
    const distribution = {};
    for (const field of ratingFields) {
      distribution[field] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }

    if (responseCount > 0) {
      for (const response of responses) {
        for (const field of ratingFields) {
          const val = response[field];
          averages[field] += val;
          distribution[field][val] = (distribution[field][val] || 0) + 1;
        }
      }

      for (const field of ratingFields) {
        averages[field] = parseFloat((averages[field] / responseCount).toFixed(1));
      }
    }

    // Get comments with player name
    const comments = responses
      .filter(r => r.comment && r.comment.trim().length > 0)
      .map(r => ({
        player_name: r.player_name,
        comment: r.comment,
        created_at: r.created_at
      }));

    // Get declined count (dismiss_count >= 3)
    const declinedResult = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM survey_dismissals
         WHERE campaign_id = $1
           AND dismiss_count >= 3
           AND UPPER(player_licence) NOT LIKE 'TEST%'`,
        [id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const declinedCount = declinedResult?.count || 0;

    res.json({
      campaign,
      responseCount,
      averages,
      distribution,
      comments,
      declinedCount
    });
  } catch (err) {
    console.error('Error fetching survey results:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
