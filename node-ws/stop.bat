@echo off
echo Stopping Fisher WebSocket Server (graceful)...
:: 先尝试优雅关闭（发送 close 帧给所有设备）
curl -s -X POST http://127.0.0.1:8889/internal/shutdown >nul 2>&1
if %errorlevel%==0 (
    echo Graceful shutdown signal sent, waiting 3s...
    timeout /t 3 /nobreak >nul
) else (
    echo Could not reach WS server, force killing...
)
:: 如果进程还在，强制杀掉
tasklist /FI "IMAGENAME eq node.exe" | findstr node.exe >nul 2>&1
if %errorlevel%==0 (
    taskkill /F /IM node.exe >nul 2>&1
    echo Force killed remaining node process.
)
echo Server stopped.
timeout /t 1 >nul
