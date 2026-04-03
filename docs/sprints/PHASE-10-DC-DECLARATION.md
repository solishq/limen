# Phase 10: Governance Suite — Defect Class Declaration

**Date**: 2026-04-03
**Criticality**: Tier 1
**Design Source**: PHASE-10-DESIGN-SOURCE.md

---

## 1. Data Integrity

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-101 | Classification level stored on claim matches rule engine result | HIGH | Assert: `preference.*` claim → classification = 'confidential'. Reject: unmatched predicate → default level. |
| DC-P10-102 | Classification rule persists with all required fields | MEDIUM | Assert: addRule → stored in DB. Reject: missing predicate_pattern → error. |
| DC-P10-103 | Erasure certificate persists in governance_erasure_certificates | CRITICAL | Assert: erasure → certificate in DB with correct counts. |
| DC-P10-104 | Erasure tombstones ALL PII claims for data subject | CRITICAL | Assert: 3 PII claims → all 3 tombstoned. Reject: non-PII claims untouched. |

## 2. State Consistency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-201 | Erasure is atomic — either all claims tombstoned or none | HIGH | Assert: full erasure completes. Reject: partial failure rolls back. |
| DC-P10-202 | Erasure certificate hash is deterministic and verifiable | HIGH | Assert: same inputs → same hash. Reject: tampered certificate → hash mismatch. |

## 3. Concurrency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-301 | Classification + claim INSERT in same transaction | HIGH | Assert: classification stored atomically with claim. |
| DC-P10-302 | Erasure within single transaction boundary | MEDIUM | SQLite serialized writes. Document as STRUCTURAL. |

## 4. Authority / Governance

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-401 | Protected predicate blocks unauthorized assertClaim | CRITICAL | Assert: agent without permission → PROTECTED_PREDICATE_UNAUTHORIZED, claim NOT stored. Reject: agent with permission → claim stored. |
| DC-P10-402 | Protected predicate blocks unauthorized retractClaim | CRITICAL | Assert: agent without permission → error on forget(). Reject: agent with permission → retraction succeeds. |
| DC-P10-403 | Protected predicates dormant when RBAC dormant | HIGH | Assert: dormant RBAC → all predicates writable by anyone. |
| DC-P10-404 | Governance permissions don't break dormant RBAC | CRITICAL | Assert: createLimen without RBAC → all operations succeed including classified claims. |

## 5. Causality / Observability

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-501 | Erasure produces audit entry | HIGH | Assert: erasure → audit with operation = 'governance.erasure'. |
| DC-P10-502 | Classification rule creation produces audit entry | MEDIUM | Assert: addRule → audit with operation = 'governance.rule.add'. |
| DC-P10-503 | SOC 2 export includes chain verification result | HIGH | Assert: export contains chainVerification.valid field. |

## 6. Migration / Evolution

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-601 | Migration 034 is additive — existing claims get 'unrestricted' default | CRITICAL | Assert: pre-existing claims retain data, classification = 'unrestricted'. |
| DC-P10-602 | New Permission values don't affect dormant RBAC | HIGH | Assert: existing apps upgrading don't break. |

## 7. Credential / Secret

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-701 | Erasure certificate hash uses SHA-256 | HIGH | Assert: certificate_hash is valid SHA-256 hex. |
| DC-P10-702 | SOC 2 export does not include tombstoned PII | HIGH | Assert: export after erasure has sanitized entries. |

## 8. Behavioral / Model Quality

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-801 | Classification: `preference.*` → confidential | HIGH | Assert: matched. |
| DC-P10-802 | Classification: `decision.*` → internal | HIGH | Assert: matched. |
| DC-P10-803 | Classification: `medical.*` → restricted | HIGH | Assert: matched. |
| DC-P10-804 | Classification: unmatched predicate → default level | MEDIUM | Assert: `random.thing` → unrestricted. |
| DC-P10-805 | SOC 2 export has correct period boundaries | MEDIUM | Assert: entries outside period excluded. |

## 9. Availability / Resource

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P10-901 | Classification engine < 0.1ms per claim | MEDIUM | Benchmark. |
| DC-P10-902 | SOC 2 export handles empty audit trail | MEDIUM | Assert: empty period → EXPORT_NO_ENTRIES. |

---

## Summary: 27 DCs — 6 CRITICAL, 11 HIGH, 10 MEDIUM

*SolisHQ — We innovate, invent, then disrupt.*
