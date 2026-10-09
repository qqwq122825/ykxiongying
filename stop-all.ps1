$ErrorActionPreference = "Continue"
Write-Host "Stopping panel..." -ForegroundColor Cyan
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8080,8081,8889 } | ForEach-Object {
  try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop; "  killed pid $($_.OwningProcess) (port $($_.LocalPort))" } catch {}
}
Write-Host "Done (MySQL service left running)." -ForegroundColor Green
