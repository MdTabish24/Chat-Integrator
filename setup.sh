#!/bin/bash

echo "🚀 Setting up Multi-Platform Messaging Hub..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "⚠️  Docker is not installed. You'll need Docker to run the database and Redis."
    echo "   You can still run the app locally if you have PostgreSQL and Redis installed."
else
    echo "✅ Docker version: $(docker --version)"
fi

# Install root dependencies
echo ""
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Create environment files if they don't exist
if [ ! -f backend/.env ]; then
    echo ""
    echo "📝 Creating backend .env file..."
    cp backend/.env.example backend/.env
    echo "⚠️  Please edit backend/.env and add your API keys and secrets"
fi

if [ ! -f frontend/.env ]; then
    echo ""
    echo "📝 Creating frontend .env file..."
    cp frontend/.env.example frontend/.env
fi

# Initialize Git hooks
if [ -d .git ]; then
    echo ""
    echo "🔧 Setting up Git hooks..."
    npx husky install
    chmod +x .husky/pre-commit
    chmod +x .husky/pre-push
else
    echo ""
    echo "⚠️  Git repository not initialized. Skipping Git hooks setup."
    echo "   Run 'git init' and then 'npx husky install' to set up hooks."
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit backend/.env and add your API keys"
echo "2. Start services with: npm run docker:up"
echo "3. Access the app at: http://localhost:5173"
echo ""
echo "For more information, see README.md"
