# Guide Utilisateur Complet

**Application de Gestion des Tournois de Billard Francais -- Version 2.0.200**

---

## Presentation Generale

### Qu'est-ce que cette application ?

Cette application permet a un Comite Departemental de Billard (CDB) de gerer l'integralite de ses competitions de billard francais (carambole). Elle couvre :

- La gestion des joueurs licencies et leurs classifications FFB
- Les inscriptions aux competitions
- La generation des poules et l'envoi des convocations
- La gestion des forfaits
- L'import des resultats et le calcul des classements
- La communication avec les joueurs (emails, annonces)
- La configuration du bareme de points et des regles de bonus
- Le suivi d'activite (logs)

### Multi-organisation

L'application est concue pour accueillir plusieurs comites (CDB) sur une meme plateforme. Chaque CDB dispose de son propre environnement isole : joueurs, competitions, classements, parametres et personnalisation visuelle (logo, couleurs) sont entierement separes.

### Lien avec l'Application Joueur (Espace Joueur)

L'application fonctionne en tandem avec une **Application Joueur** destinee aux licencies. Cette application permet aux joueurs de :

- S'inscrire eux-memes aux competitions
- Consulter leurs convocations et la composition des poules
- Voir le calendrier des competitions
- Recevoir les annonces du comite

> **Important :** Les donnees sont partagees entre les deux applications. Quand un joueur s'inscrit via l'Application Joueur, son inscription apparait automatiquement dans l'application de gestion.

### Structure d'une saison

- Une saison va de septembre a aout (ex: "2025-2026")
- 4 modes de jeu : Libre, Cadre, Bande, 3 Bandes
- Plusieurs niveaux par mode : N1, N2, N3 (national), R1, R2, R3, R4, R5 (regional), D1, D2, D3 (departemental)
- Pour chaque categorie (mode + niveau) : plusieurs tournois qualificatifs, puis une Finale Departementale

### Modes de qualification

L'application supporte deux modes de qualification pour les finales, configurables par comite :

| Mode | Description |
|------|-------------|
| **3 Tournois Qualificatifs** (standard) | 3 tournois (T1, T2, T3) avec cumul des points de match. Les mieux classes accedent a la Finale. |
| **Journees Qualificatives** | Journees avec poules, classement par points de position. Meme import CSV que le mode standard. Seuls les N meilleurs resultats sur M journees comptent. |

Le mode de qualification se configure dans **Parametres > Types de Tournoi**.

---

## Page de Connexion

### Acces

Page d'accueil de l'application (avant authentification)

### Elements affiches

- Logo de l'organisation
- Champ "Nom d'utilisateur"
- Champ "Mot de passe"
- Bouton "Se connecter"
- Lien "Mot de passe oublie ?"
- Numero de version de l'application

### Actions utilisateur

1. Saisir le nom d'utilisateur
2. Saisir le mot de passe
3. Cliquer sur "Se connecter"

### Mot de passe oublie

1. Cliquer sur "Mot de passe oublie ?"
2. Saisir l'adresse email associee au compte
3. Recevoir un code a 6 chiffres par email
4. Saisir le code et definir un nouveau mot de passe

---

## Bouton d'aide (?)

Sur chaque page de l'application, un bouton rond **?** est affiche en bas a droite de l'ecran. En cliquant dessus, ce guide utilisateur s'ouvre dans un nouvel onglet, directement a la section correspondant a la page sur laquelle vous vous trouvez.

> **Exemple :** si vous etes sur la page "Classements" et que vous cliquez sur **?**, le guide s'ouvrira directement a la section "Classements".

---

## Bouton "Tournois a venir"

Sur chaque page de l'application, un lien **Tournois a venir** est affiche dans la barre de navigation (a gauche du bouton d'aide **?**). En cliquant dessus, une fenetre modale s'ouvre et affiche la liste de tous les tournois a venir (a partir de la date du jour).

### Informations affichees

Le tableau presente pour chaque tournoi :

- **Date** : date de debut du tournoi
- **Nom** : intitule du tournoi
- **Mode** : discipline de jeu
- **Categorie** : niveau de competition
- **Lieu** : club ou salle accueillant le tournoi
- **Inscrits** : nombre de joueurs inscrits (hors forfaits et desinscrits)

> **Astuce :** ce bouton est accessible a tous les utilisateurs (administrateur, editeur, lecteur, club). Il permet de consulter rapidement le calendrier sans quitter la page en cours.

---

## Menu : Accueil (Dashboard)

### Acces

Cliquer sur "Accueil" dans la barre de navigation (ou automatiquement apres connexion)

### Description

Page d'accueil presentant une vue d'ensemble de l'activite du comite.

#### Statistiques generales

- **Joueurs actifs** : Nombre de licencies dans la base
- **Competitions jouees** : Nombre de competitions terminees sur la saison
- **Participants cumules** : Total des participations

#### Inscriptions saison

- **Total** : Nombre total d'inscriptions
- **Convoques** : Joueurs ayant recu leur convocation
- **Forfaits** : Nombre de forfaits declares

#### Competitions saison

- **Total** : Nombre total de competitions planifiees
- **A venir** : Competitions pas encore jouees
- **Passes** : Competitions terminees

#### Alertes

Liste des actions urgentes a effectuer :

- Relances a envoyer (competitions proches avec joueurs non relances)
- Resultats a envoyer apres un tournoi termine

#### Actions rapides

Boutons d'acces direct aux fonctions les plus utilisees :

- Competitions a jouer
- Inscriptions Hors Classement
- Enregistrer une competition
- Competitions jouees
- Voir les Classements
- Vainqueurs Finales

> **Lien avec l'Application Joueur :** Le compteur "Inscriptions saison" inclut toutes les inscriptions, y compris celles faites par les joueurs via l'Application Joueur.

---

## Menu : Classements

### Acces

Cliquer sur "Classements" dans la barre de navigation

### Description

Consultation et export des classements saison par categorie.

### Filtres disponibles

- **Saison** : Selectionner la saison (ex: 2025-2026)
- **Mode de jeu** : Libre, Cadre, Bande, 3 Bandes
- **Classement FFB** : N1, N2, N3, R1, R2, R3, R4, etc.

### Mode Standard (3 Tournois Qualificatifs)

#### Informations affichees dans le tableau

| Colonne | Description |
|---------|-------------|
| Position | Rang du joueur dans le classement |
| Licence | Numero de licence FFB |
| Joueur | Nom et prenom (cliquable -> historique du joueur) |
| Club | Club du joueur (avec logo si disponible) |
| T1 | Points de match du Tournoi 1 |
| T2 | Points de match du Tournoi 2 |
| T3 | Points de match du Tournoi 3 |
| Pts Match | Somme des points de match |
| Bonus | Colonnes de bonus dynamiques (si configurees dans le bareme) |
| Total | Total des points (match + bonus) |
| Total Points | Points cumules (caramboles) |
| Total Reprises | Nombre total de reprises jouees |
| Moyenne | Moyenne generale (points/reprises) |
| Meilleure Serie | Meilleure serie realisee sur la saison |

### Mode Journees Qualificatives

En mode journees, l'affichage du classement est different :

| Colonne | Description |
|---------|-------------|
| Position | Rang du joueur |
| Licence | Numero de licence FFB |
| Joueur | Nom et prenom |
| Club | Club du joueur |
| TQ1 | Points du Tournoi Qualificatif 1 |
| TQ2 | Points du Tournoi Qualificatif 2 |
| TQ3 | Points du Tournoi Qualificatif 3 |
| Bonus Moy. | Bonus moyenne au classement saisonnier -- affiche uniquement si active dans les parametres (mode Journees) |
| Total | Score total (meilleurs resultats + bonus) |
| Moyenne | Moyenne generale |
| Meilleure Serie | Meilleure serie |

> **Scores retenus / ecartes :** En mode journees, seuls les N meilleurs resultats sur M journees comptent. Les scores retenus sont affiches en **gras**, les scores ecartes sont ~~barres~~.

### Mise en evidence des qualifies

- Les joueurs qualifies pour la finale sont affiches sur fond vert
- Indication du nombre de qualifies : "6 premiers qualifies pour la finale (21 joueurs classes)"

### Regle de qualification

- Moins de 9 participants sur la saison -> 4 qualifies pour la finale
- 9 participants ou plus -> 6 qualifies pour la finale

### Legende

- `*` indique que les points de position n'ont pas encore ete attribues pour ce tournoi
- `-` indique que le tournoi n'a pas encore eu lieu

### Historique joueur

Cliquer sur le nom d'un joueur dans le classement pour acceder a sa fiche historique. Cette page affiche :

- Informations du joueur (nom, licence, club, classements par discipline)
- Historique de tous les tournois joues par saison
- Resultats detailles : points de match, moyenne, serie, classement saison

### Boutons d'action

- **Exporter en Excel** : Telecharge le classement au format Excel avec mise en forme
- **Recalculer** : Force le recalcul du classement (utile apres modification de resultats ou changement de mode)

> **Lien avec l'Application Joueur :** Les joueurs peuvent consulter les classements dans l'Application Joueur (consultation seule).

---

## Menu : Competitions

### Acces

Cliquer sur "Competitions" dans la barre de navigation

### Sous-menus disponibles

- Generer les poules / Convocations
- Resultats des tournois
- Resultats Externes (Import)
- Liste des tournois

---

## Competitions > Generer les poules / Convocations

### Description

Fonction principale pour preparer un tournoi : selection des joueurs, generation des poules, envoi des convocations.

#### Etape 1 : Selection du tournoi

**Filtres a renseigner :**

- Mode de jeu (Libre, Cadre, Bande, 3 Bandes)
- Niveau (N1, N2, N3, R1, R2, R3, R4, etc.)
- Saison
- Tournoi (1, 2, 3 ou Finale)

**Action :** Cliquer sur "Charger les joueurs"

**Alternative :** Cliquer directement sur une carte de competition a venir affichee en haut de page.

**Informations affichees apres chargement :**

- Nom de la competition
- Date et lieu (possibilite de double lieu pour les tournois repartis sur 2 salles)
- Nombre de joueurs inscrits

#### Etape 2 : Selection des joueurs

**Pour chaque joueur :**

- Case a cocher pour la selection
- Position au classement
- Nom et prenom
- Club
- Licence
- Badge de statut (Inscrit / Forfait / Desinscrit)

**Boutons d'action :**

- **Selectionner les inscrits** : Coche uniquement les joueurs ayant une inscription
- **Tout selectionner** / **Tout deselectionner**
- **Ajouter un joueur** : Permet d'ajouter manuellement un joueur non inscrit
- **Gerer les forfaits** : Ouvre la fenetre de gestion des forfaits

#### Etape 3 : Previsualisation des poules

Les poules sont generees automatiquement avec repartition equilibree. Pour chaque poule : liste des joueurs avec leur club et planning des matchs avec horaires.

**Parametres de jeu :**

- Distance et Reprises affiches (modifiables si besoin avant envoi)
- Bouton "Valider les parametres" pour confirmer les valeurs de distance/reprises pour ce tournoi

**Possibilites de modification :**

- Glisser-deposer un joueur d'une poule a l'autre
- Boutons pour deplacer un joueur

#### Etape 4 : Envoi des convocations

**Previsualisation de l'email :** apercu de l'email tel qu'il sera recu par les joueurs, avec logo, informations du tournoi, composition de la poule et planning des matchs.

> **Mode Test :** Cocher "Mode Test - Envoyer uniquement a mon adresse", saisir une adresse email de test, puis cliquer sur "Envoyer le Test" pour verifier le rendu avant l'envoi reel.

**Ce qui se passe apres l'envoi :**

- Chaque joueur recoit un email personnalise
- Un PDF recapitulatif est joint a l'email
- Les poules sont enregistrees en base de donnees
- Le statut des joueurs passe a "Convoque"

> **Lien avec l'Application Joueur :** Apres l'envoi des convocations, les joueurs peuvent voir leur convocation, la composition complete de toutes les poules et le planning des matchs dans l'Application Joueur.

---

## Competitions > Gestion des forfaits

### Acces

Bouton "Gerer les forfaits" sur la page Generer poules (apres avoir charge les joueurs)

### Description

Permet de gerer les joueurs qui declarent forfait apres avoir recu leur convocation.

#### Processus complet de gestion d'un forfait

1. **Marquer le forfait :** Cocher le(s) joueur(s) declarant forfait, puis cliquer sur "Enregistrer les forfaits"
2. **Ajouter un remplacant (optionnel) :** Cliquer sur "Ajouter un remplacant", rechercher et selectionner un joueur, confirmer l'ajout
3. **Regenerer les poules :** Cliquer sur "Previsualiser les nouvelles poules" -- les poules sont recalculees sans les forfaits
4. **Envoyer les nouvelles convocations :** Cliquer sur "Envoyer les nouvelles convocations" -- seuls les joueurs impactes recoivent un nouvel email

#### Reintegrer un joueur (annuler un forfait)

1. Dans la section "Joueurs forfait"
2. Cliquer sur "Reintegrer" a cote du joueur
3. Le joueur revient dans la liste des convoques avec le statut "Convoque"

---

## Competitions > Resultats des tournois

### Acces

Menu Competitions > Resultats

### Description

Import des resultats des tournois termines pour mise a jour des classements.

#### Processus d'import

1. **Selectionner le tournoi :** Choisir la categorie (mode + niveau), le numero de tournoi, la saison
2. **Preparer le fichier CSV :** Format separateur point-virgule (;). Colonnes attendues : Licence, Classement, Points, Reprises, Moyenne, Serie
3. **Importer :** Cliquer sur "Choisir un fichier", selectionner le fichier CSV, cliquer sur "Importer"
4. **Verification :** Les resultats importes sont affiches et le classement saison est automatiquement recalcule. Un lien **"Voir le detail du tournoi"** permet d'acceder directement a la page de resultats du tournoi importe (points de match, moyenne, serie, et points de position le cas echeant).

#### Donnees importees par joueur

- Position finale dans le tournoi
- Points de match (selon le bareme configure)
- Total de points (caramboles)
- Nombre de reprises
- Moyenne generale
- Meilleure serie

#### Import en mode Journees Qualificatives

En mode journees, l'import des resultats utilise le **meme fichier CSV unique** que le mode standard. Il n'y a pas de procedure d'import specifique : le processus est identique a celui decrit ci-dessus.

##### Difference avec le mode standard

La seule difference concerne l'attribution automatique des **points de position** :

1. **Importer le fichier CSV :** Meme fichier CSV que pour le mode standard.
2. **Attribution automatique :** A l'enregistrement, le systeme classe les joueurs selon leurs points de match (puis moyenne en cas d'egalite) et attribue automatiquement les points de position correspondants, selon le bareme configure dans **Parametres > Types de Tournoi > Points par position**. Tous les tournois de la categorie sont recalcules a chaque import.
3. **Recalcul des classements :** Les classements de saison sont recalcules automatiquement apres l'import, en retenant les N meilleurs scores de points de position sur M journees.
4. **Consultation du detail :** Apres l'import, cliquer sur **"Voir le detail du tournoi"** pour consulter la page de resultats. En mode journees, une colonne **"Pts Position"** est affichee en plus des colonnes habituelles (points de match, caramboles, reprises, moyenne, serie).

> **Points de position :** Le bareme de points par position est configurable dans Parametres > Types de Tournoi. Par exemple : 1er -> 10 pts, 2e -> 8 pts, 3e -> 6 pts, etc. Ce bareme est applique automatiquement a chaque import de resultats en mode journees. La position est calculee d'apres les points de match (et la moyenne en cas d'egalite). La colonne "Pts Position" apparait automatiquement sur la page de resultats du tournoi.

#### Import des matchs E2i (CSV matchs individuels)

L'onglet **"Import Matchs E2i"** permet d'importer directement les fichiers CSV de matchs individuels exportes depuis **telemat.org / E2i**. Cette methode remplace l'utilisation d'Excel/Power Query pour calculer les resultats.

##### Format attendu

Les fichiers CSV sont au format E2i (separateur point-virgule, 20 colonnes) :

`No Phase;Date match;Billard;Poule;Licence J1;Joueur 1;Pts J1;Rep J1;Ser J1;Pts Match J1;Moy J1;Licence J2;Joueur 2;Pts J2;Rep J2;Ser J2;Pts Match J2;Moy J2;NOMBD;Mode de jeu`

Chaque fichier correspond a une poule ou phase (POULE A, POULE B, DEMI-FINALE, Classement 07-08, etc.).

##### Processus d'import

1. **Selectionner l'onglet "Import Matchs E2i"** sur la page d'import de competition.
2. **Choisir la categorie :** Mode de jeu, classement FFB, numero du tournoi, date.
3. **Ajouter les fichiers CSV :** La page affiche des zones de depot separees par phase : **Poules** (toujours visible), **Demi-finales**, **Finale / Petite Finale** et **Classement** (visibles en mode journees). Deposez chaque fichier CSV dans la zone correspondant a sa phase. Les fichiers selectionnes apparaissent sous chaque zone.
4. **Apercu :** Cliquer sur "Apercu des resultats" pour voir le tableau calcule avant import. Le tableau affiche pour chaque joueur : classement final (CLT), classement poule (Clt poule), parties menees (PM), points, reprises, meilleure serie (MS), moyenne generale (MGP), meilleure partie (MPART), points de match, et si applicable les points de classement et bonus.
5. **Importer :** Cliquer sur "Importer les matchs". Les resultats sont enregistres, les bonus calcules, et les classements de saison recalcules automatiquement.

##### Calculs effectues automatiquement

- **Agregation :** Les matchs individuels sont agreges par joueur (total points, reprises, meilleure serie, moyenne, nombre de matchs joues).
- **Classement par poule :** Les joueurs sont classes au sein de chaque poule par points de match puis moyenne.
- **Classement final :** Si des phases de classement (DEMI-FINALE, FINALE, Classement 07-08) sont presentes, elles determinent le classement final. Sinon, le classement est calcule par interclassement des positions de poule.
- **Meilleure partie (MPART) :** La meilleure moyenne sur un seul match est calculee pour chaque joueur.
- **Points de position :** En mode journees, les points de position sont attribues selon le bareme configure.
- **Bonus et classements :** Tous les bonus (bareme, moyenne) et les classements de saison sont recalcules apres l'import.

##### Detail des matchs

Apres l'import, la page de resultats du tournoi affiche une section repliable **"Detail des matchs"** qui liste tous les matchs individuels par poule, avec les scores de chaque joueur.

> **Degradation du dernier joueur :** En mode journees, une option dans **Parametres > Types de Tournoi > Points par position** permet d'activer la degradation du dernier joueur : le dernier classe recoit les points de la position N+1 (par exemple, s'il y a 10 joueurs, le 10e recoit les points du 11e).

---

## Competitions > Resultats Externes (Import)

### Acces

Menu Competitions > Import Donnees Externes

### Description

Import de donnees externes au format CSV : inscriptions et tournois provenant d'un systeme tiers.

#### Import des inscriptions

1. Glisser-deposer ou cliquer pour selectionner un fichier CSV
2. Colonnes attendues : INSCRIPTION_ID, JOUEUR_ID, TOURNOI_ID, TIMESTAMP, EMAIL, TELEPHONE, LICENCE, CONVOQUE, FORFAIT, COMMENTAIRE
3. Cliquer sur "Importer"
4. Rapport detaille affiche : nombre importe, mis a jour, ignore (deja inscrit via Player App), erreurs

---

## Competitions > Liste des tournois

### Acces

Menu Competitions > Liste des tournois

### Description

Vue d'ensemble de tous les tournois internes (T1, T2, T3, Finale) avec leurs resultats.

### Filtres

- Par saison
- Par mode de jeu
- Par niveau

### Informations affichees

- Categorie
- Numero de tournoi
- Date
- Nombre de participants
- Statut (Planifie, Termine)

---

## Menu : Calendrier

### Acces

Cliquer sur "Calendrier" dans la barre de navigation

### Vue calendrier

- Affichage par mois
- Navigation mois precedent / mois suivant
- Code couleur par mode de jeu
- Clic sur une competition pour voir les details

### Creer une competition

1. Cliquer sur "Ajouter une competition"
2. Renseigner : Mode de jeu, Niveau, Nom du tournoi, Date de debut, Lieu (possibilite de renseigner un 2e lieu pour les tournois repartis sur 2 salles)
3. Cliquer sur "Enregistrer"

### Annuler une competition

1. Cliquer sur la competition
2. Cliquer sur "Annuler"
3. Confirmer (les joueurs ne sont PAS notifies automatiquement)

### Supprimer une competition

Pour supprimer definitivement une competition (et toutes ses inscriptions associees) :

1. Aller dans **Competitions > Liste des tournois externes**
2. Reperer la competition a supprimer dans la liste
3. Cliquer sur le bouton rouge **"Supprimer"** sur la ligne correspondante
4. Confirmer la suppression dans la boite de dialogue

> **Attention :** La suppression est irreversible. Toutes les inscriptions liees a cette competition seront egalement supprimees. Cette action est reservee aux administrateurs.

> **Lien avec l'Application Joueur :** Le calendrier est visible par les joueurs dans l'Application Joueur. Les joueurs peuvent s'inscrire directement aux competitions a venir depuis leur application. Les inscriptions apparaissent automatiquement dans l'application de gestion.

---

## Menu : Com Joueurs (Communication Joueurs)

### Acces

Cliquer sur "Com joueurs" dans la barre de navigation

### Sous-menus / Onglets disponibles

- Annonces
- Composer un email
- Historique
- Invitations Espace Joueur

---

## Com Joueurs > Annonces

### Description

Publication d'annonces visibles dans l'Application Joueur.

#### Creer une annonce

**Champs a remplir :**

- **Titre** : Titre de l'annonce
- **Message** : Contenu de l'annonce
- **Type** : INFO (Information generale), ALERTE (Message important), RESULTATS (Resultats de competition), PERSO (Message personnel cible)

**Options avancees :**

- **Date d'expiration** : L'annonce disparait automatiquement apres cette date
- **Mode Test** : Envoie l'annonce uniquement a une licence specifique pour test
- **Destinataire** : Tous les joueurs ou un joueur specifique (saisir la licence)

#### Gerer les annonces existantes

**Actions par annonce :**

- **Activer / Desactiver** : Rend visible ou masque l'annonce
- **Supprimer** : Supprime definitivement l'annonce

#### Purger les annonces

Section pliable permettant de supprimer en lot les annonces expirees, inactives, ou par periode.

> **Lien avec l'Application Joueur :** Les annonces actives et non expirees apparaissent dans l'Application Joueur. Les annonces PERSO n'apparaissent que pour le joueur cible.

---

## Com Joueurs > Composer un email

### Description

Envoi d'emails de masse a un groupe de joueurs.

#### Etape 1 : Selectionner les destinataires

**Filtres disponibles :**

- **Actifs seulement** : Exclut les joueurs inactifs
- **Utilisateurs Espace Joueur** : Uniquement ceux ayant cree un compte
- **Par club**, **Par mode de jeu**, **Par classement FFB**
- **Par tournoi** : Joueurs inscrits a un tournoi specifique
- **Par classement saison** : Joueurs presents dans un classement

#### Etape 2 : Composer le message

**Champs :** Objet + Corps du message (editeur riche avec mise en forme)

**Variables disponibles :**

| Variable | Description |
|----------|-------------|
| `{player_name}` | Nom complet du joueur |
| `{first_name}` | Prenom |
| `{last_name}` | Nom |
| `{club}` | Club du joueur |
| `{category}` | Categorie (si applicable) |
| `{tournament}` | Numero du tournoi (T1, T2, T3, Finale) |
| `{tournament_date}` | Date du tournoi |
| `{tournament_lieu}` | Lieu du tournoi |
| `{distance}` | Distance de jeu |
| `{reprises}` | Nombre de reprises |
| `{organization_name}` | Nom complet de l'organisation |
| `{organization_short_name}` | Sigle de l'organisation |
| `{organization_email}` | Email de contact de l'organisation |

> **Modeles par defaut :** Pour les relances (T1, T2, T3, Finale), il est possible d'enregistrer le message comme modele par defaut. Ce modele sera pre-rempli automatiquement lors des prochaines relances du meme type.

#### Etape 3 : Mode test (recommande)

1. Cocher "Mode Test"
2. Saisir une adresse email de test
3. Cliquer sur "Envoyer le test"
4. Verifier le rendu de l'email recu

#### Etape 4 : Envoi

1. Verifier le nombre de destinataires
2. Cliquer sur "Envoyer"
3. Confirmer l'envoi
4. Message de confirmation avec le nombre d'emails envoyes

---

## Com Joueurs > Historique

### Description

Historique des emails envoyes.

### Informations affichees

- Date d'envoi
- Objet de l'email
- Nombre de destinataires
- Statut (Envoye, En cours, Erreur)

---

## Com Joueurs > Invitations Espace Joueur

### Description

Gestion des invitations envoyees aux joueurs pour creer leur compte sur l'Application Joueur.

#### Onglet "Envoyer des invitations"

**Objectif :** Inviter des joueurs a rejoindre l'Application Joueur

- Filtres par club, par email, par statut
- Liste des joueurs eligibles avec cases a cocher
- Option mode test

L'email d'invitation contient : presentation de l'Application Joueur, instructions pour creer un compte, guide PDF en piece jointe (si configure).

#### Onglet "Suivi des invitations"

| Colonne | Description |
|---------|-------------|
| Nom | Nom et prenom + licence |
| Club | Club du joueur |
| Email | Adresse email |
| Date d'envoi | Date de l'invitation initiale |
| Envois | Nombre total d'envois (initial + rappels) |
| Statut | En attente ou Inscrit |
| Actions | Bouton "Renvoyer" (si En attente), "Supprimer" |

**Actions en lot :** Cocher plusieurs joueurs "En attente" et cliquer sur "Renvoyer la selection" pour envoyer un rappel a tous.

#### Onglet "Parametres"

- **Template de l'email :** Modifier le sujet et le corps du message d'invitation (editeur riche)
- **Variables disponibles :** `{first_name}`, `{organization_name}`, `{organization_short_name}`, `{organization_email}`
- **Guide PDF :** Telecharger un PDF joint automatiquement a chaque invitation

> **Lien avec l'Application Joueur :** Quand un joueur cree son compte sur l'Application Joueur, son statut passe automatiquement de "En attente" a "Inscrit". Le bouton "Synchroniser statuts" force cette verification.

---

## Menu : Parametres

### Acces

Cliquer sur "Parametres" dans la barre de navigation (visible uniquement pour les administrateurs)

### Sous-sections disponibles

- **Generer les tournois de la saison** (a partir du calendrier Excel)
- Parametres de l'organisation
- Gestion des utilisateurs
- Types de Tournoi et Mode de qualification
- Parametres de jeu (Distance, Reprises par categorie)
- Bareme de points
- Classifications FFB
- Gestion des clubs
- Donnees de reference
- Politique de Confidentialite
- Logs d'activite

---

## Parametres > Generer les tournois de la saison

### Description

Cette fonctionnalite permet de creer automatiquement toutes les competitions d'une saison a partir du fichier calendrier Excel. Au lieu de saisir chaque competition manuellement dans le calendrier, le systeme analyse le fichier Excel et genere l'ensemble des tournois en une seule operation.

### Acces

Depuis la page **Parametres**, cliquer sur le bouton vert **"Generer tournois saison"**.

### Prerequis

- Disposer du fichier calendrier Excel de la saison (format `.xlsx`)
- Le fichier doit contenir les lignes **S** (Samedi) et **D** (Dimanche) avec les dates de chaque journee
- Les tournois sont identifies par les marqueurs : **T1**, **T2**, **T3** (Tournois Qualificatifs) et **FD** (Finale Departementale)
- Le club organisateur est identifie automatiquement par la **couleur de fond** de chaque cellule de tournoi

### Etapes

1. **Selectionner la saison** -- Choisir la saison cible dans le menu deroulant (ex: 2026-2027)
2. **Charger le fichier Excel** -- Selectionner le fichier calendrier de la saison
3. **Cliquer sur "Previsualiser"** -- Le systeme analyse le fichier et detecte automatiquement :
   - Les dates (a partir des lignes S/D)
   - Les tournois (T1, T2, T3, FD)
   - Le mode de jeu (Libre, Cadre, Bande, 3 Bandes)
   - La categorie (N3, R1, R2, R3, R4...)
   - La taille (Distance/Reprises)
   - Le club organisateur (via la couleur de fond de la cellule)
4. **Verifier la reconnaissance des clubs** -- Le systeme affiche les couleurs detectees et le club associe a chacune. Verifier que chaque couleur correspond bien au bon club. Corriger si necessaire avant de poursuivre. Si une couleur n'est pas reconnue, le processus est interrompu.
5. **Controler la previsualisation** -- Verifier le tableau recapitulatif de tous les tournois detectes (date, nom, mode, categorie, lieu, taille). Les finales sont mises en evidence.
6. **Cliquer sur "Importer les tournois"** -- Tous les tournois sont crees dans le calendrier. Si un tournoi avec le meme identifiant existe deja, il est mis a jour.

> **Identification du club organisateur :** Le systeme detecte le club a partir de la couleur de fond des cellules du fichier Excel. En alternative, le format **T1/A** (lettre du club apres le slash) est egalement reconnu. Si ni la couleur ni la lettre ne correspondent a un club connu, le processus s'arrete et demande de corriger le fichier ou de configurer la correspondance.

> **Important :** Apres la generation, il est recommande de verifier les competitions creees dans le menu **Calendrier**. Les tournois peuvent etre modifies individuellement si necessaire (changement de date, de lieu, etc.).

---

## Parametres > Organisation

### Description

Configuration des informations generales de l'organisation.

#### Champs configurables

| Parametre | Description |
|-----------|-------------|
| Nom de l'organisation | Nom complet (ex: "Comite Departemental de Billard des Hauts-de-Seine") |
| Sigle | Nom court (ex: "CDB92") |
| Logo | Image affichee dans les emails et documents |
| Email de communication | Adresse d'expedition des emails |
| Email de notification | Adresse recevant les notifications systeme |
| Nom de l'expediteur | Nom affiche comme expediteur des emails |

#### Personnalisation visuelle

| Parametre | Description |
|-----------|-------------|
| Couleur principale | Couleur des en-tetes, boutons, liens |
| Couleur secondaire | Couleur des degrades, survols |
| Couleur d'accent | Couleur des alertes, badges |

---

## Parametres > Utilisateurs

### Roles disponibles

| Role | Permissions |
|------|-------------|
| Admin | Acces complet, peut creer d'autres utilisateurs |
| Editeur | Peut gerer competitions, inscriptions, communications |
| Lecteur | Consultation seule (acces en lecture a toutes les pages) |

#### Creer un utilisateur

1. Cliquer sur "Ajouter un utilisateur"
2. Saisir : nom d'utilisateur, email, mot de passe temporaire
3. Selectionner le role
4. Cliquer sur "Creer"

#### Actions sur un utilisateur existant

- **Modifier le role** : Changer les permissions
- **Reinitialiser le mot de passe** : Envoie un email de reinitialisation
- **Desactiver** : Bloque l'acces sans supprimer le compte

---

## Parametres > Types de Tournoi et Mode de Qualification

### Description

Configuration du mode de qualification pour les finales et gestion des types de tournoi.

#### Choisir le mode de qualification

Deux modes disponibles, selectionnables par carte :

| Mode | Description |
|------|-------------|
| **3 Tournois Qualificatifs** | 3 tournois (T1, T2, T3) avec cumul des points. Les meilleurs joueurs accedent a la Finale Departementale. |
| **Journees Qualificatives** | Journees avec poules, classement par points de position (meilleurs N sur M journees). Meme import CSV que le mode standard. |

#### Types de Tournoi

Tableau listant les types de tournoi definis (T1, T2, T3, Finale, etc.) avec code, nom d'affichage, et options (compte pour le classement, est une finale). Il est possible d'ajouter de nouveaux types via le formulaire en bas du tableau.

#### Bonus Moyenne

(Visible dans les deux modes : Standard et Journees)

Active un bonus de points par tournoi base sur la moyenne du joueur par rapport aux seuils min/max de la categorie (configures dans Parametres de jeu).

| Type | Formule |
|------|---------|
| **Normal** | Au-dessus du max -> +2 | Entre min et max -> +1 | En dessous du min -> 0 |
| **Par paliers** | < min -> 0 | min-milieu -> +1 | milieu-max -> +2 | >= max -> +3 |

Le bonus est calcule automatiquement a chaque import de resultats et s'ajoute aux eventuels bonus du bareme (VDL, etc.).

Un bandeau d'information affiche les seuils et regles du bonus moyenne en haut de la page de resultats du tournoi et de la page de classements.

#### Parametres Journees Qualificatives

(Visible uniquement en mode journees)

| Parametre | Description |
|-----------|-------------|
| Nombre de journees | Nombre de tournois qualificatifs par saison (defaut: 3) |
| Meilleurs resultats retenus | Nombre de meilleurs scores pris en compte (defaut: 2) |
| Bonus Moyenne au classement saisonnier | Ajoute un bonus au classement saisonnier selon la moyenne des meilleurs tournois retenus (utilise le meme type Normal/Par paliers que le bonus par tournoi) |

#### Points par position

Tableau configurable qui definit le nombre de points attribues pour chaque position finale dans une journee :

- Position 1 -> 10 points (par defaut)
- Position 2 -> 8 points
- etc.
- Possibilite d'ajouter ou modifier des positions

---

## Parametres > Parametres de jeu

### Description

Configuration des parametres de jeu (Distance, Reprises) par mode et categorie pour la saison en cours.

#### Parametres par categorie

| Parametre | Description |
|-----------|-------------|
| Distance | Nombre de points a atteindre |
| Reprises | Nombre maximum de reprises |
| Moyenne mini | Seuil minimum de moyenne pour la categorie |
| Moyenne maxi | Seuil maximum de moyenne pour la categorie |

Ces parametres sont utilises pour :

- Les convocations (distance et reprises affiches dans l'email)
- Le calcul du bonus moyenne (seuils mini/maxi)
- La validation des classifications FFB

> **Surcharge par tournoi :** Les parametres Distance et Reprises peuvent etre modifies pour un tournoi specifique directement depuis la page "Generer les poules" (bouton "Valider les parametres"). Ces surcharges n'affectent que le tournoi concerne.

---

## Parametres > Bareme de Points

### Acces

Menu Parametres > Types de tournois (section "Bareme des points")

### Description

Configuration des regles de calcul des points de match et des bonus. Le bareme est visible dans les deux modes (Standard et Journees), directement sous la section Bonus Moyenne.

#### Bareme de base (Victoire / Nul / Defaite)

Definit les points attribues pour chaque resultat de match :

- **Victoire** : 2 points (par defaut)
- **Match nul** : 1 point
- **Defaite** : 0 point

Ces valeurs sont modifiables via le bouton "Modifier" de chaque ligne.

#### Blocs de bonus

Des blocs de bonus peuvent etre ajoutes pour attribuer des points supplementaires selon des conditions :

**Structure d'un bloc :**

- **Nom du bloc** : Identifiant (ex: "Bonus Moyenne")
- **Libelle colonne** : Nom affiche dans les classements (ex: "Bonus Moy.")
- **Statut** : Actif ou Inactif (toggle)

**Chaque condition dans un bloc :**

- **Champ** : Moyenne du joueur, Nombre de joueurs, Points de match, Serie
- **Operateur** : >, >=, <, <=, =
- **Valeur** : Seuil max categorie, Seuil min categorie, ou valeur numerique
- **Logique** : Possibilite de combiner 2 conditions avec ET/OU
- **Points** : Nombre de points bonus attribues

**Actions :**

- Ajouter un nouveau bloc de conditions
- Modifier/supprimer des conditions individuelles
- Activer/desactiver un bloc entier
- Supprimer un bloc complet

---

## Parametres > Classifications FFB

### Acces

Menu Parametres > Classifications FFB

### Description

Gestion des classifications FFB par discipline pour chaque joueur. Permet d'attribuer un classement FFB (N1, R2, D3, etc.) et une moyenne FFB par mode de jeu.

#### Recherche d'un joueur

1. Saisir le numero de licence dans le champ de recherche
2. Le joueur est identifie automatiquement (nom, prenom, club)

#### Gestion des classifications par discipline

Pour chaque joueur, il est possible de gerer les classifications par mode de jeu :

- **Mode de jeu** : Libre, Cadre, Bande, 3 Bandes
- **Classement** : Dropdown avec les niveaux FFB disponibles (N1 a D3)
- **Moyenne FFB** : Valeur numerique avec 3 decimales

> **Validation :** Un indicateur de plage de moyenne s'affiche (ex: "Plage: 15.000 - 50.000") pour guider la saisie.

**Actions :**

- Ajouter une discipline (bouton "+")
- Supprimer une discipline
- Enregistrer les classifications

#### Vue d'ensemble

Un tableau recapitulatif affiche toutes les classifications enregistrees pour tous les joueurs, regroupees par discipline. Statistiques affichees : nombre total de joueurs classes et nombre de classifications saisies.

---

## Parametres > Clubs

### Actions disponibles

- **Ajouter un club** : Nom, ville, logo
- **Modifier un club** : Mettre a jour les informations
- **Telecharger un logo** : Image affichee dans les classements et documents
- **Supprimer un club** : Retirer de la liste

#### Utilisation des logos

Les logos des clubs apparaissent dans les classements (tableau et export Excel) et les convocations.

---

## Parametres > Donnees de reference

### Description

Gestion des donnees de base du systeme, organisee en onglets.

#### Onglet "Modes de jeu"

- Liste des disciplines : Libre, Cadre, Bande, 3 Bandes
- Pour chaque mode : code, nom, couleur d'affichage, ordre
- Possibilite d'ajouter, modifier, supprimer ou reordonner

#### Onglet "Classements FFB"

- Liste des niveaux : N1, N2, N3, R1-R5, D1-D3
- Pour chaque niveau : code, nom complet, palier (National/Regional/Departemental), niveau hierarchique

#### Onglet "Categories"

- Combinaisons mode + niveau
- Nom d'affichage personnalisable (ex: "Libre R2", "3 Bandes N3")
- Statut : Actif / Inactif / N/A
- Bouton "Synchroniser" : cree automatiquement les categories manquantes

#### Onglet "Config. Poules"

- Configuration automatique de la composition des poules
- Option : Autoriser les poules de 2 joueurs
- Tableau de previsualisation : pour chaque nombre de joueurs, la repartition en poules est affichee

---

## Parametres > Politique de Confidentialite

### Description

Editeur de la politique de confidentialite affichee dans l'Application Joueur (conformite RGPD).

### Fonctionnalites

- Editeur de texte avec barre d'outils (titres, gras, italique, listes)
- Previsualisation en temps reel (onglet Apercu)
- Import depuis un fichier Word (.docx)
- Export en document Word (.doc)
- Sauvegarde en base de donnees

---

## Parametres > Logs d'activite

### Acces

Menu Parametres > Logs d'activite (lien direct)

### Description

Historique des actions effectuees par les utilisateurs de l'application et de l'Espace Joueur.

#### Statistiques rapides (7 derniers jours)

- Connexions
- Inscriptions
- Desinscriptions
- Nouveaux comptes
- Utilisateurs actifs

#### Filtres disponibles

- **Periode** : Date de debut et de fin
- **Type d'action** : Connexion, inscription, desinscription, creation de compte, etc.
- **Nom du joueur** : Recherche avec operateurs (contient, commence par, est egal a, etc.)
- **Licence** : Recherche par numero de licence

#### Tableau des logs

| Colonne | Description |
|---------|-------------|
| Date/Heure | Horodatage de l'action |
| Action | Type d'action effectuee |
| Statut | Succes ou echec |
| Joueur | Nom du joueur concerne |
| Email | Adresse email |
| Cible | Element cible par l'action |
| Details | Informations complementaires |
| IP | Adresse IP de l'utilisateur |

#### Actions

- **Export Excel** : Telecharge les logs filtres au format Excel
- **Rafraichissement automatique** : Toggle pour actualiser les logs toutes les 30 secondes
- **Pagination** : 50 logs par page

---

## Liste des Inscriptions

### Acces

Via le menu "Inscriptions" dans la barre de navigation

### Description

Vue complete de toutes les inscriptions aux competitions.

### Filtres disponibles

- **Saison**, **Mode de jeu**, **Niveau**
- **Statut** : Inscrit, Convoque, Forfait, Desinscrit
- **Recherche** : Par nom ou licence

### Tableau affiche

| Colonne | Description |
|---------|-------------|
| Joueur | Nom, prenom, licence |
| Club | Club du joueur |
| Email | Adresse email |
| Telephone | Numero de telephone |
| Competition | Mode + niveau + numero tournoi |
| Source | player_app / manual / ionos |
| Statut | Inscrit / Convoque / Forfait / Desinscrit |
| Actions | Modifier / Supprimer |

### Sources d'inscription

- **player_app** : Le joueur s'est inscrit via l'Application Joueur
- **manual** : Un administrateur a ajoute l'inscription manuellement
- **ionos** : Import CSV (ancien systeme)

#### Ajouter une inscription manuellement

1. Cliquer sur "Ajouter"
2. Selectionner le tournoi
3. Rechercher le joueur
4. Verifier/completer email et telephone
5. Cliquer sur "Enregistrer"

> **Lien avec l'Application Joueur :** Les inscriptions avec source "player_app" ont ete faites par le joueur lui-meme. Ces inscriptions ne doivent generalement pas etre modifiees manuellement.

---

## Flux de Travail Types

### Preparer un tournoi de A a Z

1. **Creer le tournoi** (Menu Calendrier) -- Definir mode, niveau, date, lieu
2. **Attendre les inscriptions** -- Les joueurs s'inscrivent via l'Application Joueur. Suivre dans la liste des inscriptions
3. **Generer les poules** (Menu Competitions) -- Charger le tournoi, verifier les joueurs, valider les parametres de jeu, generer les poules
4. **Envoyer les convocations** -- Previsualiser, tester si besoin, envoyer a tous les joueurs
5. **Gerer les forfaits** (si necessaire) -- Marquer les forfaits, ajouter des remplacants, renvoyer les convocations modifiees
6. **Apres le tournoi** -- Importer les resultats (CSV), verifier le classement mis a jour

---

### Gerer un forfait de derniere minute

1. Menu Competitions > Generer poules
2. Charger le tournoi concerne
3. Cliquer sur "Gerer les forfaits"
4. Cocher le joueur forfait et cliquer sur "Enregistrer les forfaits"
5. (Optionnel) Cliquer sur "Ajouter un remplacant"
6. Cliquer sur "Previsualiser les nouvelles poules"
7. Verifier la nouvelle composition
8. Cliquer sur "Envoyer les nouvelles convocations"

---

### Inviter les joueurs a l'Espace Joueur

1. Menu Com joueurs > Invitations Espace Joueur
2. Onglet "Parametres" : Verifier le template et telecharger le guide PDF
3. Onglet "Envoyer" : Filtrer et selectionner les joueurs
4. Envoyer les invitations
5. Onglet "Suivi" : Suivre les inscriptions
6. Renvoyer des rappels aux "En attente" (individuellement ou en lot)

---

### Configurer le bareme de points

1. Menu Parametres > Types de tournois
2. Faire defiler jusqu'a la section "Configuration du scoring par phase"
3. Sous la grille, les blocs de bareme sont affiches (Victoire/Nul/Defaite, Bonus Moyenne, etc.)
4. Cliquer sur "Modifier" pour ajuster les points d'une condition
5. (Optionnel) Ajouter un bloc de bonus : saisir un nom de bloc et un libelle de colonne, cliquer sur "Ajouter le bloc"
6. Ajouter des conditions avec le formulaire structure
7. Activer ou desactiver les blocs selon les besoins
8. Les bonus sont appliques automatiquement lors de l'import des resultats

---

### Passer en mode Journees Qualificatives

1. Menu Parametres > Types de Tournoi
2. Cliquer sur la carte "Journees Qualificatives"
3. Configurer : nombre de journees, meilleurs resultats retenus
4. Configurer les points par position (tableau en bas)
5. (Optionnel) Activer le "Bonus Moyenne au classement saisonnier"
6. Cliquer sur "Enregistrer"
7. Le classement adopte automatiquement le format journees (TQ1/TQ2/TQ3, scores retenus/ecartes)

---

## Glossaire

| Terme | Definition |
|-------|------------|
| Application Joueur / Espace Joueur | Application permettant aux licencies de s'inscrire et consulter leurs informations |
| Bareme | Ensemble des regles definissant l'attribution des points de match et des bonus |
| Bonus Moyenne | Points bonus par tournoi selon la moyenne du joueur par rapport aux seuils min/max de la categorie. Deux types : Normal (+0/+1/+2) ou Par paliers (+0/+1/+2/+3). Disponible dans les deux modes (Standard et Journees). En mode Journees, un bonus similaire peut etre active sur le classement saisonnier. |
| Categorie | Combinaison d'un mode de jeu et d'un niveau (ex: "Libre R2", "3 Bandes N3") |
| CDB | Comite Departemental de Billard -- chaque CDB dispose de son propre environnement isole |
| Classification FFB | Classement attribue par la FFB a un joueur pour une discipline donnee (ex: R2 en 3 Bandes) |
| Convocation | Email envoye au joueur avec toutes les informations du tournoi et sa poule |
| Distance | Nombre de points (caramboles) a atteindre pour gagner une manche |
| Forfait | Joueur qui ne peut pas participer apres avoir ete convoque |
| Journee Qualificative | Mode de competition avec poules, classement par points de position attribues selon la position finale |
| Licence FFB | Numero d'identification unique du joueur a la Federation Francaise de Billard |
| Mode de jeu | Discipline de billard : Libre, Cadre, Bande, ou 3 Bandes |
| Moyenne | Ratio points/reprises mesurant le niveau de jeu d'un joueur |
| Niveau | Classification FFB : N1/N2/N3 (national), R1-R5 (regional), D1-D3 (departemental) |
| Points de match | Points attribues selon le resultat d'un match (Victoire/Nul/Defaite) |
| Points de position | Points attribues selon le classement final dans une journee qualificative |
| Poule | Groupe de joueurs s'affrontant lors d'un tournoi |
| Reprise | Unite de jeu au billard (tour de jeu) |
| Saison | Periode allant de septembre a aout (ex: 2025-2026) |
| Serie | Nombre de points consecutifs marques sans rater |
| E2i / telemat.org | Systeme federal de saisie et gestion des competitions FFB. Les fichiers CSV de matchs exportes depuis E2i peuvent etre importes dans l'application. |
| MGP (Moyenne Generale Parties) | Moyenne generale du joueur calculee sur l'ensemble des matchs d'un tournoi (total points / total reprises) |
| MPART (Meilleure Partie) | Meilleure moyenne obtenue par un joueur sur un seul match dans un tournoi |
| PM (Parties Menees) | Nombre de matchs joues par un joueur dans un tournoi |
| Clt poule | Classement du joueur au sein de sa poule (1er, 2e, 3e...) |

---

*Document de reference pour l'Application de Gestion des Tournois -- Version 2.0.200*

*JR (c)*
