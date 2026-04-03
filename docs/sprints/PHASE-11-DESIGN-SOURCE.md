# Phase 11: Vector Search — Design Source

**Date**: 2026-04-03
**Author**: Orchestrator
**Criticality**: Tier 2 (core product logic, query surfaces) with Tier 1 inheritance on data integrity
**Governing documents**: LIMEN_BUILD_PHASES.md (Phase 11), KNOWLEDGE_RETRIEVAL_RESEARCH.md, CLAUDE.md
**Decision weight**: Significant (new subsystem, optional dependency, new search mode)

---

## THE FIVE QUESTIONS

1. **What does the spec actually say?**
   Phase 11 delivers: sqlite-vec integration as optional peer dependency (11.1), embedding generation with configurable provider (11.2), `limen.search(query, { mode: 'semantic' })` (11.3), hybrid FTS5+vector search (11.4), duplicate detection via cosine similarity (11.5). The existing `SearchOptions.mode` field was designed for this — comment says "Phase 11 extends to: 'semantic' | 'hybrid'". 16 system calls FROZEN.

2. **How can this fail?**
   - sqlite-vec not installed → semantic search must fail gracefully, not crash
   - Embedding provider fails/unavailable → claims must still assert without embeddings
   - Embedding dimensions mismatch → vec0 table rejects wrong-size vectors
   - Stale embeddings after claim retraction → search returns retracted claims
   - GDPR erasure doesn't delete embeddings → privacy violation
   - Hybrid ranking math is wrong → worse than either FTS5 or vector alone
   - Duplicate detection too aggressive → rejects legitimate similar claims
   - Duplicate detection too loose → misses actual duplicates
   - Large embedding vectors → storage bloat, query slowdown

3. **What are the downstream consequences?**
   - Phase 12 Cognitive Engine depends on embeddings for: consolidation, auto-connection, prioritization
   - Embedding storage is permanent — schema design must be forward-compatible with ANN indexes
   - The `EmbeddingProvider` interface becomes a public contract — breaking it affects all users
   - Hybrid search ranking algorithm is a quality differentiator — it must be tunable

4. **What am I assuming?**
   - sqlite-vec v0.1.9+ is stable enough for production (confirmed: Apache 2.0, active development)
   - Embedding generation is the CALLER'S responsibility — Limen does not ship an embedding model
   - The caller provides a function `(text: string) => Promise<number[]>` — Limen calls it
   - 768 dimensions (nomic-embed-text-v1.5 default) is the recommended size
   - Brute-force KNN is acceptable for Limen's scale (< 100K claims per instance)

5. **Would a hostile reviewer find fault?**
   - "No built-in embedding model" → By design — Limen is zero-dependency. Embedding model is caller's choice.
   - "Brute-force, not ANN" → Correct for Limen's embedded scale. ANN (DiskANN) comes with sqlite-vec v0.1.10.
   - "Async embedding in a sync library" → The claim asserts synchronously. Embedding is deferred to background. First search triggers lazy embedding. This is the right tradeoff.

---

## FIRST-PRINCIPLES ARCHITECTURE

### The Ontological Question: What IS an embedding in a belief system?

In Limen, claims are beliefs — they have confidence, evidence, decay, and lifecycle. An embedding is NOT the belief itself. It is a **projection of the belief's content into a semantic space** that enables meaning-based retrieval. The embedding:

- Is derived FROM the claim content (subject + predicate + objectValue)
- Has NO epistemic status — it doesn't have confidence or evidence
- Is DISPOSABLE — it can be regenerated from the claim content at any time
- Must be DELETED when the claim is tombstoned (GDPR — the content it was derived from is erased)
- Must be EXCLUDED from search when the claim is retracted (same as FTS5 behavior)
- Is MODEL-SPECIFIC — different embedding models produce incompatible vectors

This means:
1. Embeddings are stored in a SEPARATE table from claims (not a column on claim_assertions)
2. The embedding table records the model identity so we can detect stale embeddings after model change
3. Embedding generation is asynchronous and idempotent — safe to retry, safe to skip
4. The vec0 virtual table is the storage + query engine — we don't build custom similarity math

### The Deferred Embedding Pattern

Claims in Limen assert synchronously. Embedding generation requires an async call to an external provider (OpenAI, Ollama, etc.). The resolution:

```
remember() → assertClaim() → INSERT claim (sync, immediate)
                            → queue embedding request (sync, just an INSERT to pending table)

embedPending() → for each pending claim:
                   → call provider(text) → await embedding vector
                   → INSERT into vec0 table
                   → remove from pending queue
```

`embedPending()` is called:
- Explicitly by the caller: `limen.embedPending()` — for batch processing
- Lazily on first `search({ mode: 'semantic' })` — auto-embed pending claims before searching
- By a background interval if configured: `embeddingInterval: 5000` (5s default, 0 = disabled)

This means semantic search may have a "cold start" where recently asserted claims don't have embeddings yet. This is documented and expected — the caller controls the tradeoff.

---

## OUTPUT 1: MODULE DECOMPOSITION

### New Modules

| Module | Location | Responsibility |
|--------|----------|----------------|
| **Vector Types** | `src/vector/vector_types.ts` | Types for embeddings, providers, search modes |
| **Vector Store** | `src/vector/vector_store.ts` | vec0 table management, embedding CRUD, KNN queries |
| **Embedding Queue** | `src/vector/embedding_queue.ts` | Pending embeddings table, batch processing |
| **Hybrid Ranker** | `src/vector/hybrid_ranker.ts` | Combine FTS5 BM25 + vector cosine into unified score |
| **Duplicate Detector** | `src/vector/duplicate_detector.ts` | Cosine similarity check at assertion time |

### Existing Modules Modified

| Module | Change |
|--------|--------|
| `src/api/convenience/convenience_types.ts` | Extend `SearchOptions.mode` to include 'semantic' \| 'hybrid' |
| `src/claims/store/claim_stores.ts` | Hook embedding queue + duplicate detection into assertClaim |
| `src/api/index.ts` | Wire vector modules, sqlite-vec optional load, `limen.embedPending()` |
| `src/api/interfaces/api.ts` | Add vector methods to Limen interface |
| `src/governance/compliance/erasure_engine.ts` | Delete embeddings during GDPR erasure |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Consumer API (Limen)                         │
│                                                                  │
│  remember() ─► assertClaim() ─► [DuplicateDetector.check]       │
│                               ─► INSERT claim                    │
│                               ─► INSERT into embedding_pending   │
│                                                                  │
│  search(query, { mode: 'semantic' })                             │
│    ├─ embedPending() if auto-embed enabled                       │
│    ├─ VectorStore.knn(queryEmbedding, k)                         │
│    └─ Return results sorted by cosine similarity                 │
│                                                                  │
│  search(query, { mode: 'hybrid' })                               │
│    ├─ FTS5 search → BM25 scores                                 │
│    ├─ VectorStore.knn → cosine scores                            │
│    └─ HybridRanker.combine(bm25, cosine) → unified ranking      │
│                                                                  │
│  embedPending() ─► EmbeddingQueue.process(provider)              │
│                                                                  │
│  governance.erasure() ─► VectorStore.delete(claimIds)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## OUTPUT 2: TYPE ARCHITECTURE

```typescript
// ── Embedding Provider ──

/**
 * The embedding provider interface — what callers implement.
 * Limen does not ship an embedding model. The caller provides this function.
 *
 * Design choice: single function, not a class. Simplest possible contract.
 * The function takes text and returns a vector of numbers.
 * Dimensions must match the configured embeddingDimensions.
 */
export type EmbeddingProvider = (text: string) => Promise<number[]>;

// ── Vector Configuration ──

export interface VectorConfig {
  /** The embedding provider function. Required for semantic search. */
  readonly provider: EmbeddingProvider;
  /** Embedding dimensions. Must match the provider's output. Default: 768. */
  readonly dimensions?: number;
  /** Auto-embed pending claims before semantic search. Default: true. */
  readonly autoEmbed?: boolean;
  /** Background embedding interval in ms. 0 = disabled. Default: 0. */
  readonly embeddingInterval?: number;
  /** Duplicate detection threshold. 0 = disabled. Default: 0.95. */
  readonly duplicateThreshold?: number;
  /** Maximum number of pending embeddings to process per batch. Default: 50. */
  readonly batchSize?: number;
  /** Model identifier stored with embeddings for staleness detection. */
  readonly modelId?: string;
}

// ── Stored Embedding ──

export interface StoredEmbedding {
  readonly claimId: string;
  readonly modelId: string;
  readonly dimensions: number;
  readonly createdAt: string;
}

// ── Duplicate Detection ──

export interface DuplicateCandidate {
  readonly claimId: string;
  readonly similarity: number;  // cosine similarity 0-1
  readonly subject: string;
  readonly predicate: string;
}

export interface DuplicateCheckResult {
  readonly isDuplicate: boolean;
  readonly candidates: readonly DuplicateCandidate[];
  readonly threshold: number;
}

// ── Search Mode Extension ──

export type SearchMode = 'fulltext' | 'semantic' | 'hybrid';

// ── Hybrid Ranking ──

export interface HybridScore {
  readonly claimId: string;
  readonly fts5Score: number | null;    // null if not in FTS5 results
  readonly vectorScore: number | null;   // null if not in vector results
  readonly combinedScore: number;        // unified ranking
}

/** Hybrid ranking weights — how much each signal contributes */
export interface HybridWeights {
  readonly fts5: number;    // default: 0.4
  readonly vector: number;  // default: 0.6
}

// ── Error Codes ──

export type VectorErrorCode =
  | 'VECTOR_NOT_AVAILABLE'        // sqlite-vec not installed
  | 'VECTOR_DIMENSION_MISMATCH'   // embedding size doesn't match config
  | 'VECTOR_PROVIDER_FAILED'      // embedding provider threw
  | 'VECTOR_NO_EMBEDDINGS'        // no embeddings exist yet
  | 'DUPLICATE_DETECTED';         // cosine similarity above threshold
```

---

## OUTPUT 3: STATE MACHINES

### 3.1 Embedding Lifecycle

```
  assertClaim() succeeds
         │
         ▼
  ┌──────────────────────┐
  │      PENDING          │  (row in embedding_pending table)
  │  content hashed,      │
  │  awaiting provider    │
  └──────┬───────────────┘
         │ embedPending() / auto-embed
         ▼
  ┌──────────────────────┐
  │     EMBEDDED          │  (row in vec0 table + metadata)
  │  vector stored,       │
  │  searchable           │
  └──────┬──────┬────────┘
         │      │
  retract│      │ tombstone (GDPR)
         │      │
         ▼      ▼
  ┌──────────┐ ┌──────────┐
  │ EXCLUDED │ │ DELETED  │
  │ from     │ │ from vec0│
  │ search   │ │ table    │
  │ (status  │ │ (hard    │
  │ filter)  │ │ delete)  │
  └──────────┘ └──────────┘
```

**Transitions:**
- PENDING → EMBEDDED: `embedPending()` calls provider, stores vector
- EMBEDDED → EXCLUDED: claim retracted → embedding stays but filtered by `status='active'` JOIN
- EMBEDDED → DELETED: claim tombstoned (GDPR) → embedding hard-deleted from vec0
- PENDING → DELETED: claim tombstoned before embedding generated → pending record removed

### 3.2 Vector Store Availability

```
  createLimen()
       │
       ├─ sqlite-vec installed?
       │     YES → load(db) → AVAILABLE
       │     NO  → UNAVAILABLE
       │
  AVAILABLE:
    search({mode:'semantic'}) → vector KNN
    search({mode:'hybrid'})  → FTS5 + vector
    embedPending()           → processes queue
    duplicate detection      → active

  UNAVAILABLE:
    search({mode:'semantic'}) → VECTOR_NOT_AVAILABLE error
    search({mode:'hybrid'})  → falls back to fulltext
    embedPending()           → no-op
    duplicate detection      → disabled
```

---

## OUTPUT 4: SYSTEM-CALL MAPPING

**ZERO new system calls.**

| Spec Item | System Call | How Phase 11 Hooks In |
|-----------|------------|----------------------|
| 11.1 sqlite-vec | None (initialization) | `load(db)` at createLimen(), behind try/catch |
| 11.2 Embedding generation | SC-11 (assertClaim) | Queue pending embedding after INSERT |
| 11.3 Semantic search | SC-4 (searchClaims) | New mode in existing search handler |
| 11.4 Hybrid search | SC-4 (searchClaims) | Combined FTS5 + vector in search handler |
| 11.5 Duplicate detection | SC-11 (assertClaim) | Pre-INSERT similarity check |

### New API Methods (convenience surface)

| Method | Description |
|--------|-------------|
| `limen.embedPending()` | Process pending embedding queue |
| `limen.embeddingStats()` | Return embedding count, pending count, model info |

---

## OUTPUT 5: ERROR TAXONOMY

| Code | When | Severity |
|------|------|----------|
| `VECTOR_NOT_AVAILABLE` | Semantic search attempted without sqlite-vec | Informational |
| `VECTOR_DIMENSION_MISMATCH` | Embedding vector length !== configured dimensions | Blocking |
| `VECTOR_PROVIDER_FAILED` | Embedding provider function threw | Non-blocking (claim still asserts) |
| `VECTOR_NO_EMBEDDINGS` | Semantic search with zero embeddings | Informational |
| `DUPLICATE_DETECTED` | Cosine similarity >= threshold at assertion | Configurable (warn or reject) |

---

## OUTPUT 6: SCHEMA DESIGN

### Migration 035: Vector Search

```sql
-- 6.1: vec0 virtual table for claim embeddings
-- Only created if sqlite-vec is loaded. Conditional creation.
CREATE VIRTUAL TABLE IF NOT EXISTS claim_embeddings USING vec0(
  claim_id TEXT PRIMARY KEY,
  embedding float[768]  -- dimensions configurable at migration time
);

-- 6.2: Embedding metadata table (always created, even without sqlite-vec)
CREATE TABLE IF NOT EXISTS embedding_metadata (
  claim_id    TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  model_id    TEXT NOT NULL,
  dimensions  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  FOREIGN KEY (claim_id) REFERENCES claim_assertions(id)
);

-- 6.3: Pending embeddings queue
CREATE TABLE IF NOT EXISTS embedding_pending (
  claim_id    TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  content     TEXT NOT NULL,    -- the text to embed (subject + predicate + objectValue)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  FOREIGN KEY (claim_id) REFERENCES claim_assertions(id)
);

-- 6.4: Indexes
CREATE INDEX IF NOT EXISTS idx_embedding_meta_model ON embedding_metadata(model_id);
CREATE INDEX IF NOT EXISTS idx_embedding_pending_created ON embedding_pending(created_at);

-- 6.5: Tenant isolation triggers
CREATE TRIGGER IF NOT EXISTS embedding_metadata_tenant_immutable
  BEFORE UPDATE OF tenant_id ON embedding_metadata
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on embedding_metadata');
  END;
```

### Schema Notes

- The `vec0` table creation is CONDITIONAL — only runs if sqlite-vec is loaded
- If sqlite-vec is not installed, `embedding_metadata` and `embedding_pending` still exist (for tracking state)
- Dimensions in vec0 are set at table creation time — changing dimensions requires dropping and recreating
- The `content` field in `embedding_pending` stores the pre-computed text for embedding (avoids re-querying claims)
- `claim_id` is the primary key for both metadata and vec0 — 1:1 with claims

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### Dependencies (what Phase 11 uses)

| Phase | What | How |
|-------|------|-----|
| Phase 0 (Kernel) | DatabaseConnection, TimeProvider | Schema, queries |
| Phase 2 (FTS5) | Search infrastructure, BM25 scoring | Hybrid ranking combines with FTS5 |
| Phase 3 (Cognitive) | effectiveConfidence, decay | Hybrid score incorporates confidence |
| Phase 9 (Security) | PII detection, SecurityPolicy | Embedding content should NOT include PII-redacted fields |
| Phase 10 (Governance) | GDPR erasure, classification | Erasure deletes embeddings, classification filters search |

### Dependents (future phases)

| Phase | What | How |
|-------|------|-----|
| Phase 12 (Cognitive) | Embeddings exist | Consolidation uses cosine similarity, auto-connection uses KNN |

### Integration Points

1. **assertClaim hook**: After successful INSERT, queue embedding pending (same transaction)
2. **search handler**: Extended with 'semantic' and 'hybrid' modes
3. **erasure engine**: Delete embeddings for tombstoned claims
4. **retraction**: No embedding deletion — filtered by status JOIN

---

## OUTPUT 8: ASSURANCE MAPPING

| Element | Class | Justification |
|---------|-------|---------------|
| Graceful degradation without sqlite-vec | CONSTITUTIONAL | Core must work without optional dep |
| Embedding deletion on GDPR erasure | CONSTITUTIONAL | Privacy — derived content must be destroyed |
| Embedding pending queue atomicity | CONSTITUTIONAL | Queue insert in same transaction as claim |
| Dimension mismatch rejection | CONSTITUTIONAL | Wrong-size vectors corrupt the vec0 table |
| Duplicate detection threshold | QUALITY_GATE | Tunable, statistical |
| Hybrid ranking quality | QUALITY_GATE | Benchmark-driven |
| Semantic search relevance | QUALITY_GATE | Depends on provider quality |
| Model staleness detection | DESIGN_PRINCIPLE | Warning, not blocking |

---

## IMPLEMENTATION SEQUENCE

1. Vector types
2. Migration 035 (conditional vec0 creation)
3. Vector store (vec0 CRUD + KNN queries)
4. Embedding queue (pending table management + batch processing)
5. Hybrid ranker (combine BM25 + cosine)
6. Duplicate detector (pre-assertion similarity check)
7. Wire into assertClaim (queue pending + duplicate check)
8. Extend search handler (semantic + hybrid modes)
9. Wire into createLimen (sqlite-vec load, provider config)
10. Wire into erasure engine (delete embeddings)
11. Tests

---

## HONEST LIMITATIONS

1. **Brute-force KNN** — O(n) scan. Acceptable for < 100K claims. ANN indexes (DiskANN) in sqlite-vec v0.1.10 will improve this.
2. **No built-in embedding model** — caller provides the provider function. This is a feature (zero dependencies), not a limitation.
3. **Deferred embeddings** — claims are searchable by keyword immediately but by meaning only after embedding. Cold start is real.
4. **Single embedding per claim** — no multi-model or multi-representation support in v1. Future enhancement.
5. **Dimensions fixed at creation** — changing embedding model requires re-embedding all claims.
6. **Hybrid ranking weights are static** — no learned/adaptive ranking in v1.

---

*SolisHQ — We innovate, invent, then disrupt.*
