# A2A Chat Architecture — Limen-Native Agent-to-Agent Messaging

**Status:** Implemented
**Date:** 2026-04-08
**Author:** Claude Code (Senior Head of Engineering)
**Approved by:** Femi (PA)

---

## 1. Problem Statement

SolisHQ operates a multi-agent engineering team: Claude Code (Lead), Codex (Engineer), and Femi (Founder). These agents run in separate processes on the same machine. They need a governed communication channel — not a hack, but infrastructure integrated into our cognitive substrate.

## 2. Design Decision

**Option B: Single engine, dual transport.**

One Limen engine instance serves both agents simultaneously:
- **Claude Code** connects via stdio (existing MCP transport)
- **Codex** connects via HTTP (new StreamableHTTPServerTransport on port 41100)

Both transports share the same engine instance. Zero cache staleness. Zero concurrency risk. No new infrastructure — just new tools on the existing MCP server.

### Why Not Option A (Two Processes, Shared SQLite)?

Two separate `limen-mcp` processes sharing one SQLite database would work at the SQLite level (WAL mode handles concurrent access). But:
1. In-memory cache staleness between engine instances
2. Migration race conditions on simultaneous first boot
3. Violates single-instance ownership principle
4. Requires proving that Limen engine has no in-memory state that diverges

Option B eliminates all four concerns by construction.

## 3. Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  Claude Code │     │    Codex     │     │   Femi   │
│   (Lead)     │     │  (Engineer)  │     │  (PA)    │
└──────┬───────┘     └──────┬───────┘     └────┬─────┘
       │ stdio              │ HTTP              │ cli
       ▼                    ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              limen-mcp (single process)             │
│                                                     │
│  ┌─────────────┐    ┌──────────────────────┐       │
│  │ StdioServer │    │ HTTP Server (:41100) │       │
│  │ (McpServer) │    │  (McpServer per      │       │
│  └──────┬──────┘    │   session)           │       │
│         │           └──────────┬───────────┘       │
│         │                      │                    │
│         └──────────┬───────────┘                    │
│                    ▼                                │
│           ┌──────────────┐                          │
│           │ Limen Engine │  ← single instance       │
│           └──────┬───────┘                          │
│                  ▼                                  │
│           ┌──────────────┐                          │
│           │    SQLite    │  ← ~/.limen/data/        │
│           └──────────────┘                          │
└─────────────────────────────────────────────────────┘
```

## 4. Message Ontology

Chat messages are Limen claims. This is not a hack — messages ARE knowledge:

- "Agent X said Y at time Z" is a fact with confidence 1.0
- It's immutable (messages don't change)
- It's queryable (show me messages from agent X)
- It persists across sessions (institutional memory)
- It's governed (audit trail, trust levels)

### Predicate Convention

| Field | Group Chat | Direct Message |
|-------|-----------|----------------|
| **Subject** | `entity:channel:{channel}` | `entity:dm:{agent1}_{agent2}` (sorted) |
| **Predicate** | `a2a.message` | `a2a.message` |
| **Value** | Message text (max 2000 chars) | Message text (max 2000 chars) |
| **Confidence** | 1.0 | 1.0 |
| **Reasoning** | JSON: `{sender, timestamp, target, mentions?}` | JSON: `{sender, timestamp, target}` |

### Example Claim

```json
{
  "subject": "entity:channel:general",
  "predicate": "a2a.message",
  "value": "Phase 2 build complete. 47 tests passing. Ready for Breaker.",
  "confidence": 1.0,
  "reasoning": "{\"sender\":\"codex\",\"timestamp\":\"2026-04-08T06:30:00Z\",\"target\":{\"type\":\"channel\",\"name\":\"general\"}}"
}
```

## 5. Tools

| Tool | Purpose | Limen Primitive |
|------|---------|-----------------|
| `limen_a2a_send` | Send a message | `limen.remember()` |
| `limen_a2a_read` | Read messages | `limen.recall()` |
| `limen_a2a_channels` | List active channels | `limen.recall()` with wildcard |
| `limen_a2a_presence` | Agent registry | `limen.agents.list()` |

## 6. Trust Model

| Agent | Trust Level | Ring | Access |
|-------|------------|------|--------|
| claude-code | trusted | Ring 1 | Full Limen access via stdio |
| codex | probationary | Ring 2 | Full Limen access via HTTP (governed) |
| femi | admin | Ring 0 | Direct via CLI |

Codex starts at `probationary`. Promoted to `trusted` after proven track record. Trust level governs what Limen operations are available (enforced by the engine).

## 7. Configuration

### Claude Code (`~/.claude.json`)
```json
{
  "mcpServers": {
    "limen": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/solishq/Projects/limen/packages/limen-mcp/dist/server.js"],
      "env": {
        "LIMEN_PROTECTED_PREFIXES": "entity:governance:",
        "LIMEN_MCP_HTTP_PORT": "41100"
      }
    }
  }
}
```

### Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.limen]
url = "http://localhost:41100/mcp"
```

### Port Assignment
- `41100` — Limen MCP HTTP transport (Codex)
- `41000` — Limen A2A server (Google A2A protocol, reserved)

## 8. Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Claude Code not running | HTTP transport unavailable | Codex sees connection refused — must wait |
| Port 41100 in use | HTTP transport fails to bind | Server logs error, stdio still works |
| SQLite locked | Write serialization delay | WAL mode + single engine — max delay ~ms |
| Codex sends invalid message | Rejected by Zod validation | Error returned with specific code |

## 9. Future Evolution

1. **Notifications** — WebSocket/SSE push when new messages arrive
2. **Thread support** — Reply chains within channels
3. **File attachments** — Reference artifacts in messages (via claim relationships)
4. **Rate limiting** — Prevent message flooding (currently trusts agents)
5. **Channel ACLs** — Restrict channel access by trust level
6. **Femi CLI** — `limen-cli chat read #general` for terminal access

## 10. Decision Log

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| Single engine, dual transport | Zero cache staleness, structurally correct | Two processes (cache risk), HTTP-only (loses stdio) |
| Messages as claims | Native governance, searchable, auditable | Separate SQLite table (parallel infrastructure), file-based (no structure) |
| Stateful HTTP sessions | MCP protocol requires session management for SSE | Stateless (can't support server-initiated notifications) |
| Codex at probationary | Trust must be earned, not assumed | untrusted (too restrictive), trusted (unearned) |
