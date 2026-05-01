param(
    [string]$OutputDir = "",
    [string]$ZipPath = "",
    [switch]$Bundle,
    [switch]$Clean,
    [switch]$Install
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseRoot = if ($OutputDir) { [IO.Path]::GetFullPath($OutputDir) } else { Join-Path $ProjectRoot "release\DatasetsDeputy" }
$ReleaseZip = if ($ZipPath) { [IO.Path]::GetFullPath($ZipPath) } else { Join-Path $ProjectRoot "release\DatasetsDeputy.zip" }
$TauriDir = Join-Path $ProjectRoot "src-tauri"
$ExeSource = Join-Path $TauriDir "target\release\datasets-deputy.exe"
$ExeTarget = Join-Path $ReleaseRoot "DatasetsDeputy.exe"
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Resolve-CommandPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    throw "Required command not found: $($Candidates -join ', ')"
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function New-CleanDirectory {
    param([string]$Path)
    if (Test-Path $Path) {
        Remove-Item $Path -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function New-ReleaseLayout {
    param([string]$Path)

    New-CleanDirectory $Path
    foreach ($dir in @("model", "config", "datasets", "runtime", "app", "log", "temp")) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Path $dir) | Out-Null
    }
}

function Stop-ReleaseProcesses {
    $roots = @(
        [IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\'),
        [IO.Path]::GetFullPath((Join-Path $TauriDir "target\release")).TrimEnd('\')
    )

    $processes = Get-CimInstance Win32_Process |
        Where-Object {
            $path = $_.ExecutablePath
            if (-not $path) {
                $false
            }
            else {
                $matchesReleaseRoot = $false
                foreach ($root in $roots) {
                    if ($path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                        $matchesReleaseRoot = $true
                        break
                    }
                }

                $matchesReleaseRoot
            }
        }

    foreach ($process in $processes) {
        Write-Host "Stopping running process: $($process.Name) ($($process.ProcessId))"
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Wait-FileUnlocked {
    param(
        [string]$Path,
        [int]$TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-Path $Path)) {
            return
        }

        try {
            $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $stream.Close()
            return
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }

    throw "File is still locked after $TimeoutSeconds seconds: $Path"
}

function Remove-FileIfExists {
    param([string]$Path)

    if (Test-Path $Path) {
        Wait-FileUnlocked $Path
        Remove-Item $Path -Force
    }
}

function Get-GitCommit {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        return $null
    }

    try {
        return (git -C $ProjectRoot rev-parse --short HEAD 2>$null)
    }
    catch {
        return $null
    }
}

Write-Step "Preparing build environment"
Set-Location $ProjectRoot

if (Test-Path $CargoBin) {
    $env:Path = "$CargoBin;$env:Path"
}

Assert-Command "node"
Assert-Command "npm"
Assert-Command "cargo"
Assert-Command "rustc"

$NodeCmd = Resolve-CommandPath @("node.exe", "node")
$NpmCmd = Resolve-CommandPath @("npm.cmd", "npm.exe", "npm")
$NpxCmd = Resolve-CommandPath @("npx.cmd", "npx.exe", "npx")
$CargoCmd = Resolve-CommandPath @("cargo.exe", "cargo")
$RustcCmd = Resolve-CommandPath @("rustc.exe", "rustc")

Write-Host "Node:  $(& $NodeCmd -v)"
Write-Host "npm:   $(& $NpmCmd -v)"
Write-Host "Rust:  $(& $RustcCmd -V)"
Write-Host "Cargo: $(& $CargoCmd -V)"

if ($Install -or -not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Step "Installing npm dependencies"
    Invoke-Checked $NpmCmd @("install")
}

Write-Step "Stopping running release executables"
Stop-ReleaseProcesses
Wait-FileUnlocked $ExeSource
Wait-FileUnlocked $ExeTarget

if ($Clean) {
    Write-Step "Cleaning previous build outputs"
    if (Test-Path (Join-Path $ProjectRoot "dist")) {
        Remove-Item (Join-Path $ProjectRoot "dist") -Recurse -Force
    }
    if (Test-Path $ReleaseRoot) {
        Remove-Item $ReleaseRoot -Recurse -Force
    }
    if (Test-Path $ReleaseZip) {
        Remove-Item $ReleaseZip -Force
    }
}

Write-Step "Removing stale executable"
Remove-FileIfExists $ExeSource

Write-Step "Building frontend"
Invoke-Checked $NpmCmd @("run", "build")

Write-Step "Checking Rust project"
Push-Location $TauriDir
try {
    Invoke-Checked $CargoCmd @("check")
    Invoke-Checked $CargoCmd @("clippy", "--", "-D", "warnings")
}
finally {
    Pop-Location
}

if ($Bundle) {
    Write-Step "Building Tauri bundles"
    Invoke-Checked $NpmCmd @("run", "tauri:build")
}
else {
    Write-Step "Building Tauri executable"
    Invoke-Checked $NpxCmd @("tauri", "build", "--no-bundle")
}

if (-not (Test-Path $ExeSource)) {
    throw "Release executable was not found: $ExeSource"
}

Write-Step "Assembling clean release layout"
New-ReleaseLayout $ReleaseRoot
Copy-Item $ExeSource $ExeTarget -Force

$SourceExeInfo = Get-Item $ExeSource
$TargetExeInfo = Get-Item $ExeTarget
if ($SourceExeInfo.Length -ne $TargetExeInfo.Length) {
    throw "Published executable size mismatch. Source: $($SourceExeInfo.Length), Target: $($TargetExeInfo.Length)"
}
if ($TargetExeInfo.LastWriteTime -lt $SourceExeInfo.LastWriteTime.AddSeconds(-2)) {
    throw "Published executable appears stale. Source: $($SourceExeInfo.LastWriteTime), Target: $($TargetExeInfo.LastWriteTime)"
}

$BuildInfo = [ordered]@{
    product = "Datasets Deputy"
    version = "0.1.0"
    buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    gitCommit = Get-GitCommit
    sourceExe = $ExeSource
}

$BuildInfoPath = Join-Path $ReleaseRoot "app\build-info.json"
$BuildInfo | ConvertTo-Json -Depth 4 | Set-Content -Path $BuildInfoPath -Encoding UTF8

Write-Step "Creating release archive"
$ReleaseParent = Split-Path -Parent $ReleaseZip
if ($ReleaseParent -and -not (Test-Path $ReleaseParent)) {
    New-Item -ItemType Directory -Force -Path $ReleaseParent | Out-Null
}
if (Test-Path $ReleaseZip) {
    Remove-Item $ReleaseZip -Force
}
Compress-Archive -Path (Join-Path $ReleaseRoot "*") -DestinationPath $ReleaseZip -Force

Write-Step "Publish completed"
Write-Host "Release directory: $ReleaseRoot"
Write-Host "Release archive:   $ReleaseZip"
Write-Host "Executable:        $ExeTarget"
