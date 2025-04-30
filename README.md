# Aphori.st

Copyright Max Hniebergall 2024
- The contents of this repo are made available for informational purposes only
- You must request written permission to execute, reproduce, extend, etc. as available protections exist under Canadian copyright law.
- Permission is likely to be granted for the purpose of local development for non commercial educational or hobby purposes for the benefit of the project (Aphori.st)

This repo is production ready.

# Build info

## Main build command for development
From the root directory (../Aphorist):
docker-compose up --build

### Start the firebase emulator for local firebase database for development
firebase emulators:start --only database


## Main build command for production
### Build and run production services
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

### View logs
docker-compose -f docker-compose.prod.yml logs -f

### Stop services
docker-compose -f docker-compose.prod.yml down


# Seed database
## In Development:
curl -X POST http://localhost:3000/api/seed-default-stories -H "Content-Type: application/json" -d '{}'