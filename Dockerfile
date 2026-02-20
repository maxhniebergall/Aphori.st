# Stage 1: Build Node.js API
FROM node:20-slim AS node-builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./

# Copy package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

# Build shared package first, then API
RUN pnpm --filter @chitin/shared build && pnpm --filter @chitin/api build

# Stage 2: Build Python virtualenv
FROM python:3.11-slim AS python-builder

RUN apt-get update -qq && apt-get install -yqq \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY discourse-engine/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -q -r /tmp/requirements.txt

# Stage 3: Production image
FROM python:3.11-slim AS production

# Install Node.js 20, supervisor, and curl (for healthcheck)
RUN apt-get update -qq && apt-get install -yqq \
    curl \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -yqq nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy Python virtualenv
COPY --from=python-builder /opt/venv /opt/venv

WORKDIR /app

# Copy workspace config for pnpm prod install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Install production Node.js dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built Node.js artifacts
COPY --from=node-builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=node-builder /app/apps/api/dist/ apps/api/dist/

# Copy migration SQL files to where the compiled migrate.js expects them
COPY apps/api/src/db/migrations/ apps/api/dist/db/migrations/

# Copy Python application code (matches DE Dockerfile layout)
COPY discourse-engine/factional_analysis/ /app/factional_analysis/
COPY discourse-engine/chitin_wrapper/ /app/chitin_wrapper/

# Copy supervisor config
COPY supervisor/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Run as non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser \
    && chown -R appuser:appuser /app /opt/venv
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
