<p align="center">
  <img src="docs/assets/banner.svg" alt="Limen" width="700">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/limen-ai"><img src="https://img.shields.io/npm/v/limen-ai" alt="npm version"></a>
  <a href="https://github.com/solishq/limen/actions"><img src="https://img.shields.io/github/actions/workflow/status/solishq/limen/ci.yml?branch=main" alt="CI"></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js"></a>
  <img src="https://img.shields.io/badge/Dependencies-1-green" alt="Dependencies">
</p>

---

# Limen

A governed knowledge engine for AI agents. Beliefs, not data.

```
npm install limen-ai
```

## Quickstart

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();

// Store a belief
limen.remember('entity:user:alice', 'preference.food', 'loves Thai food');

// Recall what you know
const beliefs = limen.recall('entity:user:alice');
if (beliefs.ok) {
  console.log(beliefs.value[0].value);            // "loves Thai food"
  console.log(beliefs.value[0].confidence);        // 0.7 (governed ceiling)
  console.log(beliefs.value[0].effectiveConfidence); // decays over time
}

// Search across all knowledge
const results = limen.search('Thai');
if (results.ok) {
  console.log(results.value[0].belief.value);  // "loves Thai food"
  console.log(results.value[0].score);         // relevance * confidence
}

await limen.shutdown();
```

`createLimen()` with no arguments auto-detects providers, generates a dev encryption key, and provisions a local SQLite database. Copy, paste, run.

## Why Limen

AI agents accumulate knowledge, but most systems store it as flat data -- key-value pairs, vector embeddings, chat history. Knowledge is not data. Knowledge is belief: it has confidence, it decays without reinforcement, it can be contradicted, retracted, and traced back to evidence. Limen treats knowledge this way. Every belief has a confidence score, a temporal anchor, a decay curve, and a governed lifecycle. The engine does not store facts. It manages beliefs.

## Core API

| Method | Description |
|---|---|
| `remember(subject, predicate, value, options?)` | Store a belief with confidence and temporal anchoring |
| `remember(text, options?)` | Store a free-text observation (auto-generates subject) |
| `recall(subject?, predicate?, options?)` | Retrieve beliefs, filtered by subject/predicate |
| `search(query, options?)` | Full-text search across all beliefs (FTS5 + BM25) |
| `forget(claimId, reason?)` | Retract a belief (governed, audited, never deleted) |
| `connect(claimId1, claimId2, type)` | Relate beliefs: `supports`, `contradicts`, `supersedes`, `derived_from` |
| `reflect(entries)` | Batch-store categorized learnings (decisions, patterns, warnings, findings) |
| `promptInstructions()` | Get system prompt text teaching agents how to use Limen |
| `cognitive.health(config?)` | Knowledge health report: freshness, conflicts, gaps, stale domains |

## Beliefs That Breathe

Beliefs decay without reinforcement. Limen uses the FSRS power-decay formula: `R(t) = (1 + t/(9*S))^-1`, where `S` is stability in days (governance claims: 365d, findings: 90d, ephemeral: 7d).

```typescript
// A belief stored 60 days ago with stability=90d (finding)
limen.remember('entity:project:limen', 'finding.performance', 'FTS5 queries <5ms at 10K claims');

// 60 days later, recall shows decay
const beliefs = limen.recall('entity:project:limen');
if (beliefs.ok) {
  const b = beliefs.value[0];
  console.log(b.confidence);          // 0.7  (original, governed ceiling)
  console.log(b.effectiveConfidence);  // 0.57 (after 60d decay with S=90)
  console.log(b.freshness);           // "stale" | "aging" | "fresh"
}
```

Effective confidence is computed at query time. Nothing is stored. Recall always reflects the current state of belief.

## Safety and Governance

Limen contains wrongness by default. Auto-extracted claims are capped at 0.7 confidence -- the `maxAutoConfidence` ceiling prevents confidence laundering. Structural conflict detection flags contradictions. Cascade retraction penalizes downstream beliefs when a source is retracted.

```typescript
// Wrongness containment: confidence is capped
const r = limen.remember('entity:market:ev', 'size.2025', '$45B', { confidence: 0.95 });
console.log(r.ok && r.value.confidence); // 0.7 (capped, not 0.95)

// Conflict detection: contradictions are automatic
limen.remember('entity:market:ev', 'size.2025', '$52B');
// ^ creates a 'contradicts' relationship with the first claim

// Cascade retraction: derived beliefs are penalized
const health = limen.cognitive.health();
if (health.ok) {
  console.log(health.value.conflicts.unresolved); // 1 active conflict
  console.log(health.value.freshness);             // { fresh: N, aging: N, stale: N }
}
```

## Under the Hood

16 system calls. 134 invariants across 3 tiers. 3,400+ tests. 1 production dependency (`better-sqlite3`). Every state mutation is audited in a hash-chained, append-only trail. RBAC on every operation. AES-256-GCM encryption at rest. Tenant isolation at row or database level.

The governance layer runs whether you configure it or not. The difference between the quickstart and production is explicit configuration -- not a different code path.

Full trust surface with file-and-line evidence: [docs/proof/readiness.md](docs/proof/readiness.md).

## Configuration

All fields are optional when calling `createLimen()` with no arguments (zero-config mode).

| Option | Type | Default | Description |
|---|---|---|---|
| `dataDir` | `string` | OS temp dir | Where all engine state lives |
| `masterKey` | `Buffer` | Auto-generated | AES-256-GCM encryption key (>= 32 bytes) |
| `providers` | `ProviderConfig[]` | Auto-detected | LLM provider configurations |
| `tenancy.mode` | `'single' \| 'multi'` | `'single'` | Tenancy model |
| `tenancy.isolation` | `'row-level' \| 'database'` | `'row-level'` | Multi-tenant isolation strategy |
| `cognitive.maxAutoConfidence` | `number` | `0.7` | Confidence ceiling for auto-extracted claims |
| `autoConflict` | `boolean` | `true` | Structural conflict detection on assertion |
| `requireRbac` | `boolean` | `false` | Enforce RBAC on all operations |
| `defaultTimeoutMs` | `number` | `60000` | Chat/infer timeout (ms) |
| `rateLimiting.apiCallsPerMinute` | `number` | `100` | API rate limit |
| `failoverPolicy` | `'degrade' \| 'allow-overdraft' \| 'block'` | `'degrade'` | Provider failure behavior |
| `logger` | `(event) => void` | No-op | Structured logging callback |

## Installation Troubleshooting

Limen depends on `better-sqlite3`, which requires native C++ compilation.

**Windows without Visual Studio Build Tools:**
```bash
npm install --global windows-build-tools   # or install Visual Studio Build Tools manually
npm install limen-ai
```

**Docker slim / Alpine Linux (musl):**
```dockerfile
# Alpine: install build dependencies
RUN apk add --no-cache python3 make g++
RUN npm install limen-ai

# Debian slim: install build-essential
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install limen-ai
```

**Node.js version:** Limen requires Node.js >= 22. Check with `node --version`.

**CI environments (GitHub Actions, etc.):**
```yaml
# GitHub Actions: Node.js 22 is required
- uses: actions/setup-node@v4
  with:
    node-version: '22'
```

If `npm install` fails with `node-gyp` errors, ensure a C++ toolchain is available. On macOS: `xcode-select --install`. On Linux: `apt install build-essential` or `yum groupinstall "Development Tools"`.

## Architecture

```
API Surface       createLimen(), remember(), recall(), search(), cognitive.health()
Orchestration     Missions, task graphs, budgets, 16 system calls
Substrate         LLM gateway, transport engine, worker pool
Kernel            SQLite (WAL), audit trail, RBAC, crypto, events
```

Layers depend downward only. The kernel knows nothing about AI. The API composes everything into a single frozen `Limen` object.

## License

[Apache License 2.0](LICENSE)

---

<p align="center">Built by <a href="https://solishq.ai">SolisHQ</a></p>
