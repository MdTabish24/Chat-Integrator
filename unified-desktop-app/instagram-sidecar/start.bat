@echo off
echo Starting Instagram Private API Sidecar...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.9+ from https://python.org
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt --quiet

REM Create sessions directory
if not exist "sessions" mkdir sessions

REM Start the server
echo.
echo Starting server on http://127.0.0.1:5050
echo Press Ctrl+C to stop
echo.
uvicorn engine:app --host 127.0.0.1 --port 5050 --reload
