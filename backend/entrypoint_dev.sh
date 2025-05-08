#!/bin/sh

# Requirements:
# - Loads environment variables from .env file
# - Starts TypeScript compiler in watch mode for development
# - Uses ES modules for TypeScript compilation

# Load environment variables from .env
if [ -f .env ]; then
  set -a
  . .env
  set +a
fi

# Start the TypeScript compiler in watch mode for development
yarn dev