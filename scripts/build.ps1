# Build parakeet-realtime-server.exe for Windows x64.
#
# Prerequisites:
#   - Rust stable toolchain (rustup default stable-x86_64-pc-windows-msvc)
#   - Visual Studio 2022 Build Tools with C++ workload
#   - CUDA 12.x toolkit installed on PATH (needed by the ort crate to link)
#
# Output lands in <repo>/dist/. This script does NOT copy CUDA/cuDNN DLLs;
# run `scripts/fetch-cuda-deps.ps1` afterwards to populate those.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$DistDir   = Join-Path $RepoRoot "dist"

Write-Host "Building parakeet-realtime-server (release)..."
Push-Location $RepoRoot
cargo build --release
Pop-Location

Write-Host "Copying binary to $DistDir..."
if (!(Test-Path $DistDir)) { New-Item -ItemType Directory -Path $DistDir | Out-Null }
Copy-Item (Join-Path $RepoRoot "target\release\parakeet-realtime-server.exe") $DistDir -Force

# Copy onnxruntime DLLs from the ort crate's download cache.
# The ort crate (with load-dynamic) downloads them to either:
#   - $env:ORT_LIB_LOCATION (if the user set it), or
#   - %USERPROFILE%\.cargo\registry\src\... (the cargo build cache)
$OrtDir = $env:ORT_LIB_LOCATION
if (!$OrtDir) {
    Write-Host "WARNING: ORT_LIB_LOCATION not set. You may need to manually copy onnxruntime*.dll to $DistDir"
} else {
    Get-ChildItem "$OrtDir\*.dll" | ForEach-Object {
        Copy-Item $_.FullName $DistDir -Force
        Write-Host "  Copied $($_.Name)"
    }
}

$TotalSize = (Get-ChildItem $DistDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$FileCount = (Get-ChildItem $DistDir).Count
Write-Host "`nDone! $FileCount files, $([math]::Round($TotalSize, 1)) MB total in $DistDir"
Write-Host "Next: run scripts\fetch-cuda-deps.ps1 to populate CUDA/cuDNN DLLs."
