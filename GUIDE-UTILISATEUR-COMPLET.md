# Guide Utilisateur Complet

> **Note:** Ce document est généré automatiquement depuis le guide HTML.
> **Dernière mise à jour:** 26/04/2026
>
> **Nouvelle section (V 2.0.526) :** Compétitions > Assistant Calendrier (génération automatique du calendrier de saison)
>
> **Nouvelles fonctionnalités documentées (Avril 2026):**
> - **🧭 Navigation refondue — Mega-menu** (23/04/2026, V 2.0.456-458) : La barre de 8-10 liens plats est remplacée par 5 groupes thématiques avec menus déroulants (Accueil, Compétitions ▾, Données ▾, Com joueurs, Paramètres ▾). Navigation préservée par rôle (admin, lecteur, club, DdJ) — muscle memory conservée (cliquer sur un titre ouvre la page principale du groupe). Voir la nouvelle section « Naviguer dans l'application ».
> - **🎮 Directeur de Jeu (DdJ)** (23/04/2026) : Nouvelle section du guide dédiée au module DdJ. Écran d'accueil (étape 0 : sélection de la compétition) disponible dès aujourd'hui. Workflow complet en 7 étapes (0-Sélection → 1-Pointage → 2-Poules → 3-Matchs poules → 4-Phase finale → 5-Matchs classement → 6-Export E2i) prévu pour la saison 2026-27. Module activable par CDB. Voir section « Compétitions > Directeur de Jeu ».
> - **📈 Statistiques accessibles à tous les rôles** (22/04/2026, V 2.0.453) : La page Statistiques (activité clubs/joueurs/participations) est désormais accessible depuis le menu Données pour tous les rôles non-admin (visiteurs, lecteurs, représentants de clubs, responsables de ligue). Voir nouvelle section « Données > Statistiques ».
> - **🧪 Mode Test — Blocage des communications joueurs** (21/04/2026, V 2.0.450) : Interrupteur global par CDB qui bloque intégralement les emails et notifications push destinés aux joueurs, tout en laissant passer les communications administrateurs (reset password, récaps admin, emails onboarding CDB). Journal d'audit des envois bloqués + bandeau rouge persistant en haut de toutes les pages admin. Idéal pour l'onboarding d'un nouveau CDB sans déranger les vrais joueurs. Voir section « Paramètres > Mode Test — Blocage des communications joueurs ».
> - **Historique Inscriptions — Export XLSX + Purge** (18/04/2026, V 2.0.398) : Bouton "📥 Exporter" (XLSX avec filtres actifs) et bouton "🗑️ Purger" (admin, plage de dates obligatoire, flux en deux étapes avec export recommandé avant suppression)
> - **Purge historique campagnes — filtres enrichis** (18/04/2026, V 2.0.396/397) : Sélecteur Type (avec option « sans type » et compteurs par type), case "Uniquement les enregistrements vides (0 destinataire)" pour cibler les fantômes
> - **Décompte précis inscriptions** (17/04/2026, V 2.0.395) : Générer les poules affiche maintenant la ventilation précise (ex. "0 inscrit(s) / 1 renonciation" au lieu d'un compte agrégé flou)
> - **📣 Message à une catégorie** (17/04/2026) : Nouveau bouton ambre sur la liste des tournois externes. Permet d'envoyer push + email à une catégorie entière OU uniquement aux joueurs inscrits à un tournoi (T1/T2/T3/Finale). 3 sélecteurs (Mode / Catégorie / Tournoi), compteur temps réel, 3 modèles pré-définis, récap admin avec liste détaillée des destinataires
> - **Notifications changement date/lieu** (12/04/2026) : Push découplé de l'email (envoi indépendant), récap admin automatique envoyé sur summary_email
> - **Push Notifications** : Sélection "🔔 Joueurs avec notifications actives" pour cibler uniquement les joueurs abonnés
> - **Annonces** : Sélection "📱 Joueurs avec l'app installée" pour cibler uniquement les utilisateurs de l'Espace Joueur
> - **Annonces** : Filtrage par catégorie/club (🎯 Par catégorie/club)
> - **Notifications admin** : Notification résumé de confirmation après envoi groupé
>
> **Clarifications terminologiques (12/04/2026):**
> - "Types de tournoi" → "Typologie des tournois" avec explication détaillée du lien avec le mode de qualification
> - "Barème des points" → "Barème des points de match" pour distinguer des bonus
> - Mode "Tournois Qualificatifs" affiche désormais le nombre dynamique de tournois configurés

---

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

<a name="multi-org"></a>

### Multi-organisation

L'application est conçue pour accueillir plusieurs comités (CDB) sur une même plateforme. Chaque CDB dispose de son propre environnement isolé : joueurs, compétitions, classements, paramètres et personnalisation visuelle (logo, couleurs) sont entièrement séparés.

### Lien avec l'Application Joueur (Espace Joueur)

L'application fonctionne en tandem avec une **Application Joueur **destinée aux licenciés. Cette application permet aux joueurs de :
- S'inscrire eux-mêmes aux compétitions
- Consulter leurs convocations et la composition des poules
- Voir le calendrier des compétitions
- Recevoir les annonces du comité

> 
### **Important : **Les données sont partagées entre les deux applications. Quand un joueur s'inscrit via l'Application Joueur, son inscription apparaît automatiquement dans l'application de gestion. Structure d'une saison
- Une saison va de septembre à août (ex: "2025-2026")
- 4 modes de jeu : Libre, Cadre, Bande, 3 Bandes
- Plusieurs niveaux par mode : N1, N2, N3 (national), R1, R2, R3, R4, R5 (régional), D1, D2, D3 (départemental)
- Pour chaque catégorie (mode + niveau) : plusieurs tournois qualificatifs, puis une Finale Départementale

<a name="modes-qualif"></a>

### Modes de qualification

L'application supporte deux modes de qualification pour les finales, configurables par comité :

| Mode | Description |
| --- | --- |
| **3 Tournois Qualificatifs **(standard) | 3 tournois (T1, T2, T3) avec cumul des points de match. Les mieux classés accèdent à la Finale. |
| **Journées Qualificatives ** | Journées avec poules, classement par points de position. Même import CSV que le mode standard. Seuls les N meilleurs résultats sur M journées comptent. |

Le mode de qualification se configure dans **Paramètres > Types de Tournoi **.

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
- Informations légales : copyright et numéro de dépôt APP

### Informations légales

En bas de l'écran de connexion, les informations suivantes sont affichées :

> 
**Nom du logiciel : **Kayros <br>**Copyright : **© 2025-26 Jeff R. Tous droits réservés. <br>**Protection légale : **Logiciel protégé <br>**Numéro de dépôt APP : **IDDN.FR.001.130044.000.S.P.2026.000.42000 Ces informations sont également présentes sur l'écran de connexion de l'Application Joueur (Espace Joueur).

![Page de connexion](screenshots/01-login.png)

### IMG-01 📷 Page de connexion Capture de la page de login avec le logo, les champs identifiant/mot de passe et le bouton "Se connecter" Actions utilisateur
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

Sur chaque page de l'application, un bouton rond **? **est affiché en bas à droite de l'écran. En cliquant dessus, ce guide utilisateur s'ouvre dans un nouvel onglet, directement à la section correspondant à la page sur laquelle vous vous trouvez.

> 
## **Exemple : **si vous êtes sur la page "Classements" et que vous cliquez sur **? **, le guide s'ouvrira directement à la section "Classements". Bouton "Tournois à venir"

Sur chaque page de l'application, un lien **Tournois à venir **est affiché dans la barre de navigation (à gauche du bouton d'aide **? **). En cliquant dessus, une fenêtre modale s'ouvre et affiche la liste de tous les tournois à venir (à partir de la date du jour).

### Informations affichées

Le tableau présente pour chaque tournoi :
- **Date **: date de début du tournoi
- **Nom **: intitulé du tournoi
- **Mode **: discipline de jeu
- **Catégorie **: niveau de compétition
- **Lieu **: club ou salle accueillant le tournoi
- **Inscrits **: nombre de joueurs inscrits (hors forfaits et désinscrits)

> 
---

## **Astuce : **ce bouton est accessible à tous les utilisateurs (administrateur, éditeur, lecteur, club). Il permet de consulter rapidement le calendrier sans quitter la page en cours. Menu : Accueil (Dashboard)

### Accès

Cliquer sur "Accueil" dans la barre de navigation (ou automatiquement après connexion)

### Description

Page d'accueil présentant une vue d'ensemble de l'activité du comité.

#### Statistiques générales
- **Joueurs actifs **: Nombre de licenciés dans la base
- **Compétitions jouées **: Nombre de compétitions terminées sur la saison
- **Participants cumulés **: Total des participations

#### Inscriptions saison
- **Total **: Nombre total d'inscriptions actives (hors indisponibles et désinscrits)
- **Convoqués **: Joueurs ayant reçu leur convocation
- **Forfaits **: Nombre de forfaits déclarés
- **Indisponibles **: Joueurs ayant déclaré leur indisponibilité via l'Application Joueur

#### Compétitions saison
- **Total **: Nombre total de compétitions planifiées
- **A venir **: Compétitions pas encore jouées
- **Passés **: Compétitions terminées

#### Alertes

Liste des actions urgentes à effectuer :
- Relances à envoyer (compétitions proches avec joueurs non relancés)
- Résultats à envoyer après un tournoi terminé

![Dashboard](screenshots/02-dashboard.png)

#### IMG-02 📷 Dashboard — Vue d'ensemble Capture du tableau de bord avec les cartes de statistiques (joueurs actifs, compétitions, participants), les alertes et les actions rapides Actions rapides

Boutons d'accès direct aux fonctions les plus utilisées :
- Compétitions à jouer
- Inscriptions Hors Classement
- Enregistrer une compétition
- Compétitions jouées
- Voir les Classements
- Vainqueurs Finales

> 
---

## **Lien avec l'Application Joueur : **Le compteur "Inscriptions saison" inclut toutes les inscriptions, y compris celles faites par les joueurs via l'Application Joueur. Menu : Classements

### Accès

Cliquer sur "Classements" dans la barre de navigation

### Description

Consultation et export des classements saison par catégorie.

### Filtres disponibles
- **Saison **: Sélectionner la saison (ex: 2025-2026)
- **Mode de jeu **: Libre, Cadre, Bande, 3 Bandes
- **Classement FFB **: N1, N2, N3, R1, R2, R3, R4, etc.

![Classements saison](screenshots/03-classements.png)

<a name="classements-standard"></a>

### IMG-03 📷 Classements — Filtres et tableau Capture de la page classements avec les filtres (saison, mode, niveau) et le tableau de classement affiché. Montrer les joueurs qualifiés en vert. Mode Standard (3 Tournois Qualificatifs)

#### Informations affichées dans le tableau

| Colonne | Description |
| --- | --- |
| Position | Rang du joueur dans le classement |
| Licence | Numéro de licence FFB |
| Joueur | Nom et prénom (cliquable → historique du joueur) |
| Club | Club du joueur (avec logo si disponible) |
| T1 | Points de match du Tournoi 1 (cliquable → résultats du tournoi) |
| T2 | Points de match du Tournoi 2 (cliquable → résultats du tournoi) |
| T3 | Points de match du Tournoi 3 (cliquable → résultats du tournoi) |
| Pts Match | Somme des points de match |
| Bonus | Colonnes de bonus dynamiques (si configurées dans le barème) |
| Total | Total des points (match + bonus) |
| Total Points | Points cumulés (caramboles) |
| Total Reprises | Nombre total de reprises jouées |
| Moyenne | Moyenne générale (points/reprises) |
| Meilleure Série | Meilleure série réalisée sur la saison |

<a name="classements-journees"></a>

### Mode Journées Qualificatives

En mode journées, l'affichage du classement est basé sur les **points de position **(et non les points de match). Le tableau affiche les colonnes suivantes :

| Colonne | Description |
| --- | --- |
| Clt | Rang du joueur dans le classement saison |
| N°Licence | Numéro de licence FFB |
| Nom | Nom de famille |
| Prénom | Prénom (cliquable → historique du joueur) |
| Club | Club du joueur |
| J1, J2, J3 | Score de chaque journée (Pts clt + Bonus). Scores retenus en **gras **, scores écartés barrés . « * » si les points n'ont pas encore été attribués, « - » si le tournoi n'a pas eu lieu. En-têtes et scores cliquables → résultats du tournoi. |
| Bonus Moy. | Bonus moyenne saison (0 à +3 selon la moyenne des tournois retenus). Affiché uniquement si activé dans les paramètres. |
| Total Top N | Somme des N meilleurs scores de journées + bonus moyenne saison |
| Moy. Gen. (arr.) | Moyenne générale arrondie en début de saison (si disponible) |
| Moy. J1, J2, J3 | Moyenne du joueur pour chaque journée (si disponible) |
| Moy.G saison | Moyenne générale saison calculée sur les tournois retenus uniquement |
| Pts | Total des caramboles (tournois retenus) |
| Rep | Total des reprises (tournois retenus) |
| MS | Meilleure série de la saison |

![Classements mode journées](screenshots/04-classements-journees.png)

> 
#### IMG-04 📷 Classements — Mode Journées Capture du classement en mode journées avec colonnes J1/J2/J3, scores retenus en gras et scores écartés barrés, Total Top 2, moyennes par journée **Scores retenus / écartés : **Lorsque le paramètre « Meilleurs résultats retenus » est configuré (dans Paramètres > Types de Tournoi), seuls les N meilleurs résultats comptent pour le classement. Les scores retenus sont affichés en **gras **, les scores écartés sont barrés . Cette fonctionnalité est disponible dans les deux modes (Standard et Journées). Classement pour la Finale de District

En mode journées, lorsque tous les tournois qualificatifs de la saison ont été joués, un bouton **« Classement pour la Finale de District » **apparaît. Il permet de voir le classement final avec mise en évidence des joueurs qualifiés. Un bouton **« Retour au classement saison » **permet de revenir à la vue par défaut.

### Mise en évidence des qualifiés
- Les joueurs qualifiés pour la finale sont affichés sur fond vert
- Indication du nombre de qualifiés : « 6 premiers qualifiés pour la finale (21 joueurs classés) »

### Règle de qualification
- Le nombre de qualifiés est configurable dans Paramètres > Qualification
- Par défaut : moins de 9 participants sur la saison → 4 qualifiés, 9 ou plus → 6 qualifiés

### Légende
- `* `indique que les points de position n'ont pas encore été attribués pour ce tournoi
- `- `indique que le tournoi n'a pas encore eu lieu

> 
<a name="historique-joueur"></a>

### **Navigation vers les résultats : **Les en-têtes de colonnes T1/T2/T3 (ou J1/J2/J3) ainsi que les scores individuels sont cliquables lorsque le tournoi a été joué. En cliquant, vous accédez directement à la page de résultats détaillés du tournoi concerné. Historique joueur

![Historique joueur](screenshots/05-historique-joueur.png)

IMG-05 📷 Historique d'un joueur Capture de la fiche historique d'un joueur avec ses informations, classements par discipline et résultats par saison Cliquer sur le nom d'un joueur dans le classement pour accéder à sa fiche historique. Cette page affiche :
- Informations du joueur (nom, licence, club, classements par discipline)
- Historique de tous les tournois joués par saison
- Résultats détaillés : points de match, moyenne, série, classement saison

### Boutons d'action
- **Exporter en Excel **: Télécharge le classement au format Excel avec mise en forme
- **Recalculer **: Force le recalcul du classement (utile après modification de résultats ou changement de mode)

> 
---

## **Lien avec l'Application Joueur : **Les joueurs peuvent consulter les classements dans l'Application Joueur (consultation seule). Menu : Compétitions

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

![Sélection du tournoi](screenshots/06-poules-selection.png)

#### IMG-06 📷 Générer les poules — Sélection du tournoi Capture montrant les filtres (mode, niveau, saison, tournoi), les cartes de compétitions à venir et le bouton "Charger les joueurs" Étape 1 : Sélection du tournoi

**Filtres à renseigner : **
- Mode de jeu (Libre, Cadre, Bande, 3 Bandes)
- Niveau (N1, N2, N3, R1, R2, R3, R4, etc.)
- Saison
- Tournoi (1, 2, 3 ou Finale)

**Action : **Cliquer sur "Charger les joueurs"

**Alternative : **Cliquer directement sur une carte de compétition à venir affichée en haut de page.

**Informations affichées après chargement : **
- Nom de la compétition
- Date et lieu (possibilité de double lieu pour les tournois répartis sur 2 salles)
- **Décompte précis des joueurs** (depuis V 2.0.395) :
  - *Tournois standards* : "N inscrit(s)" éventuellement complété par les autres statuts non nuls, par exemple *"3 inscrit(s) / 1 renonciation / 1 forfait"*
  - *Finales* : "X/Y inscrits" (inscrits sur total de finalistes qualifiés), suivi entre parenthèses de la ventilation si applicable, par exemple *"0/6 inscrits (0 inscrit(s) / 1 renonciation)"*
  - Statuts comptés séparément : renonciation (statut "indisponible"), forfait, désinscription — les catégories à zéro sont masquées pour plus de lisibilité

![Sélection des joueurs](screenshots/07-poules-joueurs.png)

#### IMG-07 📷 Générer les poules — Liste des joueurs Capture de la liste des joueurs avec cases à cocher, badges de statut (Inscrit/Forfait/Désinscrit) et boutons d'action Étape 2 : Sélection des joueurs

**Pour chaque joueur : **
- Case à cocher pour la sélection
- Position au classement
- Nom et prénom
- Club
- Licence
- Badge de statut ( Inscrit Forfait Indisponible Désinscrit )

**Boutons d'action : **
- **Sélectionner les inscrits **: Coche uniquement les joueurs ayant une inscription
- **Tout sélectionner **/ **Tout désélectionner **
- **Ajouter un joueur **: Permet d'ajouter manuellement un joueur non inscrit
- **Gérer les forfaits **: Ouvre la fenêtre de gestion des forfaits

#### Étape 3 : Prévisualisation des poules

![Prévisualisation des poules](screenshots/08-poules-preview.png)

IMG-08 📷 Générer les poules — Prévisualisation Capture des poules générées avec la composition de chaque poule, le planning des matchs et les paramètres de jeu (distance/reprises) Les poules sont générées automatiquement avec répartition équilibrée. Pour chaque poule : liste des joueurs avec leur club et planning des matchs avec horaires.

**Paramètres de jeu : **
- Distance et Reprises affichés (modifiables si besoin avant envoi)
- Bouton "Valider les paramètres" pour confirmer les valeurs de distance/reprises pour ce tournoi

**Possibilités de modification : **
- Glisser-déposer un joueur d'une poule à l'autre
- Boutons pour déplacer un joueur

#### Étape 4 : Envoi des convocations

![Prévisualisation email de convocation](screenshots/09-convocation-email.png)

IMG-09 📷 Convocation — Prévisualisation email Capture de l'aperçu de l'email de convocation avec le logo, les informations du tournoi, la poule et le planning des matchs **Prévisualisation de l'email : **aperçu de l'email tel qu'il sera reçu par les joueurs, avec logo, informations du tournoi, composition de la poule et planning des matchs.

> 
#### **Mode Test : **Cocher "Mode Test - Envoyer uniquement à mon adresse", saisir une adresse email de test, puis cliquer sur "Envoyer le Test" pour vérifier le rendu avant l'envoi réel. Publication sur le site web (WordPress)

Si le connecteur WordPress est configuré (voir [Paramètres > Site Web / WordPress ]), une option **« Publier également sur le site web » **apparaît à l'étape 4 :
- **Avec l'envoi des convocations : **Cocher la case « Publier également sur le site web » avant d'envoyer. L'article est créé automatiquement sur le site WordPress en même temps que l'envoi des emails.
- **Sans envoyer d'emails : **Utiliser le bouton « Publier sur le site web (sans envoyer d'emails) » pour publier l'article indépendamment.
- **Mise à jour : **Si un article a déjà été publié pour ce tournoi, il est mis à jour automatiquement (pas de doublon).
- **Suppression : **Un bouton « Supprimer l'article » permet de retirer l'article du site WordPress.

Sur les cartes de tournoi (Compétitions à venir), un bouton indique l'état de la publication :
- **« Publication sur le site » **— aucun article n'a encore été publié pour ce tournoi
- **« MAJ publication sur le site » **— un article existe déjà et sera mis à jour

L'article publié contient : le titre du tournoi, la date, le(s) lieu(x), les paramètres de jeu (distance/reprises), la composition des poules avec le lieu de chaque poule, les noms et clubs des joueurs, un lien de téléchargement du PDF de convocation, et un lien vers la page publique du tournoi.

> 
> 
**Mode Test et WordPress : **En mode test, l'article est publié comme brouillon sur WordPress avec le préfixe [TEST] dans le titre et un bandeau d'avertissement dans le contenu. Cela permet de vérifier le rendu sur le site sans publier réellement. Pensez à supprimer l'article test depuis l'application après vérification. **Page publique du tournoi : **Chaque tournoi dispose d'une page publique accessible sans connexion, affichant les informations du tournoi et la composition des poules. Le lien vers cette page est automatiquement inclus dans l'article WordPress. **Ce qui se passe après l'envoi : **
- Chaque joueur reçoit un email personnalisé
- Un PDF récapitulatif est joint à l'email
- Les poules sont enregistrées en base de données
- Le statut des joueurs passe à "Convoqué"
- Si la case « Publier sur le site web » est cochée, un article est publié sur le site WordPress

> 
#### **Lien avec l'Application Joueur : **Après l'envoi des convocations, les joueurs peuvent voir leur convocation, la composition complète de toutes les poules et le planning des matchs dans l'Application Joueur. Cas particulier : Générer les poules d'un tournoi dédoublé

Pour un tournoi dédoublé, la génération des poules et l'envoi des convocations se font **en deux passes **, une par sous-tournoi (Tournoi X A puis Tournoi X B).

##### Sélection du sous-tournoi

Lorsque vous sélectionnez un tournoi dédoublé, un **sélecteur de sous-tournoi **apparaît avec deux boutons :
- **Tournoi X A **— nom du club A
- **Tournoi X B **— nom du club B

Chaque bouton affiche un **badge de statut **:
- Convoqué : les convocations ont déjà été envoyées pour ce sous-tournoi
- En attente : les convocations n'ont pas encore été envoyées

Un message sous les boutons indique les convocations restantes à envoyer.

##### Processus en deux passes
1. Sélectionner le **Tournoi X A **— seuls les joueurs assignés au sous-tournoi A sont chargés
2. Suivre les étapes habituelles : vérifier les joueurs, générer les poules, envoyer les convocations
3. Un **bandeau d'information **en haut de l'étape 3 indique quel sous-tournoi est en cours et le statut de l'autre
4. Un bouton **« Passer au Tournoi X B » **est disponible dans la barre d'actions (étapes 3 et 4), même sans envoyer les convocations
5. Cliquer sur ce bouton pour revenir automatiquement à l'étape 1 avec le sous-tournoi B pré-sélectionné
6. Répéter les étapes pour le sous-tournoi B

> 
---

## **Identification des convocations : **Le PDF récapitulatif et l'email de convocation incluent automatiquement le suffixe A ou B dans le titre (ex : « CONVOCATION TOURNOI N°1 A »), permettant de distinguer clairement les deux sous-tournois. Compétitions > Gestion des forfaits

### Accès

Bouton "Gérer les forfaits" sur la page Générer poules (après avoir chargé les joueurs)

### Description

Permet de gérer les joueurs qui déclarent forfait après avoir reçu leur convocation.

![Gestion des forfaits](screenshots/10-forfaits.png)

#### IMG-10 📷 Gestion des forfaits Capture de la fenêtre de gestion des forfaits avec la liste des joueurs, les cases à cocher et les boutons "Enregistrer" / "Ajouter un remplaçant" Processus complet de gestion d'un forfait
1. **Marquer le forfait : **Cocher le(s) joueur(s) déclarant forfait, puis cliquer sur "Enregistrer les forfaits"
2. **Ajouter un remplaçant (optionnel) : **Cliquer sur "Ajouter un remplaçant", rechercher et sélectionner un joueur, confirmer l'ajout
3. **Régénérer les poules : **Cliquer sur "Prévisualiser les nouvelles poules" — les poules sont recalculées sans les forfaits
4. **Envoyer les nouvelles convocations : **Cliquer sur "Envoyer les nouvelles convocations" — seuls les joueurs impactés reçoivent un nouvel email

#### Réintégrer un joueur (annuler un forfait)
1. Dans la section "Joueurs forfait"
2. Cliquer sur "Réintégrer" à côté du joueur
3. Le joueur revient dans la liste des convoqués avec le statut "Convoqué"

---

## Compétitions > Résultats des tournois

### Accès

Menu Compétitions > Résultats

### Description

Import des résultats des tournois terminés pour mise à jour des classements. La page d'import comporte **2 onglets **: « Import Classements E2i » (import d'un fichier CSV récapitulatif) et « Import Matchs E2i » (import des fichiers de matchs individuels par phase).

<a name="resultats-2-modes"></a>

### Les 2 modes de qualification

Le fonctionnement de l'import et de l'affichage des résultats dépend du **mode de qualification **configuré pour votre organisation (dans Paramètres > Mode de qualification) :

> 
<a name="import-standard"></a>

### **Quel onglet utiliser ? **L'onglet 1 (Import Classements) fonctionne pour les deux modes. L'onglet 2 (Import Matchs E2i) est plus précis et recommandé en mode journées car il détecte automatiquement les phases (poules, demi-finales, finales, classements) et calcule les positions finales en conséquence. En mode standard, l'onglet 2 fonctionne aussi (agrégation des matchs par joueur). Onglet 1 — Import Classements E2i (mode Standard)

#### IMG-11 📷 Import Classements E2i — Mode Standard Capture de la page d'import CSV (onglet 1) avec la sélection de catégorie, la zone de dépôt du fichier et le tableau des résultats importés Processus d'import
1. **Sélectionner le tournoi : **Choisir le mode de jeu, le classement FFB (la catégorie se déduit automatiquement), le numéro de tournoi (T1, T2, T3, Finale) et la date. Les champs **Lieu **et **Lieu 2 **sont remplis automatiquement à partir du calendrier des tournois planifiés. Vous pouvez les modifier avant l'import si nécessaire.
2. **Préparer le fichier CSV : **Format séparateur point-virgule (;). Colonnes attendues : Licence, Classement, Points, Reprises, Moyenne, Série.
3. **Importer : **Glisser-déposer ou cliquer dans la zone de dépôt pour sélectionner le fichier CSV, puis cliquer sur « Enregistrer la compétition ».
4. **Vérification : **Les résultats importés sont affichés et le classement saison est automatiquement recalculé. Un lien **« Voir le détail du tournoi » **permet d'accéder directement à la page de résultats.

#### Données importées par joueur
- Position finale dans le tournoi
- Points de match (selon le barème configuré)
- Total de points (caramboles)
- Nombre de reprises
- Moyenne générale
- Meilleure série

> 
<a name="import-journees"></a>

### **Mode Journées avec l'onglet 1 : **Si votre organisation est en mode journées, l'import via l'onglet 1 fonctionne aussi. Le système classe les joueurs par points de match (puis moyenne en cas d'égalité) et attribue automatiquement les **points de position **selon le barème configuré dans **Paramètres > Types de Tournoi > Points par position **. Cependant, cette méthode ne distingue pas les phases (poules vs classements vs tableau) — pour un classement plus précis en mode journées, utilisez l'onglet 2 (Import Matchs E2i). Onglet 2 — Import Matchs E2i (recommandé en mode Journées)

L'onglet **« Import Matchs E2i » **permet d'importer directement les fichiers CSV de matchs individuels exportés depuis **telemat.org / E2i **. Cette méthode est recommandée en mode journées car elle détecte automatiquement les phases de la journée et calcule le classement final en conséquence.

<a name="import-matchs-e2i"></a>

#### IMG-11B 📷 Import Matchs E2i — Mode Journées Capture de l'onglet Import Matchs E2i avec les 4 zones de dépôt par phase (Poules, Demi-finales, Finale/Petite Finale, Classement) Format attendu

Les fichiers CSV sont au format E2i (séparateur point-virgule, 20 colonnes) :

No Phase;Date match;Billard;Poule;Licence J1;Joueur 1;Pts J1;Rep J1;Ser J1;Pts Match J1;Moy J1;Licence J2;Joueur 2;Pts J2;Rep J2;Ser J2;Pts Match J2;Moy J2;NOMBD;Mode de jeu

Chaque fichier correspond à une poule ou phase (POULE A, POULE B, DEMI-FINALE, Classement 07-08, etc.).

#### Processus d'import
1. **Sélectionner l'onglet « Import Matchs E2i » **sur la page d'import de compétition.
2. **Choisir la catégorie : **Mode de jeu, classement FFB, numéro du tournoi, date. Les champs **Lieu **et **Lieu 2 **sont remplis automatiquement à partir du calendrier. Modifiables si besoin.
  - **Ajouter les fichiers CSV par phase : **La page affiche des zones de dépôt séparées : **Poules **— toujours visible, fichiers des matchs de poule (POULE A, POULE B, etc.)
  - **Demi-finales **— visible en mode journées
  - **Finale / Petite Finale **— visible en mode journées
  - **Classement **— visible en mode journées, fichiers de type « Classement 05-06 », « Classement 07-08 »
3. Déposez chaque fichier CSV dans la zone correspondant à sa phase.
4. **Aperçu : **Cliquer sur « Aperçu des résultats » pour vérifier le tableau calculé avant import. Le tableau affiche pour chaque joueur : CLT, Clt poule, PM, Pts, Reprises, MS, MGP, MPART, et en mode journées les Pts clt et bonus.
5. **Sauvegarder : **Cliquer sur « Sauvegarder les résultats ». Les résultats sont enregistrés, les bonus calculés, et les classements de saison recalculés automatiquement.

#### Calculs effectués automatiquement
- **Agrégation : **Les matchs individuels sont agrégés par joueur (total points, reprises, meilleure série, moyenne, nombre de matchs).
- **Classement par poule : **Les joueurs sont classés au sein de chaque poule par PM (desc) → Moyenne (desc) → MS (desc).
- **Classement final : **Si des phases de classement (DEMI-FINALE, FINALE, Classement 07-08) sont présentes, elles déterminent le classement final. Positions 1-4 par le tableau (SF → F/PF), positions 5-N par les matchs de classement. Pour les joueurs sans match de classement, le **numéro de phase **(première colonne du CSV E2i) est le critère principal : un joueur ayant atteint une phase supérieure est toujours classé devant un joueur d'une phase inférieure. En cas d'égalité de phase : confrontation directe, puis classement de poule, puis performance globale. Si aucune phase de classement n'est présente, le classement est calculé par interclassement des positions de poule.
- **MPART (Meilleure Partie) : **La meilleure moyenne sur un seul match, calculée sur les matchs gagnés.
- **Points de position (mode journées) : **Attribués automatiquement selon le barème configuré (Paramètres > Types de Tournoi > Points par position).
- **Bonus moyenne (mode journées) : **Bonus de 0 à +3 points selon la moyenne du joueur par rapport aux seuils de sa catégorie (mini, milieu, maxi).
- **Recalcul global : **Tous les bonus et les classements de saison sont recalculés après chaque import.

> 
> 
<a name="phase-finale-bracket"></a>

### **Dégradation du dernier joueur : **En mode journées, une option dans **Paramètres > Types de Tournoi > Points par position **permet d'activer la dégradation du dernier joueur : le dernier classé reçoit les points de la position N+1 (par exemple, s'il y a 10 joueurs, le 10e reçoit les points du 11e). **En résumé : **Avec l'Import Matchs E2i, le processus est simple : remplissez les 4 zones de dépôt avec vos fichiers CSV (poules, demi-finales, finale, classement), cliquez sur « Aperçu des résultats », vérifiez, puis sauvegardez. Le système calcule automatiquement le classement complet de la journée. C'est tout ! Phase Finale manuelle (Tableau) — Alternative sans fichiers CSV

Si vous ne disposez pas des fichiers CSV des phases finales (demi-finales, finale, classement), une page dédiée permet de **saisir manuellement **les résultats de la phase finale match par match. Accessible depuis l'écran de résultats d'un tournoi en mode journées, ou via l'URL `tournament-bracket.html?id=X `.

> 
#### **Note : **Si vous utilisez l'Import Matchs E2i avec les 4 fichiers CSV, cette page n'est **pas nécessaire **— tout est calculé automatiquement lors de l'import. Fonctionnement
1. **Génération du tableau : **Le système identifie les meilleurs joueurs des poules et génère les matchs (demi-finales + matchs de classement).
2. **Saisie des résultats : **Pour chaque match, saisir les points et reprises, puis valider. La Finale et la Petite Finale sont générées après les demi-finales.
3. **Validation finale : **Cliquer sur « Valider les positions » pour attribuer les positions, les points de position, et recalculer le classement saison.

<a name="ecran-resultats"></a>

### Écran de résultats d'un tournoi

La page de résultats d'un tournoi s'affiche en cliquant sur l'icône **œil **dans la liste des tournois, ou via le lien « Voir le détail » après un import. Le titre indique le numéro du tournoi (ex. « Classement du Tournoi 2 » ou « Classement de la Finale Départementale »).

#### En-tête

L'en-tête affiche : la **saison **, la **date **, le **lieu **et le nombre de **participants **. Si le bonus moyenne est activé, un bandeau d'information résume les paliers du bonus (mini, milieu, maxi et points attribués).

#### Mode Standard — Colonnes du tableau

| IMG-11D 📷 Résultats d'un tournoi — Mode Standard Capture de l'écran de résultats en mode standard avec les colonnes CLT, Licence, Joueur, Club, Pts Match, Bonus, Total, Points, Reprises, Moyenne, MS Colonne | Description |
| --- | --- |
| CLT | Classement final dans le tournoi |
| Licence | Numéro de licence FFB |
| Joueur | Nom et prénom (cliquable → historique du joueur) |
| Club | Club du joueur (avec logo si disponible) |
| Clt poule | Classement dans la poule (si import E2i matchs) |
| Pts Match | Total des points de match |
| Bonus | Colonnes de bonus dynamiques (si configurées dans le barème) |
| Total | Total points de match + bonus |
| PM | Parties menées (si disponible) |
| Points | Total des caramboles |
| Reprises | Total des reprises jouées |
| Moyenne | Moyenne générale (points/reprises) |
| MS | Meilleure série |

#### Mode Journées — Colonnes du tableau

![Résultats tournoi — mode journées](screenshots/11e-resultats-journees.png)

| IMG-11E 📷 Résultats d'un tournoi — Mode Journées Capture de l'écran de résultats en mode journées avec les colonnes CLT, Licence, Joueur, Club, Clt poule, Clt Finale, Pts clt, bonus, Pts Clt Total, PM, Pts, R, MS, MGP, MPART Colonne | Description |
| --- | --- |
| CLT | Position finale dans le tournoi (déterminée par le tableau + matchs de classement) |
| Licence | Numéro de licence FFB |
| Joueur | Nom et prénom (cliquable → historique du joueur) |
| Club | Club du joueur (avec logo si disponible) |
| Clt poule | Classement dans la poule de qualification (matin) |
| Clt Finale | Position finale issue du tableau et des matchs de classement (après-midi) |
| Pts clt | Points de classement attribués selon le barème de position (ex. 1er = 34 pts) |
| Bonus | Bonus moyenne (0 à +3 selon la moyenne par rapport aux seuils de la catégorie) |
| Pts Clt Total | Score total du tournoi = Pts clt + Bonus |
| PM | Points de match cumulés (toutes phases) |
| Pts | Total des caramboles |
| R | Total des reprises |
| MS | Meilleure série |
| MGP | Moyenne Générale du Parcours (points/reprises sur l'ensemble du tournoi) |
| MPART | Meilleure Partie (meilleure moyenne sur un seul match gagné) |

#### Détail des matchs (Import E2i uniquement)

Lorsque les résultats proviennent d'un import E2i (onglet 2), une section repliable **« Détail des matchs » **apparaît sous le tableau. Elle liste tous les matchs individuels par poule, avec les scores détaillés de chaque joueur. Le gagnant est affiché en vert et en gras.

#### Boutons d'action
- **Voir le classement de la catégorie : **Lien direct vers le classement saison de la catégorie
- **Exporter en Excel : **Télécharge les résultats au format Excel
- **Recalculer bonus & classements : **Force le recalcul de tous les bonus et du classement saison (utile après modification de paramètres)

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

Vue d'ensemble de tous les tournois internes (T1, T2, T3, Finale) avec leurs résultats. Cette page est identique quel que soit le mode de qualification (Standard ou Journées).

### Filtres
- **Recherche **: Recherche libre par nom de catégorie
- **Mode de jeu **: Libre, Cadre, Bande, 3 Bandes
- **Classement FFB **: N1, N2, R1, R2, etc.
- **Saison **: Saisons disponibles
- **Numéro de tournoi **: 1, 2, 3, Finale

### Informations affichées

| Colonne | Description |
| --- | --- |
| Catégorie | Nom de la catégorie (ex. Bande R1) |
| Tournoi | Numéro ou nom du tournoi (T1, T2, T3, Finale Départementale) |
| Saison | Saison du tournoi (ex. 2025-2026) |
| Participants | Nombre de joueurs ayant participé |
| Date | Date du tournoi |
| Lieu | Lieu du tournoi (et lieu secondaire si tournoi réparti sur 2 sites) |
| Actions | Voir les résultats, modifier, statut d'envoi email, supprimer |

### Actions disponibles
- **Voir les résultats **(icône œil) : Ouvre la page de résultats détaillés du tournoi
- **Modifier **(icône crayon, admin) : Permet de modifier le lieu et le statut d'envoi des résultats
- **Statut email **(icône email, admin) : Indique si les résultats ont été envoyés par email. Cliquer pour basculer le statut ou accéder à l'envoi des résultats.
- **Supprimer **(icône poubelle, admin) : Supprime le tournoi et recalcule les classements

### Boutons en haut de page
- **Exporter Excel : **Exporte la liste complète des tournois au format Excel
- **Tout marquer envoyé : **Marque tous les tournois comme « résultats envoyés » en un clic
- **Importer un Tournoi : **Lien vers la page d'import de résultats (admin uniquement)

---

## Menu : Calendrier

### Accès

Cliquer sur "Calendrier" dans la barre de navigation

![Calendrier](screenshots/12-calendrier.png)

### IMG-12 📷 Calendrier des compétitions Capture de la vue calendrier mensuelle avec les compétitions en couleur par mode de jeu et le bouton "Ajouter une compétition" Vue calendrier
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
1. Aller dans **Compétitions > Liste des tournois externes **
2. Repérer la compétition à supprimer dans la liste
3. Cliquer sur le bouton rouge **"Supprimer" **sur la ligne correspondante
4. Confirmer la suppression dans la boîte de dialogue

> 
> 
---

## **Attention : **La suppression est irréversible. Toutes les inscriptions liées à cette compétition seront également supprimées. Cette action est réservée aux administrateurs. **Lien avec l'Application Joueur : **Le calendrier est visible par les joueurs dans l'Application Joueur. Les joueurs peuvent s'inscrire directement aux compétitions à venir depuis leur application. Les inscriptions apparaissent automatiquement dans l'application de gestion.

---

## Calendrier > Téléverser le fichier calendrier (PDF ou Excel)

### Description

Cette fonctionnalité permet à l'administrateur de téléverser le **fichier calendrier officiel de la saison** (PDF ou Excel) pour le rendre consultable et téléchargeable par l'ensemble des utilisateurs de l'application — administrateurs, éditeurs, lecteurs, et joueurs via l'Espace Joueur.

Il ne s'agit pas du même écran que la vue calendrier mensuelle (qui affiche les compétitions saisies dans l'application) : ici, il s'agit du **document de référence** de la saison (souvent un Excel édité par le comité, ou sa version PDF).

### Accès

Depuis la barre de navigation, cliquer sur **"Calendrier"**. Seuls les administrateurs voient le bloc "Téléverser le calendrier" en haut de page.

### Étapes

1. **Sélectionner la saison** dans le menu déroulant (par défaut : la prochaine saison à partir d'avril, sinon la saison courante).
2. **Choisir le fichier** (format accepté : `.pdf`, `.xlsx`, `.xls`) depuis votre ordinateur. Le nom du fichier n'a pas d'importance.
3. **Cliquer sur "Téléverser"**. Le fichier remplace immédiatement le précédent (un seul calendrier actif par CDB).

> **Renommage automatique :** lors du téléversement, le fichier est automatiquement renommé par le serveur selon le format `Calendrier {SIGLE DU CDB} {saison}.{extension}` (exemple : `Calendrier CDBHS 2026-2027.xlsx`). Vous pouvez donc envoyer votre fichier sous n'importe quel nom — le système garantit un nommage cohérent et lisible.

> **Alerte "calendrier de la saison précédente" :** si la saison encodée dans le nom du fichier ne correspond plus à la saison courante (par exemple, si nous sommes en septembre et que le calendrier affiché est encore celui de l'année dernière), un bandeau orange s'affiche sous "Calendrier actuel" pour inviter l'administrateur à téléverser le nouveau calendrier. Ce bandeau disparaît automatiquement dès qu'un fichier à jour est téléversé.

### Qui peut voir le calendrier ?

- **Administrateurs, éditeurs, lecteurs** — le calendrier s'affiche dans la page "Calendrier" (avec bouton "Télécharger").
- **Joueurs via l'Espace Joueur** — accessible depuis l'onglet "Compétitions CDB", bouton "Voir le calendrier".

### Durée de conservation

Un seul calendrier est conservé en base par CDB : **le plus récent**. Lorsqu'un nouveau fichier est téléversé, l'ancien est automatiquement supprimé. Il n'est donc pas nécessaire de faire un nettoyage manuel entre deux saisons.

> **Bonnes pratiques :**
> - Téléversez le calendrier de la prochaine saison **avant le 1er septembre** pour éviter l'alerte "saison précédente".
> - Une fois le fichier Excel téléversé, vous pouvez enchaîner avec la fonction "Générer les tournois de la saison" pour créer automatiquement toutes les compétitions.

---

## ✨ Compétitions > Assistant Calendrier (génération automatique)

### À quoi sert cet assistant ?

L'**Assistant Calendrier** remplace le travail manuel de construction du calendrier de saison sous Excel. Il produit automatiquement un calendrier complet — tous les tournois (T1, T2, T3, Finale) de toutes les catégories actives, placés sur des week-ends et chez des clubs hôtes — en respectant les contraintes que vous avez définies (espacement, jours autorisés, indisponibilités, équilibre entre clubs, etc.).

Le résultat est **modifiable manuellement** et peut être **verrouillé partiellement** pour permettre une régénération en cours de saison sans perdre vos décisions déjà annoncées aux joueurs.

> **Réservé aux administrateurs.** Le lien "Assistant Calendrier" dans le menu Compétitions n'est visible qu'aux comptes admin.

### Workflow en 3 étapes (V1 actuelle)

1. **Étape 1 — Brief de saison** : décrire le cadre (saison, dates, catégories actives, clubs hôtes, blackouts...)
2. **Étape 2 — Règles & contraintes** : valider/ajuster les règles que le moteur respectera
3. **Étape 3 — Génération du calendrier** : lancer le moteur, visualiser, modifier, télécharger

### Étape 1 — Brief de saison

Décrivez la réalité de votre saison :

- **Saison à planifier** (ex. 2026-2027), **jour des qualificatifs / des finales**, **premier et dernier week-end de compétition** (date butoir).
- **Modes & catégories actifs**, **clubs hôtes confirmés**.
- **Week-ends blackout** (vacances, finales fédérales).
- **Indisponibilités par club** (travaux, fermeture exceptionnelle) avec dates de début/fin et motif optionnel.
- **Dates des finales de ligue** par catégorie (optionnel — la finale CDB sera placée avant).
- **Attribution du lieu des finales** : "Manuelle" ou "Vainqueur des qualifications" (TBD à l'issue du T3).

Cliquer "💾 Sauvegarder le brief" puis "Étape suivante : Règles →".

### Étape 2 — Règles & contraintes

Pour 80 % des CDB, un seul clic suffit : **"💾 Charger et adapter les règles habituelles"**. Cela pré-remplit la bibliothèque V1 (sous-ensemble standard du catalogue).

Deux tableaux à ajuster ensuite :

- **Règles obligatoires** : le moteur refuse de les violer (≥ 3 sem. entre tournois d'une même catégorie, pas 2 tournois pour un même club / week-end, etc.).
- **Règles souhaitées** : optimisées par le moteur avec un poids ajustable (équilibre entre clubs hôtes, étalement des modes, anti-cluster sur les week-ends).

> **Assistance IA** : un bloc violet permet de décrire une règle en français (ex. "Clichy ne doit jamais accueillir deux week-ends d'affilée"). L'IA traduit en règle structurée et vous validez avant ajout.

### Étape 3 — Génération du calendrier

Cliquer **"⚡ Tout régénérer"** lance le moteur. Le résultat apparaît en quelques secondes.

**Trois vues du calendrier** (boutons en haut) :
- **Vue calendrier** (par défaut, façon Excel) : lignes = catégories, colonnes = week-ends, cellules colorées par club.
- **Compacte par catégorie** : lignes = catégories, colonnes = T1/T2/T3/Finale.
- **Par club hôte** : lignes = clubs, colonnes = mois.

**Réglages rapides** : un panneau permet de modifier 4 paramètres clés (sem. min, max par WE) **uniquement pour cette simulation**. Cliquer "💾 Conserver ces réglages..." pour les sauvegarder définitivement.

**Modification manuelle** : cliquer sur n'importe quelle cellule remplie de la Vue calendrier ouvre un popup pour changer la date, le club hôte, **🔒 verrouiller** la cellule, et ajouter un commentaire. Sauvegarde immédiate.

**Régénération avec verrous (en cours de saison)** :
- **"⚡ Tout régénérer"** : remplace TOUT le calendrier (efface aussi les verrous).
- **"🔒 Régénérer en gardant mes verrous"** : préserve les cellules verrouillées et recalcule uniquement le reste.

**Conflits** : si le moteur n'a pas pu placer un tournoi, un panneau rouge liste les conflits avec un diagnostic chiffré (ex. "12× après le dernier week-end · 4× < 3 sem. depuis T2 · 2× blackout").

**Téléchargement Excel** (3 onglets) : Calendrier visuel A3 paysage avec logo CDB, mois fusionnés, cellules colorées par club + Liste des tournois auto-filtrable + Légende clubs.

### Cas d'usage concret en cours de saison

**Exemple :** la finale ligue Bande R1 change après envoi des convocations.
1. Ouvrir Étape 3, verrouiller 🔒 toutes les cellules déjà annoncées aux joueurs.
2. Mettre à jour la date de la finale ligue dans Étape 1.
3. Cliquer "🔒 Régénérer en gardant mes verrous". Le moteur préserve les verrous et ajuste autour.

### Affichage pour joueurs et lecteurs

Le calendrier généré est consultable par tous via **Compétitions > Calendrier**, section "Calendrier généré" en haut. Le sélecteur de saison permet de basculer entre saisons. Les non-admins voient uniquement la saison courante et les saisons passées (les drafts en cours de préparation sont masqués).

---

## Calendrier > Dédoubler un tournoi

### Quand utiliser le dédoublement ?

Lorsqu'une compétition reçoit trop d'inscriptions pour se dérouler sur un seul site, il est possible de **dédoubler **le tournoi en deux sous-tournois (A et B), chacun organisé dans un lieu différent. Les résultats des deux sous-tournois sont ensuite fusionnés pour produire un classement unique.

> 
### **Exemple : **Le tournoi T1 de Libre R2 reçoit 24 inscriptions. La salle habituelle ne peut accueillir que 12 joueurs. L'administrateur dédouble le tournoi : 12 joueurs jouent à Courbevoie (A), 12 joueurs jouent à Châtillon (B). Les résultats des deux salles sont fusionnés en un seul classement T1 Libre R2. Comment dédoubler un tournoi

Le dédoublement est accessible depuis deux endroits :

#### Depuis la page Compétitions (recommandé)
1. Aller sur la page **Compétitions **(page principale de gestion des poules)
2. Dans la section **« Compétitions à venir » **, repérer le tournoi souhaité. Le bouton **« Dédoubler (2 lieux) » **apparaît automatiquement lorsqu'un tournoi a **plus de 6 inscrits **.
3. Cliquer sur le bouton **« Dédoubler (2 lieux) » **
  - Dans la fenêtre qui s'affiche, sélectionner les deux clubs dans les listes déroulantes : **Tournoi A **: club du premier sous-tournoi
  - **Tournoi B **: club du second sous-tournoi
4. Valider : deux sous-tournois sont créés automatiquement, identifiés par les suffixes **(A) **et **(B) **

#### Depuis la liste des tournois externes
1. Aller dans **Paramètres > Liste des tournois de la saison **
2. Repérer le tournoi à venir que vous souhaitez dédoubler
3. Cliquer sur le bouton **« Dédoubler » **sur la ligne du tournoi
4. Suivre les mêmes étapes que ci-dessus

> 
> 
---

## **Note : **Les deux lieux peuvent être le même club (par exemple, si le tournoi se déroule dans deux salles différentes du même club). **Résultat : **Le tournoi d'origine devient un tournoi « parent » et deux tournois « enfants » (A et B) apparaissent dans la liste. Les inscriptions du tournoi parent sont conservées et pourront être réparties entre A et B à l'étape suivante. Calendrier > Répartir les joueurs entre A et B

### Description

Après avoir dédoublé un tournoi, il faut répartir les joueurs inscrits entre les deux sous-tournois. L'application propose une répartition automatique équilibrée (serpentine) et permet des ajustements manuels.

### Processus de répartition
1. Depuis la page **Compétitions **(bouton **« Répartir les joueurs A/B » **sur la carte du tournoi dédoublé) ou depuis la **liste des tournois externes **(bouton **« Répartir » **sur la ligne du tournoi)
2. **Répartition automatique (serpentine) : **Cliquer sur **« Répartition automatique (serpentine) » **pour distribuer les joueurs de manière équilibrée entre A et B en fonction de leur classement. Les joueurs sont alternés : le 1er va en A, le 2e en B, le 3e en B, le 4e en A, etc. (serpentine), ce qui garantit un niveau homogène entre les deux sous-tournois.
3. **Ajustements manuels : **Vous pouvez ensuite modifier la répartition en cliquant sur un joueur pour le déplacer de A vers B ou de B vers A.
4. Une fois satisfait de la répartition, cliquer sur **« Enregistrer » **pour sauvegarder.

> 
---

## **Conseil : **La répartition en serpentine est recommandée car elle assure un équilibre de niveau entre les deux sous-tournois. Les ajustements manuels permettent ensuite de prendre en compte des contraintes logistiques (proximité géographique d'un joueur, préférences, etc.). Compétitions > Importer les résultats d'un tournoi dédoublé

### Description

Lors de l'import des résultats d'un tournoi qui a été dédoublé, la page d'import affiche **deux zones de dépôt **distinctes : une pour le sous-tournoi A et une pour le sous-tournoi B.

### Processus d'import
1. Aller dans **Compétitions > Résultats **
2. Sélectionner la catégorie et le numéro de tournoi correspondant au tournoi dédoublé
  - La page détecte automatiquement que le tournoi est dédoublé et affiche **deux zones de dépôt **: **Zone A **: déposer le fichier CSV des résultats du lieu A
  - **Zone B **: déposer le fichier CSV des résultats du lieu B
3. Déposer chaque fichier CSV dans la zone correspondante
4. Cliquer sur **« Enregistrer la compétition » **
5. Les résultats des deux sous-tournois sont **fusionnés automatiquement **en un classement unique pour la catégorie

> 
---

## **Fusion des résultats : **Le classement final du tournoi combine les résultats des deux lieux. Les joueurs sont classés ensemble, comme s'ils avaient participé à un seul tournoi. Le classement saison est recalculé automatiquement après l'import. Calendrier > Annuler un dédoublement

### Description

Si le dédoublement n'est finalement plus nécessaire (par exemple, en cas de désistements ramenant le nombre de joueurs à un niveau gérable sur un seul site), il est possible d'annuler le dédoublement.

### Conditions

> 
### **Attention : **L'annulation du dédoublement n'est possible que si les convocations n'ont pas encore été envoyées pour les sous-tournois A et B. Une fois les convocations envoyées, le dédoublement ne peut plus être annulé. Processus d'annulation
1. Sur la ligne du tournoi dédoublé dans la liste des tournois externes, cliquer sur le bouton **« Annuler split » **
2. Confirmer l'annulation dans la boîte de dialogue

### Conséquences de l'annulation
- Les sous-tournois A et B sont supprimés
- Les affectations de joueurs aux sous-tournois sont effacées
- Le tournoi parent retrouve son état initial avec toutes les inscriptions d'origine

---

## Menu : Com Joueurs (Communication Joueurs)

### Accès

Cliquer sur "Com joueurs" dans la barre de navigation

### Sous-menus / Onglets disponibles
- Notifications Push
- Annonces
- Composer un email
- Relances
- Résultats Tournoi
- Résultats Finale
- Gestion Contacts
- Templates
- Historique
- Programmés
- Sondages

---

## Com Joueurs > Notifications Push

### Description

Envoi de notifications push instantanées vers l'Application Joueur (Espace Joueur) installée sur les smartphones des joueurs. Les notifications apparaissent directement sur l'écran du téléphone, même si l'application n'est pas ouverte.

> - **📱 Compatibilité : ****Android : **Fonctionne partout (avec ou sans PWA installée)
- **iOS : **Fonctionne uniquement si l'Espace Joueur a été ajouté à l'écran d'accueil (PWA installée)

![Notifications Push](screenshots/12a-notifications-push.png)

#### IMG-12A 📷 Notifications Push Capture de l'onglet Notifications Push avec le formulaire d'envoi (destinataires, titre, message, destination) et l'historique des notifications envoyées Envoyer une notification push

**Étape 1 : Sélectionner les destinataires **
- **Tous les joueurs **: Envoie à tous les joueurs ayant activé les notifications
- **Liste de licences **: Envoie uniquement aux licences spécifiées (une par ligne, maximum 15)

**Étape 2 : Composer la notification **
- **Titre **: Titre court (50 caractères maximum) - Ex: "Rappel Important"
- **Message **: Contenu de la notification (150 caractères maximum) - Ex: "N'oubliez pas de vous inscrire avant le 15 mars pour le tournoi Libre N2"
  - **Destination **: Page de l'Espace Joueur à ouvrir quand le joueur clique sur la notification 🏠 Page d'accueil
  - 🏆 Vos compétitions
  - 📝 Inscriptions
  - 📊 Stats
  - 📅 Compétitions CDB
  - 👤 Profil & FAQ
  - ✉️ Contact
  - 🔗 URL personnalisée (ex: lien vers un article WordPress)

> 
**🔗 URL personnalisée : **Permet de diriger les joueurs vers n'importe quel lien externe (ex: article du site web, page d'inscription externe, formulaire en ligne). Saisissez l'URL complète commençant par `https:// `**Étape 3 : Prévisualiser et envoyer **
- Vérifiez l'aperçu de la notification (affichage comme sur le téléphone)
- Cliquez sur **📤 Envoyer la notification **
- La notification est envoyée instantanément aux joueurs abonnés

#### Statut des abonnements

En haut à droite du formulaire, vous voyez le nombre de joueurs abonnés aux notifications push :
- **Exemple : **"12 / 58 abonnés (21%)"
- Seuls les joueurs ayant autorisé les notifications dans l'Espace Joueur recevront les notifications
- **Liste détaillée : **Cliquez sur le pourcentage pour afficher la liste complète des joueurs abonnés avec leur nom, licence, club et nombre d'appareils enregistrés

> 
#### **📱 Plusieurs appareils : **Un joueur peut recevoir les notifications sur plusieurs appareils (smartphone personnel, tablette, etc.). Le compteur d'appareils indique le nombre d'inscriptions actives par joueur. Historique des notifications envoyées

Le tableau d'historique affiche toutes les notifications envoyées avec :
- **Date et heure **d'envoi
- **Titre et message **de la notification
- **Destinataires **: "Tous les joueurs" ou nombre de licences ciblées
- **Envoyés **: Nombre de notifications effectivement envoyées
- **Action Supprimer **: Supprime l'entrée de l'historique (n'affecte pas les notifications déjà reçues par les joueurs)

- **⚠️ Important : **Les notifications sont **instantanées et définitives **- vérifiez bien le contenu avant d'envoyer
- Respectez une fréquence raisonnable pour ne pas surcharger les joueurs
- Utilisez un langage clair et concis (limites de caractères)

#### Cas d'usage recommandés
- **Rappel date limite inscription **: "Plus que 3 jours pour vous inscrire au tournoi Cadre 47/2 du 28/03"
- **Résultats publiés **: "Les résultats du tournoi 3 Bandes N2 sont disponibles !"
- **Changement de dernière minute **: "Attention : Le tournoi Libre R1 est reporté au 05/04"
- **Annonce importante **: "Assemblée Générale le 15 juin - Tous les joueurs sont invités"

> 
---

## **💡 Astuce : **Les joueurs peuvent gérer leurs notifications dans l'Espace Joueur → Paramètres → "Recevoir les notifications push". Ils peuvent consulter l'historique de leurs notifications reçues via l'icône 🔔 en haut de l'écran. Com Joueurs > Annonces

### Description

Publication d'annonces visibles dans l'Application Joueur.

![Annonces](screenshots/13-annonces.png)

#### IMG-13 📷 Annonces Capture de la page annonces avec le formulaire de création (titre, message, type) et la liste des annonces existantes avec leur statut Créer une annonce

**Champs à remplir : **
- **Titre **: Titre de l'annonce
- **Message **: Contenu de l'annonce
- **Type **: INFO Information générale, ALERTE Message important (déclenche une notification push automatique), RESULTATS Résultats de compétition, PERSO Message personnel ciblé

> 
**📲 Notification push automatique : **Lorsque vous créez une annonce de type ALERTE (urgente), une notification push est automatiquement envoyée à tous les joueurs ayant activé les notifications dans l'Espace Joueur. Cela garantit que les messages importants sont reçus instantanément, en complément de l'affichage dans l'application. **Options avancées : **
- **Date d'expiration **: L'annonce disparaît automatiquement après cette date
- **Mode Test **: Envoie l'annonce uniquement à une licence spécifique pour test
- **Destinataire **: Tous les joueurs ou un joueur spécifique (saisir la licence)

#### Gérer les annonces existantes

**Actions par annonce : **
- **Activer / Désactiver **: Rend visible ou masque l'annonce
- **Supprimer **: Supprime définitivement l'annonce

#### Purger les annonces

Section pliable permettant de supprimer en lot les annonces expirées, inactives, ou par période.

> 
---

## **Lien avec l'Application Joueur : **Les annonces actives et non expirées apparaissent dans l'Application Joueur. Les annonces PERSO n'apparaissent que pour le joueur ciblé. Com Joueurs > Composer un email

### Description

Envoi d'emails de masse à un groupe de joueurs.

![Composer un email](screenshots/14-composer-email.png)

#### IMG-14 📷 Composer un email Capture de la page d'envoi d'email avec les filtres de destinataires, l'éditeur riche et les variables disponibles Étape 1 : Sélectionner les destinataires

**Filtres disponibles : **
- **Actifs seulement **: Exclut les joueurs inactifs
- **Utilisateurs Espace Joueur **: Uniquement ceux ayant créé un compte
- **Par club **, **Par mode de jeu **, **Par classement FFB **
- **Par tournoi **: Joueurs inscrits à un tournoi spécifique
- **Par classement saison **: Joueurs présents dans un classement

#### Étape 2 : Composer le message

**Champs : **Objet + Corps du message (éditeur riche avec mise en forme)

**Variables disponibles : **

| Variable | Description |
| --- | --- |
| `{player_name} ` | Nom complet du joueur |
| `{first_name} ` | Prénom |
| `{last_name} ` | Nom |
| `{club} ` | Club du joueur |
| `{category} ` | Catégorie (si applicable) |
| `{tournament} ` | Numéro du tournoi (T1, T2, T3, Finale) |
| `{tournament_date} ` | Date du tournoi |
| `{tournament_lieu} ` | Lieu du tournoi |
| `{distance} ` | Distance de jeu |
| `{reprises} ` | Nombre de reprises |
| `{organization_name} ` | Nom complet de l'organisation |
| `{organization_short_name} ` | Sigle de l'organisation |
| `{organization_email} ` | Email de contact de l'organisation |

> 
#### **Modèles par défaut : **Pour les relances (T1, T2, T3, Finale), il est possible d'enregistrer le message comme modèle par défaut. Ce modèle sera pré-rempli automatiquement lors des prochaines relances du même type. Étape 3 : Mode test (recommandé)
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

## Com Joueurs > Notifs (Notifications Push)

### Description

Envoi de notifications push instantanées vers l'Application Joueur. Les notifications apparaissent directement sur le téléphone des joueurs, même lorsque l'application n'est pas ouverte.

> 
![Notifications Push](screenshots/14b-notifications-push.png)

### **📱 Avantage des notifications push : **Contrairement aux emails, les notifications push sont instantanées et ont un taux d'ouverture beaucoup plus élevé. Idéales pour les communications urgentes (changement de dernière minute, rappel important, etc.). IMG-14B 📷 Onglet Notifs Capture de l'interface d'envoi de notifications push avec sélection des destinataires et aperçu Accès
1. Menu principal : **Com Joueurs **
2. Onglet : **🔔 Notifs **(premier onglet)

### Étape 1 : Sélectionner les destinataires

**Deux modes disponibles : **
- **📋 Liste de licences **(par défaut) : Saisir les numéros de licence manuellement (un par ligne, maximum 15)
- **👥 Tous les joueurs **: Envoyer à tous les joueurs ayant activé les notifications dans l'Application Joueur

### **⚠️ Important : **Seuls les joueurs ayant activé les notifications push dans l'Espace Joueur recevront la notification. Les joueurs n'ayant pas encore accepté les notifications ne la recevront pas. Étape 2 : Composer la notification

**Champs obligatoires : **
  - **Titre **(50 caractères maximum) : Titre court et accrocheur <br>*Exemple : "Rappel Important" ***Message **(150 caractères maximum) : Message concis et clair <br>*Exemple : "N'oubliez pas de vous inscrire avant le 15 mars pour le tournoi Libre N2" ***Destination **: Page de l'Application Joueur à ouvrir lorsque le joueur tape sur la notification 🏠 Page d'accueil
  - 🏆 Vos compétitions
  - 📝 Inscriptions
  - 📊 Stats
  - 📅 Compétitions CDB
  - 👤 Profil & FAQ
  - ✉️ Contact

> 
### **📱 Aperçu en direct : **L'interface affiche un aperçu en temps réel de la notification telle qu'elle apparaîtra sur le téléphone du joueur. Étape 3 : Envoyer la notification
  1. Vérifier le titre, le message et la destination dans l'aperçu
  2. Cliquer sur **📤 Envoyer la notification **
  3. Confirmer l'envoi dans la boîte de dialogue
  4. Message de confirmation : "✅ Notification envoyée à X joueur(s)"

### Historique des notifications envoyées

L'historique apparaît en bas de la page et affiche :
  - **Date et heure **d'envoi
  - **Titre **de la notification
  - **Message **envoyé
  - **Destinataires **: Nombre de joueurs ciblés
  - **Envoyés **: Nombre de notifications effectivement envoyées
  - **Actions **: Bouton de suppression 🗑️

#### Supprimer des notifications de l'historique

**Sur ordinateur : **
  - Cliquer sur le bouton 🗑️ dans la colonne "Actions"
  - Confirmer la suppression

**Sur mobile/tablette : **
  - Glisser la ligne de droite à gauche (swipe)
  - Un fond rouge apparaît pour confirmer l'action
  - Relâcher après 120 pixels pour supprimer

> 
### **💡 Bon à savoir : **La suppression de l'historique n'affecte pas les notifications déjà reçues par les joueurs. Elle permet uniquement de nettoyer l'interface administrateur (par exemple, pour supprimer les notifications de test). Notifications automatiques

Certaines actions dans l'application déclenchent automatiquement l'envoi de notifications push aux joueurs concernés, sans intervention manuelle de votre part. Ces notifications sont envoyées instantanément et apparaissent également dans l'historique.

#### Liste complète des notifications automatiques

| Type de notification | Événement déclencheur | Destinataires |
| --- | --- | --- |
| **🔔 Convocation ** | Envoi des convocations depuis "Tournois > Générer poules" | Joueurs convoqués pour le tournoi |
| **⏰ Rappel Inscriptions ** | *Automatique quotidien à 9h : *tournois dont la date limite d'inscription est le lendemain | Joueurs non encore inscrits |
| **📊 Résultats publiés ** | Import des résultats d'un tournoi (CSV) | Tous les participants du tournoi |
| **⚠️ Annonce urgente ** | Création d'une annonce de type "Urgent" dans Com joueurs > Annonces | Tous les joueurs actifs de votre comité |
| **🏆 Qualification Finale ** | *Automatique : *après import des résultats du dernier tournoi qualificatif (T3) | Joueurs qualifiés pour la finale (top 4 ou 6 selon effectif) |
| **🎯 Nouveau tournoi ** | Création d'un nouveau tournoi dans "Tournois" | Tous les joueurs actifs de votre comité |
| **📝 Date modifiée ** | Modification de la date d'un tournoi existant | Joueurs inscrits à ce tournoi |
| **📍 Lieu modifié ** | Modification du lieu d'un tournoi existant | Joueurs inscrits à ce tournoi |
| **❌ Tournoi annulé ** | Changement du statut d'un tournoi vers "Annulé" | Joueurs inscrits à ce tournoi |
| **✅ Inscription confirmée ** | Joueur s'inscrit via l'Espace Joueur | Le joueur qui s'inscrit |
| **⚠️ Forfait enregistré ** | Joueur déclare forfait via l'Espace Joueur | Le joueur qui déclare forfait |
| **🎉 Bienvenue ** | Création d'un compte Espace Joueur | Le nouveau joueur |
| **📰 Article publié ** | Publication d'un article de résultats sur votre site WordPress | Participants du tournoi concerné |

>   - **🎯 Total : **12 types de notifications automatiques pour tenir vos joueurs informés en temps réel. Jaune = Priorité haute (convocations, rappels, résultats)
  - Vert = Événements tournois (création, modifications, annulation)
  - Bleu = Actions depuis l'Espace Joueur

> 
### **💡 Avantage : **Ces notifications automatiques améliorent l'expérience joueur en les tenant informés en temps réel, sans effort supplémentaire de votre part. Elles complètent les emails envoyés et garantissent que les joueurs reçoivent l'information instantanément. **⚠️ Important : **Les notifications automatiques ne sont envoyées qu'aux joueurs ayant activé les notifications push dans l'Espace Joueur. Les joueurs qui n'ont pas activé les notifications continueront à recevoir uniquement les emails classiques. Côté joueur : Réception des notifications

Dans l'Application Joueur :
  1. Le joueur reçoit une notification instantanée sur son téléphone
  2. En tapant sur la notification, l'Application s'ouvre sur la page sélectionnée (destination)
  3. L'icône 🔔 (en haut à droite) affiche un badge avec le nombre de notifications non lues
  4. En tapant sur 🔔, le joueur accède au centre de notifications avec l'historique
  5. Le joueur peut supprimer les notifications en glissant de droite à gauche (swipe-to-delete)

---

## **⚠️ iOS (iPhone/iPad) : **Les notifications push ne fonctionnent que si le joueur a ajouté l'Application Joueur sur son écran d'accueil (via Partager > Ajouter à l'écran d'accueil). Sur Android, les notifications fonctionnent directement depuis le navigateur.

---

## Compétitions > 📣 Message à une catégorie

### Description

Outil de communication ciblée permettant à l'administrateur d'envoyer simultanément une notification push et/ou un email à tous les joueurs d'une catégorie de jeu (ex. Cadre 42/2 R1), ou uniquement aux joueurs inscrits à un tournoi spécifique (T1, T2, T3, Finale). Le contexte du tournoi sélectionné est pré-rempli dans le modal pour un envoi rapide.

### Accès

1. Menu principal : **Compétitions**
2. Sous-menu : **Liste des tournois externes** (`tournois-list.html`)
3. Sur la ligne du tournoi concerné, colonne **Actions**, cliquer sur le bouton ambre **📣 Message**

### Les 3 sélecteurs de cible

- **Mode de jeu** : pré-rempli depuis le tournoi cliqué, modifiable
- **Catégorie FFB** : pré-remplie, liste dynamique liée au mode
- **Tournoi** : pré-sélectionné sur le tournoi cliqué, permet de choisir :
  - **— Toute la catégorie (fichier joueurs) —** : tous les joueurs de la catégorie pour la saison (classement + inscriptions)
  - **T1 / T2 / T3 / Finale** : uniquement les joueurs inscrits à ce tournoi spécifique (hors forfait et désinscrit)

### Compteur temps réel

Affiche le nombre exact de joueurs concernés dès que mode + catégorie + tournoi sont renseignés. Exemple : *« 👥 11 joueurs inscrits à T3 — 16/05/2026 — Bois-Colombes »*

**💡 Vérifiez toujours ce compteur avant d'envoyer.**

### Modèles pré-définis

- **Message libre** (vide, par défaut)
- **Rappel convocation** (pré-remplit titre + message avec infos tournoi)
- **Changement de date / lieu** (squelette à compléter)

### Titre + Message + Aperçu

- Titre : max 200 caractères, compteur en temps réel
- Message : max 2000 caractères, retours à la ligne conservés
- Aperçu push en temps réel dans encadré ambre

### Canaux

- **📲 Push** : joueurs ayant activé les notifications dans l'App Joueur
- **✉️ Email** : tous les joueurs de la cible

Au moins un canal doit être coché. Les deux le sont par défaut.

### Confirmation avant envoi

Dialog explicite rappelant la cible et le nombre de destinataires.

### Récapitulatif administrateur

Après chaque envoi, un email est envoyé à `summary_email` avec :
- Titre et message envoyés
- Cible (tournoi spécifique ou catégorie)
- Compteurs (total / push / emails)
- **Tableau détaillé des destinataires** (nom, club, email, statut par canal : ✓ envoyé / ○ non délivré / ✗ échec / — canal non demandé)

### Cas d'usage typiques

| Situation | Cible | Modèle |
|---|---|---|
| Rappel convocation avant TQ | Tournoi spécifique | Rappel convocation |
| Changement de date / lieu TQ | Tournoi spécifique | Changement |
| Communication aux finalistes | Finale | Message libre |
| Ouverture inscriptions saison | Toute la catégorie | Message libre |

### Notes techniques

- Comptes test (licence `TEST*`) exclus automatiquement
- Joueurs désinscrit/forfait exclus des cibles « Tournoi spécifique »
- Envoi instantané (léger délai 100 ms entre emails pour respecter Resend)
- Fonction réservée aux administrateurs

### Distinction avec « Com Joueurs > Notifs »

L'onglet **Notifs** de Com Joueurs = notifications push génériques (liste de licences ou tous les abonnés). La fonction **📣 Message** = contextuelle à un tournoi/catégorie, avec pré-remplissage automatique, envoie push ET email simultanément.

---

## Com Joueurs > Historique

### Description

L'onglet **Historique** regroupe deux blocs distincts : l'historique des **campagnes d'emails** envoyées par l'administrateur (convocations, relances, résultats, etc.) et l'historique des **inscriptions / désinscriptions automatiques** déclenchées par l'Application Joueur.

### Bloc 1 — Historique des campagnes

Trace tous les envois groupés initiés par l'administrateur ou par les automatismes (rappels, alertes).

**Colonnes affichées :**
- Date d'envoi
- Type — catégorie de la campagne (Convocation, Résultats, Rappel Tournois, Composer, etc.). Depuis V 2.0.397, tous les types utilisés côté serveur sont correctement libellés (auparavant certains apparaissaient en "-").
- Sujet de l'email
- Par — utilisateur ayant déclenché l'envoi
- Dest. / Env. / Ech. — destinataires ciblés / envois réussis / échecs
- Statut (completed, sending, pending, error)

**Purger l'historique des campagnes** — bouton rouge 🗑️ *Purger l'historique* (admin uniquement). Ouvre un panneau avec deux options :

**Option A — Purger par plage de dates**
1. Renseigner les dates **Du** et **Au**
2. **Type** (depuis V 2.0.396) : filtrer sur un type précis (ex. "Rappel Tournois", "Convocation") ou laisser "Tous les types". Option spéciale *"(sans type)"* pour cibler les enregistrements dont `campaign_type` est vide. Chaque type affiche son nombre entre parenthèses.
3. ☑ **Emails TEST uniquement** : ne supprime que les lignes marquées comme TEST
4. ☑ **Uniquement les enregistrements vides (0 destinataire)** (depuis V 2.0.397) : ne supprime que les lignes fantômes à 0 destinataire — pratique pour nettoyer sans toucher à l'historique légitime
5. Cliquer sur **Supprimer** — une confirmation résume le périmètre

**Option B — Purger TOUT l'historique** (action irréversible)
1. Sélectionner éventuellement un **Type** pour limiter la portée
2. Cocher éventuellement **Emails TEST uniquement** ou **Uniquement les enregistrements vides**
3. Taper `SUPPRIMER` dans le champ de confirmation pour activer le bouton
4. Cliquer sur **Supprimer tout** puis confirmer

**Astuce pour nettoyer les entrées fantômes** : Les schedulers automatiques créaient parfois des lignes 0/0/0 en historique lorsqu'il n'y avait rien à envoyer. Bug corrigé en V 2.0.395, mais les anciennes lignes restent. Pour les nettoyer : *option A, plage de dates large, case "Uniquement les enregistrements vides" cochée*.

### Bloc 2 — Historique Inscriptions (App Joueur)

Trace les emails automatiques envoyés lors des inscriptions et désinscriptions effectuées par les joueurs via leur Application Joueur.

**Filtres :**
- Type : Inscriptions, Désinscriptions, ou tous
- Statut : Envoyé, Échec, ou tous
- Joueur : recherche libre sur le nom ou l'email
- Plage de dates : Du / Au

**Exporter en Excel** (depuis V 2.0.398) — bouton vert 📥 *Exporter*. Télécharge un fichier `historique-inscriptions-YYYY-MM-DD.xlsx` contenant toutes les lignes correspondant aux filtres actuels (sans la limite d'affichage de 200 lignes). 11 colonnes : Date, Type, Joueur, Email, Tournoi, Mode, Catégorie, Date tournoi, Lieu, Statut, Erreur. Cas d'usage : archive de fin de saison, analyse des échecs d'envoi, audit des désinscriptions par catégorie.

**Purger** (admin uniquement, depuis V 2.0.398) — bouton rouge 🗑️ *Purger*. Flux sécurisé :
1. Les deux dates sont **obligatoires** (filet de sécurité contre les suppressions totales accidentelles)
2. Premier dialogue : l'application propose d'**exporter d'abord** les données en XLSX avant suppression (recommandé)
   - "OK" : l'export se télécharge, puis l'utilisateur doit re-cliquer Purger pour passer à la confirmation finale
   - "Annuler" : passe directement à la confirmation sans export
3. Second dialogue : confirmation définitive avec rappel des dates et filtres actifs
4. Au succès : toast *"N enregistrement(s) supprimé(s)"* et la liste se recharge

**Workflow recommandé fin de saison :**
1. Régler *Du* au 1er septembre de la saison précédente, *Au* au 30 juin
2. Cliquer 🗑️ Purger → choisir **OK** (exporter d'abord)
3. Vérifier l'XLSX téléchargé, le classer dans l'archive du comité
4. Re-cliquer 🗑️ Purger → **Annuler** (sauter l'export) → confirmer la suppression

---

## Com Joueurs > Invitations Espace Joueur

### Description

Gestion des invitations envoyées aux joueurs pour créer leur compte sur l'Application Joueur.

![Invitations Espace Joueur](screenshots/15-invitations.png)

#### IMG-15 📷 Invitations Espace Joueur Capture de la page invitations avec l'onglet d'envoi (liste des joueurs) et l'onglet suivi (statuts En attente / Inscrit) Onglet "Envoyer des invitations"

**Objectif : **Inviter des joueurs à rejoindre l'Application Joueur
  - Filtres par club, par email, par statut
  - Liste des joueurs éligibles avec cases à cocher
  - Option mode test

L'email d'invitation contient : présentation de l'Application Joueur, instructions pour créer un compte, guide PDF en pièce jointe (si configuré).

#### Onglet "Suivi des invitations"

| Colonne | Description |
| --- | --- |
| Nom | Nom et prénom + licence |
| Club | Club du joueur |
| Email | Adresse email |
| Date d'envoi | Date de l'invitation initiale |
| Envois | Nombre total d'envois (initial + rappels) |
| Statut | En attente ou Inscrit |
| Actions | Bouton "Renvoyer" (si En attente), "Supprimer" |

**Actions en lot : **Cocher plusieurs joueurs "En attente" et cliquer sur "Renvoyer la sélection" pour envoyer un rappel à tous.

#### Onglet "Paramètres"
  - **Template de l'email : **Modifier le sujet et le corps du message d'invitation (éditeur riche)
  - **Variables disponibles : **`{first_name} `, `{organization_name} `, `{organization_short_name} `, `{organization_email} `
  - **Guide PDF : **Télécharger un PDF joint automatiquement à chaque invitation

> 
---

## **Lien avec l'Application Joueur : **Quand un joueur crée son compte sur l'Application Joueur, son statut passe automatiquement de "En attente" à "Inscrit". Le bouton "Synchroniser statuts" force cette vérification. Com Joueurs > Sondages

### Description

Création et gestion d'enquêtes de satisfaction destinées aux joueurs de l'Application Joueur. Les sondages apparaissent sous forme de bannière dans l'application mobile.

### Créer une campagne
  1. Cliquer sur l'onglet **Sondages **dans la page Com Joueurs
  2. Cliquer sur **Nouvelle enquête **
  3. Renseigner le **titre **(affiché aux joueurs dans la bannière) et la **description **(optionnelle)
  4. Personnaliser les **5 catégories de notation **si nécessaire (valeurs par défaut fournies)
  5. Cliquer sur **Créer **

### Activer une campagne (programmation)
  1. Depuis la liste des campagnes, cliquer sur **Activer **sur une campagne en brouillon
  2. Choisir la **date de début **et la **date de fin **
  3. Si la date de début est aujourd'hui ou passée, la campagne est activée immédiatement
  4. Si la date de début est future, la campagne passe en statut **Programmée **et sera activée automatiquement
  5. La campagne sera automatiquement clôturée à la date de fin

> 
### **Limitation : **Une seule campagne peut être active ou programmée à la fois. Fermez la campagne en cours avant d'en activer une nouvelle. Modifier une campagne
  - **Brouillon / Programmée : **Modification complète (titre, description, catégories)
  - **Active : **Seuls le titre et la description peuvent être modifiés (les catégories sont verrouillées car des réponses existent déjà)
  - **Clôturée : **Aucune modification possible

### Fonctionnement côté joueur
  - Une **bannière **s'affiche en haut de l'Application Joueur pendant la période active
  - Le joueur note chaque catégorie de **1 à 5 étoiles **, attribue une **note globale **, et peut laisser un **commentaire libre **
  - Si le joueur ferme la bannière **3 fois **, elle ne s'affiche plus pour cette campagne
  - Chaque joueur ne peut répondre qu' **une seule fois **par campagne

### Consulter les résultats

Cliquer sur **Résultats **sur une campagne active ou clôturée pour voir :
  - **Nombre de réponses **et **note moyenne globale **
  - **Moyennes par catégorie **avec distribution des notes (barres de progression)
  - **Nombre de joueurs ayant décliné **(fermé la bannière 3 fois)
  - **Commentaires libres **des joueurs avec nom et date

### Cycle de vie d'une campagne

**Brouillon **→ **Programmée **(ou **Active **) → **Clôturée **
  - **Clôturer : **Arrête la collecte de réponses (les résultats restent consultables)
  - **Supprimer : **Possible uniquement pour les campagnes en brouillon ou clôturées

---

## Menu : Paramètres

### Accès

Cliquer sur **"Paramètres" **dans la barre de navigation (visible uniquement pour les administrateurs). La page d'accueil des paramètres affiche les raccourcis principaux (génération de la saison, clubs, données de référence, etc.).

Les paramètres d'administration sont organisés en **5 onglets **, chacun contenant des **panneaux repliables (accordéons) **. Chaque panneau affiche un résumé de sa configuration lorsqu'il est fermé — cliquer sur l'en-tête pour le déplier :
  - **Organisation **— Organisation, Identité Visuelle, Configuration des Emails, Configuration de la Saison, Politique de Confidentialité
  - **Utilisateurs **— Mon compte, mot de passe, gestion des utilisateurs
  - **Compétitions **— Paramètres des épreuves, Délais des compétitions, Qualification pour la finale, Mode de qualification, Types de tournoi, Bonus Moyenne, Barème des points, Classement saisonnier
  - **Espace Joueur **— Comptes Espace Joueur, Planification des emails, Paramètres Espace Joueur
  - **Maintenance **— Outils de maintenance, Logs d'activité

### Navigation par accordéons

Chaque section de paramètres est présentée sous forme de panneau repliable. Lorsqu'un panneau est fermé, un **résumé **de la configuration actuelle est affiché à droite de l'en-tête (par exemple : "4 types définis", "Journées Qualificatives + Dédoublement", "Envoi à 08h00"). Cliquer sur l'en-tête pour ouvrir ou fermer le panneau.

Dans l'onglet **Compétitions **, les 5 derniers panneaux (Mode de qualification à Classement saisonnier) partagent un même bouton "Enregistrer" situé en bas du groupe. Les autres panneaux ont chacun leur propre bouton de sauvegarde.

---

## Paramètres > Générer les tournois de la saison

### Description

Cette fonctionnalité permet de créer automatiquement toutes les compétitions d'une saison à partir du fichier calendrier Excel. Au lieu de saisir chaque compétition manuellement dans le calendrier, le système analyse le fichier Excel et génère l'ensemble des tournois en une seule opération.

### Accès

Depuis la page **Paramètres **, cliquer sur le bouton vert **"Générer tournois saison" **.

### Prérequis
  - Disposer du fichier calendrier Excel de la saison (format `.xlsx `)
  - Le fichier doit contenir les lignes **S **(Samedi) et **D **(Dimanche) avec les dates de chaque journée
  - Les tournois sont identifiés par les marqueurs : **T1 **, **T2 **, **T3 **(Tournois Qualificatifs) et **FD **(Finale Départementale)
  - Le club organisateur est identifié automatiquement par la **couleur de fond **de chaque cellule de tournoi

### Étapes
  1. **Sélectionner la saison **— Choisir la saison cible dans le menu déroulant (ex: 2026-2027)
  2. **Charger le fichier Excel **— Sélectionner le fichier calendrier de la saison
    - **Cliquer sur "Prévisualiser" **— Le système analyse le fichier et détecte automatiquement : Les dates (à partir des lignes S/D)
    - Les tournois (T1, T2, T3, FD)
    - Le mode de jeu (Libre, Cadre, Bande, 3 Bandes)
    - La catégorie (N3, R1, R2, R3, R4...)
    - La taille (Distance/Reprises)
    - Le club organisateur (via la couleur de fond de la cellule)
  3. **Vérifier la reconnaissance des clubs **— Le système affiche les couleurs détectées et le club associé à chacune. Vérifier que chaque couleur correspond bien au bon club. Corriger si nécessaire avant de poursuivre. Si une couleur n'est pas reconnue, le processus est interrompu.
  4. **Contrôler la prévisualisation **— Vérifier le tableau récapitulatif de tous les tournois détectés (date, nom, mode, catégorie, lieu, taille). Les finales sont mises en évidence.
  5. **Cliquer sur "Importer les tournois" **— Tous les tournois sont créés dans le calendrier. Si un tournoi avec le même identifiant existe déjà, il est mis à jour.

> 
> 
---

## **Identification du club organisateur : **Le système détecte le club à partir de la couleur de fond des cellules du fichier Excel. En alternative, le format **T1/A **(lettre du club après le slash) est également reconnu. Si ni la couleur ni la lettre ne correspondent à un club connu, le processus s'arrête et demande de corriger le fichier ou de configurer la correspondance. **Important : **Après la génération, il est recommandé de vérifier les compétitions créées dans le menu **Calendrier **. Les tournois peuvent être modifiés individuellement si nécessaire (changement de date, de lieu, etc.). Paramètres > Organisation

### Description

Configuration des informations générales de l'organisation. L'onglet Organisation contient 6 panneaux repliables, chacun avec son propre bouton "Enregistrer" :
  - **Organisation **— Nom, sigle, email de notification, options d'import/inscription, logo
  - **Identité Visuelle **— Couleurs de l'application (principale, secondaire, accent, fonds)
  - **Configuration des Emails **— Adresses email d'expédition
  - **Configuration de la Saison **— Mois de début de saison, clôture des statistiques
  - **Site Web / WordPress **— Connexion au site WordPress pour la publication automatique des convocations (voir [section dédiée ])
  - **Politique de Confidentialité **— Lien vers l'éditeur

![Paramètres organisation](screenshots/16-param-organisation.png)

#### IMG-16 📷 Paramètres — Organisation Capture de l'onglet Organisation avec les panneaux repliables (Organisation, Identité Visuelle, Emails, Saison, Confidentialité) Champs configurables

| Paramètre | Description |
| --- | --- |
| Nom de l'organisation | Nom complet (ex: "Comité Départemental de Billard des Hauts-de-Seine") |
| Sigle | Nom court (ex: "CDB92") |
| Logo | Image affichée dans les emails et documents |
| Email de communication | Adresse d'expédition des emails |
| Email de notification | Adresse recevant les notifications système |
| Nom de l'expéditeur | Nom affiché comme expéditeur des emails |

#### Inscription externe (emails de relance)

Configure le comportement des emails de relance pour les joueurs qui n'ont pas de compte Espace Joueur :

| Paramètre | Description |
| --- | --- |
| Activer le lien d'inscription externe | Si activé, les emails de relance incluent un lien vers un site externe (ex: site du comité) pour les joueurs sans compte Espace Joueur. Si désactivé, les joueurs sont simplement invités à répondre par email. |
| URL du site d'inscription | Adresse du site externe vers lequel rediriger les joueurs (ex: https://moncomite.fr). Visible uniquement si le lien externe est activé. |

#### Personnalisation visuelle

| Paramètre | Description |
| --- | --- |
| Couleur principale | Couleur des en-têtes, boutons, liens |
| Couleur secondaire | Couleur des dégradés, survols |
| Couleur d'accent | Couleur des alertes, badges |

---

## Paramètres > Site Web / WordPress

### Accès

Onglet **Organisation **des Paramètres > panneau **« Site Web / WordPress » **

### Description

Configure la connexion au site WordPress de l'organisation pour publier automatiquement les convocations sous forme d'articles. Cette fonctionnalité utilise le protocole XML-RPC de WordPress.

### Prérequis
  - Un site WordPress avec XML-RPC activé (activé par défaut sur la plupart des installations)
  - Un compte WordPress avec les permissions de publication (rôle **Éditeur **ou **Administrateur **recommandé)
  - Un **Mot de passe d'application **WordPress (différent du mot de passe classique)

### Générer un mot de passe d'application WordPress
  1. Connectez-vous à l'administration WordPress de votre site
  2. Allez dans **Utilisateurs > Profil **
  3. Descendez jusqu'à la section **« Mots de passe d'application » **
  4. Saisissez un nom (ex: « Gestion Tournois ») et cliquez sur **« Ajouter un mot de passe d'application » **
  5. Copiez le mot de passe généré (il ne sera plus affiché)

### Configuration

| Paramètre | Description |
| --- | --- |
| URL du site | Adresse complète du site WordPress (ex: `https://cdbhs.net `) |
| Nom d'utilisateur | Identifiant du compte WordPress |
| Mot de passe d'application | Mot de passe d'application généré (avec ou sans espaces) |
| Statut par défaut | **Brouillon **(à relire avant publication) ou **Publié **(visible immédiatement) |
| Activer la publication | Active ou désactive globalement la fonctionnalité |

### Test de connexion

Après avoir saisi les informations, cliquez sur **« Tester la connexion » **pour vérifier que l'application peut se connecter au site WordPress. Un message de succès ou d'erreur s'affiche.

### Catégories WordPress

Les articles publiés sont automatiquement classés dans une hiérarchie de catégories :
    - **Saison 2025-2026 **(catégorie parente) **Convocations 2025-2026 **(catégorie enfant)

Ces catégories sont créées automatiquement si elles n'existent pas et si le compte WordPress dispose des permissions nécessaires. Dans le cas contraire, l'article est publié sans catégorie.

> 
---

## **Permissions WordPress : **Pour que les catégories soient créées automatiquement, le compte WordPress doit avoir le rôle **Éditeur **ou **Administrateur **. Si le compte a un rôle inférieur (ex: Auteur), les articles seront publiés sans catégorie — vous pourrez les classer manuellement depuis WordPress. Paramètres > Utilisateurs

### Rôles disponibles

| Rôle | Permissions |
| --- | --- |
| Admin | Accès complet, peut créer d'autres utilisateurs |
| Éditeur | Peut gérer compétitions, inscriptions, communications |
| Lecteur | Consultation seule (accès en lecture à toutes les pages) |

#### Créer un utilisateur
  1. Cliquer sur "Ajouter un utilisateur"
  2. Saisir : nom d'utilisateur, email, mot de passe temporaire
  3. Sélectionner le rôle
  4. Cliquer sur "Créer"

#### Actions sur un utilisateur existant
  - **Modifier le rôle **: Changer les permissions
  - **Réinitialiser le mot de passe **: Envoie un email de réinitialisation
  - **Désactiver **: Bloque l'accès sans supprimer le compte

---

## Paramètres > Types de Tournoi et Mode de Qualification

### Description

Configuration du mode de qualification pour les finales et gestion des types de tournoi. Ces paramètres sont répartis dans 5 panneaux repliables (accordéons) dans l'onglet Compétitions, avec un bouton "Enregistrer" commun en bas du groupe.

![Types de tournoi et mode de qualification](screenshots/17-param-types-tournoi.png)

#### IMG-17 📷 Paramètres — Types de Tournoi Capture de l'onglet Compétitions avec les panneaux repliables : Mode de qualification, Types de tournoi, Bonus Moyenne, Barème des points, Classement saisonnier Choisir le mode de qualification

Panneau **"Mode de qualification" **. Deux modes disponibles, sélectionnables par carte :

| Mode | Description |
| --- | --- |
| **3 Tournois Qualificatifs ** | 3 tournois (T1, T2, T3) avec cumul des points. Les meilleurs joueurs accèdent à la Finale Départementale. |
| **Journées Qualificatives ** | Journées avec poules, classement par points de position (meilleurs N sur M journées). Même import CSV que le mode standard. |

#### Types de Tournoi

Tableau listant les types de tournoi définis (T1, T2, T3, Finale, etc.) avec code, nom d'affichage, et options (compte pour le classement, est une finale). Il est possible d'ajouter de nouveaux types via le formulaire en bas du tableau.

#### Bonus Moyenne

(Visible dans les deux modes : Standard et Journées)

Active un bonus de points par tournoi basé sur la moyenne du joueur par rapport aux seuils min/max de la catégorie (configurés dans le panneau "Paramètres des épreuves").

| Type | Formule |
| --- | --- |
| **Normal ** | Au-dessus du max → +2 | Entre min et max → +1 | En dessous du min → 0 |
| **Par paliers ** | < min → 0 | min–milieu → +1 | milieu–max → +2 | ≥ max → +3 |

**Périmètre de calcul : **un second sélecteur permet de choisir la base de calcul de la moyenne utilisée pour le bonus :

| Option | Description |
| --- | --- |
| **Poules uniquement ** | Seuls les matchs de poule sont pris en compte (les phases finales et matchs de classement sont exclus). C'est l'option par défaut. |
| **Journée complète ** | Tous les matchs de la journée sont pris en compte (poules + phases finales + classement). |

Le bonus est calculé automatiquement à chaque import de résultats et s'ajoute aux éventuels bonus du barème (VDL, etc.).

Un bandeau d'information affiche les seuils et règles du bonus moyenne en haut de la page de résultats du tournoi et de la page de classements.

#### Meilleurs résultats retenus

(Visible dans les deux modes : Standard et Journées)

Permet de ne retenir que les N meilleurs résultats de tournoi pour le classement saisonnier. Par exemple, avec la valeur 2 et 3 tournois joués, seuls les 2 meilleurs scores comptent pour le total des points de match. La moyenne, la meilleure série, les points et reprises restent calculés sur tous les tournois.

| Paramètre | Description |
| --- | --- |
| Nombre de résultats retenus | Nombre de meilleurs scores pris en compte. Laisser à 0 pour que tous les tournois comptent. |

Les résultats retenus apparaissent en **gras **dans le classement et l'export Excel. Les résultats écartés sont affichés barrés en gris .

#### Paramètres Journées Qualificatives

(Visible uniquement en mode journées)

| Paramètre | Description |
| --- | --- |
| Nombre de journées | Nombre de tournois qualificatifs par saison (défaut: 3) |
| Bonus Moyenne au classement saisonnier | Ajoute un bonus au classement saisonnier selon la moyenne des meilleurs tournois retenus (utilise le même type Normal/Par paliers que le bonus par tournoi) |

#### Points par position

Tableau configurable qui définit le nombre de points attribués pour chaque position finale dans une journée :
  - Position 1 → 10 points (par défaut)
  - Position 2 → 8 points
  - etc.
  - Possibilité d'ajouter ou modifier des positions

---

## Paramètres > Paramètres des épreuves

### Accès

Paramètres > onglet **Compétitions **> panneau **"Paramètres des épreuves" **

### Description

Configuration des paramètres de jeu (Distance, Reprises) par mode et catégorie pour la saison en cours.

![Paramètres des épreuves](screenshots/18-param-jeu.png)

#### IMG-18 📷 Paramètres — Paramètres des épreuves Capture du panneau "Paramètres des épreuves" dans l'onglet Compétitions (distance, reprises, moyenne mini/maxi par catégorie) Paramètres par catégorie

| Paramètre | Description |
| --- | --- |
| Distance | Nombre de points à atteindre |
| Reprises | Nombre maximum de reprises |
| Moyenne mini | Seuil minimum de moyenne pour la catégorie |
| Moyenne maxi | Seuil maximum de moyenne pour la catégorie |

Ces paramètres sont utilisés pour :
  - Les convocations (distance et reprises affichés dans l'email)
  - Le calcul du bonus moyenne (seuils mini/maxi)
  - La validation des classifications FFB

> 
---

## **Surcharge par tournoi : **Les paramètres Distance et Reprises peuvent être modifiés pour un tournoi spécifique directement depuis la page "Générer les poules" (bouton "Valider les paramètres"). Ces surcharges n'affectent que le tournoi concerné. Paramètres > Barème de Points

### Accès

Paramètres > onglet Compétitions > panneau **"Barème des points" **

### Description

Configuration des règles de calcul des points de match et des bonus. Le barème est visible dans les deux modes (Standard et Journées), dans un panneau repliable dédié.

![Barème de points](screenshots/19-param-bareme.png)

#### IMG-19 📷 Paramètres — Barème de points Capture de la page barème avec le tableau de base (V/N/D) et les blocs de bonus avec leurs conditions structurées Barème de base (Victoire / Nul / Défaite)

Définit les points attribués pour chaque résultat de match :
  - **Victoire **: 2 points (par défaut)
  - **Match nul **: 1 point
  - **Défaite **: 0 point

Ces valeurs sont modifiables via le bouton "Modifier" de chaque ligne.

#### Blocs de bonus

Des blocs de bonus peuvent être ajoutés pour attribuer des points supplémentaires selon des conditions :

**Structure d'un bloc : **
  - **Nom du bloc **: Identifiant (ex: "Bonus Moyenne")
  - **Libellé colonne **: Nom affiché dans les classements (ex: "Bonus Moy.")
  - **Statut **: Actif ou Inactif (toggle)

**Chaque condition dans un bloc : **
  - **Champ **: Moyenne du joueur, Nombre de joueurs, Points de match, Série
  - **Opérateur **: >, >=, < , < =, =
  - **Valeur **: Seuil max catégorie, Seuil min catégorie, ou valeur numérique
  - **Logique **: Possibilité de combiner 2 conditions avec ET/OU
  - **Points **: Nombre de points bonus attribués

**Actions : **
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

![Classifications FFB](screenshots/20-classifications-ffb.png)

#### IMG-20 📷 Classifications FFB Capture de la page classifications avec la recherche par licence, les lignes discipline/classement/moyenne et le tableau récapitulatif Recherche d'un joueur
  1. Saisir le numéro de licence dans le champ de recherche
  2. Le joueur est identifié automatiquement (nom, prénom, club)

#### Gestion des classifications par discipline

Pour chaque joueur, il est possible de gérer les classifications par mode de jeu :
  - **Mode de jeu **: Libre, Cadre, Bande, 3 Bandes
  - **Classement **: Dropdown avec les niveaux FFB disponibles (N1 à D3)
  - **Moyenne FFB **: Valeur numérique avec 3 décimales

> 
**Validation : **Un indicateur de plage de moyenne s'affiche (ex: "Plage: 15.000 - 50.000") pour guider la saisie. **Actions : **
  - Ajouter une discipline (bouton "+")
  - Supprimer une discipline
  - Enregistrer les classifications

#### Vue d'ensemble

Un tableau récapitulatif affiche toutes les classifications enregistrées pour tous les joueurs, regroupées par discipline. Statistiques affichées : nombre total de joueurs classés et nombre de classifications saisies.

---

## Paramètres > Clubs

### Actions disponibles
  - **Ajouter un club **: Nom, ville, logo
  - **Modifier un club **: Mettre à jour les informations
  - **Télécharger un logo **: Image affichée dans les classements et documents
  - **Supprimer un club **: Retirer de la liste

#### Utilisation des logos

Les logos des clubs apparaissent dans les classements (tableau et export Excel) et les convocations.

---

## Paramètres > Données de référence

### Description

Gestion des données de base du système, organisée en onglets.

![Données de référence](screenshots/21-donnees-reference.png)

#### IMG-21 📷 Données de référence Capture de la page données de référence avec les onglets (Modes de jeu, Classements FFB, Catégories, Config. Poules) Onglet "Modes de jeu"
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

### Accès

Paramètres > onglet **Organisation **> panneau **"Politique de Confidentialité" **

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

Paramètres > onglet **Maintenance **> panneau **"Logs d'activité" **

### Description

Historique des actions effectuées par les utilisateurs de l'application et de l'Espace Joueur.

![Logs d'activité](screenshots/22-logs-activite.png)

#### IMG-22 📷 Logs d'activité Capture de la page logs avec les statistiques rapides (7 jours), les filtres et le tableau des actions Statistiques rapides (7 derniers jours)
  - Connexions
  - Inscriptions
  - Désinscriptions
  - Nouveaux comptes
  - Utilisateurs actifs

#### Filtres disponibles
  - **Période **: Date de début et de fin
  - **Type d'action **: Connexion, inscription, désinscription, création de compte, etc.
  - **Nom du joueur **: Recherche avec opérateurs (contient, commence par, est égal à, etc.)
  - **Licence **: Recherche par numéro de licence

#### Tableau des logs

| Colonne | Description |
| --- | --- |
| Date/Heure | Horodatage de l'action |
| Action | Type d'action effectuée |
| Statut | Succès ou échec |
| Joueur | Nom du joueur concerné |
| Email | Adresse email |
| Cible | Élément ciblé par l'action |
| Détails | Informations complémentaires |
| IP | Adresse IP de l'utilisateur |

#### Actions
  - **Export Excel **: Télécharge les logs filtrés au format Excel
  - **Rafraîchissement automatique **: Toggle pour actualiser les logs toutes les 30 secondes
  - **Pagination **: 50 logs par page

#### Zone dangereuse - Suppression sélective de logs (Admin uniquement)

Une zone dédiée permet de supprimer des logs selon des critères précis.

##### **⚠️ Attention **: La suppression est définitive. Un backup Excel est automatiquement téléchargé avant toute suppression. Filtres de suppression
  - **Date début / Date fin **: Période à supprimer
  - **Type d'action **: Sélectionner un type spécifique (ex: "Echec connexion", "Inscription confirmée")
  - **Licence **: Supprimer les logs d'un joueur spécifique
  - **CDB (Super Admin) **: Sélectionner l'organisation (visible uniquement pour les super admins)

##### Processus de suppression
  1. Définir les critères de suppression dans la zone dangereuse
    - Cliquer sur **"👁️ Prévisualiser + Afficher" **Affiche le nombre de logs concernés (ex: "96 log(s) seront supprimés")
    - Synchronise automatiquement les filtres du tableau principal
    - Affiche les logs qui seront supprimés pour vérification visuelle
  2. Vérifier visuellement les logs affichés dans le tableau
  3. Cliquer sur **"🗑️ Supprimer les logs" **
  4. Confirmer la suppression dans la boîte de dialogue
    - Le système : Télécharge automatiquement un fichier Excel de sauvegarde ( `backup-activity-logs-YYYY-MM-DD.xlsx `)
    - Supprime les logs de la base de données
    - Affiche le message : "✅ Sauvegarde téléchargée. X logs supprimés avec succès"

##### Scoping par organisation
  - **Admin régulier **: Ne peut supprimer que les logs de son organisation (le sélecteur CDB est masqué)
  - **Super Admin **: Peut sélectionner une organisation spécifique ou tous les CDBs

---

## Paramètres > Logs Administrateur

### Accès

Paramètres > onglet **Maintenance **> panneau **"Logs Administrateur" **

### Description

Historique des actions effectuées par les administrateurs dans l'application de gestion des tournois (imports, exports, envois d'emails, modifications de paramètres, etc.).

#### Statistiques rapides (7 derniers jours)
  - Connexions (admin)
  - Imports (tournois, inscriptions)
  - Emails envoyés
  - Total actions
  - Utilisateurs actifs avec leur dernière activité

#### Filtres disponibles
  - **Période **: Date de début et de fin
  - **Type d'action **: Connexion, import, export, email, modification, etc.
  - **Utilisateur **: Nom d'utilisateur de l'administrateur

#### Tableau des logs

| Colonne | Description |
| --- | --- |
| Date/Heure | Horodatage de l'action |
| Utilisateur | Nom d'utilisateur de l'administrateur |
| Rôle | admin, viewer, ou lecteur |
| Action | Type d'action effectuée |
| Détails | Informations complémentaires sur l'action |

#### Actions
  - **Pagination **: 50 logs par page

#### Zone dangereuse - Suppression sélective de logs (Admin uniquement)

Une zone dédiée permet de supprimer des logs selon des critères précis.

##### **⚠️ Attention **: La suppression est définitive. Un backup Excel est automatiquement téléchargé avant toute suppression. Filtres de suppression
  - **Date début / Date fin **: Période à supprimer
  - **Type d'action **: Sélectionner un type spécifique (ex: "Echec connexion", "Import tournoi")
  - **Utilisateur **: Supprimer les logs d'un utilisateur spécifique (ex: admin92)
  - **CDB (Super Admin) **: Sélectionner l'organisation (visible uniquement pour les super admins)

##### Processus de suppression
  1. Définir les critères de suppression dans la zone dangereuse
    - Cliquer sur **"👁️ Prévisualiser + Afficher" **Affiche le nombre de logs concernés (ex: "96 log(s) seront supprimés")
    - Synchronise automatiquement les filtres du tableau principal
    - Affiche les logs qui seront supprimés pour vérification visuelle
  2. Vérifier visuellement les logs affichés dans le tableau
  3. Cliquer sur **"🗑️ Supprimer les logs" **
  4. Confirmer la suppression dans la boîte de dialogue
    - Le système : Télécharge automatiquement un fichier Excel de sauvegarde ( `backup-admin-logs-YYYY-MM-DD.xlsx `)
    - Supprime les logs de la base de données
    - Affiche le message : "✅ Sauvegarde téléchargée. X logs supprimés avec succès"

##### Scoping par organisation
  - **Admin régulier **: Ne peut supprimer que les logs de son organisation (le sélecteur CDB est masqué)
  - **Super Admin **: Peut sélectionner une organisation spécifique ou tous les CDBs

---

## Liste des Inscriptions

### Accès

Via le menu "Inscriptions" dans la barre de navigation

### Description

Vue complète de toutes les inscriptions aux compétitions.

![Liste des inscriptions](screenshots/23-inscriptions-liste.png)

### IMG-23 📷 Liste des inscriptions Capture de la liste des inscriptions avec les filtres (saison, mode, statut), le tableau et les badges de statut colorés Filtres disponibles
  - **Saison **, **Mode de jeu **, **Niveau **
  - **Statut **: Inscrit Convoqué Forfait Indisponible Désinscrit
  - **Recherche **: Par nom ou licence

### Tableau affiché

| Colonne | Description |
| --- | --- |
| Joueur | Nom, prénom, licence |
| Club | Club du joueur |
| Email | Adresse email |
| Téléphone | Numéro de téléphone |
| Compétition | Mode + niveau + numéro tournoi |
| Source | player_app / manual / ionos |
| Statut | Inscrit / Convoqué / Forfait / Indisponible / Désinscrit |
| Actions | Modifier / Supprimer |

### Sources d'inscription
  - **player_app **: Le joueur s'est inscrit via l'Application Joueur
  - **manual **: Un administrateur a ajouté l'inscription manuellement
  - **ionos **: Import CSV (ancien système)

#### Ajouter une inscription manuellement
  1. Cliquer sur "Ajouter"
  2. Sélectionner le tournoi
  3. Rechercher le joueur
  4. Vérifier/compléter email et téléphone
  5. Cliquer sur "Enregistrer"

> 
#### **Lien avec l'Application Joueur : **Les inscriptions avec source "player_app" ont été faites par le joueur lui-même. Ces inscriptions ne doivent généralement pas être modifiées manuellement. Statut « Indisponible »

Les joueurs peuvent déclarer leur indisponibilité pour une compétition via l'Application Joueur, soit directement depuis la carte de la compétition, soit via le bouton « Indiquer mon indisponibilité » dans les emails de relance.
  - Une inscription est créée avec le statut Indisponible
  - L'administrateur reçoit un **email de notification **à l'adresse configurée dans Paramètres > Email de notification
  - Le joueur indisponible est **automatiquement exclu **des prochaines relances
  - Le joueur peut changer d'avis et s'inscrire tant que les inscriptions sont ouvertes — le statut passe alors à « Inscrit »
  - Les inscriptions « Indisponible » ne sont **pas comptabilisées **dans le total des inscriptions actives

---

## Flux de Travail Types

### Préparer un tournoi de A à Z
  1. **Créer le tournoi **(Menu Calendrier) — Définir mode, niveau, date, lieu
  2. **Attendre les inscriptions **— Les joueurs s'inscrivent via l'Application Joueur. Suivre dans la liste des inscriptions
  3. **Générer les poules **(Menu Compétitions) — Charger le tournoi, vérifier les joueurs, valider les paramètres de jeu, générer les poules
  4. **Envoyer les convocations **— Prévisualiser, tester si besoin, envoyer à tous les joueurs
  5. **Gérer les forfaits **(si nécessaire) — Marquer les forfaits, ajouter des remplaçants, renvoyer les convocations modifiées
  6. **Après le tournoi **— Importer les résultats (CSV), vérifier le classement mis à jour

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
| --- | --- |
| Application Joueur / Espace Joueur | Application permettant aux licenciés de s'inscrire et consulter leurs informations |
| Barème | Ensemble des règles définissant l'attribution des points de match et des bonus |
| Bonus Moyenne | Points bonus par tournoi selon la moyenne du joueur par rapport aux seuils min/max de la catégorie. Deux types : Normal (+0/+1/+2) ou Par paliers (+0/+1/+2/+3). Deux périmètres : Poules uniquement (par défaut) ou Journée complète (inclut phases finales et classement). Disponible dans les deux modes (Standard et Journées). En mode Journées, un bonus similaire peut être activé sur le classement saisonnier. |
| Catégorie | Combinaison d'un mode de jeu et d'un niveau (ex: "Libre R2", "3 Bandes N3") |
| CDB | Comité Départemental de Billard — chaque CDB dispose de son propre environnement isolé |
| Classification FFB | Classement attribué par la FFB à un joueur pour une discipline donnée (ex: R2 en 3 Bandes) |
| Convocation | Email envoyé au joueur avec toutes les informations du tournoi et sa poule |
| Dédoublement | Action de scinder un tournoi en deux sous-tournois (A et B) organisés dans deux lieux différents, lorsque le nombre d'inscrits dépasse la capacité d'un seul site |
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
| Répartition serpentine | Méthode de distribution équilibrée des joueurs entre deux sous-tournois : les joueurs triés par classement sont alternés (1er → A, 2e → B, 3e → B, 4e → A, etc.) pour garantir un niveau homogène |
| Série | Nombre de points consécutifs marqués sans rater |
| E2i / telemat.org | Système fédéral de saisie et gestion des compétitions FFB. Les fichiers CSV de matchs exportés depuis E2i peuvent être importés dans l'application. |
| Mot de passe d'application | Mot de passe spécifique généré par WordPress pour les connexions depuis des applications tierces. Différent du mot de passe de connexion classique. |
| XML-RPC | Protocole utilisé pour communiquer avec WordPress depuis l'application. Permet de créer, modifier et supprimer des articles à distance. |
| Page publique du tournoi | Page accessible sans connexion affichant les informations d'un tournoi et la composition des poules. URL : `/public/{slug}/tournament/{id} ` |
| MGP (Moyenne Générale Parties) | Moyenne générale du joueur calculée sur l'ensemble des matchs d'un tournoi (total points / total reprises) |
| MPART (Meilleure Partie) | Meilleure moyenne obtenue par un joueur sur un seul match dans un tournoi |
| PM (Parties Menées) | Nombre de matchs joués par un joueur dans un tournoi |
| Clt poule | Classement du joueur au sein de sa poule (1er, 2e, 3e...) |

## Checklist des captures d'écran

> 
| **Instructions : **Pour chaque capture ci-dessous, prenez une copie d'écran de la page indiquée et enregistrez-la dans le dossier `screenshots/ `avec le nom de fichier spécifié. Puis décommentez la balise `<img> `correspondante dans le HTML pour remplacer le placeholder. ID | Fichier | Page / État à capturer | Détails |
| --- | --- | --- | --- |
| IMG-01 | `01-login.png ` | Page de connexion | Afficher la page de login avec le logo, les champs vides et le bouton "Se connecter". Version visible en bas. |
| IMG-02 | `02-dashboard.png ` | Dashboard | Se connecter et capturer le tableau de bord complet : cartes de statistiques, section alertes, et boutons d'actions rapides. |
| IMG-03 | `03-classements.png ` | Classements (mode standard) | Menu Classements. Sélectionner une catégorie ayant des résultats. Montrer les filtres + le tableau avec les joueurs qualifiés en vert. |
| IMG-04 | `04-classements-journees.png ` | Classements (mode journées) | Si disponible : classement en mode journées avec colonnes TQ1/TQ2/TQ3, scores en gras (retenus) et barrés (écartés). Sinon, omettre cette capture. |
| IMG-05 | `05-historique-joueur.png ` | Historique d'un joueur | Depuis le classement, cliquer sur un nom de joueur. Capturer la fiche avec infos, classifications et historique des résultats. |
| IMG-06 | `06-poules-selection.png ` | Générer poules — Étape 1 | Menu Compétitions > Générer les poules. Montrer les filtres en haut et les cartes de compétitions à venir. |
| IMG-07 | `07-poules-joueurs.png ` | Générer poules — Étape 2 | Après "Charger les joueurs" : liste des joueurs avec cases à cocher, badges de statut et boutons d'action. |
| IMG-08 | `08-poules-preview.png ` | Générer poules — Étape 3 | Après génération : prévisualisation des poules avec composition, planning et paramètres de jeu. |
| IMG-09 | `09-convocation-email.png ` | Convocation — Aperçu email | Aperçu de l'email de convocation avec logo, infos tournoi, poule et planning. |
| IMG-10 | `10-forfaits.png ` | Gestion des forfaits | Depuis Générer poules, cliquer "Gérer les forfaits". Montrer la liste avec cases à cocher et actions. |
| IMG-11 | `11-resultats-import.png ` | Import Classements E2i (onglet 1) | Menu Compétitions > Résultats > onglet « Import Classements E2i ». Montrer la sélection de catégorie et la zone de dépôt du fichier CSV. |
| IMG-11B | `11b-import-matchs-e2i.png ` | Import Matchs E2i (onglet 2) | Onglet « Import Matchs E2i » avec les 4 zones de dépôt par phase (Poules, Demi-finales, Finale/Petite Finale, Classement). |
| IMG-11C | `11c-phase-finale-bracket.png ` | Phase Finale (Tableau) | Page tournament-bracket.html après génération : joueurs qualifiés, demi-finales, finale/petite finale, matchs de classement. |
| IMG-11D | `11d-resultats-standard.png ` | Résultats d'un tournoi — Mode Standard | Page de résultats d'un tournoi en mode standard : colonnes CLT, Licence, Joueur, Club, Pts Match, Bonus, Total, Points, Reprises, Moyenne, MS. |
| IMG-11E | `11e-resultats-journees.png ` | Résultats d'un tournoi — Mode Journées | Page de résultats d'un tournoi en mode journées : colonnes CLT, Clt poule, Clt Finale, Pts clt, bonus, Pts Clt Total, PM, Pts, R, MS, MGP, MPART. |
| IMG-12 | `12-calendrier.png ` | Calendrier | Vue calendrier mensuelle avec des compétitions affichées (couleurs par mode). Choisir un mois avec plusieurs événements. |
| IMG-13 | `13-annonces.png ` | Annonces | Menu Com joueurs > Annonces. Montrer le formulaire de création et quelques annonces existantes si possible. |
| IMG-14 | `14-composer-email.png ` | Composer un email | Menu Com joueurs > Composer. Montrer les filtres de destinataires, l'éditeur riche et la liste des variables. |
| IMG-15 | `15-invitations.png ` | Invitations Espace Joueur | Menu Com joueurs > Invitations. Montrer l'onglet suivi avec les statuts "En attente" et "Inscrit". |
| IMG-16 | `16-param-organisation.png ` | Paramètres > Organisation | Onglet Organisation avec les panneaux repliables (Organisation, Identité Visuelle, Emails, Saison, Confidentialité). |
| IMG-17 | `17-param-types-tournoi.png ` | Paramètres > Compétitions | Onglet Compétitions avec les panneaux repliables (Paramètres des épreuves, Délais, Qualification, Mode, Types, Bonus, Barème, Classement). |
| IMG-18 | `18-param-jeu.png ` | Paramètres > Paramètres des épreuves | Panneau "Paramètres des épreuves" dans l'onglet Compétitions avec distance, reprises et moyennes par catégorie. |
| IMG-19 | `19-param-bareme.png ` | Paramètres > Barème de points | Tableau V/N/D et au moins un bloc de bonus avec ses conditions. |
| IMG-20 | `20-classifications-ffb.png ` | Paramètres > Classifications FFB | Rechercher un joueur par licence. Montrer les lignes discipline avec classement et moyenne. |
| IMG-21 | `21-donnees-reference.png ` | Paramètres > Données de référence | Page avec les onglets visibles. Montrer l'onglet "Catégories" ou "Modes de jeu". |
| IMG-22 | `22-logs-activite.png ` | Paramètres > Maintenance > Logs d'activité | Panneau "Logs d'activité" dans l'onglet Maintenance avec statistiques rapides, filtres et tableau. |
| IMG-23 | `23-inscriptions-liste.png ` | Liste des inscriptions | Menu Inscriptions. Filtrer pour afficher des résultats. Montrer les badges de statut colorés. |

> 
> 
---

**Astuce : **Pour des captures de bonne qualité, utilisez la résolution de votre écran standard (pas de zoom). Largeur recommandée : 1200-1400px. Format PNG recommandé. **Activation des images : **Une fois les captures placées dans le dossier `screenshots/ `, ouvrez ce fichier HTML et pour chaque placeholder, décommentez la ligne `<img src="screenshots/XX-nom.png"> `. Le placeholder gris sera alors remplacé par la vraie capture. Document de référence pour l'Application de Gestion des Tournois — Version 2.0.200

JR ©