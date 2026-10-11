@echo off
title Fisher WebSocket Server
cd /d %~dp0
echo Starting Fisher WebSocket Server...
echo.
node src/index.js
pause
