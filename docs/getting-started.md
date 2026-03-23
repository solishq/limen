# Getting Started with Limen

This guide walks you through installing Limen, making your first LLM call, and exploring the key features.

---

## Prerequisites

- Node.js >= 22
- An API key from at least one LLM provider (Anthropic, OpenAI, Gemini, Groq, Mistral) or a local Ollama instance

---

## Installation

```bash
npm install @solishq/limen
```

That's it. One production dependency (`better-sqlite3`). No provider SDKs.

---

## 1. Your First Chat

```typescript
import { createLimen } from '@solishq/limen';
import crypto from 'node:crypto';

const limen = await createLimen({
  dataDir: './my-app-data',
  masterKey: crypto.randomBytes(32),
  providers: [{
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  }],
});

const response = limen.chat('Hello, world!');
console.log(await response.text);
await limen.shutdown();
```

Run it:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx app.ts
```

`createLimen()` creates an engine instance with a local SQLite database, configures encryption, and registers your providers. The returned object is deeply frozen and immutable.

> **Note**: `crypto.randomBytes(32)` generates a new key on every restart. In production, persist your master key. See the [Master Key Management](../README.md) section in the README.

---

## 2. Streaming

```typescript
const streamed = limen.chat('Explain emergence in three sentences.');
for await (const chunk of streamed.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}
```

Streaming and non-streaming produce identical final results (Invariant I-26).

---

## 3. Structured Output

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

---

## 4. Sessions

Sessions maintain conversation history across turns, scoped to a tenant and agent.

```typescript
import type { TenantId } from '@solishq/limen';

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

---

## 5. Multiple Providers

Configure multiple providers and let Limen route between them.

```typescript
const limen = await createLimen({
  dataDir: './data',
  masterKey: Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex'),
  providers: [
    { type: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-20250514'], apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
    { type: 'openai', baseUrl: 'https://api.openai.com', models: ['gpt-4o'], apiKeyEnvVar: 'OPENAI_API_KEY' },
    { type: 'ollama', baseUrl: 'http://localhost:11434', models: ['llama3.2'] },
  ],
});

// Auto-routing
limen.chat('Hello', { routing: 'auto' });

// Explicit model
limen.chat('Hello', { routing: 'explicit', model: 'gpt-4o' });
```

---

## 6. Standalone Transport

If you only need reliable LLM communication (retry, circuit breakers, streaming safety) without the full engine:

```typescript
import { createTransportEngine, createAnthropicAdapterFromEnv } from '@solishq/limen/transport';

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

---

## 7. Health and Observability

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
- [Examples](../examples/) — Five runnable examples
