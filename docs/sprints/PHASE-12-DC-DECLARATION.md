# Phase 12: Cognitive Engine — Defect Class Declaration

**Date**: 2026-04-03
**Criticality**: Tier 2 with Tier 1 inheritance
**Design Source**: PHASE-12-DESIGN-SOURCE.md

---

## 1. Data Integrity

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-101 | Consolidation merge retracts loser, not winner | CRITICAL | Assert: two similar claims → loser retracted, winner active. |
| DC-P12-102 | Consolidation creates supersedes relationship from winner to loser | HIGH | Assert: after merge → supersedes edge exists. |
| DC-P12-103 | Importance score stored in claim_importance with correct factors | HIGH | Assert: compute → DB row matches. |
| DC-P12-104 | Narrative snapshot stored with correct counts | MEDIUM | Assert: narrative → DB row counts match claim queries. |
| DC-P12-105 | Consolidation log records every merge/archive/resolve operation | HIGH | Assert: merge → log entry exists. |

## 2. State Consistency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-201 | Self-healing auto-retracts claims below threshold | CRITICAL | Assert: retract parent → derived child auto-retracted. Reject: above threshold → child survives. |
| DC-P12-202 | Self-healing prevents cycles (visited Set) | CRITICAL | Assert: circular derived_from → no infinite loop, no crash. |
| DC-P12-203 | Self-healing respects max depth | HIGH | Assert: depth > max → stops, logs DEPTH_EXCEEDED. |
| DC-P12-204 | Self-healing uses RetractionReason 'incorrect' | CRITICAL | Assert: auto-retracted claim has reason 'incorrect'. |
| DC-P12-205 | Suggestion lifecycle: pending → accepted/rejected only | HIGH | Assert: accept pending → accepted. Reject: accept already-accepted → error. |

## 3. Concurrency

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-301 | Self-healing events processed sequentially (SQLite serialized) | MEDIUM | STRUCTURAL — SQLite guarantees. |
| DC-P12-302 | Consolidation operates within single transaction | HIGH | Assert: partial failure → rollback, no partial merge. |

## 4. Authority / Governance

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-401 | Self-healing audit trail — every auto-retraction logged in consolidation_log | CRITICAL | Assert: auto-retract → log entry with operation='self_heal'. |
| DC-P12-402 | acceptSuggestion creates relationship via existing relateClaims | HIGH | Assert: accept → relationship exists. |
| DC-P12-403 | verify() is advisory only — never auto-retracts | HIGH | Assert: verify returns result, claim status unchanged. |

## 5. Causality / Observability

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-501 | Consolidation produces audit entry for each merge | HIGH | Assert: merge → audit entry. |
| DC-P12-502 | Self-healing retraction produces standard audit entry | HIGH | Assert: auto-retract → audit entry with operation='claim_retracted'. |

## 6. Migration / Evolution

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-601 | Migration 036 additive — existing claims/tables unaffected | CRITICAL | Assert: pre-existing data intact. |
| DC-P12-602 | Self-healing disabled by default (config.enabled = true default, threshold safe) | HIGH | Assert: default config → threshold 0.1. |

## 7. Credential / Secret

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-701 | verify() does not store LLM response in plaintext audit | MEDIUM | Assert: audit detail contains verdict, not full LLM response. |

## 8. Behavioral / Model Quality

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-801 | Importance scoring: high-access claim scores higher than low-access | HIGH | Assert: access_count=100 > access_count=1. |
| DC-P12-802 | Importance scoring: recent claim scores higher than old claim | HIGH | Assert: today > 30 days ago. |
| DC-P12-803 | Narrative momentum: more created than retracted = 'growing' | MEDIUM | Assert: 5 created, 1 retracted → 'growing'. |
| DC-P12-804 | Auto-connection: similar claims get suggestion, dissimilar don't | HIGH | Assert: similar → suggestion exists. Reject: dissimilar → no suggestion. |
| DC-P12-805 | Consolidation archive: stale + low confidence + low access → archived | HIGH | Assert: stale claim archived. Reject: fresh claim NOT archived. |

## 9. Availability / Resource

| DC | Description | Severity | Test Strategy |
|----|-------------|----------|---------------|
| DC-P12-901 | Consolidation without sqlite-vec → CONSOLIDATION_VECTOR_UNAVAILABLE for merge, archive still works | HIGH | Assert: no vectors → archive works, merge returns informational error. |
| DC-P12-902 | verify() without provider → VERIFY_PROVIDER_MISSING | MEDIUM | Assert: no provider → clear error. |
| DC-P12-903 | Self-healing cascade < 50ms for 100-claim chain | MEDIUM | Benchmark. |

---

## Summary: 28 DCs — 6 CRITICAL, 13 HIGH, 7 MEDIUM, 2 LOW

*SolisHQ — We innovate, invent, then disrupt.*
