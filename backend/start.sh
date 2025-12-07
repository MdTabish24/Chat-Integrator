#!/bin/bash
set -e

echo "Starting Chat Orbitor Backend..."

# Run migrations
echo "Running database migrations..."
python manage.py migrate --noinput

# Collect static files
echo "Collecting static files..."
python manage.py collectstatic --noinput

# Start server with optimized settings for free tier
# Using daphne with limited workers for memory efficiency
echo "Starting Daphne ASGI server..."
exec daphne -b 0.0.0.0 -p ${PORT:-8000} --verbosity 1 config.asgi:application
