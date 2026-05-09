<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# limen-mcp

[Model Context Protocol](https://modelcontextprotocol.io/) server for the [Limen](https://github.com/solishq/limen) Cognitive OS. Native integration with Claude Code.

## Install

```bash
npm install -g limen-mcp
```

## Usage

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "limen": {
      "command": "limen-mcp"
    }
  }
}
```

The server reads configuration from `~/.limen/config.json` (created by `limen init` from the CLI package). If no config exists, it uses defaults:

- **Data directory:** `~/.limen/data`
- **Master key:** `~/.limen/master.key`

To initialize, install the CLI and run `limen init`:

```bash
npm install -g limen-cli
limen init
```

For HTTP transport (e.g., Codex integration), set `LIMEN_MCP_HTTP_PORT`:

```json
{
  "mcpServers": {
    "limen": {
      "command": "limen-mcp",
      "env": {
        "LIMEN_MCP_HTTP_PORT": "3100"
      }
    }
  }
}
```

## Tools

### Core Tools

| Tool | Description |
|---|---|
| `limen_health` | Engine health status |
| `limen_agent_register` | Register a new agent |
| `limen_agent_list` | List all agents |
| `limen_agent_get` | Get agent by name |
| `limen_agent_promote` | Promote agent trust level |
| `limen_mission_create` | Create a mission |
| `limen_mission_list` | List missions |
| `limen_claim_assert` | Assert a knowledge claim |
| `limen_claim_query` | Query claims |
| `limen_wm_write` | Write to working memory |
| `limen_wm_read` | Read from working memory |
| `limen_wm_discard` | Discard from working memory |

### Context Tools

| Tool | Description |
|---|---|
| `limen_context_*` | Context governance — manage agent conversation context |

### Cognitive Tools

| Tool | Description |
|---|---|
| `limen_cognitive_health` | Knowledge health diagnostics — freshness, conflicts, gaps |
| `limen_cognitive_consolidate` | Merge duplicates, archive stale, suggest resolutions |
| `limen_cognitive_importance` | 5-factor composite importance scoring |
| `limen_cognitive_narrative` | Knowledge narrative — threads, themes, momentum |

### Search Tools

| Tool | Description |
|---|---|
| `limen_search` | Full-text and hybrid search across beliefs |
| `limen_semantic_search` | Vector-based semantic similarity search |

### Learning Tools

| Tool | Description |
|---|---|
| `limen_remember` | Store a belief or observation |
| `limen_recall` | Retrieve beliefs with decay applied |
| `limen_reflect` | Batch-store categorized learnings |

### A2A Chat Tools

| Tool | Description |
|---|---|
| `limen_a2a_chat_*` | Agent-to-agent chat messaging via Limen |

## Resources

| URI | Description |
|---|---|
| `limen://health` | Health status JSON |

## License

Apache-2.0
