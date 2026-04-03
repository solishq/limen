# Phase 10: Governance Suite -- Certifier Report

**Date**: 2026-04-03
**Certifier**: Independent Certifier (Session 3 -- structural separation)
**Criticality**: Tier 1 (governance, authorization, compliance)
**Builder tests**: 52 (tests/unit/phase10_governance.test.ts)
**Breaker tests**: 16 (tests/breaker/phase10_breaker.test.ts)
**Full suite**: 3759 pass, 0 fail, 81 skipped

---

## Oracle Gate Summary

| Gate | Tool | Status | Evidence |
|------|------|--------|----------|
| OG-TRACE | oracle_trace | DEGRADED | Oracle MCP tools not available. Manual traceability analysis performed per Degradation Protocol. |

---

## Discriminative Sampling: 12 Claims Verified

I independently verified 12 specific claims from the evidence chain. This is not a rubber stamp of artifacts. Each claim was tested against the actual codebase.

### Sample 1: F-P10-001 Fix -- Custom Rules Wired to assertClaim
**Claim**: Custom classification rules added via `addRule()` are now read from DB by the claim pipeline.
**Evidence**: `src/api/index.ts:798-811` -- `getClassificationRules()` getter reads from `governance_classification_rules` table. `src/claims/store/claim_stores.ts:1556-1558` -- `deps.getClassificationRules()` called at classification time. Builder test at line 674 verifies custom rule `custom.* -> restricted` is applied to claim in DB. Breaker test F-P10-001 confirms independently.
**Verdict**: **PASS** -- wiring verified at code level and test level. Discriminative: test would fail if getter removed.

### Sample 2: F-P10-002/003 Fix -- Protected Predicate Guard Wired
**Claim**: Protected predicate rules are now enforced at the integration level.
**Evidence**: `src/api/index.ts:813-828` -- `getProtectedPredicateRules()` and `getRbacActive()` getters passed to `createClaimSystem()`. `src/claims/store/claim_stores.ts:1269-1274` (assert) and `1739-1744` (retract) -- guard fires with dynamic rules.
**PROBLEM**: The integration test at line 735 uses a default context with ALL permissions. The guard fires AND allows because the caller IS authorized. This test would pass both with and without the fix. **No integration test exists where an unauthorized caller is actually blocked.** Pure function tests (line 262, 279) verify rejection but not at the wired level. M-2 and M-3 mutations would likely still survive.
**Verdict**: **CONDITIONAL** -- code wiring is correct (verified by inspection), but no discriminative integration test proves it. Residual risk: if wiring regresses, no integration test catches it.

### Sample 3: F-P10-004 Fix -- Certificate Hash Integration
**Claim**: Erasure certificate hash is verified at integration level.
**Evidence**: Builder test at line 784 executes full erasure pipeline, recomputes SHA-256 from certificate fields, asserts match. Breaker test F-P10-004 does the same independently.
**Verdict**: **PASS** -- discriminative test exists and exercises the real pipeline.

### Sample 4: F-P10-005 Fix -- Consent Revocation
**Claim**: Erasure revokes all active consent records.
**Evidence**: Builder test at line 835 registers consent, creates PII claim, executes erasure, verifies `consentRecordsRevoked >= 1` AND verifies via `consent.list()` that no active consent remains. Breaker test F-P10-005 does similar verification.
**Verdict**: **PASS** -- discriminative test at integration level.

### Sample 5: F-P10-006 Fix -- Erasure Audit Entry
**Claim**: Erasure produces `governance.erasure` audit entry.
**Evidence**: Builder test at line 878 executes erasure, reads `core_audit_log` directly, verifies operation = `governance.erasure`, resource_type = `erasure_certificate`, actor_id = `erasure_engine`.
**Verdict**: **PASS** -- discriminative test at integration level.

### Sample 6: F-P10-007 Fix -- SOC 2 Chain Verification Discriminative
**Claim**: SOC 2 export chain verification test is now discriminative (not shape-only).
**Evidence**: Builder test at line 912 asserts `chainVerification.valid === true` (not just `'valid' in`). Breaker test at line 348 also verifies value, not shape.
**Verdict**: **PASS** -- assertion upgraded from shape to value.

### Sample 7: F-P10-010 -- Single-Tenant Audit Tombstoning Gap
**Claim**: Audit tombstoning is skipped in single-tenant mode (tenantId = null).
**Evidence**: `erasure_engine.ts:167` -- `if (tenantId !== null)` gates tombstoning. Breaker test at line 298 confirms `auditEntriesTombstoned = 0` in single-tenant mode. This is documented but NOT fixed.
**Verdict**: **RESIDUAL RISK** -- GDPR gap in default mode. Audit entries containing PII details survive erasure.

### Sample 8: F-P10-012 -- Over-Broad LIKE Matching
**Claim**: Erasure uses `LIKE %dataSubjectId%` which is over-broad.
**Evidence**: `erasure_engine.ts:94` -- `const subjectPattern = '%${request.dataSubjectId}%'`. A `dataSubjectId` of `%` matches ALL PII claims. A `dataSubjectId` of `bob` matches `bobby`, `bob_smith`, etc.
**Verdict**: **RESIDUAL RISK** -- data integrity risk. Not fixed.

### Sample 9: F-P10-009 -- Erasure Cascade Direction
**Claim**: Cascade direction may be inverted.
**Evidence**: `erasure_engine.ts:136-141` queries `WHERE cr.from_claim_id = ? AND cr.type = 'derived_from'`. If `derived_from` means "A is derived from B" with A=from, B=to, then this query follows the WRONG direction. Breaker test at line 278 documents the concern with `assert.ok(true)` -- a Hard Ban #8 violation (assertion that passes regardless of implementation).
**Verdict**: **RESIDUAL RISK** -- no integration test with actual derived_from relationships to verify direction. Breaker test is a placeholder.

### Sample 10: DC-P10-702 -- SOC 2 Export Excludes Tombstoned PII
**Claim**: Test exists per header comment.
**Evidence**: The DC header at line 37 claims `DC-P10-702: SOC 2 export does not include tombstoned PII (success)`. **No test body exists for DC-P10-702.** Zero assertions anywhere in the test file verify tombstoned PII is excluded from exports.
**Verdict**: **FAIL** -- phantom test reference. DC-P10-702 is UNCOVERED.

### Sample 11: Migration 034 -- Backward Compatibility
**Claim**: Migration is additive only, existing claims get `unrestricted`.
**Evidence**: `034_governance_suite.ts` -- only ALTER TABLE ADD COLUMN and CREATE TABLE IF NOT EXISTS. DEFAULT 'unrestricted' on classification column. No DROP, no column modification. DC-P10-601 test at line 347 verifies. Phase 8 test updated (commit 955140d) to accept migration 034.
**Verdict**: **PASS** -- additive-only migration, backward compatible.

### Sample 12: I-P10-41 -- Dormant RBAC Preservation
**Claim**: New Permission values don't activate dormant RBAC.
**Evidence**: `common.ts` diff adds `classify_claims`, `manage_classification_rules`, `manage_protected_predicates`, `request_erasure`, `export_compliance` to the Permission type union. This is a type-level addition only -- RBAC activation requires custom role creation or `forceActive=true`. DC-P10-404 and DC-P10-602 tests verify dormant RBAC still works.
**Verdict**: **PASS** -- type-only change, no activation trigger.

---

## Defect-Class Coverage Matrix

| DC | Description | Builder Test | Breaker Test | A21 Dual-Path | Discriminative | Verdict |
|----|-------------|-------------|-------------|---------------|----------------|---------|
| DC-P10-101 | Classification stored matches rule | Lines 367, 384 | F-P10-001 | YES (success + rejection) | YES | PASS |
| DC-P10-102 | Classification rule persists | Lines 401, 474 | -- | YES (add + list + remove) | YES | PASS |
| DC-P10-103 | Erasure certificate persists | Lines 989-1023 | F-P10-004 | YES (success + no-claims rejection) | YES | PASS |
| DC-P10-104 | Erasure tombstones ALL PII | Lines 939-973 | -- | YES (success path, implicit rejection via non-PII) | YES | PASS |
| DC-P10-201 | Erasure atomic | Lines 989-1023 | -- | SUCCESS only (no rollback test) | PARTIAL | CONDITIONAL |
| DC-P10-202 | Certificate hash deterministic | Lines 784-828 | F-P10-004 | YES (recomputation) | YES | PASS |
| DC-P10-301 | Classification + INSERT atomic | STRUCTURAL | -- | N/A | SQLite serialized | PASS |
| DC-P10-302 | Erasure transaction boundary | STRUCTURAL | -- | N/A | SQLite serialized | PASS |
| DC-P10-401 | Protected predicate blocks assert | Lines 262, 272 (pure) | F-P10-002 | YES at pure level | NO at integration | CONDITIONAL |
| DC-P10-402 | Protected predicate blocks retract | Lines 279, 289 (pure) | -- | YES at pure level | NO at integration | CONDITIONAL |
| DC-P10-403 | Dormant RBAC bypasses guard | Line 296 (pure), 331 (integration) | -- | SUCCESS only | PARTIAL | CONDITIONAL |
| DC-P10-404 | Governance perms don't break dormant | Lines 331-343 | -- | SUCCESS only | YES | PASS |
| DC-P10-501 | Erasure audit entry | Lines 878-904 | -- | SUCCESS only | YES (operation + actor verified) | PASS |
| DC-P10-502 | Rule creation audit entry | Lines 429-448 | -- | SUCCESS only | YES | PASS |
| DC-P10-503 | SOC 2 chain verification | Lines 912-932 | F-P10-007 | SUCCESS only | YES (value, not shape) | PASS |
| DC-P10-601 | Migration additive | Lines 347-363 | -- | SUCCESS only | YES | PASS |
| DC-P10-602 | New perms don't activate RBAC | Lines 498-508 | -- | SUCCESS only | YES | PASS |
| DC-P10-701 | Certificate SHA-256 | Lines 784-828 | F-P10-004 | SUCCESS only | YES (recomputed) | PASS |
| DC-P10-702 | SOC 2 excludes tombstoned PII | **NONE** | -- | **NO TEST** | **NO** | **FAIL** |
| DC-P10-801 | preference.* -> confidential | Line 139 | -- | SUCCESS | YES | PASS |
| DC-P10-802 | decision.* -> internal | Line 146 | -- | SUCCESS | YES | PASS |
| DC-P10-803 | medical.* -> restricted | Line 153 | -- | SUCCESS | YES | PASS |
| DC-P10-804 | unmatched -> unrestricted | Line 160 | -- | SUCCESS (rejection is the test) | YES | PASS |
| DC-P10-805 | SOC 2 period boundaries | Lines 563-578 | -- | SUCCESS only | PARTIAL (checks stored period, not entry filtering) | CONDITIONAL |
| DC-P10-901 | Classification < 0.1ms | Line 232 | -- | Benchmark | YES | PASS |
| DC-P10-902 | SOC 2 empty period | Lines 511-523 | -- | YES (both paths) | YES | PASS |

**Summary**: 19 PASS, 5 CONDITIONAL, 1 FAIL, 2 STRUCTURAL.

---

## Invariant Coverage Matrix

| Invariant | Tested | Discriminative | Verdict |
|-----------|--------|----------------|---------|
| I-P10-01 | DC-P10-101 (line 367) | YES | PASS |
| I-P10-02 | DC-P10-804 (line 160), custom default (line 180) | YES | PASS |
| I-P10-03 | STRUCTURAL (SQLite serialized) | N/A | PASS |
| I-P10-04 | Line 168 (most restrictive wins) | YES | PASS |
| I-P10-10 | DC-P10-401 (pure function level) | YES at pure level, NO at integration | CONDITIONAL |
| I-P10-11 | DC-P10-403 (line 296) | YES | PASS |
| I-P10-12 | Lines 303, 310 (action-specific rules) | YES | PASS |
| I-P10-20 | F-P10-013 (line 939) | YES | PASS |
| I-P10-21 | **No integration test with derived_from** | NO | FAIL |
| I-P10-22 | F-P10-005 (line 835) | YES | PASS |
| I-P10-23 | F-P10-004 (line 784) via certificate.chainVerification.valid | PARTIAL | CONDITIONAL |
| I-P10-24 | F-P10-004 (line 784) hash recomputation | YES | PASS |
| I-P10-25 | F-P10-006 (line 878) | YES | PASS |
| I-P10-30 | DC-P10-805 (line 563) | PARTIAL (period stored, not entry filtering verified) | CONDITIONAL |
| I-P10-31 | F-P10-007 (line 912) | YES | PASS |
| I-P10-32 | **DC-P10-702 has NO test** | NO | FAIL |
| I-P10-40 | DC-P10-601 (line 347) | YES | PASS |
| I-P10-41 | DC-P10-602 (line 498) | YES | PASS |

**Summary**: 12 PASS, 3 CONDITIONAL, 2 FAIL, 1 STRUCTURAL.

---

## Breaker Findings Resolution Assessment

| Finding | Severity | Fix Claimed | Fix Verified | Verdict |
|---------|----------|-------------|--------------|---------|
| F-P10-001 | CRITICAL | YES -- getClassificationRules getter wired | YES -- code + tests discriminative | **RESOLVED** |
| F-P10-002 | CRITICAL | YES -- getProtectedPredicateRules getter wired | PARTIAL -- code wired, no rejection-path integration test | **PARTIALLY RESOLVED** |
| F-P10-003 | CRITICAL | YES -- retract guard wired | PARTIAL -- same as F-P10-002 | **PARTIALLY RESOLVED** |
| F-P10-004 | HIGH | YES -- integration test added | YES -- hash recomputation test at pipeline level | **RESOLVED** |
| F-P10-005 | HIGH | YES -- integration test added | YES -- consent revocation verified end-to-end | **RESOLVED** |
| F-P10-006 | HIGH | YES -- integration test added | YES -- audit entry verified with operation/actor | **RESOLVED** |
| F-P10-007 | HIGH | YES -- discriminative assertion | YES -- `=== true` instead of `in` shape check | **RESOLVED** |
| F-P10-008 | MEDIUM | DOCUMENTED | DOCUMENTED -- case-sensitivity is inherent in design | **ACCEPTED** (design decision) |
| F-P10-009 | MEDIUM | DOCUMENTED | NOT RESOLVED -- breaker test uses assert.ok(true) (HB#8) | **UNRESOLVED** |
| F-P10-010 | MEDIUM | DOCUMENTED | NOT RESOLVED -- gap confirmed in single-tenant mode | **UNRESOLVED** |
| F-P10-011 | LOW | DOCUMENTED | NOT RESOLVED -- removeRule still succeeds for phantom IDs | **ACCEPTED** (low severity) |
| F-P10-012 | MEDIUM | DOCUMENTED | NOT RESOLVED -- LIKE %id% over-broad matching persists | **UNRESOLVED** |
| F-P10-013 | HIGH | YES -- integration tests added | YES -- PII tombstoning, certificate, atomicity tested | **RESOLVED** |

**Summary**: 7 RESOLVED, 2 PARTIALLY RESOLVED, 3 UNRESOLVED, 1 ACCEPTED (design).

---

## Hard Ban Compliance

| HB | Check | Verdict |
|----|-------|---------|
| HB#8 | No `assert.ok(true)` | **VIOLATION** -- F-P10-009 breaker test line 289 uses `assert.ok(true, 'Direction concern documented')`. This passes regardless of implementation. |
| HB#10 | Certifier not accepting artifact existence as evidence | PASS -- discriminative sampling performed |
| HB#16 | Defect-class coverage matrix present | PASS |
| HB#24 | Enforcement DCs have both success + rejection tests | PARTIAL -- DC-P10-401/402 have dual-path at pure level but not integration |
| HB#25 | Wiring verified | PASS -- getters wired and called at correct sites |
| HB#29 | Oracle Gates summary | PASS (degraded, documented) |

---

## Residual Risk Register

| # | Risk | Severity | Mitigation | Owner |
|---|------|----------|------------|-------|
| RR-01 | F-P10-002/003: Protected predicate enforcement has no integration-level rejection test. If wiring regresses, no test catches it. | HIGH | Add integration test with explicit unauthorized context (`requireRbac: true`, custom role without required permission). | Builder |
| RR-02 | F-P10-009: Erasure cascade direction unverified. `derived_from` traversal may follow sources (upward) instead of derivatives (downward). | MEDIUM | Add integration test creating A derived_from B, erase B, verify A tombstoned. | Builder |
| RR-03 | F-P10-010: Single-tenant mode (default) skips audit tombstoning during erasure. PII in audit entries survives GDPR erasure. | HIGH | Remove `if (tenantId !== null)` guard or add single-tenant tombstone path. GDPR compliance gap. | Builder |
| RR-04 | F-P10-012: Erasure subject matching uses LIKE %id%. Over-broad. A dataSubjectId of `%` erases ALL PII. A partial match erases unrelated subjects. | MEDIUM | Use anchored pattern `entity:%:${id}` or exact subject field match. | Builder |
| RR-05 | DC-P10-702: SOC 2 export tombstone safety (I-P10-32) has ZERO tests. Tombstoned PII may appear in export. | HIGH | Add test: create claim with PII, tombstone it, export, verify PII absent from exported entries. | Builder |
| RR-06 | I-P10-21: Erasure cascade (derived_from relationships) has no integration test. CONSTITUTIONAL invariant unproven. | HIGH | Create claims with derived_from relationships, execute erasure with `includeRelated: true`, verify cascade. | Builder |
| RR-07 | F-P10-009 breaker test: `assert.ok(true)` violates HB#8. Passes regardless of implementation. | LOW | Replace with meaningful assertion or remove. | Builder |

---

## Verdict

### **CONDITIONAL PASS**

Phase 10 Governance Suite demonstrates quality in 4 of 5 subsystems:

1. **Classification Engine**: PASS. Pure function is correct, wiring is verified, custom rules read from DB (F-P10-001 resolved). Discriminative tests kill mutations.

2. **Protected Predicate Guard**: CONDITIONAL. Pure function logic is correct. Wiring is structurally verified by code inspection. However, **no integration-level rejection test exists** -- the only integration test uses an authorized caller (which passes both before and after the fix). RR-01 must be resolved to upgrade to PASS.

3. **GDPR Erasure**: CONDITIONAL. The pipeline works for the happy path: PII claims tombstoned, certificate generated with valid SHA-256, consent revoked, audit entry produced. However:
   - Single-tenant mode skips audit tombstoning (RR-03, GDPR compliance gap)
   - Subject matching is over-broad (RR-04)
   - Cascade direction unverified (RR-02, RR-06)
   - DC-P10-702 (tombstoned PII in exports) is completely untested (RR-05)

4. **SOC 2 Compliance Export**: PASS. Period validation, chain verification (discriminative, not shape-only), statistics computation all tested.

5. **Migration**: PASS. Additive only. Backward compatible. Dormant RBAC preserved.

### Conditions for Merge

**Must resolve before merge (blocking):**
1. **RR-01**: Add integration-level rejection test for protected predicate enforcement (unauthorized caller blocked).
2. **RR-05**: Add test for DC-P10-702 (SOC 2 export excludes tombstoned PII). This is a CONSTITUTIONAL invariant (I-P10-32) with zero tests.

**Should resolve before merge (non-blocking but documented):**
3. **RR-03**: Fix single-tenant audit tombstoning gap (GDPR compliance concern).
4. **RR-06**: Add integration test for erasure cascade with actual derived_from relationships.

**May defer to Phase 11+ (accepted risk):**
5. RR-02, RR-04, RR-07: Cascade direction, LIKE matching, HB#8 violation in breaker test.

### Assurance Level

The claimed assurance level of 18 CONSTITUTIONAL invariants is partially supported. 12 invariants are proven, 3 are conditionally proven, and 2 are unproven (I-P10-21 cascade, I-P10-32 tombstone safety). The evidence does NOT support a CONSTITUTIONAL assurance claim for the erasure subsystem until RR-05 and RR-06 are resolved.

---

## Self-Audit

- Was every finding derived from evidence? **YES** -- file:line references, code inspection, and test execution for all findings.
- Did I accept artifact existence as evidence? **NO** -- I performed 12-sample discriminative verification against the actual codebase.
- Did I suppress risk to avoid CONDITIONAL? **NO** -- 7 residual risks documented, 2 blocking.
- What did I NOT verify? Multi-tenant behavior (tested single-tenant only). Plugin interaction with governance. Performance of governance API under load. SOC 2 export correctness of categorization logic (trusted, not sampled).
- Did I judge my own work? **NO** -- I did not build or attack any Phase 10 artifacts.

---

*SolisHQ -- We innovate, invent, then disrupt.*
