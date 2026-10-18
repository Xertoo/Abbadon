@echo off
title Push to GitHub - Abbadon
echo =======================================================
echo          PUSHING ABBADON CODEBASE TO GITHUB
echo =======================================================
echo.
echo Target Repository: https://github.com/Xertoo/abbadon.git
echo.

git push -u origin main

if %ERRORLEVEL% EQU 0 (
  echo.
  echo =======================================================
  echo     SUCCESS! Your code is now live on GitHub!
  echo =======================================================
  echo View your repository: https://github.com/Xertoo/abbadon
) else (
  echo.
  echo [NOTE] If a browser window opened, click 'Sign in with your browser'
  echo to authorize Git Credential Manager to push to your repository.
)

echo.
pause
