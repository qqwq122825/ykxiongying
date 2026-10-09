
$ErrorActionPreference="Continue"
$ROOT="C:\Users\Administrator\Desktop\stST\local"
$NODE="C:\Program Files\nodejs\node.exe"
$ADB="C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $ADB forward tcp:17912 tcp:7912 | Out-Null
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 8889 } | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {} }
Start-Sleep -Milliseconds 700
if (Test-Path "$ROOT\logs\ws-out.log") { Move-Item -LiteralPath "$ROOT\logs\ws-out.log" -Destination "$ROOT\logs\ws-out.log.bak" -Force }
if (Test-Path "$ROOT\logs\ws-err.log") { Move-Item -LiteralPath "$ROOT\logs\ws-err.log" -Destination "$ROOT\logs\ws-err.log.bak" -Force }
$env:WS_RAW_DUMP="20"
$env:WS_VERBOSE_MESSAGE_LOGS="true"
Start-Process -FilePath $NODE -ArgumentList @("src/index.js") -WorkingDirectory "$ROOT\cs\node-ws" -WindowStyle Hidden -RedirectStandardOutput "$ROOT\logs\ws-out.log" -RedirectStandardError "$ROOT\logs\ws-err.log"
Start-Sleep -Seconds 5
Set-Content -LiteralPath "$ROOT\logs\ws-restart.done" -Value (Get-Date).ToString("s")
