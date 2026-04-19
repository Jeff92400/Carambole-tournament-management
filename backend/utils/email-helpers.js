/**
 * Email template helpers — shared between routes/email.js and routes/emailing.js.
 *
 * These 4 functions were duplicated verbatim (with minor drift) across the two
 * route files for ~1 year. The audit Phase 5 finding C3 flagged the duplication
 * as a source of silent divergence — whenever a new email type was added on
 * one side, the other could end up using a stale subset of settings.
 *
 * This module is the canonical source of truth. Any new email setting key
 * must be added here first.
 */

const appSettings = require('./app-settings');

/**
 * Return the summary email address for an organization. Used as the CC target
 * for admin summary emails (recap after finale, etc.).
 *
 * @param {number|null} orgId
 * @returns {Promise<string|null>} Email address or null if not configured.
 */
async function getSummaryEmail(orgId) {
  const value = await appSettings.getOrgSetting(orgId, 'summary_email');
  return value || null;
}

/**
 * Return the contact email address shown to players in email templates.
 * Currently aliased to summary_email — could be split later if needed.
 *
 * @param {number|null} orgId
 * @returns {Promise<string|null>}
 */
async function getContactEmail(orgId) {
  return appSettings.getOrgSetting(orgId, 'summary_email');
}

/**
 * Fetch all email/branding settings needed to render a template in one call.
 * Returns an object with one key per setting name.
 *
 * @param {number|null} orgId
 * @returns {Promise<object>}
 */
async function getEmailTemplateSettings(orgId) {
  return appSettings.getOrgSettingsBatch(orgId, [
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
}

/**
 * Build a "From" header value of the form `"Sender Name <email@domain>"`.
 *
 * @param {object} settings - Result of getEmailTemplateSettings.
 * @param {'noreply'|'convocations'|'communication'} [type='noreply']
 * @returns {string}
 */
function buildFromAddress(settings, type = 'noreply') {
  const senderName = settings.email_sender_name || 'CDBHS';
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

/**
 * Build the "Contact us" HTML block used at the bottom of email templates.
 *
 * @param {string} email - Recipient for mailto link.
 * @param {string} [primaryColor='#1F4788']
 * @returns {string} HTML snippet.
 */
function buildContactPhraseHtml(email, primaryColor = '#1F4788') {
  return `<p style="margin-top: 20px; padding: 10px; background: #e8f4f8; border-left: 3px solid ${primaryColor}; font-size: 14px;">
  Pour toute question ou information, écrivez à <a href="mailto:${email}" style="color: ${primaryColor};">${email}</a>
</p>`;
}

module.exports = {
  getSummaryEmail,
  getContactEmail,
  getEmailTemplateSettings,
  buildFromAddress,
  buildContactPhraseHtml
};
