/**
 * EGP (Execution Governance Protocol) interface types.
 * Spec ref: EGP v1.0 Design Source (FINAL), Architecture Freeze CF-06/CF-11
 *
 * Phase: v3.3.0 — Execution Governance Truth Model
 * Status: FROZEN — interfaces defined before implementation.
 *
 * Implements: All TypeScript types for the Execution Governance subsystem:
 *   §3 (13 Constitutional Invariants), §4 (8 Pre-Schema Decisions),
 *   §5 (Reservation Model), §6 (Branch Failure Policies),
 *   §7 (Capability Mutability & Retry), §8 (Scheduling Fairness),
 *   §9 (Scheduling Determinism & Replay), §11 (Failure Modes)
 *
 * Key architectural properties:
 *   - Dual-dimension reservation: token (prompt/completion) + deliberation (CF-06, DBA-I1)
 *   - Four reservation statuses: reserved, active, retained, released (§5.1)
 *   - Conservation law with missionDebt (EGP-I13)
 *   - Scheduler algorithm is implementation freedom; only starvation bound is frozen (CF-11)
 *   - Mission-level branch failure policy only (PSD-4)
 *   - Capability mutability classification determines retry safety (EGP-I7)
 *
 * SUPERSESSION: This file replaces the dead v1.2-based egp_types.ts.
 * Everything here derives from EGP v1.0 Design Source ONLY.
 */

import type {
  TaskId, MissionId, OperationContext, Result,
  CorrelationId,
} from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';

// ============================================================================
// Phase 0A Integration — EGP Operation Context (v1.1 DC Coverage)
// ============================================================================

/**
 * EGP-specific operation context extending OperationContext with Phase 0A fields.
 * Used by Phase 0A-dependent interfaces (admission gate, trace emission, etc.).
 * The correlationId links EGP events to originating syscall trace chains (BC-006).
 *
 * Truth-model ref: DC-EGP-050 (CorrelationId propagation through EGP operations).
 */
export interface EGPOperationContext extends OperationContext {
  /** BC-006: CorrelationId for trace event chain linkage (Phase 0A) */
  readonly correlationId?: CorrelationId;
}

// ============================================================================
// Branded ID Types — EGP-specific
// ============================================================================

/**
 * §5.1: Reservation identifier — unique per reservation record.
 * A task has at most one non-released reservation at any time.
 * Primary lookup is by taskId; ReservationId provides record identity.
 */
export type ReservationId = string & { readonly __brand: 'ReservationId' };

/**
 * §9.1: Wave identifier — unique per scheduling wave.
 * Used for replay determinism (EGP-I9) and replay record linking.
 */
export type WaveId = string & { readonly __brand: 'WaveId' };

// ============================================================================
// Union Types — derived from design source
// ============================================================================

/**
 * §5.1: Reservation lifecycle status.
 * Four statuses — the 'retained' status is the architectural centerpiece:
 *   reserved  → Budget allocated. Task SCHEDULED but not yet RUNNING.
 *   active    → Task RUNNING. Consumption tracked per dimension.
 *   retained  → Task FAILED but retries remain. Reservation persists
 *               with cumulative consumption. Returns to 'active' when retry begins.
 *   released  → Final terminal. Unused budget reclaimed per dimension.
 *
 * NOTE: The design source §5.1 schema union shows 3 values ('reserved' | 'active' | 'released')
 * but the description text immediately below lists 4 statuses including 'retained'.
 * This is an editorial inconsistency — the 4th status is confirmed by the design source's
 * description, the prompt's lineage table, and the invariant set (EGP-I3, EGP-I8).
 * Resolution: Include 'retained'. [AMB-01]
 */
export type ReservationStatus = 'reserved' | 'active' | 'retained' | 'released';

/**
 * §5.1: Valid reservation status transitions.
 * Reservation status is subordinate to task state — transitions are consequences
 * of task state transitions, not independent decisions.
 *
 * reserved → active     (task SCHEDULED → RUNNING)
 * reserved → released   (task cancelled while SCHEDULED, before ever running)
 * active → retained     (task RUNNING → FAILED, retries remain)
 * active → released     (task → COMPLETED, CANCELLED, or FAILED with no retries)
 * retained → active     (retry execution begins: task RUNNING again)
 * retained → released   (retries exhausted or cancelled while in retry-pending)
 * released → (none)     (terminal — no transitions out)
 */
export const RESERVATION_STATUS_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  reserved: ['active', 'released'],
  active: ['retained', 'released'],
  retained: ['active', 'released'],
  released: [],
} as const;

/**
 * PSD-1: Budget allocation method.
 * Selected at propose_task_graph time or defaulted by the orchestrator.
 * All methods must produce minimum viable reservation per dimension or exclude the task.
 */
export type AllocationMethod = 'proportional' | 'equal' | 'explicit';

/**
 * EGP-I6, §6.1: Branch failure policy.
 * Mission-level only in v1 (PSD-4). All fan-outs use the same policy.
 * A single mission cannot mix policies across different fan-outs.
 */
export type BranchFailurePolicy = 'isolate' | 'fail-fast' | 'quorum';

/**
 * EGP-I7, §7.1: Capability mutability classification.
 * Determines retry safety. Unclassified operations default to mutating-external.
 * Classification attaches to the specific operation, not the adapter family.
 */
export type MutabilityClass = 'read-only' | 'side-effecting' | 'mutating' | 'mutating-external';

/**
 * EGP-I4, CF-06: Budget dimension identifier.
 * Every reservation has TWO independent ceilings enforced separately.
 * PSD-7: 'token' means prompt/completion only. Deliberation is separate.
 */
export type BudgetDimension = 'token' | 'deliberation';

/**
 * Task execution states relevant to EGP dependency resolution and scheduling.
 * Defined here to avoid layer dependency on orchestration types. [AMB-11]
 * These values mirror TaskState from orchestration but are independently defined.
 */
export type EGPRelevantTaskState =
  | 'PENDING' | 'SCHEDULED' | 'RUNNING'
  | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BLOCKED';

// ============================================================================
// Per-Dimension Budget Types — EGP-I4, EGP-I13
// ============================================================================

/**
 * §5.0: Per-dimension budget state within a mission.
 * Both token and deliberation dimensions follow this structure independently.
 * The conservation law (EGP-I13) holds per dimension.
 */
export interface DimensionBudgetState {
  /** Total budget allocated to this mission in this dimension */
  readonly allocated: number;
  /** Sum of consumed across all tasks (including released reservations) */
  readonly totalConsumed: number;
  /** Sum of reservation ceilings for active (non-released) reservations */
  readonly totalReserved: number;
  /**
   * = max(0, allocated - totalConsumed - totalReserved)
   * Clamped to zero; deficit becomes missionDebt.
   */
  readonly unreservedRemaining: number;
  /**
   * Cumulative consumption beyond allocated budget. ≥ 0.
   * When overage exceeds unreserved pool, pool clamps to 0 and excess becomes debt.
   * Triggers over-budget fault state.
   */
  readonly missionDebt: number;
}

// ============================================================================
// Domain Objects — §5, §6, §7, §8, §9
// ============================================================================

/**
 * §5.1: Task budget reservation — the core EGP domain object.
 * Each reservation has two independent ceilings (EGP-I4).
 * Reservation status is subordinate to task state (§5.1).
 *
 * A task has at most one non-released reservation at any time.
 * The reservation persists across retry attempts (EGP-I8) via 'retained' status.
 */
export interface TaskBudgetReservation {
  /** Record identity */
  readonly reservationId: ReservationId;
  /** Task this reservation belongs to — primary lookup key */
  readonly taskId: TaskId;
  /** Mission this task belongs to */
  readonly missionId: MissionId;

  // Token dimension (PSD-7: prompt/completion only)
  /** §5.1: Reserved token ceiling */
  readonly reservedTokens: number;
  /** §5.1: Consumed tokens — cumulative across retry attempts (EGP-I8) */
  readonly consumedTokens: number;

  // Deliberation dimension (CF-06, DBA-I11)
  /** §5.1: Reserved deliberation ceiling */
  readonly reservedDeliberation: number;
  /** §5.1: Consumed deliberation — cumulative across retry attempts (EGP-I8) */
  readonly consumedDeliberation: number;

  /** §5.1: Current lifecycle status (4 values — see ReservationStatus) */
  readonly status: ReservationStatus;
  /** PSD-1: How this reservation was allocated */
  readonly allocationMethod: AllocationMethod;
  /** Record creation timestamp */
  readonly createdAt: string;
  /** Timestamp when released (null if not yet released) */
  readonly releasedAt: string | null;
}

/**
 * §5.0: Mission budget ledger state.
 * Per-dimension budget state for a mission. Both dimensions tracked independently.
 * The conservation law (EGP-I13) holds per dimension at every consistent snapshot.
 */
export interface MissionBudgetState {
  readonly missionId: MissionId;
  /** Token dimension state (PSD-7: prompt/completion only) */
  readonly token: DimensionBudgetState;
  /** Deliberation dimension state (CF-06, DBA-I11) */
  readonly deliberation: DimensionBudgetState;
  /**
   * §5.5: true when missionDebt > 0 in either dimension.
   * No new task admission until checkpoint processed.
   */
  readonly overBudgetFaultActive: boolean;
}

/**
 * §2, §8: Descriptor for a task eligible for scheduling.
 * Used as input to wave composition and scheduler cycle.
 * Dependencies already resolved (eligibility predicate from EGP-I5).
 */
export interface EligibleTaskDescriptor {
  readonly taskId: TaskId;
  /** Task priority — used for deterministic ordering (EGP-I9) */
  readonly priority: number;
  /** Estimated token consumption (prompt/completion) */
  readonly estimatedTokens: number;
  /** Estimated deliberation consumption (PSD-8) */
  readonly estimatedDeliberationTokens: number;
  /**
   * PSD-8: Whether this task requires deliberation reservation.
   * Determined by execution mode (reasoning-capable model), not estimate alone.
   * If true and estimatedDeliberationTokens = 0, task fails DBA admissibility (fail-safe).
   */
  readonly requiresDeliberation: boolean;
}

/**
 * EGP-I5, EGP-I6: Fan-in task dependency resolution status.
 * Evaluates whether a fan-in task is eligible, waiting, or should be cancelled.
 * Policy-aware: behavior differs under isolate, fail-fast, and quorum.
 */
export interface FanInDependencyStatus {
  readonly taskId: TaskId;
  /** Whether the fan-in task is now eligible for scheduling */
  readonly eligible: boolean;
  /** Reason for current status */
  readonly reason:
    | 'all_resolved'        // isolate: all predecessors terminally resolved
    | 'all_completed'       // fail-fast/default: all predecessors completed
    | 'quorum_met'          // quorum: threshold met by completed predecessors
    | 'quorum_impossible'   // quorum: cannot be met — fan-in should be cancelled
    | 'waiting'             // predecessors still active — not yet eligible
    | 'cancelled';          // fan-in cancelled (quorum impossible or fail-fast cascade)
  /** Predecessors that completed successfully */
  readonly completedPredecessors: readonly TaskId[];
  /** Predecessors that reached final failure (no retries) */
  readonly failedPredecessors: readonly TaskId[];
  /** Predecessors that were cancelled */
  readonly cancelledPredecessors: readonly TaskId[];
  /** Predecessors still executing or pending */
  readonly activePredecessors: readonly TaskId[];
  /** Quorum-specific state (only present when policy = 'quorum') */
  readonly quorumState?: {
    /** Configured threshold (0.0-1.0) */
    readonly threshold: number;
    /** ceil(threshold × totalPredecessors) */
    readonly requiredSuccesses: number;
    /** Count of COMPLETED predecessors */
    readonly completedSuccessCount: number;
    /** Count of still-active predecessors (PENDING/SCHEDULED/RUNNING) */
    readonly remainingActiveCount: number;
    /** completedSuccessCount >= requiredSuccesses */
    readonly met: boolean;
    /** completedSuccessCount + remainingActiveCount < requiredSuccesses */
    readonly impossible: boolean;
  };
}

/**
 * EGP-I7, §7.2: Capability retry decision.
 * Returned by the retry policy evaluator when a capability execution fails.
 */
export interface CapabilityRetryDecision {
  /** The capability type that failed */
  readonly capabilityType: string;
  /** Optional operation identifier (for adapters with per-operation classification) */
  readonly operationId?: string;
  /** The mutability class of the failed operation */
  readonly mutabilityClass: MutabilityClass;
  /** Whether auto-retry is permitted based on mutability class */
  readonly retryPermitted: boolean;
  /** Whether sandbox reset is required before retry (side-effecting only) */
  readonly requiresSandboxReset: boolean;
  /** Human-readable reason for the decision */
  readonly reason: string;
}

/**
 * §5.5, EGP-I12: Over-budget fault state.
 * Entered when missionDebt > 0 in either dimension.
 * Blocks new task admission and scheduling until checkpoint processed.
 */
export interface OverBudgetFaultState {
  readonly missionId: MissionId;
  /** Whether the fault is currently active */
  readonly active: boolean;
  /** Which dimension(s) triggered the fault */
  readonly triggeringDimensions: readonly BudgetDimension[];
  /** Token dimension debt amount (0 if not in debt) */
  readonly tokenDebt: number;
  /** Deliberation dimension debt amount (0 if not in debt) */
  readonly deliberationDebt: number;
  /** No new task admission until checkpoint processed */
  readonly admissionBlocked: boolean;
  /** No new scheduling until budget approved or replan reduces work */
  readonly schedulingBlocked: boolean;
}

/**
 * §9.1, EGP-I9: Wave replay record.
 * Captures all scheduling inputs and outputs for deterministic replay.
 * Replay from recorded inputs must produce identical wave composition and reservations.
 */
export interface WaveReplayRecord {
  readonly waveId: WaveId;
  readonly missionId: MissionId;
  /** Eligible task set at decision time */
  readonly eligibleTaskIds: readonly TaskId[];
  /** Priority inputs per task */
  readonly taskPriorities: readonly { readonly taskId: TaskId; readonly priority: number }[];
  /** Required dimensions per task */
  readonly taskDimensions: readonly {
    readonly taskId: TaskId;
    readonly requiresDeliberation: boolean;
    readonly estimatedTokens: number;
    readonly estimatedDeliberationTokens: number;
  }[];
  /** Wave pool snapshot per dimension */
  readonly tokenPoolSnapshot: number;
  readonly deliberationPoolSnapshot: number;
  /** Worker availability at decision time */
  readonly workerAvailability: number;
  /** Computed reservations per task per dimension */
  readonly computedReservations: readonly {
    readonly taskId: TaskId;
    readonly reservedTokens: number;
    readonly reservedDeliberation: number;
  }[];
  /** Allocation method used */
  readonly allocationMethod: AllocationMethod;
  /** Final wave composition — which tasks were selected */
  readonly selectedTaskIds: readonly TaskId[];
  /** Starvation counter state per mission at decision time */
  readonly starvationCounters: readonly {
    readonly missionId: MissionId;
    readonly counter: number;
  }[];
  /** Decision timestamp */
  readonly timestamp: string;
}

/**
 * EGP-I13: Conservation law check result.
 * Verifies: allocated + missionDebt = totalConsumed + reservedRemaining + unreservedRemaining
 * per dimension independently.
 */
export interface ConservationCheckResult {
  /** Whether the conservation law holds in both dimensions */
  readonly holds: boolean;
  /** Token dimension check */
  readonly token: {
    /** allocated + missionDebt */
    readonly leftSide: number;
    /** totalConsumed + sum(reservedRemaining) + unreservedRemaining */
    readonly rightSide: number;
    /** leftSide - rightSide (0 if conservation holds) */
    readonly delta: number;
  };
  /** Deliberation dimension check */
  readonly deliberation: {
    readonly leftSide: number;
    readonly rightSide: number;
    readonly delta: number;
  };
}

// ============================================================================
// Input Types — for store/handler method parameters
// ============================================================================

/**
 * §5.2: Input for creating a budget reservation.
 * Both dimensions specified independently.
 */
export interface ReservationCreateInput {
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  /** Token ceiling for this reservation (PSD-7: prompt/completion) */
  readonly reservedTokens: number;
  /** Deliberation ceiling for this reservation (CF-06) */
  readonly reservedDeliberation: number;
  /** How this reservation was allocated */
  readonly allocationMethod: AllocationMethod;
}

/**
 * §5.2, PSD-3: Input for wave composition.
 * The composer selects a deterministic subset of eligible tasks
 * that can all receive minimum viable reservation.
 */
export interface WaveCompositionInput {
  readonly missionId: MissionId;
  /** Tasks eligible for scheduling (dependencies met, not blocked) */
  readonly eligibleTasks: readonly EligibleTaskDescriptor[];
  /** Available token budget for this wave */
  readonly tokenPool: number;
  /** Available deliberation budget for this wave */
  readonly deliberationPool: number;
  /** Allocation method to use */
  readonly allocationMethod: AllocationMethod;
  /** PSD-2: Minimum token reservation per task */
  readonly minimumViableTokens: number;
  /** PSD-2: Minimum deliberation reservation per task (for tasks requiring deliberation) */
  readonly minimumViableDeliberation: number;
}

/**
 * §6.2: Input for branch failure evaluation.
 * Triggered when a task reaches final failure (after retry exhaustion).
 * NOT triggered on intermediate failures that will be retried.
 */
export interface BranchFailureInput {
  /** The task that reached final failure */
  readonly failedTaskId: TaskId;
  readonly missionId: MissionId;
  /** Mission-level policy (PSD-4) */
  readonly policy: BranchFailurePolicy;
  /** Sibling tasks in the same fan-out set */
  readonly siblingTaskIds: readonly TaskId[];
  /** Current state of each sibling */
  readonly siblingStates: readonly {
    readonly taskId: TaskId;
    readonly state: EGPRelevantTaskState;
  }[];
  /** Fan-in tasks that depend on the failed task or its siblings */
  readonly fanInDependents: readonly {
    readonly taskId: TaskId;
    readonly allPredecessorIds: readonly TaskId[];
    readonly quorumThreshold?: number;
  }[];
}

/**
 * §8, EGP-I5: Input for a scheduler cycle.
 * Contains all inputs needed for deterministic scheduling (EGP-I9).
 */
export interface SchedulerCycleInput {
  /** Number of idle workers available for task dispatch */
  readonly availableWorkers: number;
  /** Missions with eligible tasks */
  readonly eligibleMissions: readonly {
    readonly missionId: MissionId;
    readonly eligibleTasks: readonly EligibleTaskDescriptor[];
    readonly tokenPool: number;
    readonly deliberationPool: number;
    readonly branchFailurePolicy: BranchFailurePolicy;
    readonly starvationCounter: number;
  }[];
  /** CF-11: Configurable starvation bound */
  readonly starvationBound: number;
  /** Default allocation method */
  readonly allocationMethod: AllocationMethod;
  /** PSD-2: Minimum viable reservation per dimension */
  readonly minimumViableTokens: number;
  readonly minimumViableDeliberation: number;
}

/**
 * §6.3: Input for replan budget calculation.
 * Determines available budget after cancelling old graph tasks.
 */
export interface ReplanBudgetInput {
  readonly missionId: MissionId;
  /** All tasks from the current (old) graph with their states */
  readonly currentGraphTasks: readonly {
    readonly taskId: TaskId;
    readonly state: EGPRelevantTaskState;
  }[];
}

// ============================================================================
// Output/Result Types
// ============================================================================

/**
 * §5.2, PSD-3: Result of wave composition.
 * All reservations computed against immutable pool snapshot and committed atomically.
 */
export interface WaveCompositionResult {
  /** Unique identifier for this wave */
  readonly waveId: WaveId;
  readonly missionId: MissionId;
  /** Tasks selected for this wave */
  readonly scheduledTaskIds: readonly TaskId[];
  /** Reservations created for selected tasks */
  readonly reservations: readonly TaskBudgetReservation[];
  /** Tasks excluded from the wave and why */
  readonly excludedTasks: readonly {
    readonly taskId: TaskId;
    readonly reason: string;
  }[];
  /** Allocation method used */
  readonly allocationMethod: AllocationMethod;
  /** Immutable pool snapshots at wave start */
  readonly tokenPoolSnapshot: number;
  readonly deliberationPoolSnapshot: number;
}

/**
 * §6.2: Result of branch failure evaluation.
 */
export interface BranchFailureResult {
  readonly failedTaskId: TaskId;
  readonly missionId: MissionId;
  readonly policy: BranchFailurePolicy;
  /** Tasks cancelled as a result of the failure (fail-fast siblings, quorum-impossible fan-ins) */
  readonly cancelledTaskIds: readonly TaskId[];
  /** Reservations released from cancelled tasks */
  readonly releasedReservationIds: readonly ReservationId[];
  /** Updated fan-in dependency status for affected dependents */
  readonly affectedFanIns: readonly FanInDependencyStatus[];
}

/**
 * §8, EGP-I5: Result of a scheduler cycle.
 */
export interface SchedulerCycleResult {
  /** Waves composed and committed in this cycle */
  readonly waves: readonly WaveCompositionResult[];
  /** Starvation counter updates */
  readonly starvationUpdates: readonly {
    readonly missionId: MissionId;
    readonly newCounter: number;
    /** true if starvation bound triggered priority promotion */
    readonly promoted: boolean;
  }[];
  /** Missions with eligible tasks that were not scheduled and why */
  readonly unscheduledMissions: readonly {
    readonly missionId: MissionId;
    readonly reason: string;
  }[];
  /** Worker availability snapshot for replay */
  readonly workerAvailabilitySnapshot: number;
  /** Replay record for this cycle */
  readonly replayRecord: WaveReplayRecord;
}

/**
 * §6.3: Result of replan budget calculation.
 */
export interface ReplanBudgetResult {
  /** Available token budget for new graph (both dimensions) */
  readonly replanBudgetTokens: number;
  readonly replanBudgetDeliberation: number;
  /** Tasks cancelled during replan */
  readonly cancelledTasks: readonly {
    readonly taskId: TaskId;
    readonly previousState: string;
    /** Budget released per dimension */
    readonly releasedTokens: number;
    readonly releasedDeliberation: number;
  }[];
  /** RUNNING tasks excluded from replan — their reservations are committed */
  readonly runningTasksExcluded: readonly {
    readonly taskId: TaskId;
    /** Budget committed (unavailable for replan) per dimension */
    readonly committedTokens: number;
    readonly committedDeliberation: number;
  }[];
}

/**
 * EGP-I1, EGP-I11: Result of headroom check before invocation authorization.
 * Both dimensions checked independently.
 */
export interface HeadroomCheckResult {
  /** Whether the invocation is allowed (both dimensions have headroom) */
  readonly allowed: boolean;
  /** Available headroom per dimension */
  readonly tokenHeadroom: number;
  readonly deliberationHeadroom: number;
  /** Whether either dimension is exhausted */
  readonly tokenExhausted: boolean;
  readonly deliberationExhausted: boolean;
  /** Whether this invocation would cause overage per dimension */
  readonly wouldCauseTokenOverage: boolean;
  readonly wouldCauseDeliberationOverage: boolean;
  /** Projected overage amounts if the invocation proceeds */
  readonly projectedTokenOverage: number;
  readonly projectedDeliberationOverage: number;
}

/**
 * EGP-I3: Result of EGP's terminal transition operation.
 * Phase 1D will compose this with WMP's terminal operation.
 *
 * Three cases:
 *   'released'  — final terminal: budget reclaimed per dimension
 *   'retained'  — task failed with retries: reservation persists
 *   'none'      — v3.2 task without reservation: no-op
 */
export interface EGPTerminalResult {
  /** What EGP did with the reservation */
  readonly action: 'released' | 'retained' | 'none';
  /** Reclaimed token budget (0 if retained or none) */
  readonly reclaimedTokens: number;
  /** Reclaimed deliberation budget (0 if retained or none) */
  readonly reclaimedDeliberation: number;
  /** Token overage recorded (consumption > reservation, charged to mission pool) */
  readonly overageTokens: number;
  /** Deliberation overage recorded */
  readonly overageDeliberation: number;
  /** Reservation affected (null if no reservation — v3.2 compatibility) */
  readonly reservationId: ReservationId | null;
}

// ============================================================================
// Store Interfaces — persistence layer
// ============================================================================

/**
 * §5.1, §5.2: Budget reservation store.
 * CRUD operations for TaskBudgetReservation records.
 * All methods follow (conn, ctx) pattern per CCP precedent.
 */
export interface BudgetReservationStore {
  /** Create a single reservation */
  create(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: ReservationCreateInput,
  ): Result<TaskBudgetReservation>;

  /** Create reservations for an entire wave atomically (§5.2: committed in single transaction) */
  createBatch(
    conn: DatabaseConnection,
    ctx: OperationContext,
    inputs: readonly ReservationCreateInput[],
  ): Result<readonly TaskBudgetReservation[]>;

  /** Get reservation by task ID (primary lookup) */
  getByTaskId(
    conn: DatabaseConnection,
    taskId: TaskId,
  ): Result<TaskBudgetReservation | null>;

  /** Get reservation by reservation ID */
  getById(
    conn: DatabaseConnection,
    reservationId: ReservationId,
  ): Result<TaskBudgetReservation>;

  /** Transition reservation: reserved → active (task begins execution) */
  activate(
    conn: DatabaseConnection,
    reservationId: ReservationId,
  ): Result<void>;

  /** Transition reservation: active → retained (task failed, retries remain) [EGP-I8] */
  retain(
    conn: DatabaseConnection,
    reservationId: ReservationId,
  ): Result<void>;

  /** Transition reservation: retained → active (retry execution begins) [EGP-I8] */
  reactivate(
    conn: DatabaseConnection,
    reservationId: ReservationId,
  ): Result<void>;

  /** Update consumption counters (both dimensions) */
  updateConsumed(
    conn: DatabaseConnection,
    reservationId: ReservationId,
    tokensConsumed: number,
    deliberationConsumed: number,
  ): Result<void>;

  /**
   * Release reservation and reclaim unused budget (EGP-I3).
   * Atomic with terminal state transition.
   * Returns reclaimed amounts and overage per dimension.
   */
  release(
    conn: DatabaseConnection,
    ctx: OperationContext,
    reservationId: ReservationId,
    reason: string,
  ): Result<{
    readonly reclaimedTokens: number;
    readonly reclaimedDeliberation: number;
    readonly overageTokens: number;
    readonly overageDeliberation: number;
  }>;

  /** Get all active (non-released) reservations for a mission */
  getActiveByMission(
    conn: DatabaseConnection,
    missionId: MissionId,
  ): Result<readonly TaskBudgetReservation[]>;
}

/**
 * §5.0, EGP-I13: Mission budget ledger.
 * Manages per-dimension budget state. Enforces conservation law.
 */
export interface MissionBudgetLedger {
  /** Get current budget state for a mission (both dimensions) */
  getState(
    conn: DatabaseConnection,
    missionId: MissionId,
  ): Result<MissionBudgetState>;

  /** Reserve budget from unreserved pool (during wave allocation) — per dimension */
  reserveFromPool(
    conn: DatabaseConnection,
    missionId: MissionId,
    tokenAmount: number,
    deliberationAmount: number,
  ): Result<void>;

  /** Return reclaimed budget to unreserved pool (during reservation release) — per dimension */
  returnToPool(
    conn: DatabaseConnection,
    missionId: MissionId,
    tokenAmount: number,
    deliberationAmount: number,
  ): Result<void>;

  /** Record consumption against a mission (increments totalConsumed) — per dimension */
  recordConsumption(
    conn: DatabaseConnection,
    missionId: MissionId,
    tokenAmount: number,
    deliberationAmount: number,
  ): Result<void>;

  /**
   * Record overage and potentially enter over-budget fault state (EGP-I12).
   * If overage exceeds unreserved pool, pool clamps to 0 and excess becomes missionDebt.
   * Returns OverBudgetFaultState if fault entered, null otherwise.
   */
  recordOverage(
    conn: DatabaseConnection,
    ctx: OperationContext,
    missionId: MissionId,
    tokenOverage: number,
    deliberationOverage: number,
  ): Result<OverBudgetFaultState | null>;

  /** Verify conservation law holds (EGP-I13) — per dimension independently */
  checkConservation(
    conn: DatabaseConnection,
    missionId: MissionId,
  ): Result<ConservationCheckResult>;

  /**
   * Phase 2B Wire: Initialize mission budget allocation.
   * Sets the allocated and unreservedRemaining fields for a mission.
   * Called when a mission is created with a budget.
   *
   * Conservation: allocated = unreservedRemaining (initially, all budget is unreserved).
   * Subsequent operations (reserve, consume, release) maintain the equation.
   *
   * Required for I-87 (floor enforcement): floor = allocated * floorPct.
   * Without allocated, floor is always 0 and floor enforcement is vacuous.
   */
  initializeBudget(
    conn: DatabaseConnection,
    missionId: MissionId,
    tokenAllocation: number,
    deliberationAllocation: number,
  ): Result<void>;

  /**
   * Phase 2B Wire: Finalize reservation at terminal state (conservation-correct).
   * Atomically performs the full reservation accounting:
   *   - totalReserved -= (consumedTokens + reclaimedTokens)  [full reservation removed]
   *   - unreservedRemaining += reclaimedTokens               [unconsumed returned]
   *   - totalConsumed += consumedTokens                       [consumed accounted]
   *
   * Conservation proof: right-side change = +C - (C+R) + R = 0. Equation holds.
   *
   * This replaces the separate returnToPool + recordConsumption pattern,
   * which cannot correctly move consumed from "reserved" to "consumed"
   * without transiently breaking conservation.
   *
   * Invariants: EGP-I3 (atomic reclaim), EGP-I13 (conservation), I-83 (terminal release).
   */
  finalizeReservation(
    conn: DatabaseConnection,
    missionId: MissionId,
    consumedTokens: number,
    consumedDeliberation: number,
    reclaimedTokens: number,
    reclaimedDeliberation: number,
  ): Result<void>;
}

// ============================================================================
// Algorithm/Handler Interfaces — governance logic
// ============================================================================

/**
 * PSD-3, EGP-I9: Wave composer.
 * Selects a deterministic subset of eligible tasks for scheduling.
 * Algorithm is implementation freedom (PSD-3) but output must be deterministic (EGP-I9).
 * All reservations computed against immutable pool snapshot and committed atomically.
 */
export interface WaveComposer {
  compose(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: WaveCompositionInput,
  ): Result<WaveCompositionResult>;
}

/**
 * EGP-I6, §6.2: Branch failure handler.
 * Evaluates branch failure policies when a task reaches final failure.
 * NOT triggered on intermediate failures that will be retried (§6.2 triggering condition).
 */
export interface BranchFailureHandler {
  /**
   * Handle a task reaching final failure state.
   * Evaluates the mission's branch failure policy and cancels siblings/dependents as required.
   */
  handleFailure(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: BranchFailureInput,
  ): Result<BranchFailureResult>;

  /**
   * Evaluate a fan-in task's dependency status under the active policy.
   * Used for scheduling eligibility determination.
   */
  evaluateFanIn(
    conn: DatabaseConnection,
    taskId: TaskId,
    policy: BranchFailurePolicy,
    predecessors: readonly {
      readonly taskId: TaskId;
      readonly state: EGPRelevantTaskState;
    }[],
    quorumThreshold?: number,
  ): Result<FanInDependencyStatus>;
}

/**
 * EGP-I7, §7.2: Capability retry policy evaluator.
 * Determines whether a failed capability invocation can be auto-retried
 * based on the operation's mutability classification.
 */
export interface CapabilityRetryPolicy {
  /**
   * Evaluate retry decision for a failed capability.
   * Decision based on operation-level classification (not adapter family default).
   */
  evaluate(
    capabilityType: string,
    operationId: string | undefined,
    mutabilityClass: MutabilityClass,
    sandboxResetAvailable: boolean,
  ): Result<CapabilityRetryDecision>;

  /**
   * Get the default mutability class for a capability type (adapter family default).
   * Used when an operation has no explicit classification.
   */
  getDefaultClass(
    capabilityType: string,
  ): Result<MutabilityClass>;
}

/**
 * §8, EGP-I5, EGP-I9: Scheduler engine.
 * Executes a complete scheduler cycle: mission admission, wave composition,
 * starvation tracking. Algorithm is implementation freedom (PSD-3) but
 * output must be deterministic (EGP-I9) with starvation bound enforced (EGP-I5).
 */
export interface SchedulerEngine {
  executeCycle(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: SchedulerCycleInput,
  ): Result<SchedulerCycleResult>;
}

/**
 * §5.3, EGP-I1, EGP-I11: Reservation enforcer.
 * Checks consumption against reservation ceilings per dimension.
 * Provides the headroom surface that DBA's admissibility check queries.
 */
export interface ReservationEnforcer {
  /**
   * Check headroom before authorizing an invocation.
   * Both dimensions checked independently (EGP-I4).
   * Returns allowed=false if either dimension is exhausted.
   */
  checkHeadroom(
    conn: DatabaseConnection,
    taskId: TaskId,
    additionalTokens: number,
    additionalDeliberation: number,
  ): Result<HeadroomCheckResult>;

  /**
   * Handle post-invocation overage reconciliation (EGP-I12).
   * Charges overage to mission unreserved pool per dimension.
   * Returns fault state if mission enters over-budget.
   */
  handleOverage(
    conn: DatabaseConnection,
    ctx: OperationContext,
    taskId: TaskId,
    tokenOverage: number,
    deliberationOverage: number,
  ): Result<OverBudgetFaultState | null>;
}

/**
 * §6.3: Replan calculator.
 * Determines available budget after cancelling old graph tasks during replan.
 */
export interface ReplanCalculator {
  calculateReplanBudget(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: ReplanBudgetInput,
  ): Result<ReplanBudgetResult>;
}

/**
 * §8.2, EGP-I5: Starvation tracker.
 * Per-mission counter of consecutive unscheduled cycles.
 * In-memory only — resets on engine restart (per Implementation Doctrine §4.3).
 * Does not use DatabaseConnection since it's a runtime-only structure.
 */
export interface StarvationTracker {
  /** Increment counter for a mission (was eligible but not scheduled) */
  increment(missionId: MissionId): void;
  /** Reset counter for a mission (was scheduled) */
  reset(missionId: MissionId): void;
  /** Get current counter value for a mission */
  getCounter(missionId: MissionId): number;
  /** Check if counter exceeds the configured starvation bound */
  isAboveBound(missionId: MissionId, bound: number): boolean;
  /** Get all non-zero counters (for replay record) */
  getAllCounters(): ReadonlyMap<string, number>;
}

/**
 * EGP-I3, EGP-I8: Terminal operation handler.
 * EGP's contribution to the composed TaskTerminalTransition (Phase 1D).
 *
 * Called when a task exits RUNNING state:
 *   - COMPLETED: release reservation, reclaim unused budget per dimension
 *   - CANCELLED: release reservation, reclaim unused budget per dimension
 *   - FAILED with retries remaining: retain reservation (not released)
 *   - FAILED without retries: release reservation, reclaim unused budget per dimension
 *   - Task has no reservation (v3.2 compatibility): no-op
 *
 * Must be atomic with the task state transition (I-03).
 */
export interface EGPTerminalOperationHandler {
  execute(
    conn: DatabaseConnection,
    ctx: OperationContext,
    taskId: TaskId,
    terminalState: 'COMPLETED' | 'CANCELLED' | 'FAILED',
    hasRetriesRemaining: boolean,
  ): Result<EGPTerminalResult>;
}

// ============================================================================
// Phase 0A Integration Interfaces — v1.1 Defect Class Coverage
// ============================================================================

/**
 * DC-EGP-064: Admission-time reservation gate.
 * Validates that a v3.3 task has a budget reservation before transitioning
 * to 'executing' state. This is the EGP side of the TransitionEnforcer
 * composition (Phase 1D).
 *
 * Truth-model obligation: EGP-I14 (reservation requirement).
 * A v3.3 task cannot enter 'executing' without a non-released reservation.
 * v3.2 tasks are exempt (backward compatibility via PSD-5).
 */
export interface ReservationAdmissionGate {
  /**
   * Check if a task has a valid (non-released) reservation for execution.
   * Returns admitted=true if reservation exists and is in valid state,
   * or if task is a v3.2 task (exempt from reservation requirement).
   */
  checkAdmission(
    conn: DatabaseConnection,
    ctx: OperationContext,
    taskId: TaskId,
    taskVersion: '3.2' | '3.3',
  ): Result<{
    readonly admitted: boolean;
    readonly reason: string;
    readonly reservationId: ReservationId | null;
  }>;
}

/**
 * DC-EGP-063: Reservation age monitoring (runtime companion).
 * Detects reservations in 'reserved' status that have exceeded a configurable
 * age threshold — indicating the task was never scheduled for execution.
 *
 * Control mode: contained in runtime. This interface provides the detection
 * surface; remediation is operational (monitoring/alerting).
 */
export interface ReservationAgeMonitor {
  /**
   * Query for reservations that have been in 'reserved' status longer than maxAgeMs.
   * Returns orphan candidates for operational review.
   */
  getOrphanedReservations(
    conn: DatabaseConnection,
    maxAgeMs: number,
  ): Result<readonly {
    readonly reservationId: ReservationId;
    readonly taskId: TaskId;
    readonly missionId: MissionId;
    readonly ageMs: number;
    readonly status: ReservationStatus;
  }[]>;
}

/**
 * DC-EGP-062, DC-EGP-066: Suspended reservation query.
 * Checks whether a task's reservation should be treated as non-consumable
 * because the task (or its mission) is currently suspended (INV-X05).
 *
 * DC-EGP-062: Suspension not reflected in reservation state — headroom
 * should return allowed=false for suspended tasks.
 * DC-EGP-066: Suspended reservation accumulation — consumption should not
 * accrue against a suspended task's reservation.
 */
export interface SuspendedReservationQuery {
  /**
   * Check if a task's reservation is effectively frozen due to suspension.
   * Returns true if the task or its parent mission has an active suspension.
   */
  isTaskSuspended(
    conn: DatabaseConnection,
    taskId: TaskId,
  ): Result<boolean>;

  /**
   * Check if a mission-level suspension affects reservation operations.
   * Returns true if the mission has an active suspension (BC-049: cascades to tasks).
   */
  isMissionSuspended(
    conn: DatabaseConnection,
    missionId: MissionId,
  ): Result<boolean>;
}

// ============================================================================
// Facade — ExecutionGovernor
// ============================================================================

/**
 * EGP Facade: Execution Governor.
 * Composes all EGP subsystems into a single frozen entry point.
 * Pattern: identical to LearningSystem facade (Object.freeze'd).
 */
export interface ExecutionGovernor {
  readonly reservations: BudgetReservationStore;
  readonly ledger: MissionBudgetLedger;
  readonly waveComposer: WaveComposer;
  readonly branchFailure: BranchFailureHandler;
  readonly retryPolicy: CapabilityRetryPolicy;
  readonly scheduler: SchedulerEngine;
  readonly enforcer: ReservationEnforcer;
  readonly replanCalculator: ReplanCalculator;
  readonly starvation: StarvationTracker;
  readonly terminalOp: EGPTerminalOperationHandler;
  /** DC-EGP-064: Admission-time reservation gate (Phase 0A integration) */
  readonly admissionGate: ReservationAdmissionGate;
  /** DC-EGP-063: Reservation age monitoring (runtime companion) */
  readonly ageMonitor: ReservationAgeMonitor;
  /** DC-EGP-062/066: Suspension-aware reservation query (Phase 0A integration) */
  readonly suspendedQuery: SuspendedReservationQuery;
}

/**
 * External dependencies for the ExecutionGovernor.
 * Injected at construction time.
 */
export interface ExecutionGovernorDeps {
  /** I-03: Audit trail for atomic audit entries */
  readonly audit: {
    append(conn: DatabaseConnection, input: {
      readonly tenantId: string | null;
      readonly actorType: string;
      readonly actorId: string;
      readonly action: string;
      readonly resourceType: string;
      readonly resourceId: string;
      readonly detail: Record<string, unknown>;
      readonly parentEntryId?: string;
    }): Result<unknown>;
  };
  /** §10: Event bus for EGP event emission */
  readonly events: {
    emit(event: {
      readonly type: string;
      readonly scope: string;
      readonly propagation: string;
      readonly payload: Record<string, unknown>;
    }): void;
  };
  /**
   * Phase 0A: TraceEmitter for constitutional event emission (DC-EGP-050/051/052).
   * Optional — EGP functions without trace emission in pre-Phase-0A mode.
   * Minimal projection of TraceEmitter interface (trace.ts).
   */
  readonly traceEmitter?: {
    emit(conn: DatabaseConnection, ctx: OperationContext, event: {
      readonly correlationId: CorrelationId;
      readonly type: string;
      readonly payload: Record<string, unknown>;
    }): Result<unknown>;
  };
  /**
   * Phase 0A: Suspension store query for suspension-aware headroom (DC-EGP-062/066).
   * Optional — EGP functions without suspension awareness in pre-Phase-0A mode.
   * Minimal projection: only needs getActiveForTarget from SuspensionStore.
   */
  readonly suspensionQuery?: {
    getActiveForTarget(
      conn: DatabaseConnection,
      targetType: 'mission' | 'task',
      targetId: string,
    ): Result<unknown | null>;
  };
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: import('../../kernel/interfaces/time.js').TimeProvider;
}

// ============================================================================
// Error Code Constants
// ============================================================================

/** Reservation operation error codes */
export const RESERVATION_ERROR_CODES = Object.freeze({
  /** Reservation not found for given taskId or reservationId */
  NOT_FOUND: 'EGP_RESERVATION_NOT_FOUND',
  /** Task already has a non-released reservation */
  ALREADY_EXISTS: 'EGP_RESERVATION_ALREADY_EXISTS',
  /** Invalid status transition attempted */
  INVALID_TRANSITION: 'EGP_RESERVATION_INVALID_TRANSITION',
  /** Reservation below minimum viable threshold (PSD-2) */
  BELOW_MINIMUM: 'EGP_RESERVATION_BELOW_MINIMUM',
  /** Both dimensions must meet minimum — one or both insufficient */
  DIMENSION_INSUFFICIENT: 'EGP_RESERVATION_DIMENSION_INSUFFICIENT',
} as const);

/** Wave composition error codes */
export const WAVE_ERROR_CODES = Object.freeze({
  /** Not enough budget in either dimension for any task's minimum */
  POOL_INSUFFICIENT: 'EGP_WAVE_POOL_INSUFFICIENT',
  /** No eligible tasks for wave composition */
  NO_ELIGIBLE_TASKS: 'EGP_WAVE_NO_ELIGIBLE_TASKS',
  /** Wave composition produced no scheduled tasks (all below minimum) */
  COMPOSITION_EMPTY: 'EGP_WAVE_COMPOSITION_EMPTY',
  /** DC-EGP-068: Negative pool value in wave input */
  INVALID_POOL: 'EGP_WAVE_INVALID_POOL',
  /** DC-EGP-068: Duplicate taskId in eligible task set */
  DUPLICATE_TASK: 'EGP_WAVE_DUPLICATE_TASK',
  /** DC-EGP-068: Negative or NaN task estimate in eligible set */
  INVALID_TASK_ESTIMATE: 'EGP_WAVE_INVALID_TASK_ESTIMATE',
} as const);

/** Branch failure error codes */
export const BRANCH_FAILURE_ERROR_CODES = Object.freeze({
  /** Invalid branch failure policy specified */
  INVALID_POLICY: 'EGP_BRANCH_INVALID_POLICY',
  /** Quorum threshold out of range (must be 0.0-1.0) */
  QUORUM_THRESHOLD_INVALID: 'EGP_BRANCH_QUORUM_THRESHOLD_INVALID',
  /** Failed task not found in mission */
  TASK_NOT_FOUND: 'EGP_BRANCH_TASK_NOT_FOUND',
} as const);

/** Scheduler error codes */
export const SCHEDULER_ERROR_CODES = Object.freeze({
  /** No missions with eligible tasks */
  NO_ELIGIBLE_MISSIONS: 'EGP_SCHEDULER_NO_ELIGIBLE_MISSIONS',
  /** Worker pool exhausted — no idle workers */
  NO_WORKERS_AVAILABLE: 'EGP_SCHEDULER_NO_WORKERS',
} as const);

/** Enforcement error codes */
export const ENFORCEMENT_ERROR_CODES = Object.freeze({
  /** Task's reservation exhausted in token dimension */
  TOKEN_HEADROOM_EXHAUSTED: 'EGP_ENFORCEMENT_TOKEN_EXHAUSTED',
  /** Task's reservation exhausted in deliberation dimension */
  DELIBERATION_HEADROOM_EXHAUSTED: 'EGP_ENFORCEMENT_DELIBERATION_EXHAUSTED',
  /** Mission entered over-budget fault state */
  OVER_BUDGET_FAULT: 'EGP_ENFORCEMENT_OVER_BUDGET',
  /** DC-EGP-002: Negative consumption value rejected (v1.1 strengthened) */
  INVALID_CONSUMPTION: 'EGP_ENFORCEMENT_INVALID_CONSUMPTION',
} as const);

/** SC-2 amendment error codes (propose_task_graph extensions) */
export const SC2_EGP_ERROR_CODES = Object.freeze({
  /** estimatedDeliberationTokens is negative or NaN */
  DELIBERATION_ESTIMATE_INVALID: 'EGP_SC2_DELIBERATION_ESTIMATE_INVALID',
  /** quorumThreshold is < 0 or > 1.0 */
  QUORUM_THRESHOLD_INVALID: 'EGP_SC2_QUORUM_THRESHOLD_INVALID',
  /** branchFailurePolicy is not a valid policy string */
  BRANCH_POLICY_INVALID: 'EGP_SC2_BRANCH_POLICY_INVALID',
} as const);

/** SC-3 amendment error codes (propose_task_execution extensions) */
export const SC3_EGP_ERROR_CODES = Object.freeze({
  /** Not enough token budget for minimum viable reservation */
  BUDGET_INSUFFICIENT_TOKEN: 'EGP_SC3_BUDGET_INSUFFICIENT_TOKEN',
  /** Not enough deliberation budget for minimum viable reservation */
  BUDGET_INSUFFICIENT_DELIBERATION: 'EGP_SC3_BUDGET_INSUFFICIENT_DELIBERATION',
} as const);

/** Retry policy error codes */
export const RETRY_ERROR_CODES = Object.freeze({
  /** Capability type not recognized */
  UNKNOWN_CAPABILITY: 'EGP_RETRY_UNKNOWN_CAPABILITY',
  /** Operation's mutability class could not be determined */
  UNCLASSIFIED_OPERATION: 'EGP_RETRY_UNCLASSIFIED_OPERATION',
  /** Sandbox reset required but not available */
  SANDBOX_RESET_UNAVAILABLE: 'EGP_RETRY_SANDBOX_RESET_UNAVAILABLE',
} as const);

/** Admission gate error codes (DC-EGP-064) */
export const ADMISSION_ERROR_CODES = Object.freeze({
  /** v3.3 task has no non-released reservation */
  NO_RESERVATION: 'EGP_ADMISSION_NO_RESERVATION',
  /** Task is suspended — admission blocked (DC-EGP-062) */
  TASK_SUSPENDED: 'EGP_ADMISSION_TASK_SUSPENDED',
  /** Mission is suspended — admission blocked for all tasks (BC-049) */
  MISSION_SUSPENDED: 'EGP_ADMISSION_MISSION_SUSPENDED',
} as const);

// ============================================================================
// Event Constants — §10 integration
// ============================================================================

/**
 * EGP events emitted through the EventBus.
 * Each event includes scope (task/mission/system) and propagation direction.
 */
export const EGP_EVENTS = Object.freeze({
  /** §5.3: Task's reservation exhausted in one or both dimensions */
  TASK_BUDGET_EXCEEDED: 'egp.task_budget_exceeded',
  /** §5.5: Mission entered over-budget fault state */
  MISSION_BUDGET_EXCEEDED: 'egp.mission_budget_exceeded',
  /** Reservation created during wave allocation */
  RESERVATION_CREATED: 'egp.reservation_created',
  /** Reservation activated (task began execution) */
  RESERVATION_ACTIVATED: 'egp.reservation_activated',
  /** Reservation retained (task failed with retries remaining) */
  RESERVATION_RETAINED: 'egp.reservation_retained',
  /** Reservation released (final terminal state, budget reclaimed) */
  RESERVATION_RELEASED: 'egp.reservation_released',
  /** Scheduling wave composed and committed */
  WAVE_COMPOSED: 'egp.wave_composed',
  /** Branch failure policy evaluated */
  BRANCH_FAILURE_EVALUATED: 'egp.branch_failure_evaluated',
  /** EGP-I5: Starvation bound triggered — mission promoted */
  STARVATION_BOUND_TRIGGERED: 'egp.starvation_bound_triggered',
} as const);

// ============================================================================
// Configuration Constants — PSD-2, §8.2
// ============================================================================

/**
 * PSD-2: Default minimum viable reservation — token dimension.
 * Tasks that cannot receive at least this amount are not scheduled.
 * Prevents reservation fragmentation (FM-EGP-01).
 */
export const DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS = 100;

/**
 * PSD-2: Default minimum viable reservation — deliberation dimension.
 * For tasks requiring deliberation reservation (PSD-8).
 */
export const DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION = 50;

/**
 * §8.2, EGP-I5: Default starvation bound.
 * Per Implementation Doctrine §4.3: 100 cycles (10 seconds at 100ms polling).
 */
export const DEFAULT_MAX_STARVATION_CYCLES = 100;

/**
 * EGP-I7, §7.1: Default mutability class per capability type.
 * Unclassified operations default to mutating-external (safest assumption).
 */
export const DEFAULT_CAPABILITY_MUTABILITY: Readonly<Record<string, MutabilityClass>> = Object.freeze({
  web_search: 'read-only',
  web_fetch: 'read-only',
  code_execute: 'side-effecting',
  data_query: 'read-only',
  file_read: 'read-only',
  file_write: 'mutating',
  api_call: 'mutating-external',
});
