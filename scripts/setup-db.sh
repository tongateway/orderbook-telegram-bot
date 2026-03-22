#!/bin/bash

# Database setup script for Telegram Trading Bot

set -e  # Exit on error

echo "🗄️  Setting up PostgreSQL database..."
echo ""

# Start PostgreSQL container
echo "📦 Starting PostgreSQL container..."
docker compose up -d postgres

echo "⏳ Waiting for database to be ready..."
until docker compose exec -T postgres pg_isready -U vibe_user -d vibe_kanban > /dev/null 2>&1; do
    sleep 2
done
echo "✅ Database is healthy"

echo ""

# Generate Prisma client
echo "⚙️  Generating Prisma client..."
yarn db:generate

echo ""

# Run migrations
echo "🔄 Running database migrations..."
yarn db:migrate

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Database info:"
echo "  Host: localhost:5435"
echo "  Database: vibe_kanban"
echo "  User: vibe_user"
echo ""
echo "Useful commands:"
echo "  yarn db:studio  - Open Prisma Studio (database GUI)"
echo "  yarn db:seed    - Seed database with test data"
