/**
 * Reference Data Loader
 * Loads dynamic reference data from the API and populates select elements.
 * All dropdowns should use this instead of hardcoded options.
 */

const ReferenceData = {
  cache: {},
  cacheExpiry: 5 * 60 * 1000, // 5 minutes
  cacheTimestamps: {},

  /**
   * Fetch reference data from API with caching
   * @param {string} type - Reference data type (e.g., 'game-modes', 'ffb-rankings')
   * @returns {Promise<Array>} Array of reference data items
   */
  async fetch(type) {
    const now = Date.now();
    if (this.cache[type] && this.cacheTimestamps[type] && (now - this.cacheTimestamps[type]) < this.cacheExpiry) {
      return this.cache[type];
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/reference-data/${type}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        console.error(`Failed to fetch reference data: ${type}`);
        return [];
      }

      const data = await response.json();
      this.cache[type] = data;
      this.cacheTimestamps[type] = now;
      return data;
    } catch (error) {
      console.error(`Error fetching reference data ${type}:`, error);
      return [];
    }
  },

  /**
   * Populate a select element with reference data
   * @param {string} selectId - ID of the select element
   * @param {string} type - Reference data type
   * @param {Object} options - Configuration options
   */
  async populateSelect(selectId, type, options = {}) {
    const {
      placeholder = '-- Sélectionner --',
      showPlaceholder = true,
      valueField = 'code',
      labelField = 'display_name',
      iconField = null,
      selectedValue = null,
      filter = null,
      activeOnly = false
    } = options;

    const select = document.getElementById(selectId);
    if (!select) {
      console.warn(`Select element not found: ${selectId}`);
      return;
    }

    // Show loading state
    select.innerHTML = '<option value="">Chargement...</option>';
    select.disabled = true;

    try {
      let url = type;
      if (activeOnly) url += '?active_only=true';

      let data = await this.fetch(url);

      // Apply filter if provided
      if (filter && typeof filter === 'function') {
        data = data.filter(filter);
      }

      // Build options HTML
      let html = '';
      if (showPlaceholder) {
        html += `<option value="">${placeholder}</option>`;
      }

      data.forEach(item => {
        const value = item[valueField];
        const label = iconField && item[iconField]
          ? `${item[iconField]} ${item[labelField]}`
          : item[labelField];
        const selected = selectedValue && value === selectedValue ? ' selected' : '';
        html += `<option value="${value}"${selected}>${label}</option>`;
      });

      select.innerHTML = html;
      select.disabled = false;

      // Trigger change event if value was pre-selected
      if (selectedValue) {
        select.dispatchEvent(new Event('change'));
      }

      return data;
    } catch (error) {
      console.error(`Error populating select ${selectId}:`, error);
      select.innerHTML = `<option value="">Erreur de chargement</option>`;
      select.disabled = false;
      return [];
    }
  },

  /**
   * Get game modes
   */
  async getGameModes(activeOnly = true) {
    const url = activeOnly ? 'game-modes?active_only=true' : 'game-modes';
    return this.fetch(url);
  },

  /**
   * Get FFB rankings
   */
  async getFfbRankings(activeOnly = true) {
    const url = activeOnly ? 'ffb-rankings?active_only=true' : 'ffb-rankings';
    return this.fetch(url);
  },

  /**
   * Get categories
   */
  async getCategories() {
    return this.fetch('categories');
  },

  /**
   * Get tournament rounds
   */
  async getTournamentRounds() {
    return this.fetch('tournament-rounds');
  },

  /**
   * Get announcement types
   */
  async getAnnouncementTypes() {
    return this.fetch('announcement-types');
  },

  /**
   * Get relance types
   */
  async getRelanceTypes() {
    return this.fetch('relance-types');
  },

  /**
   * Get inscription sources
   */
  async getInscriptionSources() {
    return this.fetch('inscription-sources');
  },

  /**
   * Get inscription statuses
   */
  async getInscriptionStatuses() {
    return this.fetch('inscription-statuses');
  },

  /**
   * Get contact statuses
   */
  async getContactStatuses() {
    return this.fetch('contact-statuses');
  },

  /**
   * Get user roles
   */
  async getUserRoles() {
    return this.fetch('user-roles');
  },

  /**
   * Get tournament statuses
   */
  async getTournamentStatuses() {
    return this.fetch('tournament-statuses');
  },

  /**
   * Get activity log types
   */
  async getActivityLogTypes() {
    return this.fetch('activity-log-types');
  },

  /**
   * Get time slots
   */
  async getTimeSlots() {
    return this.fetch('time-slots');
  },

  /**
   * Get purge criteria
   */
  async getPurgeCriteria() {
    return this.fetch('purge-criteria');
  },

  /**
   * Build a mapping from code to display_name
   * @param {string} type - Reference data type
   * @returns {Promise<Object>} Mapping object
   */
  async getMapping(type) {
    const data = await this.fetch(type);
    const mapping = {};
    data.forEach(item => {
      mapping[item.code] = item.display_name;
    });
    return mapping;
  },

  /**
   * Build a mapping from game mode to rank column
   * @returns {Promise<Object>} Mapping object
   */
  async getGameModeRankMapping() {
    const modes = await this.fetch('game-modes');
    const mapping = {};
    modes.forEach(mode => {
      if (mode.rank_column) {
        mapping[mode.code] = mode.rank_column;
        mapping[mode.display_name] = mode.rank_column;
        // Also add normalized versions
        mapping[mode.code.replace(/ /g, '')] = mode.rank_column;
        mapping[mode.display_name.toUpperCase()] = mode.rank_column;
      }
    });
    return mapping;
  },

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache = {};
    this.cacheTimestamps = {};
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReferenceData;
}
