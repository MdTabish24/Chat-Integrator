@echo off
REM Facebook Sidecar Startup Script for Windows
REM This script starts the Facebook Messenger Private API sidecar

echo ========================================
echo Facebook Messenger Private API Sidecar
echo ========================================
echo.

cd /d "%~dp0"

REM Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo [INFO] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        echo [ERROR] Please ensure Python 3.9+ is installed.
        pause
        exit /b 1
    )
    
    echo [INFO] Installing dependencies...
    venv\Scripts\pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo [INFO] Starting Facebook sidecar on port 5001...
echo [INFO] Press Ctrl+C to stop.
echo.

venv\Scripts\python -m uvicorn engine:app --host 127.0.0.1 --port 5001

pause
