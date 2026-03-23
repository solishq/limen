/**
 * ReferenceAgent -- the cognitive agent entry point and execution orchestrator.
 * S ref: S41 (UC-10, UC-11, UC-12), S14-S24 (10 system calls),
 *        SD-06 (integration harness), S49 (developer experience)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §10 Build Order Step 6 (Integration Harness)
 *
 * The ReferenceAgent is the top-level orchestrator that:
 *   1. Registers the agent via limen.agents.register() (S12)
 *   2. Creates missions via limen.missions.create() (SC-1)
 *   3. Coordinates planning (MissionPlanner), execution (TaskExecutor),
 *      artifact management (ArtifactManager), checkpoint handling
 *      (CheckpointHandler), and result aggregation (ResultAggregator)
 *   4. Handles recursive delegation (UC-10) by spawning child agents
 *   5. Responds to reality changes (UC-11) via replan flow
 *   6. Manages long-horizon execution (UC-12) with budget checkpoints
 *
 * This is a LIBRARY -- it exports a factory function. It does NOT run
 * autonomously. It is driven by tests or by the consumer.
 *
 * Invariants enforced: I-17 (all state through system calls),
 *                      I-20 (mission tree limits respected),
 *                      I-21 (bounded cognitive state),
 *                      I-22 (capability immutability),
 *                      I-24 (goal anchoring),
 *                      I-25 (deterministic replay for deterministic paths)
 * Failure modes defended: FM-02 (cost explosion -- budget tracking),
 *                         FM-13 (unbounded autonomy -- structural limits),
 *                         FM-14 (semantic drift -- objective alignment),
 *                         FM-15 (artifact entropy -- purposeful creation),
 *                         FM-16 (mission drift -- confidence monitoring),
 *                         FM-17 (plan explosion -- revision limits),
 *                         FM-19 (delegation cycle -- system enforces)
 */

import type {
  MissionHandle, MissionResult,
  MissionCreateOptions,
  MissionId,
  AgentExecutionState,
  ReferenceAgentConfig, MissionRunOptions,
  TaskGraphInput, TaskGraphOutput,
} from './reference_agent.types.js';

import type { Limen, AgentRegistration } from '../api/index.js';

import { DEFAULT_BUDGET_DECAY_FACTOR, MISSION_TREE_DEFAULTS } from './reference_agent.types.js';
import { SystemCallClient, toClassifiedError } from './system_call_client.js';
import { MissionPlanner } from './mission_planner.js';
import { TaskExecutor } from './task_executor.js';
import { ArtifactManager } from './artifact_manager.js';
import { CheckpointHandler } from './checkpoint_handler.js';
import { ResultAggregator } from './result_aggregator.js';

// ============================================================================
// Input Sanitization (SEC-P5-003, SEC-P5-007)
// ============================================================================

/** SEC-P5-003: Maximum allowed objective length to prevent prompt injection via oversized input. */
const MAX_OBJECTIVE_LENGTH = 4096;

/**
 * SEC-P5-003: Sanitize an objective string before interpolation into task descriptions.
 * Strips control characters (except newlines/tabs), truncates to MAX_OBJECTIVE_LENGTH.
 * Prevents prompt injection via objective fields.
 *
 * @param objective - Raw objective string
 * @returns Sanitized objective string
 */
function sanitizeObjective(objective: string): string {
  // Strip control characters except \n (0x0A) and \t (0x09)
  const cleaned = objective.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Truncate to maximum length
  if (cleaned.length > MAX_OBJECTIVE_LENGTH) {
    return cleaned.slice(0, MAX_OBJECTIVE_LENGTH);
  }
  return cleaned;
}

/**
 * SEC-P5-007: Sanitize error messages before exposing in result submissions.
 * Strips stack traces, file paths, and internal identifiers.
 *
 * @param message - Raw error message
 * @returns Sanitized message safe for external consumption
 */
function sanitizeErrorMessage(message: string): string {
  // Strip file paths (Unix and Windows patterns)
  let safe = message.replace(/(?:\/[\w.-]+)+\.\w+/g, '[path]');
  safe = safe.replace(/(?:[A-Z]:\\[\w\\.-]+)+/g, '[path]');
  // Strip stack trace lines
  safe = safe.replace(/\s+at\s+.+/g, '');
  // Truncate to reasonable length
  if (safe.length > 512) {
    safe = safe.slice(0, 512);
  }
  return safe.trim();
}

// ============================================================================
// Agent Execution State Factory
// ============================================================================

/**
 * SDD §5: Create initial agent execution state for a mission.
 *
 * @param missionId - The mission ID
 * @param objective - The mission objective
 * @param successCriteria - Success criteria
 * @param scopeBoundaries - Scope boundaries
 * @param budgetAllocated - Initial budget allocation
 * @returns Fresh AgentExecutionState
 */
function createExecutionState(
  missionId: MissionId,
  objective: string,
  successCriteria: readonly string[],
  scopeBoundaries: readonly string[],
  budgetAllocated: number,
  capabilities: readonly string[],
): AgentExecutionState {
  return {
    missionId,
    objective,
    successCriteria,
    scopeBoundaries,
    capabilities,
    budgetAllocated,
    budgetConsumed: 0,
    currentPlanVersion: 0,
    planRevisionCount: 0,
    activeTaskIds: new Set(),
    completedTaskIds: new Set(),
    completedArtifactIds: [],
    childMissionResults: new Map(),
    checkpointHistory: [],
    crossedBudgetThresholds: new Set(),
  };
}

// ============================================================================
// ReferenceAgent Class
// ============================================================================

/**
 * §41, S49: The reference cognitive agent.
 *
 * Usage:
 *   const limen = await createLimen({ ... });
 *   const agent = createReferenceAgent(limen, { name: 'strategist' });
 *   const result = await agent.runMission({ objective: '...', constraints: { ... } });
 *
 * The agent is a library. It does not run autonomously.
 * The consumer drives execution by calling runMission().
 */
export class ReferenceAgent {
  private readonly limen: Limen;
  private readonly config: Required<ReferenceAgentConfig>;
  private registered: boolean = false;

  constructor(limen: Limen, config: ReferenceAgentConfig) {
    this.limen = limen;
    this.config = {
      name: config.name,
      decompositionStrategy: config.decompositionStrategy ?? 'heuristic',
      maxRetryAttempts: config.maxRetryAttempts ?? 3,
      checkpointAssessmentMode: config.checkpointAssessmentMode ?? 'heuristic',
      systemPrompt: config.systemPrompt ?? '',
      domains: config.domains ?? [],
      capabilities: config.capabilities ?? [],
    };
  }

  /**
   * §12: Register the agent with the Limen engine.
   *
   * Must be called before runMission(). Registers the agent identity
   * with the system so it can be assigned to missions.
   *
   * DL-2: Agent starts in 'registered' status with 'untrusted' trust level.
   */
  async register(): Promise<void> {
    if (this.registered) return;

    const registration: AgentRegistration = {
      name: this.config.name,
      ...(this.config.systemPrompt ? { systemPrompt: this.config.systemPrompt } : {}),
      ...(this.config.domains.length > 0 ? { domains: this.config.domains } : {}),
      ...(this.config.capabilities.length > 0 ? { capabilities: this.config.capabilities } : {}),
    };

    await this.limen.agents.register(registration);
    this.registered = true;
  }

  /**
   * §41 UC-10/UC-11/UC-12: Run a mission end-to-end.
   *
   * This is the primary entry point for the reference agent. It:
   *   1. Creates a mission via limen.missions.create()
   *   2. Plans: decomposes objective into task DAG
   *   3. Executes tasks in dependency order
   *   4. Creates artifacts from task outputs
   *   5. Handles checkpoints during execution
   *   6. Submits final result
   *
   * For UC-10 recursive missions, delegation happens during execution
   * when a task warrants spawning a child mission.
   *
   * @param options - Mission configuration
   * @returns MissionResult from the completed mission
   */
  async runMission(options: MissionRunOptions): Promise<MissionResult> {
    // Ensure agent is registered
    await this.register();

    // SEC-P5-003: Sanitize objective to prevent prompt injection via interpolation.
    const sanitizedObjective = sanitizeObjective(options.objective);

    // Step 1: Create mission via limen.missions.create()
    const createOptions: MissionCreateOptions = {
      agent: this.config.name,
      objective: sanitizedObjective,
      ...(options.successCriteria != null
        ? { successCriteria: [...options.successCriteria] }
        : {}),
      ...(options.scopeBoundaries != null
        ? { scopeBoundaries: [...options.scopeBoundaries] }
        : {}),
      constraints: {
        tokenBudget: options.constraints.tokenBudget,
        deadline: options.constraints.deadline,
        ...(options.constraints.capabilities != null
          ? { capabilities: [...options.constraints.capabilities] }
          : {}),
        maxTasks: options.constraints.maxTasks ?? MISSION_TREE_DEFAULTS.maxTasks,
        maxChildren: options.constraints.maxChildren ?? MISSION_TREE_DEFAULTS.maxChildren,
        maxDepth: options.constraints.maxDepth ?? MISSION_TREE_DEFAULTS.maxDepth,
      },
      ...(options.deliverables != null ? { deliverables: options.deliverables } : {}),
      ...(options.parentMissionId != null ? { parentMissionId: options.parentMissionId } : {}),
    };

    const missionHandle = await this.limen.missions.create(createOptions);

    // Initialize execution state
    // DR-P5-002: Thread capabilities from constraints into state so decompose() uses them.
    const state = createExecutionState(
      missionHandle.id,
      sanitizedObjective,
      options.successCriteria ?? [],
      options.scopeBoundaries ?? [],
      missionHandle.budget.allocated,
      options.constraints.capabilities ?? [],
    );

    // Create module instances for this mission
    const client = new SystemCallClient(missionHandle, this.config.maxRetryAttempts);
    const planner = new MissionPlanner(client, this.config.decompositionStrategy);
    const executor = new TaskExecutor(client, options.onTaskExecution);
    const artifactManager = new ArtifactManager(client);
    const resultAggregator = new ResultAggregator(client);
    // DR-P5-004: Instantiate CheckpointHandler for UC-11/UC-12 budget checkpoints.
    const checkpointHandler = new CheckpointHandler(client, this.config.checkpointAssessmentMode);

    try {
      // Step 2: Plan -- decompose objective into task graph
      // DR-P5-001: planMission() now returns the exact TaskGraphInput it proposed.
      // We use THIS graph for execution -- no second decomposition.
      const { graphInput } = await planner.planMission(state);

      const taskDescriptions = new Map(
        graphInput.tasks.map(t => [t.id, t.description]),
      );

      // Step 3: Execute tasks in dependency order
      // DR-P5-001: Uses the graphInput from planMission(), not a second heuristicDecompose().
      const completedTasks = await executor.executeTaskGraph(
        graphInput.tasks,
        graphInput.dependencies,
        state,
        taskDescriptions,
        // DR-P5-004: Pass checkpoint handler and planner for budget checkpoint polling
        checkpointHandler,
        options.onCheckpoint,
      );

      // SEC-P5-005: Sync budget from authoritative source after execution.
      state.budgetConsumed = missionHandle.budget.consumed;

      // Step 4: Create artifacts from completed tasks
      for (const taskId of completedTasks) {
        const description = taskDescriptions.get(taskId) ?? taskId;
        await artifactManager.createTaskOutput(
          state.missionId,
          taskId,
          description,
          `Output of task: ${description}`,
          state,
        );
      }

      // Step 5: Submit result via SC-9
      await resultAggregator.submitResult(state);

      // Step 6: Wait for mission completion and return result
      const result = await missionHandle.wait();
      return result;

    } catch (error: unknown) {
      // On failure, attempt to submit a failed result
      const classified = toClassifiedError(error);

      // SEC-P5-007: Sanitize error messages before submitting to system.
      const safeMessage = sanitizeErrorMessage(classified.message);

      try {
        await resultAggregator.submitCustomResult(
          state,
          `Mission failed: ${safeMessage}`,
          0,
          [`Mission terminated due to error: ${safeMessage}`],
          ['Investigate root cause and retry mission'],
        );
      } catch {
        // Submit itself failed -- nothing more we can do
      }

      throw error;
    }
  }

  /**
   * UC-10: Delegate a sub-task to a child mission.
   *
   * Creates a child mission with:
   *   - Budget: parent remaining * DEFAULT_BUDGET_DECAY_FACTOR (0.3)
   *   - Capabilities: subset of parent capabilities
   *   - parentMissionId linking to parent mission
   *
   * I-20: The system enforces depth, children, and tree size limits.
   * I-22: Child capabilities must be subset of parent.
   * FM-19: System detects delegation cycles via visited set.
   * SEC-P5-002: Agent-side depth tracking prevents unbounded recursion.
   * DR-P5-006: Pre-flight check against I-20 limits before spawning.
   *
   * @param parentState - Parent mission execution state
   * @param childObjective - What the child mission should accomplish
   * @param childCapabilities - Capabilities for the child (must be subset of parent)
   * @param childAgentName - Agent name for the child mission
   * @param currentDepth - Current delegation depth (SEC-P5-002)
   * @returns MissionResult from the completed child mission
   */
  async delegateToChild(
    parentState: AgentExecutionState,
    childObjective: string,
    childCapabilities: readonly string[],
    childAgentName: string,
    currentDepth: number = 0,
  ): Promise<MissionResult> {
    // SEC-P5-002: Agent-side delegation depth check.
    // The system also enforces this (DEPTH_EXCEEDED), but we fail fast
    // to avoid wasting resources on a delegation that will be rejected.
    const maxDepth = MISSION_TREE_DEFAULTS.maxDepth;
    if (currentDepth + 1 >= maxDepth) {
      throw Object.assign(new Error(
        `Delegation depth ${currentDepth + 1} would exceed maximum depth ${maxDepth}. ` +
        `Cannot delegate further.`,
      ), { code: 'DEPTH_EXCEEDED' as const });
    }

    // DR-P5-006: Pre-flight check on children count (I-20).
    const maxChildren = MISSION_TREE_DEFAULTS.maxChildren;
    if (parentState.childMissionResults.size >= maxChildren) {
      throw Object.assign(new Error(
        `Parent mission already has ${parentState.childMissionResults.size} children, ` +
        `which meets or exceeds the maximum of ${maxChildren}.`,
      ), { code: 'CHILDREN_EXCEEDED' as const });
    }

    // §11: Budget decay -- child gets parent remaining * 0.3
    const parentRemaining = parentState.budgetAllocated - parentState.budgetConsumed;
    const childBudget = Math.floor(parentRemaining * DEFAULT_BUDGET_DECAY_FACTOR);

    // Create child agent and run child mission
    const childAgent = new ReferenceAgent(this.limen, {
      name: childAgentName,
      decompositionStrategy: this.config.decompositionStrategy,
      maxRetryAttempts: this.config.maxRetryAttempts,
      checkpointAssessmentMode: this.config.checkpointAssessmentMode,
    });

    const childResult = await childAgent.runMission({
      objective: childObjective,
      constraints: {
        tokenBudget: childBudget,
        deadline: '24h',
        capabilities: childCapabilities as string[],
      },
      parentMissionId: parentState.missionId,
      // SEC-P5-002: Propagate delegation depth to child
      delegationDepth: currentDepth + 1,
    });

    // Record child result in parent state
    parentState.childMissionResults.set(childResult.missionId as string, childResult);

    return childResult;
  }

  /**
   * UC-11: Handle a reality change during execution.
   *
   * DR-P5-007: Fully wired replan flow. When new information invalidates previous work:
   *   1. Emit 'data.invalid' event
   *   2. Trigger replanning via the MissionPlanner
   *   3. If replan succeeds, return the revised graph for the caller to re-execute
   *   4. If replan is exhausted (FM-17), return null -- caller submits with current plan
   *
   * @param missionHandle - The active mission handle
   * @param state - Current execution state
   * @param reason - What changed and why
   * @param checkpointHandler - Handler for responding to checkpoints
   * @param planner - MissionPlanner for producing revised task graphs
   * @returns The revised TaskGraphInput for re-execution, or null if replan exhausted
   */
  async handleRealityChange(
    _missionHandle: MissionHandle,
    state: AgentExecutionState,
    reason: string,
    checkpointHandler: CheckpointHandler,
    planner?: MissionPlanner,
  ): Promise<{ graphInput: TaskGraphInput; graphOutput: TaskGraphOutput } | null> {
    // Step 1: Emit data.invalid event
    await checkpointHandler.emitEvent(
      'data.invalid',
      state.missionId,
      { reason, affectedTasks: [...state.activeTaskIds] },
      'up',
    );

    // Step 2: Trigger replanning if planner is available.
    // DR-P5-007: This is the follow-through that was structurally missing.
    // The planner proposes a revised task graph; the orchestrator validates and
    // cancels affected PENDING tasks. The returned graph drives re-execution.
    if (planner) {
      const replanResult = await planner.replan(state, reason);
      return replanResult; // null if FM-17 revision limit reached
    }

    return null;
  }

  /** Get the agent name. */
  get name(): string {
    return this.config.name;
  }

  /** Check if the agent is registered. */
  get isRegistered(): boolean {
    return this.registered;
  }
}
