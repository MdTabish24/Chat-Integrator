# Build Script for Chat Orbitor Desktop App
# Usage: .\scripts\build.ps1 [platform]
# Platforms: win, mac, linux, all (default: current platform)

param(
    [string]$Platform = ""
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chat Orbitor Desktop - Build Script  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Navigate to project root
$projectRoot = Join-Path $PSScriptRoot ".."
Push-Location $projectRoot

try {
    # Step 1: Check if icons exist
    Write-Host "[1/4] Checking assets..." -ForegroundColor Yellow
    $iconPng = Join-Path $projectRoot "assets\icon.png"
    $iconIco = Join-Path $projectRoot "assets\icon.ico"
    $trayIcon = Join-Path $projectRoot "assets\tray-icon.png"

    if (-not (Test-Path $iconPng) -or -not (Test-Path $trayIcon)) {
        Write-Host "  Icons not found. Generating..." -ForegroundColor Gray
        & powershell -File ".\scripts\generate-icons.ps1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Warning: Icon generation failed. Build may fail." -ForegroundColor Red
        }
    } else {
        Write-Host "  Assets OK" -ForegroundColor Green
    }

    # Step 2: Install dependencies
    Write-Host ""
    Write-Host "[2/4] Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host "  Dependencies OK" -ForegroundColor Green

    # Step 3: Build the app
    Write-Host ""
    Write-Host "[3/4] Building application..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
    Write-Host "  Build OK" -ForegroundColor Green

    # Step 4: Package the app
    Write-Host ""
    Write-Host "[4/4] Packaging application..." -ForegroundColor Yellow
    
    switch ($Platform.ToLower()) {
        "win" {
            Write-Host "  Building for Windows..." -ForegroundColor Gray
            npm run package:win
        }
        "mac" {
            Write-Host "  Building for macOS..." -ForegroundColor Gray
            npm run package:mac
        }
        "linux" {
            Write-Host "  Building for Linux..." -ForegroundColor Gray
            npm run package:linux
        }
        "all" {
            Write-Host "  Building for all platforms..." -ForegroundColor Gray
            npm run package
        }
        default {
            Write-Host "  Building for current platform..." -ForegroundColor Gray
            npm run package
        }
    }
    
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }
    Write-Host "  Packaging OK" -ForegroundColor Green

    # Done
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Build Complete!                      " -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Output files are in: release/" -ForegroundColor White
    
    $releaseDir = Join-Path $projectRoot "release"
    if (Test-Path $releaseDir) {
        Write-Host ""
        Get-ChildItem $releaseDir -Recurse -File | Where-Object { $_.Extension -in ".exe", ".dmg", ".AppImage", ".zip" } | ForEach-Object {
            $size = [math]::Round($_.Length / 1MB, 2)
            Write-Host "  - $($_.Name) ($size MB)" -ForegroundColor Gray
        }
    }

} catch {
    Write-Host ""
    Write-Host "Build failed: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
