@echo off
echo [Reload] Triggering hot-reload...
curl -s -X POST http://127.0.0.1:8889/internal/reload
echo.
echo [Reload] Done.
pause
