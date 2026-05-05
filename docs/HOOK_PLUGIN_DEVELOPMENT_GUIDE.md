# Hook/Plugin Development Guide

Build computational pipeline hooks that intercept Limen's core behavior — claim assertion, decay computation, and recall result transformation.

## Hooks vs. Plugins

| Aspect | Plugins (Phase 8) | Hooks (Phase 2.6) |
|--------|-------------------|-------------------|
| Purpose | **Observe** events | **Intercept** computation |
| Timing | After the fact | Before/during execution |
| Can modify? | No | Yes |
| Can reject? | No | Yes (beforeAssert → null) |
| Interface | `LimenPlugin` | `LimenHook` |
| Registration | `config.plugins[]` | `config.hooks[]` |

Both systems coexist. Existing plugins continue to work unchanged.

## Hook Interface

```typescript
import type { LimenHook } from 'limen-ai';

const myHook: LimenHook = {
  meta: { name: 'my-hook', version: '1.0.0' },
  priority: 100, // Lower number = runs first. Default: 100.

  claimAssertion: {
    beforeAssert(claim, ctx) { /* ... */ },
    afterAssert(claim, ctx) { /* ... */ },
  },

  decay: {
    computeDecay(confidence, ageMs, stabilityDays) { /* ... */ },
  },

  recall: {
    onRecall(beliefs, query) { /* ... */ },
  },
};
```

All hook methods are optional. Implement only what you need.

## Registration

```typescript
import { createLimen } from 'limen-ai';
import { myHook } from './my-hook.js';

const limen = await createLimen({
  dataDir: '/path/to/data',
  masterKey: Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex'),
  hooks: [myHook],
});
```

Hooks are registered during `createLimen()`, before `Object.freeze()`.

## Important: Execution Semantics Differ by Hook Type

- **Assertion hooks** and **Recall hooks**: ALL registered hooks run, chaining in priority order.
- **Decay hooks**: Only the hook with the **highest priority number** wins. Others are ignored. This is "last wins" — not "all chain."

This asymmetry exists because multiple decay formulas cannot compose meaningfully (applying two independent decay functions would double-decay), while assertion checks and recall transforms compose naturally.

## Hook Types

### 1. Claim Assertion Hook

Intercepts the claim assertion pipeline between validation and persistence.

```typescript
claimAssertion: {
  // Called after all 23 validation guards pass, before store.create()
  beforeAssert(claim: ClaimCreateInput, ctx: AssertionHookContext) {
    // Return claim (possibly modified) to continue
    // Return null to reject (pipeline returns HOOK_REJECTED error)
    if (claim.confidence < 0.5) return null;
    return claim;
  },

  // Called after persistence, before event emission (notification only)
  afterAssert(claim: AssertedClaimInfo, ctx: AssertionHookContext) {
    console.log(`Claim ${claim.id} asserted for ${claim.subject}`);
  },
}
```

**`AssertionHookContext`:**
- `agentId` — Agent performing the assertion
- `tenantId` — Tenant scope
- `missionId` — Mission context

### 2. Decay Hook

Replaces the default FSRS power-decay formula.

```typescript
decay: {
  // Called instead of the default computeDecayFactor()
  computeDecay(confidence: number, ageMs: number, stabilityDays: number): number {
    // Return effective confidence (confidence × decay factor)
    const ageDays = ageMs / 86_400_000;
    return confidence * Math.exp(-0.023 * ageDays); // exponential
  },
}
```

**Semantics:**
- If multiple hooks define `computeDecay`, the **last one** (highest priority number) wins
- On error, falls back to default FSRS decay
- Return value must be in range [0, confidence]

**Default FSRS formula (what you're replacing):**
```
R(t) = (1 + t/(9*S))^(-1)
effectiveConfidence = confidence * R(t)
```

### 3. Recall Hook

Transforms recall results before they're returned to the caller.

```typescript
recall: {
  // Called after results are assembled, before return
  onRecall(beliefs: RecallBeliefView[], query: RecallQueryContext): RecallBeliefView[] {
    // Filter, reorder, augment, or transform
    return beliefs.filter(b => b.effectiveConfidence > 0.3);
  },
}
```

**Semantics:**
- If multiple hooks define `onRecall`, they **chain** (output of one = input of next)
- On error, previous result is preserved (hook skipped)
- Can add properties to beliefs (spread + new fields)

## Error Isolation

Every hook call is wrapped in try/catch. A throwing hook:
- Is logged as a warning
- Is skipped for that invocation
- Does NOT crash the pipeline
- Does NOT affect other hooks

```typescript
// This hook throws but won't crash Limen
beforeAssert(claim, ctx) {
  throw new Error('oops'); // Logged, skipped, pipeline continues
}
```

## Priority System

Lower priority number = runs first.

```typescript
const earlyHook: LimenHook = { meta: {...}, priority: 10, ... };  // Runs first
const lateHook: LimenHook = { meta: {...}, priority: 200, ... };  // Runs last
const defaultHook: LimenHook = { meta: {...}, ... };              // priority: 100
```

For decay hooks, priority determines which one wins (last = highest priority number).

## Testing Your Hook

```typescript
import { createHookRegistry } from 'limen-ai/src/plugins/hook_registry.js';

const registry = createHookRegistry({
  log: (level, cat, msg) => console.log(`[${level}] ${cat}: ${msg}`),
});

registry.registerAll([myHook]);

// Test assertion rejection
const result = registry.executeBeforeAssert(testClaim, testCtx);
assert.strictEqual(result.value, null); // Hook rejected

// Test decay override
const decay = registry.computeDecay(0.9, 86_400_000 * 30, 10);
assert.ok(decay !== null); // Hook provided value
```

## Reference Plugins

See `examples/plugins/` for complete working examples:

1. **`confidence-verifier.ts`** — Blocks low-confidence claims
2. **`refusal-extractor.ts`** — Enriches beliefs with refusal metadata
3. **`exponential-decay.ts`** — Alternative decay formula

## Constraints

- Max 50 hooks (shared limit with plugins)
- Hooks are synchronous (no async/await)
- Hook names must be unique
- Hooks cannot access Limen internals — only the data passed to them
- Cannot modify the `PluginMeta` after registration
