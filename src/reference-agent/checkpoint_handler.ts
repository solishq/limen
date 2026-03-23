/**
 * CheckpointHandler -- governance response during mission execution.
 * S ref: S24 (respond_checkpoint), S20 (emit_event), S22 (request_budget),
 *        SD-01 (lifecycle-phase grouping), SD-04 (LLM-preferred assessment)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §10 Build Order Step 4 (CheckpointHandler)
 *
 * The CheckpointHandler is responsible for:
 *   1. Responding to checkpoints via SC-10 (respond_checkpoint)
 *   2. Emitting agent events via SC-6 (emit_event)
 *   3. Requesting additional budget via SC-8 (request_budget)
 *   4. Computing confidence and assessment (heuristic or LLM)
 *   5. Deciding action: continue / replan / escalate / abort
 *
 * These three calls (respond_checkpoint, emit_event, request_budget) are
 * the "governance" calls that maintain ALIGNMENT during execution. They
 * are responses to system pressure, not agent-initiated planning.
 *
 * Invariants enforced: I-17 (governance boundary),
 *                      I-24 (goal anchoring -- assessment against objective)
 * Failure modes defended: FM-02 (budget request before exceeding),
 *                         FM-14 (semantic drift -- checkpoint assessment),
 *                         FM-16 (mission drift -- confidence-driven escalation)
 */

import type {
  MissionId, TaskId,
  CheckpointResponseInput, CheckpointResponseOutput,
  EventEmitInput, EventEmitOutput,
  BudgetRequestInput, BudgetRequestOutput,
  CapabilityRequestInput,
  TaskGraphInput,
  AgentExecutionState, CheckpointRecord,
  CheckpointAssessmentMode,
} from './reference_agent.types.js';

import {
  ESCALATION_CONFIDENCE_THRESHOLD,
  BUDGET_CHECKPOINT_THRESHOLDS,
} from './reference_agent.types.js';

import { SystemCallClient } from './system_call_client.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';

// ============================================================================
// LLM Assessment Response Validation (SD-04)
// ============================================================================

/** Valid actions that the LLM assessment can suggest. */
const VALID_SUGGESTED_ACTIONS = new Set(['continue', 'replan', 'escalate', 'abort']);

/**
 * SD-04: Expected shape of LLM assessment response.
 * Used for runtime validation of the untyped `result` from requestCapability.
 */
interface LlmAssessmentResponse {
  readonly assessment: string;
  readonly confidence: number;
  readonly suggestedAction: 'continue' | 'replan' | 'escalate' | 'abort';
}

/**
 * SD-04: Validate that the LLM response matches the expected assessment schema.
 * Returns the validated response or null if validation fails.
 *
 * Validation rules:
 *   - assessment must be a non-empty string
 *   - confidence must be a number (clamped to [0, 1] if outside range)
 *   - suggestedAction must be one of: 'continue', 'replan', 'escalate', 'abort'
 *
 * @param result - Untyped result from requestCapability
 * @returns Validated response with confidence clamped to [0, 1], or null
 */
export function validateLlmAssessmentResponse(
  result: unknown,
): LlmAssessmentResponse | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;

  // assessment: non-empty string
  if (typeof r['assessment'] !== 'string' || r['assessment'].length === 0) return null;

  // confidence: number (will be clamped)
  if (typeof r['confidence'] !== 'number' || Number.isNaN(r['confidence'])) return null;

  // suggestedAction: valid enum
  if (typeof r['suggestedAction'] !== 'string' || !VALID_SUGGESTED_ACTIONS.has(r['suggestedAction'])) return null;

  // Clamp confidence to [0, 1]
  const clampedConfidence = Math.min(1, Math.max(0, r['confidence']));

  return {
    assessment: r['assessment'],
    confidence: clampedConfidence,
    suggestedAction: r['suggestedAction'] as LlmAssessmentResponse['suggestedAction'],
  };
}

// ============================================================================
// Confidence Computation (SD-04)
// ============================================================================

/**
 * SD-04: Compute confidence heuristically from execution state.
 *
 * Heuristic factors:
 *   - Task completion ratio (completed / total)
 *   - Budget consumption ratio (consumed / allocated)
 *   - Artifact production (at least one artifact = positive signal)
 *   - Plan stability (fewer revisions = higher confidence)
 *
 * @param state - Agent execution state
 * @returns Confidence score in [0.0, 1.0]
 */
export function computeHeuristicConfidence(state: AgentExecutionState): number {
  const totalTasks = state.activeTaskIds.size + state.completedTaskIds.size;
  if (totalTasks === 0) return 0.5; // No tasks yet -- neutral

  // Factor 1: Task completion (40% weight)
  const completionRatio = state.completedTaskIds.size / totalTasks;
  const completionScore = completionRatio * 0.4;

  // Factor 2: Budget efficiency (30% weight)
  // Good if we're on track: consumed / allocated roughly matches completion
  const budgetRatio = state.budgetAllocated > 0
    ? state.budgetConsumed / state.budgetAllocated
    : 0;
  const budgetEfficiency = completionRatio > 0
    ? Math.min(1, completionRatio / Math.max(budgetRatio, 0.01))
    : 1;
  const budgetScore = budgetEfficiency * 0.3;

  // Factor 3: Artifact production (15% weight)
  const hasArtifacts = state.completedArtifactIds.length > 0;
  const artifactScore = hasArtifacts ? 0.15 : 0;

  // Factor 4: Plan stability (15% weight)
  const planStability = Math.max(0, 1 - (state.planRevisionCount * 0.2));
  const planScore = planStability * 0.15;

  return Math.min(1, Math.max(0, completionScore + budgetScore + artifactScore + planScore));
}

/**
 * SD-04: Generate a heuristic assessment string.
 *
 * I-24: The assessment always references the original objective
 * to maintain goal anchoring.
 *
 * @param state - Agent execution state
 * @param confidence - Computed confidence score
 * @returns Human-readable assessment string
 */
export function generateHeuristicAssessment(
  state: AgentExecutionState,
  confidence: number,
): string {
  const totalTasks = state.activeTaskIds.size + state.completedTaskIds.size;
  const completedCount = state.completedTaskIds.size;
  const artifactCount = state.completedArtifactIds.length;
  const budgetPct = state.budgetAllocated > 0
    ? Math.round((state.budgetConsumed / state.budgetAllocated) * 100)
    : 0;

  let assessment = `Mission "${state.objective}": `;
  assessment += `${completedCount}/${totalTasks} tasks complete, `;
  assessment += `${artifactCount} artifacts produced, `;
  assessment += `${budgetPct}% budget consumed. `;

  if (confidence >= 0.8) {
    assessment += 'On track -- proceeding as planned.';
  } else if (confidence >= ESCALATION_CONFIDENCE_THRESHOLD) {
    assessment += 'Progress is acceptable but slower than expected.';
  } else {
    assessment += 'Confidence low -- mission may need replanning or escalation.';
  }

  return assessment;
}

// ============================================================================
// Action Decision (§24, FM-14, FM-16)
// ============================================================================

/**
 * §24: Determine the appropriate checkpoint action based on state and trigger.
 *
 * FM-16: Escalates when confidence drops below ESCALATION_CONFIDENCE_THRESHOLD (0.5).
 * FM-14: Replans when stale data is detected.
 *
 * @param trigger - What caused the checkpoint (BUDGET_THRESHOLD, TASK_FAILED, etc.)
 * @param confidence - Current confidence score
 * @param state - Agent execution state
 * @returns The proposed action
 */
export function decideCheckpointAction(
  trigger: string,
  confidence: number,
  state: AgentExecutionState,
): 'continue' | 'replan' | 'escalate' | 'abort' {
  // FM-16: Low confidence -> escalate
  if (confidence < ESCALATION_CONFIDENCE_THRESHOLD) {
    return 'escalate';
  }

  switch (trigger) {
    case 'BUDGET_THRESHOLD': {
      // UC-12: Budget checkpoints at 25/50/75/90%
      const budgetRatio = state.budgetAllocated > 0
        ? state.budgetConsumed / state.budgetAllocated
        : 0;

      if (budgetRatio >= 0.9) {
        // 90%+ consumed: abort if confidence is not high
        return confidence >= 0.8 ? 'continue' : 'escalate';
      }
      if (budgetRatio >= 0.75) {
        // 75%+ consumed: consider replanning to reduce scope
        return confidence >= 0.7 ? 'continue' : 'replan';
      }
      return 'continue';
    }

    case 'TASK_FAILED':
      // A task failed: replan to work around the failure
      return 'replan';

    case 'TASK_COMPLETED':
    case 'CHILD_MISSION_COMPLETED':
      // Progress signal: continue if confident
      return 'continue';

    case 'PERIODIC':
    case 'HEARTBEAT_MISSED':
      // Routine check: continue if on track
      return confidence >= 0.6 ? 'continue' : 'replan';

    case 'HUMAN_INPUT_RECEIVED':
      // Human provided input: continue with updated context
      return 'continue';

    default:
      return 'continue';
  }
}

// ============================================================================
// CheckpointHandler Class
// ============================================================================

/**
 * SD-01: CheckpointHandler groups respond_checkpoint + emit_event + request_budget.
 * These are the "governance" calls used during EXECUTING phase.
 *
 * Checkpoint handling flow:
 *   1. Compute confidence from execution state
 *   2. Generate assessment (heuristic or LLM)
 *   3. Decide action based on trigger and confidence
 *   4. Submit response via respond_checkpoint
 *   5. Record checkpoint in history for self-reflection
 */
export class CheckpointHandler {
  private readonly client: SystemCallClient;
  readonly assessmentMode: CheckpointAssessmentMode;
  private readonly clock: TimeProvider;

  constructor(
    client: SystemCallClient,
    assessmentMode: CheckpointAssessmentMode = 'heuristic',
    time?: TimeProvider,
  ) {
    this.client = client;
    this.assessmentMode = assessmentMode;
    this.clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  }

  /**
   * §24, SC-10: Handle a checkpoint event.
   *
   * I-24: Assessment always references the mission objective.
   * FM-14: Detects semantic drift via confidence computation.
   * FM-16: Escalates on low confidence.
   *
   * @param checkpointId - The checkpoint to respond to
   * @param trigger - What caused the checkpoint
   * @param state - Agent execution state
   * @param planRevision - Optional revised task graph (for replan action)
   * @returns CheckpointResponseOutput from the system
   */
  async handleCheckpoint(
    checkpointId: string,
    trigger: string,
    state: AgentExecutionState,
    planRevision?: TaskGraphInput,
  ): Promise<CheckpointResponseOutput> {
    // SD-04: Assessment mode determines confidence/assessment computation.
    // LLM-preferred uses requestCapability (SC-7) for richer assessment.
    // Heuristic uses deterministic computation.
    // I-16: LLM-preferred falls back to heuristic on ANY error.
    let confidence: number;
    let assessment: string;

    if (this.assessmentMode === 'llm-preferred') {
      const llmResult = await this.computeLlmAssessment(state);
      if (llmResult !== null) {
        // LLM assessment succeeded -- use LLM-provided values.
        // Note: suggestedAction from LLM is informational. The deterministic
        // decideCheckpointAction() still governs the actual action.
        confidence = llmResult.confidence;
        assessment = llmResult.assessment;
      } else {
        // I-16: LLM assessment failed -- graceful degradation to heuristic.
        confidence = computeHeuristicConfidence(state);
        assessment = generateHeuristicAssessment(state, confidence);
      }
    } else {
      confidence = computeHeuristicConfidence(state);
      assessment = generateHeuristicAssessment(state, confidence);
    }

    const proposedAction = decideCheckpointAction(trigger, confidence, state);

    const response: CheckpointResponseInput = {
      checkpointId,
      assessment,
      confidence,
      proposedAction,
      ...(proposedAction === 'replan' && planRevision != null ? { planRevision } : {}),
      ...(proposedAction === 'escalate'
        ? { escalationReason:
            `Confidence ${confidence.toFixed(2)} below threshold ${ESCALATION_CONFIDENCE_THRESHOLD}. ` +
            `Objective: "${state.objective}"` }
        : {}),
    };

    const result = await this.client.respondCheckpoint(response);

    // Record checkpoint in history for self-reflection
    const record: CheckpointRecord = {
      checkpointId,
      trigger,
      assessment,
      confidence,
      action: result.action,
      timestamp: this.clock.nowMs(),
    };
    state.checkpointHistory.push(record);

    return result;
  }

  /**
   * §20, SC-6: Emit an agent event.
   *
   * Only non-lifecycle events are allowed (§10 rule):
   *   - 'data.invalid': Signal that data has changed
   *   - 'plan.needs_revision': Signal need for replanning
   *   - 'human.input_needed': Request human attention
   *
   * System/lifecycle events (system.*, lifecycle.*) are reserved for the
   * orchestrator. The agent NEVER emits them (I-17, §10).
   *
   * SEC-P5-001: Agent-side namespace validation. The system also validates,
   * but we fail fast to prevent the agent from even attempting to emit
   * reserved events.
   *
   * @param eventType - The event type (must not start with 'system.' or 'lifecycle.')
   * @param missionId - Mission context
   * @param payload - Event payload
   * @param propagation - How the event propagates (up/down/local)
   * @returns EventEmitOutput
   * @throws Error if eventType uses a reserved namespace
   */
  async emitEvent(
    eventType: string,
    missionId: MissionId,
    payload: Record<string, unknown>,
    propagation: 'up' | 'down' | 'local' = 'local',
  ): Promise<EventEmitOutput> {
    // SEC-P5-001: Guard against reserved namespaces (I-17, §10).
    if (eventType.startsWith('system.') || eventType.startsWith('lifecycle.')) {
      throw new Error(
        `Agent cannot emit events in reserved namespace "${eventType.split('.')[0]}.*". ` +
        `Only the orchestrator may emit system/lifecycle events (I-17, §10).`,
      );
    }

    const input: EventEmitInput = {
      eventType,
      missionId,
      payload,
      propagation,
    };

    return this.client.emitEvent(input);
  }

  /**
   * §22, SC-8: Request additional budget.
   *
   * FM-02: The agent requests budget BEFORE exceeding allocation,
   * not after. Budget can never go negative.
   *
   * @param missionId - Mission context
   * @param amount - Amount of additional resources needed
   * @param justification - Why additional budget is needed
   * @returns BudgetRequestOutput with approval status
   */
  async requestBudget(
    missionId: MissionId,
    amount: { tokens?: number; time?: number; compute?: number; storage?: number },
    justification: string,
  ): Promise<BudgetRequestOutput> {
    const input: BudgetRequestInput = {
      missionId,
      amount,
      justification,
    };

    const result = await this.client.requestBudget(input);

    return result;
  }

  /**
   * UC-12: Check if a budget checkpoint should be triggered.
   *
   * Budget checkpoints fire at 25%, 50%, 75%, 90% consumption.
   * The agent tracks these internally because the system may or may
   * not fire them at exact thresholds.
   *
   * DR-P5-012: Uses state.crossedBudgetThresholds Set for explicit tracking.
   * The previous implementation used fragile checkpoint history counting.
   *
   * @param state - Agent execution state
   * @returns The threshold that was just crossed, or null
   */
  checkBudgetThreshold(state: AgentExecutionState): number | null {
    if (state.budgetAllocated === 0) return null;

    const ratio = state.budgetConsumed / state.budgetAllocated;

    for (const threshold of BUDGET_CHECKPOINT_THRESHOLDS) {
      // DR-P5-012: Check if we crossed this threshold and haven't tracked it yet
      if (ratio >= threshold && !state.crossedBudgetThresholds.has(threshold)) {
        state.crossedBudgetThresholds.add(threshold);
        return threshold;
      }
    }

    return null;
  }

  /**
   * SD-04: Compute LLM-based assessment via requestCapability (SC-7).
   *
   * Builds an execution state summary and sends it to the LLM for assessment.
   * The LLM returns confidence, assessment text, and a suggested action.
   *
   * I-24: The prompt includes the mission objective for goal anchoring.
   * I-16: Returns null on ANY error, allowing the caller to fall back to heuristic.
   *
   * @param state - Agent execution state
   * @returns Validated LLM assessment response, or null on any failure
   */
  private async computeLlmAssessment(
    state: AgentExecutionState,
  ): Promise<LlmAssessmentResponse | null> {
    try {
      const syntheticTaskId = `task-${(state.missionId as string).replace(/^mission-/, '')}-llm-assess` as TaskId;

      const totalTasks = state.activeTaskIds.size + state.completedTaskIds.size;
      const executionSummary = {
        objective: state.objective,
        tasksCompleted: state.completedTaskIds.size,
        tasksTotal: totalTasks,
        budgetConsumed: state.budgetConsumed,
        budgetAllocated: state.budgetAllocated,
        artifactsProduced: state.completedArtifactIds.length,
        planRevisionCount: state.planRevisionCount,
        checkpointCount: state.checkpointHistory.length,
      };

      const input: CapabilityRequestInput = {
        capabilityType: 'api_call',
        parameters: {
          prompt: `Assess the current execution state of a mission.\n\n` +
            `Objective: "${state.objective}"\n` +
            `Tasks completed: ${executionSummary.tasksCompleted}/${executionSummary.tasksTotal}\n` +
            `Budget consumed: ${executionSummary.budgetConsumed}/${executionSummary.budgetAllocated}\n` +
            `Artifacts produced: ${executionSummary.artifactsProduced}\n` +
            `Plan revisions: ${executionSummary.planRevisionCount}\n` +
            `Checkpoints so far: ${executionSummary.checkpointCount}\n\n` +
            `Return a JSON object with:\n` +
            `- assessment: string (human-readable assessment referencing the objective)\n` +
            `- confidence: number in [0.0, 1.0]\n` +
            `- suggestedAction: one of "continue", "replan", "escalate", "abort"`,
          schema: {
            assessment: 'string',
            confidence: 'number',
            suggestedAction: 'string',
          },
          executionSummary,
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
      return validateLlmAssessmentResponse(output.result);
    } catch (_error: unknown) {
      // I-16: Graceful degradation -- any error returns null for heuristic fallback.
      return null;
    }
  }
}
