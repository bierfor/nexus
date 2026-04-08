#!/bin/bash
# Nexus.js Database Migration Script
# Supports up/down migrations with Prisma or raw SQL

set -e

DIRECTION=${1:-up}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🗄️  Nexus Database Migration - $DIRECTION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
  export $(cat "$PROJECT_ROOT/.env" | grep -v '^#' | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL not set"
  exit 1
fi

echo "📋 Database: ${DATABASE_URL%%\?*}"  # Print without query params

# Check if using Prisma
if [ -f "$PROJECT_ROOT/prisma/schema.prisma" ]; then
  echo "🔧 Using Prisma for migrations..."
  cd "$PROJECT_ROOT"
  
  if [ "$DIRECTION" == "up" ]; then
    pnpm prisma migrate deploy
  elif [ "$DIRECTION" == "down" ]; then
    echo "⚠️  Prisma doesn't support automated rollback"
    echo "   Run manually: pnpm prisma migrate resolve --rolled-back <migration>"
    exit 1
  else
    echo "❌ Invalid direction: $DIRECTION (use 'up' or 'down')"
    exit 1
  fi
else
  # Raw SQL migrations
  MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
  
  if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "⚠️  No migrations directory found at $MIGRATIONS_DIR"
    echo "   Skipping migrations"
    exit 0
  fi
  
  echo "🔧 Running SQL migrations..."
  
  if [ "$DIRECTION" == "up" ]; then
    for sql_file in "$MIGRATIONS_DIR"/*.up.sql; do
      if [ -f "$sql_file" ]; then
        echo "   Applying $(basename $sql_file)..."
        psql "$DATABASE_URL" -f "$sql_file"
      fi
    done
  elif [ "$DIRECTION" == "down" ]; then
    # Run down migrations in reverse order
    for sql_file in $(ls -r "$MIGRATIONS_DIR"/*.down.sql); do
      if [ -f "$sql_file" ]; then
        echo "   Rolling back $(basename $sql_file)..."
        psql "$DATABASE_URL" -f "$sql_file"
      fi
    done
  else
    echo "❌ Invalid direction: $DIRECTION (use 'up' or 'down')"
    exit 1
  fi
fi

echo "✅ Migrations completed successfully"
