/**
 * Phase 8 Plugin System Type Definitions.
 *
 * Spec refs: LIMEN_BUILD_PHASES.md (8.1, 8.5)
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 2)
 *
 * Plugins extend Limen at construction time, before Object.freeze().
 * They cannot mutate the frozen instance. They CAN:
 * - Subscribe to events via context.on()
 * - Register lifecycle hooks (install, destroy)
 * - Access the Limen API for reads/writes (deferred — not during install)
 */

// ── Plugin Identity ──

/** Plugin identity — unique name, semver version. */
export interface PluginMeta {
  /** Unique plugin name (e.g., 'limen-langchain', 'my-custom-plugin'). */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
}

// ── Plugin Context ──

/**
 * Consumer-facing event names.
 * Colon-separated (not dot-separated like internal EventBus).
 * Maps to internal EventBus types via simple translation.
 *
 * I-P8-10: Bidirectional mapping to internal event types.
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
 *
 * I-P8-10: CONSTITUTIONAL — correctness of this mapping is a system invariant.
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

/** All valid consumer event names (excluding wildcard) */
export const VALID_EVENT_NAMES: ReadonlySet<string> = new Set([
  'claim:asserted',
  'claim:retracted',
  'claim:evidence:retracted',
  'claim:relationship:declared',
  'claim:tombstoned',
  'claim:evidence:orphaned',
  '*',
]);

// ── Plugin API ──

/**
 * Subset of Limen API exposed to plugins.
 * Does NOT include shutdown(), session(), agents, missions, roles — those
 * are engine-level concerns, not plugin concerns.
 *
 * I-P8-03: Methods throw PLUGIN_API_NOT_READY during install().
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
 * The context provided to a plugin during installation.
 * This is the plugin's view of the Limen engine — scoped and safe.
 *
 * CRITICAL: PluginContext does NOT expose .raw or database internals.
 * Plugins interact through the public API only.
 */
export interface PluginContext {
  /**
   * Subscribe to Limen events.
   * Returns a subscription ID for later unsubscription.
   */
  on(event: LimenEventName, handler: LimenEventHandler): string;

  /**
   * Unsubscribe from events by subscription ID.
   */
  off(subscriptionId: string): void;

  /**
   * Access to the Limen convenience API for reads/writes.
   *
   * NOTE: This is a deferred reference — the actual Limen instance is not
   * available until all plugins are installed and the engine is constructed.
   * Plugins MUST NOT call api methods during install(). They should
   * store the reference and use it in event handlers or deferred callbacks.
   */
  readonly api: PluginApi;

  /**
   * Plugin-scoped configuration (from LimenConfig.pluginConfig[name]).
   * Type-erased — plugins cast to their own config type.
   */
  readonly config: Readonly<Record<string, unknown>>;

  /**
   * Logger scoped to the plugin name.
   */
  readonly log: PluginLogger;
}

// ── Plugin Interface ──

/**
 * The Plugin interface — what plugin authors implement.
 *
 * Lifecycle (I-P8-01):
 * 1. createLimen() iterates config.plugins[]
 * 2. For each: calls plugin.install(context)
 * 3. All plugins installed -> engine frozen -> returned to consumer
 * 4. On shutdown: calls plugin.destroy() in reverse install order (I-P8-04)
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
   * Called during shutdown(), in reverse install order (I-P8-04).
   * Clean up resources, flush buffers, unsubscribe events.
   * Optional — plugins without cleanup can omit this.
   */
  destroy?(): void | Promise<void>;
}

// ── Plugin Registry Types ──

/** Plugin lifecycle state (I-P8-01, DS O3) */
export type PluginState = 'registered' | 'installing' | 'installed' | 'destroying' | 'destroyed' | 'failed';

/** Internal: tracks installed plugins */
export interface InstalledPlugin {
  readonly plugin: LimenPlugin;
  readonly subscriptionIds: string[];
  readonly installedAt: string; // ISO 8601
  state: PluginState;
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

/** Maximum plugins per Limen instance (resource containment, I-P8-05) */
export const MAX_PLUGINS = 50;
