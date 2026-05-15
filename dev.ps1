param(
    [switch]$Install,
    [switch]$WebOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$AssetRoot = Join-Path $ProjectRoot "assets"
$SplashAssetDir = Join-Path $AssetRoot "splash"
$PublicSplashDir = Join-Path $ProjectRoot "public\splash"
$IconAssetPath = Join-Path $AssetRoot "icon\Deputy.ico"
$TauriIconPath = Join-Path $ProjectRoot "src-tauri\icons\icon.ico"

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

function Sync-ProjectAssets {
    if (-not (Test-Path $SplashAssetDir)) {
        throw "Splash asset directory not found: $SplashAssetDir"
    }
    if (-not (Test-Path $IconAssetPath)) {
        throw "App icon asset not found: $IconAssetPath"
    }

    New-Item -ItemType Directory -Force -Path $PublicSplashDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TauriIconPath) | Out-Null

    Copy-Item (Join-Path $SplashAssetDir "*") $PublicSplashDir -Recurse -Force
    Copy-Item $IconAssetPath $TauriIconPath -Force
}

Write-Step "Preparing dev environment"
Set-Location $ProjectRoot

if (Test-Path $CargoBin) {
    $env:Path = "$CargoBin;$env:Path"
}

Assert-Command "node"
Assert-Command "npm"

if (-not $WebOnly) {
    Assert-Command "cargo"
    Assert-Command "rustc"
}

$NodeCmd = Resolve-CommandPath @("node.exe", "node")
$NpmCmd = Resolve-CommandPath @("npm.cmd", "npm.exe", "npm")
$TauriCli = Join-Path $ProjectRoot "node_modules\@tauri-apps\cli\tauri.js"
$ViteCli = Join-Path $ProjectRoot "node_modules\vite\bin\vite.js"

Write-Host "Node: $(& $NodeCmd -v)"
Write-Host "npm:  $(& $NpmCmd -v)"

if (-not $WebOnly) {
    $CargoCmd = Resolve-CommandPath @("cargo.exe", "cargo")
    $RustcCmd = Resolve-CommandPath @("rustc.exe", "rustc")
    Write-Host "Rust: $(& $RustcCmd -V)"
    Write-Host "Cargo: $(& $CargoCmd -V)"
}

if ($Install -or -not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Step "Installing npm dependencies"
    & $NpmCmd install
}

Write-Step "Syncing project assets from assets"
Sync-ProjectAssets

if (-not (Test-Path $ViteCli)) {
    throw "Vite CLI not found. Run .\dev.ps1 -Install first."
}

if ($WebOnly) {
    Write-Step "Starting Vite dev server"
    & $NodeCmd $ViteCli
}
else {
    if (-not (Test-Path $TauriCli)) {
        throw "Tauri CLI not found. Run .\dev.ps1 -Install first."
    }

    Write-Step "Starting Tauri dev app"
    & $NodeCmd $TauriCli dev
}
