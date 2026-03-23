/**
 * Lifecycle Transition Table interfaces for Phase 0A governance layer.
 * Truth Model: Deliverable 6 (Lifecycle Transition Tables)
 *
 * Phase: 0A (Governance Primitives)
 *
 * BC-060: 6 mission lifecycle states (replaces 10-state v3.2 MissionState).
 * BC-061: 4 mission active substates.
 * BC-062: TransitionEnforcer is the SOLE mechanism for lifecycle state changes.
 * BC-063: TransitionEnforcer validates preconditions before allowing transitions.
 * BC-064: 7 task lifecycle states with readiness discriminator.
 * BC-065: 3 task readiness substates.
 * BC-066: 7 handoff lifecycle states.
 * BC-067: Suspension is orthogonal — entities freeze at current state (INV-X05).
 * BC-068: Migration backfill mapping from v3.2 states (Binding 9).
 * BC-069: Handoff lifecycle with acceptance/rejection typed outcomes.
 * BC-070: No reverse transitions from terminal states.
 * BC-071: Completing is an intermediate state between active and completed.
 * ST-060: Mission lifecycle transition table.
 * ST-061: Task lifecycle transition table.
 * ST-062: Handoff lifecycle transition table.
 * ST-063: Suspension lifecycle (active → resolved).
 */

import type { MissionId, TaskId, Result } from './common.js';
import type { HandoffId, RunId } from './governance_ids.js';
import type { DatabaseConnection } from './database.js';

// ─── Mission Lifecycle ───

/**
 * BC-060: 6 constitutional mission lifecycle states.
 * Replaces v3.2's 10-state MissionState.
 * BC-071: 'completing' is an intermediate state for result submission/eval.
 * Terminal states: completed, failed, revoked (BC-070: no reverse transitions).
 */
export type MissionLifecycleState =
  | 'created'
  | 'active'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'revoked';

/**
 * BC-061: Active substates (only valid when mission is in 'active' state).
 * These replace v3.2's PLANNING, EXECUTING, REVIEWING, DEGRADED as top-level states.
 */
export type MissionActiveSubstate =
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'degraded';

// ─── Task Lifecycle ───

/**
 * BC-064: 7 constitutional task lifecycle states.
 * Replaces v3.2 task states with constitutional names.
 * 'skipped' is new (no v3.2 equivalent).
 * v3.2 BLOCKED → pending with readiness 'awaiting-dependencies'.
 * Terminal states: completed, failed, skipped, revoked (BC-070).
 */
export type TaskLifecycleState =
  | 'pending'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'revoked';

/**
 * BC-065: Task readiness discriminator (only valid when task is 'pending').
 * Replaces v3.2 BLOCKED state with structured readiness tracking.
 */
export type TaskReadiness =
  | 'awaiting-dependencies'
  | 'awaiting-scheduling'
  | 'ready';

// ─── Handoff Lifecycle ───

/**
 * BC-066: 7 handoff lifecycle states.
 * BC-069: Typed acceptance/rejection outcomes (in supervisor.ts).
 */
export type HandoffLifecycleState =
  | 'issued'
  | 'accepted'
  | 'rejected'
  | 'active'
  | 'returned'
  | 'revoked'
  | 'expired';

// ─── Transition Enforcement ───

/**
 * BC-062, BC-063: Result of a lifecycle transition enforcement.
 * Records the transition that occurred (or why it was rejected).
 */
export interface TransitionResult {
  /** The state before the transition */
  readonly fromState: string;
  /** The state after the transition */
  readonly toState: string;
  /** Timestamp of the transition */
  readonly timestamp: string;
}

/**
 * BC-062: TransitionEnforcer — the SOLE mechanism for lifecycle state changes.
 * BC-063: Validates preconditions before allowing any transition.
 * BC-070: Rejects reverse transitions from terminal states.
 * BC-067: Checks suspension status — suspended entities cannot transition.
 *
 * Every state change in the system MUST go through the TransitionEnforcer.
 * Direct SQL updates to lifecycle state columns are non-conforming.
 */
export interface TransitionEnforcer {
  /**
   * ST-060: Enforce mission lifecycle transition.
   * Returns error if transition is invalid or entity is suspended.
   */
  enforceMissionTransition(
    conn: DatabaseConnection,
    missionId: MissionId,
    toState: MissionLifecycleState,
    substate?: MissionActiveSubstate,
  ): Result<TransitionResult>;

  /**
   * ST-061: Enforce task lifecycle transition.
   * Returns error if transition is invalid or entity is suspended.
   */
  enforceTaskTransition(
    conn: DatabaseConnection,
    taskId: TaskId,
    toState: TaskLifecycleState,
    readiness?: TaskReadiness,
  ): Result<TransitionResult>;

  /**
   * ST-062: Enforce handoff lifecycle transition.
   * Returns error if transition is invalid.
   */
  enforceHandoffTransition(
    conn: DatabaseConnection,
    handoffId: HandoffId,
    toState: HandoffLifecycleState,
  ): Result<TransitionResult>;

  /**
   * ST-020 (v1.1): Enforce run lifecycle transition.
   * Run state is derived from mission outcome.
   */
  enforceRunTransition(
    conn: DatabaseConnection,
    runId: RunId,
    toState: 'completed' | 'failed' | 'abandoned',
  ): Result<TransitionResult>;
}

// ─── Migration Backfill Mapping (Binding 9) ───

/**
 * BC-068, Binding 9: v3.2 to constitutional state mapping.
 * Used by migration-backfill to convert existing state values.
 */
export const MISSION_STATE_BACKFILL_MAP: Readonly<Record<string, {
  readonly state: MissionLifecycleState;
  readonly substate: MissionActiveSubstate | null;
}>> = {
  CREATED: { state: 'created', substate: null },
  PLANNING: { state: 'active', substate: 'planning' },
  EXECUTING: { state: 'active', substate: 'executing' },
  REVIEWING: { state: 'active', substate: 'reviewing' },
  PAUSED: { state: 'active', substate: null }, // + suspension record
  BLOCKED: { state: 'active', substate: null }, // + readiness: awaiting-dependencies
  DEGRADED: { state: 'active', substate: 'degraded' },
  COMPLETED: { state: 'completed', substate: null },
  FAILED: { state: 'failed', substate: null },
  CANCELLED: { state: 'revoked', substate: null },
} as const;

/**
 * BC-068: v3.2 task state to constitutional state mapping.
 */
export const TASK_STATE_BACKFILL_MAP: Readonly<Record<string, {
  readonly state: TaskLifecycleState;
  readonly readiness: TaskReadiness | null;
}>> = {
  PENDING: { state: 'pending', readiness: 'awaiting-scheduling' },
  SCHEDULED: { state: 'ready', readiness: null },
  RUNNING: { state: 'executing', readiness: null },
  COMPLETED: { state: 'completed', readiness: null },
  FAILED: { state: 'failed', readiness: null },
  CANCELLED: { state: 'revoked', readiness: null },
  BLOCKED: { state: 'pending', readiness: 'awaiting-dependencies' },
} as const;
