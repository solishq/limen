/**
 * Task Store -- Task lifecycle and state machine.
 * S ref: S7 (Task lifecycle), I-20 (task limits)
 *
 * Phase: 3 (Orchestration)
 * Implements: Task CRUD, state transitions with validation.
 */

import type { Result, MissionId, TaskId, TenantId } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, Task, TaskState } from '../interfaces/orchestration.js';
import { TASK_TRANSITIONS } from '../interfaces/orchestration.js';

/** S7: Parse task row to domain object */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row['id'] as TaskId,
    missionId: row['mission_id'] as MissionId,
    tenantId: (row['tenant_id'] ?? null) as Task['tenantId'],
    graphId: row['graph_id'] as string,
    description: row['description'] as string,
    executionMode: row['execution_mode'] as Task['executionMode'],
    estimatedTokens: row['estimated_tokens'] as number,
    capabilitiesRequired: JSON.parse(row['capabilities_required'] as string) as string[],
    state: row['state'] as TaskState,
    assignedAgent: (row['assigned_agent'] ?? null) as Task['assignedAgent'],
    retryCount: row['retry_count'] as number,
    maxRetries: row['max_retries'] as number,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    completedAt: (row['completed_at'] ?? null) as string | null,
  };
}

/** S7: Get task by id */
export function getTask(deps: OrchestrationDeps, taskId: TaskId): Result<Task> {
  const row = deps.conn.get<Record<string, unknown>>(
    'SELECT * FROM core_tasks WHERE id = ?',
    [taskId],
  );
  if (!row) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `Task ${taskId} not found`, spec: 'S7' } };
  }
  return { ok: true, value: rowToTask(row) };
}

/** S7: Get tasks for a mission's active graph */
export function getActiveTasks(deps: OrchestrationDeps, missionId: MissionId): Result<Task[]> {
  // Find active graph
  const graph = deps.conn.get<{ id: string }>(
    'SELECT id FROM core_task_graphs WHERE mission_id = ? AND is_active = 1',
    [missionId],
  );
  if (!graph) {
    return { ok: true, value: [] };
  }

  const rows = deps.conn.query<Record<string, unknown>>(
    'SELECT * FROM core_tasks WHERE graph_id = ?',
    [graph.id],
  );
  return { ok: true, value: rows.map(rowToTask) };
}

/** S7: Transition task state with validation */
export function transitionTask(
  deps: OrchestrationDeps,
  taskId: TaskId,
  from: TaskState,
  to: TaskState,
): Result<void> {
  const validTargets = TASK_TRANSITIONS[from];
  if (!validTargets.includes(to)) {
    return { ok: false, error: { code: 'INVALID_TRANSITION', message: `Cannot transition task from ${from} to ${to}`, spec: 'S7' } };
  }

  const now = deps.time.nowISO();
  const isTerminal = to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED';

  // Debt 3: Derive tenant_id from task for audit trail
  const taskRow = deps.conn.get<{ tenant_id: string | null }>(
    'SELECT tenant_id FROM core_tasks WHERE id = ?',
    [taskId],
  );
  const taskTenantId = (taskRow?.tenant_id ?? null) as TenantId | null;

  deps.conn.transaction(() => {
    const result = deps.conn.run(
      `UPDATE core_tasks SET state = ?, updated_at = ?${isTerminal ? ', completed_at = ?' : ''} WHERE id = ? AND state = ?`,
      isTerminal ? [to, now, now, taskId, from] : [to, now, taskId, from],
    );

    if (result.changes === 0) {
      throw new Error(`Task ${taskId} not in state ${from}`);
    }

    deps.audit.append(deps.conn, {
      tenantId: taskTenantId,
      actorType: 'system',
      actorId: 'orchestrator',
      operation: 'task_transition',
      resourceType: 'task',
      resourceId: taskId,
      detail: { from, to },
    });
  });

  return { ok: true, value: undefined };
}

/** S16: Check if all dependencies for a task are satisfied */
export function areDependenciesMet(deps: OrchestrationDeps, taskId: TaskId): Result<boolean> {
  const task = deps.conn.get<{ graph_id: string }>('SELECT graph_id FROM core_tasks WHERE id = ?', [taskId]);
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `Task ${taskId} not found`, spec: 'S16' } };
  }

  // Find all tasks that this task depends on (from_task -> to_task means to_task depends on from_task)
  const depRows = deps.conn.query<{ from_task: string }>(
    'SELECT from_task FROM core_task_dependencies WHERE graph_id = ? AND to_task = ?',
    [task.graph_id, taskId],
  );

  if (depRows.length === 0) {
    return { ok: true, value: true };
  }

  // Check all dependencies are COMPLETED
  for (const dep of depRows) {
    const depTask = deps.conn.get<{ state: string }>(
      'SELECT state FROM core_tasks WHERE id = ?',
      [dep.from_task],
    );
    if (!depTask) {
      // Debt 2: Missing dependency task is data corruption — do not silently treat as "not met"
      return { ok: false, error: { code: 'NOT_FOUND', message: `Dependency task ${dep.from_task} not found — graph references phantom task`, spec: 'S16' } };
    }
    if (depTask.state !== 'COMPLETED') {
      return { ok: true, value: false };
    }
  }

  return { ok: true, value: true };
}
