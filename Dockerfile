# ==============================================================================
# Multi-Stage Hardened Production Dockerfile for Ownlight
# Node 24 Alpine, non-root user (UID 1001, GID 1001), Next.js Standalone
# ==============================================================================

# Stage 1: Full dependency resolution and caching for build
FROM node:24.2.0-alpine3.21 AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g pnpm@12.10.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Production-only dependencies resolution
FROM node:24.2.0-alpine3.21 AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g pnpm@12.10.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Stage 3: Application compilation & bundle generation
FROM node:24.2.0-alpine3.21 AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm@12.10.1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=true

# Compile Next.js standalone and retention worker bundles
RUN pnpm run build
RUN pnpm run retention:build

# Stage 4: Minimal hardened production runner
FROM node:24.2.0-alpine3.21 AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Security: Create dedicated unprivileged non-root user (UID 1001, GID 1001)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nodejs

# Production dependencies from prod-deps stage (ensures worker and migration runtime modules)
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy Next.js standalone server and compiled files (excluding standalone traced node_modules)
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone/server.js ./server.js
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone/package.json ./package.json
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone/.next ./.next
COPY --from=builder --chown=nodejs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nodejs:nodejs /app/public ./public

# Copy PostgreSQL migrations and schema definitions
COPY --from=builder --chown=nodejs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nodejs:nodejs /app/drizzle ./drizzle

# Copy retention worker runner and bundled code
COPY --from=builder --chown=nodejs:nodejs /app/scripts/worker.mjs ./scripts/worker.mjs
COPY --from=builder --chown=nodejs:nodejs /app/dist/retention ./dist/retention

# Copy startup entrypoint script
COPY --chown=nodejs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Switch to unprivileged execution
USER nodejs:nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
