# PHASE 1 TRUTH MODEL: Convenience API

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: `docs/sprints/PHASE-1-DESIGN-SOURCE.md` (APPROVED with 3 amendments)
**DC Declaration**: `docs/sprints/PHASE-1-DC-DECLARATION.md`

---

## Phase 1 Invariants

### Initialization Invariants

**I-CONV-01**: After `createLimen()` returns, all convenience methods (remember, recall, forget, connect, reflect, promptInstructions) are immediately usable without additional setup.

**I-CONV-02**: The convenience mission and agent are created once during engine initialization and cached for the engine lifetime. No lazy initialization state machine exists at runtime.

**I-CONV-03**: `maxAutoConfidence` is validated at `createLimen()` time. It must be a finite number in [0.0, 1.0]. Invalid values cause `createLimen()` to throw `INVALID_CONFIG`.

### Confidence Ceiling Invariants

**I-CONV-04 (CONSTITUTIONAL)**: A claim created via `remember()` with `groundingMode !== 'evidence_path'` OR empty `evidenceRefs` has `confidence <= maxAutoConfidence`. This is the primary defense against confidence laundering (A.2 Rule 1).

**I-CONV-05 (CONSTITUTIONAL)**: A claim created via `remember()` with `groundingMode === 'evidence_path'` AND non-empty `evidenceRefs` may have `confidence > maxAutoConfidence`. This is the explicit bypass path requiring evidence.

### Governance Boundary Invariants

**I-CONV-06 (CONSTITUTIONAL)**: Every convenience method delegates to `ClaimApi` for data operations. No convenience method directly accesses `ClaimSystem`, `ClaimStore`, or database tables. (I-17 preserved.)

**I-CONV-07 (CONSTITUTIONAL)**: Every mutating convenience method (remember, forget, connect, reflect) produces an audit trail entry via the underlying system call delegation chain. (I-03 preserved.)

### Data Quality Invariants

**I-CONV-08**: `recall()` excludes superseded claims by default. Claims with `superseded === true` in the query result are filtered out unless `options.includeSuperseded === true`.

**I-CONV-09**: `remember()` 1-param form rejects empty or whitespace-only text with `CONV_INVALID_TEXT`.

**I-CONV-10**: `reflect()` is all-or-nothing. Either all entries are committed (stored count = entries.length) or none are (transaction rollback). No partial state.

**I-CONV-11**: `forget()` delegates to `ClaimApi.retractClaim()`. The retracted claim remains in the database with `status='retracted'`. Forward-only lifecycle (CCP-I2) is enforced by the database trigger.

### Overload Resolution Invariant

**I-CONV-12**: `remember(subject, predicate, value, opts?)` is resolved when `typeof secondArg === 'string'`. `remember(text, opts?)` is resolved otherwise. No ambiguity at runtime.

### Subject Format Invariant

**I-CONV-13**: 1-param `remember()` generates subject as `entity:observation:<sha256-hex-first-12>`. This satisfies CCP subject validation (3 colon-separated segments with `entity:` prefix).

### Error Flow Invariant

**I-CONV-14**: System-call errors from ClaimApi are mapped to convenience error codes where appropriate (CLAIM_NOT_FOUND -> CONV_CLAIM_NOT_FOUND, CLAIM_ALREADY_RETRACTED -> CONV_ALREADY_RETRACTED, SELF_REFERENCE -> CONV_SELF_REFERENCE). All other system-call errors pass through unchanged.

### Deep Freeze Compatibility Invariant

**I-CONV-15**: All convenience methods are callable on a deepFrozen Limen object. Closure-captured mutable state (missionId, taskId, agentId) survives Object.freeze because freeze applies to the object graph, not captured variables.

### Cross-Phase Invariants

**I-CONV-16 (CONSTITUTIONAL)**: All 3,188 existing tests pass after Phase 1 implementation. Phase 1 is purely additive -- no existing method signature changed, no existing behavior altered.

**I-CONV-17**: All 134 existing invariants remain enforced. Phase 1 does not modify any enforcement mechanism.

### Prompt Instructions Invariant

**I-CONV-18**: `promptInstructions()` is a pure function. It performs no I/O, accesses no state, and returns the same string every time.

---

## Formal Assertions (Testable)

```
ASSERT: createLimen({ cognitive: { maxAutoConfidence: -0.1 } }) throws INVALID_CONFIG
ASSERT: createLimen({ cognitive: { maxAutoConfidence: 1.1 } }) throws INVALID_CONFIG
ASSERT: createLimen({ cognitive: { maxAutoConfidence: NaN } }) throws INVALID_CONFIG
ASSERT: createLimen({ cognitive: { maxAutoConfidence: Infinity } }) throws INVALID_CONFIG
ASSERT: createLimen({ cognitive: { maxAutoConfidence: 0.5 } }) succeeds
ASSERT: createLimen({ cognitive: {} }) succeeds (default 0.7)
ASSERT: createLimen({}) succeeds (no cognitive config = default 0.7)

ASSERT: remember(subj, pred, val).ok === true
ASSERT: remember(subj, pred, val).value.confidence <= 0.7 (default maxAutoConfidence)
ASSERT: remember(subj, pred, val, { confidence: 0.9 }).value.confidence === 0.7 (capped)
ASSERT: remember(subj, pred, val, { confidence: 0.9, groundingMode: 'evidence_path', evidenceRefs: [ref] }).value.confidence === 0.9 (bypass)
ASSERT: remember('text').ok === true
ASSERT: remember('').ok === false && error.code === 'CONV_INVALID_TEXT'
ASSERT: remember('   ').ok === false && error.code === 'CONV_INVALID_TEXT'
ASSERT: remember(subj, pred, val, { confidence: 1.5 }).ok === false && error.code === 'CONV_INVALID_CONFIDENCE'

ASSERT: recall().ok === true (returns all recent claims)
ASSERT: recall(subj).ok === true (filters by subject)
ASSERT: recall(subj, pred).ok === true (filters by subject+predicate)
ASSERT: recall() result excludes superseded claims by default
ASSERT: recall(undefined, undefined, { includeSuperseded: true }) includes superseded claims

ASSERT: forget(validClaimId).ok === true
ASSERT: forget('nonexistent').ok === false
ASSERT: forget(alreadyRetracted).ok === false && error.code === 'CONV_ALREADY_RETRACTED'

ASSERT: connect(id1, id2, 'supports').ok === true
ASSERT: connect(id1, id1, 'supports').ok === false && error.code === 'CONV_SELF_REFERENCE'

ASSERT: reflect([{ category: 'decision', statement: 'test' }]).ok === true
ASSERT: reflect([]).ok === false && error.code === 'CONV_EMPTY_ENTRIES'
ASSERT: reflect([{ category: 'invalid', statement: 'test' }]).ok === false
ASSERT: reflect([{ category: 'decision', statement: 'x'.repeat(501) }]).ok === false

ASSERT: promptInstructions() returns non-empty string
ASSERT: promptInstructions() === promptInstructions() (deterministic)
```

---

## Self-Audit

- Did I derive from spec? YES -- every invariant traces to Design Source, Addendum A.2, or constitution.
- Would the Breaker find fault? The confidence capping logic is the primary attack surface. The Breaker should verify that the pre-capping in the convenience layer correctly interacts with any downstream capping in the GroundingValidator.
- **I do NOT judge completeness -- that is the Breaker's job (HB #23).**

---

*SolisHQ -- We innovate, invent, then disrupt.*
