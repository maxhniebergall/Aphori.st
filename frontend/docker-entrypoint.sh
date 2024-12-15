#!/bin/sh
set -e

# Replace environment variables in the nginx config template
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Verify nginx configuration
nginx -t

# Start nginx in the foreground
exec nginx -g 'daemon off;' 