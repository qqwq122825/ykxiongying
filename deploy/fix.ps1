<#
Fisher 项目 - 修复脚本
============================================
用法: 在 deploy.ps1 中途失败后,运行此脚本
    根据报错选择对应阶段继续
============================================
#>

#Requires -Version 5.1
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Continue'

function Write-Section($msg) {
    Write-Host ""
    Write-Host "==== $msg ====" -ForegroundColor Cyan
}

function Write-Success($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "[*] $msg" -ForegroundColor Yellow }
function Write-Error1($msg) { Write-Host "[X] $msg" -ForegroundColor Red }

Clear-Host
Write-Host "Fisher 项目 - 修复脚本" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""
Write-Host "请选择要修复的阶段:"
Write-Host "  1. 检查并修复管理员权限"
Write-Host "  2. 检查 BtSoft 安装"
Write-Host "  3. 检查 MySQL 数据库"
Write-Host "  4. 重新导入数据库"
Write-Host "  5. 检查 PHP 配置"
Write-Host "  6. 检查 Node.js 依赖"
Write-Host "  7. 重新安装 npm 依赖"
Write-Host "  8. 检查 .env 配置"
Write-Host "  9. 重启 Node.js 服务"
Write-Host "  10. 重启 frps"
Write-Host "  11. 重启 nginx"
Write-Host "  12. 检查端口监听"
Write-Host "  13. 全部修复(按顺序)"
Write-Host "  0. 退出"
Write-Host ""
$choice = Read-Host "请输入选择 (0-13)"

switch ($choice) {
    "1" { Fix-Admin }
    "2" { Fix-BtSoft }
    "3" { Fix-MySQL }
    "4" { Fix-ReimportDB }
    "5" { Fix-PHP }
    "6" { Fix-NodeDeps }
    "7" { Fix-NpmInstall }
    "8" { Fix-Env }
    "9" { Fix-NodeJS }
    "10" { Fix-Frps }
    "11" { Fix-Nginx }
    "12" { Fix-Ports }
    "13" {
        Fix-Admin
        Fix-BtSoft
        Fix-MySQL
        Fix-ReimportDB
        Fix-PHP
        Fix-NodeDeps
        Fix-Env
        Fix-NodeJS
        Fix-Frps
        Fix-Nginx
        Fix-Ports
    }
    "0" { exit }
}

# ==================== 修复函数 ====================
function Fix-Admin {
    Write-Section "检查管理员权限"
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Write-Success "当前是管理员"
    } else {
        Write-Error1 "当前不是管理员"
        Write-Info "右键 PowerShell → '以管理员身份运行'"
    }
    Pause
}

function Fix-BtSoft {
    Write-Section "检查 BtSoft 安装"
    $btsoft = "C:\BtSoft"
    if (Test-Path $btsoft) {
        Write-Success "BtSoft 已安装"
        Write-Info "组件目录:"
        Get-ChildItem $btsoft -Directory | ForEach-Object {
            Write-Host "  - $($_.Name)"
        }
    } else {
        Write-Error1 "BtSoft 未安装"
        Write-Info "下载: https://www.bt.cn/download/windows.html"
        Write-Info "安装到: $btsoft"
    }
    Pause
}

function Fix-MySQL {
    Write-Section "检查 MySQL"
    $mysql = "C:\BtSoft\MySQL\bin\mysql.exe"
    if (-not (Test-Path $mysql)) {
        $mysql = (Get-Command mysql.exe -ErrorAction SilentlyContinue).Source
    }
    if ($mysql) {
        Write-Success "MySQL: $mysql"
        $envFile = "C:\wwwroot\cs\node-ws\.env"
        $dbUser = "cs725"
        $dbPass = "cs725"
        if (Test-Path $envFile) {
            $envContent = Get-Content $envFile -Raw
            if ($envContent -match 'DB_USER=(.+)') { $dbUser = $matches[1].Trim() }
            if ($envContent -match 'DB_PASS=(.+)') { $dbPass = $matches[1].Trim() }
        }
        Write-Info "测试连接 (user=$dbUser)..."
        $ver = & $mysql -u $dbUser -p"$dbPass" -N -e "SELECT VERSION();" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "MySQL 连接成功(版本: $ver)"
            & $mysql -u $dbUser -p"$dbPass" -e "SHOW DATABASES;" 2>&1
        } else {
            Write-Error1 "MySQL 连接失败"
            Write-Info "尝试重置密码:"
            Write-Host "  $mysql -u root -e \"ALTER USER '$dbUser'@'localhost' IDENTIFIED BY '$dbPass';\""
        }
    } else {
        Write-Error1 "找不到 mysql.exe"
    }
    Pause
}

function Fix-ReimportDB {
    Write-Section "重新导入数据库"
    $sqlFiles = Get-ChildItem "C:\wwwroot\cs" -Filter "*.sql" -Recurse -Depth 2 -ErrorAction SilentlyContinue
    $sqlFile = $null
    $sqlFiles | ForEach-Object { if ($_.Name -match 'cs\.sql|cs725\.sql|init\.sql') { $sqlFile = $_.FullName } }
    if (-not $sqlFile) {
        Write-Error1 "未找到 .sql 文件"
    } else {
        Write-Info "SQL 文件: $sqlFile"
        $mysql = "C:\BtSoft\MySQL\bin\mysql.exe"
        $dbUser = "cs725"
        $dbPass = "cs725"
        $envFile = "C:\wwwroot\cs\node-ws\.env"
        if (Test-Path $envFile) {
            $envContent = Get-Content $envFile -Raw
            if ($envContent -match 'DB_USER=(.+)') { $dbUser = $matches[1].Trim() }
            if ($envContent -match 'DB_PASS=(.+)') { $dbPass = $matches[1].Trim() }
            if ($envContent -match 'DB_NAME=(.+)') { $dbName = $matches[1].Trim() }
        } else {
            $dbName = "cs725"
        }
        $drop = Read-Host "是否 DROP 数据库 $dbName 重新导入? (yes/no)"
        if ($drop -eq 'yes') {
            & $mysql -u $dbUser -p"$dbPass" -e "DROP DATABASE IF EXISTS \`$dbName\`; CREATE DATABASE \`$dbName\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
            Get-Content $sqlFile -Raw | & $mysql -u $dbUser -p"$dbPass" $dbName
            if ($LASTEXITCODE -eq 0) {
                Write-Success "数据库重新导入成功"
            } else {
                Write-Error1 "数据库导入失败"
            }
        } else {
            Get-Content $sqlFile -Raw | & $mysql -u $dbUser -p"$dbPass" $dbName
            Write-Info "已执行导入(可能跳过冲突)"
        }
    }
    Pause
}

function Fix-PHP {
    Write-Section "检查 PHP"
    $php = (Get-Command php.exe -ErrorAction SilentlyContinue).Source
    if ($php) {
        Write-Success "PHP: $php"
        & php -v
    } else {
        Write-Error1 "PHP 未安装"
        Write-Info "通过 BtSoft 面板安装 PHP 7.4"
    }
    Write-Host ""
    Write-Info "PHP 服务状态:"
    $services = Get-Service | Where-Object { $_.Name -match 'PHP|Mysql|Redis|Nginx|BtSoft' }
    $services | ForEach-Object {
        $color = if ($_.Status -eq 'Running') { 'Green' } else { 'Red' }
        Write-Host "  $($_.Name): $($_.Status)" -ForegroundColor $color
    }
    Pause
}

function Fix-NodeDeps {
    Write-Section "检查 Node.js 依赖"
    if (Test-Path "C:\wwwroot\cs\node-ws\package.json") {
        $json = Get-Content "C:\wwwroot\cs\node-ws\package.json" -Raw | ConvertFrom-Json
        $deps = $json.dependencies
        Write-Info "package.json 有 $($deps.Count) 个依赖"
        $deps.Keys | ForEach-Object { Write-Host "  - $_" }
    } else {
        Write-Error1 "package.json 不存在"
    }
    if (Test-Path "C:\wwwroot\cs\node-ws\node_modules") {
        $moduleCount = (Get-ChildItem "C:\wwwroot\cs\node-ws\node_modules" -Directory).Count
        Write-Success "node_modules 有 $moduleCount 个模块"
    } else {
        Write-Error1 "node_modules 不存在"
    }
    Pause
}

function Fix-NpmInstall {
    Write-Section "重新安装 npm 依赖"
    $dirs = @(
        "C:\wwwroot\cs\node-ws",
        "C:\wwwroot\cs\frontend-react"
    )
    foreach ($dir in $dirs) {
        if (Test-Path "$dir\package.json") {
            Push-Location $dir
            Write-Info "在 $dir 安装依赖"
            $useMirror = Read-Host "使用淘宝镜像源? (yes/no)"
            if ($useMirror -eq 'yes') {
                npm install --registry=https://registry.npmmirror.com
            } else {
                npm install
            }
            if ($LASTEXITCODE -eq 0) {
                Write-Success "$dir 依赖安装完成"
            } else {
                Write-Error1 "$dir 依赖安装失败"
            }
            Pop-Location
        }
    }
    Pause
}

function Fix-Env {
    Write-Section "检查 .env 配置"
    $envFile = "C:\wwwroot\cs\node-ws\.env"
    $envExample = "C:\wwwroot\cs\node-ws\.env.example"
    if (Test-Path $envFile) {
        Write-Success ".env 存在"
        Write-Info "内容:"
        Get-Content $envFile | ForEach-Object { Write-Host "  $_" }
    } elseif (Test-Path $envExample) {
        Write-Info ".env 不存在但 .env.example 存在,复制"
        Copy-Item $envExample $envFile
    } else {
        Write-Error1 ".env 和 .env.example 都不存在"
    }
    Pause
}

function Fix-NodeJS {
    Write-Section "重启 Node.js 服务"
    Write-Info "停止现有 Node.js 进程"
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '' -or $_.Path -match 'index\.js' } | ForEach-Object {
        Write-Host "  停止 PID $($_.Id)"
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2

    $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) {
        $nodeExe = "C:\nodejs\node.exe"
    }

    if (-not (Test-Path $nodeExe)) {
        Write-Error1 "找不到 node.exe"
    } else {
        Write-Info "启动 Node.js (用 0.0.0.0 监听)"
        Start-Process -FilePath $nodeExe -ArgumentList "src/index.js" -WorkingDirectory "C:\wwwroot\cs\node-ws" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        $test = Invoke-WebRequest -Uri "http://127.0.0.1:8889/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($test.StatusCode -eq 200) {
            Write-Success "Node.js 启动成功(端口 8889 在线)"
        } else {
            Write-Error1 "Node.js 启动失败(端口 8889 不在线)"
        }
    }
    Pause
}

function Fix-Frps {
    Write-Section "重启 frps"
    $frpsExe = "C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.exe"
    if (Test-Path $frpsExe) {
        Write-Info "停止现有 frps 进程"
        Get-Process frps -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-Info "启动 frps"
        Start-Process -FilePath $frpsExe -ArgumentList "-c C:\Users\Administrator\Desktop\frp_0.61.1_windows_amd64\frps.toml" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        $test = Invoke-WebRequest -Uri "http://127.0.0.1:7500/" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($test.StatusCode -eq 200 -or $test.StatusCode -eq 401 -or $test.StatusCode -eq 403) {
            Write-Success "frps 启动成功(端口 7500 在线)"
        } else {
            Write-Error1 "frps 启动失败"
        }
    } else {
        Write-Error1 "找不到 frps.exe: $frpsExe"
    }
    Pause
}

function Fix-Nginx {
    Write-Section "重启 nginx"
    $nginx = "C:\BtSoft\nginx\nginx.exe"
    if (Test-Path $nginx) {
        Write-Info "测试配置"
        & $nginx -t -p "C:\BtSoft\nginx" 2>&1
        Write-Info "重新加载配置"
        & $nginx -s reload -p "C:\BtSoft\nginx" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "nginx 重载成功"
        } else {
            Write-Error1 "nginx 重载失败"
        }
    } else {
        Write-Error1 "找不到 nginx.exe"
    }
    Pause
}

function Fix-Ports {
    Write-Section "检查关键端口监听"
    $ports = @(80, 3306, 6379, 7000, 7500, 8888, 8889, 9000)
    foreach ($port in $ports) {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            Write-Host "  $port : $($process.ProcessName) (PID $($conn.OwningProcess))" -ForegroundColor Green
        } else {
            Write-Host "  $port : 未监听" -ForegroundColor Yellow
        }
    }
    Pause
}
