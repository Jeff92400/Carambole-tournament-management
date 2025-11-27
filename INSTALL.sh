#!/bin/bash

# Billard Ranking App - Installation Script
# For Mac and Linux

echo "╔════════════════════════════════════════════╗"
echo "║   Billard Ranking App - Installation      ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Check if Node.js is installed
echo "🔍 Vérification de Node.js..."
if ! command -v node &> /dev/null
then
    echo "❌ Node.js n'est pas installé !"
    echo ""
    echo "Téléchargez et installez Node.js depuis : https://nodejs.org/"
    echo "Choisissez la version LTS (Long Term Support)"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js est installé : $NODE_VERSION"
echo ""

# Get the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "📁 Dossier de l'application : $SCRIPT_DIR"
echo ""

# Create CSV folders if they don't exist
echo "📂 Création des dossiers CSV..."
mkdir -p "$SCRIPT_DIR/Tournament CSV files"
mkdir -p "$SCRIPT_DIR/Player CSV files"
echo "✅ Dossiers CSV créés"
echo ""

# Navigate to backend folder
echo "📦 Installation des dépendances..."
cd "$SCRIPT_DIR/backend"

# Install dependencies
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "╔════════════════════════════════════════════╗"
    echo "║          Installation terminée !           ║"
    echo "╚════════════════════════════════════════════╝"
    echo ""
    echo "⚠️  IMPORTANT : Configuration requise"
    echo ""
    echo "Vous devez mettre à jour les chemins dans ces fichiers :"
    echo "1. backend/routes/tournaments.js (ligne 11)"
    echo "2. backend/routes/players.js (ligne 11)"
    echo ""
    echo "Remplacez par : '$SCRIPT_DIR/Tournament CSV files'"
    echo "            et : '$SCRIPT_DIR/Player CSV files'"
    echo ""
    echo "Pour démarrer l'application :"
    echo "  cd backend"
    echo "  npm start"
    echo ""
    echo "Puis ouvrez : http://localhost:3000"
    echo ""
else
    echo ""
    echo "❌ Erreur lors de l'installation"
    echo "Vérifiez votre connexion internet et réessayez"
    exit 1
fi
