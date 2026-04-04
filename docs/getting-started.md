# Getting Started with Limen

Limen is a governed knowledge store for AI agents. This guide walks you through storing and recalling knowledge, then optionally connecting an LLM provider.

---

## Prerequisites

- Node.js >= 22

An LLM provider API key is **not required** for knowledge operations (`remember`, `recall`, `search`, `forget`, `reflect`). You only need a provider key if you want to use `chat()`, `infer()`, or `session()`.

---

## Installation

```bash
npm install limen-ai
```

One production dependency (`better-sqlite3`). No provider SDKs.

---

## Your First Knowledge Operations

No API key. No provider. Just structured knowledge with governance.

```typescript
import { createLimen, resolveMasterKey } from 'limen-ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'limen-quickstart-'));

const limen = await createLimen({
  dataDir,
  masterKey: resolveMasterKey(),
});

// Store beliefs
limen.remember('entity:user:alice', 'preference.food', 'loves Thai food');
limen.remember('entity:user:alice', 'role.team', 'backend engineer');
limen.remember('entity:project:alpha', 'finding.performance', 'API latency under 50ms at P99');

// Recall by subject
const beliefs = limen.recall('entity:user:alice');
if (beliefs.ok) {
  for (const b of beliefs.value) {
    console.log(`${b.predicate}: ${b.value} (confidence: ${b.effectiveConfidence.toFixed(2)})`);
  }
}

// Full-text search across all knowledge
const results = limen.search('latency');
if (results.ok) {
  for (const r of results.value) {
    console.log(`${r.belief.subject}: ${r.belief.value}`);
  }
}

// Soft-delete a belief (retracted, not destroyed)
if (beliefs.ok && beliefs.value.length > 0) {
  limen.forget(beliefs.value[0].claimId, 'manual');
}

await limen.shutdown();
rmSync(dataDir, { recursive: true, force: true });
```

```bash
npx tsx app.ts
```

See [examples/knowledge/](../examples/knowledge/) for the full knowledge track: remember/recall, search/decay, and governance.

**What happens behind the scenes:**

1. **Dev master key** -- `resolveMasterKey()` auto-generates a 32-byte encryption key and persists it to `~/.limen/dev.key`. A stderr warning reminds you this is not for production.
2. **Full governance** -- The entire governance layer (audit trail, RBAC, encryption, conflict detection) runs with zero-config, identical to production.
3. **FSRS decay** -- Beliefs lose effective confidence over time. Frequently accessed beliefs stay fresh; neglected ones decay.

> **Warning**: Dev mode data is ephemeral (temp directory, cleared on reboot) and the dev key regenerates if `~/.limen/dev.key` is deleted. Do not use this for data you need to keep.

---

## Adding LLM Chat (Optional)

If you want LLM capabilities, set an API key environment variable and Limen auto-detects the provider:

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();
console.log(await limen.chat('What is quantum computing?').text);
await limen.shutdown();
```

```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx app.ts
```

**Provider auto-detection** -- Limen scans for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, and `OLLAMA_HOST`. Every provider with a set env var is registered automatically. Set multiple keys and multi-provider routing works with zero configuration.

See [examples/llm-gateway/](../examples/llm-gateway/) for the full LLM track: hello, streaming, structured output, multi-provider, sessions, and missions.

---

## Production Configuration

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

- **Key management** -- Generate a 32-byte key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and store it in your secrets manager. Set `LIMEN_MASTER_KEY` or `LIMEN_MASTER_KEY_FILE` env var. Never commit keys to source control.
- **Persistent storage** -- Point `dataDir` to a durable filesystem path. Back it up. All engine state (SQLite databases, audit logs, session history) lives here.
- **Shutdown handler** -- Always call `limen.shutdown()` on process exit. This flushes WAL, closes database connections, and cleans up resources. Register it on `SIGTERM`/`SIGINT`.
- **Monitoring** -- Use `limen.health()` for readiness probes and `limen.metrics.snapshot()` for Prometheus-style metrics. Add a `logger` callback for structured event visibility.

See [Deployment Guide](./deployment.md) for the full production setup (filesystem requirements, Docker, environment variables, backup strategy).

See [Security Model](./proof/security-model.md) for the encryption, audit, RBAC, and transport security posture.

---

## Core Concepts

Read [CONCEPTS.md](./CONCEPTS.md) for a deeper explanation of:

- **Subject URN format** -- `entity:<type>:<id>`
- **Predicate format** -- `domain.property`
- **Belief vs Claim** -- convenience API vs claim protocol
- **Confidence model** -- auto-extracted ceiling, FSRS decay
- **Retraction** -- soft delete, not hard delete
- **Result pattern** -- always check `.ok` before using

---

## Next Steps

- [CONCEPTS.md](./CONCEPTS.md) -- Core concepts (subject URNs, confidence, decay, retraction)
- [Provider Cookbook](./providers.md) -- All six providers, routing, standalone transport
- [Error Codes](./error-codes.md) -- Complete error reference
- [Security Model](./security-model.md) -- Encryption, audit, RBAC, transport security
- [Mission System](./missions.md) -- Autonomous agent execution with governance
- [Examples](../examples/) -- Knowledge, LLM gateway, and advanced tracks
