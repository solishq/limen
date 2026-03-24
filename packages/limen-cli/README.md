# limen-cli

JSON-first command-line interface for the [Limen](https://github.com/solishq/limen) Cognitive OS.

## Install

```bash
npm install -g limen-cli
```

Requires `limen-ai` as a peer — installed automatically.

## Usage

```bash
# Initialize a Limen data directory
limen init --dataDir ./my-project

# Check engine health
limen health --dataDir ./my-project

# Register an agent
limen agent register --name "my-agent" --dataDir ./my-project

# Create a mission
limen mission create --goal "Analyze dataset" --agentId <id> --dataDir ./my-project
```

Every command writes valid JSON to stdout. Errors go to stderr as JSON.

## Global Options

| Option | Description |
|---|---|
| `--dataDir <path>` | Override data directory |
| `--masterKey <path>` | Override master key file path |

## Commands

- `limen init` — Initialize data directory and master key
- `limen health` — Engine health status
- `limen agent` — Agent registration and management
- `limen claim` — Knowledge claim operations
- `limen wm` — Working memory read/write/discard
- `limen mission` — Mission lifecycle management

## License

Apache-2.0
