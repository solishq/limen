# PHASE 5 DEFECT-CLASS DECLARATION: Reasoning

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: docs/sprints/PHASE-5-DESIGN-SOURCE.md
**Governing Documents**: CLAUDE.md (29 Hard Bans, 9 Mandatory Categories, Amendment 21)

---

## Defect-Class Table

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P5-101 | reasoning field stored at creation MUST be returned unchanged in all query paths (recall, search, queryClaims). Silent data loss = constitutional violation. | 1: Data Integrity | CBM | INSERT stores reasoning; SELECT projects it; BeliefView maps it. | I-P5-01, I-P5-02 | Success: remember(s,p,v,{reasoning:"R"}) -> recall returns reasoning="R". Rejection: N/A (no rejection path -- presence/absence, not enforcement). |
| DC-P5-102 | reasoning column is immutable after creation. UPDATE of reasoning MUST be rejected by the CCP-I1 trigger extension. | 2: State Consistency | CBM | SQLite BEFORE UPDATE trigger includes reasoning in protected column set. | I-P5-01, CCP-I1 | **[A21]** Success: INSERT with reasoning succeeds. Rejection: UPDATE reasoning on existing claim -> RAISE(ABORT) with CCP-I1 error. |
| DC-P5-103 | reasoning exceeding MAX_REASONING_LENGTH (1000 chars) in RememberOptions MUST be rejected with CONV_REASONING_TOO_LONG. | 1: Data Integrity | CBM | Convenience layer length check before ClaimCreateInput construction. | I-P5-07 | **[A21]** Success: remember(s,p,v,{reasoning:"short"}) succeeds. Rejection: remember(s,p,v,{reasoning: "x".repeat(1001)}) -> error code CONV_REASONING_TOO_LONG, no claim created. |
| DC-P5-104 | cognitive.health().totalClaims MUST equal actual count of active claims. Off-by-one or stale cache = constitutional defect. | 1: Data Integrity | CBM | SQL COUNT(*) with status='active' filter, no caching. | I-P5-03 | **[A21]** Success: After N remember() calls, totalClaims === N. Rejection: After retract, totalClaims decreases by 1. |
| DC-P5-105 | cognitive.health().freshness distribution MUST be exhaustive: fresh + aging + stale === totalClaims. | 1: Data Integrity | CBM | SQL CASE WHEN classification matching freshness.ts thresholds. | I-P5-04 | **[A21]** Success: Distribution sums to totalClaims. Rejection: N/A (mathematical invariant, not enforcement gate). |
| DC-P5-106 | cognitive.health() on empty knowledge base MUST return all-zero values. No NaN, no undefined, no division-by-zero. | 1: Data Integrity | CBM | Guard: if totalClaims === 0, return zero-filled report. Median/mean return 0. | I-P5-06 | **[A21]** Success: Empty DB -> totalClaims=0, mean=0, median=0, percentFresh=0. Rejection: N/A (no rejection path -- zero handling). |
| DC-P5-107 | cognitive.health().conflicts.unresolved MUST count only contradicts relationships where BOTH claims are active. Retracted claim pairs must not inflate count. | 1: Data Integrity | CBM | SQL JOIN claim_assertions on both from_claim_id and to_claim_id filtering status='active'. | I-P5-05 | **[A21]** Success: Two active conflicting claims -> unresolved=1. Rejection: Retract one claim -> unresolved=0. |
| DC-P5-108 | Migration MUST be additive only. No column drops, no table drops, no existing data modification. | 6: Migration/Evolution | CBM | ALTER TABLE ADD COLUMN + DROP/CREATE TRIGGER only. No destructive DDL. | I-P5-10 | Success: Migration runs on existing database without data loss. Rejection: N/A (structural -- migration SQL is auditable). |
| DC-P5-109 | Phase 5 introduces ZERO new system calls. If a new system call is added, it is a spec violation. | 4: Authority/Governance | CBM | cognitive.health() delegates to SQL aggregation, not a new system call. | Output 4 | Success: All operations use existing SC-11/SC-13 or direct SQL. Rejection: N/A (structural constraint). |
| DC-P5-110 | All existing tests MUST pass after Phase 5 changes. Zero regressions. | 1: Data Integrity | CBM | CI gate: full test suite. | I-P5-11 | Success: Full suite passes. Rejection: Any test failure = build blocked. |
| DC-P5-201 | Claim lifecycle remains forward-only (active -> retracted). Adding reasoning column MUST NOT create new state transitions. | 2: State Consistency | CBM | reasoning is content, not lifecycle. No new triggers or state machines. | CCP-I2 | N/A (no new transitions introduced). |
| DC-P5-301 | cognitive.health() is read-only. Concurrent calls during active claim mutations MUST NOT corrupt data or deadlock. | 3: Concurrency | CBM | All health queries are SELECT-only. SQLite WAL mode handles reader-writer concurrency. | — | N/A (read-only operation, SQLite WAL provides isolation). |
| DC-P5-401 | cognitive.health() MUST NOT bypass tenant isolation. Health report scoped to the OperationContext tenant. | 4: Authority/Governance | CBM | All SQL queries include tenant_id filter from OperationContext. | FM-10 | **[A21]** Success: Tenant A's health report excludes Tenant B's claims. Rejection: Cross-tenant claims not counted. |
| DC-P5-501 | reasoning field MUST appear in audit trail when claim is asserted. Missing reasoning in audit = observability gap. | 5: Causality/Observability | CBD | Audit detail includes reasoning field in claim_asserted event. | CCP-I9 | N/A (audit append is existing behavior; reasoning flows through input). |
| DC-P5-601 | Migration v41 trigger recreation MUST exactly match the existing trigger's protected columns plus reasoning. Omitting a column from the recreated trigger = immutability regression. | 6: Migration/Evolution | CBM | Migration SQL verified against 019_ccp_claims.ts trigger definition. | CCP-I1 | **[A21]** Success: After migration, UPDATE on subject still rejected. Rejection: After migration, UPDATE on reasoning rejected. |
| DC-P5-701 | reasoning text is user-provided free text. It MUST NOT be interpreted as SQL, HTML, or any executable format. | 7: Credential/Secret | N/A | reasoning stored as TEXT via parameterized query. No interpretation. | — | N/A -- NOT APPLICABLE: reasoning is stored via parameterized SQL (no injection vector). No credentials stored in reasoning field. |
| DC-P5-801 | confidence.mean and confidence.median calculations MUST use mathematically correct formulas. Off-by-one in median offset = quality defect. | 8: Behavioral/Model Quality | CBM | Mean: SUM(confidence)/COUNT(*). Median: ORDER BY confidence LIMIT 1 OFFSET (count/2). | I-P5-03 | **[A21]** Success: Known distribution -> expected mean/median. Rejection: N/A (QUALITY_GATE, not enforcement). |
| DC-P5-802 | gaps detection MUST NOT return false positives for domains that have recent claims. | 8: Behavioral/Model Quality | CBM | SQL GROUP BY domain with MAX(valid_at) > threshold filter. | I-P5-08 | **[A21]** Success: Domain with recent claim not in gaps list. Rejection: Domain with only old claims appears in gaps. |
| DC-P5-901 | cognitive.health() at 100K claims MUST complete in <200ms. Unbounded scan = availability risk. | 9: Availability/Resource | CBD | SQL aggregation with indexes (no row-by-row processing). Performance test. | Perf Budget | N/A (QUALITY_GATE -- performance budget, not enforcement gate). |

---

## Category Coverage

| # | Category | DCs | Status |
|---|---|---|---|
| 1 | Data Integrity | DC-P5-101, DC-P5-103, DC-P5-104, DC-P5-105, DC-P5-106, DC-P5-107, DC-P5-108, DC-P5-110 | COVERED |
| 2 | State Consistency | DC-P5-102, DC-P5-201 | COVERED |
| 3 | Concurrency | DC-P5-301 | COVERED |
| 4 | Authority/Governance | DC-P5-109, DC-P5-401 | COVERED |
| 5 | Causality/Observability | DC-P5-501 | COVERED |
| 6 | Migration/Evolution | DC-P5-108, DC-P5-601 | COVERED |
| 7 | Credential/Secret | DC-P5-701 | NOT APPLICABLE: No credentials. Reasoning stored via parameterized SQL. |
| 8 | Behavioral/Model Quality | DC-P5-801, DC-P5-802 | COVERED |
| 9 | Availability/Resource | DC-P5-901 | COVERED |

---

## Self-Audit (Method Quality)

- [x] Every DC derived from spec (Design Source or invariants)
- [x] All 9 categories covered (HB#15)
- [x] All enforcement DCs marked with [A21]
- [x] Completeness judgment deferred to Breaker (HB#23)

---

*SolisHQ -- We innovate, invent, then disrupt.*
