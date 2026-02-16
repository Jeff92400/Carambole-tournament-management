/**
 * App Settings Helper
 *
 * Provides a cached interface to app_settings table for dynamic configuration.
 * Settings are cached with TTL to balance performance and freshness.
 */

// Cache for settings
let settingsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

// Default values (fallbacks if database is unavailable)
const defaults = {
  // Legacy settings
  summary_email: 'cdbhs92@gmail.com',
  email_scheduler_hour: '6',

  // Organization settings
  organization_name: 'Comité Départemental de Billard des Hauts-de-Seine',
  organization_short_name: 'CDBHS',

  // Branding settings
  primary_color: '#1F4788',
  secondary_color: '#667EEA',
  accent_color: '#FFC107',
  background_color: '#FFFFFF',
  background_secondary_color: '#F5F5F5',

  // Email settings
  email_communication: 'communication@cdbhs.net',
  email_convocations: 'convocations@cdbhs.net',
  email_noreply: 'noreply@cdbhs.net',
  email_sender_name: 'CDBHS',

  // Season settings
  season_start_month: '9', // September (1-12 format)

  // Ranking settings
  qualification_threshold: '9',
  qualification_small: '4',
  qualification_large: '6',

  // Player App
  player_app_url: 'https://cdbhs-player-app-production.up.railway.app',

  // Privacy policy
  privacy_policy: ''
};

/**
 * Load all settings from database into cache
 */
async function loadSettings() {
  const db = require('../db-loader');

  return new Promise((resolve) => {
    db.all('SELECT key, value FROM app_settings', [], (err, rows) => {
      if (err) {
        console.error('Error loading app settings:', err);
        // Return defaults on error
        resolve({ ...defaults });
        return;
      }

      // Convert rows to object and merge with defaults
      const settings = { ...defaults };
      (rows || []).forEach(row => {
        settings[row.key] = row.value;
      });

      // Update cache
      settingsCache = settings;
      cacheTimestamp = Date.now();

      resolve(settings);
    });
  });
}

/**
 * Get all settings (from cache if valid, otherwise reload)
 */
async function getSettings() {
  const now = Date.now();

  // Return cached settings if still valid
  if (settingsCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
    return settingsCache;
  }

  // Reload from database
  return loadSettings();
}

/**
 * Get a single setting by key
 * @param {string} key - Setting key
 * @returns {Promise<string>} Setting value
 */
async function getSetting(key) {
  const settings = await getSettings();
  return settings[key] || defaults[key] || '';
}

/**
 * Get multiple settings at once
 * @param {string[]} keys - Array of setting keys
 * @returns {Promise<Object>} Object with requested settings
 */
async function getSettingsBatch(keys) {
  const settings = await getSettings();
  const result = {};
  keys.forEach(key => {
    result[key] = settings[key] || defaults[key] || '';
  });
  return result;
}

/**
 * Clear the cache (call after updating settings)
 */
function clearCache() {
  settingsCache = null;
  cacheTimestamp = null;
}

/**
 * Get email settings bundle (commonly used together)
 */
async function getEmailSettings() {
  return getSettingsBatch([
    'email_communication',
    'email_convocations',
    'email_noreply',
    'email_sender_name',
    'summary_email',
    'organization_name',
    'organization_short_name'
  ]);
}

/**
 * Get branding settings bundle
 */
async function getBrandingSettings() {
  return getSettingsBatch([
    'primary_color',
    'secondary_color',
    'accent_color',
    'background_color',
    'background_secondary_color',
    'organization_name',
    'organization_short_name'
  ]);
}

/**
 * Get qualification settings bundle
 */
async function getQualificationSettings() {
  const settings = await getSettingsBatch([
    'qualification_threshold',
    'qualification_small',
    'qualification_large'
  ]);

  // Convert to numbers for easier use
  return {
    threshold: parseInt(settings.qualification_threshold, 10) || 9,
    small: parseInt(settings.qualification_small, 10) || 4,
    large: parseInt(settings.qualification_large, 10) || 6
  };
}

// ==================== SEASON HELPERS ====================

/**
 * Get the season start month (1-12, where 9 = September)
 * @returns {Promise<number>} Month number (1-12)
 */
async function getSeasonStartMonth() {
  const setting = await getSetting('season_start_month');
  const month = parseInt(setting, 10) || 9; // Default to September
  // Ensure valid range 1-12
  return Math.max(1, Math.min(12, month));
}

/**
 * Calculate season string for a given date
 * @param {Date} date - Date to calculate season for (defaults to now)
 * @returns {Promise<string>} Season string in format "YYYY-YYYY" (e.g., "2025-2026")
 */
async function getCurrentSeason(date = new Date()) {
  const startMonth = await getSeasonStartMonth();
  const month = date.getMonth() + 1; // Convert to 1-indexed
  const year = date.getFullYear();

  if (month >= startMonth) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

/**
 * Get season date range
 * @param {string} season - Season string (e.g., "2025-2026")
 * @returns {Promise<{start: string, end: string}>} Date range in YYYY-MM-DD format
 */
async function getSeasonDateRange(season) {
  const startMonth = await getSeasonStartMonth();
  const [startYear] = season.split('-').map(Number);
  const endYear = startYear + 1;

  // Season starts on 1st of start month
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;

  // Season ends on last day of month before start month
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endMonthYear = startMonth === 1 ? endYear : endYear;
  const lastDay = new Date(endMonthYear, endMonth, 0).getDate(); // Last day of previous month
  const endDate = `${endMonthYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return { start: startDate, end: endDate };
}

/**
 * Check if a date falls within a given season
 * @param {Date|string} date - Date to check
 * @param {string} season - Season string (e.g., "2025-2026")
 * @returns {Promise<boolean>}
 */
async function isDateInSeason(date, season) {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const { start, end } = await getSeasonDateRange(season);
  const dateStr = dateObj.toISOString().split('T')[0];
  return dateStr >= start && dateStr <= end;
}

/**
 * Synchronous version of getCurrentSeason (uses cached startMonth)
 * Call getSeasonStartMonth() first to warm the cache, then use this for sync contexts
 * @param {number} startMonth - The season start month (1-12)
 * @param {Date} date - Date to calculate season for (defaults to now)
 * @returns {string} Season string
 */
function getCurrentSeasonSync(startMonth, date = new Date()) {
  const month = date.getMonth() + 1; // Convert to 1-indexed
  const year = date.getFullYear();

  if (month >= startMonth) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

// ==================== ORG-AWARE SETTINGS ====================

// Per-org cache: Map<orgId, { settings, timestamp }>
const orgSettingsCache = new Map();

/**
 * Load organization-specific settings, merged with global app_settings and defaults
 * Fallback chain: organization_settings → app_settings → hardcoded defaults
 */
async function loadOrgSettings(orgId) {
  const db = require('../db-loader');

  // First ensure global settings are loaded
  const globalSettings = await getSettings();

  return new Promise((resolve) => {
    db.all(
      'SELECT key, value FROM organization_settings WHERE organization_id = $1',
      [orgId],
      (err, orgRows) => {
        if (err) {
          console.error('Error loading org settings for org', orgId, ':', err);
          resolve({ ...globalSettings });
          return;
        }

        // Start with defaults → global app_settings → org overrides
        const settings = { ...globalSettings };
        (orgRows || []).forEach(row => {
          if (row.value !== null && row.value !== undefined) {
            settings[row.key] = row.value;
          }
        });

        orgSettingsCache.set(orgId, { settings, timestamp: Date.now() });
        resolve(settings);
      }
    );
  });
}

/**
 * Get all settings for an organization (cached)
 */
async function getOrgSettings(orgId) {
  if (!orgId) return getSettings();

  const cached = orgSettingsCache.get(orgId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.settings;
  }
  return loadOrgSettings(orgId);
}

/**
 * Get a single setting for an organization
 * @param {number} orgId - Organization ID (null = global)
 * @param {string} key - Setting key
 */
async function getOrgSetting(orgId, key) {
  if (!orgId) return getSetting(key);
  const settings = await getOrgSettings(orgId);
  return settings[key] || defaults[key] || '';
}

/**
 * Get multiple settings for an organization
 * @param {number} orgId - Organization ID (null = global)
 * @param {string[]} keys - Array of setting keys
 */
async function getOrgSettingsBatch(orgId, keys) {
  if (!orgId) return getSettingsBatch(keys);
  const settings = await getOrgSettings(orgId);
  const result = {};
  keys.forEach(key => {
    result[key] = settings[key] || defaults[key] || '';
  });
  return result;
}

/**
 * Set a setting for an organization (upsert)
 * @param {number} orgId - Organization ID
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 */
async function setOrgSetting(orgId, key, value) {
  const db = require('../db-loader');
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO organization_settings (organization_id, key, value, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [orgId, key, value],
      function(err) {
        if (err) return reject(err);
        // Invalidate org cache
        orgSettingsCache.delete(orgId);
        resolve(this);
      }
    );
  });
}

/**
 * Clear all caches (global + org)
 */
const _originalClearCache = clearCache;
function clearAllCaches() {
  settingsCache = null;
  cacheTimestamp = null;
  orgSettingsCache.clear();
}

module.exports = {
  getSettings,
  getSetting,
  getSettingsBatch,
  clearCache: clearAllCaches,
  getEmailSettings,
  getBrandingSettings,
  getQualificationSettings,
  // Org-aware settings
  getOrgSettings,
  getOrgSetting,
  getOrgSettingsBatch,
  setOrgSetting,
  // Season helpers
  getSeasonStartMonth,
  getCurrentSeason,
  getSeasonDateRange,
  isDateInSeason,
  getCurrentSeasonSync,
  defaults
};
