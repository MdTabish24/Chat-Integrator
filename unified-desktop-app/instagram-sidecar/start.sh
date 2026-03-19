#!/bin/bash
echo "Starting Instagram Private API Sidecar..."
echo

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python3 is not installed"
    echo "Please install Python 3.9+ from https://python.org"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt --quiet

# Create sessions directory
mkdir -p sessions

# Start the server
echo
echo "Starting server on http://127.0.0.1:5050"
echo "Press Ctrl+C to stop"
echo
uvicorn engine:app --host 127.0.0.1 --port 5050 --reload
