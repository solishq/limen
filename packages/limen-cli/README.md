# limen-cli

JSON-first command-line interface for the [Limen](https://github.com/solishq/limen) Cognitive OS.

The CLI is a thin, auditable shell around the `limen-ai` engine. Every command
produces valid JSON on stdout and structured JSON errors on stderr so it can be
piped into other tools, scripts, or agents without custom parsing.

## Install

```bash
npm install -g limen-cli
```

Requires `limen-ai` as a peer — installed automatically.

## Quickstart

```bash
# 1. Initialize a Limen home (creates master key + config)
limen init

# 2. Store a belief
limen remember --subject "entity:user:alice" --predicate "preference.food" --value "loves Thai food"

# 3. Recall beliefs by subject
limen recall --subject "entity:user:alice"

# 4. Search full-text
limen search --query "Thai"

# 5. Connect two claims
limen connect --from <id1> --to <id2> --type supersedes

# 6. Retract a claim (audit-preserving)
limen forget --claimId <id1> --reason superseded
```

## Data Layout and Isolation

By default Limen stores everything under `~/.limen/`:

```
~/.limen/
  master.key     # 256-bit encryption key (mode 0600)
  config.json    # default paths
  data/          # SQLite database and WAL files
```

Use `--dataDir <path>` to run a fully-isolated Limen home somewhere else — for
per-project databases, CI runs, or ephemeral sandboxes. When you pass
`--dataDir` to `init`, the target directory is treated as a complete home:
`master.key`, `config.json`, and the database all live inside it.

```bash
# Create an isolated home for a project
limen --dataDir /tmp/project-limen init

# Subsequent commands against the same home
limen --dataDir /tmp/project-limen remember \
  --subject "entity:project:alpha" --predicate "status" --value "active"
```

When `--dataDir` is provided, the CLI auto-discovers `<dataDir>/master.key`
first, then falls back to a legacy `<dataDir>/../master.key` layout, and
finally to the config default. This preserves compatibility with pre-existing
setups that used `--dataDir` to point only at the data subdirectory.

## Global Options

| Option | Description |
|---|---|
| `--dataDir <path>` | Override the Limen home/data directory. Respected by `init` and every other command. |
| `--masterKey <path>` | Override the master key file path. |
| `--version` | Print CLI version. |
| `--help` | Show help text. Works on any subcommand. |

## JSON Output Contract

- Success: a single JSON value (object or array) on stdout, exit 0.
- Error: `{"error": {"code": "...", "message": "..."}}` on stderr, exit 1.
- The only exception is `limen context --format text`, which emits a raw text
  block on stdout (no JSON wrapping) so it can be piped directly into files.

Error codes follow two prefixes:
- `CLI_*` — validation failures caught in the CLI layer before the engine is invoked (e.g. `CLI_INVALID_CONFIDENCE`, `CLI_INVALID_JSON`, `CLI_DUAL_TARGET`).
- `CONV_*` / engine-specific codes — errors returned by the Limen engine (e.g. `CONV_CLAIM_NOT_FOUND`, `CONV_ALREADY_RETRACTED`).

---

## Commands

### Core

#### `limen init`
Initialize a Limen home. Generates a 256-bit master key (mode `0600`) and writes
a default `config.json`. Idempotent — never overwrites an existing master key.

```bash
limen init                                   # ~/.limen/
limen --dataDir /tmp/sandbox-limen init      # isolated home
```

Returns `{ initialized, home, dataDir, masterKeyPath, created, skipped }`.

#### `limen health`
Report engine health: providers, substrate, crypto, and subsystem status.

```bash
limen health
```

Returns a structured health object. Status `degraded` with a `providers`
subsystem note simply means no LLM keys are configured — unrelated to core
knowledge operations.

---

### Agent management

#### `limen agent register --name <name> [--domains <csv>] [--capabilities <csv>] [--systemPrompt <text>]`
Register a new agent in the A2A network.

#### `limen agent list`
List all agents registered for the current tenant.

#### `limen agent get --name <name>`
Fetch a single agent by name.

#### `limen agent promote --name <name>`
Promote an agent to the next trust level.

---

### Claim system (low-level)

#### `limen claim ...`
Low-level claim operations for direct access to the CCP surface. Most users
will prefer the knowledge commands below. See `limen claim --help` for the
full subcommand list.

---

### Working memory

#### `limen wm write --taskId <id> --key <key> --value <value>`
#### `limen wm read --taskId <id> [--key <key>]`
#### `limen wm discard --taskId <id> [--key <key>]`

Task-scoped working memory. Keys must be ≤ 256 chars without whitespace or
path separators. Omitting `--key` on `read`/`discard` targets the whole
namespace.

---

### Mission lifecycle

#### `limen mission create --agent <name> --objective <text> --budget <n> --deadline <iso>`
#### `limen mission list [--state <state>] [--limit <n>]`

Mission creation and listing. See `limen mission --help` for the full set.

---

### Knowledge (convenience API)

These are the high-level commands most agents and tooling consume. They map
to the Limen convenience API (`remember`, `recall`, `forget`, `connect`,
`reflect`, `search`, `recall-bulk`, `context`).

#### `limen remember`
Store a knowledge claim.

```bash
limen remember \
  --subject "entity:user:alice" \
  --predicate "preference.food" \
  --value "loves Thai food" \
  [--confidence 0.8] \
  [--reasoning "explicit statement"]
```

Required: `--subject` (URN `entity:<type>:<id>`), `--predicate` (`<domain>.<property>`), `--value` (max 500 chars).
Optional: `--confidence` (0.0–1.0), `--reasoning` (max 1000 chars).

Returns `{ claimId, confidence }`. If the engine caps the requested confidence
under its `maxAutoConfidence` ceiling (default 0.7 for non-grounded claims),
the response additionally includes `requestedConfidence`, `governed: true`,
and `governanceReason` so you know the value was governed:

```json
{
  "claimId": "9f6c…",
  "confidence": 0.7,
  "requestedConfidence": 0.9,
  "governed": true,
  "governanceReason": "maxAutoConfidence ceiling (0.7)"
}
```

Related: `limen recall`, `limen forget`.

#### `limen recall`
Retrieve beliefs with optional filters.

```bash
limen recall --subject "entity:user:alice"
limen recall --subject "entity:user:*"            # wildcard
limen recall --predicate "preference.*"           # predicate wildcard
limen recall --minConfidence 0.5 --limit 20
limen recall                                      # all knowledge claims
```

Optional flags: `--subject`, `--predicate`, `--minConfidence` (0.0–1.0),
`--limit` (1–1000), `--includeSuperseded`.

Returns an array of beliefs with `claimId`, `subject`, `predicate`, `value`,
`confidence`, `effectiveConfidence` (rounded to 4 decimals), time-based
`freshness` (`fresh` < 1h, `aging` < 24h, `stale` ≥ 24h), `disputed`,
`superseded`, and access metadata.

By default, bare `limen recall` (no filters) excludes `a2a.message` claims so
that chat messages do not leak into your knowledge view. Pass
`--predicate "a2a.message"` (or any `a2a.*` prefix) to include them explicitly.

Related: `limen remember`, `limen search`, `limen context`, `limen forget`.

#### `limen forget`
Retract a claim. The claim is preserved with `status = "retracted"` for audit
continuity; relationships survive.

```bash
limen forget --claimId <id> [--reason incorrect|superseded|expired|manual]
```

Returns `{ retracted: true, claimId }`. On a recall after `forget`, any
previously-disputed counterpart is automatically re-evaluated: if the only
contradictor was retracted, `disputed` flips back to `false`.

Related: `limen recall`, `limen connect`.

#### `limen connect`
Create a directed relationship between two claims.

```bash
limen connect --from <claimId1> --to <claimId2> --type supports|contradicts|supersedes|derived_from
```

Returns `{ connected: true, from, to, type }`.

#### `limen reflect`
Batch-store categorized learnings in a single all-or-nothing transaction. Each
entry becomes a claim with predicate `reflection.<category>`.

```bash
limen reflect --entries '[
  {"category":"finding","statement":"Test runner blocks on SIGPIPE","confidence":0.85},
  {"category":"warning","statement":"Do not bypass the deploy gate"}
]'

# Or from a file
limen reflect --file learnings.json
```

Categories: `decision | pattern | warning | finding`.
Statements: ≤ 500 chars. Up to 100 entries per call.

Returns `{ stored, claimIds }`. Invalid JSON surfaces as `CLI_INVALID_JSON`.

#### `limen search`
Full-text search over claim content (FTS5 + BM25, ranked by a combined score).

```bash
limen search --query "lazy dog"
limen search --query "policy" --minConfidence 0.5 --limit 10
```

Returns an array of `{ belief, score }` where `score` is normalized so higher
is better. The raw BM25 `relevance` field is intentionally NOT exposed — it
was confusing for users (negative numbers).

Related: `limen recall`, `limen context`.

#### `limen recall-bulk`
Recall beliefs for multiple subjects in one call. Fewer round-trips for agents
that fan out over a subject set.

```bash
limen recall-bulk --subjects "entity:user:alice,entity:user:bob"
limen recall-bulk --subjects '["entity:user:alice","entity:user:bob"]'
```

Accepts comma-separated or JSON array format. Max 50 subjects per call. Returns
an array of `{ subject, beliefs[] }` grouped by input subject.

#### `limen context`
Generate a knowledge summary tailored for injection into an LLM system prompt.

```bash
# Default: raw text (pipeable into files)
limen context --subject "entity:project:alpha" --format text > project-context.txt

# JSON array of processed beliefs
limen context --subject "entity:project:alpha" --format json
```

Flags: `--subject`, `--predicate`, `--minConfidence`, `--limit` (1–100),
`--format text|json` (default `text`).

`--format text` emits a Markdown-style knowledge summary directly to stdout.
It is deliberately NOT wrapped in JSON — this is the one command whose text
format prints raw text so it can be piped into files or other tools without
`jq -r`. `--format json` emits the processed belief array.

Related: `limen recall`, `limen search`.

---

### Agent-to-Agent (A2A) messaging

A2A messages are stored as claims with predicate `a2a.message`. Messaging and
knowledge share the same substrate but are presented as separate surfaces:
bare `limen recall` does NOT return `a2a.message` claims (see above).

Sender identity in A2A is self-declared. Any agent name used in `a2a-send` is
auto-registered if it does not already exist, so it shows up in `a2a-presence`.
Explicit registration via `limen agent register` is still supported and lets
you pre-set capabilities, domains, and trust level.

#### `limen a2a-send`
Send a message to a channel or direct message.

```bash
# Channel message
limen a2a-send --from "femi" --channel "general" --message "hello team" \
  [--mentions "codex,claude-code"]

# Direct message
limen a2a-send --from "femi" --to "codex" --message "ping"
```

Exactly one of `--to` or `--channel` is required. Sender, recipient, channel,
and mention names must each be 1–64 chars of `[a-zA-Z0-9_-]`. Message max
length is 2000 chars. Returns `{ sent, target, sender, claimId, transport: "cli" }`.

#### `limen a2a-read`
Read messages from a channel or DM thread.

```bash
limen a2a-read --channel "general" [--limit 20] [--since <iso>] [--agent-id <name>]
limen a2a-read --me "femi" --from "codex"
```

For a DM, pass `--me <yourname> --from <other>`. DMs are transparent — any
agent can read any thread. Messages are returned chronologically.

#### `limen a2a-channels`
List active channels and DM threads with last activity.

#### `limen a2a-presence`
List registered agents with trust level, domains, and capabilities. Supports
`--agent-id <name>` to filter to a single agent and `--channel <name>` to
restrict to agents who have sent to that channel.

---

### Cognitive health

#### `limen health-cognitive`
Comprehensive cognitive report: total claims, freshness distribution,
unresolved conflicts, confidence statistics, knowledge gaps, and stale domains.
This is the fastest way to understand the state of a Limen instance.

```bash
limen health-cognitive
```

---

## Error Handling

Every validation failure produces a JSON error on stderr with exit code 1:

```json
{
  "error": {
    "code": "CLI_INVALID_CONFIDENCE",
    "message": "--confidence must be in range [0.0, 1.0]"
  }
}
```

Every `CLI_*` code emitted by the CLI source is listed here. This table is
cross-referenced against the source by the loopback audit (F-BR4-010) — if
the code shows up in `src/` it must appear here.

| Code | When |
|---|---|
| `CLI_USAGE` | Commander-level errors: missing required option, unknown command/option |
| `CLI_FATAL` | Unhandled internal error |
| `CLI_INVALID_CONFIDENCE` | Confidence out of range or not a number (`remember`, `recall`, `recall-bulk`, `context`) |
| `CLI_INVALID_VALUE` | Empty / over-length `--value` (`remember`) |
| `CLI_INVALID_LIMIT` | `--limit` not a positive integer (`recall`, `recall-bulk`, `search`, `context`, `a2a-read`) |
| `CLI_INVALID_QUERY` | Empty `--query` (`search`) |
| `CLI_INVALID_FORMAT` | Unknown `--format` (must be `text` or `json`, `context`) |
| `CLI_INVALID_JSON` | `reflect --entries` or `recall-bulk --subjects` JSON is malformed |
| `CLI_INVALID_DATADIR` | `--dataDir` is empty/whitespace (`init`) |
| `CLI_DATADIR_NOT_DIRECTORY` | `--dataDir` points at an existing non-directory path (F-BR4-008, `init`) |
| `CLI_UNINITIALIZED_DATADIR` | `--dataDir` has no `master.key` yet — run `limen --dataDir <path> init` (F-BR4-001, bootstrap) |
| `CLI_MASTER_KEY_NOT_FOUND` | Explicit `--masterKey` path or default home key missing (bootstrap) |
| `CLI_DUAL_TARGET` / `CLI_NO_TARGET` | `a2a-send` / `a2a-read` target mis-specified |
| `CLI_INVALID_SENDER` / `CLI_INVALID_RECIPIENT` / `CLI_INVALID_CHANNEL` / `CLI_INVALID_MENTION` / `CLI_INVALID_AGENT_ID` | A2A name validation |
| `CLI_INVALID_TIMESTAMP` | Invalid `--since` value (`a2a-read`) |
| `CLI_INVALID_METADATA` | Invalid JSON in `--metadata` (`a2a-send`) |
| `CLI_INVALID_MESSAGE` | `a2a-send --message` empty or exceeds 2000 characters |
| `CLI_INVALID_SUBJECTS` | `recall-bulk --subjects` empty, > 50, or invalid shape |
| `CLI_INVALID_TYPE` | `connect --type` not in allowed set |
| `CLI_INVALID_REASON` | `forget --reason` not in allowed set |
| `CLI_INVALID_GAP_THRESHOLD` | `health-cognitive --gapThresholdDays` invalid |
| `CLI_INVALID_STALE_THRESHOLD` | `health-cognitive --staleThresholdDays` invalid |
| `CLI_INVALID_MAX_CONFLICTS` | `health-cognitive --maxCriticalConflicts` invalid |
| `CLI_INVALID_MAX_GAPS` | `health-cognitive --maxGaps` invalid |
| `CLI_INVALID_MAX_STALE` | `health-cognitive --maxStaleDomains` invalid |
| `CLI_MISSING_ENTRIES` / `CLI_DUAL_ENTRIES` | `reflect` missing/conflicting source |
| `CLI_FILE_READ_ERROR` | `reflect --file` could not be read |
| `CONV_CLAIM_NOT_FOUND` | Engine could not find the referenced claim |
| `CONV_ALREADY_RETRACTED` | Claim already retracted |

Warnings (non-fatal, written to stderr alongside the success payload):

| Code | When |
|---|---|
| `CLI_AGENT_AUTOREGISTER_FAILED` | `a2a-send` attempted to auto-register the sender and the engine rejected the register call. Message send still proceeds. (F-BR4-005) |

## License

Apache-2.0
