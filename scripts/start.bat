@echo off
title Foodie Express Server
echo Starting Foodie Express...
echo.
echo Once you see "Foodie Express running -> http://localhost:3000"
echo open that link in your browser.
echo.
echo Press Ctrl+C in this window to stop the server.
echo.
call node "%~dp0..\server\server.js"
pause
