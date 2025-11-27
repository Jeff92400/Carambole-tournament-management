# 🎱 French Billiard Ranking System

Application complète de gestion des classements de tournois de billard français.

## ✅ Application Installée et Fonctionnelle

Le serveur est actuellement **en cours d'exécution** sur votre Mac !

**URL de l'application :** http://localhost:3000

**Identifiants par défaut :**
- Mot de passe : `admin123`

⚠️ **Important :** Pensez à changer le mot de passe après votre première connexion !

## 📋 Fonctionnalités

✅ **Authentification administrateur** (mot de passe unique)
✅ **Import des joueurs** depuis fichier CSV (JOUEURS.csv)
✅ **Import des résultats de tournois** avec sélection de catégorie et numéro
✅ **13 catégories** (LIBRE, CADRE, BANDE, 3 BANDES avec niveaux)
✅ **Calcul automatique des classements** (Points match → Moyenne → Série)
✅ **Classements cumulatifs** sur 3 tournois par saison
✅ **Historique par joueur** avec tous ses résultats
✅ **Export Excel** des classements avec mise en forme professionnelle
✅ **Interface responsive** adaptée à tous les écrans

## 🚀 Démarrage de l'application

### Première utilisation

L'application est déjà démarrée ! Ouvrez simplement votre navigateur :

```
http://localhost:3000
```

### Démarrage ultérieur

Si vous avez redémarré votre Mac ou fermé le serveur, voici comment le relancer :

1. Ouvrez le Terminal
2. Naviguez vers le dossier :
   ```bash
   cd "/Users/jeffrallet/Library/CloudStorage/OneDrive-Personal/Billard/Ranking App/backend"
   ```
3. Démarrez le serveur :
   ```bash
   npm start
   ```

Le serveur sera accessible sur http://localhost:3000

### Arrêt du serveur

Pour arrêter le serveur, appuyez sur `Ctrl + C` dans le Terminal.

---

## 💻 Installation sur un nouvel ordinateur

### Étape 1 : Vérifier les prérequis

Avant de commencer, vous devez avoir **Node.js** installé.

**Pour vérifier si Node.js est installé :**
1. Ouvrez le Terminal (Mac/Linux) ou l'Invite de commandes (Windows)
2. Tapez : `node --version`
3. Si vous voyez un numéro de version (ex: v18.x.x), passez à l'Étape 2
4. Sinon, téléchargez Node.js : https://nodejs.org/ (version LTS recommandée)

### Étape 2 : Copier l'application

Copiez le dossier complet **"Ranking App"** sur le nouvel ordinateur.

**Le dossier doit contenir :**
```
Ranking App/
├── backend/              (serveur Node.js)
├── frontend/             (interface web)
├── billard.db           (base de données - IMPORTANT!)
├── Tournament CSV files/ (optionnel)
├── Player CSV files/     (optionnel)
└── README.md            (ce fichier)
```

⚠️ **IMPORTANT :** Le fichier `billard.db` contient toutes vos données (joueurs, tournois, classements). Ne l'oubliez pas !

### Étape 3 : Installer l'application

**Sur Mac/Linux :**
1. Ouvrez le Terminal
2. Tapez : `cd ` (avec un espace) puis glissez-déposez le dossier "Ranking App"
3. Appuyez sur Entrée
4. Tapez : `cd backend`
5. Tapez : `npm install`
6. Attendez la fin de l'installation (1-2 minutes)

**Sur Windows :**
1. Ouvrez l'Invite de commandes (cmd)
2. Tapez : `cd C:\chemin\vers\Ranking App\backend` (remplacez par votre chemin)
3. Tapez : `npm install`
4. Attendez la fin de l'installation (1-2 minutes)

### Étape 4 : Configurer les chemins des fichiers CSV

Vous devez mettre à jour les chemins des dossiers CSV dans le code :

**Fichier 1 :** `backend/routes/tournaments.js` - ligne 11
```javascript
const upload = multer({ dest: '/NOUVEAU/CHEMIN/vers/Ranking App/Tournament CSV files' });
```

**Fichier 2 :** `backend/routes/players.js` - ligne 11
```javascript
const upload = multer({ dest: '/NOUVEAU/CHEMIN/vers/Ranking App/Player CSV files' });
```

💡 **Astuce :** Pour obtenir le chemin complet du dossier :
- **Mac :** Glissez-déposez le dossier dans le Terminal, le chemin s'affichera
- **Windows :** Shift + Clic droit sur le dossier → "Copier en tant que chemin d'accès"

### Étape 5 : Démarrer l'application

Dans le Terminal/Invite de commandes, tapez :
```bash
npm start
```

Vous verrez :
```
╔════════════════════════════════════════════╗
║  French Billiard Ranking System           ║
║  Server running on http://localhost:3000  ║
╚════════════════════════════════════════════╝
```

### Étape 6 : Accéder à l'application

1. Ouvrez votre navigateur
2. Allez à : **http://localhost:3000**
3. Connectez-vous avec le mot de passe admin

🎉 **Installation terminée !**

---

## 💾 Sauvegarde et restauration

### Sauvegarder vos données

**IMPORTANT :** Toutes vos données sont dans `billard.db`

1. Arrêtez le serveur (Ctrl+C)
2. Copiez le fichier `billard.db`
3. Renommez-le avec la date : `billard_backup_2025-10-07.db`
4. Conservez-le dans un endroit sûr (OneDrive, Google Drive, clé USB...)

### Restaurer une sauvegarde

1. Arrêtez le serveur
2. Remplacez `billard.db` par votre fichier de sauvegarde
3. Renommez le fichier en `billard.db`
4. Redémarrez : `npm start`

## 📖 Guide d'utilisation

### 1. Connexion

1. Ouvrez http://localhost:3000
2. Entrez le mot de passe : `admin123`
3. Cliquez sur "Se connecter"

### 2. Import des joueurs

1. Cliquez sur "Import Joueurs" dans le menu
2. Sélectionnez votre fichier CSV (JOUEURS.csv)
3. Cliquez sur "Importer les joueurs"

Le fichier doit contenir les colonnes :
- Licence
- Club
- Prénom
- Nom
- Classements (LIBRE, CADRE, BANDE, 3 BANDES)
- Statut actif (0 ou 1)

### 3. Import d'un tournoi

1. Cliquez sur "Import Tournoi" dans le menu
2. Sélectionnez la **catégorie** (ex: LIBRE - REGIONALE 1)
3. Sélectionnez le **numéro du tournoi** (1, 2 ou 3)
4. Entrez la **saison** (ex: 2024-2025)
5. Sélectionnez le fichier CSV des résultats
6. Cliquez sur "Importer le tournoi"

Le fichier doit contenir les colonnes :
- Classement
- Licence
- Joueur
- Nombre de matchs
- Points match
- Moyenne
- Série

### 4. Consulter les classements

1. Cliquez sur "Classements" dans le menu
2. Sélectionnez une **saison**
3. Sélectionnez une **catégorie**
4. Le classement s'affiche automatiquement
5. Cliquez sur un nom de joueur pour voir son historique
6. Cliquez sur "Exporter en Excel" pour télécharger le classement

### 5. Voir l'historique d'un joueur

- Depuis la page des classements, cliquez sur le nom d'un joueur
- Vous verrez tous ses résultats par tournoi et catégorie

## 📁 Structure des fichiers

```
Ranking App/
├── backend/                 # Serveur Node.js
│   ├── server.js           # Point d'entrée
│   ├── db.js               # Base de données SQLite
│   ├── routes/             # Routes API
│   └── package.json        # Dépendances
├── frontend/               # Interface utilisateur
│   ├── *.html             # Pages web
│   ├── css/               # Styles
│   └── js/                # Scripts
├── database/              # Base de données SQLite
│   └── billard.db         # Données de l'application
├── uploads/               # Fichiers CSV temporaires
└── README.md              # Ce fichier
```

## 🔐 Sécurité

- **Mot de passe par défaut :** `admin123`
- **⚠️ IMPORTANT :** Changez ce mot de passe dès votre première connexion
- L'application est accessible uniquement en local (localhost)
- Pour un accès réseau, configurez les paramètres CORS dans `backend/server.js`

## 🎯 Les 13 catégories

1. **LIBRE**
   - NATIONALE 3 GC
   - REGIONALE 1
   - REGIONALE 2
   - REGIONALE 3
   - REGIONALE 4

2. **CADRE**
   - NATIONALE 3
   - REGIONALE 1

3. **BANDE**
   - NATIONALE 3
   - REGIONALE 1
   - REGIONALE 2

4. **3 BANDES**
   - NATIONALE 3
   - REGIONALE 1
   - REGIONALE 2

## 📊 Calcul des classements

Le classement est calculé selon les règles suivantes :

1. **Points match** (critère principal)
   - Victoire : 2 points
   - Égalité : 1 point
   - Défaite : 0 point

2. **Moyenne** (1er critère en cas d'égalité)
   - Nombre de points / Nombre de tirs

3. **Série** (2ème critère en cas d'égalité)
   - Meilleure série réalisée

Le classement est **cumulatif** sur les 3 tournois de la saison.

## 🔧 Technologies utilisées

- **Backend :** Node.js, Express, SQLite3
- **Frontend :** HTML5, CSS3, JavaScript (Vanilla)
- **Export :** ExcelJS
- **Authentification :** JWT, bcrypt
- **Upload :** Multer
- **Parsing CSV :** csv-parse

## ❓ Dépannage

### Le serveur ne démarre pas

Vérifiez que le port 3000 n'est pas déjà utilisé :
```bash
lsof -i :3000
```

Pour utiliser un autre port, modifiez `backend/server.js` (ligne `const PORT = 3000;`)

### Erreur lors de l'import CSV

- Vérifiez que le fichier est bien au format CSV
- Assurez-vous que les colonnes sont séparées par des virgules
- Vérifiez l'encodage du fichier (UTF-8 recommandé)

### Les classements ne s'affichent pas

- Vérifiez qu'au moins un tournoi a été importé pour la catégorie et la saison sélectionnées
- Rafraîchissez la page

## 📞 Support

Pour toute question ou problème :
1. Vérifiez les logs du serveur dans le Terminal
2. Consultez ce fichier README
3. Vérifiez que tous les fichiers CSV sont au bon format

## 🎉 Prêt à l'emploi !

Votre application est **installée, configurée et fonctionnelle** !

Accédez-y maintenant : **http://localhost:3000**

Bon classement ! 🎱
