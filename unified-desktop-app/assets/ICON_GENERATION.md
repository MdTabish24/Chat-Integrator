# Icon Generation Guide

The app icons need to be generated from the SVG source files.

## Source Files
- `icon.svg` - Main app icon (256x256)
- `tray-icon.svg` - System tray icon (32x32)

## Required Output Files

### Windows (.ico)
- `icon.ico` - Multi-resolution icon containing 16x16, 32x32, 48x48, 64x64, 128x128, 256x256

### macOS (.icns)
- `icon.icns` - Apple icon format with multiple resolutions

### Linux (.png)
- `icon.png` - 256x256 PNG for Linux builds
- `icon-16.png` - 16x16 for small displays
- `icon-32.png` - 32x32 for medium displays
- `icon-64.png` - 64x64 for larger displays

### Tray Icons
- `tray-icon.png` - 32x32 PNG for system tray (Windows/Linux)
- `tray-iconTemplate.png` - 22x22 PNG for macOS (template image)
- `tray-iconTemplate@2x.png` - 44x44 PNG for macOS Retina

## Generation Methods

### Using ImageMagick (Recommended)
```bash
# Install ImageMagick first
# Windows: choco install imagemagick
# macOS: brew install imagemagick
# Linux: sudo apt install imagemagick

# Generate PNG from SVG
magick convert -background none icon.svg -resize 256x256 icon.png
magick convert -background none icon.svg -resize 64x64 icon-64.png
magick convert -background none icon.svg -resize 32x32 icon-32.png
magick convert -background none icon.svg -resize 16x16 icon-16.png

# Generate ICO (Windows)
magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Generate tray icons
magick convert -background none tray-icon.svg -resize 32x32 tray-icon.png
magick convert -background none tray-icon.svg -resize 22x22 tray-iconTemplate.png
magick convert -background none tray-icon.svg -resize 44x44 tray-iconTemplate@2x.png
```

### Using Online Tools
1. Go to https://cloudconvert.com/svg-to-ico
2. Upload `icon.svg`
3. Download the generated `.ico` file

For macOS `.icns`:
1. Use https://cloudconvert.com/png-to-icns
2. Or use `iconutil` on macOS

### Using electron-icon-builder (npm package)
```bash
npm install -g electron-icon-builder
electron-icon-builder --input=icon.svg --output=./
```

## Quick Start (Windows PowerShell)
If you have ImageMagick installed:
```powershell
cd unified-desktop-app/assets
magick convert -background none icon.svg -resize 256x256 icon.png
magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico
magick convert -background none tray-icon.svg -resize 32x32 tray-icon.png
```

## Notes
- The SVG files are the source of truth
- Regenerate all icons if the SVG is updated
- macOS template images should be grayscale for proper menu bar appearance
