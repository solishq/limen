---
eap_version: "1.0"
type: ATTACK-REPORT
id: GDPR-BREAKER-2026-04-04
project: limen
commit: 09a7a95aa91341a3bf50f46f383efc3f0c3a9adc
timestamp: "2026-04-04T21:50:00Z"
producer_role: Breaker
evidence_status: VALIDATED
---

# GDPR Erasure Engine Breaker Report — 2026-04-04

## Role: Breaker (HB-26 compliant)
## Target: GDPR erasure SQL remediation (F-E2E-002b, F-E2E-008b)
## File: `src/governance/compliance/erasure_engine.ts`

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Checks | Key Findings | Status |
|------|------|-----------------|--------|--------------|--------|
| OG-THREAT | oracle_threat_model | PASS | 15/15 | STRIDE complete. CWE-20 (input validation), CWE-269 (privilege). Parameterized queries mitigate CWE-89. | COMPLETED |

---

## Attack Vector Results

### AV-1: Boundary Attacks — Child Hierarchy Erasure

**Result: FINDING (F-GDPR-001) — MEDIUM**

The erasure engine's LIKE child pattern (lines 119-131) is designed to match hierarchical child subjects like `entity:user:alice:session:123`. However, `isValidSubjectURN()` at `src/claims/store/claim_stores.ts:162` enforces `parts.length !== 3` — exactly 3 colon-separated segments.

**Consequence:** Child subjects with >3 segments can NEVER be created through the claim assertion pipeline. The LIKE child pattern (`escapedId:%` and `escapedUrn:%`) is dead code. It matches nothing in the current system.

**Evidence:**
- `claim_stores.ts:162`: `if (parts.length !== 3) return false;`
- Test: `AV-1: FINDING: isValidSubjectURN rejects subjects with >3 colon-separated segments` — PASS (confirms rejection)
- The 4 SQL LIKE parameters on lines 128-131 (`${escapedId}:%`, `${escapedUrn}:%`) serve no purpose

**Impact:** LOW — dead code is defense-in-depth (no security impact), but it adds SQL complexity and execution cost for zero benefit. If the subject URN format is ever extended to support hierarchical children, the erasure engine is pre-wired.

**Recommendation:** Document the dead-code status in a comment. If hierarchical subjects are never planned, remove the LIKE clauses. If they are planned, add integration tests when the URN format is extended.

---

### AV-2: Negative Test — aliceberg Survives

**Result: PASS**

All three negative tests pass:
- `entity:user:aliceberg` survives `entity:user:alice` erasure
- `entity:user:al` survives `entity:user:alice` erasure (prefix)
- `entity:user:alice2` survives `entity:user:alice` erasure (suffix)

**Evidence:** 3 tests, all PASS. The exact match (`=`) on lines 122 and 127 correctly prevents substring collateral.

---

### AV-3: Unicode Attacks

**Result: PASS**

- **Null bytes:** `entity:user:alice\x00berg` — either rejected by validation or correctly NOT matched by `user:alice` erasure. Test confirms no bypass.
- **Unicode normalization:** Pre-composed `caf\u00e9` and decomposed `cafe\u0301` treated as different subjects by SQLite byte comparison. Erasure of one does not affect the other.
- **Long subjects:** Subjects near the 256-char limit work correctly.

**Evidence:** 3 tests, all PASS.

---

### AV-4: SQL Injection

**Result: PASS**

Three injection vectors tested:
1. `'; DROP TABLE claim_assertions; --` — returns `ERASURE_NO_CLAIMS_FOUND`, table survives
2. `user:safe' OR '1'='1` — returns `ERASURE_NO_CLAIMS_FOUND`
3. `x' UNION SELECT id, subject FROM claim_assertions --` — returns `ERASURE_NO_CLAIMS_FOUND`

**Evidence:** 3 tests, all PASS. Parameterized queries (`?` placeholders on lines 127-131) prevent injection. The `dataSubjectId` is never interpolated into SQL strings directly.

---

### AV-5: Wildcard Leakage

**Result: PASS**

Four wildcard vectors tested:
1. Subject containing `%` (`user:100%alice`) — `%` treated as literal, bob survives
2. Subject containing `_` (`user:test_user`) — `_` treated as literal, testXuser survives
3. Subject containing `\` (`user:back\slash`) — backslash handled correctly
4. Subject containing `%%` (`user:double%%pct`) — no match-all behavior

**Evidence:** 4 tests, all PASS. `escapeLikeWildcards()` on lines 40-42 escapes `\` first, then `%`, then `_`. Correct escape order prevents double-escaping.

---

### AV-6: Empty/Null Subjects

**Result: PASS**

Four degenerate input vectors tested:
1. Empty string `""` — returns `ERASURE_NO_CLAIMS_FOUND`, no claims deleted
2. Whitespace `"   "` — returns `ERASURE_NO_CLAIMS_FOUND`, no claims deleted
3. Single colon `":"` — returns `ERASURE_NO_CLAIMS_FOUND`, no claims deleted
4. Partial URN `"entity:"` — returns `ERASURE_NO_CLAIMS_FOUND`, no claims deleted

**Evidence:** 4 tests, all PASS. Empty subjects create LIKE patterns like `:%` or `entity:entity::%` which do not match standard `entity:type:id` subjects. The exact match `=` also does not match.

---

### AV-7: Nested Subjects

**Result: PASS (F-GDPR-001 confirmation)**

- `entity:user:alice:entity:user:bob` is rejected by `isValidSubjectURN()` — confirms F-GDPR-001
- Standalone `entity:user:bob` survives `entity:user:alice` erasure — correct subject isolation

**Evidence:** 2 tests, all PASS.

---

### AV-8: Case Sensitivity

**Result: PASS (behavior documented)**

SQLite's `=` operator is case-sensitive:
- `entity:user:Alice` SURVIVES `entity:user:alice` erasure (= operator is case-sensitive)
- `entity:user:Zebra` SURVIVES `entity:user:zebra` erasure (confirmed)

**Note:** SQLite LIKE is case-insensitive for ASCII by default. The LIKE child pattern `entity:user:alice:%` would case-insensitively match `entity:User:Alice:child:1`. However, since child subjects cannot exist (F-GDPR-001), this is moot. The only active matching is the exact `=` which is case-sensitive. No behavioral defect.

**Evidence:** 2 tests, all PASS.

---

### BONUS: Audit Trail Integrity

**Result: PASS**

- Single erasure maintains valid hash chain
- Sequential erasures maintain valid hash chain
- Certificate hashes are non-empty and well-formed
- Audit tombstone boundary matching correctly isolates subjects (JSON-quoted boundaries)

**Evidence:** 3 tests, all PASS.

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Verdict |
|---|---------|----------|----------|----------|---------|
| F-GDPR-001 | LIKE child hierarchy matching is dead code — isValidSubjectURN rejects >3 segments | MEDIUM | Dead code / Design mismatch | `claim_stores.ts:162`, `erasure_engine.ts:119-131` | NOT BLOCKING — defense-in-depth with no runtime impact |

---

## Test Summary

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| New breaker tests (gdpr_erasure_breaker.test.ts) | 26 | 26 | 0 |
| Existing E2E breaker tests (e2e_breaker.test.ts) | 9 | 9 | 0 |
| **Total** | **35** | **35** | **0** |

---

## Overall Verdict: PASS

The GDPR erasure SQL remediation is **safe to ship**. All 8 mandatory attack vectors tested GREEN:

1. The exact match (`=`) correctly prevents substring collateral erasure
2. Wildcard escaping (`escapeLikeWildcards`) correctly handles `%`, `_`, and `\`
3. Parameterized queries prevent SQL injection
4. Empty/degenerate inputs do not cause catastrophic deletion
5. Case sensitivity is well-defined (= is case-sensitive)
6. Audit trail tombstoning uses JSON-quoted boundary matching correctly
7. Hash chain integrity is maintained through re-hashing

**One MEDIUM finding** (F-GDPR-001): The LIKE child hierarchy pattern is dead code because the CCP subject validation rejects subjects with >3 colon-separated segments. This is defense-in-depth, not a vulnerability. Recommend documenting the dead-code status.

---

## Self-Audit

- Every finding backed by evidence (file:line, test output)
- What would prove F-GDPR-001 wrong? If subjects with >3 segments could be inserted via a path that bypasses `isValidSubjectURN`. Verified: only `claim_stores.ts` inserts into `claim_assertions`, and all paths go through validation.
- What did I NOT examine? Multi-tenant mode audit tombstoning (tested single-tenant only since that is the more complex path). The `deps.audit.tombstone(conn, tenantId)` multi-tenant path on line 278 delegates to the AuditTrail interface — not tested here but covered by Phase 10 tests.
- Finding count: 1 MEDIUM. Reasonable given the targeted scope (single function remediation).
