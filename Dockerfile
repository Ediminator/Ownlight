# ==============================================================================
# Multi-Stage Hardened Production Dockerfile for Ownlight
# Node 24 Alpine, non-root user (UID 1001, GID 1001), Next.js Standalone
# ==============================================================================

# Stage 1: Dependency resolution and caching
FROM node:24.2.0-alpine3.21 AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Application compilation & bundle generation
FROM node:24.2.0-alpine3.21 AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Compile Next.js standalone and retention worker bundles
RUN pnpm run build
RUN pnpm run retention:build

# Stage 3: Minimal hardened production runner
FROM node:24.2.0-alpine3.21 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Security: Create dedicated unprivileged non-root user (UID 1001, GID 1001)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nodejs

# Copy Next.js standalone server and traced modules
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
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
