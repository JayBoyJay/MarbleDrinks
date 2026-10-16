@echo off
title MARBLE MAYHEM server
cd /d "%~dp0"
where node 1>NUL 2>NUL
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and run this again.
  pause
  exit /b
)
if exist "%~dp0server\venv\Scripts\python.exe" (
  start "Kitten TTS voices" /min cmd /k "cd /d "%~dp0" && server\venv\Scripts\python.exe server\kitten.py"
) else (
  where python 1>NUL 2>NUL
  if not errorlevel 1 start "Kitten TTS voices" /min cmd /k "cd /d "%~dp0" && python server\kitten.py"
)
start "" /min cmd /c "timeout /t 2 1>NUL & start http://localhost:3000"
node server\server.js
pause
