/**
 * Push Notification Messages - Hardcoded Templates
 *
 * Version: 1.0 (Mars 2026)
 * Status: Hardcoded - To be migrated to database settings in future
 *
 * IMPORTANT: These messages will eventually be moved to the database
 * to allow admin editing via the Tournament Management App.
 */

const NOTIFICATION_MESSAGES = {

  // ==================== 1. CONVOCATIONS ====================
  CONVOCATION: {
    titre: (variables) => `📢 Convocation — ${variables.tournoiName}`,
    corps: (variables) =>
      `Vous êtes convoqué(e) le ${variables.date} à ${variables.heure} à ${variables.lieu}. ` +
      `Poule ${variables.pouleNumber}. Bonne compétition !`,
    url: '/inscriptions'
  },

  // ==================== 2. REGISTRATION REMINDERS ====================
  REMINDER_LAST_DAY: {
    titre: (variables) => `🚨 Dernière chance !`,
    corps: (variables) =>
      `Les inscriptions pour le ${variables.tournoiName} ferment demain. Inscrivez-vous vite !`,
    url: '/tournaments'
  },

  NEW_TOURNAMENT: {
    titre: (variables) => `🎯 Nouveau tournoi disponible`,
    corps: (variables) =>
      `Les inscriptions pour le ${variables.tournoiName} sont ouvertes jusqu'au ${variables.closingDate}.`,
    url: '/tournaments'
  },

  // ==================== 3. RESULTS PUBLISHED ====================
  RESULTS_NORMAL: {
    titre: (variables) => `📊 Résultats — ${variables.tournoiName}`,
    corps: (variables) =>
      `Les résultats sont publiés ! Vous êtes classé(e) ${variables.position}e. Bravo !`,
    url: '/stats'
  },

  RESULTS_FINALE: {
    titre: (variables) => `🏆 Résultats Finale — ${variables.tournoiName}`,
    corps: (variables) =>
      `Les résultats sont publiés ! Vous êtes classé(e) ${variables.position}e. Bravo !`,
    url: '/stats'
  },

  // ==================== 4. URGENT ANNOUNCEMENTS ====================
  URGENT_ANNOUNCEMENT: {
    titre: (variables) => `⚠️ ${variables.announcementTitle}`,
    corps: (variables) => variables.announcementBody.substring(0, 150), // Truncate to 150 chars
    url: '/'
  },

  // ==================== 5. TOURNAMENT MODIFICATIONS ====================
  TOURNAMENT_DATE_CHANGED: {
    titre: (variables) => `📝 Modification — ${variables.tournoiName}`,
    corps: (variables) =>
      `Le tournoi du ${variables.oldDate} a été modifié. Nouvelle date : ${variables.newDate}.`,
    url: '/inscriptions'
  },

  TOURNAMENT_CANCELLED: {
    titre: (variables) => `❌ Tournoi annulé`,
    corps: (variables) =>
      `Le ${variables.tournoiName} prévu le ${variables.date} est annulé. Consultez vos inscriptions.`,
    url: '/inscriptions'
  },

  TOURNAMENT_LOCATION_CHANGED: {
    titre: (variables) => `📍 Changement de lieu — ${variables.tournoiName}`,
    corps: (variables) =>
      `Le tournoi du ${variables.date} aura lieu à ${variables.newLocation} au lieu de ${variables.oldLocation}.`,
    url: '/inscriptions'
  },

  // ==================== 6. REGISTRATION CONFIRMED ====================
  INSCRIPTION_CONFIRMED: {
    titre: (variables) => `✅ Inscription enregistrée`,
    corps: (variables) =>
      `Vous êtes inscrit(e) au ${variables.tournoiName} le ${variables.date}.`,
    url: '/inscriptions'
  },

  // ==================== 7. FORFEIT CONFIRMED ====================
  FORFEIT_CONFIRMED: {
    titre: (variables) => `⚠️ Forfait enregistré`,
    corps: (variables) =>
      `Votre forfait pour le ${variables.tournoiName} a été pris en compte. Le comité a été informé. ` +
      `Il vous est impossible de repostuler à cette compétition`,
    url: '/inscriptions'
  },

  // ==================== 8. WELCOME / ACCOUNT CREATED ====================
  WELCOME: {
    titre: () => `🎉 Bienvenue sur l'Espace Joueur`,
    corps: () =>
      `Votre compte a été créé avec succès. Découvrez les compétitions disponibles et vos statistiques !`,
    url: '/tournaments'
  }
};

/**
 * Helper function to build a notification object
 * @param {string} type - Notification type (e.g., 'CONVOCATION', 'RESULTS_NORMAL')
 * @param {Object} variables - Variables to inject into the template
 * @returns {Object} - { title, body, url }
 */
function buildNotification(type, variables = {}) {
  const template = NOTIFICATION_MESSAGES[type];

  if (!template) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  return {
    title: typeof template.titre === 'function' ? template.titre(variables) : template.titre,
    body: typeof template.corps === 'function' ? template.corps(variables) : template.corps,
    url: template.url
  };
}

/**
 * Determine if a tournament is a Finale (for choosing the right emoji)
 * @param {string} tournoiName - Tournament name
 * @returns {boolean} - true if finale, false otherwise
 */
function isFinale(tournoiName) {
  return tournoiName && tournoiName.toUpperCase().includes('FINALE');
}

/**
 * Get the appropriate results notification type based on tournament
 * @param {string} tournoiName - Tournament name
 * @returns {string} - 'RESULTS_FINALE' or 'RESULTS_NORMAL'
 */
function getResultsNotificationType(tournoiName) {
  return isFinale(tournoiName) ? 'RESULTS_FINALE' : 'RESULTS_NORMAL';
}

module.exports = {
  NOTIFICATION_MESSAGES,
  buildNotification,
  isFinale,
  getResultsNotificationType
};
