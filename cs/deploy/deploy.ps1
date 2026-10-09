<#
Fisher 椤圭洰 Windows 涓€閿儴缃茶剼鏈?
============================================
椤圭洰浣嶇疆: C:\wwwroot\cs
鏀寔: Win10/Win Server 2016+
鍔熻兘:
  - 鑷姩瀹夎 MySQL/Redis (BtSoft 闆嗘垚)
  - 鑷姩閮ㄧ讲 PHP (ThinkPHP) 鍚庣
  - 鑷姩閮ㄧ讲 Node.js 鍚庣
  - 鑷姩閮ㄧ讲 React 鍓嶇
  - 鑷姩鍚姩 frps
  - 鑷姩鍚姩鎵€鏈夋湇鍔?
============================================
#>

#Requires -Version 5.1
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ==================== 棰滆壊鍑芥暟 ====================
function Write-Section($msg) {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success($msg) { Write-Host "鉁?$msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "鈩癸笍  $msg" -ForegroundColor Yellow }
function Write-Error1($msg) { Write-Host "鉂?$msg" -ForegroundColor Red }
function Write-Step($msg) { Write-Host "鈻?$msg" -ForegroundColor Magenta }

# ==================== 鐘舵€佹枃浠?====================
$stateFile = "C:\wwwroot\cs\deploy\.install_state.json"
$state = @{}
if (Test-Path $stateFile) {
    try { $state = Get-Content $stateFile -Raw | ConvertFrom-Json } catch {}
}

function Save-State {
    $state | ConvertTo-Json -Depth 5 | Set-Content $stateFile -Encoding UTF8
}

# ==================== 涓绘祦绋?====================
Clear-Host
Write-Host @"

  鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽
  鈺?  Fisher 椤圭洰 - Windows 涓€閿儴缃茶剼鏈?           鈺?
  鈺?  绯荤粺鏀寔: Win10 / Win Server 2016+           鈺?
  鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆
"@ -ForegroundColor Magenta
Write-Host ""
Write-Info "椤圭洰璺緞: C:\wwwroot\cs"
Write-Info "鏈剼鏈細瀹夎: MySQL + Redis + PHP + Node.js + React + frps"
Write-Info "濡備腑鏂?閲嶈窇姝よ剼鏈彲缁х画;閬囧埌閿欒璇疯繍琛?fix.ps1"
Write-Host ""

# ==================== 1. 妫€鏌ョ鐞嗗憳鏉冮檺 ====================
Write-Section "1/12 妫€鏌ョ鐞嗗憳鏉冮檺"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error1 "璇蜂互绠＄悊鍛樿韩浠借繍琛?PowerShell"
    Read-Host "鎸?Enter 閫€鍑?
    exit 1
}
Write-Success "绠＄悊鍛樻潈闄愮‘璁?

# ==================== 2. 妫€鏌ラ」鐩洰褰?====================
Write-Section "2/12 妫€鏌ラ」鐩洰褰?
if (-not (Test-Path "C:\wwwroot\cs\node-ws")) {
    Write-Error1 "椤圭洰鐩綍 C:\wwwroot\cs 涓嶅畬鏁?缂哄皯 node-ws 瀛愮洰褰?
    Read-Host "鎸?Enter 閫€鍑?
    exit 1
}
if (-not (Test-Path "C:\wwwroot\cs\app")) {
    Write-Error1 "缂哄皯 PHP 鍚庣鐩綍 C:\wwwroot\cs\app"
    Read-Host "鎸?Enter 閫€鍑?
    exit 1
}
if (-not (Test-Path "C:\wwwroot\cs\frontend-react")) {
    Write-Error1 "缂哄皯鍓嶇鐩綍 C:\wwwroot\cs\frontend-react"
    Read-Host "鎸?Enter 閫€鍑?
    exit 1
}
Write-Success "椤圭洰鐩綍瀹屾暣"

# ==================== 3. 瀹夎 BtSoft 闆嗘垚鐜(nginx + mysql + php + redis) ====================
Write-Section "3/12 瀹夎 BtSoft 闆嗘垚鐜(nginx/mysql/php/redis)"

if ($state.btsoft -eq 'done') {
    Write-Info "BtSoft 宸插畨瑁?璺宠繃"
} else {
    $btsoftPath = "C:\BtSoft"
    if (Test-Path $btsoftPath) {
        Write-Success "BtSoft 宸插瓨鍦?
    } else {
        Write-Info "BtSoft 鏈畨瑁?闇€瑕佹墜鍔ㄥ畨瑁?
        Write-Info "璇蜂笅杞? https://www.bt.cn/download/windows.html"
        Write-Info "瀹夎璺緞: $btsoftPath"
        Write-Info "瀹夎鏃跺嬀閫夌粍浠? Nginx + MySQL + PHP + Redis"
        Write-Info "鎺ㄨ崘 PHP 鐗堟湰: 7.4"
        Read-Host "瀹夎瀹屾垚鍚庢寜 Enter 缁х画"
        if (-not (Test-Path $btsoftPath)) {
            Write-Error1 "BtSoft 浠嶆湭瀹夎,閫€鍑?
            exit 1
        }
    }
    $state.btsoft = 'done'
    Save-State
}

# ==================== 4. 鍒濆鍖?MySQL 鏁版嵁搴?====================
Write-Section "4/12 鍒濆鍖?MySQL 鏁版嵁搴?

$mysqlBin = "C:\BtSoft\MySQL\bin\mysql.exe"
if (-not (Test-Path $mysqlBin)) {
    $mysqlBin = (Get-Command mysql.exe -ErrorAction SilentlyContinue).Source
}

if (-not $mysqlBin) {
    Write-Error1 "鎵句笉鍒?mysql.exe,璇风‘璁?MySQL 宸插畨瑁呭苟鍔犲叆 PATH"
} else {
    Write-Info "MySQL 璺緞: $mysqlBin"

    if ($state.mysql_init -eq 'done') {
        Write-Info "MySQL 鏁版嵁搴撳凡鍒濆鍖?璺宠繃"
    } else {
        # 妫€鏌?.env 鍙栧瘑鐮?
        $envFile = "C:\wwwroot\cs\node-ws\.env"
        $dbUser = "cs725"
        $dbPass = "cs725"
        if (Test-Path $envFile) {
            $envContent = Get-Content $envFile -Raw
            if ($envContent -match 'DB_USER=(.+)') { $dbUser = $matches[1].Trim() }
            if ($envContent -match 'DB_PASS=(.+)') { $dbPass = $matches[1].Trim() }
        }
        Write-Info "DB 鐢ㄦ埛: $dbUser"

        # 娴嬭瘯杩炴帴
        $testSql = "SELECT VERSION();"
        $versionOutput = & $mysqlBin -u $dbUser -p"$dbPass" -N -e "SELECT VERSION();" 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error1 "鏃犳硶杩炴帴 MySQL,璇风‘璁ゅ瘑鐮?
            Write-Info "灏濊瘯閲嶇疆: $mysqlBin -u root -e \"ALTER USER '$dbUser'@'localhost' IDENTIFIED BY '$dbPass';\""
        } else {
            Write-Success "MySQL 杩炴帴鎴愬姛(鐗堟湰: $versionOutput)"
        }

        # 瀵煎叆鏁版嵁搴?
        $sqlFile = $null
        Get-ChildItem "C:\wwwroot\cs" -Filter "*.sql" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.Name -match 'cs\.sql|cs725\.sql|init\.sql') { $sqlFile = $_.FullName }
        }
        if ($sqlFile) {
            Write-Info "鎵惧埌鏁版嵁搴撴枃浠? $sqlFile"
            $dbName = "cs725"
            if (Test-Path $envFile) {
                $envContent = Get-Content $envFile -Raw
                if ($envContent -match 'DB_NAME=(.+)') { $dbName = $matches[1].Trim() }
            }
            Write-Info "瀵煎叆鍒版暟鎹簱: $dbName"
            & $mysqlBin -u $dbUser -p"$dbPass" -e "CREATE DATABASE IF NOT EXISTS \`$dbName\` DEFAULT CHARACTER SET utf8mb4;"
            Get-Content $sqlFile -Raw | & $mysqlBin -u $dbUser -p"$dbPass" $dbName
            if ($LASTEXITCODE -eq 0) {
                Write-Success "鏁版嵁搴撳鍏ユ垚鍔?
                $state.mysql_init = 'done'
                Save-State
            } else {
                Write-Error1 "鏁版嵁搴撳鍏ュけ璐?鍙兘鏂囦欢宸插瓨鍦?
            }
        } else {
            Write-Info "鏈壘鍒?.sql 鏂囦欢,闇€瑕佹墜鍔ㄥ鍏?
        }
    }
}

# ==================== 5. 閮ㄧ讲 PHP 鍚庣 (ThinkPHP) ====================
Write-Section "5/12 閮ㄧ讲 PHP 鍚庣"

if ($state.php -eq 'done') {
    Write-Info "PHP 鍚庣宸查儴缃?璺宠繃"
} else {
    $phpDir = "C:\wwwroot\cs\app"
    if (Test-Path $phpDir) {
        # 鍒涘缓 runtime 鐩綍(ThinkPHP 闇€瑕?
        if (-not (Test-Path "$phpDir\runtime")) {
            New-Item -ItemType Directory -Path "$phpDir\runtime" -Force | Out-Null
            Write-Info "鍒涘缓 runtime 鐩綍"
        }

        # 妫€鏌?nginx vhost 閰嶇疆
        $vhostConf = "C:\BtSoft\nginx\conf\nginx.conf"
        $phpSite = "default"
        $vhostLink = "C:\BtSoft\nginx\conf\vhost\$phpSite.conf"
        $phpSiteConf = Get-Content $vhostLink -Raw -ErrorAction SilentlyContinue

        # 妫€鏌ユ槸鍚﹂厤缃繃 PHP
        if ($phpSiteConf -and ($phpSiteConf -match "root.*wwwroot|app")) {
            Write-Success "PHP 绔欑偣宸查厤缃?(vhost/default.conf)"
        } else {
            Write-Info "闇€瑕侀厤缃?PHP 绔欑偣 vhost"
            # 鍐欏叆榛樿 vhost 閰嶇疆
            @"
server {
    listen 80;
    server_name _;
    root  C:/wwwroot/cs/app/public;
    index index.php index.html;
    location / {
        if (!-e $request_filename) {
            rewrite ^/(.*)$ /index.php?s=$1 last;
            break;
        }
    }
    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        fastcgi_split_path_info ^(.+\\.php)(.*)$;
        include fastcgi-php.conf;
    }
}
"@ | Set-Content $vhostLink -Encoding UTF8
            Write-Success "PHP vhost 閰嶇疆宸插啓鍏?
        }

        Write-Success "PHP 鍚庣閮ㄧ讲瀹屾垚"
        $state.php = 'done'
        Save-State
    } else {
        Write-Error1 "PHP 鍚庣鐩綍涓嶅瓨鍦?
    }
}

# ==================== 6. 瀹夎 Node.js ====================
Write-Section "6/12 瀹夎 Node.js"

$nodeCmd = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if ($nodeCmd) {
    $nodeVer = & node -v 2>&1
    Write-Success "Node.js 宸插畨瑁? $nodeVer"
    $state.node = 'done'
} else {
    Write-Info "Node.js 鏈畨瑁?鑷姩涓嬭浇"
    $arch = (Get-CimInstance Win32_Processor).Architecture
    $nodeArch = if ($arch -eq 9) { "x64" } else { "x86" }
    $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-${nodeArch}.zip"
    $nodeZip = "$env:TEMP\node.zip"
    Write-Info "涓嬭浇: $nodeUrl"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing
        $nodeExtract = "C:\nodejs"
        Expand-Archive $nodeZip -DestinationPath $nodeExtract -Force
        [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$nodeExtract", "User")
        $env:Path = $env:Path + ";$nodeExtract"
        Write-Success "Node.js 瀹夎瀹屾垚"
        $state.node = 'done'
    } catch {
        Write-Error1 "Node.js 涓嬭浇澶辫触,璇锋墜鍔ㄥ畨瑁?
    }
}
Save-State

# ==================== 7. 瀹夎 Node.js 渚濊禆 ====================
Write-Section "7/12 瀹夎 Node.js 渚濊禆"
if (Test-Path "C:\wwwroot\cs\node-ws\package.json") {
    Push-Location "C:\wwwroot\cs\node-ws"
    if (Test-Path "node_modules") {
        Write-Success "node_modules 宸插瓨鍦?
    } else {
        Write-Info "杩愯 npm install(鍙兘闇€瑕?5-10 鍒嗛挓)"
        npm install --registry=https://registry.npmmirror.com
        if ($LASTEXITCODE -eq 0) {
            Write-Success "npm install 瀹屾垚"
        } else {
            Write-Error1 "npm install 澶辫触"
        }
    }
    Pop-Location
}

# ==================== 8. 閰嶇疆 .env ====================
Write-Section "8/12 閰嶇疆 .env"
$envExample = "C:\wwwroot\cs\node-ws\.env.example"
$envFile = "C:\wwwroot\cs\node-ws\.env"
if (Test-Path $envExample) {
    if (-not (Test-Path $envFile)) {
        Copy-Item $envExample $envFile
        Write-Success "宸蹭粠 .env.example 澶嶅埗 .env"
    } else {
        Write-Info ".env 宸插瓨鍦?璺宠繃"
    }
} else {
    Write-Info ".env.example 涓嶅瓨鍦?闇€瑕佹墜鍔ㄥ垱寤?.env"
}

# ==================== 9. 閮ㄧ讲鍓嶇(React) ====================
Write-Section "9/12 閮ㄧ讲鍓嶇"
if (Test-Path "C:\wwwroot\cs\frontend-react\package.json") {
    if ($state.frontend -eq 'done') {
        Write-Info "鍓嶇宸叉瀯寤?璺宠繃"
    } else {
        Push-Location "C:\wwwroot\cs\frontend-react"
        if (-not (Test-Path "node_modules")) {
            Write-Info "杩愯 npm install"
            npm install --registry=https://registry.npmmirror.com
        }
        if (-not (Test-Path "dist")) {
            Write-Info "杩愯 npm run build"
            npm run build
        }
        if (Test-Path "dist") {
            Write-Success "鍓嶇宸叉瀯寤?
            $state.frontend = 'done'
            Save-State
        }
        Pop-Location
    }

    # 閰嶇疆鍓嶇 vhost
    $vhostLink = "C:\BtSoft\nginx\conf\vhost\frontend.conf"
    if (-not (Test-Path $vhostLink)) {
        @"
server {
    listen 8888;
    server_name _;
    root  C:/wwwroot/cs/frontend-react/dist;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
"@ | Set-Content $vhostLink -Encoding UTF8
        Write-Success "鍓嶇 vhost 閰嶇疆宸插啓鍏?绔彛 8888)"
    }
}

# ==================== 10. 閮ㄧ讲 frp ====================
Write-Section "10/12 閮ㄧ讲 frp"
$frpDir = "C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64"
if (Test-Path $frpDir) {
    Write-Success "frp 宸查儴缃? $frpDir"
    $state.frp = 'done'
} else {
    Write-Info "frp 鏈儴缃?璇锋墜鍔ㄤ笅杞藉埌: $frpDir"
}
Save-State

# ==================== 11. 鍒涘缓鍚姩鑴氭湰 ====================
Write-Section "11/12 鍒涘缓鍚姩鑴氭湰"

$startBat = @"
@echo off
chcp 65001 >nul
title Fisher Project

echo ============================================
echo  Fisher Project - 鏈嶅姟鍚姩鍣?
echo  鍚姩鏃堕棿: %date% %time%
echo ============================================

echo.
echo [1/4] 鍚姩 frps(绔彛 7000/7500)...
start "frps" cmd /k "C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.exe -c C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.toml"
timeout /t 2 >nul

echo [2/4] 鍚姩 MySQL/BtSoft 闈㈡澘...
net start BtSoftMySQL 2>nul
net start BtSoftRedis 2>nul
net start BtSoftNginx 2>nul
net start BtSoftPHP 2>nul
timeout /t 3 >nul

echo [3/4] 鍚姩 Node.js (绔彛 8889)...
start "fisher-ws" cmd /k "cd /d C:\wwwroot\cs\node-ws && C:\nodejs\node.exe src/index.js"
timeout /t 3 >nul

echo [4/4] 鍚姩 frpc 瀹㈡埛绔?璁惧妯℃嫙鍣?...
adb devices
echo.
echo 鍚姩瀹屾垚!
echo 璁块棶:
echo   鍓嶇:  http://localhost:8888
echo   鍚庣:  http://localhost
echo   WS:    ws://localhost:8889/ws/panel
echo   frp:   http://localhost:7500
echo.
pause
"@

$startPath = "C:\wwwroot\cs\deploy\start.bat"
Set-Content $startPath $startBat -Encoding UTF8
Write-Success "鍚姩鑴氭湰: $startPath"

# ==================== 12. 瀹屾垚 ====================
Write-Section "12/12 閮ㄧ讲瀹屾垚!"
Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  鉁?Fisher 椤圭洰閮ㄧ讲鎴愬姛!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "鏈嶅姟璁块棶鍦板潃:"
Write-Host "  鈥?鍓嶇:    http://localhost:8888"
Write-Host "  鈥?PHP API:  http://localhost"
Write-Host "  鈥?Node.js WS: ws://localhost:8889"
Write-Host "  鈥?frp 鎺у埗:  http://localhost:7500"
Write-Host ""
Write-Host "鍚姩鏂瑰紡:"
Write-Host "  鍙屽嚮: C:\wwwroot\cs\deploy\start.bat"
Write-Host ""
Write-Host "濡傛湁闂:"
Write-Host "  閲嶆柊杩愯: C:\wwwroot\cs\deploy\deploy.ps1"
Write-Host "  淇杩愯: C:\wwwroot\cs\deploy\fix.ps1"
Write-Host ""
Read-Host "鎸?Enter 閫€鍑?


