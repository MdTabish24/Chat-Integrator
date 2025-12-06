# Django Messaging Hub - Setup Script (Windows PowerShell)

Write-Host "🚀 Django Messaging Hub - Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check if Python is installed
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Python is not installed. Please install Python 3.11+" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Python found: $(python --version)" -ForegroundColor Green

# Create virtual environment
Write-Host ""
Write-Host "📦 Creating virtual environment..." -ForegroundColor Yellow
python -m venv venv

# Activate virtual environment
Write-Host "✅ Activating virtual environment..." -ForegroundColor Green
.\venv\Scripts\Activate.ps1

# Install dependencies
Write-Host ""
Write-Host "📥 Installing dependencies..." -ForegroundColor Yellow
python -m pip install --upgrade pip
pip install -r requirements.txt

# Copy environment file
if (-not (Test-Path .env)) {
    Write-Host ""
    Write-Host "📝 Creating .env file from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "⚠️  Please edit .env file with your configuration!" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "✅ .env file already exists" -ForegroundColor Green
}

# Run migrations
Write-Host ""
Write-Host "🗄️  Running database migrations..." -ForegroundColor Yellow
python manage.py makemigrations
python manage.py migrate

# Create superuser prompt
Write-Host ""
$createSuperuser = Read-Host "❓ Do you want to create a superuser? (y/n)"
if ($createSuperuser -eq "y" -or $createSuperuser -eq "Y") {
    python manage.py createsuperuser
}

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "🎯 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Edit .env file with your configuration"
Write-Host "   2. Start Redis (WSL or Docker): redis-server"
Write-Host "   3. Start Django: python manage.py runserver"
Write-Host "   4. Start Celery Worker: celery -A config worker -l info"
Write-Host "   5. Start Celery Beat: celery -A config beat -l info"
Write-Host ""
Write-Host "📚 Visit http://localhost:8000/admin for Django admin" -ForegroundColor Cyan
Write-Host "📚 Visit http://localhost:8000/health for health check" -ForegroundColor Cyan
Write-Host ""
Write-Host "Happy coding! 🎉" -ForegroundColor Green
