# PHASE 4: Quality & Safety -- Breaker Pass B Report (Independent Verification)

**Date**: 2026-03-30
**Role**: Breaker (SolisHQ Engineering) -- Independent Second Pass
**Target**: Phase 4 Quality & Safety implementation
**Baseline**: 26 tests, all passing
**Version Pin**: CLAUDE.md v2.3+A24

---

## Prompt Audit Gate

No issues found. Prompt specified 8 priority attack vectors with file references and explicit mandatory checks.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Status |
|------|------|-----------------|--------|
| OG-THREAT | oracle_threat_model | DEGRADED | Intelligence MCP unavailable -- manual STRIDE analysis performed |
| OG-FMEA | oracle_fmea | DEGRADED | Intelligence MCP unavailable -- manual FMEA performed |

### Manual STRIDE Analysis (OG-THREAT Degradation Compensation)

| STRIDE Category | Threat Identified | DC Coverage | Gap |
|----------------|-------------------|-------------|-----|
| Spoofing | RBAC bypass when `requireRbac=true` | DC-P4-401 | **ZERO TESTS for requireRbac=true** |
| Tampering | Cascade multiplier mutation | DC-P4-801 | Covered by constant tests |
| Repudiation | `.raw` access without audit | DC-P4-403, DC-P4-404 | **ZERO TESTS for audit logging** |
| Information Disclosure | Cross-tenant cascade leakage | DC-P4-103 | Tested by TenantScopedConnection (existing) |
| Denial of Service | N+1 cascade query explosion | DC-P4-902 | Bounded by depth 2 -- acceptable |
| Elevation of Privilege | Retraction without valid reason | DC-P4-104 | **Rejection path untested at integration level** |

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|-------|--------------|-----------------|---------------------|---------|
| DC-P4-101 | quality_safety.test.ts:66 | quality_safety.test.ts:112 | YES | PASS |
| DC-P4-102 | quality_safety.test.ts:91 | quality_safety.test.ts:112 | YES | PASS |
| DC-P4-103 | (no integration test) | (no integration test) | N/A | **UNCOVERED** -- relies on TenantScopedConnection from prior phases |
| DC-P4-104 | quality_safety.test.ts:171 | **MISSING** | N/A | **FAIL -- no rejection test for invalid reason** |
| DC-P4-201 | (transactional -- tested via DC-P4-101) | N/A (structural) | N/A | PASS (structural guarantee) |
| DC-P4-202 | quality_safety.test.ts:66 (disputed=true) | quality_safety.test.ts:91 (disputed=false) | YES | PASS |
| DC-P4-203 | quality_safety.test.ts:143 | cascade.test.ts:93 (unit only) | **NO -- unit test is mock-based, integration has no retracted-ancestor test** | **FAIL** |
| DC-P4-401 | **MISSING** | **MISSING** | N/A | **FAIL -- ZERO tests for requireRbac=true** |
| DC-P4-402 | quality_safety.test.ts:203 | N/A (guard off) | N/A | PASS |
| DC-P4-403 | **MISSING** | **MISSING** | N/A | **FAIL -- ZERO tests for .raw audit with RBAC** |
| DC-P4-404 | quality_safety.test.ts:227 (non-discriminative) | N/A | **NO -- test checks health(), not audit logging** | **FAIL** |
| DC-P4-601 | (migration runs at boot) | (IF NOT EXISTS) | N/A | PASS (structural) |
| DC-P4-602 | quality_safety.test.ts:171 | **MISSING** | N/A | **FAIL -- same as DC-P4-104** |
| DC-P4-801 | cascade.test.ts:23 | cascade.test.ts:27 | YES | PASS |
| DC-P4-802 | cascade.test.ts:134 | cascade.test.ts:119 | YES | PASS |
| DC-P4-803 | cascade.test.ts:168 | N/A | **NO -- pure arithmetic test, not integration** | **FAIL -- non-discriminative** |
| DC-P4-804 | conflict.test.ts:21 | N/A | YES (constant check) | PASS |

**Summary**: 8 of 17 testable DCs FAIL the A21 audit. This is a significant coverage gap.

---

## DC Coverage Matrix

| DC-ID | Test(s) | Discriminative? | Evidence Level |
|-------|---------|-----------------|----------------|
| DC-P4-101 | quality_safety:66, conflict.test:46 | YES | Integration + Unit |
| DC-P4-102 | quality_safety:91, quality_safety:112, conflict.test:55 | YES | Integration + Unit |
| DC-P4-103 | NONE | N/A | **UNCOVERED** |
| DC-P4-104 | quality_safety:171 (success only) | NO (no rejection) | **PARTIAL** |
| DC-P4-201 | (via DC-P4-101 transaction) | Structural | Structural |
| DC-P4-202 | quality_safety:66 | YES | Integration |
| DC-P4-203 | quality_safety:143, cascade.test:84 | **NO at integration level** | **PARTIAL** |
| DC-P4-301 | NONE (structural via SQLite) | N/A | Structural |
| DC-P4-302 | NONE (QUALITY_GATE) | N/A | N/A |
| DC-P4-401 | **NONE** | N/A | **UNCOVERED** |
| DC-P4-402 | quality_safety:203, quality_safety:214 | YES | Integration |
| DC-P4-403 | **NONE** | N/A | **UNCOVERED** |
| DC-P4-404 | quality_safety:227 (non-discriminative) | NO | **NON-DISCRIMINATIVE** |
| DC-P4-501 | (via DC-P4-101 audit) | Implicit | Implicit |
| DC-P4-502 | (DESIGN_PRINCIPLE) | N/A | N/A |
| DC-P4-601 | (migration boot) | Structural | Structural |
| DC-P4-602 | quality_safety:171 (success only) | NO (no rejection) | **PARTIAL** |
| DC-P4-801 | cascade.test:23, cascade.test:27 | YES | Unit |
| DC-P4-802 | cascade.test:38, cascade.test:134 | YES | Unit |
| DC-P4-803 | cascade.test:168 (non-discriminative) | **NO** | **NON-DISCRIMINATIVE** |
| DC-P4-804 | conflict.test:21 | YES | Unit |
| DC-P4-901 | NONE (QUALITY_GATE) | N/A | N/A |
| DC-P4-902 | NONE (QUALITY_GATE) | N/A | N/A |
| DC-P4-903 | NONE (QUALITY_GATE) | N/A | N/A |

---

## Mutation Testing Results

Independent second-pass mutations. 15 mutations total, independently executed with full test suite verification.

| # | Mutation | File:Line | Expected | Actual | Verdict |
|---|---------|-----------|----------|--------|---------|
| M-1 | Change CASCADE_FIRST_DEGREE_MULTIPLIER 0.5 -> 1.0 | cascade.ts:20 | cascade.test fails | 3 tests failed (expected 0.5, got 1.0) | **KILLED** |
| M-2 | Change CASCADE_SECOND_DEGREE_MULTIPLIER 0.25 -> 0.5 | cascade.ts:27 | cascade.test fails | 2 tests failed | **KILLED** |
| M-3 | Change CASCADE_MAX_DEPTH 2 -> 10 | cascade.ts:34 | cascade.test fails | 1 test failed (expected 2, got 10) | **KILLED** (constant test only -- depth is dead code) |
| M-4 | Remove early return when no parents (`if (parents.length === 0) return 1.0`) | cascade.ts:71 | cascade.test fails | ALL 12 PASSED | **SURVIVED** |
| M-5 | Remove `AND status = 'active'` from conflict detection query | conflict.ts:64 | quality_safety fails | DC-P4-102 rejection failed | **KILLED** |
| M-6 | Remove `AND object_value != ?` from conflict detection query | conflict.ts:64 | quality_safety fails | DC-P4-102 success failed | **KILLED** |
| M-7 | Disable conflict detection at call site (autoConflictEnabled = false) | claim_stores.ts:1404 | quality_safety fails | DC-P4-101 failed | **KILLED** |
| M-8 | Bypass cascade penalty in query path (hardcode 1.0) | claim_stores.ts:534 | Tests should fail | ALL 22 PASSED | **SURVIVED** |
| M-9 | Bypass retraction reason taxonomy validation (`if (false)`) | claim_stores.ts:1538 | Tests should fail | ALL 10 PASSED | **SURVIVED** |
| M-10 | Change DEFAULT_AUTO_CONFLICT_THRESHOLD 0.8 -> 0.0 | conflict.ts:23 | conflict.test fails | Constant test failed | **KILLED** (but constant is dead code) |
| M-11 | Disable forceActive RBAC (`if (false && forceActive)`) | rbac_engine.ts:82 | Tests should fail | ALL 10 PASSED | **SURVIVED** |
| M-12 | Disable .raw audit logging (`if (false)` on auditLogger call) | tenant_scope.ts:182 | Tests should fail | ALL 10 PASSED | **SURVIVED** |
| M-13 | Disable .raw RBAC tag enforcement (`if (false)` on requireRbac check) | tenant_scope.ts:186 | Tests should fail | ALL 10 PASSED | **SURVIVED** |
| M-14 | Replace conflict iteration with empty array | claim_stores.ts:1412 | quality_safety fails | DC-P4-101 failed | **KILLED** |
| M-15 | Bypass convenience layer reason validation (`if (false)`) | convenience_layer.ts:306 | convenience.test fails | ALL 75 PASSED | **SURVIVED** |

**Kill rate**: 8 of 15 mutations killed (53.3%). **7 SURVIVED** -- 5 on CONSTITUTIONAL invariants, 2 on defense-in-depth layers.

**Surviving mutations on CONSTITUTIONAL invariants:**
- M-8: Cascade penalty call site bypass (I-P4-05)
- M-9: Retraction reason taxonomy bypass (I-P4-15, I-P4-17)
- M-11: RBAC forceActive bypass (I-P4-11)
- M-12: .raw audit logging bypass (I-P4-13)
- M-13: .raw RBAC tag enforcement bypass (I-P4-14)

**Surviving mutations on defense-in-depth:**
- M-4: Cascade early return removal (function-level, not call-site)
- M-15: Convenience layer reason validation bypass (dual-validation layer)

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-P4-001 | **Retraction reason taxonomy validation mutation survived at BOTH layers (M-9 + M-15)**. DC-P4-104 has no rejection-path test anywhere. Zero tests pass an invalid reason like 'arbitrary_text' to forget() or retractClaim(). Both convenience_layer.ts:306 and claim_stores.ts:1538 validation removable with zero test failure. `grep -r 'invalid.*reason\|CONV_INVALID_REASON' tests/` returns zero hits. | **HIGH** | A21 violation + P-001 | claim_stores.ts:1538 mutated to `if (false)`, all tests pass. convenience_layer.ts:306 mutated to `if (false)`, all 75 tests pass. Only existing reason test (contract_ccp.test.ts:916) tests empty string, not taxonomy violation. | Add test: `forget(claimId, 'INVALID_TEXT' as any)` must return error. Add test at store level: retractClaim with reason='bogus' must return INVALID_REASON. |
| F-P4-002 | **Cascade penalty at query call site mutation survived (M-8)**. `computeCascadePenalty(conn, claimIdVal)` replaced with `1.0` in query path -- all 22 tests pass (cascade unit + quality_safety integration). No integration test creates a `derived_from` relationship, retracts the parent, then verifies effectiveConfidence is penalized. | **HIGH** | Defense not wired-tested (P-002) | claim_stores.ts:534 mutated to `1.0`, 22/22 tests pass. The only cascade integration test (quality_safety.test.ts:143) tests a claim with NO derived_from edges -- cascade penalty is 1.0 regardless of implementation. | Add integration test: remember A -> remember B -> connect(B, A, derived_from) -> forget(A) -> recall B -> assert effectiveConfidence < storedConfidence. |
| F-P4-003 | **Cascade penalty at search call site mutation survived (M-8 covers both paths)**. Same as F-P4-002 but in the search path (claim_stores.ts:755). Zero search integration tests for Phase 4. | **HIGH** | Defense not wired-tested (P-002) | claim_stores.ts:755 also bypassed with no test failure. | Add search integration test with derived_from + retracted parent, verify search score reflects penalty. |
| F-P4-004 | **RBAC forceActive mutation survived (M-11)**. ZERO tests for `requireRbac=true` anywhere in entire test suite. DC-P4-401 (CONSTITUTIONAL) and DC-P4-403 (CONSTITUTIONAL) have zero integration tests. `grep -r 'requireRbac.*true' tests/` returns empty. | **HIGH** | A21 violation -- missing both paths | rbac_engine.ts:82 `if (forceActive)` changed to `if (false && forceActive)`, all tests pass. | Add: `createLimen({requireRbac: true})` -> remember() with no permissions -> assert UNAUTHORIZED. Add: .raw access without rawAccessTag when requireRbac=true -> assert throws. |
| F-P4-005 | **.raw audit logging mutation survived (M-12)**. The auditLogger callback in tenant_scope.ts:182 can be disabled with zero test failure. DC-P4-404 test checks `health()` truthy, not audit entries. `grep -r 'auditLogger\|rawAccessTag\|raw_access' tests/` returns empty. | **HIGH** | A21 violation -- zero test coverage for CONSTITUTIONAL invariant I-P4-13 | tenant_scope.ts:182 `if (rawAccessConfig.auditLogger)` changed to `if (false)`, all tests pass. | Add unit test for createTenantScopedConnection with mock auditLogger -- verify callback fires on .raw access. |
| F-P4-006 | **.raw RBAC tag enforcement mutation survived (M-13)**. The requireRbac + rawAccessTag guard in tenant_scope.ts:186 can be disabled with zero test failure. DC-P4-403 CONSTITUTIONAL invariant I-P4-14 is untested. | **HIGH** | A21 violation -- zero test coverage for CONSTITUTIONAL invariant I-P4-14 | tenant_scope.ts:186 `if (rawAccessConfig.requireRbac && !rawAccessConfig.rawAccessTag)` changed to `if (false)`, all tests pass. | Add unit test: createTenantScopedConnection with requireRbac=true and no rawAccessTag -> .raw access -> assert throws. |
| F-P4-007 | DC-P4-803 "cascade composes multiplicatively" test is non-discriminative. Test computes `0.8 * 0.9 * 0.5 = 0.36` in LOCAL VARIABLES -- does not test the actual composition in claim_stores.ts. Would pass if implementation used additive composition. | **MEDIUM** | Non-discriminative test (P-001) | cascade.test.ts:168-180 -- pure arithmetic, no call to computeCascadePenalty or claim API. | Replace with integration test that verifies effectiveConfidence through actual query pipeline. |
| F-P4-008 | `CASCADE_MAX_DEPTH` constant is dead code. Exported and tested (cascade.test.ts:38) but NEVER used in `computeCascadePenalty` function body. Depth limit enforced structurally by two-level nested loop. The constant could change to 99 with zero behavioral effect. | **MEDIUM** | Dead code / P-002 variant | cascade.ts:34 -- `CASCADE_MAX_DEPTH = 2` declared but not referenced in lines 59-116 (function body). | Either use the constant to control loop depth programmatically, or document structural bound and remove unused constant. |
| F-P4-009 | `DEFAULT_AUTO_CONFLICT_THRESHOLD` constant is dead code. Defined in conflict.ts:23, tested in conflict.test.ts:21, imported in conflict.test.ts but never imported or used anywhere else in source. It controls nothing. | **MEDIUM** | Dead code / P-002 variant | conflict.ts:23 -- constant defined, tested, never consumed. `grep -rn DEFAULT_AUTO_CONFLICT_THRESHOLD src/` shows only definition line. | Either wire threshold into conflict detection logic or remove it. Current state provides false assurance. |
| F-P4-010 | **Cascade fast-path mutation survived (M-4)**. Removing `if (parents.length === 0) return 1.0` early return does not cause test failure. When no parents exist, the loop body simply doesn't execute and `worstPenalty = 1.0` is returned anyway. This is not a defect but indicates the early return is optimization-only -- structurally safe. | **LOW** | Defense-in-depth (not a vulnerability) | cascade.ts:71 removed, all 12 unit tests pass. The loop naturally returns 1.0 when parents list is empty. | Acceptable. Document as optimization, not guard. |
| F-P4-011 | DC-P4-103 (cross-tenant cascade leakage) has no Phase 4 test. Relies on TenantScopedConnection from prior phases. | **LOW** | Boundary gap (P-006) | No test in quality_safety.test.ts creates a multi-tenant cascade scenario. | Acceptable risk if TenantScopedConnection tests are comprehensive. |
| F-P4-012 | Migration file named `031_conflict_index.ts` but contains version 40. | **LOW** | Documentation (P-007 variant) | 031_conflict_index.ts:51 `buildEntry(40, ...)` vs filename `031`. | Rename to `040_conflict_index.ts` for consistency. |
| F-P4-013 | Phase 4 Design Source document not found in worktree. DC declaration and truth model reference `docs/sprints/PHASE-4-DESIGN-SOURCE.md`. | **LOW** | Documentation gap (P-008) | `ls docs/sprints/PHASE-4-*` shows only DC-DECLARATION.md, TRUTH-MODEL.md, BREAKER-REPORT.md. | Ensure Design Source is committed before merge. |

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative enforcement tests | YES | **FOUND**: DC-P4-803 (cascade composition -- pure arithmetic, F-P4-007), DC-P4-404 (health check not audit check, F-P4-005), DC-P4-104 "rejection" tests default reason not invalid input (F-P4-001). 3 instances. |
| P-002 | Defense built but not wired in | YES | **FOUND**: CASCADE_MAX_DEPTH unused in function (F-P4-008). DEFAULT_AUTO_CONFLICT_THRESHOLD not imported anywhere (F-P4-009). Cascade penalty wired at call sites but untested through integration (F-P4-002, F-P4-003). .raw audit logging wired but untested (F-P4-005, F-P4-006). 6 instances. |
| P-003 | IBC overclaims | YES | No "impossible by construction" claims in Phase 4 declaration. All claims are CBM. CLEAR. |
| P-004 | Test rewrite drops coverage | YES | New test files, no rewrite of existing tests. CLEAR. |
| P-005 | Phantom test references | YES | DC declaration references test mechanisms. All referenced tests exist. CLEAR. |
| P-006 | Cross-subsystem boundary gaps | YES | **FOUND**: DC-P4-103 cascade-to-tenant boundary (F-P4-011). Cascade at ClaimStore boundary untested (F-P4-002, F-P4-003). 3 instances. |
| P-007 | FM numbering collisions | YES | **FOUND** (variant): Migration file naming inconsistency (F-P4-012). |
| P-008 | Documentation in session only | YES | **FOUND**: PHASE-4-DESIGN-SOURCE.md not in worktree (F-P4-013). |
| P-009 | Prompt Audit Gate degradation | YES | PAG instruction present in Breaker prompt. CLEAR. |
| P-010 | Implementation logic in harness | YES | No harness file for Phase 4. CLEAR. |

---

## Architecture-Level Findings

1. **Cascade penalty is computed per-claim in a loop**: For a query returning N claims, cascade penalty runs 1 + K queries per claim (K = number of parents). With 50 claims each having 2 parents, that's 150 additional queries per recall(). Within QUALITY_GATE budget for small result sets.

2. **Double validation of retraction reason**: Both convenience_layer.ts:306 and claim_stores.ts:1538 validate against VALID_RETRACTION_REASONS. Defense-in-depth is acceptable but BOTH layers survived mutation (M-9 + M-15), meaning neither layer is tested for rejection.

3. **Convenience layer masks store-level gaps**: All integration tests route through the convenience API. When the convenience layer has its own validation (e.g., reason taxonomy), store-level validation gaps are invisible to tests. This means a consumer using the low-level ClaimApi directly would bypass convenience validation -- and the store validation is also untested.

---

## Security Findings

1. **RBAC enforcement is untested (F-P4-004)**: The `requireRbac=true` path has zero tests. M-11 survived. CONSTITUTIONAL invariant I-P4-11 with zero coverage.

2. **.raw audit gating is untested (F-P4-005, F-P4-006)**: Both the audit logging callback (M-12) and the RBAC-gated throw (M-13) survived mutation. CONSTITUTIONAL invariants I-P4-13 and I-P4-14 with zero coverage.

3. **Retraction reason bypass at both layers (F-P4-001)**: Taxonomy validation can be disabled at convenience layer AND store layer with zero detection. A low-level API consumer could store arbitrary retraction reasons.

---

## Performance Findings

No performance defects found. Cascade depth bounded at 2 (structurally, not by the dead-code constant). Conflict detection uses compound partial index. All within spec budgets.

---

## Dependency Findings

OG-THREAT DEGRADED -- manual review performed. No new dependencies introduced in Phase 4.

---

## Self-Audit

- **Was every finding derived from evidence?** YES. 15 mutations executed, each with file:line, mutation description, and full test suite result (pass/fail counts).
- **What would I check to prove my findings wrong?** Search for requireRbac=true tests in all test files (done -- zero). Search for invalid reason tests (done -- zero). Run cascade mutation against full test suite including metabolism.test.ts (done -- still survived). Check if .raw audit tests exist in tenant tests (done -- zero matches for auditLogger/rawAccessTag).
- **What did I NOT examine?** Performance benchmarks (QUALITY_GATE). Cross-session cascade behavior. Concurrent write-then-read cascade scenarios (QUALITY_GATE). AI/Agentic threats (not applicable to Phase 4).
- **Is my finding count reasonable?** 13 findings (0 CRITICAL, 6 HIGH, 3 MEDIUM, 4 LOW). Higher than prior pass (11 findings, 4 HIGH) due to additional mutations M-12, M-13, M-15 discovering independently surviving mutations on .raw audit and convenience layer. Historical average: 16.4. Consistent.
- **Did I check all 10 recurring patterns?** YES. 6 patterns found positive.
- **Independent verification of prior report**: All 11 prior findings confirmed. 2 new HIGH findings added (F-P4-005, F-P4-006) for .raw audit/RBAC gating mutations.

---

## Oracle Gates Summary (HB#29)

| Gate | Status | Evidence |
|------|--------|----------|
| OG-THREAT | DEGRADED -- MCP unavailable | Manual STRIDE table above |
| OG-FMEA | DEGRADED -- MCP unavailable | Manual failure mode analysis in mutation testing (15 mutations) |

---

## Verdict

**CONDITIONAL PASS** -- 6 HIGHs must be fixed before merge:

1. **F-P4-001** (retraction reason rejection test missing at BOTH layers -- M-9 + M-15 survived)
2. **F-P4-002** (cascade penalty in query path untested -- M-8 survived)
3. **F-P4-003** (cascade penalty in search path untested -- M-8 survived)
4. **F-P4-004** (RBAC enforcement requireRbac=true zero tests -- M-11 survived)
5. **F-P4-005** (.raw audit logging zero tests -- M-12 survived)
6. **F-P4-006** (.raw RBAC tag enforcement zero tests -- M-13 survived)

All 6 HIGHs are surviving mutations on CONSTITUTIONAL invariants. The Builder must add integration tests that kill these mutations before the Certifier can proceed.

---

*SolisHQ -- We innovate, invent, then disrupt.*
