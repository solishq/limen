/**
 * EGP (Execution Governance Protocol) implementation — all 13 subsystems.
 * Spec ref: EGP v1.0 Design Source (FINAL), Architecture Freeze CF-06/CF-11
 *
 * Phase: v3.3.0 — Execution Governance Implementation (Control 3, Phase 5)
 * Status: IMPLEMENTATION — replaces NotImplementedError harness.
 *
 * Architecture: In-memory stateful implementation within governor factory closure.
 * State lives in Maps (reservations, mission budgets, starvation counters).
 * DatabaseConnection accepted for interface compliance; state is not SQL-backed.
 * StarvationTracker explicitly in-memory per AMB-06.
 *
 * Invariants enforced:
 *   EGP-I1  Reservation Isolation (overage doesn't leak across tasks)
 *   EGP-I3  Atomic Reclaim on Final Terminal per dimension
 *   EGP-I4  Dual-Dimension Enforcement (token + deliberation independently)
 *   EGP-I5  Starvation Bound (N+1 cycles → priority promotion)
 *   EGP-I6  Branch Failure Policies (isolate, fail-fast, quorum)
 *   EGP-I7  Capability Mutability Classification per operation
 *   EGP-I8  Retry Consumes Same Reservation (cumulative consumption)
 *   EGP-I9  Scheduling Determinism (same inputs → same output)
 *   EGP-I10 Running Tasks Not Preemptible
 *   EGP-I12 Overage Normalization (clamp to zero, debt to mission)
 *   EGP-I13 Conservation Law per dimension
 *   EGP-I14 v3.3 task requires reservation for execution (DC-EGP-064)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  OperationContext, Result, TaskId, MissionId,
} from '../../kernel/interfaces/index.js';

import type {
  ExecutionGovernor,
  ExecutionGovernorDeps,
  EGPOperationContext,
  BudgetReservationStore,
  MissionBudgetLedger,
  WaveComposer,
  BranchFailureHandler,
  CapabilityRetryPolicy,
  SchedulerEngine,
  ReservationEnforcer,
  ReplanCalculator,
  StarvationTracker,
  EGPTerminalOperationHandler,
  ReservationAdmissionGate,
  ReservationAgeMonitor,
  SuspendedReservationQuery,
  TaskBudgetReservation,
  ReservationCreateInput,
  ReservationId,
  ReservationStatus,
  MissionBudgetState,
  DimensionBudgetState,
  ConservationCheckResult,
  OverBudgetFaultState,
  WaveCompositionInput,
  WaveCompositionResult,
  WaveReplayRecord,
  BranchFailureInput,
  BranchFailureResult,
  FanInDependencyStatus,
  EGPRelevantTaskState,
  MutabilityClass,
  CapabilityRetryDecision,
  SchedulerCycleInput,
  SchedulerCycleResult,
  HeadroomCheckResult,
  ReplanBudgetInput,
  ReplanBudgetResult,
  EGPTerminalResult,
  WaveId,
  BudgetDimension,
  AllocationMethod,
} from '../interfaces/egp_types.js';

import {
  RESERVATION_STATUS_TRANSITIONS,
  DEFAULT_CAPABILITY_MUTABILITY,
  EGP_EVENTS,
  RESERVATION_ERROR_CODES,
  WAVE_ERROR_CODES,
  BRANCH_FAILURE_ERROR_CODES,
  SCHEDULER_ERROR_CODES,
  ENFORCEMENT_ERROR_CODES,
} from '../interfaces/egp_types.js';

// ============================================================================
// Result Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string = ''): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// ============================================================================
// Internal Mutable State Types
// ============================================================================

interface MutableReservation {
  reservationId: ReservationId;
  taskId: TaskId;
  missionId: MissionId;
  reservedTokens: number;
  consumedTokens: number;
  reservedDeliberation: number;
  consumedDeliberation: number;
  status: ReservationStatus;
  allocationMethod: AllocationMethod;
  createdAt: string;
  releasedAt: string | null;
}

interface MutableDimensionState {
  allocated: number;
  totalConsumed: number;
  totalReserved: number;
  unreservedRemaining: number;
  missionDebt: number;
}

interface MutableMissionBudget {
  missionId: MissionId;
  token: MutableDimensionState;
  deliberation: MutableDimensionState;
}

// ============================================================================
// Freeze Helpers
// ============================================================================

function freezeReservation(r: MutableReservation): TaskBudgetReservation {
  return Object.freeze({
    reservationId: r.reservationId,
    taskId: r.taskId,
    missionId: r.missionId,
    reservedTokens: r.reservedTokens,
    consumedTokens: r.consumedTokens,
    reservedDeliberation: r.reservedDeliberation,
    consumedDeliberation: r.consumedDeliberation,
    status: r.status,
    allocationMethod: r.allocationMethod,
    createdAt: r.createdAt,
    releasedAt: r.releasedAt,
  });
}

function freezeDimension(d: MutableDimensionState): DimensionBudgetState {
  return Object.freeze({
    allocated: d.allocated,
    totalConsumed: d.totalConsumed,
    totalReserved: d.totalReserved,
    unreservedRemaining: d.unreservedRemaining,
    missionDebt: d.missionDebt,
  });
}

function freezeBudgetState(b: MutableMissionBudget): MissionBudgetState {
  return Object.freeze({
    missionId: b.missionId,
    token: freezeDimension(b.token),
    deliberation: freezeDimension(b.deliberation),
    overBudgetFaultActive: b.token.missionDebt > 0 || b.deliberation.missionDebt > 0,
  });
}

// ============================================================================
// Event Emission Helpers
// ============================================================================

function emitEvent(
  deps: ExecutionGovernorDeps,
  type: string,
  scope: string,
  payload: Record<string, unknown>,
): void {
  deps.events.emit({ type, scope, propagation: 'up', payload });
}

function emitTrace(
  deps: ExecutionGovernorDeps,
  conn: DatabaseConnection,
  ctx: OperationContext,
  type: string,
  payload: Record<string, unknown>,
): void {
  if (!deps.traceEmitter) return;
  const egpCtx = ctx as EGPOperationContext;
  if (!egpCtx.correlationId) return;
  deps.traceEmitter.emit(conn, ctx, {
    correlationId: egpCtx.correlationId,
    type,
    payload,
  });
}

// ============================================================================
// Factory: createExecutionGovernorImpl
// ============================================================================

export function createExecutionGovernorImpl(
  deps: ExecutionGovernorDeps,
): ExecutionGovernor {

  // ── Internal State ──

  const reservationMap = new Map<string, MutableReservation>();
  const taskIndex = new Map<string, string>(); // taskId → reservationId
  let reservationCounter = 0;
  let waveCounter = 0;

  // BRK-EGP-B08: Released reservation retention period (ms).
  // Released reservations are cleaned up after this period on next access.
  const RELEASED_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

  const missionBudgets = new Map<string, MutableMissionBudget>();
  const starvationCounters = new Map<string, number>();

  // ── Internal Helpers ──

  function getOrCreateBudget(missionId: MissionId): MutableMissionBudget {
    const existing = missionBudgets.get(missionId as string);
    if (existing) return existing;
    const budget: MutableMissionBudget = {
      missionId,
      token: { allocated: 0, totalConsumed: 0, totalReserved: 0, unreservedRemaining: 0, missionDebt: 0 },
      deliberation: { allocated: 0, totalConsumed: 0, totalReserved: 0, unreservedRemaining: 0, missionDebt: 0 },
    };
    missionBudgets.set(missionId as string, budget);
    return budget;
  }

  function findReservationByTask(taskId: TaskId): MutableReservation | null {
    const resId = taskIndex.get(taskId as string);
    if (!resId) return null;
    const res = reservationMap.get(resId);
    if (!res || res.status === 'released') return null;
    return res;
  }

  function validateTransition(current: ReservationStatus, target: ReservationStatus): boolean {
    const allowed = RESERVATION_STATUS_TRANSITIONS[current];
    return allowed.includes(target);
  }

  function generateReservationId(): ReservationId {
    return `egp-res-${++reservationCounter}` as ReservationId;
  }

  function generateWaveId(): WaveId {
    return `egp-wave-${++waveCounter}` as WaveId;
  }

  // ── 1. BudgetReservationStore ──

  const reservations: BudgetReservationStore = Object.freeze({
    create(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: ReservationCreateInput,
    ): Result<TaskBudgetReservation> {
      // Check for existing non-released reservation
      const existing = findReservationByTask(input.taskId);
      if (existing) {
        return err(RESERVATION_ERROR_CODES.ALREADY_EXISTS,
          `Task ${input.taskId} already has a non-released reservation`,
          '§5.1');
      }

      const resId = generateReservationId();
      const now = deps.time.nowISO();
      const mutable: MutableReservation = {
        reservationId: resId,
        taskId: input.taskId,
        missionId: input.missionId,
        reservedTokens: input.reservedTokens,
        consumedTokens: 0,
        reservedDeliberation: input.reservedDeliberation,
        consumedDeliberation: 0,
        status: 'reserved',
        allocationMethod: input.allocationMethod,
        createdAt: now,
        releasedAt: null,
      };

      reservationMap.set(resId as string, mutable);
      taskIndex.set(input.taskId as string, resId as string);

      // Emit events
      emitEvent(deps, EGP_EVENTS.RESERVATION_CREATED, 'task', {
        reservationId: resId,
        taskId: input.taskId,
        missionId: input.missionId,
        reservedTokens: input.reservedTokens,
        reservedDeliberation: input.reservedDeliberation,
      });

      // Trace emission (Phase 0A)
      emitTrace(deps, conn, ctx, 'egp.reservation.created', {
        reservationId: resId,
        taskId: input.taskId,
        missionId: input.missionId,
      });

      return ok(freezeReservation(mutable));
    },

    createBatch(
      conn: DatabaseConnection,
      ctx: OperationContext,
      inputs: readonly ReservationCreateInput[],
    ): Result<readonly TaskBudgetReservation[]> {
      return conn.transaction(() => {
        const results: TaskBudgetReservation[] = [];
        for (const input of inputs) {
          const result = reservations.create(conn, ctx, input);
          if (!result.ok) return result as Result<readonly TaskBudgetReservation[]>;
          results.push(result.value);
        }
        return ok(Object.freeze(results));
      });
    },

    getByTaskId(
      _conn: DatabaseConnection,
      taskId: TaskId,
    ): Result<TaskBudgetReservation | null> {
      const resId = taskIndex.get(taskId as string);
      if (!resId) return ok(null);
      const res = reservationMap.get(resId);
      if (!res) return ok(null);
      return ok(freezeReservation(res));
    },

    getById(
      _conn: DatabaseConnection,
      reservationId: ReservationId,
    ): Result<TaskBudgetReservation> {
      const res = reservationMap.get(reservationId as string);
      if (!res) {
        return err(RESERVATION_ERROR_CODES.NOT_FOUND,
          `Reservation ${reservationId} not found`, '§5.1');
      }
      return ok(freezeReservation(res));
    },

    activate(
      _conn: DatabaseConnection,
      reservationId: ReservationId,
    ): Result<void> {
      const res = reservationMap.get(reservationId as string);
      if (!res) {
        return err(RESERVATION_ERROR_CODES.NOT_FOUND,
          `Reservation ${reservationId} not found`, '§5.1');
      }
      if (!validateTransition(res.status, 'active')) {
        return err(RESERVATION_ERROR_CODES.INVALID_TRANSITION,
          `Cannot transition from ${res.status} to active`, '§5.1');
      }
      res.status = 'active';
      emitEvent(deps, EGP_EVENTS.RESERVATION_ACTIVATED, 'task', {
        reservationId, taskId: res.taskId,
      });
      return ok(undefined);
    },

    retain(
      _conn: DatabaseConnection,
      reservationId: ReservationId,
    ): Result<void> {
      const res = reservationMap.get(reservationId as string);
      if (!res) {
        return err(RESERVATION_ERROR_CODES.NOT_FOUND,
          `Reservation ${reservationId} not found`, '§5.1');
      }
      if (!validateTransition(res.status, 'retained')) {
        return err(RESERVATION_ERROR_CODES.INVALID_TRANSITION,
          `Cannot transition from ${res.status} to retained`, '§5.1');
      }
      res.status = 'retained';
      emitEvent(deps, EGP_EVENTS.RESERVATION_RETAINED, 'task', {
        reservationId, taskId: res.taskId,
      });
      return ok(undefined);
    },

    reactivate(
      _conn: DatabaseConnection,
      reservationId: ReservationId,
    ): Result<void> {
      const res = reservationMap.get(reservationId as string);
      if (!res) {
        return err(RESERVATION_ERROR_CODES.NOT_FOUND,
          `Reservation ${reservationId} not found`, '§5.1');
      }
      if (!validateTransition(res.status, 'active')) {
        return err(RESERVATION_ERROR_CODES.INVALID_TRANSITION,
          `Cannot transition from ${res.status} to active`, '§5.1');
      }
      res.status = 'active';
      emitEvent(deps, EGP_EVENTS.RESERVATION_ACTIVATED, 'task', {
        reservationId, taskId: res.taskId,
      });
      return ok(undefined);
    },

    updateConsumed(
      _conn: DatabaseConnection,
      reservationId: ReservationId,
      tokensConsumed: number,
      deliberationConsumed: number,
    ): Result<void> {
      // DC-EGP-002: Non-negative consumption validation
      if (tokensConsumed < 0 || deliberationConsumed < 0) {
        return err(ENFORCEMENT_ERROR_CODES.INVALID_CONSUMPTION,
          'Consumption values must be non-negative', 'DC-EGP-002');
      }

      const res = reservationMap.get(reservationId as string);
      if (!res) {
        return err(RESERVATION_ERROR_CODES.NOT_FOUND,
          `Reservation ${reservationId} not found`, '§5.1');
      }

      // EGP-I8: Cumulative consumption across retry attempts
      res.consumedTokens += tokensConsumed;
      res.consumedDeliberation += deliberationConsumed;
      return ok(undefined);
    },

    release(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      reservationId: ReservationId,
      reason: string,
    ): Result<{
      readonly reclaimedTokens: number;
      readonly reclaimedDeliberation: number;
      readonly overageTokens: number;
      readonly overageDeliberation: number;
    }> {
      const res = reservationMap.get(reservationId as string);
      if (!res) {
        return err(RESERVATION_ERROR_CODES.NOT_FOUND,
          `Reservation ${reservationId} not found`, '§5.1');
      }
      if (!validateTransition(res.status, 'released')) {
        return err(RESERVATION_ERROR_CODES.INVALID_TRANSITION,
          `Cannot transition from ${res.status} to released`, '§5.1');
      }

      // EGP-I3: Atomic reclaim per dimension
      const overageTokens = Math.max(0, res.consumedTokens - res.reservedTokens);
      const overageDeliberation = Math.max(0, res.consumedDeliberation - res.reservedDeliberation);
      const reclaimedTokens = Math.max(0, res.reservedTokens - res.consumedTokens);
      const reclaimedDeliberation = Math.max(0, res.reservedDeliberation - res.consumedDeliberation);

      res.status = 'released';
      res.releasedAt = deps.time.nowISO();

      // Remove from task index (released reservations not found by task lookup)
      taskIndex.delete(res.taskId as string);

      emitEvent(deps, EGP_EVENTS.RESERVATION_RELEASED, 'task', {
        reservationId, taskId: res.taskId, reason,
        reclaimedTokens, reclaimedDeliberation,
        overageTokens, overageDeliberation,
      });

      return ok(Object.freeze({ reclaimedTokens, reclaimedDeliberation, overageTokens, overageDeliberation }));
    },

    getActiveByMission(
      _conn: DatabaseConnection,
      missionId: MissionId,
    ): Result<readonly TaskBudgetReservation[]> {
      const active: TaskBudgetReservation[] = [];
      const now = deps.time.nowMs();

      // BRK-EGP-B08: Opportunistic cleanup of released reservations
      // older than retention period for this mission.
      const toRemove: string[] = [];
      for (const [resId, res] of reservationMap.entries()) {
        if (res.missionId === missionId) {
          if (res.status === 'released' && res.releasedAt) {
            const ageMs = now - new Date(res.releasedAt).getTime();
            if (ageMs > RELEASED_RETENTION_MS) {
              toRemove.push(resId);
            }
          } else if (res.status !== 'released') {
            active.push(freezeReservation(res));
          }
        }
      }

      for (const resId of toRemove) {
        reservationMap.delete(resId);
      }

      return ok(Object.freeze(active));
    },
  });

  // ── 2. MissionBudgetLedger ──

  const ledger: MissionBudgetLedger = Object.freeze({
    getState(
      _conn: DatabaseConnection,
      missionId: MissionId,
    ): Result<MissionBudgetState> {
      const budget = getOrCreateBudget(missionId);
      return ok(freezeBudgetState(budget));
    },

    reserveFromPool(
      _conn: DatabaseConnection,
      missionId: MissionId,
      tokenAmount: number,
      deliberationAmount: number,
    ): Result<void> {
      const budget = getOrCreateBudget(missionId);
      budget.token.unreservedRemaining -= tokenAmount;
      budget.token.totalReserved += tokenAmount;
      budget.deliberation.unreservedRemaining -= deliberationAmount;
      budget.deliberation.totalReserved += deliberationAmount;
      return ok(undefined);
    },

    returnToPool(
      _conn: DatabaseConnection,
      missionId: MissionId,
      tokenAmount: number,
      deliberationAmount: number,
    ): Result<void> {
      const budget = getOrCreateBudget(missionId);
      budget.token.unreservedRemaining += tokenAmount;
      budget.token.totalReserved -= tokenAmount;
      budget.deliberation.unreservedRemaining += deliberationAmount;
      budget.deliberation.totalReserved -= deliberationAmount;
      return ok(undefined);
    },

    recordConsumption(
      _conn: DatabaseConnection,
      missionId: MissionId,
      tokenAmount: number,
      deliberationAmount: number,
    ): Result<void> {
      const budget = getOrCreateBudget(missionId);
      budget.token.totalConsumed += tokenAmount;
      budget.deliberation.totalConsumed += deliberationAmount;
      return ok(undefined);
    },

    recordOverage(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      missionId: MissionId,
      tokenOverage: number,
      deliberationOverage: number,
    ): Result<OverBudgetFaultState | null> {
      const budget = getOrCreateBudget(missionId);
      const triggeringDimensions: BudgetDimension[] = [];

      // Token dimension
      if (tokenOverage > 0) {
        if (tokenOverage > budget.token.unreservedRemaining) {
          const excess = tokenOverage - budget.token.unreservedRemaining;
          budget.token.unreservedRemaining = 0;
          budget.token.missionDebt += excess;
          triggeringDimensions.push('token');
        } else {
          budget.token.unreservedRemaining -= tokenOverage;
        }
      }

      // Deliberation dimension
      if (deliberationOverage > 0) {
        if (deliberationOverage > budget.deliberation.unreservedRemaining) {
          const excess = deliberationOverage - budget.deliberation.unreservedRemaining;
          budget.deliberation.unreservedRemaining = 0;
          budget.deliberation.missionDebt += excess;
          triggeringDimensions.push('deliberation');
        } else {
          budget.deliberation.unreservedRemaining -= deliberationOverage;
        }
      }

      // EGP-I12: Over-budget fault state
      if (budget.token.missionDebt > 0 || budget.deliberation.missionDebt > 0) {
        const fault: OverBudgetFaultState = Object.freeze({
          missionId,
          active: true,
          triggeringDimensions: Object.freeze(triggeringDimensions),
          tokenDebt: budget.token.missionDebt,
          deliberationDebt: budget.deliberation.missionDebt,
          admissionBlocked: true,
          schedulingBlocked: true,
        });

        emitEvent(deps, EGP_EVENTS.MISSION_BUDGET_EXCEEDED, 'mission', {
          missionId,
          tokenDebt: budget.token.missionDebt,
          deliberationDebt: budget.deliberation.missionDebt,
        });

        return ok(fault);
      }

      return ok(null);
    },

    checkConservation(
      conn: DatabaseConnection,
      missionId: MissionId,
    ): Result<ConservationCheckResult> {
      const budget = getOrCreateBudget(missionId);

      // EGP-I13: allocated + missionDebt = totalConsumed + totalReserved + unreservedRemaining
      const tokenLeft = budget.token.allocated + budget.token.missionDebt;
      const tokenRight = budget.token.totalConsumed + budget.token.totalReserved + budget.token.unreservedRemaining;
      const tokenDelta = tokenLeft - tokenRight;

      const delibLeft = budget.deliberation.allocated + budget.deliberation.missionDebt;
      const delibRight = budget.deliberation.totalConsumed + budget.deliberation.totalReserved + budget.deliberation.unreservedRemaining;
      const delibDelta = delibLeft - delibRight;

      const result: ConservationCheckResult = Object.freeze({
        holds: tokenDelta === 0 && delibDelta === 0,
        token: Object.freeze({ leftSide: tokenLeft, rightSide: tokenRight, delta: tokenDelta }),
        deliberation: Object.freeze({ leftSide: delibLeft, rightSide: delibRight, delta: delibDelta }),
      });

      // DC-EGP-051: Audit entry for conservation check
      deps.audit.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'egp',
        action: 'conservation_check',
        resourceType: 'mission',
        resourceId: missionId as string,
        detail: {
          holds: result.holds,
          tokenDelta,
          delibDelta,
          tokenLeft,
          tokenRight,
          delibLeft,
          delibRight,
        },
      });

      return ok(result);
    },

    initializeBudget(
      _conn: DatabaseConnection,
      missionId: MissionId,
      tokenAllocation: number,
      deliberationAllocation: number,
    ): Result<void> {
      const budget = getOrCreateBudget(missionId);
      budget.token.allocated = tokenAllocation;
      budget.token.unreservedRemaining = tokenAllocation;
      budget.deliberation.allocated = deliberationAllocation;
      budget.deliberation.unreservedRemaining = deliberationAllocation;
      return ok(undefined);
    },

    finalizeReservation(
      _conn: DatabaseConnection,
      missionId: MissionId,
      consumedTokens: number,
      consumedDeliberation: number,
      reclaimedTokens: number,
      reclaimedDeliberation: number,
    ): Result<void> {
      const budget = getOrCreateBudget(missionId);
      // EGP-I3 + EGP-I13: Atomic reservation finalization
      // reserved -= (consumed + reclaimed) — full reservation removed
      budget.token.totalReserved -= (consumedTokens + reclaimedTokens);
      budget.deliberation.totalReserved -= (consumedDeliberation + reclaimedDeliberation);
      // unreserved += reclaimed — unconsumed returned to pool
      budget.token.unreservedRemaining += reclaimedTokens;
      budget.deliberation.unreservedRemaining += reclaimedDeliberation;
      // consumed += consumed — consumption recorded at mission level
      budget.token.totalConsumed += consumedTokens;
      budget.deliberation.totalConsumed += consumedDeliberation;
      return ok(undefined);
    },
  });

  // ── 3. WaveComposer ──

  const waveComposer: WaveComposer = Object.freeze({
    compose(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      input: WaveCompositionInput,
    ): Result<WaveCompositionResult> {
      // Validate inputs (DC-EGP-068)
      if (input.eligibleTasks.length === 0) {
        return err(WAVE_ERROR_CODES.NO_ELIGIBLE_TASKS,
          'No eligible tasks for wave composition', 'PSD-3');
      }
      if (input.tokenPool < 0 || input.deliberationPool < 0) {
        return err(WAVE_ERROR_CODES.INVALID_POOL,
          'Pool values must be non-negative', 'DC-EGP-068');
      }

      // Check for duplicate taskIds
      const taskIdSet = new Set<string>();
      for (const task of input.eligibleTasks) {
        if (taskIdSet.has(task.taskId as string)) {
          return err(WAVE_ERROR_CODES.DUPLICATE_TASK,
            `Duplicate taskId: ${task.taskId}`, 'DC-EGP-068');
        }
        taskIdSet.add(task.taskId as string);
      }

      // Check for invalid estimates
      for (const task of input.eligibleTasks) {
        if (task.estimatedTokens < 0 || isNaN(task.estimatedTokens) ||
            task.estimatedDeliberationTokens < 0 || isNaN(task.estimatedDeliberationTokens)) {
          return err(WAVE_ERROR_CODES.INVALID_TASK_ESTIMATE,
            `Invalid estimate for task ${task.taskId}`, 'DC-EGP-068');
        }
      }

      // EGP-I9: Snapshot pool (immutable during composition)
      const tokenPoolSnapshot = input.tokenPool;
      const deliberationPoolSnapshot = input.deliberationPool;
      const theWaveId = generateWaveId();

      // Sort by priority for determinism (EGP-I9)
      const sortedTasks = [...input.eligibleTasks].sort((a, b) => a.priority - b.priority);

      // Iterative allocation: allocate, exclude below-minimum, re-allocate with remaining tasks
      // This ensures that when equal allocation produces sub-minimum shares, we remove tasks
      // and give the remaining tasks larger shares until all scheduled tasks meet minimums.
      let candidateTasks = [...sortedTasks];
      const excluded: Array<{ taskId: TaskId; reason: string }> = [];
      let stable = false;

      // BRK-EGP-B07: Math.floor in allocation produces budget "dust" — the total
      // allocated tokens may be less than the pool by up to (N-1) tokens where N is
      // the number of scheduled tasks. This is accepted behavior: floor guarantees no
      // individual task receives more than its share (prevents over-allocation), and the
      // dust (≤ N-1 tokens) returns to the unreserved pool implicitly. The dust amount
      // is bounded and does not accumulate across waves. Conservation law still holds
      // because allocated - sum(reservations) = dust ≥ 0, which is accounted for in
      // the unreservedRemaining term.
      while (!stable) {
        stable = true;
        const allocations = new Map<string, { tokens: number; deliberation: number }>();
        const candDelibTasks = candidateTasks.filter(t => t.requiresDeliberation);

        if (input.allocationMethod === 'proportional') {
          const totalEstTokens = candidateTasks.reduce((s, t) => s + t.estimatedTokens, 0);
          const totalEstDelib = candDelibTasks.reduce((s, t) => s + t.estimatedDeliberationTokens, 0);

          for (const task of candidateTasks) {
            const tokenShare = totalEstTokens > 0
              ? (task.estimatedTokens / totalEstTokens) * tokenPoolSnapshot
              : tokenPoolSnapshot / candidateTasks.length;

            let delibShare = 0;
            if (task.requiresDeliberation && totalEstDelib > 0) {
              delibShare = (task.estimatedDeliberationTokens / totalEstDelib) * deliberationPoolSnapshot;
            }

            allocations.set(task.taskId as string, {
              tokens: Math.floor(tokenShare),
              deliberation: Math.floor(delibShare),
            });
          }
        } else if (input.allocationMethod === 'equal') {
          const tokenPerTask = candidateTasks.length > 0
            ? Math.floor(tokenPoolSnapshot / candidateTasks.length)
            : 0;
          const delibPerTask = candDelibTasks.length > 0
            ? Math.floor(deliberationPoolSnapshot / candDelibTasks.length)
            : 0;

          for (const task of candidateTasks) {
            allocations.set(task.taskId as string, {
              tokens: tokenPerTask,
              deliberation: task.requiresDeliberation ? delibPerTask : 0,
            });
          }
        } else if (input.allocationMethod === 'explicit') {
          for (const task of candidateTasks) {
            allocations.set(task.taskId as string, {
              tokens: task.estimatedTokens,
              deliberation: task.requiresDeliberation ? task.estimatedDeliberationTokens : 0,
            });
          }
        }

        // Check if any candidate is below minimum viable — if so, exclude ONE (lowest priority)
        // and re-iterate. Excluding only one at a time ensures remaining tasks get larger shares
        // on the next pass, preventing the case where all tasks are excluded simultaneously
        // when re-allocation with fewer tasks would produce viable shares.
        let excludedOne = false;
        // Iterate in reverse (lowest priority first) to exclude the least important task
        for (let i = candidateTasks.length - 1; i >= 0; i--) {
          const task = candidateTasks[i]!;
          const alloc = allocations.get(task.taskId as string)!;

          if (alloc.tokens < input.minimumViableTokens) {
            excluded.push({ taskId: task.taskId, reason: `Token allocation ${alloc.tokens} below minimum ${input.minimumViableTokens}` });
            candidateTasks.splice(i, 1);
            stable = false;
            excludedOne = true;
            break; // Exclude only one per iteration, then re-allocate
          }

          if (task.requiresDeliberation && alloc.deliberation < input.minimumViableDeliberation) {
            excluded.push({ taskId: task.taskId, reason: `Deliberation allocation ${alloc.deliberation} below minimum ${input.minimumViableDeliberation}` });
            candidateTasks.splice(i, 1);
            stable = false;
            excludedOne = true;
            break; // Exclude only one per iteration, then re-allocate
          }
        }

        if (!excludedOne) {
          // All candidates meet minimums — stable
          stable = true;
        }
        if (candidateTasks.length === 0) break;
      }

      const scheduled = candidateTasks;

      // Compute final allocations for scheduled tasks
      const finalAllocations = new Map<string, { tokens: number; deliberation: number }>();
      const finalDelibTasks = scheduled.filter(t => t.requiresDeliberation);

      if (input.allocationMethod === 'proportional') {
        const totalEstTokens = scheduled.reduce((s, t) => s + t.estimatedTokens, 0);
        const totalEstDelib = finalDelibTasks.reduce((s, t) => s + t.estimatedDeliberationTokens, 0);

        for (const task of scheduled) {
          const tokenShare = totalEstTokens > 0
            ? (task.estimatedTokens / totalEstTokens) * tokenPoolSnapshot
            : tokenPoolSnapshot / scheduled.length;

          let delibShare = 0;
          if (task.requiresDeliberation && totalEstDelib > 0) {
            delibShare = (task.estimatedDeliberationTokens / totalEstDelib) * deliberationPoolSnapshot;
          }

          finalAllocations.set(task.taskId as string, {
            tokens: Math.floor(tokenShare),
            deliberation: Math.floor(delibShare),
          });
        }
      } else if (input.allocationMethod === 'equal') {
        const tokenPerTask = scheduled.length > 0
          ? Math.floor(tokenPoolSnapshot / scheduled.length)
          : 0;
        const delibPerTask = finalDelibTasks.length > 0
          ? Math.floor(deliberationPoolSnapshot / finalDelibTasks.length)
          : 0;

        for (const task of scheduled) {
          finalAllocations.set(task.taskId as string, {
            tokens: tokenPerTask,
            deliberation: task.requiresDeliberation ? delibPerTask : 0,
          });
        }
      } else if (input.allocationMethod === 'explicit') {
        for (const task of scheduled) {
          finalAllocations.set(task.taskId as string, {
            tokens: task.estimatedTokens,
            deliberation: task.requiresDeliberation ? task.estimatedDeliberationTokens : 0,
          });
        }
      }

      // BRK-EGP-B06: Build reservations through formal createBatch path,
      // not direct map insertion. This ensures conservation checks apply,
      // duplicate-reservation guards fire, and lifecycle events emit.
      const batchInputs: ReservationCreateInput[] = scheduled.map(task => {
        const alloc = finalAllocations.get(task.taskId as string)!;
        return {
          taskId: task.taskId,
          missionId: input.missionId,
          reservedTokens: alloc.tokens,
          reservedDeliberation: alloc.deliberation,
          allocationMethod: input.allocationMethod,
        };
      });

      const batchResult = reservations.createBatch(_conn, _ctx, batchInputs);
      if (!batchResult.ok) {
        return batchResult as Result<WaveCompositionResult>;
      }
      const waveReservations = batchResult.value;

      // Emit WAVE_COMPOSED event
      if (scheduled.length > 0) {
        emitEvent(deps, EGP_EVENTS.WAVE_COMPOSED, 'mission', {
          waveId: theWaveId,
          missionId: input.missionId,
          scheduledCount: scheduled.length,
          excludedCount: excluded.length,
        });
      }

      return ok(Object.freeze({
        waveId: theWaveId,
        missionId: input.missionId,
        scheduledTaskIds: Object.freeze(scheduled.map(t => t.taskId)),
        reservations: Object.freeze(waveReservations),
        excludedTasks: Object.freeze(excluded),
        allocationMethod: input.allocationMethod,
        tokenPoolSnapshot,
        deliberationPoolSnapshot,
      }));
    },
  });

  // ── 4. BranchFailureHandler ──

  const branchFailure: BranchFailureHandler = Object.freeze({
    handleFailure(
      conn: DatabaseConnection,
      _ctx: OperationContext,
      input: BranchFailureInput,
    ): Result<BranchFailureResult> {
      const cancelledTaskIds: TaskId[] = [];
      const releasedReservationIds: ReservationId[] = [];
      const affectedFanIns: FanInDependencyStatus[] = [];

      if (input.policy === 'isolate') {
        // EGP-I6: Siblings unaffected under isolate
        // No cancellations
      } else if (input.policy === 'fail-fast') {
        // Cancel PENDING/SCHEDULED siblings (NOT RUNNING — EGP-I10)
        for (const sibling of input.siblingStates) {
          if (sibling.state === 'PENDING' || sibling.state === 'SCHEDULED') {
            cancelledTaskIds.push(sibling.taskId);
            // Release reservation if exists
            const res = findReservationByTask(sibling.taskId);
            if (res) {
              releasedReservationIds.push(res.reservationId);
            }
          }
        }
      } else if (input.policy === 'quorum') {
        // Quorum: evaluate fan-in dependents for impossibility
        // No sibling cancellation under quorum
      }

      // Evaluate fan-in dependents
      for (const fanIn of input.fanInDependents) {
        const allStates = fanIn.allPredecessorIds.map(predId => {
          // Find state from sibling states or the failed task
          if (predId === input.failedTaskId) {
            return { taskId: predId, state: 'FAILED' as EGPRelevantTaskState };
          }
          const sibState = input.siblingStates.find(s => s.taskId === predId);
          if (sibState) return sibState;
          // If cancelled by fail-fast
          if (cancelledTaskIds.includes(predId)) {
            return { taskId: predId, state: 'CANCELLED' as EGPRelevantTaskState };
          }
          return { taskId: predId, state: 'PENDING' as EGPRelevantTaskState };
        });

        const fanInResult = branchFailure.evaluateFanIn(
          conn, fanIn.taskId, input.policy, allStates, fanIn.quorumThreshold,
        );
        if (fanInResult.ok) {
          affectedFanIns.push(fanInResult.value);
        }
      }

      emitEvent(deps, EGP_EVENTS.BRANCH_FAILURE_EVALUATED, 'mission', {
        failedTaskId: input.failedTaskId,
        missionId: input.missionId,
        policy: input.policy,
        cancelledCount: cancelledTaskIds.length,
      });

      return ok(Object.freeze({
        failedTaskId: input.failedTaskId,
        missionId: input.missionId,
        policy: input.policy,
        cancelledTaskIds: Object.freeze(cancelledTaskIds),
        releasedReservationIds: Object.freeze(releasedReservationIds),
        affectedFanIns: Object.freeze(affectedFanIns),
      }));
    },

    evaluateFanIn(
      _conn: DatabaseConnection,
      taskId: TaskId,
      policy: import('../interfaces/egp_types.js').BranchFailurePolicy,
      predecessors: readonly { readonly taskId: TaskId; readonly state: EGPRelevantTaskState }[],
      quorumThreshold?: number,
    ): Result<FanInDependencyStatus> {
      const completed = predecessors.filter(p => p.state === 'COMPLETED');
      const failed = predecessors.filter(p => p.state === 'FAILED');
      const cancelled = predecessors.filter(p => p.state === 'CANCELLED');
      const terminal = new Set<EGPRelevantTaskState>(['COMPLETED', 'FAILED', 'CANCELLED']);
      const active = predecessors.filter(p => !terminal.has(p.state));

      if (policy === 'quorum') {
        // Validate threshold
        if (quorumThreshold !== undefined && (quorumThreshold < 0 || quorumThreshold > 1.0)) {
          return err(BRANCH_FAILURE_ERROR_CODES.QUORUM_THRESHOLD_INVALID,
            `Quorum threshold ${quorumThreshold} out of range [0.0, 1.0]`, 'EGP-I6');
        }

        const threshold = quorumThreshold ?? 1.0;
        const total = predecessors.length;
        const requiredSuccesses = Math.ceil(threshold * total);
        const completedSuccessCount = completed.length;
        const remainingActiveCount = active.length;
        const met = completedSuccessCount >= requiredSuccesses;
        const impossible = completedSuccessCount + remainingActiveCount < requiredSuccesses;

        let reason: FanInDependencyStatus['reason'];
        let eligible: boolean;

        if (met) {
          reason = 'quorum_met';
          eligible = true;
        } else if (impossible) {
          reason = 'quorum_impossible';
          eligible = false;
        } else {
          reason = 'waiting';
          eligible = false;
        }

        return ok(Object.freeze({
          taskId,
          eligible,
          reason,
          completedPredecessors: Object.freeze(completed.map(p => p.taskId)),
          failedPredecessors: Object.freeze(failed.map(p => p.taskId)),
          cancelledPredecessors: Object.freeze(cancelled.map(p => p.taskId)),
          activePredecessors: Object.freeze(active.map(p => p.taskId)),
          quorumState: Object.freeze({
            threshold,
            requiredSuccesses,
            completedSuccessCount,
            remainingActiveCount,
            met,
            impossible,
          }),
        }));
      }

      if (policy === 'isolate') {
        // Eligible when ALL predecessors terminally resolved
        const allResolved = predecessors.every(p => terminal.has(p.state));
        return ok(Object.freeze({
          taskId,
          eligible: allResolved,
          reason: allResolved ? 'all_resolved' as const : 'waiting' as const,
          completedPredecessors: Object.freeze(completed.map(p => p.taskId)),
          failedPredecessors: Object.freeze(failed.map(p => p.taskId)),
          cancelledPredecessors: Object.freeze(cancelled.map(p => p.taskId)),
          activePredecessors: Object.freeze(active.map(p => p.taskId)),
        }));
      }

      // fail-fast: eligible when ALL predecessors COMPLETED
      const allCompleted = predecessors.every(p => p.state === 'COMPLETED');
      // If any cancelled or failed under fail-fast, fan-in is cancelled
      const hasFailed = failed.length > 0 || cancelled.length > 0;

      return ok(Object.freeze({
        taskId,
        eligible: allCompleted,
        reason: allCompleted ? 'all_completed' as const
          : hasFailed ? 'cancelled' as const
          : 'waiting' as const,
        completedPredecessors: Object.freeze(completed.map(p => p.taskId)),
        failedPredecessors: Object.freeze(failed.map(p => p.taskId)),
        cancelledPredecessors: Object.freeze(cancelled.map(p => p.taskId)),
        activePredecessors: Object.freeze(active.map(p => p.taskId)),
      }));
    },
  });

  // ── 5. CapabilityRetryPolicy ──

  const retryPolicy: CapabilityRetryPolicy = Object.freeze({
    evaluate(
      capabilityType: string,
      operationId: string | undefined,
      mutabilityClass: MutabilityClass,
      sandboxResetAvailable: boolean,
    ): Result<CapabilityRetryDecision> {
      let retryPermitted: boolean;
      let requiresSandboxReset = false;

      switch (mutabilityClass) {
        case 'read-only':
          retryPermitted = true;
          break;
        case 'side-effecting':
          requiresSandboxReset = true;
          retryPermitted = sandboxResetAvailable;
          break;
        case 'mutating':
          retryPermitted = true;
          break;
        case 'mutating-external':
          retryPermitted = false;
          break;
        default:
          retryPermitted = false;
      }

      let reason: string;
      if (retryPermitted && requiresSandboxReset) {
        reason = `${mutabilityClass} operation retry permitted with sandbox reset`;
      } else if (retryPermitted) {
        reason = `${mutabilityClass} operation safe to retry`;
      } else if (requiresSandboxReset && !sandboxResetAvailable) {
        reason = `${mutabilityClass} operation requires sandbox reset (unavailable)`;
      } else {
        reason = `${mutabilityClass} operation not safe for auto-retry`;
      }

      const decision: CapabilityRetryDecision = {
        capabilityType,
        ...(operationId !== undefined ? { operationId } : {}),
        mutabilityClass,
        retryPermitted,
        requiresSandboxReset,
        reason,
      };
      return ok(Object.freeze(decision));
    },

    getDefaultClass(
      capabilityType: string,
    ): Result<MutabilityClass> {
      const defaultClass = DEFAULT_CAPABILITY_MUTABILITY[capabilityType];
      // Unclassified defaults to mutating-external (safest)
      return ok(defaultClass ?? 'mutating-external');
    },
  });

  // ── 6. SchedulerEngine ──

  const scheduler: SchedulerEngine = Object.freeze({
    executeCycle(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: SchedulerCycleInput,
    ): Result<SchedulerCycleResult> {
      // DC-EGP-060: Zero workers → error
      if (input.availableWorkers <= 0) {
        return err(SCHEDULER_ERROR_CODES.NO_WORKERS_AVAILABLE,
          'No workers available for scheduling', 'EGP-I10');
      }

      const waves: WaveCompositionResult[] = [];
      const starvationUpdates: Array<{ missionId: MissionId; newCounter: number; promoted: boolean }> = [];
      const unscheduledMissions: Array<{ missionId: MissionId; reason: string }> = [];
      let workersRemaining = input.availableWorkers;

      // Sort missions: starvation-promoted first, then natural order
      const sortedMissions = [...input.eligibleMissions].sort((a, b) => {
        const aPromoted = a.starvationCounter > input.starvationBound;
        const bPromoted = b.starvationCounter > input.starvationBound;
        if (aPromoted && !bPromoted) return -1;
        if (!aPromoted && bPromoted) return 1;
        return 0;
      });

      const scheduledMissionIds = new Set<string>();

      for (const mission of sortedMissions) {
        if (workersRemaining <= 0) {
          unscheduledMissions.push({ missionId: mission.missionId, reason: 'No workers available' });
          continue;
        }

        const promoted = mission.starvationCounter > input.starvationBound;

        // Compose wave for this mission
        const waveInput: WaveCompositionInput = {
          missionId: mission.missionId,
          eligibleTasks: mission.eligibleTasks,
          tokenPool: mission.tokenPool,
          deliberationPool: mission.deliberationPool,
          allocationMethod: input.allocationMethod,
          minimumViableTokens: input.minimumViableTokens,
          minimumViableDeliberation: input.minimumViableDeliberation,
        };

        const waveResult = waveComposer.compose(conn, ctx, waveInput);
        if (waveResult.ok && waveResult.value.scheduledTaskIds.length > 0) {
          waves.push(waveResult.value);
          workersRemaining -= waveResult.value.scheduledTaskIds.length;
          scheduledMissionIds.add(mission.missionId as string);

          if (promoted) {
            emitEvent(deps, EGP_EVENTS.STARVATION_BOUND_TRIGGERED, 'mission', {
              missionId: mission.missionId,
              starvationCounter: mission.starvationCounter,
              starvationBound: input.starvationBound,
            });
          }
        } else {
          unscheduledMissions.push({
            missionId: mission.missionId,
            reason: waveResult.ok ? 'No tasks met minimum viable' : 'Wave composition failed',
          });
        }
      }

      // Starvation updates: reset scheduled, increment unscheduled
      // Only increment if at least one mission was scheduled (not pure saturation)
      const anyScheduled = scheduledMissionIds.size > 0;

      for (const mission of input.eligibleMissions) {
        if (scheduledMissionIds.has(mission.missionId as string)) {
          starvation.reset(mission.missionId);
          starvationUpdates.push({
            missionId: mission.missionId,
            newCounter: 0,
            promoted: mission.starvationCounter > input.starvationBound,
          });
        } else if (anyScheduled) {
          // EGP-I5: Only increment during non-pure saturation
          starvation.increment(mission.missionId);
          starvationUpdates.push({
            missionId: mission.missionId,
            newCounter: starvation.getCounter(mission.missionId),
            promoted: false,
          });
        }
      }

      // Build replay record
      const firstWave = waves[0];
      const replayRecord: WaveReplayRecord = Object.freeze({
        waveId: firstWave ? firstWave.waveId : generateWaveId(),
        missionId: sortedMissions[0]?.missionId ?? ('' as MissionId),
        eligibleTaskIds: Object.freeze(
          input.eligibleMissions.flatMap(m => m.eligibleTasks.map(t => t.taskId)),
        ),
        taskPriorities: Object.freeze(
          input.eligibleMissions.flatMap(m =>
            m.eligibleTasks.map(t => Object.freeze({ taskId: t.taskId, priority: t.priority })),
          ),
        ),
        taskDimensions: Object.freeze(
          input.eligibleMissions.flatMap(m =>
            m.eligibleTasks.map(t => Object.freeze({
              taskId: t.taskId,
              requiresDeliberation: t.requiresDeliberation,
              estimatedTokens: t.estimatedTokens,
              estimatedDeliberationTokens: t.estimatedDeliberationTokens,
            })),
          ),
        ),
        tokenPoolSnapshot: input.eligibleMissions[0]?.tokenPool ?? 0,
        deliberationPoolSnapshot: input.eligibleMissions[0]?.deliberationPool ?? 0,
        workerAvailability: input.availableWorkers,
        computedReservations: Object.freeze(
          waves.flatMap(w => w.reservations.map(r => Object.freeze({
            taskId: r.taskId,
            reservedTokens: r.reservedTokens,
            reservedDeliberation: r.reservedDeliberation,
          }))),
        ),
        allocationMethod: input.allocationMethod,
        selectedTaskIds: Object.freeze(waves.flatMap(w => [...w.scheduledTaskIds])),
        starvationCounters: Object.freeze(
          starvationUpdates.map(u => Object.freeze({
            missionId: u.missionId,
            counter: u.newCounter,
          })),
        ),
        timestamp: deps.time.nowISO(),
      });

      return ok(Object.freeze({
        waves: Object.freeze(waves),
        starvationUpdates: Object.freeze(
          starvationUpdates.map(u => Object.freeze(u)),
        ),
        unscheduledMissions: Object.freeze(
          unscheduledMissions.map(u => Object.freeze(u)),
        ),
        workerAvailabilitySnapshot: input.availableWorkers,
        replayRecord,
      }));
    },
  });

  // ── 7. ReservationEnforcer ──

  const enforcer: ReservationEnforcer = Object.freeze({
    checkHeadroom(
      conn: DatabaseConnection,
      taskId: TaskId,
      additionalTokens: number,
      additionalDeliberation: number,
    ): Result<HeadroomCheckResult> {
      const res = findReservationByTask(taskId);
      if (!res) {
        // No reservation found — return zero headroom
        return ok(Object.freeze({
          allowed: false,
          tokenHeadroom: 0,
          deliberationHeadroom: 0,
          tokenExhausted: true,
          deliberationExhausted: false,
          wouldCauseTokenOverage: additionalTokens > 0,
          wouldCauseDeliberationOverage: additionalDeliberation > 0,
          projectedTokenOverage: additionalTokens,
          projectedDeliberationOverage: additionalDeliberation,
        }));
      }

      // Check suspension (DC-EGP-062)
      if (deps.suspensionQuery) {
        const suspResult = deps.suspensionQuery.getActiveForTarget(conn, 'task', taskId as string);
        if (suspResult.ok && suspResult.value !== null) {
          return ok(Object.freeze({
            allowed: false,
            tokenHeadroom: res.reservedTokens - res.consumedTokens,
            deliberationHeadroom: res.reservedDeliberation - res.consumedDeliberation,
            tokenExhausted: false,
            deliberationExhausted: false,
            wouldCauseTokenOverage: false,
            wouldCauseDeliberationOverage: false,
            projectedTokenOverage: 0,
            projectedDeliberationOverage: 0,
          }));
        }
      }

      const tokenHeadroom = res.reservedTokens - res.consumedTokens;
      const deliberationHeadroom = res.reservedDeliberation - res.consumedDeliberation;

      const tokenExhausted = tokenHeadroom <= 0;
      // Only consider deliberation exhausted if there's a deliberation reservation
      const deliberationExhausted = res.reservedDeliberation > 0 && deliberationHeadroom <= 0;

      const projectedTokenTotal = res.consumedTokens + additionalTokens;
      const projectedDelibTotal = res.consumedDeliberation + additionalDeliberation;

      const wouldCauseTokenOverage = projectedTokenTotal > res.reservedTokens;
      const wouldCauseDeliberationOverage = res.reservedDeliberation > 0 && projectedDelibTotal > res.reservedDeliberation;

      const projectedTokenOverage = Math.max(0, projectedTokenTotal - res.reservedTokens);
      const projectedDeliberationOverage = res.reservedDeliberation > 0
        ? Math.max(0, projectedDelibTotal - res.reservedDeliberation)
        : 0;

      const allowed = !tokenExhausted && !deliberationExhausted;

      // Emit event if exhausted
      if (tokenExhausted || deliberationExhausted) {
        emitEvent(deps, EGP_EVENTS.TASK_BUDGET_EXCEEDED, 'task', {
          taskId,
          tokenExhausted,
          deliberationExhausted,
          tokenHeadroom,
          deliberationHeadroom,
        });
      }

      return ok(Object.freeze({
        allowed,
        tokenHeadroom,
        deliberationHeadroom,
        tokenExhausted,
        deliberationExhausted,
        wouldCauseTokenOverage,
        wouldCauseDeliberationOverage,
        projectedTokenOverage,
        projectedDeliberationOverage,
      }));
    },

    handleOverage(
      conn: DatabaseConnection,
      ctx: OperationContext,
      taskId: TaskId,
      tokenOverage: number,
      deliberationOverage: number,
    ): Result<OverBudgetFaultState | null> {
      const res = findReservationByTask(taskId);
      if (!res) {
        // Debt 2: Missing reservation during overage means budget enforcement is impossible — do not silently skip
        return err('RESERVATION_NOT_FOUND', `No active reservation found for task ${taskId} — cannot record overage`, 'EGP-I14');
      }
      return ledger.recordOverage(conn, ctx, res.missionId, tokenOverage, deliberationOverage);
    },
  });

  // ── 8. ReplanCalculator ──

  const replanCalculator: ReplanCalculator = Object.freeze({
    calculateReplanBudget(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      input: ReplanBudgetInput,
    ): Result<ReplanBudgetResult> {
      const cancelledTasks: Array<{
        taskId: TaskId;
        previousState: string;
        releasedTokens: number;
        releasedDeliberation: number;
      }> = [];
      const runningTasksExcluded: Array<{
        taskId: TaskId;
        committedTokens: number;
        committedDeliberation: number;
      }> = [];

      let replanBudgetTokens = 0;
      let replanBudgetDeliberation = 0;

      for (const task of input.currentGraphTasks) {
        if (task.state === 'RUNNING') {
          // EGP-I10: Running tasks not preemptible
          const res = findReservationByTask(task.taskId);
          runningTasksExcluded.push({
            taskId: task.taskId,
            committedTokens: res ? res.reservedTokens : 0,
            committedDeliberation: res ? res.reservedDeliberation : 0,
          });
        } else {
          // SCHEDULED, PENDING, FAILED — cancel and release
          const res = findReservationByTask(task.taskId);
          let releasedTokens = 0;
          let releasedDeliberation = 0;

          if (res) {
            releasedTokens = Math.max(0, res.reservedTokens - res.consumedTokens);
            releasedDeliberation = Math.max(0, res.reservedDeliberation - res.consumedDeliberation);
            // Release the reservation
            res.status = 'released';
            res.releasedAt = deps.time.nowISO();
            taskIndex.delete(res.taskId as string);
          }

          replanBudgetTokens += releasedTokens;
          replanBudgetDeliberation += releasedDeliberation;

          cancelledTasks.push({
            taskId: task.taskId,
            previousState: task.state,
            releasedTokens,
            releasedDeliberation,
          });
        }
      }

      return ok(Object.freeze({
        replanBudgetTokens,
        replanBudgetDeliberation,
        cancelledTasks: Object.freeze(cancelledTasks.map(t => Object.freeze(t))),
        runningTasksExcluded: Object.freeze(runningTasksExcluded.map(t => Object.freeze(t))),
      }));
    },
  });

  // ── 9. StarvationTracker (AMB-06: in-memory only) ──

  const starvation: StarvationTracker = Object.freeze({
    increment(missionId: MissionId): void {
      const current = starvationCounters.get(missionId as string) ?? 0;
      starvationCounters.set(missionId as string, current + 1);
    },

    reset(missionId: MissionId): void {
      starvationCounters.set(missionId as string, 0);
    },

    getCounter(missionId: MissionId): number {
      return starvationCounters.get(missionId as string) ?? 0;
    },

    isAboveBound(missionId: MissionId, bound: number): boolean {
      const counter = starvationCounters.get(missionId as string) ?? 0;
      return counter > bound;
    },

    getAllCounters(): ReadonlyMap<string, number> {
      return new Map(starvationCounters);
    },
  });

  // ── 10. EGPTerminalOperationHandler ──

  const terminalOp: EGPTerminalOperationHandler = Object.freeze({
    execute(
      conn: DatabaseConnection,
      ctx: OperationContext,
      taskId: TaskId,
      terminalState: 'COMPLETED' | 'CANCELLED' | 'FAILED',
      hasRetriesRemaining: boolean,
    ): Result<EGPTerminalResult> {
      const res = findReservationByTask(taskId);

      // v3.2 compatibility: no reservation → no-op
      if (!res) {
        return ok(Object.freeze({
          action: 'none' as const,
          reclaimedTokens: 0,
          reclaimedDeliberation: 0,
          overageTokens: 0,
          overageDeliberation: 0,
          reservationId: null,
        }));
      }

      // FAILED with retries remaining → retain (EGP-I8)
      if (terminalState === 'FAILED' && hasRetriesRemaining) {
        const retainResult = reservations.retain(conn, res.reservationId);
        if (!retainResult.ok) return retainResult as Result<EGPTerminalResult>;

        return ok(Object.freeze({
          action: 'retained' as const,
          reclaimedTokens: 0,
          reclaimedDeliberation: 0,
          overageTokens: 0,
          overageDeliberation: 0,
          reservationId: res.reservationId,
        }));
      }

      // Final terminal: release and reclaim (EGP-I3)
      const releaseResult = reservations.release(conn, ctx, res.reservationId, terminalState);
      if (!releaseResult.ok) return releaseResult as Result<EGPTerminalResult>;

      return ok(Object.freeze({
        action: 'released' as const,
        reclaimedTokens: releaseResult.value.reclaimedTokens,
        reclaimedDeliberation: releaseResult.value.reclaimedDeliberation,
        overageTokens: releaseResult.value.overageTokens,
        overageDeliberation: releaseResult.value.overageDeliberation,
        reservationId: res.reservationId,
      }));
    },
  });

  // ── 11. ReservationAdmissionGate (DC-EGP-064) ──

  const admissionGate: ReservationAdmissionGate = Object.freeze({
    checkAdmission(
      conn: DatabaseConnection,
      _ctx: OperationContext,
      taskId: TaskId,
      taskVersion: '3.2' | '3.3',
    ): Result<{
      readonly admitted: boolean;
      readonly reason: string;
      readonly reservationId: ReservationId | null;
    }> {
      // v3.2 backward compatibility (PSD-5)
      if (taskVersion === '3.2') {
        return ok(Object.freeze({
          admitted: true,
          reason: 'v3.2 task exempt from reservation requirement',
          reservationId: null,
        }));
      }

      // v3.3: EGP-I14 — must have non-released reservation
      const res = findReservationByTask(taskId);
      if (!res) {
        return ok(Object.freeze({
          admitted: false,
          reason: 'No non-released reservation found for v3.3 task',
          reservationId: null,
        }));
      }

      // Check suspension (DC-EGP-062)
      if (deps.suspensionQuery) {
        const taskSusp = deps.suspensionQuery.getActiveForTarget(conn, 'task', taskId as string);
        if (taskSusp.ok && taskSusp.value !== null) {
          return ok(Object.freeze({
            admitted: false,
            reason: 'Task is suspended',
            reservationId: res.reservationId,
          }));
        }

        const missionSusp = deps.suspensionQuery.getActiveForTarget(conn, 'mission', res.missionId as string);
        if (missionSusp.ok && missionSusp.value !== null) {
          return ok(Object.freeze({
            admitted: false,
            reason: 'Mission is suspended',
            reservationId: res.reservationId,
          }));
        }
      }

      return ok(Object.freeze({
        admitted: true,
        reason: 'Reservation confirmed',
        reservationId: res.reservationId,
      }));
    },
  });

  // ── 12. ReservationAgeMonitor ──

  const ageMonitor: ReservationAgeMonitor = Object.freeze({
    getOrphanedReservations(
      _conn: DatabaseConnection,
      maxAgeMs: number,
    ): Result<readonly {
      readonly reservationId: ReservationId;
      readonly taskId: TaskId;
      readonly missionId: MissionId;
      readonly ageMs: number;
      readonly status: ReservationStatus;
    }[]> {
      const now = deps.time.nowMs();
      const orphans: Array<{
        reservationId: ReservationId;
        taskId: TaskId;
        missionId: MissionId;
        ageMs: number;
        status: ReservationStatus;
      }> = [];

      for (const res of reservationMap.values()) {
        if (res.status === 'reserved') {
          const ageMs = now - new Date(res.createdAt).getTime();
          if (ageMs > maxAgeMs) {
            orphans.push(Object.freeze({
              reservationId: res.reservationId,
              taskId: res.taskId,
              missionId: res.missionId,
              ageMs,
              status: res.status,
            }));
          }
        }
      }

      return ok(Object.freeze(orphans));
    },
  });

  // ── 13. SuspendedReservationQuery ──

  const suspendedQuery: SuspendedReservationQuery = Object.freeze({
    isTaskSuspended(
      conn: DatabaseConnection,
      taskId: TaskId,
    ): Result<boolean> {
      if (!deps.suspensionQuery) return ok(false);
      const result = deps.suspensionQuery.getActiveForTarget(conn, 'task', taskId as string);
      if (!result.ok) return result as Result<boolean>;
      return ok(result.value !== null);
    },

    isMissionSuspended(
      conn: DatabaseConnection,
      missionId: MissionId,
    ): Result<boolean> {
      if (!deps.suspensionQuery) return ok(false);
      const result = deps.suspensionQuery.getActiveForTarget(conn, 'mission', missionId as string);
      if (!result.ok) return result as Result<boolean>;
      return ok(result.value !== null);
    },
  });

  // ── Facade ──

  return Object.freeze({
    reservations,
    ledger,
    waveComposer,
    branchFailure,
    retryPolicy,
    scheduler,
    enforcer,
    replanCalculator,
    starvation,
    terminalOp,
    admissionGate,
    ageMonitor,
    suspendedQuery,
  });
}
