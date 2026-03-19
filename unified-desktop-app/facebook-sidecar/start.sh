#!/bin/bash
# Facebook Sidecar Startup Script for macOS/Linux
# This script starts the Facebook Messenger Private API sidecar

echo "========================================"
echo "Facebook Messenger Private API Sidecar"
echo "========================================"
echo ""

cd "$(dirname "$0")"

# Check if venv exists
if [ ! -f "venv/bin/python" ]; then
    echo "[INFO] Creating virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create virtual environment."
        echo "[ERROR] Please ensure Python 3.9+ is installed."
        exit 1
    fi
    
    echo "[INFO] Installing dependencies..."
    venv/bin/pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies."
        exit 1
    fi
fi

echo "[INFO] Starting Facebook sidecar on port 5001..."
echo "[INFO] Press Ctrl+C to stop."
echo ""

venv/bin/python -m uvicorn engine:app --host 127.0.0.1 --port 5001
