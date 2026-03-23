/**
 * Wire-EGP-04: Floor Enforcer — unreserved floor enforcement.
 * Spec ref: I-87 (reservation fairness), EGP-I4 (dual-dimension)
 *
 * Phase: 2B — EGP ↔ Execution Wiring
 *
 * Ensures that reservation creation does not starve sibling tasks by
 * maintaining a minimum unreserved floor (default 10% of mission allocation).
 * Total active reservations must not exceed mission budget minus the floor.
 *
 * This enforcer operates at the scheduling boundary — it validates
 * proposed reservation amounts against the floor before allocation.
 *
 * Invariants enforced:
 *   I-87   Reservation fairness (unreserved floor)
 *   EGP-I4 Dual-dimension (floor checked per dimension independently)
 *
 * Defect classes covered:
 *   DC-EGP-010  Reservation starvation (floor violated → rejected)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { Result, MissionId } from '../../kernel/interfaces/index.js';
import type { ExecutionGovernor } from '../interfaces/egp_types.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

// ── Error Codes ──

export const FLOOR_ERROR_CODES = Object.freeze({
  /** Proposed reservation would violate unreserved floor */
  FLOOR_VIOLATED: 'EGP_UNRESERVED_FLOOR_VIOLATED',
} as const);

// ── Constants ──

/** Default unreserved floor percentage (10% of mission allocation per I-87) */
export const DEFAULT_UNRESERVED_FLOOR_PCT = 0.10;

// ── Types ──

export interface FloorCheckResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly tokenFloor: number;
  readonly deliberationFloor: number;
  readonly tokenAvailableAfterFloor: number;
  readonly deliberationAvailableAfterFloor: number;
}

export interface FloorEnforcer {
  /**
   * Check if a proposed reservation amount would violate the unreserved floor.
   *
   * I-87: Total active reservations must not exceed
   *   allocated - (allocated * floorPct)
   *
   * Per dimension independently (EGP-I4):
   *   availableForReservation = unreservedRemaining - floor
   *   floor = allocated * floorPct
   *
   * Returns allowed=true if proposedTokens <= availableForReservation (both dimensions).
   */
  checkFloor(
    conn: DatabaseConnection,
    missionId: MissionId,
    proposedTokens: number,
    proposedDeliberation: number,
    floorPct?: number,
  ): Result<FloorCheckResult>;

  /**
   * Calculate the maximum allocatable pool after floor enforcement.
   * Used to adjust scheduler inputs before wave composition.
   */
  getEffectivePool(
    conn: DatabaseConnection,
    missionId: MissionId,
    floorPct?: number,
  ): Result<{
    readonly effectiveTokenPool: number;
    readonly effectiveDeliberationPool: number;
    readonly tokenFloor: number;
    readonly deliberationFloor: number;
  }>;
}

// ── Factory ──

/**
 * Create a FloorEnforcer that checks unreserved floor constraints.
 * Pattern: C-07 (Object.freeze on public API)
 */
export function createFloorEnforcer(governor: ExecutionGovernor): FloorEnforcer {
  return Object.freeze({
    checkFloor(
      conn: DatabaseConnection,
      missionId: MissionId,
      proposedTokens: number,
      proposedDeliberation: number,
      floorPct: number = DEFAULT_UNRESERVED_FLOOR_PCT,
    ): Result<FloorCheckResult> {
      // Get current mission budget state
      const stateResult = governor.ledger.getState(conn, missionId);
      if (!stateResult.ok) {
        return stateResult as unknown as Result<FloorCheckResult>;
      }

      const state = stateResult.value;

      // Calculate floors per dimension (I-87: floor = allocated * floorPct)
      const tokenFloor = Math.ceil(state.token.allocated * floorPct);
      const deliberationFloor = Math.ceil(state.deliberation.allocated * floorPct);

      // Available for new reservations = unreservedRemaining - floor
      const tokenAvailableAfterFloor = Math.max(0, state.token.unreservedRemaining - tokenFloor);
      const deliberationAvailableAfterFloor = Math.max(0, state.deliberation.unreservedRemaining - deliberationFloor);

      // Check both dimensions independently (EGP-I4)
      const tokenOk = proposedTokens <= tokenAvailableAfterFloor;
      const deliberationOk = proposedDeliberation <= deliberationAvailableAfterFloor;
      const allowed = tokenOk && deliberationOk;

      let reason: string;
      if (allowed) {
        reason = 'Within unreserved floor limits';
      } else if (!tokenOk && !deliberationOk) {
        reason = `Both dimensions exceed floor: tokens need ${proposedTokens} but only ${tokenAvailableAfterFloor} available (floor: ${tokenFloor}), deliberation need ${proposedDeliberation} but only ${deliberationAvailableAfterFloor} available (floor: ${deliberationFloor})`;
      } else if (!tokenOk) {
        reason = `Token dimension exceeds floor: need ${proposedTokens} but only ${tokenAvailableAfterFloor} available (floor: ${tokenFloor})`;
      } else {
        reason = `Deliberation dimension exceeds floor: need ${proposedDeliberation} but only ${deliberationAvailableAfterFloor} available (floor: ${deliberationFloor})`;
      }

      return ok(Object.freeze({
        allowed,
        reason,
        tokenFloor,
        deliberationFloor,
        tokenAvailableAfterFloor,
        deliberationAvailableAfterFloor,
      }));
    },

    getEffectivePool(
      conn: DatabaseConnection,
      missionId: MissionId,
      floorPct: number = DEFAULT_UNRESERVED_FLOOR_PCT,
    ): Result<{
      readonly effectiveTokenPool: number;
      readonly effectiveDeliberationPool: number;
      readonly tokenFloor: number;
      readonly deliberationFloor: number;
    }> {
      const stateResult = governor.ledger.getState(conn, missionId);
      if (!stateResult.ok) {
        return stateResult as unknown as Result<{
          readonly effectiveTokenPool: number;
          readonly effectiveDeliberationPool: number;
          readonly tokenFloor: number;
          readonly deliberationFloor: number;
        }>;
      }

      const state = stateResult.value;
      const tokenFloor = Math.ceil(state.token.allocated * floorPct);
      const deliberationFloor = Math.ceil(state.deliberation.allocated * floorPct);

      return ok(Object.freeze({
        effectiveTokenPool: Math.max(0, state.token.unreservedRemaining - tokenFloor),
        effectiveDeliberationPool: Math.max(0, state.deliberation.unreservedRemaining - deliberationFloor),
        tokenFloor,
        deliberationFloor,
      }));
    },
  });
}
