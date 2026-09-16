@echo off
title Foodie Express - Permanent HTTPS Tunnel
echo ========================================================
echo   Foodie Express - Permanent Authenticated HTTPS Tunnel
echo ========================================================
echo.
echo Connecting to your permanent static domain:
echo https://divina-nondiscordant-malissa.ngrok-free.dev
echo.
echo ========================================================
echo  This URL NEVER changes! 
echo  Bookmark it on your phone or install the PWA once.
echo ========================================================
echo.
"%~dp0ngrok.exe" http --url=https://divina-nondiscordant-malissa.ngrok-free.dev 3000
pause
