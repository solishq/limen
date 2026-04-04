/**
 * InstanceContext — per-instance mutable state container.
 *
 * Phase: v2.1.0 remediation (C-06 independent instances)
 *
 * Problem: 7 module-level mutable variables were shared across all Limen
 * instances in the same process, violating C-06. This caused cross-task
 * data leakage, schema cache poisoning, and cross-instance interference.
 *
 * Solution: InstanceContext holds all per-instance mutable state. Every
 * factory function receives it. Module-level mutation becomes impossible.
 *
 * Variables eliminated:
 *   1. _lastTimestamp (wmp_stores.ts) -> monotonicClock.lastTimestamp
 *   2. _connRef (wmp_stores.ts) -> wmpConnectionRef.current
 *   3. _hasPiiDetectedCol (claim_stores.ts) -> schemaCache.hasPiiDetectedCol
 *   4. _hasClassificationCol (claim_stores.ts) -> schemaCache.hasClassificationCol
 *   5. rateLimitCounters (claim_stores.ts) -> rateLimitCounters
 *   6. activeCascadeClaims (self_healing.ts) -> activeCascadeClaims
 *
 * Note: _govTime (governance_stores.ts) is NOT in InstanceContext. It is
 * eliminated by threading TimeProvider directly through factory functions.
 */

import type { DatabaseConnection } from './database.js';

/**
 * Cached schema detection results for claim_assertions columns.
 * Populated lazily via PRAGMA table_info on first access.
 * Per-instance: prevents cache poisoning across databases with different schemas.
 */
export interface SchemaDetectionCache {
  hasPiiDetectedCol: boolean | null;
  hasClassificationCol: boolean | null;
}

/**
 * Rate limit entry for per-agent sliding window enforcement.
 */
export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Per-instance mutable state container.
 *
 * All fields are readonly references to mutable containers. The container
 * identity is stable (cannot be reassigned), but the contents are mutable
 * (that is the point -- they hold runtime state).
 *
 * C-06: Each createLimen() call creates its own InstanceContext. No sharing.
 */
export interface InstanceContext {
  /** Schema detection cache for claim_assertions columns. */
  readonly schemaCache: SchemaDetectionCache;
  /** Per-agent rate limit counters (60s sliding window). */
  readonly rateLimitCounters: Map<string, RateLimitEntry>;
  /** Re-entry guard for self-healing cascades. */
  readonly activeCascadeClaims: Set<string>;
  /** Monotonic clock state for WMP timestamp ordering. */
  readonly monotonicClock: { lastTimestamp: string };
  /** Connection reference bridging WMP handlers to CGP internal reader (Pattern P-004). */
  readonly wmpConnectionRef: { current: DatabaseConnection | null };
}

/**
 * Create a fresh InstanceContext with zeroed state.
 * Called once per createLimen() invocation.
 */
export function createInstanceContext(): InstanceContext {
  return {
    schemaCache: { hasPiiDetectedCol: null, hasClassificationCol: null },
    rateLimitCounters: new Map(),
    activeCascadeClaims: new Set(),
    monotonicClock: { lastTimestamp: '' },
    wmpConnectionRef: { current: null },
  };
}
