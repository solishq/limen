/**
 * SystemCallClient -- thin wrapper over MissionHandle system call methods.
 * S ref: S14 (interface design principles), SD-07 (thin wrapper rationale),
 *        SD-05 (error taxonomy)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §6.2 (System Call Client Interface), §6.3 (Error Code Classification)
 *
 * This wrapper provides:
 *   - Structured error classification (every error code categorized per SD-05)
 *   - Transient-error retry with exponential backoff (WORKER_UNAVAILABLE, RATE_LIMITED)
 *   - Consistent logging pattern for debugging
 *
 * This wrapper does NOT:
 *   - Cache state (would violate I-17 by creating shadow authority)
 *   - Validate beyond spec (orchestrator validates; agent does not second-guess)
 *   - Extend capabilities (pure passthrough to MissionHandle methods)
 *
 * Invariants enforced: I-17 (governance boundary -- pure passthrough)
 * Failure modes defended: FM-02 (cost explosion -- retry limits prevent waste)
 */

import type {
  MissionHandle,
  MissionCreateOptions,
  TaskGraphInput, TaskGraphOutput,
  TaskExecutionInput, TaskExecutionOutput,
  ArtifactCreateInput, ArtifactCreateOutput,
  ArtifactReadInput, ArtifactReadOutput,
  EventEmitInput, EventEmitOutput,
  CapabilityRequestInput, CapabilityRequestOutput,
  BudgetRequestInput, BudgetRequestOutput,
  ResultSubmitInput, ResultSubmitOutput,
  CheckpointResponseInput, CheckpointResponseOutput,
  LimenErrorCode,
} from './reference_agent.types.js';

import type { ClassifiedError, ErrorCategory } from './reference_agent.types.js';

// ============================================================================
// Error Classification (SD-05)
// ============================================================================

/**
 * SD-05: Exhaustive error code classification.
 * Every error code from S15-S24 is mapped to exactly one category.
 *
 * Retryable: transient infrastructure failures -- retry with backoff.
 * Recoverable: agent can restructure and retry with a different approach.
 * Terminal: cannot recover -- abort or escalate.
 */
const ERROR_CLASSIFICATION: ReadonlyMap<LimenErrorCode, ErrorCategory> = new Map<LimenErrorCode, ErrorCategory>([
  // Retryable (transient infrastructure)
  ['WORKER_UNAVAILABLE', 'retryable'],
  ['RATE_LIMITED', 'retryable'],

  // Recoverable (agent can adapt)
  ['BUDGET_EXCEEDED', 'recoverable'],
  ['TASK_LIMIT_EXCEEDED', 'recoverable'],
  ['PLAN_REVISION_LIMIT', 'recoverable'],
  ['CAPABILITY_DENIED', 'recoverable'],
  ['STORAGE_EXCEEDED', 'recoverable'],
  ['ARTIFACT_LIMIT_EXCEEDED', 'recoverable'],
  ['CHECKPOINT_EXPIRED', 'recoverable'],
  ['INVALID_PLAN', 'recoverable'],
  ['PARENT_INSUFFICIENT', 'recoverable'],
  ['HUMAN_APPROVAL_REQUIRED', 'recoverable'],
  ['DEPENDENCIES_UNMET', 'recoverable'],
  ['ARCHIVED', 'recoverable'],
  ['JUSTIFICATION_REQUIRED', 'recoverable'],

  // Terminal (cannot recover)
  ['CYCLE_DETECTED', 'terminal'],
  ['CAPABILITY_VIOLATION', 'terminal'],
  ['DEPTH_EXCEEDED', 'terminal'],
  ['CHILDREN_EXCEEDED', 'terminal'],
  ['TREE_SIZE_EXCEEDED', 'terminal'],
  ['AGENT_NOT_FOUND', 'terminal'],
  ['UNAUTHORIZED', 'terminal'],
  ['DEADLINE_EXCEEDED', 'terminal'],
  ['MISSION_NOT_ACTIVE', 'terminal'],
  ['INVALID_DEPENDENCY', 'terminal'],
  ['TASKS_INCOMPLETE', 'terminal'],
  ['NO_ARTIFACTS', 'terminal'],
  ['NOT_FOUND', 'terminal'],
  ['INVALID_TYPE', 'terminal'],
  ['MISSION_NOT_FOUND', 'terminal'],
  ['TASK_NOT_PENDING', 'terminal'],
  ['TIMEOUT', 'terminal'],
  ['SANDBOX_VIOLATION', 'terminal'],
  ['DELEGATION_CYCLE', 'terminal'],

  // API surface errors (pass-through, classified as terminal)
  ['CANCELLED', 'terminal'],
  ['PROVIDER_UNAVAILABLE', 'recoverable'],
  ['SCHEMA_VALIDATION_FAILED', 'terminal'],
  ['ENGINE_UNHEALTHY', 'terminal'],
  ['SESSION_NOT_FOUND', 'terminal'],
  ['INVALID_CONFIG', 'terminal'],
]);

/**
 * SD-05: Classify an error code into the three-category taxonomy.
 * Unknown codes default to 'terminal' for safety.
 *
 * @param code - The LimenErrorCode to classify
 * @returns The error category
 */
export function classifyError(code: LimenErrorCode): ErrorCategory {
  return ERROR_CLASSIFICATION.get(code) ?? 'terminal';
}

/**
 * SD-05: Create a ClassifiedError from a caught error.
 *
 * @param error - The caught error (from system call rejection)
 * @returns Structured ClassifiedError with category
 */
export function toClassifiedError(error: unknown): ClassifiedError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const e = error as { code: LimenErrorCode; message: string; retryable?: boolean };
    const category = classifyError(e.code);
    return {
      code: e.code,
      message: e.message,
      category,
      retryable: category === 'retryable',
    };
  }

  // Unknown error shape -- treat as terminal
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'ENGINE_UNHEALTHY' as LimenErrorCode,
    message,
    category: 'terminal',
    retryable: false,
  };
}

// ============================================================================
// Retry Logic (SD-07)
// ============================================================================

/**
 * SD-07: Retry a system call with exponential backoff for transient errors.
 *
 * Only retries errors classified as 'retryable' (WORKER_UNAVAILABLE, RATE_LIMITED).
 * Recoverable and terminal errors are NOT retried -- they require agent restructuring
 * or escalation, respectively.
 *
 * @param fn - The async operation to retry
 * @param maxRetries - Maximum retry attempts (default 3)
 * @returns The result of the operation
 * @throws ClassifiedError if all retries exhausted or non-retryable error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: ClassifiedError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = toClassifiedError(error);

      if (lastError.category !== 'retryable') {
        throw lastError;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 100ms, 200ms, 400ms, ...
        const delayMs = 100 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted
  throw lastError!;
}

// ============================================================================
// System Call Client (SD-07)
// ============================================================================

/**
 * SD-07, S14: System call client wrapping MissionHandle methods.
 *
 * Pure passthrough convenience wrapper. Does NOT add state caching,
 * validation beyond spec, or capability extension.
 *
 * Each method:
 *   1. Delegates to the corresponding MissionHandle method
 *   2. Applies retry logic for retryable errors
 *   3. Classifies errors for the caller
 *
 * I-17: This wrapper is a pure convenience layer. It adds no capabilities
 * beyond what MissionHandle provides. It does not create shadow authority.
 */
export class SystemCallClient {
  private readonly handle: MissionHandle;
  private readonly maxRetries: number;

  constructor(handle: MissionHandle, maxRetries: number = 3) {
    this.handle = handle;
    this.maxRetries = maxRetries;
  }

  /**
   * §15, SC-1, DR-P5-003: Propose (create) a mission via limen.missions.create().
   *
   * Static method because SC-1 executes BEFORE a MissionHandle exists.
   * The returned handle is then used to construct a SystemCallClient instance
   * for SC-2 through SC-10.
   *
   * @param missions - The limen.missions API object
   * @param options - Mission creation options
   * @param maxRetries - Maximum retry attempts for transient errors
   * @returns MissionHandle for the created mission
   */
  static async proposeMission(
    missions: { create(options: MissionCreateOptions): Promise<MissionHandle> },
    options: MissionCreateOptions,
    maxRetries: number = 3,
  ): Promise<MissionHandle> {
    return withRetry(() => missions.create(options), maxRetries);
  }

  /** §15: Get the mission handle for direct access when needed. */
  getHandle(): MissionHandle {
    return this.handle;
  }

  /** §16, SC-2: Propose a task graph with retry for transient errors. */
  async proposeTaskGraph(input: TaskGraphInput): Promise<TaskGraphOutput> {
    return withRetry(() => this.handle.proposeTaskGraph(input), this.maxRetries);
  }

  /** §17, SC-3: Propose task execution with retry for transient errors. */
  async proposeTaskExecution(input: TaskExecutionInput): Promise<TaskExecutionOutput> {
    return withRetry(() => this.handle.proposeTaskExecution(input), this.maxRetries);
  }

  /** §18, SC-4: Create an artifact with retry for transient errors. */
  async createArtifact(input: ArtifactCreateInput): Promise<ArtifactCreateOutput> {
    return withRetry(() => this.handle.createArtifact(input), this.maxRetries);
  }

  /** §19, SC-5: Read an artifact with retry for transient errors. */
  async readArtifact(input: ArtifactReadInput): Promise<ArtifactReadOutput> {
    return withRetry(() => this.handle.readArtifact(input), this.maxRetries);
  }

  /** §20, SC-6: Emit an event with retry for transient errors. */
  async emitEvent(input: EventEmitInput): Promise<EventEmitOutput> {
    return withRetry(() => this.handle.emitEvent(input), this.maxRetries);
  }

  /** §21, SC-7: Request a capability with retry for transient errors. */
  async requestCapability(input: CapabilityRequestInput): Promise<CapabilityRequestOutput> {
    return withRetry(() => this.handle.requestCapability(input), this.maxRetries);
  }

  /** §22, SC-8: Request additional budget with retry for transient errors. */
  async requestBudget(input: BudgetRequestInput): Promise<BudgetRequestOutput> {
    return withRetry(() => this.handle.requestBudget(input), this.maxRetries);
  }

  /** §23, SC-9: Submit mission result with retry for transient errors. */
  async submitResult(input: ResultSubmitInput): Promise<ResultSubmitOutput> {
    return withRetry(() => this.handle.submitResult(input), this.maxRetries);
  }

  /** §24, SC-10: Respond to a checkpoint with retry for transient errors. */
  async respondCheckpoint(input: CheckpointResponseInput): Promise<CheckpointResponseOutput> {
    return withRetry(() => this.handle.respondCheckpoint(input), this.maxRetries);
  }
}
