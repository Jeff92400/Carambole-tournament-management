# Guide Utilisateur Complet

**Application de Gestion des Tournois de Billard Français — Version 2.0.200**

---

## Présentation Générale

### Qu'est-ce que cette application ?

Cette application permet à un Comité Départemental de Billard (CDB) de gérer l'intégralité de ses compétitions de billard français (carambole). Elle couvre :

- La gestion des joueurs licenciés et leurs classifications FFB
- Les inscriptions aux compétitions
- La génération des poules et l'envoi des convocations
- La gestion des forfaits
- L'import des résultats et le calcul des classements
- La communication avec les joueurs (emails, annonces)
- La configuration du barème de points et des règles de bonus
- Le suivi d'activité (logs)

### Multi-organisation

L'application est conçue pour accueillir plusieurs comités (CDB) sur une même plateforme. Chaque CDB dispose de son propre environnement isolé : joueurs, compétitions, classements, paramètres et personnalisation visuelle (logo, couleurs) sont entièrement séparés.

### Lien avec l'Application Joueur (Espace Joueur)

L'application fonctionne en tandem avec une **Application Joueur** destinée aux licenciés. Cette application permet aux joueurs de :

- S'inscrire eux-mêmes aux compétitions
- Consulter leurs convocations et la composition des poules
- Voir le calendrier des compétitions
- Recevoir les annonces du comité

> **Important :** Les données sont partagées entre les deux applications. Quand un joueur s'inscrit via l'Application Joueur, son inscription apparaît automatiquement dans l'application de gestion.

### Structure d'une saison

- Une saison va de septembre à août (ex: "2025-2026")
- 4 modes de jeu : Libre, Cadre, Bande, 3 Bandes
- Plusieurs niveaux par mode : N1, N2, N3 (national), R1, R2, R3, R4, R5 (régional), D1, D2, D3 (départemental)
- Pour chaque catégorie (mode + niveau) : plusieurs tournois qualificatifs, puis une Finale Départementale

### Modes de qualification

L'application supporte deux modes de qualification pour les finales, configurables par comité :

| Mode | Description |
|------|-------------|
| **3 Tournois Qualificatifs** (standard) | 3 tournois (T1, T2, T3) avec cumul des points de match. Les mieux classés accèdent à la Finale. |
| **Journées Qualificatives** | Journées avec poules, classement par points de position. Même import CSV que le mode standard. Seuls les N meilleurs résultats sur M journées comptent. |

Le mode de qualification se configure dans **Paramètres > Types de Tournoi**.

---

## Page de Connexion

### Accès

Page d'accueil de l'application (avant authentification)

### Éléments affichés

- Logo de l'organisation
- Champ "Nom d'utilisateur"
- Champ "Mot de passe"
- Bouton "Se connecter"
- Lien "Mot de passe oublié ?"
- Numéro de version de l'application

*[IMG-01] Page de connexion — Capture de la page de login avec le logo, les champs identifiant/mot de passe et le bouton "Se connecter"*

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

## Bouton d'aide (?)

Sur chaque page de l'application, un bouton rond **?** est affiché en bas à droite de l'écran. En cliquant dessus, ce guide utilisateur s'ouvre dans un nouvel onglet, directement à la section correspondant à la page sur laquelle vous vous trouvez.

**Exemple :** si vous êtes sur la page "Classements" et que vous cliquez sur **?**, le guide s'ouvrira directement à la section "Classements".

## Bouton "Tournois à venir"

Sur chaque page de l'application, un lien **Tournois à venir** est affiché dans la barre de navigation (à gauche du bouton d'aide **?**). En cliquant dessus, une fenêtre modale s'ouvre et affiche la liste de tous les tournois à venir (à partir de la date du jour).

### Informations affichées

Le tableau présente pour chaque tournoi :

- **Date** : date de début du tournoi
- **Nom** : intitulé du tournoi
- **Mode** : discipline de jeu
- **Catégorie** : niveau de compétition
- **Lieu** : club ou salle accueillant le tournoi
- **Inscrits** : nombre de joueurs inscrits (hors forfaits et désinscrits)

**Astuce :** ce bouton est accessible à tous les utilisateurs (administrateur, éditeur, lecteur, club). Il permet de consulter rapidement le calendrier sans quitter la page en cours.

---

## Menu : Accueil (Dashboard)

### Accès

Cliquer sur "Accueil" dans la barre de navigation (ou automatiquement après connexion)

### Description

Page d'accueil présentant une vue d'ensemble de l'activité du comité.

#### Statistiques générales

- **Joueurs actifs** : Nombre de licenciés dans la base
- **Compétitions jouées** : Nombre de compétitions terminées sur la saison
- **Participants cumulés** : Total des participations

#### Inscriptions saison

- **Total** : Nombre total d'inscriptions
- **Convoqués** : Joueurs ayant reçu leur convocation
- **Forfaits** : Nombre de forfaits déclarés

#### Compétitions saison

- **Total** : Nombre total de compétitions planifiées
- **A venir** : Compétitions pas encore jouées
- **Passés** : Compétitions terminées

#### Alertes

Liste des actions urgentes à effectuer :

- Relances à envoyer (compétitions proches avec joueurs non relancés)
- Résultats à envoyer après un tournoi terminé

*[IMG-02] Dashboard — Vue d'ensemble — Capture du tableau de bord avec les cartes de statistiques (joueurs actifs, compétitions, participants), les alertes et les actions rapides*

#### Actions rapides

Boutons d'accès direct aux fonctions les plus utilisées :

- Compétitions à jouer
- Inscriptions Hors Classement
- Enregistrer une compétition
- Compétitions jouées
- Voir les Classements
- Vainqueurs Finales

> **Lien avec l'Application Joueur :** Le compteur "Inscriptions saison" inclut toutes les inscriptions, y compris celles faites par les joueurs via l'Application Joueur.

---

## Menu : Classements

### Accès

Cliquer sur "Classements" dans la barre de navigation

### Description

Consultation et export des classements saison par catégorie.

### Filtres disponibles

- **Saison** : Sélectionner la saison (ex: 2025-2026)
- **Mode de jeu** : Libre, Cadre, Bande, 3 Bandes
- **Classement FFB** : N1, N2, N3, R1, R2, R3, R4, etc.

*[IMG-03] Classements — Filtres et tableau — Capture de la page classements avec les filtres (saison, mode, niveau) et le tableau de classement affiché. Montrer les joueurs qualifiés en vert.*

### Mode Standard (3 Tournois Qualificatifs)

#### Informations affichées dans le tableau

| Colonne | Description |
|---------|-------------|
| Position | Rang du joueur dans le classement |
| Licence | Numéro de licence FFB |
| Joueur | Nom et prénom (cliquable -> historique du joueur) |
| Club | Club du joueur (avec logo si disponible) |
| T1 | Points de match du Tournoi 1 |
| T2 | Points de match du Tournoi 2 |
| T3 | Points de match du Tournoi 3 |
| Pts Match | Somme des points de match |
| Bonus | Colonnes de bonus dynamiques (si configurées dans le barème) |
| Total | Total des points (match + bonus) |
| Total Points | Points cumulés (caramboles) |
| Total Reprises | Nombre total de reprises jouées |
| Moyenne | Moyenne générale (points/reprises) |
| Meilleure Série | Meilleure série réalisée sur la saison |

### Mode Journées Qualificatives

En mode journées, l'affichage du classement est différent :

| Colonne | Description |
|---------|-------------|
| Position | Rang du joueur |
| Licence | Numéro de licence FFB |
| Joueur | Nom et prénom |
| Club | Club du joueur |
| TQ1 | Points du Tournoi Qualificatif 1 |
| TQ2 | Points du Tournoi Qualificatif 2 |
| TQ3 | Points du Tournoi Qualificatif 3 |
| Bonus Moy. | Bonus moyenne au classement saisonnier — affiché uniquement si activé dans les paramètres (mode Journées) |
| Total | Score total (meilleurs résultats + bonus) |
| Moyenne | Moyenne générale |
| Meilleure Série | Meilleure série |

*[IMG-04] Classements — Mode Journées — Capture du classement en mode journées avec colonnes TQ1/TQ2/TQ3, scores retenus en gras et scores écartés barrés*

> **Scores retenus / écartés :** Lorsque le paramètre « Meilleurs résultats retenus » est configuré (dans Paramètres > Types de Tournoi), seuls les N meilleurs résultats comptent pour le classement. Les scores retenus sont affichés en **gras**, les scores écartés sont ~~barrés~~. Cette fonctionnalité est disponible dans les deux modes (Standard et Journées).

### Mise en évidence des qualifiés

- Les joueurs qualifiés pour la finale sont affichés sur fond vert
- Indication du nombre de qualifiés : "6 premiers qualifiés pour la finale (21 joueurs classés)"

### Règle de qualification

- Moins de 9 participants sur la saison -> 4 qualifiés pour la finale
- 9 participants ou plus -> 6 qualifiés pour la finale

### Légende

- `*` indique que les points de position n'ont pas encore été attribués pour ce tournoi
- `-` indique que le tournoi n'a pas encore eu lieu

### Historique joueur

*[IMG-05] Historique d'un joueur — Capture de la fiche historique d'un joueur avec ses informations, classements par discipline et résultats par saison*

Cliquer sur le nom d'un joueur dans le classement pour accéder à sa fiche historique. Cette page affiche :

- Informations du joueur (nom, licence, club, classements par discipline)
- Historique de tous les tournois joués par saison
- Résultats détaillés : points de match, moyenne, série, classement saison

### Boutons d'action

- **Exporter en Excel** : Télécharge le classement au format Excel avec mise en forme
- **Recalculer** : Force le recalcul du classement (utile après modification de résultats ou changement de mode)

> **Lien avec l'Application Joueur :** Les joueurs peuvent consulter les classements dans l'Application Joueur (consultation seule).

---

## Menu : Compétitions

### Accès

Cliquer sur "Compétitions" dans la barre de navigation

### Sous-menus disponibles

- Générer les poules / Convocations
- Résultats des tournois
- Résultats Externes (Import)
- Liste des tournois

---

## Compétitions > Générer les poules / Convocations

### Description

Fonction principale pour préparer un tournoi : sélection des joueurs, génération des poules, envoi des convocations.

*[IMG-06] Générer les poules — Sélection du tournoi — Capture montrant les filtres (mode, niveau, saison, tournoi), les cartes de compétitions à venir et le bouton "Charger les joueurs"*

#### Étape 1 : Sélection du tournoi

**Filtres à renseigner :**

- Mode de jeu (Libre, Cadre, Bande, 3 Bandes)
- Niveau (N1, N2, N3, R1, R2, R3, R4, etc.)
- Saison
- Tournoi (1, 2, 3 ou Finale)

**Action :** Cliquer sur "Charger les joueurs"

**Alternative :** Cliquer directement sur une carte de compétition à venir affichée en haut de page.

**Informations affichées après chargement :**

- Nom de la compétition
- Date et lieu (possibilité de double lieu pour les tournois répartis sur 2 salles)
- Nombre de joueurs inscrits

*[IMG-07] Générer les poules — Liste des joueurs — Capture de la liste des joueurs avec cases à cocher, badges de statut (Inscrit/Forfait/Désinscrit) et boutons d'action*

#### Étape 2 : Sélection des joueurs

**Pour chaque joueur :**

- Case à cocher pour la sélection
- Position au classement
- Nom et prénom
- Club
- Licence
- Badge de statut (Inscrit / Forfait / Désinscrit)

**Boutons d'action :**

- **Sélectionner les inscrits** : Coche uniquement les joueurs ayant une inscription
- **Tout sélectionner** / **Tout désélectionner**
- **Ajouter un joueur** : Permet d'ajouter manuellement un joueur non inscrit
- **Gérer les forfaits** : Ouvre la fenêtre de gestion des forfaits

#### Étape 3 : Prévisualisation des poules

*[IMG-08] Générer les poules — Prévisualisation — Capture des poules générées avec la composition de chaque poule, le planning des matchs et les paramètres de jeu (distance/reprises)*

Les poules sont générées automatiquement avec répartition équilibrée. Pour chaque poule : liste des joueurs avec leur club et planning des matchs avec horaires.

**Paramètres de jeu :**

- Distance et Reprises affichés (modifiables si besoin avant envoi)
- Bouton "Valider les paramètres" pour confirmer les valeurs de distance/reprises pour ce tournoi

**Possibilités de modification :**

- Glisser-déposer un joueur d'une poule à l'autre
- Boutons pour déplacer un joueur

#### Étape 4 : Envoi des convocations

*[IMG-09] Convocation — Prévisualisation email — Capture de l'aperçu de l'email de convocation avec le logo, les informations du tournoi, la poule et le planning des matchs*

**Prévisualisation de l'email :** aperçu de l'email tel qu'il sera reçu par les joueurs, avec logo, informations du tournoi, composition de la poule et planning des matchs.

> **Mode Test :** Cocher "Mode Test - Envoyer uniquement à mon adresse", saisir une adresse email de test, puis cliquer sur "Envoyer le Test" pour vérifier le rendu avant l'envoi réel.

**Ce qui se passe après l'envoi :**

- Chaque joueur reçoit un email personnalisé
- Un PDF récapitulatif est joint à l'email
- Les poules sont enregistrées en base de données
- Le statut des joueurs passe à "Convoqué"

> **Lien avec l'Application Joueur :** Après l'envoi des convocations, les joueurs peuvent voir leur convocation, la composition complète de toutes les poules et le planning des matchs dans l'Application Joueur.

---

## Compétitions > Gestion des forfaits

### Accès

Bouton "Gérer les forfaits" sur la page Générer poules (après avoir chargé les joueurs)

### Description

Permet de gérer les joueurs qui déclarent forfait après avoir reçu leur convocation.

*[IMG-10] Gestion des forfaits — Capture de la fenêtre de gestion des forfaits avec la liste des joueurs, les cases à cocher et les boutons "Enregistrer" / "Ajouter un remplaçant"*

#### Processus complet de gestion d'un forfait

1. **Marquer le forfait :** Cocher le(s) joueur(s) déclarant forfait, puis cliquer sur "Enregistrer les forfaits"
2. **Ajouter un remplaçant (optionnel) :** Cliquer sur "Ajouter un remplaçant", rechercher et sélectionner un joueur, confirmer l'ajout
3. **Régénérer les poules :** Cliquer sur "Prévisualiser les nouvelles poules" — les poules sont recalculées sans les forfaits
4. **Envoyer les nouvelles convocations :** Cliquer sur "Envoyer les nouvelles convocations" — seuls les joueurs impactés reçoivent un nouvel email

#### Réintégrer un joueur (annuler un forfait)

1. Dans la section "Joueurs forfait"
2. Cliquer sur "Réintégrer" à côté du joueur
3. Le joueur revient dans la liste des convoqués avec le statut "Convoqué"

---

## Compétitions > Résultats des tournois

### Accès

Menu Compétitions > Résultats

### Description

Import des résultats des tournois terminés pour mise à jour des classements.

*[IMG-11] Import des résultats — Capture de la page d'import CSV avec la sélection du tournoi, la zone de dépôt du fichier et le tableau des résultats importés*

#### Processus d'import

1. **Sélectionner le tournoi :** Choisir la catégorie (mode + niveau), le numéro de tournoi, la saison
2. **Préparer le fichier CSV :** Format séparateur point-virgule (;). Colonnes attendues : Licence, Classement, Points, Reprises, Moyenne, Série
3. **Importer :** Cliquer sur "Choisir un fichier", sélectionner le fichier CSV, cliquer sur "Importer"
4. **Vérification :** Les résultats importés sont affichés et le classement saison est automatiquement recalculé. Un lien **« Voir le détail du tournoi »** permet d'accéder directement à la page de résultats du tournoi importé (points de match, moyenne, série, et points de position le cas échéant).

#### Données importées par joueur

- Position finale dans le tournoi
- Points de match (selon le barème configuré)
- Total de points (caramboles)
- Nombre de reprises
- Moyenne générale
- Meilleure série

#### Import en mode Journées Qualificatives

En mode journées, l'import des résultats utilise le **même fichier CSV unique** que le mode standard. Il n'y a pas de procédure d'import spécifique : le processus est identique à celui décrit ci-dessus.

##### Différence avec le mode standard

La seule différence concerne l'attribution automatique des **points de position** :

1. **Importer le fichier CSV :** Même fichier CSV que pour le mode standard.
2. **Attribution automatique :** À l'enregistrement, le système classe les joueurs selon leurs points de match (puis moyenne en cas d'égalité) et attribue automatiquement les points de position correspondants, selon le barème configuré dans **Paramètres > Types de Tournoi > Points par position**. Tous les tournois de la catégorie sont recalculés à chaque import.
3. **Recalcul des classements :** Les classements de saison sont recalculés automatiquement après l'import, en retenant les N meilleurs scores de points de position sur M journées.
4. **Consultation du détail :** Après l'import, cliquer sur **« Voir le détail du tournoi »** pour consulter la page de résultats. En mode journées, une colonne **« Pts Position »** est affichée en plus des colonnes habituelles (points de match, caramboles, reprises, moyenne, série).

> **Points de position :** Le barème de points par position est configurable dans Paramètres > Types de Tournoi. Par exemple : 1er -> 10 pts, 2e -> 8 pts, 3e -> 6 pts, etc. Ce barème est appliqué automatiquement à chaque import de résultats en mode journées. La position est calculée d'après les points de match (et la moyenne en cas d'égalité). La colonne « Pts Position » apparaît automatiquement sur la page de résultats du tournoi.

#### Import des matchs E2i (CSV matchs individuels)

L'onglet **« Import Matchs E2i »** permet d'importer directement les fichiers CSV de matchs individuels exportés depuis **telemat.org / E2i**. Cette méthode remplace l'utilisation d'Excel/Power Query pour calculer les résultats.

##### Format attendu

Les fichiers CSV sont au format E2i (séparateur point-virgule, 20 colonnes) :

`No Phase;Date match;Billard;Poule;Licence J1;Joueur 1;Pts J1;Rep J1;Ser J1;Pts Match J1;Moy J1;Licence J2;Joueur 2;Pts J2;Rep J2;Ser J2;Pts Match J2;Moy J2;NOMBD;Mode de jeu`

Chaque fichier correspond à une poule ou phase (POULE A, POULE B, DEMI-FINALE, Classement 07-08, etc.).

##### Processus d'import

1. **Sélectionner l'onglet « Import Matchs E2i »** sur la page d'import de compétition.
2. **Choisir la catégorie :** Mode de jeu, classement FFB, numéro du tournoi, date.
3. **Ajouter les fichiers CSV :** La page affiche des zones de dépôt séparées par phase : **Poules** (toujours visible), **Demi-finales**, **Finale / Petite Finale** et **Classement** (visibles en mode journées). Déposez chaque fichier CSV dans la zone correspondant à sa phase. Les fichiers sélectionnés apparaissent sous chaque zone.
4. **Aperçu :** Cliquer sur « Aperçu des résultats » pour voir le tableau calculé avant import. Le tableau affiche pour chaque joueur : classement final (CLT), classement poule (Clt poule), parties menées (PM), points, reprises, meilleure série (MS), moyenne générale (MGP), meilleure partie (MPART), points de match, et si applicable les points de classement et bonus.
5. **Sauvegarder :** Cliquer sur « Sauvegarder les résultats ». Les résultats sont enregistrés, les bonus calculés, et les classements de saison recalculés automatiquement.

##### Calculs effectués automatiquement

- **Agrégation :** Les matchs individuels sont agrégés par joueur (total points, reprises, meilleure série, moyenne, nombre de matchs joués).
- **Classement par poule :** Les joueurs sont classés au sein de chaque poule par points de match puis moyenne.
- **Classement final :** Si des phases de classement (DEMI-FINALE, FINALE, Classement 07-08) sont présentes, elles déterminent le classement final. Sinon, le classement est calculé par interclassement des positions de poule.
- **Meilleure partie (MPART) :** La meilleure moyenne sur un seul match est calculée pour chaque joueur.
- **Points de position :** En mode journées, les points de position sont attribués selon le barème configuré.
- **Bonus et classements :** Tous les bonus (barème, moyenne) et les classements de saison sont recalculés après l'import.

##### Détail des matchs

Après l'import, la page de résultats du tournoi affiche une section repliable **« Détail des matchs »** qui liste tous les matchs individuels par poule, avec les scores de chaque joueur.

> **Dégradation du dernier joueur :** En mode journées, une option dans **Paramètres > Types de Tournoi > Points par position** permet d'activer la dégradation du dernier joueur : le dernier classé reçoit les points de la position N+1 (par exemple, s'il y a 10 joueurs, le 10e reçoit les points du 11e).

---

## Compétitions > Résultats Externes (Import)

### Accès

Menu Compétitions > Import Données Externes

### Description

Import de données externes au format CSV : inscriptions et tournois provenant d'un système tiers.

#### Import des inscriptions

1. Glisser-déposer ou cliquer pour sélectionner un fichier CSV
2. Colonnes attendues : INSCRIPTION_ID, JOUEUR_ID, TOURNOI_ID, TIMESTAMP, EMAIL, TELEPHONE, LICENCE, CONVOQUE, FORFAIT, COMMENTAIRE
3. Cliquer sur "Importer"
4. Rapport détaillé affiché : nombre importé, mis à jour, ignoré (déjà inscrit via Player App), erreurs

---

## Compétitions > Liste des tournois

### Accès

Menu Compétitions > Liste des tournois

### Description

Vue d'ensemble de tous les tournois internes (T1, T2, T3, Finale) avec leurs résultats.

### Filtres

- Par saison
- Par mode de jeu
- Par niveau

### Informations affichées

- Catégorie
- Numéro de tournoi
- Date
- Nombre de participants
- Statut (Planifié, Terminé)

---

## Menu : Calendrier

### Accès

Cliquer sur "Calendrier" dans la barre de navigation

*[IMG-12] Calendrier des compétitions — Capture de la vue calendrier mensuelle avec les compétitions en couleur par mode de jeu et le bouton "Ajouter une compétition"*

### Vue calendrier

- Affichage par mois
- Navigation mois précédent / mois suivant
- Code couleur par mode de jeu
- Clic sur une compétition pour voir les détails

### Créer une compétition

1. Cliquer sur "Ajouter une compétition"
2. Renseigner : Mode de jeu, Niveau, Nom du tournoi, Date de début, Lieu (possibilité de renseigner un 2e lieu pour les tournois répartis sur 2 salles)
3. Cliquer sur "Enregistrer"

### Annuler une compétition

1. Cliquer sur la compétition
2. Cliquer sur "Annuler"
3. Confirmer (les joueurs ne sont PAS notifiés automatiquement)

### Supprimer une compétition

Pour supprimer définitivement une compétition (et toutes ses inscriptions associées) :

1. Aller dans **Compétitions > Liste des tournois externes**
2. Repérer la compétition à supprimer dans la liste
3. Cliquer sur le bouton rouge **"Supprimer"** sur la ligne correspondante
4. Confirmer la suppression dans la boîte de dialogue

> **Attention :** La suppression est irréversible. Toutes les inscriptions liées à cette compétition seront également supprimées. Cette action est réservée aux administrateurs.

> **Lien avec l'Application Joueur :** Le calendrier est visible par les joueurs dans l'Application Joueur. Les joueurs peuvent s'inscrire directement aux compétitions à venir depuis leur application. Les inscriptions apparaissent automatiquement dans l'application de gestion.

---

## Menu : Com Joueurs (Communication Joueurs)

### Accès

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

*[IMG-13] Annonces — Capture de la page annonces avec le formulaire de création (titre, message, type) et la liste des annonces existantes avec leur statut*

#### Créer une annonce

**Champs à remplir :**

- **Titre** : Titre de l'annonce
- **Message** : Contenu de l'annonce
- **Type** :
  - INFO : Information générale
  - ALERTE : Message important
  - RESULTATS : Résultats de compétition
  - PERSO : Message personnel ciblé

**Options avancées :**

- **Date d'expiration** : L'annonce disparaît automatiquement après cette date
- **Mode Test** : Envoie l'annonce uniquement à une licence spécifique pour test
- **Destinataire** : Tous les joueurs ou un joueur spécifique (saisir la licence)

#### Gérer les annonces existantes

**Actions par annonce :**

- **Activer / Désactiver** : Rend visible ou masque l'annonce
- **Supprimer** : Supprime définitivement l'annonce

#### Purger les annonces

Section pliable permettant de supprimer en lot les annonces expirées, inactives, ou par période.

> **Lien avec l'Application Joueur :** Les annonces actives et non expirées apparaissent dans l'Application Joueur. Les annonces PERSO n'apparaissent que pour le joueur ciblé.

---

## Com Joueurs > Composer un email

### Description

Envoi d'emails de masse à un groupe de joueurs.

*[IMG-14] Composer un email — Capture de la page d'envoi d'email avec les filtres de destinataires, l'éditeur riche et les variables disponibles*

#### Étape 1 : Sélectionner les destinataires

**Filtres disponibles :**

- **Actifs seulement** : Exclut les joueurs inactifs
- **Utilisateurs Espace Joueur** : Uniquement ceux ayant créé un compte
- **Par club**, **Par mode de jeu**, **Par classement FFB**
- **Par tournoi** : Joueurs inscrits à un tournoi spécifique
- **Par classement saison** : Joueurs présents dans un classement

#### Étape 2 : Composer le message

**Champs :** Objet + Corps du message (éditeur riche avec mise en forme)

**Variables disponibles :**

| Variable | Description |
|----------|-------------|
| `{player_name}` | Nom complet du joueur |
| `{first_name}` | Prénom |
| `{last_name}` | Nom |
| `{club}` | Club du joueur |
| `{category}` | Catégorie (si applicable) |
| `{tournament}` | Numéro du tournoi (T1, T2, T3, Finale) |
| `{tournament_date}` | Date du tournoi |
| `{tournament_lieu}` | Lieu du tournoi |
| `{distance}` | Distance de jeu |
| `{reprises}` | Nombre de reprises |
| `{organization_name}` | Nom complet de l'organisation |
| `{organization_short_name}` | Sigle de l'organisation |
| `{organization_email}` | Email de contact de l'organisation |

> **Modèles par défaut :** Pour les relances (T1, T2, T3, Finale), il est possible d'enregistrer le message comme modèle par défaut. Ce modèle sera pré-rempli automatiquement lors des prochaines relances du même type.

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

## Com Joueurs > Historique

### Description

Historique des emails envoyés.

### Informations affichées

- Date d'envoi
- Objet de l'email
- Nombre de destinataires
- Statut (Envoyé, En cours, Erreur)

---

## Com Joueurs > Invitations Espace Joueur

### Description

Gestion des invitations envoyées aux joueurs pour créer leur compte sur l'Application Joueur.

*[IMG-15] Invitations Espace Joueur — Capture de la page invitations avec l'onglet d'envoi (liste des joueurs) et l'onglet suivi (statuts En attente / Inscrit)*

#### Onglet "Envoyer des invitations"

**Objectif :** Inviter des joueurs à rejoindre l'Application Joueur

- Filtres par club, par email, par statut
- Liste des joueurs éligibles avec cases à cocher
- Option mode test

L'email d'invitation contient : présentation de l'Application Joueur, instructions pour créer un compte, guide PDF en pièce jointe (si configuré).

#### Onglet "Suivi des invitations"

| Colonne | Description |
|---------|-------------|
| Nom | Nom et prénom + licence |
| Club | Club du joueur |
| Email | Adresse email |
| Date d'envoi | Date de l'invitation initiale |
| Envois | Nombre total d'envois (initial + rappels) |
| Statut | En attente ou Inscrit |
| Actions | Bouton "Renvoyer" (si En attente), "Supprimer" |

**Actions en lot :** Cocher plusieurs joueurs "En attente" et cliquer sur "Renvoyer la sélection" pour envoyer un rappel à tous.

#### Onglet "Paramètres"

- **Template de l'email :** Modifier le sujet et le corps du message d'invitation (éditeur riche)
- **Variables disponibles :** `{first_name}`, `{organization_name}`, `{organization_short_name}`, `{organization_email}`
- **Guide PDF :** Télécharger un PDF joint automatiquement à chaque invitation

> **Lien avec l'Application Joueur :** Quand un joueur crée son compte sur l'Application Joueur, son statut passe automatiquement de "En attente" à "Inscrit". Le bouton "Synchroniser statuts" force cette vérification.

---

## Menu : Paramètres

### Accès

Cliquer sur "Paramètres" dans la barre de navigation (visible uniquement pour les administrateurs)

### Sous-sections disponibles

- **Générer les tournois de la saison** (à partir du calendrier Excel)
- Paramètres de l'organisation
- Gestion des utilisateurs
- Types de Tournoi et Mode de qualification
- Paramètres de jeu (Distance, Reprises par catégorie)
- Barème de points
- Classifications FFB
- Gestion des clubs
- Données de référence
- Politique de Confidentialité
- Logs d'activité

---

## Paramètres > Générer les tournois de la saison

### Description

Cette fonctionnalité permet de créer automatiquement toutes les compétitions d'une saison à partir du fichier calendrier Excel. Au lieu de saisir chaque compétition manuellement dans le calendrier, le système analyse le fichier Excel et génère l'ensemble des tournois en une seule opération.

### Accès

Depuis la page **Paramètres**, cliquer sur le bouton vert **"Générer tournois saison"**.

### Prérequis

- Disposer du fichier calendrier Excel de la saison (format `.xlsx`)
- Le fichier doit contenir les lignes **S** (Samedi) et **D** (Dimanche) avec les dates de chaque journée
- Les tournois sont identifiés par les marqueurs : **T1**, **T2**, **T3** (Tournois Qualificatifs) et **FD** (Finale Départementale)
- Le club organisateur est identifié automatiquement par la **couleur de fond** de chaque cellule de tournoi

### Étapes

1. **Sélectionner la saison** — Choisir la saison cible dans le menu déroulant (ex: 2026-2027)
2. **Charger le fichier Excel** — Sélectionner le fichier calendrier de la saison
3. **Cliquer sur "Prévisualiser"** — Le système analyse le fichier et détecte automatiquement :
   - Les dates (à partir des lignes S/D)
   - Les tournois (T1, T2, T3, FD)
   - Le mode de jeu (Libre, Cadre, Bande, 3 Bandes)
   - La catégorie (N3, R1, R2, R3, R4...)
   - La taille (Distance/Reprises)
   - Le club organisateur (via la couleur de fond de la cellule)
4. **Vérifier la reconnaissance des clubs** — Le système affiche les couleurs détectées et le club associé à chacune. Vérifier que chaque couleur correspond bien au bon club. Corriger si nécessaire avant de poursuivre. Si une couleur n'est pas reconnue, le processus est interrompu.
5. **Contrôler la prévisualisation** — Vérifier le tableau récapitulatif de tous les tournois détectés (date, nom, mode, catégorie, lieu, taille). Les finales sont mises en évidence.
6. **Cliquer sur "Importer les tournois"** — Tous les tournois sont créés dans le calendrier. Si un tournoi avec le même identifiant existe déjà, il est mis à jour.

> **Identification du club organisateur :** Le système détecte le club à partir de la couleur de fond des cellules du fichier Excel. En alternative, le format **T1/A** (lettre du club après le slash) est également reconnu. Si ni la couleur ni la lettre ne correspondent à un club connu, le processus s'arrête et demande de corriger le fichier ou de configurer la correspondance.

> **Important :** Après la génération, il est recommandé de vérifier les compétitions créées dans le menu **Calendrier**. Les tournois peuvent être modifiés individuellement si nécessaire (changement de date, de lieu, etc.).

---

## Paramètres > Organisation

### Description

Configuration des informations générales de l'organisation.

*[IMG-16] Paramètres — Organisation — Capture de la page paramètres organisation avec le formulaire (nom, sigle, logo, emails) et la personnalisation visuelle (couleurs)*

#### Champs configurables

| Paramètre | Description |
|-----------|-------------|
| Nom de l'organisation | Nom complet (ex: "Comité Départemental de Billard des Hauts-de-Seine") |
| Sigle | Nom court (ex: "CDB92") |
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

---

## Paramètres > Utilisateurs

### Rôles disponibles

| Rôle | Permissions |
|------|-------------|
| Admin | Accès complet, peut créer d'autres utilisateurs |
| Éditeur | Peut gérer compétitions, inscriptions, communications |
| Lecteur | Consultation seule (accès en lecture à toutes les pages) |

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

## Paramètres > Types de Tournoi et Mode de Qualification

### Description

Configuration du mode de qualification pour les finales et gestion des types de tournoi.

*[IMG-17] Paramètres — Types de Tournoi — Capture de la page types de tournoi avec les cartes de sélection du mode (Standard / Journées) et le tableau des types*

#### Choisir le mode de qualification

Deux modes disponibles, sélectionnables par carte :

| Mode | Description |
|------|-------------|
| **3 Tournois Qualificatifs** | 3 tournois (T1, T2, T3) avec cumul des points. Les meilleurs joueurs accèdent à la Finale Départementale. |
| **Journées Qualificatives** | Journées avec poules, classement par points de position (meilleurs N sur M journées). Même import CSV que le mode standard. |

#### Types de Tournoi

Tableau listant les types de tournoi définis (T1, T2, T3, Finale, etc.) avec code, nom d'affichage, et options (compte pour le classement, est une finale). Il est possible d'ajouter de nouveaux types via le formulaire en bas du tableau.

#### Bonus Moyenne

(Visible dans les deux modes : Standard et Journées)

Active un bonus de points par tournoi basé sur la moyenne du joueur par rapport aux seuils min/max de la catégorie (configurés dans Paramètres de jeu).

| Type | Formule |
|------|---------|
| **Normal** | Au-dessus du max -> +2 | Entre min et max -> +1 | En dessous du min -> 0 |
| **Par paliers** | < min -> 0 | min-milieu -> +1 | milieu-max -> +2 | >= max -> +3 |

Le bonus est calculé automatiquement à chaque import de résultats et s'ajoute aux éventuels bonus du barème (VDL, etc.).

Un bandeau d'information affiche les seuils et règles du bonus moyenne en haut de la page de résultats du tournoi et de la page de classements.

#### Meilleurs résultats retenus

(Visible dans les deux modes : Standard et Journées)

Permet de ne retenir que les N meilleurs résultats de tournoi pour le classement saisonnier. Par exemple, avec la valeur 2 et 3 tournois joués, seuls les 2 meilleurs scores comptent pour le total des points de match. La moyenne, la meilleure série, les points et reprises restent calculés sur tous les tournois.

| Paramètre | Description |
|-----------|-------------|
| Nombre de résultats retenus | Nombre de meilleurs scores pris en compte. Laisser à 0 pour que tous les tournois comptent. |

Les résultats retenus apparaissent en **gras** dans le classement et l'export Excel. Les résultats écartés sont affichés ~~barrés en gris~~.

#### Paramètres Journées Qualificatives

(Visible uniquement en mode journées)

| Paramètre | Description |
|-----------|-------------|
| Nombre de journées | Nombre de tournois qualificatifs par saison (défaut: 3) |
| Bonus Moyenne au classement saisonnier | Ajoute un bonus au classement saisonnier selon la moyenne des meilleurs tournois retenus (utilise le même type Normal/Par paliers que le bonus par tournoi) |

#### Points par position

Tableau configurable qui définit le nombre de points attribués pour chaque position finale dans une journée :

- Position 1 -> 10 points (par défaut)
- Position 2 -> 8 points
- etc.
- Possibilité d'ajouter ou modifier des positions

---

## Paramètres > Paramètres de jeu

### Description

Configuration des paramètres de jeu (Distance, Reprises) par mode et catégorie pour la saison en cours.

*[IMG-18] Paramètres — Paramètres de jeu — Capture du tableau des paramètres de jeu par catégorie (distance, reprises, moyenne mini/maxi)*

#### Paramètres par catégorie

| Paramètre | Description |
|-----------|-------------|
| Distance | Nombre de points à atteindre |
| Reprises | Nombre maximum de reprises |
| Moyenne mini | Seuil minimum de moyenne pour la catégorie |
| Moyenne maxi | Seuil maximum de moyenne pour la catégorie |

Ces paramètres sont utilisés pour :

- Les convocations (distance et reprises affichés dans l'email)
- Le calcul du bonus moyenne (seuils mini/maxi)
- La validation des classifications FFB

> **Surcharge par tournoi :** Les paramètres Distance et Reprises peuvent être modifiés pour un tournoi spécifique directement depuis la page "Générer les poules" (bouton "Valider les paramètres"). Ces surcharges n'affectent que le tournoi concerné.

---

## Paramètres > Barème de Points

### Accès

Menu Paramètres > Types de tournois (section "Barème des points")

### Description

Configuration des règles de calcul des points de match et des bonus. Le barème est visible dans les deux modes (Standard et Journées), directement sous la section Bonus Moyenne.

*[IMG-19] Paramètres — Barème de points — Capture de la page barème avec le tableau de base (V/N/D) et les blocs de bonus avec leurs conditions structurées*

#### Barème de base (Victoire / Nul / Défaite)

Définit les points attribués pour chaque résultat de match :

- **Victoire** : 2 points (par défaut)
- **Match nul** : 1 point
- **Défaite** : 0 point

Ces valeurs sont modifiables via le bouton "Modifier" de chaque ligne.

#### Blocs de bonus

Des blocs de bonus peuvent être ajoutés pour attribuer des points supplémentaires selon des conditions :

**Structure d'un bloc :**

- **Nom du bloc** : Identifiant (ex: "Bonus Moyenne")
- **Libellé colonne** : Nom affiché dans les classements (ex: "Bonus Moy.")
- **Statut** : Actif ou Inactif (toggle)

**Chaque condition dans un bloc :**

- **Champ** : Moyenne du joueur, Nombre de joueurs, Points de match, Série
- **Opérateur** : >, >=, <, <=, =
- **Valeur** : Seuil max catégorie, Seuil min catégorie, ou valeur numérique
- **Logique** : Possibilité de combiner 2 conditions avec ET/OU
- **Points** : Nombre de points bonus attribués

**Actions :**

- Ajouter un nouveau bloc de conditions
- Modifier/supprimer des conditions individuelles
- Activer/désactiver un bloc entier
- Supprimer un bloc complet

---

## Paramètres > Classifications FFB

### Accès

Menu Paramètres > Classifications FFB

### Description

Gestion des classifications FFB par discipline pour chaque joueur. Permet d'attribuer un classement FFB (N1, R2, D3, etc.) et une moyenne FFB par mode de jeu.

*[IMG-20] Classifications FFB — Capture de la page classifications avec la recherche par licence, les lignes discipline/classement/moyenne et le tableau récapitulatif*

#### Recherche d'un joueur

1. Saisir le numéro de licence dans le champ de recherche
2. Le joueur est identifié automatiquement (nom, prénom, club)

#### Gestion des classifications par discipline

Pour chaque joueur, il est possible de gérer les classifications par mode de jeu :

- **Mode de jeu** : Libre, Cadre, Bande, 3 Bandes
- **Classement** : Dropdown avec les niveaux FFB disponibles (N1 à D3)
- **Moyenne FFB** : Valeur numérique avec 3 décimales

> **Validation :** Un indicateur de plage de moyenne s'affiche (ex: "Plage: 15.000 - 50.000") pour guider la saisie.

**Actions :**

- Ajouter une discipline (bouton "+")
- Supprimer une discipline
- Enregistrer les classifications

#### Vue d'ensemble

Un tableau récapitulatif affiche toutes les classifications enregistrées pour tous les joueurs, regroupées par discipline. Statistiques affichées : nombre total de joueurs classés et nombre de classifications saisies.

---

## Paramètres > Clubs

### Actions disponibles

- **Ajouter un club** : Nom, ville, logo
- **Modifier un club** : Mettre à jour les informations
- **Télécharger un logo** : Image affichée dans les classements et documents
- **Supprimer un club** : Retirer de la liste

#### Utilisation des logos

Les logos des clubs apparaissent dans les classements (tableau et export Excel) et les convocations.

---

## Paramètres > Données de référence

### Description

Gestion des données de base du système, organisée en onglets.

*[IMG-21] Données de référence — Capture de la page données de référence avec les onglets (Modes de jeu, Classements FFB, Catégories, Config. Poules)*

#### Onglet "Modes de jeu"

- Liste des disciplines : Libre, Cadre, Bande, 3 Bandes
- Pour chaque mode : code, nom, couleur d'affichage, ordre
- Possibilité d'ajouter, modifier, supprimer ou réordonner

#### Onglet "Classements FFB"

- Liste des niveaux : N1, N2, N3, R1-R5, D1-D3
- Pour chaque niveau : code, nom complet, palier (National/Régional/Départemental), niveau hiérarchique

#### Onglet "Catégories"

- Combinaisons mode + niveau
- Nom d'affichage personnalisable (ex: "Libre R2", "3 Bandes N3")
- Statut : Actif / Inactif / N/A
- Bouton "Synchroniser" : crée automatiquement les catégories manquantes

#### Onglet "Config. Poules"

- Configuration automatique de la composition des poules
- Option : Autoriser les poules de 2 joueurs
- Tableau de prévisualisation : pour chaque nombre de joueurs, la répartition en poules est affichée

---

## Paramètres > Politique de Confidentialité

### Description

Éditeur de la politique de confidentialité affichée dans l'Application Joueur (conformité RGPD).

### Fonctionnalités

- Éditeur de texte avec barre d'outils (titres, gras, italique, listes)
- Prévisualisation en temps réel (onglet Aperçu)
- Import depuis un fichier Word (.docx)
- Export en document Word (.doc)
- Sauvegarde en base de données

---

## Paramètres > Logs d'activité

### Accès

Menu Paramètres > Logs d'activité (lien direct)

### Description

Historique des actions effectuées par les utilisateurs de l'application et de l'Espace Joueur.

*[IMG-22] Logs d'activité — Capture de la page logs avec les statistiques rapides (7 jours), les filtres et le tableau des actions*

#### Statistiques rapides (7 derniers jours)

- Connexions
- Inscriptions
- Désinscriptions
- Nouveaux comptes
- Utilisateurs actifs

#### Filtres disponibles

- **Période** : Date de début et de fin
- **Type d'action** : Connexion, inscription, désinscription, création de compte, etc.
- **Nom du joueur** : Recherche avec opérateurs (contient, commence par, est égal à, etc.)
- **Licence** : Recherche par numéro de licence

#### Tableau des logs

| Colonne | Description |
|---------|-------------|
| Date/Heure | Horodatage de l'action |
| Action | Type d'action effectuée |
| Statut | Succès ou échec |
| Joueur | Nom du joueur concerné |
| Email | Adresse email |
| Cible | Élément ciblé par l'action |
| Détails | Informations complémentaires |
| IP | Adresse IP de l'utilisateur |

#### Actions

- **Export Excel** : Télécharge les logs filtrés au format Excel
- **Rafraîchissement automatique** : Toggle pour actualiser les logs toutes les 30 secondes
- **Pagination** : 50 logs par page

---

## Liste des Inscriptions

### Accès

Via le menu "Inscriptions" dans la barre de navigation

### Description

Vue complète de toutes les inscriptions aux compétitions.

*[IMG-23] Liste des inscriptions — Capture de la liste des inscriptions avec les filtres (saison, mode, statut), le tableau et les badges de statut colorés*

### Filtres disponibles

- **Saison**, **Mode de jeu**, **Niveau**
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

#### Ajouter une inscription manuellement

1. Cliquer sur "Ajouter"
2. Sélectionner le tournoi
3. Rechercher le joueur
4. Vérifier/compléter email et téléphone
5. Cliquer sur "Enregistrer"

> **Lien avec l'Application Joueur :** Les inscriptions avec source "player_app" ont été faites par le joueur lui-même. Ces inscriptions ne doivent généralement pas être modifiées manuellement.

---

## Flux de Travail Types

### Préparer un tournoi de A à Z

1. **Créer le tournoi** (Menu Calendrier) — Définir mode, niveau, date, lieu
2. **Attendre les inscriptions** — Les joueurs s'inscrivent via l'Application Joueur. Suivre dans la liste des inscriptions
3. **Générer les poules** (Menu Compétitions) — Charger le tournoi, vérifier les joueurs, valider les paramètres de jeu, générer les poules
4. **Envoyer les convocations** — Prévisualiser, tester si besoin, envoyer à tous les joueurs
5. **Gérer les forfaits** (si nécessaire) — Marquer les forfaits, ajouter des remplaçants, renvoyer les convocations modifiées
6. **Après le tournoi** — Importer les résultats (CSV), vérifier le classement mis à jour

---

### Gérer un forfait de dernière minute

1. Menu Compétitions > Générer poules
2. Charger le tournoi concerné
3. Cliquer sur "Gérer les forfaits"
4. Cocher le joueur forfait et cliquer sur "Enregistrer les forfaits"
5. (Optionnel) Cliquer sur "Ajouter un remplaçant"
6. Cliquer sur "Prévisualiser les nouvelles poules"
7. Vérifier la nouvelle composition
8. Cliquer sur "Envoyer les nouvelles convocations"

---

### Inviter les joueurs à l'Espace Joueur

1. Menu Com joueurs > Invitations Espace Joueur
2. Onglet "Paramètres" : Vérifier le template et télécharger le guide PDF
3. Onglet "Envoyer" : Filtrer et sélectionner les joueurs
4. Envoyer les invitations
5. Onglet "Suivi" : Suivre les inscriptions
6. Renvoyer des rappels aux "En attente" (individuellement ou en lot)

---

### Configurer le barème de points

1. Menu Paramètres > Types de tournois
2. Faire défiler jusqu'à la section "Configuration du scoring par phase"
3. Sous la grille, les blocs de barème sont affichés (Victoire/Nul/Défaite, Bonus Moyenne, etc.)
4. Cliquer sur "Modifier" pour ajuster les points d'une condition
5. (Optionnel) Ajouter un bloc de bonus : saisir un nom de bloc et un libellé de colonne, cliquer sur "Ajouter le bloc"
6. Ajouter des conditions avec le formulaire structuré
7. Activer ou désactiver les blocs selon les besoins
8. Les bonus sont appliqués automatiquement lors de l'import des résultats

---

### Passer en mode Journées Qualificatives

1. Menu Paramètres > Types de Tournoi
2. Cliquer sur la carte "Journées Qualificatives"
3. Configurer : nombre de journées
4. Configurer les points par position (tableau en bas)
5. (Optionnel) Activer le "Bonus Moyenne au classement saisonnier"
6. Cliquer sur "Enregistrer"
7. Le classement adopte automatiquement le format journées (TQ1/TQ2/TQ3, scores retenus/écartés)

---

## Glossaire

| Terme | Définition |
|-------|------------|
| Application Joueur / Espace Joueur | Application permettant aux licenciés de s'inscrire et consulter leurs informations |
| Barème | Ensemble des règles définissant l'attribution des points de match et des bonus |
| Bonus Moyenne | Points bonus par tournoi selon la moyenne du joueur par rapport aux seuils min/max de la catégorie. Deux types : Normal (+0/+1/+2) ou Par paliers (+0/+1/+2/+3). Disponible dans les deux modes (Standard et Journées). En mode Journées, un bonus similaire peut être activé sur le classement saisonnier. |
| Catégorie | Combinaison d'un mode de jeu et d'un niveau (ex: "Libre R2", "3 Bandes N3") |
| CDB | Comité Départemental de Billard — chaque CDB dispose de son propre environnement isolé |
| Classification FFB | Classement attribué par la FFB à un joueur pour une discipline donnée (ex: R2 en 3 Bandes) |
| Convocation | Email envoyé au joueur avec toutes les informations du tournoi et sa poule |
| Distance | Nombre de points (caramboles) à atteindre pour gagner une manche |
| Forfait | Joueur qui ne peut pas participer après avoir été convoqué |
| Journée Qualificative | Mode de compétition avec poules, classement par points de position attribués selon la position finale |
| Licence FFB | Numéro d'identification unique du joueur à la Fédération Française de Billard |
| Mode de jeu | Discipline de billard : Libre, Cadre, Bande, ou 3 Bandes |
| Moyenne | Ratio points/reprises mesurant le niveau de jeu d'un joueur |
| Niveau | Classification FFB : N1/N2/N3 (national), R1-R5 (régional), D1-D3 (départemental) |
| Points de match | Points attribués selon le résultat d'un match (Victoire/Nul/Défaite) |
| Points de position | Points attribués selon le classement final dans une journée qualificative |
| Poule | Groupe de joueurs s'affrontant lors d'un tournoi |
| Reprise | Unité de jeu au billard (tour de jeu) |
| Saison | Période allant de septembre à août (ex: 2025-2026) |
| Série | Nombre de points consécutifs marqués sans rater |
| E2i / telemat.org | Système fédéral de saisie et gestion des compétitions FFB. Les fichiers CSV de matchs exportés depuis E2i peuvent être importés dans l'application. |
| MGP (Moyenne Générale Parties) | Moyenne générale du joueur calculée sur l'ensemble des matchs d'un tournoi (total points / total reprises) |
| MPART (Meilleure Partie) | Meilleure moyenne obtenue par un joueur sur un seul match dans un tournoi |
| PM (Parties Menées) | Nombre de matchs joués par un joueur dans un tournoi |
| Clt poule | Classement du joueur au sein de sa poule (1er, 2e, 3e...) |

---

## Checklist des captures d'écran

> **Instructions :** Pour chaque capture ci-dessous, prenez une copie d'écran de la page indiquée et enregistrez-la dans le dossier `screenshots/` avec le nom de fichier spécifié. Puis décommentez la balise `<img>` correspondante dans le HTML pour remplacer le placeholder.

| ID | Fichier | Page / État à capturer | Détails |
|----|---------|------------------------|---------|
| IMG-01 | `01-login.png` | Page de connexion | Afficher la page de login avec le logo, les champs vides et le bouton "Se connecter". Version visible en bas. |
| IMG-02 | `02-dashboard.png` | Dashboard | Se connecter et capturer le tableau de bord complet : cartes de statistiques, section alertes, et boutons d'actions rapides. |
| IMG-03 | `03-classements.png` | Classements (mode standard) | Menu Classements. Sélectionner une catégorie ayant des résultats. Montrer les filtres + le tableau avec les joueurs qualifiés en vert. |
| IMG-04 | `04-classements-journees.png` | Classements (mode journées) | Si disponible : classement en mode journées avec colonnes TQ1/TQ2/TQ3, scores en gras (retenus) et barrés (écartés). Sinon, omettre cette capture. |
| IMG-05 | `05-historique-joueur.png` | Historique d'un joueur | Depuis le classement, cliquer sur un nom de joueur. Capturer la fiche avec infos, classifications et historique des résultats. |
| IMG-06 | `06-poules-selection.png` | Générer poules — Étape 1 | Menu Compétitions > Générer les poules. Montrer les filtres en haut et les cartes de compétitions à venir. |
| IMG-07 | `07-poules-joueurs.png` | Générer poules — Étape 2 | Après "Charger les joueurs" : liste des joueurs avec cases à cocher, badges de statut et boutons d'action. |
| IMG-08 | `08-poules-preview.png` | Générer poules — Étape 3 | Après génération : prévisualisation des poules avec composition, planning et paramètres de jeu. |
| IMG-09 | `09-convocation-email.png` | Convocation — Aperçu email | Aperçu de l'email de convocation avec logo, infos tournoi, poule et planning. |
| IMG-10 | `10-forfaits.png` | Gestion des forfaits | Depuis Générer poules, cliquer "Gérer les forfaits". Montrer la liste avec cases à cocher et actions. |
| IMG-11 | `11-resultats-import.png` | Import des résultats | Menu Compétitions > Résultats. Montrer la sélection du tournoi et/ou le tableau après import. |
| IMG-12 | `12-calendrier.png` | Calendrier | Vue calendrier mensuelle avec des compétitions affichées (couleurs par mode). Choisir un mois avec plusieurs événements. |
| IMG-13 | `13-annonces.png` | Annonces | Menu Com joueurs > Annonces. Montrer le formulaire de création et quelques annonces existantes si possible. |
| IMG-14 | `14-composer-email.png` | Composer un email | Menu Com joueurs > Composer. Montrer les filtres de destinataires, l'éditeur riche et la liste des variables. |
| IMG-15 | `15-invitations.png` | Invitations Espace Joueur | Menu Com joueurs > Invitations. Montrer l'onglet suivi avec les statuts "En attente" et "Inscrit". |
| IMG-16 | `16-param-organisation.png` | Paramètres > Organisation | Formulaire complet avec nom, sigle, logo, emails et section couleurs. |
| IMG-17 | `17-param-types-tournoi.png` | Paramètres > Types de Tournoi | Les deux cartes de sélection du mode (Standard/Journées), le tableau des types et les paramètres journées si visible. |
| IMG-18 | `18-param-jeu.png` | Paramètres > Paramètres de jeu | Tableau des paramètres de jeu par catégorie avec distance, reprises et moyennes. |
| IMG-19 | `19-param-bareme.png` | Paramètres > Barème de points | Tableau V/N/D et au moins un bloc de bonus avec ses conditions. |
| IMG-20 | `20-classifications-ffb.png` | Paramètres > Classifications FFB | Rechercher un joueur par licence. Montrer les lignes discipline avec classement et moyenne. |
| IMG-21 | `21-donnees-reference.png` | Paramètres > Données de référence | Page avec les onglets visibles. Montrer l'onglet "Catégories" ou "Modes de jeu". |
| IMG-22 | `22-logs-activite.png` | Paramètres > Logs d'activité | Statistiques rapides + filtres + quelques lignes de log dans le tableau. |
| IMG-23 | `23-inscriptions-liste.png` | Liste des inscriptions | Menu Inscriptions. Filtrer pour afficher des résultats. Montrer les badges de statut colorés. |

> **Astuce :** Pour des captures de bonne qualité, utilisez la résolution de votre écran standard (pas de zoom). Largeur recommandée : 1200-1400px. Format PNG recommandé.

> **Activation des images :** Une fois les captures placées dans le dossier `screenshots/`, ouvrez ce fichier HTML et pour chaque placeholder, décommentez la ligne `<img src="screenshots/XX-nom.png">`. Le placeholder gris sera alors remplacé par la vraie capture.

---

*Document de référence pour l'Application de Gestion des Tournois — Version 2.0.200*

*JR (c)*
