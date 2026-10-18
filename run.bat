@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :err
)

echo.
echo   SoundPulse Pro 9000 - launching desktop app
echo.

call npm run app || goto :err
goto :eof

:err
echo.
echo Build failed. Run "npm install" and try again.
pause
endlocal