![Billard Français](images/FrenchBillard-Icon-small.png)
    
## Guide Utilisateur
Gestion des Tournois

  
  
    [Accueil](#presentation)
    [Présentation Générale](#presentation)
    [Multi-organisation](#multi-org)
    [Modes de qualification](#modes-qualif)
    [Page de Connexion](#connexion)
    [Bouton d'aide (?)](#bouton-aide)

    [Menus](#nav-menus)
    [Accueil (Dashboard)](#dashboard)
    [Classements](#classements)
    [Mode Standard](#classements-standard)
    [Mode Journées](#classements-journees)
    [Historique joueur](#historique-joueur)

    [Compétitions](#competitions)
    [Générer les poules](#generer-poules)
    [Gestion des forfaits](#forfaits)
    [Résultats des tournois](#resultats)
    [Import mode Journées](#import-journees)
    [Résultats Externes](#resultats-externes)
    [Liste des tournois](#liste-tournois)

    [Calendrier](#calendrier)
    [Calendrier](#calendrier)

    [Communication](#communication)
    [Annonces](#annonces)
    [Composer un email](#composer-email)
    [Historique emails](#historique-emails)
    [Invitations Espace Joueur](#invitations)

    [Paramètres](#parametres)
    [Organisation](#param-organisation)
    [Utilisateurs](#param-utilisateurs)
    [Types de Tournoi](#param-types-tournoi)
    [Paramètres de jeu](#param-jeu)
    [Barème de Points](#param-bareme)
    [Classifications FFB](#param-classifications)
    [Clubs](#param-clubs)
    [Données de référence](#param-reference)
    [Politique de Confidentialité](#param-confidentialite)
    [Logs d'activité](#param-logs)

    [Inscriptions](#inscriptions-list)
    [Liste des inscriptions](#inscriptions-list)

    [Flux de travail](#workflows)
    [Préparer un tournoi](#workflow-tournoi)
    [Gérer un forfait](#workflow-forfait)
    [Inviter les joueurs](#workflow-invitations)
    [Configurer le barème](#workflow-bareme)
    [Passer en mode Journées](#workflow-journees)

    [Référence](#glossaire)
    [Glossaire](#glossaire)
    [Checklist captures](#screenshots-checklist)
  


  
    
# Guide Utilisateur Complet

    
Application de Gestion des Tournois de Billard Français — Version 2.0.200

  

  
  
    
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
    
    
      **Important :** Les données sont partagées entre les deux applications. Quand un joueur s'inscrit via l'Application Joueur, son inscription apparaît automatiquement dans l'application de gestion.
    

    
### Structure d'une saison

    
      - Une saison va de septembre à août (ex: "2025-2026")
      - 4 modes de jeu : Libre, Cadre, Bande, 3 Bandes
      - Plusieurs niveaux par mode : N1, N2, N3 (national), R1, R2, R3, R4, R5 (régional), D1, D2, D3 (départemental)
      - Pour chaque catégorie (mode + niveau) : plusieurs tournois qualificatifs, puis une Finale Départementale
    

    
### Modes de qualification

    
L'application supporte deux modes de qualification pour les finales, configurables par comité :

    
      
        ModeDescription
      
      
        
          **3 Tournois Qualificatifs** (standard)
          3 tournois (T1, T2, T3) avec cumul des points de match. Les mieux classés accèdent à la Finale.
        
        
          **Journées Qualificatives**
          Journées avec poules, classement par points de position. Même import CSV que le mode standard. Seuls les N meilleurs résultats sur M journées comptent.
        
      
    
    
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
    

    
      IMG-01
      
      Page de connexion
      Capture de la page de login avec le logo, les champs identifiant/mot de passe et le bouton "Se connecter"
      ![Page de connexion](screenshots/01-login.png)
    

    
### Actions utilisateur

    
      - Saisir le nom d'utilisateur
      - Saisir le mot de passe
      - Cliquer sur "Se connecter"
    

    
### Mot de passe oublié

    
      - Cliquer sur "Mot de passe oublié ?"
      - Saisir l'adresse email associée au compte
      - Recevoir un code à 6 chiffres par email
      - Saisir le code et définir un nouveau mot de passe
    
  

  
---


  
  
    
## Bouton d'aide (?)

    
Sur chaque page de l'application, un bouton rond **?** est affiché en bas à droite de l'écran. En cliquant dessus, ce guide utilisateur s'ouvre dans un nouvel onglet, directement à la section correspondant à la page sur laquelle vous vous trouvez.

    
      **Exemple :** si vous êtes sur la page "Classements" et que vous cliquez sur **?**, le guide s'ouvrira directement à la section "Classements".
    
  

  
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
    

    
      IMG-02
      
      Dashboard — Vue d'ensemble
      Capture du tableau de bord avec les cartes de statistiques (joueurs actifs, compétitions, participants), les alertes et les actions rapides
      ![Dashboard](screenshots/02-dashboard.png)
    

    
#### Actions rapides

    
Boutons d'accès direct aux fonctions les plus utilisées :

    
      - Compétitions à jouer
      - Inscriptions Hors Classement
      - Enregistrer une compétition
      - Compétitions jouées
      - Voir les Classements
      - Vainqueurs Finales
    

    
      **Lien avec l'Application Joueur :** Le compteur "Inscriptions saison" inclut toutes les inscriptions, y compris celles faites par les joueurs via l'Application Joueur.
    
  

  
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
    

    
      IMG-03
      
      Classements — Filtres et tableau
      Capture de la page classements avec les filtres (saison, mode, niveau) et le tableau de classement affiché. Montrer les joueurs qualifiés en vert.
      ![Classements saison](screenshots/03-classements.png)
    

    
### Mode Standard (3 Tournois Qualificatifs)


    
#### Informations affichées dans le tableau

    
      
        ColonneDescription
      
      
        PositionRang du joueur dans le classement
        LicenceNuméro de licence FFB
        JoueurNom et prénom (cliquable &rarr; historique du joueur)
        ClubClub du joueur (avec logo si disponible)
        T1Points de match du Tournoi 1
        T2Points de match du Tournoi 2
        T3Points de match du Tournoi 3
        Pts MatchSomme des points de match
        BonusColonnes de bonus dynamiques (si configurées dans le barème)
        TotalTotal des points (match + bonus)
        Total PointsPoints cumulés (caramboles)
        Total ReprisesNombre total de reprises jouées
        MoyenneMoyenne générale (points/reprises)
        Meilleure SérieMeilleure série réalisée sur la saison
      
    

    
### Mode Journées Qualificatives

    
En mode journées, l'affichage du classement est différent :

    
      
        ColonneDescription
      
      
        PositionRang du joueur
        LicenceNuméro de licence FFB
        JoueurNom et prénom
        ClubClub du joueur
        TQ1Points du Tournoi Qualificatif 1
        TQ2Points du Tournoi Qualificatif 2
        TQ3Points du Tournoi Qualificatif 3
        Bonus Moy.Bonus moyenne (0 à 3 pts) — affiché uniquement si activé dans les paramètres
        TotalScore total (meilleurs résultats + bonus)
        MoyenneMoyenne générale
        Meilleure SérieMeilleure série
      
    

    
      IMG-04
      
      Classements — Mode Journées
      Capture du classement en mode journées avec colonnes TQ1/TQ2/TQ3, scores retenus en gras et scores écartés barrés
      ![Classements mode journées](screenshots/04-classements-journees.png)
    

    
      **Scores retenus / écartés :** En mode journées, seuls les N meilleurs résultats sur M journées comptent. Les scores retenus sont affichés en **gras**, les scores écartés sont barrés.
    

    
### Mise en évidence des qualifiés

    
      - Les joueurs qualifiés pour la finale sont affichés sur fond vert
      - Indication du nombre de qualifiés : "6 premiers qualifiés pour la finale (21 joueurs classés)"
    

    
### Règle de qualification

    
      - Moins de 9 participants sur la saison &rarr; 4 qualifiés pour la finale
      - 9 participants ou plus &rarr; 6 qualifiés pour la finale
    

    
### Légende

    
      - `*` indique que les points de position n'ont pas encore été attribués pour ce tournoi
      - `-` indique que le tournoi n'a pas encore eu lieu
    

    
### Historique joueur

    
      IMG-05
      
      Historique d'un joueur
      Capture de la fiche historique d'un joueur avec ses informations, classements par discipline et résultats par saison
      ![Historique joueur](screenshots/05-historique-joueur.png)
    
    
Cliquer sur le nom d'un joueur dans le classement pour accéder à sa fiche historique. Cette page affiche :

    
      - Informations du joueur (nom, licence, club, classements par discipline)
      - Historique de tous les tournois joués par saison
      - Résultats détaillés : points de match, moyenne, série, classement saison
    

    
### Boutons d'action

    
      - **Exporter en Excel** : Télécharge le classement au format Excel avec mise en forme
      - **Recalculer** : Force le recalcul du classement (utile après modification de résultats ou changement de mode)
    

    
      **Lien avec l'Application Joueur :** Les joueurs peuvent consulter les classements dans l'Application Joueur (consultation seule).
    
  

  
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


    
      IMG-06
      
      Générer les poules — Sélection du tournoi
      Capture montrant les filtres (mode, niveau, saison, tournoi), les cartes de compétitions à venir et le bouton "Charger les joueurs"
      ![Sélection du tournoi](screenshots/06-poules-selection.png)
    

    
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
    

    
      IMG-07
      
      Générer les poules — Liste des joueurs
      Capture de la liste des joueurs avec cases à cocher, badges de statut (Inscrit/Forfait/Désinscrit) et boutons d'action
      ![Sélection des joueurs](screenshots/07-poules-joueurs.png)
    

    
#### Étape 2 : Sélection des joueurs

    
**Pour chaque joueur :**

    
      - Case à cocher pour la sélection
      - Position au classement
      - Nom et prénom
      - Club
      - Licence
      - Badge de statut (Inscrit Forfait Désinscrit)
    
    
**Boutons d'action :**

    
      - **Sélectionner les inscrits** : Coche uniquement les joueurs ayant une inscription
      - **Tout sélectionner** / **Tout désélectionner**
      - **Ajouter un joueur** : Permet d'ajouter manuellement un joueur non inscrit
      - **Gérer les forfaits** : Ouvre la fenêtre de gestion des forfaits
    

    
#### Étape 3 : Prévisualisation des poules

    
      IMG-08
      
      Générer les poules — Prévisualisation
      Capture des poules générées avec la composition de chaque poule, le planning des matchs et les paramètres de jeu (distance/reprises)
      ![Prévisualisation des poules](screenshots/08-poules-preview.png)
    
    
Les poules sont générées automatiquement avec répartition équilibrée. Pour chaque poule : liste des joueurs avec leur club et planning des matchs avec horaires.

    
**Paramètres de jeu :**

    
      - Distance et Reprises affichés (modifiables si besoin avant envoi)
      - Bouton "Valider les paramètres" pour confirmer les valeurs de distance/reprises pour ce tournoi
    
    
**Possibilités de modification :**

    
      - Glisser-déposer un joueur d'une poule à l'autre
      - Boutons pour déplacer un joueur
    

    
#### Étape 4 : Envoi des convocations

    
      IMG-09
      
      Convocation — Prévisualisation email
      Capture de l'aperçu de l'email de convocation avec le logo, les informations du tournoi, la poule et le planning des matchs
      ![Prévisualisation email de convocation](screenshots/09-convocation-email.png)
    
    
**Prévisualisation de l'email :** aperçu de l'email tel qu'il sera reçu par les joueurs, avec logo, informations du tournoi, composition de la poule et planning des matchs.


    
      **Mode Test :** Cocher "Mode Test - Envoyer uniquement à mon adresse", saisir une adresse email de test, puis cliquer sur "Envoyer le Test" pour vérifier le rendu avant l'envoi réel.
    

    
**Ce qui se passe après l'envoi :**

    
      - Chaque joueur reçoit un email personnalisé
      - Un PDF récapitulatif est joint à l'email
      - Les poules sont enregistrées en base de données
      - Le statut des joueurs passe à "Convoqué"
    

    
      **Lien avec l'Application Joueur :** Après l'envoi des convocations, les joueurs peuvent voir leur convocation, la composition complète de toutes les poules et le planning des matchs dans l'Application Joueur.
    
  

  
---


  
  
    
## Compétitions > Gestion des forfaits


    
### Accès

    
Bouton "Gérer les forfaits" sur la page Générer poules (après avoir chargé les joueurs)


    
### Description

    
Permet de gérer les joueurs qui déclarent forfait après avoir reçu leur convocation.


    
      IMG-10
      
      Gestion des forfaits
      Capture de la fenêtre de gestion des forfaits avec la liste des joueurs, les cases à cocher et les boutons "Enregistrer" / "Ajouter un remplaçant"
      ![Gestion des forfaits](screenshots/10-forfaits.png)
    

    
#### Processus complet de gestion d'un forfait

    
      - **Marquer le forfait :** Cocher le(s) joueur(s) déclarant forfait, puis cliquer sur "Enregistrer les forfaits"
      - **Ajouter un remplaçant (optionnel) :** Cliquer sur "Ajouter un remplaçant", rechercher et sélectionner un joueur, confirmer l'ajout
      - **Régénérer les poules :** Cliquer sur "Prévisualiser les nouvelles poules" — les poules sont recalculées sans les forfaits
      - **Envoyer les nouvelles convocations :** Cliquer sur "Envoyer les nouvelles convocations" — seuls les joueurs impactés reçoivent un nouvel email
    

    
#### Réintégrer un joueur (annuler un forfait)

    
      - Dans la section "Joueurs forfait"
      - Cliquer sur "Réintégrer" à côté du joueur
      - Le joueur revient dans la liste des convoqués avec le statut "Convoqué"
    
  

  
---


  
  
    
## Compétitions > Résultats des tournois


    
### Accès

    
Menu Compétitions > Résultats


    
### Description

    
Import des résultats des tournois terminés pour mise à jour des classements.


    
      IMG-11
      
      Import des résultats
      Capture de la page d'import CSV avec la sélection du tournoi, la zone de dépôt du fichier et le tableau des résultats importés
      ![Import des résultats](screenshots/11-resultats-import.png)
    

    
#### Processus d'import

    
      - **Sélectionner le tournoi :** Choisir la catégorie (mode + niveau), le numéro de tournoi, la saison
      - **Préparer le fichier CSV :** Format séparateur point-virgule (;). Colonnes attendues : Licence, Classement, Points, Reprises, Moyenne, Série
      - **Importer :** Cliquer sur "Choisir un fichier", sélectionner le fichier CSV, cliquer sur "Importer"
      - **Vérification :** Les résultats importés sont affichés et le classement saison est automatiquement recalculé
    

    
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

1. **Importer le fichier CSV :** Même fichier CSV que pour le mode standard, contenant la colonne "Classement" qui indique la position finale de chaque joueur dans la journée.
2. **Attribution automatique :** À l'enregistrement, le système lit la position de chaque joueur (colonne "Classement" du CSV) et lui attribue automatiquement les points de position correspondants, selon le barème configuré dans **Paramètres > Types de Tournoi > Points par position**.
3. **Recalcul des classements :** Les classements de saison sont recalculés automatiquement après l'import, en retenant les N meilleurs scores de points de position sur M journées.

> **Points de position :** Le barème de points par position est configurable dans Paramètres > Types de Tournoi. Par exemple : 1er → 10 pts, 2e → 8 pts, 3e → 6 pts, etc. Ce barème est appliqué automatiquement à chaque import de résultats en mode journées.
    
  

  
---


  
  
    
## Compétitions > Résultats Externes (Import)


    
### Accès

    
Menu Compétitions > Import Données Externes


    
### Description

    
Import de données externes au format CSV : inscriptions et tournois provenant d'un système tiers.


    
#### Import des inscriptions

    
      - Glisser-déposer ou cliquer pour sélectionner un fichier CSV
      - Colonnes attendues : INSCRIPTION_ID, JOUEUR_ID, TOURNOI_ID, TIMESTAMP, EMAIL, TELEPHONE, LICENCE, CONVOQUE, FORFAIT, COMMENTAIRE
      - Cliquer sur "Importer"
      - Rapport détaillé affiché : nombre importé, mis à jour, ignoré (déjà inscrit via Player App), erreurs
    
  

  
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


    
      IMG-12
      
      Calendrier des compétitions
      Capture de la vue calendrier mensuelle avec les compétitions en couleur par mode de jeu et le bouton "Ajouter une compétition"
      ![Calendrier](screenshots/12-calendrier.png)
    

    
### Vue calendrier

    
      - Affichage par mois
      - Navigation mois précédent / mois suivant
      - Code couleur par mode de jeu
      - Clic sur une compétition pour voir les détails
    

    
### Créer une compétition

    
      - Cliquer sur "Ajouter une compétition"
      - Renseigner : Mode de jeu, Niveau, Nom du tournoi, Date de début, Lieu (possibilité de renseigner un 2e lieu pour les tournois répartis sur 2 salles)
      - Cliquer sur "Enregistrer"
    

    
### Annuler une compétition

    
      - Cliquer sur la compétition
      - Cliquer sur "Annuler"
      - Confirmer (les joueurs ne sont PAS notifiés automatiquement)
    

    
### Supprimer une compétition

    
Pour supprimer définitivement une compétition (et toutes ses inscriptions associées) :

    
      - Aller dans **Compétitions > Liste des tournois externes**
      - Repérer la compétition à supprimer dans la liste
      - Cliquer sur le bouton rouge **"Supprimer"** sur la ligne correspondante
      - Confirmer la suppression dans la boîte de dialogue
    
    
      **Attention :** La suppression est irréversible. Toutes les inscriptions liées à cette compétition seront également supprimées. Cette action est réservée aux administrateurs.
    

    
      **Lien avec l'Application Joueur :** Le calendrier est visible par les joueurs dans l'Application Joueur. Les joueurs peuvent s'inscrire directement aux compétitions à venir depuis leur application. Les inscriptions apparaissent automatiquement dans l'application de gestion.
    
  

  
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


    
      IMG-13
      
      Annonces
      Capture de la page annonces avec le formulaire de création (titre, message, type) et la liste des annonces existantes avec leur statut
      ![Annonces](screenshots/13-annonces.png)
    

    
#### Créer une annonce

    
**Champs à remplir :**

    
      - **Titre** : Titre de l'annonce
      - **Message** : Contenu de l'annonce
      - **Type** :
        INFO Information générale,
        ALERTE Message important,
        RESULTATS Résultats de compétition,
        PERSO Message personnel ciblé
      
    

    
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


    
      **Lien avec l'Application Joueur :** Les annonces actives et non expirées apparaissent dans l'Application Joueur. Les annonces PERSO n'apparaissent que pour le joueur ciblé.
    
  

  
---


  
  
    
## Com Joueurs > Composer un email


    
### Description

    
Envoi d'emails de masse à un groupe de joueurs.


    
      IMG-14
      
      Composer un email
      Capture de la page d'envoi d'email avec les filtres de destinataires, l'éditeur riche et les variables disponibles
      ![Composer un email](screenshots/14-composer-email.png)
    

    
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

    
      
        VariableDescription
      
      
        `{player_name}`Nom complet du joueur
        `{first_name}`Prénom
        `{last_name}`Nom
        `{club}`Club du joueur
        `{category}`Catégorie (si applicable)
        `{tournament}`Numéro du tournoi (T1, T2, T3, Finale)
        `{tournament_date}`Date du tournoi
        `{tournament_lieu}`Lieu du tournoi
        `{distance}`Distance de jeu
        `{reprises}`Nombre de reprises
        `{organization_name}`Nom complet de l'organisation
        `{organization_short_name}`Sigle de l'organisation
        `{organization_email}`Email de contact de l'organisation
      
    

    
      **Modèles par défaut :** Pour les relances (T1, T2, T3, Finale), il est possible d'enregistrer le message comme modèle par défaut. Ce modèle sera pré-rempli automatiquement lors des prochaines relances du même type.
    

    
#### Étape 3 : Mode test (recommandé)

    
      - Cocher "Mode Test"
      - Saisir une adresse email de test
      - Cliquer sur "Envoyer le test"
      - Vérifier le rendu de l'email reçu
    

    
#### Étape 4 : Envoi

    
      - Vérifier le nombre de destinataires
      - Cliquer sur "Envoyer"
      - Confirmer l'envoi
      - Message de confirmation avec le nombre d'emails envoyés
    
  

  
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


    
      IMG-15
      
      Invitations Espace Joueur
      Capture de la page invitations avec l'onglet d'envoi (liste des joueurs) et l'onglet suivi (statuts En attente / Inscrit)
      ![Invitations Espace Joueur](screenshots/15-invitations.png)
    

    
#### Onglet "Envoyer des invitations"

    
**Objectif :** Inviter des joueurs à rejoindre l'Application Joueur

    
      - Filtres par club, par email, par statut
      - Liste des joueurs éligibles avec cases à cocher
      - Option mode test
    
    
L'email d'invitation contient : présentation de l'Application Joueur, instructions pour créer un compte, guide PDF en pièce jointe (si configuré).


    
#### Onglet "Suivi des invitations"

    
      
        ColonneDescription
      
      
        NomNom et prénom + licence
        ClubClub du joueur
        EmailAdresse email
        Date d'envoiDate de l'invitation initiale
        EnvoisNombre total d'envois (initial + rappels)
        StatutEn attente ou Inscrit
        ActionsBouton "Renvoyer" (si En attente), "Supprimer"
      
    

    
**Actions en lot :** Cocher plusieurs joueurs "En attente" et cliquer sur "Renvoyer la sélection" pour envoyer un rappel à tous.


    
#### Onglet "Paramètres"

    
      - **Template de l'email :** Modifier le sujet et le corps du message d'invitation (éditeur riche)
      - **Variables disponibles :** `{first_name}`, `{organization_name}`, `{organization_short_name}`, `{organization_email}`
      - **Guide PDF :** Télécharger un PDF joint automatiquement à chaque invitation
    

    
      **Lien avec l'Application Joueur :** Quand un joueur crée son compte sur l'Application Joueur, son statut passe automatiquement de "En attente" à "Inscrit". Le bouton "Synchroniser statuts" force cette vérification.
    
  

  
---


  
  
    
## Menu : Paramètres


    
### Accès

    
Cliquer sur "Paramètres" dans la barre de navigation (visible uniquement pour les administrateurs)


    
### Sous-sections disponibles

    
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


   Organisation -->
  
    
## Paramètres > Organisation


    
### Description

    
Configuration des informations générales de l'organisation.


    
      IMG-16
      
      Paramètres — Organisation
      Capture de la page paramètres organisation avec le formulaire (nom, sigle, logo, emails) et la personnalisation visuelle (couleurs)
      ![Paramètres organisation](screenshots/16-param-organisation.png)
    

    
#### Champs configurables

    
      
        ParamètreDescription
      
      
        Nom de l'organisationNom complet (ex: "Comité Départemental de Billard des Hauts-de-Seine")
        SigleNom court (ex: "CDB92")
        LogoImage affichée dans les emails et documents
        Email de communicationAdresse d'expédition des emails
        Email de notificationAdresse recevant les notifications système
        Nom de l'expéditeurNom affiché comme expéditeur des emails
      
    

    
#### Personnalisation visuelle

    
      
        ParamètreDescription
      
      
        Couleur principaleCouleur des en-têtes, boutons, liens
        Couleur secondaireCouleur des dégradés, survols
        Couleur d'accentCouleur des alertes, badges
      
    
  

  
---


   Utilisateurs -->
  
    
## Paramètres > Utilisateurs


    
### Rôles disponibles

    
      
        RôlePermissions
      
      
        AdminAccès complet, peut créer d'autres utilisateurs
        ÉditeurPeut gérer compétitions, inscriptions, communications
        LecteurConsultation seule (accès en lecture à toutes les pages)
      
    

    
#### Créer un utilisateur

    
      - Cliquer sur "Ajouter un utilisateur"
      - Saisir : nom d'utilisateur, email, mot de passe temporaire
      - Sélectionner le rôle
      - Cliquer sur "Créer"
    

    
#### Actions sur un utilisateur existant

    
      - **Modifier le rôle** : Changer les permissions
      - **Réinitialiser le mot de passe** : Envoie un email de réinitialisation
      - **Désactiver** : Bloque l'accès sans supprimer le compte
    
  

  
---


   Types de Tournoi -->
  
    
## Paramètres > Types de Tournoi et Mode de Qualification


    
### Description

    
Configuration du mode de qualification pour les finales et gestion des types de tournoi.


    
      IMG-17
      
      Paramètres — Types de Tournoi
      Capture de la page types de tournoi avec les cartes de sélection du mode (Standard / Journées) et le tableau des types
      ![Types de tournoi et mode de qualification](screenshots/17-param-types-tournoi.png)
    

    
#### Choisir le mode de qualification

    
Deux modes disponibles, sélectionnables par carte :

    
      
        ModeDescription
      
      
        
          **3 Tournois Qualificatifs**
          3 tournois (T1, T2, T3) avec cumul des points. Les meilleurs joueurs accèdent à la Finale Départementale.
        
        
          **Journées Qualificatives**
          Journées avec poules, classement par points de position (meilleurs N sur M journées). Même import CSV que le mode standard.
        
      
    

    
#### Types de Tournoi

    
Tableau listant les types de tournoi définis (T1, T2, T3, Finale, etc.) avec code, nom d'affichage, et options (compte pour le classement, est une finale). Il est possible d'ajouter de nouveaux types via le formulaire en bas du tableau.


    
#### Paramètres Journées Qualificatives

    
(Visible uniquement en mode journées)

    
      
        ParamètreDescription
      
      
        Nombre de journéesNombre de tournois qualificatifs par saison (défaut: 3)
        Meilleurs résultats retenusNombre de meilleurs scores pris en compte (défaut: 2)
        Bonus Moyenne au classementActive le bonus de 0 à 3 points selon la moyenne du joueur par rapport aux seuils min/max de la catégorie
      
    

    
#### Points par position

    
Tableau configurable qui définit le nombre de points attribués pour chaque position finale dans une journée :

    
      - Position 1 &rarr; 10 points (par défaut)
      - Position 2 &rarr; 8 points
      - etc.
      - Possibilité d'ajouter ou modifier des positions
    
  

  
---


   Paramètres de jeu -->
  
    
## Paramètres > Paramètres de jeu


    
### Description

    
Configuration des paramètres de jeu (Distance, Reprises) par mode et catégorie pour la saison en cours.


    
      IMG-18
      
      Paramètres — Paramètres de jeu
      Capture du tableau des paramètres de jeu par catégorie (distance, reprises, moyenne mini/maxi)
      ![Paramètres de jeu](screenshots/18-param-jeu.png)
    

    
#### Paramètres par catégorie

    
      
        ParamètreDescription
      
      
        DistanceNombre de points à atteindre
        ReprisesNombre maximum de reprises
        Moyenne miniSeuil minimum de moyenne pour la catégorie
        Moyenne maxiSeuil maximum de moyenne pour la catégorie
      
    

    
Ces paramètres sont utilisés pour :

    
      - Les convocations (distance et reprises affichés dans l'email)
      - Le calcul du bonus moyenne en mode journées (seuils mini/maxi)
      - La validation des classifications FFB
    

    
      **Surcharge par tournoi :** Les paramètres Distance et Reprises peuvent être modifiés pour un tournoi spécifique directement depuis la page "Générer les poules" (bouton "Valider les paramètres"). Ces surcharges n'affectent que le tournoi concerné.
    
  

  
---


   Barème -->
  
    
## Paramètres > Barème de Points


    
### Accès

    
Menu Paramètres > Types de tournois (section "Configuration du scoring par phase")


    
### Description

    
Configuration des règles de calcul des points de match et des bonus. Le barème est intégré à la page d'administration, sous la grille de scoring par phase.


    
      IMG-19
      
      Paramètres — Barème de points
      Capture de la page barème avec le tableau de base (V/N/D) et les blocs de bonus avec leurs conditions structurées
      ![Barème de points](screenshots/19-param-bareme.png)
    

    
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
      - **Opérateur** : >, >=, 

    
**Actions :**

    
      - Ajouter un nouveau bloc de conditions
      - Modifier/supprimer des conditions individuelles
      - Activer/désactiver un bloc entier
      - Supprimer un bloc complet
    
  

  
---


   Classifications FFB -->
  
    
## Paramètres > Classifications FFB


    
### Accès

    
Menu Paramètres > Classifications FFB


    
### Description

    
Gestion des classifications FFB par discipline pour chaque joueur. Permet d'attribuer un classement FFB (N1, R2, D3, etc.) et une moyenne FFB par mode de jeu.


    
      IMG-20
      
      Classifications FFB
      Capture de la page classifications avec la recherche par licence, les lignes discipline/classement/moyenne et le tableau récapitulatif
      ![Classifications FFB](screenshots/20-classifications-ffb.png)
    

    
#### Recherche d'un joueur

    
      - Saisir le numéro de licence dans le champ de recherche
      - Le joueur est identifié automatiquement (nom, prénom, club)
    

    
#### Gestion des classifications par discipline

    
Pour chaque joueur, il est possible de gérer les classifications par mode de jeu :

    
      - **Mode de jeu** : Libre, Cadre, Bande, 3 Bandes
      - **Classement** : Dropdown avec les niveaux FFB disponibles (N1 à D3)
      - **Moyenne FFB** : Valeur numérique avec 3 décimales
    

    
      **Validation :** Un indicateur de plage de moyenne s'affiche (ex: "Plage: 15.000 - 50.000") pour guider la saisie.
    

    
**Actions :**

    
      - Ajouter une discipline (bouton "+")
      - Supprimer une discipline
      - Enregistrer les classifications
    

    
#### Vue d'ensemble

    
Un tableau récapitulatif affiche toutes les classifications enregistrées pour tous les joueurs, regroupées par discipline. Statistiques affichées : nombre total de joueurs classés et nombre de classifications saisies.

  

  
---


   Clubs -->
  
    
## Paramètres > Clubs


    
### Actions disponibles

    
      - **Ajouter un club** : Nom, ville, logo
      - **Modifier un club** : Mettre à jour les informations
      - **Télécharger un logo** : Image affichée dans les classements et documents
      - **Supprimer un club** : Retirer de la liste
    

    
#### Utilisation des logos

    
Les logos des clubs apparaissent dans les classements (tableau et export Excel) et les convocations.

  

  
---


   Données de référence -->
  
    
## Paramètres > Données de référence


    
### Description

    
Gestion des données de base du système, organisée en onglets.


    
      IMG-21
      
      Données de référence
      Capture de la page données de référence avec les onglets (Modes de jeu, Classements FFB, Catégories, Config. Poules)
      ![Données de référence](screenshots/21-donnees-reference.png)
    

    
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


   Politique de Confidentialité -->
  
    
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


   Logs d'activité -->
  
    
## Paramètres > Logs d'activité


    
### Accès

    
Menu Paramètres > Logs d'activité (lien direct)


    
### Description

    
Historique des actions effectuées par les utilisateurs de l'application et de l'Espace Joueur.


    
      IMG-22
      
      Logs d'activité
      Capture de la page logs avec les statistiques rapides (7 jours), les filtres et le tableau des actions
      ![Logs d'activité](screenshots/22-logs-activite.png)
    

    
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

    
      
        ColonneDescription
      
      
        Date/HeureHorodatage de l'action
        ActionType d'action effectuée
        StatutSuccès ou échec
        JoueurNom du joueur concerné
        EmailAdresse email
        CibleÉlément ciblé par l'action
        DétailsInformations complémentaires
        IPAdresse IP de l'utilisateur
      
    

    
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


    
      IMG-23
      
      Liste des inscriptions
      Capture de la liste des inscriptions avec les filtres (saison, mode, statut), le tableau et les badges de statut colorés
      ![Liste des inscriptions](screenshots/23-inscriptions-liste.png)
    

    
### Filtres disponibles

    
      - **Saison**, **Mode de jeu**, **Niveau**
      - **Statut** : Inscrit Convoqué Forfait Désinscrit
      - **Recherche** : Par nom ou licence
    

    
### Tableau affiché

    
      
        ColonneDescription
      
      
        JoueurNom, prénom, licence
        ClubClub du joueur
        EmailAdresse email
        TéléphoneNuméro de téléphone
        CompétitionMode + niveau + numéro tournoi
        Sourceplayer_app / manual / ionos
        StatutInscrit / Convoqué / Forfait / Désinscrit
        ActionsModifier / Supprimer
      
    

    
### Sources d'inscription

    
      - **player_app** : Le joueur s'est inscrit via l'Application Joueur
      - **manual** : Un administrateur a ajouté l'inscription manuellement
      - **ionos** : Import CSV (ancien système)
    

    
#### Ajouter une inscription manuellement

    
      - Cliquer sur "Ajouter"
      - Sélectionner le tournoi
      - Rechercher le joueur
      - Vérifier/compléter email et téléphone
      - Cliquer sur "Enregistrer"
    

    
      **Lien avec l'Application Joueur :** Les inscriptions avec source "player_app" ont été faites par le joueur lui-même. Ces inscriptions ne doivent généralement pas être modifiées manuellement.
    
  

  
---


  
  
    
## Flux de Travail Types

  

  
    
### Préparer un tournoi de A à Z

    
      - **Créer le tournoi** (Menu Calendrier) — Définir mode, niveau, date, lieu
      - **Attendre les inscriptions** — Les joueurs s'inscrivent via l'Application Joueur. Suivre dans la liste des inscriptions
      - **Générer les poules** (Menu Compétitions) — Charger le tournoi, vérifier les joueurs, valider les paramètres de jeu, générer les poules
      - **Envoyer les convocations** — Prévisualiser, tester si besoin, envoyer à tous les joueurs
      - **Gérer les forfaits** (si nécessaire) — Marquer les forfaits, ajouter des remplaçants, renvoyer les convocations modifiées
      - **Après le tournoi** — Importer les résultats (CSV), vérifier le classement mis à jour
    
  

  
---


  
    
### Gérer un forfait de dernière minute

    
      - Menu Compétitions > Générer poules
      - Charger le tournoi concerné
      - Cliquer sur "Gérer les forfaits"
      - Cocher le joueur forfait et cliquer sur "Enregistrer les forfaits"
      - (Optionnel) Cliquer sur "Ajouter un remplaçant"
      - Cliquer sur "Prévisualiser les nouvelles poules"
      - Vérifier la nouvelle composition
      - Cliquer sur "Envoyer les nouvelles convocations"
    
  

  
---


  
    
### Inviter les joueurs à l'Espace Joueur

    
      - Menu Com joueurs > Invitations Espace Joueur
      - Onglet "Paramètres" : Vérifier le template et télécharger le guide PDF
      - Onglet "Envoyer" : Filtrer et sélectionner les joueurs
      - Envoyer les invitations
      - Onglet "Suivi" : Suivre les inscriptions
      - Renvoyer des rappels aux "En attente" (individuellement ou en lot)
    
  

  
---


  
    
### Configurer le barème de points

    
      - Menu Paramètres > Types de tournois
      - Faire défiler jusqu'à la section "Configuration du scoring par phase"
      - Sous la grille, les blocs de barème sont affichés (Victoire/Nul/Défaite, Bonus Moyenne, etc.)
      - Cliquer sur "Modifier" pour ajuster les points d'une condition
      - (Optionnel) Ajouter un bloc de bonus : saisir un nom de bloc et un libellé de colonne, cliquer sur "Ajouter le bloc"
      - Ajouter des conditions avec le formulaire structuré
      - Activer ou désactiver les blocs selon les besoins
      - Les bonus sont appliqués automatiquement lors de l'import des résultats
    
  

  
---


  
    
### Passer en mode Journées Qualificatives

    
      - Menu Paramètres > Types de Tournoi
      - Cliquer sur la carte "Journées Qualificatives"
      - Configurer : nombre de journées, meilleurs résultats retenus
      - (Optionnel) Activer le "Bonus Moyenne au classement"
      - Configurer les points par position (tableau en bas)
      - Cliquer sur "Enregistrer"
      - Le classement adopte automatiquement le format journées (TQ1/TQ2/TQ3, scores retenus/écartés)
    
  

  
---


  
  
    
## Glossaire


    
      
        TermeDéfinition
      
      
        Application Joueur / Espace JoueurApplication permettant aux licenciés de s'inscrire et consulter leurs informations
        BarèmeEnsemble des règles définissant l'attribution des points de match et des bonus
        Bonus MoyennePoints supplémentaires attribués selon la moyenne du joueur par rapport aux seuils de la catégorie (0 à 3 pts, mode journées)
        CatégorieCombinaison d'un mode de jeu et d'un niveau (ex: "Libre R2", "3 Bandes N3")
        CDBComité Départemental de Billard — chaque CDB dispose de son propre environnement isolé
        Classification FFBClassement attribué par la FFB à un joueur pour une discipline donnée (ex: R2 en 3 Bandes)
        ConvocationEmail envoyé au joueur avec toutes les informations du tournoi et sa poule
        DistanceNombre de points (caramboles) à atteindre pour gagner une manche
        ForfaitJoueur qui ne peut pas participer après avoir été convoqué
        Journée QualificativeMode de compétition avec poules, classement par points de position attribués selon la position finale
        Licence FFBNuméro d'identification unique du joueur à la Fédération Française de Billard
        Mode de jeuDiscipline de billard : Libre, Cadre, Bande, ou 3 Bandes
        MoyenneRatio points/reprises mesurant le niveau de jeu d'un joueur
        NiveauClassification FFB : N1/N2/N3 (national), R1-R5 (régional), D1-D3 (départemental)
        Points de matchPoints attribués selon le résultat d'un match (Victoire/Nul/Défaite)
        Points de positionPoints attribués selon le classement final dans une journée qualificative
        PouleGroupe de joueurs s'affrontant lors d'un tournoi
        RepriseUnité de jeu au billard (tour de jeu)
        SaisonPériode allant de septembre à août (ex: 2025-2026)
        SérieNombre de points consécutifs marqués sans rater
      
    
  

  
  
    
## Checklist des captures d'écran


    
      **Instructions :** Pour chaque capture ci-dessous, prenez une copie d'écran de la page indiquée et enregistrez-la dans le dossier `screenshots/` avec le nom de fichier spécifié. Puis décommentez la balise `<img>` correspondante dans le HTML pour remplacer le placeholder.
    

    
      
        IDFichierPage / État à capturerDétails
      
      
        
          IMG-01
          `01-login.png`
          Page de connexion
          Afficher la page de login avec le logo, les champs vides et le bouton "Se connecter". Version visible en bas.
        
        
          IMG-02
          `02-dashboard.png`
          Dashboard
          Se connecter et capturer le tableau de bord complet : cartes de statistiques, section alertes, et boutons d'actions rapides.
        
        
          IMG-03
          `03-classements.png`
          Classements (mode standard)
          Menu Classements. Sélectionner une catégorie ayant des résultats. Montrer les filtres + le tableau avec les joueurs qualifiés en vert.
        
        
          IMG-04
          `04-classements-journees.png`
          Classements (mode journées)
          Si disponible : classement en mode journées avec colonnes TQ1/TQ2/TQ3, scores en gras (retenus) et barrés (écartés). Sinon, omettre cette capture.
        
        
          IMG-05
          `05-historique-joueur.png`
          Historique d'un joueur
          Depuis le classement, cliquer sur un nom de joueur. Capturer la fiche avec infos, classifications et historique des résultats.
        
        
          IMG-06
          `06-poules-selection.png`
          Générer poules — Étape 1
          Menu Compétitions > Générer les poules. Montrer les filtres en haut et les cartes de compétitions à venir.
        
        
          IMG-07
          `07-poules-joueurs.png`
          Générer poules — Étape 2
          Après "Charger les joueurs" : liste des joueurs avec cases à cocher, badges de statut et boutons d'action.
        
        
          IMG-08
          `08-poules-preview.png`
          Générer poules — Étape 3
          Après génération : prévisualisation des poules avec composition, planning et paramètres de jeu.
        
        
          IMG-09
          `09-convocation-email.png`
          Convocation — Aperçu email
          Aperçu de l'email de convocation avec logo, infos tournoi, poule et planning.
        
        
          IMG-10
          `10-forfaits.png`
          Gestion des forfaits
          Depuis Générer poules, cliquer "Gérer les forfaits". Montrer la liste avec cases à cocher et actions.
        
        
          IMG-11
          `11-resultats-import.png`
          Import des résultats
          Menu Compétitions > Résultats. Montrer la sélection du tournoi et/ou le tableau après import.
        
        
          IMG-12
          `12-calendrier.png`
          Calendrier
          Vue calendrier mensuelle avec des compétitions affichées (couleurs par mode). Choisir un mois avec plusieurs événements.
        
        
          IMG-13
          `13-annonces.png`
          Annonces
          Menu Com joueurs > Annonces. Montrer le formulaire de création et quelques annonces existantes si possible.
        
        
          IMG-14
          `14-composer-email.png`
          Composer un email
          Menu Com joueurs > Composer. Montrer les filtres de destinataires, l'éditeur riche et la liste des variables.
        
        
          IMG-15
          `15-invitations.png`
          Invitations Espace Joueur
          Menu Com joueurs > Invitations. Montrer l'onglet suivi avec les statuts "En attente" et "Inscrit".
        
        
          IMG-16
          `16-param-organisation.png`
          Paramètres > Organisation
          Formulaire complet avec nom, sigle, logo, emails et section couleurs.
        
        
          IMG-17
          `17-param-types-tournoi.png`
          Paramètres > Types de Tournoi
          Les deux cartes de sélection du mode (Standard/Journées), le tableau des types et les paramètres journées si visible.
        
        
          IMG-18
          `18-param-jeu.png`
          Paramètres > Paramètres de jeu
          Tableau des paramètres de jeu par catégorie avec distance, reprises et moyennes.
        
        
          IMG-19
          `19-param-bareme.png`
          Paramètres > Barème de points
          Tableau V/N/D et au moins un bloc de bonus avec ses conditions.
        
        
          IMG-20
          `20-classifications-ffb.png`
          Paramètres > Classifications FFB
          Rechercher un joueur par licence. Montrer les lignes discipline avec classement et moyenne.
        
        
          IMG-21
          `21-donnees-reference.png`
          Paramètres > Données de référence
          Page avec les onglets visibles. Montrer l'onglet "Catégories" ou "Modes de jeu".
        
        
          IMG-22
          `22-logs-activite.png`
          Paramètres > Logs d'activité
          Statistiques rapides + filtres + quelques lignes de log dans le tableau.
        
        
          IMG-23
          `23-inscriptions-liste.png`
          Liste des inscriptions
          Menu Inscriptions. Filtrer pour afficher des résultats. Montrer les badges de statut colorés.
        
      
    

    
      **Astuce :** Pour des captures de bonne qualité, utilisez la résolution de votre écran standard (pas de zoom). Largeur recommandée : 1200-1400px. Format PNG recommandé.
    

    
      **Activation des images :** Une fois les captures placées dans le dossier `screenshots/`, ouvrez ce fichier HTML et pour chaque placeholder, décommentez la ligne `<img src="screenshots/XX-nom.png">`. Le placeholder gris sera alors remplacé par la vraie capture.
    
  

  
---


  
  
    
Document de référence pour l'Application de Gestion des Tournois — Version 2.0.200

    
JR &copy;