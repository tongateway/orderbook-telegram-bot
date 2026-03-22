#!/bin/bash

# Build and run script for Telegram Trading Bot
# Combines build and run steps

set -e  # Exit on error

echo "🔨🚀 Build and Run Telegram Trading Bot"
echo ""

# Build the app
./scripts/build.sh

echo ""
echo "─────────────────────────────────────"
echo ""

# Run the app
./scripts/run.sh
