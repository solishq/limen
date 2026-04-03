# Phase 11: Vector Search — Defect Class Declaration

**Date**: 2026-04-03
**Criticality**: Tier 2 with Tier 1 inheritance (data integrity, GDPR)
**Design Source**: PHASE-11-DESIGN-SOURCE.md

---

## 1. Data Integrity

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-101 | Embedding stored in vec0 matches provider output exactly | CRITICAL | Assert: embed claim → read back from vec0 → vector matches. |
| DC-P11-102 | Embedding metadata records model_id and dimensions | HIGH | Assert: embed → metadata row has correct model_id + dimensions. |
| DC-P11-103 | Pending queue entry created in same transaction as claim | CRITICAL | Assert: assertClaim → pending row exists. Reject: claim INSERT fails → no pending row. |
| DC-P11-104 | Embedding deleted when claim tombstoned (GDPR) | CRITICAL | Assert: tombstone claim → embedding absent from vec0. |
| DC-P11-105 | Pending entry removed when claim tombstoned before embedding | HIGH | Assert: tombstone pending claim → no pending row, no vec0 row. |

## 2. State Consistency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-201 | Embedding lifecycle: PENDING → EMBEDDED → EXCLUDED/DELETED only | HIGH | Assert: each transition valid. Reject: no backward transitions. |
| DC-P11-202 | Retracted claim embedding excluded from search results | CRITICAL | Assert: retract → semantic search does not return it. |
| DC-P11-203 | embedPending() is idempotent — reprocessing same claim is safe | MEDIUM | Assert: call twice → one embedding, no error. |

## 3. Concurrency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-301 | Pending queue + claim INSERT atomic (same transaction) | HIGH | SQLite serialized writes. STRUCTURAL + test. |
| DC-P11-302 | embedPending() batch processing doesn't block assertClaim | MEDIUM | Documented: SQLite WAL mode or serialized — no concurrent write concern for embedded. |

## 4. Authority / Governance

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-401 | Duplicate detection: similarity >= threshold returns DUPLICATE_DETECTED | HIGH | Assert: near-identical claim → DUPLICATE_DETECTED. Reject: different claim → passes. |
| DC-P11-402 | Duplicate detection respects tenant isolation | HIGH | Assert: same content, different tenant → not flagged as duplicate. |
| DC-P11-403 | Duplicate detection disabled when threshold = 0 | MEDIUM | Assert: threshold 0 → no duplicate check, claim stored. |

## 5. Causality / Observability

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-501 | embeddingStats() returns accurate counts | MEDIUM | Assert: embed 3 claims → stats shows embedded=3, pending=0. |
| DC-P11-502 | VECTOR_PROVIDER_FAILED logged but claim still asserts | HIGH | Assert: provider throws → claim stored, embedding pending, error logged. |

## 6. Migration / Evolution

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-601 | Migration 035 additive — existing claims unaffected | CRITICAL | Assert: pre-existing claims accessible, no schema errors. |
| DC-P11-602 | vec0 table creation conditional on sqlite-vec availability | HIGH | Assert: without sqlite-vec → metadata + pending tables exist, vec0 does not. |

## 7. Credential / Secret

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-701 | Embedding content does NOT include tombstoned/purged text | HIGH | Assert: tombstoned claim → pending content cleared, vec0 row deleted. |

## 8. Behavioral / Model Quality

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-801 | Semantic search returns relevant claims by meaning | HIGH | Assert: search "pet" finds claim about "dog" (via embedding similarity). |
| DC-P11-802 | Hybrid search outperforms or equals fulltext alone | MEDIUM | Assert: hybrid finds claims that fulltext misses (synonym case). |
| DC-P11-803 | Dimension mismatch rejected with VECTOR_DIMENSION_MISMATCH | HIGH | Assert: wrong-size vector → error. Reject: correct size → stored. |
| DC-P11-804 | KNN returns results ordered by cosine similarity descending | HIGH | Assert: closest match first. |

## 9. Availability / Resource

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P11-901 | Graceful degradation: core works without sqlite-vec | CRITICAL | Assert: createLimen without sqlite-vec → remember/recall/search(fulltext) all work. |
| DC-P11-902 | search({ mode: 'semantic' }) without sqlite-vec → VECTOR_NOT_AVAILABLE | HIGH | Assert: clear error, no crash. |
| DC-P11-903 | search({ mode: 'hybrid' }) without sqlite-vec → fallback to fulltext | HIGH | Assert: returns fulltext results, no error. |
| DC-P11-904 | KNN query < 50ms for 10K embeddings | MEDIUM | Benchmark. |

---

## Summary: 28 DCs — 5 CRITICAL, 13 HIGH, 6 MEDIUM, 0 LOW

*SolisHQ — We innovate, invent, then disrupt.*
