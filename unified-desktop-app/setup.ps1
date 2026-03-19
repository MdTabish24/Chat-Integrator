# ============================================
# Chat Orbitor Desktop - Complete Setup Script
# ============================================
# This script sets up everything automatically:
# 1. Node.js dependencies
# 2. Python sidecars (Instagram & Facebook fbchat-v2)
# 3. Builds the app
# 4. Optionally packages for distribution
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Chat Orbitor Desktop - Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running from correct directory
if (-not (Test-Path "package.json")) {
    Write-Host "[ERROR] Please run this script from the unified-desktop-app directory!" -ForegroundColor Red
    exit 1
}

# ============================================
# Step 1: Check Prerequisites
# ============================================
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "  [OK] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Node.js not found! Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check Python
$pythonCmd = $null
try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python 3") {
        $pythonCmd = "python"
        Write-Host "  [OK] Python: $pythonVersion" -ForegroundColor Green
    }
} catch {}

if (-not $pythonCmd) {
    try {
        $pythonVersion = python3 --version 2>&1
        if ($pythonVersion -match "Python 3") {
            $pythonCmd = "python3"
            Write-Host "  [OK] Python: $pythonVersion" -ForegroundColor Green
        }
    } catch {}
}

if (-not $pythonCmd) {
    Write-Host "  [WARNING] Python 3 not found! Facebook Private API (fbchat-v2) won't work." -ForegroundColor Yellow
    Write-Host "  [INFO] Install Python 3.9+ from https://python.org for best experience." -ForegroundColor Yellow
}

Write-Host ""

# ============================================
# Step 2: Install Node.js Dependencies
# ============================================
Write-Host "[2/5] Installing Node.js dependencies..." -ForegroundColor Yellow

npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Failed to install Node.js dependencies!" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Node.js dependencies installed" -ForegroundColor Green
Write-Host ""

# ============================================
# Step 3: Setup Instagram Sidecar (instagrapi)
# ============================================
Write-Host "[3/5] Setting up Instagram Private API sidecar..." -ForegroundColor Yellow

$instaSidecarPath = "instagram-sidecar"
if (Test-Path $instaSidecarPath) {
    Push-Location $instaSidecarPath
    
    # Create venv if not exists
    if (-not (Test-Path "venv")) {
        Write-Host "  Creating Python virtual environment..." -ForegroundColor Gray
        & $pythonCmd -m venv venv
    }
    
    # Install dependencies
    $pipPath = if ($IsWindows -or $env:OS -match "Windows") { "venv\Scripts\pip" } else { "venv/bin/pip" }
    Write-Host "  Installing Instagram sidecar dependencies..." -ForegroundColor Gray
    & $pipPath install -r requirements.txt -q
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Instagram sidecar ready (instagrapi)" -ForegroundColor Green
    } else {
        Write-Host "  [WARNING] Instagram sidecar setup had issues" -ForegroundColor Yellow
    }
    
    Pop-Location
} else {
    Write-Host "  [SKIP] Instagram sidecar folder not found" -ForegroundColor Yellow
}
Write-Host ""

# ============================================
# Step 4: Setup Facebook Sidecar (fbchat-v2)
# ============================================
Write-Host "[4/5] Setting up Facebook Private API sidecar (fbchat-v2 MQTT)..." -ForegroundColor Yellow

$fbSidecarPath = "facebook-sidecar"
if ((Test-Path $fbSidecarPath) -and $pythonCmd) {
    Push-Location $fbSidecarPath
    
    # Create venv if not exists
    if (-not (Test-Path "venv")) {
        Write-Host "  Creating Python virtual environment..." -ForegroundColor Gray
        & $pythonCmd -m venv venv
    }
    
    # Install dependencies (includes fbchat-v2 from GitHub)
    $pipPath = if ($IsWindows -or $env:OS -match "Windows") { "venv\Scripts\pip" } else { "venv/bin/pip" }
    Write-Host "  Installing Facebook sidecar dependencies (fbchat-v2)..." -ForegroundColor Gray
    Write-Host "  This may take a minute (downloading from GitHub)..." -ForegroundColor Gray
    & $pipPath install -r requirements.txt -q
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Facebook sidecar ready (fbchat-v2 MQTT)" -ForegroundColor Green
        Write-Host "       - Speed: <1 sec response" -ForegroundColor DarkGray
        Write-Host "       - RAM: ~20MB (vs 500MB browser)" -ForegroundColor DarkGray
    } else {
        Write-Host "  [WARNING] Facebook sidecar setup had issues" -ForegroundColor Yellow
        Write-Host "  [INFO] Browser automation will be used as fallback" -ForegroundColor Yellow
    }
    
    Pop-Location
} else {
    if (-not $pythonCmd) {
        Write-Host "  [SKIP] Python not available - Facebook will use browser automation" -ForegroundColor Yellow
    } else {
        Write-Host "  [SKIP] Facebook sidecar folder not found" -ForegroundColor Yellow
    }
}
Write-Host ""

# ============================================
# Step 5: Build the App
# ============================================
Write-Host "[5/5] Building the application..." -ForegroundColor Yellow

npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Application built successfully" -ForegroundColor Green
Write-Host ""

# ============================================
# Done!
# ============================================
Write-Host "========================================" -ForegroundColor Green
Write-Host "   Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the app:" -ForegroundColor Cyan
Write-Host "  npm start" -ForegroundColor White
Write-Host ""
Write-Host "To package for distribution:" -ForegroundColor Cyan
Write-Host "  npm run package:win    (Windows installer)" -ForegroundColor White
Write-Host "  npm run package:mac    (macOS DMG)" -ForegroundColor White
Write-Host "  npm run package:linux  (Linux AppImage)" -ForegroundColor White
Write-Host ""
Write-Host "Facebook Private API:" -ForegroundColor Cyan
if ($pythonCmd) {
    Write-Host "  [ENABLED] fbchat-v2 MQTT - Fast messaging!" -ForegroundColor Green
} else {
    Write-Host "  [FALLBACK] Browser automation (install Python for faster mode)" -ForegroundColor Yellow
}
Write-Host ""
