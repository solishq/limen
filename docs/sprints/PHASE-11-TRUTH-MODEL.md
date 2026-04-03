# Phase 11: Vector Search — Truth Model

**Date**: 2026-04-03
**Criticality**: Tier 2 with Tier 1 inheritance
**Design Source**: PHASE-11-DESIGN-SOURCE.md

---

## Graceful Degradation Invariants

### I-P11-01: Core Independence
**Limen MUST function fully without sqlite-vec installed.** remember(), recall(), forget(), search({mode:'fulltext'}), export, import, governance — all MUST work. Vector features return informational errors, never crashes.
**Assurance**: CONSTITUTIONAL

### I-P11-02: Semantic Search Requires sqlite-vec
**search({mode:'semantic'}) MUST return VECTOR_NOT_AVAILABLE when sqlite-vec is not loaded.** It MUST NOT crash, hang, or return empty results without explanation.
**Assurance**: CONSTITUTIONAL

### I-P11-03: Hybrid Fallback
**search({mode:'hybrid'}) without sqlite-vec MUST fall back to fulltext search and return results.** The caller receives fulltext results with a flag indicating vector was unavailable.
**Assurance**: CONSTITUTIONAL

---

## Embedding Storage Invariants

### I-P11-10: Embedding Fidelity
**The vector stored in vec0 MUST be identical to the vector returned by the provider.** No normalization, truncation, or modification. The provider's output is stored as-is.
**Assurance**: CONSTITUTIONAL

### I-P11-11: Dimension Enforcement
**IF the provider returns a vector with length !== configured dimensions, the embedding MUST be rejected with VECTOR_DIMENSION_MISMATCH.** The vec0 table MUST NOT contain wrong-sized vectors.
**Assurance**: CONSTITUTIONAL

### I-P11-12: Pending Queue Atomicity
**The embedding_pending INSERT MUST occur in the same SQLite transaction as the claim INSERT.** There MUST be no state where a claim exists without a corresponding pending record (when vector is enabled and claim assertion succeeds).
**Assurance**: CONSTITUTIONAL

### I-P11-13: Model Identity
**Every stored embedding MUST record the model_id in embedding_metadata.** When the configured model_id changes, existing embeddings are detectable as stale.
**Assurance**: CONSTITUTIONAL

---

## Search Invariants

### I-P11-20: Retracted Exclusion
**Retracted claims MUST NOT appear in semantic or hybrid search results.** The vec0 KNN query MUST JOIN with claim_assertions WHERE status='active'.
**Assurance**: CONSTITUTIONAL

### I-P11-21: Tenant Isolation
**Semantic search MUST be tenant-isolated.** The vec0 KNN query MUST filter by tenant_id matching the caller's context. Cross-tenant embedding leakage is a data breach.
**Assurance**: CONSTITUTIONAL

### I-P11-22: KNN Ordering
**Semantic search results MUST be ordered by cosine similarity descending (most similar first).**
**Assurance**: CONSTITUTIONAL

### I-P11-23: Hybrid Ranking
**Hybrid search MUST combine FTS5 BM25 score and vector cosine similarity using configurable weights.** The default weights are fts5=0.4, vector=0.6. Claims appearing in both result sets receive a combined score. Claims in only one set receive a weighted score from that signal alone.
**Assurance**: QUALITY_GATE

---

## GDPR / Privacy Invariants

### I-P11-30: Tombstone Deletes Embedding
**When a claim is tombstoned (GDPR erasure), its embedding MUST be hard-deleted from the vec0 table AND its metadata row MUST be deleted from embedding_metadata.** The content that generated the embedding no longer exists — the embedding (a projection of that content) MUST also not exist.
**Assurance**: CONSTITUTIONAL

### I-P11-31: Tombstone Clears Pending
**When a claim is tombstoned before its embedding is generated, its pending record MUST be removed from embedding_pending.** No embedding should ever be generated for a tombstoned claim.
**Assurance**: CONSTITUTIONAL

---

## Duplicate Detection Invariants

### I-P11-40: Duplicate Threshold
**IF duplicate detection is enabled (threshold > 0) AND the nearest existing embedding has cosine similarity >= threshold for the same predicate, THEN assertClaim MUST return DUPLICATE_DETECTED.**
**Assurance**: QUALITY_GATE (threshold is tunable)

### I-P11-41: Duplicate Tenant Isolation
**Duplicate detection MUST only compare within the same tenant.** A claim in tenant A MUST NOT be flagged as duplicate of a claim in tenant B.
**Assurance**: CONSTITUTIONAL

### I-P11-42: Duplicate Detection Disabled
**IF duplicateThreshold === 0 OR vector is unavailable, duplicate detection MUST be completely skipped.** No performance overhead, no false positives.
**Assurance**: CONSTITUTIONAL

---

## Embedding Queue Invariants

### I-P11-50: Idempotent Processing
**Calling embedPending() multiple times MUST be safe.** A claim that already has an embedding MUST NOT be re-embedded. A claim in the pending queue MUST be processed exactly once.
**Assurance**: CONSTITUTIONAL

### I-P11-51: Provider Failure Isolation
**IF the embedding provider throws for one claim, it MUST NOT prevent other pending claims from being processed.** Failed claims remain in the pending queue for retry.
**Assurance**: CONSTITUTIONAL

### I-P11-52: Batch Size Limit
**embedPending() MUST process at most `batchSize` claims per invocation.** This prevents unbounded memory usage from large pending queues.
**Assurance**: CONSTITUTIONAL

---

## Summary: 22 invariants — 17 CONSTITUTIONAL, 5 QUALITY_GATE

*SolisHQ — We innovate, invent, then disrupt.*
