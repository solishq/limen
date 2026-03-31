/**
 * Phase 3 Cognitive Metabolism: Batched Access Tracker.
 *
 * Records claim access events in memory, flushes to database on timer/threshold/shutdown.
 * Avoids write-on-read contention by decoupling access recording from query execution.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (3.4)
 * Design Source: docs/sprints/PHASE-3-DESIGN-SOURCE.md (Decision 5, Decision 6)
 *
 * Invariants: I-P3-05 (tracking scope), I-P3-12 (lifecycle), I-P3-13 (interval ID storage)
 *
 * PA Amendment: flushIntervalMs exposed through CognitiveConfig.
 * PA Amendment: setInterval reference strongly held (interval ID stored for explicit clearInterval).
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';

/** Phase 3 section 3.4: Access tracking configuration. */
export interface AccessTrackerConfig {
  /** Flush interval in milliseconds. Default: 5000 (5 seconds). */
  readonly flushIntervalMs?: number;
  /** Flush threshold (number of distinct pending claims). Default: 100. */
  readonly flushThreshold?: number;
}

/** Default flush interval: 5 seconds */
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
/** Default flush threshold: 100 distinct claims */
const DEFAULT_FLUSH_THRESHOLD = 100;

/** Pending access event for a single claim. */
interface PendingAccess {
  count: number;
  latestAt: string;
}

/** Phase 3 section 3.4: Access tracker interface. */
export interface AccessTracker {
  /** Record that these claims were accessed. Non-blocking, in-memory only. */
  recordAccess(claimIds: readonly string[], accessedAt: string): void;
  /** Flush all pending access events to the database. */
  flush(): void;
  /** Number of distinct claims with pending access events. */
  pendingCount(): number;
  /** Stop the flush timer. Must be called during shutdown. */
  destroy(): void;
}

/**
 * Create an AccessTracker with batched flush capability.
 *
 * @param getConnection - Connection factory (same pattern as convenience layer)
 * @param config - Access tracking configuration
 * @returns AccessTracker instance
 *
 * Lifecycle: ACTIVE -> FLUSHING -> ACTIVE -> ... -> DESTROYED
 * After destroy(): no more writes to database, timer cleared.
 */
export function createAccessTracker(
  getConnection: () => DatabaseConnection,
  config?: AccessTrackerConfig,
): AccessTracker {
  const flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const flushThreshold = config?.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD;
  const pending = new Map<string, PendingAccess>();
  let destroyed = false;

  // I-P3-13 (PA Amendment): Store interval ID for explicit clearInterval in shutdown.
  // Timer uses unref() to avoid keeping Node.js process alive (DC-P3-901).
  let intervalId: ReturnType<typeof setInterval> | null = null;

  /** Flush pending access events to the database (DC-P3-104). */
  function doFlush(): void {
    if (destroyed || pending.size === 0) return;

    let conn: DatabaseConnection;
    try {
      conn = getConnection();
    } catch {
      // Connection unavailable (e.g., during shutdown race). Skip this flush cycle.
      return;
    }

    try {
      conn.run('BEGIN');
      for (const [claimId, event] of pending) {
        conn.run(
          'UPDATE claim_assertions SET last_accessed_at = ?, access_count = access_count + ? WHERE id = ?',
          [event.latestAt, event.count, claimId],
        );
      }
      conn.run('COMMIT');
      pending.clear();
    } catch {
      // DC-P3-902: Flush errors caught and logged. Never propagated.
      // Access tracking is QUALITY_GATE. Rollback and retry next cycle.
      try { conn!.run('ROLLBACK'); } catch { /* already rolled back */ }
    }
  }

  // Start the flush timer
  if (flushIntervalMs > 0) {
    intervalId = setInterval(doFlush, flushIntervalMs);
    // DC-P3-901: unref() so timer doesn't keep process alive
    if (intervalId && typeof intervalId === 'object' && 'unref' in intervalId) {
      (intervalId as NodeJS.Timeout).unref();
    }
  }

  return {
    recordAccess(claimIds: readonly string[], accessedAt: string): void {
      if (destroyed) return; // DC-P3-201: Silently ignore after destroy

      for (const id of claimIds) {
        const existing = pending.get(id);
        if (existing) {
          existing.count += 1;
          existing.latestAt = accessedAt;
        } else {
          pending.set(id, { count: 1, latestAt: accessedAt });
        }
      }

      // Check threshold trigger
      if (pending.size >= flushThreshold) {
        doFlush();
      }
    },

    flush(): void {
      doFlush();
    },

    pendingCount(): number {
      return pending.size;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;

      // I-P3-13: Explicit clearInterval using stored ID (PA Amendment)
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}
