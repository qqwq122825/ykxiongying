@echo off
chcp 65001 >nul
title Fisher Project - Service Manager
setlocal enabledelayedexpansion

:MENU
cls
echo ============================================
echo  Fisher Project - Service Controller
echo  Time: %date% %time%
echo ============================================
echo.
echo  [1] Start ALL services
echo  [2] Stop ALL services
echo  [3] Restart ALL services
echo  [4] Start Node.js only
echo  [5] Stop Node.js only
echo  [6] Start frps only
echo  [7] Stop frps only
echo  [8] Start BtSoft services (MySQL/PHP/Nginx/Redis)
echo  [9] View service status
echo  [0] Exit
echo.
set /p choice="Please choose (0-9): "

if "%choice%"=="1" goto START_ALL
if "%choice%"=="2" goto STOP_ALL
if "%choice%"=="3" goto RESTART_ALL
if "%choice%"=="4" goto START_NODE
if "%choice%"=="5" goto STOP_NODE
if "%choice%"=="6" goto START_FRPS
if "%choice%"=="7" goto STOP_FRPS
if "%choice%"=="8" goto START_BTSOFT
if "%choice%"=="9" goto STATUS
if "%choice%"=="0" exit
goto MENU

:START_ALL
echo.
echo === Starting BtSoft services ===
net start BtSoftMySQL 2>nul
net start BtSoftRedis 2>nul
net start BtSoftNginx 2>nul
net start BtSoftPHP 2>nul
timeout /t 3 >nul

echo === Starting frps ===
start "frps" /min cmd /k "C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.exe -c C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.toml"
timeout /t 2 >nul

echo === Starting Node.js ===
start "fisher-ws" /min cmd /k "cd /d C:\wwwroot\cs\node-ws && C:\nodejs\node.exe src/index.js"
timeout /t 3 >nul

echo.
echo All services started!
echo.
echo Access:
echo   Frontend:  http://localhost:8888
echo   Backend:   http://localhost
echo   WS:        ws://localhost:8889
echo   frp:       http://localhost:7500
echo.
pause
goto MENU

:STOP_ALL
echo.
echo === Stopping Node.js ===
taskkill /F /IM node.exe /FI "WINDOWTITLE eq fisher-ws*" 2>nul
taskkill /F /IM node.exe 2>nul

echo === Stopping frps ===
taskkill /F /IM frps.exe 2>nul

echo === Stopping BtSoft services (PHP only, keep MySQL/Redis/Nginx) ===
net stop BtSoftPHP 2>nul

echo.
echo All services stopped!
pause
goto MENU

:RESTART_ALL
call :STOP_ALL
timeout /t 3 >nul
call :START_ALL
goto MENU

:START_NODE
echo.
echo Starting Node.js (fisher-ws)...
start "fisher-ws" /min cmd /k "cd /d C:\wwwroot\cs\node-ws && C:\nodejs\node.exe src/index.js"
timeout /t 3 >nul
echo Done!
pause
goto MENU

:STOP_NODE
echo.
echo Stopping Node.js...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq fisher-ws*" 2>nul
echo Done!
pause
goto MENU

:START_FRPS
echo.
echo Starting frps...
start "frps" /min cmd /k "C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.exe -c C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.toml"
timeout /t 2 >nul
echo Done!
pause
goto MENU

:STOP_FRPS
echo.
echo Stopping frps...
taskkill /F /IM frps.exe 2>nul
echo Done!
pause
goto MENU

:START_BTSOFT
echo.
echo Starting BtSoft services...
net start BtSoftMySQL 2>nul
net start BtSoftRedis 2>nul
net start BtSoftNginx 2>nul
net start BtSoftPHP 2>nul
timeout /t 3 >nul
echo Done!
pause
goto MENU

:STATUS
echo.
echo === Service Status ===
echo.
echo [MySQL]
net start | findstr Mysql
sc query BtSoftMySQL 2>nul | findstr STATE
echo.
echo [Redis]
sc query BtSoftRedis 2>nul | findstr STATE
echo.
echo [Nginx]
sc query BtSoftNginx 2>nul | findstr STATE
echo.
echo [PHP]
sc query BtSoftPHP 2>nul | findstr STATE
echo.
echo [Node.js (fisher-ws)]
tasklist /FI "IMAGENAME eq node.exe" 2>nul
echo.
echo [frps]
tasklist /FI "IMAGENAME eq frps.exe" 2>nul
echo.
echo === Listening Ports ===
netstat -ano | findstr "LISTENING" | findstr ":80 \|:443 \|:3306 \|:6379 \|:7000 \|:7500 \|:8888 \|:8889 " 2>nul
echo.
pause
goto MENU
