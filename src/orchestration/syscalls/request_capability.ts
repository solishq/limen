/**
 * SC-7: request_capability -- Executes a capability in sandbox.
 * S ref: S21, I-12 (sandboxing), I-22 (capability immutability)
 *
 * Phase: 3 (Orchestration)
 * Validates capability is in mission set, budget available,
 * then delegates to substrate capability adapter.
 */

import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, RequestCapabilityInput, RequestCapabilityOutput,
  BudgetGovernor,
} from '../interfaces/orchestration.js';
import type { CapabilityType } from '../../substrate/interfaces/substrate.js';

/** SC-7: request_capability system call */
export function requestCapability(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: RequestCapabilityInput,
  budget: BudgetGovernor,
): Result<RequestCapabilityOutput> {
  // CQ-11: S21 RATE_LIMITED -- capability rate limiting is enforced at the substrate
  // adapter level via budget consumption. The RATE_LIMITED error from substrate
  // would surface through the error mapping below. No separate application-level
  // rate limiter is needed because budget consumption provides natural throttling.

  // I-22: Verify capability is in mission's capability set
  const mission = deps.conn.get<{ capabilities: string }>(
    'SELECT capabilities FROM core_missions WHERE id = ?',
    [input.missionId],
  );
  if (!mission) {
    return { ok: false, error: { code: 'CAPABILITY_DENIED', message: `Mission ${input.missionId} not found`, spec: 'S21' } };
  }
  const missionCaps = new Set(JSON.parse(mission.capabilities) as string[]);
  if (!missionCaps.has(input.capabilityType)) {
    return { ok: false, error: { code: 'CAPABILITY_DENIED', message: `Capability '${input.capabilityType}' not in mission set`, spec: 'S21' } };
  }

  // Budget check: estimate some cost for capability execution
  const estimatedCost = 100; // baseline per-capability cost
  const budgetCheck = budget.checkBudget(deps, input.missionId, estimatedCost);
  if (!budgetCheck.ok) return { ok: false, error: budgetCheck.error };
  if (!budgetCheck.value) {
    return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Insufficient budget for capability execution', spec: 'S21' } };
  }

  // Execute via substrate capability adapter
  const capResult = deps.substrate.adapters.execute(deps.conn, ctx, {
    type: input.capabilityType as CapabilityType,
    params: input.parameters,
    missionId: input.missionId,
    taskId: input.taskId,
    // CF-020: Workspace under dataDir, scoped per mission/task (I-07, I-12)
    workspaceDir: join(deps.conn.dataDir, 'workspaces', String(input.missionId), String(input.taskId ?? 'default')),
    timeoutMs: 30000,
  });

  if (!capResult.ok) {
    // Map substrate errors to SC-7 errors
    if (capResult.error.code === 'SANDBOX_VIOLATION' || capResult.error.code === 'CAPABILITY_NOT_FOUND') {
      return { ok: false, error: { code: 'SANDBOX_VIOLATION', message: capResult.error.message, spec: 'S21' } };
    }
    return { ok: false, error: { code: 'TIMEOUT', message: capResult.error.message, spec: 'S21' } };
  }

  // F-001 fix: NaN/Infinity guard on resourcesConsumed (DC-SC7-106)
  const consumed = capResult.value.resourcesConsumed;
  if (!Number.isFinite(consumed.tokensUsed) || !Number.isFinite(consumed.wallClockMs) || !Number.isFinite(consumed.bytesWritten)) {
    return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Substrate returned non-finite resource consumption values', spec: 'S21' } };
  }
  if (consumed.tokensUsed < 0 || consumed.wallClockMs < 0 || consumed.bytesWritten < 0) {
    return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Substrate returned negative resource consumption values', spec: 'S21' } };
  }

  // F-014 fix: Check consume() return value (DC-SC7-203/DC-SC7-B02)
  const consumeResult = budget.consume(deps, input.missionId, {
    tokens: consumed.tokensUsed,
    compute: Math.floor(consumed.wallClockMs / 1000),
    storage: consumed.bytesWritten,
  });
  if (!consumeResult.ok) {
    return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: consumeResult.error.message, spec: 'S21' } };
  }

  // Sprint 1, CCP-02: Persist capability result for evidence chain.
  // Only persist on successful execution. INSERT into core_capability_results.
  // Failure to persist is non-fatal — the result is still returned to the caller.
  // The persisted result can be referenced as evidence in claim assertions.
  try {
    const resultId = crypto.randomUUID();
    const resultJson = JSON.stringify(capResult.value.result);
    const parametersHash = createHash('sha256')
      .update(JSON.stringify(input.parameters))
      .digest('hex');
    const now = deps.time?.nowISO?.() ?? new Date().toISOString();

    // Resolve tenant_id from mission for tenant isolation
    const missionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [input.missionId],
    );

    deps.conn.run(
      `INSERT INTO core_capability_results (id, tenant_id, mission_id, task_id, capability_type, parameters_hash, result_json, result_size, tokens_consumed, time_consumed_ms, compute_consumed, storage_consumed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resultId,
        missionRow?.tenant_id ?? null,
        input.missionId,
        input.taskId ?? null,
        input.capabilityType,
        parametersHash,
        resultJson,
        Buffer.byteLength(resultJson, 'utf-8'),
        consumed.tokensUsed,
        consumed.wallClockMs,
        Math.floor(consumed.wallClockMs / 1000),
        consumed.bytesWritten,
        now,
      ],
    );
  } catch (persistErr) {
    // CCP-02: Persistence failure is non-fatal (F-S1-003). The capability executed
    // successfully and budget was consumed. The result is returned regardless.
    // Evidence for this result will be unavailable in the claim system.
    // However, the failure MUST be observable via audit trail.
    try {
      deps.audit.append(deps.conn, {
        tenantId: ctx.tenantId,
        actorType: ctx.agentId ? 'agent' : 'system',
        actorId: ctx.agentId ?? 'system',
        operation: 'capability_result_persistence_failed',
        resourceType: 'capability_result',
        resourceId: input.missionId,
        detail: {
          capabilityType: input.capabilityType,
          taskId: input.taskId ?? null,
          error: persistErr instanceof Error ? persistErr.message : String(persistErr),
        },
      });
    } catch {
      // Audit append itself failed — nothing more we can do without
      // introducing a circular failure. The capability result is still returned.
    }
  }

  return {
    ok: true,
    value: {
      result: capResult.value.result,
      resourcesConsumed: {
        tokens: consumed.tokensUsed,
        time: consumed.wallClockMs,
        compute: Math.floor(consumed.wallClockMs / 1000),
        storage: consumed.bytesWritten,
      },
    },
  };
}
