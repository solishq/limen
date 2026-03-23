/**
 * Reference Agent internal type definitions.
 * S ref: S6-S11, S14-S24 (types consumed from API surface),
 *        SD-03 (single types file for DX simplicity)
 *
 * Phase: 5 (Reference Agent)
 * Implements: §6.1 of Synthesized SDD (Core Types)
 *
 * All API types are imported from src/api/. This file defines ONLY
 * agent-internal types that are NOT part of the public API surface.
 * The agent never creates its own branded ID types -- it uses the ones
 * from the API surface exclusively.
 *
 * Invariants enforced: I-17 (governance boundary -- types import only from API)
 * Failure modes defended: FM-14 (semantic drift -- types match spec exactly)
 */

import type {
  MissionId, TaskId, ArtifactId, AgentId,
  MissionHandle, MissionResult, MissionCreateOptions,
  TaskGraphInput, TaskGraphOutput, TaskSpec,
  TaskExecutionInput, TaskExecutionOutput,
  ArtifactCreateInput, ArtifactCreateOutput,
  ArtifactReadInput, ArtifactReadOutput,
  EventEmitInput, EventEmitOutput,
  CapabilityRequestInput, CapabilityRequestOutput,
  BudgetRequestInput, BudgetRequestOutput,
  ResultSubmitInput, ResultSubmitOutput,
  CheckpointResponseInput, CheckpointResponseOutput,
  LimenErrorCode, MissionState,
} from '../api/index.js';

// Re-export API types that the agent modules use internally
export type {
  MissionId, TaskId, ArtifactId, AgentId,
  MissionHandle, MissionResult, MissionCreateOptions,
  TaskGraphInput, TaskGraphOutput, TaskSpec,
  TaskExecutionInput, TaskExecutionOutput,
  ArtifactCreateInput, ArtifactCreateOutput,
  ArtifactReadInput, ArtifactReadOutput,
  EventEmitInput, EventEmitOutput,
  CapabilityRequestInput, CapabilityRequestOutput,
  BudgetRequestInput, BudgetRequestOutput,
  ResultSubmitInput, ResultSubmitOutput,
  CheckpointResponseInput, CheckpointResponseOutput,
  LimenErrorCode, MissionState,
};

// ============================================================================
// Agent Configuration (SD-02, SD-04)
// ============================================================================

/**
 * SD-02: Decomposition strategy determines how the agent decomposes
 * objectives into task graphs. Heuristic is deterministic (for testing).
 * LLM-augmented uses request_capability for richer decomposition.
 */
export type DecompositionStrategy = 'heuristic' | 'llm-augmented';

/**
 * SD-04: Checkpoint assessment mode. LLM-preferred produces richer
 * assessments but requires capability access. Heuristic fallback
 * ensures I-16 graceful degradation.
 */
export type CheckpointAssessmentMode = 'heuristic' | 'llm-preferred';

/**
 * §41, SD-02, SD-04: Reference agent configuration.
 * Passed to createReferenceAgent() factory.
 */
export interface ReferenceAgentConfig {
  /** Agent name used for registration and mission assignment. */
  readonly name: string;

  /** SD-02: How objectives are decomposed into task graphs. Default: 'heuristic'. */
  readonly decompositionStrategy?: DecompositionStrategy;

  /** Maximum retry attempts for retryable errors. Default: 3. */
  readonly maxRetryAttempts?: number;

  /** SD-04: How checkpoint assessments are computed. Default: 'heuristic'. */
  readonly checkpointAssessmentMode?: CheckpointAssessmentMode;

  /** System prompt for agent registration. Optional. */
  readonly systemPrompt?: string;

  /** Agent domains for registration. Optional. */
  readonly domains?: readonly string[];

  /** Agent capabilities for registration. Optional. */
  readonly capabilities?: readonly string[];
}

// ============================================================================
// Agent Execution State (SDD §5 -- transient, per-mission)
// ============================================================================

/**
 * SDD §5: In-memory agent state maintained during mission execution.
 * This state is transient -- NOT persisted by the agent.
 * All authoritative state lives in the Limen engine (L1/L2).
 *
 * This shadow state is reconstructable from system call return values
 * and checkpoint events. If the agent crashes, it resumes from the
 * last checkpoint (S7), not from this state.
 *
 * Invariants: I-21 (bounded cognitive state)
 */
export interface AgentExecutionState {
  readonly missionId: MissionId;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly scopeBoundaries: readonly string[];
  /** DR-P5-002: Capabilities from mission constraints, threaded through to decompose(). */
  readonly capabilities: readonly string[];
  budgetAllocated: number;
  budgetConsumed: number;
  currentPlanVersion: number;
  planRevisionCount: number;
  readonly activeTaskIds: Set<string>;
  readonly completedTaskIds: Set<string>;
  readonly completedArtifactIds: ArtifactId[];
  readonly childMissionResults: Map<string, MissionResult>;
  readonly checkpointHistory: CheckpointRecord[];
  /** DR-P5-012: Explicit tracking of crossed budget thresholds to prevent re-triggering. */
  readonly crossedBudgetThresholds: Set<number>;
}

/**
 * §24: Record of a checkpoint interaction for self-reflection.
 */
export interface CheckpointRecord {
  readonly checkpointId: string;
  readonly trigger: string;
  readonly assessment: string;
  readonly confidence: number;
  readonly action: string;
  readonly timestamp: number;
}

// ============================================================================
// Error Classification (SD-05)
// ============================================================================

/**
 * SD-05: Three-category error taxonomy derived from S14-S24.
 * Every error code from the 10 system calls is classified here.
 */
export type ErrorCategory = 'retryable' | 'recoverable' | 'terminal';

/**
 * SD-05: Classified error with category and original code.
 */
export interface ClassifiedError {
  readonly code: LimenErrorCode;
  readonly message: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
}

// ============================================================================
// Mission Run Options (§41 UC-10, UC-11, UC-12)
// ============================================================================

/**
 * §41: Options for running a mission through the reference agent.
 */
export interface MissionRunOptions {
  /** Mission objective. */
  readonly objective: string;

  /** Success criteria for the mission. */
  readonly successCriteria?: readonly string[];

  /** Scope boundaries for the mission. */
  readonly scopeBoundaries?: readonly string[];

  /** Mission constraints (budget, deadline, capabilities). */
  readonly constraints: {
    readonly tokenBudget: number;
    readonly deadline: string;
    readonly capabilities?: readonly string[];
    readonly maxTasks?: number;
    readonly maxChildren?: number;
    readonly maxDepth?: number;
  };

  /** Deliverables expected from this mission. */
  readonly deliverables?: ReadonlyArray<{
    readonly type: string;
    readonly name: string;
  }>;

  /** Parent mission ID for recursive delegation (UC-10). */
  readonly parentMissionId?: MissionId;

  /**
   * SEC-P5-002: Current delegation depth for cycle/depth prevention.
   * Incremented on each delegation. Checked against MISSION_TREE_DEFAULTS.maxDepth.
   * Default: 0 (top-level mission).
   */
  readonly delegationDepth?: number;

  /**
   * Checkpoint handler callback. When the system fires a checkpoint,
   * this callback is invoked. If not provided, the agent uses its
   * internal heuristic/LLM handler.
   */
  readonly onCheckpoint?: CheckpointCallback;

  /**
   * Task execution callback. Invoked when a task needs execution.
   * The agent drives execution through this callback. If not provided,
   * the agent uses its internal executor.
   */
  readonly onTaskExecution?: TaskExecutionCallback;
}

/**
 * §24: Callback invoked when the system fires a checkpoint.
 */
export type CheckpointCallback = (
  checkpointId: string,
  trigger: string,
  state: AgentExecutionState,
) => Promise<CheckpointResponseInput>;

/**
 * §17: Callback invoked when a task is ready for execution.
 * Returns the task output content as a string.
 */
export type TaskExecutionCallback = (
  taskId: string,
  description: string,
  executionMode: 'deterministic' | 'stochastic' | 'hybrid',
  missionHandle: MissionHandle,
) => Promise<string>;

// ============================================================================
// Delegation Configuration (UC-10, I-20)
// ============================================================================

/**
 * §11, I-20: Budget decay factor for child mission delegation.
 * Default: 0.3 per spec.
 */
export const DEFAULT_BUDGET_DECAY_FACTOR = 0.3;

/**
 * I-20: Default mission tree structural limits per spec.
 */
export const MISSION_TREE_DEFAULTS = {
  maxDepth: 5,
  maxChildren: 10,
  maxTasks: 50,
  maxTotalMissions: 50, // I-20
} as const;

/**
 * FM-17: Maximum plan revisions to prevent plan explosion.
 * Agent-internal limit. Spec does not prescribe a specific number,
 * but FM-17 requires bounded replanning.
 *
 * ASSUMPTION P5-FM17-1: We set this to 5, which allows reasonable
 * adaptation without unbounded replanning. The spec says "plan_revision_limit"
 * exists as an error code, implying the system enforces one. We track
 * revisions internally and submit with current plan if limit reached.
 */
export const MAX_PLAN_REVISIONS = 5;

/**
 * §7: Default max retries for task execution per spec.
 */
export const DEFAULT_MAX_TASK_RETRIES = 2;

/**
 * FM-16: Confidence threshold below which the agent escalates.
 * Derived from SDD §4 FM-16 defense: "Escalates when confidence drops below 0.5."
 */
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.5;

/**
 * §22: Budget thresholds that trigger checkpoints.
 * Per UC-12: checkpoints at 25%, 50%, 75%, 90% consumption.
 */
export const BUDGET_CHECKPOINT_THRESHOLDS = [0.25, 0.50, 0.75, 0.90] as const;
