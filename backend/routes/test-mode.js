const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../db-loader');
const appSettings = require('../utils/app-settings');
const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// ==================== HELPER FUNCTIONS ====================

// Get email template from database
async function getEmailTemplate(templateKey, orgId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM email_templates
       WHERE template_key = $1
         AND ($2::int IS NULL OR organization_id = $2)
       LIMIT 1`,
      [templateKey, orgId],
      (err, row) => {
        if (err) reject(err);
        else if (!row) {
          // Fallback to default template
          resolve({
            subject: '[TEST] Convocation - {player_name} - {category}',
            body: 'Bonjour {first_name} {last_name},\n\nVous êtes convoqué(e) pour le {tournament} en {category}.\n\nDate : {date}\nHeure : {time}\nLieu : {location}\nVotre poule : {poule}\n\nMerci de confirmer votre présence.'
          });
        } else {
          // Return subject_template and body_template as subject and body
          resolve({
            subject: row.subject_template,
            body: row.body_template
          });
        }
      }
    );
  });
}

// Replace template variables
function replaceTemplateVariables(text, variables) {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value || '');
  }
  return result;
}

// Build "from" address for emails
function buildFromAddress(settings, type = 'noreply') {
  const senderName = settings.email_sender_name || 'CDB';
  let email;
  switch (type) {
    case 'convocations':
      email = settings.email_convocations || 'convocations@cdbhs.net';
      break;
    case 'communication':
      email = settings.email_communication || 'communication@cdbhs.net';
      break;
    default:
      email = settings.email_noreply || 'noreply@cdbhs.net';
  }
  return `${senderName} <${email}>`;
}

// Get contact email
async function getContactEmail(orgId) {
  return appSettings.getOrgSetting(orgId, 'summary_email');
}

// Get email template settings
async function getEmailTemplateSettings(orgId) {
  const settings = await appSettings.getOrgSettingsBatch(orgId, [
    'primary_color',
    'secondary_color',
    'accent_color',
    'email_noreply',
    'email_convocations',
    'email_communication',
    'email_sender_name',
    'organization_name',
    'organization_short_name',
    'summary_email'
  ]);
  return settings;
}

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

// ==================== TOURNAMENT-SPECIFIC FUNCTIONS ====================

// Send test convocations with REAL email template and sending
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
            `INSERT INTO inscriptions (inscription_id, tournoi_id, licence, timestamp, source, statut, organization_id)
             VALUES ((SELECT COALESCE(MAX(inscription_id), 0) + 1 FROM inscriptions WHERE ($1::int IS NULL OR organization_id = $1)), $2, $3, CURRENT_TIMESTAMP, 'manual', 'inscrit', $4)`,
            [orgId, tournamentId, player.licence, orgId],
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

      // 6. Load REAL email template from database
      const emailTemplate = await getEmailTemplate('convocation', orgId);

      // 7. Get branding settings
      const emailSettings = await getEmailTemplateSettings(orgId);
      const primaryColor = emailSettings.primary_color || '#1F4788';
      const orgShortName = emailSettings.organization_short_name || 'CDB';
      const contactEmail = await getContactEmail(orgId);
      const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
      const orgSlug = await appSettings.getOrgSlug(orgId);
      const logoUrl = appSettings.buildLogoUrl(baseUrl, orgSlug);

      // 8. Prepare tournament info
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      // 9. Send REAL emails via Resend
      const emails = [];
      for (let index = 0; index < players.length; index++) {
        const player = players[index];
        const pouleNum = Math.floor(index / pouleSize) + 1;

        // Prepare template variables
        const templateVariables = {
          player_name: `${player.first_name} ${player.last_name}`,
          first_name: player.first_name,
          last_name: player.last_name,
          club: player.club || '',
          category: 'Libre N2',
          tournament: 'TEST - Mode Test',
          date: dateStr,
          tournament_date: dateStr,
          time: '14H00',
          tournament_lieu: 'Salle de test',
          location: 'Salle de test',
          poule: pouleNum,
          distance: '80',
          reprises: '25',
          organization_name: emailSettings.organization_name || 'Comité Départemental de Billard',
          organization_short_name: orgShortName,
          organization_email: contactEmail
        };

        // Generate subject and body from template
        const emailSubject = '[TEST] ' + replaceTemplateVariables(emailTemplate.subject, templateVariables);
        const emailBodyText = replaceTemplateVariables(emailTemplate.body, templateVariables);
        const emailBodyHtml = emailBodyText.replace(/\n/g, '<br>');

        // Build HTML email with real branding
        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
              <img src="${logoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
              <h1 style="margin: 0; font-size: 24px;">${orgShortName}</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">CONVOCATION - MODE TEST</p>
            </div>

            <div style="padding: 20px; background: #f8f9fa;">
              <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-weight: 600;">🧪 Ceci est un email de TEST</p>
                <p style="margin: 5px 0 0 0; color: #856404; font-size: 13px;">Généré par le Mode Test pour vérifier le rendu des emails.</p>
              </div>

              <div style="margin-bottom: 20px; padding: 15px; background: white; border-radius: 4px; border-left: 4px solid ${primaryColor};">
                <p style="margin: 5px 0;"><strong>Catégorie :</strong> Libre N2</p>
                <p style="margin: 5px 0;"><strong>Compétition :</strong> TEST - Mode Test</p>
                <p style="margin: 5px 0;"><strong>Date :</strong> ${dateStr}</p>
                <p style="margin: 5px 0;"><strong>Heure :</strong> 14H00</p>
                <p style="margin: 5px 0;"><strong>Lieu :</strong> Salle de test</p>
                <p style="margin: 5px 0;"><strong>Votre poule :</strong> ${pouleNum}</p>
              </div>

              <div style="line-height: 1.6;">
                ${emailBodyHtml}
              </div>

              <p style="margin-top: 20px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; font-size: 13px;">
                📧 <strong>Contact :</strong> Pour toute question, contactez-nous à
                <a href="mailto:${contactEmail}" style="color: ${primaryColor};">${contactEmail}</a>
              </p>
            </div>

            <div style="background: ${primaryColor}; color: white; padding: 10px; text-align: center; font-size: 12px;">
              <p style="margin: 0;">${orgShortName} - <a href="mailto:${contactEmail}" style="color: white;">${contactEmail}</a></p>
            </div>
          </div>
        `;

        // Send via Resend
        try {
          const emailResult = await resend.emails.send({
            from: buildFromAddress(emailSettings, 'convocations'),
            replyTo: contactEmail,
            to: [overrideEmail],
            subject: emailSubject,
            html: htmlContent
          });

          console.log('[Test Mode] Email sent:', emailResult);

          emails.push({
            type: 'convocation',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'sent'
          });
        } catch (error) {
          console.error('[Test Mode] Email error:', error);
          emails.push({
            type: 'convocation',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'failed',
            error: error.message
          });
        }
      }

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
          `SELECT licence, first_name, last_name, club FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      // Load email template
      const emailTemplate = await getEmailTemplate('results', orgId);

      // Get branding settings
      const emailSettings = await getEmailTemplateSettings(orgId);
      const primaryColor = emailSettings.primary_color || '#1F4788';
      const orgShortName = emailSettings.organization_short_name || 'CDB';
      const contactEmail = await getContactEmail(orgId);
      const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
      const orgSlug = await appSettings.getOrgSlug(orgId);
      const logoUrl = appSettings.buildLogoUrl(baseUrl, orgSlug);

      // Tournament info
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      // Send emails
      const emails = [];
      for (let index = 0; index < players.length; index++) {
        const player = players[index];
        const position = index + 1;

        // Template variables
        const templateVariables = {
          player_name: `${player.first_name} ${player.last_name}`,
          first_name: player.first_name,
          last_name: player.last_name,
          club: player.club || '',
          category: 'Libre N2',
          tournament: 'TEST - Mode Test',
          date: dateStr,
          tournament_date: dateStr,
          position: position,
          organization_name: emailSettings.organization_name || 'Comité Départemental de Billard',
          organization_short_name: orgShortName,
          organization_email: contactEmail
        };

        const emailSubject = '[TEST] ' + replaceTemplateVariables(emailTemplate.subject, templateVariables);
        const emailBodyText = replaceTemplateVariables(emailTemplate.body, templateVariables);
        const emailBodyHtml = emailBodyText.replace(/\n/g, '<br>');

        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
              <img src="${logoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
              <h1 style="margin: 0; font-size: 24px;">${orgShortName}</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">RÉSULTATS - MODE TEST</p>
            </div>

            <div style="padding: 20px; background: #f8f9fa;">
              <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-weight: 600;">🧪 Ceci est un email de TEST</p>
                <p style="margin: 5px 0 0 0; color: #856404; font-size: 13px;">Généré par le Mode Test pour vérifier le rendu des emails.</p>
              </div>

              <div style="line-height: 1.6;">
                ${emailBodyHtml}
              </div>

              <p style="margin-top: 20px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; font-size: 13px;">
                📧 <strong>Contact :</strong> Pour toute question, contactez-nous à
                <a href="mailto:${contactEmail}" style="color: ${primaryColor};">${contactEmail}</a>
              </p>
            </div>

            <div style="background: ${primaryColor}; color: white; padding: 10px; text-align: center; font-size: 12px;">
              <p style="margin: 0;">${orgShortName} - <a href="mailto:${contactEmail}" style="color: white;">${contactEmail}</a></p>
            </div>
          </div>
        `;

        try {
          await resend.emails.send({
            from: buildFromAddress(emailSettings, 'communication'),
            replyTo: contactEmail,
            to: [overrideEmail],
            subject: emailSubject,
            html: htmlContent
          });

          emails.push({
            type: 'results',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'sent'
          });
        } catch (error) {
          emails.push({
            type: 'results',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'failed',
            error: error.message
          });
        }
      }

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
          `SELECT licence, first_name, last_name, club FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      // Load email template
      const emailTemplate = await getEmailTemplate('relance', orgId);

      // Get branding settings
      const emailSettings = await getEmailTemplateSettings(orgId);
      const primaryColor = emailSettings.primary_color || '#1F4788';
      const orgShortName = emailSettings.organization_short_name || 'CDB';
      const contactEmail = await getContactEmail(orgId);
      const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
      const orgSlug = await appSettings.getOrgSlug(orgId);
      const logoUrl = appSettings.buildLogoUrl(baseUrl, orgSlug);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      const closingDate = tomorrow.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

      const emails = [];
      for (const player of players) {
        const templateVariables = {
          player_name: `${player.first_name} ${player.last_name}`,
          first_name: player.first_name,
          last_name: player.last_name,
          club: player.club || '',
          category: 'Libre N2',
          tournament: 'TEST - Mode Test',
          tournament_date: closingDate,
          deadline_date: closingDate,
          organization_name: emailSettings.organization_name || 'Comité Départemental de Billard',
          organization_short_name: orgShortName,
          organization_email: contactEmail
        };

        const emailSubject = '[TEST] ' + replaceTemplateVariables(emailTemplate.subject, templateVariables);
        const emailBodyText = replaceTemplateVariables(emailTemplate.body, templateVariables);
        const emailBodyHtml = emailBodyText.replace(/\n/g, '<br>');

        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
              <img src="${logoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
              <h1 style="margin: 0; font-size: 24px;">${orgShortName}</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">RELANCE - MODE TEST</p>
            </div>

            <div style="padding: 20px; background: #f8f9fa;">
              <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-weight: 600;">🧪 Ceci est un email de TEST</p>
                <p style="margin: 5px 0 0 0; color: #856404; font-size: 13px;">Généré par le Mode Test pour vérifier le rendu des emails.</p>
              </div>

              <div style="line-height: 1.6;">
                ${emailBodyHtml}
              </div>

              <p style="margin-top: 20px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; font-size: 13px;">
                📧 <strong>Contact :</strong> Pour toute question, contactez-nous à
                <a href="mailto:${contactEmail}" style="color: ${primaryColor};">${contactEmail}</a>
              </p>
            </div>

            <div style="background: ${primaryColor}; color: white; padding: 10px; text-align: center; font-size: 12px;">
              <p style="margin: 0;">${orgShortName} - <a href="mailto:${contactEmail}" style="color: white;">${contactEmail}</a></p>
            </div>
          </div>
        `;

        try {
          await resend.emails.send({
            from: buildFromAddress(emailSettings, 'communication'),
            replyTo: contactEmail,
            to: [overrideEmail],
            subject: emailSubject,
            html: htmlContent
          });

          emails.push({
            type: 'relance',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'sent'
          });
        } catch (error) {
          emails.push({
            type: 'relance',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'failed',
            error: error.message
          });
        }
      }

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
          `SELECT licence, first_name, last_name, club FROM players
           WHERE licence IN (${playerLicences.map(() => '?').join(',')})`,
          playerLicences,
          (err, rows) => err ? rej(err) : res(rows || [])
        );
      });

      // Load email template
      const emailTemplate = await getEmailTemplate('invitation', orgId);

      // Get branding settings
      const emailSettings = await getEmailTemplateSettings(orgId);
      const primaryColor = emailSettings.primary_color || '#1F4788';
      const orgShortName = emailSettings.organization_short_name || 'CDB';
      const contactEmail = await getContactEmail(orgId);
      const baseUrl = process.env.BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app';
      const orgSlug = await appSettings.getOrgSlug(orgId);
      const logoUrl = appSettings.buildLogoUrl(baseUrl, orgSlug);

      const emails = [];
      for (const player of players) {
        const templateVariables = {
          player_name: `${player.first_name} ${player.last_name}`,
          first_name: player.first_name,
          last_name: player.last_name,
          club: player.club || '',
          organization_name: emailSettings.organization_name || 'Comité Départemental de Billard',
          organization_short_name: orgShortName,
          organization_email: contactEmail
        };

        const emailSubject = '[TEST] ' + replaceTemplateVariables(emailTemplate.subject, templateVariables);
        const emailBodyText = replaceTemplateVariables(emailTemplate.body, templateVariables);
        const emailBodyHtml = emailBodyText.replace(/\n/g, '<br>');

        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${primaryColor}; color: white; padding: 20px; text-align: center;">
              <img src="${logoUrl}" alt="${orgShortName}" style="height: 60px; max-width: 80%; width: auto; margin-bottom: 10px;" onerror="this.style.display='none'">
              <h1 style="margin: 0; font-size: 24px;">${orgShortName}</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">INVITATION - MODE TEST</p>
            </div>

            <div style="padding: 20px; background: #f8f9fa;">
              <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-weight: 600;">🧪 Ceci est un email de TEST</p>
                <p style="margin: 5px 0 0 0; color: #856404; font-size: 13px;">Généré par le Mode Test pour vérifier le rendu des emails.</p>
              </div>

              <div style="line-height: 1.6;">
                ${emailBodyHtml}
              </div>

              <p style="margin-top: 20px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; font-size: 13px;">
                📧 <strong>Contact :</strong> Pour toute question, contactez-nous à
                <a href="mailto:${contactEmail}" style="color: ${primaryColor};">${contactEmail}</a>
              </p>
            </div>

            <div style="background: ${primaryColor}; color: white; padding: 10px; text-align: center; font-size: 12px;">
              <p style="margin: 0;">${orgShortName} - <a href="mailto:${contactEmail}" style="color: white;">${contactEmail}</a></p>
            </div>
          </div>
        `;

        try {
          await resend.emails.send({
            from: buildFromAddress(emailSettings, 'communication'),
            replyTo: contactEmail,
            to: [overrideEmail],
            subject: emailSubject,
            html: htmlContent
          });

          emails.push({
            type: 'invitation',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'sent'
          });
        } catch (error) {
          emails.push({
            type: 'invitation',
            to: overrideEmail,
            originalRecipient: `${player.first_name} ${player.last_name}`,
            subject: emailSubject,
            status: 'failed',
            error: error.message
          });
        }
      }

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

        // Create new test tournament - need to generate tournoi_id first
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];

        // Get next tournoi_id
        db.get(
          'SELECT MAX(tournoi_id) as max_id FROM tournoi_ext WHERE ($1::int IS NULL OR organization_id = $1)',
          [orgId],
          (err, maxIdResult) => {
            if (err) return reject(err);

            const nextId = (maxIdResult?.max_id || 0) + 1;

            // Insert with explicit tournoi_id
            db.run(
              `INSERT INTO tournoi_ext (tournoi_id, nom, mode, categorie, taille, debut, lieu, organization_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
              [nextId, 'TEST - Mode Test', 'LIBRE', 'N2', 10, dateStr, 'Salle de test', orgId],
              function(err) {
                if (err) return reject(err);
                resolve(nextId);
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

// ==================== SIMPLIFIED TEMPLATE TESTING ====================

// Generate fake template variables based on template key
function generateFakeTemplateData(templateKey) {
  const baseData = {
    first_name: 'Jean',
    last_name: 'Dupont',
    player_name: 'Jean Dupont',
    club: 'BC Paris',
    category: 'Libre N2',
    tournament: 'T1',
    tournament_name: 'Tournoi Qualificatif 1 - Libre N2',
    date: '15/03/2026',
    tournament_date: '15/03/2026',
    time: '14H00',
    tournament_lieu: 'Salle Charenton',
    location: 'Salle Charenton',
    poule: '1',
    distance: '80',
    reprises: '25',
    deadline_date: '08/03/2026',
    closing_date: '08/03/2026',
    position: '3e',
    organization_name: 'Comité Départemental de Billard',
    organization_short_name: 'CDB',
    organization_email: 'contact@cdbhs.net'
  };

  // Template-specific additions
  switch (templateKey) {
    case 'results':
    case 'results-finale':
      baseData.position = '3e';
      baseData.tournament_name = templateKey === 'results-finale'
        ? 'Finale Départementale - Libre N2'
        : 'Tournoi Qualificatif 1 - Libre N2';
      break;

    case 'relance':
    case 'rappel-club':
      baseData.deadline_date = '08/03/2026';
      baseData.closing_date = '08/03/2026';
      break;

    case 'convocation-finale':
      baseData.tournament = 'Finale';
      baseData.tournament_name = 'Finale Départementale - Libre N2';
      break;

    case 'confirmation':
    case 'desinscription':
      // Use base data as is
      break;
  }

  return baseData;
}

// POST /api/test-mode/send-template - Simplified template testing
// Sends ONE test email to the logged-in admin for the specified template
router.post('/send-template', authenticateToken, async (req, res) => {
  try {
    const { templateKey } = req.body;
    const orgId = req.user.organizationId || null;
    const adminEmail = req.user.email; // Get admin email from JWT

    if (!templateKey) {
      return res.status(400).json({ error: 'Template key is required' });
    }

    if (!adminEmail) {
      return res.status(400).json({ error: 'Admin email not found in session' });
    }

    // Generate fake template data
    const fakeData = generateFakeTemplateData(templateKey);

    // Load template from database
    const template = await getEmailTemplate(templateKey, orgId);

    // Get email settings
    const settings = await getEmailTemplateSettings(orgId);
    const contactEmail = await getContactEmail(orgId);

    // Replace variables in subject and body
    const subject = '[TEST] ' + replaceTemplateVariables(template.subject, fakeData);
    const bodyText = replaceTemplateVariables(template.body, fakeData);

    // Build HTML email
    const primaryColor = settings.primary_color || '#1F4788';
    const secondaryColor = settings.secondary_color || '#667eea';
    const backgroundColor = settings.background_color || '#ffffff';
    const orgName = settings.organization_short_name || 'CDB';

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <!-- Test Mode Warning -->
  <div style="background: #fff3cd; border-bottom: 3px solid #ffc107; padding: 12px; text-align: center;">
    <strong style="color: #856404; font-size: 14px;">🧪 MODE TEST - Cet email est un test et ne correspond à aucune vraie compétition</strong>
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; background-color: ${backgroundColor}; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">${orgName}</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Gestion des compétitions départementales FFB</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <div style="white-space: pre-wrap; line-height: 1.6; color: #333; font-size: 15px;">
${bodyText}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #6c757d; font-size: 13px;">
                Pour toute question, contactez-nous à <a href="mailto:${contactEmail}" style="color: ${primaryColor}; text-decoration: none;">${contactEmail}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Determine from address based on template type
    let fromType = 'noreply';
    if (templateKey.includes('convocation')) {
      fromType = 'convocations';
    } else if (templateKey.includes('results') || templateKey.includes('relance')) {
      fromType = 'communication';
    }
    const fromAddress = buildFromAddress(settings, fromType);

    // Send email via Resend
    const emailResult = await resend.emails.send({
      from: fromAddress,
      to: adminEmail,
      subject: subject,
      html: htmlBody
    });

    res.json({
      success: true,
      message: `Email de test envoyé à ${adminEmail}`,
      templateKey: templateKey,
      emailId: emailResult.id,
      to: adminEmail
    });

  } catch (error) {
    console.error('Error sending test template:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'envoi du test',
      details: error.message
    });
  }
});

module.exports = router;
