/**
 * Wire-EGP-02: Invocation Gate — pre-invocation admissibility check.
 * Spec ref: I-86 (pre-invocation admissibility), EGP-I4 (dual-dimension)
 *
 * Phase: 2B — EGP ↔ Execution Wiring
 *
 * Before each model invocation within a running task, the system checks
 * reservation headroom for both token and deliberation dimensions.
 * If either dimension is exhausted, the invocation is blocked.
 *
 * Invariants enforced:
 *   EGP-I4   Dual-dimension enforcement (token + deliberation independently)
 *   I-86     Pre-invocation admissibility check
 *   I-56     Both dimensions must pass (joint feasibility)
 *
 * Defect classes covered:
 *   DC-EGP-007  Pre-invocation admissibility bypass (blocked)
 *   DC-EGP-008  Single dimension admissibility (both dimensions checked)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { Result, TaskId } from '../../kernel/interfaces/index.js';
import type {
  ExecutionGovernor,
} from '../interfaces/egp_types.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

// ── Error Codes ──

export const INVOCATION_GATE_ERROR_CODES = Object.freeze({
  /** Token dimension exhausted — invocation blocked */
  TOKEN_EXHAUSTED: 'EGP_TOKEN_HEADROOM_EXHAUSTED',
  /** Deliberation dimension exhausted — invocation blocked */
  DELIBERATION_EXHAUSTED: 'EGP_DELIBERATION_HEADROOM_EXHAUSTED',
  /** Both dimensions exhausted */
  BOTH_EXHAUSTED: 'EGP_BOTH_HEADROOM_EXHAUSTED',
  /** No reservation found for task */
  NO_RESERVATION: 'EGP_NO_RESERVATION_FOR_INVOCATION',
} as const);

// ── Types ──

export interface InvocationAdmissibilityResult {
  readonly admissible: boolean;
  readonly tokenHeadroom: number;
  readonly deliberationHeadroom: number;
  readonly rejectionDimension: 'token' | 'deliberation' | 'both' | null;
}

export interface InvocationGate {
  /**
   * Check headroom before authorizing a model invocation.
   *
   * Both dimensions checked independently (EGP-I4, I-56):
   * - Token dimension: reservedTokens - consumedTokens > 0
   * - Deliberation dimension: reservedDeliberation - consumedDeliberation > 0
   *   (only if deliberation was reserved)
   *
   * Returns admissible=false if either dimension is exhausted.
   * Call this BEFORE every gateway.request() / gateway.requestStream().
   */
  checkAdmissibility(
    conn: DatabaseConnection,
    taskId: TaskId,
    additionalTokens: number,
    additionalDeliberation: number,
  ): Result<InvocationAdmissibilityResult>;
}

// ── Factory ──

/**
 * Create an InvocationGate that checks dual-dimension headroom.
 * Pattern: C-07 (Object.freeze on public API)
 */
export function createInvocationGate(governor: ExecutionGovernor): InvocationGate {
  return Object.freeze({
    checkAdmissibility(
      conn: DatabaseConnection,
      taskId: TaskId,
      additionalTokens: number,
      additionalDeliberation: number,
    ): Result<InvocationAdmissibilityResult> {
      // Check headroom via EGP reservation enforcer
      const headroomResult = governor.enforcer.checkHeadroom(
        conn, taskId, additionalTokens, additionalDeliberation,
      );
      if (!headroomResult.ok) {
        return headroomResult as unknown as Result<InvocationAdmissibilityResult>;
      }

      const headroom = headroomResult.value;

      // Determine rejection dimension for diagnostics
      let rejectionDimension: 'token' | 'deliberation' | 'both' | null = null;
      if (headroom.tokenExhausted && headroom.deliberationExhausted) {
        rejectionDimension = 'both';
      } else if (headroom.tokenExhausted) {
        rejectionDimension = 'token';
      } else if (headroom.deliberationExhausted) {
        rejectionDimension = 'deliberation';
      }

      return ok(Object.freeze({
        admissible: headroom.allowed,
        tokenHeadroom: headroom.tokenHeadroom,
        deliberationHeadroom: headroom.deliberationHeadroom,
        rejectionDimension,
      }));
    },
  });
}
