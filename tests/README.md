# Aphorist E2E Tests

This directory contains end-to-end tests for the Aphorist application, with a focus on testing the reply deduplication functionality using Playwright.

## Overview

The test suite covers:
- Reply creation and duplicate detection
- Vector similarity matching (threshold 0.08)
- Duplicate comparison UI at `/dupe/:groupId`
- Voting functionality on duplicate replies
- API endpoint testing for duplicate-related operations

## Prerequisites

1. **Application Running**: Ensure the application is running with Docker Compose:
   ```bash
   docker-compose up --build
   ```
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5050/api

2. **Firebase Emulator**: The Firebase Realtime Database emulator should be running on localhost:9000

3. **FAISS Vector Search**: Ensure the vector search system is initialized and working

## Installation

Install Playwright and browser dependencies:

```bash
# Install Playwright
npm install

# Install browser binaries
npx playwright install
```

## Running Tests

### Full Test Suite
```bash
# Run all e2e tests
npm run test:e2e

# Run with browser UI visible
npm run test:e2e:headed

# Run with Playwright UI
npm run test:e2e:ui
```

### Specific Test Categories
```bash
# Run only duplicate detection tests
npm run test:duplicate

# Run only API tests
npm run test:duplicate-api

# Debug mode
npm run test:e2e:debug
```

### View Test Reports
```bash
npm run show-report
```

## Test Structure

### Test Files

- **`reply-deduplication.spec.ts`**: Main UI tests for duplicate detection and comparison
- **`duplicate-api.spec.ts`**: API endpoint tests for duplicate functionality

### Helper Classes

- **`AuthHelper`**: Handles user authentication and login flows
- **`PostHelper`**: Creates and manages test posts
- **`ReplyHelper`**: Creates replies and handles duplicate detection
- **`DuplicateHelper`**: Tests duplicate comparison UI and voting

### Test Data

- **`test-data.ts`**: Contains test users, posts, and reply fixtures
- Includes replies designed to trigger duplicate detection (high similarity)
- Includes unique replies that should NOT be detected as duplicates

## Key Test Scenarios

### 1. Duplicate Detection Flow
1. Create original reply on a post
2. Create similar reply → should trigger duplicate detection
3. Verify redirect to `/dupe/:groupId`
4. Verify duplicate comparison UI displays correctly

### 2. Voting Functionality
1. Navigate to duplicate comparison page
2. Vote for preferred duplicate reply
3. Verify vote is recorded and UI updates
4. Test vote persistence across page reloads

### 3. Multiple Duplicates
1. Create original reply
2. Create first duplicate → creates group
3. Create second duplicate → adds to same group
4. Verify UI shows all duplicates in group

### 4. Vector Similarity Threshold
1. Test replies above similarity threshold (0.08) → detected as duplicates
2. Test replies below threshold → NOT detected as duplicates
3. Verify similarity scores displayed in UI

### 5. API Endpoints
- `POST /api/replies/createReply` → with duplicate detection
- `GET /api/replies/duplicate/:groupId` → fetch group data
- `POST /api/replies/duplicate/:groupId/vote` → vote on duplicates

## Configuration

### Playwright Config (`playwright.config.ts`)
- **Base URL**: http://localhost:3000
- **Browsers**: Chromium, Firefox, WebKit
- **Timeouts**: 30s per test, 10s for assertions
- **Screenshots**: On failure only
- **Videos**: Retained on failure
- **Web Server**: Starts Docker Compose automatically

### Test Data Configuration
- **Similarity Threshold**: 0.08 (matches backend configuration)
- **Test Users**: 3 test users for multi-user scenarios
- **Test Content**: Designed to trigger/avoid duplicate detection

## Debugging

### Debug Mode
```bash
npm run test:e2e:debug
```
This opens Playwright Inspector for step-by-step debugging.

### Screenshots and Videos
Failed tests automatically capture:
- Screenshots in `test-results/`
- Videos in `test-results/`
- Traces for analysis

### Common Issues

1. **App Not Running**: Ensure Docker Compose is up
2. **Firebase Emulator**: Check localhost:9000 is accessible
3. **Vector Search**: Verify FAISS index is initialized
4. **Auth Issues**: Mock authentication may need adjustment

## Mock Data

The tests use mock authentication and test data:
- Mock tokens for API authentication
- Predefined test users and content
- Reply text designed for similarity testing

## Continuous Integration

For CI/CD pipelines:
```bash
# Install dependencies
npm ci

# Install browsers in CI
npx playwright install --with-deps

# Run tests in CI mode
CI=true npm run test:e2e
```

## Contributing

When adding new tests:
1. Use the helper classes for common operations
2. Add new test data to `fixtures/test-data.ts`
3. Follow the existing test patterns
4. Ensure tests are independent and can run in parallel
5. Add appropriate assertions for UI and API responses