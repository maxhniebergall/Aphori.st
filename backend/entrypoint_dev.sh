#!/bin/sh

# Load environment variables from .env
if [ -f .env ]; then
  export $(cat .env | sed 's/#.*//g' | xargs)
fi

# Start the backend server
node server.js