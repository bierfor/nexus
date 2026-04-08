#!/bin/bash
# Nexus.js Rollback Script
# Reverts to the previous working container

set -e

echo "🔙 Nexus Rollback"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if rollback image exists
if ! docker images nexus-app:rollback --format "{{.ID}}" | grep -q .; then
  echo "❌ Error: No rollback image found"
  echo "   Cannot rollback without a previous deployment"
  exit 1
fi

echo "⚠️  Rolling back to previous version..."

# Stop current container
docker-compose down nexus-app || true

# Tag rollback as latest
docker tag nexus-app:rollback nexus-app:latest

# Start rollback container
docker-compose up -d nexus-app

# Health check
MAX_RETRIES=30
RETRY_COUNT=0
HEALTH_URL="http://localhost:${NEXUS_PORT:-3000}/_nexus/health"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf $HEALTH_URL > /dev/null; then
    echo "✅ Rollback successful"
    echo "   Previous version restored and healthy"
    exit 0
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "   Waiting for app... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done

echo "❌ Rollback failed - previous version is unhealthy"
echo "   Manual intervention required"
exit 1
