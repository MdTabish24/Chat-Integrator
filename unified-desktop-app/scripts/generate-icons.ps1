# Icon Generation Script for Chat Orbitor
# Requires ImageMagick to be installed

$assetsDir = Join-Path $PSScriptRoot "..\assets"

Write-Host "Generating icons from SVG sources..." -ForegroundColor Cyan

# Check if ImageMagick is available
$magick = Get-Command magick -ErrorAction SilentlyContinue
if (-not $magick) {
    Write-Host "ImageMagick not found. Please install it:" -ForegroundColor Red
    Write-Host "  choco install imagemagick" -ForegroundColor Yellow
    Write-Host "  or download from https://imagemagick.org/script/download.php" -ForegroundColor Yellow
    exit 1
}

Push-Location $assetsDir

try {
    # Generate main icon PNG (256x256)
    Write-Host "Generating icon.png (256x256)..." -ForegroundColor Green
    & magick convert -background none icon.svg -resize 256x256 icon.png

    # Generate Windows ICO with multiple resolutions
    Write-Host "Generating icon.ico (multi-resolution)..." -ForegroundColor Green
    & magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico

    # Generate additional PNG sizes for Linux
    Write-Host "Generating icon-64.png, icon-32.png, icon-16.png..." -ForegroundColor Green
    & magick convert -background none icon.svg -resize 64x64 icon-64.png
    & magick convert -background none icon.svg -resize 32x32 icon-32.png
    & magick convert -background none icon.svg -resize 16x16 icon-16.png

    # Generate tray icons
    Write-Host "Generating tray-icon.png (32x32)..." -ForegroundColor Green
    & magick convert -background none tray-icon.svg -resize 32x32 tray-icon.png

    # Generate macOS tray template icons
    Write-Host "Generating macOS tray template icons..." -ForegroundColor Green
    & magick convert -background none tray-icon.svg -resize 22x22 tray-iconTemplate.png
    & magick convert -background none tray-icon.svg -resize 44x44 "tray-iconTemplate@2x.png"

    Write-Host ""
    Write-Host "Icon generation complete!" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Generated files:" -ForegroundColor White
    Get-ChildItem -Filter "*.png" | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
    Get-ChildItem -Filter "*.ico" | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
    Write-Host ""
    Write-Host "Note: For macOS .icns file, use iconutil on macOS or an online converter." -ForegroundColor Yellow

} finally {
    Pop-Location
}
