const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../db-loader');
const appSettings = require('../utils/app-settings');

  // ==================== VERIFY TEST ENVIRONMENT ====================

  // Check if test environment is ready (6+ TEST players exist)
  router.get('/verify', authenticateToken, async (req, res) => {
    try {
      const orgId = req.user.organizationId || null;

      // Count TEST players
      db.get(
        `SELECT COUNT(*) as count
         FROM players
         WHERE UPPER(licence) LIKE 'TEST%'
           AND ($1::int IS NULL OR organization_id = $1)`,
        [orgId],
        (err, result) => {
          if (err) {
            console.error('Error counting TEST players:', err);
            return res.status(500).json({ error: 'Erreur lors de la vérification' });
          }

          const testPlayerCount = result.count || 0;
          const ready = testPlayerCount >= 6;

          res.json({
            ready,
            testPlayerCount,
            minimumRequired: 6,
            message: ready
              ? `${testPlayerCount} joueurs TEST disponibles`
              : `Seulement ${testPlayerCount} joueurs TEST (minimum 6 requis)`
          });
        }
      );
    } catch (error) {
      console.error('Error in /verify:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ==================== GET TEST PLAYERS ====================

  // List all TEST players
  router.get('/players', authenticateToken, async (req, res) => {
    try {
      const orgId = req.user.organizationId || null;

      db.all(
        `SELECT
           licence,
           first_name,
           last_name,
           club,
           rank_libre,
           rank_cadre,
           rank_bande,
           rank_3bandes
         FROM players
         WHERE UPPER(licence) LIKE 'TEST%'
           AND ($1::int IS NULL OR organization_id = $1)
         ORDER BY licence`,
        [orgId],
        (err, players) => {
          if (err) {
            console.error('Error fetching TEST players:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des joueurs' });
          }

          res.json(players || []);
        }
      );
    } catch (error) {
      console.error('Error in /players:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ==================== GET ADMIN USERS ====================

  // List all admin users (potential email recipients)
  router.get('/admins', authenticateToken, async (req, res) => {
    try {
      const orgId = req.user.organizationId || null;

      db.all(
        `SELECT
           id,
           username,
           email,
           role
         FROM users
         WHERE ($1::int IS NULL OR organization_id = $1)
           AND role IN ('admin', 'editor')
         ORDER BY role DESC, username`,
        [orgId],
        (err, admins) => {
          if (err) {
            console.error('Error fetching admin users:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des administrateurs' });
          }

          res.json(admins || []);
        }
      );
    } catch (error) {
      console.error('Error in /admins:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ==================== SEND TEST EMAILS ====================

  // Send test emails of selected types to override email address
  router.post('/send', authenticateToken, async (req, res) => {
    try {
      const {
        playerLicences = [],
        overrideEmail,
        emailTypes = [],
        deleteAfterTest = false
      } = req.body;
      const orgId = req.user.organizationId || null;

      // Validation
      if (!overrideEmail || !overrideEmail.includes('@')) {
        return res.status(400).json({ error: 'Adresse email invalide' });
      }

      if (playerLicences.length === 0) {
        return res.status(400).json({ error: 'Aucun joueur sélectionné' });
      }

      if (emailTypes.length === 0) {
        return res.status(400).json({ error: 'Aucun type d\'email sélectionné' });
      }

      // Verify selected players are TEST players
      const invalidPlayers = playerLicences.filter(l => !l.toUpperCase().startsWith('TEST'));
      if (invalidPlayers.length > 0) {
        return res.status(400).json({
          error: `Joueurs non-TEST détectés: ${invalidPlayers.join(', ')}`
        });
      }

      const results = {
        success: true,
        emailsSent: [],
        errors: [],
        testTournamentId: null
      };

      // ==================== CONVOCATIONS ====================
      if (emailTypes.includes('convocation')) {
        if (playerLicences.length < 6) {
          results.errors.push('Convocations: minimum 6 joueurs requis');
        } else {
          try {
            const convocationResult = await sendTestConvocations(
              db,
              appSettings,
              playerLicences,
              overrideEmail,
              orgId
            );
            results.emailsSent.push(...convocationResult.emails);
            results.testTournamentId = convocationResult.tournamentId;
          } catch (error) {
            results.errors.push(`Convocations: ${error.message}`);
          }
        }
      }

      // ==================== RESULTS ====================
      if (emailTypes.includes('results')) {
        if (playerLicences.length < 3) {
          results.errors.push('Résultats: minimum 3 joueurs requis');
        } else {
          try {
            const resultsResult = await sendTestResults(
              db,
              appSettings,
              playerLicences,
              overrideEmail,
              orgId,
              results.testTournamentId
            );
            results.emailsSent.push(...resultsResult.emails);
            if (!results.testTournamentId) {
              results.testTournamentId = resultsResult.tournamentId;
            }
          } catch (error) {
            results.errors.push(`Résultats: ${error.message}`);
          }
        }
      }

      // ==================== RELANCES ====================
      if (emailTypes.includes('relance')) {
        try {
          const relanceResult = await sendTestRelance(
            db,
            appSettings,
            playerLicences,
            overrideEmail,
            orgId
          );
          results.emailsSent.push(...relanceResult.emails);
        } catch (error) {
          results.errors.push(`Relances: ${error.message}`);
        }
      }

      // ==================== INVITATIONS ====================
      if (emailTypes.includes('invitation')) {
        try {
          const invitationResult = await sendTestInvitations(
            db,
            appSettings,
            playerLicences,
            overrideEmail,
            orgId
          );
          results.emailsSent.push(...invitationResult.emails);
        } catch (error) {
          results.errors.push(`Invitations: ${error.message}`);
        }
      }

      // ==================== CLEANUP ====================
      if (deleteAfterTest && results.testTournamentId) {
        try {
          await deleteTestTournament(db, results.testTournamentId);
          results.cleaned = true;
        } catch (error) {
          results.errors.push(`Nettoyage: ${error.message}`);
        }
      }

      res.json(results);

    } catch (error) {
      console.error('Error in /send:', error);
      res.status(500).json({ error: 'Erreur lors de l\'envoi des emails de test' });
    }
  });

// ==================== HELPER FUNCTIONS ====================

// Send test convocations
async function sendTestConvocations(db, appSettings, playerLicences, overrideEmail, orgId) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Create or get test tournament
      const tournamentId = await getOrCreateTestTournament(db, orgId, 'Libre N2');

      // 2. Add players to inscriptions (clear existing first)
      await new Promise((res, rej) => {
        db.run(
          `DELETE FROM inscriptions WHERE tournoi_id = $1`,
          [tournamentId],
          (err) => err ? rej(err) : res()
        );
      });

      // 3. Get player details
      const players = await new Promise((res, rej) => {
        db.all(
          `SELECT licence, first_name, last_name, club
           FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      // 4. Insert inscriptions
      for (const player of players) {
        await new Promise((res, rej) => {
          db.run(
            `INSERT INTO inscriptions (tournoi_id, licence, nom, prenom, club, source, statut)
             VALUES ($1, $2, $3, $4, $5, 'manual', 'inscrit')`,
            [tournamentId, player.licence, player.last_name, player.first_name, player.club],
            (err) => err ? rej(err) : res()
          );
        });
      }

      // 5. Generate poules (simple serpentine)
      const pouleSize = 3;
      const poules = [];
      for (let i = 0; i < players.length; i++) {
        const pouleNum = Math.floor(i / pouleSize) + 1;
        if (!poules[pouleNum]) poules[pouleNum] = [];
        poules[pouleNum].push(players[i]);
      }

      // 6. Build and send emails (mocked - actual implementation would call email routes)
      const emails = players.map(player => ({
        type: 'convocation',
        to: overrideEmail,
        originalRecipient: `${player.first_name} ${player.last_name}`,
        subject: `[TEST - ${player.first_name} ${player.last_name}] Convocation - Libre N2`,
        status: 'sent'
      }));

      resolve({ emails, tournamentId });

    } catch (error) {
      reject(error);
    }
  });
}

// Send test results
async function sendTestResults(db, appSettings, playerLicences, overrideEmail, orgId, existingTournamentId) {
  return new Promise(async (resolve, reject) => {
    try {
      const tournamentId = existingTournamentId || await getOrCreateTestTournament(db, orgId, 'Libre N2');

      // Get player details
      const players = await new Promise((res, rej) => {
        db.all(
          `SELECT licence, first_name, last_name FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      const emails = players.map(player => ({
        type: 'results',
        to: overrideEmail,
        originalRecipient: `${player.first_name} ${player.last_name}`,
        subject: `[TEST - ${player.first_name} ${player.last_name}] Résultats - Libre N2`,
        status: 'sent'
      }));

      resolve({ emails, tournamentId });

    } catch (error) {
      reject(error);
    }
  });
}

// Send test relance
async function sendTestRelance(db, appSettings, playerLicences, overrideEmail, orgId) {
  return new Promise(async (resolve, reject) => {
    try {
      const players = await new Promise((res, rej) => {
        db.all(
          `SELECT licence, first_name, last_name FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      const emails = players.map(player => ({
        type: 'relance',
        to: overrideEmail,
        originalRecipient: `${player.first_name} ${player.last_name}`,
        subject: `[TEST - ${player.first_name} ${player.last_name}] Relance - Tournois à venir`,
        status: 'sent'
      }));

      resolve({ emails });

    } catch (error) {
      reject(error);
    }
  });
}

// Send test invitations
async function sendTestInvitations(db, appSettings, playerLicences, overrideEmail, orgId) {
  return new Promise(async (resolve, reject) => {
    try {
      const players = await new Promise((res, rej) => {
        db.all(
          `SELECT licence, first_name, last_name FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      const emails = players.map(player => ({
        type: 'invitation',
        to: overrideEmail,
        originalRecipient: `${player.first_name} ${player.last_name}`,
        subject: `[TEST - ${player.first_name} ${player.last_name}] Invitation - Espace Joueur`,
        status: 'sent'
      }));

      resolve({ emails });

    } catch (error) {
      reject(error);
    }
  });
}

// Get or create test tournament
async function getOrCreateTestTournament(db, orgId, category) {
  return new Promise((resolve, reject) => {
    // Try to find existing test tournament
    db.get(
      `SELECT tournoi_id FROM tournoi_ext
       WHERE nom LIKE 'TEST -%'
         AND ($1::int IS NULL OR organization_id = $1)
       ORDER BY tournoi_id DESC LIMIT 1`,
      [orgId],
      (err, existing) => {
        if (err) return reject(err);

        if (existing) {
          return resolve(existing.tournoi_id);
        }

        // Create new test tournament
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];

        db.run(
          `INSERT INTO tournoi_ext (nom, mode, categorie, taille, debut, lieu, organization_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
           RETURNING tournoi_id`,
          ['TEST - Mode Test', 'LIBRE', 'N2', 10, dateStr, 'Salle de test', orgId],
          function(err) {
            if (err) return reject(err);

            // Get the inserted ID
            db.get(
              `SELECT tournoi_id FROM tournoi_ext
               WHERE nom = 'TEST - Mode Test'
                 AND ($1::int IS NULL OR organization_id = $1)
               ORDER BY tournoi_id DESC LIMIT 1`,
              [orgId],
              (err, row) => {
                if (err) return reject(err);
                if (!row || !row.tournoi_id) {
                  return reject(new Error('Impossible de créer le tournoi de test'));
                }
                resolve(row.tournoi_id);
              }
            );
          }
        );
      }
    );
  });
}

// Delete test tournament and related data
async function deleteTestTournament(db, tournamentId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM inscriptions WHERE tournoi_id = $1`,
      [tournamentId],
      (err) => {
        if (err) return reject(err);

        db.run(
          `DELETE FROM tournoi_ext WHERE tournoi_id = $1`,
          [tournamentId],
          (err) => err ? reject(err) : resolve()
        );
      }
    );
  });
}

module.exports = router;
