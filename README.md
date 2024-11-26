# Aphori.st

Copyright Max Hniebergall 2024


# Build info

## Main build command for development
From the root directory (../Aphorist):
docker-compose up --build


## Main build command for production
### Build and run production services
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

### View logs
docker-compose -f docker-compose.prod.yml logs -f

### Stop services
docker-compose -f docker-compose.prod.yml down


## Developing on WSL2
netsh advfirewall firewall add rule name="Allowing LAN connections" dir=in action=allow protocol=TCP localport=3000
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=172.24.130.134

netsh advfirewall firewall add rule name="Allowing LAN connections" dir=in action=allow protocol=TCP localport=5000
netsh interface portproxy add v4tov4 listenport=5000 listenaddress=0.0.0.0 connectport=5000 connectaddress=172.24.130.134

get port from ipconfig

go to port:3000 on phone