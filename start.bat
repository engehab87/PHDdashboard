@echo off
title Palm Hills Community Intelligence
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22+ from https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting Palm Hills Community Operations Intelligence on http://localhost:2020 ...
start "" "http://localhost:2020"
node server.js
pause
