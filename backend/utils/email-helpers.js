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

const { Resend } = require('resend');
const appSettings = require('./app-settings');
const db = require('../db-loader');

// Single Resend instance shared across all routes. Instantiated lazily so that
// routes that don't send email (or test harnesses without RESEND_API_KEY)
// don't crash on import.
let _resendSingleton = null;
function getResend() {
  if (!_resendSingleton) {
    _resendSingleton = new Resend(process.env.RESEND_API_KEY);
  }
  return _resendSingleton;
}

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

// ============================================================================
// TEST MODE CHOKEPOINT
// ============================================================================
//
// All outgoing email (and, in push.js, all outgoing push notifications) MUST go
// through sendEmail() / logSkippedSend() rather than calling resend.emails.send()
// directly. This is enforced by a grep check in CI — any raw
// `resend.emails.send(` call outside this file is a bug.
//
// Behavior:
//   - recipient_kind='player'  AND  org setting email_test_mode_enabled='true'
//       -> email is NOT sent, a row is inserted in email_test_mode_log,
//          and { skipped: true, reason: 'test_mode_players_blocked' } is returned.
//   - All other cases: email is sent via Resend and the raw SDK response is
//     returned (shape: { data: { id }, error }).
//
// Call sites must pass `recipientKind`. The correct classification is:
//   'player' — convocations, results, relances, player invitations, RSVP,
//              announcements to players, registration confirmations, etc.
//   'admin'  — password reset, enrollment requests to super admin, CDB welcome
//              emails, admin summary/digest emails, RSVP notifications to admin.
// When in doubt: if the recipient is a licensed player acting as a competitor,
// it's 'player'. If the recipient is a platform/CDB administrator, it's 'admin'.

/**
 * Check whether the given org has test mode enabled.
 *
 * @param {number|null} orgId
 * @returns {Promise<boolean>}
 */
async function isTestModeEnabled(orgId) {
  if (!orgId) return false;
  const value = await appSettings.getOrgSetting(orgId, 'email_test_mode_enabled');
  return value === 'true' || value === true;
}

/**
 * Insert a row in email_test_mode_log to record a blocked send.
 * Failures are swallowed (we never want logging to crash a route handler).
 *
 * @param {object} params
 * @param {number|null} params.orgId
 * @param {'email'|'push'} params.channel
 * @param {string} params.recipient            Email address or licence number.
 * @param {string} [params.recipientKind='player']
 * @param {string} [params.recipientName]
 * @param {string} [params.subject]
 * @param {string} [params.emailType]          e.g. 'convocation', 'results', ...
 * @param {number} [params.triggeredByUserId]
 * @param {object} [params.context]            JSON payload (tournoi_id, etc.)
 */
async function logSkippedSend({
  orgId,
  channel,
  recipient,
  recipientKind = 'player',
  recipientName = null,
  subject = null,
  emailType = null,
  triggeredByUserId = null,
  context = null
}) {
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO email_test_mode_log
         (organization_id, channel, recipient, recipient_kind, recipient_name,
          subject, email_type, triggered_by_user_id, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orgId,
        channel,
        recipient,
        recipientKind,
        recipientName,
        subject,
        emailType,
        triggeredByUserId,
        context ? JSON.stringify(context) : null
      ],
      (err) => {
        if (err) {
          console.error('[TestMode] Failed to log skipped send:', err.message);
        }
        resolve();
      }
    );
  });
}

/**
 * Send an email via Resend, gated by the per-org test mode toggle for player
 * recipients. This is the ONLY place in the codebase that should invoke
 * `resend.emails.send()` directly.
 *
 * @param {object} payload - Resend SDK payload: { from, to, subject, html, ... }.
 * @param {object} meta - Classification metadata.
 * @param {'player'|'admin'} meta.recipientKind    REQUIRED.
 * @param {number|null} meta.orgId                 Required when recipientKind='player'.
 * @param {string} [meta.recipientName]            For audit log display.
 * @param {string} [meta.emailType]                'convocation' | 'results' | 'relance' | 'invitation' | 'announcement' | 'confirmation' | 'reset_password' | 'welcome' | 'enrollment' | 'other'
 * @param {number} [meta.triggeredByUserId]        Admin user who initiated the action.
 * @param {object} [meta.context]                  JSON to store in audit log.
 * @returns {Promise<object>} Either the Resend response, or { skipped: true, reason }.
 */
async function sendEmail(payload, meta = {}) {
  const {
    recipientKind,
    orgId = null,
    recipientName = null,
    emailType = 'other',
    triggeredByUserId = null,
    context = null
  } = meta;

  if (!recipientKind) {
    throw new Error('sendEmail: recipientKind is required (\'player\' or \'admin\')');
  }
  if (recipientKind !== 'player' && recipientKind !== 'admin') {
    throw new Error(`sendEmail: invalid recipientKind '${recipientKind}' (must be 'player' or 'admin')`);
  }

  // Test mode gate — only applies to player-bound traffic.
  if (recipientKind === 'player' && await isTestModeEnabled(orgId)) {
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    for (const addr of recipients) {
      await logSkippedSend({
        orgId,
        channel: 'email',
        recipient: addr,
        recipientKind: 'player',
        recipientName,
        subject: payload.subject,
        emailType,
        triggeredByUserId,
        context
      });
    }
    console.log(`[TestMode] Blocked email (org=${orgId}, type=${emailType}, to=${recipients.join(',')}, subj="${payload.subject}")`);
    return { skipped: true, reason: 'test_mode_players_blocked', recipients };
  }

  // Normal send.
  return getResend().emails.send(payload);
}

module.exports = {
  getSummaryEmail,
  getContactEmail,
  getEmailTemplateSettings,
  buildFromAddress,
  buildContactPhraseHtml,
  // Test mode chokepoint — see header comment above.
  sendEmail,
  logSkippedSend,
  isTestModeEnabled,
  getResend
};
