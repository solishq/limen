# v1.5.0 E2E Integration Hardening -- Breaker Pass B Report

**Date:** 2026-04-03
**Target:** 6 cross-phase integration fixes + E2E capstone test
**Artifacts:** erasure_engine.ts, claim_stores.ts, export.ts, exchange_types.ts, v150_integration.test.ts, phase9_breaker.test.ts, phase10_breaker.test.ts

---

## Prompt Audit Gate

No issues with the Breaker prompt. Attack vectors are well-specified.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Status |
|------|------|-----------------|--------|
| OG-THREAT | oracle_threat_model | DEGRADED | MCP tool unavailable -- manual analysis substituted |
| OG-FMEA | oracle_fmea | DEGRADED | MCP tool unavailable -- manual analysis substituted |

### Degradation Compensation

Manual STRIDE analysis performed:
- **Spoofing:** dataSubjectId not validated against any identity system -- attacker could erase another user's data
- **Tampering:** Re-hash algorithm in erasure_engine.ts duplicates audit_trail.ts logic -- divergence risk
- **Repudiation:** Erasure audit entry (step 9) re-introduces the dataSubjectId after tombstoning
- **Information Disclosure:** LIKE %id% pattern over-matches audit entries
- **Denial of Service:** No limit on cascade depth -- deeply nested derived_from chains could exhaust memory
- **Elevation:** PII elevation checked at assertion time but no retroactive enforcement on existing claims

---

## Mutation Testing Results

| # | Mutation | File:Line | Expected Fail | Actual | Verdict |
|---|---------|-----------|---------------|--------|---------|
| M-1 | Change cascade JOIN to wrong alias | erasure_engine.ts:141 | E2E:230 | KILLED | PASS |
| M-2 | Disable PII classification elevation | claim_stores.ts:1567-1573 | E2E:152 | KILLED | PASS |
| M-3 | Remove single-tenant audit tombstone entirely | erasure_engine.ts:178-246 | E2E:242 | KILLED | PASS |
| M-4 | Remove re-hash, keep tombstone | erasure_engine.ts:197-242 | E2E:218 (chain fail) | KILLED | PASS |
| M-5 | Fully invert cascade direction (from<->to) | erasure_engine.ts:140-142 | E2E:230 | KILLED | PASS |
| **M-6** | **Remove consent status filter (revoke ALL including expired)** | **erasure_engine.ts:256** | **E2E:236** | **SURVIVED** | **FAIL** |
| M-7 | Remove PII/classification SELECT columns from export | export.ts:121-122 | E2E:141 | KILLED | PASS |
| M-8 | Return null for all PII values in export mapping | export.ts:156 | E2E:141 | KILLED | PASS |

**Mutation kill rate: 7/8 (87.5%)**

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-E2E-001 | Consent status filter mutation survived | HIGH | Non-discriminative test | M-6 survived: removing `record.status === 'active'` filter has no effect because test only creates active consent records | E2E must create expired AND revoked consent records before erasure, then verify only the active one is revoked and count matches exactly |
| F-E2E-002 | Audit tombstone LIKE pattern over-broad: false positives | HIGH | Data integrity | erasure_engine.ts:183 `WHERE detail LIKE '%user:alice%'` matches any audit entry mentioning "user:alice" regardless of context -- would tombstone unrelated entries that happen to contain the substring | Add test with second data subject "user:aliceberg" and verify their entries survive erasure of "user:alice" |
| F-E2E-003 | Erasure audit entry re-introduces PII after tombstoning | HIGH | Data integrity / GDPR | erasure_engine.ts:340 `dataSubjectId: request.dataSubjectId` -- the audit entry appended in step 9 contains the raw data subject ID, defeating the purpose of audit tombstoning. E2E checks for email but NOT for dataSubjectId in SOC2 export | E2E step 10 should assert `auditStr.includes('user:alice') === false` for the tombstoned entries. The audit entry for the erasure operation itself needs design review: should it reference the data subject or should it only reference the certificate ID? |
| F-E2E-004 | E2E does not verify non-erasure (over-erasure protection) | MEDIUM | Non-discriminative test | E2E creates claims for only one data subject. Uses `>= 1` assertions (lines 224, 230, 236, 242). Never verifies that unrelated claims/audit survive | Add a second unrelated data subject's claims and verify they survive the first subject's erasure |
| F-E2E-005 | Import roundtrip does not verify PII metadata preservation | MEDIUM | Roundtrip fidelity | E2E step 8 (line 198-201) only checks `recalled.value.length >= 2`, never verifies imported claims have correct piiDetected or classification | Export JSON, import to second instance, export from second instance, compare PII fields |
| F-E2E-006 | CSV export silently drops PII/classification columns | MEDIUM | Export fidelity | CSV_COLUMNS (exchange_types.ts:153-157) lacks piiDetected, piiCategories, classification. Not tested by E2E | Either add columns to CSV_COLUMNS or add a test verifying CSV is documented as PII-lossy |
| F-E2E-007 | Re-hash algorithm duplicated between erasure_engine.ts and audit_trail.ts | MEDIUM | Code duplication / divergence risk | erasure_engine.ts:225-235 manually re-implements computeEntryHash (audit_trail.ts:47-61). The erasure version has a different condition for empty objects (`entry.detail !== '{}'` vs always using sorted keys). A future change to one but not the other will break chain integrity silently | Extract shared re-hash function or have erasure engine call audit trail's computeEntryHash |
| F-E2E-008 | LIKE wildcard characters in dataSubjectId not escaped | MEDIUM | Data integrity | erasure_engine.ts:94 `%${request.dataSubjectId}%` -- if dataSubjectId contains `%` or `_`, the LIKE matches too broadly. Same issue at line 181. No input validation on dataSubjectId format | Escape `%` and `_` in dataSubjectId before embedding in LIKE pattern, or validate dataSubjectId format at the API boundary |
| F-E2E-009 | Phase 9 breaker tests retain 15+ `assert.ok(true, ...)` instances | LOW | Hard Ban #8 adjacency | phase9_breaker.test.ts has 15+ `assert.ok(true, '...')` statements. While these are documenting findings (not testing behavior), they inflate test count without testing anything | Convert to documented findings in the report; remove from test count or convert to proper assertions |
| F-E2E-010 | No cascade depth limit | LOW | Resource exhaustion | erasure_engine.ts:133-165 BFS with no depth/count limit. A deeply nested derived_from chain (1000+ levels) could exhaust memory | Add configurable max cascade depth with error on overflow |
| **F-E2E-011** | **Phone number +1234567890 NOT detected as PII** | **HIGH** | **PII detection gap / GDPR** | **`contact.phone` with value `+1234567890` has `pii_detected=0`. A GDPR erasure request for a user whose only stored PII is a phone number would tombstone ZERO claims. Confirmed by export showing piiDetected=0.** | **Review phone number regex in PII scanner. The international format `+XXXXXXXXXX` should be detected.** |
| **F-E2E-002b** | **LIKE over-broad: CONFIRMED by test** | **CRITICAL** | **Data integrity / GDPR** | **Breaker test proves: erasing `user:alice` also tombstones `user:aliceberg` claims. `LIKE '%user:alice%'` matches any subject containing the substring. This is collateral GDPR erasure of unrelated data.** | **Replace LIKE with exact match on subject URN prefix, or use `= ?` instead of `LIKE ?` for subject matching. The current approach violates data integrity.** |
| **F-E2E-008b** | **LIKE wildcard `_`: CONFIRMED by test** | **HIGH** | **Data integrity / GDPR** | **Breaker test proves: `_` in dataSubjectId (`user:test_a`) matches single character wildcard in LIKE, causing `user:testXa` claims to be erased.** | **Escape `%` and `_` in dataSubjectId before embedding in LIKE pattern (same fix as F-E2E-008).** |

---

## Architecture-Level Findings

### Re-hash Algorithm Duplication (F-E2E-007)

The erasure engine at line 224-235 manually constructs the hash input array:
```typescript
const data = [prevHash, String(entry.seq_no), entry.timestamp, entry.actor_type, entry.actor_id,
  entry.operation, entry.resource_type, entry.resource_id,
  entry.detail ? JSON.stringify(JSON.parse(entry.detail), entry.detail !== '{}' ? Object.keys(JSON.parse(entry.detail)).sort() : undefined) : '',
].join('|');
```

The canonical `computeEntryHash` in audit_trail.ts:47-61 uses:
```typescript
input.detail ? JSON.stringify(input.detail, Object.keys(input.detail).sort()) : ''
```

The difference: erasure engine checks `entry.detail !== '{}'` to decide whether to use sorted keys. The canonical function always uses sorted keys. For `{}`, both produce `'{}'` so they match today, but the branching logic is a divergence vector.

### Audit Entry PII Re-introduction (F-E2E-003)

erasure_engine.ts:331-348 appends an audit entry containing:
```typescript
detail: {
  dataSubjectId: request.dataSubjectId,  // <-- PII re-introduced
  reason: request.reason,
  ...
}
```

This entry is appended AFTER audit tombstoning (step 4) and is never tombstoned itself. If the purpose of audit tombstoning is GDPR compliance, the system tombstones historical references to the data subject but then creates a new permanent reference in the erasure audit entry.

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative tests | YES | **FOUND**: M-6 consent filter survival. E2E uses `>= 1` for all counts (non-discriminative for over-action). |
| P-002 | Defense built but not wired | YES | No new instances found. Governance API wiring confirmed at api/index.ts:797-828. |
| P-003 | IBC overclaims | YES | Not applicable -- no IBC claims in these artifacts. |
| P-004 | Test rewrite drops coverage | YES | Not applicable -- E2E is new, not a rewrite. |
| P-005 | Phantom test references | YES | No phantom references found. |
| P-006 | Cross-subsystem boundary gaps | YES | **FOUND**: erasure_engine -> audit_trail boundary tested only for chain validity, not for hash algorithm consistency. |
| P-007 | FM numbering collisions | YES | Not applicable for this scope. |
| P-008 | Documentation in session only | YES | E2E-BREAKER-REPORT.md being produced now. |
| P-009 | PAG degradation | YES | No issues. |
| P-010 | Implementation logic in harness | YES | No harness involved -- direct implementation test. |

---

## Self-Audit

- **Was every finding derived from evidence?** Yes. M-6 survival confirmed by test execution. F-E2E-002/003/004/005/006/007/008 confirmed by code reading at specific file:line references.
- **What would I check to prove my findings wrong?**
  - F-E2E-001: If consent.revoke() on an expired record returns an error (not ok), then the filter is redundant. Need to check ConsentRegistry.revoke behavior on expired records.
  - F-E2E-003: If the SOC2 export strips dataSubjectId from erasure audit entries, the PII re-introduction is mitigated. Need to check SOC2 export filtering.
  - F-E2E-007: If the hash algorithms produce identical output for ALL possible inputs (not just test inputs), the duplication is safe. Formal proof needed.
- **What did I NOT examine?**
  - The actual ConsentRegistry.revoke() implementation for expired record behavior
  - Multi-tenant erasure path (test only exercises single-tenant)
  - Import pipeline PII scanning fidelity on roundtrip
  - Performance under large dataset (1000+ claims for one data subject)
- **Is my finding count reasonable?** 10 findings (0 CRITICAL, 3 HIGH, 5 MEDIUM, 2 LOW) for 6 integration fixes is proportional. One surviving mutation is significant for a capstone test.

---

*SolisHQ -- We innovate, invent, then disrupt.*
