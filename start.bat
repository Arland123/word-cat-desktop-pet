@echo off
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required to start the Electron desktop pet.
  pause
  exit /b 1
)
npm start
