@echo off
chcp 65001 >nul
echo ╔════════════════════════════════════════════╗
echo ║   Billard Ranking App - Installation      ║
echo ╚════════════════════════════════════════════╝
echo.

REM Check if Node.js is installed
echo 🔍 Vérification de Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js n'est pas installé !
    echo.
    echo Téléchargez et installez Node.js depuis : https://nodejs.org/
    echo Choisissez la version LTS ^(Long Term Support^)
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js est installé : %NODE_VERSION%
echo.

REM Get the script's directory
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
echo 📁 Dossier de l'application : %SCRIPT_DIR%
echo.

REM Create CSV folders if they don't exist
echo 📂 Création des dossiers CSV...
if not exist "%SCRIPT_DIR%\Tournament CSV files" mkdir "%SCRIPT_DIR%\Tournament CSV files"
if not exist "%SCRIPT_DIR%\Player CSV files" mkdir "%SCRIPT_DIR%\Player CSV files"
echo ✅ Dossiers CSV créés
echo.

REM Navigate to backend folder
echo 📦 Installation des dépendances...
cd /d "%SCRIPT_DIR%\backend"

REM Install dependencies
call npm install

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ╔════════════════════════════════════════════╗
    echo ║          Installation terminée !           ║
    echo ╚════════════════════════════════════════════╝
    echo.
    echo ⚠️  IMPORTANT : Configuration requise
    echo.
    echo Vous devez mettre à jour les chemins dans ces fichiers :
    echo 1. backend\routes\tournaments.js ^(ligne 11^)
    echo 2. backend\routes\players.js ^(ligne 11^)
    echo.
    echo Remplacez par : '%SCRIPT_DIR%\Tournament CSV files'
    echo             et : '%SCRIPT_DIR%\Player CSV files'
    echo.
    echo Pour démarrer l'application :
    echo   cd backend
    echo   npm start
    echo.
    echo Puis ouvrez : http://localhost:3000
    echo.
) else (
    echo.
    echo ❌ Erreur lors de l'installation
    echo Vérifiez votre connexion internet et réessayez
    pause
    exit /b 1
)

pause
