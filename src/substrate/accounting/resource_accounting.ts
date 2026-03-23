/**
 * Resource Accounting implementation.
 * S ref: §25.6 (Resource Accounting), §11 (Resource Model), FM-02 (Cost Explosion)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: Per-task token/time/compute/artifact tracking via meter_interaction_accounting.
 *             Budget enforcement with max(engine, provider) effective token counting per §11.
 *
 * Invariants enforced: I-03 (audit in same transaction), I-05 (transactional)
 * Failure modes defended: FM-02 (cost explosion), FM-11 (observability overhead < 2%)
 *
 * SYNC interface. All methods return Result<T>.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  Result,
  MissionId,
  TenantId,
  OperationContext,
  AuditCreateInput,
} from '../../kernel/interfaces/index.js';

/**
 * Minimal audit dependency. Uses only the append method to keep coupling lightweight.
 * S ref: I-03 (every state mutation and its audit entry in same transaction)
 */
interface AuditDep {
  append(conn: DatabaseConnection, input: AuditCreateInput): Result<unknown>;
}
import type {
  ResourceAccounting,
  AccountingRecord,
  BudgetCheckResult,
  MissionConsumption,
  TenantConsumption,
} from '../interfaces/substrate.js';

// ─── Error Constructors ───

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Resource Accounting Factory ───

/**
 * §25.6 default budget limit (tokens). Configurable per mission via orchestration.
 * This is the fallback if no mission-specific budget is set.
 */
export const DEFAULT_BUDGET_LIMIT = 1_000_000;

/**
 * Create a ResourceAccounting implementation.
 * S ref: §25.6, C-07 (Object.freeze)
 *
 * Token counting follows §11: effective = max(engine_counted, provider_reported).
 * Budget enforcement prevents cost explosion (FM-02).
 */
export function createResourceAccounting(audit?: AuditDep): ResourceAccounting {

  /** §25.6: Record a task interaction's resource consumption */
  function record(conn: DatabaseConnection, _ctx: OperationContext, rec: AccountingRecord): Result<void> {
    // §11: effective = max(engine, provider)
    const providerIn = rec.providerInputTokens ?? 0;
    const providerOut = rec.providerOutputTokens ?? 0;
    const effectiveIn = Math.max(rec.inputTokens, providerIn);
    const effectiveOut = Math.max(rec.outputTokens, providerOut);

    const id = randomUUID();

    // I-03: mutation + audit in same transaction
    conn.transaction(() => {
      conn.run(
        `INSERT INTO meter_interaction_accounting
          (id, task_id, mission_id, tenant_id, agent_id, model_id,
           interaction_type, input_tokens, output_tokens,
           provider_input_tokens, provider_output_tokens,
           effective_input_tokens, effective_output_tokens,
           wall_clock_ms, artifacts_bytes, capabilities_used, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        [
          id,
          rec.taskId,
          rec.missionId,
          rec.tenantId,
          rec.agentId,
          rec.modelId,
          rec.interactionType,
          rec.inputTokens,
          rec.outputTokens,
          rec.providerInputTokens ?? null,
          rec.providerOutputTokens ?? null,
          effectiveIn,
          effectiveOut,
          rec.wallClockMs,
          rec.artifactsBytes,
          JSON.stringify(rec.capabilitiesUsed),
        ]
      );

      audit?.append(conn, {
        tenantId: rec.tenantId,
        actorType: 'system',
        actorId: 'substrate.accounting',
        operation: 'accounting.record',
        resourceType: 'accounting',
        resourceId: id,
        detail: {
          taskId: rec.taskId,
          missionId: rec.missionId,
          interactionType: rec.interactionType,
          effectiveInputTokens: effectiveIn,
          effectiveOutputTokens: effectiveOut,
        },
      });
    });

    return ok(undefined);
  }

  /** §11, FM-02: Check if estimated tokens would exceed mission budget */
  function checkBudget(conn: DatabaseConnection, missionId: MissionId, estimatedTokens: number): Result<BudgetCheckResult> {
    // Sum effective tokens for this mission
    const row = conn.get<{ total_effective: number }>(
      `SELECT COALESCE(SUM(effective_input_tokens + effective_output_tokens), 0) as total_effective
       FROM meter_interaction_accounting
       WHERE mission_id = ?`,
      [missionId]
    );

    const consumed = row?.total_effective ?? 0;
    const budgetLimit = DEFAULT_BUDGET_LIMIT;
    const remaining = budgetLimit - consumed;

    if (estimatedTokens > remaining) {
      return ok({
        allowed: false,
        remainingTokens: remaining,
        consumedTokens: consumed,
        budgetLimit,
        reason: `Estimated ${estimatedTokens} tokens exceeds remaining budget of ${remaining}`,
      });
    }

    return ok({
      allowed: true,
      remainingTokens: remaining,
      consumedTokens: consumed,
      budgetLimit,
    });
  }

  /** §25.6: Get total consumption for a mission */
  function getMissionConsumption(conn: DatabaseConnection, missionId: MissionId): Result<MissionConsumption> {
    const row = conn.get<{
      total_effective_in: number;
      total_effective_out: number;
      total_wall_clock: number;
      total_artifacts_bytes: number;
      interaction_count: number;
    }>(
      `SELECT
        COALESCE(SUM(effective_input_tokens), 0) as total_effective_in,
        COALESCE(SUM(effective_output_tokens), 0) as total_effective_out,
        COALESCE(SUM(wall_clock_ms), 0) as total_wall_clock,
        COALESCE(SUM(artifacts_bytes), 0) as total_artifacts_bytes,
        COUNT(*) as interaction_count
       FROM meter_interaction_accounting
       WHERE mission_id = ?`,
      [missionId]
    );

    if (!row) {
      return ok({
        missionId,
        totalEffectiveInputTokens: 0,
        totalEffectiveOutputTokens: 0,
        totalWallClockMs: 0,
        totalArtifactsBytes: 0,
        interactionCount: 0,
      });
    }

    return ok({
      missionId,
      totalEffectiveInputTokens: row.total_effective_in,
      totalEffectiveOutputTokens: row.total_effective_out,
      totalWallClockMs: row.total_wall_clock,
      totalArtifactsBytes: row.total_artifacts_bytes,
      interactionCount: row.interaction_count,
    });
  }

  /** §25.6: Get total consumption for a tenant */
  function getTenantConsumption(conn: DatabaseConnection, tenantId: TenantId): Result<TenantConsumption> {
    const row = conn.get<{
      total_effective_in: number;
      total_effective_out: number;
      total_interactions: number;
    }>(
      `SELECT
        COALESCE(SUM(effective_input_tokens), 0) as total_effective_in,
        COALESCE(SUM(effective_output_tokens), 0) as total_effective_out,
        COUNT(*) as total_interactions
       FROM meter_interaction_accounting
       WHERE tenant_id = ?`,
      [tenantId]
    );

    if (!row) {
      return ok({
        tenantId,
        totalEffectiveInputTokens: 0,
        totalEffectiveOutputTokens: 0,
        totalInteractions: 0,
      });
    }

    return ok({
      tenantId,
      totalEffectiveInputTokens: row.total_effective_in,
      totalEffectiveOutputTokens: row.total_effective_out,
      totalInteractions: row.total_interactions,
    });
  }

  const accounting: ResourceAccounting = {
    record,
    checkBudget,
    getMissionConsumption,
    getTenantConsumption,
  };

  // Expose deliberation recording as a separate function on the module
  // (not on the frozen interface — this is an internal substrate path)
  return Object.freeze(accounting);
}

/**
 * Phase 5A: Supplementary deliberation recording for resource accounting.
 * Called by the LLM gateway after a successful transport execution.
 * This is a standalone function (not on the frozen ResourceAccounting interface)
 * because deliberation data comes from the transport layer, not from the
 * AccountingRecord input.
 *
 * S ref: §25.6, I-03 (same transaction as accounting record)
 */
export function recordAccountingDeliberation(
  conn: DatabaseConnection,
  accountingId: string,
  deliberation: {
    deliberationTokens: number;
    accountingMode: 'provider_authoritative' | 'estimated';
    providerReportedThinkingTokens: number | null;
  },
): void {
  const effectiveDeliberationTokens = Math.max(
    deliberation.deliberationTokens,
    deliberation.providerReportedThinkingTokens ?? 0,
  );

  conn.run(
    `UPDATE meter_interaction_accounting
     SET deliberation_tokens = ?,
         deliberation_accounting_mode = ?,
         provider_deliberation_tokens = ?,
         effective_deliberation_tokens = ?,
         estimator_id = ?,
         estimator_version = ?
     WHERE id = ?`,
    [
      deliberation.deliberationTokens,
      deliberation.accountingMode,
      deliberation.providerReportedThinkingTokens,
      effectiveDeliberationTokens,
      null,
      null,
      accountingId,
    ],
  );
}
