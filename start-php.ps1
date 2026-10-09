$ErrorActionPreference = "Stop"
$php = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"
$ini = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.ini"
$root = "C:\Users\Administrator\Desktop\stST\local\cs"
$env:PHP_CLI_SERVER_WORKERS = "8"
Set-Location -LiteralPath $root
Start-Process -FilePath $php -ArgumentList @("-c", $ini, "-S", "0.0.0.0:8081", "-t", "public", "public/router.php") -WindowStyle Hidden
Write-Output "php on 8081"
