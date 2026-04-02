# Phase 9: Security Hardening — Defect Class Declaration

**Date**: 2026-04-02
**Criticality**: Tier 1
**Design Source**: PHASE-9-DESIGN-SOURCE.md
**Governing documents**: CLAUDE.md (9 mandatory categories), LIMEN_SECURITY_ENGINEERING.md

---

## 1. Data Integrity

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-101 | PII flag set on claim when PII detected in content | HIGH | Assert: claim with email → pii_detected = 1. Reject: claim without PII → pii_detected = 0. |
| DC-P9-102 | PII categories stored accurately match detected types | MEDIUM | Assert: email + phone claim → categories = ["email","phone"]. Reject: non-PII claim → categories = null. |
| DC-P9-103 | Consent record persists with all required fields | HIGH | Assert: register consent → all fields present. Reject: missing dataSubjectId → error. |
| DC-P9-104 | Content scan result stored as valid JSON | MEDIUM | Assert: scan result parseable. Reject: corrupted JSON → never written (computed before INSERT). |

## 2. State Consistency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-201 | Consent transitions: ACTIVE→REVOKED only via revoke() | HIGH | Assert: revoke active → status = 'revoked'. Reject: revoke already-revoked → CONSENT_ALREADY_REVOKED. |
| DC-P9-202 | Consent transitions: ACTIVE→EXPIRED computed on read | MEDIUM | Assert: expired consent returns status = 'expired'. Reject: expired consent cannot be revoked (already terminal). |
| DC-P9-203 | No consent reactivation — revoked/expired consent stays terminal | CRITICAL | Assert: no API path transitions from revoked/expired back to active. |

## 3. Concurrency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-301 | PII scan + claim INSERT in same transaction | HIGH | Assert: PII flag and claim data written atomically. Reject: partial write (scan succeeds, INSERT fails) → both rolled back. |
| DC-P9-302 | Poisoning defense window query is consistent under concurrent writes | MEDIUM | SQLite serialized writes guarantee this. Document as STRUCTURAL. |

## 4. Authority / Governance

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-401 | SecurityPolicy.pii.action = 'reject' blocks claim with PII | CRITICAL | Assert: PII claim with reject policy → PII_DETECTED_REJECT error, claim NOT stored. Reject: non-PII claim with reject policy → claim stored normally. |
| DC-P9-402 | SecurityPolicy.injection.action = 'reject' blocks prompt injection | CRITICAL | Assert: injection claim with reject policy → INJECTION_DETECTED_REJECT, claim NOT stored. Reject: clean claim → stored. |
| DC-P9-403 | Poisoning burst limit enforced per agent | HIGH | Assert: agent at burst limit → POISONING_BURST_LIMIT, claim NOT stored. Reject: agent under limit → claim stored. |
| DC-P9-404 | Poisoning diversity check enforced | MEDIUM | Assert: agent with < diversityMin subjects → POISONING_LOW_DIVERSITY. Reject: agent with diverse subjects → allowed. |

## 5. Causality / Observability

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-501 | Consent register produces audit entry | HIGH | Assert: register consent → audit entry with operation = 'consent.register'. |
| DC-P9-502 | Consent revoke produces audit entry | HIGH | Assert: revoke consent → audit entry with operation = 'consent.revoke'. |
| DC-P9-503 | PII detection logged when PII found (action = 'tag' or 'warn') | MEDIUM | Assert: PII found → log entry with categories. |

## 6. Migration / Evolution

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-601 | Migration 033 is additive — no existing data modified | CRITICAL | Assert: all existing claims retain original values after migration. pii_detected defaults to 0. |
| DC-P9-602 | Pre-Phase-9 claims have content_scan_result = NULL | HIGH | Assert: existing claims not retroactively scanned. NULL means "not scanned." |

## 7. Credential / Secret

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-701 | PII detection patterns do not leak matched PII into logs | HIGH | Assert: log entries contain category names, NOT the matched PII text. |
| DC-P9-702 | content_scan_result does NOT store matched PII text | HIGH | Assert: ContentScanResult.pii.matches contains offset+length, not the matched text itself. |

## 8. Behavioral / Model Quality

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-801 | PII detector catches standard email patterns | HIGH | Assert: "user@example.com" → email detected. |
| DC-P9-802 | PII detector catches standard phone patterns | HIGH | Assert: "+1-555-123-4567" → phone detected. |
| DC-P9-803 | PII detector catches SSN patterns | HIGH | Assert: "123-45-6789" → ssn detected. |
| DC-P9-804 | PII detector catches credit card patterns (Luhn) | HIGH | Assert: valid Luhn number → credit_card detected. Reject: invalid Luhn → not detected. |
| DC-P9-805 | Prompt injection patterns detected | HIGH | Assert: "ignore previous instructions" → injection detected. Reject: normal text → not detected. |
| DC-P9-806 | PII detector does NOT false-positive on normal text | MEDIUM | Assert: "The meeting is at 3pm" → no PII. |

## 9. Availability / Resource

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P9-901 | PII scan completes in < 1ms for claims under 500 chars | MEDIUM | Benchmark: 1000 scans averaged. |
| DC-P9-902 | Poisoning defense query completes in < 5ms | MEDIUM | Benchmark: query against 10K claims. |
| DC-P9-903 | Security modules disabled via policy do not add overhead | MEDIUM | Assert: disabled PII scan → no regex executed. |

---

## DC Count Summary

| Category | Count | CRITICAL | HIGH | MEDIUM |
|----------|-------|----------|------|--------|
| Data Integrity | 4 | 0 | 2 | 2 |
| State Consistency | 3 | 1 | 1 | 1 |
| Concurrency | 2 | 0 | 1 | 1 |
| Authority / Governance | 4 | 2 | 1 | 1 |
| Causality / Observability | 3 | 0 | 2 | 1 |
| Migration / Evolution | 2 | 1 | 1 | 0 |
| Credential / Secret | 2 | 0 | 2 | 0 |
| Behavioral / Model Quality | 6 | 0 | 4 | 2 |
| Availability / Resource | 3 | 0 | 0 | 3 |
| **TOTAL** | **29** | **4** | **14** | **11** |

---

*SolisHQ — We innovate, invent, then disrupt.*
