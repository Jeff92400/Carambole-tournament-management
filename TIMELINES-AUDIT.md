# AUDIT COMPLET DES TIMELINES - TOURNAMENT & PLAYER APP

**Date:** 11 avril 2026
**Objectif:** Vue d'ensemble complète avant cleanup des paramètres temporels

---

## 📊 VUE D'ENSEMBLE - CYCLE DE VIE D'UN TOURNOI

```
CRÉATION → INSCRIPTIONS OUVERTES → INSCRIPTIONS FERMÉES → CONVOCATIONS → JOUR J
   │              │                        │                    │            │
   │              │                        │                    │            │
 J-28j          J-28j                    J-7j                J-3/5j        J-0
   │              │                        │                    │            │
   │        [Player App]              [Player App]         [Admin]      [Tournoi]
   │       visible dans               inscriptions          envoie       se joue
   │      "Compétitions"               ferment            poules
   │
[Admin crée]
```

---

## 🎯 PARAMÈTRES TEMPORELS ACTUELS (organization_settings)

### ✅ UTILISÉS

| Paramètre | Valeur | Où utilisé | Impact |
|-----------|--------|------------|--------|
| **AUCUN ACTUELLEMENT** | - | - | Les délais sont codés en dur ! |

### ❌ DÉFINIS MAIS NON UTILISÉS

| Paramètre | Valeur | Usage prévu | Status |
|-----------|--------|-------------|--------|
| `threshold_simulation_disabled` | 7j | Verrouiller simulation X jours avant | ❌ Jamais vérifié |
| `threshold_relance_start` | 7j | Début fenêtre relances manuelles | ❌ Pas appliqué |
| `threshold_relance_end` | 14j | Fin fenêtre relances manuelles | ❌ Pas appliqué |
| `threshold_relance_search` | 28j | Recherche tournois à relancer | ❌ Pas appliqué |
| `threshold_registration_deadline` | 7j | Calcul auto de fin | ❌ Jamais calculé |
| `threshold_stale_import_warning` | 7j | Alerte import obsolète | ❌ Jamais affiché |
| `threshold_urgent_alert` | 7j | Alertes rouges dashboard | ❌ Pas implémenté |
| `threshold_display_competitions` | 28j | Fenêtre "Compétitions à venir" | ❌ Pas appliqué |

**Résultat:** 8 paramètres configurables mais 0 utilisés = confusion totale !

---

## 📱 PLAYER APP - AFFICHAGE DES TOURNOIS

### Onglet "Vos compétitions" (tournaments)

**Filtrage actuel** (codé en dur dans `postgresql-adapter.js` ligne 81-97) :

```javascript
const inscriptionOpenDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
// SQL: WHERE t.debut >= today AND t.debut <= inscriptionOpenDate
// SQL: CASE WHEN t.debut <= inscriptionOpenDate THEN true ELSE false END as inscription_open
```

**Affichage:**
- Tournois **dans les 28 prochains jours**
- Filtrés par catégorie du joueur (rankings)
- Status: "Inscriptions ouvertes dans X jours" si > 28j
- Status: "Inscriptions fermées" si < 7j
- Bouton "S'inscrire" si entre 7j et 28j

### Onglet "Compétitions CDB" (calendar)

**Filtrage actuel** (Player App `player-api.js` ligne 193-197) :

```javascript
const inscriptionOpenDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
// WHERE debut >= today AND debut <= seasonEnd
// CASE WHEN debut <= inscriptionOpenDate THEN true ELSE false END as inscription_open
```

**Affichage:**
- TOUS les tournois de la saison (non filtrés par catégorie)
- Même logique 28j/7j
- Lien "📄 convocation" si PDF disponible

### Logique de clôture (player-api.js ligne 2960-2980)

```javascript
function getInscriptionStatus(tournament) {
  const daysUntil = (tournamentDate - now) / (1000 * 60 * 60 * 24);

  if (daysUntil < 7) {
    return { open: false, status: 'closed' };           // Fermé
  } else if (!tournament.inscription_open) {
    return { open: false, status: 'not_yet_open' };     // Pas encore ouvert
  } else {
    return { open: true, status: 'open' };              // Ouvert
  }
}
```

**Résultat:** Fenêtre d'inscription = **28 jours à 7 jours avant** le tournoi (codé en dur)

---

## 🖥️ TOURNAMENT APP - AFFICHAGE DES TOURNOIS

### Dashboard (dashboard.html)

**Alertes de tournois** (où ?) :
- DEVRAIT afficher alertes rouges X jours avant (`threshold_urgent_alert = 7j`)
- **Status:** ❌ Pas implémenté

### Générer les poules (generate-poules.html)

**Cartes "Upcoming tournaments"** :
- Affiche TOUS les tournois à venir (`WHERE debut >= today`)
- Pas de filtre temporel appliqué
- Simulation de poules disponible jusqu'à J-? (`threshold_simulation_disabled = 7j` NON appliqué)

**IMPORTANT:** Ces cartes doivent **rester visibles** même si inscription fermée !

### Com joueurs → Relances (emailing.html)

**Fenêtre de relance actuelle** :
- DEVRAIT filtrer entre `threshold_relance_start (7j)` et `threshold_relance_end (14j)`
- **Status:** ❌ Affiche TOUS les tournois futurs (pas de filtre appliqué)

---

## 📧 FLOWS EMAIL/NOTIFICATION UTILISANT DES DATES

### 1. Convocations (email.js - manuel)

**Déclencheur:** Admin clique "Envoyer les convocations" dans generate-poules.html

**Variables de date:**
- `{date}` - Date du tournoi (`tournoi_ext.debut`)
- `{deadline_date}` - ❌ **PAS UTILISÉ** (devrait être `debut - 7j`)

**Impact suppression `fin`:** ✅ **AUCUN** - n'utilise que `debut`

---

### 2. Résultats tournoi (emailing.js - manuel)

**Déclencheur:** Admin clique "Envoyer les résultats" après import CSV

**Variables de date:**
- `{tournament_date}` - Date du tournoi (`tournoi_ext.debut`)

**Impact suppression `fin`:** ✅ **AUCUN**

---

### 3. Relances manuelles (emailing.js - manuel)

**Déclencheur:** Admin sélectionne joueurs et envoie relance

**Variables de date:**
- `{tournament_date}` - Date du tournoi (`debut`)
- `{deadline_date}` - ❌ **PAS UTILISÉ**

**Requête SQL actuelle** (ligne 2913) :
```sql
SELECT t.tournoi_id, t.nom, t.mode, t.categorie, t.debut, t.fin, t.lieu, ...
```

**Impact suppression `fin`:** ⚠️ **Colonne sélectionnée mais jamais utilisée** - retirer de SELECT

---

### 4. Relances AUTOMATIQUES (server.js - scheduler DÉSACTIVÉ)

**Déclencheur:** Tous les jours à 9h AM, si `DATE(fin) = tomorrow`

**Variables de date:**
- `closingDate` = `new Date(tournament.fin)` (ligne 1375)

**Message:** "Les inscriptions pour {tournoi} ferment demain. Inscrivez-vous vite !"

**Problèmes identifiés:**
1. ❌ Utilise `fin` qui est actuellement = `debut` → message absurde
2. ❌ Pas de filtrage par catégorie
3. ❌ Pas de déduplication (envoie en boucle)
4. ❌ S'exécute au redémarrage (90s après startup)

**Impact suppression `fin`:** 🔴 **BLOQUE** - Le scheduler doit être réécrit de toute façon

---

### 5. Notifications automatiques (autres types)

**Tournoi annulé** (inscriptions.js ligne 2258) :
- Utilise `debut` uniquement ✅

**Tournoi modifié** (inscriptions.js ligne 2456) :
- Utilise `debut` uniquement ✅

**Nouveau tournoi** (inscriptions.js ligne 2133) :
- Utilise `debut` uniquement ✅

**Finale qualification** (tournaments.js ligne 902) :
- Utilise `debut` uniquement ✅

---

## 🗂️ USAGES DE `tournoi_ext.fin` DANS LE CODE

### Backend - Tournament App

| Fichier | Ligne | Usage | Critique ? |
|---------|-------|-------|------------|
| `server.js` | 1356 | SELECT fin FROM tournoi_ext (scheduler) | 🔴 OUI |
| `server.js` | 1375 | new Date(tournament.fin) | 🔴 OUI |
| `inscriptions.js` | 203-214 | INSERT/UPDATE fin depuis CSV import | ⚠️ Migration |
| `inscriptions.js` | 2236-2374 | INSERT/UPDATE fin (création/modification) | ⚠️ Migration |
| `inscriptions.js` | 2987-4043 | INSERT fin (création test/split) | ⚠️ Migration |
| `calendar.js` | 353-372 | INSERT fin depuis Excel (= debut) | ⚠️ Migration |
| `emailing.js` | 2913 | SELECT fin (jamais utilisé) | ✅ Retirer |

### Backend - Player App

| Fichier | Ligne | Usage | Critique ? |
|---------|-------|-------|------------|
| **AUCUN** | - | Player App n'utilise PAS la colonne fin | ✅ SAFE |

**Résultat:** La suppression de `fin` ne casse RIEN dans le Player App ✅

---

## 🎯 PLAN DE CLEANUP

### Phase 1 : Nouveaux paramètres configurables

**Ajouter dans `organization_settings` (defaults dans app-settings.js) :**

```javascript
// Fenêtre d'inscription (Player App)
inscription_opens_days_before: '28',      // Tournois apparaissent 28j avant
inscription_closes_days_before: '7',      // Inscriptions ferment 7j avant

// Relances manuelles (Tournament App)
relance_window_start: '7',                // Fenêtre de relance commence
relance_window_end: '14',                 // Fenêtre de relance se termine

// Relances automatiques (scheduler)
auto_reminder_enabled: 'true',            // On/off
auto_reminder_days_before_deadline: '3',  // Envoyer 3j avant clôture

// Simulation poules
poule_simulation_lock_days: '7',          // Verrouiller simulation 7j avant
```

**Supprimer:**
- `threshold_stale_import_warning` (jamais utilisé, hors scope)

**Garder mais renommer pour clarté:**
- `threshold_urgent_alert` → `dashboard_alert_days` (pour future implémentation)
- `threshold_display_competitions` → `dashboard_competitions_window` (idem)

---

### Phase 2 : Supprimer `tournoi_ext.fin`

**Migration SQL:**
```sql
ALTER TABLE tournoi_ext DROP COLUMN fin;
```

**Fichiers à modifier:**

1. **Backend - Tournament App**
   - `routes/inscriptions.js` : Retirer `fin` de tous les INSERT/UPDATE
   - `routes/calendar.js` : Retirer `fin = debut`
   - `routes/emailing.js` : Retirer `fin` du SELECT (ligne 2913)
   - `server.js` : Scheduler réécrit (n'utilisera plus `fin`)

2. **Backend - Player App**
   - ✅ **AUCUNE MODIFICATION** - n'utilise pas `fin`

3. **Frontend - Tournament App**
   - Vérifier si formulaires de création/modification de tournoi ont un champ `fin` à retirer

---

### Phase 3 : Implémenter les paramètres

**Player App** (`postgresql-adapter.js`) :
```javascript
// Ligne 81 - AVANT (codé en dur)
const inscriptionOpenDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);

// APRÈS (configurable)
const opensDays = await getSetting('inscription_opens_days_before') || 28;
const inscriptionOpenDate = new Date(Date.now() + opensDays * 24 * 60 * 60 * 1000);
```

**Tournament App** (`emailing.js`) :
- Appliquer `relance_window_start/end` au SELECT des tournois à relancer

**Simulation poules** (`generate-poules.html`) :
- Vérifier `poule_simulation_lock_days` avant d'afficher bouton "Simuler"

---

### Phase 4 : Corriger le scheduler automatique

**Nouveau comportement** (server.js) :

```javascript
// Condition: tournoi commence dans (inscription_closes_days_before + auto_reminder_days_before_deadline) jours
// Exemple: inscription ferme 7j avant, rappel 3j avant clôture = envoyer 10j avant le tournoi

const closesDays = await getSetting('inscription_closes_days_before') || 7;
const reminderDays = await getSetting('auto_reminder_days_before_deadline') || 3;
const targetDays = closesDays + reminderDays; // = 10j

const targetDate = new Date(Date.now() + targetDays * 24 * 60 * 60 * 1000);

// SELECT tournoi WHERE debut = targetDate
// + Filtrer par catégorie du tournoi
// + Vérifier déduplication (notification_log table)
```

**Ajout table `notification_log`:**
```sql
CREATE TABLE notification_log (
  id SERIAL PRIMARY KEY,
  tournoi_id INTEGER,
  notification_type VARCHAR(50),
  sent_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tournoi_id, notification_type, DATE(sent_at))
);
```

---

### Phase 5 : Page paramètres - Tableau récapitulatif

**Ajouter section "📅 Chronologie des compétitions"** dans `settings-admin.html` :

| Événement | Délai | Paramètre | Valeur | Impact |
|-----------|-------|-----------|--------|--------|
| **Création tournoi** | J-28+ | - | - | Tournoi créé par admin |
| **Inscriptions s'ouvrent (Player App)** | J-28 | `inscription_opens_days_before` | 28j | Tournoi visible dans "Vos compétitions" |
| **Fenêtre relance commence** | J-14 | `relance_window_end` | 14j | Admin peut envoyer relances manuelles |
| **Rappel automatique** | J-10 | `auto_reminder_days_before_deadline` | 3j | Notification auto aux non-inscrits |
| **Fenêtre relance se termine** | J-7 | `relance_window_start` | 7j | Tournoi disparaît de la fenêtre relances |
| **Inscriptions ferment (Player App)** | J-7 | `inscription_closes_days_before` | 7j | Plus possible de s'inscrire |
| **Simulation poules verrouillée** | J-7 | `poule_simulation_lock_days` | 7j | Admin ne peut plus modifier poules |
| **Convocations envoyées** | J-3/5 | - | Manuel | Admin envoie via "Générer les poules" |
| **Jour du tournoi** | J-0 | - | - | Compétition a lieu |

**Format visuel:** Timeline horizontale avec icônes 🗓️📧🔔📊

---

## ⚠️ POINTS DE VIGILANCE (VOTRE CRAINTE)

### Flows email/notification à NE PAS CASSER

✅ **Convocations manuelles** - Utilisent `debut` uniquement
✅ **Résultats tournoi** - Utilisent `debut` uniquement
✅ **Relances manuelles** - Utilisent `debut` (retirer `fin` du SELECT)
✅ **Notifications automatiques** - Utilisent `debut` uniquement
🔴 **Scheduler relances auto** - NÉCESSITE réécriture complète

**Stratégie de sécurité:**

1. ✅ Ne jamais toucher aux routes d'envoi d'emails existantes (`/send-convocations`, `/send-results`, etc.)
2. ✅ Supprimer `fin` uniquement des SELECT/INSERT (pas de logique métier)
3. 🔴 Réactiver scheduler SEULEMENT après tests complets
4. ✅ Garder les cartes de tournois dans generate-poules.html exactement comme aujourd'hui

---

## 📋 CHECKLIST DE VALIDATION

Avant de déployer :

- [ ] Player App - Vérifier "Vos compétitions" affiche tournois J-28 à J-7
- [ ] Player App - Vérifier "Compétitions CDB" affiche tous les tournois
- [ ] Player App - Vérifier message "Inscriptions ouvertes dans X jours"
- [ ] Player App - Vérifier bouton "S'inscrire" désactivé si < J-7
- [ ] Tournament App - Vérifier cartes tournois dans generate-poules.html
- [ ] Tournament App - Vérifier convocations s'envoient normalement
- [ ] Tournament App - Vérifier relances manuelles s'envoient normalement
- [ ] Tournament App - Vérifier résultats s'envoient normalement
- [ ] Tournament App - Vérifier fenêtre relances filtre J-14 à J-7
- [ ] Scheduler - Vérifier filtrage par catégorie
- [ ] Scheduler - Vérifier déduplication (pas de doublons)
- [ ] Scheduler - Vérifier n'envoie PAS au startup

---

## 🔄 ORDRE D'EXÉCUTION (pour éviter de casser)

1. **Ajouter** les nouveaux paramètres (sans les utiliser encore)
2. **Créer** `notification_log` table
3. **Retirer** `threshold_stale_import_warning` des settings
4. **Modifier** Player App pour lire paramètres (backward compatible avec valeurs en dur)
5. **Retirer** `fin` des SELECT qui ne l'utilisent pas
6. **Supprimer** colonne `fin` de la BDD
7. **Réécrire** scheduler automatique avec nouvelle logique
8. **Appliquer** filtres relances manuelles
9. **Tester** tous les flows email un par un
10. **Réactiver** scheduler si tests OK

**Durée estimée:** 1-2 jours (en faisant attention)

---

**IMPORTANT:** Ce document est la source de vérité. Toute modification doit être validée contre cette spec.
