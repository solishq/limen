# PHASE 4: Quality & Safety — Defect-Class Declaration

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: `docs/sprints/PHASE-4-DESIGN-SOURCE.md` (APPROVED)
**Version Pin**: CLAUDE.md v2.3+A24, PHASE-4-DESIGN-SOURCE.md (2026-03-30)

---

## Assurance Mapping Reference

| Element | Assurance Class |
|---------|----------------|
| Cascade multiplier 0.5 (first-degree) | CONSTITUTIONAL |
| Cascade multiplier 0.25 (second-degree) | CONSTITUTIONAL |
| Cascade max depth 2 | CONSTITUTIONAL |
| Cascade is query-time only (never stored) | CONSTITUTIONAL |
| Retraction reason taxonomy | CONSTITUTIONAL |
| `requireRbac` default false | CONSTITUTIONAL |
| `requireRbac` enforcement | CONSTITUTIONAL |
| `.raw` audit logging | CONSTITUTIONAL |
| Contradiction review threshold 0.8 | CONSTITUTIONAL |
| Conflict detection synchronous | QUALITY_GATE |
| `.raw` SYSTEM_SCOPE gating | QUALITY_GATE |
| `disputed` bidirectional | DESIGN_PRINCIPLE |
| `autoConflict` default | DESIGN_PRINCIPLE |
| Compound index for conflict detection | DESIGN_PRINCIPLE |

---

## Category 1: Data Integrity

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-101 | Conflict detection query returns stale results due to reading outside the assertion transaction | 1: Data integrity | CONSTITUTIONAL | CBM | Conflict detection executes inside the same `conn.transaction()` as claim creation. SQLite serialized writes guarantee TOCTOU safety. | AssertClaimHandler step 17b | [A21] Success: assert claim → conflict query finds existing conflict → `contradicts` relationship created in same txn. Rejection: N/A (no user-facing rejection — conflict detection is additive). |
| DC-P4-102 | `contradicts` relationship created for retracted claims (false positive) | 1: Data integrity | CONSTITUTIONAL | CBM | Conflict detection query includes `status = 'active'` filter. Only active claims participate. | AssertClaimHandler conflict detection query | [A21] Success: assert claim when existing active claim has same subject+predicate+different value → contradiction created. Rejection: assert claim when existing claim is retracted → no contradiction created. |
| DC-P4-103 | Cascade penalty reads retraction status of wrong claim (cross-tenant leakage) | 1: Data integrity | CONSTITUTIONAL | CBM | Cascade traversal queries run through `TenantScopedConnection` which auto-injects `tenant_id` filter. | `computeCascadePenalty` via `conn.query` | [A21] Success: cascade penalty correctly reads parent status within tenant scope. Rejection: cascade query on multi-tenant DB returns only tenant-scoped results. |
| DC-P4-104 | Retraction reason stored as free-text bypassing taxonomy | 1: Data integrity | CONSTITUTIONAL | CBM | `RetractClaimHandler` validates `input.reason` against `VALID_RETRACTION_REASONS` before storing. | RetractClaimHandler step 1 | [A21] Success: retract with reason='incorrect' succeeds. Rejection: retract with reason='arbitrary text' fails with `INVALID_REASON`. |

## Category 2: State Consistency

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-201 | Claim and its `contradicts` relationship have inconsistent visibility (one committed, other not) | 2: State consistency | CONSTITUTIONAL | CBM | Claim creation and contradiction relationship creation occur in the same `conn.transaction()`. Atomic visibility. | AssertClaimHandler transaction boundary | [A21] Success: claim + contradiction visible together after commit. Rejection: N/A (SQLite transaction guarantees atomicity). |
| DC-P4-202 | `disputed` flag shows false for claim that has `contradicts` relationship | 2: State consistency | CONSTITUTIONAL | CBM | `disputed` computed at query-time by checking BOTH directions of `contradicts` relationships (`from_claim_id = ? OR to_claim_id = ?`). | QueryClaimsHandler, SearchClaimHandler | [A21] Success: query claim that is source of `contradicts` → `disputed: true`. Rejection: query claim with no contradicts relationships → `disputed: false`. |
| DC-P4-203 | Cascade penalty returns non-1.0 when no ancestors are retracted | 2: State consistency | CONSTITUTIONAL | CBM | `computeCascadePenalty` returns 1.0 when no `derived_from` parents exist or all parents are active. | cascade.ts | [A21] Success: claim with no derived_from edges → penalty = 1.0. Rejection: claim with retracted parent → penalty = 0.5 (not 1.0). |

## Category 3: Concurrency

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-301 | Two conflicting claims asserted simultaneously — each detects the other, creating duplicate contradiction pairs | 3: Concurrency | CONSTITUTIONAL | CBM | SQLite serialized writes: concurrent `conn.transaction()` calls are serialized. Exactly one assertion completes first; the second sees the first. No duplicate pairs possible. | SQLite transaction serialization | [A21] Success: sequential assertions → second assertion detects first → one directional contradicts relationship. Rejection: N/A (SQLite serialization prevents the race). |
| DC-P4-302 | Cascade penalty reads stale retraction status during concurrent retract+query | 3: Concurrency | QUALITY_GATE | CBM | SQLite WAL mode: readers see snapshot, writers serialize. Query-time penalty reflects committed state. Momentary staleness within WAL window is acceptable. | SQLite WAL isolation | N/A (QUALITY_GATE — not enforcement). |

## Category 4: Authority / Governance

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-401 | Operation succeeds when `requireRbac: true` and agent lacks required permission | 4: Authority | CONSTITUTIONAL | CBM | When `requireRbac: true`, `RbacEngine.isActive()` returns `true`, `checkPermission()` performs actual check. `requirePermission()` in facades throws `UNAUTHORIZED` when denied. | Facade `requirePermission()` calls | [A21] Success: operation with valid role when requireRbac=true → succeeds. Rejection: operation without valid role when requireRbac=true → `UNAUTHORIZED` error. |
| DC-P4-402 | `requireRbac: false` breaks existing consumers by enforcing permissions | 4: Authority | CONSTITUTIONAL | CBM | When `requireRbac: false` (default), `RbacEngine.isActive()` returns `false`, `checkPermission()` always returns `true`. Zero behavioral change from pre-Phase 4. | Facade `requirePermission()` passthrough | [A21] Success: all operations pass when requireRbac=false (default). Rejection: N/A (guard is off). |
| DC-P4-403 | `.raw` access without audit trail when `requireRbac: true` | 4: Authority | CONSTITUTIONAL | CBM | `.raw` getter wrapped with audit logging that fires on every access. When `requireRbac: true`, `rawAccessTag` must be present or access throws. | `createTenantScopedConnection` .raw getter | [A21] Success: .raw access with rawAccessTag when requireRbac=true → access granted + audit entry. Rejection: .raw access without rawAccessTag when requireRbac=true → access denied. |
| DC-P4-404 | `.raw` access without audit trail when `requireRbac: false` | 4: Authority | CONSTITUTIONAL | CBM | `.raw` getter logs audit entry regardless of `requireRbac` setting. All accesses are logged. | `createTenantScopedConnection` .raw getter | [A21] Success: .raw access when requireRbac=false → access granted + audit entry logged. Rejection: N/A (access always granted when requireRbac=false, but logging is always on). |

## Category 5: Causality / Observability

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-501 | Conflict detection creates `contradicts` relationship but no audit entry | 5: Causality | CONSTITUTIONAL | CBM | Conflict-created relationships are created via `RelateClaimsHandler` internal call or inline SQL with audit entry in same transaction. | AssertClaimHandler audit entry includes contradiction details | [A21] Success: contradiction created → audit entry records the contradiction event. Rejection: N/A (audit is mandatory, not optional). |
| DC-P4-502 | Cascade penalty computation not observable (no way to inspect the multiplier applied) | 5: Causality | DESIGN_PRINCIPLE | CBD | `effectiveConfidence` in query results reflects the cascade penalty. Consumer can compare `claim.confidence` with `effectiveConfidence` to detect penalty. | QueryClaimsHandler, SearchClaimHandler | N/A (DESIGN_PRINCIPLE). |

## Category 6: Migration / Evolution

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-601 | Migration v40 compound index fails on existing databases | 6: Migration | CONSTITUTIONAL | CBM | `CREATE INDEX IF NOT EXISTS` — idempotent. Works on empty and populated databases. Partial index `WHERE status = 'active'` is valid SQLite syntax. | Migration 031_conflict_index.ts | [A21] Success: migration applied → index exists → conflict detection query uses index. Rejection: migration already applied → `IF NOT EXISTS` prevents error. |
| DC-P4-602 | Retraction reason taxonomy validation breaks existing consumers passing free-text reasons | 6: Migration | CONSTITUTIONAL | CBM | Validation added to `RetractClaimHandler`. Existing code via `forget()` now uses typed `RetractionReason`. Low-level callers passing free-text get `INVALID_REASON`. This is an intentional breaking change for correctness. | RetractClaimHandler reason validation | [A21] Success: retract with valid taxonomy reason → succeeds. Rejection: retract with free-text reason → `INVALID_REASON`. |

## Category 7: Credential / Secret

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-701 | NOT APPLICABLE | 7: Credential | — | — | Phase 4 introduces no new credentials, tokens, or secrets. RBAC enforcement uses existing permission sets (in-memory, not stored as credentials). `.raw` gating uses config-time `rawAccessTag` strings, not runtime credentials. | — | — |

## Category 8: Behavioral / Model Quality

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-801 | Cascade penalty multiplier uses wrong constant value (e.g., 0.3 instead of 0.5) | 8: Behavioral | CONSTITUTIONAL | CBM | `CASCADE_FIRST_DEGREE_MULTIPLIER = 0.5` and `CASCADE_SECOND_DEGREE_MULTIPLIER = 0.25` are CONSTITUTIONAL constants. Tests assert exact values. | cascade.ts constants | [A21] Success: retracted parent → effective_confidence multiplied by exactly 0.5. Rejection: mutation of constant → test fails (expected 0.5, got other value). |
| DC-P4-802 | Cascade penalty traverses beyond depth 2 | 8: Behavioral | CONSTITUTIONAL | CBM | `CASCADE_MAX_DEPTH = 2`. Traversal algorithm explicitly stops at depth 2. Depth 3+ claims receive penalty 1.0 (no effect). | cascade.ts depth limit | [A21] Success: depth-3 claim of retracted grandparent's parent → penalty = 1.0 (no penalty). Rejection: depth-2 claim of retracted grandparent → penalty = 0.25 (penalty applied). |
| DC-P4-803 | Cascade penalty composed incorrectly with decay (additive instead of multiplicative) | 8: Behavioral | CONSTITUTIONAL | CBM | `effective_confidence = confidence * decayFactor * cascadePenalty`. Three factors multiplied, not added. | QueryClaimsHandler, SearchClaimHandler | [A21] Success: confidence=0.8, decay=0.9, cascade=0.5 → effective = 0.36. Rejection: if additive, result would be 2.2 (clearly wrong). Test asserts multiplicative composition. |
| DC-P4-804 | Conflict detection threshold allows contradiction for low-confidence claims when spec says >= 0.8 | 8: Behavioral | CONSTITUTIONAL | CBM | Conflict detection creates `contradicts` for ALL structural conflicts (same subject+predicate+different value). The 0.8 threshold is for review severity, not relationship creation. All contradictions are relationships. | AssertClaimHandler conflict detection | [A21] Success: conflict with low-confidence existing claim → `contradicts` relationship created. Rejection: N/A (all conflicts create relationships per Design Source Decision 3). |

## Category 9: Availability / Resource

| ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|---|
| DC-P4-901 | Conflict detection query exceeds 2ms budget on large tables | 9: Availability | QUALITY_GATE | CBD | Compound partial index `idx_claims_conflict_detection` on `(subject, predicate, status) WHERE status = 'active'`. B-tree lookup O(log N). Budget: <2ms on 100K claims. | Migration v40 index | N/A (QUALITY_GATE — benchmark, not enforcement). |
| DC-P4-902 | Cascade penalty traversal causes N+1 query explosion on claims with many `derived_from` edges | 9: Availability | QUALITY_GATE | CBD | Traversal bounded by `CASCADE_MAX_DEPTH = 2`. Maximum queries: 1 (parents) + N_parents * 1 (grandparents). Typical N_parents < 3. Short-circuit on worst penalty found. | cascade.ts short-circuit | N/A (QUALITY_GATE — bounded by depth constraint). |
| DC-P4-903 | Conflict detection adds latency to every `assertClaim` call even when no conflicts exist | 9: Availability | QUALITY_GATE | CBD | Single indexed query per assertion. Returns empty result set for non-conflicting claims. Overhead: ~0.5ms per assertion (index scan, zero rows returned). | AssertClaimHandler step 17b | N/A (QUALITY_GATE — performance target). |

---

## Assumption Ledger

| ID | Assumption | Owner | Review Trigger | Invalidation Trigger | Response When Broken |
|---|---|---|---|---|---|
| A-P4-01 | Conflict detection SELECT executes in <2ms on tables with <100K claims with compound index | Builder | Table exceeds 100K claims | Latency exceeds 2ms consistently under normal load | Evaluate index effectiveness. Consider denormalized conflict flag. Reopen DC-P4-901. |
| A-P4-02 | Creating `contradicts` relationship inside assertion transaction does not violate CCP-I6 (append-only) | Builder | New constraint on relationship creation order | Schema trigger rejects relationship creation inside assertion transaction | Refactor to post-assertion hook. Reopen DC-P4-201. |
| A-P4-03 | `TenantScopedConnection` auto-injects tenant_id into cascade traversal queries | Builder | New query patterns added to cascade that use JOINs or complex SQL | `COMPLEX_SQL_PATTERNS` regex blocks a cascade query | Refactor to use `.raw` with SYSTEM_SCOPE annotation. Reopen DC-P4-103. |

---

## Coverage Summary

| Category | DCs | Covered |
|----------|-----|---------|
| 1. Data integrity | 4 | DC-P4-101, DC-P4-102, DC-P4-103, DC-P4-104 |
| 2. State consistency | 3 | DC-P4-201, DC-P4-202, DC-P4-203 |
| 3. Concurrency | 2 | DC-P4-301, DC-P4-302 |
| 4. Authority / governance | 4 | DC-P4-401, DC-P4-402, DC-P4-403, DC-P4-404 |
| 5. Causality / observability | 2 | DC-P4-501, DC-P4-502 |
| 6. Migration / evolution | 2 | DC-P4-601, DC-P4-602 |
| 7. Credential / secret | 0 | NOT APPLICABLE (no new credentials) |
| 8. Behavioral / model quality | 4 | DC-P4-801, DC-P4-802, DC-P4-803, DC-P4-804 |
| 9. Availability / resource | 3 | DC-P4-901, DC-P4-902, DC-P4-903 |
| **Total** | **24** | All 9 categories addressed |

---

*SolisHQ -- We innovate, invent, then disrupt.*
