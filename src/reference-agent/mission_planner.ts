/**
 * MissionPlanner -- objective decomposition into task graphs.
 * S ref: S15 (propose_mission), S16 (propose_task_graph),
 *        SD-01 (lifecycle-phase grouping), SD-02 (heuristic decomposition)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §10 Build Order Step 2 (MissionPlanner)
 *
 * The MissionPlanner is responsible for:
 *   1. Decomposing an objective into a TaskGraphInput (DAG of tasks)
 *   2. Computing objectiveAlignment for every graph (I-24 mandatory)
 *   3. Supporting both heuristic (deterministic) and LLM-augmented decomposition
 *   4. Tracking plan version for revision counting (FM-17)
 *
 * The planner does NOT execute tasks. It produces proposals that the
 * orchestrator validates (DAG acyclicity, budget, alignment).
 *
 * Invariants enforced: I-24 (goal anchoring -- objectiveAlignment on every graph)
 * Failure modes defended: FM-14 (semantic drift), FM-17 (plan explosion)
 */

import type {
  MissionId, TaskId,
  TaskGraphInput, TaskGraphOutput, TaskSpec,
  CapabilityRequestInput,
  DecompositionStrategy,
  AgentExecutionState,
} from './reference_agent.types.js';

import { MAX_PLAN_REVISIONS } from './reference_agent.types.js';
import { SystemCallClient, toClassifiedError } from './system_call_client.js';

// ============================================================================
// LLM Response Validation (SD-02)
// ============================================================================

/**
 * SD-02: Expected shape of LLM decomposition response.
 * Used for runtime validation of the untyped `result` from requestCapability.
 */
interface LlmDecomposeResponse {
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly executionMode: 'deterministic' | 'stochastic' | 'hybrid';
    readonly estimatedTokens: number;
    readonly capabilitiesRequired?: readonly string[];
  }>;
  readonly dependencies: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
  }>;
}

/**
 * SD-02: Validate that the LLM response matches the expected decomposition schema.
 * Returns the validated response or null if validation fails.
 *
 * Validation rules:
 *   - tasks must be a non-empty array
 *   - each task must have a non-empty string id
 *   - each task must have estimatedTokens > 0
 *   - each dependency must reference valid task IDs
 *   - total estimatedTokens must not exceed remaining budget
 *
 * @param result - Untyped result from requestCapability
 * @param remainingBudget - Budget available for decomposition
 * @returns Validated response or null
 */
export function validateLlmDecomposeResponse(
  result: unknown,
  remainingBudget: number,
): LlmDecomposeResponse | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;

  // Validate tasks array
  if (!Array.isArray(r['tasks']) || r['tasks'].length === 0) return null;
  const tasks = r['tasks'] as unknown[];

  const validModes = new Set(['deterministic', 'stochastic', 'hybrid']);
  const taskIds = new Set<string>();
  let totalEstimated = 0;

  for (const task of tasks) {
    if (!task || typeof task !== 'object') return null;
    const t = task as Record<string, unknown>;

    // id: non-empty string
    if (typeof t['id'] !== 'string' || t['id'].length === 0) return null;
    // estimatedTokens: positive number
    if (typeof t['estimatedTokens'] !== 'number' || t['estimatedTokens'] <= 0) return null;
    // description: non-empty string
    if (typeof t['description'] !== 'string' || t['description'].length === 0) return null;
    // executionMode: valid enum
    if (typeof t['executionMode'] !== 'string' || !validModes.has(t['executionMode'])) return null;

    taskIds.add(t['id']);
    totalEstimated += t['estimatedTokens'];
  }

  // Total estimated tokens must not exceed budget
  if (totalEstimated > remainingBudget) return null;

  // Validate dependencies
  const deps = Array.isArray(r['dependencies']) ? r['dependencies'] as unknown[] : [];
  for (const dep of deps) {
    if (!dep || typeof dep !== 'object') return null;
    const d = dep as Record<string, unknown>;
    if (typeof d['from'] !== 'string' || !taskIds.has(d['from'])) return null;
    if (typeof d['to'] !== 'string' || !taskIds.has(d['to'])) return null;
  }

  // F-S6-002 FIX: Construct validated object from verified fields instead of casting raw input
  return {
    tasks: (r['tasks'] as unknown[]).map((t) => {
      const task = t as Record<string, unknown>;
      return {
        id: task['id'] as string,
        description: task['description'] as string,
        executionMode: task['executionMode'] as 'deterministic' | 'stochastic' | 'hybrid',
        estimatedTokens: task['estimatedTokens'] as number,
        ...(Array.isArray(task['capabilitiesRequired'])
          ? { capabilitiesRequired: task['capabilitiesRequired'] as readonly string[] }
          : {}),
      };
    }),
    dependencies: deps.map((d) => {
      const dep = d as Record<string, unknown>;
      return { from: dep['from'] as string, to: dep['to'] as string };
    }),
  };
}

// ============================================================================
// Task ID Generation
// ============================================================================

/** Generate a deterministic task ID from mission context. */
function makeTaskId(missionId: string, index: number): string {
  return `task-${missionId.replace(/^mission-/, '')}-${index}`;
}

// ============================================================================
// Heuristic Decomposition (SD-02)
// ============================================================================

/**
 * SD-02: Heuristic decomposition -- deterministic task graph generation.
 *
 * Derives a standard 4-phase research structure from the objective:
 *   Phase 1: Research (gather data) -- independent tasks
 *   Phase 2: Analyze (process data) -- depends on research
 *   Phase 3: Synthesize (combine findings) -- depends on analysis
 *   Phase 4: Deliver (produce output) -- depends on synthesis
 *
 * This structure maps to §41 UC-12's research -> analyze -> synthesize -> deliver.
 * Each phase is a single task, creating a linear DAG.
 *
 * For UC-10 recursive missions, the research phase may produce a "delegation"
 * task that the executor handles by spawning a child mission.
 *
 * I-24: objectiveAlignment computed by direct reference to the objective.
 *
 * @param missionId - The mission this graph belongs to
 * @param objective - The mission objective to decompose
 * @param budget - Available token budget (determines task granularity)
 * @param capabilities - Available capabilities (determines task types)
 * @returns TaskGraphInput ready for proposeTaskGraph
 */
export function heuristicDecompose(
  missionId: MissionId,
  objective: string,
  budget: number,
  capabilities: readonly string[],
): TaskGraphInput {
  const mid = missionId as string;
  const tasks: TaskSpec[] = [];
  const dependencies: Array<{ readonly from: string; readonly to: string }> = [];

  // Determine execution mode based on capabilities
  const hasStochastic = capabilities.length > 0;
  const mode: 'deterministic' | 'stochastic' | 'hybrid' = hasStochastic ? 'stochastic' : 'deterministic';

  // Budget allocation: research 30%, analyze 30%, synthesize 20%, deliver 20%
  const researchBudget = Math.floor(budget * 0.30);
  const analyzeBudget = Math.floor(budget * 0.30);
  const synthesizeBudget = Math.floor(budget * 0.20);
  const deliverBudget = Math.floor(budget * 0.20);

  // Phase 1: Research
  const researchId = makeTaskId(mid, 1);
  tasks.push({
    id: researchId,
    description: `Research: Gather data and information relevant to "${objective}"`,
    executionMode: mode,
    estimatedTokens: researchBudget,
    capabilitiesRequired: capabilities.filter(c => c === 'web_search' || c === 'data_query'),
  });

  // Phase 2: Analyze
  const analyzeId = makeTaskId(mid, 2);
  tasks.push({
    id: analyzeId,
    description: `Analyze: Process and analyze findings from research on "${objective}"`,
    executionMode: mode,
    estimatedTokens: analyzeBudget,
    capabilitiesRequired: capabilities.filter(c => c === 'code_execute' || c === 'data_query'),
  });
  dependencies.push({ from: researchId, to: analyzeId });

  // Phase 3: Synthesize
  const synthesizeId = makeTaskId(mid, 3);
  tasks.push({
    id: synthesizeId,
    description: `Synthesize: Combine analysis results into coherent findings for "${objective}"`,
    executionMode: mode,
    estimatedTokens: synthesizeBudget,
  });
  dependencies.push({ from: analyzeId, to: synthesizeId });

  // Phase 4: Deliver
  const deliverId = makeTaskId(mid, 4);
  tasks.push({
    id: deliverId,
    description: `Deliver: Produce final deliverables for "${objective}"`,
    executionMode: 'deterministic',
    estimatedTokens: deliverBudget,
  });
  dependencies.push({ from: synthesizeId, to: deliverId });

  // I-24: objectiveAlignment -- direct reference to objective
  const objectiveAlignment =
    `Tasks decompose "${objective}" into four phases: ` +
    `research (data gathering), analysis (processing), synthesis (combining), ` +
    `and delivery (final output). Each phase directly supports the mission objective.`;

  return {
    missionId,
    tasks,
    dependencies,
    objectiveAlignment,
  };
}

// ============================================================================
// MissionPlanner Class
// ============================================================================

/**
 * SD-01: MissionPlanner groups propose_mission + propose_task_graph calls.
 * These are the "planning" calls that define WHAT the agent will do.
 *
 * The planner:
 *   1. Decomposes objectives into task graphs (heuristic or LLM-augmented)
 *   2. Proposes task graphs via the SystemCallClient
 *   3. Handles plan revisions within FM-17 limits
 *   4. Ensures I-24 objectiveAlignment on every proposal
 */
export class MissionPlanner {
  private readonly client: SystemCallClient;
  readonly strategy: DecompositionStrategy;

  constructor(client: SystemCallClient, strategy: DecompositionStrategy = 'heuristic') {
    this.client = client;
    this.strategy = strategy;
  }

  /**
   * §16, I-24: Create and propose an initial task graph for a mission.
   *
   * DR-P5-001: Returns both the TaskGraphInput that was proposed AND the
   * TaskGraphOutput from the system. The caller must use the returned
   * graphInput to drive execution — not a second decomposition.
   *
   * @param state - Current agent execution state
   * @returns { graphInput, graphOutput } — the proposed graph and the system's validation result
   * @throws ClassifiedError on validation failure
   */
  async planMission(state: AgentExecutionState): Promise<{ graphInput: TaskGraphInput; graphOutput: TaskGraphOutput }> {
    const graphInput = await this.decompose(state);
    const graphOutput = await this.client.proposeTaskGraph(graphInput);

    // Update state with plan version
    state.currentPlanVersion = graphOutput.planVersion;
    state.planRevisionCount = 0;

    // Track active task IDs
    for (const task of graphInput.tasks) {
      state.activeTaskIds.add(task.id);
    }

    return { graphInput, graphOutput };
  }

  /**
   * §16, FM-17: Propose a revised task graph (replan).
   *
   * Called when a checkpoint response triggers replanning.
   * Tracks revision count against MAX_PLAN_REVISIONS limit.
   *
   * DR-P5-001: Returns the graphInput alongside graphOutput so the caller
   * can drive execution from the exact graph that was accepted.
   *
   * @param state - Current agent execution state
   * @param reason - Why replanning is needed
   * @returns { graphInput, graphOutput } or null if revision limit reached
   */
  async replan(state: AgentExecutionState, _reason: string): Promise<{ graphInput: TaskGraphInput; graphOutput: TaskGraphOutput } | null> {
    // FM-17: Check plan revision limit
    if (state.planRevisionCount >= MAX_PLAN_REVISIONS) {
      return null; // Submit with current plan
    }

    const graphInput = await this.decompose(state);
    try {
      const graphOutput = await this.client.proposeTaskGraph(graphInput);

      state.currentPlanVersion = graphOutput.planVersion;
      state.planRevisionCount++;

      // Clear and repopulate active tasks
      state.activeTaskIds.clear();
      for (const task of graphInput.tasks) {
        state.activeTaskIds.add(task.id);
      }

      return { graphInput, graphOutput };
    } catch (error: unknown) {
      const classified = toClassifiedError(error);
      if (classified.code === 'PLAN_REVISION_LIMIT') {
        return null; // System-enforced limit reached
      }
      throw classified;
    }
  }

  /**
   * §16: Create a TaskGraphInput from a revised set of tasks.
   * Used when a specific revised graph is needed (e.g., from checkpoint replan).
   *
   * @param missionId - Mission this graph belongs to
   * @param tasks - The revised task list
   * @param dependencies - The revised dependency list
   * @param objective - The mission objective for alignment
   * @returns TaskGraphInput ready for proposeTaskGraph
   */
  createRevisedGraph(
    missionId: MissionId,
    tasks: readonly TaskSpec[],
    dependencies: readonly { readonly from: string; readonly to: string }[],
    objective: string,
  ): TaskGraphInput {
    return {
      missionId,
      tasks,
      dependencies,
      objectiveAlignment: `Revised plan for "${objective}" based on checkpoint feedback. ` +
        `${tasks.length} tasks in revised graph.`,
    };
  }

  /**
   * SD-02: Decompose objective into task graph using configured strategy.
   *
   * When strategy is 'llm-augmented':
   *   1. Calls requestCapability (SC-7) for LLM-powered decomposition
   *   2. Validates the response schema rigorously
   *   3. Tracks budget consumed by the capability call
   *   4. Falls back to heuristic on ANY error (I-16 graceful degradation)
   *
   * When strategy is 'heuristic':
   *   Uses deterministic heuristicDecompose() directly.
   *
   * DR-P5-002: Uses state.capabilities (threaded from MissionRunOptions.constraints.capabilities)
   * to determine execution mode and attach capabilities to tasks.
   *
   * I-24: objectiveAlignment is always present in the returned TaskGraphInput.
   *
   * @param state - Agent execution state with objective and constraints
   * @returns TaskGraphInput for proposal
   */
  private async decompose(state: AgentExecutionState): Promise<TaskGraphInput> {
    const remainingBudget = state.budgetAllocated - state.budgetConsumed;

    if (this.strategy === 'llm-augmented') {
      try {
        // SD-02: LLM-augmented decomposition via requestCapability (SC-7)
        const syntheticTaskId = `task-${(state.missionId as string).replace(/^mission-/, '')}-llm-decompose` as TaskId;

        const input: CapabilityRequestInput = {
          capabilityType: 'api_call',
          parameters: {
            prompt: `Decompose the following objective into a task graph (DAG of tasks):\n\n` +
              `Objective: "${state.objective}"\n\n` +
              `Available capabilities: ${JSON.stringify(state.capabilities)}\n` +
              `Remaining budget (tokens): ${remainingBudget}\n\n` +
              `Return a JSON object with:\n` +
              `- tasks: array of { id: string, description: string, executionMode: "deterministic"|"stochastic"|"hybrid", estimatedTokens: number, capabilitiesRequired?: string[] }\n` +
              `- dependencies: array of { from: string, to: string } referencing task IDs\n\n` +
              `Total estimatedTokens across all tasks must not exceed ${remainingBudget}.`,
            schema: {
              tasks: [{ id: 'string', description: 'string', executionMode: 'string', estimatedTokens: 'number' }],
              dependencies: [{ from: 'string', to: 'string' }],
            },
            objective: state.objective,
            budget: remainingBudget,
            capabilities: state.capabilities,
          },
          missionId: state.missionId,
          taskId: syntheticTaskId,
        };

        const output = await this.client.requestCapability(input);

        // F-S6-001 FIX: Guard against NaN/Infinity/negative token costs
        const tokensCost = output.resourcesConsumed.tokens ?? 0;
        if (Number.isFinite(tokensCost) && tokensCost > 0) {
          state.budgetConsumed += tokensCost;
        }

        // Validate the response schema
        const validated = validateLlmDecomposeResponse(output.result, remainingBudget);
        if (validated === null) {
          // I-16: Invalid response -> fall through to heuristic
          return heuristicDecompose(state.missionId, state.objective, remainingBudget, state.capabilities);
        }

        // I-24: objectiveAlignment -- direct reference to objective from LLM decomposition
        const objectiveAlignment =
          `LLM-augmented decomposition for "${state.objective}": ` +
          `${validated.tasks.length} tasks generated. ` +
          `Each task derived from the mission objective to ensure goal anchoring.`;

        return {
          missionId: state.missionId,
          tasks: validated.tasks as readonly TaskSpec[],
          dependencies: validated.dependencies,
          objectiveAlignment,
        };
      } catch (_error: unknown) {
        // I-16: Graceful degradation -- any error falls back to heuristic decomposition.
        // This covers: SANDBOX_VIOLATION, CAPABILITY_DENIED, network errors, parse failures.
        return heuristicDecompose(state.missionId, state.objective, remainingBudget, state.capabilities);
      }
    }

    return heuristicDecompose(
      state.missionId,
      state.objective,
      remainingBudget,
      state.capabilities,
    );
  }
}
