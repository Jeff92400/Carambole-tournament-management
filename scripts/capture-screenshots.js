#!/usr/bin/env node

/**
 * Automated Screenshot Capture for the User Guide
 *
 * Captures 23 screenshots from the CDB9394 production org using Playwright
 * and optionally uncomments <img> tags in the guide HTML.
 *
 * Usage:
 *   npm run screenshots                  # capture only
 *   npm run screenshots:update-guide     # capture + uncomment <img> tags
 *
 * Environment variables:
 *   SCREENSHOT_USERNAME  (required) — CDB admin username
 *   SCREENSHOT_PASSWORD  (required) — CDB admin password
 *   SCREENSHOT_BASE_URL  (optional) — defaults to production
 *   SCREENSHOT_ORG_SLUG  (optional) — defaults to cdb9394
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  BASE_URL: process.env.SCREENSHOT_BASE_URL || 'https://cdbhs-tournament-management-production.up.railway.app',
  ORG_SLUG: process.env.SCREENSHOT_ORG_SLUG || 'cdb9394',
  VIEWPORT: { width: 1280, height: 800 },
  OUTPUT_DIR: path.join(__dirname, '..', 'frontend', 'screenshots'),
  USERNAME: process.env.SCREENSHOT_USERNAME,
  PASSWORD: process.env.SCREENSHOT_PASSWORD,
  SETTLE_MS: 600,
  NAV_DELAY_MS: 500,
  TIMEOUT_MS: 30000,
};

const UPDATE_GUIDE = process.argv.includes('--update-guide');

// ---------------------------------------------------------------------------
// Screenshot definitions (all 23)
// ---------------------------------------------------------------------------

// IMG-01 is handled separately (captured before login to avoid session destruction)
const LOGIN_SCREENSHOT = {
  id: 'IMG-01',
  filename: '01-login.png',
  description: 'Page de connexion',
};

const SCREENSHOTS = [
  {
    id: 'IMG-02',
    filename: '02-dashboard.png',
    url: () => 'dashboard.html',
    waitFor: '#activePlayerCount',
    requiresAuth: true,
    description: 'Dashboard',
  },
  {
    id: 'IMG-03',
    filename: '03-classements.png',
    url: () => 'rankings.html',
    waitFor: '#modeSelect',
    requiresAuth: true,
    description: 'Classements (mode standard)',
    setup: async (page) => {
      await selectRankingsFilters(page);
    },
  },
  {
    id: 'IMG-04',
    filename: '04-classements-journees.png',
    url: () => 'rankings.html',
    waitFor: '#modeSelect',
    requiresAuth: true,
    description: 'Classements (mode journées)',
    setup: async (page) => {
      // Same filters — the org uses journées mode so TQ columns should appear
      await selectRankingsFilters(page);
      // Scroll to table area
      await page.evaluate(() => {
        const card = document.getElementById('rankingsCard');
        if (card) card.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await settle(300);
    },
  },
  {
    id: 'IMG-05',
    filename: '05-historique-joueur.png',
    url: () => null, // Dynamic — we navigate from rankings
    waitFor: null,
    requiresAuth: true,
    description: 'Historique joueur',
    setup: async (page) => {
      // Try to find a player link from current rankings state
      let link = await page.$('#rankingsBody a[href*="player-history"]');
      if (!link) {
        // Navigate fresh, try all mode+level combos to find one with data
        await navigateAndWait(page, 'rankings.html', '#modeSelect');
        await waitAndSelectFirst(page, 'modeSelect', 15000);
        await settle(800);
        // Try all modes and levels
        const modes = await page.$$eval('#modeSelect option', opts =>
          opts.filter(o => o.value && o.value !== '').map(o => o.value)
        );
        for (const mode of modes) {
          await page.selectOption('#modeSelect', mode);
          await page.evaluate(() => {
            document.getElementById('modeSelect').dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settle(1000);
          const levels = await page.$$eval('#levelSelect option', opts =>
            opts.filter(o => o.value && o.value !== '').map(o => o.value)
          );
          for (const level of levels) {
            await page.selectOption('#levelSelect', level);
            await page.evaluate(() => {
              document.getElementById('levelSelect').dispatchEvent(new Event('change', { bubbles: true }));
            });
            await settle(2000);
            link = await page.$('#rankingsBody a[href*="player-history"]');
            if (link) break;
          }
          if (link) break;
        }
      }
      if (link) {
        // Scroll link into view first (it may be off-screen in the table)
        await link.scrollIntoViewIfNeeded().catch(() => {});
        await settle(300);
        // Use evaluate to navigate directly (avoids visibility issues)
        const href = await link.getAttribute('href');
        if (href) {
          await page.goto(buildUrl(href), { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_MS });
          await page.waitForLoadState('networkidle').catch(() => {});
          await settle(1500);
        }
      } else {
        throw new Error('No player link found in rankings — no ranking data available');
      }
    },
  },
  {
    id: 'IMG-06',
    filename: '06-poules-selection.png',
    url: () => 'generate-poules.html',
    waitFor: '#modeSelect',
    requiresAuth: true,
    description: 'Générer poules — Étape 1 (sélection)',
    setup: async (page) => {
      await initializeGeneratePoules(page);
      // Scroll to show the tournament cards
      await page.evaluate(() => {
        const card = document.getElementById('upcomingTournamentsCard');
        if (card) card.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await settle(300);
    },
  },
  {
    id: 'IMG-07',
    filename: '07-poules-joueurs.png',
    url: () => null, // Continue from generate-poules state
    waitFor: null,
    requiresAuth: true,
    description: 'Générer poules — Étape 2 (joueurs)',
    setup: async (page) => {
      // Click the first tournament card to enter the wizard
      const tournCard = await page.$('.upcoming-tournament-card');
      if (!tournCard) throw new Error('No tournament cards found');
      await tournCard.click();
      await settle(2000);
      // Wait for step 2 (player selection) to become visible
      await page.waitForSelector('#step2', { state: 'visible', timeout: 15000 }).catch(() => {});
      await settle(1000);
      // Scroll to step 2
      await page.evaluate(() => {
        const el = document.getElementById('step2');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await settle(300);
    },
  },
  {
    id: 'IMG-08',
    filename: '08-poules-preview.png',
    url: () => null, // Continue from previous state
    waitFor: null,
    requiresAuth: true,
    description: 'Générer poules — Étape 3 (prévisualisation)',
    setup: async (page) => {
      // Select all players, then validate
      const selectAllBtn = await page.$('#selectAllBtn');
      if (selectAllBtn) {
        const isVisible = await selectAllBtn.isVisible().catch(() => false);
        if (isVisible) await selectAllBtn.click();
        await settle(300);
      } else {
        const selectInscritsBtn = await page.$('#selectRegisteredBtn');
        if (selectInscritsBtn) {
          const isVisible = await selectInscritsBtn.isVisible().catch(() => false);
          if (isVisible) await selectInscritsBtn.click();
          await settle(300);
        }
      }
      // Click validate players to proceed to step 3
      const validateBtn = await page.$('#validatePlayersBtn');
      if (validateBtn) {
        const isVisible = await validateBtn.isVisible().catch(() => false);
        if (isVisible) {
          await validateBtn.click();
          await settle(2000);
          await page.waitForSelector('#step3', { state: 'visible', timeout: 15000 }).catch(() => {});
          await settle(1000);
        }
      }
      // Scroll to step 3 area
      await page.evaluate(() => {
        const el = document.getElementById('step3');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await settle(300);
    },
  },
  {
    id: 'IMG-09',
    filename: '09-convocation-email.png',
    url: () => null, // Continue from previous state
    waitFor: null,
    requiresAuth: true,
    description: 'Convocation — Aperçu email',
    setup: async (page) => {
      // Scroll down to the email/convocation section (step 4)
      await page.evaluate(() => {
        const el = document.getElementById('step4') ||
                   document.getElementById('goToEmailBtn') ||
                   document.querySelector('[id*="convocation"], [id*="email"]');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await settle(500);
    },
  },
  {
    id: 'IMG-10',
    filename: '10-forfaits.png',
    url: () => 'generate-poules.html', // Navigate fresh for forfait
    waitFor: '.container',
    requiresAuth: true,
    description: 'Gestion des forfaits',
    setup: async (page) => {
      // Directly invoke the openForfaitModal function via JS
      // This avoids visibility issues with the button (branding.js timing)
      await page.waitForFunction(
        () => typeof openForfaitModal === 'function',
        { timeout: 10000 }
      ).catch(() => {});
      await settle(500);

      await page.evaluate(() => {
        if (typeof openForfaitModal === 'function') openForfaitModal();
      });

      await settle(1500);
      await page.waitForSelector('#forfaitModal', { state: 'visible', timeout: 10000 }).catch(() => {});
      await settle(500);
    },
  },
  {
    id: 'IMG-11',
    filename: '11-resultats-import.png',
    url: () => 'import-tournament.html',
    waitFor: '.container',
    requiresAuth: true,
    description: 'Import des résultats',
  },
  {
    id: 'IMG-12',
    filename: '12-calendrier.png',
    url: () => 'calendar.html',
    waitFor: '.container',
    requiresAuth: true,
    description: 'Calendrier',
    setup: async (page) => {
      // Wait for calendar to load events
      await settle(2000);
    },
  },
  {
    id: 'IMG-13',
    filename: '13-annonces.png',
    url: () => 'emailing.html',
    waitFor: '.tabs',
    requiresAuth: true,
    description: 'Annonces',
    setup: async (page) => {
      // Announcements tab is active by default — just wait for content
      await page.waitForSelector('div[data-tab="announcements"]', { timeout: 10000 });
      await settle(1500);
    },
  },
  {
    id: 'IMG-14',
    filename: '14-composer-email.png',
    url: () => null, // Reuse emailing.html from IMG-13
    waitFor: null,
    requiresAuth: true,
    description: 'Composer un email',
    setup: async (page) => {
      await page.click('div[data-tab="compose"]');
      await settle(2000);
    },
  },
  {
    id: 'IMG-15',
    filename: '15-invitations.png',
    url: () => 'player-invitations.html',
    waitFor: '.tabs',
    requiresAuth: true,
    description: 'Invitations Espace Joueur',
    setup: async (page) => {
      await page.waitForSelector('button[data-tab="tracking"]', { timeout: 10000 });
      await page.click('button[data-tab="tracking"]');
      await settle(1500);
    },
  },
  {
    id: 'IMG-16',
    filename: '16-param-organisation.png',
    url: () => 'settings-admin.html',
    waitFor: '#organisationSection',
    requiresAuth: true,
    description: 'Paramètres > Organisation',
    setup: async (page) => {
      await scrollToSection(page, 'organisationSection');
    },
  },
  {
    id: 'IMG-17',
    filename: '17-param-types-tournoi.png',
    url: () => 'settings-admin.html',
    waitFor: '#tournamentTypesSection',
    requiresAuth: true,
    description: 'Paramètres > Types de Tournoi',
    setup: async (page) => {
      await scrollToSection(page, 'tournamentTypesSection');
    },
  },
  {
    id: 'IMG-18',
    filename: '18-param-jeu.png',
    url: () => 'settings-admin.html',
    waitFor: '#gameParametersSection',
    requiresAuth: true,
    description: 'Paramètres > Paramètres de jeu',
    setup: async (page) => {
      await scrollToSection(page, 'gameParametersSection');
    },
  },
  {
    id: 'IMG-19',
    filename: '19-param-bareme.png',
    url: () => 'settings-admin.html',
    waitFor: '#stageScoringTable',
    requiresAuth: true,
    description: 'Paramètres > Barème de points',
    setup: async (page) => {
      // Scroll to the scoring configuration area (inside rankingsConfigSection)
      await page.evaluate(() => {
        const el = document.getElementById('stageScoringTable') || document.getElementById('scoringRuleBlocks');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await settle(500);
    },
  },
  {
    id: 'IMG-20',
    filename: '20-classifications-ffb.png',
    url: () => 'classifications-ffb.html',
    waitFor: '#licenceInput',
    requiresAuth: true,
    description: 'Classifications FFB',
    setup: async (page) => {
      // Wait for overview table to load
      await page.waitForSelector('#overviewTableBody', { timeout: 5000 }).catch(() => {});
      await settle(1000);
      // Try to click on a player row to show classification details
      const editLink = await page.$('.edit-link');
      if (editLink) {
        await editLink.click();
        await settle(1000);
      }
    },
  },
  {
    id: 'IMG-21',
    filename: '21-donnees-reference.png',
    url: () => 'settings-reference.html',
    waitFor: '.tab[data-tab="game-modes"]',
    requiresAuth: true,
    description: 'Données de référence',
    setup: async (page) => {
      // Default tab (game modes) should be visible, just wait for table
      await page.waitForSelector('#gameModesTable', { timeout: 5000 }).catch(() => {});
      await settle(500);
    },
  },
  {
    id: 'IMG-22',
    filename: '22-logs-activite.png',
    url: () => 'admin-activity-logs.html',
    waitFor: '.container',
    requiresAuth: true,
    description: 'Logs d\'activité',
    setup: async (page) => {
      // Wait for log table to load
      await settle(2000);
    },
  },
  {
    id: 'IMG-23',
    filename: '23-inscriptions-liste.png',
    url: () => 'inscriptions-list.html',
    waitFor: '#inscriptionsTable',
    requiresAuth: true,
    description: 'Liste des inscriptions',
    setup: async (page) => {
      // Wait for filters and table to load
      await page.waitForSelector('#inscriptionsBody', { timeout: 5000 }).catch(() => {});
      await settle(1500);
    },
  },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function settle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms || CONFIG.SETTLE_MS));
}

function buildUrl(relativePath) {
  return `${CONFIG.BASE_URL}/${relativePath}`;
}

async function navigateAndWait(page, relativePath, selector) {
  await page.goto(buildUrl(relativePath), { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_MS });
  // Wait for network to settle (API calls completing)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (selector) {
    await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {});
  }
  await settle(CONFIG.SETTLE_MS);
}

async function scrollToSection(page, sectionId) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, sectionId);
  await settle(500);
}

/**
 * Wait for a <select> to have real options (beyond the placeholder), then
 * select the first one. Returns the selected value or null.
 */
async function waitAndSelectFirst(page, selectId, timeoutMs) {
  const timeout = timeoutMs || 10000;
  await page.waitForFunction(
    (id) => {
      const sel = document.getElementById(id);
      return sel && [...sel.options].some(o => o.value && o.value !== '');
    },
    selectId,
    { timeout }
  );
  const opts = await page.$$eval(`#${selectId} option`, options =>
    options.filter(o => o.value && o.value !== '').map(o => o.value)
  );
  if (opts.length > 0) {
    await page.selectOption(`#${selectId}`, opts[0]);
    // Trigger change event (some pages rely on addEventListener)
    await page.evaluate((id) => {
      document.getElementById(id).dispatchEvent(new Event('change', { bubbles: true }));
    }, selectId);
    await settle(500);
    return opts[0];
  }
  return null;
}

/**
 * Shared filter selection for rankings.html.
 * Waits for categories API → selects mode → tries each level until data appears.
 */
async function selectRankingsFilters(page) {
  const mode = await waitAndSelectFirst(page, 'modeSelect', 15000);
  if (!mode) throw new Error('No modes available in #modeSelect');
  await settle(800);

  // Get all available levels
  const levels = await page.$$eval('#levelSelect option', opts =>
    opts.filter(o => o.value && o.value !== '').map(o => o.value)
  );

  // Try each level until we find one with ranking data
  let foundData = false;
  for (const level of levels) {
    await page.selectOption('#levelSelect', level);
    await page.evaluate(() => {
      document.getElementById('levelSelect').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(2000);
    const rowCount = await page.$$eval('#rankingsBody tr', rows => rows.length);
    if (rowCount > 0) {
      foundData = true;
      break;
    }
  }

  if (!foundData && levels.length > 0) {
    // Fall back to first level even without data
    await page.selectOption('#levelSelect', levels[0]);
    await page.evaluate(() => {
      document.getElementById('levelSelect').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(1000);
  }
  await settle(500);
}

/**
 * Navigate generate-poules.html through its initialization flow.
 * CDB9394 has CSV imports disabled so the flow is:
 *   quickActionsCard → "Voir les compétitions" → tournament cards → click card
 */
async function initializeGeneratePoules(page) {
  // Handle both paths: CSV enabled (inscriptionWarning) or disabled (quickActionsCard)
  const skipBtn = await page.$('#skipInscriptionUpdate');
  const goToCompBtn = await page.$('#goToCompetitions');

  if (skipBtn) {
    // CSV enabled path
    const isVisible = await skipBtn.isVisible().catch(() => false);
    if (isVisible) {
      await skipBtn.click();
      await settle(500);
    }
  }
  if (goToCompBtn) {
    // CSV disabled path
    const isVisible = await goToCompBtn.isVisible().catch(() => false);
    if (isVisible) {
      await goToCompBtn.click();
      await settle(500);
    }
  }

  // Wait for upcoming tournaments card to display
  await page.waitForSelector('#upcomingTournamentsCard', { state: 'visible', timeout: 10000 }).catch(() => {});
  await settle(1500);

  // Wait for tournament cards to render
  await page.waitForSelector('.upcoming-tournament-card', { timeout: 10000 }).catch(() => {});
  await settle(500);
}

async function login(page) {
  console.log('  Logging in...');
  await navigateAndWait(page, `login.html?org=${CONFIG.ORG_SLUG}`, '#loginForm');

  // Capture IMG-01 (login page) BEFORE submitting — login.html clears localStorage
  // so we must do this before establishing the session
  const loginScreenshotPath = path.join(CONFIG.OUTPUT_DIR, LOGIN_SCREENSHOT.filename);
  await page.screenshot({ path: loginScreenshotPath });
  const loginSize = fs.statSync(loginScreenshotPath).size;
  console.log(`  [${LOGIN_SCREENSHOT.id}] ${LOGIN_SCREENSHOT.description}... OK (${(loginSize / 1024).toFixed(0)} KB)`);

  await page.fill('#username', CONFIG.USERNAME);
  await page.fill('#password', CONFIG.PASSWORD);
  await page.click('form#loginForm button[type="submit"]');
  await page.waitForURL('**/dashboard.html**', { timeout: CONFIG.TIMEOUT_MS });
  await page.waitForSelector('#activePlayerCount', { timeout: CONFIG.TIMEOUT_MS });
  await settle(1000);
  console.log('  Login successful');
}

/**
 * Verify the page hasn't redirected to login (session lost).
 * If it has, re-login and return false so the caller can retry.
 */
async function verifyAuth(page) {
  const url = page.url();
  if (url.includes('login.html')) {
    console.log('\n    Session lost — re-logging in...');
    await page.fill('#username', CONFIG.USERNAME);
    await page.fill('#password', CONFIG.PASSWORD);
    await page.click('form#loginForm button[type="submit"]');
    await page.waitForURL('**/dashboard.html**', { timeout: CONFIG.TIMEOUT_MS });
    await settle(1000);
    console.log('    Re-login successful');
    return false; // caller should re-navigate
  }
  return true;
}

async function captureScreenshot(page, filepath, options = {}) {
  const opts = { path: filepath, fullPage: false, ...options };

  // Retry once on failure
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (options.element) {
        const el = await page.$(options.element);
        if (el) {
          await el.screenshot({ path: filepath });
          return true;
        }
        // Fall back to full page if element not found
        console.log(`    Element ${options.element} not found, capturing full page`);
      }
      await page.screenshot(opts);
      return true;
    } catch (err) {
      if (attempt === 2) throw err;
      console.log(`    Retry screenshot (attempt ${attempt} failed: ${err.message})`);
      await settle(500);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Guide update (--update-guide)
// ---------------------------------------------------------------------------

function updateGuide(capturedFiles) {
  const guidePath = path.join(__dirname, '..', 'frontend', 'guide-utilisateur.html');
  const guideCompletePath = path.join(__dirname, '..', 'GUIDE-UTILISATEUR-COMPLET.html');
  const guideMdPath = path.join(__dirname, '..', 'GUIDE-UTILISATEUR-COMPLET.md');

  if (!fs.existsSync(guidePath)) {
    console.error('Guide file not found:', guidePath);
    return;
  }

  let html = fs.readFileSync(guidePath, 'utf-8');
  let uncommented = 0;

  for (const filename of capturedFiles) {
    // Match: <!-- <img src="screenshots/{filename}" alt="..."> -->
    const pattern = new RegExp(
      `<!-- (<img src="screenshots/${escapeRegex(filename)}" alt="[^"]*">) -->`,
      'g'
    );
    const before = html;
    html = html.replace(pattern, '$1');
    if (html !== before) uncommented++;
  }

  if (uncommented > 0) {
    fs.writeFileSync(guidePath, html, 'utf-8');
    console.log(`\n  Updated guide: uncommented ${uncommented} <img> tag(s)`);

    // Sync to GUIDE-UTILISATEUR-COMPLET.html
    fs.copyFileSync(guidePath, guideCompletePath);
    console.log('  Synced to GUIDE-UTILISATEUR-COMPLET.html');

    // Regenerate GUIDE-UTILISATEUR-COMPLET.md from HTML
    const mdContent = htmlToMarkdown(html);
    fs.writeFileSync(guideMdPath, mdContent, 'utf-8');
    console.log('  Regenerated GUIDE-UTILISATEUR-COMPLET.md');
  } else {
    console.log('\n  No <img> tags to uncomment (all already active or no matching files)');
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlToMarkdown(html) {
  // Lightweight HTML-to-Markdown for the guide
  let md = html;

  // Remove everything before <body> and after </body>
  md = md.replace(/[\s\S]*<body[^>]*>/i, '');
  md = md.replace(/<\/body>[\s\S]*/i, '');

  // Remove <style> and <script> blocks
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

  // Convert bold/italic
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');

  // Convert list items
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1');

  // Convert paragraphs and line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&mdash;/g, '—');
  md = md.replace(/&ndash;/g, '–');
  md = md.replace(/&laquo;/g, '«');
  md = md.replace(/&raquo;/g, '»');
  md = md.replace(/&#\d+;/g, '');

  // Clean up excess whitespace
  md = md.replace(/\n{4,}/g, '\n\n\n');
  md = md.trim();

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Validate environment
  if (!CONFIG.USERNAME || !CONFIG.PASSWORD) {
    console.error('Error: SCREENSHOT_USERNAME and SCREENSHOT_PASSWORD environment variables are required.');
    console.error('');
    console.error('Usage:');
    console.error('  export SCREENSHOT_USERNAME="your_username"');
    console.error('  export SCREENSHOT_PASSWORD="your_password"');
    console.error('  npm run screenshots');
    process.exit(1);
  }

  console.log('=== Screenshot Capture for User Guide ===');
  console.log(`  Target: ${CONFIG.BASE_URL} (org: ${CONFIG.ORG_SLUG})`);
  console.log(`  Output: ${CONFIG.OUTPUT_DIR}`);
  console.log(`  Update guide: ${UPDATE_GUIDE ? 'yes' : 'no'}`);
  const TOTAL_SCREENSHOTS = SCREENSHOTS.length + 1; // +1 for login screenshot
  console.log(`  Screenshots to capture: ${TOTAL_SCREENSHOTS}`);
  console.log('');

  // Create output directory
  fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: CONFIG.VIEWPORT,
    locale: 'fr-FR',
    deviceScaleFactor: 2,     // Retina quality
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const results = { success: [], failed: [], skipped: [] };

  try {
    // Phase A: Login (also captures IMG-01 before submitting)
    console.log('Phase A: Login + IMG-01');
    await login(page);
    results.success.push(LOGIN_SCREENSHOT);
    console.log('');

    // Phase B: Capture loop (IMG-02 through IMG-23)
    console.log('Phase B: Capturing screenshots...');
    console.log('');

    // Track last URL to avoid unnecessary navigation for sequential flows
    let lastNavigatedUrl = null;

    for (const shot of SCREENSHOTS) {
      const filepath = path.join(CONFIG.OUTPUT_DIR, shot.filename);
      process.stdout.write(`  [${shot.id}] ${shot.description}... `);

      try {
        // Navigate if URL is specified
        const targetUrl = shot.url ? shot.url() : null;

        if (targetUrl) {
          // For same-page captures (e.g., settings-admin), skip re-navigation
          const isSamePage = targetUrl === lastNavigatedUrl;

          if (!isSamePage) {
            await navigateAndWait(page, targetUrl, shot.waitFor);
            lastNavigatedUrl = targetUrl;
          }

          // Verify we weren't redirected to login
          const authOk = await verifyAuth(page);
          if (!authOk) {
            // Re-navigate after re-login
            await navigateAndWait(page, targetUrl, shot.waitFor);
            lastNavigatedUrl = targetUrl;
          }
        } else {
          // Sequential step (no navigation) — verify auth
          await verifyAuth(page);
        }

        // Run optional setup
        if (shot.setup) {
          await shot.setup(page);
        }

        // Capture
        const captureOpts = {};
        if (shot.captureElement) {
          captureOpts.element = shot.captureElement;
        }
        await captureScreenshot(page, filepath, captureOpts);

        const size = fs.statSync(filepath).size;
        console.log(`OK (${(size / 1024).toFixed(0)} KB)`);
        results.success.push(shot);

        // Small delay between captures
        await settle(CONFIG.NAV_DELAY_MS);
      } catch (err) {
        console.log(`FAILED (${err.message})`);
        results.failed.push({ ...shot, error: err.message });
        lastNavigatedUrl = null; // Force re-navigation on next shot
      }
    }
  } finally {
    await browser.close();
  }

  // Phase D: Report
  console.log('');
  console.log('=== Summary ===');
  console.log(`  Captured: ${results.success.length}/${TOTAL_SCREENSHOTS}`);
  if (results.failed.length > 0) {
    console.log(`  Failed:   ${results.failed.length}`);
    for (const f of results.failed) {
      console.log(`    - ${f.id} (${f.filename}): ${f.error}`);
    }
  }
  if (results.skipped.length > 0) {
    console.log(`  Skipped:  ${results.skipped.length}`);
  }

  // Phase E: Update guide (if requested)
  if (UPDATE_GUIDE) {
    console.log('');
    console.log('Phase C: Updating guide HTML...');
    const capturedFiles = results.success.map(s => s.filename);
    updateGuide(capturedFiles);
  }

  // Exit code
  const exitCode = results.failed.length > 0 ? 1 : 0;
  console.log('');
  console.log(exitCode === 0 ? 'All screenshots captured successfully.' : 'Some screenshots failed — see details above.');
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
