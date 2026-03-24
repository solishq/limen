# limen-a2a

[Google Agent-to-Agent Protocol](https://google.github.io/A2A/) server for the [Limen](https://github.com/solishq/limen) Cognitive OS.

## Install

```bash
npm install -g limen-a2a
```

## Usage

```bash
# Start the A2A server (default port 41000)
limen-a2a

# Custom port
limen-a2a --port 8080

# Or via environment variable
LIMEN_A2A_PORT=8080 limen-a2a
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/.well-known/agent.json` | Agent Card (discovery) |
| `POST` | `/` | JSON-RPC 2.0 handler |

## JSON-RPC Methods

- `tasks/send` — Submit a task to the Limen engine
- `tasks/get` — Retrieve task status and results
- `tasks/cancel` — Cancel a running task

## Configuration

The server reads `~/.limen/config.json` for engine configuration (data directory, master key, providers).

## License

Apache-2.0
