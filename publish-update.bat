@echo off
setlocal enabledelayedexpansion
title Abbadon - Release & Update Wizard

echo =======================================================
echo            ABBADON - RELEASE & UPDATE WIZARD
echo =======================================================
echo.
echo This script prepares and packages a new version of the app,
echo which will be automatically fetched by all installed Abbadon clients.
echo.

node -e "const p = require('./package.json'); console.log('Current application version: v' + p.version);"

echo.
set /p NEW_VER="Enter new version number (e.g. 1.0.1) [Press Enter to keep current]: "

if not "%NEW_VER%"=="" (
  echo Updating package.json to version %NEW_VER%...
  node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); p.version = '%NEW_VER%'; fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');"
  echo Version updated to %NEW_VER%.
)

echo.
echo =======================================================
echo STEP 1/2: Compiling and building application...
echo =======================================================
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Application build failed!
  pause
  exit /b 1
)

echo.
echo =======================================================
echo STEP 2/2: Packaging installer and latest.yml...
echo =======================================================

REM If GH_TOKEN is set in environment, publish directly to GitHub Releases
if defined GH_TOKEN (
  echo GH_TOKEN detected. Publishing directly to GitHub Releases...
  call npx electron-builder --win --publish always
) else (
  echo Building installer locally into release/ directory...
  call npx electron-builder --win
)

if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Application packaging failed!
  pause
  exit /b 1
)

echo.
echo =======================================================
echo                 SUCCESS! RELEASE READY
echo =======================================================
echo.
echo All artifacts have been generated in the "release\" folder:
echo   1. latest.yml                   (hash and metadata file for auto-updater)
echo   2. Abbadon Setup *.exe          (Windows installer for end users)
echo.
echo To deliver this update to all users:
echo   - Go to your GitHub repository -> Releases -> Draft a new release.
echo   - Set tag to matching version (e.g. v1.0.1).
echo   - Drag and drop both files (latest.yml and Abbadon Setup *.exe).
echo   - Click "Publish release".
echo.
echo All installed apps will automatically detect, download, and prompt
echo to restart with 1 click on startup!
echo =======================================================
echo.
pause
