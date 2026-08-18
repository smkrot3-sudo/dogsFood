@echo off
REM Starts the Anipet price scanner web server.
REM Double-click this file, then open http://localhost:3000 on this PC,
REM or the https://... LAN address shown below on your phone.
cd /d "%~dp0"
echo ================================================
echo   Anipet Price Scanner - server
echo ================================================
node server.js
pause
