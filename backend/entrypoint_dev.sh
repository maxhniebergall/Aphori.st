#!/bin/sh

# Load environment variables from .env
if [ -f .env ]; then
  export $(cat .env | sed 's/#.*//g' | xargs)
fi

# Run the seed script
node seed.js

# Start the backend server
node server.js
