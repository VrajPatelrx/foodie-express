@echo off
title Foodie Express - Secure HTTPS Tunnel
cd /d "%~dp0.."
call node scripts\tunnel.js
if %ERRORLEVEL% NEQ 0 (
  pause
)
