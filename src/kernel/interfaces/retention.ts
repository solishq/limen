/**
 * Retention scheduler interface types.
 * S ref: §35, I-06, I-02
 *
 * Phase: 1 (Kernel)
 * Implements: Data retention policies with archive/delete/soft-delete actions.
 *
 * §35: Configurable per-type retention with automated archival.
 * I-06: Audit retention = archival to sealed file, never deletion.
 * I-02: User data ownership -- retention supports purge operations.
 */

import type { Result, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── Retention Policy ───

/**
 * A retention policy defining how long data is kept and what happens when it expires.
 * S ref: §35 (configurable per-type retention)
 */
export interface RetentionPolicy {
  readonly id: string;
  readonly dataType: string;
  readonly retentionDays: number;
  readonly action: 'archive' | 'delete' | 'soft_delete';
  readonly enabled: boolean;
}

/**
 * Result of executing a retention pass.
 * S ref: §35 (automated archival execution)
 */
export interface RetentionRunResult {
  readonly runId: string;
  readonly recordsArchived: number;
  readonly recordsDeleted: number;
  readonly policiesApplied: string[];
}

// ─── Retention Scheduler Interface ───

/**
 * Data retention scheduler.
 * S ref: §35 (retention policies), I-06 (audit archival, not deletion),
 *        I-02 (user data ownership)
 */
export interface RetentionScheduler {
  /**
   * Execute retention pass: archive/delete records past retention period.
   * Audit entries are ALWAYS archived, never deleted (I-06).
   * S ref: §35 (automated retention execution)
   */
  executeRetention(conn: DatabaseConnection, ctx: OperationContext): Result<RetentionRunResult>;

  /**
   * Get current retention policies.
   * S ref: §35 (policy inspection)
   */
  getPolicies(conn: DatabaseConnection, ctx: OperationContext): Result<RetentionPolicy[]>;

  /**
   * Update retention policy for a data type.
   * S ref: §35 (configurable retention periods)
   */
  updatePolicy(conn: DatabaseConnection, ctx: OperationContext, dataType: string, retentionDays: number, action: 'archive' | 'delete' | 'soft_delete'): Result<void>;
}
