# Downloads CUDA 12.x + cuDNN 9.x DLLs into <repo>/dist/ so the parakeet
# server can run without a full CUDA toolkit install. Writes into
# <repo>/dist/ by default; override with -OutDir.
#
# Requires 7z.exe on PATH for the Purfview archive.

param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "dist" }

$CUDA_LIBS_URL    = "https://github.com/Purfview/whisper-standalone-win/releases/download/libs/cuBLAS.and.cuDNN_CUDA12_win_v3.7z"
$CUFFT_WHEEL_URL  = "https://files.pythonhosted.org/packages/20/ee/29955203338515b940bd4f60ffdbc073428f25ef9bfbce44c9a066aedc5c/nvidia_cufft_cu12-11.4.1.4-py3-none-win_amd64.whl"
$CURAND_WHEEL_URL = "https://files.pythonhosted.org/packages/e5/98/1bd66fd09cbe1a5920cb36ba87029d511db7cca93979e635fd431ad3b6c0/nvidia_curand_cu12-10.3.10.19-py3-none-win_amd64.whl"
# CUDART_WHEEL_URL resolved at plan-time from PyPI — see README.
$CUDART_WHEEL_URL = "https://files.pythonhosted.org/packages/59/df/e7c3a360be4f7b93cee39271b792669baeb3846c58a4df6dfcf187a7ffab/nvidia_cuda_runtime_cu12-12.9.79-py3-none-win_amd64.whl"

$PurfviewDlls = @(
    "cublas64_12.dll", "cublasLt64_12.dll",
    "cudnn64_9.dll", "cudnn_graph64_9.dll", "cudnn_ops64_9.dll",
    "cudnn_cnn64_9.dll", "cudnn_adv64_9.dll", "cudnn_heuristic64_9.dll",
    "cudnn_engines_precompiled64_9.dll", "cudnn_engines_runtime_compiled64_9.dll"
)

$AllDlls = @("cudart64_12.dll", "cufft64_11.dll", "curand64_10.dll") + $PurfviewDlls

if (!(Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# Skip if everything is already present.
$allPresent = $true
foreach ($d in $AllDlls) {
    if (!(Test-Path (Join-Path $OutDir $d))) { $allPresent = $false; break }
}
if ($allPresent) {
    Write-Host "All CUDA DLLs already present in $OutDir, skipping."
    exit 0
}

function Find-FileRecursive($dir, $name) {
    Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ieq $name } |
        Select-Object -First 1 -ExpandProperty FullName
}

function Download-File($url, $dest) {
    Write-Host "Downloading: $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    $size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "  -> $dest ($size MB)"
}

function Extract-DllFromWheel($wheelUrl, $dllName, $outDir) {
    $tmp   = Join-Path $outDir "__wheel_tmp.whl"
    $tmpEx = Join-Path $outDir "__wheel_tmp"
    Download-File $wheelUrl $tmp
    if (Test-Path $tmpEx) { Remove-Item -Recurse -Force $tmpEx }
    Expand-Archive -Path $tmp -DestinationPath $tmpEx -Force
    $src = Find-FileRecursive $tmpEx $dllName
    if ($src) {
        Copy-Item $src (Join-Path $outDir $dllName) -Force
        Write-Host "  Copied $dllName from wheel"
    } else {
        Write-Warning "$dllName not found in wheel"
    }
    Remove-Item -Recurse -Force $tmpEx
    Remove-Item $tmp
}

# --- 1. Purfview libs (cuBLAS + cuDNN) ---
$purfviewArchive = Join-Path $OutDir "__purfview.7z"
$purfviewEx      = Join-Path $OutDir "__purfview_ex"
Download-File $CUDA_LIBS_URL $purfviewArchive
if (Test-Path $purfviewEx) { Remove-Item -Recurse -Force $purfviewEx }
New-Item -ItemType Directory -Path $purfviewEx | Out-Null
Write-Host "Extracting Purfview archive (requires 7z on PATH)..."
& 7z x $purfviewArchive "-o$purfviewEx" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z extraction failed (exit $LASTEXITCODE)" }
foreach ($dll in $PurfviewDlls) {
    $src = Find-FileRecursive $purfviewEx $dll
    if ($src) {
        Copy-Item $src (Join-Path $OutDir $dll) -Force
        Write-Host "  Copied $dll from Purfview"
    } else {
        Write-Warning "$dll not found in Purfview archive"
    }
}
Remove-Item -Recurse -Force $purfviewEx
Remove-Item $purfviewArchive

# --- 2. Wheels ---
Extract-DllFromWheel $CUFFT_WHEEL_URL  "cufft64_11.dll"  $OutDir
Extract-DllFromWheel $CURAND_WHEEL_URL "curand64_10.dll" $OutDir
Extract-DllFromWheel $CUDART_WHEEL_URL "cudart64_12.dll" $OutDir

# --- 3. Verify ---
Write-Host "`nVerification:"
$allOk = $true
foreach ($d in $AllDlls) {
    $p = Join-Path $OutDir $d
    if (Test-Path $p) { Write-Host "  [OK] $d" }
    else { Write-Host "  [MISSING] $d"; $allOk = $false }
}
if ($allOk) {
    Write-Host "`nDone. All DLLs in $OutDir"
} else {
    throw "One or more DLLs failed to install."
}
