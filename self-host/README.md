# Limen MCP Server — Self-Host

Run Limen as a containerized MCP server with persistent SQLite storage.

## Quick Start

```bash
# 1. Generate a master encryption key
openssl rand -hex 32 > self-host/master.key

# 2. Configure environment
cp self-host/.env.example self-host/.env

# 3. Start the server
cd self-host
docker compose up -d
```

## Architecture

The container runs the Limen MCP server over stdio transport. Data persists in a Docker volume (`limen-data`), and the master encryption key is injected via Docker secrets.

```
Host                          Container
----                          ---------
master.key ──secret──> /run/secrets/master_key
limen-data ──volume──> /data (SQLite databases)
```

## Master Key Options

**File mount (default):** Place your key at `self-host/master.key`. Docker Compose mounts it as a secret.

```bash
openssl rand -hex 32 > self-host/master.key
```

**Environment variable:** Set `LIMEN_MASTER_KEY` in `.env` with a hex-encoded 32-byte key. This overrides the file mount.

```bash
echo "LIMEN_MASTER_KEY=$(openssl rand -hex 32)" >> self-host/.env
```

## Health Checks

The container runs an automated health check every 30 seconds. It creates a lightweight Limen engine instance against the data directory and verifies the engine reports `healthy`.

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' limen-mcp
```

## Monitoring (Optional)

Activate the monitoring profile to add Prometheus and Grafana:

```bash
docker compose --profile monitor up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (admin/admin)

## Rebuilding

```bash
docker compose build --no-cache
docker compose up -d
```

## Data Backup

```bash
# Stop the container to ensure SQLite consistency
docker compose stop limen-mcp

# Copy the volume data
docker run --rm -v limen-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/limen-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restart
docker compose start limen-mcp
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LIMEN_DATA_DIR` | `/data` | SQLite data directory inside container |
| `LIMEN_MASTER_KEY_PATH` | `/run/secrets/master_key` | Path to master key file inside container |
| `LIMEN_MASTER_KEY` | (none) | Hex-encoded master key (overrides file) |
| `LIMEN_MASTER_KEY_FILE` | `./master.key` | Host path to master key file |
| `NODE_ENV` | `production` | Node.js environment |
| `PROMETHEUS_PORT` | `9090` | Prometheus external port |
| `GRAFANA_PORT` | `3000` | Grafana external port |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana admin password |
