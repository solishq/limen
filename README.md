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

Cognitive infrastructure for AI agents — beliefs that decay, governance that enforces, knowledge that heals itself.

```
npm install limen-ai
```

Optional, for semantic/vector search:

```
npm install sqlite-vec
```

## Quick Start

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();

limen.remember('entity:user:alice', 'preference.food', 'loves Thai food');

const beliefs = limen.recall('entity:user:alice');
if (beliefs.ok) {
  console.log(beliefs.value[0].value);              // "loves Thai food"
  console.log(beliefs.value[0].confidence);          // 0.7 (governed ceiling)
  console.log(beliefs.value[0].effectiveConfidence); // decays over time
}

const results = limen.search('Thai');
if (results.ok) {
  console.log(results.value[0].belief.value);  // "loves Thai food"
  console.log(results.value[0].score);         // relevance * confidence
}

await limen.shutdown();
```

`createLimen()` with no arguments auto-detects LLM providers, generates a dev encryption key, and provisions a local SQLite database. Copy, paste, run.

## What Makes Limen Different

Most AI memory systems store data — key-value pairs, vector embeddings, chat history. Limen stores **beliefs**.

**Beliefs, not data.** Every claim has a confidence score, a temporal anchor, and a decay curve. A belief stored 90 days ago with no reinforcement is weaker than one stored yesterday. This is computed on every read — nothing is stored. `effectiveConfidence` always reflects the current state of belief.

**Governance, not storage.** Auto-extracted claims are capped at 0.7 confidence — the `maxAutoConfidence` ceiling prevents confidence laundering. Structural conflict detection flags contradictions on write. Cascade retraction penalizes downstream beliefs when a source is retracted. PII detection blocks sensitive data before it reaches the database. Protected predicates prevent unauthorized mutation of critical knowledge.

**Cognition, not retrieval.** The engine consolidates duplicate beliefs, computes importance scores, suggests connections between claims, generates narrative snapshots of knowledge state, and optionally self-heals by auto-retracting derived claims whose parents have decayed below threshold.

## Core API

| Method | Description |
|---|---|
| `remember(subject, predicate, value, options?)` | Store a belief with confidence and temporal anchoring |
| `remember(text, options?)` | Store a free-text observation (auto-generates subject) |
| `recall(subject?, predicate?, options?)` | Retrieve beliefs, filtered by subject/predicate, with decay applied |
| `search(query, options?)` | Full-text search across all beliefs (FTS5 + BM25) |
| `forget(claimId, reason?)` | Retract a belief (governed, audited, never deleted) |
| `connect(claimId1, claimId2, type)` | Relate beliefs: `supports`, `contradicts`, `supersedes`, `derived_from` |
| `reflect(entries)` | Batch-store categorized learnings (decisions, patterns, warnings, findings) |

```typescript
// Beliefs decay without reinforcement (FSRS power-decay)
// R(t) = (1 + t/(9*S))^-1, where S is stability in days
const beliefs = limen.recall('entity:project:limen');
if (beliefs.ok) {
  const b = beliefs.value[0];
  console.log(b.confidence);          // 0.7  (original, governed ceiling)
  console.log(b.effectiveConfidence);  // 0.57 (after 60d decay with S=90)
  console.log(b.freshness);           // "stale" | "aging" | "fresh"
}

// Wrongness containment: confidence is capped
const r = limen.remember('entity:market:ev', 'size.2025', '$45B', { confidence: 0.95 });
// r.value.confidence === 0.7 (capped, not 0.95)

// Conflict detection is automatic
limen.remember('entity:market:ev', 'size.2025', '$52B');
// ^ creates a 'contradicts' relationship with the first claim

// Batch-store learnings
limen.reflect([
  { category: 'decision', statement: 'Chose FSRS over exponential decay', confidence: 0.85 },
  { category: 'warning', statement: 'FTS5 trigram index doubles storage', confidence: 0.7 },
]);
```

## Cognitive API

The `cognitive` namespace provides knowledge health diagnostics and active knowledge management.

| Method | Description |
|---|---|
| `cognitive.health(config?)` | Knowledge health report: freshness distribution, conflicts, gaps, stale domains |
| `cognitive.consolidate(options?)` | Merge similar claims, archive stale ones, suggest contradiction resolutions |
| `cognitive.importance(claimId, weights?)` | 5-factor composite importance score for a claim |
| `cognitive.narrative(missionId?)` | Snapshot of knowledge state — threads, themes, evolution over time |
| `cognitive.verify(claimId)` | Verify a claim via external provider (async, advisory only) |
| `cognitive.suggestConnections(claimId)` | KNN-based relationship suggestions via embedding similarity |
| `cognitive.acceptSuggestion(id)` | Accept a pending connection suggestion |
| `cognitive.rejectSuggestion(id)` | Reject a pending connection suggestion |

```typescript
// Knowledge health diagnostics
const health = limen.cognitive.health();
if (health.ok) {
  console.log(health.value.total);               // total active claims
  console.log(health.value.freshness);           // { fresh: N, aging: N, stale: N }
  console.log(health.value.conflicts.unresolved); // unresolved contradictions
  console.log(health.value.gaps);                // predicates with no recent claims
}

// Consolidation: merge duplicates, archive stale, suggest resolutions
const result = limen.cognitive.consolidate({ dryRun: true });
if (result.ok) {
  console.log(result.value.merged);               // claims merged
  console.log(result.value.archived);             // claims archived
  console.log(result.value.suggestedResolutions); // contradiction resolutions
}

// Importance scoring
const score = limen.cognitive.importance(claimId);
if (score.ok) {
  console.log(score.value.composite);  // 0.0-1.0 weighted score
  console.log(score.value.factors);    // { recency, confidence, connections, access, centrality }
}

// Knowledge narrative
const narrative = limen.cognitive.narrative();
if (narrative.ok) {
  console.log(narrative.value.threads);  // thematic threads across claims
  console.log(narrative.value.summary);  // compressed knowledge state
}
```

## Governance API

Classification, access control, compliance, and audit infrastructure.

| Method | Description |
|---|---|
| `governance.erasure(request)` | GDPR Article 17 erasure with certificate generation |
| `governance.exportAudit(options)` | SOC 2 Type II audit package export |
| `governance.addRule(rule)` | Add a data classification rule |
| `governance.removeRule(ruleId)` | Remove a classification rule |
| `governance.listRules()` | List all active classification rules |
| `governance.protectPredicate(rule)` | Protect a predicate from unauthorized mutation |
| `governance.listProtectedPredicates()` | List all protected predicate rules |

```typescript
// GDPR erasure with audit certificate
const erasure = limen.governance.erasure({
  dataSubjectId: 'user:alice',
  reason: 'Right to erasure request',
  requestedBy: 'dpo@company.com',
});
if (erasure.ok) {
  console.log(erasure.value.certificateId); // audit-grade certificate
  console.log(erasure.value.claimsErased);  // count
}

// Protect critical predicates
limen.governance.protectPredicate({
  predicatePattern: 'governance.*',
  requiredRole: 'admin',
  description: 'Governance claims require admin role',
});

// SOC 2 audit export
const audit = limen.governance.exportAudit({
  fromDate: '2026-01-01T00:00:00Z',
  toDate: '2026-04-01T00:00:00Z',
  format: 'json',
});
```

## Security

Limen applies security controls before data reaches storage.

**PII Detection.** Configurable patterns detect and block or redact PII (emails, phone numbers, SSNs, credit cards) before claims are stored. Detections are logged. Sensitivity levels control enforcement.

**Injection Defense.** Claim content is sanitized against prompt injection patterns. SQL injection via FTS5 queries is neutralized. Subject/predicate formats are validated against URI patterns.

**Consent Tracking.** CRUD for data subject consent records. Consent status (active, revoked, expired) is computed on read with expiry checks. All mutations produce audit trail entries.

**Poisoning Defense.** The `maxAutoConfidence` ceiling (default 0.7) prevents any programmatic source from laundering high-confidence claims. Only human-verified claims via `evidence_path` grounding can exceed the ceiling.

```typescript
// Consent management
limen.consent.register({
  dataSubjectId: 'user:alice',
  scope: 'knowledge-storage',
  basis: 'consent',
  expiresAt: '2027-01-01T00:00:00Z',
});

const consent = limen.consent.check('user:alice', 'knowledge-storage');
// consent.value.status === 'active' | 'revoked' | 'expired'
```

## Vector Search

Semantic search, hybrid search, and duplicate detection. Requires the optional `sqlite-vec` dependency.

```
npm install sqlite-vec
```

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen({
  vector: {
    provider: yourEmbeddingProvider,  // (query: string) => Promise<Float32Array>
    dimensions: 384,
  },
});

// Embed pending claims (call after batch inserts)
await limen.embedPending();

// Semantic search — finds conceptually similar beliefs
const results = await limen.semanticSearch('food preferences');

// Hybrid search — combines FTS5 keyword + vector similarity
const hybrid = limen.search('Thai food', { mode: 'hybrid' });

// Duplicate detection before storing
const dup = await limen.checkDuplicate(
  'entity:user:alice', 'preference.food', 'loves Thai cuisine'
);
if (dup.ok && dup.value.isDuplicate) {
  console.log(dup.value.similarClaimId);  // existing claim
  console.log(dup.value.similarity);      // 0.0-1.0
}

// Embedding statistics
const stats = limen.embeddingStats();
if (stats.ok) {
  console.log(stats.value.totalEmbedded);
  console.log(stats.value.pendingCount);
}
```

Without `sqlite-vec`, `semanticSearch()` falls back to full-text search. The core engine functions identically with or without vector capabilities.

## Self-Healing

When a parent claim is retracted or decays below threshold, derived claims can be automatically retracted in a cascade. This is opt-in.

```typescript
const limen = await createLimen({
  selfHealing: {
    enabled: true,
    autoRetractThreshold: 0.1,   // retract derived claims when parent drops below this
    maxCascadeDepth: 5,          // prevent unbounded recursion
  },
});

// If "entity:source:data" is retracted...
limen.forget(sourceClaimId, 'incorrect');
// ...all claims with derived_from relationships to it
// are auto-retracted if their effective confidence < 0.1
```

Disabled by default. Existing applications upgrading to v2.0.0 see no behavior changes unless explicitly configured.

## Configuration

All fields optional. `createLimen()` with no arguments runs in zero-config mode.

| Option | Type | Default | Description |
|---|---|---|---|
| `dataDir` | `string` | OS temp dir | Where all engine state lives |
| `masterKey` | `Buffer` | Auto-generated | AES-256-GCM encryption key (>= 32 bytes) |
| `providers` | `ProviderConfig[]` | Auto-detected | LLM provider configurations |
| `tenancy.mode` | `'single' \| 'multi'` | `'single'` | Tenancy model |
| `tenancy.isolation` | `'row-level' \| 'database'` | `'row-level'` | Multi-tenant isolation strategy |
| `cognitive.maxAutoConfidence` | `number` | `0.7` | Confidence ceiling for auto-extracted claims |
| `autoConflict` | `boolean` | `true` | Structural conflict detection on assertion |
| `selfHealing.enabled` | `boolean` | `false` | Auto-retraction cascades (opt-in) |
| `selfHealing.autoRetractThreshold` | `number` | `0.1` | Effective confidence floor for derived claims |
| `selfHealing.maxCascadeDepth` | `number` | `5` | Maximum cascade recursion depth |
| `vector.provider` | `EmbeddingProvider` | `undefined` | Embedding function for semantic search |
| `vector.dimensions` | `number` | `undefined` | Embedding vector dimensions |
| `requireRbac` | `boolean` | `false` | Enforce RBAC on all operations |
| `defaultTimeoutMs` | `number` | `60000` | Chat/infer timeout (ms) |
| `rateLimiting.apiCallsPerMinute` | `number` | `100` | API rate limit |
| `failoverPolicy` | `'degrade' \| 'allow-overdraft' \| 'block'` | `'degrade'` | Provider failure behavior |
| `logger` | `(event) => void` | No-op | Structured logging callback |

## Architecture

```
API Surface       createLimen(), remember(), recall(), search(), cognitive.*,
                  governance.*, consent.*, on(), exportData(), importData()

Orchestration     Missions, task graphs, budgets, 16 system calls

Substrate         LLM gateway, transport engine, worker pool

Kernel            SQLite (WAL), audit trail, RBAC, crypto, events
```

Layers depend downward only. The kernel knows nothing about AI. The API composes everything into a single frozen `Limen` object via `Object.freeze`.

5,000+ tests. 134+ invariants across 3 tiers. 16 system calls. 1 production dependency (`better-sqlite3`). Every state mutation is audited in a hash-chained, append-only trail. RBAC on every operation. AES-256-GCM encryption at rest.

## Trust Surface

What is proven:

- Every invariant in [docs/proof/invariants.md](docs/proof/invariants.md) links to a file and line number in the source. CI verifies these references stay fresh.
- 16 system calls, each with interface, implementation, and dual-path test coverage (success + rejection). Evidence: [docs/proof/system-calls.md](docs/proof/system-calls.md).
- Security model with 8 mechanisms and 25 declared non-protections. Evidence: [docs/proof/security-model.md](docs/proof/security-model.md).
- Failure mode defenses with honest accounting. Evidence: [docs/proof/failure-modes.md](docs/proof/failure-modes.md).

What is not:

- Limen is not a vector database. Semantic search requires an external embedding provider and the optional `sqlite-vec` dependency.
- Limen does not guarantee real-time performance at scale. SQLite with WAL mode is the foundation — appropriate for single-node deployments with thousands to low millions of claims.
- The cognitive engine (consolidation, narrative, importance) uses heuristic algorithms, not ML models. Results are deterministic but approximate.
- Self-healing cascades are opt-in and advisory by design. They retract derived claims but do not rewrite or repair them.

Full trust surface with file-and-line evidence: [docs/proof/readiness.md](docs/proof/readiness.md).

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

## License

[Apache License 2.0](LICENSE)

---

<p align="center">Built by <a href="https://solishq.ai">SolisHQ</a></p>
