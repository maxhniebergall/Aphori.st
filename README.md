# Aphori.st

Copyright Max Hniebergall 2024


# Build info

## Main build command for development
From the root directory (../Aphorist):
`docker-compose up --build`


## Main build command for production
### Build and run production services
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

### View logs
docker-compose -f docker-compose.prod.yml logs -f

### Stop services
docker-compose -f docker-compose.prod.yml down