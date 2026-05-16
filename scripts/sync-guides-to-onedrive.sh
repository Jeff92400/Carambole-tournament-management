#!/usr/bin/env bash
# ============================================================================
# sync-guides-to-onedrive.sh
# ----------------------------------------------------------------------------
# Synchronise les guides utilisateur HTML des 2 repos (Tournament Management
# et Player App) vers le dépôt OneDrive maître :
#   Documentations Applications Carambole FFB/Guides-Utilisateur/
#
# Détecte automatiquement la version courante de chaque app depuis
# le fichier de version affiché à l'utilisateur (login.html / index.html).
#
# Met les anciennes versions OneDrive en quarantaine dans :
#   Claude Clean Up/Doublons-AAAA-MM/Guides-Anciennes-Versions/
#
# Usage (depuis n'importe quel dossier) :
#   bash sync-guides-to-onedrive.sh           # exécution réelle
#   bash sync-guides-to-onedrive.sh --dry-run # simulation (n'écrit rien)
#
# Recommandé : lancer après chaque déploiement Railway, ou en post-commit hook.
# ============================================================================

set -euo pipefail

# --- Configuration ---------------------------------------------------------
REPO_TM="/Users/jeffrallet/Personal App/Carambole-tournament-management"
REPO_PA="/Users/jeffrallet/Personal App/cdbhs-player-app"
ONEDOC="/Users/jeffrallet/Library/CloudStorage/OneDrive-Personal/Billard/Projet Tournois management FFB/Documentations Applications Carambole FFB"
CCU="/Users/jeffrallet/Library/CloudStorage/OneDrive-Personal/Billard/Projet Tournois management FFB/Claude Clean Up"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🟡 MODE DRY-RUN — aucun fichier ne sera modifié"
fi

# --- Helpers --------------------------------------------------------------
run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    eval "$@"
  fi
}

extract_version() {
  # Extrait la version "V2.0.XXX" du fichier login/index (format affiché)
  # Source : "V 2.0.743 05/26" → retourne "V2.0.743"
  local file="$1"
  grep -oE "V 2\.0\.[0-9]+ [0-9]+/[0-9]+" "$file" | head -1 | awk '{print $1$2}'
}

# --- Détection des versions ------------------------------------------------
echo "═══ Détection des versions actuelles ═══"
VER_TM=$(extract_version "$REPO_TM/frontend/login.html")
VER_PA=$(extract_version "$REPO_PA/frontend/index.html")
echo "  Tournament Management : $VER_TM"
echo "  Player App            : $VER_PA"

if [[ -z "$VER_TM" || -z "$VER_PA" ]]; then
  echo "❌ Impossible de détecter une version. Abandon." >&2
  exit 1
fi

# --- Préparation quarantaine ----------------------------------------------
DATE_TAG="$(date +%Y-%m)"
QUARANTINE="$CCU/Doublons-${DATE_TAG}/Guides-Anciennes-Versions"
echo ""
echo "═══ Préparation quarantaine ═══"
echo "  → $QUARANTINE"
run "mkdir -p \"$QUARANTINE\""

# --- Étape 1 : déplacer les anciennes versions en quarantaine -------------
echo ""
echo "═══ Étape 1 : Quarantaine des versions OneDrive existantes ═══"
shopt -s nullglob
for old in "$ONEDOC/Guides-Utilisateur/Guide-Admin-Tournament-V"*.html \
           "$ONEDOC/Guides-Utilisateur/Guide-Calendrier-Admin-V"*.html \
           "$ONEDOC/Guides-Utilisateur/Guide-Directeur-de-Jeu-V"*.html \
           "$ONEDOC/Guides-Utilisateur/Guide-Espace-Joueur-V"*.html \
           "$ONEDOC/Guides-Utilisateur/Guide Administrateur"*.html \
           "$ONEDOC/Guides-Utilisateur/Guide Calendrier"*.html \
           "$ONEDOC/Guides-Utilisateur/Guide Utilisateur"*.html; do
  [[ -e "$old" ]] || continue
  base=$(basename "$old")
  # Skip si c'est la version qu'on est en train de re-générer
  if [[ "$base" == "Guide-Admin-Tournament-${VER_TM}.html" ]] || \
     [[ "$base" == "Guide-Calendrier-Admin-${VER_TM}.html" ]] || \
     [[ "$base" == "Guide-Directeur-de-Jeu-${VER_TM}.html" ]] || \
     [[ "$base" == "Guide-Espace-Joueur-${VER_PA}.html" ]]; then
    echo "  ⏭ skip (cible courante) : $base"
    continue
  fi
  echo "  → quarantaine : $base"
  run "mv \"$old\" \"$QUARANTINE/\""
done
shopt -u nullglob

# --- Étape 2 : copier les guides repo (récents) vers OneDrive --------------
echo ""
echo "═══ Étape 2 : Copie des guides repo vers OneDrive ═══"
copy_guide() {
  local src="$1" dst="$2" label="$3"
  if [[ ! -f "$src" ]]; then
    echo "  ⚠️  source absente : $src"
    return
  fi
  echo "  ✅ $label"
  run "cp \"$src\" \"$dst\""
}

copy_guide "$REPO_TM/frontend/guide-utilisateur.html" \
           "$ONEDOC/Guides-Utilisateur/Guide-Admin-Tournament-${VER_TM}.html" \
           "Guide Admin Tournament → ${VER_TM}"

copy_guide "$REPO_TM/frontend/guide-utilisateur-ddj.html" \
           "$ONEDOC/Guides-Utilisateur/Guide-Directeur-de-Jeu-${VER_TM}.html" \
           "Guide Directeur de Jeu → ${VER_TM}"

copy_guide "$REPO_TM/frontend/guide-calendrier-admin.html" \
           "$ONEDOC/Guides-Utilisateur/Guide-Calendrier-Admin-${VER_TM}.html" \
           "Guide Calendrier Admin → ${VER_TM}"

copy_guide "$REPO_PA/frontend/guide-utilisateur.html" \
           "$ONEDOC/Guides-Utilisateur/Guide-Espace-Joueur-${VER_PA}.html" \
           "Guide Espace Joueur → ${VER_PA}"

# --- Étape 3 : rappel mise à jour CLAUDE.md -------------------------------
echo ""
echo "═══ Étape 3 : Vérification version dans CLAUDE.md ═══"
CLAUDE_TM_VER=$(grep -oE "Current Version:\*\* V 2\.0\.[0-9]+ [0-9]+/[0-9]+" "$REPO_TM/CLAUDE.md" | grep -oE "V 2\.0\.[0-9]+" | tr -d ' ')
CLAUDE_PA_VER=$(grep -oE "Current Version:\*\* V 2\.0\.[0-9]+ [0-9]+/[0-9]+" "$REPO_PA/CLAUDE.md" 2>/dev/null | grep -oE "V 2\.0\.[0-9]+" | tr -d ' ' || echo "")

if [[ "$CLAUDE_TM_VER" != "$VER_TM" ]]; then
  echo "  🟡 CLAUDE.md Tournament : ${CLAUDE_TM_VER:-?} ≠ ${VER_TM} (à mettre à jour manuellement)"
else
  echo "  ✅ CLAUDE.md Tournament aligné : ${VER_TM}"
fi

if [[ -n "$CLAUDE_PA_VER" && "$CLAUDE_PA_VER" != "$VER_PA" ]]; then
  echo "  🟡 CLAUDE.md Player App : ${CLAUDE_PA_VER:-?} ≠ ${VER_PA} (à mettre à jour manuellement)"
elif [[ -n "$CLAUDE_PA_VER" ]]; then
  echo "  ✅ CLAUDE.md Player App aligné : ${VER_PA}"
fi

# --- Résumé ---------------------------------------------------------------
echo ""
echo "═══ Résumé ═══"
echo "  Versions synchronisées :"
echo "    Tournament Management → ${VER_TM}"
echo "    Player App            → ${VER_PA}"
if $DRY_RUN; then
  echo ""
  echo "🟡 Mode dry-run — aucune modification effectuée."
  echo "   Relancer sans --dry-run pour appliquer."
else
  echo ""
  echo "✅ Synchronisation terminée."
fi
echo ""
echo "Pour vérifier le résultat :"
echo "  ls \"$ONEDOC/Guides-Utilisateur/\""
