#!/bin/bash

# Development mode script for Telegram Trading Bot
# Runs with ts-node for faster iteration (no build step)

set -e  # Exit on error

echo "🔥 Starting Telegram Trading Bot (Development Mode)..."
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Please create .env file with required variables."
    exit 1
fi

# Ensure infrastructure is running
echo "🗄️  Ensuring PostgreSQL + Redis are running..."
docker compose up -d postgres redis

echo "⏳ Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U vibe_user -d vibe_kanban > /dev/null 2>&1; do
    sleep 2
done

echo "⏳ Waiting for Redis..."
until docker compose exec -T redis redis-cli ping | grep -q PONG; do
    sleep 2
done

echo "✅ Infrastructure is ready"
echo ""

# Run with ts-node (no build required)
echo "🤖 Starting bot (dev mode)..."
echo ""
yarn dev
