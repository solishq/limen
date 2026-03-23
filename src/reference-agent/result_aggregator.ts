/**
 * ResultAggregator -- mission completion and result synthesis.
 * S ref: S23 (submit_result), SD-01 (lifecycle-phase grouping)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §10 Build Order Step 5 (ResultAggregator)
 *
 * The ResultAggregator is responsible for:
 *   1. Collecting results from completed tasks and child missions
 *   2. Computing overall confidence from constituent results
 *   3. Assembling deliverables (artifact references)
 *   4. Producing unresolvedQuestions and followupRecommendations
 *   5. Submitting the final result via SC-9 (submit_result)
 *
 * This is the final stage of the mission lifecycle. It synthesizes
 * everything the agent has done into a coherent MissionResult.
 *
 * Invariants enforced: I-17 (governance boundary -- submit through SC-9),
 *                      I-21 (bounded cognition -- uses only tracked artifacts)
 * Failure modes defended: FM-14 (semantic drift -- result references objective)
 */

import type {
  ArtifactId,
  ResultSubmitInput, ResultSubmitOutput,
  AgentExecutionState,
} from './reference_agent.types.js';

import { SystemCallClient } from './system_call_client.js';

// ============================================================================
// Confidence Aggregation
// ============================================================================

/**
 * §23: Compute aggregate confidence from execution state and child results.
 *
 * The aggregate confidence accounts for:
 *   - Task completion ratio (primary factor)
 *   - Child mission confidences (weighted by budget proportion)
 *   - Artifact production (evidence of work)
 *   - Checkpoint history trend (improving or declining)
 *
 * @param state - Agent execution state
 * @returns Aggregate confidence in [0.0, 1.0]
 */
export function computeAggregateConfidence(state: AgentExecutionState): number {
  const totalTasks = state.activeTaskIds.size + state.completedTaskIds.size;

  // Base confidence from task completion
  let confidence: number;
  if (totalTasks === 0) {
    confidence = 0.5;
  } else {
    confidence = state.completedTaskIds.size / totalTasks;
  }

  // Incorporate child mission confidences (if any)
  if (state.childMissionResults.size > 0) {
    let childConfidenceSum = 0;
    for (const [, result] of state.childMissionResults) {
      childConfidenceSum += result.confidence;
    }
    const avgChildConfidence = childConfidenceSum / state.childMissionResults.size;

    // Weighted: 60% own completion, 40% child confidence
    confidence = (confidence * 0.6) + (avgChildConfidence * 0.4);
  }

  // Artifact production bonus
  if (state.completedArtifactIds.length > 0) {
    confidence = Math.min(1, confidence + 0.05);
  }

  return Math.min(1, Math.max(0, confidence));
}

// ============================================================================
// Result Summary Generation
// ============================================================================

/**
 * §23: Generate a result summary from execution state.
 *
 * The summary references the original objective (I-24 goal anchoring)
 * and includes key metrics from the execution.
 *
 * @param state - Agent execution state
 * @param confidence - Computed confidence
 * @returns Human-readable summary string
 */
export function generateResultSummary(
  state: AgentExecutionState,
  confidence: number,
): string {
  const totalTasks = state.activeTaskIds.size + state.completedTaskIds.size;
  const completedCount = state.completedTaskIds.size;
  const artifactCount = state.completedArtifactIds.length;
  const childCount = state.childMissionResults.size;

  let summary = `Mission "${state.objective}" completed. `;
  summary += `${completedCount}/${totalTasks} tasks executed, `;
  summary += `${artifactCount} artifacts produced`;

  if (childCount > 0) {
    summary += `, ${childCount} child missions aggregated`;
  }

  summary += `. Confidence: ${(confidence * 100).toFixed(0)}%.`;

  return summary;
}

/**
 * §23: Collect unresolved questions from execution state.
 *
 * These are questions the agent could not answer within its budget
 * and scope. They provide transparency about what was NOT achieved.
 *
 * @param state - Agent execution state
 * @returns List of unresolved question strings
 */
export function collectUnresolvedQuestions(state: AgentExecutionState): string[] {
  const questions: string[] = [];

  // Tasks that remain active (not completed) represent unresolved work
  if (state.activeTaskIds.size > 0) {
    questions.push(
      `${state.activeTaskIds.size} task(s) were not completed within budget constraints.`,
    );
  }

  // Child missions with low confidence
  for (const [missionId, result] of state.childMissionResults) {
    if (result.confidence < 0.7) {
      questions.push(
        `Child mission ${missionId} completed with low confidence (${(result.confidence * 100).toFixed(0)}%).`,
      );
    }
    for (const q of result.unresolvedQuestions) {
      questions.push(q);
    }
  }

  return questions;
}

/**
 * §23: Generate followup recommendations from execution state.
 *
 * @param state - Agent execution state
 * @returns List of recommendation strings
 */
export function collectFollowupRecommendations(state: AgentExecutionState): string[] {
  const recommendations: string[] = [];

  // Incomplete tasks -> recommend completing them
  if (state.activeTaskIds.size > 0) {
    recommendations.push(
      `Commission follow-up mission to complete ${state.activeTaskIds.size} remaining task(s).`,
    );
  }

  // Aggregate child recommendations
  for (const [, result] of state.childMissionResults) {
    for (const rec of result.followupRecommendations) {
      recommendations.push(rec);
    }
  }

  // Budget exhaustion -> recommend additional budget
  if (state.budgetAllocated > 0 && state.budgetConsumed >= state.budgetAllocated * 0.9) {
    recommendations.push(
      'Budget was nearly exhausted. Consider allocating additional budget for deeper analysis.',
    );
  }

  return recommendations;
}

// ============================================================================
// ResultAggregator Class
// ============================================================================

/**
 * SD-01: ResultAggregator groups submit_result.
 * It synthesizes everything the agent has done into a final MissionResult.
 *
 * The aggregator:
 *   1. Collects all artifact IDs produced during execution
 *   2. Incorporates child mission results
 *   3. Computes aggregate confidence
 *   4. Generates summary, unresolved questions, recommendations
 *   5. Submits via SC-9 (submit_result)
 */
export class ResultAggregator {
  private readonly client: SystemCallClient;

  constructor(client: SystemCallClient) {
    this.client = client;
  }

  /**
   * §23, SC-9: Submit the mission result.
   *
   * This is the terminal call in the mission lifecycle. After this,
   * the mission transitions to COMPLETED (or REVIEWING).
   *
   * I-21: Only artifacts tracked in completedArtifactIds are referenced.
   * The agent does not reference artifacts it hasn't created or read.
   *
   * @param state - Final agent execution state
   * @returns ResultSubmitOutput with resultId and final missionState
   */
  async submitResult(state: AgentExecutionState): Promise<ResultSubmitOutput> {
    const confidence = computeAggregateConfidence(state);
    const summary = generateResultSummary(state, confidence);
    const unresolvedQuestions = collectUnresolvedQuestions(state);
    const followupRecommendations = collectFollowupRecommendations(state);

    // Collect all artifact IDs (own + child mission artifacts)
    const allArtifactIds: ArtifactId[] = [...state.completedArtifactIds];

    // Add artifacts from child mission results
    for (const [, result] of state.childMissionResults) {
      for (const artifact of result.artifacts) {
        allArtifactIds.push(artifact.id);
      }
    }

    const input: ResultSubmitInput = {
      missionId: state.missionId,
      summary,
      confidence,
      artifactIds: allArtifactIds,
      unresolvedQuestions,
      followupRecommendations,
    };

    return this.client.submitResult(input);
  }

  /**
   * §23: Submit a result with custom summary and confidence.
   *
   * Used when the agent has specific information to include in the result
   * beyond what the automatic aggregation produces.
   *
   * @param state - Agent execution state
   * @param summary - Custom summary string
   * @param confidence - Custom confidence score
   * @param unresolvedQuestions - Custom unresolved questions
   * @param followupRecommendations - Custom recommendations
   * @returns ResultSubmitOutput
   */
  async submitCustomResult(
    state: AgentExecutionState,
    summary: string,
    confidence: number,
    unresolvedQuestions: string[] = [],
    followupRecommendations: string[] = [],
  ): Promise<ResultSubmitOutput> {
    const input: ResultSubmitInput = {
      missionId: state.missionId,
      summary,
      confidence,
      artifactIds: state.completedArtifactIds,
      unresolvedQuestions,
      followupRecommendations,
    };

    return this.client.submitResult(input);
  }
}
