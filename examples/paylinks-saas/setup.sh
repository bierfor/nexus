#!/bin/bash
# PayLinks SaaS - Setup Script
# Automates the initial setup process

set -e

echo "🚀 PayLinks SaaS - Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Check if .env exists
if [ ! -f .env ]; then
  echo "📋 Creating .env file..."
  cp .env.example .env
  
  # Generate NEXUS_SECRET
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  
  # Replace placeholder with generated secret (works on both Linux and macOS)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|NEXUS_SECRET=.*|NEXUS_SECRET=\"$SECRET\"|" .env
  else
    sed -i "s|NEXUS_SECRET=.*|NEXUS_SECRET=\"$SECRET\"|" .env
  fi
  
  echo "   ✅ .env created with auto-generated NEXUS_SECRET"
else
  echo "   ℹ️  .env already exists, skipping..."
fi

# Step 2: Install dependencies
echo ""
echo "📦 Installing dependencies..."
pnpm install

# Step 3: Setup database
echo ""
echo "🗄️  Setting up database..."
pnpm db:push

echo ""
echo "🔧 Generating Prisma client..."
pnpm db:generate

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "🚀 Start the development server:"
echo "   pnpm dev"
echo ""
echo "🔐 Demo credentials:"
echo "   Email: demo@example.com"
echo "   Password: demo123"
