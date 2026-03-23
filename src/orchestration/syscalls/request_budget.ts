/**
 * SC-8: request_budget -- Agent requests additional mission resources.
 * S ref: S22, S11 (Resource), I-17, I-20
 *
 * Phase: 3 (Orchestration)
 * Delegates to: BudgetGovernor.requestFromParent
 * Side effects: BUDGET_REQUESTED event (propagation: up),
 *               mission -> BLOCKED if human approval required.
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, RequestBudgetInput, RequestBudgetOutput,
  BudgetGovernor, EventPropagator, MissionStore,
} from '../interfaces/orchestration.js';

/** SC-8: request_budget system call */
export function requestBudget(
  deps: OrchestrationDeps,
  _ctx: OperationContext,
  input: RequestBudgetInput,
  budget: BudgetGovernor,
  events: EventPropagator,
  missions: MissionStore,
): Result<RequestBudgetOutput> {
  // S22: Justification required
  if (!input.justification || input.justification.trim().length === 0) {
    return { ok: false, error: { code: 'JUSTIFICATION_REQUIRED', message: 'Justification must be non-empty', spec: 'S22' } };
  }

  // CF-013: Justification max length (10KB)
  const justificationBytes = Buffer.byteLength(input.justification, 'utf8');
  if (justificationBytes > 10_240) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: `Justification exceeds maximum size (${justificationBytes} bytes > 10240 bytes limit)`, spec: 'S22/CF-013' } };
  }

  // Determine total token amount requested
  const tokenAmount = input.amount.tokens ?? 0;

  // F-002 fix: NaN/Infinity guard (DC-SC8-105) + zero/negative guard (DC-SC8-404)
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: `Token amount must be a finite positive number, got: ${tokenAmount}`, spec: 'S22' } };
  }

  const result = budget.requestFromParent(deps, input.missionId, tokenAmount, input.justification);

  // Emit BUDGET_REQUESTED event (propagation: up) regardless of outcome
  events.emitLifecycle(deps, 'BUDGET_REQUESTED', input.missionId, {
    amount: input.amount,
    justification: input.justification,
    approved: result.ok ? result.value.approved : false,
  });

  if (!result.ok) {
    // If human approval required, transition mission to BLOCKED
    if (result.error.code === 'HUMAN_APPROVAL_REQUIRED') {
      const mission = missions.get(deps, input.missionId);
      if (mission.ok && mission.value.state === 'EXECUTING') {
        missions.transition(deps, input.missionId, 'EXECUTING', 'BLOCKED');
      }
    }
    return result;
  }

  return result;
}
