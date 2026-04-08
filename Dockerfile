# Nexus.js Production Dockerfile
# Multi-stage build for optimal image size and security

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Build - Compile TypeScript and bundle assets
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root and package definitions
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/*/package.json ./packages/

# Install dependencies (with lockfile)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages
RUN pnpm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Production - Minimal runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Security: Run as non-root user
RUN addgroup -g 1001 nexus && \
    adduser -u 1001 -G nexus -s /bin/sh -D nexus

WORKDIR /app

# Copy package definitions and lockfile
COPY --from=builder --chown=nexus:nexus /app/package.json ./
COPY --from=builder --chown=nexus:nexus /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=nexus:nexus /app/pnpm-lock.yaml ./
COPY --from=builder --chown=nexus:nexus /app/packages/*/package.json ./packages/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=builder --chown=nexus:nexus /app/packages/*/dist ./packages/
COPY --from=builder --chown=nexus:nexus /app/packages/cli/templates ./packages/cli/templates

# Switch to non-root user
USER nexus

# Environment variables (override in docker-compose or runtime)
ENV NODE_ENV=production
ENV NEXUS_PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/_nexus/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Expose port
EXPOSE 3000

# Default command (can be overridden)
CMD ["node", "packages/cli/dist/bin.js", "start"]
