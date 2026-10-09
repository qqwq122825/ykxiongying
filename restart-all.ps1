$ErrorActionPreference = "Continue"
$ROOT = "C:\Users\Administrator\Desktop\stST\local"
$NODE = "C:\Program Files\nodejs\node.exe"
$PHP  = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"
$ADB  = "C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe"

# keep the dxs agent reachable from the host
& $ADB forward tcp:17912 tcp:7912 | Out-Null

function Stop-Port($port) {
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $port } | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {}
  }
}

# --- node-ws (8889) ---
Stop-Port 8889
Start-Sleep -Milliseconds 600
foreach ($f in @("$ROOT\logs\ws-out.log", "$ROOT\logs\ws-err.log")) { if (Test-Path $f) { Move-Item -LiteralPath $f -Destination "$f.bak" -Force } }
$env:WS_RAW_DUMP = "200"
$env:WS_VERBOSE_MESSAGE_LOGS = "true"
$env:NODE_WS_VERBOSE_DEVICE = "1"
Start-Process -FilePath $NODE -ArgumentList @("src/index.js") -WorkingDirectory "$ROOT\cs\node-ws" -WindowStyle Hidden -RedirectStandardOutput "$ROOT\logs\ws-out.log" -RedirectStandardError "$ROOT\logs\ws-err.log"

# --- front (8080) ---
Stop-Port 8080
Start-Sleep -Milliseconds 600
Start-Process -FilePath $NODE -ArgumentList @("server.mjs") -WorkingDirectory "$ROOT\front" -WindowStyle Hidden -RedirectStandardOutput "$ROOT\logs\front-out.log" -RedirectStandardError "$ROOT\logs\front-err.log"

Start-Sleep -Seconds 4
Write-Host "restart-all done"