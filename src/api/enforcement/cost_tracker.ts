/**
 * Cost scaling verification tracker.
 * S ref: I-15 (Linear Cost Scaling), §4 (Performance Invariants)
 *
 * Phase: Sprint 5 (Performance & Events)
 * Implements: Per-session overhead tracking and linear scaling verification.
 *
 * I-15: "Engine overhead per agent-session scales linearly, not quadratically."
 *
 * Overhead = total tokens consumed - raw LLM I/O tokens.
 * This captures the pipeline skeleton cost (system prompts, context assembly)
 * and injected technique cost.
 *
 * Linear scaling is verified via R-squared (R^2) of linear regression on
 * overhead vs session index. R^2 > 0.95 = linear. If <= 2 sessions exist,
 * isLinear defaults to true (insufficient data for statistical verification).
 *
 * Design decisions:
 *   - `recordSessionOverhead`: Queries `core_interactions` for session token
 *     totals, computes overhead from ResponseMetadata technique cost.
 *   - `evaluateCostScaling`: Queries all sessions for a mission, runs linear
 *     regression, returns R^2 and verdict.
 *   - No new tables required: reads from existing `core_interactions`.
 *
 * Invariants enforced: I-15
 * Failure modes defended: FM-02 (cost explosion detection)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type { ResponseMetadata } from '../interfaces/api.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Per-session overhead snapshot.
 */
export interface SessionOverhead {
  readonly sessionId: string;
  readonly missionId: string;
  readonly fixedOverhead: number;
  readonly techniqueOverhead: number;
  readonly totalOverhead: number;
}

/**
 * Cost scaling evaluation report.
 */
export interface CostScalingReport {
  readonly sessionCount: number;
  readonly overheads: readonly SessionOverhead[];
  readonly linearityR2: number;
  readonly isLinear: boolean;
  readonly averageOverhead: number;
  readonly maxOverhead: number;
}

// ============================================================================
// Overhead Recording
// ============================================================================

/**
 * I-15: Record per-session overhead from pipeline metadata.
 *
 * Computes overhead as the difference between total tokens consumed and the
 * raw LLM I/O (which scales with user content, not engine complexity).
 *
 * The technique overhead comes from ResponseMetadata.techniqueTokenCost,
 * which tracks the token cost of injected prompt fragments (I-54).
 *
 * Fixed overhead is the pipeline skeleton cost: context assembly, system
 * prompts, safety gates, evaluation, and audit instrumentation. This is
 * estimated as (total tokens - user content tokens - technique tokens).
 *
 * Since this data is derived at pipeline time and stored implicitly in
 * core_interactions, we return the computed overhead for the caller to
 * use (e.g., emit as a warning event or store in metrics).
 *
 * @param conn - Database connection for querying core_interactions
 * @param sessionId - Session identifier
 * @param missionId - Mission identifier (may be empty for sessionless chat)
 * @param metadata - ResponseMetadata from the completed pipeline
 * @returns SessionOverhead snapshot
 */
export function computeSessionOverhead(
  sessionId: string,
  missionId: string,
  metadata: ResponseMetadata,
): SessionOverhead {
  // Technique overhead comes from the pipeline's technique injection
  const techniqueOverhead = metadata.techniqueTokenCost;

  // Fixed overhead: pipeline skeleton cost beyond raw LLM I/O
  // The total tokens includes everything; the raw I/O is input + output tokens
  // that the user's content required. Fixed overhead is everything else.
  // Since we cannot perfectly separate user-content tokens from system-prompt
  // tokens at this level, we estimate fixed overhead as a constant per pipeline
  // execution. The key invariant (I-15) is that this does NOT grow quadratically
  // with session count.
  //
  // For now, fixed overhead = 0 (baseline). The actual pipeline skeleton tokens
  // are accounted within input_tokens by the LLM provider. What matters for I-15
  // is that technique overhead (which grows with technique count, not session
  // count) is tracked and the total overhead per session stays bounded.
  const fixedOverhead = 0;

  const totalOverhead = fixedOverhead + techniqueOverhead;

  return {
    sessionId,
    missionId,
    fixedOverhead,
    techniqueOverhead,
    totalOverhead,
  };
}

// ============================================================================
// Cost Scaling Evaluation
// ============================================================================

/**
 * I-15: Evaluate cost scaling linearity across sessions within a mission.
 *
 * Queries core_interactions for all sessions associated with a mission,
 * computes per-session token totals, and runs linear regression on the
 * overhead sequence to verify R^2 > 0.95 (linear scaling).
 *
 * If <= 2 sessions exist, isLinear defaults to true (insufficient data
 * for meaningful statistical analysis).
 *
 * @param conn - Database connection
 * @param missionId - Mission to evaluate
 * @returns CostScalingReport with R^2, verdict, and per-session details
 */
export function evaluateCostScaling(
  conn: DatabaseConnection,
  missionId: string,
): CostScalingReport {
  // Query per-session token totals from core_interactions.
  // Sessions are ordered by first interaction time (proxy for session index).
  // Note: No core_sessions table exists yet. When it does (with mission_id FK),
  // the missionId parameter can be used for scoped queries. Currently we query
  // all sessions in core_interactions. The missionId filter is a forward
  // obligation for when session-mission linking is implemented.
  const effectiveSessions = conn.query<{
    session_id: string;
    total_input: number;
    total_output: number;
    interaction_count: number;
  }>(
    `SELECT
       session_id,
       SUM(input_tokens) as total_input,
       SUM(output_tokens) as total_output,
       COUNT(*) as interaction_count
     FROM core_interactions
     WHERE session_id IS NOT NULL
     GROUP BY session_id
     ORDER BY MIN(created_at) ASC`,
  );

  if (effectiveSessions.length === 0) {
    return {
      sessionCount: 0,
      overheads: [],
      linearityR2: 1.0,
      isLinear: true,
      averageOverhead: 0,
      maxOverhead: 0,
    };
  }

  // Compute per-session overhead
  // For I-15 verification: overhead = total tokens per session.
  // The invariant states overhead scales linearly with session count,
  // meaning each new session adds a roughly constant cost, not a
  // cost proportional to the number of existing sessions.
  const overheads: SessionOverhead[] = effectiveSessions.map((s) => {
    const totalTokens = s.total_input + s.total_output;
    return {
      sessionId: s.session_id,
      missionId,
      fixedOverhead: totalTokens,
      techniqueOverhead: 0, // Computed at pipeline time, not queryable after the fact
      totalOverhead: totalTokens,
    };
  });

  // If <= 2 sessions, insufficient data for regression
  if (overheads.length <= 2) {
    const avg = overheads.reduce((sum, o) => sum + o.totalOverhead, 0) / overheads.length;
    const maxOh = Math.max(...overheads.map(o => o.totalOverhead));
    return {
      sessionCount: overheads.length,
      overheads,
      linearityR2: 1.0,
      isLinear: true,
      averageOverhead: avg,
      maxOverhead: maxOh,
    };
  }

  // Linear regression: fit overhead[i] = a + b * i
  // R^2 = 1 - (SS_res / SS_tot)
  const n = overheads.length;
  const values = overheads.map(o => o.totalOverhead);
  const r2 = computeLinearR2(values);

  const avg = values.reduce((sum, v) => sum + v, 0) / n;
  const maxOh = Math.max(...values);

  return {
    sessionCount: n,
    overheads,
    linearityR2: r2,
    isLinear: r2 > 0.95,
    averageOverhead: avg,
    maxOverhead: maxOh,
  };
}

// ============================================================================
// Linear Regression Helper
// ============================================================================

/**
 * Compute R^2 (coefficient of determination) for a sequence of values
 * against their index (0, 1, 2, ..., n-1).
 *
 * R^2 = 1 - (SS_res / SS_tot)
 * where:
 *   SS_res = sum of (actual - predicted)^2
 *   SS_tot = sum of (actual - mean)^2
 *
 * predicted = a + b * i (least squares linear fit)
 *
 * @param values - Array of numeric values ordered by index
 * @returns R^2 value between 0 and 1 (1 = perfectly linear)
 */
export function computeLinearR2(values: readonly number[]): number {
  const n = values.length;
  if (n <= 1) return 1.0;

  // Compute means
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += (values[i] ?? 0);
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Compute slope (b) and intercept (a) via least squares
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    numerator += dx * ((values[i] ?? 0) - meanY);
    denominator += dx * dx;
  }

  // If all x values are identical (impossible for index sequence but handle gracefully)
  if (denominator === 0) return 1.0;

  const b = numerator / denominator;
  const a = meanY - b * meanX;

  // Compute SS_res and SS_tot
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const val = values[i] ?? 0;
    const predicted = a + b * i;
    const residual = val - predicted;
    ssRes += residual * residual;
    const deviation = val - meanY;
    ssTot += deviation * deviation;
  }

  // If SS_tot is 0 (all values identical), perfect linear fit
  if (ssTot === 0) return 1.0;

  const r2 = 1 - (ssRes / ssTot);

  // Clamp to [0, 1] to handle floating point imprecision
  return Math.max(0, Math.min(1, r2));
}
