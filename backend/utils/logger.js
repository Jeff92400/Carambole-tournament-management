/**
 * Runtime logger — silences low-severity logs in production.
 *
 * Audit Phase 5 W9: hundreds of `console.log` calls across route files
 * create very noisy Railway logs in production, which makes it hard to
 * spot real incidents. Having a tiny wrapper lets us gate verbose
 * tracing behind NODE_ENV without having to delete helpful
 * development logs.
 *
 * Usage:
 *   const logger = require('../utils/logger');
 *   logger.log(`[Inscriptions] Processing CSV row ${i}`);   // dev only
 *   logger.info('[Startup] Scheduler started');              // dev only
 *   logger.debug('[Payload]', req.body);                     // dev only
 *   logger.warn('[Email] Resend rate-limited, retrying');    // always
 *   logger.error('[DB] Query failed', err);                  // always
 *
 * Rule of thumb:
 *   - `log` / `info` / `debug` → verbose tracing, silenced in prod
 *   - `warn` → unusual but recoverable (retry, fallback, deprecation)
 *   - `error` → failure worth investigating
 *
 * Set DEBUG_LOGS=1 in Railway to re-enable verbose logs temporarily
 * (e.g. diagnosing a production incident). This is the escape hatch
 * when `warn`/`error` alone don't give enough context.
 */

const isProduction = process.env.NODE_ENV === 'production';
const forceVerbose = process.env.DEBUG_LOGS === '1';
const silent = isProduction && !forceVerbose;

function log(...args) {
  if (!silent) console.log(...args);
}

function info(...args) {
  if (!silent) console.info(...args);
}

function debug(...args) {
  if (!silent) console.debug(...args);
}

function warn(...args) {
  console.warn(...args);
}

function error(...args) {
  console.error(...args);
}

module.exports = { log, info, debug, warn, error };
