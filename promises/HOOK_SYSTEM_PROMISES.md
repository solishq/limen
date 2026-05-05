# Hook System Contract Promises

Phase 2.6 — Computational Pipeline Hooks

## Promise 1: Error Isolation (CONSTITUTIONAL)

A throwing hook NEVER crashes the Limen engine. All hook invocations are wrapped in try/catch at every call site. A single bad hook cannot affect other hooks or core behavior.

**Verification:** `tests/unit/hook_registry.test.ts` — error isolation tests (4 distinct scenarios). `tests/breaker/phase_2_6_hooks.test.ts` — F-002 getter trap test.

## Promise 2: Backward Compatibility (CONSTITUTIONAL)

The hook system does NOT modify existing Phase 8 plugin behavior. Existing `LimenPlugin` event subscriptions work identically. An engine with no hooks (`config.hooks: []` or `undefined`) behaves identically to an engine without hook support.

**Verification:** `tests/unit/hook_registry.test.ts` — "empty hook registry has no effect on any pipeline" test.

## Promise 3: Decay Clamping (CONSTITUTIONAL)

A decay hook can NEVER amplify confidence. The return value of `computeDecay()` is clamped to `[0, confidence]`. NaN, Infinity, negative values, and values exceeding the input confidence are rejected (fallback to default FSRS decay).

**Verification:** `tests/breaker/phase_2_6_hooks.test.ts` — F-003 FIX tests (5 scenarios: NaN, Infinity, negative, amplification, valid).

## Promise 4: Assertion Validation (CONSTITUTIONAL)

A beforeAssert hook cannot return partial or invalid objects that bypass downstream validation. Return values are validated for required fields (subject, predicate, object, confidence in [0,1], groundingMode). Invalid returns are SKIPPED (original input preserved).

**Verification:** `tests/breaker/phase_2_6_hooks.test.ts` — F-001 FIX tests (4 scenarios).

## Promise 5: Resource Containment

Maximum 50 hooks per registry. Cumulative across all `registerAll()` calls. Excess registration returns `HOOK_MAX_EXCEEDED` error.

**Verification:** `tests/breaker/phase_2_6_hooks.test.ts` — F-005 FIX test.

## Promise 6: Deterministic Ordering

Hooks execute in ascending priority order (lower number = first). NaN priorities normalize to DEFAULT_HOOK_PRIORITY (100). Same-priority hooks maintain registration order (V8 stable sort).

**Verification:** `tests/unit/hook_registry.test.ts` — priority ordering tests. `tests/breaker/phase_2_6_hooks.test.ts` — F-007 FIX test.

## Promise 7: Recall Isolation

Recall hooks receive a defensive copy of the beliefs array. Mutation within a hook does not corrupt the caller's original array or the input to other hooks on failure.

**Verification:** `tests/breaker/phase_2_6_hooks.test.ts` — F-004 FIX tests (2 scenarios).

## Concurrency Posture

The hook system is synchronous. Hooks execute within the same transaction as the operation they intercept (assertion hooks within the claim assertion transaction, decay/recall hooks within the query operation). SQLite WAL mode provides serialized write access. No concurrent access to hook state is possible under normal operation.

## Interface Evolution Strategy

Hook interfaces (`LimenHook`, `ClaimAssertionHook`, `DecayHook`, `RecallHook`) are versioned via the package semver. Adding new optional hook types is a minor version bump. Removing or modifying existing hook signatures requires a major version bump. The `meta.version` field on each hook instance enables runtime compatibility detection if needed in future.
