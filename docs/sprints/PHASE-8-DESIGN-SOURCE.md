# PHASE 8 DESIGN SOURCE: INTEGRATIONS

**Date**: 2026-04-01
**Author**: Builder
**Status**: DESIGN SOURCE (Phase 0.5)
**Classification**: SIGNIFICANT
**Governing documents**: LIMEN_BUILD_PHASES.md (Phase 8), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md, CLAUDE.md
**Oracle Gate**: OG-CONSULT completed 2026-04-01T19:17:54Z (CISA KEV advisories — no Class A failures on design; no design-specific standards violations)

---

## PROMPT AUDIT GATE

| Check | Finding | Resolution |
|-------|---------|------------|
| Gaps | None | All governing documents read, all codebase references verified |
| Wrong assumptions | Prompt asks about "existing EventBus" — EventBus CONFIRMED at `src/kernel/interfaces/events.ts` with `emit()`, `subscribe()`, `unsubscribe()`. CCP_EVENTS defines 6 event types. | Proceed with EventBus as foundation |
| Missing edge cases | Plugin lifecycle during shutdown not in spec. Import deduplication strategy undefined. | Addressed in Outputs 3 and 5 below |
| Downstream | Design Source feeds Controls 1-7 for Builder | All interfaces specified with precision |

---

## FIVE QUESTIONS

1. **What does the spec require?** Phase 8 items 8.1-8.6: plugin architecture (`limen.use(plugin)`), LangChain adapter (`LimenMemory extends BaseMemory`), export CLI (json/csv/markdown/sqlite), import CLI (json with dedup), custom event hooks (`limen.on('claim:asserted', callback)`), tests for all.

2. **How can this fail?** (a) Plugin mutates frozen Limen instance — TypeError at runtime. (b) Plugin introduces memory leaks via event subscriptions never cleaned up. (c) Import creates duplicate claims corrupting knowledge graph. (d) Export format loses relationship data. (e) LangChain dependency contaminates main package. (f) Event hooks run user code synchronously in critical path causing latency spikes.

3. **Downstream consequences?** Plugin interface becomes a public API contract — frozen after release. LangChain adapter becomes a separate npm package with its own semver. Export format becomes a de facto interchange standard. Event hook pattern becomes the extension mechanism for all future integrations.

4. **What am I assuming?** (a) The Limen interface is Object.freeze'd — VERIFIED at `src/api/index.ts:1245`. (b) EventBus subscribe() uses glob patterns — VERIFIED. (c) CLI lives at `packages/limen-cli` with Commander.js — VERIFIED. (d) LangChain BaseMemory interface is stable enough to target — ASSUMPTION, mitigated by separate package.

5. **Would a hostile reviewer find fault?** They would ask: how does `limen.use()` work if the object is frozen? Answer: `use()` must be called BEFORE `createLimen()` returns — it is a config-time operation, not a runtime mutation. The plugin registers hooks/extensions into a mutable plugin registry during construction, before `deepFreeze()`.

---

## OUTPUT 1: MODULE DECOMPOSITION

### 1.1 Plugin System (8.1)

**Location**: `src/plugins/`
**Purpose**: Extensibility mechanism for Limen. Plugins register capabilities during engine construction (before freeze). They cannot mutate the frozen instance.

```
src/plugins/
  interfaces/plugin_types.ts     <- THE CONTRACT: Plugin, PluginContext, PluginHook
  harness/plugin_harness.ts      <- THE FACTORY: createPluginRegistry()
  store/plugin_stores.ts         <- THE IMPLEMENTATION: registry, lifecycle, validation
```

**Dependencies**: Kernel EventBus (for hook registration), LimenConfig (for plugin config)
**Consumed by**: `createLimen()` in `src/api/index.ts`

### 1.2 Event Hooks (8.5)

**Location**: `src/plugins/` (part of plugin system)
**Purpose**: Consumer-facing event subscription API. Thin facade over kernel EventBus with consumer-friendly event names and payloads.

The consumer-facing `limen.on()` and `limen.off()` methods delegate to the kernel EventBus `subscribe()` and `unsubscribe()`. The mapping between consumer event names (`'claim:asserted'`) and internal event types (`'claim.asserted'`) is a trivial translation layer.

**Design decision**: `limen.on()` / `limen.off()` are added to the Limen interface as new methods. They are safe to add because the interface is additive-only (Phase 8 constraint). The implementation captures the EventBus reference in a closure during `createLimen()`, same pattern as all other methods on Limen.

### 1.3 Import/Export (8.3, 8.4)

**Location**: `packages/limen-cli/src/commands/` (CLI commands) + `src/exchange/` (core logic)

The import/export logic lives in the main `limen-ai` package as a reusable module. The CLI commands in `limen-cli` are thin wrappers.

```
src/exchange/
  interfaces/exchange_types.ts   <- THE CONTRACT: ExportFormat, ImportFormat, ExportOptions
  harness/exchange_harness.ts    <- THE FACTORY: createExporter(), createImporter()
  store/exchange_stores.ts       <- THE IMPLEMENTATION: serialization, deserialization, dedup

packages/limen-cli/src/commands/
  export.ts                      <- CLI command: limen export --format json|csv|markdown|sqlite
  import.ts                      <- CLI command: limen import --format json
```

**Dependencies**: ClaimApi (queryClaims, assertClaim, relateClaims), DatabaseConnection (for sqlite export)
**Consumed by**: limen-cli, programmatic API (`limen.export()`, `limen.import()`)

### 1.4 LangChain Adapter (8.2)

**Location**: `packages/limen-langchain/`
**Purpose**: LangChain framework adapter. Separate package. NOT a dependency of `limen-ai`.

```
packages/limen-langchain/
  package.json                   <- peerDependencies: { "limen-ai": "^1.4.0", "@langchain/core": "^0.3.0" }
  src/
    index.ts                     <- export { LimenMemory }
    memory.ts                    <- LimenMemory extends BaseMemory
    types.ts                     <- LimenMemoryConfig, etc.
  tests/
    memory.test.ts               <- Integration tests
```

**Dependencies**: `limen-ai` (peer), `@langchain/core` (peer)
**Zero production dependencies of its own** — both are peer deps.

### 1.5 Boundary Summary

| Module | Location | New Files | Modifies Existing |
|--------|----------|-----------|-------------------|
| Plugin System | `src/plugins/` | 3 files | `src/api/interfaces/api.ts`, `src/api/index.ts` |
| Event Hooks | `src/plugins/` | (included above) | `src/api/interfaces/api.ts`, `src/api/index.ts` |
| Exchange (core) | `src/exchange/` | 3 files | None |
| Exchange (CLI) | `packages/limen-cli/` | 2 files | `packages/limen-cli/src/cli.ts` |
| LangChain | `packages/limen-langchain/` | 4+ files | None (new package) |

---

## OUTPUT 2: TYPE ARCHITECTURE

### 2.1 Plugin Types (`src/plugins/interfaces/plugin_types.ts`)

```typescript
/**
 * Phase 8 Plugin System Type Definitions.
 *
 * Spec refs: LIMEN_BUILD_PHASES.md (8.1, 8.5)
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 2)
 *
 * Plugins extend Limen at construction time, before Object.freeze().
 * They cannot mutate the frozen instance. They CAN:
 * - Subscribe to events
 * - Register lifecycle hooks (init, destroy)
 * - Access the Limen API for reads/writes
 */

/** Plugin identity — unique name, semver version. */
export interface PluginMeta {
  /** Unique plugin name (e.g., 'limen-langchain', 'my-custom-plugin'). */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
}

/**
 * The context provided to a plugin during installation.
 * This is the plugin's view of the Limen engine — scoped and safe.
 *
 * CRITICAL: PluginContext does NOT expose .raw or database internals.
 * Plugins interact through the public API only.
 */
export interface PluginContext {
  /**
   * Subscribe to Limen events.
   * Pattern uses colon-separated names: 'claim:asserted', 'claim:retracted', etc.
   * Returns a subscription ID for later unsubscription.
   */
  on(event: LimenEventName, handler: LimenEventHandler): string;

  /**
   * Unsubscribe from events by subscription ID.
   */
  off(subscriptionId: string): void;

  /**
   * Access to the Limen convenience API for reads/writes.
   * Available after plugin install completes (during engine construction).
   *
   * NOTE: This is a deferred reference — the actual Limen instance is not
   * available until all plugins are installed and the engine is constructed.
   * Plugins MUST NOT call api methods during install(). They should
   * store the reference and use it in event handlers or deferred callbacks.
   */
  readonly api: PluginApi;

  /**
   * Plugin-scoped configuration (from LimenConfig.plugins[name]).
   * Type-erased — plugins cast to their own config type.
   */
  readonly config: Readonly<Record<string, unknown>>;

  /**
   * Logger scoped to the plugin name.
   */
  readonly log: PluginLogger;
}

/**
 * Subset of Limen API exposed to plugins.
 * Does NOT include shutdown(), session(), agents, missions, roles — those
 * are engine-level concerns, not plugin concerns.
 */
export interface PluginApi {
  remember(subject: string, predicate: string, value: string, options?: unknown): unknown;
  recall(subject?: string, predicate?: string, options?: unknown): unknown;
  forget(claimId: string, reason?: string): unknown;
  search(query: string, options?: unknown): unknown;
  connect(claimId1: string, claimId2: string, type: string): unknown;
}

/**
 * Plugin logger interface.
 */
export interface PluginLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * The Plugin interface — what plugin authors implement.
 *
 * Lifecycle:
 * 1. createLimen() iterates config.plugins[]
 * 2. For each: calls plugin.install(context)
 * 3. All plugins installed -> engine frozen -> returned to consumer
 * 4. On shutdown: calls plugin.destroy() in reverse install order
 *
 * Install is SYNCHRONOUS. If a plugin needs async init, it defers
 * to event handlers or the first API call.
 */
export interface LimenPlugin {
  /** Plugin identity */
  readonly meta: PluginMeta;

  /**
   * Called during createLimen(), before Object.freeze().
   * Register event subscriptions, store API references.
   * MUST NOT call api methods during install (engine not ready).
   * MUST be synchronous.
   */
  install(context: PluginContext): void;

  /**
   * Called during shutdown(), in reverse install order.
   * Clean up resources, flush buffers, unsubscribe events.
   * Optional — plugins without cleanup can omit this.
   */
  destroy?(): void | Promise<void>;
}

// ── Event Types ──

/**
 * Consumer-facing event names.
 * Colon-separated (not dot-separated like internal EventBus).
 * Maps to internal EventBus types via simple translation.
 */
export type LimenEventName =
  | 'claim:asserted'
  | 'claim:retracted'
  | 'claim:evidence:retracted'
  | 'claim:relationship:declared'
  | 'claim:tombstoned'
  | 'claim:evidence:orphaned'
  | '*';  // wildcard — all events

/**
 * Consumer-facing event payload.
 * Simplified from internal EventPayload — no scope/propagation/missionId.
 */
export interface LimenEvent {
  /** Event name (e.g., 'claim:asserted') */
  readonly type: LimenEventName;
  /** Event-specific data */
  readonly data: Readonly<Record<string, unknown>>;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
}

/** Consumer event handler */
export type LimenEventHandler = (event: LimenEvent) => void;

// ── Event Name Mapping ──

/**
 * Maps consumer event names (colon-separated) to internal EventBus types (dot-separated).
 * Bidirectional — used for subscribe (consumer->internal) and emit (internal->consumer).
 */
export const EVENT_NAME_MAP: ReadonlyMap<LimenEventName, string> = new Map([
  ['claim:asserted', 'claim.asserted'],
  ['claim:retracted', 'claim.retracted'],
  ['claim:evidence:retracted', 'claim.evidence.retracted'],
  ['claim:relationship:declared', 'claim.relationship.declared'],
  ['claim:tombstoned', 'claim.tombstoned'],
  ['claim:evidence:orphaned', 'claim.evidence.orphaned'],
]);

/** Reverse map: internal type -> consumer event name */
export const REVERSE_EVENT_MAP: ReadonlyMap<string, LimenEventName> = new Map(
  Array.from(EVENT_NAME_MAP.entries()).map(([k, v]) => [v, k]),
);

// ── Plugin Registry Types ──

/** Internal: tracks installed plugins */
export interface InstalledPlugin {
  readonly plugin: LimenPlugin;
  readonly subscriptionIds: readonly string[];
  readonly installedAt: string; // ISO 8601
}

// ── Error Codes ──

export type PluginErrorCode =
  | 'PLUGIN_INVALID_META'          // Missing name or version
  | 'PLUGIN_DUPLICATE_NAME'        // Plugin with same name already installed
  | 'PLUGIN_INSTALL_FAILED'        // install() threw
  | 'PLUGIN_DESTROY_FAILED'        // destroy() threw
  | 'PLUGIN_API_NOT_READY'         // Plugin tried to call API during install()
  | 'PLUGIN_MAX_EXCEEDED'          // Too many plugins (resource containment)
  | 'PLUGIN_INVALID_EVENT';        // Unknown event name

/** Maximum plugins per Limen instance (resource containment) */
export const MAX_PLUGINS = 50;
```

### 2.2 Exchange Types (`src/exchange/interfaces/exchange_types.ts`)

```typescript
/**
 * Phase 8 Import/Export Type Definitions.
 *
 * Spec refs: LIMEN_BUILD_PHASES.md (8.3, 8.4)
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 2)
 *
 * Defines the interchange format for Limen knowledge.
 * JSON is the canonical format — CSV and Markdown are lossy projections.
 */

// ── Export Types ──

/** Supported export formats */
export type ExportFormat = 'json' | 'csv' | 'markdown' | 'sqlite';

/** Export options */
export interface ExportOptions {
  /** Output format. Default: 'json'. */
  readonly format: ExportFormat;
  /** Filter by subject pattern (glob). Default: all. */
  readonly subject?: string;
  /** Filter by predicate pattern (glob). Default: all. */
  readonly predicate?: string;
  /** Filter by status. Default: 'active' only. */
  readonly status?: 'active' | 'retracted' | 'all';
  /** Include relationships. Default: true for json/sqlite, false for csv/markdown. */
  readonly includeRelationships?: boolean;
  /** Include evidence references. Default: true for json/sqlite, false for csv/markdown. */
  readonly includeEvidence?: boolean;
  /** Output file path. Default: stdout (for CLI). */
  readonly outputPath?: string;
  /** Pretty-print JSON. Default: true. */
  readonly pretty?: boolean;
}

/**
 * The canonical JSON export format.
 * This is the interchange standard. All other formats derive from this.
 */
export interface LimenExportDocument {
  /** Format version for forward compatibility */
  readonly version: '1.0.0';
  /** Export metadata */
  readonly metadata: ExportMetadata;
  /** Exported claims */
  readonly claims: readonly ExportedClaim[];
  /** Exported relationships (if includeRelationships) */
  readonly relationships: readonly ExportedRelationship[];
}

export interface ExportMetadata {
  /** ISO 8601 export timestamp */
  readonly exportedAt: string;
  /** Limen version that produced the export */
  readonly limenVersion: string;
  /** Total claim count */
  readonly claimCount: number;
  /** Total relationship count */
  readonly relationshipCount: number;
  /** Export options used */
  readonly options: Omit<ExportOptions, 'outputPath'>;
}

export interface ExportedClaim {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly objectType: string;
  readonly objectValue: string;
  readonly confidence: number;
  readonly validAt: string;
  readonly createdAt: string;
  readonly status: 'active' | 'retracted';
  readonly groundingMode: 'evidence_path' | 'runtime_witness';
  /** Phase 3: Stability value in days */
  readonly stability: number | null;
  /** Phase 5: Reasoning text */
  readonly reasoning: string | null;
  /** Evidence references (if includeEvidence) */
  readonly evidenceRefs?: readonly ExportedEvidenceRef[];
}

export interface ExportedEvidenceRef {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly label: string | null;
}

export interface ExportedRelationship {
  readonly fromClaimId: string;
  readonly toClaimId: string;
  readonly type: string;
  readonly createdAt: string;
}

// ── Import Types ──

/** Import options */
export interface ImportOptions {
  /** Input format. Currently only 'json'. */
  readonly format: 'json';
  /** Input file path. Required for CLI. */
  readonly inputPath?: string;
  /** Deduplication strategy. Default: 'by_content'. */
  readonly dedup: ImportDedup;
  /** Dry run — report what would be imported without writing. Default: false. */
  readonly dryRun?: boolean;
  /** Conflict resolution for duplicates. Default: 'skip'. */
  readonly onConflict?: 'skip' | 'update' | 'error';
}

/**
 * Deduplication strategy for import.
 *
 * 'by_id': Skip claims whose ID already exists in the database.
 *          Fast but fragile — IDs may collide across instances.
 *
 * 'by_content': Skip claims with same subject+predicate+objectValue+status.
 *               Slower but semantically correct. DEFAULT.
 *
 * 'none': Import everything. No dedup. Risk of duplicates.
 */
export type ImportDedup = 'by_id' | 'by_content' | 'none';

/** Import result */
export interface ImportResult {
  /** Claims successfully imported */
  readonly imported: number;
  /** Claims skipped (dedup match) */
  readonly skipped: number;
  /** Claims that failed to import */
  readonly failed: number;
  /** Relationships imported */
  readonly relationshipsImported: number;
  /** Relationships skipped (missing claim references) */
  readonly relationshipsSkipped: number;
  /** Details of failures */
  readonly errors: readonly ImportError[];
  /** ID mapping: old ID -> new ID (for relationship rebinding) */
  readonly idMap: ReadonlyMap<string, string>;
}

export interface ImportError {
  readonly claimIndex: number;
  readonly claimId: string;
  readonly reason: string;
}

// ── CSV Column Spec ──

/**
 * CSV export columns (ordered).
 * CSV is a lossy projection — no evidence refs, no relationships.
 */
export const CSV_COLUMNS = [
  'id', 'subject', 'predicate', 'objectType', 'objectValue',
  'confidence', 'validAt', 'createdAt', 'status', 'groundingMode',
  'stability', 'reasoning',
] as const;

// ── Error Codes ──

export type ExchangeErrorCode =
  | 'EXPORT_INVALID_FORMAT'       // Unknown format
  | 'EXPORT_WRITE_FAILED'         // File write error
  | 'EXPORT_QUERY_FAILED'         // Claim query error
  | 'IMPORT_INVALID_FORMAT'       // Not valid JSON or wrong version
  | 'IMPORT_INVALID_DOCUMENT'     // Missing required fields
  | 'IMPORT_READ_FAILED'          // File read error
  | 'IMPORT_CLAIM_FAILED'         // Individual claim import error
  | 'IMPORT_DEDUP_CONFLICT';      // Dedup conflict with onConflict='error'
```

### 2.3 LangChain Adapter Types (`packages/limen-langchain/src/types.ts`)

```typescript
/**
 * LangChain adapter types for Limen.
 * Separate package — NOT part of limen-ai.
 */

/** Configuration for LimenMemory */
export interface LimenMemoryConfig {
  /** The Limen instance to use as memory backend. */
  readonly limen: unknown;  // typed as unknown to avoid importing Limen type at module level
  /** Subject prefix for all memories stored by this adapter. Default: 'langchain:memory'. */
  readonly subjectPrefix?: string;
  /** Maximum memories to retrieve per load. Default: 20. */
  readonly maxMemories?: number;
  /** Minimum confidence for retrieved memories. Default: 0.3. */
  readonly minConfidence?: number;
  /** Memory key for the output of this memory class. Default: 'history'. */
  readonly memoryKey?: string;
  /** Human prefix in conversation. Default: 'Human'. */
  readonly humanPrefix?: string;
  /** AI prefix in conversation. Default: 'AI'. */
  readonly aiPrefix?: string;
}
```

---

## OUTPUT 3: STATE MACHINES

### 3.1 Plugin Lifecycle

```
States: REGISTERED -> INSTALLING -> INSTALLED -> DESTROYING -> DESTROYED
                         |                          |
                         v                          v
                      FAILED                     FAILED

Transitions:
  REGISTERED -> INSTALLING:   createLimen() iterates plugin list
  INSTALLING -> INSTALLED:    install() returns without error
  INSTALLING -> FAILED:       install() throws
  INSTALLED -> DESTROYING:    shutdown() called
  DESTROYING -> DESTROYED:    destroy() completes
  DESTROYING -> FAILED:       destroy() throws (non-fatal, logged, continue)

Terminal states: INSTALLED (normal operation), DESTROYED (after shutdown), FAILED

Guards:
  - REGISTERED -> INSTALLING: meta.name is unique, meta.version is non-empty
  - INSTALLING -> INSTALLED: install() is synchronous, does not throw
```

### 3.2 Import Pipeline

```
States: VALIDATING -> DEDUPLICATING -> IMPORTING_CLAIMS -> REBINDING_RELATIONSHIPS -> COMPLETE
            |              |                  |                       |
            v              v                  v                       v
          FAILED        SKIPPED          PARTIAL_FAIL            PARTIAL_FAIL

Transitions:
  VALIDATING -> DEDUPLICATING:     Document passes schema validation
  VALIDATING -> FAILED:            Invalid document structure
  DEDUPLICATING -> IMPORTING:      Dedup analysis complete
  IMPORTING -> REBINDING:          All claims processed (some may have failed)
  REBINDING -> COMPLETE:           All relationships processed

Notes:
  - Claims import in a single SQLite transaction (all-or-nothing per claim batch)
  - Relationships are rebased using the old-ID -> new-ID map
  - Relationships referencing missing claims are SKIPPED, not failed
```

### 3.3 Export Pipeline

```
States: QUERYING -> SERIALIZING -> WRITING -> COMPLETE
           |            |            |
           v            v            v
         FAILED       FAILED      FAILED

Simple linear pipeline. No retry. Failure at any stage = abort.
```

---

## OUTPUT 4: SYSTEM-CALL MAPPING

Phase 8 introduces NO new system calls. All operations delegate to existing system calls and APIs.

| Spec Item | Operation | Existing API Used |
|-----------|-----------|-------------------|
| 8.1 Plugin `limen.use()` | Register plugin during construction | None — new internal mechanism, pre-freeze |
| 8.1 Plugin `install()` | Plugin initialization | EventBus.subscribe() |
| 8.1 Plugin `destroy()` | Plugin cleanup | EventBus.unsubscribe() |
| 8.5 `limen.on()` | Event subscription | EventBus.subscribe() via internal mapping |
| 8.5 `limen.off()` | Event unsubscription | EventBus.unsubscribe() |
| 8.3 Export JSON | Query all claims | ClaimApi.queryClaims(), direct SQL for relationships |
| 8.3 Export CSV | Query + serialize | ClaimApi.queryClaims() |
| 8.3 Export Markdown | Query + render | ClaimApi.queryClaims() |
| 8.3 Export SQLite | Copy database | Direct file copy + filtered SQL |
| 8.4 Import JSON | Create claims | ClaimApi.assertClaim(), ClaimApi.relateClaims() |
| 8.2 LangChain load | Retrieve memories | limen.recall(), limen.search() |
| 8.2 LangChain save | Store memories | limen.remember() |

---

## OUTPUT 5: ERROR TAXONOMY

### 5.1 Plugin Errors

| Code | Trigger | Meaning | Recovery |
|------|---------|---------|----------|
| `PLUGIN_INVALID_META` | Plugin missing `meta.name` or `meta.version` | Plugin object malformed | Fix plugin implementation |
| `PLUGIN_DUPLICATE_NAME` | Two plugins with same `meta.name` | Name collision | Remove duplicate or rename |
| `PLUGIN_INSTALL_FAILED` | `install()` throws | Plugin init error | Fix plugin, check plugin logs |
| `PLUGIN_DESTROY_FAILED` | `destroy()` throws | Cleanup error (non-fatal) | Logged, shutdown continues |
| `PLUGIN_API_NOT_READY` | Plugin calls API during `install()` | Engine not constructed yet | Defer to event handler |
| `PLUGIN_MAX_EXCEEDED` | >50 plugins registered | Resource containment | Reduce plugin count |
| `PLUGIN_INVALID_EVENT` | `on()` with unknown event name | Typo or wrong name | Use valid LimenEventName |

### 5.2 Exchange Errors

| Code | Trigger | Meaning | Recovery |
|------|---------|---------|----------|
| `EXPORT_INVALID_FORMAT` | Unknown format string | Not json/csv/markdown/sqlite | Use supported format |
| `EXPORT_WRITE_FAILED` | File system error | Permission denied, disk full | Check path/permissions |
| `EXPORT_QUERY_FAILED` | Claim query fails | Database error | Check Limen health |
| `IMPORT_INVALID_FORMAT` | Input is not valid JSON | Corrupted file | Validate input file |
| `IMPORT_INVALID_DOCUMENT` | JSON missing `version`, `claims` | Wrong export format | Re-export from Limen |
| `IMPORT_READ_FAILED` | File read error | File not found, permission denied | Check path/permissions |
| `IMPORT_CLAIM_FAILED` | Individual claim fails validation | Invalid subject/predicate/value | Check claim data |
| `IMPORT_DEDUP_CONFLICT` | Duplicate found, `onConflict='error'` | Policy rejects duplicate | Use skip or update |

---

## OUTPUT 6: SCHEMA DESIGN

### 6.1 No New Migrations

Phase 8 introduces NO new database tables or columns. All data operations use existing schema:

- `claim_assertions` — claim storage (read for export, write for import)
- `claim_relationships` — relationship storage (read for export, write for import)
- `claim_evidence` — evidence storage (read for export)
- `obs_events` — event storage (existing EventBus)
- `obs_event_subscriptions` — webhook subscriptions (existing EventBus)

### 6.2 Plugin State

Plugin state is in-memory only — no persistence. Plugin registry lives in closure inside `createLimen()`. This is correct because:
- Plugins are registered at construction time
- Plugin list is deterministic (from config)
- No need to persist plugin state across restarts

### 6.3 Export Document Schema (JSON)

The `LimenExportDocument` type (Output 2) IS the schema. Version field (`"version": "1.0.0"`) enables forward-compatible evolution.

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### 7.1 Reads From Prior Phases

| Phase | What Phase 8 Reads | How |
|-------|-------------------|-----|
| Phase 1 (Convenience API) | `remember()`, `recall()`, `forget()`, `connect()`, `search()` | Plugin API, LangChain adapter, import/export |
| Phase 2 (FTS5) | `search()` for LangChain semantic retrieval | Via convenience API |
| Phase 3 (Cognitive Metabolism) | `stability`, `effectiveConfidence`, `freshness` | Included in JSON export |
| Phase 4 (Quality & Safety) | `status`, conflict relationships | Exported in relationships |
| Phase 5 (Reasoning) | `reasoning` column | Included in JSON export |
| Phase 7 (MCP) | No direct reads | MCP tools remain independent |
| Kernel | EventBus `subscribe()`/`unsubscribe()` | Plugin system, event hooks |

### 7.2 Writes To Future Phases

| Future Phase | What Phase 8 Provides | How |
|--------------|----------------------|-----|
| Phase 9 (Security) | Plugin system enables PII detection as a plugin | `limen.use(piiPlugin)` |
| Phase 10 (Governance) | Export enables compliance reporting | `limen export --format json` |
| Phase 11 (Vector Search) | Plugin system enables embedding providers | `limen.use(embeddingPlugin)` |
| Phase 12 (Cognitive Engine) | Plugin system enables custom consolidation | Plugin hooks |
| Phase 14 (Launch) | LangChain adapter is a headline integration | Marketing/DX |

### 7.3 Interface Additions to Limen

The `Limen` interface (`src/api/interfaces/api.ts`) gains these methods:

```typescript
// Added to Limen interface:

/**
 * Phase 8 §8.5: Subscribe to Limen events.
 * Consumer-facing event names use colon separators.
 * Returns subscription ID for later unsubscription.
 */
on(event: LimenEventName, handler: LimenEventHandler): string;

/**
 * Phase 8 §8.5: Unsubscribe from events.
 */
off(subscriptionId: string): void;

/**
 * Phase 8 §8.3: Export knowledge to a format.
 * Programmatic API (CLI wraps this).
 */
export(options: ExportOptions): Result<string>;  // Returns serialized content

/**
 * Phase 8 §8.4: Import knowledge from JSON.
 * Programmatic API (CLI wraps this).
 */
import(document: LimenExportDocument, options?: Omit<ImportOptions, 'format' | 'inputPath'>): Result<ImportResult>;
```

**Plugin registration** happens in `createLimen()` config, NOT on the Limen instance:

```typescript
// LimenConfig addition:
export interface LimenConfig {
  // ... existing fields ...

  /**
   * Phase 8 §8.1: Plugins to install during construction.
   * Installed in order before Object.freeze().
   * Destroyed in reverse order during shutdown().
   */
  readonly plugins?: readonly LimenPlugin[];

  /**
   * Phase 8 §8.1: Per-plugin configuration.
   * Keys are plugin names. Values passed to PluginContext.config.
   */
  readonly pluginConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
```

### 7.4 Critical Design Decision: `limen.use()` vs Config

The spec says `limen.use(plugin)`. But the Limen instance is Object.freeze'd (C-07). You cannot call `use()` on a frozen object to mutate its internal state.

**Resolution**: Plugins are declared in `LimenConfig.plugins`, not via `limen.use()`. This is derived from first principles:

1. The Limen instance is frozen (C-07, verified at `src/api/index.ts:1245`)
2. `use()` implies mutation after construction
3. Mutation after freeze is impossible
4. Therefore: plugin registration MUST happen during construction
5. Therefore: plugins go in config

**However**, we also provide `limen.use()` as a convenience that can only be called on an unfrozen pre-construction builder object. This is a BUILDER PATTERN:

```typescript
// Convenience for consumers who prefer imperative style:
const builder = createLimenBuilder(config);
builder.use(myPlugin);
builder.use(anotherPlugin);
const limen = await builder.build();

// Equivalent declarative style (config-based):
const limen = await createLimen({
  ...config,
  plugins: [myPlugin, anotherPlugin],
});
```

**Decision**: BOTH patterns supported. Config-based is primary (shown in docs first). Builder pattern is sugar. The `createLimenBuilder()` function returns a mutable builder; `.build()` calls `createLimen()` internally with the accumulated plugins.

---

## OUTPUT 8: ASSURANCE MAPPING

### 8.1 Classification Matrix

| Element | Class | Rationale |
|---------|-------|-----------|
| Plugin `install()` isolation (no API calls during install) | CONSTITUTIONAL | Calling API before engine ready = undefined behavior |
| Plugin `destroy()` reverse order | QUALITY_GATE | Nice-to-have ordering, not a correctness requirement |
| Plugin name uniqueness | CONSTITUTIONAL | Duplicate names = ambiguous identity |
| Plugin max count (50) | QUALITY_GATE | Resource containment, configurable threshold |
| Event name mapping correctness | CONSTITUTIONAL | Wrong mapping = consumers get wrong events |
| Event handler error isolation | CONSTITUTIONAL | One handler throwing must not kill event dispatch |
| Export JSON roundtrip fidelity | CONSTITUTIONAL | Export -> Import must not lose data |
| Export CSV is documented as lossy | DESIGN_PRINCIPLE | CSV cannot represent relationships/evidence |
| Import dedup correctness | CONSTITUTIONAL | Wrong dedup = data corruption or duplication |
| Import ID remapping for relationships | CONSTITUTIONAL | Broken remapping = orphaned relationships |
| Import dry-run accuracy | QUALITY_GATE | Dry run must match actual import behavior |
| LangChain adapter correctness | QUALITY_GATE | Third-party integration, not core governance |
| LangChain as separate package | CONSTITUTIONAL | Main package dependency invariant (I-01) |
| Zero new production deps on limen-ai | CONSTITUTIONAL | Invariant I-01: single dependency |
| `on()`/`off()` on frozen Limen | CONSTITUTIONAL | Must work on Object.freeze'd instance (closure-captured) |
| Export/Import on frozen Limen | CONSTITUTIONAL | Must work on Object.freeze'd instance (closure-captured) |

### 8.2 Test Strategy by Classification

| Class | Test Mechanism | Required For |
|-------|---------------|--------------|
| CONSTITUTIONAL | [A21] dual-path (success + rejection) | Plugin isolation, event mapping, roundtrip, dedup, dependency invariant |
| QUALITY_GATE | Benchmark + threshold | Plugin count, dry-run accuracy |
| DESIGN_PRINCIPLE | Architectural review | CSV lossiness documentation |

### 8.3 Spec Item Coverage

| Spec Item | Outputs Covering It | Assurance Class |
|-----------|-------------------|-----------------|
| 8.1 Plugin architecture | O1 (decomposition), O2 (types), O3 (state machine), O7 (config integration) | CONSTITUTIONAL |
| 8.2 LangChain adapter | O1 (decomposition), O2 (types), O7 (separate package) | QUALITY_GATE |
| 8.3 Export CLI | O1 (decomposition), O2 (types), O4 (system-call mapping), O5 (errors) | CONSTITUTIONAL (roundtrip) |
| 8.4 Import CLI | O1 (decomposition), O2 (types), O3 (state machine), O5 (errors) | CONSTITUTIONAL (dedup) |
| 8.5 Event hooks | O1 (decomposition), O2 (types), O4 (EventBus mapping) | CONSTITUTIONAL |
| 8.6 Tests | O8 (test strategy by classification) | N/A (meta) |

---

## DESIGN DECISIONS LOG

### DD-01: Plugin Registration at Config Time, Not Runtime

**Decision**: Plugins declared in `LimenConfig.plugins[]`, installed during `createLimen()`, before `deepFreeze()`.
**Alternatives considered**: (a) `limen.use()` post-construction — impossible, frozen. (b) Proxy-based interception — complexity, fragility, violates frozen contract. (c) Plugin registry as separate unfrozen object — breaks single-object API.
**Rejected**: (a) physically impossible, (b) too complex and fragile, (c) ergonomics degradation.
**Risk**: Plugin authors must know plugins are declared at construction. Well-documented.

### DD-02: Consumer Event Names Use Colons

**Decision**: Consumer-facing: `'claim:asserted'`. Internal EventBus: `'claim.asserted'`. Translation layer maps between them.
**Rationale**: Colons are the Node.js convention for event namespacing (EventEmitter pattern). Dots are Limen's internal convention. Consumers should see the familiar pattern. The translation layer is 6 entries in a Map — negligible cost.
**Alternative**: Use dots everywhere. Rejected: consumers would confuse `limen.on('claim.asserted')` with property access syntax.

### DD-03: Import Creates New IDs

**Decision**: Imported claims get NEW IDs. Old IDs are tracked in an `idMap` for relationship rebinding.
**Rationale**: UUIDs from another Limen instance may collide with local IDs (unlikely but possible). More importantly, the claim_assertions table has a PRIMARY KEY on `id` — inserting a duplicate ID would fail. New IDs are safe; the idMap preserves referential integrity for relationships.
**Alternative**: Preserve original IDs. Rejected: collision risk, and it would require checking every ID against the database.

### DD-04: Export/Import on Limen Interface

**Decision**: `limen.export()` and `limen.import()` are methods on the Limen interface, not standalone functions.
**Rationale**: They need database access (via the Limen instance's connection). Making them standalone would require passing the connection, breaking the convenience pattern. The CLI wraps these methods.
**Note**: `import` is a reserved word in JavaScript. The method will be named `importData()` in the implementation to avoid the reserved word conflict. The interface type can still declare it as `import()` since TypeScript allows reserved words as method names in interfaces.

### DD-05: LangChain Uses Peer Dependencies

**Decision**: `packages/limen-langchain/` declares both `limen-ai` and `@langchain/core` as `peerDependencies`.
**Rationale**: (a) Keeps limen-langchain at zero production dependencies. (b) Consumer controls which versions they use. (c) No duplicate instances in node_modules. (d) Follows LangChain ecosystem convention.

### DD-06: SQLite Export = Filtered Copy

**Decision**: SQLite export creates a new SQLite database file with only the selected claims, relationships, and evidence. NOT a full database copy.
**Rationale**: Full copy would include audit trails, RBAC data, event subscriptions, and other governance artifacts that should not be exported. Filtered copy exports only knowledge data.

### DD-07: Event Handler Error Isolation

**Decision**: If a consumer's event handler throws, the error is caught and logged. Other handlers and the emitting operation continue.
**Rationale**: One misbehaving handler must not crash a `remember()` call. The EventBus already dispatches synchronously (RDD-4). Wrapping each handler in try/catch preserves dispatch semantics while adding isolation.

### DD-08: Builder Pattern as Sugar

**Decision**: Provide `createLimenBuilder()` as an imperative alternative to config-based plugin declaration.
**Rationale**: `limen.use(plugin)` is the spec requirement. We satisfy it literally via the builder pattern. Config-based is the primary path (shown first in docs). Builder is sugar for consumers who prefer imperative style.

---

## SELF-AUDIT (Method Quality)

- Did I derive from spec? YES — every output traces to Phase 8 items 8.1-8.6.
- Did I consider failure modes? YES — plugin mutation of frozen objects, handler errors, import dedup, ID collisions.
- Did I mark enforcement decisions? YES — assurance mapping classifies CONSTITUTIONAL vs QUALITY_GATE.
- Would the Breaker find fault? They will challenge: (a) event handler isolation under concurrent emit, (b) import transaction atomicity guarantees, (c) whether the builder pattern introduces state leaks. These are valid attack surfaces for Controls 4A/4B.
- Completeness: NOT MY JUDGMENT (HB#23).

---

## ORACLE GATES

| Gate | Tool | Status | Notes |
|------|------|--------|-------|
| OG-CONSULT | oracle_consult | COMPLETED | CISA KEV advisories returned; no design-specific Class A failures |
| OG-DESIGN | oracle_design | SKIPPED | Not Tier 1 subsystem |
| OG-FMEA | oracle_fmea | SKIPPED | Not Tier 1 subsystem |
| OG-REVIEW | oracle_review | N/A | Design Source, not implementation |
| OG-VERIFY | oracle_verify | N/A | Design Source, not tests |

---

*SolisHQ -- We innovate, invent, then disrupt.*
