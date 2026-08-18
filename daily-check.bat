@echo off
REM Runs the daily price check: downloads the latest Anipet catalog and records
REM any price changes vs. the previous run. Safe to run any time.
REM This is the file to point Windows Task Scheduler at (see README).
cd /d "%~dp0"
node scripts\fetch-catalog.js
