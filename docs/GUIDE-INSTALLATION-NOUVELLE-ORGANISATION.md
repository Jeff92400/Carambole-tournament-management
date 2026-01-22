# Guide d'Installation et de Configuration
## Système de Gestion de Tournois de Billard Français

Ce document décrit toutes les étapes nécessaires pour déployer et configurer les deux applications (Application de Gestion des Tournois et Espace Joueur) pour une nouvelle organisation départementale de billard.

---

## Table des Matières

1. [Prérequis](#1-prérequis)
2. [Création des Comptes de Services](#2-création-des-comptes-de-services)
3. [Déploiement des Applications](#3-déploiement-des-applications)
4. [Configuration de la Base de Données](#4-configuration-de-la-base-de-données)
5. [Configuration des Variables d'Environnement](#5-configuration-des-variables-denvironnement)
6. [Personnalisation de l'Organisation](#6-personnalisation-de-lorganisation)
7. [Configuration des Emails](#7-configuration-des-emails)
8. [Import des Données Initiales](#8-import-des-données-initiales)
9. [Création des Comptes Utilisateurs](#9-création-des-comptes-utilisateurs)
10. [Tests et Validation](#10-tests-et-validation)
11. [Maintenance et Opérations Courantes](#11-maintenance-et-opérations-courantes)

---

## 1. Prérequis

### Compétences Requises
- Connaissances de base en administration web
- Familiarité avec les interfaces de gestion cloud
- Compréhension des concepts de base de données

### Informations à Préparer
Avant de commencer, rassemblez les informations suivantes :

| Information | Exemple | Notes |
|-------------|---------|-------|
| Nom complet de l'organisation | Comité Départemental de Billard du Rhône | Nom officiel |
| Nom court | CDBR | Acronyme utilisé dans les emails |
| Adresse email de contact | contact@cdbr.fr | Email principal de l'organisation |
| Adresse email pour les convocations | convocations@cdbr.fr | Optionnel, peut être identique |
| Logo de l'organisation | Format PNG, fond transparent | Taille recommandée : 200x200px |
| Couleur principale | #1F4788 | Code hexadécimal |
| Liste des clubs du département | Noms et adresses | Pour l'import initial |
| Liste des catégories de jeu | Libre, Cadre, Bande, 3 Bandes... | Selon les disciplines pratiquées |

---

## 2. Création des Comptes de Services

### 2.1 GitHub (Hébergement du Code)

1. Créer un compte sur [github.com](https://github.com) si vous n'en avez pas
2. Forker les deux repositories :
   - `cdbhs-tournament-management` (Application de Gestion)
   - `cdbhs-player-app` (Espace Joueur)
3. Renommer vos forks selon votre organisation (ex: `cdbr-tournament-management`)

### 2.2 Railway (Hébergement et Base de Données)

1. Créer un compte sur [railway.app](https://railway.app)
2. Lier votre compte GitHub à Railway
3. Créer un nouveau projet pour chaque application

### 2.3 Resend (Service d'Envoi d'Emails)

1. Créer un compte sur [resend.com](https://resend.com)
2. Vérifier votre domaine email (instructions fournies par Resend)
3. Créer une clé API (API Key)
4. **Important** : Configurer les adresses d'envoi autorisées :
   - `noreply@votredomaine.fr`
   - `convocations@votredomaine.fr`
   - `communication@votredomaine.fr`

### 2.4 Domaine (Optionnel mais Recommandé)

Si vous souhaitez utiliser un domaine personnalisé (ex: `gestion.cdbr.fr`) :
1. Acheter un domaine chez un registrar (OVH, Gandi, etc.)
2. Configurer les DNS selon les instructions Railway

---

## 3. Déploiement des Applications

### 3.1 Application de Gestion des Tournois

1. **Dans Railway**, créer un nouveau projet
2. Cliquer sur **"New"** → **"GitHub Repo"**
3. Sélectionner votre fork de `tournament-management`
4. Railway détecte automatiquement Node.js et déploie

### 3.2 Base de Données PostgreSQL

1. Dans le même projet Railway, cliquer sur **"New"** → **"Database"** → **"PostgreSQL"**
2. La base de données est créée automatiquement
3. Noter l'URL de connexion (DATABASE_URL) fournie par Railway

### 3.3 Espace Joueur (Player App)

1. Créer un **second projet** Railway
2. Déployer depuis votre fork de `player-app`
3. **Important** : Cette application doit utiliser la **même base de données** que l'application de gestion
4. Copier la `DATABASE_URL` du premier projet vers ce projet

### 3.4 Vérification du Déploiement

Après déploiement, vous devriez avoir :
- URL Application de Gestion : `https://votre-projet-gestion.up.railway.app`
- URL Espace Joueur : `https://votre-projet-joueur.up.railway.app`

---

## 4. Configuration de la Base de Données

### 4.1 Initialisation Automatique

Au premier démarrage, l'application crée automatiquement toutes les tables nécessaires. Vérifiez dans les logs Railway que l'initialisation s'est bien passée.

### 4.2 Tables Principales

| Table | Description |
|-------|-------------|
| `players` | Joueurs licenciés FFB |
| `categories` | Catégories de compétition |
| `clubs` | Clubs du département |
| `tournoi_ext` | Tournois externes |
| `inscriptions` | Inscriptions aux tournois |
| `tournaments` | Tournois internes (T1, T2, T3) |
| `tournament_results` | Résultats des tournois |
| `rankings` | Classements par catégorie |
| `email_templates` | Modèles d'emails personnalisables |
| `app_settings` | Paramètres de l'application |
| `player_accounts` | Comptes Espace Joueur |
| `users` | Comptes administrateurs |

---

## 5. Configuration des Variables d'Environnement

### 5.1 Application de Gestion des Tournois

Dans Railway, aller dans **Settings** → **Variables** et configurer :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | URL PostgreSQL | Automatiquement remplie par Railway |
| `JWT_SECRET` | Clé secrète pour l'authentification | Générer une chaîne aléatoire de 64 caractères |
| `RESEND_API_KEY` | Clé API Resend | `re_xxxxxxxxxxxx` |
| `BASE_URL` | URL publique de l'application | `https://votre-projet.up.railway.app` |
| `ALLOWED_ORIGINS` | Origines CORS autorisées | `https://votre-projet.up.railway.app,https://joueur.up.railway.app` |
| `PLAYER_APP_API_KEY` | Clé partagée avec l'Espace Joueur | Générer une chaîne aléatoire de 32 caractères |
| `PLAYER_APP_URL` | URL de l'Espace Joueur | `https://votre-projet-joueur.up.railway.app` |

### 5.2 Espace Joueur (Player App)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | **Même URL** que l'application de gestion | Copier depuis le premier projet |
| `JWT_SECRET` | Clé secrète (peut être différente) | Générer une chaîne aléatoire |
| `TOURNAMENT_APP_API_KEY` | **Même valeur** que `PLAYER_APP_API_KEY` | Doit correspondre |
| `TOURNAMENT_APP_URL` | URL de l'application de gestion | `https://votre-projet-gestion.up.railway.app` |
| `BASE_URL` | URL publique de l'Espace Joueur | `https://votre-projet-joueur.up.railway.app` |

### 5.3 Génération de Clés Sécurisées

Pour générer des clés secrètes sécurisées, utilisez :
```bash
# Sur Mac/Linux
openssl rand -hex 32

# Ou en ligne
# https://generate-secret.vercel.app/64
```

---

## 6. Personnalisation de l'Organisation

### 6.1 Accès Initial

1. Accéder à votre application de gestion : `https://votre-projet.up.railway.app`
2. Un compte administrateur par défaut est créé :
   - **Utilisateur** : `admin`
   - **Mot de passe** : `admin123`
3. **IMPORTANT** : Changer immédiatement ce mot de passe !

### 6.2 Paramètres de l'Organisation

Aller dans **Paramètres** → **Organisation** et configurer :

| Paramètre | Description |
|-----------|-------------|
| Nom de l'organisation | Nom complet affiché dans les emails et PDF |
| Nom court | Acronyme utilisé dans les en-têtes |
| Logo | Télécharger le logo de votre organisation |

### 6.3 Personnalisation des Couleurs

Aller dans **Paramètres** → **Apparence** :

| Couleur | Utilisation | Valeur par défaut |
|---------|-------------|-------------------|
| Couleur principale | En-têtes, boutons, liens | `#1F4788` |
| Couleur secondaire | Dégradés, survols | `#667EEA` |
| Couleur d'accent | Alertes, badges | `#FFC107` |

### 6.4 Configuration des Adresses Email

Aller dans **Paramètres** → **Emails** :

| Paramètre | Description | Exemple |
|-----------|-------------|---------|
| Email de contact | Adresse pour les réponses | `contact@cdbr.fr` |
| Email noreply | Expéditeur par défaut | `noreply@cdbr.fr` |
| Email convocations | Pour les convocations | `convocations@cdbr.fr` |
| Email communication | Pour les communications | `communication@cdbr.fr` |
| Nom de l'expéditeur | Affiché dans les emails | `CDBR` |

---

## 7. Configuration des Emails

### 7.1 Vérification du Domaine dans Resend

1. Connectez-vous à [resend.com](https://resend.com)
2. Aller dans **Domains** → **Add Domain**
3. Entrer votre domaine (ex: `cdbr.fr`)
4. Ajouter les enregistrements DNS fournis chez votre hébergeur :
   - Enregistrement TXT pour la vérification
   - Enregistrements DKIM pour l'authentification
5. Attendre la validation (peut prendre jusqu'à 48h)

### 7.2 Personnalisation des Modèles d'Emails

Aller dans **Paramètres** → **Modèles d'emails** pour personnaliser :

| Modèle | Utilisation |
|--------|-------------|
| Convocation | Envoyé aux joueurs avant un tournoi |
| Convocation Finale | Pour les finales départementales |
| Résultats | Envoyé après un tournoi avec les résultats |
| Relance T2 | Relance pour le 2ème tournoi |
| Relance T3 | Relance pour le 3ème tournoi |
| Relance Finale | Invitation à la finale |

**Variables disponibles dans les modèles :**

| Variable | Description |
|----------|-------------|
| `{player_name}` | Nom complet du joueur |
| `{first_name}` | Prénom du joueur |
| `{category}` | Catégorie de la compétition |
| `{tournament}` | Numéro du tournoi |
| `{date}` | Date de la compétition |
| `{location}` | Lieu de la compétition |
| `{organization_name}` | Nom complet de l'organisation |
| `{organization_short_name}` | Nom court de l'organisation |
| `{organization_email}` | Email de contact |

### 7.3 Test d'Envoi d'Email

1. Aller dans **Emailing** → **Composer**
2. Sélectionner un destinataire test
3. Envoyer un email de test
4. Vérifier la réception et le formatage

---

## 8. Import des Données Initiales

### 8.1 Import des Joueurs (Fichier FFB)

1. Exporter la liste des licenciés depuis le site FFB
2. Aller dans **Joueurs** → **Importer**
3. Sélectionner le fichier CSV
4. Mapper les colonnes :
   - Licence
   - Nom
   - Prénom
   - Club
   - Classements (Libre, Cadre, Bande, 3 Bandes)
5. Valider l'import

**Format CSV attendu :**
```csv
licence;nom;prenom;club;cat_libre;cat_cadre;cat_bande;cat_3bandes
123456;DUPONT;Jean;BC Lyon;D2;D3;D4;NC
```

### 8.2 Configuration des Clubs

1. Aller dans **Paramètres** → **Clubs**
2. Vérifier que tous les clubs sont présents (importés avec les joueurs)
3. Pour chaque club, compléter :
   - Adresse complète
   - Email de contact
   - Numéro de téléphone
   - Nombre de tables disponibles

### 8.3 Configuration des Catégories

1. Aller dans **Paramètres** → **Catégories**
2. Vérifier/créer les catégories selon vos besoins :

| Mode | Catégories typiques |
|------|---------------------|
| Libre | D1, D2, D3, D4, Honneur |
| Cadre | D1, D2, D3 |
| Bande | D1, D2, D3, D4 |
| 3 Bandes | D1, D2, D3, D4 |

3. Pour chaque catégorie, définir :
   - Nombre de joueurs qualifiés pour la finale
   - Nombre de points par victoire
   - Distance de jeu

### 8.4 Création des Tournois de la Saison

1. Aller dans **Tournois Externes** → **Nouveau**
2. Créer les tournois pour chaque catégorie :
   - Tournoi 1 (T1)
   - Tournoi 2 (T2)
   - Tournoi 3 (T3)
   - Finale
3. Définir pour chaque tournoi :
   - Date
   - Lieu (club organisateur)
   - Catégorie
   - Mode de jeu
   - Date limite d'inscription

---

## 9. Création des Comptes Utilisateurs

### 9.1 Comptes Administrateurs (Application de Gestion)

1. Aller dans **Paramètres** → **Utilisateurs**
2. Créer les comptes nécessaires :

| Rôle | Permissions |
|------|-------------|
| Admin | Accès complet, gestion des utilisateurs |
| Editeur | Gestion des tournois, inscriptions, emails |
| Lecteur | Consultation uniquement |

### 9.2 Comptes Joueurs (Espace Joueur)

Les joueurs créent leur compte eux-mêmes via l'Espace Joueur :

1. Le joueur accède à l'URL de l'Espace Joueur
2. Il clique sur **"Créer un compte"**
3. Il entre son numéro de licence FFB
4. Le système vérifie la licence dans la base
5. Le joueur définit son email et mot de passe

**Ou par invitation :**

1. Aller dans **Espace Joueur** → **Invitations**
2. Sélectionner les joueurs à inviter
3. Envoyer les invitations par email
4. Les joueurs reçoivent un lien pour créer leur compte

---

## 10. Tests et Validation

### 10.1 Checklist de Validation

#### Application de Gestion
- [ ] Connexion avec le compte admin
- [ ] Changement de mot de passe admin
- [ ] Affichage correct du logo et des couleurs
- [ ] Liste des joueurs visible
- [ ] Liste des clubs complète
- [ ] Catégories configurées
- [ ] Au moins un tournoi créé

#### Emails
- [ ] Test d'envoi d'email depuis le Composer
- [ ] Vérification du nom d'expéditeur
- [ ] Vérification des couleurs dans l'email
- [ ] Logo visible dans l'email (si configuré)
- [ ] Lien de réponse fonctionnel

#### Espace Joueur
- [ ] Page d'accueil accessible
- [ ] Création d'un compte joueur test
- [ ] Connexion avec le compte test
- [ ] Affichage du calendrier des tournois
- [ ] Inscription à un tournoi test
- [ ] Réception de l'email de confirmation

### 10.2 Test Complet d'un Cycle

1. **Créer un tournoi test** avec une date proche
2. **Inscrire quelques joueurs** (manuellement ou via l'Espace Joueur)
3. **Générer les poules** dans l'outil de convocation
4. **Envoyer les convocations** (en mode test d'abord)
5. **Vérifier la réception** des emails et PDF
6. **Simuler les résultats** du tournoi
7. **Envoyer les résultats** aux participants
8. **Vérifier le classement** mis à jour

---

## 11. Maintenance et Opérations Courantes

### 11.1 Sauvegarde des Données

Railway effectue des sauvegardes automatiques de PostgreSQL. Pour une sauvegarde manuelle :

1. Aller dans Railway → Database → Backups
2. Cliquer sur **"Create Backup"**
3. Télécharger le fichier de sauvegarde

### 11.2 Mise à Jour de l'Application

Les mises à jour sont automatiques via GitHub :

1. Synchroniser votre fork avec le repository principal
2. Railway redéploie automatiquement

### 11.3 Import Annuel des Licenciés

Au début de chaque saison :

1. Exporter la nouvelle liste FFB
2. Aller dans **Joueurs** → **Importer**
3. L'import met à jour les joueurs existants et ajoute les nouveaux

### 11.4 Archivage de Fin de Saison

À la fin de chaque saison :

1. Exporter les classements finaux (PDF ou CSV)
2. Archiver les résultats des tournois
3. Réinitialiser les classements pour la nouvelle saison

### 11.5 Monitoring et Logs

- **Railway Dashboard** : Métriques d'utilisation, logs en temps réel
- **Logs d'emails** : Dans l'application, section **Emailing** → **Historique**
- **Erreurs** : Consultables dans les logs Railway

---

## Support et Assistance

### Documentation Technique
- Repository GitHub : Contient la documentation technique détaillée
- Fichiers CLAUDE.md : Documentation pour les développeurs

### Problèmes Courants

| Problème | Solution |
|----------|----------|
| Emails non reçus | Vérifier la configuration Resend et les DNS |
| Erreur de connexion | Vérifier les variables d'environnement |
| Logo non affiché | Vérifier le format (PNG) et la taille |
| Base de données inaccessible | Vérifier DATABASE_URL dans Railway |

### Contact

Pour toute question technique ou demande d'assistance, consulter :
- La documentation GitHub du projet
- Les issues GitHub pour signaler des bugs
- La communauté des utilisateurs

---

## Annexes

### A. Glossaire

| Terme | Définition |
|-------|------------|
| FFB | Fédération Française de Billard |
| Poule | Groupe de joueurs s'affrontant lors d'un tournoi |
| Convocation | Document envoyé aux joueurs avant un tournoi |
| Catégorie | Niveau de compétition (D1, D2, D3, D4, Honneur) |
| Mode | Type de jeu (Libre, Cadre, Bande, 3 Bandes) |
| T1, T2, T3 | Tournois qualificatifs 1, 2 et 3 de la saison |

### B. Formats de Fichiers

#### Import Joueurs (CSV)
```
licence;nom;prenom;sexe;club;cat_libre;cat_cadre;cat_bande;cat_3bandes;email
```

#### Import Résultats (CSV)
```
licence;nom;prenom;points;reprises;meilleure_serie
```

### C. Variables d'Environnement - Récapitulatif

#### Application de Gestion
```env
DATABASE_URL=postgresql://user:pass@host:5432/db
JWT_SECRET=votre_cle_secrete_64_caracteres
RESEND_API_KEY=re_xxxxxxxxxxxx
BASE_URL=https://votre-app.up.railway.app
ALLOWED_ORIGINS=https://votre-app.up.railway.app,https://joueur-app.up.railway.app
PLAYER_APP_API_KEY=cle_partagee_32_caracteres
PLAYER_APP_URL=https://joueur-app.up.railway.app
```

#### Espace Joueur
```env
DATABASE_URL=postgresql://user:pass@host:5432/db
JWT_SECRET=votre_cle_secrete_joueur
TOURNAMENT_APP_API_KEY=cle_partagee_32_caracteres
TOURNAMENT_APP_URL=https://votre-app.up.railway.app
BASE_URL=https://joueur-app.up.railway.app
```

---

*Document créé le 22 janvier 2026*
*Version 1.0*
