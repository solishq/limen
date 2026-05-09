# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
# ============================================================================
# Limen MCP Server — Multi-Stage Docker Build
# ============================================================================
# Stage 1 (build): Install all deps, compile TypeScript, build native modules
# Stage 2 (runtime): Minimal image with dist + production deps
#
# Native module: better-sqlite3 requires build-essential + python3 at compile
# time. The build stage compiles it; the runtime stage copies the pre-built
# binary from node_modules — no build tools needed at runtime.
#
# Module resolution: limen-ai is the root package. The MCP server imports it
# via a node_modules symlink. We recreate this symlink in the runtime stage
# since Docker COPY resolves symlinks (which would cause circular copies).
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:22-slim AS build

# better-sqlite3 native addon requires build tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential \
      python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy workspace root package files first (layer cache optimization)
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./

# Copy source code — monorepo structure required for workspace resolution
COPY src/ src/
COPY packages/ packages/

# Install ALL dependencies (devDeps needed for tsc)
RUN npm ci

# Build the core engine (limen-ai)
RUN npx tsc -p tsconfig.build.json

# Build the MCP server package
RUN cd packages/limen-mcp && npx tsc -p tsconfig.json

# Prepare production node_modules: remove workspace symlinks before copy,
# then prune dev dependencies. This avoids Docker COPY following the
# workspace symlink (which points to the root — circular).
RUN rm -f node_modules/limen-mcp node_modules/limen-ai 2>/dev/null || true
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

# Metadata
LABEL org.opencontainers.image.title="limen-mcp" \
      org.opencontainers.image.description="Limen Cognitive OS — MCP Server" \
      org.opencontainers.image.vendor="SolisHQ" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/solishq/limen"

# Create non-root user
RUN groupadd --gid 1001 limen && \
    useradd --uid 1001 --gid limen --shell /bin/sh --create-home limen

WORKDIR /app

# Copy root package.json (defines "limen-ai" name and exports)
COPY --from=build /build/package.json ./

# Copy production node_modules (better-sqlite3 native binary, MCP SDK, zod)
# Workspace symlinks were removed in build stage to prevent circular COPY
COPY --from=build /build/node_modules/ node_modules/

# Copy compiled core engine
COPY --from=build /build/dist/ dist/

# Copy compiled MCP server
COPY --from=build /build/packages/limen-mcp/dist/ packages/limen-mcp/dist/
COPY --from=build /build/packages/limen-mcp/package.json packages/limen-mcp/

# Recreate workspace symlinks for module resolution:
#   - limen-ai: root package (self-reference for packages/limen-mcp imports)
#   - limen-mcp: MCP server workspace package
RUN ln -s /app node_modules/limen-ai && \
    ln -s /app/packages/limen-mcp node_modules/limen-mcp

# Copy health check script
COPY self-host/healthcheck.js /app/healthcheck.js

# Create data directory with correct ownership
RUN mkdir -p /data && chown -R limen:limen /data

# Volumes
VOLUME ["/data"]

# Environment defaults (overridden by .env or docker-compose)
ENV LIMEN_DATA_DIR=/data \
    LIMEN_MASTER_KEY_PATH=/run/secrets/master_key \
    NODE_ENV=production

# Switch to non-root user
USER limen

# Health check — runs a standalone Limen health probe against the data dir
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD ["node", "/app/healthcheck.js"]

# Entry point — MCP server over stdio
ENTRYPOINT ["node", "packages/limen-mcp/dist/server.js"]
