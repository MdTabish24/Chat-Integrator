#!/bin/bash
# ============================================
# Chat Orbitor Desktop - Complete Setup Script
# ============================================
# This script sets up everything automatically:
# 1. Node.js dependencies
# 2. Python sidecars (Instagram & Facebook fbchat-v2)
# 3. Builds the app
# 4. Optionally packages for distribution
# ============================================

echo ""
echo "========================================"
echo "   Chat Orbitor Desktop - Setup"
echo "========================================"
echo ""

# Check if running from correct directory
if [ ! -f "package.json" ]; then
    echo "[ERROR] Please run this script from the unified-desktop-app directory!"
    exit 1
fi

# ============================================
# Step 1: Check Prerequisites
# ============================================
echo "[1/5] Checking prerequisites..."

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "  [OK] Node.js: $NODE_VERSION"
else
    echo "  [ERROR] Node.js not found! Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

# Check Python
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    PYTHON_CMD="python3"
    echo "  [OK] Python: $PYTHON_VERSION"
elif command -v python &> /dev/null; then
    PYTHON_VERSION=$(python --version 2>&1)
    if [[ $PYTHON_VERSION == *"Python 3"* ]]; then
        PYTHON_CMD="python"
        echo "  [OK] Python: $PYTHON_VERSION"
    fi
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "  [WARNING] Python 3 not found! Facebook Private API (fbchat-v2) won't work."
    echo "  [INFO] Install Python 3.9+ for best experience."
fi

echo ""

# ============================================
# Step 2: Install Node.js Dependencies
# ============================================
echo "[2/5] Installing Node.js dependencies..."

npm install
if [ $? -ne 0 ]; then
    echo "  [ERROR] Failed to install Node.js dependencies!"
    exit 1
fi
echo "  [OK] Node.js dependencies installed"
echo ""

# ============================================
# Step 3: Setup Instagram Sidecar (instagrapi)
# ============================================
echo "[3/5] Setting up Instagram Private API sidecar..."

INSTA_SIDECAR="instagram-sidecar"
if [ -d "$INSTA_SIDECAR" ] && [ -n "$PYTHON_CMD" ]; then
    cd "$INSTA_SIDECAR"
    
    # Create venv if not exists
    if [ ! -d "venv" ]; then
        echo "  Creating Python virtual environment..."
        $PYTHON_CMD -m venv venv
    fi
    
    # Install dependencies
    echo "  Installing Instagram sidecar dependencies..."
    venv/bin/pip install -r requirements.txt -q
    
    if [ $? -eq 0 ]; then
        echo "  [OK] Instagram sidecar ready (instagrapi)"
    else
        echo "  [WARNING] Instagram sidecar setup had issues"
    fi
    
    cd ..
else
    echo "  [SKIP] Instagram sidecar folder not found or Python not available"
fi
echo ""

# ============================================
# Step 4: Setup Facebook Sidecar (fbchat-v2)
# ============================================
echo "[4/5] Setting up Facebook Private API sidecar (fbchat-v2 MQTT)..."

FB_SIDECAR="facebook-sidecar"
if [ -d "$FB_SIDECAR" ] && [ -n "$PYTHON_CMD" ]; then
    cd "$FB_SIDECAR"
    
    # Create venv if not exists
    if [ ! -d "venv" ]; then
        echo "  Creating Python virtual environment..."
        $PYTHON_CMD -m venv venv
    fi
    
    # Install dependencies (includes fbchat-v2 from GitHub)
    echo "  Installing Facebook sidecar dependencies (fbchat-v2)..."
    echo "  This may take a minute (downloading from GitHub)..."
    venv/bin/pip install -r requirements.txt -q
    
    if [ $? -eq 0 ]; then
        echo "  [OK] Facebook sidecar ready (fbchat-v2 MQTT)"
        echo "       - Speed: <1 sec response"
        echo "       - RAM: ~20MB (vs 500MB browser)"
    else
        echo "  [WARNING] Facebook sidecar setup had issues"
        echo "  [INFO] Browser automation will be used as fallback"
    fi
    
    cd ..
else
    if [ -z "$PYTHON_CMD" ]; then
        echo "  [SKIP] Python not available - Facebook will use browser automation"
    else
        echo "  [SKIP] Facebook sidecar folder not found"
    fi
fi
echo ""

# ============================================
# Step 5: Build the App
# ============================================
echo "[5/5] Building the application..."

npm run build
if [ $? -ne 0 ]; then
    echo "  [ERROR] Build failed!"
    exit 1
fi
echo "  [OK] Application built successfully"
echo ""

# ============================================
# Done!
# ============================================
echo "========================================"
echo "   Setup Complete!"
echo "========================================"
echo ""
echo "To start the app:"
echo "  npm start"
echo ""
echo "To package for distribution:"
echo "  npm run package:win    (Windows installer)"
echo "  npm run package:mac    (macOS DMG)"
echo "  npm run package:linux  (Linux AppImage)"
echo ""
echo "Facebook Private API:"
if [ -n "$PYTHON_CMD" ]; then
    echo "  [ENABLED] fbchat-v2 MQTT - Fast messaging!"
else
    echo "  [FALLBACK] Browser automation (install Python for faster mode)"
fi
echo ""
