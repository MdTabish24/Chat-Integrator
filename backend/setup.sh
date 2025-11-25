#!/bin/bash

echo "🚀 Django Messaging Hub - Setup Script"
echo "========================================"

# Check if Python 3.11+ is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.11+"
    exit 1
fi

echo "✅ Python found: $(python3 --version)"

# Create virtual environment
echo ""
echo "📦 Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "✅ Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo ""
echo "📥 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Copy environment file
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration!"
else
    echo ""
    echo "✅ .env file already exists"
fi

# Run migrations
echo ""
echo "🗄️  Running database migrations..."
python manage.py makemigrations
python manage.py migrate

# Create superuser prompt
echo ""
read -p "❓ Do you want to create a superuser? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    python manage.py createsuperuser
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Edit .env file with your configuration"
echo "   2. Start Redis: redis-server"
echo "   3. Start Django: python manage.py runserver"
echo "   4. Start Celery Worker: celery -A config worker -l info"
echo "   5. Start Celery Beat: celery -A config beat -l info"
echo ""
echo "📚 Visit http://localhost:8000/admin for Django admin"
echo "📚 Visit http://localhost:8000/health for health check"
echo ""
echo "Happy coding! 🎉"
