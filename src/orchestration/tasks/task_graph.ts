/**
 * Task Graph Engine -- DAG validation with Kahn's algorithm.
 * S ref: S16 (propose_task_graph), S7 (Task lifecycle), I-20 (task limits),
 *        I-24 (goal anchoring -- objectiveAlignment required)
 *
 * Phase: 3 (Orchestration)
 * Implements: Graph validation (acyclicity via Kahn's), task creation,
 *             plan versioning, capability validation.
 *
 * SD-14: Kahn's algorithm chosen for O(V+E) acyclicity proof + topological
 *        ordering as byproduct. Both Alpha and Bravo converged on this.
 */

import type { Result, OperationContext, TaskId, TenantId } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, TaskGraphEngine, TaskState,
  ProposeTaskGraphInput, ProposeTaskGraphOutput, TaskDefinition, TaskDependency,
} from '../interfaces/orchestration.js';
import { MISSION_TREE_DEFAULTS, generateId } from '../interfaces/orchestration.js';
import { getTask, getActiveTasks, transitionTask, areDependenciesMet } from './task_store.js';
import type { OrchestrationTransitionService } from '../transitions/transition_service.js';

/**
 * SD-14: Kahn's algorithm for DAG acyclicity verification.
 * Returns topological order if DAG, null if cycle detected.
 * O(V+E) time complexity.
 */
export function kahnsAlgorithm(
  tasks: TaskDefinition[],
  dependencies: TaskDependency[],
): TaskId[] | null {
  const taskIds = new Set(tasks.map(t => t.id as string));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const id of taskIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  // Build graph: from -> to means "to depends on from"
  for (const dep of dependencies) {
    const fromStr = dep.from as string;
    const toStr = dep.to as string;
    const adj = adjacency.get(fromStr);
    if (adj) {
      adj.push(toStr);
    }
    inDegree.set(toStr, (inDegree.get(toStr) ?? 0) + 1);
  }

  // Collect nodes with in-degree 0
  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: TaskId[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node as TaskId);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If we didn't process all nodes, there's a cycle
  if (sorted.length !== taskIds.size) {
    return null;
  }

  return sorted;
}

/**
 * S16: Create the task graph engine module.
 * Factory function returns frozen object per C-07.
 */
export function createTaskGraphEngine(transitionService?: OrchestrationTransitionService): TaskGraphEngine {

  /** S16: Validate and install a new task graph */
  function proposeGraph(
    deps: OrchestrationDeps,
    _ctx: OperationContext,
    input: ProposeTaskGraphInput,
  ): Result<ProposeTaskGraphOutput> {
    // I-24: objectiveAlignment required and non-empty
    if (!input.objectiveAlignment || input.objectiveAlignment.trim().length === 0) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: 'objectiveAlignment is required and must be non-empty (I-24)', spec: 'I-24' } };
    }

    // Verify mission exists and is in valid state
    const mission = deps.conn.get<{ state: string; plan_version: number; capabilities: string; constraints_json: string }>(
      'SELECT state, plan_version, capabilities, constraints_json FROM core_missions WHERE id = ?',
      [input.missionId],
    );
    if (!mission) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `Mission ${input.missionId} not found`, spec: 'S16' } };
    }

    // Must be in a state that allows planning
    const validStates = ['CREATED', 'PLANNING', 'EXECUTING'];
    if (!validStates.includes(mission.state)) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `Mission in state ${mission.state}, must be CREATED/PLANNING/EXECUTING`, spec: 'S16' } };
    }

    const constraints = JSON.parse(mission.constraints_json) as { maxTasks: number; maxDepth: number; budget: number };
    const maxTasks = constraints.maxTasks ?? MISSION_TREE_DEFAULTS.maxTasks;
    const maxPlanRevisions = MISSION_TREE_DEFAULTS.maxPlanRevisions;

    // FM-17: Task limit
    if (input.tasks.length > maxTasks) {
      return { ok: false, error: { code: 'TASK_LIMIT_EXCEEDED', message: `${input.tasks.length} tasks exceeds maxTasks ${maxTasks}`, spec: 'FM-17' } };
    }

    // FM-17: Plan revision limit
    if (mission.plan_version >= maxPlanRevisions) {
      return { ok: false, error: { code: 'PLAN_REVISION_LIMIT', message: `Plan version ${mission.plan_version} >= max ${maxPlanRevisions}`, spec: 'FM-17' } };
    }

    // Validate task IDs are unique
    const taskIds = new Set(input.tasks.map(t => t.id as string));
    if (taskIds.size !== input.tasks.length) {
      return { ok: false, error: { code: 'INVALID_DEPENDENCY', message: 'Duplicate task IDs in graph', spec: 'S16' } };
    }

    // Validate dependency references exist in this graph
    for (const dep of input.dependencies) {
      if (!taskIds.has(dep.from as string)) {
        return { ok: false, error: { code: 'INVALID_DEPENDENCY', message: `Dependency from ${dep.from} references non-existent task`, spec: 'S16' } };
      }
      if (!taskIds.has(dep.to as string)) {
        return { ok: false, error: { code: 'INVALID_DEPENDENCY', message: `Dependency to ${dep.to} references non-existent task`, spec: 'S16' } };
      }
      // Self-dependency (also caught by SQL CHECK but validate here too)
      if (dep.from === dep.to) {
        return { ok: false, error: { code: 'CYCLE_DETECTED', message: `Self-dependency: ${dep.from} -> ${dep.to}`, spec: 'S16' } };
      }
    }

    // SD-14: Kahn's algorithm -- acyclicity proof
    const topologicalOrder = kahnsAlgorithm(input.tasks, input.dependencies);
    if (topologicalOrder === null) {
      return { ok: false, error: { code: 'CYCLE_DETECTED', message: 'Task graph contains a cycle', spec: 'S16' } };
    }

    // I-22: Capability check -- all task capabilities must be in mission capabilities
    const missionCaps = new Set(JSON.parse(mission.capabilities) as string[]);
    for (const task of input.tasks) {
      for (const cap of task.capabilitiesRequired) {
        if (!missionCaps.has(cap)) {
          return { ok: false, error: { code: 'CAPABILITY_VIOLATION', message: `Task ${task.id} requires capability '${cap}' not in mission`, spec: 'I-22' } };
        }
      }
    }

    // Budget check -- sum of estimated tokens must not exceed remaining
    const totalEstimated = input.tasks.reduce((sum, t) => sum + t.estimatedTokens, 0);
    const resource = deps.conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [input.missionId],
    );
    if (resource && totalEstimated > resource.token_remaining) {
      return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: `Estimated ${totalEstimated} tokens exceeds remaining ${resource.token_remaining}`, spec: 'S11' } };
    }

    // F-02 fix: Inherit tenant_id from mission (T-4 cross-tenant isolation)
    const missionTenantId = (deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [input.missionId],
    )?.tenant_id ?? null) as TenantId | null;

    const graphId = generateId();
    const newPlanVersion = mission.plan_version + 1;
    const now = deps.time.nowISO();

    deps.conn.transaction(() => {
      // Deactivate previous active graph and cancel its PENDING tasks
      const prevGraph = deps.conn.get<{ id: string }>(
        'SELECT id FROM core_task_graphs WHERE mission_id = ? AND is_active = 1',
        [input.missionId],
      );
      if (prevGraph) {
        deps.conn.run(
          'UPDATE core_task_graphs SET is_active = 0 WHERE id = ?',
          [prevGraph.id],
        );
        // P0-A: Rewired to OrchestrationTransitionService bulk transition.
        // Query PENDING task IDs from the old graph, then cancel via the service.
        if (transitionService) {
          const pendingTasks = deps.conn.query<{ id: string }>(
            `SELECT id FROM core_tasks WHERE graph_id = ? AND state = 'PENDING'`,
            [prevGraph.id],
          );
          if (pendingTasks.length > 0) {
            const bulkResult = transitionService.bulkTransitionTasks(
              deps.conn,
              pendingTasks.map(t => ({
                taskId: t.id as TaskId,
                from: 'PENDING' as TaskState,
                to: 'CANCELLED' as TaskState,
              })),
            );
            // Bulk failure should not silently pass — throw to abort the transaction
            if (!bulkResult.ok) {
              throw new Error(`Bulk task cancellation failed: ${bulkResult.error.message}`);
            }
          }
        } else {
          deps.conn.run(
            `UPDATE core_tasks SET state = 'CANCELLED', updated_at = ?, completed_at = ? WHERE graph_id = ? AND state = 'PENDING'`,
            [now, now, prevGraph.id],
          );
        }
      }

      // Insert new graph metadata
      // FM-10: tenant_id inherited from mission (T-4 cross-tenant isolation)
      deps.conn.run(
        'INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
        [graphId, input.missionId, missionTenantId, newPlanVersion, input.objectiveAlignment, now],
      );

      // Insert tasks
      for (const task of input.tasks) {
        deps.conn.run(
          `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description,
           execution_mode, estimated_tokens, capabilities_required, state,
           created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          [
            task.id,
            input.missionId,
            missionTenantId, // F-02: tenant_id inherited from mission (T-4)
            graphId,
            task.description,
            task.executionMode,
            task.estimatedTokens,
            JSON.stringify(task.capabilitiesRequired),
            now,
            now,
          ],
        );
      }

      // Insert dependencies
      // FM-10: tenant_id inherited from mission (T-4 cross-tenant isolation)
      for (const dep of input.dependencies) {
        deps.conn.run(
          'INSERT INTO core_task_dependencies (graph_id, from_task, to_task, tenant_id) VALUES (?, ?, ?, ?)',
          [graphId, dep.from, dep.to, missionTenantId],
        );
      }

      // Update mission plan version (always) and state (CREATED→PLANNING only)
      // F-RW-002: Wire through transitionService when available for governance enforcement.
      // Legacy fallback uses inline CASE for backward compatibility.
      if (transitionService && mission.state === 'CREATED') {
        // Update plan_version first (this is data, not a state transition)
        deps.conn.run(
          `UPDATE core_missions SET plan_version = ?, updated_at = ? WHERE id = ?`,
          [newPlanVersion, now, input.missionId],
        );
        // State transition through the service — gets CAS + audit + governance
        const transResult = transitionService.transitionMission(
          deps.conn, input.missionId, 'CREATED', 'PLANNING',
        );
        if (!transResult.ok) {
          // Log but don't fail — the graph proposal is the primary operation.
          // The mission may have been concurrently transitioned to a valid state.
          deps.audit.append(deps.conn, {
            tenantId: missionTenantId,
            actorType: 'system',
            actorId: 'orchestrator',
            operation: 'transition_failed',
            resourceType: 'mission',
            resourceId: input.missionId,
            detail: {
              attemptedTransition: { from: 'CREATED', to: 'PLANNING' },
              reason: 'propose_task_graph',
              error: transResult.error,
            },
          });
        }
      } else {
        // Legacy path or non-CREATED state: plan_version update + conditional state change
        deps.conn.run(
          `UPDATE core_missions SET plan_version = ?, state = CASE WHEN state = 'CREATED' THEN 'PLANNING' ELSE state END, updated_at = ? WHERE id = ?`,
          [newPlanVersion, now, input.missionId],
        );
      }

      // I-03: Audit entry
      deps.audit.append(deps.conn, {
        tenantId: missionTenantId,
        actorType: 'system',
        actorId: 'orchestrator',
        operation: 'propose_task_graph',
        resourceType: 'task_graph',
        resourceId: graphId,
        detail: { missionId: input.missionId, taskCount: input.tasks.length, planVersion: newPlanVersion },
      });
    });

    return {
      ok: true,
      value: {
        graphId,
        planVersion: newPlanVersion,
        taskCount: input.tasks.length,
        validationWarnings: [], // CQ-09 fix: S16 spec output includes validationWarnings
      },
    };
  }

  return Object.freeze({
    proposeGraph,
    getTask,
    getActiveTasks,
    transitionTask,
    areDependenciesMet,
  });
}
