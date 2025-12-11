# CDBHS Tournois - Guide Utilisateur

## Table des matières
1. [Connexion](#1-connexion)
2. [Tableau de bord](#2-tableau-de-bord)
3. [Gestion des fichiers IONOS](#3-gestion-des-fichiers-ionos)
4. [Génération des poules et convocations](#4-génération-des-poules-et-convocations)
5. [Envoi des convocations par email](#5-envoi-des-convocations-par-email)
6. [Classements](#6-classements)
7. [Tournois joués et envoi des résultats](#7-tournois-joués-et-envoi-des-résultats)
8. [Gestion des joueurs](#8-gestion-des-joueurs)
9. [Gestion des clubs](#9-gestion-des-clubs)
10. [Paramètres](#10-paramètres)

---

## 1. Connexion

### Accès à l'application
- URL : https://cdbhs-tournament-management-production.up.railway.app
- Identifiants par défaut : `admin` / `admin123`

### Rôles utilisateurs
| Rôle | Droits |
|------|--------|
| **Admin** | Accès complet (import, modification, suppression) |
| **Viewer** | Consultation uniquement (classements, résultats) |

---

## 2. Tableau de bord

Le tableau de bord affiche :
- Statistiques globales (joueurs, tournois, catégories)
- Accès rapide aux fonctionnalités principales
- État des derniers imports

---

## 3. Gestion des fichiers IONOS

### Accès
Menu **Fichiers** > **Compétitions & Inscriptions**

### Fichiers à importer depuis IONOS
L'application nécessite 3 fichiers CSV exportés depuis la base IONOS :

| Fichier | Description | Fréquence |
|---------|-------------|-----------|
| **Joueurs** | Liste des joueurs FFB avec licences et classements | Début de saison |
| **Compétitions IONOS** | Liste des compétitions CDBHS | Début de saison |
| **Inscriptions** | Inscriptions des joueurs aux tournois | Avant chaque tournoi |

### Procédure d'import

1. **Exporter depuis IONOS** :
   - Connectez-vous à l'interface IONOS
   - Exportez chaque fichier au format CSV

2. **Importer dans l'application** :
   - Allez dans **Fichiers** > **Compétitions & Inscriptions**
   - Section "1. Importer les Compétitions IONOS" pour les tournois
   - Section "2. Importer les Inscriptions" pour les inscriptions joueurs
   - Cliquez sur la zone de dépôt ou glissez-déposez le fichier CSV
   - Cliquez sur **Importer**

3. **Vérification** :
   - Un message confirme le nombre d'enregistrements importés
   - La section "Données actuelles" affiche le nombre de compétitions et inscriptions

### Indicateurs de fraîcheur des données

Sur la page "Compétitions à jouer", un panneau affiche l'état des fichiers avec un code couleur :

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | Mis à jour il y a moins de 24h |
| 🟡 Jaune | Mis à jour il y a 1-2 jours |
| 🟠 Orange | Mis à jour il y a 3-7 jours |
| 🔴 Rouge | Mis à jour il y a plus de 7 jours |

---

## 4. Génération des poules et convocations

### Accès
Menu principal > **Compétitions à jouer**

### Étape 1 : Vérification des données

À l'ouverture de la page, un avertissement vous rappelle de mettre à jour les fichiers IONOS :
- Cliquez sur **Mettre à jour les inscriptions** pour importer les derniers fichiers
- Ou cliquez sur **Continuer sans mise à jour** si les données sont à jour

### Étape 2 : Sélection du tournoi

**Tournois à venir** :
- L'application affiche automatiquement les tournois prévus dans les 2 prochaines semaines
- Cliquez sur un tournoi pour pré-remplir automatiquement les sélections
- Les **finales** sont affichées séparément avec un badge doré "Finale"

**Sélection manuelle** :
1. Choisissez la **Catégorie** (ex: LIBRE - REGIONALE 3)
2. Vérifiez la **Saison** (pré-sélectionnée)
3. Sélectionnez le **Tournoi** (1, 2, 3 ou Finale)
4. Cliquez sur **Charger les joueurs**

### Étape 3 : Sélection des joueurs

L'écran affiche un résumé en temps réel :
- **Joueurs sélectionnés** : Nombre de joueurs cochés
- **Configuration des poules** : Distribution automatique (ex: "5 poules de 3 et 1 poule de 4")
- **Tables nécessaires** : Nombre de tables pour le tournoi

**Pour un tournoi classique (T1, T2, T3)** :

L'écran affiche 3 sections :

**Joueurs classés** :
- Liste des joueurs du classement actuel
- Marqués "Inscrit" (vert) ou "Forfait" (rouge)
- Les inscrits sont pré-sélectionnés automatiquement

**Nouveaux joueurs** :
- Joueurs inscrits mais non présents au classement
- Marqués "Nouveau" (orange)
- Tous pré-sélectionnés automatiquement

**Ajout last minute** :
- Recherchez un joueur par nom ou licence
- Ajoutez-le manuellement si absent des inscriptions

**Pour une Finale** :

- L'application charge automatiquement les **4 ou 6 meilleurs joueurs** du classement général
- La règle est : 6 finalistes si 10+ participants dans la catégorie, sinon 4 finalistes
- Les joueurs sont marqués "Finaliste" (badge doré)
- La configuration affiche "1 poule unique (tous contre tous)"

**Actions rapides** :
- **Tout sélectionner** : Sélectionne tous les joueurs
- **Tout désélectionner** : Désélectionne tous les joueurs
- **Sélectionner les inscrits** : Sélectionne uniquement les joueurs inscrits

### Étape 4 : Validation et aperçu des poules

Cliquez sur **Valider la liste** pour passer à l'aperçu.

**Résumé du tournoi** :
- Catégorie, numéro de tournoi, date, lieu
- Nombre de joueurs et configuration

**Aperçu des poules** :
- Distribution serpentine automatique (les joueurs sont répartis selon leur classement)
- Possibilité de **déplacer un joueur** entre poules (cliquer sur le joueur, puis sur la poule cible)
- Chaque joueur affiche son classement (rang dans la catégorie)

**Pour une Finale** : Une seule poule "POULE UNIQUE" est générée avec tous les finalistes.

**Configuration du lieu** :
1. Sélectionnez le **Lieu principal** (club) dans la liste déroulante
2. Choisissez l'**Heure de début**
3. Optionnel : Cliquez sur **+ Ajouter un second lieu** pour un tournoi split

**Attribution des lieux par poule** (si 2 lieux) :
- Chaque poule peut être assignée à Lieu 1 ou Lieu 2
- Utile pour les tournois split sur 2 clubs

### Étape 5 : Génération des documents

**Fichier Excel** :
Cliquez sur **Générer le fichier Excel** pour télécharger un fichier contenant 3 feuilles :
1. **Poules** : Composition des poules avec planning des matchs
2. **Convocation** : Format classique
3. **Convocation v2** : Format moderne avec mise en page professionnelle

**Convocations PDF individuelles** :
Cliquez sur **Générer les PDFs** pour créer un fichier ZIP contenant une convocation PDF par joueur.

Chaque PDF contient :
- En-tête avec logo CDBHS
- Informations du tournoi (catégorie, date, lieu)
- Composition de la poule du joueur (avec tous les adversaires)
- Adresse complète du lieu avec code QR Google Maps
- Horaire de convocation

**Pour une Finale** : Les PDFs ont un en-tête doré et le titre "CONVOCATION FINALE DÉPARTEMENTALE".

---

## 5. Envoi des convocations par email

### Accès
Depuis l'étape 4 de génération des poules, cliquez sur **Envoyer les convocations par email**

### Pré-requis
- Les joueurs doivent avoir une adresse email valide dans leurs coordonnées
- Synchronisez d'abord les contacts via **Emailing** > **Synchroniser les contacts IONOS**

### Processus d'envoi

**Étape 1 : Préparation**
1. Vérifiez la liste des destinataires affichée
2. Les joueurs sans email sont marqués et seront ignorés
3. Le nombre d'emails à envoyer est indiqué

**Étape 2 : Personnalisation du message**
1. Saisissez un **message d'introduction** personnalisé (optionnel)
2. Vous pouvez utiliser des variables :
   - `{first_name}` : Prénom du joueur
   - `{last_name}` : Nom du joueur
   - `{tournament_name}` : Nom du tournoi
   - `{tournament_date}` : Date du tournoi

**Étape 3 : Email en copie (CC)**
1. Cochez **Envoyer une copie récapitulative**
2. Saisissez l'adresse email (ex: votre email pour suivi)
3. Vous recevrez un récapitulatif avec la liste de tous les envois

**Étape 4 : Test avant envoi**
1. Cochez **Mode test**
2. Saisissez votre adresse email
3. Cliquez sur **Envoyer (test)** pour recevoir un exemple
4. Vérifiez le rendu de l'email

**Étape 5 : Envoi définitif**
1. Décochez le mode test
2. Cliquez sur **Envoyer les convocations**
3. Une barre de progression s'affiche
4. Un message confirme le nombre d'emails envoyés

### Contenu de l'email de convocation

Chaque joueur reçoit un email contenant :
- Objet : "Convocation - [Catégorie] - Tournoi N°[X] - [Date]"
- En-tête avec logo CDBHS
- Message d'introduction personnalisé
- **Tableau de la poule** avec tous les joueurs et leur classement
- **Informations pratiques** : Date, heure, lieu
- **Adresse complète** du club
- Pièce jointe : **PDF de convocation individuelle**

---

## 6. Classements

### Accès
Menu principal > **Classements**

### Fonctionnalités
- Filtrage par **Catégorie** et **Saison**
- Affichage du **podium** (Or, Argent, Bronze)
- Détails par joueur :
  - Total points de match
  - Moyenne des moyennes
  - Meilleure série
  - Points par tournoi
- **Export Excel** du classement

### Calcul du classement
- Points de match additionnés sur la saison
- Départage par : Moyenne > Meilleure série

---

## 7. Tournois joués et envoi des résultats

### Accès
Menu principal > **Tournois joués**

### Consultation des résultats
- Liste de tous les tournois importés
- Filtrage par catégorie et saison
- Visualisation des résultats avec podium
- Suppression de tournoi (recalcule le classement)

### Import des résultats
Menu **Fichiers** > **Tournois joués** > **Importer**

1. Préparez le fichier CSV des résultats (export depuis le logiciel de gestion de tournoi)
2. Sélectionnez la **Catégorie**
3. Indiquez le **Numéro de tournoi**
4. Saisissez la **Date du tournoi**
5. Uploadez le fichier
6. Validez après vérification

### Envoi des résultats par email

**Accès** : Sur la page d'un tournoi, cliquez sur **Envoyer les résultats**

**Contenu de l'email** :

Chaque participant reçoit :
- **Tableau des résultats du tournoi** avec sa ligne en surbrillance
- **Classement général** mis à jour avec sa position en surbrillance
- **Message de qualification** indiquant s'il est éligible pour la finale :
  - Après T1/T2 : "Vous êtes à ce stade éligible pour la finale" (provisoire)
  - Après T3 : "Félicitations ! Vous êtes sélectionné pour la finale" (définitif)

**Format des noms** : Les noms sont affichés au format "Prénom Nom" dans les deux tableaux.

**Procédure d'envoi** :
1. Saisissez un message d'introduction personnalisé
2. Ajoutez une adresse CC pour recevoir le récapitulatif
3. Testez d'abord en mode test
4. Envoyez à tous les participants

---

## 8. Gestion des joueurs

### Accès
Menu **Fichiers** > **Joueurs**

### Fonctionnalités
- Liste de tous les joueurs
- Filtrage par club, statut actif/inactif
- Modification des informations :
  - Nom, prénom
  - Club
  - Classements (Libre, Cadre, Bande, 3 Bandes)
- Historique des performances par joueur
- Import CSV de la liste FFB

### Contacts joueurs
Menu **Emailing** > **Contacts**

- Liste des coordonnées (email, téléphone)
- Synchronisation avec les données IONOS
- Modification manuelle des contacts

---

## 9. Gestion des clubs

### Accès
Menu **Fichiers** > **Clubs**

### Informations gérées
- Nom du club
- Adresse complète (rue, code postal, ville)
- Téléphone
- Email
- Logo

Ces informations sont utilisées dans les convocations générées (adresse affichée avec QR code).

---

## 10. Paramètres

### Accès
Menu **Paramètres** > **Configuration**

### Gestion des utilisateurs
- Création de nouveaux comptes
- Attribution des rôles (Admin/Viewer)
- Désactivation de comptes
- Changement de mot de passe

### Gestion des catégories
Menu **Paramètres** > **Catégories**
- Création/modification des catégories (Mode, Niveau)
- Activation/désactivation par saison

### Calendrier
Menu **Paramètres** > **Calendrier**
- Upload du calendrier de saison (PDF ou Excel)
- Consultation et téléchargement

---

## Annexe A : Format des fichiers CSV

### Joueurs (export FFB)
```csv
licence,club,first_name,last_name,rank_libre,rank_cadre,rank_bande,rank_3bandes
123456,BILLARD CLUB PARIS,Jean,DUPONT,R3,NC,NC,R2
```

### Résultats tournoi
```csv
Classement;Licence;Joueur;Points;Reprises;Moyenne;Série
1;123456;DUPONT Jean;8;45;1.234;12
2;789012;MARTIN Pierre;6;52;0.987;8
```

---

## Annexe B : Workflow complet d'un tournoi

### Avant le tournoi (J-7 à J-2)
1. **Importer les inscriptions** depuis IONOS (Fichiers > Compétitions & Inscriptions)
2. **Générer les poules** (Compétitions à jouer)
3. **Vérifier la composition** et ajuster si nécessaire
4. **Envoyer les convocations** par email

### Le jour du tournoi
1. Imprimer les feuilles de poules (fichier Excel)
2. Gérer les absences/remplacements de dernière minute

### Après le tournoi
1. **Importer les résultats** CSV (Fichiers > Tournois joués)
2. **Vérifier le classement** mis à jour (Classements)
3. **Envoyer les résultats** par email aux participants

### Fin de saison (après T3)
1. **Préparer la finale** : Sélectionner la finale depuis "Compétitions à jouer"
2. Les 4 ou 6 finalistes sont automatiquement chargés
3. **Envoyer les convocations finale** (en-tête doré, poule unique)

---

## Support

- **Repository** : https://github.com/Jeff92400/cdbhs-tournament-management
- **Hébergement** : Railway

---

*Guide utilisateur - CDBHS Tournois v2.0*
*Mis à jour le 10 décembre 2025*
