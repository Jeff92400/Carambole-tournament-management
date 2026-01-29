# Guide Utilisateur Complet - Application de Gestion des Tournois de Billard Français

---

## PRÉSENTATION GÉNÉRALE

### Qu'est-ce que cette application ?

Cette application permet à un Comité Départemental de Billard de gérer l'intégralité de ses compétitions de billard français (carambole). Elle couvre :

- La gestion des joueurs licenciés
- Les inscriptions aux compétitions
- La génération des poules et l'envoi des convocations
- La gestion des forfaits
- L'import des résultats et le calcul des classements
- La communication avec les joueurs (emails, annonces)

### Lien avec l'Application Joueur (Espace Joueur)

L'application fonctionne en tandem avec une **Application Joueur** destinée aux licenciés. Cette application permet aux joueurs de :
- S'inscrire eux-mêmes aux compétitions
- Consulter leurs convocations et la composition des poules
- Voir le calendrier des compétitions
- Recevoir les annonces du comité

**Important** : Les données sont partagées entre les deux applications. Quand un joueur s'inscrit via l'Application Joueur, son inscription apparaît automatiquement dans l'application de gestion.

### Structure d'une saison

- Une saison va de septembre à août (ex: "2025-2026")
- 4 modes de jeu : Libre, Cadre, Bande, 3 Bandes
- Plusieurs niveaux par mode : N1, N2, N3 (national), R1, R2, R3, R4 (régional)
- Pour chaque catégorie (mode + niveau) : Tournoi 1, Tournoi 2, Tournoi 3, puis Finale Départementale

---

## PAGE DE CONNEXION

### Accès
Page d'accueil de l'application (avant authentification)

### Éléments affichés
- Logo de l'organisation
- Champ "Nom d'utilisateur"
- Champ "Mot de passe"
- Bouton "Se connecter"
- Lien "Mot de passe oublié ?"
- Numéro de version de l'application

### Actions utilisateur
1. Saisir le nom d'utilisateur
2. Saisir le mot de passe
3. Cliquer sur "Se connecter"

### Mot de passe oublié
1. Cliquer sur "Mot de passe oublié ?"
2. Saisir l'adresse email associée au compte
3. Recevoir un code à 6 chiffres par email
4. Saisir le code et définir un nouveau mot de passe

---

## MENU : ACCUEIL (Dashboard)

### Accès
Cliquer sur "Accueil" dans la barre de navigation (ou automatiquement après connexion)

### Description
Page d'accueil présentant une vue d'ensemble de l'activité du comité.

### Sections affichées

#### Statistiques générales
- **Joueurs actifs** : Nombre de licenciés dans la base
- **Inscriptions saison** : Total des inscriptions pour la saison en cours
- **Compétitions à venir** : Nombre de tournois planifiés

#### Alertes
Liste des actions urgentes à effectuer :
- Compétitions proches sans convocations envoyées
- Tournois avec peu d'inscrits

#### Compétitions à venir
Cartes cliquables affichant les prochains tournois avec :
- Mode de jeu et niveau
- Date et lieu
- Nombre d'inscrits
- Possibilité de cliquer pour accéder directement à la génération des poules

#### Raccourcis rapides
Boutons d'accès direct aux fonctions les plus utilisées

### Lien avec l'Application Joueur
Le compteur "Inscriptions saison" inclut toutes les inscriptions, y compris celles faites par les joueurs via l'Application Joueur.

---

## MENU : CLASSEMENTS

### Accès
Cliquer sur "Classements" dans la barre de navigation

### Description
Consultation et export des classements saison par catégorie.

### Filtres disponibles
- **Saison** : Sélectionner la saison (ex: 2025-2026)
- **Mode de jeu** : Libre, Cadre, Bande, 3 Bandes
- **Classement FFB** : N1, N2, N3, R1, R2, R3, R4

### Informations affichées dans le tableau

| Colonne | Description |
|---------|-------------|
| Position | Rang du joueur dans le classement |
| Licence | Numéro de licence FFB |
| Joueur | Nom et prénom |
| Club | Club du joueur (avec logo si disponible) |
| T1 | Points de match du Tournoi 1 |
| T2 | Points de match du Tournoi 2 |
| T3 | Points de match du Tournoi 3 |
| Total Pts Match | Somme des points de match |
| Total Points | Points cumulés (caramboles) |
| Total Reprises | Nombre total de reprises jouées |
| Moyenne | Moyenne générale (points/reprises) |
| Meilleure Série | Meilleure série réalisée sur la saison |

### Mise en évidence des qualifiés
- Les joueurs qualifiés pour la finale sont affichés sur fond vert
- Indication du nombre de qualifiés : "6 premiers qualifiés pour la finale (21 joueurs classés)"

### Règle de qualification
- Moins de 9 participants sur la saison → 4 qualifiés pour la finale
- 9 participants ou plus → 6 qualifiés pour la finale

### Légende
- `*` indique une non-participation au tournoi concerné
- `-` indique que le tournoi n'a pas encore eu lieu

### Boutons d'action
- **Exporter en Excel** : Télécharge le classement au format Excel avec mise en forme
- **Recalculer** : Force le recalcul du classement (utile après modification de résultats)

### Lien avec l'Application Joueur
Les joueurs peuvent consulter les classements dans l'Application Joueur (consultation seule).

---

## MENU : COMPÉTITIONS

### Accès
Cliquer sur "Compétitions" dans la barre de navigation

### Sous-menus disponibles
- Générer les poules / Convocations
- Résultats des tournois
- Liste des tournois

---

### COMPÉTITIONS > Générer les poules / Convocations

#### Description
Fonction principale pour préparer un tournoi : sélection des joueurs, génération des poules, envoi des convocations.

#### Étape 1 : Sélection du tournoi

**Filtres à renseigner :**
- Mode de jeu (Libre, Cadre, Bande, 3 Bandes)
- Niveau (N1, N2, N3, R1, R2, R3, R4)
- Saison
- Tournoi (1, 2, 3 ou Finale)

**Action** : Cliquer sur "Charger les joueurs"

**Alternative** : Cliquer directement sur une carte de compétition à venir affichée en haut de page.

**Informations affichées après chargement :**
- Nom de la compétition
- Date et lieu
- Nombre de joueurs inscrits

#### Étape 2 : Sélection des joueurs

**Liste des joueurs affichés :**
- Joueurs classés (issus du classement de la saison)
- Nouveaux joueurs (inscrits mais pas encore classés)

**Pour chaque joueur :**
- Case à cocher pour la sélection
- Position au classement
- Nom et prénom
- Club
- Licence
- Badge de statut (Inscrit, Forfait, Désinscrit)

**Codes couleur :**
- Vert : Joueur inscrit
- Jaune : Joueur forfait (non sélectionnable)
- Gris barré : Joueur désinscrit

**Boutons d'action :**
- **Sélectionner les inscrits** : Coche uniquement les joueurs ayant une inscription
- **Tout sélectionner** / **Tout désélectionner**
- **Ajouter un joueur** : Permet d'ajouter manuellement un joueur non inscrit
- **Gérer les forfaits** : Ouvre la fenêtre de gestion des forfaits

**Action** : Cliquer sur "Générer les poules"

#### Étape 3 : Prévisualisation des poules

**Affichage :**
- Poules générées automatiquement avec répartition équilibrée
- Pour chaque poule : liste des joueurs avec leur club
- Planning des matchs avec horaires

**Possibilités de modification :**
- Glisser-déposer un joueur d'une poule à l'autre
- Boutons pour déplacer un joueur

**Boutons d'action :**
- **Modifier la liste** : Revenir à l'étape 2
- **Générer le fichier Excel** : Télécharge un fichier Excel avec les poules et planning
- **Envoyer les convocations** : Passe à l'étape 4

#### Étape 4 : Envoi des convocations

**Prévisualisation de l'email :**
- Aperçu de l'email tel qu'il sera reçu par les joueurs
- En-tête avec logo et nom de l'organisation
- Informations du tournoi (date, lieu, heure)
- Composition de la poule du joueur
- Planning des matchs

**Option Mode Test :**
- Cocher "Mode Test - Envoyer uniquement à mon adresse"
- Saisir une adresse email de test
- Cliquer sur "Envoyer le Test" pour vérifier le rendu

**Envoi réel :**
- Cliquer sur "Envoyer les convocations"
- Confirmation du nombre d'emails envoyés

**Ce qui se passe après l'envoi :**
- Chaque joueur reçoit un email personnalisé
- Un PDF récapitulatif est joint à l'email
- Les poules sont enregistrées en base de données
- Le statut des joueurs passe à "Convoqué"

**Lien avec l'Application Joueur :**
Après l'envoi des convocations, les joueurs peuvent voir :
- Leur convocation dans l'Application Joueur
- La composition complète de toutes les poules du tournoi
- Le planning des matchs

---

### COMPÉTITIONS > Gestion des forfaits

#### Accès
Bouton "Gérer les forfaits" sur la page Générer poules (après avoir chargé les joueurs)

#### Description
Permet de gérer les joueurs qui déclarent forfait après avoir reçu leur convocation.

#### Fenêtre de gestion des forfaits

**Liste des joueurs convoqués :**
- Case à cocher pour marquer comme forfait
- Nom, club, licence du joueur

**Section "Joueurs forfait" :**
- Liste des joueurs déjà marqués forfait
- Bouton "Réintégrer" pour annuler un forfait

#### Processus complet de gestion d'un forfait

1. **Marquer le forfait :**
   - Cocher le(s) joueur(s) déclarant forfait
   - Cliquer sur "Enregistrer les forfaits"

2. **Ajouter un remplaçant (optionnel) :**
   - Cliquer sur "Ajouter un remplaçant"
   - Rechercher et sélectionner un joueur
   - Confirmer l'ajout

3. **Régénérer les poules :**
   - Cliquer sur "Prévisualiser les nouvelles poules"
   - Vérifier la nouvelle composition
   - Les poules sont recalculées sans les forfaits

4. **Envoyer les nouvelles convocations :**
   - Cliquer sur "Envoyer les nouvelles convocations"
   - Seuls les joueurs impactés par les changements reçoivent un nouvel email

#### Réintégrer un joueur (annuler un forfait)
1. Dans la section "Joueurs forfait"
2. Cliquer sur "Réintégrer" à côté du joueur
3. Le joueur revient dans la liste des convoqués avec le statut "Convoqué"

---

### COMPÉTITIONS > Résultats des tournois

#### Accès
Menu Compétitions > Résultats

#### Description
Import des résultats des tournois terminés pour mise à jour des classements.

#### Processus d'import

1. **Sélectionner le tournoi :**
   - Choisir la catégorie (mode + niveau)
   - Choisir le numéro de tournoi (1, 2 ou 3)
   - Choisir la saison

2. **Préparer le fichier CSV :**
   - Format : séparateur point-virgule (;)
   - Colonnes attendues : Licence, Classement, Points, Reprises, Moyenne, Série

3. **Importer :**
   - Cliquer sur "Choisir un fichier"
   - Sélectionner le fichier CSV
   - Cliquer sur "Importer"

4. **Vérification :**
   - Les résultats importés sont affichés
   - Le classement saison est automatiquement recalculé

#### Données importées par joueur
- Position finale dans le tournoi
- Points de match (selon le classement)
- Total de points (caramboles)
- Nombre de reprises
- Moyenne générale
- Meilleure série

---

### COMPÉTITIONS > Liste des tournois

#### Accès
Menu Compétitions > Liste des tournois

#### Description
Vue d'ensemble de tous les tournois internes (T1, T2, T3, Finale) avec leurs résultats.

#### Filtres
- Par saison
- Par mode de jeu
- Par niveau

#### Informations affichées
- Catégorie
- Numéro de tournoi
- Date
- Nombre de participants
- Statut (Planifié, Terminé)

---

## MENU : CALENDRIER

### Accès
Cliquer sur "Calendrier" dans la barre de navigation

### Description
Gestion du calendrier des compétitions (tournois externes définis dans le système d'inscription).

### Vue calendrier
- Affichage par mois
- Navigation mois précédent / mois suivant
- Code couleur par mode de jeu
- Clic sur une compétition pour voir les détails

### Créer une compétition

1. Cliquer sur "Ajouter une compétition"
2. Renseigner :
   - Mode de jeu
   - Niveau (catégorie)
   - Nom du tournoi (ex: "Tournoi 1", "Finale Départementale")
   - Date de début
   - Lieu
3. Cliquer sur "Enregistrer"

### Modifier une compétition
1. Cliquer sur la compétition dans le calendrier
2. Modifier les informations
3. Enregistrer

### Annuler une compétition
1. Cliquer sur la compétition
2. Cliquer sur "Annuler"
3. Confirmer (les joueurs ne sont PAS notifiés automatiquement)

### Lien avec l'Application Joueur
- Le calendrier est visible par les joueurs dans l'Application Joueur
- Les joueurs peuvent s'inscrire directement aux compétitions à venir depuis leur application
- Les inscriptions apparaissent automatiquement dans l'application de gestion

---

## MENU : COM JOUEURS (Communication Joueurs)

### Accès
Cliquer sur "Com joueurs" dans la barre de navigation

### Sous-menus / Onglets disponibles
- Annonces
- Composer un email
- Historique
- Invitations Espace Joueur

---

### COM JOUEURS > Onglet "Annonces"

#### Description
Publication d'annonces visibles dans l'Application Joueur.

#### Créer une annonce

**Champs à remplir :**
- **Titre** : Titre de l'annonce
- **Message** : Contenu de l'annonce
- **Type** :
  - INFO : Information générale
  - ALERTE : Message important (fond rouge)
  - RESULTATS : Résultats de compétition
  - PERSO : Message personnel ciblé

**Options avancées :**
- **Date d'expiration** : L'annonce disparaît automatiquement après cette date
- **Mode Test** : Envoie l'annonce uniquement à une licence spécifique pour test
- **Destinataire** :
  - Tous les joueurs
  - Un joueur spécifique (saisir la licence)

**Action** : Cliquer sur "Publier l'annonce"

#### Gérer les annonces existantes

**Liste affichée :**
- Type (badge coloré)
- Titre
- Statut (Active, Inactive, Expirée)
- Badge licence si annonce ciblée
- Date de création
- Date d'expiration

**Actions par annonce :**
- **Activer / Désactiver** : Rend visible ou masque l'annonce
- **Supprimer** : Supprime définitivement l'annonce

#### Purger les annonces

**Accès** : Section pliable "Purger les annonces"

**Critères de purge :**
- **Toutes les expirées** : Supprime les annonces dont la date d'expiration est passée
- **Toutes les inactives** : Supprime les annonces désactivées manuellement
- **Inactives + Expirées** : Supprime les deux catégories
- **Par période** : Supprime les annonces créées entre deux dates

**Action** : Sélectionner le critère, puis cliquer sur "Purger" (confirmation demandée)

#### Lien avec l'Application Joueur
- Les annonces actives et non expirées apparaissent dans l'Application Joueur
- Les annonces PERSO n'apparaissent que pour le joueur ciblé
- Les annonces de type ALERTE sont mises en évidence

---

### COM JOUEURS > Onglet "Composer un email"

#### Description
Envoi d'emails de masse à un groupe de joueurs.

#### Étape 1 : Sélectionner les destinataires

**Filtres disponibles :**
- **Actifs seulement** : Exclut les joueurs inactifs
- **Utilisateurs Espace Joueur** : Uniquement ceux ayant créé un compte
- **Par club** : Sélectionner un club spécifique
- **Par mode de jeu** : Libre, Cadre, Bande, 3 Bandes
- **Par classement FFB** : Filtrer par niveau
- **Par tournoi** : Joueurs inscrits à un tournoi spécifique
- **Par classement saison** : Joueurs présents dans un classement

**Liste des joueurs :**
- Affichage avec nom, club, email
- Cases à cocher pour sélection individuelle
- Compteur de joueurs sélectionnés

**Actions :**
- Cocher/décocher individuellement
- "Tout sélectionner" / "Tout désélectionner"

#### Étape 2 : Composer le message

**Champs :**
- **Objet** : Sujet de l'email
- **Corps du message** : Éditeur riche avec mise en forme (gras, italique, listes, liens)

**Variables disponibles :**
- `{player_name}` : Nom complet du joueur
- `{first_name}` : Prénom
- `{last_name}` : Nom
- `{club}` : Club du joueur
- `{category}` : Catégorie (si applicable)

#### Étape 3 : Mode test (recommandé)

1. Cocher "Mode Test"
2. Saisir une adresse email de test
3. Cliquer sur "Envoyer le test"
4. Vérifier le rendu de l'email reçu

#### Étape 4 : Envoi

1. Vérifier le nombre de destinataires
2. Cliquer sur "Envoyer"
3. Confirmer l'envoi
4. Message de confirmation avec le nombre d'emails envoyés

---

### COM JOUEURS > Onglet "Historique"

#### Description
Historique des emails envoyés.

#### Informations affichées
- Date d'envoi
- Objet de l'email
- Nombre de destinataires
- Statut (Envoyé, En cours, Erreur)

---

### COM JOUEURS > Invitations Espace Joueur

#### Description
Gestion des invitations envoyées aux joueurs pour créer leur compte sur l'Application Joueur.

#### Onglet "Envoyer des invitations"

**Objectif** : Inviter des joueurs à rejoindre l'Application Joueur

**Filtres :**
- Par club
- Joueurs ayant un email
- Joueurs non encore invités

**Liste des joueurs éligibles :**
- Nom, club, email
- Cases à cocher pour sélection

**Options :**
- Mode test : Envoyer uniquement à une adresse test

**Action** : Cliquer sur "Envoyer les invitations"

**L'email d'invitation contient :**
- Présentation de l'Application Joueur
- Instructions pour créer un compte
- Guide PDF en pièce jointe (si configuré)

#### Onglet "Suivi des invitations"

**Filtres :**
- Par club
- Par statut (Tous, Inscrits, En attente)
- Recherche par nom

**Bouton "Synchroniser statuts"** : Met à jour le statut des invitations en vérifiant qui a créé son compte

**Tableau affiché :**

| Colonne | Description |
|---------|-------------|
| Case à cocher | Pour sélection multiple (En attente uniquement) |
| Nom | Nom et prénom + licence |
| Club | Club du joueur |
| Email | Adresse email |
| Date d'envoi | Date de l'invitation initiale |
| Envois | Nombre total d'envois (initial + rappels) |
| Envoyé par | Utilisateur ayant envoyé |
| Statut | "En attente" ou "Inscrit" |
| Actions | Bouton "Renvoyer" (si En attente), "Supprimer" |

**Actions en lot :**
- Cocher plusieurs joueurs "En attente"
- Cliquer sur "Renvoyer la sélection" pour envoyer un rappel à tous
- "Sélectionner tous les En attente" : sélection rapide

**Renvoyer individuellement :**
- Cliquer sur "Renvoyer" à côté d'un joueur
- Un email de rappel est envoyé (avec préfixe "Rappel amical")

#### Onglet "Paramètres"

**Template de l'email :**
- Modifier le sujet de l'email d'invitation
- Modifier le corps du message (éditeur riche)
- Variables disponibles : `{first_name}`, `{organization_name}`, `{organization_short_name}`, `{organization_email}`

**Guide PDF :**
- Affiche le PDF actuellement configuré
- Bouton pour télécharger un nouveau PDF
- Ce PDF est joint automatiquement à chaque invitation

#### Lien avec l'Application Joueur
- Quand un joueur crée son compte sur l'Application Joueur, son statut passe automatiquement de "En attente" à "Inscrit"
- Le bouton "Synchroniser statuts" force cette vérification

---

## MENU : PARAMÈTRES

### Accès
Cliquer sur "Paramètres" dans la barre de navigation

### Sous-sections disponibles
- Paramètres de l'organisation
- Gestion des utilisateurs
- Paramètres des compétitions
- Gestion des clubs
- Données de référence

---

### PARAMÈTRES > Organisation

#### Description
Configuration des informations générales de l'organisation.

#### Champs configurables

| Paramètre | Description |
|-----------|-------------|
| Nom de l'organisation | Nom complet (ex: "Comité Départemental de Billard des Hauts-de-Seine") |
| Sigle | Nom court (ex: "CDBHS") |
| Logo | Image affichée dans les emails et documents |
| Email de communication | Adresse d'expédition des emails |
| Email de notification | Adresse recevant les notifications système |
| Nom de l'expéditeur | Nom affiché comme expéditeur des emails |

#### Personnalisation visuelle

| Paramètre | Description |
|-----------|-------------|
| Couleur principale | Couleur des en-têtes, boutons, liens |
| Couleur secondaire | Couleur des dégradés, survols |
| Couleur d'accent | Couleur des alertes, badges |

**Action** : Modifier les valeurs puis cliquer sur "Enregistrer"

---

### PARAMÈTRES > Utilisateurs

#### Description
Gestion des comptes ayant accès à l'application.

#### Rôles disponibles

| Rôle | Permissions |
|------|------------|
| Admin | Accès complet, peut créer d'autres utilisateurs |
| Éditeur | Peut gérer compétitions, inscriptions, communications |
| Lecteur | Consultation seule |

#### Créer un utilisateur
1. Cliquer sur "Ajouter un utilisateur"
2. Saisir : nom d'utilisateur, email, mot de passe temporaire
3. Sélectionner le rôle
4. Cliquer sur "Créer"

#### Actions sur un utilisateur existant
- **Modifier le rôle** : Changer les permissions
- **Réinitialiser le mot de passe** : Envoie un email de réinitialisation
- **Désactiver** : Bloque l'accès sans supprimer le compte

---

### PARAMÈTRES > Compétitions

#### Description
Configuration des paramètres de jeu par catégorie.

#### Paramètres par catégorie

| Paramètre | Description |
|-----------|-------------|
| Distance | Nombre de points à atteindre |
| Reprises max | Nombre maximum de reprises |
| Joueurs par poule | Nombre de joueurs dans chaque poule |

---

### PARAMÈTRES > Clubs

#### Description
Gestion de la liste des clubs du département.

#### Actions disponibles
- **Ajouter un club** : Nom, ville, logo
- **Modifier un club** : Mettre à jour les informations
- **Télécharger un logo** : Image affichée dans les classements et documents
- **Supprimer un club** : Retirer de la liste

#### Utilisation des logos
Les logos des clubs apparaissent dans :
- Les classements (tableau et export Excel)
- Les convocations

---

### PARAMÈTRES > Données de référence

#### Description
Gestion des données de base du système.

#### Modes de jeu
- Liste des disciplines : Libre, Cadre, Bande, 3 Bandes
- Possibilité de renommer ou réordonner

#### Classements FFB
- Liste des niveaux : N1, N2, N3, R1, R2, R3, R4
- Ordre hiérarchique (N1 = plus haut niveau)

#### Catégories
- Combinaisons mode + niveau
- Nom d'affichage personnalisable (ex: "Libre R2", "3 Bandes N3")

---

## LISTE DES INSCRIPTIONS

### Accès
Via le menu ou depuis le dashboard

### Description
Vue complète de toutes les inscriptions aux compétitions.

### Filtres disponibles
- **Saison** : Sélectionner la saison
- **Mode de jeu** : Filtrer par discipline
- **Niveau** : Filtrer par classement
- **Statut** : Inscrit, Convoqué, Forfait, Désinscrit
- **Recherche** : Par nom ou licence

### Tableau affiché

| Colonne | Description |
|---------|-------------|
| Joueur | Nom, prénom, licence |
| Club | Club du joueur |
| Email | Adresse email |
| Téléphone | Numéro de téléphone |
| Compétition | Mode + niveau + numéro tournoi |
| Source | player_app / manual / ionos |
| Statut | Inscrit / Convoqué / Forfait / Désinscrit |
| Actions | Modifier / Supprimer |

### Sources d'inscription
- **player_app** : Le joueur s'est inscrit via l'Application Joueur
- **manual** : Un administrateur a ajouté l'inscription manuellement
- **ionos** : Import CSV (ancien système)

### Ajouter une inscription manuellement
1. Cliquer sur "Ajouter"
2. Sélectionner le tournoi
3. Rechercher le joueur
4. Vérifier/compléter email et téléphone
5. Cliquer sur "Enregistrer"

### Modifier une inscription
1. Cliquer sur "Modifier"
2. Changer les informations souhaitées
3. Possibilité de changer le statut
4. Cliquer sur "Enregistrer"

### Lien avec l'Application Joueur
Les inscriptions avec source "player_app" ont été faites par le joueur lui-même. Ces inscriptions ne doivent généralement pas être modifiées manuellement.

---

## FLUX DE TRAVAIL TYPES

### Préparer un tournoi de A à Z

1. **Créer le tournoi** (Menu Calendrier)
   - Définir mode, niveau, date, lieu

2. **Attendre les inscriptions**
   - Les joueurs s'inscrivent via l'Application Joueur
   - Suivre dans la liste des inscriptions

3. **Générer les poules** (Menu Compétitions)
   - Charger le tournoi
   - Vérifier les joueurs sélectionnés
   - Générer les poules

4. **Envoyer les convocations**
   - Prévisualiser l'email
   - Tester si besoin
   - Envoyer à tous les joueurs

5. **Gérer les forfaits** (si nécessaire)
   - Marquer les forfaits
   - Ajouter des remplaçants
   - Renvoyer les convocations modifiées

6. **Après le tournoi**
   - Importer les résultats (CSV)
   - Vérifier le classement mis à jour

---

### Gérer un forfait de dernière minute

1. Menu Compétitions > Générer poules
2. Charger le tournoi concerné
3. Cliquer sur "Gérer les forfaits"
4. Cocher le joueur forfait
5. Cliquer sur "Enregistrer les forfaits"
6. (Optionnel) Cliquer sur "Ajouter un remplaçant"
7. Cliquer sur "Prévisualiser les nouvelles poules"
8. Vérifier la nouvelle composition
9. Cliquer sur "Envoyer les nouvelles convocations"

---

### Inviter les joueurs à l'Espace Joueur

1. Menu Com joueurs > Invitations Espace Joueur
2. Onglet "Paramètres" : Vérifier le template et télécharger le guide PDF
3. Onglet "Envoyer" : Filtrer et sélectionner les joueurs
4. Envoyer les invitations
5. Onglet "Suivi" : Suivre les inscriptions
6. Renvoyer des rappels aux "En attente" (individuellement ou en lot)

---

## GLOSSAIRE

| Terme | Définition |
|-------|------------|
| Catégorie | Combinaison d'un mode de jeu et d'un niveau (ex: "Libre R2", "3 Bandes N3") |
| Convocation | Email envoyé au joueur avec toutes les informations du tournoi et sa poule |
| Forfait | Joueur qui ne peut pas participer après avoir été convoqué |
| Licence FFB | Numéro d'identification unique du joueur à la Fédération Française de Billard |
| Mode de jeu | Discipline de billard : Libre, Cadre, Bande, ou 3 Bandes |
| Niveau | Classification FFB : N1/N2/N3 (national), R1/R2/R3/R4 (régional) |
| Points de match | Points attribués selon le classement final dans un tournoi |
| Poule | Groupe de joueurs s'affrontant lors d'un tournoi |
| Reprise | Unité de jeu au billard (tour de jeu) |
| Saison | Période allant de septembre à août (ex: 2025-2026) |
| Série | Nombre de points consécutifs marqués sans rater |
| Application Joueur / Espace Joueur | Application permettant aux licenciés de s'inscrire et consulter leurs informations |

---

*Document de référence pour l'Application de Gestion des Tournois - Version 2.0*
