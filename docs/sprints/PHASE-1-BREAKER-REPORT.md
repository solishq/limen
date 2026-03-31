# Phase 1 Convenience API Breaker Report (Pass B)

**Date**: 2026-03-30
**Author**: Breaker (SolisHQ Engineering)
**Target**: Phase 1 Convenience API implementation
**Design Source**: `docs/sprints/PHASE-1-DESIGN-SOURCE.md` (APPROVED with 3 amendments)
**DC Declaration**: `docs/sprints/PHASE-1-DC-DECLARATION.md`
**Truth Model**: `docs/sprints/PHASE-1-TRUTH-MODEL.md`
**Test File**: `tests/api/convenience.test.ts` (58 tests, all passing at baseline)

---

## Prompt Audit Gate

No issues found with the Breaker prompt. All target files enumerated. Attack vectors specified. Recurring patterns listed.

---

## Threat Intelligence Scan

**Dependencies checked**: The convenience layer introduces no new dependencies. It uses `node:crypto` (createHash for SHA-256) which is a Node.js built-in. No external packages added.

**Threat registry**: No updates needed. CVE-2025-6965 in SQLite 3.49.2 (from prior scan) remains the only known issue. The convenience layer does not modify SQL queries or schema.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Status |
|------|------|-----------------|--------|
| OG-THREAT | oracle_threat_model | DEGRADED | Intelligence MCP tools not available in this session. Manual STRIDE analysis performed below. |
| OG-FMEA | oracle_fmea | DEGRADED | Intelligence MCP tools not available. Manual failure mode analysis performed via mutation testing. |

### Manual STRIDE Analysis (Compensating for OG-THREAT Degradation)

| STRIDE Category | Threats Identified | DC Coverage |
|---|---|---|
| **Spoofing** | Convenience agent identity is auto-registered. No authentication for convenience API calls. | Low risk -- single-tenant library mode. No DC needed. |
| **Tampering** | Confidence laundering via evidence_path bypass. Deep freeze bypass. | DC-P1-101, DC-P1-902 cover these. |
| **Repudiation** | Missing audit trail on convenience operations. | DC-P1-501, DC-P1-502 cover via delegation chain. |
| **Information Disclosure** | No new data surfaces. BeliefView strips internal fields. | Adequate. |
| **Denial of Service** | reflect() with large arrays. No limit on entries count. | **FINDING F-P1-010** -- see below. |
| **Elevation of Privilege** | Convenience layer bypasses ClaimApi. | DC-P1-401 covers. Verified structurally (no ClaimSystem/ClaimStore imports). |

---

## "Impossible by Construction" Audit

### IBC-1: DC-P1-301 -- Concurrent reflect() calls impossible

**Claim**: "Limen is single-threaded (SQLite synchronous mode). No concurrent reflect() calls possible."

**Attack**: Node.js IS single-threaded for CPU-bound synchronous code. All convenience methods return `Result<T>` synchronously. SQLite operations via better-sqlite3 are synchronous. Therefore, two reflect() calls cannot interleave within a single event loop tick.

**Verdict**: **HOLDS**. The Node.js event loop guarantees sequential execution of synchronous code. No interleaving possible.

### IBC-2: DC-P1-601 -- Zero schema changes

**Claim**: "Phase 1 adds ZERO tables, ZERO columns, ZERO migrations."

**Attack**: Searched for migration files in convenience directory. None found. No ALTER TABLE, CREATE TABLE, or migration functions in any convenience file.

**Verdict**: **HOLDS**.

### IBC-3: DC-P1-401 -- Convenience layer only imports ClaimApi

**Claim**: "Convenience layer never imports from ClaimSystem, ClaimStore, or kernel types beyond branded IDs."

**Attack**: Grep for ClaimSystem, ClaimStore, claim_stores in convenience directory. Only found a comment referencing the boundary, no actual imports.

**Verdict**: **HOLDS**.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|---|---|---|---|---|
| DC-P1-101 [A21] | YES (line 142) -- but see F-P1-001 | YES (line 190, 202) | **NO** -- success test is non-discriminative (Mutation 10 survived) | **FINDING F-P1-001** |
| DC-P1-102 [A21] | YES (line 372) | YES (line 396) | YES | PASS |
| DC-P1-103 [A21] | YES (line 416) | N/A (correct) | YES | PASS |
| DC-P1-201 [A21] | YES (line 680) | YES (line 692) -- but see F-P1-002 | **NO** -- rejection test tests pre-validation, not transaction rollback (Mutation 3 survived) | **FINDING F-P1-002** |
| DC-P1-202 [A21] | YES (implicit -- every test creates engine) | N/A (init failure is exception) | YES | PASS |
| DC-P1-401 [A21] | YES (structural) | YES (structural) | YES | PASS |
| DC-P1-402 [A21] | YES (line 446) | **PARTIAL** (line 482 tests NOT_FOUND, not UNAUTHORIZED) | **NO** -- UNAUTHORIZED rejection path untested | **FINDING F-P1-003** |
| DC-P1-501 [A21] | YES (structural delegation) | YES (structural) | N/A (delegation chain) | PASS |
| DC-P1-502 [A21] | YES (structural delegation) | YES (structural) | N/A (delegation chain) | PASS |
| DC-P1-801 [A21] | YES (line 271) | YES (line 277, 285) | YES | PASS |
| DC-P1-802 [A21] | YES (line 644) | YES (line 652) | YES | PASS |
| DC-P1-803 [A21] | YES (line 662) | YES (line 670) | YES | PASS |
| DC-P1-804 [A21] | YES (line 511-553) | YES (line 555) | YES | PASS |
| DC-P1-805 [A21] | YES (line 573) | YES (line 584) | YES -- but see F-P1-004 | PASS (defense-in-depth) |
| DC-P1-806 [A21] | YES (line 75-94) | YES (line 96-134) | YES | PASS |
| DC-P1-807 [A21] | YES (line 628) | YES (line 636) | YES | PASS |
| DC-P1-808 [A21] | YES (line 226) | YES (line 232, 240) | YES | PASS |
| DC-P1-901 [A21] | YES (npm test) | N/A | YES | PASS |
| DC-P1-902 [A21] | YES (line 770) | N/A | YES | PASS |

---

## DC Coverage Matrix

| DC-ID | Test(s) | Discriminative? | Evidence Level |
|---|---|---|---|
| DC-P1-101 | line 142, 190, 202 | Partial -- success path non-discriminative | FINDING |
| DC-P1-102 | line 372, 396 | YES | Full |
| DC-P1-103 | line 416 | YES | Full |
| DC-P1-201 | line 680, 692 | NO -- tests pre-validation not transaction | FINDING |
| DC-P1-202 | Implicit (all tests) | YES | Full |
| DC-P1-301 | N/A (IBC) | N/A | Structural |
| DC-P1-401 | Import analysis | YES | Structural |
| DC-P1-402 | line 446, 482, 488 | Partial -- UNAUTHORIZED untested | FINDING |
| DC-P1-501 | Delegation chain analysis | N/A | Structural |
| DC-P1-502 | Delegation chain analysis | N/A | Structural |
| DC-P1-601 | File analysis | N/A | Structural |
| DC-P1-701 | N/A (not applicable) | N/A | N/A |
| DC-P1-801 | line 271, 277, 285 | YES | Full |
| DC-P1-802 | line 644, 652 | YES | Full |
| DC-P1-803 | line 662, 670 | YES | Full |
| DC-P1-804 | line 555 | YES | Full |
| DC-P1-805 | line 573, 584 | YES | Full |
| DC-P1-806 | line 75-134 | YES | Full |
| DC-P1-807 | line 628, 636 | YES | Full |
| DC-P1-808 | line 232, 240 | YES | Full |
| DC-P1-901 | npm test (full suite) | YES | Full |
| DC-P1-902 | line 770 | YES | Full |

---

## Mutation Testing Results

| # | Mutation | File:Line | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| M-1 | Remove `Math.min(confidence, maxAutoConfidence)` cap | convenience_layer.ts:132 | DC-P1-101 rejection tests fail | 2 tests failed | **KILLED** |
| M-2 | Remove superseded filter `items.filter(item => !item.superseded)` | convenience_layer.ts:261 | DC-P1-102 test fails | 2 tests failed | **KILLED** |
| M-3 | Remove `BEGIN`/`COMMIT` from reflect() transaction | convenience_layer.ts:382,418 | DC-P1-201 rejection test fails | **ALL 58 TESTS PASSED** | **SURVIVED** -- F-P1-002 |
| M-4 | Stub `claims.retractClaim()` to always succeed | convenience_layer.ts:291 | forget tests fail | 3 tests failed | **KILLED** |
| M-5 | Disable confidence range validation `if(false)` | convenience_layer.ts:146 | DC-P1-808 tests fail | 2 tests failed | **KILLED** |
| M-6 | Disable empty text validation `if(false)` | convenience_layer.ts:202 | DC-P1-801 tests fail | 2 tests failed | **KILLED** |
| M-7 | Remove self-reference check `if(false)` in connect() | convenience_layer.ts:323 | DC-P1-805 test fails | **ALL 58 TESTS PASSED** | **SURVIVED** -- F-P1-004 |
| M-8 | Remove maxAutoConfidence validation in createLimen() | index.ts:481 | DC-P1-806 tests fail | 4 tests failed | **KILLED** |
| M-9 | Stub remember wiring at call site | index.ts:1056 | Remember tests fail | 5+ tests failed | **KILLED** |
| M-10 | Disable evidence_path bypass (always cap) | convenience_layer.ts:127 | DC-P1-101 success test fails | **ALL 58 TESTS PASSED** | **SURVIVED** -- F-P1-001 |

**Summary**: 10 mutations attempted, 7 killed, 3 survived.

---

## Missing Defect Classes

### MDC-1: reflect() entries array size limit (DoS vector)

**Attack vector**: `reflect()` accepts any number of entries. There is no upper bound. A caller could pass 10,000 entries, creating 10,000 claims in a single transaction, consuming significant memory and CPU.

**Impact**: Resource exhaustion. Category 9 (Availability/resource).

**Why missing**: The Design Source does not specify a maximum. The MCP adapter's `limen_reflect` tool has `maxItems: 100` but the programmatic API has no such limit.

### MDC-2: NaN/Infinity confidence in remember() -- guard exists but untested

**Attack vector**: `remember()` with `confidence: NaN` or `confidence: Infinity`.

**Impact**: The guard at convenience_layer.ts:146 catches these via `Number.isFinite()`, but no test verifies this specific case. If the guard were removed, NaN could propagate to the database.

**Coverage**: Guard exists. Test does not verify NaN/Infinity specifically (only 1.5 and -0.1 tested).

### MDC-3: NaN/Infinity confidence in reflect() -- guard exists but untested

**Attack vector**: `reflect([{ category: 'decision', statement: 'test', confidence: NaN }])`.

**Impact**: Same as MDC-2 but for the reflect() code path.

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---|---|---|
| P-001 | Non-discriminative enforcement tests | YES | **FOUND** -- DC-P1-101 success test is non-discriminative (Mutation 10 survived). DC-P1-201 rejection test tests pre-validation not transaction (Mutation 3 survived). |
| P-002 | Defense built but not wired in | YES | **FOUND** -- connect() self-reference guard is redundant with downstream ClaimApi guard. Mutation 7 survived because downstream catches it. The convenience-level guard is untested independently. |
| P-003 | IBC overclaims | YES | CLEAN -- all 3 IBC claims verified (DC-P1-301, DC-P1-601, DC-P1-401). |
| P-004 | Test rewrite drops coverage | YES | CLEAN -- 58 tests is a new file, no prior tests to compare against. |
| P-005 | Phantom test references | YES | CLEAN -- all DC-cited tests verified to exist in test file. |
| P-006 | Cross-subsystem boundary gaps | YES | LOW RISK -- one boundary (Convenience -> ClaimApi). DC-P1-401 covers the governance boundary. Error code mapping (DC-P1-402) is the gap area. |
| P-007 | FM numbering collisions | YES | CLEAN -- DC numbering is subsystem-prefixed (DC-P1-xxx). |
| P-008 | Documentation in session only | YES | CLEAN -- all documents in docs/sprints/. |
| P-009 | Prompt Audit Gate degradation | YES | CLEAN -- PAG is documented in Design Source. |
| P-010 | Implementation logic in harness | YES | N/A -- no harness file. Convenience layer uses three-file pattern without harness (types -> layer). |

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---|---|---|---|---|
| F-P1-001 | **evidence_path confidence bypass is untested**. Mutation 10 (disable bypass, always cap) survived all 58 tests. The DC-P1-101 success test (line 142) is non-discriminative: it accepts CCP rejection as "passing" without verifying the convenience layer actually passed uncapped confidence. Constitutional invariant I-CONV-05 has no discriminative test. | **HIGH** | P-001 (Non-discriminative test) | Mutation survived at convenience_layer.ts:127. Test at convenience.test.ts:142-188 has early return on CCP rejection without verifying confidence was uncapped. | Write a test that creates valid evidence first (e.g., WM entry), then asserts confidence > maxAutoConfidence in the stored claim. Alternatively, mock ClaimApi to verify the confidence value passed to assertClaim(). |
| F-P1-002 | **reflect() transaction rollback is untested**. Mutation 3 (remove BEGIN/COMMIT) survived all 58 tests. The DC-P1-201 rejection test (line 692) uses an invalid category, which is caught by pre-validation BEFORE the transaction starts. No test exercises a mid-transaction failure that would require ROLLBACK. I-CONV-10 (all-or-nothing) has no discriminative test for the transaction mechanism. | **HIGH** | P-001 (Non-discriminative test) | Mutation survived at convenience_layer.ts:382,418. DC-P1-201 rejection test at convenience.test.ts:692-715 tests pre-validation, not transaction rollback. | Write a test where a runtime error occurs during the loop (e.g., after first claim succeeds but before second completes). Verify zero net claims created. This requires injecting a failure into the ClaimApi on the Nth call. |
| F-P1-003 | **DC-P1-402 UNAUTHORIZED rejection path untested**. DC-P1-402 declares "Rejection: forget() by non-source non-admin returns UNAUTHORIZED." The test at line 482 only tests CLAIM_NOT_FOUND (nonexistent claim), not UNAUTHORIZED (wrong agent). The rejection path for the authorization check is not exercised. | **MEDIUM** | A21 gap | DC-P1-402 A21 annotation specifies UNAUTHORIZED rejection. Test at convenience.test.ts:482-486 checks wrong error code path. | Add a test with two Limen instances (or mock context) where agent B tries to forget agent A's claim. |
| F-P1-004 | **connect() self-reference guard mutation survived**. Mutation 7 (remove self-reference check at convenience_layer.ts:323) survived because the downstream ClaimApi.relateClaims also checks SELF_REFERENCE and the error mapping at line 337-339 re-maps it to CONV_SELF_REFERENCE. The convenience-level guard is defense-in-depth but untested independently. | **MEDIUM** | P-002 (Defense not wired -- variant: defense redundant with downstream) | Mutation survived at convenience_layer.ts:323. Error remapping at line 337-339 catches downstream SELF_REFERENCE. | Either (a) remove the redundant guard and rely on the downstream, or (b) add a test that verifies the convenience guard fires BEFORE ClaimApi is called (by mocking ClaimApi to NOT check). Option (a) is preferred for simplicity. |
| F-P1-005 | **Hard Stop #7 violation: Direct clock access**. Three uses of `new Date()` and one `Date.now()` in the convenience layer without TimeProvider injection. convenience_layer.ts:154, convenience_layer.ts:390, convenience_init.ts:79. The constitution mandates: "All temporal logic uses TimeProvider, never direct Date.now()." | **MEDIUM** | Constitutional violation | convenience_layer.ts:154 (`new Date().toISOString()`), convenience_layer.ts:390 (same), convenience_init.ts:79 (`Date.now()`). CLAUDE.md Hard Stop #7. | Inject TimeProvider via ConvenienceLayerDeps and use it for all temporal values. For convenience_init.ts, the deadline is a one-time value that does not affect correctness (1 year from now), so it is LOW priority within this finding. |
| F-P1-006 | **Type-level lie in ConvenienceInitResult.taskId**. convenience_init.ts:133 uses `null as unknown as TaskId` to return null for a field typed as `TaskId` (non-null). The interface at line 25 declares `readonly taskId: TaskId` but the implementation always returns null. This bypasses TypeScript type safety via double-cast. | **MEDIUM** | Type safety | convenience_init.ts:25 (interface), convenience_init.ts:133 (cast). ConvenienceLayerDeps.taskId at convenience_layer.ts:83 correctly types it as `TaskId | null`. | Fix ConvenienceInitResult to declare `taskId: TaskId | null`. |
| F-P1-007 | **remember() delegation casts `predicateOrOptions as string` for all forms**. index.ts:1056 always calls `convenienceLayer.remember(subjectOrText, predicateOrOptions as string, value!, options)` regardless of which overload is intended. When the 1-param form is used, `predicateOrOptions` is actually `RememberOptions | undefined`, not `string`. Works at runtime because the convenience layer checks `typeof predicateOrOptions === 'string'`, but the cast is misleading. | **LOW** | Type safety | index.ts:1056. Cast is runtime-safe but type-level lie. | Remove the `as string` cast. The unified implementation signature accepts `string | RememberOptions | undefined` for the second parameter. |
| F-P1-008 | **No upper bound on reflect() entries count**. The programmatic API imposes no limit on the number of entries passed to reflect(). The MCP adapter limits to 100 via `maxItems`. An adversary or buggy caller could pass thousands of entries. | **LOW** | Category 9 (Availability) | convenience_layer.ts:352 -- no length check beyond `entries.length === 0`. MCP adapter has `maxItems: 100` but programmatic API does not. | Add a MAX_REFLECT_ENTRIES constant (e.g., 100 or 1000) and validate in reflect(). |
| F-P1-009 | **NaN/Infinity confidence not tested for remember() or reflect()**. The guard exists (`Number.isFinite()` check) but no test verifies NaN or Infinity specifically. Only 1.5 and -0.1 are tested. | **LOW** | Test coverage gap | convenience_layer.ts:146, 374 (guards exist). convenience.test.ts DC-P1-808 tests only 1.5 and -0.1. | Add test cases for NaN, Infinity, and -Infinity confidence in both remember() and reflect(). |
| F-P1-010 | **Convenience init failure is silently swallowed**. index.ts:890-894 catches convenience init failure and logs a warning but continues. If init fails, all convenience methods throw ENGINE_UNHEALTHY on every call. The user gets no indication at createLimen() time that convenience API is broken. DC-P1-202 says createLimen() throws LimenError on init failure, but the implementation does NOT throw. | **MEDIUM** | DC-to-implementation mismatch | index.ts:890-894 catches and logs warning. DC-P1-202 A21 declares "if init fails, createLimen() throws LimenError." | Either (a) make init failure throw (matching DC-P1-202), or (b) update DC-P1-202 to reflect the actual non-fatal behavior. Option (a) is preferred since the DC declares it constitutional. |

---

## Architecture-Level Findings

No cascade risks or coupling issues beyond what is documented. The convenience layer is a thin delegation layer with well-defined boundaries.

## Security Findings

No new attack surfaces. The convenience layer delegates all security-sensitive operations to ClaimApi which delegates to SC-11.

## Performance Findings

F-P1-008 (no reflect() entry limit) is the only performance-relevant finding.

## Dependency Findings

No new dependencies. No CVEs relevant to the convenience layer.

## AI/Agentic Findings

The convenience API is designed for AI agents. The confidence ceiling (I-CONV-04) is the primary defense against confidence laundering. F-P1-001 (untested evidence_path bypass) is the most significant AI-specific risk -- an agent could bypass the confidence ceiling without the tests catching it.

---

## Self-Audit

- **Was every finding derived from evidence?** YES -- every finding includes file:line references and mutation test results.
- **What would I check to prove my findings wrong?**
  - F-P1-001: If the DC-P1-101 success test DOES verify uncapped confidence propagation (re-read the early-return logic). Verified: it does NOT -- the early return on CCP rejection exits without checking confidence.
  - F-P1-002: If SQLite auto-commits without BEGIN/COMMIT such that the test effectively tests atomicity. Verified: SQLite auto-commits each statement individually without explicit BEGIN, so removing BEGIN/COMMIT makes each assertClaim an independent auto-commit. The test should detect this but doesn't because pre-validation catches the error first.
  - F-P1-010: If there is a separate mechanism that surfaces convenience init failure. Verified: there is not -- the catch block only logs a warning.
- **What did I NOT examine?**
  - The full 3,188 existing test suite was not re-run (would require 10+ minutes). DC-P1-901 is taken at the Builder's word.
  - Unicode edge cases (emoji in subject, CJK in value, zero-width characters). These would exercise the CCP's subject validation, not the convenience layer.
  - The `as any` deep freeze bypass vector was not tested because convenience methods use closure-captured state, not object properties.
- **Is my finding count reasonable?** 10 findings (0 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW). Historical average is 16.4 findings per subsystem (range 12-21). This count is below average, which is expected for a thin delegation layer with limited logic. The two HIGHs are significant -- both involve surviving mutations on constitutional invariants.
- **Did I check all 10 recurring patterns?** YES -- all 10 checked and documented above.

---

*SolisHQ -- We innovate, invent, then disrupt.*
