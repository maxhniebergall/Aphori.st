#!/bin/bash

# Aphorist E2E Test Setup Script
# This script sets up Playwright testing for the reply deduplication functionality

set -e

echo "🎭 Setting up Playwright E2E Tests for Aphorist..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install Playwright dependencies
echo "📦 Installing Playwright..."
npm install @playwright/test@^1.40.0

# Install Playwright browsers
echo "🌐 Installing browser binaries..."
npx playwright install

# Install browser dependencies (for Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "🐧 Installing browser dependencies for Linux..."
    npx playwright install-deps
fi

# Check if application is running
echo "🔍 Checking if application is running..."

# Check frontend
if curl -s -f http://localhost:3000 > /dev/null; then
    echo "✅ Frontend is running on http://localhost:3000"
else
    echo "⚠️  Frontend is not running. Starting with Docker Compose..."
    docker-compose up -d
    echo "⏳ Waiting for services to start..."
    sleep 30
fi

# Check backend
if curl -s -f http://localhost:5050/api/health > /dev/null; then
    echo "✅ Backend is running on http://localhost:5050"
else
    echo "⚠️  Backend health check failed. Please verify the application is running properly."
fi

# Check Firebase emulator
if curl -s -f http://localhost:9000 > /dev/null; then
    echo "✅ Firebase emulator is running on http://localhost:9000"
else
    echo "⚠️  Firebase emulator is not responding. Please ensure it's running."
fi

echo ""
echo "🎉 Test setup complete!"
echo ""
echo "Available test commands:"
echo "  npm run test:e2e              - Run all E2E tests"
echo "  npm run test:e2e:headed       - Run tests with browser UI visible"
echo "  npm run test:e2e:ui           - Run tests with Playwright UI"
echo "  npm run test:duplicate        - Run only duplicate detection tests"
echo "  npm run test:duplicate-api    - Run only API tests"
echo "  npm run test:e2e:debug        - Debug tests step by step"
echo "  npm run show-report           - View test report"
echo ""
echo "Test files created:"
echo "  tests/reply-deduplication.spec.ts     - Main UI tests"
echo "  tests/duplicate-api.spec.ts           - API endpoint tests"
echo "  tests/duplicate-edge-cases.spec.ts    - Edge case tests"
echo "  tests/helpers/                        - Test helper classes"
echo "  tests/fixtures/                       - Test data"
echo ""
echo "📖 See tests/README.md for detailed documentation"
echo ""

# Verify test configuration
echo "🔧 Verifying test configuration..."

if [[ -f "playwright.config.ts" ]]; then
    echo "✅ Playwright configuration found"
else
    echo "❌ Playwright configuration missing"
    exit 1
fi

if [[ -d "tests" ]]; then
    echo "✅ Test directory found"
    TEST_COUNT=$(find tests -name "*.spec.ts" | wc -l)
    echo "📝 Found $TEST_COUNT test files"
else
    echo "❌ Test directory missing"
    exit 1
fi

echo ""
echo "🚀 Ready to run tests! Try: npm run test:e2e"
echo ""
echo "💡 Tips:"
echo "  - Use 'npm run test:e2e:headed' to see tests run in the browser"
echo "  - Use 'npm run test:e2e:debug' to debug failing tests"
echo "  - Check 'test-results/' for screenshots and videos of failed tests"
echo "  - Ensure the application is fully running before running tests"
echo ""