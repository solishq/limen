/**
 * Orchestration Layer interface types.
 * S ref: S6-S11, S14-S24, S26, I-17-I-28, FM-13-FM-19
 *
 * Phase: 3 (Orchestration)
 * Implements: All TypeScript types for the orchestration layer:
 *   S6 (Mission), S7 (Task), S8 (Artifact), S10 (Event), S11 (Resource/Budget),
 *   S14-S24 (10 System Calls), S26 (Conversation), I-17-I-28 (Invariants)
 *
 * Layer 2: Deterministic governance engine.
 * Agents propose. The system validates. The system executes. Never the reverse.
 */

import type {
  Result, OperationContext,
  MissionId, TaskId, ArtifactId, AgentId, EventId, SessionId,
  TenantId, DatabaseConnection, AuditTrail, RateLimiter,
  TimeProvider,
} from '../../kernel/interfaces/index.js';
import type { Substrate } from '../../substrate/interfaces/substrate.js';
import type { OrchestrationTransitionService } from '../transitions/transition_service.js';

// ============================================================================
// S6: Mission Lifecycle States
// ============================================================================

/** S6: Mission lifecycle states -- 10 states, 3 terminal */
export type MissionState =
  | 'CREATED' | 'PLANNING' | 'EXECUTING' | 'REVIEWING'
  | 'COMPLETED' | 'PAUSED' | 'FAILED' | 'CANCELLED'
  | 'DEGRADED' | 'BLOCKED';

/** S6: Valid mission state transitions per lifecycle diagram */
export const MISSION_TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  CREATED:    ['PLANNING', 'CANCELLED'],
  PLANNING:   ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING:  ['REVIEWING', 'PAUSED', 'FAILED', 'CANCELLED', 'DEGRADED', 'BLOCKED'],
  REVIEWING:  ['COMPLETED', 'EXECUTING', 'FAILED'],
  COMPLETED:  [],
  PAUSED:     ['EXECUTING', 'CANCELLED'],
  FAILED:     [],
  CANCELLED:  [],
  DEGRADED:   ['EXECUTING', 'FAILED', 'CANCELLED'],
  BLOCKED:    ['EXECUTING', 'FAILED', 'CANCELLED'],
} as const;

// ============================================================================
// S7: Task Lifecycle States
// ============================================================================

/** S7: Task lifecycle states -- 7 states */
export type TaskState =
  | 'PENDING' | 'SCHEDULED' | 'RUNNING'
  | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BLOCKED';

/** S7: Valid task state transitions */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  PENDING:    ['SCHEDULED', 'CANCELLED', 'BLOCKED'],
  SCHEDULED:  ['RUNNING', 'CANCELLED'],
  RUNNING:    ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED:  [],
  FAILED:     ['PENDING'],  // retry
  CANCELLED:  [],
  BLOCKED:    ['PENDING'],
} as const;

// ============================================================================
// S8: Artifact Types
// ============================================================================

/** S8: Artifact lifecycle states */
export type ArtifactLifecycleState = 'ACTIVE' | 'SUMMARIZED' | 'ARCHIVED' | 'DELETED';

/** S18: Artifact types (from spec) */
export type ArtifactType = 'report' | 'data' | 'code' | 'analysis' | 'image' | 'raw';

/** S18: Artifact formats (from spec) */
export type ArtifactFormat = 'markdown' | 'json' | 'csv' | 'python' | 'sql' | 'html';

// ============================================================================
// S10: Event Types
// ============================================================================

/** S10: Event propagation direction */
export type PropagationDirection = 'up' | 'down' | 'local';

/** S10: Event scope */
export type EventScope = 'system' | 'mission' | 'task';

// ============================================================================
// S17: Execution Modes
// ============================================================================

/** S17: Execution modes */
export type ExecutionMode = 'deterministic' | 'stochastic' | 'hybrid';

// ============================================================================
// S24: Checkpoint Types
// ============================================================================

/** S24: Checkpoint trigger types */
export type CheckpointTrigger =
  | 'BUDGET_THRESHOLD' | 'TASK_COMPLETED' | 'TASK_FAILED'
  | 'CHILD_MISSION_COMPLETED' | 'HEARTBEAT_MISSED'
  | 'HUMAN_INPUT_RECEIVED' | 'PERIODIC';

/** S24: Agent-proposed actions at checkpoint */
export type CheckpointAction = 'continue' | 'replan' | 'escalate' | 'abort';

/** S24: System decision after processing checkpoint response */
export type CheckpointDecision =
  | 'continue' | 'replan_accepted' | 'replan_rejected'
  | 'escalated' | 'aborted';

// ============================================================================
// S26: Conversation Types
// ============================================================================

/** S26: Conversation turn roles */
export type ConversationRole = 'user' | 'assistant' | 'system' | 'tool';

// ============================================================================
// I-20: Mission Tree Constraint Defaults
// ============================================================================

/** I-20: Mission tree constraint defaults -- hard stops */
export const MISSION_TREE_DEFAULTS = {
  maxDepth: 5,
  maxChildren: 10,
  maxTotalMissions: 50, // I-20: "total nodes (max 50)"
  maxTasks: 50,
  maxPlanRevisions: 10,
  maxArtifacts: 100,
  budgetDecayFactor: 0.3,
} as const;

/** S24: Confidence-driven behavior thresholds */
export const CONFIDENCE_BANDS = {
  CONTINUE_AUTONOMOUS: { min: 0.8, max: 1.0 },
  CONTINUE_FLAGGED: { min: 0.5, max: 0.8 },
  PAUSE_HUMAN_INPUT: { min: 0.2, max: 0.5 },
  HALT_ESCALATE: { min: 0.0, max: 0.2 },
} as const;

// ============================================================================
// Domain Objects
// ============================================================================

/** S6: Mission domain object */
export interface Mission {
  readonly id: MissionId;
  readonly tenantId: TenantId | null;
  readonly parentId: MissionId | null;
  readonly agentId: AgentId;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly scopeBoundaries: readonly string[];
  readonly capabilities: readonly string[];
  readonly state: MissionState;
  readonly planVersion: number;
  readonly delegationChain: readonly string[];
  readonly constraints: MissionConstraints;
  readonly depth: number;
  readonly compacted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

/** S6/I-20: Mission constraints */
export interface MissionConstraints {
  readonly budget: number;
  readonly deadline: string;
  readonly maxTasks: number;
  readonly maxDepth: number;
  readonly maxChildren: number;
  readonly budgetDecayFactor: number;
}

/** S7: Task domain object */
export interface Task {
  readonly id: TaskId;
  readonly missionId: MissionId;
  readonly tenantId: TenantId | null;
  readonly graphId: string;
  readonly description: string;
  readonly executionMode: ExecutionMode;
  readonly estimatedTokens: number;
  readonly capabilitiesRequired: readonly string[];
  readonly state: TaskState;
  readonly assignedAgent: AgentId | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

/** S26: Conversation turn */
export interface ConversationTurn {
  readonly id: string;
  readonly conversationId: string;
  readonly turnNumber: number;
  readonly role: ConversationRole;
  readonly content: string;
  readonly tokenCount: number;
  readonly modelUsed: string | null;
  readonly isSummary: boolean;
  readonly isLearningSource: boolean;
  readonly participantId: string | null;
  readonly createdAt: string;
}

// ============================================================================
// SD-10: Dependency Injection
// ============================================================================

/**
 * SD-10: Explicit dependency injection for orchestration functions.
 * Every system call and internal module receives this as its first argument.
 */
export interface OrchestrationDeps {
  readonly conn: DatabaseConnection;
  readonly substrate: Substrate;
  readonly audit: AuditTrail;
  /** CF-007: Kernel rate limiter for SQLite-backed, persistent rate limiting. Optional for backward compatibility. */
  readonly rateLimiter?: RateLimiter;
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: TimeProvider;
}

// ============================================================================
// SC-1: propose_mission (S15)
// ============================================================================

/** S15: propose_mission input */
export interface ProposeMissionInput {
  parentMissionId: MissionId | null;
  agentId: AgentId;
  objective: string;
  successCriteria: string[];
  scopeBoundaries: string[];
  capabilities: string[];
  constraints: {
    budget: number;
    deadline: string;
    maxTasks?: number;
    maxDepth?: number;
    maxChildren?: number;
    budgetDecayFactor?: number;
  };
}

/** S15: propose_mission output */
export interface ProposeMissionOutput {
  missionId: MissionId;
  state: 'CREATED';
  allocated: {
    budget: number;
    capabilities: string[];
  };
}

/** S15: propose_mission error codes */
export type ProposeMissionError =
  | 'BUDGET_EXCEEDED'
  | 'DEPTH_EXCEEDED'
  | 'CHILDREN_EXCEEDED'
  | 'TREE_SIZE_EXCEEDED'
  | 'CAPABILITY_VIOLATION'
  | 'AGENT_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'DEADLINE_EXCEEDED'
  | 'DELEGATION_CYCLE';

// ============================================================================
// SC-2: propose_task_graph (S16)
// ============================================================================

/** S16: Task definition within a graph */
export interface TaskDefinition {
  id: TaskId;
  description: string;
  executionMode: ExecutionMode;
  estimatedTokens: number;
  capabilitiesRequired: string[];
}

/** S16: Task dependency edge */
export interface TaskDependency {
  from: TaskId;
  to: TaskId;
}

/** S16: propose_task_graph input */
export interface ProposeTaskGraphInput {
  missionId: MissionId;
  tasks: TaskDefinition[];
  dependencies: TaskDependency[];
  objectiveAlignment: string;
}

/** S16: Validation warning (non-blocking) */
export interface ValidationWarning {
  code: string;
  message: string;
  taskId?: string;
}

/** S16: propose_task_graph output */
export interface ProposeTaskGraphOutput {
  graphId: string;
  planVersion: number;
  taskCount: number;
  /** CQ-09 fix: S16 spec output includes validationWarnings: Warning[] */
  validationWarnings: ValidationWarning[];
}

/** S16: propose_task_graph error codes */
export type ProposeTaskGraphError =
  | 'CYCLE_DETECTED'
  | 'BUDGET_EXCEEDED'
  | 'TASK_LIMIT_EXCEEDED'
  | 'INVALID_DEPENDENCY'
  | 'CAPABILITY_VIOLATION'
  | 'MISSION_NOT_ACTIVE'
  | 'PLAN_REVISION_LIMIT'
  | 'UNAUTHORIZED';

// ============================================================================
// SC-3: propose_task_execution (S17)
// ============================================================================

/** S17: propose_task_execution input */
export interface ProposeTaskExecutionInput {
  taskId: TaskId;
  executionMode: ExecutionMode;
  environmentRequest: {
    capabilities: string[];
    timeout: number;
  };
}

/** S17: propose_task_execution output */
export interface ProposeTaskExecutionOutput {
  executionId: string;
  scheduledAt: string;
  workerId: string;
}

/** S17: propose_task_execution error codes */
export type ProposeTaskExecutionError =
  | 'DEPENDENCIES_UNMET'
  | 'BUDGET_EXCEEDED'
  | 'CAPABILITY_DENIED'
  | 'WORKER_UNAVAILABLE'
  | 'TASK_NOT_PENDING';

// ============================================================================
// SC-4: create_artifact (S18)
// ============================================================================

/** S18: create_artifact input */
export interface CreateArtifactInput {
  missionId: MissionId;
  name: string;
  type: ArtifactType;
  format: ArtifactFormat;
  content: string | Buffer;
  sourceTaskId: TaskId;
  parentArtifactId: ArtifactId | null;
  metadata: Record<string, unknown>;
}

/** S18: create_artifact output */
export interface CreateArtifactOutput {
  artifactId: ArtifactId;
  version: number;
}

/** S18: create_artifact error codes */
export type CreateArtifactError =
  | 'MISSION_NOT_ACTIVE'
  | 'STORAGE_EXCEEDED'
  | 'ARTIFACT_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED';

// ============================================================================
// SC-5: read_artifact (S19)
// ============================================================================

/** S19: read_artifact input */
export interface ReadArtifactInput {
  artifactId: ArtifactId;
  version: number | 'latest';
}

/** S19: read_artifact output */
export interface ReadArtifactOutput {
  artifact: {
    id: ArtifactId;
    version: number;
    missionId: MissionId;
    name: string;
    type: ArtifactType;
    format: ArtifactFormat;
    content: string | Buffer;
    lifecycleState: ArtifactLifecycleState;
    metadata: Record<string, unknown>;
  };
}

/** S19: read_artifact error codes */
export type ReadArtifactError =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'ARCHIVED';

// ============================================================================
// SC-6: emit_event (S20)
// ============================================================================

/** S20: emit_event input */
export interface EmitEventInput {
  eventType: string;
  missionId: MissionId;
  payload: Record<string, unknown>;
  propagation: PropagationDirection;
}

/** S20: emit_event output */
export interface EmitEventOutput {
  eventId: EventId;
  delivered: boolean;
}

/** S20: emit_event error codes */
export type EmitEventError =
  | 'RATE_LIMITED'
  | 'INVALID_TYPE'
  | 'INVALID_INPUT'
  | 'MISSION_NOT_FOUND';

// ============================================================================
// SC-7: request_capability (S21)
// ============================================================================

/** S21: request_capability input */
export interface RequestCapabilityInput {
  capabilityType: string;
  parameters: Record<string, unknown>;
  missionId: MissionId;
  taskId: TaskId;
}

/** S21: request_capability output */
export interface RequestCapabilityOutput {
  result: unknown;
  resourcesConsumed: {
    tokens?: number;
    time?: number;
    compute?: number;
    storage?: number;
  };
}

/** S21: request_capability error codes */
export type RequestCapabilityError =
  | 'CAPABILITY_DENIED'
  | 'BUDGET_EXCEEDED'
  | 'TIMEOUT'
  | 'SANDBOX_VIOLATION'
  | 'RATE_LIMITED';

// ============================================================================
// SC-8: request_budget (S22)
// ============================================================================

/** S22: request_budget input */
export interface RequestBudgetInput {
  missionId: MissionId;
  amount: {
    tokens?: number;
    time?: number;
    compute?: number;
    storage?: number;
  };
  justification: string;
}

/** S22: request_budget output */
export interface RequestBudgetOutput {
  approved: boolean;
  allocated: {
    tokens?: number;
    time?: number;
    compute?: number;
    storage?: number;
  };
  source: 'parent' | 'human';
}

/** S22: request_budget error codes */
export type RequestBudgetError =
  | 'PARENT_INSUFFICIENT'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'MISSION_NOT_ACTIVE'
  | 'JUSTIFICATION_REQUIRED'
  | 'INVALID_INPUT';

// ============================================================================
// SC-9: submit_result (S23)
// ============================================================================

/** S23: submit_result input */
export interface SubmitResultInput {
  missionId: MissionId;
  summary: string;
  confidence: number;
  artifactIds: ArtifactId[];
  unresolvedQuestions: string[];
  followupRecommendations: string[];
}

/** S23: submit_result output */
export interface SubmitResultOutput {
  resultId: string;
  missionState: 'COMPLETED' | 'REVIEWING';
}

/** S23: submit_result error codes */
export type SubmitResultError =
  | 'TASKS_INCOMPLETE'
  | 'NO_ARTIFACTS'
  | 'MISSION_NOT_ACTIVE'
  | 'UNAUTHORIZED'
  | 'INVALID_INPUT';

// ============================================================================
// SC-10: respond_checkpoint (S24)
// ============================================================================

/** S24: respond_checkpoint input */
export interface RespondCheckpointInput {
  checkpointId: string;
  assessment: string;
  confidence: number;
  proposedAction: CheckpointAction;
  planRevision: ProposeTaskGraphInput | null;
  escalationReason: string | null;
}

/** S24: respond_checkpoint output */
export interface RespondCheckpointOutput {
  action: CheckpointDecision;
  reason: string;
}

/** S24: respond_checkpoint error codes */
export type RespondCheckpointError =
  | 'CHECKPOINT_EXPIRED'
  | 'INVALID_PLAN';

// ============================================================================
// Internal Module Interfaces
// ============================================================================

/** S6: MissionStore -- Foundation store */
export interface MissionStore {
  /** S6: Create a new mission */
  create(deps: OrchestrationDeps, ctx: OperationContext, input: ProposeMissionInput): Result<ProposeMissionOutput>;
  /** S6: Transition mission state with validation */
  transition(deps: OrchestrationDeps, missionId: MissionId, from: MissionState, to: MissionState): Result<void>;
  /** S6: Get mission by id */
  get(deps: OrchestrationDeps, missionId: MissionId): Result<Mission>;
  /** S6: Get children of a mission */
  getChildren(deps: OrchestrationDeps, missionId: MissionId): Result<Mission[]>;
  /** I-20: Get depth of a mission */
  getDepth(deps: OrchestrationDeps, missionId: MissionId): Result<number>;
  /** I-20: Get children count */
  getChildrenCount(deps: OrchestrationDeps, missionId: MissionId): Result<number>;
  /** I-20: Get root mission id for a mission */
  getRootMissionId(deps: OrchestrationDeps, missionId: MissionId): Result<MissionId>;
}

/** S7/S16: TaskGraphEngine -- Task DAG validation and management */
export interface TaskGraphEngine {
  /** S16: Validate and install a new task graph (Kahn's algorithm) */
  proposeGraph(deps: OrchestrationDeps, ctx: OperationContext, input: ProposeTaskGraphInput): Result<ProposeTaskGraphOutput>;
  /** S7: Get task by id */
  getTask(deps: OrchestrationDeps, taskId: TaskId): Result<Task>;
  /** S7: Get tasks for a mission's active graph */
  getActiveTasks(deps: OrchestrationDeps, missionId: MissionId): Result<Task[]>;
  /** S7: Transition task state */
  transitionTask(deps: OrchestrationDeps, taskId: TaskId, from: TaskState, to: TaskState): Result<void>;
  /** S16: Check if all dependencies for a task are satisfied */
  areDependenciesMet(deps: OrchestrationDeps, taskId: TaskId): Result<boolean>;
}

/** S8: ArtifactStore -- Immutable artifact workspace */
export interface ArtifactStore {
  /** S18: Create artifact (always INSERT, never UPDATE) */
  create(deps: OrchestrationDeps, ctx: OperationContext, input: CreateArtifactInput): Result<CreateArtifactOutput>;
  /** S19: Read artifact */
  read(deps: OrchestrationDeps, ctx: OperationContext, input: ReadArtifactInput): Result<ReadArtifactOutput>;
  /** I-23: Track dependency edge */
  trackDependency(deps: OrchestrationDeps, readingMissionId: MissionId, artifactId: ArtifactId, version: number, isCrossMission: boolean): Result<void>;
  /** FM-15: Get artifact count for mission */
  getArtifactCount(deps: OrchestrationDeps, missionId: MissionId): Result<number>;
  /** I-21: Archive artifacts for compaction */
  archiveForMission(deps: OrchestrationDeps, missionId: MissionId): Result<number>;
}

/** S11/I-20: BudgetGovernor -- Resource management */
export interface BudgetGovernor {
  /** S11: Allocate budget for a new mission */
  allocate(deps: OrchestrationDeps, missionId: MissionId, budget: number, deadline: string): Result<void>;
  /** S11: Consume resources */
  consume(deps: OrchestrationDeps, missionId: MissionId, amount: { tokens?: number; time?: number; compute?: number; storage?: number }): Result<void>;
  /** S22: Request additional budget from parent */
  requestFromParent(deps: OrchestrationDeps, missionId: MissionId, amount: number, justification: string): Result<RequestBudgetOutput>;
  /** S11: Check if budget allows estimated cost */
  checkBudget(deps: OrchestrationDeps, missionId: MissionId, estimatedCost: number): Result<boolean>;
  /** S11: Get remaining budget */
  getRemaining(deps: OrchestrationDeps, missionId: MissionId): Result<number>;
}

/** S10: EventPropagator -- Event routing */
export interface EventPropagator {
  /** S10: Emit and propagate an event (agent-callable) */
  emit(deps: OrchestrationDeps, ctx: OperationContext, input: EmitEventInput): Result<EmitEventOutput>;
  /** S10: Emit a lifecycle event (orchestrator-only) */
  emitLifecycle(deps: OrchestrationDeps, type: string, missionId: MissionId, payload: Record<string, unknown>): Result<EventId>;
}

/** S24: CheckpointCoordinator -- Checkpoint lifecycle */
export interface CheckpointCoordinator {
  /** S24: Fire a checkpoint for a mission */
  fire(deps: OrchestrationDeps, missionId: MissionId, trigger: CheckpointTrigger, detail?: unknown): Result<string>;
  /** S24: Process agent's response to a checkpoint */
  processResponse(deps: OrchestrationDeps, input: RespondCheckpointInput): Result<RespondCheckpointOutput>;
  /** S24: Expire overdue checkpoints */
  expireOverdue(deps: OrchestrationDeps): Result<number>;
}

/** I-21: CompactionEngine -- Bounded cognition */
export interface CompactionEngine {
  /** I-21: Eagerly compact a completed subtree in same transaction */
  compactSubtree(deps: OrchestrationDeps, completedMissionId: MissionId): Result<void>;
  /** I-21: Get working set (non-compacted, active missions) */
  getWorkingSet(deps: OrchestrationDeps, rootMissionId: MissionId): Result<MissionId[]>;
}

/** S26: ConversationManager -- Conversation history */
export interface ConversationManager {
  /** S26: Create a new conversation */
  create(deps: OrchestrationDeps, sessionId: SessionId, agentId: AgentId, tenantId: TenantId | null): Result<string>;
  /** S26.1: Append a turn to conversation */
  appendTurn(deps: OrchestrationDeps, conversationId: string, turn: {
    role: ConversationRole;
    content: string;
    tokenCount: number;
    modelUsed?: string;
    isLearningSource?: boolean;
    participantId?: string;
  }): Result<number>;
  /** S26.2: Auto-summarize if threshold exceeded */
  autoSummarize(deps: OrchestrationDeps, conversationId: string, contextWindowTokens: number): Result<boolean>;
  /** S26.3: Fork a conversation at a turn (copy-on-branch) */
  fork(deps: OrchestrationDeps, conversationId: string, atTurn: number, tenantId: TenantId | null): Result<string>;
  /** S26: Get conversation turns for context assembly */
  getTurns(deps: OrchestrationDeps, conversationId: string): Result<ConversationTurn[]>;
}

/** FM-19: DelegationDetector -- Cycle detection */
export interface DelegationDetector {
  /** FM-19: Check if assigning agentId would create a delegation cycle */
  checkCycle(deps: OrchestrationDeps, parentMissionId: MissionId, agentId: AgentId): Result<boolean>;
  /** FM-19: Get the delegation chain for a mission */
  getChain(deps: OrchestrationDeps, missionId: MissionId): Result<string[]>;
}

// ============================================================================
// SD-10: OrchestrationEngine Facade
// ============================================================================

/**
 * SD-10: Public facade for the orchestration layer.
 * Constructs OrchestrationDeps internally and exposes the 10 system calls
 * plus internal subsystem accessors.
 */
export interface OrchestrationEngine {
  // 10 System Calls (public API)
  proposeMission(ctx: OperationContext, input: ProposeMissionInput): Result<ProposeMissionOutput>;
  proposeTaskGraph(ctx: OperationContext, input: ProposeTaskGraphInput): Result<ProposeTaskGraphOutput>;
  proposeTaskExecution(ctx: OperationContext, input: ProposeTaskExecutionInput): Result<ProposeTaskExecutionOutput>;
  createArtifact(ctx: OperationContext, input: CreateArtifactInput): Result<CreateArtifactOutput>;
  readArtifact(ctx: OperationContext, input: ReadArtifactInput): Result<ReadArtifactOutput>;
  emitEvent(ctx: OperationContext, input: EmitEventInput): Result<EmitEventOutput>;
  requestCapability(ctx: OperationContext, input: RequestCapabilityInput): Result<RequestCapabilityOutput>;
  requestBudget(ctx: OperationContext, input: RequestBudgetInput): Result<RequestBudgetOutput>;
  submitResult(ctx: OperationContext, input: SubmitResultInput): Result<SubmitResultOutput>;
  respondCheckpoint(ctx: OperationContext, input: RespondCheckpointInput): Result<RespondCheckpointOutput>;

  // Internal subsystem access
  readonly missions: MissionStore;
  readonly taskGraph: TaskGraphEngine;
  readonly artifacts: ArtifactStore;
  readonly budget: BudgetGovernor;
  readonly checkpoints: CheckpointCoordinator;
  readonly compaction: CompactionEngine;
  readonly events: EventPropagator;
  readonly conversations: ConversationManager;
  readonly delegation: DelegationDetector;
  /** P0-A: Sole mechanism for mission/task state transitions at L2. */
  readonly transitions: OrchestrationTransitionService;
}

// ============================================================================
// Helper: UUID generation (deterministic layer utility)
// ============================================================================

/** Generate a UUID v4 using node:crypto for I-25 deterministic replay compliance */
export function generateId(): string {
  // Use crypto.randomUUID for standard UUID v4 generation
  return globalThis.crypto.randomUUID();
}
