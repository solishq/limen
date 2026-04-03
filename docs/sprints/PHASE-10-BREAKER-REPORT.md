# Phase 10: Governance Suite -- Breaker Pass B Report

**Date**: 2026-04-03
**Artifact**: Phase 10 Governance Suite (Classification, Protected Predicates, GDPR Erasure, SOC 2 Export)
**Criticality**: Tier 1
**Builder tests**: 41 passing (tests/unit/phase10_governance.test.ts)
**Breaker tests**: 16 (tests/breaker/phase10_breaker.test.ts) -- 14 pass, 2 expected failures confirming defects

---

## Prompt Audit Gate

No issues found. Prompt included all 15 priority attack vectors with spec references.

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Status |
|------|------|-----------------|--------|
| OG-THREAT | oracle_threat_model | DEGRADED | Oracle MCP tools not available in this session |
| OG-FMEA | oracle_fmea | DEGRADED | Oracle MCP tools not available in this session |

Compensated with deeper manual analysis per Degradation Protocol.

---

## Mutation Testing Results

| ID | Mutation | File:Line | Expected | Actual | Verdict |
|----|----------|-----------|----------|--------|---------|
| M-1 | Remove classification UPDATE from assertClaim | claim_stores.ts:1542-1556 | DC-P10-101 fails | DC-P10-101 FAILED | **KILLED** |
| M-2 | Remove predicate guard from assertClaim | claim_stores.ts:1266-1276 | DC-P10-401 fails | ALL 41 PASS | **SURVIVED** |
| M-3 | Remove predicate guard from retractClaim | claim_stores.ts:1724-1734 | DC-P10-402 fails | ALL 41 PASS | **SURVIVED** |
| M-4 | Replace certificate hash with fake string | erasure_engine.ts:224 | DC-P10-701/202 fails | ALL 41 PASS | **SURVIVED** |
| M-5 | Remove consent revocation from erasure | erasure_engine.ts:174-186 | I-P10-22 test fails | ALL 41 PASS | **SURVIVED** |
| M-6 | Remove audit append from erasure | erasure_engine.ts:253-270 | DC-P10-501 fails | ALL 41 PASS | **SURVIVED** |
| M-7 | Replace chain verification with fake object | compliance_export.ts:124-129 | DC-P10-503 fails | ALL 41 PASS | **SURVIVED** |

**Summary**: 1 killed, 6 survived. Survival rate: 85.7%. This is a CRITICAL test coverage failure.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|-------|---------------|-----------------|---------------------|---------|
| DC-P10-101 | YES (line 367) | YES (line 384) | YES -- M-1 killed | **PASS** |
| DC-P10-102 | YES (line 401) | Partial (listRules) | N/A | **PASS** |
| DC-P10-103 | NO (no integration erasure test) | NO | N/A | **FAIL -- no test** |
| DC-P10-104 | NO (no integration erasure test) | NO | N/A | **FAIL -- no test** |
| DC-P10-201 | NO | NO | N/A | **FAIL -- no test** |
| DC-P10-202 | NO (DC-P10-701 tests SHA-256 format, not pipeline) | NO | N/A | **FAIL -- M-4 survived** |
| DC-P10-401 | YES (line 272, pure fn only) | YES (line 262, pure fn only) | NOT AT INTEGRATION LEVEL -- M-2 survived | **FAIL** |
| DC-P10-402 | YES (line 289, pure fn only) | YES (line 279, pure fn only) | NOT AT INTEGRATION LEVEL -- M-3 survived | **FAIL** |
| DC-P10-403 | YES (line 296, pure fn only) | NO | Pure fn only | **PARTIAL** |
| DC-P10-404 | YES (line 331) | NO | Integration level | **PARTIAL** |
| DC-P10-501 | NO (M-6 survived) | NO | N/A | **FAIL -- no integration test** |
| DC-P10-502 | YES (line 429) | NO | Shape check only | **PARTIAL** |
| DC-P10-503 | YES (line 540) | NO | Shape check only -- M-7 survived | **FAIL -- non-discriminative** |
| DC-P10-601 | YES (line 347) | NO | YES | **PASS** |
| DC-P10-701 | YES (line 582) | NO | Tests SHA-256 format, not pipeline | **FAIL -- M-4 survived** |
| DC-P10-702 | NO | NO | N/A | **FAIL -- no test** |
| DC-P10-801-804 | YES | YES (804) | YES | **PASS** |
| DC-P10-805 | YES (line 563) | NO | Shape check only | **PARTIAL** |
| DC-P10-901 | YES (line 232) | N/A | Benchmark | **PASS** |
| DC-P10-902 | YES (line 511) | YES (same test) | YES | **PASS** |

**7 DCs PASS, 8 DCs FAIL, 5 DCs PARTIAL.**

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-P10-001 | **Custom classification rules added via addRule() never used by assertClaim** | **CRITICAL** | Defense not wired (P-002) | `createClaimSystem()` at api/index.ts:777-795 does NOT pass `classificationRules`. assertClaim uses `deps.classificationRules ?? []` which defaults to `[]`, falling back to `DEFAULT_CLASSIFICATION_RULES`. Custom rules stored in `governance_classification_rules` table are dead data. Breaker test confirms: custom rule for `custom.*` -> `restricted` produces `unrestricted` classification. | Wire custom rules from DB into `createClaimSystem` deps, or query them at classification time. |
| F-P10-002 | **Protected predicate rules added via protectPredicate() never enforced by assertClaim** | **CRITICAL** | Defense not wired (P-002) | `createClaimSystem()` at api/index.ts:777-795 does NOT pass `protectedPredicateRules` or `rbacActive`. The guard at claim_stores.ts:1267 short-circuits: `if (deps.protectedPredicateRules && deps.protectedPredicateRules.length > 0)` is always false because deps.protectedPredicateRules is undefined. M-2 survived. Breaker test confirms: protected governance.* predicate allows unauthorized assert. | Wire protected predicate rules from DB and RBAC active state into `createClaimSystem` deps. |
| F-P10-003 | **Protected predicate rules never enforced by retractClaim** | **CRITICAL** | Defense not wired (P-002) | Same root cause as F-P10-002. claim_stores.ts:1725 short-circuits identically. M-3 survived. | Same fix as F-P10-002. |
| F-P10-004 | **Erasure certificate hash not verified at integration level** | **HIGH** | Mutation survived (P-001) | DC-P10-701 test at line 582 only verifies SHA-256 format using `createHash` directly -- never calls `computeCertificateHash` or exercises erasure pipeline. DC-P10-202 (deterministic hash) has NO integration test. M-4 survived: replacing hash with `'FAKE_HASH_NOT_SHA256'` did not fail any test. | Add integration test that executes erasure and recomputes hash from certificate fields. |
| F-P10-005 | **Consent revocation during erasure has zero Builder tests** | **HIGH** | Missing test coverage | M-5 survived: consent revocation code removed from erasure_engine.ts:174-186, all 41 tests pass. I-P10-22 (CONSTITUTIONAL) has no test. Code IS correct (verified by Breaker test) but no Builder test guards it. | Add Builder test that registers consent, executes erasure, verifies consent revoked. |
| F-P10-006 | **Erasure audit entry (DC-P10-501) has zero integration tests** | **HIGH** | Missing test coverage | M-6 survived: audit.append removed from erasure_engine.ts:253-270, all 41 tests pass. I-P10-25 (CONSTITUTIONAL) has no integration test. | Add integration test that executes erasure and verifies `governance.erasure` audit entry exists. |
| F-P10-007 | **SOC 2 chain verification test is non-discriminative** | **HIGH** | Non-discriminative test (P-001) | DC-P10-503 test at line 540 checks `'chainVerification' in result.value` and `'valid' in result.value.chainVerification` -- shape-only assertions. M-7 survived: replacing verifyChain with fake `{valid: true, entries: 0}` passed all tests. | Assert `result.value.chainVerification.valid === true` and verify entries count > 0. |
| F-P10-008 | **Case-sensitive predicate matching allows classification bypass** | **MEDIUM** | Design gap | `predicateMatchesPattern` uses `startsWith` which is case-sensitive. `'Preference.Color'.startsWith('preference.')` is false. Breaker test confirms: mixed-case predicates bypass all classification rules. Not necessarily a bug but is undocumented and may be unexpected. | Document case-sensitivity requirement in spec and add toLowerCase() normalization or explicit documentation. |
| F-P10-009 | **Erasure cascade direction potentially inverted** | **MEDIUM** | Logic concern | erasure_engine.ts:136-141 queries `WHERE cr.from_claim_id = ? AND cr.type = 'derived_from'` and tombstones `cr.to_claim_id`. If `derived_from` means "this claim is derived from that claim" (from->to direction), then the query follows the source chain (upward) instead of the derivative chain (downward). No integration test exercises cascade to verify. | Add integration test with derived_from relationships, execute erasure, verify correct claims tombstoned. |
| F-P10-010 | **Audit tombstoning skipped in single-tenant mode** | **MEDIUM** | Logic gap | erasure_engine.ts:167: `if (tenantId !== null)` gates audit tombstoning. Default single-tenant mode has `tenantId = null`. Result: PII audit entries survive erasure in single-tenant mode. Breaker test confirms: `auditEntriesTombstoned = 0`. | Remove the null guard or handle single-tenant audit tombstoning separately. |
| F-P10-011 | **removeRule silently succeeds for non-existent rules** | **LOW** | Missing validation | api/index.ts:1241-1257: `DELETE FROM governance_classification_rules WHERE id = ?` executes without checking if rule exists. Always returns `ok: true` and creates audit entry even when nothing was deleted. | Check `changes` count from DELETE. Return error if 0 rows deleted. |
| F-P10-012 | **Erasure subject matching uses over-broad LIKE %id%** | **MEDIUM** | Data integrity risk | erasure_engine.ts:94: `const subjectPattern = '%${request.dataSubjectId}%'`. A data subject ID of `"bob"` would match subjects containing `"bobby"`, `"bob_smith"`, `"user:bob:extra"`, etc. Over-broad LIKE match could tombstone unrelated claims. | Use exact match on a structured field or anchored pattern like `entity:%:${id}`. |
| F-P10-013 | **No erasure integration test exists in Builder tests** | **HIGH** | Missing test coverage | The entire erasure pipeline (DC-P10-103, DC-P10-104, DC-P10-201) has ZERO integration tests in the Builder's test file. The `governance.erasure()` method is never called in any Builder test. All erasure-related DCs are untested at the integration level. | Add comprehensive erasure integration tests covering PII claim tombstoning, certificate generation, and atomicity. |

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative enforcement tests | YES | **FOUND**: DC-P10-503 (shape-only chain verification), DC-P10-701 (tests SHA-256 format not pipeline). M-4 and M-7 survived. |
| P-002 | Defense built but not wired in | YES | **FOUND (3x)**: F-P10-001 (custom rules), F-P10-002 (predicate guard assert), F-P10-003 (predicate guard retract). All three are deps never passed to createClaimSystem. |
| P-003 | IBC overclaims | YES | None found. No IBC claims in this phase. |
| P-004 | Test rewrite drops coverage | YES | Not applicable -- new tests, no rewrite. |
| P-005 | Phantom test references | YES | None found. DC header accurately lists tests that exist. |
| P-006 | Cross-subsystem boundary gaps | YES | **FOUND**: Erasure engine <-> ClaimStore boundary untested. Erasure engine <-> ConsentRegistry boundary untested. GovernanceApi <-> ClaimSystem boundary untested (rules not wired). |
| P-007 | FM numbering collisions | YES | None found. |
| P-008 | Documentation in session only | YES | Design source referenced but not verified. |
| P-009 | Prompt Audit Gate degradation | YES | Not applicable (Breaker session). |
| P-010 | Implementation logic in harness | YES | No harness file for Phase 10. Logic in store files (correct). |

---

## Architecture-Level Findings

1. **GovernanceApi is a dead facade for rules + predicates.** `addRule()`, `removeRule()`, `protectPredicate()` store data to DB tables that are never read by the claim pipeline. The governance.listRules() and governance.listProtectedPredicates() return stored data but this data never influences claim behavior. This is a structural gap -- the governance API and the claim system are disconnected.

2. **Erasure engine is never exercised by any Builder test.** The entire GDPR erasure flow (6 invariants, 5 DCs) has zero integration tests. This is the highest-risk untested surface in Phase 10.

3. **Single-tenant mode (the default) has degraded GDPR compliance.** Audit tombstoning and potentially consent matching behave differently when `tenantId === null`.

---

## Security Findings

1. **LIKE injection in erasure subject matching.** The `dataSubjectId` is interpolated into a LIKE pattern (`%${id}%`). While SQL parameterization prevents SQL injection, the LIKE pattern itself can match unintended subjects if the ID contains `%` or `_` wildcard characters. A `dataSubjectId` of `%` would match ALL PII claims across ALL subjects.

2. **No authorization check on governance API methods.** `addRule()`, `removeRule()`, `protectPredicate()`, `erasure()`, and `exportAudit()` have no RBAC enforcement. Any caller can add classification rules, protect predicates, and execute erasures. The governance API permissions (`classify_claims`, `manage_classification_rules`, etc.) are registered but never checked.

---

## Self-Audit

- Was every finding derived from evidence? **YES** -- file:line references and mutation results for all 13 findings.
- What would I check to prove my findings wrong? For F-P10-001/002/003: check if there is a middleware layer between GovernanceApi and ClaimSystem that reads rules from DB and passes them. Verified there is not. For F-P10-009: create actual derived_from relationships and verify cascade direction.
- What did I NOT examine? Plugin system integration with governance. Import/export pipeline interaction with classification. Multi-tenant behavior (tested single-tenant only). Performance under high rule counts.
- Is my finding count reasonable? 13 findings (3 CRITICAL, 5 HIGH, 4 MEDIUM, 1 LOW). Historical average: 16.4. Given the breadth of Phase 10 (4 subsystems) and 6 survived mutations, this count is reasonable.

---

## Verdict

**CONDITIONAL PASS -- 3 CRITICAL and 5 HIGH findings must be fixed before merge.**

Critical findings F-P10-001, F-P10-002, F-P10-003 represent a structural wiring gap (P-002 pattern, 6th/7th/8th occurrence in the project). Custom classification rules and protected predicate rules are stored but never enforced. This means:
- **Classification**: All claims use DEFAULT_CLASSIFICATION_RULES regardless of custom rules.
- **Protected predicates**: The guard is structurally bypassed -- no predicate is actually protected.

HIGH findings F-P10-004 through F-P10-007 and F-P10-013 represent 5 surviving mutations on CONSTITUTIONAL invariants with zero integration tests for the entire erasure pipeline.

---

*SolisHQ -- We innovate, invent, then disrupt.*
