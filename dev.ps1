param(
    [switch]$Install,
    [switch]$WebOnly,
    [switch]$ResetCache
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-ProjectRoot {
    if ($PSScriptRoot) {
        return (Resolve-Path -LiteralPath $PSScriptRoot).Path
    }

    if ($MyInvocation.MyCommand.Path) {
        $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
        return (Resolve-Path -LiteralPath $scriptRoot).Path
    }

    return (Get-Location).Path
}

function Resolve-CargoBin {
    if ($env:CARGO_HOME) {
        return (Join-Path $env:CARGO_HOME "bin")
    }

    if ($env:USERPROFILE) {
        return (Join-Path $env:USERPROFILE ".cargo\bin")
    }

    if ($env:HOME) {
        return (Join-Path $env:HOME ".cargo/bin")
    }

    return $null
}

$ProjectRoot = Resolve-ProjectRoot
$ProjectRootMarker = Join-Path $ProjectRoot ".cache\project-root.txt"
$CargoBin = Resolve-CargoBin
$AssetRoot = Join-Path $ProjectRoot "assets"
$SplashAssetDir = Join-Path $AssetRoot "splash"
$PublicSplashDir = Join-Path $ProjectRoot "public\splash"
$IconAssetPath = Join-Path $AssetRoot "icon\Deputy.ico"
$TauriIconPath = Join-Path $ProjectRoot "src-tauri\icons\icon.ico"
$DevPort = 11115

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到必需命令：$Name"
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

    throw "未找到必需命令：$($Candidates -join ', ')"
}

function Assert-PortAvailable {
    param([int]$Port)

    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        return
    }

    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) {
        return
    }

    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $processLabel = if ($process) {
        "$($process.ProcessName) (PID $($process.Id))"
    }
    else {
        "PID $($listener.OwningProcess)"
    }

    throw "开发端口 $Port 已被占用：$processLabel"
}

function Clear-GeneratedPathCaches {
    param([string]$Reason)

    Write-Step $Reason

    $cachePaths = @(
        (Join-Path $ProjectRoot ".vite")
        (Join-Path $ProjectRoot "node_modules\.vite")
        (Join-Path $ProjectRoot "node_modules\.cache")
        (Join-Path $ProjectRoot "src-tauri\.tauri")
        (Join-Path $ProjectRoot "src-tauri\target\debug\.fingerprint")
        (Join-Path $ProjectRoot "src-tauri\target\debug\build")
        (Join-Path $ProjectRoot "src-tauri\target\release\.fingerprint")
        (Join-Path $ProjectRoot "src-tauri\target\release\build")
    )

    foreach ($path in $cachePaths) {
        if (Test-Path -LiteralPath $path) {
            Write-Host "清理本地路径缓存：$path"
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Write-ProjectRootMarker {
    $currentRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $markerDir = Split-Path -Parent $ProjectRootMarker
    New-Item -ItemType Directory -Force -Path $markerDir | Out-Null
    Set-Content -LiteralPath $ProjectRootMarker -Value $currentRoot -Encoding UTF8
}

function Sync-ProjectRootMarker {
    param([switch]$SkipCacheClear)

    $currentRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $previousRoot = $null

    if (Test-Path -LiteralPath $ProjectRootMarker) {
        $markerContent = Get-Content -LiteralPath $ProjectRootMarker -Raw -ErrorAction SilentlyContinue
        if ($null -ne $markerContent) {
            $previousRoot = $markerContent.Trim()
        }
    }

    if ($previousRoot -and $previousRoot.Equals($currentRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return
    }

    if (-not $SkipCacheClear) {
        if ($previousRoot) {
            Clear-GeneratedPathCaches "检测到项目目录变化，清理包含旧绝对路径的本地缓存"
        }
        else {
            Clear-GeneratedPathCaches "初始化项目目录标记，清理可能包含绝对路径的本地缓存"
        }
    }

    Write-ProjectRootMarker
}

function Sync-ProjectAssets {
    if (-not (Test-Path $SplashAssetDir)) {
        throw "未找到启动图资源目录：$SplashAssetDir"
    }
    if (-not (Test-Path $IconAssetPath)) {
        throw "未找到应用图标资源：$IconAssetPath"
    }

    New-Item -ItemType Directory -Force -Path $PublicSplashDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TauriIconPath) | Out-Null

    Copy-Item (Join-Path $SplashAssetDir "*") $PublicSplashDir -Recurse -Force
    Copy-Item $IconAssetPath $TauriIconPath -Force
}

Write-Step "准备开发环境"
Set-Location $ProjectRoot

if ($ResetCache) {
    Clear-GeneratedPathCaches "按参数要求清理本地路径缓存"
    Sync-ProjectRootMarker -SkipCacheClear
}
else {
    Sync-ProjectRootMarker
}

if ($CargoBin -and (Test-Path $CargoBin)) {
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

Write-Host "Node 版本：  $(& $NodeCmd -v)"
Write-Host "npm 版本：   $(& $NpmCmd -v)"

if (-not $WebOnly) {
    $CargoCmd = Resolve-CommandPath @("cargo.exe", "cargo")
    $RustcCmd = Resolve-CommandPath @("rustc.exe", "rustc")
    Write-Host "Rust 版本：  $(& $RustcCmd -V)"
    Write-Host "Cargo 版本： $(& $CargoCmd -V)"
}

if ($Install -or -not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Step "安装 npm 依赖"
    & $NpmCmd install
}

Write-Step "从 assets 同步项目资源"
Sync-ProjectAssets
Assert-PortAvailable $DevPort

if (-not (Test-Path $ViteCli)) {
    throw "未找到 Vite CLI。请先运行 .\dev.ps1 -Install。"
}

if ($WebOnly) {
    Write-Step "启动 Vite 开发服务器"
    & $NodeCmd $ViteCli
}
else {
    if (-not (Test-Path $TauriCli)) {
        throw "未找到 Tauri CLI。请先运行 .\dev.ps1 -Install。"
    }

    Write-Step "启动 Tauri 开发应用"
    & $NodeCmd $TauriCli dev
}
