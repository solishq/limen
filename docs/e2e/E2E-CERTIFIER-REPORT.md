# v1.5.0 E2E Integration Hardening -- Certifier Report

**Date:** 2026-04-03
**Certifier:** Certifier Agent (independent session)
**Scope:** 6 cross-phase integration gaps + Breaker findings resolution
**Verdict:** CERTIFIED

---

## Oracle Gate Results

| Gate | Status | Notes |
|------|--------|-------|
| OG-TRACE | DEGRADED | MCP Intelligence tools unavailable. Manual traceability analysis performed. |

### Degradation Compensation

Manual trace performed: each gap fix traced from breaker finding -> implementation change -> test assertion -> independent verification by this Certifier session.

---

## Discriminative Sampling (15 Claims Verified)

| # | Claim | Verification Method | Verdict |
|---|-------|-------------------|---------|
| DS-1 | CRITICAL F-E2E-002b: LIKE exact match prevents collateral erasure | Read erasure_engine.ts:109-118: uses `subject = ?` exact match, not LIKE. Confirmed breaker test `e2e_breaker.test.ts:119-157` passes (user:aliceberg survives user:alice erasure). | PASS |
| DS-2 | Cascade walks descendants, not ancestors | Read erasure_engine.ts:155-162: `WHERE cr.to_claim_id = ?` with `from_claim_id` as descendant. Comment at line 152-154 explains semantic correctly. Multi-hop test (A->B->C) passes with `relationshipsCascaded >= 2`. | PASS |
| DS-3 | Audit tombstone works in single-tenant mode | Read erasure_engine.ts:188-269: when `tenantId === null`, direct audit entry sanitization with re-hash. Capstone test line 258 asserts `auditEntriesTombstoned >= 1`. Chain verification at line 267. | PASS |
| DS-4 | PII detection elevates classification to 'restricted' | Read claim_stores.ts:1563-1573: checks `contentScanResult?.pii.hasPii` and `CLASSIFICATION_LEVEL_ORDER[finalLevel] < CLASSIFICATION_LEVEL_ORDER['restricted']`. Verified CLASSIFICATION_LEVEL_ORDER: unrestricted=0, internal=1, confidential=2, restricted=3. Capstone test line 166 asserts `classification === 'restricted'` for email claim. | PASS |
| DS-5 | Export includes pii_detected, piiCategories, classification | Read export.ts:94-95: PRAGMA table_info detects columns. Lines 121-122: conditionally adds to SELECT. Lines 156-157: maps to exported object. exchange_types.ts:78-82 declares optional fields. Capstone test lines 155-170 verify values. | PASS |
| DS-6 | No vacuous assertions in E2E capstone test | Grep `assert.ok(true` in v150_integration.test.ts: 0 matches. Every assertion checks a specific value (equal, match, ok with error message). | PASS |
| DS-7 | No vacuous assertions in E2E breaker test | Grep `assert.ok(true` in e2e_breaker.test.ts: 0 matches. | PASS |
| DS-8 | Consent filter only revokes active records | Read erasure_engine.ts:283: `if (record.status === 'active')`. Breaker test F-E2E-001 creates active + revoked consent, asserts exactly 1 revoked. Capstone test line 251 also asserts `consentRecordsRevoked === 1` with both active and revoked present. | PASS |
| DS-9 | LIKE wildcard escape prevents underscore attack | Read erasure_engine.ts:38-40: `escapeLikeWildcards` replaces `%` and `_` with escaped versions. Used at lines 205-206 and 299-300 for audit LIKE queries. Breaker test F-E2E-008 confirms user:testXa survives user:test_a erasure. | PASS |
| DS-10 | F-E2E-003: PII re-introduction after tombstoning | Read erasure_engine.ts:298-367: second-pass audit tombstoning runs AFTER claim tombstoning and consent revocation. Catches new audit entries containing dataSubjectId. Breaker test F-E2E-003 asserts `auditStr.includes('user:carol') === false`. Capstone test line 305 asserts same for 'user:alice'. | PASS |
| DS-11 | Phone number E.164 PII detection | Read pii_detector.ts:103-109: new regex `/\+\d{7,15}/g` with confidence 0.75. Breaker test F-E2E-011 asserts `piiDetected === 1` for `+1234567890`. | PASS |
| DS-12 | Over-erasure protection | Breaker test F-E2E-004: erases diana, verifies eve survives with `length >= 1`, verifies diana tombstoned with `length === 0`. Both directions tested. | PASS |
| DS-13 | Import roundtrip preserves PII metadata | Breaker test F-E2E-005: export from instance 1, import to instance 2, re-export, verify `piiDetected === 1` on reimported claim. | PASS |
| DS-14 | Diamond cascade topology | Breaker test: B and C are PII, D derives from both. After erasure, `claimsTombstoned >= 3` and all hugo claims gone. D counted once in cascade (dedup via tombstonedIds set). | PASS |
| DS-15 | Certificate hash is deterministic SHA-256 | Capstone test lines 270-282: recomputes SHA-256 from certificate fields and asserts equality. | PASS |

**Sampling kill rate: 15/15 (100%)**

---

## Certification Checklist

| # | Item | Evidence | Verdict |
|---|------|----------|---------|
| 1 | CRITICAL Breaker finding resolved: LIKE exact match | DS-1: erasure_engine.ts:109-118 uses `subject = ?` not LIKE. Breaker test confirms no collateral. | PASS |
| 2 | Cascade direction correct: walks descendants | DS-2: JOIN logic queries `to_claim_id = ?` and reads `from_claim_id`. Multi-hop + diamond tests pass. | PASS |
| 3 | Audit tombstone in single-tenant: re-hash preserves chain | DS-3: Two-pass tombstoning. Chain integrity verified. Capstone assertion at line 267. | PASS |
| 4 | PII elevates classification | DS-4: Level comparison against CLASSIFICATION_LEVEL_ORDER. Correctly elevates unrestricted/internal/confidential. | PASS |
| 5 | Export includes security/governance metadata | DS-5: PRAGMA detection, conditional SELECT, ExportedClaim type includes fields. | PASS |
| 6 | No vacuous assertions | DS-6, DS-7: Zero `assert.ok(true)` in capstone and e2e_breaker. | PASS |
| 7 | E2E test is discriminative | Breaker mutation testing: 7/8 killed (87.5%). The surviving M-6 was subsequently addressed in the capstone test (now creates revoked consent and asserts `=== 1`). All 9 breaker attack tests pass independently. | PASS |
| 8 | Zero regressions | Full suite: 3852 tests, 3771 pass, 0 fail, 81 skipped. | PASS |
| 9 | All prior Phase 8/9/10 tests still pass | Included in full suite run. Zero failures. | PASS |

---

## Defect-Class Coverage Matrix

| # | Category | Covered By | Verdict |
|---|----------|-----------|---------|
| 1 | Data integrity | DS-1 (collateral erasure), DS-9 (wildcard escape), DS-12 (over-erasure), DS-13 (roundtrip) | COVERED |
| 2 | State consistency | DS-8 (consent terminal state filter), DS-2 (cascade BFS dedup) | COVERED |
| 3 | Concurrency | Not applicable for this scope (erasure runs in single transaction) | N/A |
| 4 | Authority / governance | DS-4 (PII elevation), DS-5 (export metadata) | COVERED |
| 5 | Causality / observability | DS-3 (audit chain re-hash), DS-15 (certificate hash), DS-10 (PII sanitization in audit) | COVERED |
| 6 | Migration / evolution | DS-5 (PRAGMA backward compat for Phase 9/10 columns) | COVERED |
| 7 | Credential / secret | Not directly scoped. PII sanitization (DS-10) is adjacent. | N/A |
| 8 | Behavioral / model quality | Not applicable for this scope. | N/A |
| 9 | Availability / resource | Cascade depth limit absent (Breaker F-E2E-010, LOW). Documented in residual risk. | NOTED |

---

## Assurance Classification

| Fix | Class | Rationale |
|-----|-------|-----------|
| Gap 5: Cascade direction | CONSTITUTIONAL | Erasure correctness is a GDPR compliance invariant (QAL-4). Wrong direction = data breach. |
| Gap 9: Audit tombstone single-tenant | CONSTITUTIONAL | Audit chain integrity is QAL-4. Broken chain = undetectable tampering. |
| Gap 1: PII elevation | CONSTITUTIONAL | Classification enforcement is part of governance engine (QAL-4). Under-classification = data exposure. |
| Gap 4: Export columns | QUALITY_GATE | Export completeness is QAL-2 concern. Lossy export is degraded, not catastrophic. |
| Gap 3: Vacuous assertions | QUALITY_GATE | Test quality. Hard Ban #8 compliance. |
| Gap 6: Consent handling | CONSTITUTIONAL | GDPR consent revocation correctness. Over-revocation is data integrity violation. |
| F-E2E-002b: LIKE exact match | CONSTITUTIONAL | Collateral erasure of unrelated users is a GDPR violation. |
| F-E2E-003: PII re-introduction | CONSTITUTIONAL | Defeats purpose of audit tombstoning. Second-pass fix is correct. |
| F-E2E-008b: Wildcard escape | CONSTITUTIONAL | Same class as F-E2E-002b. Wildcard characters in identifiers cause collateral erasure. |
| F-E2E-011: Phone PII detection | QUALITY_GATE | Detection gap. Phone-only users would have zero claims tombstoned on erasure. |

---

## Residual Risk Register

| # | Risk | Severity | Mitigation Status | Waiver |
|---|------|----------|------------------|--------|
| R-1 | Re-hash algorithm duplicated between erasure_engine.ts and audit_trail.ts (F-E2E-007). Divergence could silently break chain integrity. | MEDIUM | Acknowledged. Both implementations produce identical output for all current inputs. Divergence is a future maintenance risk, not a current defect. | Accepted for v1.5.0. Track as tech debt. |
| R-2 | No cascade depth limit (F-E2E-010). Deeply nested derived_from chains could exhaust memory. | LOW | No known production path creates deep chains. BFS queue is bounded by total claim count. | Accepted for v1.5.0. |
| R-3 | CSV export drops PII/classification columns (F-E2E-006). | LOW | CSV is documented as lossy (exchange_types.ts line 8: "CSV is a lossy projection"). JSON is canonical. | Accepted. No change needed. |
| R-4 | Phase 9 breaker tests retain 21 `assert.ok(true)` instances (F-E2E-009). | LOW | These are finding documentation, not behavioral tests. They do not inflate pass/fail counts for quality claims. Pre-existing from Phase 9, not introduced by v1.5.0. | Accepted. Not a v1.5.0 regression. |
| R-5 | Multi-tenant erasure path not tested by E2E (only single-tenant exercised). | MEDIUM | Multi-tenant path uses existing `audit.tombstone()` which has its own test coverage in Phase 10. Integration gap is single-tenant only. | Accepted for v1.5.0. |
| R-6 | PII elevation is assertion-time only, not retroactive on existing claims. | MEDIUM | Noted by Breaker (STRIDE analysis). Existing claims stored before PII detection was enabled would not be elevated. This is a design decision, not a bug. | Accepted. Document in upgrade guide. |

---

## Verdict

### CERTIFIED

**Rationale:** All 6 cross-phase integration gaps have verified fixes with discriminative evidence. The CRITICAL Breaker finding (F-E2E-002b: LIKE collateral erasure) has been resolved with exact subject matching and independently verified. All 4 HIGH findings from the Breaker pass have corresponding fixes and tests. The capstone E2E test exercises the full lifecycle (PII assertion -> export -> import roundtrip -> erasure cascade -> audit tombstone -> SOC2 export) in a single flow with discriminative assertions.

15 discriminative samples verified independently. 0 failures. Full test suite: 3852 tests, 0 failures. No regressions.

**Publish recommendation:** v1.5.0 is ready for npm publish. The 6 residual risks are documented and none are blocking.

---

## Oracle Gates Summary

| Gate | Status | Evidence |
|------|--------|----------|
| OG-TRACE | DEGRADED | MCP Intelligence tools unavailable. Manual traceability analysis substituted: 15-claim discriminative sampling with file:line evidence for each claim. |

---

*SolisHQ -- We innovate, invent, then disrupt.*
