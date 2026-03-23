/**
 * Evidence source validator — CCP-01 (Memory Evidence) + Sprint 1 Foundation.
 * Replaces the accept-all stub in createLimen() with real database validation.
 *
 * Phase: Sprint 1 (Foundation Layer)
 * Implements: EvidenceSourceValidator interface from claim_types.ts
 *
 * Evidence types validated:
 *   - 'artifact': Checks core_artifacts table by ID + tenant scope
 *   - 'memory': Checks working_memory_entries table by task_id + key,
 *               with tenant scope validation via core_tasks → core_missions chain.
 *               Requires task context (taskId from ClaimCreateInput).
 *   - 'capability_result': Checks core_capability_results table by ID + tenant scope
 *   - 'claim': Handled inline by claim_stores.ts (self-referential), never reaches this validator
 *
 * Design decision: Memory evidence uses `evidenceId` as the raw WM key and requires
 * `taskId` from ClaimCreateInput for scoping. The taskId is passed via the optional 5th
 * parameter. When taskId is absent, memory evidence is rejected (memory evidence requires
 * task context for scope isolation).
 *
 * Spec ref: CCP v2.0 §7 (Evidence model), WMP v1.0 §5 (Working memory entries)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { Result, TenantId } from '../../kernel/interfaces/index.js';
import type { EvidenceType, EvidenceSourceValidator } from '../interfaces/claim_types.js';

/**
 * Create a real evidence source validator backed by SQLite.
 *
 * Returns an EvidenceSourceValidator that checks evidence references against
 * the actual database tables, enforcing tenant isolation on all lookups.
 *
 * @param getTaskId - Optional function to retrieve the current task context.
 *   When provided, memory evidence validation uses this to scope WM lookups.
 *   When absent, memory evidence is rejected (requires task context).
 */
export function createEvidenceValidator(): EvidenceSourceValidator {
  return {
    exists(
      conn: DatabaseConnection,
      evidenceType: EvidenceType,
      evidenceId: string,
      tenantId: TenantId | null,
      taskId?: string | null,
    ): Result<boolean> {
      switch (evidenceType) {
        case 'artifact': {
          // Check core_artifacts table with tenant isolation
          const row = conn.get<{ id: string }>(
            'SELECT id FROM core_artifacts WHERE id = ? AND (tenant_id IS ? OR (tenant_id IS NULL AND ? IS NULL))',
            [evidenceId, tenantId, tenantId],
          );
          if (!row) {
            return {
              ok: false,
              error: {
                code: 'EVIDENCE_NOT_FOUND',
                message: `Artifact evidence '${evidenceId}' not found`,
                spec: 'CCP-I5',
              },
            };
          }
          return { ok: true, value: true };
        }

        case 'memory': {
          // Memory evidence requires task context for scope isolation
          if (!taskId) {
            return {
              ok: false,
              error: {
                code: 'EVIDENCE_NOT_FOUND',
                message: 'Memory evidence requires task context (taskId)',
                spec: 'CCP-01',
              },
            };
          }

          // Validate: WM entry exists for this task+key, and task belongs to correct tenant
          // Join chain: working_memory_entries → core_tasks → core_missions for tenant check
          const row = conn.get<{ key: string }>(
            `SELECT wme.key FROM working_memory_entries wme
             INNER JOIN core_tasks ct ON ct.id = wme.task_id
             INNER JOIN core_missions cm ON cm.id = ct.mission_id
             WHERE wme.task_id = ? AND wme.key = ?
             AND (cm.tenant_id IS ? OR (cm.tenant_id IS NULL AND ? IS NULL))`,
            [taskId, evidenceId, tenantId, tenantId],
          );
          if (!row) {
            return {
              ok: false,
              error: {
                code: 'EVIDENCE_NOT_FOUND',
                message: `Memory evidence '${evidenceId}' not found for task '${taskId}'`,
                spec: 'CCP-01',
              },
            };
          }
          return { ok: true, value: true };
        }

        case 'capability_result': {
          // Check core_capability_results table with tenant isolation
          const row = conn.get<{ id: string }>(
            'SELECT id FROM core_capability_results WHERE id = ? AND (tenant_id IS ? OR (tenant_id IS NULL AND ? IS NULL))',
            [evidenceId, tenantId, tenantId],
          );
          if (!row) {
            return {
              ok: false,
              error: {
                code: 'EVIDENCE_NOT_FOUND',
                message: `Capability result evidence '${evidenceId}' not found`,
                spec: 'CCP-02',
              },
            };
          }
          return { ok: true, value: true };
        }

        case 'claim': {
          // Claims are validated inline by claim_stores.ts (self-referential lookup).
          // This path should not be reached, but if it is, we return true to avoid
          // double-validation. The claim_stores.ts handles claim evidence directly.
          return { ok: true, value: true };
        }

        default: {
          return {
            ok: false,
            error: {
              code: 'EVIDENCE_NOT_FOUND',
              message: `Unknown evidence type '${String(evidenceType)}'`,
              spec: 'CCP-I5',
            },
          };
        }
      }
    },
  };
}
