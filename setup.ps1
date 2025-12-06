# Multi-Platform Messaging Hub Setup Script

Write-Host "🚀 Setting up Multi-Platform Messaging Hub..." -ForegroundColor Cyan

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed. Please install Node.js 18+ first." -ForegroundColor Red
    exit 1
}

# Check if Docker is installed
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker version: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Docker is not installed. You'll need Docker to run the database and Redis." -ForegroundColor Yellow
    Write-Host "   You can still run the app locally if you have PostgreSQL and Redis installed." -ForegroundColor Yellow
}

# Install root dependencies
Write-Host ""
Write-Host "📦 Installing root dependencies..." -ForegroundColor Cyan
npm install

# Install backend dependencies
Write-Host ""
Write-Host "📦 Installing backend dependencies..." -ForegroundColor Cyan
Set-Location backend
npm install
Set-Location ..

# Install frontend dependencies
Write-Host ""
Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Cyan
Set-Location frontend
npm install
Set-Location ..

# Create environment files if they don't exist
if (-not (Test-Path "backend\.env")) {
    Write-Host ""
    Write-Host "📝 Creating backend .env file..." -ForegroundColor Cyan
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "⚠️  Please edit backend\.env and add your API keys and secrets" -ForegroundColor Yellow
}

if (-not (Test-Path "frontend\.env")) {
    Write-Host ""
    Write-Host "📝 Creating frontend .env file..." -ForegroundColor Cyan
    Copy-Item "frontend\.env.example" "frontend\.env"
}

# Initialize Git hooks
if (Test-Path ".git") {
    Write-Host ""
    Write-Host "🔧 Setting up Git hooks..." -ForegroundColor Cyan
    npx husky install
} else {
    Write-Host ""
    Write-Host "⚠️  Git repository not initialized. Skipping Git hooks setup." -ForegroundColor Yellow
    Write-Host "   Run 'git init' and then 'npx husky install' to set up hooks." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit backend\.env and add your API keys"
Write-Host "2. Start services with: npm run docker:up"
Write-Host "3. Access the app at: http://localhost:5173"
Write-Host ""
Write-Host "For more information, see README.md"
