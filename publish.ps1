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
$ReleaseRoot = if ($OutputDir) {
    if ([IO.Path]::IsPathRooted($OutputDir)) {
        [IO.Path]::GetFullPath($OutputDir)
    }
    else {
        [IO.Path]::GetFullPath((Join-Path $ProjectRoot $OutputDir))
    }
}
else {
    Join-Path $ProjectRoot "release\DatasetsDeputy"
}
$ReleaseZip = if ($ZipPath) {
    if ([IO.Path]::IsPathRooted($ZipPath)) {
        [IO.Path]::GetFullPath($ZipPath)
    }
    else {
        [IO.Path]::GetFullPath((Join-Path $ProjectRoot $ZipPath))
    }
}
else {
    Join-Path $ProjectRoot "release\DatasetsDeputy.zip"
}
$TauriDir = Join-Path $ProjectRoot "src-tauri"
$ExeSource = Join-Path $TauriDir "target\release\datasets-deputy.exe"
$ExeTarget = Join-Path $ReleaseRoot "DatasetsDeputy.exe"
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$AssetRoot = Join-Path $ProjectRoot "assets"
$SplashAssetDir = Join-Path $AssetRoot "splash"
$PublicSplashDir = Join-Path $ProjectRoot "public\splash"
$IconAssetPath = Join-Path $AssetRoot "icon\Deputy.ico"
$TauriIconPath = Join-Path $TauriDir "icons\icon.ico"
$DefaultWindowRenderMode = "auto"
$SupportedWindowRenderModes = @("blur", "acrylic")

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

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败，退出码 $LASTEXITCODE：$FilePath $($Arguments -join ' ')"
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
        Write-Host "停止正在运行的进程：$($process.Name) ($($process.ProcessId))"
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

    throw "文件等待 $TimeoutSeconds 秒后仍被占用：$Path"
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

Write-Step "准备构建环境"
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

Write-Host "Node 版本：  $(& $NodeCmd -v)"
Write-Host "npm 版本：   $(& $NpmCmd -v)"
Write-Host "Rust 版本：  $(& $RustcCmd -V)"
Write-Host "Cargo 版本： $(& $CargoCmd -V)"

if ($Install -or -not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Step "安装 npm 依赖"
    Invoke-Checked $NpmCmd @("install")
}

Write-Step "从 assets 同步项目资源"
Sync-ProjectAssets

Write-Step "停止正在运行的发布版程序"
Stop-ReleaseProcesses
Wait-FileUnlocked $ExeSource
Wait-FileUnlocked $ExeTarget

if ($Clean) {
    Write-Step "清理旧构建输出"
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

Write-Step "移除旧可执行文件"
Remove-FileIfExists $ExeSource

Write-Step "构建前端"
Invoke-Checked $NpmCmd @("run", "build")

Write-Step "检查 Rust 项目"
Push-Location $TauriDir
try {
    Invoke-Checked $CargoCmd @("check")
    Invoke-Checked $CargoCmd @("clippy", "--", "-D", "warnings")
}
finally {
    Pop-Location
}

if ($Bundle) {
    Write-Step "构建 Tauri 安装包"
    Invoke-Checked $NpmCmd @("run", "tauri:build")
}
else {
    Write-Step "构建 Tauri 可执行文件"
    Invoke-Checked $NpxCmd @("tauri", "build", "--no-bundle")
}

if (-not (Test-Path $ExeSource)) {
    throw "未找到发布版可执行文件：$ExeSource"
}

Write-Step "组装干净的发布目录"
New-ReleaseLayout $ReleaseRoot
Copy-Item $ExeSource $ExeTarget -Force

$SourceExeInfo = Get-Item $ExeSource
$TargetExeInfo = Get-Item $ExeTarget
if ($SourceExeInfo.Length -ne $TargetExeInfo.Length) {
    throw "发布版可执行文件大小不匹配。源文件：$($SourceExeInfo.Length)，目标文件：$($TargetExeInfo.Length)"
}
if ($TargetExeInfo.LastWriteTime -lt $SourceExeInfo.LastWriteTime.AddSeconds(-2)) {
    throw "发布版可执行文件疑似过期。源文件时间：$($SourceExeInfo.LastWriteTime)，目标文件时间：$($TargetExeInfo.LastWriteTime)"
}

$BuildInfo = [ordered]@{
    product = "Datasets Deputy"
    version = "0.1.0"
    buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    gitCommit = Get-GitCommit
    sourceExe = $ExeSource
    defaultWindowRenderMode = $DefaultWindowRenderMode
    supportedWindowRenderModes = $SupportedWindowRenderModes
}

$BuildInfoPath = Join-Path $ReleaseRoot "app\build-info.json"
$BuildInfo | ConvertTo-Json -Depth 4 | Set-Content -Path $BuildInfoPath -Encoding UTF8

Write-Step "创建发布压缩包"
$ReleaseParent = Split-Path -Parent $ReleaseZip
if ($ReleaseParent -and -not (Test-Path $ReleaseParent)) {
    New-Item -ItemType Directory -Force -Path $ReleaseParent | Out-Null
}
if (Test-Path $ReleaseZip) {
    Remove-Item $ReleaseZip -Force
}
Compress-Archive -Path (Join-Path $ReleaseRoot "*") -DestinationPath $ReleaseZip -Force

Write-Step "发布完成"
Write-Host "发布目录：     $ReleaseRoot"
Write-Host "发布压缩包：   $ReleaseZip"
Write-Host "可执行文件：   $ExeTarget"
Write-Host "默认渲染模式： $DefaultWindowRenderMode"
