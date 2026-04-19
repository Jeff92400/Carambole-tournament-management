const path = require('path');
const fs = require('fs');

/**
 * Load an organization's logo as a Buffer (for PDF embedding, email attachments,
 * or any server-side binary output).
 *
 * Looks up the most recently uploaded logo for the given `orgId` in the
 * `organization_logo` table. Falls back to a static bundled billiard icon
 * if no logo is found (or if orgId is null — super-admin case).
 *
 * This helper consolidates a function that was duplicated verbatim across
 * email.js, rankings.js, and tournaments.js (audit Phase 5 finding I21).
 *
 * @param {number|null} orgId - Organization ID, or null for org-agnostic lookup.
 * @returns {Promise<Buffer|null>} Logo bytes, or null if no logo and no fallback file.
 */
async function getOrganizationLogoBuffer(orgId) {
  const db = require('../db-loader');
  return new Promise((resolve) => {
    const query = orgId
      ? 'SELECT file_data, content_type FROM organization_logo WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1'
      : 'SELECT file_data, content_type FROM organization_logo ORDER BY created_at DESC LIMIT 1';
    const params = orgId ? [orgId] : [];
    db.get(query, params, (err, row) => {
      if (err || !row) {
        // Fallback to static French billiard icon bundled with the frontend
        const fallbackPath = path.join(__dirname, '../../frontend/images/FrenchBillard-Icon-small.png');
        if (fs.existsSync(fallbackPath)) {
          resolve(fs.readFileSync(fallbackPath));
        } else {
          resolve(null);
        }
        return;
      }
      const buffer = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
      resolve(buffer);
    });
  });
}

module.exports = {
  getOrganizationLogoBuffer
};
