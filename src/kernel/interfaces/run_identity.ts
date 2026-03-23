/**
 * Run Identity Model + Attempt Entity + Causal Ordering.
 * Truth Model ref: Deliverable 2 — BC-010 through BC-019, ST-010, ST-020
 * Truth Model v1.1 ref: Revised BC-011 (typed AttemptFailureRef/AttemptStrategyDelta),
 *                        New ST-020 (Run lifecycle transitions), New EDGE-013 (fork from active run)
 *
 * Phase: 0A (Foundation)
 * Build Order: 2 (depends on Deliverable 1)
 *
 * Constitutional Sources: Table 6 (causal model), Principle 15, Amendment A10 (fork storage),
 *                         Amendment A12 (self-version pinning)
 * Binding Doctrine: Binding 9 (migration backfill), Binding 15 (suspension cascade),
 *                   Binding 16 (typed substates)
 */

import type {
  TenantId, MissionId, TaskId, Result,
} from './common.js';

import type {
  RunId, AttemptId, TraceEventId,
  SupervisorDecisionId, LimenViolation,
} from './governance_ids.js';

import type { DatabaseConnection } from './database.js';

// ─── Run Entity (BC-010) ───

/**
 * BC-010: Run entity — constitutional execution envelope.
 * Immutable once terminal. Fork lineage via forkOfRunId + forkFromEventRef.
 *
 * ST-020 (v1.1): Run lifecycle transitions:
 *   active → completed  (mission completed)
 *   active → failed     (mission failed)
 *   active → abandoned  (mission revoked)
 *   No reverse transitions. No suspended state (Principle 14).
 *   Run state DERIVED from mission outcome.
 *
 * EDGE-013 (v1.1): Fork from active (non-completed) run is valid.
 * Forked run sees ancestor events up to forkFromEventRef's runSeq, then its own from 1.
 */
export interface Run {
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly missionId: MissionId;
  readonly forkOfRunId?: RunId;
  readonly forkFromEventRef?: TraceEventId;
  readonly state: RunState;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly schemaVersion: string;
  readonly origin: 'runtime' | 'migration-backfill';
}

/**
 * BC-010: Run state union — 4 states exactly.
 * No 'suspended' (Principle 14 — suspension is orthogonal).
 * Terminal states: completed, failed, abandoned (irreversible per BC-070).
 */
export type RunState = 'active' | 'completed' | 'failed' | 'abandoned';

// ─── Attempt Entity (BC-011, revised v1.1) ───

/**
 * BC-011 (revised v1.1): Attempt entity — single execution try within a task.
 * triggeringFailure and strategyDelta are TYPED interfaces (not strings).
 * BC-019: Only one non-terminal Attempt per task at any time.
 */
export interface Attempt {
  readonly attemptId: AttemptId;
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  readonly runId: RunId;
  readonly priorAttemptRef?: AttemptId;
  readonly triggeringFailure?: AttemptFailureRef;
  readonly strategyDelta?: AttemptStrategyDelta;
  readonly state: AttemptState;
  readonly pinnedVersions: AttemptPinnedVersions;
  readonly schemaVersion: string;
  readonly origin: 'runtime' | 'migration-backfill';
  readonly createdAt: string;
}

/**
 * ST-010: Attempt lifecycle states.
 *   started → executing       (attempt begins work)
 *   executing → succeeded     (work completed)
 *   executing → failed        (work failed)
 *   executing → abandoned     (suspension resolved with revoke — Amendment A8)
 * No 'suspended' state. Entity freezes at current state during suspension.
 */
export type AttemptState = 'started' | 'executing' | 'succeeded' | 'failed' | 'abandoned';

// ─── Attempt Supporting Types ───

/**
 * BC-012: Typed version pinning — not Record<string, unknown>.
 * Amendment A5 (minimum version capture), Amendment A12 (own + external versions).
 */
export interface AttemptPinnedVersions {
  readonly missionContractVersion: string;
  readonly traceGrammarVersion: string;
  readonly evalSchemaVersion: string;
  readonly capabilityManifestSchemaVersion: string;
}

/**
 * BC-011 (revised v1.1): Typed failure reference.
 * Enables programmatic analysis of retry strategies in evals.
 *
 * Note: errorCode is string (kernel-layer compatible with KernelError.code pattern).
 * API-layer mapping to LimenErrorCode occurs at the boundary.
 */
export interface AttemptFailureRef {
  readonly priorAttemptId: AttemptId;
  readonly errorCode: string;
  readonly violations?: readonly LimenViolation[];
  readonly summary: string;
}

/**
 * BC-011 (revised v1.1): Typed strategy delta.
 * Enables supervisor intervention tracking and strategy revision comparison.
 */
export interface AttemptStrategyDelta {
  readonly description: string;
  readonly changedParameters?: Readonly<Record<string, unknown>>;
  readonly supervisorInterventionIds?: readonly SupervisorDecisionId[];
}

// ─── Store Interfaces ───

/**
 * Run persistence operations.
 * All methods accept DatabaseConnection as first param and return Result<T>.
 */
export interface RunStore {
  create(conn: DatabaseConnection, run: Run): Result<Run>;
  get(conn: DatabaseConnection, runId: RunId): Result<Run | null>;
  getByMission(conn: DatabaseConnection, missionId: MissionId): Result<readonly Run[]>;
  updateState(conn: DatabaseConnection, runId: RunId, state: RunState): Result<Run>;
}

/**
 * Attempt persistence operations.
 * BC-019: getActiveForTask returns at most one non-terminal attempt.
 */
export interface AttemptStore {
  create(conn: DatabaseConnection, attempt: Attempt): Result<Attempt>;
  get(conn: DatabaseConnection, attemptId: AttemptId): Result<Attempt | null>;
  /** BC-019: Returns the single non-terminal attempt for this task, or null */
  getActiveForTask(conn: DatabaseConnection, taskId: TaskId): Result<Attempt | null>;
  getByTask(conn: DatabaseConnection, taskId: TaskId): Result<readonly Attempt[]>;
  updateState(conn: DatabaseConnection, attemptId: AttemptId, state: AttemptState): Result<Attempt>;
}
