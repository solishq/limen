# Getting Started with Limen

This guide walks you through installing Limen, making your first LLM call, and exploring the key features.

---

## Prerequisites

- Node.js >= 22
- An API key from at least one LLM provider (Anthropic, OpenAI, Gemini, Groq, Mistral) or a local Ollama instance

---

## Installation

```bash
npm install limen-ai
```

That's it. One production dependency (`better-sqlite3`). No provider SDKs.

---

## Choose Your Path

### Demo (Learning and Prototyping)

Set one environment variable and call `createLimen()` with no arguments:

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();
console.log(await limen.chat('Hello, world!').text);
await limen.shutdown();
```

```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx app.ts
```

**What happens behind the scenes:**

1. **Provider auto-detection** — Limen scans for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, and `OLLAMA_HOST`. Every provider with a set env var is registered automatically. Set multiple keys and multi-provider routing works with zero configuration.
2. **Dev master key** — A 32-byte encryption key is auto-generated and persisted to `~/.limen/dev.key`. A stderr warning reminds you this is not for production.
3. **Temp data directory** — SQLite database goes to your OS temp directory (`/tmp/limen-dev` or equivalent). Data is ephemeral and cleaned on reboot.

The full governance layer (audit trail, RBAC, encryption, budget enforcement, circuit breakers) runs with zero-config, identical to production. The only differences are the key source and data persistence.

> **Warning**: Dev mode data is ephemeral (temp directory, cleared on reboot) and the dev key regenerates if `~/.limen/dev.key` is deleted. Do not use zero-config for data you need to keep.

See [examples/01-hello.ts](../examples/01-hello.ts), [examples/02-streaming.ts](../examples/02-streaming.ts), and [examples/03-structured-output.ts](../examples/03-structured-output.ts) for runnable zero-config examples.

---

### Production

For persistent data and managed encryption, provide explicit configuration:

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen({
  dataDir: '/var/lib/myapp/limen',
  masterKey: Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex'),
  providers: [{
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  }],
});
```

**Production checklist:**

- **Key management** — Generate a 32-byte key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and store it in your secrets manager. Set `LIMEN_MASTER_KEY` or `LIMEN_MASTER_KEY_FILE` env var. Never commit keys to source control.
- **Persistent storage** — Point `dataDir` to a durable filesystem path. Back it up. All engine state (SQLite databases, audit logs, session history) lives here.
- **Shutdown handler** — Always call `limen.shutdown()` on process exit. This flushes WAL, closes database connections, and cleans up resources. Register it on `SIGTERM`/`SIGINT`.
- **Monitoring** — Use `limen.health()` for readiness probes and `limen.metrics.snapshot()` for Prometheus-style metrics. Add a `logger` callback for structured event visibility.

See [Deployment Guide](./deployment.md) for the full production setup (filesystem requirements, Docker, environment variables, backup strategy).

See [Security Model](./proof/security-model.md) for the encryption, audit, RBAC, and transport security posture.

---

## Core Features

### Streaming

```typescript
const streamed = limen.chat('Explain emergence in three sentences.');
for await (const chunk of streamed.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}
```

Streaming and non-streaming produce identical final results (Invariant I-26).

### Structured Output

Get typed, validated JSON from any LLM. Limen validates against your JSON Schema and retries on validation failure.

```typescript
const result = await limen.infer({
  input: 'List the top 3 programming languages',
  outputSchema: {
    type: 'object',
    properties: {
      languages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['name', 'reason'],
        },
      },
    },
    required: ['languages'],
  },
  maxRetries: 2,
});

console.log(result.data.languages); // Typed and validated
```

### Sessions

Sessions maintain conversation history across turns, scoped to a tenant and agent.

```typescript
import type { TenantId } from 'limen-ai';

const session = await limen.session({
  agentName: 'researcher',
  tenantId: 'acme-corp' as TenantId,
  user: { id: 'user-1', role: 'analyst' },
});

session.chat('What were the major AI trends in 2025?');
session.chat('Which has the strongest moat?'); // Remembers prior turn
session.chat('Compare to 2020.');              // Full context available

const turns = await session.history();
await session.close();
```

When the context window fills, Limen automatically summarizes earlier turns to make room.

### Multiple Providers

Zero-config handles multi-provider automatically — set multiple API key env vars and Limen detects all of them. Use routing options to control provider selection:

```typescript
// Auto-routing: engine picks the best available provider
limen.chat('Hello', { routing: 'auto' });

// Explicit model selection
limen.chat('Hello', { routing: 'explicit', model: 'gpt-4o' });
```

See [examples/04-multi-provider.ts](../examples/04-multi-provider.ts) for the full example.

### Standalone Transport

If you only need reliable LLM communication (retry, circuit breakers, streaming safety) without the full engine:

```typescript
import { createTransportEngine, createAnthropicAdapterFromEnv } from 'limen-ai/transport';

const engine = createTransportEngine();
const adapter = createAnthropicAdapterFromEnv();

const result = await engine.execute(adapter, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});

engine.shutdown();
```

### Health and Observability

```typescript
const health = await limen.health();
console.log(health.status);      // 'healthy' | 'degraded' | 'unhealthy'
console.log(health.subsystems);  // Per-subsystem breakdown

const metrics = limen.metrics.snapshot();
console.log(metrics.limen_requests_total);
console.log(metrics.limen_tokens_cost_usd);
```

---

## Next Steps

- [Provider Cookbook](./providers.md) — All six providers, routing, standalone transport
- [Error Codes](./error-codes.md) — Complete error reference
- [Security Model](./security-model.md) — Encryption, audit, RBAC, transport security
- [Mission System](./missions.md) — Autonomous agent execution with governance
- [Examples](../examples/) — Eight runnable examples
