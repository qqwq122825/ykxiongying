$ErrorActionPreference = "Continue"
$root = "C:\Users\Administrator\Desktop\stST\local\cs\node-ws"
Set-Location -LiteralPath $root
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList @("src/index.js") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\..\ws-out.log" -RedirectStandardError "$root\..\ws-err.log"
Write-Output "node-ws launched"
