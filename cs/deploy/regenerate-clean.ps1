# Force regenerate the clean copy
$source = "C:\wwwroot\cs"
$dest = "C:\wwwroot\cs_copy"

if (Test-Path $dest) {
    Write-Host "Removing old $dest ..."
    Get-ChildItem -Path $dest -Recurse -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $dest -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "Old removed."

# Run the main script
& "C:\wwwroot\cs\deploy\create-clean-copy.ps1"
