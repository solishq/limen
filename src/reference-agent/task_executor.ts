/**
 * TaskExecutor -- drives tasks through their lifecycle.
 * S ref: S17 (propose_task_execution), S21 (request_capability),
 *        SD-01 (lifecycle-phase grouping)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §10 Build Order Step 3 (TaskExecutor)
 *
 * The TaskExecutor is responsible for:
 *   1. Proposing task execution via SC-3 (propose_task_execution)
 *   2. Requesting capabilities via SC-7 (request_capability)
 *   3. Driving tasks through PENDING -> SCHEDULED -> RUNNING -> terminal
 *   4. Respecting dependency order (agent-side dependency awareness)
 *
 * The executor does NOT validate dependencies -- that is the orchestrator's job.
 * It does NOT manage artifacts -- that is ArtifactManager's job.
 *
 * Invariants enforced: I-17 (all execution through system calls),
 *                      I-22 (capability immutability -- uses only mission-scoped caps)
 * Failure modes defended: FM-02 (budget tracking per execution)
 */

import type {
  TaskId, MissionId,
  TaskExecutionInput, TaskExecutionOutput,
  CapabilityRequestInput, CapabilityRequestOutput,
  AgentExecutionState,
  TaskExecutionCallback,
  CheckpointCallback,
} from './reference_agent.types.js';

import { SystemCallClient, toClassifiedError } from './system_call_client.js';
import type { CheckpointHandler } from './checkpoint_handler.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';

// ============================================================================
// TaskExecutor Class
// ============================================================================

/**
 * SD-01: TaskExecutor groups propose_task_execution + request_capability.
 * These are the "execution" calls that perform WORK on individual tasks.
 *
 * The executor:
 *   1. Drives tasks in dependency order (topological sort awareness)
 *   2. Proposes execution via system call
 *   3. Uses capabilities within mission scope (I-22)
 *   4. Tracks budget consumption from execution responses
 */
export class TaskExecutor {
  private readonly client: SystemCallClient;
  private readonly onExecution: TaskExecutionCallback | undefined;
  private readonly clock: TimeProvider;

  constructor(
    client: SystemCallClient,
    onExecution?: TaskExecutionCallback,
    time?: TimeProvider,
  ) {
    this.client = client;
    this.onExecution = onExecution;
    this.clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  }

  /**
   * §17, SC-3: Execute a single task.
   *
   * Proposes task execution to the orchestrator. The orchestrator validates
   * dependencies, budget, and task state before scheduling.
   *
   * DR-P5-011: Now accepts description parameter so the callback receives
   * a meaningful task description instead of an empty string.
   *
   * @param taskId - The task to execute
   * @param description - Human-readable description of the task
   * @param executionMode - How the task should be executed
   * @param capabilities - Capabilities required for this task
   * @param timeout - Execution timeout in milliseconds
   * @param state - Current agent execution state (for budget tracking)
   * @returns TaskExecutionOutput with scheduling info
   */
  async executeTask(
    taskId: string,
    description: string,
    executionMode: 'deterministic' | 'stochastic' | 'hybrid',
    capabilities: readonly string[],
    timeout: number,
    _state: AgentExecutionState,
  ): Promise<TaskExecutionOutput> {
    const input: TaskExecutionInput = {
      taskId: taskId as TaskId,
      executionMode,
      environmentRequest: {
        capabilities: capabilities as string[],
        timeout,
      },
    };

    const result = await this.client.proposeTaskExecution(input);

    // If we have a custom execution callback, invoke it
    // DR-P5-011: Thread the actual task description through to the callback.
    if (this.onExecution) {
      const handle = this.client.getHandle();
      await this.onExecution(taskId, description, executionMode, handle);
    }

    return result;
  }

  /**
   * §17: Execute all tasks in a graph respecting dependency order.
   *
   * This is a simplified topological execution: tasks with no unresolved
   * dependencies execute first, then their dependents, and so on.
   *
   * SEC-P5-006: Added retry counter per task for DEPENDENCIES_UNMET and
   * max iteration count for outer while loop to prevent infinite loops.
   *
   * DR-P5-004: Polls checkBudgetThreshold() between task executions.
   * When a threshold is crossed, invokes the checkpoint handler.
   *
   * @param tasks - Task definitions from the task graph
   * @param dependencies - Dependency edges (from -> to means "from must complete before to")
   * @param state - Agent execution state for tracking
   * @param taskDescriptions - Map of taskId to description for the executor callback
   * @param checkpointHandler - Optional checkpoint handler for budget threshold polling (DR-P5-004)
   * @param onCheckpoint - Optional checkpoint callback from MissionRunOptions
   * @returns List of completed task IDs in execution order
   */
  async executeTaskGraph(
    tasks: readonly { readonly id: string; readonly description: string; readonly executionMode: 'deterministic' | 'stochastic' | 'hybrid'; readonly capabilitiesRequired?: readonly string[] }[],
    dependencies: readonly { readonly from: string; readonly to: string }[],
    state: AgentExecutionState,
    taskDescriptions: ReadonlyMap<string, string>,
    checkpointHandler?: CheckpointHandler,
    onCheckpoint?: CheckpointCallback,
  ): Promise<readonly string[]> {
    const completedTasks: string[] = [];
    const remainingTasks = new Set(tasks.map(t => t.id));
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // SEC-P5-006: Per-task retry counter for DEPENDENCIES_UNMET errors.
    const depUnmetRetries = new Map<string, number>();
    const MAX_DEP_UNMET_RETRIES = 3;

    // SEC-P5-006: Max iterations for outer loop to prevent infinite loops.
    // Worst case: each iteration resolves one task. tasks.length * (MAX_DEP_UNMET_RETRIES + 1)
    // gives a generous upper bound.
    const MAX_ITERATIONS = tasks.length * (MAX_DEP_UNMET_RETRIES + 2);
    let iterations = 0;

    // Build adjacency: for each task, which tasks must complete before it
    const incomingDeps = new Map<string, Set<string>>();
    for (const task of tasks) {
      incomingDeps.set(task.id, new Set());
    }
    for (const dep of dependencies) {
      incomingDeps.get(dep.to)?.add(dep.from);
    }

    // Topological execution loop
    while (remainingTasks.size > 0) {
      // SEC-P5-006: Guard against infinite loop.
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        break;
      }

      // Find tasks with all dependencies satisfied
      const readyTasks: string[] = [];
      for (const taskId of remainingTasks) {
        const deps = incomingDeps.get(taskId);
        if (!deps || deps.size === 0) {
          readyTasks.push(taskId);
        }
      }

      if (readyTasks.length === 0) {
        // All remaining tasks have unresolved dependencies.
        // This should not happen if the DAG was validated, but we handle it.
        break;
      }

      // Execute ready tasks (sequentially for determinism in heuristic mode)
      for (const taskId of readyTasks) {
        const task = taskMap.get(taskId);
        if (!task) continue;

        // DR-P5-011: Get actual task description for the callback
        const description = taskDescriptions.get(taskId) ?? task.description ?? taskId;

        try {
          await this.executeTask(
            taskId,
            description,
            task.executionMode,
            task.capabilitiesRequired ?? [],
            60000, // Default timeout
            state,
          );

          completedTasks.push(taskId);
          remainingTasks.delete(taskId);
          state.activeTaskIds.delete(taskId);
          state.completedTaskIds.add(taskId);

          // Remove this task from all dependents' incoming deps
          for (const [, deps] of incomingDeps) {
            deps.delete(taskId);
          }

          // DR-P5-004: Poll budget threshold after each task execution.
          if (checkpointHandler) {
            const threshold = checkpointHandler.checkBudgetThreshold(state);
            if (threshold !== null) {
              // Budget threshold crossed -- handle checkpoint
              const checkpointId = `budget-${threshold}-${this.clock.nowMs()}`;
              if (onCheckpoint) {
                // Use consumer-provided callback
                const response = await onCheckpoint(checkpointId, 'BUDGET_THRESHOLD', state);
                await this.client.respondCheckpoint(response);
              } else {
                // Use internal heuristic handler
                await checkpointHandler.handleCheckpoint(
                  checkpointId, 'BUDGET_THRESHOLD', state,
                );
              }
            }
          }
        } catch (error: unknown) {
          const classified = toClassifiedError(error);

          if (classified.code === 'DEPENDENCIES_UNMET') {
            // SEC-P5-006: Track retries per task, don't retry forever
            const retryCount = (depUnmetRetries.get(taskId) ?? 0) + 1;
            depUnmetRetries.set(taskId, retryCount);
            if (retryCount < MAX_DEP_UNMET_RETRIES) {
              // Task not ready yet -- skip and retry next iteration
              continue;
            }
            // Exhausted retries -- fall through to failure handling
          }

          // For other errors (or exhausted DEPENDENCIES_UNMET retries),
          // mark task as failed and continue
          remainingTasks.delete(taskId);
          state.activeTaskIds.delete(taskId);

          // Propagate failure: remove all tasks that depend on this one
          const toCancel = this.findDependents(taskId, dependencies);
          for (const cancelId of toCancel) {
            remainingTasks.delete(cancelId);
            state.activeTaskIds.delete(cancelId);
          }
        }
      }
    }

    return completedTasks;
  }

  /**
   * §21, SC-7: Request a capability execution within a task.
   *
   * I-22: The capability must be within the mission's capability set.
   * The system validates this -- the agent does not second-guess.
   *
   * @param capabilityType - The capability to invoke
   * @param parameters - Capability-specific parameters
   * @param missionId - The mission context
   * @param taskId - The task context
   * @param state - Agent execution state (for budget tracking)
   * @returns CapabilityRequestOutput with result and resources consumed
   */
  async requestCapability(
    capabilityType: string,
    parameters: Record<string, unknown>,
    missionId: MissionId,
    taskId: string,
    state: AgentExecutionState,
  ): Promise<CapabilityRequestOutput> {
    const input: CapabilityRequestInput = {
      capabilityType,
      parameters,
      missionId,
      taskId: taskId as TaskId,
    };

    const result = await this.client.requestCapability(input);

    // FM-02: Track budget consumption from capability execution
    if (result.resourcesConsumed.tokens) {
      state.budgetConsumed += result.resourcesConsumed.tokens;
    }

    return result;
  }

  /**
   * Find all tasks that transitively depend on a given task.
   * Used to propagate failure cancellation.
   */
  private findDependents(
    taskId: string,
    dependencies: readonly { readonly from: string; readonly to: string }[],
  ): Set<string> {
    const dependents = new Set<string>();
    const queue = [taskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of dependencies) {
        if (dep.from === current && !dependents.has(dep.to)) {
          dependents.add(dep.to);
          queue.push(dep.to);
        }
      }
    }

    return dependents;
  }
}
