@echo off
echo Restarting Fisher WebSocket Server...
:: 优雅关闭
curl -s -X POST http://127.0.0.1:8889/internal/shutdown >nul 2>&1
if %errorlevel%==0 (
    echo Graceful shutdown signal sent, waiting 3s...
    timeout /t 3 /nobreak >nul
) else (
    echo Could not reach WS server, force killing...
    taskkill /F /IM node.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
)
:: 确保进程已退出
tasklist /FI "IMAGENAME eq node.exe" | findstr node.exe >nul 2>&1
if %errorlevel%==0 (
    taskkill /F /IM node.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
)
:: 启动
start /B cmd /c "cd /d C:\wwwroot\cs\node-ws && node src/index.js > C:\wwwroot\cs\runtime\node.log 2>&1"
echo Server restarted.
