# Guide Fonctionnel - Application de Gestion des Tournois de Billard Français

## Introduction

Cette application permet à un Comité Départemental de Billard de gérer l'ensemble de ses compétitions de billard français (carambole). Elle couvre tout le cycle de vie des tournois : inscriptions des joueurs, génération des poules, envoi des convocations, saisie des résultats et calcul des classements.

**L'application fonctionne en tandem avec une "Application Joueur" (Espace Joueur)** qui permet aux licenciés de s'inscrire eux-mêmes aux compétitions et de consulter leurs convocations.

---

## 1. VUE D'ENSEMBLE DES FONCTIONNALITÉS

### 1.1 Ce que permet l'application

| Domaine | Fonctionnalités |
|---------|-----------------|
| **Gestion des joueurs** | Base de données des licenciés FFB, informations de contact, classements par discipline |
| **Inscriptions** | Import CSV ou inscriptions via l'Application Joueur, suivi des inscriptions par tournoi |
| **Compétitions** | 4 modes de jeu (Libre, Cadre, Bande, 3 Bandes) × plusieurs niveaux (N1 à R4) = 13 catégories |
| **Convocations** | Génération des poules, envoi automatique des emails avec PDF, gestion des forfaits |
| **Résultats** | Import des résultats CSV, calcul automatique des classements saison |
| **Communication** | Emails de masse, annonces dans l'Application Joueur, invitations à l'Espace Joueur |

### 1.2 Structure d'une saison

Une saison va de septembre à août (ex: "2024-2025"). Pour chaque catégorie :
- **Tournoi 1, 2, 3** : Tournois qualificatifs
- **Finale Départementale** : Les 4 ou 6 meilleurs du classement s'affrontent

### 1.3 Lien avec l'Application Joueur

L'Application Joueur (accessible aux licenciés) permet de :
- S'inscrire aux compétitions (remplace les inscriptions manuelles)
- Consulter ses convocations et la composition des poules
- Voir le calendrier des compétitions
- Recevoir les annonces du comité

**Les données sont partagées** : quand un joueur s'inscrit via l'Application Joueur, son inscription apparaît automatiquement dans l'application de gestion.

---

## 2. CONNEXION ET TABLEAU DE BORD

### 2.1 Page de connexion

**Accès** : Page d'accueil de l'application

**Actions utilisateur** :
1. Saisir le nom d'utilisateur
2. Saisir le mot de passe
3. Cliquer sur "Se connecter"

**Lien "Mot de passe oublié"** : Permet de recevoir un code de réinitialisation par email.

### 2.2 Tableau de bord (Dashboard)

**Accès** : Après connexion, page d'accueil

**Ce qu'on y trouve** :

| Section | Description |
|---------|-------------|
| **Statistiques** | Nombre de joueurs actifs, inscriptions saison, compétitions à venir |
| **Alertes** | Compétitions proches nécessitant une action (convocations à envoyer) |
| **Compétitions à venir** | Liste des prochains tournois avec nombre d'inscrits |
| **Raccourcis rapides** | Accès direct aux fonctions les plus utilisées |

**Interaction avec l'Application Joueur** : Le compteur "Inscriptions saison" inclut les inscriptions faites via l'Application Joueur.

---

## 3. MENU "COMPÉTITIONS"

### 3.1 Générer les poules / Convocations

**Accès** : Menu Compétitions > Générer poules

**Objectif** : Créer les poules pour un tournoi et envoyer les convocations aux joueurs.

**Étapes du processus** :

#### Étape 1 : Sélection du tournoi
1. Choisir le **mode de jeu** (Libre, Cadre, Bande, 3 Bandes)
2. Choisir le **niveau** (N1, N2, N3, R1, R2, R3, R4)
3. Choisir la **saison**
4. Choisir le **tournoi** (1, 2, 3 ou Finale)
5. Cliquer sur "Charger les joueurs"

**Alternative** : Cliquer directement sur une carte de compétition à venir affichée en haut de page.

#### Étape 2 : Sélection des joueurs
- Les joueurs inscrits sont pré-cochés
- Les joueurs du classement précédent sont affichés (pour T2, T3, Finale)
- Possibilité d'ajouter manuellement un joueur non inscrit
- Les joueurs forfait ou désinscrits sont grisés

**Actions possibles** :
- Cocher/décocher des joueurs
- "Sélectionner les inscrits" : coche uniquement les joueurs ayant une inscription
- "Tout sélectionner" / "Tout désélectionner"

#### Étape 3 : Prévisualisation des poules
1. Cliquer sur "Générer les poules"
2. L'algorithme répartit les joueurs en poules équilibrées
3. Visualiser la composition de chaque poule
4. Possibilité de modifier manuellement (drag & drop ou boutons)

**Options disponibles** :
- **Générer le fichier Excel** : Télécharge un fichier Excel avec les poules
- **Envoyer les convocations** : Passe à l'étape 4

#### Étape 4 : Envoi des convocations
1. Prévisualiser l'email qui sera envoyé
2. Option "Mode Test" : envoie uniquement à une adresse de test
3. Cliquer sur "Envoyer les convocations"

**Ce qui se passe** :
- Chaque joueur reçoit un email personnalisé avec :
  - La date, l'heure et le lieu du tournoi
  - La composition de sa poule
  - Le planning des matchs
  - Un PDF récapitulatif en pièce jointe
- Les poules sont enregistrées en base de données
- Le statut des joueurs passe à "Convoqué"

**Lien avec l'Application Joueur** : Les joueurs peuvent consulter leurs convocations et la composition des poules directement dans l'Application Joueur après l'envoi.

### 3.2 Gestion des forfaits

**Accès** : Bouton "Gérer les forfaits" sur la page Générer poules (après avoir chargé les joueurs)

**Objectif** : Gérer les joueurs qui déclarent forfait après avoir reçu leur convocation.

**Processus complet** :

1. **Marquer un joueur forfait** :
   - Cliquer sur "Gérer les forfaits"
   - Cocher le(s) joueur(s) déclarant forfait
   - Cliquer sur "Enregistrer les forfaits"

2. **Régénérer les poules** :
   - Cliquer sur "Prévisualiser les nouvelles poules"
   - Vérifier la nouvelle composition (sans les forfaits)
   - Cliquer sur "Envoyer les nouvelles convocations"

3. **Ajouter un remplaçant** (optionnel) :
   - Cliquer sur "Ajouter un remplaçant"
   - Rechercher et sélectionner un joueur
   - Le joueur est ajouté à la liste des convoqués

4. **Réintégrer un joueur** (annuler un forfait) :
   - Dans la section "Joueurs forfait", cliquer sur "Réintégrer"
   - Le joueur revient dans la liste des convoqués

**Statuts des joueurs** :
- **Inscrit** : Inscription enregistrée, pas encore convoqué
- **Convoqué** : Convocation envoyée
- **Forfait** : A déclaré forfait
- **Désinscrit** : Inscription annulée

### 3.3 Résultats des tournois

**Accès** : Menu Compétitions > Résultats

**Objectif** : Importer les résultats des tournois terminés.

**Processus** :
1. Sélectionner la catégorie et le numéro de tournoi
2. Télécharger le fichier CSV des résultats (format standard)
3. Cliquer sur "Importer"
4. Vérifier les résultats importés
5. Le classement saison est automatiquement recalculé

**Données importées** :
- Classement final du tournoi
- Points de match
- Moyenne générale
- Meilleure série

### 3.4 Classements

**Accès** : Menu Compétitions > Classements

**Objectif** : Consulter et exporter les classements saison.

**Fonctionnalités** :
1. Sélectionner la catégorie
2. Sélectionner la saison
3. Visualiser le classement avec :
   - Position
   - Joueur (nom, prénom, club)
   - Points T1, T2, T3
   - Total points de match
   - Moyenne cumulée
   - Meilleure série
4. Les qualifiés pour la finale sont mis en évidence (fond vert)
5. Bouton "Exporter Excel" pour télécharger le classement

**Règle de qualification** :
- Moins de 9 participants sur la saison → 4 qualifiés
- 9 participants ou plus → 6 qualifiés

---

## 4. MENU "INSCRIPTIONS"

### 4.1 Liste des inscriptions

**Accès** : Menu Inscriptions > Liste

**Objectif** : Consulter et gérer toutes les inscriptions aux compétitions.

**Filtres disponibles** :
- Par saison
- Par mode de jeu
- Par niveau
- Par statut (Inscrit, Convoqué, Forfait, Désinscrit)
- Recherche par nom ou licence

**Actions sur une inscription** :
- **Modifier** : Changer les coordonnées, le statut
- **Supprimer** : Retirer l'inscription (avec confirmation)

**Sources d'inscription** :
- `player_app` : Inscription faite par le joueur via l'Application Joueur
- `manual` : Inscription ajoutée manuellement par un administrateur
- `ionos` : Import CSV (ancien système, en cours de suppression)

**Lien avec l'Application Joueur** : Les inscriptions faites par les joueurs dans l'Application Joueur apparaissent automatiquement avec la source "player_app".

### 4.2 Ajouter une inscription

**Accès** : Bouton "Ajouter" sur la page Liste des inscriptions

**Processus** :
1. Sélectionner le tournoi
2. Rechercher le joueur (par nom ou licence)
3. Vérifier/compléter l'email et téléphone
4. Cliquer sur "Enregistrer"

**Contrainte** : Un joueur ne peut pas être inscrit deux fois au même tournoi.

---

## 5. MENU "JOUEURS"

### 5.1 Base de données joueurs

**Accès** : Menu Joueurs > Liste

**Objectif** : Gérer la base de données des licenciés.

**Informations par joueur** :
- Licence FFB
- Nom, prénom
- Club
- Classement FFB par discipline (Libre, Cadre, Bande, 3 Bandes)
- Statut (Actif/Inactif)

**Actions** :
- **Importer** : Charger un fichier CSV de la FFB
- **Modifier** : Mettre à jour les informations d'un joueur
- **Filtrer** : Par club, par statut actif/inactif

### 5.2 Contacts joueurs

**Accès** : Menu Joueurs > Contacts

**Objectif** : Gérer les coordonnées (email, téléphone) des joueurs.

**Note** : Ces informations sont utilisées pour l'envoi des convocations et communications.

---

## 6. MENU "COMMUNICATION"

### 6.1 Annonces (Application Joueur)

**Accès** : Menu Communication > Annonces

**Objectif** : Publier des annonces visibles dans l'Application Joueur.

**Types d'annonces** :
- **INFO** : Information générale
- **ALERTE** : Message important
- **RESULTATS** : Résultats de compétition
- **PERSO** : Message personnel (ciblé à un joueur)

**Créer une annonce** :
1. Saisir le titre
2. Saisir le message
3. Choisir le type
4. Optionnel : définir une date d'expiration
5. Optionnel : cibler un joueur spécifique (par licence)
6. Cliquer sur "Publier"

**Gestion des annonces existantes** :
- **Activer/Désactiver** : Rendre visible ou masquer
- **Supprimer** : Retirer définitivement
- **Purger** : Supprimer en masse (toutes les expirées, toutes les inactives, ou par période)

**Lien avec l'Application Joueur** : Les annonces actives et non expirées sont visibles par tous les joueurs (ou par le joueur ciblé uniquement pour les annonces PERSO).

### 6.2 Emails de masse

**Accès** : Menu Communication > Emailing

**Objectif** : Envoyer des emails à un groupe de joueurs.

**Processus** :
1. **Sélectionner les destinataires** :
   - Filtrer par club, mode de jeu, classement FFB
   - Filtrer par tournoi (inscrits à un tournoi spécifique)
   - Filtrer par classement saison
   - Option "Utilisateurs Espace Joueur" : uniquement ceux ayant l'application

2. **Composer le message** :
   - Saisir l'objet
   - Rédiger le contenu (éditeur riche avec mise en forme)
   - Variables disponibles : {player_name}, {first_name}, {club}, etc.

3. **Mode test** (recommandé) :
   - Cocher "Mode Test"
   - Saisir une adresse email de test
   - Envoyer pour vérifier le rendu

4. **Envoyer** :
   - Cliquer sur "Envoyer"
   - Confirmation du nombre d'emails envoyés

### 6.3 Invitations à l'Espace Joueur

**Accès** : Menu Communication > Invitations Espace Joueur

**Objectif** : Inviter les joueurs à créer leur compte sur l'Application Joueur.

#### Onglet "Envoyer des invitations"

1. Filtrer les joueurs éligibles (ayant un email, pas encore invités)
2. Sélectionner les joueurs à inviter
3. Option "Mode Test" pour vérifier l'email
4. Cliquer sur "Envoyer les invitations"

**L'email d'invitation contient** :
- Explication de l'Application Joueur
- Lien pour créer un compte
- Guide PDF en pièce jointe (configurable)

#### Onglet "Suivi des invitations"

- Liste de toutes les invitations envoyées
- Statut : "En attente" ou "Inscrit"
- Nombre d'envois (initial + rappels)
- Possibilité de renvoyer un rappel individuellement ou en lot

**Actions en lot** :
- Cocher plusieurs joueurs "En attente"
- Cliquer sur "Renvoyer la sélection"
- Un email de rappel est envoyé à tous les sélectionnés

#### Onglet "Paramètres"

- Personnaliser le template de l'email d'invitation
- Télécharger le guide PDF joint aux invitations

**Lien avec l'Application Joueur** : Quand un joueur crée son compte, son statut passe automatiquement à "Inscrit" dans le suivi.

---

## 7. MENU "ADMINISTRATION"

### 7.1 Paramètres organisation

**Accès** : Menu Administration > Paramètres

**Objectif** : Configurer les informations de l'organisation.

**Paramètres disponibles** :
- Nom de l'organisation
- Sigle (nom court)
- Logo
- Couleurs de l'interface (personnalisation visuelle)
- Adresses email (communication, notifications)

### 7.2 Gestion des utilisateurs

**Accès** : Menu Administration > Utilisateurs

**Objectif** : Gérer les comptes ayant accès à l'application.

**Rôles** :
- **Admin** : Accès complet, peut créer d'autres utilisateurs
- **Éditeur** : Peut gérer les compétitions et inscriptions
- **Lecteur** : Consultation seule

**Actions** :
- Créer un utilisateur
- Modifier le rôle
- Réinitialiser le mot de passe
- Désactiver un compte

### 7.3 Paramètres des tournois

**Accès** : Menu Administration > Tournois

**Objectif** : Configurer les paramètres de jeu par catégorie.

**Paramètres configurables** :
- Distance (nombre de points à atteindre)
- Nombre de reprises
- Format des poules (nombre de joueurs par poule)

### 7.4 Gestion des clubs

**Accès** : Menu Administration > Clubs

**Objectif** : Gérer la liste des clubs du département.

**Fonctionnalités** :
- Ajouter/modifier/supprimer un club
- Télécharger le logo du club
- Les logos apparaissent dans les classements et documents

---

## 8. CALENDRIER DES COMPÉTITIONS

**Accès** : Menu Calendrier

**Objectif** : Visualiser et gérer le calendrier des compétitions.

**Vue calendrier** :
- Affichage par mois
- Code couleur par mode de jeu
- Clic sur une compétition pour voir les détails

**Gestion des compétitions** :
- Créer une nouvelle compétition (tournoi externe)
- Définir : mode, catégorie, date, lieu
- Modifier ou annuler une compétition

**Lien avec l'Application Joueur** : Le calendrier est visible par les joueurs dans l'Application Joueur. Ils peuvent s'inscrire directement aux compétitions à venir.

---

## 9. FLUX DE TRAVAIL TYPIQUES

### 9.1 Préparer un tournoi (de A à Z)

1. **Créer le tournoi** : Menu Calendrier > Ajouter
2. **Attendre les inscriptions** : Les joueurs s'inscrivent via l'Application Joueur
3. **Vérifier les inscriptions** : Menu Inscriptions > Liste
4. **Générer les poules** : Menu Compétitions > Générer poules
5. **Envoyer les convocations** : Étape 4 de la génération
6. **Gérer les forfaits** : Si des joueurs se désistent
7. **Après le tournoi** : Importer les résultats

### 9.2 Gérer un forfait de dernière minute

1. Menu Compétitions > Générer poules
2. Charger le tournoi concerné
3. Cliquer "Gérer les forfaits"
4. Cocher le joueur forfait
5. Optionnel : Ajouter un remplaçant
6. Prévisualiser les nouvelles poules
7. Envoyer les nouvelles convocations (seuls les joueurs impactés sont notifiés)

### 9.3 Inviter les joueurs à l'Espace Joueur

1. Menu Communication > Invitations Espace Joueur
2. Onglet "Paramètres" : Vérifier le template et le PDF
3. Onglet "Envoyer" : Sélectionner les joueurs
4. Envoyer les invitations
5. Onglet "Suivi" : Suivre les inscriptions
6. Renvoyer des rappels aux "En attente" si nécessaire

---

## 10. GLOSSAIRE

| Terme | Définition |
|-------|------------|
| **Catégorie** | Combinaison mode de jeu + niveau (ex: "Libre R2") |
| **Convocation** | Email envoyé au joueur avec les informations du tournoi et sa poule |
| **Forfait** | Joueur qui ne peut finalement pas participer après avoir été convoqué |
| **Licence FFB** | Numéro d'identification unique du joueur à la Fédération Française de Billard |
| **Mode de jeu** | Discipline : Libre, Cadre, Bande, ou 3 Bandes |
| **Niveau** | Classement : N1, N2, N3 (national), R1, R2, R3, R4 (régional) |
| **Points de match** | Points attribués selon le classement dans un tournoi (utilisés pour le classement saison) |
| **Poule** | Groupe de joueurs s'affrontant lors d'un tournoi |
| **Saison** | Période de septembre à août (ex: 2024-2025) |
| **Application Joueur / Espace Joueur** | Application mobile/web permettant aux joueurs de s'inscrire et consulter leurs informations |

---

## 11. NOTES TECHNIQUES

### Emails
- Les emails sont envoyés via le service Resend
- L'adresse d'expédition est configurable dans les paramètres
- Les images (logo) sont hébergées sur le serveur de l'application

### Données partagées avec l'Application Joueur
- Inscriptions aux tournois
- Convocations et composition des poules
- Annonces
- Calendrier des compétitions

### Format des fichiers d'import
- **Joueurs** : CSV avec colonnes licence, nom, prénom, club, classements
- **Résultats** : CSV avec colonnes licence, classement, points, moyenne, série
- **Délimiteur** : Point-virgule (;)

---

*Ce document décrit les fonctionnalités de l'Application de Gestion des Tournois version 2.0. Pour toute question, contacter l'administrateur de votre comité.*
