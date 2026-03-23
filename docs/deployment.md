# Deployment Guide

Limen runs as an embedded library in your Node.js application. There is no separate server to deploy, no external database to manage, and no container orchestration required.

---

## Requirements

- Node.js >= 22
- Writable filesystem for SQLite database
- C++ build tools for `better-sqlite3` native compilation:
  - **macOS**: `xcode-select --install`
  - **Ubuntu/Debian**: `sudo apt install build-essential python3`
  - **Alpine**: `apk add build-base python3`
  - **Windows**: Visual Studio Build Tools

---

## Data Directory

All engine state is stored in the `dataDir` you specify:

```typescript
const limen = await createLimen({
  dataDir: '/var/lib/myapp/limen',
  masterKey: Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex'),
  // ...
});
```

The directory contains:
- `limen.db` — Main SQLite database (WAL mode)
- `limen.db-wal` — Write-ahead log (auto-managed)
- `limen.db-shm` — Shared memory (auto-managed)

**Backup**: Copy `limen.db` while the engine is shut down, or use SQLite's online backup API. WAL mode checkpoints periodically (every 5 minutes, passive mode).

---

## Master Key

The master key encrypts sensitive data at rest (AES-256-GCM). You must provide the same key on every startup or encrypted data becomes unreadable.

```bash
# Generate once
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > /etc/myapp/master.key
chmod 600 /etc/myapp/master.key
```

**Storage options**:
- Environment variable: `LIMEN_MASTER_KEY=<hex>`
- File with restricted permissions (0600)
- Secret manager (AWS Secrets Manager, Vault, etc.)

Never commit the key to version control.

---

## Docker

```dockerfile
FROM node:22-slim

# Build tools for better-sqlite3
RUN apt-get update && apt-get install -y build-essential python3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

# Data directory
VOLUME /data

ENV LIMEN_DATA_DIR=/data
ENV LIMEN_MASTER_KEY=""

CMD ["node", "dist/server.js"]
```

Mount the data volume to persist the SQLite database across container restarts.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LIMEN_MASTER_KEY` | Yes | Hex-encoded 32-byte encryption key |
| `ANTHROPIC_API_KEY` | If using Anthropic | API key |
| `OPENAI_API_KEY` | If using OpenAI | API key |
| `GEMINI_API_KEY` | If using Gemini | API key |
| `GROQ_API_KEY` | If using Groq | API key |
| `MISTRAL_API_KEY` | If using Mistral | API key |

---

## Graceful Shutdown

Always call `shutdown()` before process exit to flush WAL and close the database cleanly.

```typescript
process.on('SIGTERM', async () => {
  await limen.shutdown();
  process.exit(0);
});
```

---

## Monitoring

Use the health endpoint to build readiness and liveness checks:

```typescript
const health = await limen.health();
// health.status: 'healthy' | 'degraded' | 'unhealthy'
// health.subsystems: per-subsystem breakdown
// health.uptime_ms: time since initialization
```

- **Readiness**: `health.status !== 'unhealthy'`
- **Liveness**: `health.status === 'healthy'`

---

## Scaling Considerations

Limen uses SQLite in WAL mode, which supports concurrent reads with a single writer. This is appropriate for:

- Single-server deployments
- Applications with moderate write throughput
- Horizontal scaling via tenant-level database isolation (one SQLite file per tenant)

For high-write-throughput scenarios, use `database` isolation mode to give each tenant its own SQLite file, eliminating write contention across tenants.
