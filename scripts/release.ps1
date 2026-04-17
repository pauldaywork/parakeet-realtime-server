# Maintainer release script. Builds the binary + zips the release asset
# + creates a GitHub release via the gh CLI.
#
# Usage:
#   .\scripts\release.ps1 v0.1.0

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^v\d+\.\d+\.\d+$') {
    throw "Version must be of the form v<MAJOR>.<MINOR>.<PATCH>, e.g. v0.1.0"
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$DistDir   = Join-Path $RepoRoot "dist"
$AssetName = "parakeet-realtime-server-$Version-win-x64.zip"
$AssetPath = Join-Path $RepoRoot $AssetName

Write-Host "=== Release $Version ==="

# 1. Build (writes exe + onnxruntime DLLs into dist/)
& (Join-Path $ScriptDir "build.ps1")

# 2. Identify the files that go in the release zip. We deliberately
#    DO NOT ship CUDA/cuDNN DLLs or model files — users fetch those
#    via fetch-cuda-deps.ps1 and download-models.ps1.
$ReleaseFiles = @(
    "parakeet-realtime-server.exe",
    "onnxruntime.dll",
    "onnxruntime_providers_cuda.dll",
    "onnxruntime_providers_shared.dll",
    "onnxruntime_providers_tensorrt.dll"
)

$staging = Join-Path $RepoRoot "__release_staging"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
foreach ($f in $ReleaseFiles) {
    $src = Join-Path $DistDir $f
    if (!(Test-Path $src)) { throw "Missing $f in dist/ - did build.ps1 succeed?" }
    Copy-Item $src $staging -Force
}
# Short README inside the zip pointing users at the repo.
$readmeTxt = @"
parakeet-realtime-server $Version

This archive contains the pre-built Windows x64 binary and onnxruntime DLLs.
CUDA/cuDNN DLLs and model files are NOT bundled. To finish setup:

  1. Clone https://github.com/pauldaywork/parakeet-realtime-server
  2. Copy the files from this zip into the repo's dist/ folder (or anywhere)
  3. Run scripts/fetch-cuda-deps.ps1  (downloads ~2 GB of NVIDIA DLLs)
  4. Run scripts/download-models.ps1  (downloads ~480 MB of ONNX weights)
  5. Run: parakeet-realtime-server.exe --model-dir models --port 9005

See the repo README for full documentation.
"@
Set-Content -Path (Join-Path $staging "README.txt") -Value $readmeTxt

# 3. Zip
if (Test-Path $AssetPath) { Remove-Item -Force $AssetPath }
Write-Host "Zipping $AssetName..."
Compress-Archive -Path "$staging\*" -DestinationPath $AssetPath -CompressionLevel Optimal
Remove-Item -Recurse -Force $staging

$zipSize = [math]::Round((Get-Item $AssetPath).Length / 1MB, 1)
Write-Host "  -> $AssetPath ($zipSize MB)"

# 4. Create release (requires gh CLI + authenticated)
Write-Host "`nCreating GitHub release $Version..."
& gh release create $Version $AssetPath --title $Version --notes "Release $Version - see README for setup steps."
if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)" }

Write-Host "`nRelease $Version published."
