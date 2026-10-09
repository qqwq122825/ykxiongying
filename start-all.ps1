$ErrorActionPreference = "Continue"
$ROOT = "C:\Users\Administrator\Desktop\stST\local"
$PHP  = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"
$INI  = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.ini"
$NODE = "C:\Program Files\nodejs\node.exe"

Write-Host "[1/3] MySQL ..." -ForegroundColor Cyan
if ((Get-Service MySQL -ErrorAction SilentlyContinue).Status -ne 'Running') { Start-Service MySQL }

Write-Host "[2/3] ThinkPHP backend :8081 ..." -ForegroundColor Cyan
$env:PHP_CLI_SERVER_WORKERS = "8"
Start-Process -FilePath $PHP -ArgumentList @("-c", $INI, "-S", "0.0.0.0:8081", "-t", "public", "public/router.php") -WorkingDirectory "$ROOT\cs" -WindowStyle Hidden

Write-Host "[2/3] node-ws :8889 ..." -ForegroundColor Cyan
Start-Process -FilePath $NODE -ArgumentList @("src/index.js") -WorkingDirectory "$ROOT\cs\node-ws" -WindowStyle Hidden -RedirectStandardOutput "$ROOT\logs\ws-out.log" -RedirectStandardError "$ROOT\logs\ws-err.log"

Write-Host "[3/3] front door :8080 ..." -ForegroundColor Cyan
Start-Process -FilePath $NODE -ArgumentList @("server.mjs") -WorkingDirectory "$ROOT\front" -WindowStyle Hidden -RedirectStandardOutput "$ROOT\logs\front-out.log" -RedirectStandardError "$ROOT\logs\front-err.log"

Start-Sleep -Seconds 5

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*以太网 2*' -and $_.InterfaceAlias -notlike '*以太网 3*' } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "=================== 本地面板已启动 ===================" -ForegroundColor Green
Write-Host "  本机访问:   http://127.0.0.1:8080" -ForegroundColor Yellow
Write-Host "  局域网访问: http://$ip`:8080" -ForegroundColor Yellow
Write-Host "  账号: admin / admin123      (备份账号: mkdemo / admin123)" -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Green
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8080,8081,8889 } | Select-Object LocalAddress,LocalPort | Sort-Object LocalPort | Format-Table -AutoSize
