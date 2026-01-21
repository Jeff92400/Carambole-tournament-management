// Branding - Dynamic color loading for Tournament Management App
// Fetches colors from API and updates CSS variables

(function() {
  'use strict';

  const API_URL = '/api/settings/branding/colors';
  const CACHE_KEY = 'branding_colors';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Map API keys to CSS variable names
  const colorMapping = {
    primary_color: '--color-primary',
    secondary_color: '--color-secondary',
    accent_color: '--color-accent',
    background_color: '--color-bg-primary',
    background_secondary_color: '--color-bg-secondary'
  };

  // Check cache first
  function getCachedColors() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { colors, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          return colors;
        }
      }
    } catch (e) {
      // Ignore cache errors
    }
    return null;
  }

  // Save to cache
  function setCachedColors(colors) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        colors,
        timestamp: Date.now()
      }));
    } catch (e) {
      // Ignore cache errors
    }
  }

  // Apply colors to CSS variables
  function applyColors(colors) {
    const root = document.documentElement;
    for (const [apiKey, cssVar] of Object.entries(colorMapping)) {
      if (colors[apiKey]) {
        root.style.setProperty(cssVar, colors[apiKey]);
      }
    }

    // Also set secondary-dark as a darker shade of secondary
    if (colors.secondary_color) {
      // Use the secondary color directly for secondary-dark gradient
      // In most cases, the gradient uses two different colors
      root.style.setProperty('--color-secondary-dark', colors.secondary_color);
    }
  }

  // Load colors from API
  async function loadColors() {
    // Try cache first for instant display
    const cached = getCachedColors();
    if (cached) {
      applyColors(cached);
    }

    // Fetch fresh colors (will update if different)
    try {
      const response = await fetch(API_URL);
      if (response.ok) {
        const colors = await response.json();
        applyColors(colors);
        setCachedColors(colors);
      }
    } catch (error) {
      console.log('[Branding] Could not fetch colors:', error.message);
      // CSS defaults will be used
    }
  }

  // Initialize immediately
  loadColors();

  // Also run on DOMContentLoaded in case script is in head
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadColors);
  }
})();
