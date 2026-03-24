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
      "command": "limen-mcp",
      "env": {
        "LIMEN_DATA_DIR": "/path/to/data",
        "LIMEN_MASTER_KEY": "/path/to/master.key"
      }
    }
  }
}
```

## Tools

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

## Resources

| URI | Description |
|---|---|
| `limen://health` | Health status JSON |

## License

Apache-2.0
