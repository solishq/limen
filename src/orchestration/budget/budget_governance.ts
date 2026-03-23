/**
 * Budget Governance -- Resource management and constraint enforcement.
 * S ref: S11 (Resource/Budget), S22 (request_budget), I-20 (never-negative),
 *        I-03 (atomic audit), FM-02 (cost explosion defense)
 *
 * Phase: 3 (Orchestration)
 * Implements: Budget allocation, consumption tracking, parent-to-child transfer,
 *             never-negative enforcement via SQLite CHECK constraint + application check,
 *             6 budget dimensions.
 *
 * SD-15: Budget can never go negative. Enforced at both application layer (pre-check)
 *        and database layer (CHECK constraint on token_remaining >= 0).
 */

import type { Result, MissionId, TenantId } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, BudgetGovernor, RequestBudgetOutput,
} from '../interfaces/orchestration.js';

/**
 * S11: Create the budget governance module.
 * Factory function returns frozen object per C-07.
 */
export function createBudgetGovernor(): BudgetGovernor {

  /** S11: Allocate budget for a new mission */
  function allocate(
    deps: OrchestrationDeps,
    missionId: MissionId,
    budget: number,
    deadline: string,
  ): Result<void> {
    const now = deps.time.nowISO();
    // CQ-08 fix: I-03 -- budget allocation INSERT + audit in same transaction.
    // Note: allocate() is typically called inside MissionStore.create()'s transaction,
    // but the mission_store inlines the INSERT directly rather than calling this method.
    // When called standalone, this ensures I-03 compliance.
    // FM-10 / CORR1-03: Resolve tenant_id from mission record (not hardcoded NULL)
    const missionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [missionId],
    );
    const tenantId = (missionRow?.tenant_id ?? null) as TenantId | null;

    deps.conn.transaction(() => {
      deps.conn.run(
        `INSERT INTO core_resources (mission_id, tenant_id, token_allocated, token_consumed, token_remaining, deadline, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [missionId, tenantId, budget, budget, deadline, now],
      );

      deps.audit.append(deps.conn, {
        tenantId,
        actorType: 'system',
        actorId: 'budget_governor',
        operation: 'allocate_budget',
        resourceType: 'resource',
        resourceId: missionId,
        detail: { budget, deadline },
      });
    });
    return { ok: true, value: undefined };
  }

  /**
   * S11: Consume resources. I-20: token_remaining never negative.
   * SD-15: Pre-check at application layer + CHECK constraint at DB layer.
   * FM-02: Defense against cost explosion -- halt if budget exceeded.
   */
  function consume(
    deps: OrchestrationDeps,
    missionId: MissionId,
    amount: { tokens?: number; time?: number; compute?: number; storage?: number },
  ): Result<void> {
    const tokenCost = amount.tokens ?? 0;
    const timeCost = amount.time ?? 0;
    const computeCost = amount.compute ?? 0;
    const storageCost = amount.storage ?? 0;

    // Pre-check: verify budget allows this consumption
    const resource = deps.conn.get<{ token_remaining: number; compute_max_seconds: number; compute_consumed_seconds: number; storage_max_bytes: number; storage_consumed_bytes: number; tenant_id: TenantId | null }>(
      'SELECT token_remaining, compute_max_seconds, compute_consumed_seconds, storage_max_bytes, storage_consumed_bytes, tenant_id FROM core_resources WHERE mission_id = ?',
      [missionId],
    );
    if (!resource) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `No resource record for mission ${missionId}`, spec: 'S11' } };
    }

    if (tokenCost > resource.token_remaining) {
      // CF-016: On BUDGET_EXCEEDED, transition mission to BLOCKED state.
      // Same pattern as checkpoint_coordinator: direct SQL UPDATE + audit.
      // FM-02: Defense against cost explosion — halt execution.
      const blockNow = deps.time.nowISO();
      deps.conn.transaction(() => {
        const blockResult = deps.conn.run(
          `UPDATE core_missions SET state = 'BLOCKED', updated_at = ?
           WHERE id = ? AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED')`,
          [blockNow, missionId],
        );
        if (blockResult.changes > 0) {
          deps.audit.append(deps.conn, {
            tenantId: resource.tenant_id,
            actorType: 'system',
            actorId: 'budget_governor',
            operation: 'mission_transition',
            resourceType: 'mission',
            resourceId: missionId,
            detail: { to: 'BLOCKED', reason: 'budget_exceeded', tokenCost, tokenRemaining: resource.token_remaining },
          });
        }
      });

      return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: `Token cost ${tokenCost} exceeds remaining ${resource.token_remaining}`, spec: 'S11' } };
    }

    const now = deps.time.nowISO();
    deps.conn.transaction(() => {
      deps.conn.run(
        `UPDATE core_resources
         SET token_consumed = token_consumed + ?,
             token_remaining = token_remaining - ?,
             time_elapsed_ms = time_elapsed_ms + ?,
             compute_consumed_seconds = compute_consumed_seconds + ?,
             storage_consumed_bytes = storage_consumed_bytes + ?,
             updated_at = ?
         WHERE mission_id = ?`,
        [tokenCost, tokenCost, timeCost, computeCost, storageCost, now, missionId],
      );

      deps.audit.append(deps.conn, {
        tenantId: resource.tenant_id,
        actorType: 'system',
        actorId: 'budget_governor',
        operation: 'consume_budget',
        resourceType: 'resource',
        resourceId: missionId,
        detail: { tokens: tokenCost, time: timeCost, compute: computeCost, storage: storageCost },
      });
    });

    return { ok: true, value: undefined };
  }

  /**
   * S22: Request additional budget from parent mission.
   * SD-15: Atomic parent-child transfer in same transaction.
   * If no parent (root mission), requires human approval.
   */
  function requestFromParent(
    deps: OrchestrationDeps,
    missionId: MissionId,
    amount: number,
    justification: string,
  ): Result<RequestBudgetOutput> {
    // Validate justification (S22: JUSTIFICATION_REQUIRED)
    if (!justification || justification.trim().length === 0) {
      return { ok: false, error: { code: 'JUSTIFICATION_REQUIRED', message: 'Justification must be non-empty', spec: 'S22' } };
    }

    // Verify mission exists and is active
    const mission = deps.conn.get<{ id: string; parent_id: string | null; state: string; tenant_id: TenantId | null }>(
      'SELECT id, parent_id, state, tenant_id FROM core_missions WHERE id = ?',
      [missionId],
    );
    if (!mission) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `Mission ${missionId} not found`, spec: 'S22' } };
    }
    const activeStates = ['CREATED', 'PLANNING', 'EXECUTING', 'REVIEWING', 'PAUSED', 'DEGRADED', 'BLOCKED'];
    if (!activeStates.includes(mission.state)) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `Mission in terminal state ${mission.state}`, spec: 'S22' } };
    }

    // Root missions: require human approval
    if (mission.parent_id === null) {
      return { ok: false, error: { code: 'HUMAN_APPROVAL_REQUIRED', message: 'Root mission budget requests require human approval', spec: 'S22' } };
    }

    // Check parent has sufficient remaining budget
    const parentResource = deps.conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [mission.parent_id],
    );
    if (!parentResource || parentResource.token_remaining < amount) {
      return { ok: false, error: { code: 'PARENT_INSUFFICIENT', message: `Parent remaining ${parentResource?.token_remaining ?? 0} < requested ${amount}`, spec: 'S22' } };
    }

    const now = deps.time.nowISO();

    // SD-15: Atomic parent-child budget transfer in same transaction
    deps.conn.transaction(() => {
      // Decrement parent
      deps.conn.run(
        `UPDATE core_resources SET token_remaining = token_remaining - ?, updated_at = ? WHERE mission_id = ?`,
        [amount, now, mission.parent_id],
      );

      // Increment child
      deps.conn.run(
        `UPDATE core_resources SET token_allocated = token_allocated + ?, token_remaining = token_remaining + ?, updated_at = ? WHERE mission_id = ?`,
        [amount, amount, now, missionId],
      );

      // I-03: Audit entry with justification
      deps.audit.append(deps.conn, {
        tenantId: mission.tenant_id,
        actorType: 'system',
        actorId: 'budget_governor',
        operation: 'budget_transfer',
        resourceType: 'resource',
        resourceId: missionId,
        detail: { from: mission.parent_id, to: missionId, amount, justification },
      });
    });

    return {
      ok: true,
      value: {
        approved: true,
        allocated: { tokens: amount },
        source: 'parent',
      },
    };
  }

  /** S11: Check if budget allows estimated cost */
  function checkBudget(
    deps: OrchestrationDeps,
    missionId: MissionId,
    estimatedCost: number,
  ): Result<boolean> {
    const resource = deps.conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [missionId],
    );
    if (!resource) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `No resource record for mission ${missionId}`, spec: 'S11' } };
    }
    return { ok: true, value: resource.token_remaining >= estimatedCost };
  }

  /** S11: Get remaining budget for a mission */
  function getRemaining(
    deps: OrchestrationDeps,
    missionId: MissionId,
  ): Result<number> {
    const resource = deps.conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [missionId],
    );
    if (!resource) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `No resource record for mission ${missionId}`, spec: 'S11' } };
    }
    return { ok: true, value: resource.token_remaining };
  }

  return Object.freeze({
    allocate,
    consume,
    requestFromParent,
    checkBudget,
    getRemaining,
  });
}
