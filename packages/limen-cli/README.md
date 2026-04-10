# limen-cli

JSON-first command-line interface for the [Limen](https://github.com/solishq/limen) Cognitive OS.

## Install

```bash
npm install -g limen-cli
```

Requires `limen-ai` as a peer — installed automatically.

## Usage

```bash
# Initialize ~/.limen/ directory with master key and default config
limen init

# Check engine health
limen health

# Register an agent
limen agent register --name "my-agent"

# Create a mission
limen mission create --agent "my-agent" --objective "Analyze dataset" --budget 100000 --deadline "2026-12-31T00:00:00Z"
```

All data is stored in `~/.limen/` by default. Override with `--dataDir` and `--masterKey` global options.

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
