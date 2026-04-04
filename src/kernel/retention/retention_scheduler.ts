/**
 * Data retention scheduler implementation.
 * S ref: §35, I-06, I-02
 *
 * Phase: 1 (Kernel) -- Build Order 7
 * Depends on database + audit + crypto.
 *
 * §35: Configurable per-type retention with automated archival/deletion.
 * I-06: Audit entries archived to sealed file, never deleted.
 * I-02: User data ownership -- retention supports purge operations.
 *
 * Default retention values (§35):
 * - memories: 365 days (archive)
 * - audit: 2555 days / 7 years (archive to sealed file per I-06)
 * - sessions: 90 days (archive)
 * - artifacts: mission-scoped + retention period (archive)
 * - techniques: indefinite (soft_delete per I-10)
 * - events: 90 days (delete)
 */

import { randomUUID } from 'node:crypto';
import type {
  Result, TenantId, OperationContext,
  RetentionScheduler, RetentionPolicy, RetentionRunResult,
  AuditTrail, DatabaseConnection,
} from '../interfaces/index.js';
import type { TimeProvider } from '../interfaces/time.js';

/**
 * Default retention policies per §35.
 * S ref: §35 (default retention values)
 */
const DEFAULT_POLICIES: ReadonlyArray<{
  dataType: string;
  retentionDays: number;
  action: 'archive' | 'delete' | 'soft_delete';
}> = [
  { dataType: 'memories', retentionDays: 365, action: 'archive' },
  { dataType: 'audit', retentionDays: 2555, action: 'archive' },      // 7 years per I-06
  { dataType: 'sessions', retentionDays: 90, action: 'archive' },
  { dataType: 'artifacts', retentionDays: 365, action: 'archive' },
  { dataType: 'techniques', retentionDays: 0, action: 'soft_delete' }, // 0 = indefinite (I-10)
  { dataType: 'events', retentionDays: 90, action: 'delete' },
];

/**
 * Create a RetentionScheduler implementation.
 * S ref: §35 (retention policies), I-06 (audit archival), I-02 (data ownership)
 */
/**
 * CF-018: Create a RetentionScheduler with optional audit trail for tombstoning.
 * When auditTrail is provided, the 'audit' data type uses tombstone() instead of delete.
 */
export function createRetentionScheduler(auditTrail?: AuditTrail, time?: TimeProvider): RetentionScheduler {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  return {
    /**
     * Execute retention pass: archive/delete records past retention period.
     * S ref: §35 (automated retention execution)
     */
    executeRetention(conn: DatabaseConnection, _ctx: OperationContext): Result<RetentionRunResult> {
      const runId = randomUUID();
      try {
        // Phase 3 fix: Wrap entire retention execution in transaction so partial
        // deletions are rolled back on failure. Also update run status to 'failed'
        // in catch block (previously stayed 'running' forever on error).
        const result = conn.transaction(() => {
          let recordsArchived = 0;
          let recordsDeleted = 0;
          const policiesApplied: string[] = [];

          // Get active policies
          const policies = conn.query<{
            id: string; data_type: string; retention_days: number;
            action: string; enabled: number;
          }>(
            `SELECT id, data_type, retention_days, action, enabled
             FROM core_retention_policies WHERE enabled = 1`
          );

          // Record the run start
          conn.run(
            `INSERT INTO core_retention_runs (id, started_at, policies_applied, status)
             VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'running')`,
            [runId, JSON.stringify(policies.map(p => p.id))]
          );

          for (const policy of policies) {
            if (policy.retention_days === 0) continue; // 0 = indefinite

            const cutoffMs = clock.nowMs() - (policy.retention_days * 24 * 60 * 60 * 1000);
            const cutoff = new Date(cutoffMs).toISOString();

            // CF-018: Execute retention per data type
            switch (policy.data_type) {
              case 'events': {
                if (policy.action === 'delete') {
                  const result = conn.run(
                    `DELETE FROM obs_events WHERE created_at < ? AND delivered = 1`,
                    [cutoff]
                  );
                  recordsDeleted += result.changes;
                }
                break;
              }

              case 'sessions': {
                // Delete conversation turns for old conversations, then conversations, then sessions
                const oldConvs = conn.query<{ id: string }>(
                  `SELECT id FROM core_conversations WHERE created_at < ?`, [cutoff]
                );
                for (const conv of oldConvs) {
                  recordsDeleted += conn.run(
                    `DELETE FROM core_conversation_turns WHERE conversation_id = ?`, [conv.id]
                  ).changes;
                }
                recordsDeleted += conn.run(
                  `DELETE FROM core_conversations WHERE created_at < ?`, [cutoff]
                ).changes;
                break;
              }

              case 'artifacts': {
                // Delete artifact dependencies first, then artifacts
                const oldArtifacts = conn.query<{ id: string }>(
                  `SELECT id FROM core_artifacts WHERE created_at < ?`, [cutoff]
                );
                for (const art of oldArtifacts) {
                  recordsDeleted += conn.run(
                    `DELETE FROM core_artifact_dependencies WHERE artifact_id = ?`, [art.id]
                  ).changes;
                }
                recordsDeleted += conn.run(
                  `DELETE FROM core_artifacts WHERE created_at < ?`, [cutoff]
                ).changes;
                break;
              }

              case 'audit': {
                // I-06: Audit entries are NEVER deleted. Use tombstone (CF-035) or archive.
                if (auditTrail && policy.action === 'archive') {
                  // Tombstone audit entries per tenant for entries older than cutoff
                  // Find distinct tenants with old entries
                  const tenants = conn.query<{ tenant_id: string }>(
                    `SELECT DISTINCT tenant_id FROM core_audit_log WHERE timestamp < ? AND tenant_id IS NOT NULL`,
                    [cutoff]
                  );
                  for (const t of tenants) {
                    const tombResult = auditTrail.tombstone(conn, t.tenant_id as TenantId);
                    if (tombResult.ok) {
                      recordsArchived += tombResult.value.tombstonedEntries;
                    }
                  }
                }
                break;
              }

              case 'interactions': {
                // PRR-PE-016: Retain chat interaction records for technique extraction,
                // then delete after retention period to prevent unbounded table growth.
                if (policy.action === 'delete') {
                  const result = conn.run(
                    `DELETE FROM core_interactions WHERE created_at < ?`,
                    [cutoff]
                  );
                  recordsDeleted += result.changes;
                }
                break;
              }

              case 'memories':
              case 'techniques': {
                // CF-002 dependency: core_memories and core_techniques tables don't exist yet.
                // These will be handled when the learning system (SS29) is implemented.
                break;
              }
            }

            policiesApplied.push(policy.id);
          }

          // Update run status
          conn.run(
            `UPDATE core_retention_runs SET
             completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             policies_applied = ?, records_archived = ?, records_deleted = ?,
             status = 'completed'
             WHERE id = ?`,
            [JSON.stringify(policiesApplied), recordsArchived, recordsDeleted, runId]
          );

          return {
            runId,
            recordsArchived,
            recordsDeleted,
            policiesApplied,
          };
        });

        return { ok: true, value: result };
      } catch (err) {
        // Phase 3 fix: Update run status to 'failed' on error.
        // Previously the run stayed 'running' forever after a failure.
        try {
          conn.run(
            `UPDATE core_retention_runs SET
             completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             status = 'failed'
             WHERE id = ?`,
            [runId]
          );
        } catch { /* best-effort status update — don't mask original error */ }

        return {
          ok: false,
          error: {
            code: 'RETENTION_EXECUTE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§35',
          },
        };
      }
    },

    /**
     * Get current retention policies.
     * S ref: §35 (policy inspection)
     */
    getPolicies(conn: DatabaseConnection, _ctx: OperationContext): Result<RetentionPolicy[]> {
      try {
        const rows = conn.query<{
          id: string; data_type: string; retention_days: number;
          action: string; enabled: number;
        }>(
          `SELECT id, data_type, retention_days, action, enabled
           FROM core_retention_policies ORDER BY data_type`
        );

        const policies: RetentionPolicy[] = rows.map(row => ({
          id: row.id,
          dataType: row.data_type,
          retentionDays: row.retention_days,
          action: row.action as 'archive' | 'delete' | 'soft_delete',
          enabled: row.enabled === 1,
        }));

        return { ok: true, value: policies };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'RETENTION_GET_POLICIES_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§35',
          },
        };
      }
    },

    /**
     * Update retention policy for a data type.
     * S ref: §35 (configurable retention periods)
     */
    updatePolicy(conn: DatabaseConnection, _ctx: OperationContext, dataType: string, retentionDays: number, action: 'archive' | 'delete' | 'soft_delete'): Result<void> {
      try {
        // I-06: Audit entries must always use 'archive' action, never 'delete'
        if (dataType === 'audit' && action === 'delete') {
          return {
            ok: false,
            error: {
              code: 'AUDIT_RETENTION_VIOLATION',
              message: 'Audit entries must be archived, not deleted (I-06)',
              spec: 'I-06',
            },
          };
        }

        const result = conn.run(
          `UPDATE core_retention_policies SET
           retention_days = ?, action = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE data_type = ?`,
          [retentionDays, action, dataType]
        );

        if (result.changes === 0) {
          return {
            ok: false,
            error: {
              code: 'RETENTION_POLICY_NOT_FOUND',
              message: `No retention policy found for data type "${dataType}"`,
              spec: '§35',
            },
          };
        }

        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'RETENTION_UPDATE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§35',
          },
        };
      }
    },
  };
}

export { DEFAULT_POLICIES };
