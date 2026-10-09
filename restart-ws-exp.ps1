$ErrorActionPreference = "Continue"
$ROOT = "C:\Users\Administrator\Desktop\stST\local"
$NODE = "C:\Program Files\nodejs\node.exe"
$log  = "$ROOT\logs\ws-out.log"; $err = "$ROOT\logs\ws-err.log"
foreach ($f in @($log, $err)) { if (Test-Path $f) { Move-Item -LiteralPath $f -Destination "$f.bak" -Force } }
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 8889 } | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {} }
Start-Sleep -Milliseconds 800
$env:WS_RAW_DUMP = "200"
$env:WS_VERBOSE_MESSAGE_LOGS = "true"
$env:WS_SLK_EXPERIMENT = "1"
Start-Process -FilePath $NODE -ArgumentList @("src/index.js") -WorkingDirectory "$ROOT\cs\node-ws" -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err
Start-Sleep -Seconds 4
