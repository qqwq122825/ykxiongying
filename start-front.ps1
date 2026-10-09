$ErrorActionPreference = "Continue"
$root = "C:\Users\Administrator\Desktop\stST\local\front"
Set-Location -LiteralPath $root
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList @("server.mjs") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\..\logs\front-out.log" -RedirectStandardError "$root\..\logs\front-err.log"
Write-Output "front launched"
