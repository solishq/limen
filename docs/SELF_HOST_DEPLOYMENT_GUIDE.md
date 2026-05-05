# Self-Host Deployment Guide

Deploy Limen's MCP server as a Docker container for persistent, production-grade cognitive infrastructure.

## Prerequisites

- Docker Engine 24+
- Docker Compose v2
- A 32-byte hex-encoded master key

## Quick Start

```bash
cd self-host/
cp .env.example .env

# Generate a master key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > master.key

# Edit .env — set LIMEN_MASTER_KEY or use the file mount
docker compose up -d
```

The MCP server is now running with stdio transport, accessible via Docker exec or MCP client configuration.

## Architecture

Limen is an embedded library. The MCP server wraps `createLimen()` as a persistent process:

```
┌─────────────────────────────────────────┐
│  Docker Container (node:22-slim)        │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  limen-mcp (stdio transport)      │  │
│  │  ├─ bootstrapEngine()             │  │
│  │  │  └─ createLimen(config)        │  │
│  │  ├─ 36 MCP tools registered       │  │
│  │  └─ graceful shutdown (SIGTERM)   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  /data/limen.db (SQLite WAL)            │
│  /run/secrets/master_key                │
└─────────────────────────────────────────┘
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LIMEN_MASTER_KEY` | Yes* | — | Hex-encoded 32-byte encryption key |
| `LIMEN_DATA_DIR` | No | `/data` | SQLite database directory |
| `LIMEN_PROTECTED_PREFIXES` | No | `governance:,system:` | Comma-separated protected subject prefixes |
| `NODE_ENV` | No | `production` | Runtime environment |

*Or mount as Docker secret at `/run/secrets/master_key`.

## Master Key Management

The master key encrypts sensitive data at rest (AES-256-GCM). Two injection methods:

**Option A: Environment variable**
```env
LIMEN_MASTER_KEY=a1b2c3...64hex_chars
```

**Option B: Docker secret (recommended for production)**
```yaml
secrets:
  master_key:
    file: ./master.key
```

Never commit the key to version control. Rotate via `limen.security.rotateKey()`.

## Data Persistence

Mount `/data` as a Docker volume:

```yaml
volumes:
  limen-data:
    driver: local
```

The data directory contains:
- `limen.db` — Main database (WAL mode)
- `limen.db-wal` — Write-ahead log
- `limen.db-shm` — Shared memory

**Backup:** Stop the container, copy `limen.db`. Or use SQLite online backup while running.

## Health Checks

The container includes an automated health check that verifies:
- SQLite database is accessible
- Limen engine initializes correctly
- Returns `healthy` / `degraded` / `unhealthy`

Check health: `docker inspect --format='{{.State.Health.Status}}' limen-mcp`

## Monitoring (Optional)

Enable the monitoring profile for Prometheus + Grafana:

```bash
docker compose --profile monitor up -d
```

Access Grafana at `http://localhost:3000`.

## Claude Code Integration

Point Claude Code at the running container:

```json
{
  "mcpServers": {
    "limen": {
      "command": "docker",
      "args": ["exec", "-i", "limen-mcp", "node", "dist/server.js"]
    }
  }
}
```

## Graceful Shutdown

The container handles SIGTERM correctly:
1. MCP server closes transport
2. Limen engine flushes WAL checkpoint
3. SQLite database closed cleanly
4. Process exits 0

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container won't start | Missing master key | Set `LIMEN_MASTER_KEY` or mount secret |
| Health check failing | Permission on /data | Ensure UID 1001 owns the volume |
| Slow startup | Large database | Normal — SQLite WAL replay on cold start |
| `EACCES` on limen.db | Volume permissions | `chown 1001:1001` the host directory |
