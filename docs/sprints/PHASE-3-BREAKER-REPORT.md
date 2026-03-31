# PHASE 3 BREAKER REPORT: Cognitive Metabolism

**Date**: 2026-03-30
**Role**: Breaker (SolisHQ Engineering)
**Target**: Phase 3 Cognitive Metabolism implementation
**Baseline**: 83 Phase 3 tests passing (28 decay, 12 freshness, 31 stability, 10 access_tracker, 12 integration)
**Governing Documents**: PHASE-3-DC-DECLARATION.md, PHASE-3-TRUTH-MODEL.md, CLAUDE.md

---

## Prompt Audit Gate

No issues found with the dispatch prompt. All artifacts listed, priority attack vectors specified, mandatory checks enumerated, output location defined.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Status |
|------|------|-----------------|--------|
| OG-THREAT | oracle_threat_model | DEGRADED | Intelligence MCP unavailable -- manual STRIDE analysis performed |
| OG-FMEA | oracle_fmea | DEGRADED | Intelligence MCP unavailable -- manual failure mode analysis performed |

### Degradation Compensation

Manual STRIDE analysis performed across all 6 threat categories. Manual FMEA performed against all new code paths. Findings below incorporate both structured threat analysis and manual adversarial testing.

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-P3-001 | NaN stability bypasses guard, propagates NaN effectiveConfidence | HIGH | 1: Data Integrity | `decay.ts:33` -- `NaN <= 0` is false, guard skipped. `computeDecayFactor(1000, NaN)` returns NaN. NaN effectiveConfidence bypasses minConfidence filter (`NaN < 0.5` is false). | Add `!Number.isFinite(stabilityDays)` guard. Add NaN test. |
| F-P3-002 | NaN age propagates through decay formula | HIGH | 1: Data Integrity | `decay.ts:36` -- `Math.max(0, NaN)` returns NaN. `computeDecayFactor(NaN, 90)` returns NaN. `computeAgeMs('invalid', nowMs)` returns NaN via `Date.parse`. | Add NaN guard for ageMs. Guard `computeAgeMs` against invalid date strings. |
| F-P3-003 | effectiveConfidence post-filter mutation SURVIVED (M-4) | HIGH | 8: Behavioral | `claim_stores.ts:530` -- Replacing `if (hasMinConfidence && effConf < filters.minConfidence!)` with `if (false)` passes all 83 tests. The constitutional filter DC-P3-801 has no test exercising decay-specific behavior (all test claims are brand-new). | Add integration test with time-controlled claims where raw confidence passes but effectiveConfidence fails. |
| F-P3-004 | Search score reversion to raw confidence SURVIVED (M-5) | HIGH | 8: Behavioral | `claim_stores.ts:737` -- Replacing `effConf` with `claim.confidence` in score formula passes all tests. DC-P3-802 is untested for the Phase 3 change. | Add test with two same-content claims of different ages, verify older ranks lower. |
| F-P3-005 | Access tracking wiring at ClaimApiImpl SURVIVED (M-7, M-8) | MEDIUM | 5: Causality | `claim_api_impl.ts:52-57,67-72` -- Removing access tracking from both `queryClaims()` and `searchClaims()` passes all tests. P-002 (defense built not wired) pattern. | Add integration test: recall() -> flush() -> verify last_accessed_at and access_count in DB. |
| F-P3-006 | Search minConfidence filter mutation SURVIVED (M-6) | MEDIUM | 8: Behavioral | `claim_stores.ts:753` -- Replacing `if (input.minConfidence !== undefined && effConf < input.minConfidence)` with `if (false)` passes all tests. No test exercises search() with minConfidence. | Add test: search() with minConfidence that should exclude results. |
| F-P3-007 | query() `total` count incorrect after decay filtering | MEDIUM | 1: Data Integrity | `claim_stores.ts:507,582-583` -- `total` comes from SQL COUNT(*) which does not account for TypeScript decay filter. `hasMore` also wrong. Consumer sees total=10 but only 3 claims pass effectiveConfidence filter. | total should reflect post-filter count: `total: allItems.length` or separate pre/post counts. |
| F-P3-008 | Over-fetch factor removal SURVIVED (M-3) | MEDIUM | 9: Availability | `claim_stores.ts:503` -- Removing `2x` over-fetch passes all tests. When many claims have decayed below threshold, 1x fetch returns fewer results than requested. | Add test with time-controlled scenario where some claims decay below minConfidence threshold. |
| F-P3-009 | AccessTracker.destroy() does not flush pending events | LOW | 2: State Consistency | `access_tracker.ts:138-147` -- destroy() sets destroyed=true and clears timer but does NOT call doFlush(). Caller (index.ts:1159) calls flush() before destroy(), but the API does not enforce this. | Add defensive flush() call inside destroy() before setting destroyed=true. |
| F-P3-010 | AccessTracker pending events survive failed flush, retry accumulates | LOW | 9: Availability | `access_tracker.ts:94-98` -- On flush error, pending is NOT cleared. On next timer fire, entire batch retried. If DB is persistently failing, pending map grows unbounded. | Add max-pending-size cap or clear pending on repeated failures. |
| F-P3-011 | No NaN/Infinity tests in any cognitive module | LOW | 1: Data Integrity | `tests/cognitive/decay.test.ts`, `freshness.test.ts`, `stability.test.ts` -- zero tests for NaN, Infinity, or non-finite inputs. Known pattern from F-P2 findings log. | Add NaN/Infinity boundary tests for all pure functions. |
| F-P3-012 | DC-P3-106 test (no stored decay) is non-discriminative | LOW | 8: Behavioral | `metabolism.test.ts:226-247` -- Test recalls twice in immediate succession and checks values are close. This proves consistency but not that decay is computed vs stored. A stored value would also be consistent across two immediate reads. | Test needs time manipulation: recall at t=0, advance time, recall at t=1d, verify effectiveConfidence decreased. |

---

## Mutation Testing Results

| # | Mutation | File:Line | Expected | Actual | Verdict |
|---|----------|-----------|----------|--------|---------|
| M-1 | Remove `stabilityDays <= 0` guard | `decay.ts:33` | Decay tests fail | TESTS FAILED | KILLED |
| M-2 | Remove negative age clamp | `decay.ts:36` | Decay tests fail | TESTS FAILED | KILLED |
| M-3 | Remove 2x over-fetch factor | `claim_stores.ts:503` | Integration tests fail | ALL 83 PASS | **SURVIVED** |
| M-4 | Disable effectiveConfidence TypeScript post-filter in query() | `claim_stores.ts:530` | DC-P3-801 test fails | ALL 83 PASS | **SURVIVED** |
| M-5 | Replace effectiveConfidence with raw confidence in search score | `claim_stores.ts:737` | DC-P3-802 test fails | ALL 83 PASS | **SURVIVED** |
| M-6 | Remove minConfidence filter in search() | `claim_stores.ts:753` | Integration tests fail | ALL 83 PASS | **SURVIVED** |
| M-7 | Remove access tracking from queryClaims() | `claim_api_impl.ts:52` | Integration tests fail | ALL 83 PASS | **SURVIVED** |
| M-8 | Remove access tracking from searchClaims() | `claim_api_impl.ts:67` | Integration tests fail | ALL 83 PASS | **SURVIVED** |

**Summary**: 2 KILLED, 6 SURVIVED. Mutation kill rate: 25%. This is critically low.

**Root Cause**: All integration tests use brand-new claims where effectiveConfidence ~= confidence and age ~= 0. No test exercises time-dependent behavior (aged claims). The entire decay-in-query pipeline is structurally untested.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|--------|---------------|-----------------|---------------------|---------|
| DC-P3-101 | YES (10 test vectors) | N/A (formula correctness, not enforcement) | YES | PASS |
| DC-P3-102 | YES (positive age) | YES (negative age -> 1.0) | YES | PASS |
| DC-P3-103 | YES (stability > 0) | YES (stability = 0 -> 0) | YES | PASS |
| DC-P3-107 | YES (3d -> fresh) | YES (null -> stale) | YES | PASS |
| DC-P3-402 | YES (valid config) | YES (stabilityDays <= 0 skipped) | YES | PASS |
| DC-P3-601 | YES (migration runs) | Claimed N/A | OK | PASS |
| DC-P3-801 | YES (brand new > threshold) | YES (brand new < threshold) | **NO** -- M-4 survived | **FAIL** |
| DC-P3-106 | YES (two immediate recalls match) | N/A -- architectural | **NO** -- non-discriminative | **FAIL** |

**DC-P3-801 FAIL**: The [A21] rejection test at `metabolism.test.ts:171-180` tests with a brand-new claim (confidence 0.7 vs minConfidence 0.8). This is rejected by the SQL pre-filter (`confidence < minConfidence`), NOT by the Phase 2 TypeScript decay filter. The decay-specific path is never exercised. Mutation M-4 proves this.

**DC-P3-106 FAIL**: Test is non-discriminative. Two immediate recalls of a brand-new claim produce the same effectiveConfidence whether decay is stored or computed. No time progression to differentiate.

---

## DC Coverage Matrix

| DC-ID | Test(s) | Discriminative? | Evidence Level |
|--------|---------|----------------|---------------|
| DC-P3-101 | decay.test.ts (10 vectors + half-life) | YES | Strong |
| DC-P3-102 | decay.test.ts (negative age clamp) | YES | Strong |
| DC-P3-103 | decay.test.ts (stability=0, stability<0) | YES | Strong |
| DC-P3-104 | access_tracker.test.ts (flush verification) | YES (unit level) | Medium |
| DC-P3-105 | stability.test.ts (17 built-in patterns) | YES | Strong |
| DC-P3-106 | metabolism.test.ts (two recalls) | **NO** (F-P3-012) | Weak |
| DC-P3-107 | freshness.test.ts (9 boundary tests) | YES | Strong |
| DC-P3-201 | access_tracker.test.ts (destroy then record) | YES | Medium |
| DC-P3-202 | access_tracker.test.ts (double destroy) | YES | Medium |
| DC-P3-301 | No test -- CBD (structural proof) | N/A | Structural |
| DC-P3-401 | **NO TEST** | UNCOVERED | None |
| DC-P3-402 | stability.test.ts (invalid config) | YES | Strong |
| DC-P3-501 | metabolism.test.ts (field presence) | YES | Medium |
| DC-P3-502 | metabolism.test.ts (field presence) | YES | Medium |
| DC-P3-503 | metabolism.test.ts (field presence) | YES | Medium |
| DC-P3-601 | metabolism.test.ts (migration runs) | YES | Medium |
| DC-P3-602 | metabolism.test.ts (defaults verified) | YES | Medium |
| DC-P3-603 | No explicit test | **UNCOVERED** | None |
| DC-P3-801 | metabolism.test.ts (both paths) | **NO** (M-4 survived) | Weak |
| DC-P3-802 | metabolism.test.ts (score > 0) | **NO** (M-5 survived) | Weak |
| DC-P3-803 | No explicit test (mathematical proof) | Structural | Medium |
| DC-P3-901 | access_tracker.test.ts (lifecycle) | YES | Medium |
| DC-P3-902 | access_tracker.test.ts (error containment) | YES | Strong |
| DC-P3-903 | No test -- CBD (accepted risk) | N/A | Structural |
| DC-P3-904 | No test (benchmark claim) | UNCOVERED | None |

**Summary**: 25 DCs total. 3 UNCOVERED (DC-P3-401, DC-P3-603, DC-P3-904). 3 with non-discriminative tests (DC-P3-106, DC-P3-801, DC-P3-802).

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative enforcement tests | YES | **FOUND** -- DC-P3-801, DC-P3-802, DC-P3-106 all have tests that pass regardless of decay implementation correctness (M-4, M-5 survived). |
| P-002 | Defense built but not wired in | YES | **FOUND** -- Access tracking in ClaimApiImpl is wired but UNTESTED (M-7, M-8 survived). The wiring exists but has zero test coverage. |
| P-003 | IBC overclaims | YES | Not found -- DC-P3-301 (concurrency) has proper structural proof and assumption ledger with all 5 lifecycle fields. |
| P-004 | Test rewrite drops coverage | YES | Not found -- all test files are new additions, no rewrites. |
| P-005 | Phantom test references | YES | Not found -- DC declaration references match existing tests. |
| P-006 | Cross-subsystem boundary gaps | YES | **FOUND** -- The boundary between ClaimApiImpl (access tracking wiring) and ClaimStore (decay computation) has zero integration tests that exercise decay+access_tracking end-to-end. |
| P-007 | FM numbering collisions | YES | Not found -- all DCs use unique P3 prefix. |
| P-008 | Documentation in session only | YES | **FOUND** -- PHASE-3-DESIGN-SOURCE.md referenced by all modules but not present in worktree (`docs/sprints/PHASE-3-DESIGN-SOURCE.md` exists only in main repo, not in worktree). |
| P-009 | Prompt Audit Gate degradation | YES | Not found -- PAG instruction present in design source. |
| P-010 | Implementation logic in harness | YES | Not found -- no harness files in cognitive tests. |

---

## Missing Defect Classes

| # | Attack Vector | Why Missing | Impact |
|---|---------------|-------------|--------|
| 1 | NaN/Infinity inputs to computeDecayFactor propagate NaN through effectiveConfidence, bypass minConfidence filter | No guard for non-finite inputs beyond stability<=0 check. NaN is not <= 0. | Claims with corrupted metadata appear in filtered results. Same pattern as F-P2 findings. |
| 2 | Invalid date string in computeAgeMs returns NaN age | `Date.parse('invalid')` returns NaN. No validation. | NaN propagates through entire decay pipeline. |
| 3 | query() total/hasMore incorrect after Phase 2 decay filtering | total from SQL COUNT, items from post-filter. Mismatch. | Consumer pagination broken -- API claims more results exist than available. |
| 4 | Memory growth in AccessTracker under persistent DB failure | Pending map never cleared on repeated flush failures | Unbounded memory growth in production if DB connection is flaky |

---

## Architecture-Level Findings

The Phase 3 implementation has a fundamental testability gap: **no test exercises the time-dependent behavior that is the entire purpose of Phase 3**. All integration tests use brand-new claims (age ~= 0, effectiveConfidence ~= confidence). The decay pipeline from claim creation through query-time computation through minConfidence filtering through search ranking is structurally untested for its core behavior.

This is not a test quality issue -- it is an architectural test design issue. Testing decay requires either:
1. TimeProvider injection in integration tests (to advance time), or
2. Claims with explicit past validAt dates (to simulate age)

Neither approach is used in the current test suite.

---

## Security Findings

1. **NaN injection via corrupted stability column**: If the stability column is manually set to NaN (e.g., via direct SQL), the entire decay pipeline for that claim produces NaN, which bypasses minConfidence filters. Defense: guard at query-time computation.

2. **No validation of stability column value on read**: `rowToClaim()` at `claim_stores.ts:243` casts `stability` without validation. A corrupted or manually-modified row could contain non-positive stability.

---

## Performance Findings

1. **Two-phase query over-fetch is correct but untested**: The 2x factor is mathematically justified but has no test proving it's needed. Under heavy decay (many stale claims), 2x may not be enough, returning fewer results than `limit`.

---

## Self-Audit

- **Was every finding derived from evidence?** Yes -- every finding has file:line evidence and/or mutation test results.
- **What would I check to prove findings wrong?** Run tests with time manipulation (advancing clock) -- if those tests exist elsewhere and I missed them, F-P3-003/004 would be invalid. Verified: no such tests exist.
- **What did I NOT examine?** (1) Facade RBAC enforcement with Phase 3 fields. (2) The convenience prompt instructions. (3) Phase 2 regression -- did not run full Phase 2 test suite to confirm search still works. (4) Edge behavior of Infinity age (returns 0 decay factor -- claim becomes effectively invisible with effectiveConfidence = 0).
- **Is my finding count reasonable?** 12 findings (0 CRITICAL, 4 HIGH, 4 MEDIUM, 4 LOW). Historical average: 16.4. Below average but justified -- Phase 3 is narrow scope (pure functions + wiring) with lower surface area than prior sprints.
- **Did I check all 10 recurring patterns?** Yes. 4 of 10 triggered.

---

## Verdict

**CONDITIONAL PASS** -- 4 HIGHs must be fixed before merge:

1. **F-P3-001**: NaN stability bypasses guard -- add non-finite guard
2. **F-P3-002**: NaN age propagates -- add non-finite guard
3. **F-P3-003**: effectiveConfidence post-filter untested (M-4 survived) -- add time-controlled integration test
4. **F-P3-004**: Search score reversion untested (M-5 survived) -- add aged-claim search ranking test

MEDIUMs (F-P3-005 through F-P3-008) should be addressed before merge but are not blocking if time-constrained.

---

*SolisHQ -- We innovate, invent, then disrupt.*
