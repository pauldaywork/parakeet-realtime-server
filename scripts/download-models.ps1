# Downloads the Parakeet Realtime EOU 120M ONNX model files from HuggingFace.
#
# Defaults to writing into <repo>/dist/models/. Override with -OutDir.

param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "dist\models" }

$BaseUrl = "https://huggingface.co/altunenes/parakeet-rs/resolve/main/realtime_eou_120m-v1-onnx"
$Files = @(
    @{ Name = "encoder.onnx";       SizeMB = 459 },
    @{ Name = "decoder_joint.onnx"; SizeMB = 21  },
    @{ Name = "tokenizer.json";     SizeMB = 1   }
)

if (!(Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

foreach ($file in $Files) {
    $target = Join-Path $OutDir $file.Name
    if (Test-Path $target) {
        Write-Host "  [skip] $($file.Name) already present"
        continue
    }
    $url = "$BaseUrl/$($file.Name)"
    Write-Host "Downloading $($file.Name) (~$($file.SizeMB) MB)..."
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
    $actual = [math]::Round((Get-Item $target).Length / 1MB, 1)
    Write-Host "  -> $target ($actual MB)"
}

Write-Host "`nDone. Model files in $OutDir"
