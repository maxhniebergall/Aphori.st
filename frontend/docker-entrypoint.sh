#!/bin/sh

# Replace environment variables in the nginx config template
envsubst '${NGINX_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Start nginx
nginx -g 'daemon off;' 