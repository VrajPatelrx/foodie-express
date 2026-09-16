@echo off
title Foodie Express - Install Dependencies
echo Installing Foodie Express dependencies...
echo (This only needs to run once)
echo.
cd /d "%~dp0.."
call npm install
echo.
echo Done. Now run start.bat to run the app.
pause
