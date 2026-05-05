# Plugin & Hook API Reference

Complete interface documentation for Limen's extension system.

## Table of Contents

1. [Hook System (Phase 2.6)](#hook-system)
2. [Plugin System (Phase 8)](#plugin-system)
3. [Error Codes](#error-codes)
4. [Constants](#constants)

---

## Hook System

### `LimenHook`

The top-level hook interface. Registered via `LimenConfig.hooks[]`.

```typescript
interface LimenHook {
  readonly meta: PluginMeta;
  readonly priority?: number;          // Default: 100. Lower = runs first.
  readonly claimAssertion?: ClaimAssertionHook;
  readonly decay?: DecayHook;
  readonly recall?: RecallHook;
}
```

---

### `ClaimAssertionHook`

```typescript
interface ClaimAssertionHook {
  readonly beforeAssert?: (claim: ClaimCreateInput, ctx: AssertionHookContext) => ClaimCreateInput | null;
  readonly afterAssert?: (claim: AssertedClaimInfo, ctx: AssertionHookContext) => void;
}
```

#### `beforeAssert`

Called between validation guards and `store.create()`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `claim` | `ClaimCreateInput` | The validated claim about to be persisted |
| `ctx` | `AssertionHookContext` | Agent/tenant/mission context |

**Returns:** Modified `ClaimCreateInput` to continue, or `null` to reject.

#### `afterAssert`

Called after persistence, before event emission.

| Parameter | Type | Description |
|-----------|------|-------------|
| `claim` | `AssertedClaimInfo` | The persisted claim record |
| `ctx` | `AssertionHookContext` | Agent/tenant/mission context |

**Returns:** void (notification only).

---

### `DecayHook`

```typescript
interface DecayHook {
  readonly computeDecay?: (confidence: number, ageMs: number, stabilityDays: number) => number;
}
```

#### `computeDecay`

Replaces the default FSRS decay computation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `confidence` | `number` | Raw stored confidence [0.0, 1.0] |
| `ageMs` | `number` | Claim age in milliseconds |
| `stabilityDays` | `number` | Stability factor in days |

**Returns:** Effective confidence after decay [0.0, confidence].

**Semantics:** Last registered decay hook wins (highest priority number among registered).

---

### `RecallHook`

```typescript
interface RecallHook {
  readonly onRecall?: (beliefs: RecallBeliefView[], query: RecallQueryContext) => RecallBeliefView[];
}
```

#### `onRecall`

Transforms recall results before return.

| Parameter | Type | Description |
|-----------|------|-------------|
| `beliefs` | `RecallBeliefView[]` | Assembled belief views |
| `query` | `RecallQueryContext` | Original query parameters |

**Returns:** Transformed array of beliefs.

**Semantics:** Multiple hooks chain (output → input of next).

---

### Context Types

#### `AssertionHookContext`

```typescript
interface AssertionHookContext {
  readonly agentId: string | null;
  readonly tenantId: string | null;
  readonly missionId: string | null;
}
```

#### `AssertedClaimInfo`

```typescript
interface AssertedClaimInfo {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly objectValue: string;
  readonly confidence: number;
  readonly groundingMode: string;
  readonly validAt: string;
  readonly createdAt: string;
}
```

#### `RecallQueryContext`

```typescript
interface RecallQueryContext {
  readonly subject: string | undefined;
  readonly predicate: string | undefined;
  readonly minConfidence: number | undefined;
  readonly limit: number | undefined;
}
```

#### `RecallBeliefView`

```typescript
interface RecallBeliefView {
  readonly claimId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly validAt: string;
  readonly freshness: string;
  [key: string]: unknown;  // Extensible — hooks can add fields
}
```

---

## Plugin System

### `LimenPlugin`

The Phase 8 event plugin interface. Registered via `LimenConfig.plugins[]`.

```typescript
interface LimenPlugin {
  readonly meta: PluginMeta;
  install(context: PluginContext): void;
  destroy?(): void | Promise<void>;
}
```

### `PluginMeta`

Shared between hooks and plugins.

```typescript
interface PluginMeta {
  readonly name: string;     // Unique identifier
  readonly version: string;  // Semver
}
```

### `PluginContext`

Provided to plugins during `install()`.

```typescript
interface PluginContext {
  on(event: LimenEventName, handler: LimenEventHandler): string;
  off(subscriptionId: string): void;
  readonly api: PluginApi;
  readonly config: Readonly<Record<string, unknown>>;
  readonly log: PluginLogger;
}
```

### `LimenEventName`

```typescript
type LimenEventName =
  | 'claim:asserted'
  | 'claim:retracted'
  | 'claim:evidence:retracted'
  | 'claim:relationship:declared'
  | 'claim:tombstoned'
  | 'claim:evidence:orphaned'
  | 'claim:dependency:invalidated'
  | 'claim:related'
  | '*';
```

### `PluginApi`

Subset of Limen API available to plugins (deferred — not during install).

```typescript
interface PluginApi {
  remember(subject: string, predicate: string, value: string, options?: unknown): unknown;
  recall(subject?: string, predicate?: string, options?: unknown): unknown;
  forget(claimId: string, reason?: string): unknown;
  search(query: string, options?: unknown): unknown;
  connect(claimId1: string, claimId2: string, type: string): unknown;
}
```

---

## Error Codes

### Hook Errors

| Code | Meaning |
|------|---------|
| `HOOK_INVALID_META` | Missing or empty name/version |
| `HOOK_DUPLICATE_NAME` | Hook with same name already registered |
| `HOOK_MAX_EXCEEDED` | Exceeded maximum hook count (50) |
| `HOOK_REJECTED` | `beforeAssert` returned null — claim rejected |

### Plugin Errors

| Code | Meaning |
|------|---------|
| `PLUGIN_INVALID_META` | Missing or empty name/version |
| `PLUGIN_DUPLICATE_NAME` | Plugin with same name already installed |
| `PLUGIN_INSTALL_FAILED` | `install()` threw |
| `PLUGIN_DESTROY_FAILED` | `destroy()` threw |
| `PLUGIN_API_NOT_READY` | Called API during install (before engine ready) |
| `PLUGIN_MAX_EXCEEDED` | Exceeded maximum plugin count (50) |
| `PLUGIN_INVALID_EVENT` | Unknown event name |

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_PLUGINS` | 50 | Maximum hooks + plugins combined |
| `DEFAULT_HOOK_PRIORITY` | 100 | Default priority when not specified |

---

## Migration to v5

When Limen v5 (Rust) ships:
- Hook interfaces remain identical (TypeScript types → Rust traits via FFI or WASM)
- Registration moves from `LimenConfig.hooks[]` to the v5 substrate's plugin registry
- Decay hooks map to the v5 `limen_projection` crate's decay pipeline
- Assertion hooks map to the v5 `limen_chain` crate's commit path
- Recall hooks map to the v5 `limen_api` crate's query surface

Design your hooks as pure functions with no Node.js-specific dependencies to ease migration.
