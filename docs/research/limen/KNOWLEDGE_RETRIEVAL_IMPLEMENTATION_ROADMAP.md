# Knowledge Retrieval Implementation Roadmap

**PA Approved**: Pending
**Date**: 2026-03-29
**Derived From**: /Users/solishq/SolisHQ/Docs/KNOWLEDGE_RETRIEVAL_RESEARCH.md

---

## The Problem

Limen stores techniques via `limen_reflect`. Retrieval via `limen_recall` uses subject/predicate prefix matching only. An agent searching for "audio capture latency" cannot find a technique stored as `entity:pattern:audio-buffer-mgmt` with predicate `pattern.description` containing "CoreAudio AudioQueue buffer management reduces round-trip latency to under 10ms." The words don't match the URN.

**Root cause**: No content-level search. Claims are findable by metadata structure, not by what they actually say.

---

## Phase 1: FTS5 (NOW — at 100 claims)

### What FTS5 Does

SQLite FTS5 (Full-Text Search 5) creates an inverted index on text content. Given a query "audio capture latency," it finds all claims whose object_value contains those words, ranked by BM25 relevance (term frequency × inverse document frequency). Built into SQLite — zero external dependencies.

### What Changes in Limen

**New migration** (added to Limen's migration chain):

```sql
-- Create FTS5 virtual table mirroring claim object text
CREATE VIRTUAL TABLE IF NOT EXISTS claim_fts USING fts5(
  claim_id,
  subject,
  predicate,
  content,
  content=claim_assertions,
  content_rowid=rowid
);

-- Populate from existing claims
INSERT INTO claim_fts(claim_id, subject, predicate, content)
  SELECT id, subject, predicate, object_value FROM claim_assertions
  WHERE status = 'active';

-- Triggers to keep FTS in sync with claim lifecycle
CREATE TRIGGER claim_fts_insert AFTER INSERT ON claim_assertions BEGIN
  INSERT INTO claim_fts(claim_id, subject, predicate, content)
    VALUES (NEW.id, NEW.subject, NEW.predicate, NEW.object_value);
END;

CREATE TRIGGER claim_fts_delete AFTER UPDATE OF status ON claim_assertions
  WHEN NEW.status = 'retracted' BEGIN
    DELETE FROM claim_fts WHERE claim_id = OLD.id;
END;
```

**New system call**: `limen_search`

```
limen_search(query: string, limit?: number, minConfidence?: number)
```

- Accepts natural language query text
- Runs FTS5 `MATCH` with BM25 ranking
- Optionally filters by confidence threshold
- Returns claims ranked by relevance, not just insertion order

**Enhanced `limen_recall`**: Add an optional `query` parameter. If provided, use FTS5 instead of prefix matching. Backward compatible — existing calls without `query` work exactly as before.

### What Changes in Hooks

**SessionStart hook** (`session-opener.sh`):
Currently calls `limen_recall` with prefix wildcards:
```
limen_recall predicate="warning.*" limit=5
limen_recall predicate="decision.*" limit=5
```

Enhanced to also call:
```
limen_search query="<current project name> <current task context>" limit=10
```

This finds techniques RELEVANT to what the agent is about to work on, not just the most recent warnings/decisions.

**PreCompact hook** (`pre-compact.sh`):
After compaction, the restore instructions include:
```
limen_search query="<project> <last known task>" limit=10
```

So the agent recovers not just recent claims but RELEVANT claims.

### What Does NOT Change
- Claim storage (`limen_reflect`, `limen_remember`) — unchanged
- Claim structure (subject, predicate, object) — unchanged
- Existing `limen_recall` without query parameter — unchanged
- MCP server protocol — add `limen_search` as new tool, don't modify existing
- All existing tests — unchanged (additive migration)

### Effort
- FTS5 migration: 2 hours
- `limen_search` system call: 4 hours
- Hook updates: 2 hours
- Tests: 4 hours
- **Total: 2-3 days**

### Blast Radius
- Limen npm package: new migration + new system call (additive, non-breaking)
- Open source: new feature, no breaking changes
- All 20 projects: benefit immediately via updated hooks
- Risk: LOW — FTS5 is mature (shipped with SQLite since 3.9.0, 2015)

---

## Phase 2: Vector Hybrid (AT 1,000 CLAIMS — ~3 months)

### Automatic Trigger

**Limen monitors its own claim count.** When `SELECT COUNT(*) FROM claim_assertions WHERE status = 'active'` exceeds 750, Limen logs a warning:

```
[LIMEN] Claim count: 782. FTS5 keyword search may miss semantic matches.
Consider enabling vector hybrid retrieval (Phase 2).
See: ~/SolisHQ/Docs/KNOWLEDGE_RETRIEVAL_IMPLEMENTATION_ROADMAP.md#phase-2
```

This warning surfaces in:
1. `limen_health` response (MCP tool)
2. Infrastructure manifest (morning briefing)
3. Stderr log on session start

**Nobody has to remember.** The system tells you when it's time.

### What Changes

1. **Add sqlite-vec extension** to Limen (npm package: `sqlite-vec`)
2. **Add embedding column** to claim_assertions (BLOB, 768 dimensions × 4 bytes = 3KB per claim)
3. **Embed on insert**: when a claim is stored, compute embedding via local model
4. **Embedding model**: nomic-embed-text-v1.5 via Ollama (local, Apache 2.0, 137M params, 550MB RAM)
5. **Hybrid query**: FTS5 keyword match → vector re-rank using Reciprocal Rank Fusion (RRF)
6. **Model version tracking**: store embedding model ID with each vector. If model changes, re-embed all.

### Effort
- sqlite-vec integration: 2 days
- Embedding pipeline: 2 days
- Hybrid ranking (RRF): 1 day
- Migration + re-embed existing claims: 1 day
- **Total: 5-8 days**

### Automatic Trigger Implementation

```sql
-- Add to Limen health check query
SELECT
  (SELECT COUNT(*) FROM claim_assertions WHERE status = 'active') as claim_count,
  CASE
    WHEN (SELECT COUNT(*) FROM claim_assertions WHERE status = 'active') > 750
      AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'claim_vectors')
    THEN 'UPGRADE_RECOMMENDED: Vector hybrid retrieval (Phase 2)'
    WHEN (SELECT COUNT(*) FROM claim_assertions WHERE status = 'active') > 5000
      AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'claim_relationships_expanded')
    THEN 'UPGRADE_RECOMMENDED: Graph expansion (Phase 3)'
    ELSE 'OK'
  END as retrieval_status;
```

---

## Phase 3: Graph Expansion (AT 10,000 CLAIMS — ~1 year, CONDITIONAL)

### Automatic Trigger

Only activates if BOTH conditions are true:
1. Claim count > 5,000
2. Average relationship density > 2.0 per claim (claims have enough connections to make traversal valuable)

```sql
SELECT
  CAST(COUNT(*) AS FLOAT) / NULLIF(
    (SELECT COUNT(DISTINCT from_claim_id) FROM claim_relationships), 0
  ) as avg_relationship_density
FROM claim_relationships;
```

If density < 2.0, graph traversal won't find anything that vector search doesn't. Skip Phase 3 entirely.

### What Changes
- Recursive CTE traversal: given a seed claim, walk `supports`/`derived_from` relationships to find connected clusters
- Expand retrieval: vector finds the seed, graph finds the neighborhood
- Most complex phase — only justified by data

### Effort: 10-15 days (only if triggered)

---

## Anti-Patterns (NEVER DO)

1. **Never use cloud embedding APIs** — violates local-first privacy model. All embeddings computed locally.
2. **Never replace structured search with vector search** — structured first (fast, deterministic), vector re-ranks (slow, probabilistic). Structured is the filter, vector is the refinement.
3. **Never use ANN indexing under 100K vectors** — brute-force cosine similarity on SQLite is both faster and more accurate for small datasets. ANN (HNSW, IVF) adds complexity and approximation error.
4. **Never store embeddings without model version** — if the model changes, old embeddings are incomparable. Track `embedding_model_id` per vector. Re-embed on model change.
5. **Never embed claims shorter than 10 words** — short claims produce low-quality embeddings. Use keyword match for short claims, vector for longer ones.
6. **Never auto-delete claims based on age** — use confidence decay (reduce confidence by 0.01/month) not deletion. Old claims may become relevant again.

---

## Decision Gate Checklist

Before implementing each phase, verify:

**Phase 1 (FTS5):**
- [ ] Limen test suite passes (baseline)
- [ ] FTS5 migration is additive (no schema breaks)
- [ ] `limen_search` MCP tool follows existing tool patterns
- [ ] Backward compatibility: existing `limen_recall` unchanged
- [ ] Open source PR passes CI

**Phase 2 (Vector):**
- [ ] Claim count > 750 (automatic trigger fired)
- [ ] Ollama installed and nomic-embed-text available locally
- [ ] sqlite-vec compiles for current Node.js version
- [ ] Embedding pipeline tested on 100-claim sample
- [ ] Re-embedding migration tested and timed

**Phase 3 (Graph):**
- [ ] Claim count > 5,000
- [ ] Relationship density > 2.0 per claim
- [ ] Recursive CTE performance tested at scale
- [ ] Graph expansion adds measurable retrieval improvement over vector-only

---

## Open Source Impact

All three phases ship as Limen releases:
- Phase 1: Limen v1.3.0 (FTS5 search)
- Phase 2: Limen v1.4.0 (vector hybrid) — optional dependency on sqlite-vec
- Phase 3: Limen v1.5.0 (graph expansion) — no new dependencies

Each phase is a semver minor bump. No breaking changes. Users who don't need search continue using `limen_recall` as-is.

---

*This document is the single source of truth for knowledge retrieval evolution. Every future decision references this roadmap. Every phase trigger is automatic — nobody has to remember.*
