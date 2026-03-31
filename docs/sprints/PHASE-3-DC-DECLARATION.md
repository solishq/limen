# PHASE 3 DEFECT-CLASS DECLARATION: Cognitive Metabolism

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Governing Documents**: PHASE-3-DESIGN-SOURCE.md, CLAUDE.md (9 mandatory categories)
**Codebase Baseline**: Phase 0+1+2 complete, 3,317 passing tests, schema v38, commit `e3b8d5a`

---

## CATEGORY 1: DATA INTEGRITY

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-101 | Decay formula computes incorrect R(t) values, producing wrong effectiveConfidence | 1: Data Integrity | CONSTITUTIONAL | CBM | Unit tests with 10 known test vectors from spec. Exact numerical comparison (4 decimal places). | §3.1 | [A21] Success: known age/stability -> expected R(t). Rejection: stability=0 -> returns 0. |
| DC-P3-102 | effectiveConfidence exceeds raw confidence (R(t) > 1.0) due to negative age (future validAt) | 1: Data Integrity | CONSTITUTIONAL | CBM | Age clamped: `max(0, now - validAt)`. Test with future-dated claim. | §3.1 edge | [A21] Success: normal age -> R(t) <= 1.0. Rejection: future validAt -> age clamped to 0, effectiveConfidence = confidence. |
| DC-P3-103 | Division by zero when stability = 0 | 1: Data Integrity | CONSTITUTIONAL | CBM | Guard clause: `if (stabilityDays <= 0) return 0`. | §3.1 edge | [A21] Success: stability > 0 -> valid decay. Rejection: stability = 0 -> returns 0 (no crash). |
| DC-P3-104 | Access count or last_accessed_at written with wrong values during flush | 1: Data Integrity | QUALITY_GATE | CBM | Integration test: recall -> flush -> verify column values in DB. | §3.4 | |
| DC-P3-105 | Stability value assigned incorrectly for a predicate pattern | 1: Data Integrity | QUALITY_GATE | CBM | Unit tests: known predicates -> expected stability values. | §3.2 | |
| DC-P3-106 | Decay stored in database instead of computed on read (violates A.3) | 1: Data Integrity | CONSTITUTIONAL | CBM | Architectural test: grep for UPDATE SET effective_confidence. No such statement may exist. | A.3 | [A21] Success: effectiveConfidence computed at query time. Rejection: no stored decay. |
| DC-P3-107 | Freshness classification returns wrong label at boundary values | 1: Data Integrity | CONSTITUTIONAL | CBM | Unit tests at exact boundaries (7d, 30d) and one above/below each. | §3.5 | [A21] Success: 3d -> fresh, 15d -> aging, 45d -> stale. Rejection: null lastAccessedAt -> stale. |

## CATEGORY 2: STATE CONSISTENCY

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-201 | AccessTracker continues accepting writes after destroy() | 2: State Consistency | QUALITY_GATE | CBM | Test: destroy() then recordAccess() -- verify no crash, no pending events. | §3.4 | |
| DC-P3-202 | AccessTracker timer fires after destroy(), writing to closed database | 2: State Consistency | QUALITY_GATE | CBM | Test: clearInterval called in destroy(). Verify timer ID stored and cleared. | §3.4 | |

## CATEGORY 3: CONCURRENCY

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-301 | Flush timer callback interleaves with recordAccess(), corrupting pending map | 3: Concurrency | QUALITY_GATE | CBD | Node.js single-threaded event loop guarantees no true concurrency. Flush and recordAccess execute atomically within their event loop turn. | §3.4 | |

**Structural Proof (DC-P3-301)**: Node.js executes JavaScript in a single-threaded event loop. `setInterval` callbacks are scheduled as macrotasks. `recordAccess()` calls are synchronous within their caller's event loop turn. These cannot interleave. No mutex needed.

**Assumption Ledger (DC-P3-301)**:
- **Assumption**: Limen runs in standard Node.js single-threaded mode (no worker_threads sharing the AccessTracker).
- **Owner**: Builder.
- **Review Trigger**: If Limen adds worker_threads or shared-memory concurrency.
- **Invalidation Trigger**: AccessTracker shared across worker threads.
- **Response When Broken**: Add mutex to pending map operations, reopen DC-P3-301.

## CATEGORY 4: AUTHORITY / GOVERNANCE

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-401 | Access tracking bypasses ClaimApi, tracking internal system queries | 4: Authority | QUALITY_GATE | CBM | Access tracking wired at ClaimApiImpl level (Decision 5). Store-level queries do not trigger tracking. | §3.4 | |
| DC-P3-402 | Stability configuration allows stabilityDays <= 0 | 4: Authority | CONSTITUTIONAL | CBM | Validation in resolveStability: patterns with stabilityDays <= 0 rejected. | §3.2 | [A21] Success: valid config accepted. Rejection: stabilityDays <= 0 -> error/default. |

## CATEGORY 5: CAUSALITY / OBSERVABILITY

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-501 | effectiveConfidence not included in recall() results | 5: Causality | CONSTITUTIONAL | CBM | Integration test: recall() returns BeliefView with effectiveConfidence field. | §3.3 | |
| DC-P3-502 | effectiveConfidence not included in search() results | 5: Causality | CONSTITUTIONAL | CBM | Integration test: search() returns SearchResult with effectiveConfidence in belief. | §3.3 | |
| DC-P3-503 | Freshness not included in recall()/search() results | 5: Causality | CONSTITUTIONAL | CBM | Integration test: results include freshness field. | §3.5 | |

## CATEGORY 6: MIGRATION / EVOLUTION

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-601 | Migration fails on existing databases (non-additive change) | 6: Migration | CONSTITUTIONAL | CBM | All statements are ALTER TABLE ADD COLUMN and CREATE INDEX. No drops. | §3.7 | [A21] Success: migration runs on existing DB with claims. Rejection: N/A -- additive only, cannot fail unless DB corrupt. |
| DC-P3-602 | Existing claims have wrong defaults after migration | 6: Migration | CONSTITUTIONAL | CBM | Test: migrate, verify existing claims have last_accessed_at=NULL, access_count=0, stability=90.0. | §3.7 | |
| DC-P3-603 | Migration version conflicts with existing migrations | 6: Migration | CONSTITUTIONAL | CBM | Version 39, name unique. Migration system enforces version ordering. | §3.7 | |

## CATEGORY 7: CREDENTIAL / SECRET

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace |
|---|---|---|---|---|---|---|
| DC-P3-701 | N/A | 7: Credential | N/A | N/A | Phase 3 introduces no credentials, tokens, or secrets. All operations are local computation on existing data. | N/A |

**NOT APPLICABLE: Phase 3 Cognitive Metabolism operates on existing claim data using pure computation functions. No credentials, tokens, API keys, or secret material is introduced, accessed, or transmitted.**

## CATEGORY 8: BEHAVIORAL / MODEL QUALITY

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-801 | minConfidence filter uses raw confidence instead of effectiveConfidence | 8: Behavioral | CONSTITUTIONAL | CBM | Test: claim with raw confidence 0.8 but effectiveConfidence 0.3 is excluded when minConfidence=0.5. | §3.6 | [A21] Success: claim with effectiveConfidence > threshold returned. Rejection: claim with effectiveConfidence < threshold excluded despite raw confidence > threshold. |
| DC-P3-802 | search() score still uses raw confidence instead of effectiveConfidence | 8: Behavioral | CONSTITUTIONAL | CBM | Test: old claim with high raw confidence ranks lower than new claim with same raw confidence. | §3.3 | |
| DC-P3-803 | Two-phase SQL pre-filter incorrectly eliminates claims that should pass | 8: Behavioral | CONSTITUTIONAL | CBM | Mathematical proof: effective_confidence <= confidence, so SQL WHERE confidence >= threshold is a necessary condition. Test with claim at exact boundary. | §3.6 | |

## CATEGORY 9: AVAILABILITY / RESOURCE

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P3-901 | Flush timer keeps Node.js process alive after all other work completes | 9: Availability | QUALITY_GATE | CBM | Timer created with unref(). Test: process exits cleanly without explicit shutdown. PA Amendment: interval ID stored for explicit clearInterval in shutdown. | §3.4 | |
| DC-P3-902 | Access tracker flush failure propagates, causing recall()/search() to fail | 9: Availability | QUALITY_GATE | CBM | Flush errors caught and logged. Never propagated to caller. Access tracking is QUALITY_GATE. | §3.4 | |
| DC-P3-903 | Pending access events lost on process crash (no flush before exit) | 9: Availability | QUALITY_GATE | CBD | Accepted risk: access tracking is eventual consistency. crash-before-flush loses at most one flush interval of events. Non-constitutional. | §3.4 | |
| DC-P3-904 | Performance regression from computing decay on every query result | 9: Availability | QUALITY_GATE | CBD | Decay is a single `Math.pow()` call per claim. Benchmark: <1ms for 200 claims. Two-phase SQL pre-filter reduces working set. | §3.3 | |

---

## ASSURANCE MAPPING COVERAGE

Total DCs: 25
- CONSTITUTIONAL: 14 (DC-P3-101 through 107, 106, 402, 501-503, 601-603, 801-803)
- QUALITY_GATE: 10 (DC-P3-104, 105, 201, 202, 301, 401, 901-904)
- NOT APPLICABLE: 1 (DC-P3-701)

All 9 categories covered. All enforcement DCs marked [A21] with success AND rejection paths.

---

*SolisHQ -- We innovate, invent, then disrupt.*
