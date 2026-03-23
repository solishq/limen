/**
 * Wire-EGP-03: Terminal Release — reservation released atomically with terminal state.
 * Spec ref: I-83 (reservation release), EGP-I3 (atomic reclaim), EGP-I13 (conservation)
 *
 * Phase: 2B — EGP ↔ Execution Wiring
 *
 * When a task reaches terminal state (COMPLETED/FAILED/CANCELLED), its reservation
 * is released and unconsumed budget is returned to the mission's unreserved pool.
 * Conservation law is verified after the release.
 *
 * Architecture note: The reservation is looked up BEFORE terminal processing
 * because terminalOp.execute() clears the task→reservation index on release.
 * The consumed amounts from the pre-release lookup are used for conservation-
 * correct finalization via finalizeReservation().
 *
 * Invariants enforced:
 *   EGP-I3   Atomic reclaim on final terminal per dimension
 *   EGP-I8   Retry consumes same reservation (retain on FAILED with retries)
 *   EGP-I13  Conservation law per dimension
 *   I-83     Reservation released atomically with terminal transition
 *
 * Defect classes covered:
 *   DC-EGP-004  Reservation not released on terminal (enforced)
 *   DC-EGP-009  Reservation events not emitted (emitted by underlying store)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { OperationContext, Result, TaskId, MissionId } from '../../kernel/interfaces/index.js';
import type {
  ExecutionGovernor,
  EGPTerminalResult,
  ConservationCheckResult,
  TaskBudgetReservation,
} from '../interfaces/egp_types.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

// ── Types ──

export interface TerminalReleaseResult {
  readonly terminalResult: EGPTerminalResult;
  readonly conservationHolds: boolean;
  readonly conservationCheck: ConservationCheckResult | null;
}

export interface TerminalRelease {
  /**
   * Execute the terminal release for a task.
   *
   * On COMPLETED/CANCELLED/FAILED-no-retries:
   *   1. Look up reservation (get consumed amounts before release clears index)
   *   2. Release reservation via terminal handler (EGP-I3)
   *   3. Finalize budget accounting: consumed→consumed, reclaimed→unreserved (EGP-I13)
   *   4. Handle overage via mission debt (EGP-I12)
   *   5. Verify conservation law (EGP-I13)
   *
   * On FAILED with retries remaining:
   *   1. Retain reservation (EGP-I8 — cumulative consumption)
   *   2. Skip finalization (budget remains reserved for retry)
   */
  executeRelease(
    conn: DatabaseConnection,
    ctx: OperationContext,
    taskId: TaskId,
    missionId: MissionId,
    terminalState: 'COMPLETED' | 'CANCELLED' | 'FAILED',
    hasRetriesRemaining: boolean,
  ): Result<TerminalReleaseResult>;
}

// ── Factory ──

/**
 * Create a TerminalRelease that composes terminal handler + ledger finalization + conservation.
 * Pattern: C-07 (Object.freeze on public API)
 */
export function createTerminalRelease(governor: ExecutionGovernor): TerminalRelease {
  return Object.freeze({
    executeRelease(
      conn: DatabaseConnection,
      ctx: OperationContext,
      taskId: TaskId,
      missionId: MissionId,
      terminalState: 'COMPLETED' | 'CANCELLED' | 'FAILED',
      hasRetriesRemaining: boolean,
    ): Result<TerminalReleaseResult> {
      // Step 1: Look up reservation BEFORE terminal processing.
      // terminalOp.execute() clears the task→reservation index on release,
      // so we must capture consumed amounts here.
      const preResult = governor.reservations.getByTaskId(conn, taskId);
      let preReservation: TaskBudgetReservation | null = null;
      if (preResult.ok) {
        preReservation = preReservation = preResult.value;
      }

      // Step 2: Execute terminal operation (release or retain)
      const termResult = governor.terminalOp.execute(
        conn, ctx, taskId, terminalState, hasRetriesRemaining,
      );
      if (!termResult.ok) {
        return termResult as unknown as Result<TerminalReleaseResult>;
      }

      const terminal = termResult.value;

      // Step 3: If released, finalize reservation budget accounting
      if (terminal.action === 'released' && preReservation) {
        // Conservation-correct finalization (EGP-I13):
        // Within-budget consumed = min(consumed, reserved)
        // Overage consumed = max(0, consumed - reserved) [handled separately via debt]
        // Reclaimed = max(0, reserved - consumed) = terminal.reclaimedTokens
        const withinBudgetConsumedTokens = Math.min(
          preReservation.consumedTokens, preReservation.reservedTokens,
        );
        const withinBudgetConsumedDelib = Math.min(
          preReservation.consumedDeliberation, preReservation.reservedDeliberation,
        );

        const finalizeResult = governor.ledger.finalizeReservation(
          conn, missionId,
          withinBudgetConsumedTokens,
          withinBudgetConsumedDelib,
          terminal.reclaimedTokens,
          terminal.reclaimedDeliberation,
        );
        if (!finalizeResult.ok) {
          return finalizeResult as unknown as Result<TerminalReleaseResult>;
        }

        // Handle overage: charge to mission debt (EGP-I12)
        if (terminal.overageTokens > 0 || terminal.overageDeliberation > 0) {
          governor.ledger.recordOverage(
            conn, ctx, missionId, terminal.overageTokens, terminal.overageDeliberation,
          );
        }
      }

      // Step 4: Verify conservation law (only for budget-moving operations)
      let conservationCheck: ConservationCheckResult | null = null;
      if (terminal.action === 'released') {
        const conservationResult = governor.ledger.checkConservation(conn, missionId);
        if (conservationResult.ok) {
          conservationCheck = conservationResult.value;
        }
      }

      return ok(Object.freeze({
        terminalResult: terminal,
        conservationHolds: conservationCheck ? conservationCheck.holds : false,
        conservationCheck,
      }));
    },
  });
}
