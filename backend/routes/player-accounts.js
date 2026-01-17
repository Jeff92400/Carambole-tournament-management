/**
 * Player Accounts Routes
 *
 * Manage player accounts for the Player App (Espace Joueur)
 *
 * GET    /api/player-accounts     - List all player accounts
 * POST   /api/player-accounts     - Create a new player account
 * PUT    /api/player-accounts/:id - Update a player account
 * DELETE /api/player-accounts/:id - Delete a player account
 */

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db-loader');

/**
 * GET /api/player-accounts
 * List all player accounts with player info
 */
router.get('/', (req, res) => {
  const query = `
    SELECT pa.id, pa.licence, pa.email, pa.is_admin, pa.email_verified,
           pa.created_at, pa.last_login,
           CONCAT(p.first_name, ' ', p.last_name) as player_name,
           p.club
    FROM player_accounts pa
    LEFT JOIN players p ON REPLACE(pa.licence, ' ', '') = REPLACE(p.licence, ' ', '')
    ORDER BY pa.created_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error loading player accounts:', err);
      return res.status(500).json({ error: 'Failed to load player accounts' });
    }
    res.json(rows || []);
  });
});

/**
 * POST /api/player-accounts
 * Create a new player account
 */
router.post('/', async (req, res) => {
  try {
    const { licence, email, password, isAdmin } = req.body;

    if (!licence || !email || !password) {
      return res.status(400).json({ error: 'Licence, email et mot de passe requis' });
    }

    // Password validation - strong: 8+ chars, uppercase, number, special char
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caracteres' });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins une majuscule' });
    }
    if (!/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins un chiffre' });
    }
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins un caractere special' });
    }

    // Check if player exists
    db.get(
      `SELECT * FROM players WHERE REPLACE(licence, ' ', '') = REPLACE($1, ' ', '')`,
      [licence],
      async (err, player) => {
        if (err) {
          console.error('Error checking player:', err);
          return res.status(500).json({ error: 'Erreur lors de la vérification du joueur' });
        }

        if (!player) {
          return res.status(404).json({ error: 'Licence non trouvée dans la base joueurs' });
        }

        // Check if account already exists
        db.get(
          `SELECT id FROM player_accounts WHERE REPLACE(licence, ' ', '') = REPLACE($1, ' ', '') OR LOWER(email) = LOWER($2)`,
          [licence, email],
          async (err, existing) => {
            if (err) {
              console.error('Error checking existing account:', err);
              return res.status(500).json({ error: 'Erreur lors de la vérification' });
            }

            if (existing) {
              return res.status(409).json({ error: 'Un compte existe déjà pour cette licence ou cet email' });
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 10);

            // Create account
            db.run(
              `INSERT INTO player_accounts (licence, email, password_hash, email_verified, is_admin)
               VALUES ($1, $2, $3, true, $4)`,
              [licence.toUpperCase(), email, passwordHash, isAdmin || false],
              function(err) {
                if (err) {
                  console.error('Error creating account:', err);
                  return res.status(500).json({ error: 'Erreur lors de la création du compte' });
                }

                res.status(201).json({
                  success: true,
                  id: this.lastID,
                  message: 'Compte créé avec succès'
                });
              }
            );
          }
        );
      }
    );

  } catch (error) {
    console.error('Error creating player account:', error);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

/**
 * PUT /api/player-accounts/:id
 * Update a player account (admin status or password)
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { isAdmin, password } = req.body;

  // Must have at least one field to update
  if (isAdmin === undefined && !password) {
    return res.status(400).json({ error: 'Paramètre isAdmin ou password requis' });
  }

  try {
    // Handle password update
    if (password) {
      // Password validation - strong: 8+ chars, uppercase, number, special char
      if (password.length < 8) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caracteres' });
      }
      if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins une majuscule' });
      }
      if (!/[0-9]/.test(password)) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins un chiffre' });
      }
      if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins un caractere special' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      db.run(
        `UPDATE player_accounts SET password_hash = $1 WHERE id = $2`,
        [passwordHash, id],
        function(err) {
          if (err) {
            console.error('Error updating player password:', err);
            return res.status(500).json({ error: 'Erreur lors de la mise à jour du mot de passe' });
          }

          if (this.changes === 0) {
            return res.status(404).json({ error: 'Compte non trouvé' });
          }

          res.json({ success: true, message: 'Mot de passe mis à jour' });
        }
      );
      return;
    }

    // Handle admin status update
    db.run(
      `UPDATE player_accounts SET is_admin = $1 WHERE id = $2`,
      [isAdmin, id],
      function(err) {
        if (err) {
          console.error('Error updating player account:', err);
          return res.status(500).json({ error: 'Erreur lors de la mise à jour' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Compte non trouvé' });
        }

        res.json({ success: true, message: 'Compte mis à jour' });
      }
    );
  } catch (error) {
    console.error('Error in player account update:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

/**
 * DELETE /api/player-accounts/:id
 * Delete a player account
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.run(
    `DELETE FROM player_accounts WHERE id = $1`,
    [id],
    function(err) {
      if (err) {
        console.error('Error deleting player account:', err);
        return res.status(500).json({ error: 'Erreur lors de la suppression' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Compte non trouvé' });
      }

      res.json({ success: true, message: 'Compte supprimé' });
    }
  );
});

/**
 * GET /api/player-accounts/:licence/calendar.ics
 * Generate iCalendar file with tournaments for player's eligible categories
 */
router.get('/:licence/calendar.ics', async (req, res) => {
  const { licence } = req.params;
  const normalizedLicence = (licence || '').replace(/\s+/g, '');

  try {
    // Get player info and their moyennes
    const player = await new Promise((resolve, reject) => {
      db.get(`
        SELECT licence, first_name, last_name,
               rank_libre, rank_cadre, rank_bande, rank_3bandes
        FROM players
        WHERE REPLACE(licence, ' ', '') = $1
      `, [normalizedLicence], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!player) {
      return res.status(404).json({ error: 'Joueur non trouvé' });
    }

    // Get game parameters to determine eligibility
    const gameParams = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM game_parameters`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Map player rankings to mode names
    const playerRankings = {
      'LIBRE': parseFloat(player.rank_libre) || 0,
      'CADRE': parseFloat(player.rank_cadre) || 0,
      'BANDE': parseFloat(player.rank_bande) || 0,
      '3BANDES': parseFloat(player.rank_3bandes) || 0,
      '3 BANDES': parseFloat(player.rank_3bandes) || 0
    };

    // Find eligible categories for each mode
    const eligibleCategories = [];
    for (const param of gameParams) {
      const modeKey = param.mode.toUpperCase().replace(/\s+/g, '');
      const playerMoyenne = playerRankings[param.mode.toUpperCase()] || playerRankings[modeKey] || 0;

      // Check if NC (not classified) - skip if NC
      const rankValue = param.mode.toUpperCase().includes('3')
        ? player.rank_3bandes
        : param.mode.toUpperCase() === 'LIBRE' ? player.rank_libre
        : param.mode.toUpperCase() === 'CADRE' ? player.rank_cadre
        : player.rank_bande;

      if (rankValue === 'NC' || rankValue === null) continue;

      // Check if player's moyenne falls within category range
      if (playerMoyenne >= parseFloat(param.moyenne_mini) && playerMoyenne <= parseFloat(param.moyenne_maxi)) {
        eligibleCategories.push({
          mode: param.mode,
          categorie: param.categorie
        });
      }
    }

    if (eligibleCategories.length === 0) {
      return res.status(404).json({ error: 'Aucune catégorie éligible trouvée' });
    }

    // Get current season
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const seasonStart = `${currentYear}-09-01`;
    const seasonEnd = `${currentYear + 1}-08-31`;

    // Build query for eligible tournaments
    const categoryConditions = eligibleCategories.map((_, i) =>
      `(UPPER(REPLACE(mode, ' ', '')) = UPPER(REPLACE($${i * 2 + 3}, ' ', '')) AND UPPER(categorie) = UPPER($${i * 2 + 4}))`
    ).join(' OR ');

    const queryParams = [seasonStart, seasonEnd];
    eligibleCategories.forEach(cat => {
      queryParams.push(cat.mode, cat.categorie);
    });

    const tournaments = await new Promise((resolve, reject) => {
      db.all(`
        SELECT tournoi_id, nom, mode, categorie, debut, lieu
        FROM tournoi_ext
        WHERE debut >= $1 AND debut <= $2
          AND (${categoryConditions})
        ORDER BY debut ASC
      `, queryParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Generate iCalendar content
    const playerName = `${player.first_name} ${player.last_name}`;
    const icsContent = generateICalendar(tournaments, playerName, eligibleCategories);

    // Set headers for file download
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="CDBHS_${normalizedLicence}.ics"`);
    res.send(icsContent);

  } catch (error) {
    console.error('Error generating calendar:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate iCalendar format content
 */
function generateICalendar(tournaments, playerName, eligibleCategories) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CDBHS//Calendrier Tournois//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:CDBHS - Tournois ${playerName}`,
    'X-WR-TIMEZONE:Europe/Paris'
  ];

  // Add timezone definition
  ics.push(
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  );

  // Add events for each tournament
  for (const tournament of tournaments) {
    const eventDate = new Date(tournament.debut);
    const dateStr = eventDate.toISOString().split('T')[0].replace(/-/g, '');
    const uid = `tournament-${tournament.tournoi_id}@cdbhs.net`;

    // Determine if it's a finale
    const isFinale = (tournament.nom || '').toLowerCase().includes('finale');
    const title = isFinale
      ? `🏆 FINALE ${tournament.mode} ${tournament.categorie}`
      : `${tournament.nom} - ${tournament.mode} ${tournament.categorie}`;

    const location = tournament.lieu || 'Lieu à confirmer';
    const description = `Tournoi CDBHS\\n${tournament.mode} - ${tournament.categorie}\\nLieu: ${location}`;

    ics.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${dateStr}`,
      `DTEND;VALUE=DATE:${dateStr}`,
      `SUMMARY:${escapeIcsText(title)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText(location)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

/**
 * Escape special characters for iCalendar format
 */
function escapeIcsText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

module.exports = router;
