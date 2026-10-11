# Creates a clean production copy of the project at C:\wwwroot\cs_copy
# Uses whitelist approach: only keeps essential source files

$source = "C:\wwwroot\cs"
$dest = "C:\wwwroot\cs_copy"

# Clean destination if exists
if (Test-Path $dest) {
    Write-Host "Removing existing $dest ..."
    Remove-Item -Path $dest -Recurse -Force
}

New-Item -ItemType Directory -Path $dest -Force | Out-Null

# =================================================================
# WHITELIST: Explicit list of files/dirs to KEEP
# Everything not listed here is excluded
# =================================================================

# Top-level directories to KEEP (relative to project root)
$keepDirs = @(
    "app"
    "config"
    "extend"
    "frontend-react\src"
    "frontend-react\public"
    "frontend-react\package.json"
    "frontend-react\vite.config.js"
    "frontend-react\index.html"
    "frontend-react\tsconfig.json"
    "frontend-react\.env.example"
    "frontend-react\.env.production"
    "node-ws\src"
    "node-ws\package.json"
    "node-ws\.env.example"
    "node-ws\config.js"
    "public"
    "route"
    "think"
    "vendor"
    "view"
)

# Individual files at top level to KEEP
$keepFiles = @(
    ".env.example"
    ".gitignore"
    ".travis.yml"
    "HANDOVER.md"
    "LICENSE.txt"
    "README.md"
    "SECURITY_DEPLOY.md"
    "TUNNEL_HANDOVER.md"
    "LINUX_OPERATION_LOG_TROUBLESHOOTING.md"
    "CURRENT_SERVER_ENVIRONMENT.md"
    "composer.json"
    "composer.lock"
    "install.sql"
    "migrate_*.php"
)

# FILES TO EXCLUDE even if in keepDirs (debug/temp files)
$excludeFilePatterns = @(
    "*.log"
    "*.log.*"
    "*.pid"
    "*.bak"
    "*.bak.sql"
    "*.old"
    "*.tmp"
    "*.sqlite"
    "*.sqlite3"
    "*.bak.json"
    "*-test.json"
    "*-test.json.bak"
    "test_*.json"
    "test_*.py"
    "test_*.js"
    "test_*.sh"
    "gc.json"
    "gc2.json"
    "od.json"
    "frps-test.json"
    "http-proxies.json"
    "tunnel-status.json"
    "tunnel-verify.txt"
    "tunnel-debug.log"
    "ftp_*.py"
    "ftp_*.log"
    "ftp_*.sh"
    "ftp_*.json"
    "ss.bin"
    "ss_final.bin"
    "ss_*.bin"
    "ss_*.txt"
    "find-*.js"
    "see-*.js"
    "check-*.js"
    "fix-*.py"
    "fix-*.cjs"
    "fix_token*.py"
    "fix_all*.py"
    "fix_subowner*.py"
    "fix_encoding*.py"
    "node-v*.zip"
    "node.exe"
    "minicap-debug-*.apk"
    "minicap-x86_64.apk"
    "package-lock.json"
    "yarn.lock"
    "frps.toml"
    "frpc.ini"
    "node-ws\.env$"
    "node-ws\.env\.bak$"
    "verify*"
    "*.bin"
    "*.log.json"
    "*.verify"
    "tunnel*"
    "PROMPT.md"
    "think"
    "extend\apk_repacker.py.bak"
)

# Directories to COMPLETELY exclude
$excludeDirs = @(
    "node_modules"
    "cs_linux"
    ".git"
    "dist"
    "deploy"
    "runtime"
    ".vscode"
    ".idea"
    "extend"
)

function Should-KeepFile($relativePath) {
    # Check exclude patterns first
    foreach ($pattern in $excludeFilePatterns) {
        if ($relativePath -like $pattern) {
            return $false
        }
    }

    # Check if in keepDirs (any path starts with the dir path)
    foreach ($dir in $keepDirs) {
        $dirNorm = $dir -replace '\\', '\'
        if ($relativePath -eq $dirNorm -or $relativePath.StartsWith($dirNorm + "\")) {
            return $true
        }
    }

    # Check if matches top-level keepFiles
    $fileName = Split-Path $relativePath -Leaf
    foreach ($kf in $keepFiles) {
        if ($relativePath -eq $kf -or $fileName -eq $kf) {
            return $true
        }
    }

    return $false
}

function Should-ExcludeDir($dirRelativePath) {
    foreach ($dir in $excludeDirs) {
        if ($dirRelativePath -eq $dir -or $dirRelativePath.StartsWith($dir + "\")) {
            return $true
        }
    }
    return $false
}

function Copy-Clean {
    param($srcDir, $dstDir)

    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null

    Get-ChildItem -Path $srcDir -Force | ForEach-Object {
        $item = $_

        $srcItem = $item.FullName
        $relativePath = $srcItem.Substring($source.Length + 1)

        if ($item.PSIsContainer) {
            if (Should-ExcludeDir $relativePath) {
                Write-Host "  SKIP dir: $relativePath"
                return
            }
            # Only recurse into dirs we want to keep
            $shouldCopy = $false
            foreach ($dir in $keepDirs) {
                if ($relativePath -eq $dir -or $relativePath.StartsWith($dir + "\")) {
                    $shouldCopy = $true
                    break
                }
            }
            if ($shouldCopy) {
                Copy-Clean -srcDir $srcItem -dstDir $dstItem
            } else {
                Write-Host "  SKIP dir: $relativePath"
            }
        } else {
            if (Should-KeepFile $relativePath) {
                Copy-Item -Path $srcItem -Destination $dstItem -Force
            } else {
                Write-Host "  SKIP file: $relativePath"
            }
        }
    }
}

Write-Host "Creating clean copy of $source to $dest ..."
Write-Host ""
Copy-Clean -srcDir $source -dstDir $dest

Write-Host ""
Write-Host "Clean copy complete!"
Write-Host "Source: $source"
Write-Host "Destination: $dest"

# Show stats
$sourceSize = (Get-ChildItem -Path $source -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
$destSize = (Get-ChildItem -Path $dest -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
$sourceSizeMB = [math]::Round($sourceSize / 1MB, 2)
$destSizeMB = [math]::Round($destSize / 1MB, 2)
$saved = $sourceSize - $destSize
$savedMB = [math]::Round($saved / 1MB, 2)

Write-Host ""
Write-Host "Source size:      $sourceSizeMB MB"
Write-Host "Clean copy size:  $destSizeMB MB"
Write-Host "Saved:            $savedMB MB"
