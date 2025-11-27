#!/bin/bash

# French Billiard Ranking System - Start Script

echo "╔════════════════════════════════════════════╗"
echo "║  French Billiard Ranking System           ║"
echo "║  Démarrage de l'application...            ║"
echo "╚════════════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")/backend"

echo "📦 Vérification des dépendances..."
if [ ! -d "node_modules" ]; then
    echo "Installation des dépendances npm..."
    npm install --cache /tmp/npm-cache
fi

echo ""
echo "🚀 Démarrage du serveur..."
echo ""
echo "✅ L'application sera accessible sur: http://localhost:3000"
echo "🔑 Mot de passe par défaut: admin123"
echo ""
echo "Pour arrêter le serveur, appuyez sur Ctrl+C"
echo ""

npm start
