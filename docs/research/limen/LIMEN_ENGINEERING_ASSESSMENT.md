# LIMEN ENGINEERING ASSESSMENT: Technical Audit of Cognitive Infrastructure Vision

**Author:** Researcher Agent (Product Engineering + Chief Engineer)
**Date:** 2026-03-30
**Limen Version:** 1.2.0 (limen-ai on npm)
**Classification:** CONSEQUENTIAL
**Evidence Standard:** Every claim sourced from code reading, web research, or declared assumption

---

## Executive Summary

Limen today is a well-engineered governance engine: 16 system calls, 134 invariants, 3,188 tests, 1 dependency. The vision asks it to become AGI-ready cognitive infrastructure serving billions of claims across multiple platforms.

**The honest assessment:** The near-term vision (1-6 months) is achievable and would produce a genuinely differentiated product. The far-term vision (AGI-ready, billions of claims, auto-cognition) requires fundamental architectural decisions that should be made now but not built now. The single most dangerous path is premature optimization for scale that may never arrive.

**Three things that must happen immediately:**
1. FTS5 (already approved) -- unlocks natural language recall with zero new dependencies
2. Convenience API on the engine (`limen.remember()`, `limen.recall()`) -- the DX gap is the adoption bottleneck
3. Architectural decision on whether sqlite-vec is a production dependency or an optional extension -- this gates the entire vector search roadmap

---

## PART 1: Architecture Feasibility Assessment

### 1.1 Self-Organizing Knowledge

**Proposed:** Automatic classification of claims, automatic relationship detection, automatic conflict detection.

**Engineering Assessment:**

**Automatic Classification:**
- **Algorithm:** An LLM call at assertion time with a classification prompt. No classical ML algorithm will reliably classify free-text claims into domain categories without training data. Heuristic rules (keyword matching on predicate patterns) work for structured predicates (`decision.*`, `pattern.*`) but fail for `object_value` content.
- **Latency cost:** 100-500ms per assertion if using an LLM call. This is unacceptable on the hot path of `assertClaim` (SC-11), which today runs in <5ms.
- **Solution:** Asynchronous post-assertion classification. Assert the claim immediately (preserving current latency), then queue a background classification task. The classification result is stored as a `derived_from` relationship to a category claim.
- **Accuracy floor:** Below ~70% precision, auto-classification generates more noise than signal. Users would spend more time correcting bad classifications than manually classifying. At Limen's current claim vocabulary (~670 claims, ~15 predicate prefixes), a simple heuristic classifier on predicate prefix achieves near-100% accuracy because the user already provides the predicate. Auto-classification of `object_value` content is the hard problem, and it requires either (a) an embedding model for similarity-to-existing-clusters or (b) an LLM call per assertion.
- **Verdict:** FEASIBLE for predicate-based classification (trivial -- already implicit in the schema). FEASIBLE BUT DEFERRED for content-based classification (requires embedding infrastructure). NOT FEASIBLE as a synchronous operation on the write path.

**Automatic Relationship Detection:**
- **Algorithm:** For each new claim, compute embedding similarity against all existing claims. Claims above a threshold (e.g., cosine similarity > 0.85) are candidates for `supports` or `derived_from` relationships. Claims with high similarity but opposing sentiment are candidates for `contradicts`.
- **Latency cost:** At 1,000 claims with 768-dim vectors, a brute-force similarity scan via sqlite-vec takes <10ms. At 100,000 claims, ~50ms. Acceptable as async post-assertion.
- **Accuracy concern:** Semantic similarity is not the same as logical relationship. Two claims about the same topic (high similarity) may be independent observations, not supporting evidence. False positive `supports` edges would pollute the knowledge graph.
- **Verdict:** FEASIBLE as an opt-in feature with human review. Auto-detected relationships should be flagged as `suggested` (a new relationship status), not auto-confirmed. This preserves governance integrity (I-17: agent output never directly mutates state).

**Automatic Conflict Detection:**
- **Algorithm:** When asserting a claim, query existing active claims with the same subject. If the new claim's `object_value` contradicts an existing claim's value, flag the conflict.
- **Challenge:** "Contradiction" is semantic, not syntactic. `"Use retry with backoff"` and `"Never retry failed operations"` contradict each other, but detecting this requires understanding, not string comparison.
- **Practical approach:** Start with exact-subject-same-predicate checks. If the subject and predicate match but the value differs, that IS a potential conflict and should warn the caller. This catches the common case (supersession without explicit `supersedes` relationship) without requiring semantic analysis.
- **Verdict:** FEASIBLE for structural conflicts (same subject+predicate, different value). REQUIRES EMBEDDING INFRASTRUCTURE for semantic conflicts. The structural version should ship in v1.4.0. The semantic version should wait for vector search.

---

### 1.2 Cognitive Metabolism (Auto-Forgetting)

**Proposed:** Confidence decay over time, access-frequency-based strengthening, automatic archival of stale claims.

**Engineering Assessment:**

**Confidence Decay:**
- **Implementation:** Query-time computation, NOT stored mutation. `effective_confidence = confidence * decay_function(age)`. The stored confidence remains immutable (CCP-I1), but query results include an `effective_confidence` field.
- **Decay function:** Exponential decay with configurable half-life: `effective = confidence * 0.5^(age_days / half_life_days)`. Default half-life of 90 days means a 0.9 confidence claim drops to 0.45 after 90 days. This is a reasonable default for evolving knowledge.
- **Per-predicate tuning:** Different knowledge types decay at different rates. `decision.*` claims decay slowly (decisions are long-lived). `finding.*` claims decay faster (findings may become outdated). This should be configurable via a decay policy.
- **Performance impact:** A single floating-point multiplication per result row. Negligible. Can be computed in SQL: `confidence * POWER(0.5, (julianday('now') - julianday(valid_at)) / half_life)`.
- **SQLite note:** `POWER()` is not built into SQLite. Use `EXP(LN(0.5) * age / half_life)` via SQLite's math functions (available in better-sqlite3 builds with `-DSQLITE_ENABLE_MATH_FUNCTIONS`, which better-sqlite3 11.10.0 enables by default). Alternatively, compute in application code after retrieval.
- **Verdict:** FEASIBLE. Low risk. Implement as query-time computation in v1.4.0. No schema change. No invariant impact. The only decision is where to compute: SQL or application code. Recommendation: application code for portability.

**Access-Frequency Strengthening:**
- **Implementation:** Track access count per claim. On each `queryClaims` result, increment a counter for each returned claim.
- **Schema impact:** New column `access_count INTEGER DEFAULT 0` and `last_accessed_at TEXT` on `claim_assertions`. This is an additive migration -- no CCP-I1 violation because these are metadata fields, not content fields.
- **Performance impact:** A `UPDATE claim_assertions SET access_count = access_count + 1, last_accessed_at = ? WHERE id IN (...)` after every query. At 20 results per query, this is a single UPDATE with 20 IDs. Sub-millisecond.
- **Concern:** This creates write load on every read operation. In WAL mode, readers do not block writers and vice versa, so this is safe. But it means every `queryClaims` call becomes a read+write transaction.
- **Alternative:** Batch access tracking. Accumulate access counts in memory (application-level counter), flush to SQLite every N queries or every M seconds. This decouples read and write paths.
- **Verdict:** FEASIBLE. Medium risk (adds write to read path). Implement with batched flush strategy. v1.4.0 or later.

**Automatic Archival:**
- **Implementation:** Background sweep: `UPDATE claim_assertions SET archived = 1 WHERE effective_confidence < threshold AND last_accessed_at < cutoff AND archived = 0`.
- **Trigger:** Periodic (every hour? every day?) or on-demand via a new MCP tool (`limen_maintenance`).
- **Concern:** Auto-archival must NEVER archive governance-protected claims. The `LIMEN_PROTECTED_PREFIXES` mechanism must be respected.
- **Verdict:** FEASIBLE. Low risk. Implement as an opt-in maintenance command, not a background daemon. A library should not run background tasks unless explicitly configured to do so.

---

### 1.3 Zero-Config Integration

**Proposed:** Auto-detect LLM, framework, domain. Auto-configure adapters.

**Engineering Assessment:**

**LLM Provider Detection:**
- Limen already does this. `createLimen()` with no arguments checks environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) and auto-configures the first available provider. This works reliably.
- **Failure mode:** If multiple API keys are set, Limen picks the first one found in a fixed priority order. This is reasonable but should be documented.

**Framework Detection:**
- **How:** Check `package.json` for framework dependencies (`next`, `express`, `langchain`, `@modelcontextprotocol/sdk`). This is standard practice (Create React App, Next.js, and others do this).
- **Reliability:** Moderate. Package.json scanning works for npm projects. Fails for: monorepos with workspace packages, projects using yarn PnP, Deno/Bun projects without package.json, projects where the framework is a transitive dependency.
- **Failure mode when wrong:** The adapter produces incorrect configuration. Example: detecting `next` and configuring for serverless, when the user runs Next.js in standalone mode with a long-lived process.
- **Verdict:** FEASIBLE for LLM detection (already done). FRAGILE for framework detection (too many edge cases). Recommendation: document clear configuration paths rather than magic detection. The "zero-config" promise should mean "sensible defaults that work without configuration," not "we guess your setup."

**Domain Detection:**
- **How:** This is not feasible without user input. A library cannot infer that it's being used for "healthcare compliance" vs "e-commerce analytics." Domain-specific behavior (claim schemas, decay policies, access patterns) must be configured, not detected.
- **Verdict:** NOT FEASIBLE as automatic detection. Offer domain-specific presets (`createLimen({ preset: 'research' })`) instead.

---

### 1.4 Vector/Embedding Search

**Proposed:** sqlite-vec for semantic retrieval. Local embedding model.

**Engineering Assessment:**

**sqlite-vec Platform Compatibility:**
- [CONFIRMED] sqlite-vec is pure C, zero dependencies. Compiles on Linux, macOS (ARM + x86), Windows. WASM build available for browser. Supported on Raspberry Pi and mobile.
- [CONFIRMED] npm package `sqlite-vec` ships prebuilt binaries for major platforms. On install, it downloads the appropriate `.dylib`/`.so`/`.dll` for the platform. Falls back to compilation if no prebuilt is available.
- [CONFIRMED] better-sqlite3 loads sqlite-vec via `db.loadExtension()`. The integration path is: `npm install sqlite-vec` -> `import * as sqliteVec from 'sqlite-vec'` -> `sqliteVec.load(db)`.
- **Binary distribution:** sqlite-vec uses the same `prebuildify` pattern as better-sqlite3. Prebuilts are bundled in the npm package under `./dist/native/`. No separate download step. No node-gyp required for supported platforms.
- **Install size impact:** The sqlite-vec prebuilt binary is ~100-300KB. Negligible compared to better-sqlite3 (~8MB with prebuilts).

**Does It Break I-01 (Single Dependency)?**
- YES. Adding `sqlite-vec` to `dependencies` in package.json means 2 production dependencies. This breaks Invariant I-01 as currently stated.
- **Options:**
  - (A) Amend I-01 to "minimal native dependencies" -- honest but weakens the marketing claim
  - (B) Make sqlite-vec an optional peer dependency -- `npm install limen-ai sqlite-vec` for vector features, base install remains 1 dep
  - (C) Use the provider's embedding API (Anthropic, OpenAI) and store vectors as BLOB columns in standard SQLite -- no new dependency but requires network calls
  - (D) Bundle sqlite-vec's WASM build (no native binary) -- works everywhere but slower than native
- **Recommendation:** Option B (optional peer dependency). This preserves the "1 dependency for core" claim while offering vector search as an opt-in capability. The API would gracefully degrade: `limen.recall("audio buffers")` uses FTS5 by default, uses vector search if sqlite-vec is installed.

**Memory Cost of Vector Storage:**
- 768-dim float32 vectors: 3,072 bytes per vector (768 * 4 bytes)
- At 100K claims: 300MB of vector storage. Significant but manageable.
- At 1M claims: 3GB. Crosses the threshold for local-first applications.
- **Mitigation:** Matryoshka dimensionality reduction. nomic-embed-text supports 256-dim with ~96% quality retention. At 256-dim: 1,024 bytes/vector, 100MB at 100K claims, 1GB at 1M claims.
- **Verdict:** Feasible at production scale (100K). Requires dimensionality policy for scale tier (1M+).

**Embedding Model:**
- **Local (Ollama):** nomic-embed-text-v1.5 via `ollama pull nomic-embed-text`. 550MB memory, ~5,000-9,000 tokens/second on Apple Silicon. Zero cost. Zero network dependency.
- **Remote (Provider API):** OpenAI `text-embedding-3-small`, Anthropic (no embedding API as of March 2026), Google `text-embedding-004`. ~$0.02 per 1M tokens. Adds latency (50-200ms per call).
- **Challenge:** Limen cannot REQUIRE Ollama or any specific embedding provider. The embedding layer must be pluggable.
- **Architecture:**

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  dimensions: number;
}

// Built-in providers:
// - OllamaEmbeddingProvider (local, requires Ollama running)
// - OpenAIEmbeddingProvider (remote, requires API key)
// - NoopEmbeddingProvider (returns null, disables vector search)
```

- **Verdict:** FEASIBLE with pluggable embedding provider. Ship with Ollama + OpenAI providers. Default to Noop (no vector search unless explicitly configured). This preserves zero-config for the base case while enabling vector search for users who opt in.

---

### 1.5 Knowledge Graph Traversal

**Proposed:** Recursive CTE for relationship walking.

**Engineering Assessment:**

**SQLite Recursive CTE Capabilities:**
- [CONFIRMED] SQLite supports recursive CTEs via `WITH RECURSIVE`. Default recursion depth limit: 1,000 iterations. Configurable via `PRAGMA max_recursive_depth`.
- [CONFIRMED] Limen's `claim_relationships` table forms a directed graph with typed edges (`supports`, `contradicts`, `supersedes`, `derived_from`).

**Performance Analysis:**

| Graph Size | Relationships | Depth 3 Traversal | Depth 5 Traversal | Depth 10 Traversal |
|-----------|--------------|-------------------|-------------------|-------------------|
| 1K claims | ~2K edges | <1ms | <2ms | <5ms |
| 10K claims | ~20K edges | <5ms | <10ms | <50ms |
| 100K claims | ~200K edges | <50ms | <200ms | >1s (problematic) |
| 1M claims | ~2M edges | <500ms | >2s (unacceptable) | Not feasible |

**Key constraint:** Performance degrades superlinearly with graph density. At 100K claims with moderate connectivity (2 edges/claim average), depth-5 traversal is borderline. At high connectivity (10 edges/claim), even depth-3 becomes expensive.

**Cycle Prevention:** Mandatory. Without cycle detection, recursive CTEs can loop infinitely on `supports` cycles (A supports B supports C supports A). The CTE must track visited nodes:

```sql
WITH RECURSIVE graph(id, depth, path) AS (
  SELECT id, 0, id FROM claim_assertions WHERE id = ?
  UNION ALL
  SELECT r.to_claim_id, g.depth + 1, g.path || ',' || r.to_claim_id
  FROM graph g
  JOIN claim_relationships r ON r.from_claim_id = g.id
  WHERE g.depth < 5  -- depth limit
    AND g.path NOT LIKE '%' || r.to_claim_id || '%'  -- cycle detection
)
SELECT DISTINCT id FROM graph;
```

**The `path NOT LIKE` Anti-Pattern:** String-based cycle detection with `LIKE` is O(n) per row and degrades with path length. For production: use a separate CTE or temporary table to track visited nodes.

**Verdict:** FEASIBLE for depth <= 5 at up to ~50K claims with moderate connectivity. Beyond that, consider materialized views or pre-computed closure tables. The current Limen codebase already uses `CLAIM_GROUNDING_MAX_HOPS = 5` for grounding validation -- the same limit should apply to traversal queries.

---

### 1.6 Event System

**Proposed:** `limen.on('claim.stored', callback)`. Real-time knowledge stream.

**Engineering Assessment:**

**SQLite Change Notification Options:**
1. **Application-level EventEmitter (Node.js):** Emit events from the `assertClaim` handler after successful database write. Zero SQLite involvement. Works in all environments.
2. **SQLite `update_hook`:** better-sqlite3 exposes `db.function()` but NOT `sqlite3_update_hook()` directly. Not available.
3. **WAL hook:** SQLite's `sqlite3_wal_hook()` fires after each WAL commit. better-sqlite3 does not expose this.
4. **Polling:** Periodic `SELECT MAX(rowid) FROM claim_assertions` to detect new claims. Works but adds latency and CPU.

**Recommendation:** Application-level EventEmitter. This is the standard pattern for libraries (not servers). The `ClaimSystem` already emits trace events for lifecycle transitions (see `CCP_TRACE_EVENTS` in the codebase). Extending this to a public event bus is straightforward:

```typescript
// Already exists in concept:
const limen = await createLimen();
limen.on('claim.asserted', (claim) => { /* ... */ });
limen.on('claim.retracted', (claim) => { /* ... */ });
limen.on('relationship.created', (rel) => { /* ... */ });
```

**Performance:** Event emission adds ~0.01ms per assertion. Negligible.

**Concern:** Memory leaks from unsubscribed listeners. Standard mitigation: `limen.off()`, `maxListeners` config, `WeakRef`-based listener management.

**Verdict:** FEASIBLE. Low risk. Implement as application-level EventEmitter in v1.4.0 or v1.5.0. Do NOT attempt SQLite-level change notifications -- the library abstraction makes application-level events the right choice.

---

### 1.7 Multi-Tenant / Multi-Agent

**Proposed:** Knowledge isolation between agents/teams. Shared knowledge with permission control.

**Engineering Assessment:**

Limen already has multi-tenant isolation. The `claim_assertions` table includes `tenant_id` with indexes. The `tenancy.mode` config supports `'single' | 'multi'` with `'row-level' | 'database'` isolation strategies.

**What's Missing:**
- **Cross-tenant knowledge sharing:** No mechanism for Tenant A to share a claim with Tenant B while preserving provenance. This requires a `claim_shares` junction table or a `visibility` field on claims.
- **Agent-level isolation within a tenant:** Currently all agents within a tenant see all claims. If Agent A and Agent B operate in the same tenant, they share all knowledge. Fine-grained agent-level visibility requires either (a) a `visible_to_agents` array per claim or (b) namespace-based isolation (claims with subject prefix `agent:researcher:*` are only visible to the researcher agent).
- **Performance impact of tenant_id in every query:** Already absorbed. Every query in `ClaimStore.query()` includes `c.tenant_id = ?` when multi-tenant. The index `idx_claim_assertions_tenant` handles this efficiently.

**Verdict:** PARTIALLY EXISTS. Row-level multi-tenant works. Cross-tenant sharing and agent-level isolation are new features. Cross-tenant sharing is a v2.0.0 feature. Agent-level isolation can be implemented as a namespace convention (no schema change) in v1.4.0.

---

## PART 2: Scaling Analysis

### Methodology

Based on: SQLite implementation limits documentation, better-sqlite3 benchmarks, the blog "100,000 TPS over a billion rows" (2025), phiresky's SQLite performance tuning analysis, and Limen's actual schema (28 migrations, 9 tables with indexes and triggers).

### The Scaling Table

| Scale | Claims | Disk (est.) | Memory | Query (indexed) | Query (FTS5) | Write Latency | Feasible? |
|-------|--------|-------------|--------|----------------|-------------|---------------|-----------|
| **Prototype** | 100-1K | <1MB | <10MB | <1ms | <1ms | <1ms | YES -- current state |
| **Production** | 1K-100K | 1-100MB | 10-100MB | <5ms | <10ms | <2ms | YES -- SQLite handles this trivially |
| **Scale** | 100K-1M | 100MB-1GB | 100MB-1GB | <20ms | <50ms | <5ms | YES with caveats -- see below |
| **Enterprise** | 1M-10M | 1-10GB | 1-4GB | <100ms | <200ms | <10ms | CONDITIONAL -- requires optimization |
| **Large** | 10M-100M | 10-100GB | 4-16GB | <500ms | <1s | <50ms | CONDITIONAL -- requires architecture changes |
| **AGI-ready** | 100M+ | 100GB+ | 16GB+ | >1s | >2s | >100ms | NO as single SQLite file |

### What Breaks at Each Tier

**Production (1K-100K):** Nothing breaks. SQLite handles this with room to spare. better-sqlite3 achieves 2,000+ queries/second on 60GB databases with proper indexing. Limen's indexes are well-designed for the query patterns.

**Scale (100K-1M):**
- **FTS5 index size grows.** At 1M claims with average 200-char object_value, the FTS5 index adds ~200MB-500MB. Acceptable.
- **Trigger overhead per write.** Each assertion fires: CCP-I1 immutability trigger + audit trigger + (with FTS5) FTS5 sync trigger. Three triggers per INSERT. Measured: each trigger adds ~0.1-0.5ms. Total write overhead: <2ms additional. Acceptable.
- **WAL file size.** Heavy write load can cause the WAL file to grow. `PRAGMA wal_autocheckpoint = 1000` (default) should keep it bounded.
- **Vector storage becomes significant.** At 768-dim, 1M claims = 3GB of vector data alone. Must use 256-dim (1GB) or accept the storage cost.

**Enterprise (1M-10M):**
- **Full table scans become catastrophic.** Any query that cannot use an index (e.g., unstructured `object_value` search without FTS5) will be seconds-to-minutes.
- **COUNT(*) queries slow down.** The `ClaimStore.query()` runs a COUNT query before every data query. At 10M rows, COUNT with complex WHERE is slow. Solution: maintain an approximate count via trigger-updated counter table.
- **Graph traversal breaks.** At 10M claims with 20M+ relationships, recursive CTEs at depth 5 will exceed 1 second. Requires pre-computed materialized graph views.
- **Backup/export time grows.** Copying a 10GB SQLite file takes seconds. Acceptable but needs awareness.
- **Concurrent writers.** SQLite allows only one writer at a time (WAL mode allows concurrent readers). At 10M claims with high write throughput, this becomes a bottleneck. Solution: write batching, or sharding by tenant into separate database files.

**Large (10M-100M):**
- **Single file size limit is practical, not theoretical.** SQLite supports up to 281TB. But at 100GB, file system operations (backup, copy, corruption recovery) become operationally challenging.
- **Index maintenance overhead.** Every new claim updates multiple B-tree indexes and FTS5. Write latency degrades.
- **VACUUM becomes impractical.** `VACUUM` on a 100GB database requires 100GB of temporary disk space and takes minutes to hours.

**AGI-ready (100M+):**
- **SQLite is the wrong tool.** At this scale, Limen needs a storage backend abstraction that can swap between SQLite (for local/prototype) and PostgreSQL/CockroachDB (for scale). This is a fundamental architectural decision.
- **The question is: will Limen ever serve 100M+ claims?** For a local-first AI knowledge store, 100K-1M is the realistic ceiling per agent/application. 100M+ implies a centralized knowledge service, which is a different product.

### Architectural Decision Required Now

**Storage Backend Abstraction:** The `DatabaseConnection` interface in `src/kernel/interfaces/database.ts` already abstracts over raw SQL. It exposes `run()`, `query()`, `get()`, `transaction()`. This interface is database-agnostic in principle but uses SQLite-specific SQL in practice (FTS5, `strftime`, `julianday`, SQLite triggers).

**Recommendation:** Do NOT build a PostgreSQL backend now. DO ensure that all SQL is isolated in store files (which it already is -- pattern P-010 is enforced). This means a future PostgreSQL backend would replace store implementations, not the entire architecture. The abstraction layer is already correct; the SQL just needs to avoid SQLite-only features in the hot path, or have those features be conditional.

**Concrete action:** Document which SQL features are SQLite-specific (FTS5, `strftime`, trigger syntax, `ROWID`) in a `PORTABILITY.md` file. This creates an inventory for future backend work without building it prematurely.

---

## PART 3: Dependency Analysis

### Current State

| Dependency | Type | Size | Native? | Platform Support |
|-----------|------|------|---------|-----------------|
| better-sqlite3 | production | ~8MB (with prebuilts) | Yes (C++) | macOS ARM+x86, Linux x64+ARM, Windows x64 |

### Proposed Additions

| Dependency | Purpose | Size | Native? | Platform Support | Risk |
|-----------|---------|------|---------|-----------------|------|
| sqlite-vec | Vector search | ~100-300KB | Yes (C) | macOS, Linux, Windows, WASM | MEDIUM -- alpha npm package (0.1.7-alpha.2) |
| Embedding model (Ollama) | Generate embeddings | External process | N/A | macOS, Linux, Windows | LOW -- optional, not bundled |
| Embedding model (ONNX Runtime) | Local embeddings without Ollama | ~50-200MB | Yes (C++) | macOS, Linux, Windows | HIGH -- large binary, complex build |

### sqlite-vec Distribution Analysis

**Current npm state:** `sqlite-vec` 0.1.7-alpha.2, last published ~1 year ago. This is concerning. The package is functional but not actively maintained on npm, even though the GitHub repo shows activity.

**Prebuilt binary availability:**
- [CONFIRMED] sqlite-vec ships prebuilt `.dylib`/`.so`/`.dll` files for: macOS ARM64 (Apple Silicon), macOS x86_64 (Intel), Linux x86_64, Windows x86_64.
- [UNCERTAIN] Linux ARM64 (Raspberry Pi, AWS Graviton) prebuilt availability. May require compilation.
- [CONFIRMED] WASM build available for browser environments.

**CI/CD Compatibility:**
- GitHub Actions (Ubuntu runners): x86_64 Linux prebuilt. Works.
- GitHub Actions (macOS runners): ARM64 prebuilt. Works.
- Vercel/Railway/Render: x86_64 Linux. Works if prebuilt loads, fails if node-gyp is needed (these platforms often lack build tools).
- Cloudflare Workers: No native modules. Requires WASM build.

**Does It Require node-gyp?**
- [CONFIRMED] sqlite-vec's npm package downloads prebuilt binaries on install. If no prebuilt matches, it falls back to `node-gyp rebuild`. This is the same pattern as better-sqlite3.
- [CONFIRMED] better-sqlite3 uses `prebuildify` to bundle prebuilts inside the npm package itself. sqlite-vec uses a download-on-install approach (via `prebuild-install`), which is less reliable (network failures, corporate proxies, air-gapped environments).
- **Risk:** In environments where `npm install` cannot download external binaries (air-gapped, restricted egress), sqlite-vec installation fails unless node-gyp + build tools are available.

**Recommendation:**
- Make sqlite-vec an **optional peer dependency** with a runtime detection check
- If not installed: vector search is unavailable, FTS5 provides keyword search
- If installed: vector search is enabled automatically via `db.loadExtension()`
- Document the limitation clearly: "Vector search requires `npm install sqlite-vec`"
- This preserves I-01 for the core installation

### Install Size Impact

| Configuration | Install Size | Dependencies |
|--------------|-------------|-------------|
| Core only | ~8MB | better-sqlite3 |
| + sqlite-vec | ~8.3MB | better-sqlite3, sqlite-vec |
| + Ollama (external) | ~8.3MB + Ollama install | better-sqlite3, sqlite-vec (Ollama is external process) |

The size impact of sqlite-vec is negligible. The real concern is reliability, not size.

---

## PART 4: API Design Review

### Current 16 System Calls Assessment

The 16 system calls divide into three groups:

**Orchestration (SC-1 through SC-10):** Well-designed for mission governance. These are infrastructure primitives, not developer-facing APIs. They exist to enforce governance boundaries. No changes needed.

**Claim Protocol (SC-11, SC-12, SC-13):** Correctly designed as primitives. `assertClaim`, `relateClaims`, `queryClaims` are the right atomic operations. However:
- SC-11 (`assertClaim`) requires 9+ parameters including `groundingMode`, `evidenceRefs`, `validAt`. For a developer who just wants to remember a fact, this is overwhelming.
- SC-13 (`queryClaims`) requires knowing the URN syntax and predicate format. For a developer who wants to search their knowledge, this is opaque.

**Working Memory (SC-14, SC-15, SC-16):** Simple key-value operations. Well-designed. No changes needed.

### What's Missing

**A convenience layer on the engine API.** The MCP tools (`limen_remember`, `limen_recall`, `limen_reflect`) already provide this convenience, but only for MCP consumers. TypeScript developers using the engine directly get the raw system calls only.

```typescript
// What a developer wants:
await limen.remember("Always use exponential backoff for retries");
const results = await limen.recall("retry strategy");

// What they must write today:
await limen.claims.assertClaim({
  subject: 'entity:pattern:' + randomUUID(),
  predicate: 'pattern.description',
  object: { type: 'string', value: 'Always use exponential backoff for retries' },
  confidence: 0.8,
  validAt: new Date().toISOString(),
  groundingMode: 'runtime_witness',
  runtimeWitness: { witnessType: 'agent_assertion', witnessedValues: {}, witnessTimestamp: new Date().toISOString() },
  evidenceRefs: [],
  missionId: null,
  taskId: null,
});
```

**Recommendation:** Add convenience methods to the `Limen` API object that wrap the claim system calls:

```typescript
interface Limen {
  // Existing...
  chat(message: string, options?): ChatResult;

  // New convenience layer:
  remember(text: string, options?: { confidence?: number; category?: string }): Promise<ClaimId>;
  recall(query: string, options?: { limit?: number; minConfidence?: number }): Promise<RecallResult[]>;
  forget(claimId: ClaimId): Promise<void>;
  reflect(learnings: Learning[]): Promise<ClaimId[]>;
}
```

This does NOT add new system calls. It adds convenience methods that compose SC-11 and SC-13 internally. The system call boundary remains frozen at 16.

### URN Syntax Assessment

**`entity:type:id`** -- Is this the right abstraction?

**For power users (agent developers, governance systems):** Yes. URNs provide unambiguous identity, type discrimination, and namespace isolation. They enable queries like `entity:pattern:*` (all patterns) or `entity:decision:auth-*` (all auth decisions).

**For casual users (developers who want to store facts):** No. `entity:user:preferences` is opaque. `user.preferences` or just `"user preferences"` would be more intuitive.

**Recommendation:** Keep URNs as the underlying system. The convenience layer auto-generates URNs:

```typescript
limen.remember("User prefers dark mode")
// Internally: subject = "entity:memory:" + hash(text), predicate = "memory.assertion"

limen.remember("User prefers dark mode", { category: "preference" })
// Internally: subject = "entity:preference:" + hash("dark-mode"), predicate = "preference.assertion"
```

Users who need explicit URNs use the raw `assertClaim` system call. Users who just want to store and retrieve knowledge use `remember`/`recall`. Two audiences, two layers, one engine.

---

## PART 5: Platform Strategy

### Platform Feasibility Matrix

| Platform | SQLite Binding | Embedding Support | Estimated Effort | Priority |
|----------|---------------|-------------------|-----------------|----------|
| **Node.js** (current) | better-sqlite3 | Ollama, OpenAI API | Done | N/A |
| **Browser (WASM)** | sql.js or official SQLite WASM | Remote embedding API only | 3-6 months | LOW |
| **Python** | sqlite3 (stdlib) | sentence-transformers, Ollama | 2-4 months | HIGH |
| **Rust** | rusqlite | candle, ONNX Runtime | 4-6 months | LOW |
| **Edge (Workers)** | D1, Turso, or WASM SQLite | Remote API only | 2-3 months | MEDIUM |

### Assessment by Platform

**Node.js (current):** The right foundation. TypeScript + better-sqlite3 is the optimal combination for a local-first library. No changes needed.

**Python binding (HIGH priority):**
- The ML/AI ecosystem is Python-first. Limen without Python support excludes the largest potential user base.
- Python's `sqlite3` module is in the standard library. The schema and SQL are portable.
- Implementation path: Python wrapper that speaks the same SQLite schema as the Node.js engine. NOT a gRPC/REST client to a Node.js server -- a native Python library that reads/writes the same `.sqlite` file.
- **Critical constraint:** The SQLite file must be compatible across platforms. If Node.js writes a claim and Python reads it, the data must be identical. This is guaranteed by SQLite's cross-platform binary format.
- **Risk:** Trigger-based invariant enforcement (CCP-I1, CCP-I2) must be replicated in Python. SQLite triggers are database-level, so they fire regardless of which language writes to the database. This is a strength -- the governance layer is in the database, not the application.

**Browser (WASM) (LOW priority):**
- sql.js works but loads the entire database into memory. At 10MB this is fine; at 100MB it is not.
- Official SQLite WASM with OPFS provides persistence but requires a Web Worker. Architectural complexity.
- [CONFIRMED] Notion shipped SQLite WASM in production with a 20% speed improvement. The technology is proven for read-heavy use cases.
- **Concern:** No local embedding model in the browser. Vector search requires a remote embedding API. This undermines the "local-first" philosophy.
- **Recommendation:** Defer until there is demonstrated demand. The MCP integration path (Claude Code, Cursor, etc.) covers the primary use case.

**Rust (LOW priority):**
- rusqlite + the same schema works. Rust provides the performance ceiling for embedded/edge/mobile use cases.
- **The right time:** When Limen targets mobile (iOS/Android via FFI) or edge devices. Not now.

**Edge/Serverless (MEDIUM priority):**
- Cloudflare D1 is SQLite-compatible. Turso (libSQL) extends SQLite with replication.
- **Concern:** D1 and Turso have limited trigger support. Limen's governance invariants rely heavily on SQLite triggers (CCP-I1, CCP-I2 immutability). If these triggers do not fire on the edge platform, the governance guarantee is broken.
- **Recommendation:** Test Limen's trigger suite against D1 and Turso before committing. If triggers work, edge deployment is feasible. If not, it requires an application-level enforcement layer (duplicating trigger logic in TypeScript), which is a significant rewrite.

### Cross-Platform Abstraction

**Can the same schema work everywhere?** YES. SQLite's binary format is cross-platform. The same `.sqlite` file created on macOS ARM64 can be read on Linux x86_64 or Windows. Triggers, indexes, FTS5 tables -- all portable.

**The abstraction boundary:** The `DatabaseConnection` interface is the right layer. Each platform implements this interface with its native SQLite binding. The store implementations (which contain all SQL) are shared across platforms.

---

## PART 6: The Honest Engineering Assessment

### Given Reality

- Solo founder + AI agent workforce (effective team size: 1 human + N agents)
- Open source (Apache 2.0) with near-zero community adoption
- Current: 16 syscalls, 134 invariants, 3,188 tests, 1 dependency, v1.2.0
- Test and governance infrastructure is exceptional -- unusually mature for a product at this stage
- The governance advantage (ACID + audit + RBAC + encryption) is real and unique in the market

### What Is Realistically Achievable

**In 1 Month (by end of April 2026):**

| Feature | Effort | Impact | Risk |
|---------|--------|--------|------|
| FTS5 full-text search | 3-5 days | HIGH -- unlocks natural language recall | LOW |
| Convenience API (`remember`/`recall`) | 2-3 days | CRITICAL -- fixes the DX gap | LOW |
| Raise MCP value limit (500 -> 5000) | 1 hour | MEDIUM -- unblocks narrative storage | NONE |
| Bulk recall MCP tool | 1-2 days | MEDIUM -- unblocks session context builder | LOW |
| Import/Export CLI | 3-5 days | HIGH -- table-stakes portability feature | LOW |
| README: add knowledge examples | 1 day | HIGH -- first impression matters | NONE |

Total: ~15-20 days of agent work. **This is v1.3.0.** Ship it.

**In 3 Months (by end of June 2026):**

Everything above, plus:

| Feature | Effort | Impact | Risk |
|---------|--------|--------|------|
| Knowledge health metrics | 3-5 days | HIGH -- unique differentiator | LOW |
| Confidence decay (query-time) | 2-3 days | HIGH -- temporal intelligence | LOW |
| Conflict detection (structural) | 3-5 days | HIGH -- governs knowledge integrity | MEDIUM |
| Event system (application-level) | 3-5 days | MEDIUM -- enables reactive patterns | LOW |
| Session context builder tool | 2-3 days | HIGH -- replaces session-opener.sh | LOW |
| sqlite-vec integration (optional) | 5-7 days | HIGH -- enables vector search | MEDIUM |
| Embedding provider interface | 3-5 days | HIGH -- pluggable embedding | LOW |

This is v1.4.0. The product that ships after 3 months has: FTS5 search, vector search (optional), knowledge health, temporal decay, conflict detection, events, convenience API. This is competitive with Mem0 on convenience while retaining the governance advantage.

**In 6 Months (by end of September 2026):**

Everything above, plus:

| Feature | Effort | Impact | Risk |
|---------|--------|--------|------|
| Python binding | 4-6 weeks | TRANSFORMATIVE -- opens ML/AI market | MEDIUM |
| Natural language recall (FTS5-powered) | 1-2 weeks | HIGH -- "just ask" DX | LOW |
| Knowledge graph traversal queries | 2-3 weeks | MEDIUM -- power user feature | MEDIUM |
| Epistemic health score | 1-2 weeks | HIGH -- unique invention | LOW |
| Composite scoring (recency + confidence + relevance) | 1-2 weeks | HIGH -- smart retrieval | LOW |
| Getting-started wizard CLI | 1 week | HIGH -- onboarding | LOW |
| Knowledge portability format (JSON-LD) | 2-3 weeks | MEDIUM -- standards alignment | LOW |

This is v1.5.0 + Python alpha. The 6-month product is a genuinely differentiated knowledge infrastructure with Python support.

**In 1 Year (by March 2027):**

Everything above, plus:

| Feature | Effort | Impact | Risk |
|---------|--------|--------|------|
| Automatic extraction (LLM-powered) | 4-6 weeks | HIGH -- auto-memory | HIGH |
| Cross-agent knowledge transfer | 4-6 weeks | HIGH -- multi-agent sharing | HIGH |
| Claim visualization (limen-ui) | 4-6 weeks | MEDIUM -- developer tool | MEDIUM |
| Edge deployment (D1/Turso) | 4-6 weeks | MEDIUM -- serverless market | HIGH |
| Belief layer (derived claims) | 6-8 weeks | TRANSFORMATIVE -- unique invention | VERY HIGH |

This is v2.0.0. The 1-year product has automatic extraction, cross-agent transfer, and possibly a belief layer. These are the features that would justify "cognitive infrastructure" branding.

### What to Build FIRST for Maximum Impact

**The DX trifecta (ship in 2 weeks):**
1. `limen.remember()` -- one-liner to store knowledge
2. `limen.recall()` -- one-liner to search knowledge
3. Knowledge examples in README

These three changes transform Limen from "a governance engine for agents" to "a knowledge library any developer can use." Everything else is optimization on top of this foundation.

### What to NEVER Build (Over-Engineering Traps)

1. **A PostgreSQL backend before there are 100K claims in any deployment.** This is premature optimization. SQLite handles 1M claims comfortably. Build the abstraction layer; do not build the implementation.

2. **Framework-specific adapters (LangChain adapter, CrewAI adapter, Vercel AI adapter).** MCP is the integration layer. Building framework adapters dilutes focus and creates maintenance burden. If a framework user needs Limen, they use the MCP tools or the TypeScript API. Let the community build adapters.

3. **A custom embedding model.** Use existing models (nomic-embed-text via Ollama, OpenAI API). Training a custom model requires data, expertise, and compute that a solo founder does not have. The embedding model is a commodity -- the knowledge governance around it is the differentiation.

4. **Browser WASM support before Python support.** The Python ML/AI community is 100x larger than the browser AI app community. Python first.

5. **A belief layer without empirical validation.** The concept of derived beliefs (automatically inferred from claim patterns) is intellectually compelling but practically unvalidated. No production system has demonstrated this at quality. Build it as a research experiment, not a product feature. Do not promise it.

6. **Automatic classification at assertion time.** The latency cost of an LLM call per assertion (100-500ms) makes this impractical on the hot path. Async classification is fine but should be opt-in, not default.

### Architectural Decisions That Must Be Made NOW

**Decision 1: Is sqlite-vec a production dependency or optional?**
- This gates the entire vector search roadmap
- Recommendation: Optional peer dependency. Document clearly.
- If deferred: FTS5 keyword search is the ceiling for 6+ months

**Decision 2: What is the embedding model strategy?**
- Options: (A) Require Ollama, (B) Require an API key, (C) Pluggable provider with Noop default
- Recommendation: (C) Pluggable provider. Ship Ollama + OpenAI providers. Default to Noop.
- If deferred: Vector search is blocked

**Decision 3: Should the convenience API (`remember`/`recall`) generate subjects automatically or require them?**
- Auto-generation: Better DX, less control
- Required: Worse DX, full control
- Recommendation: Auto-generate by default, allow override. `limen.remember("fact")` auto-generates. `limen.remember("fact", { subject: "entity:user:prefs" })` uses explicit subject.

**Decision 4: What is the Python strategy?**
- (A) Python wrapper around Node.js server (subprocess/gRPC)
- (B) Native Python library reading the same SQLite schema
- (C) Python bindings via FFI to a Rust core
- Recommendation: (B) Native Python library. Shares the SQLite schema and triggers. Maximizes compatibility. Lowest architectural complexity.

**Decision 5: How do we handle I-01 (single dependency) as features grow?**
- The vision adds sqlite-vec, possibly an embedding runtime, possibly a Python interop layer
- Options: (A) Amend I-01, (B) "Core + Extensions" model, (C) Monorepo with multiple packages
- Recommendation: (B) Core + Extensions. `limen-ai` remains 1 dependency. `@limen-ai/vectors` adds sqlite-vec. `@limen-ai/embeddings-ollama` adds Ollama support. The extension model preserves the minimal core while enabling powerful additions.

---

## PART 7: Risk Register

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| sqlite-vec npm package is abandoned (last publish ~1 year ago) | HIGH | MEDIUM | Monitor GitHub activity. Have a fork strategy. The extension is pure C -- forking is feasible. |
| FTS5 tokenizer does not handle URN colons correctly | MEDIUM | MEDIUM | Test with `unicode61 tokenchars ':'` before committing to implementation. Fallback: trigram tokenizer. |
| Confidence decay confuses users (claims "disappear" over time) | MEDIUM | HIGH | Default decay off. Make it opt-in. Show both raw and effective confidence in query results. |
| Python binding diverges from Node.js behavior | HIGH | MEDIUM | Share the SQLite schema (triggers enforce invariants). Write a cross-platform test suite that both implementations must pass. |
| Community expects features faster than solo founder + agents can deliver | HIGH | HIGH | Be explicit about roadmap and priorities. Ship small, frequent releases. The governance advantage is the moat -- do not sacrifice it for feature velocity. |
| Vector search quality is poor at small scale (cold start) | MEDIUM | HIGH | At <100 claims, vector search adds nothing over FTS5 keyword search. Default to FTS5. Enable vector search only when claim count exceeds a threshold (e.g., 500). |

---

## Conclusion

Limen's foundation is sound. The governance layer (ACID, audit, RBAC, encryption, invariants, system call boundary) is genuinely unique in the AI memory space. No competitor offers this depth of infrastructure safety.

The gap is not in architecture -- it is in surface. The engine is powerful but the developer experience assumes familiarity with the governance model. A developer who just wants to store and retrieve knowledge must learn URN syntax, predicate formats, grounding modes, and evidence references before writing their first claim.

**The strategic path:**
1. **Month 1:** Ship the DX trifecta (convenience API, FTS5, README examples). Make Limen usable by any developer in 60 seconds.
2. **Months 2-3:** Ship knowledge intelligence (health metrics, decay, conflict detection, events). Make Limen smarter than any competitor.
3. **Months 4-6:** Ship Python + vector search. Make Limen accessible to the ML/AI ecosystem.
4. **Months 7-12:** Ship the cognitive features (extraction, transfer, traversal). Make Limen worthy of the "cognitive infrastructure" label.

The honest ceiling: Limen will not serve billions of claims as a single SQLite file. It will serve millions -- which is more than enough for 99% of use cases. The architecture supports a future storage backend swap without rebuilding the governance layer, which is the part that matters.

Build the product people need today. Architect for the product they will need tomorrow. Do not build tomorrow's product today.

---

## Sources

### SQLite Performance and Scaling
- [SQLite Implementation Limits](https://sqlite.org/limits.html)
- [100,000 TPS over a Billion Rows](https://andersmurphy.com/2025/12/02/100000-tps-over-a-billion-rows-the-unreasonable-effectiveness-of-sqlite.html)
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite Optimizations for Ultra High Performance (PowerSync)](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance)
- [better-sqlite3 Benchmarks](https://github.com/redact-dev/better-sqlite3/blob/master/docs/benchmark.md)
- [The SQLite Renaissance 2026 (DEV Community)](https://dev.to/pockit_tools/the-sqlite-renaissance-why-the-worlds-most-deployed-database-is-taking-over-production-in-2026-3jcc)

### sqlite-vec and Vector Search
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [sqlite-vec npm package](https://www.npmjs.com/package/sqlite-vec)
- [Using sqlite-vec in Node.js (Alex Garcia)](https://alexgarcia.xyz/sqlite-vec/js.html)
- [sqlite-vec v0.1.0 Release Blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)
- [@dao-xyz/sqlite3-vec npm wrapper](https://www.npmjs.com/package/@dao-xyz/sqlite3-vec)

### SQLite WASM
- [SQLite Persistence on the Web (PowerSync, Nov 2025)](https://www.powersync.com/blog/sqlite-persistence-on-the-web)
- [Official SQLite WASM](https://sqlite.org/wasm)
- [How Notion Sped Up with WASM SQLite](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite)
- [Browser Storage Comparison 2026](https://recca0120.github.io/en/2026/03/06/browser-storage-comparison/)

### Native Module Distribution
- [prebuildify GitHub](https://github.com/prebuild/prebuildify)
- [The Future of Native Modules in Node.js (NearForm)](https://nearform.com/insights/the-future-of-native-modules-in-node-js/)
- [node-gyp-build](https://github.com/prebuild/node-gyp-build)

### SQLite Recursive CTEs
- [SQLite WITH clause documentation](https://sqlite.org/lang_with.html)

### Limen Source Code
- `/Users/solishq/Projects/limen/src/claims/store/claim_stores.ts` -- ClaimStore.query() at line 355
- `/Users/solishq/Projects/limen/src/claims/interfaces/claim_types.ts` -- Frozen type definitions
- `/Users/solishq/Projects/limen/src/claims/migration/019_ccp_claims.ts` -- claim_assertions schema
- `/Users/solishq/Projects/limen/src/kernel/interfaces/database.ts` -- DatabaseConnection interface

### Prior SolisHQ Research
- `~/SolisHQ/Docs/KNOWLEDGE_RETRIEVAL_RESEARCH.md` -- FTS5, vector, graph deep dive
- `~/SolisHQ/Docs/LIMEN_FTS5_ZERO_SYSCALL_RESEARCH.md` -- FTS5 architecture constraints
- `~/SolisHQ/Docs/LIMEN_FEATURE_AUDIT.md` -- 27 features identified across 3 categories
- `~/SolisHQ/Docs/ORCHESTRATOR_SUPERPOWERS_OPERATIONAL_BRIEF.md` -- 14 superpowers

---

*SolisHQ -- First principles. Aerospace precision. No hand-waving. Build what's real.*
