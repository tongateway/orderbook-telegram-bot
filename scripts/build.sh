#!/bin/bash

# Build script for Telegram Trading Bot

set -e  # Exit on error

echo "🔨 Building Telegram Trading Bot..."
echo ""

# Clean dist folder
echo "📦 Cleaning dist folder..."
rm -rf dist

# Build TypeScript
echo "⚙️  Compiling TypeScript..."
yarn build

echo ""
echo "✅ Build complete! Output in ./dist"
echo ""
echo "To run the app:"
echo "  ./scripts/run.sh"
echo "  OR"
echo "  yarn start"
