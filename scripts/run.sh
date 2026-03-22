#!/bin/bash

# Run script for Telegram Trading Bot

set -e  # Exit on error

echo "🚀 Starting Telegram Trading Bot..."
echo ""

# Check if dist exists
if [ ! -d "dist" ]; then
    echo "❌ dist folder not found. Building first..."
    ./scripts/build.sh
    echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Please create .env file with required variables."
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Check if bot token is set
if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ "$TELEGRAM_BOT_TOKEN" = "your_bot_token_here" ]; then
    echo "❌ TELEGRAM_BOT_TOKEN not set in .env file!"
    echo "Please add your Telegram bot token to .env"
    exit 1
fi

# Check database connection
echo "🗄️  Checking database..."
# Temporarily disable exit on error for docker check
set +e
docker ps | grep vibe-kanban-db > /dev/null 2>&1
DB_RUNNING=$?
set -e

if [ $DB_RUNNING -ne 0 ]; then
    echo "⚠️  PostgreSQL container not running!"
    echo "Starting database..."
    docker-compose up -d
    echo "Waiting for database to be ready..."
    sleep 3
fi

echo "✅ Database is running"
echo ""

# Run the app
echo "🤖 Starting bot..."
echo ""
node dist/index.js
