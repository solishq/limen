# Phase 11: Vector Search -- Breaker Pass B Report

**Date**: 2026-04-03
**Breaker**: SolisHQ Breaker Agent
**Target**: Phase 11 Vector Search (6 source files, 1 migration, 60 builder tests)
**Criticality**: Tier 2 with Tier 1 inheritance (data integrity, GDPR)

---

## Prompt Audit Gate

No issues with the prompt. Attack vectors well-defined. Priority targets correctly identified.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Checks | Key Findings | Status |
|------|------|-----------------|--------|--------------|--------|
| OG-THREAT | oracle_threat_model | PASS | 15/15 | 7 STRIDE threats identified, 3 partially mitigated | COMPLETED |
| OG-FMEA | oracle_fmea | -- | -- | Deferred: mutation testing provided direct failure evidence | SKIPPED (optional) |

### Oracle-Informed Findings

OG-THREAT identified information disclosure (cross-tenant) and elevation of privilege (injection) as partially mitigated. Cross-referencing with mutation results: the tenant isolation filter in KNN (I-P11-21) is completely untested (M-2 survived). This confirms the STRIDE information disclosure threat has no test defense.

---

## Mutation Testing Results (8 mutations)

| ID | Mutation | File:Line | Expected | Actual | Verdict |
|----|----------|-----------|----------|--------|---------|
| M-1 | Remove embedding enqueue from remember() | `src/api/index.ts:1434-1452` | Tests fail | 15 tests failed | **KILLED** |
| M-2 | Remove tenant filter from KNN post-filter | `src/vector/vector_store.ts:189-192` | Tests fail | 60/60 pass | **SURVIVED** |
| M-3 | Remove status='active' filter from KNN | `src/vector/vector_store.ts:197` | Tests fail | 59/60 pass (1 caught) | **KILLED** (marginal) |
| M-4 | Remove dimension validation from store() | `src/vector/vector_store.ts:67-73` | Tests fail | 60/60 pass | **SURVIVED** |
| M-5 | Remove embedding deletion from GDPR erasure | `src/governance/compliance/erasure_engine.ts:187-211` | Tests fail | 60/60 pass | **SURVIVED** |
| M-6 | Remove dimension check from KNN query vector | `src/vector/vector_store.ts:150-156` | Tests fail | 60/60 pass | **SURVIVED** |
| M-7 | Remove vectorStore from erasure engine deps | `src/api/index.ts:1312` | Tests fail | 60/60 pass | **SURVIVED** |
| M-8 | Replace threshold comparison with `candidates.length > 0` | `src/vector/duplicate_detector.ts:112` | Tests fail | 60/60 pass | **SURVIVED** |

**Kill rate: 2/8 (25%)**. This is critically low. 6 surviving mutations on CONSTITUTIONAL invariants.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|-------|---------------|-----------------|---------------------|---------|
| DC-P11-101 | Yes | Yes (no embed w/o call) | Success: non-discriminative (checks count, not vector content) | PARTIAL |
| DC-P11-102 | Yes | Yes (different modelId) | Rejection: non-discriminative (checks config, not stored metadata) | PARTIAL |
| DC-P11-103 | Yes | Yes (invalid claim) | Both discriminative | **PASS** |
| DC-P11-104 | Yes | Yes | Success: **NON-DISCRIMINATIVE** (comment admits it "confirms no crash") | **FAIL** |
| DC-P11-105 | Yes | Yes | Success: non-discriminative (doesn't verify pending deleted after tombstone) | PARTIAL |
| DC-P11-202 | Yes | No rejection test | Missing rejection path | **FAIL** |
| DC-P11-401 | Yes | Yes | Both weak: success uses `||` condition (`isDuplicate OR similarity > 0.5`) | **FAIL** |
| DC-P11-402 | Yes | Yes | Success: non-discriminative (null tenant, 0 existing claims) | **FAIL** |
| DC-P11-601 | Yes | No rejection test | Success only | **FAIL** |
| DC-P11-602 | Yes | Weak rejection | Both pass but rejection only checks stats work, not vec0 absence | PARTIAL |
| DC-P11-803 | Yes | Yes | Both discriminative | **PASS** |

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-P11-001 | **KNN tenant isolation completely untested** | **CRITICAL** | Data integrity / P-001 | M-2 survived: removing tenant filter from KNN post-filter at `vector_store.ts:189-192` caused 0 test failures | Add multi-tenant semantic search test: create claims in tenant-A, verify tenant-B search returns 0 results |
| F-P11-002 | **GDPR embedding erasure completely untested** | **CRITICAL** | Credential / GDPR | M-5 survived: removing entire embedding deletion block from `erasure_engine.ts:187-211` caused 0 failures. M-7 survived: removing vectorStore from erasure deps caused 0 failures | Add integration test with PII detection enabled: create PII claim -> embed -> erasure -> verify embeddingStats.embeddedCount === 0 |
| F-P11-003 | **Duplicate detection threshold comparison untested** | HIGH | Authority / governance | M-8 survived: replacing `c.similarity >= threshold` with `candidates.length > 0` at `duplicate_detector.ts:112` caused 0 failures | Add test: two similar but distinct texts with high threshold (0.99) -> verify isDuplicate is false when similarity < threshold |
| F-P11-004 | **KNN query dimension rejection untested** | HIGH | Behavioral / model quality | M-6 survived: removing dimension check from `vector_store.ts:150-156` caused 0 failures | Add test: search with wrong-dimension queryEmbedding -> verify VECTOR_DIMENSION_MISMATCH |
| F-P11-005 | **VectorStore.store() dimension check untested** | MEDIUM | Behavioral / model quality | M-4 survived: removing dimension check from `vector_store.ts:67-73` caused 0 failures (queue-level check fires first as defense-in-depth) | Add direct VectorStore unit test with wrong-dimension vector -> verify VECTOR_DIMENSION_MISMATCH |
| F-P11-006 | **NaN/Infinity in vectors bypass all validation** | HIGH | Data integrity | `distanceToSimilarity(NaN)` returns NaN (confirmed by test). Float32Array accepts NaN. No validation in store() or process() for NaN/Infinity vector values | Add NaN/Infinity validation in EmbeddingQueue.process() before calling store(). Fix distanceToSimilarity to handle NaN input |
| F-P11-007 | **reflect() claims never enqueued for embedding** | HIGH | Wiring gap / P-002 | `src/api/index.ts:1473-1476`: reflect() delegates to convenienceLayer.reflect() but has no embedding enqueue wiring. remember() has it at line 1434. reflect() does not | Add embedding enqueue wiring to reflect() path, or document as known limitation |
| F-P11-008 | **I-P11-12 atomicity claim is false** | MEDIUM | State consistency | `src/api/index.ts:1431-1452`: remember() calls convenienceLayer.remember() which commits the claim, then gets a NEW connection for embedding enqueue. These are two separate operations, not one atomic transaction. Comment says "same transaction scope" but implementation contradicts | Either move enqueue inside the convenience layer's transaction, or downgrade the invariant claim to "best-effort" |
| F-P11-009 | **DC-P11-104 test is non-discriminative** | HIGH | P-001 | `tests/unit/phase11_vector.test.ts:472-479`: test comment admits "The embedding may still be present if the claim wasn't flagged as PII. The wiring is verified structurally -- this confirms no crash." This is HB#8 adjacent | Replace with test that configures PII detection, creates PII claim, embeds, erases, and verifies embedding count drops to 0 |
| F-P11-010 | **distanceToSimilarity returns NaN for NaN input** | MEDIUM | Data integrity | `duplicate_detector.ts:40`: `Math.max(0, Math.min(1, NaN))` returns NaN. Confirmed by breaker test (test failed) | Add NaN guard: `if (Number.isNaN(distance)) return 0;` |
| F-P11-011 | **createVec0Table uses string interpolation for dimensions** | LOW | Migration / injection | `migration/035_vector_search.ts:113`: `` float[${dimensions}] `` — if dimensions is NaN or non-integer, creates malformed SQL | Add `dimensions = Math.floor(dimensions)` guard or validate integer |
| F-P11-012 | **Retracted claims leave orphan embeddings and pending entries** | LOW | State consistency | `forget()` at `index.ts:1463-1465` does not call vectorStore.delete(). Retracted claim's embedding persists in vec0. Pending entry persists if retraction happens before embedding | Add embedding cleanup to forget() path, or document as intentional (retraction is reversible) |
| F-P11-013 | **DC-P11-401 test uses non-discriminative assertion** | MEDIUM | P-001 | `tests/unit/phase11_vector.test.ts:673`: `assert.ok(dupResult.value.isDuplicate \|\| dupResult.value.candidates[0]!.similarity > 0.5)` — the `\|\|` means a non-duplicate with any candidate above 0.5 also passes | Assert isDuplicate specifically for the exact-match case |

---

## DC Coverage Matrix (Builder Tests)

| DC-ID | Test(s) | Discriminative? | Evidence Level |
|-------|---------|-----------------|----------------|
| DC-P11-101 | 2 tests | Partial (checks count not content) | Weak |
| DC-P11-102 | 2 tests | Partial (checks config not stored) | Weak |
| DC-P11-103 | 2 tests | Yes | Adequate |
| DC-P11-104 | 2 tests | **NO** (admits non-discriminative in comment) | **Insufficient** |
| DC-P11-105 | 2 tests | Partial (doesn't verify deletion) | Weak |
| DC-P11-201 | 1 test | Yes | Adequate |
| DC-P11-202 | 1 test | Yes (M-3 killed, but marginal) | Adequate |
| DC-P11-203 | 1 test | Yes | Adequate |
| DC-P11-301 | 1 test | Partial (checks count, not atomicity) | Weak |
| DC-P11-302 | 1 test | Yes | Adequate |
| DC-P11-401 | 2 tests | **NO** (non-discriminative `\|\|` assertion, M-8 survived) | **Insufficient** |
| DC-P11-402 | 2 tests | **NO** (null tenant only, M-2 survived) | **Insufficient** |
| DC-P11-403 | 1 test | Yes | Adequate |
| DC-P11-501 | 1 test | Yes | Adequate |
| DC-P11-502 | 1 test | Yes | Adequate |
| DC-P11-601 | 1 test | Partial | Weak |
| DC-P11-602 | 2 tests | Partial | Weak |
| DC-P11-701 | 1 test | Partial (checks embedPending skips retracted, not cleanup) | Weak |
| DC-P11-801 | 1 test | Conditional (if results > 0) | Weak |
| DC-P11-802 | 2 tests | Yes (pure function well tested) | Adequate |
| DC-P11-803 | 3 tests | Yes | Adequate |
| DC-P11-804 | 1 test | Conditional (if results >= 2) | Weak |
| DC-P11-901 | 2 tests | Yes | Adequate |
| DC-P11-902 | 2 tests | Yes | Adequate |
| DC-P11-903 | 1 test | Yes | Adequate |
| DC-P11-904 | 1 test | Benchmark only | Quality gate |

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative enforcement tests | Yes | **FOUND**: DC-P11-104 admits non-discriminative. DC-P11-401 uses `\|\|` assertion. DC-P11-402 tests null tenant only. Multiple conditional assertions (`if results > 0`). |
| P-002 | Defense built but not wired in | Yes | **FOUND**: reflect() has no embedding enqueue wiring (F-P11-007). VectorStore.store() dimension guard never exercised by tests (M-4 survived). |
| P-003 | IBC overclaims | Yes | **FOUND**: I-P11-12 claims "same transaction" but implementation is two separate operations (F-P11-008). |
| P-004 | Test rewrite drops coverage | Not applicable | N/A (first test file for Phase 11) |
| P-005 | Phantom test references | Yes | No phantoms found. All DC references map to tests. |
| P-006 | Cross-subsystem boundary gaps | Yes | **FOUND**: Erasure engine -> VectorStore boundary has zero tests (M-5, M-7 survived). reflect() -> EmbeddingQueue boundary has zero wiring. |
| P-007 | FM numbering collisions | Yes | No collisions. |
| P-008 | Documentation in session only | Yes | DC declaration and truth model are committed. |
| P-009 | Prompt audit gate | Yes | Present in prompt. |
| P-010 | Implementation logic in harness | Yes | No harness file for Phase 11. Tests call API directly. Clean. |

---

## Architecture-Level Findings

1. **Post-filter design creates performance cliff**: KNN fetches `k * 5` candidates and post-filters by status + tenant. If most claims are retracted or belong to other tenants, KNN may return fewer than k results despite more relevant results existing beyond the fetch window. The `Math.min(k * 5, 1000)` cap at `vector_store.ts:169` means for k=200, only 1000 candidates are considered.

2. **Single connection for KNN N+1 queries**: The post-filter at `vector_store.ts:182-206` executes one SQL query per KNN candidate (`SELECT id FROM claim_assertions WHERE id = ?`). For fetchSize=1000, this is 1000 individual queries. This should use an IN clause batch query.

---

## Security Findings

1. **No input validation on embedding provider output beyond dimension count**: The provider is user-supplied. It could return NaN, Infinity, extremely large values, or negative values. No validation beyond `vector.length !== dimensions`.

2. **String interpolation in DDL**: `createVec0Table` uses `float[${dimensions}]` — while dimensions is typed as `number`, it could be `NaN`, `Infinity`, or a float at runtime.

---

## Performance Findings

1. **N+1 query in KNN post-filter**: Each KNN candidate triggers an individual `SELECT` against `claim_assertions`. Should be batch-queried with `WHERE id IN (...)`.

2. **No index on embedding_metadata.tenant_id**: The migration creates indexes on `model_id` and `created_at` but not `tenant_id`, which would be needed for tenant-scoped embedding operations.

---

## Self-Audit

- Was every finding derived from evidence? **Yes** — all findings have file:line references and mutation results.
- What would I check to prove my findings wrong? F-P11-008 atomicity: verify if `getConnection()` returns the same underlying connection with an implicit transaction. F-P11-001: verify if multi-tenant tests exist elsewhere.
- What did I NOT examine? MCP tool layer (Phase 7 style) for vector methods. Import/export pipeline for embeddings. sqlite-vec version-specific CVEs.
- Is my finding count reasonable? **13 findings (2 CRITICAL, 5 HIGH, 4 MEDIUM, 2 LOW)** — consistent with historical average of 16.4 per subsystem.

---

## Oracle Gates Summary

| Gate | Status | Key Result |
|------|--------|------------|
| OG-THREAT | COMPLETED | PASS 15/15 — 7 STRIDE threats, 3 partially mitigated |
| OG-FMEA | SKIPPED | Optional gate, mutation testing provided direct failure evidence |

---

## Verdict

**CONDITIONAL PASS** -- 2 CRITICAL findings (F-P11-001 tenant isolation untested, F-P11-002 GDPR erasure untested) and 5 HIGH findings must be fixed before merge. The 25% mutation kill rate is critically low and indicates systematic test gaps around multi-tenant isolation, GDPR compliance, and duplicate detection thresholds.

---

*SolisHQ -- We innovate, invent, then disrupt.*
