#!/bin/bash
# Nexus.js Production Deployment Script
# Usage: ./scripts/deploy.sh [environment]

set -e  # Exit on error

ENVIRONMENT=${1:-production}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Nexus Deployment - $ENVIRONMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Load environment variables
if [ -f "$PROJECT_ROOT/.env.$ENVIRONMENT" ]; then
  echo "📋 Loading environment from .env.$ENVIRONMENT"
  export $(cat "$PROJECT_ROOT/.env.$ENVIRONMENT" | grep -v '^#' | xargs)
else
  echo "⚠️  Warning: .env.$ENVIRONMENT not found, using .env"
  if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(cat "$PROJECT_ROOT/.env" | grep -v '^#' | xargs)
  else
    echo "❌ Error: No .env file found"
    exit 1
  fi
fi

# Validate required environment variables
REQUIRED_VARS=("NEXUS_SECRET" "DATABASE_URL")
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Error: $var is not set"
    exit 1
  fi
done

echo "✅ Environment validated"

# Step 1: Build
echo ""
echo "📦 Step 1/5: Building application..."
cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile
pnpm run build

# Generate build ID from git SHA
if git rev-parse --git-dir > /dev/null 2>&1; then
  BUILD_ID=$(git rev-parse --short HEAD)
  export NEXUS_BUILD_ID=$BUILD_ID
  echo "   Build ID: $BUILD_ID"
fi

# Step 2: Run database migrations
echo ""
echo "🗄️  Step 2/5: Running database migrations..."
if [ -f "$PROJECT_ROOT/scripts/migrate.sh" ]; then
  bash "$PROJECT_ROOT/scripts/migrate.sh" up
else
  echo "   Skipping migrations (no migrate.sh found)"
fi

# Step 3: Build Docker image
echo ""
echo "🐳 Step 3/5: Building Docker image..."
docker build -t nexus-app:$BUILD_ID -t nexus-app:latest .

# Step 4: Stop old container and start new one
echo ""
echo "🔄 Step 4/5: Deploying new container..."

# Save current container ID for rollback
CURRENT_CONTAINER=$(docker ps -q -f name=nexus-app)
if [ ! -z "$CURRENT_CONTAINER" ]; then
  echo "   Tagging current container as rollback target..."
  docker commit $CURRENT_CONTAINER nexus-app:rollback
fi

# Stop and remove old container
docker-compose down nexus-app || true

# Start new container
docker-compose up -d nexus-app

# Step 5: Health check
echo ""
echo "🏥 Step 5/5: Running health check..."
MAX_RETRIES=30
RETRY_COUNT=0
HEALTH_URL="http://localhost:${NEXUS_PORT:-3000}/_nexus/health"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf $HEALTH_URL > /dev/null; then
    echo "✅ Health check passed"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "   Waiting for app to be healthy... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "❌ Health check failed after $MAX_RETRIES attempts"
  echo "🔙 Rolling back to previous version..."
  bash "$SCRIPT_DIR/rollback.sh"
  exit 1
fi

# Cleanup old images (keep last 3)
echo ""
echo "🧹 Cleaning up old Docker images..."
docker images nexus-app --format "{{.ID}} {{.Tag}}" | grep -v latest | grep -v rollback | tail -n +4 | awk '{print $1}' | xargs -r docker rmi || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment completed successfully!"
echo "   Build ID: $BUILD_ID"
echo "   Environment: $ENVIRONMENT"
echo "   URL: http://localhost:${NEXUS_PORT:-3000}"
echo ""
echo "📊 View logs: docker-compose logs -f nexus-app"
echo "🔙 Rollback: ./scripts/rollback.sh"
