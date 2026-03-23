/**
 * SC-2: propose_task_graph -- Validates and installs a DAG of tasks.
 * S ref: S16, I-24 (objectiveAlignment), I-20 (task limits)
 *
 * Phase: 3 (Orchestration)
 * Delegates to: TaskGraphEngine.proposeGraph
 * Side effects: Event PLAN_UPDATED emitted (S16)
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, ProposeTaskGraphInput, ProposeTaskGraphOutput, TaskGraphEngine, EventPropagator } from '../interfaces/orchestration.js';

/** SC-2: propose_task_graph system call */
export function proposeTaskGraph(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: ProposeTaskGraphInput,
  taskGraph: TaskGraphEngine,
  events: EventPropagator,
): Result<ProposeTaskGraphOutput> {
  const result = taskGraph.proposeGraph(deps, ctx, input);
  if (!result.ok) return result;

  // CQ-02 fix: S16 Side Effect -- "Event PLAN_UPDATED emitted. Audit entry atomic."
  events.emitLifecycle(deps, 'PLAN_UPDATED', input.missionId, {
    graphId: result.value.graphId,
    planVersion: result.value.planVersion,
    taskCount: result.value.taskCount,
  });

  return result;
}
