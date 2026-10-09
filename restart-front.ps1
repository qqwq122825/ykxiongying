$ErrorActionPreference = "Continue"
$ROOT = "C:\Users\Administrator\Desktop\stST\local"
$NODE = "C:\Program Files\nodejs\node.exe"
foreach ($n in @("front-out.log","front-err.log","sapi.log")) { $f = "$ROOT\logs\$n"; if (Test-Path $f) { Move-Item -LiteralPath $f -Destination "$f.bak" -Force } }
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 8080 } | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {} }
Start-Sleep -Milliseconds 700
Start-Process -FilePath $NODE -ArgumentList @("server.mjs") -WorkingDirectory "$ROOT\front" -WindowStyle Hidden -RedirectStandardOutput "$ROOT\logs\front-out.log" -RedirectStandardError "$ROOT\logs\front-err.log"
Start-Sleep -Seconds 3
