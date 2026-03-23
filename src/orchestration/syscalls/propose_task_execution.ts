/**
 * SC-3: propose_task_execution -- Requests execution of a task.
 * S ref: S17, I-05, I-12, I-14, I-17, I-22
 *
 * Phase: 3 (Orchestration)
 * Validates: dependencies met, budget available, capability subset,
 *            task in PENDING state. Then schedules via substrate.
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, ProposeTaskExecutionInput, ProposeTaskExecutionOutput,
  TaskGraphEngine, BudgetGovernor, EventPropagator,
} from '../interfaces/orchestration.js';
import { generateId } from '../interfaces/orchestration.js';

/** SC-3: propose_task_execution system call */
export function proposeTaskExecution(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: ProposeTaskExecutionInput,
  taskGraph: TaskGraphEngine,
  budget: BudgetGovernor,
  events: EventPropagator,
): Result<ProposeTaskExecutionOutput> {
  // Get the task
  const taskResult = taskGraph.getTask(deps, input.taskId);
  if (!taskResult.ok) {
    return { ok: false, error: { code: 'TASK_NOT_PENDING', message: `Task ${input.taskId} not found`, spec: 'S17' } };
  }
  const task = taskResult.value;

  // Verify task is in PENDING state
  if (task.state !== 'PENDING') {
    return { ok: false, error: { code: 'TASK_NOT_PENDING', message: `Task in state ${task.state}, expected PENDING`, spec: 'S17' } };
  }

  // Check dependencies are met
  const depsMetResult = taskGraph.areDependenciesMet(deps, input.taskId);
  if (!depsMetResult.ok) return { ok: false, error: depsMetResult.error };
  if (!depsMetResult.value) {
    return { ok: false, error: { code: 'DEPENDENCIES_UNMET', message: 'Prerequisite tasks not COMPLETED', spec: 'S17' } };
  }

  // I-22: Capability check -- requested capabilities must be in mission capabilities
  const mission = deps.conn.get<{ capabilities: string }>(
    'SELECT capabilities FROM core_missions WHERE id = ?',
    [task.missionId],
  );
  if (mission) {
    const missionCaps = new Set(JSON.parse(mission.capabilities) as string[]);
    for (const cap of input.environmentRequest.capabilities) {
      if (!missionCaps.has(cap)) {
        return { ok: false, error: { code: 'CAPABILITY_DENIED', message: `Capability '${cap}' not in mission set`, spec: 'S17' } };
      }
    }
  }

  // Budget check
  const budgetCheck = budget.checkBudget(deps, task.missionId, task.estimatedTokens);
  if (!budgetCheck.ok) return { ok: false, error: budgetCheck.error };
  if (!budgetCheck.value) {
    return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: `Estimated cost ${task.estimatedTokens} exceeds remaining budget`, spec: 'S17' } };
  }

  // Schedule via substrate: enqueue task
  const executionId = generateId();
  const now = deps.time.nowISO();

  // Transition task: PENDING -> SCHEDULED
  const transResult = taskGraph.transitionTask(deps, input.taskId, 'PENDING', 'SCHEDULED');
  if (!transResult.ok) {
    return { ok: false, error: { code: 'TASK_NOT_PENDING', message: transResult.error.message, spec: 'S17' } };
  }

  // Enqueue to substrate scheduler
  const enqueueResult = deps.substrate.scheduler.enqueue(deps.conn, ctx, {
    taskId: input.taskId,
    missionId: task.missionId,
    tenantId: ctx.tenantId,
    agentId: (ctx.agentId ?? 'system') as import('../../kernel/interfaces/index.js').AgentId,
    priority: 1,
    executionMode: input.executionMode,
    estimatedTokens: task.estimatedTokens,
    capabilitiesRequired: input.environmentRequest.capabilities as unknown as import('../../substrate/interfaces/substrate.js').CapabilityType[],
    payload: { description: task.description },
    timeoutMs: input.environmentRequest.timeout,
  });

  if (!enqueueResult.ok) {
    return { ok: false, error: { code: 'WORKER_UNAVAILABLE', message: enqueueResult.error.message, spec: 'S17' } };
  }

  // Emit TASK_SCHEDULED lifecycle event
  events.emitLifecycle(deps, 'TASK_SCHEDULED', task.missionId, {
    taskId: input.taskId,
    executionMode: input.executionMode,
  });

  return {
    ok: true,
    value: {
      executionId,
      scheduledAt: now,
      workerId: 'pending-assignment',
    },
  };
}
