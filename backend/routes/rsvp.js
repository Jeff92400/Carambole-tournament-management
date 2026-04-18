const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db-loader');
const appSettings = require('../utils/app-settings');

const router = express.Router();

// ==================== RSVP TOKEN GENERATION ====================

/**
 * Generate a signed RSVP token for a player + tournament.
 * Used by email sending pipelines to create one-click response links.
 */
function generateRsvpToken(licence, tournoiId, organizationId) {
  return jwt.sign(
    { type: 'rsvp', licence, tournoi_id: tournoiId, organization_id: organizationId },
    process.env.JWT_SECRET,
    { expiresIn: '60d' }
  );
}

/**
 * Build HTML for RSVP buttons to embed in emails.
 * Returns empty string if no tournoiExtId is provided.
 */
function buildRsvpButtonsHtml(licence, tournoiExtId, organizationId, baseUrl, primaryColor) {
  if (!tournoiExtId) return '';

  const token = generateRsvpToken(licence, tournoiExtId, organizationId);
  const yesUrl = `${baseUrl}/api/rsvp?token=${encodeURIComponent(token)}&response=yes`;
  const noUrl = `${baseUrl}/api/rsvp?token=${encodeURIComponent(token)}&response=no`;

  return `
    <div style="text-align: center; margin: 25px 0; padding: 20px; background: #f0f7ff; border-radius: 12px; border: 1px solid #d0e3f7;">
      <p style="font-weight: bold; margin: 0 0 15px 0; font-size: 16px; color: #333;">Confirmez votre participation en un clic :</p>
      <div>
        <a href="${yesUrl}" target="_blank" style="display: inline-block; background: #28a745; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 5px 8px;">
          ✅ Je participe
        </a>
        <a href="${noUrl}" target="_blank" style="display: inline-block; background: #dc3545; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 5px 8px;">
          ❌ Indisponible
        </a>
      </div>
      <p style="margin: 12px 0 0 0; font-size: 12px; color: #888;">Aucune connexion requise — votre réponse est enregistrée instantanément.</p>
    </div>`;
}

// ==================== DB HELPERS ====================

function dbGet(query, params) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(query, params) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbRun(query, params) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// ==================== RSVP PUBLIC ENDPOINT ====================

router.get('/', async (req, res) => {
  const { token, response } = req.query;

  if (!token || !['yes', 'no'].includes(response)) {
    return res.send(renderPage('Lien invalide', 'error',
      'Ce lien est invalide. Vérifiez que vous avez copié l\'adresse complète depuis votre email.'));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'rsvp') throw new Error('Invalid token type');
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.send(renderPage('Lien expiré', 'warning',
        'Ce lien a expiré. Veuillez contacter votre comité pour confirmer votre participation.'));
    }
    return res.send(renderPage('Lien invalide', 'error',
      'Ce lien est invalide. Vérifiez que vous avez copié l\'adresse complète depuis votre email.'));
  }

  const { licence, tournoi_id, organization_id } = decoded;

  try {
    // Get tournament info
    const tournament = await dbGet(
      'SELECT * FROM tournoi_ext WHERE tournoi_id = $1 AND ($2::int IS NULL OR organization_id = $2)',
      [tournoi_id, organization_id]
    );

    if (!tournament) {
      return res.send(renderPage('Tournoi introuvable', 'error',
        'Ce tournoi n\'existe plus dans le système.'));
    }

    const tournamentName = tournament.nom || 'Tournoi';
    const tournamentDate = tournament.debut
      ? new Date(tournament.debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const tournamentLieu = tournament.lieu || '';
    const tournamentLabel = `${tournamentName}${tournamentDate ? ` du ${tournamentDate}` : ''}${tournamentLieu ? ` à ${tournamentLieu}` : ''}`;

    // Get player info
    const player = await dbGet(
      `SELECT * FROM players WHERE REPLACE(licence, ' ', '') = REPLACE($1, ' ', '') AND ($2::int IS NULL OR organization_id = $2)`,
      [licence, organization_id]
    );
    const playerName = player ? `${player.first_name || ''} ${player.last_name || ''}`.trim() : '';
    const greeting = playerName ? `Bonjour ${playerName},` : 'Bonjour,';

    // Get player contact info (email, phone)
    const contact = await dbGet(
      `SELECT email, telephone FROM player_contacts WHERE REPLACE(licence, ' ', '') = REPLACE($1, ' ', '')`,
      [licence]
    );

    // Check existing inscription
    const existing = await dbGet(
      `SELECT * FROM inscriptions WHERE tournoi_id = $1 AND REPLACE(UPPER(licence), ' ', '') = REPLACE(UPPER($2), ' ', '')`,
      [tournoi_id, licence]
    );

    // Get org branding
    const orgSettings = organization_id
      ? await appSettings.getOrgSettingsBatch(organization_id, ['primary_color', 'organization_short_name', 'organization_name', 'summary_email', 'player_app_url', 'email_noreply', 'email_communication'])
      : {};
    const primaryColor = orgSettings.primary_color || '#1F4788';
    const orgShortName = orgSettings.organization_short_name || '';
    const orgName = orgSettings.organization_name || '';
    const adminEmail = orgSettings.summary_email || '';
    const playerEmail = contact?.email || player?.email || '';

    if (response === 'yes') {
      // --- PLAYER WANTS TO PARTICIPATE ---

      if (existing) {
        if (existing.statut === 'désinscrit') {
          return res.send(renderPage('Inscription impossible', 'warning',
            `${greeting}<br><br>Vous vous êtes précédemment désinscrit(e) du tournoi <strong>${tournamentLabel}</strong>.<br><br>Veuillez contacter votre comité${adminEmail ? ` (<a href="mailto:${adminEmail}">${adminEmail}</a>)` : ''} pour vous réinscrire.`,
            primaryColor, orgShortName));
        }
        if (existing.statut === 'indisponible') {
          // Re-activate: change from indisponible to inscrit
          await dbRun(
            `UPDATE inscriptions SET statut = 'inscrit', source = 'email', timestamp = CURRENT_TIMESTAMP WHERE inscription_id = $1`,
            [existing.inscription_id]
          );
          await notifyAdmin(organization_id, licence, playerName, tournamentName, 'inscription', adminEmail, primaryColor, orgShortName, orgName);
          await notifyPlayer(organization_id, playerEmail, playerName, tournamentLabel, 'inscription', primaryColor, orgShortName, orgName, orgSettings);
          return res.send(renderPage('Inscription confirmée', 'success',
            `${greeting}<br><br>Votre précédente indisponibilité a été annulée. Vous êtes maintenant <strong>inscrit(e)</strong> au tournoi :<br><br><strong>${tournamentLabel}</strong>`,
            primaryColor, orgShortName));
        }
        // Already inscrit
        return res.send(renderPage('Déjà inscrit(e)', 'info',
          `${greeting}<br><br>Vous êtes déjà inscrit(e) au tournoi :<br><br><strong>${tournamentLabel}</strong>`,
          primaryColor, orgShortName));
      }

      // Create new inscription
      const nextId = await getNextInscriptionId();
      const playerEmail = contact?.email || player?.email || '';
      const playerPhone = contact?.telephone || player?.telephone || '';

      await dbRun(
        `INSERT INTO inscriptions (inscription_id, tournoi_id, licence, email, telephone, source, statut, timestamp, organization_id)
         VALUES ($1, $2, $3, $4, $5, 'email', 'inscrit', CURRENT_TIMESTAMP, $6)`,
        [nextId, tournoi_id, licence.replace(/\s/g, ''), playerEmail, playerPhone, organization_id]
      );

      await notifyAdmin(organization_id, licence, playerName, tournamentName, 'inscription', adminEmail, primaryColor, orgShortName, orgName);
      await notifyPlayer(organization_id, playerEmail, playerName, tournamentLabel, 'inscription', primaryColor, orgShortName, orgName, orgSettings);

      return res.send(renderPage('Inscription confirmée', 'success',
        `${greeting}<br><br>Votre inscription au tournoi suivant a bien été enregistrée :<br><br><strong>${tournamentLabel}</strong><br><br>Vous recevrez une convocation par email avant le tournoi.`,
        primaryColor, orgShortName));

    } else {
      // --- PLAYER IS UNAVAILABLE ---

      if (existing) {
        if (existing.statut === 'inscrit') {
          // Change from inscrit to indisponible
          await dbRun(
            `UPDATE inscriptions SET statut = 'indisponible', source = 'email', timestamp = CURRENT_TIMESTAMP WHERE inscription_id = $1`,
            [existing.inscription_id]
          );
          await notifyAdmin(organization_id, licence, playerName, tournamentName, 'indisponible', adminEmail, primaryColor, orgShortName, orgName);
          await notifyPlayer(organization_id, playerEmail, playerName, tournamentLabel, 'indisponible', primaryColor, orgShortName, orgName, orgSettings);
          return res.send(renderPage('Indisponibilité enregistrée', 'info',
            `${greeting}<br><br>Votre précédente inscription a été annulée. Votre indisponibilité pour le tournoi suivant a été notée :<br><br><strong>${tournamentLabel}</strong><br><br>Si vous changez d'avis, cliquez sur le lien "Je participe" dans l'email original.`,
            primaryColor, orgShortName));
        }
        if (existing.statut === 'indisponible') {
          return res.send(renderPage('Déjà enregistré', 'info',
            `${greeting}<br><br>Votre indisponibilité pour le tournoi <strong>${tournamentLabel}</strong> a déjà été enregistrée.`,
            primaryColor, orgShortName));
        }
        if (existing.statut === 'désinscrit') {
          return res.send(renderPage('Déjà désinscrit(e)', 'info',
            `${greeting}<br><br>Vous êtes déjà désinscrit(e) du tournoi <strong>${tournamentLabel}</strong>.`,
            primaryColor, orgShortName));
        }
      }

      // Create new inscription with statut 'indisponible'
      const nextId = await getNextInscriptionId();
      const playerEmail = contact?.email || player?.email || '';
      const playerPhone = contact?.telephone || player?.telephone || '';

      await dbRun(
        `INSERT INTO inscriptions (inscription_id, tournoi_id, licence, email, telephone, source, statut, timestamp, organization_id)
         VALUES ($1, $2, $3, $4, $5, 'email', 'indisponible', CURRENT_TIMESTAMP, $6)`,
        [nextId, tournoi_id, licence.replace(/\s/g, ''), playerEmail, playerPhone, organization_id]
      );

      await notifyAdmin(organization_id, licence, playerName, tournamentName, 'indisponible', adminEmail, primaryColor, orgShortName, orgName);
      await notifyPlayer(organization_id, playerEmail, playerName, tournamentLabel, 'indisponible', primaryColor, orgShortName, orgName, orgSettings);

      return res.send(renderPage('Indisponibilité enregistrée', 'info',
        `${greeting}<br><br>Votre indisponibilité pour le tournoi suivant a été notée :<br><br><strong>${tournamentLabel}</strong><br><br>Merci de nous avoir informés. Si vous changez d'avis, cliquez sur le lien "Je participe" dans l'email original.`,
        primaryColor, orgShortName));
    }

  } catch (error) {
    console.error('[RSVP] Error processing response:', error);
    return res.send(renderPage('Erreur', 'error',
      'Une erreur technique est survenue. Veuillez réessayer ou contacter votre comité.'));
  }
});

// ==================== HELPERS ====================

async function getNextInscriptionId() {
  const maxRow = await dbGet(
    'SELECT COALESCE(MAX(inscription_id), 0) as max_id FROM inscriptions',
    []
  );
  return (maxRow?.max_id || 0) + 1;
}

async function notifyAdmin(orgId, licence, playerName, tournamentName, responseType, adminEmail, primaryColor, orgShortName, orgName) {
  if (!adminEmail) return;

  try {
    const { Resend } = require('resend');
    if (!process.env.RESEND_API_KEY) return;
    const resend = new Resend(process.env.RESEND_API_KEY);

    const senderEmail = orgId
      ? (await appSettings.getOrgSetting(orgId, 'email_noreply') || 'noreply@carambole-gestion.fr')
      : 'noreply@carambole-gestion.fr';
    const senderName = orgShortName || 'Gestion Tournois';
    const color = primaryColor || '#1F4788';

    const isInscription = responseType === 'inscription';
    const statusLabel = isInscription ? 'INSCRIPTION' : 'INDISPONIBILITÉ';
    const statusColor = isInscription ? '#28a745' : '#dc3545';
    const statusEmoji = isInscription ? '✅' : '❌';
    const displayName = playerName || licence;

    await resend.emails.send({
      from: `${senderName} <${senderEmail}>`,
      to: [adminEmail],
      subject: `${statusEmoji} ${statusLabel} par email - ${displayName} - ${tournamentName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <div style="background: ${color}; color: white; padding: 15px; text-align: center;">
            <h2 style="margin: 0; font-size: 18px;">${orgName || senderName}</h2>
          </div>
          <div style="padding: 20px; background: #f8f9fa;">
            <div style="background: ${isInscription ? '#d4edda' : '#f8d7da'}; border-left: 4px solid ${statusColor}; padding: 15px; margin-bottom: 15px;">
              <strong>${statusEmoji} ${statusLabel}</strong> via lien email
            </div>
            <p><strong>Joueur :</strong> ${displayName}</p>
            <p><strong>Licence :</strong> ${licence}</p>
            <p><strong>Tournoi :</strong> ${tournamentName}</p>
            <p style="font-size: 12px; color: #888; margin-top: 20px;">Réponse enregistrée via le lien RSVP dans l'email de relance.</p>
          </div>
        </div>`
    });
  } catch (error) {
    console.error('[RSVP] Error sending admin notification:', error.message);
  }
}

async function notifyPlayer(orgId, playerEmail, playerName, tournamentLabel, responseType, primaryColor, orgShortName, orgName, orgSettings) {
  if (!playerEmail) return;

  try {
    const { Resend } = require('resend');
    if (!process.env.RESEND_API_KEY) return;
    const resend = new Resend(process.env.RESEND_API_KEY);

    const senderEmail = orgSettings?.email_noreply || 'noreply@carambole-gestion.fr';
    const replyTo = orgSettings?.email_communication || orgSettings?.summary_email || undefined;
    const senderName = orgShortName || 'Gestion Tournois';
    const color = primaryColor || '#1F4788';

    const isInscription = responseType === 'inscription';
    const statusEmoji = isInscription ? '✅' : '📋';
    const subjectText = isInscription ? 'Confirmation d\'inscription' : 'Indisponibilité enregistrée';
    const greeting = playerName ? `Bonjour ${playerName},` : 'Bonjour,';

    const bodyText = isInscription
      ? `Votre inscription au tournoi suivant a bien été enregistrée :<br><br><strong>${tournamentLabel}</strong><br><br>Vous recevrez une convocation par email avant le tournoi.`
      : `Votre indisponibilité pour le tournoi suivant a bien été enregistrée :<br><br><strong>${tournamentLabel}</strong><br><br>Si vous changez d'avis, cliquez sur le lien « Je participe » dans l'email de relance original.`;

    const emailOptions = {
      from: `${senderName} <${senderEmail}>`,
      to: [playerEmail],
      subject: `${statusEmoji} ${subjectText} - ${orgShortName || 'Tournoi'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto;">
          <div style="background: ${color}; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">${orgName || senderName}</h2>
          </div>
          <div style="padding: 25px; background: #ffffff;">
            <p style="font-size: 15px; margin-bottom: 20px;">${greeting}</p>
            <div style="background: ${isInscription ? '#d4edda' : '#e2e3e5'}; border-left: 4px solid ${isInscription ? '#28a745' : '#6c757d'}; padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
              <p style="margin: 0; font-size: 15px; line-height: 1.6;">${bodyText}</p>
            </div>
            <p style="font-size: 13px; color: #666;">Cet email est une confirmation automatique suite à votre réponse par email.</p>
          </div>
          <div style="background: ${color}; color: white; padding: 10px; text-align: center; font-size: 12px;">
            ${orgName || senderName}
          </div>
        </div>`
    };
    if (replyTo) emailOptions.replyTo = replyTo;

    await resend.emails.send(emailOptions);
  } catch (error) {
    console.error('[RSVP] Error sending player confirmation:', error.message);
  }
}

function renderPage(title, type, message, primaryColor, orgShortName) {
  const color = primaryColor || '#1F4788';
  const org = orgShortName || '';

  const iconMap = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  const bgMap = {
    success: '#d4edda',
    error: '#f8d7da',
    warning: '#fff3cd',
    info: '#d1ecf1'
  };
  const borderMap = {
    success: '#28a745',
    error: '#dc3545',
    warning: '#ffc107',
    info: '#17a2b8'
  };

  const icon = iconMap[type] || '';
  const bg = bgMap[type] || bgMap.info;
  const border = borderMap[type] || borderMap.info;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}${org ? ` - ${org}` : ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #f0f2f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 500px; width: 100%; overflow: hidden; }
    .header { background: ${color}; color: white; padding: 20px; text-align: center; }
    .header h1 { font-size: 20px; margin: 0; }
    .body { padding: 30px; }
    .status { background: ${bg}; border-left: 4px solid ${border}; padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 20px; }
    .status-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .message { line-height: 1.6; color: #333; font-size: 15px; }
    .footer { padding: 15px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${org || 'Gestion des Tournois'}</h1>
    </div>
    <div class="body">
      <div class="status">
        <div class="status-title">${icon} ${title}</div>
      </div>
      <div class="message">${message}</div>
    </div>
    <div class="footer">
      ${org ? `${org} — ` : ''}Réponse par email
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;
module.exports.generateRsvpToken = generateRsvpToken;
module.exports.buildRsvpButtonsHtml = buildRsvpButtonsHtml;
