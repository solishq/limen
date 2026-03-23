/**
 * Wire-EGP-01: Execution Gate — EGP reservation check before SCHEDULED→RUNNING.
 * Spec ref: EGP-I14 (reservation requirement), I-76, DC-EGP-064
 *
 * Phase: 2B — EGP ↔ Execution Wiring
 *
 * This wire enforces that no v3.3 task transitions to RUNNING without
 * a confirmed budget reservation. The admission gate checks reservation
 * existence; this gate additionally activates the reservation (reserved → active
 * or retained → active) as part of the execution transition.
 *
 * Invariants enforced:
 *   EGP-I14  v3.3 task requires reservation for execution
 *   EGP-I8   Retry consumes same reservation (retained → active via activate)
 *
 * Defect classes covered:
 *   DC-EGP-001  Task runs without reservation (blocked)
 *   DC-EGP-002  Reservation for wrong task (rejected by admission gate's taskId lookup)
 *   DC-EGP-003  Reservation in wrong state (rejected by activate transition validation)
 *   DC-EGP-005  Double reservation (prevented by create's existing-check)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { OperationContext, Result, TaskId } from '../../kernel/interfaces/index.js';
import type {
  ExecutionGovernor,
  ReservationId,
} from '../interfaces/egp_types.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// ── Error Codes ──

export const EXECUTION_GATE_ERROR_CODES = Object.freeze({
  /** Task has no reservation and is v3.3 — execution blocked */
  RESERVATION_REQUIRED: 'EGP_RESERVATION_REQUIRED',
  /** Reservation exists but activation failed (invalid state transition) */
  ACTIVATION_FAILED: 'EGP_RESERVATION_ACTIVATION_FAILED',
  /** Task or mission is suspended */
  SUSPENDED: 'EGP_TASK_SUSPENDED',
} as const);

// ── Types ──

export interface ExecutionGateResult {
  readonly admitted: boolean;
  readonly reservationId: ReservationId | null;
  readonly reason: string;
}

export interface ExecutionGate {
  /**
   * Check if a task is admitted for execution and activate its reservation.
   *
   * This is the enforcement boundary for I-76/EGP-I14:
   * - v3.3 tasks: must have a non-released reservation → activated on success
   * - v3.2 tasks: exempt (backward compatibility via PSD-5)
   *
   * Call this BEFORE the SCHEDULED→RUNNING transition in the worker runtime.
   * If this returns admitted=false, the task MUST NOT execute.
   */
  checkAndActivate(
    conn: DatabaseConnection,
    ctx: OperationContext,
    taskId: TaskId,
    taskVersion: '3.2' | '3.3',
  ): Result<ExecutionGateResult>;
}

// ── Factory ──

/**
 * Create an ExecutionGate that composes admission check + reservation activation.
 * Pattern: C-07 (Object.freeze on public API)
 */
export function createExecutionGate(governor: ExecutionGovernor): ExecutionGate {
  return Object.freeze({
    checkAndActivate(
      conn: DatabaseConnection,
      ctx: OperationContext,
      taskId: TaskId,
      taskVersion: '3.2' | '3.3',
    ): Result<ExecutionGateResult> {
      // Step 1: Check admission via EGP admission gate (EGP-I14)
      const admissionResult = governor.admissionGate.checkAdmission(conn, ctx, taskId, taskVersion);
      if (!admissionResult.ok) {
        return admissionResult as unknown as Result<ExecutionGateResult>;
      }

      const admission = admissionResult.value;

      // Not admitted — return rejection with reason
      if (!admission.admitted) {
        return ok(Object.freeze({
          admitted: false,
          reservationId: null,
          reason: admission.reason,
        }));
      }

      // Step 2: For v3.3 tasks with a reservation, activate it (reserved → active or retained → active)
      if (admission.reservationId) {
        const activateResult = governor.reservations.activate(conn, admission.reservationId);
        if (!activateResult.ok) {
          // Activation failed — reservation in wrong state (DC-EGP-003)
          return err(
            EXECUTION_GATE_ERROR_CODES.ACTIVATION_FAILED,
            `Reservation ${admission.reservationId} activation failed: ${activateResult.error.message}`,
            'EGP-I14',
          );
        }
      }

      // Admitted and activated
      return ok(Object.freeze({
        admitted: true,
        reservationId: admission.reservationId,
        reason: 'Execution authorized — reservation active',
      }));
    },
  });
}
