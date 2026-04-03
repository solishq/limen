# Phase 12: Cognitive Engine -- Breaker Pass B Report

**Date**: 2026-04-03
**Attacker**: Breaker Agent
**Target**: Phase 12 Cognitive Engine (8 source files, 1 test file, 28 DCs)
**Baseline**: 29 tests, 0 failures

---

## Prompt Audit Gate

No issues found. Attack vectors specified with file references and line numbers.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Checks | Key Findings | Status |
|------|------|-----------------|--------|--------------|--------|
| OG-THREAT | oracle_threat_model | PASS | 15/15 | CWE-674 stack overflow from recursion (confirmed via depth limit bypass), CWE-190 arithmetic overflow relevant for NaN propagation | COMPLETED |
| OG-FMEA | oracle_fmea | -- | -- | -- | SKIPPED (Optional) |

### Oracle-Informed Findings

- **CWE-674 (Stack overflow from recursion)**: OG-THREAT flagged this as medium risk. Confirmed: depth limit defeated by event-driven re-entry (F-P12-003). The `processSelfHealing` is called recursively AND via event re-entry, and the event re-entry resets depth to 0 with a fresh visited Set.
- **CWE-862 (Missing Authorization)**: OG-THREAT flagged this as critical risk. Not directly applicable -- Phase 12 operates within the existing authorization boundary of createLimen.

---

## Mutation Testing Results

| Mutation | Target | File:Line | Expected | Actual | Verdict |
|----------|--------|-----------|----------|--------|---------|
| M-1 | Remove cycle prevention (visited Set check) | self_healing.ts:87 | DC-P12-202 test fails | All 29 pass | **SURVIVED** |
| M-2 | Remove depth limit guard | self_healing.ts:74 | DC-P12-203 test fails | All 29 pass | **SURVIVED** |
| M-3 | Change retraction reason 'incorrect' to 'manual' | self_healing.ts:137 | DC-P12-204 test fails | All 29 pass | **SURVIVED** |
| M-4 | Remove consolidation_log INSERT for self-healing | self_healing.ts:141-149 | DC-P12-401/502 test fails | All 29 pass | **SURVIVED** |
| M-5 | Remove entire event listener wiring | index.ts:1131-1149 | Self-healing tests fail | All 29 pass | **SURVIVED** |
| M-6 | Swap merge winner selection (lowest wins) | consolidation.ts:216-226 | DC-P12-101 test fails | All 29 pass | **SURVIVED** |
| M-7 | Remove freshness check in archive | consolidation.ts:320 | DC-P12-805 test fails | All 29 pass | **SURVIVED** |
| M-8 | Hardcode importance score to 0.5 | importance.ts:117-122 | DC-P12-801 test fails | All 29 pass | **SURVIVED** |

**Mutation Kill Rate: 0/8 = 0%.** This is the worst kill rate in the project's history.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|-------|--------------|-----------------|---------------------|---------|
| DC-P12-101 | Yes (shape only) | No merge integration test exists | N/A | **FAIL** -- M-6 survived |
| DC-P12-103 | Yes | Yes (IMPORTANCE_CLAIM_NOT_FOUND) | Success non-discriminative (M-8 survived) | **FAIL** |
| DC-P12-201 | Yes (NON-DISCRIMINATIVE) | Yes | Success test never asserts child is retracted | **FAIL** |
| DC-P12-202 | Yes | No rejection test | Success non-discriminative (M-1 survived) | **FAIL** |
| DC-P12-203 | Yes | No rejection test | Success non-discriminative (M-2 survived) | **FAIL** |
| DC-P12-204 | **HARD BAN #8**: `assert.ok(true)` | No rejection test | Both non-discriminative | **FAIL** |
| DC-P12-205 | Yes (rejection paths tested) | Yes | Discriminative for SUGGESTION_NOT_FOUND | PASS |
| DC-P12-401 | Claimed (no assertion) | No rejection test | Non-discriminative (M-4 survived) | **FAIL** |
| DC-P12-403 | Yes | Yes (provider failure + not found) | Discriminative | PASS |
| DC-P12-805 | Yes | Yes (fresh not archived) | Both non-discriminative (M-7 survived) | **FAIL** |
| DC-P12-901 | Yes | No rejection test | Discriminative for merged=0 | PASS |

**A21 Pass Rate: 3/11 = 27%.** 8 enforcement DCs have non-discriminative or missing tests.

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-P12-001 | Self-healing event listener wiring entirely removable | CRITICAL | P-002 (wiring) | M-5: removed index.ts:1131-1149, all 29 tests pass | Add integration test that retracts parent, asserts child auto-retracted |
| F-P12-002 | DC-P12-204 test is `assert.ok(true)` -- Hard Ban #8 | CRITICAL | P-001 (HB#8) | phase12_cognitive.test.ts:323 | Replace with discriminative test verifying retraction reason in audit/DB |
| F-P12-003 | Depth limit defeated by event-driven re-entry | CRITICAL | Design defect | Breaker test proves C3 retracted despite maxCascadeDepth=2 with 4-claim chain | Event listener must pass a shared visited Set or check if claim was already processed by self-healing |
| F-P12-004 | DC-P12-201 success test never asserts child retraction | HIGH | P-001 (non-discriminative) | phase12_cognitive.test.ts:285-291, comment says "may or may not appear" | Assert `childRecall.value.length === 0` after parent retraction |
| F-P12-005 | Cycle prevention guard entirely removable | HIGH | P-001 | M-1: removed self_healing.ts:87, all 29 tests pass | Add test with circular derived_from that verifies no infinite loop AND no duplicate retractions |
| F-P12-006 | Self-healing audit log entirely removable | HIGH | P-001 | M-4: removed self_healing.ts:141-149, all 29 tests pass | Add test querying consolidation_log for operation='self_heal' after cascade |
| F-P12-007 | Merge winner selection invertible without test failure | HIGH | P-001 | M-6: swapped consolidation.ts:216-226, all 29 tests pass | Add merge integration test with sqlite-vec that verifies winner has higher confidence |
| F-P12-008 | Archive freshness guard removable | HIGH | P-001 | M-7: removed consolidation.ts:320, all 29 tests pass | Add test with genuinely stale claim (manipulate last_accessed_at) that verifies freshness discriminates |
| F-P12-009 | Importance composite score hardcodable | MEDIUM | P-001 | M-8: hardcoded importance.ts:117, all 29 tests pass | Assert composite score differs for claims with different access patterns |
| F-P12-010 | dryRun does not prevent suggestion creation in consolidation | MEDIUM | Design defect | consolidation.ts:107, runSuggestResolution runs regardless of opts.dryRun | Gate runSuggestResolution behind `!opts.dryRun` or at least skip DB writes |
| F-P12-011 | Contradiction resolution suggests 'supports' type | MEDIUM | Semantic defect | consolidation.ts:428, hardcoded 'supports' for contradiction pair | ConnectionSuggestion type should support 'supersedes', or resolution should use a different mechanism |
| F-P12-012 | Bare catch in event listener silently swallows errors | MEDIUM | Observability | index.ts:1145-1147, comment says "logged" but no logging code | Add actual error logging in the catch block |
| F-P12-013 | NaN propagation in importance -- no NaN guard on final score | LOW | Recurring (NaN) | importance.ts:126, `Math.max(0, Math.min(1, score))` -- if score is NaN, result is NaN | Add `Number.isFinite(score) ? score : 0` guard |

---

## DC Coverage Matrix

| DC-ID | Test(s) | Discriminative? | Evidence |
|-------|---------|-----------------|----------|
| DC-P12-101 | DC-P12-901 (indirect) | No -- no merge integration test | M-6 survived |
| DC-P12-102 | None | No | No merge test exists |
| DC-P12-103 | DC-P12-103 success + rejection | Score shape only, not composite value | M-8 survived |
| DC-P12-104 | DC-P12-104 success | Yes -- verifies counts | -- |
| DC-P12-105 | None directly | No -- log never queried | M-4 survived |
| DC-P12-201 | DC-P12-201 success + rejection | SUCCESS non-discriminative (no assertion) | Comment says "may or may not" |
| DC-P12-202 | DC-P12-202 success | Non-discriminative | M-1 survived |
| DC-P12-203 | DC-P12-203 success | Non-discriminative | M-2 survived |
| DC-P12-204 | DC-P12-204 success | **NO** -- `assert.ok(true)` HB#8 | M-3 survived |
| DC-P12-205 | DC-P12-205 rejection (3 tests) | Yes -- SUGGESTION_NOT_FOUND verified | -- |
| DC-P12-401 | DC-P12-401 claimed | Non-discriminative | M-4 survived |
| DC-P12-402 | Not directly tested | -- | No accept-with-real-suggestion test |
| DC-P12-403 | DC-P12-403 (4 tests) | Yes -- advisory + provider failure | -- |
| DC-P12-501 | None directly | No | M-4 survived |
| DC-P12-502 | None directly | No | No audit query test |
| DC-P12-601 | DC-P12-601 success | Yes | -- |
| DC-P12-602 | DC-P12-602 success (3 tests) | Yes -- exact values | -- |
| DC-P12-701 | Not directly tested | -- | No audit content assertion |
| DC-P12-801 | DC-P12-801 success | Factor only, not composite | M-8 survived |
| DC-P12-802 | DC-P12-802 success | Timing-dependent, asserts confidence>0 only | -- |
| DC-P12-803 | DC-P12-803 success + rejection | Yes -- momentum + empty error | -- |
| DC-P12-804 | DC-P12-205 (indirect) | Partial -- no vector store in tests | -- |
| DC-P12-805 | DC-P12-805 success + rejection | Non-discriminative for freshness | M-7 survived |
| DC-P12-901 | DC-P12-901 success | Yes -- merged=0 without vectors | -- |
| DC-P12-902 | DC-P12-902 success | Yes -- VERIFY_PROVIDER_MISSING | -- |
| DC-P12-903 | Not tested | -- | Benchmark absent |

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative enforcement tests | Yes | **FOUND**: DC-P12-201 success, DC-P12-204 (HB#8), DC-P12-202, DC-P12-203, DC-P12-801, DC-P12-805 -- 8/8 mutations survived |
| P-002 | Defense built but not wired in | Yes | **FOUND**: F-P12-001 -- entire event listener removable (M-5) |
| P-003 | IBC overclaims | Yes | No IBC claims in Phase 12 |
| P-004 | Test rewrite drops coverage | Yes | N/A -- first test file for Phase 12 |
| P-005 | Phantom test references | Yes | Not found -- test names match DC descriptions |
| P-006 | Cross-subsystem boundary gaps | Yes | **FOUND**: consolidation<->vectorStore boundary zero tests, self-healing<->eventBus boundary zero tests |
| P-007 | FM numbering collisions | Yes | Not found |
| P-008 | Documentation in session only | Yes | PHASE-12-DESIGN-SOURCE.md referenced but presence not verified |
| P-009 | Prompt Audit Gate degradation | Yes | Not applicable (no prompts) |
| P-010 | Implementation logic in harness | Yes | Not applicable -- no harness file |

---

## Architecture-Level Findings

### F-P12-003 (CRITICAL): Depth Limit Defeated by Event Re-Entry

The self-healing system has two execution paths:
1. **Recursive**: `processSelfHealing` calls itself with `depth + 1` and shared `visited` Set
2. **Event-driven**: `claim.retracted` event fires the listener with `depth = 0` and `new Set()`

Path 2 resets the depth counter. A chain of N claims will cascade through ALL of them regardless of `maxCascadeDepth`, because each intermediate retraction triggers a new event with depth=0.

**Impact**: In a production knowledge base with deep derived_from chains, a single retraction could cascade through the entire graph, retracting hundreds or thousands of claims.

**Fix approach**: The event listener must either:
- (a) Not re-process claims that were already retracted by the recursive path (check if claim was retracted by self-healing before invoking processSelfHealing), or
- (b) Use a global "currently processing" Set that persists across event firings, or
- (c) Suppress event emission during self-healing cascades (retract via direct DB update, not the full retractClaim handler)

---

## Security Findings

No direct security vulnerabilities. Phase 12 operates within existing authentication/authorization boundaries. The verification provider boundary is correctly isolated (I-P12-51).

---

## Performance Findings

- F-P12-003 implies unbounded cascade on large graphs -- potential for cascading retraction of entire knowledge base from a single retraction
- No batch consolidation performance test (DC-P12-903 benchmark absent)

---

## Dependency Findings

No new external dependencies introduced in Phase 12.

---

## Self-Audit

- **Was every finding derived from evidence?** Yes -- all findings backed by mutation results (file:line), code inspection, or breaker test execution.
- **What would I check to prove my findings wrong?** Run M-1 through M-8 again to confirm SURVIVED verdicts. Verify F-P12-003 depth bypass test is not a false positive from test setup.
- **What did I NOT examine?** The `claim_importance` table schema and INSERT logic. The narrative SQL complexity (edge cases in INSTR/SUBSTR parsing). The `connection_suggestions` table DDL. The `computeBatchImportance` function (not exposed via API).
- **Is my finding count reasonable?** 13 findings, 3 CRITICAL, 5 HIGH, 4 MEDIUM, 1 LOW. Historical average is 16.4 per subsystem. 0% mutation kill rate is the worst in the project -- consistent with the finding that self-healing tests are structurally non-discriminative.

---

## Oracle Gates Summary

| Gate | Status | Notes |
|------|--------|-------|
| OG-THREAT | COMPLETED | 11 threats identified, CWE-674 (recursion) confirmed as real defect |
| OG-FMEA | SKIPPED | Optional for Breaker, not required for Phase 12 tier |

---

## Verdict

**CONDITIONAL PASS** -- 3 CRITICAL (F-P12-001, F-P12-002, F-P12-003) and 5 HIGH (F-P12-004 through F-P12-008) must be fixed before merge. The 0% mutation kill rate indicates the self-healing and consolidation subsystems are effectively untested despite 29 passing tests.

---

*SolisHQ -- We innovate, invent, then disrupt.*
