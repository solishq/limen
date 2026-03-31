# PHASE 4: Quality & Safety — Truth Model

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: `docs/sprints/PHASE-4-DESIGN-SOURCE.md` (APPROVED)
**Version Pin**: CLAUDE.md v2.3+A24, PHASE-4-DESIGN-SOURCE.md (2026-03-30)

---

## Invariants

### Cascade Multipliers (CONSTITUTIONAL)

**I-P4-01**: `CASCADE_FIRST_DEGREE_MULTIPLIER === 0.5`
- Spec: A.2 Rule 3. Not configurable.
- A claim whose direct parent (via `derived_from`) is retracted has `effectiveConfidence *= 0.5`.

**I-P4-02**: `CASCADE_SECOND_DEGREE_MULTIPLIER === 0.25`
- Spec: A.2 Rule 3. Not configurable.
- A claim whose grandparent (via `derived_from`) is retracted has `effectiveConfidence *= 0.25`.

**I-P4-03**: `CASCADE_MAX_DEPTH === 2`
- Spec: A.2 Rule 3. Traversal stops at depth 2.
- Claims at depth 3+ from a retracted ancestor receive penalty 1.0 (no penalty).

**I-P4-04**: Cascade penalty is never stored.
- Spec: Build Phases 4.3. Computed at query-time.
- `claim_assertions` table has no `cascade_penalty` column.
- Penalty is recomputed on every query, reflecting current retraction state.

**I-P4-05**: `effective_confidence = confidence * decayFactor * cascadePenalty`
- Spec: Phase 4 Design Source Decision 4.
- Three factors multiplied (not added, not averaged).
- `decayFactor` from Phase 3 FSRS formula, `cascadePenalty` from cascade traversal.

### Conflict Detection (CONSTITUTIONAL)

**I-P4-06**: Conflict detection is synchronous with assertion.
- Spec: Build Phases 4.1.
- Conflict detection executes inside the same transaction as claim creation.
- Claims and their contradiction relationships are atomically visible.

**I-P4-07**: Structural conflict = same subject + same predicate + different value + both active.
- Spec: Build Phases 4.1.
- Only active claims participate in conflict detection.
- Retracted claims are excluded.

**I-P4-08**: Contradiction review threshold = 0.8.
- Spec: A.2 Rule 2.
- All structural conflicts create `contradicts` relationships regardless of confidence.
- The 0.8 threshold is a configurable parameter (`autoConflictThreshold`) for determining review severity, but per the Design Source, all conflicts create relationships. The threshold may be used by future phases for review prioritization.

**I-P4-09**: `disputed` is bidirectional for `contradicts`.
- Spec: A.2 Rule 2 ("BOTH claims MUST be flagged").
- Design Source Decision 3.
- Query checks `from_claim_id = ? OR to_claim_id = ?` for `contradicts` type.
- Both the asserting claim and the contradicted claim have `disputed: true`.

### RBAC Enforcement (CONSTITUTIONAL)

**I-P4-10**: `requireRbac` defaults to `false`.
- Spec: C.8.
- When `requireRbac` is not set or is `false`, RBAC is dormant.
- `checkPermission()` always returns `true` when dormant.

**I-P4-11**: When `requireRbac: true`, `checkPermission()` enforces.
- Spec: C.8.
- `RbacEngine.isActive()` returns `true`.
- Operations without valid role fail with `UNAUTHORIZED`.

**I-P4-12**: `requireRbac` activation does not change existing facade code.
- The `requirePermission()` calls already exist in all facades.
- Phase 4 only changes the kernel `RbacEngine` behavior based on config.

### .raw Gating (CONSTITUTIONAL)

**I-P4-13**: Every `.raw` access is audit-logged.
- Spec: C.7.
- Regardless of `requireRbac` setting.
- Audit entry includes: timestamp, rawAccessTag (if present), caller context.

**I-P4-14**: When `requireRbac: true`, `.raw` access requires `rawAccessTag`.
- Spec: C.7.
- Access without tag throws when RBAC is active.
- When `requireRbac: false`, access is permitted without tag (but still logged).

### Retraction Taxonomy (CONSTITUTIONAL)

**I-P4-15**: `RetractionReason = 'incorrect' | 'superseded' | 'expired' | 'manual'`
- Spec: A.2 Rule 5.
- Four enumerated values only. Free-text not permitted.

**I-P4-16**: Default retraction reason is `'manual'`.
- Spec: Design Source Decision 5.
- `forget()` without explicit reason uses `'manual'`.

**I-P4-17**: `RetractClaimHandler` rejects reasons outside the taxonomy.
- Invalid reason → `INVALID_REASON` error.
- Claim status does not change on rejection.

---

## State Machine: Cascade Penalty

```
computeCascadePenalty(conn, claimId):

  START
    |
    [Query derived_from parents of claimId]
    |
    parents.length === 0?
    |--- YES ---> RETURN 1.0 (no penalty)
    |--- NO --->
      |
      FOR each parent:
        |
        parent.status === 'retracted'?
        |--- YES ---> worstPenalty = min(worstPenalty, 0.5)
        |--- NO --->
          |
          [Query derived_from grandparents of parent]
          |
          FOR each grandparent:
            |
            grandparent.status === 'retracted'?
            |--- YES ---> worstPenalty = min(worstPenalty, 0.25)
            |--- NO ---> continue
      |
      RETURN worstPenalty
```

Short-circuit: if `worstPenalty` reaches 0.25, no further traversal needed (0.25 is the minimum possible).

---

## Formal Assertions

```
ASSERT I-P4-01: CASCADE_FIRST_DEGREE_MULTIPLIER === 0.5
ASSERT I-P4-02: CASCADE_SECOND_DEGREE_MULTIPLIER === 0.25
ASSERT I-P4-03: CASCADE_MAX_DEPTH === 2

ASSERT I-P4-04: FOR ALL claims c:
  claim_assertions.columns DOES NOT CONTAIN 'cascade_penalty'

ASSERT I-P4-05: FOR ALL query results r:
  r.effectiveConfidence === r.claim.confidence * decayFactor(r.claim) * cascadePenalty(r.claim)

ASSERT I-P4-06: FOR ALL assertions a:
  a.contradicts_relationships CREATED IN SAME transaction AS a.claim

ASSERT I-P4-07: FOR ALL conflict detections:
  existing.status === 'active' AND existing.subject === new.subject
  AND existing.predicate === new.predicate AND existing.objectValue !== new.objectValue

ASSERT I-P4-09: FOR ALL claims c WHERE exists(contradicts relationship involving c):
  c.disputed === true
  (regardless of direction: c as from_claim_id OR c as to_claim_id)

ASSERT I-P4-10: requireRbac === undefined OR requireRbac === false
  IMPLIES checkPermission() ALWAYS returns true

ASSERT I-P4-11: requireRbac === true
  IMPLIES checkPermission() performs actual role-based check

ASSERT I-P4-13: FOR ALL .raw accesses:
  audit_entries CONTAINS entry with operation='raw_access'

ASSERT I-P4-15: FOR ALL retractClaim(input):
  input.reason IN ['incorrect', 'superseded', 'expired', 'manual']
  OR result.error.code === 'INVALID_REASON'

ASSERT I-P4-17: FOR ALL retractClaim(input) WHERE input.reason NOT IN taxonomy:
  claim.status === 'active' (unchanged)
```

---

*SolisHQ -- We innovate, invent, then disrupt.*
