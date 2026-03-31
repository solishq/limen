# PHASE 5 TRUTH MODEL: Reasoning

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: docs/sprints/PHASE-5-DESIGN-SOURCE.md

---

## Invariants

| ID | Statement | Class | DCs |
|----|-----------|-------|-----|
| I-P5-01 | `Claim.reasoning` is NULL or the exact string provided at creation. Never modified after INSERT. Enforced by SQLite trigger (CCP-I1 extended). | CONSTITUTIONAL | DC-P5-101, DC-P5-102 |
| I-P5-02 | `remember(s, p, v, { reasoning: R })` stores R in the claim's reasoning column. `recall()` returns it in `BeliefView.reasoning`. Round-trip fidelity. | CONSTITUTIONAL | DC-P5-101 |
| I-P5-03 | `cognitive.health().totalClaims` equals `SELECT COUNT(*) FROM claim_assertions WHERE status = 'active' AND tenant_id IS ?`. | CONSTITUTIONAL | DC-P5-104 |
| I-P5-04 | `cognitive.health().freshness.fresh + freshness.aging + freshness.stale === totalClaims`. Distribution is exhaustive and disjoint. | CONSTITUTIONAL | DC-P5-105 |
| I-P5-05 | `cognitive.health().conflicts.unresolved` counts only `contradicts` relationships where BOTH from_claim and to_claim have `status = 'active'`. | CONSTITUTIONAL | DC-P5-107 |
| I-P5-06 | `cognitive.health()` on an empty knowledge base returns all-zero values: totalClaims=0, fresh=0, aging=0, stale=0, percentFresh=0, unresolved=0, mean=0, median=0, below30=0, above90=0, gaps=[], staleDomains=[]. No NaN, no undefined. | CONSTITUTIONAL | DC-P5-106 |
| I-P5-07 | `reasoning` exceeding MAX_REASONING_LENGTH (1000) in `RememberOptions` is rejected with `CONV_REASONING_TOO_LONG`. Claim is NOT created. | CONSTITUTIONAL | DC-P5-103 |
| I-P5-08 | `cognitive.health().gaps` only includes domains where at least one active claim exists but none has `valid_at` within the gap threshold. | QUALITY_GATE | DC-P5-802 |
| I-P5-09 | `cognitive.health().staleDomains` only includes predicates where the newest claim's `last_accessed_at` exceeds the stale threshold. | QUALITY_GATE | -- |
| I-P5-10 | Phase 5 migration is additive only. No column drops, no table drops, no existing data modification. | CONSTITUTIONAL | DC-P5-108 |
| I-P5-11 | All existing tests pass after Phase 5 changes. Zero regressions. | CONSTITUTIONAL | DC-P5-110 |

---

## Assumptions

| ID | Assumption | Owner | Review Trigger | Invalidation Trigger | Response When Broken |
|----|-----------|-------|----------------|---------------------|---------------------|
| A-P5-01 | `reasoning` is write-once (CCP-I1 content). | Builder | Phase 12 (Cognitive Engine) may want mutable reasoning. | Spec change requesting reasoning updates. | Re-derive trigger, add UPDATE path with audit, loopback to I-P5-01. |
| A-P5-02 | SQLite aggregation over 100K rows completes in <200ms. | Builder | Production deployment with >100K claims. | Measured latency >200ms at scale. | Add materialized view or incremental aggregation cache. |
| A-P5-03 | "Domain" is the first segment of a predicate (before the dot). | Builder | New predicate format introduced. | Predicates with >2 segments or no dot. | Re-derive domain extraction logic. |

---

## Formal Assertions

```
FORALL claim c:
  c.reasoning IS NULL OR c.reasoning === valueAtCreation(c.id, 'reasoning')

FORALL health report h ON tenant t:
  h.totalClaims === COUNT(claims WHERE status='active' AND tenant_id IS t)
  h.freshness.fresh + h.freshness.aging + h.freshness.stale === h.totalClaims
  h.conflicts.unresolved === COUNT(relationships WHERE type='contradicts'
    AND from_claim.status='active' AND to_claim.status='active' AND tenant_id IS t)

FORALL remember(s, p, v, {reasoning: R}):
  LET result = recall(s, p)
  result.beliefs[0].reasoning === R

FORALL remember(s, p, v, {reasoning: R}) WHERE len(R) > 1000:
  result.ok === false
  result.error.code === 'CONV_REASONING_TOO_LONG'
```

---

*SolisHQ -- We innovate, invent, then disrupt.*
