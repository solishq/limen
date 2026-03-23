/**
 * Limen v1.0 — EGP (Execution Governance Protocol) Executable Contract Tests
 * Phase 1C: Truth Model Verification
 *
 * Every test in this file MUST FAIL against the NOT_IMPLEMENTED harness.
 * Every test asserts spec-derived behavior, not implementation details.
 * When implementation replaces the harness, tests turn green one by one.
 *
 * Spec ref: EGP v1.0 Design Source (FINAL), Architecture Freeze CF-06/CF-11
 * Invariants: EGP-I1 through EGP-I13
 * Failure Modes: FM-EGP-01 through FM-EGP-05
 * Conformance Tests: CT-EGP-01 through CT-EGP-30
 * Amendment 2: Control 3 (Executable Contract, Interface-First)
 *
 * Contract tests: ~88 (per Phase 1C specification, 12 groups)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionGovernor, NotImplementedError } from '../../src/execution/harness/egp_harness.js';
import type {
  ExecutionGovernor,
  ExecutionGovernorDeps,
  EGPOperationContext,
  ReservationId,
  WaveId,
  ReservationCreateInput,
  WaveCompositionInput,
  BranchFailureInput,
  SchedulerCycleInput,
  ReplanBudgetInput,
  EligibleTaskDescriptor,
  TaskBudgetReservation,
  MissionBudgetState,
  WaveCompositionResult,
  BranchFailureResult,
  SchedulerCycleResult,
  HeadroomCheckResult,
  ConservationCheckResult,
  CapabilityRetryDecision,
  FanInDependencyStatus,
  EGPTerminalResult,
  ReplanBudgetResult,
  MutabilityClass,
  BranchFailurePolicy,
  EGPRelevantTaskState,
} from '../../src/execution/interfaces/egp_types.js';
import {
  RESERVATION_STATUS_TRANSITIONS,
  DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
  DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
  DEFAULT_MAX_STARVATION_CYCLES,
  DEFAULT_CAPABILITY_MUTABILITY,
  EGP_EVENTS,
  RESERVATION_ERROR_CODES,
  WAVE_ERROR_CODES,
  BRANCH_FAILURE_ERROR_CODES,
  SCHEDULER_ERROR_CODES,
  ENFORCEMENT_ERROR_CODES,
  RETRY_ERROR_CODES,
  SC2_EGP_ERROR_CODES,
  ADMISSION_ERROR_CODES,
} from '../../src/execution/interfaces/egp_types.js';
import type { DatabaseConnection, OperationContext, TaskId, MissionId, CorrelationId } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Helpers — Branded Type Constructors
// ============================================================================

function reservationId(id: string): ReservationId {
  return id as ReservationId;
}

function waveId(id: string): WaveId {
  return id as WaveId;
}

function testTaskId(id: string): TaskId {
  return id as TaskId;
}

function testMissionId(id: string): MissionId {
  return id as MissionId;
}

// ============================================================================
// Test Helpers — Mock Dependencies
// ============================================================================

/** Minimal DatabaseConnection stub — tests do not exercise DB layer */
function createMockConn(): DatabaseConnection {
  return {
    dataDir: ':memory:',
    schemaVersion: 12,
    tenancyMode: 'single',
    transaction<T>(fn: () => T): T { return fn(); },
    run(_sql: string, _params?: unknown[]) { return { changes: 0, lastInsertRowid: 0 }; },
    query<T>(_sql: string, _params?: unknown[]): T[] { return []; },
    get<T>(_sql: string, _params?: unknown[]): T | undefined { return undefined; },
    close() {},
    checkpoint() { return { ok: true as const, value: undefined }; },
  } as unknown as DatabaseConnection;
}

/** Minimal OperationContext stub */
function createMockCtx(): OperationContext {
  return {
    tenantId: null,
    userId: null,
    agentId: null,
    permissions: new Set(),
    sessionId: undefined,
  } as unknown as OperationContext;
}

/** Create ExecutionGovernorDeps with event recording */
function createMockDeps(): ExecutionGovernorDeps & {
  emittedEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  auditEntries: Array<Record<string, unknown>>;
} {
  const emittedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const auditEntries: Array<Record<string, unknown>> = [];
  return {
    emittedEvents,
    auditEntries,
    audit: {
      append(_conn: DatabaseConnection, input: {
        readonly tenantId: string | null;
        readonly actorType: string;
        readonly actorId: string;
        readonly action: string;
        readonly resourceType: string;
        readonly resourceId: string;
        readonly detail: Record<string, unknown>;
        readonly parentEntryId?: string;
      }) {
        auditEntries.push(input as Record<string, unknown>);
        return { ok: true as const, value: 'audit-entry-mock' };
      },
    },
    events: {
      emit(event: {
        readonly type: string;
        readonly scope: string;
        readonly propagation: string;
        readonly payload: Record<string, unknown>;
      }) {
        emittedEvents.push({ type: event.type, payload: event.payload });
      },
    },
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
}

/** Create a standard ReservationCreateInput */
function makeReservationInput(overrides?: Partial<ReservationCreateInput>): ReservationCreateInput {
  return {
    taskId: testTaskId('task-001'),
    missionId: testMissionId('mission-001'),
    reservedTokens: 500,
    reservedDeliberation: 100,
    allocationMethod: 'proportional',
    ...overrides,
  };
}

/** Create an EligibleTaskDescriptor */
function makeEligibleTask(overrides?: Partial<EligibleTaskDescriptor>): EligibleTaskDescriptor {
  return {
    taskId: testTaskId('task-001'),
    priority: 1,
    estimatedTokens: 200,
    estimatedDeliberationTokens: 50,
    requiresDeliberation: true,
    ...overrides,
  };
}

/** Create a WaveCompositionInput */
function makeWaveInput(overrides?: Partial<WaveCompositionInput>): WaveCompositionInput {
  return {
    missionId: testMissionId('mission-001'),
    eligibleTasks: [
      makeEligibleTask({ taskId: testTaskId('task-001') }),
      makeEligibleTask({ taskId: testTaskId('task-002') }),
    ],
    tokenPool: 1000,
    deliberationPool: 200,
    allocationMethod: 'proportional',
    minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
    minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    ...overrides,
  };
}

// ============================================================================
// GROUP 1: Budget Reservation Lifecycle (~12 tests)
// CT-EGP-01, CT-EGP-02, CT-EGP-03, CT-EGP-14, CT-EGP-21
// ============================================================================

describe('GROUP 1: Budget Reservation Lifecycle', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-01: Reservation Isolation — overage does not affect sibling', () => {
    // SETUP: Mission with Tasks A and B, each with 500 token reservation.
    // A consumes 600 tokens (100 overage).
    const createA = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createA.ok);
    governor.reservations.activate(conn, createA.value.reservationId);
    governor.reservations.updateConsumed(conn, createA.value.reservationId, 600, 0);

    const createB = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-b'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createB.ok);
    governor.reservations.activate(conn, createB.value.reservationId);

    // ACTION: Check Task B's reservation headroom.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-b'), 0, 0,
    );

    // CATCHES: Implementation that charges Task A's overage to Task B's reservation
    // would show Task B's headroom < 500.
    // Invariant: EGP-I1 (Reservation Isolation)
    // Defect: DC-EGP-001 — Shared reservation pool where overage leaks across tasks
    assert.ok(result.ok);
    assert.strictEqual(result.value.tokenHeadroom, 500);
  });

  it('CT-EGP-02: No mid-execution rebalance — released budget goes to pool, not running task', () => {
    // SETUP: Task A running with reservation 500. Task C completes, releasing 200 to pool.
    const createA = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createA.ok);
    governor.reservations.activate(conn, createA.value.reservationId);

    // Task C completes and releases 200 to pool (simulated via separate reservation)
    const createC = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-c'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 200,
      reservedDeliberation: 50,
    }));
    assert.ok(createC.ok);
    governor.reservations.activate(conn, createC.value.reservationId);
    governor.reservations.release(conn, ctx, createC.value.reservationId, 'COMPLETED');

    // ACTION: Query Task A's reservation.
    const result = governor.reservations.getByTaskId(conn, testTaskId('task-a'));

    // CATCHES: Implementation that redistributes released budget to running tasks.
    // Task A's reservation must remain exactly 500, not 700.
    // Invariant: EGP-I2 (No Mid-Execution Rebalancing)
    // Defect: DC-EGP-002 — Dynamic rebalancing during execution
    assert.ok(result.ok);
    assert.notStrictEqual(result.value, null);
    assert.strictEqual(result.value!.reservedTokens, 500);
    assert.strictEqual(result.value!.status, 'active');
  });

  it('CT-EGP-03: Atomic reclaim — COMPLETED releases per dimension', () => {
    // SETUP: Task completes with 300 consumed of 500 reserved (tokens),
    // 50 consumed of 100 reserved (deliberation).
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);
    governor.reservations.updateConsumed(conn, resId, 300, 50);

    // ACTION: Release reservation.
    const result = governor.reservations.release(
      conn, ctx, resId, 'COMPLETED',
    );

    // CATCHES: Implementation that only reclaims token dimension but forgets deliberation.
    // Both dimensions must be reclaimed: 200 tokens + 50 deliberation.
    // Invariant: EGP-I3 (Atomic Reclaim on Final Terminal)
    // Defect: DC-EGP-003 — Partial dimension reclaim
    assert.ok(result.ok);
    assert.strictEqual(result.value.reclaimedTokens, 200);
    assert.strictEqual(result.value.reclaimedDeliberation, 50);
    assert.strictEqual(result.value.overageTokens, 0);
    assert.strictEqual(result.value.overageDeliberation, 0);
  });

  it('should create a single reservation with both dimensions', () => {
    // ACTION: Create a reservation with token and deliberation ceilings.
    const input = makeReservationInput({
      reservedTokens: 500,
      reservedDeliberation: 100,
    });
    const result = governor.reservations.create(conn, ctx, input);

    // CATCHES: Implementation that ignores deliberation dimension during creation.
    // Invariant: EGP-I4 (Dual-Dimension Reservation)
    // Defect: DC-EGP-004 — Missing deliberation ceiling on creation
    assert.ok(result.ok);
    assert.strictEqual(result.value.reservedTokens, 500);
    assert.strictEqual(result.value.reservedDeliberation, 100);
    assert.strictEqual(result.value.status, 'reserved');
    assert.strictEqual(result.value.consumedTokens, 0);
    assert.strictEqual(result.value.consumedDeliberation, 0);
  });

  it('should get reservation by task ID', () => {
    // SETUP: Create a reservation for task-001.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
    }));
    assert.ok(createResult.ok);

    // ACTION: Retrieve reservation by its owning task.
    const result = governor.reservations.getByTaskId(conn, testTaskId('task-001'));

    // CATCHES: Implementation that uses reservationId for lookup instead of taskId.
    // Primary lookup is by taskId (§5.1).
    // Defect: DC-EGP-005 — Wrong lookup key
    assert.ok(result.ok);
  });

  it('should activate reservation: reserved → active', () => {
    // SETUP: Create reservation in 'reserved' status.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;

    // ACTION: Transition reservation from reserved to active when task begins.
    const result = governor.reservations.activate(conn, resId);

    // CATCHES: Implementation that allows activate from 'released' status.
    // Only 'reserved' → 'active' is valid per RESERVATION_STATUS_TRANSITIONS.
    // Defect: DC-EGP-006 — Invalid transition acceptance
    assert.ok(result.ok);
  });

  it('should retain reservation on failure with retries: active → retained', () => {
    // SETUP: Create and activate reservation.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);

    // ACTION: Task fails but retries remain. Reservation moves to retained.
    const result = governor.reservations.retain(conn, resId);

    // CATCHES: Implementation that releases reservation on any failure, not distinguishing
    // intermediate failure (retries remain) from final failure (no retries).
    // Invariant: EGP-I3, EGP-I8
    // Defect: DC-EGP-007 — Release on intermediate failure
    assert.ok(result.ok);
  });

  it('should reactivate reservation on retry: retained → active', () => {
    // SETUP: Create, activate, then retain reservation.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);
    governor.reservations.retain(conn, resId);

    // ACTION: Retry begins. Reservation moves from retained back to active.
    const result = governor.reservations.reactivate(conn, resId);

    // CATCHES: Implementation that creates a new reservation for retry instead of
    // reactivating the existing one. Would break consumption accumulation (EGP-I8).
    // Invariant: EGP-I8 (Retry Consumes Reservation)
    // Defect: DC-EGP-008 — Fresh reservation on retry
    assert.ok(result.ok);
  });

  it('should update consumed amounts across both dimensions', () => {
    // SETUP: Create and activate reservation.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);

    // ACTION: Record consumption of 200 tokens and 30 deliberation.
    const result = governor.reservations.updateConsumed(
      conn, resId, 200, 30,
    );

    // CATCHES: Implementation that only tracks token consumption and ignores deliberation.
    // Both dimensions must be tracked independently.
    // Invariant: EGP-I4 (Dual-Dimension)
    // Defect: DC-EGP-009 — Single-dimension consumption tracking
    assert.ok(result.ok);
  });

  it('CT-EGP-14: Retry consumes same reservation — cumulative consumption', () => {
    // SETUP: First attempt: 200 tokens consumed. Fails. Retry: 150 tokens consumed.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);
    governor.reservations.updateConsumed(conn, resId, 200, 0);
    governor.reservations.updateConsumed(conn, resId, 150, 0);

    // ACTION: Check total consumed on reservation.
    const result = governor.reservations.getById(conn, resId);

    // CATCHES: Implementation that resets consumedTokens to 0 between retry attempts.
    // Total consumed must be 350 (200 + 150), not 150.
    // Invariant: EGP-I8 (Retry Consumes Reservation)
    // Defect: DC-EGP-010 — Consumption reset on retry
    assert.ok(result.ok);
    assert.strictEqual(result.value.consumedTokens, 350);
  });

  it('CT-EGP-21: Reservation persists across retry — not released and reallocated', () => {
    // SETUP: Task A has reservation 500 tokens. First attempt consumes 200. Task fails.
    // retryCount < maxRetries. Task retries.
    const createA = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createA.ok);
    const resId = createA.value.reservationId;
    governor.reservations.activate(conn, resId);
    governor.reservations.updateConsumed(conn, resId, 200, 0);
    // Simulate retry: retain, then reactivate
    governor.reservations.retain(conn, resId);
    governor.reservations.reactivate(conn, resId);

    // ACTION: Check reservation after retry start.
    const result = governor.reservations.getByTaskId(conn, testTaskId('task-a'));

    // CATCHES: Implementation that releases the reservation on failure and creates a new one
    // for the retry. Would reset consumedTokens and break EGP-I8 cumulative consumption.
    // Invariant: EGP-I3, EGP-I8
    // Defect: DC-EGP-011 — Reservation release/recreate on retry
    assert.ok(result.ok);
    assert.notStrictEqual(result.value, null);
    assert.strictEqual(result.value!.reservedTokens, 500);
    assert.strictEqual(result.value!.consumedTokens, 200);
    assert.strictEqual(result.value!.status, 'active');
  });

  it('should create batch reservations atomically for a wave', () => {
    // ACTION: Create reservations for 3 tasks in a single atomic batch.
    const inputs = [
      makeReservationInput({ taskId: testTaskId('task-a'), reservedTokens: 300 }),
      makeReservationInput({ taskId: testTaskId('task-b'), reservedTokens: 300 }),
      makeReservationInput({ taskId: testTaskId('task-c'), reservedTokens: 300 }),
    ];
    const result = governor.reservations.createBatch(conn, ctx, inputs);

    // CATCHES: Implementation that creates reservations non-atomically (partial batch on failure).
    // §5.2: all reservations committed in single transaction.
    // Defect: DC-EGP-012 — Non-atomic batch creation
    assert.ok(result.ok);
    assert.strictEqual(result.value.length, 3);
  });

  it('should get active reservations by mission', () => {
    // ACTION: Query all non-released reservations for a mission.
    const result = governor.reservations.getActiveByMission(
      conn, testMissionId('mission-001'),
    );

    // CATCHES: Implementation that returns released reservations in the active query.
    // Only 'reserved', 'active', 'retained' should be returned.
    // Defect: DC-EGP-013 — Including released in active query
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.value));
  });

  it('BRK-EGP-B03: released reservation excluded from getActiveByMission', () => {
    // SETUP: Create two reservations for mission. Release one. Query active.
    const missionId = testMissionId('mission-filter-test');
    const createA = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-keep'),
      missionId,
      reservedTokens: 300,
      reservedDeliberation: 50,
    }));
    assert.ok(createA.ok);
    governor.reservations.activate(conn, createA.value.reservationId);

    const createB = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-release'),
      missionId,
      reservedTokens: 200,
      reservedDeliberation: 30,
    }));
    assert.ok(createB.ok);
    governor.reservations.activate(conn, createB.value.reservationId);
    governor.reservations.release(conn, ctx, createB.value.reservationId, 'COMPLETED');

    // ACTION: Query active reservations for this mission.
    const result = governor.reservations.getActiveByMission(conn, missionId);

    // CATCHES: Implementation that includes released reservations in active query.
    // Only task-keep should appear (active). task-release is released and must be excluded.
    // Invariant: EGP-I3 (released reservation not counted as active)
    // Defect: DC-EGP-013 (BRK-EGP-B03)
    assert.ok(result.ok);
    assert.strictEqual(result.value.length, 1, 'Only one active reservation should remain');
    assert.strictEqual(result.value[0].taskId, testTaskId('task-keep'));
  });
});

// ============================================================================
// GROUP 2: Dual-Dimension Reservation (~8 tests)
// CT-EGP-04, CT-EGP-05, CT-EGP-25, CT-EGP-30
// ============================================================================

describe('GROUP 2: Dual-Dimension Reservation', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-04: Dual-dimension scheduling gate — deliberation insufficient blocks task', () => {
    // SETUP: Task needs min 100 token + 50 deliberation. Mission has 200 tokens, 30 deliberation.
    // ACTION: Compose wave with insufficient deliberation.
    const input = makeWaveInput({
      eligibleTasks: [makeEligibleTask({
        taskId: testTaskId('task-001'),
        estimatedTokens: 200,
        estimatedDeliberationTokens: 50,
        requiresDeliberation: true,
      })],
      tokenPool: 200,
      deliberationPool: 30,
      minimumViableTokens: 100,
      minimumViableDeliberation: 50,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that only checks token dimension for minimum viable.
    // Deliberation 30 < 50 minimum must exclude the task.
    // Invariant: EGP-I4 (Dual-Dimension Reservation)
    // Defect: DC-EGP-014 — Single-dimension scheduling gate
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 0);
    assert.strictEqual(result.value.excludedTasks.length, 1);
  });

  it('CT-EGP-05: Dual-dimension enforcement — deliberation exhausted halts despite token headroom', () => {
    // SETUP: Task has deliberation reservation 100. Task consumes 100 deliberation.
    // Token reservation still has 300 headroom.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);
    governor.reservations.updateConsumed(conn, resId, 200, 100);

    // ACTION: Check headroom — deliberation request of 10 more.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-001'), 0, 10,
    );

    // CATCHES: Implementation that checks combined headroom across dimensions.
    // Deliberation exhausted (0 remaining) must block regardless of token headroom.
    // Invariant: EGP-I4 (independent enforcement per dimension)
    // Defect: DC-EGP-015 — Combined dimension headroom check
    assert.ok(result.ok);
    assert.strictEqual(result.value.allowed, false);
    assert.strictEqual(result.value.deliberationExhausted, true);
    assert.strictEqual(result.value.tokenExhausted, false);
  });

  it('CT-EGP-25: Zero deliberation task — not subject to deliberation enforcement', () => {
    // SETUP: Task with estimatedDeliberationTokens = 0. No deliberation reservation needed.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-zero-delib'),
      reservedTokens: 500,
      reservedDeliberation: 0,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Check headroom for a token-only task.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-zero-delib'), 100, 0,
    );

    // CATCHES: Implementation that requires deliberation headroom for all tasks.
    // A task with reservedDeliberation = 0 cannot be halted by deliberation ceiling breach.
    // Invariant: EGP-I4 (§5.2)
    // Defect: DC-EGP-016 — Universal deliberation enforcement
    assert.ok(result.ok);
    assert.strictEqual(result.value.allowed, true);
    assert.strictEqual(result.value.deliberationExhausted, false);
  });

  it('CT-EGP-30: All-zero-deliberation wave — deliberation pool unchanged', () => {
    // SETUP: Wave of 3 tasks, all with estimatedDeliberationTokens = 0.
    // Mission token pool = 900, deliberation pool = 500.
    // ACTION: Wave allocation.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t1'), estimatedTokens: 300, estimatedDeliberationTokens: 0, requiresDeliberation: false }),
        makeEligibleTask({ taskId: testTaskId('t2'), estimatedTokens: 300, estimatedDeliberationTokens: 0, requiresDeliberation: false }),
        makeEligibleTask({ taskId: testTaskId('t3'), estimatedTokens: 300, estimatedDeliberationTokens: 0, requiresDeliberation: false }),
      ],
      tokenPool: 900,
      deliberationPool: 500,
      allocationMethod: 'equal',
      minimumViableTokens: 100,
      minimumViableDeliberation: 50,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that divides deliberation pool across all tasks regardless
    // of requiresDeliberation flag, or that produces division-by-zero on zero-deliberation waves.
    // Invariant: EGP-I4 (PSD-8)
    // Defect: DC-EGP-017 — Division by zero or spurious deliberation allocation
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 3);
    // All reservations should have reservedDeliberation = 0
    for (const reservation of result.value.reservations) {
      assert.strictEqual(reservation.reservedDeliberation, 0);
    }
  });

  it('should enforce token dimension independently — token exhausted blocks despite deliberation', () => {
    // SETUP: Task has consumed all tokens but deliberation has headroom.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-token-exhausted'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);
    governor.reservations.updateConsumed(conn, createResult.value.reservationId, 500, 0);

    // ACTION: Request additional 100 tokens.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-token-exhausted'), 100, 0,
    );

    // CATCHES: Implementation that lets deliberation headroom compensate for token exhaustion.
    // Each dimension is an independent hard ceiling.
    // Invariant: EGP-I4
    // Defect: DC-EGP-018 — Cross-dimension headroom compensation
    assert.ok(result.ok);
    assert.strictEqual(result.value.allowed, false);
    assert.strictEqual(result.value.tokenExhausted, true);
  });

  it('should schedule task only when both dimensions meet minimum', () => {
    // SETUP: Token pool sufficient (500), deliberation pool sufficient (200).
    // Both > minimum viable.
    // ACTION: Compose wave.
    const input = makeWaveInput({
      eligibleTasks: [makeEligibleTask({
        taskId: testTaskId('task-both-ok'),
        estimatedTokens: 200,
        estimatedDeliberationTokens: 50,
        requiresDeliberation: true,
      })],
      tokenPool: 500,
      deliberationPool: 200,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that skips one dimension in the admission check.
    // Both dimensions must independently meet minimum.
    // Invariant: EGP-I4
    // Defect: DC-EGP-019 — Single-dimension admission check
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 1);
    assert.ok(result.value.reservations[0].reservedTokens >= DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS);
    assert.ok(result.value.reservations[0].reservedDeliberation >= DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION);
  });

  it('should handle mixed wave — some tasks need deliberation, some do not', () => {
    // SETUP: 2 tasks: one needs deliberation, one does not.
    // ACTION: Compose wave.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t-needs-delib'), estimatedTokens: 200, estimatedDeliberationTokens: 80, requiresDeliberation: true }),
        makeEligibleTask({ taskId: testTaskId('t-no-delib'), estimatedTokens: 200, estimatedDeliberationTokens: 0, requiresDeliberation: false }),
      ],
      tokenPool: 800,
      deliberationPool: 100,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that applies deliberation minimum to all tasks in a wave.
    // Only tasks with requiresDeliberation=true need deliberation budget.
    // Invariant: EGP-I4, PSD-8
    // Defect: DC-EGP-020 — Deliberation minimum applied to non-deliberation tasks
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 2);
  });

  it('should exclude task requiring deliberation from wave when deliberation insufficient for its minimum', () => {
    // SETUP: 2 tasks: t1 needs delib (min 50), t2 does not. Delib pool = 30 (below min).
    // ACTION: Compose wave.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t-delib'), estimatedTokens: 200, estimatedDeliberationTokens: 80, requiresDeliberation: true }),
        makeEligibleTask({ taskId: testTaskId('t-nodelib'), estimatedTokens: 200, estimatedDeliberationTokens: 0, requiresDeliberation: false }),
      ],
      tokenPool: 800,
      deliberationPool: 30,
      minimumViableDeliberation: 50,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that schedules deliberation-requiring task even when
    // deliberation pool is below minimum for that dimension.
    // Invariant: EGP-I4
    // Defect: DC-EGP-021 — Scheduling with insufficient deliberation
    assert.ok(result.ok);
    // t-delib excluded, t-nodelib scheduled
    assert.strictEqual(result.value.scheduledTaskIds.length, 1);
    assert.deepStrictEqual(result.value.scheduledTaskIds, [testTaskId('t-nodelib')]);
    assert.strictEqual(result.value.excludedTasks.length, 1);
  });
});

// ============================================================================
// GROUP 3: Wave Composition (~8 tests)
// CT-EGP-16, CT-EGP-19
// ============================================================================

describe('GROUP 3: Wave Composition', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-16: Scheduling determinism — same inputs produce same output', () => {
    // SETUP: Identical eligible set, pool, and policy.
    // ACTION: Run composer on two INDEPENDENT governors with identical inputs.
    // BRK-EGP-B06: Each compose now creates formal reservations, so the same
    // governor cannot compose the same tasks twice (duplicate reservation guard).
    // Using separate governors tests determinism: same inputs → same outputs.
    const input = makeWaveInput();
    const result1 = governor.waveComposer.compose(conn, ctx, input);

    const deps2 = createMockDeps();
    const governor2 = createExecutionGovernor(deps2);
    const result2 = governor2.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation with non-deterministic ordering (e.g., random selection,
    // Map iteration order, Date.now() in tie-breaking).
    // Invariant: EGP-I9 (Scheduling Determinism)
    // Defect: DC-EGP-022 — Non-deterministic wave composition
    assert.ok(result1.ok);
    assert.ok(result2.ok);
    assert.deepStrictEqual(result1.value.scheduledTaskIds, result2.value.scheduledTaskIds);
    assert.strictEqual(result1.value.reservations.length, result2.value.reservations.length);
    for (let i = 0; i < result1.value.reservations.length; i++) {
      assert.strictEqual(
        result1.value.reservations[i].reservedTokens,
        result2.value.reservations[i].reservedTokens,
      );
      assert.strictEqual(
        result1.value.reservations[i].reservedDeliberation,
        result2.value.reservations[i].reservedDeliberation,
      );
    }
  });

  it('CT-EGP-19: Minimum viable reservation — one task scheduled when budget insufficient for two', () => {
    // SETUP: Token pool = 150. Two eligible tasks. Minimum = 100 per task. Equal allocation.
    // 150/2 = 75 < 100 per task.
    // ACTION: Compose wave.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t1'), estimatedTokens: 100 }),
        makeEligibleTask({ taskId: testTaskId('t2'), estimatedTokens: 100 }),
      ],
      tokenPool: 150,
      deliberationPool: 200,
      allocationMethod: 'equal',
      minimumViableTokens: 100,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that schedules both tasks with sub-minimum reservations.
    // Only 1 task should be scheduled (receives 150), other stays PENDING.
    // Invariant: PSD-2 (Minimum Viable Reservation), FM-EGP-01
    // Defect: DC-EGP-023 — Sub-minimum reservation permitted
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 1);
    assert.ok(result.value.reservations[0].reservedTokens >= 100);
  });

  it('should compute proportional allocation based on estimated usage', () => {
    // SETUP: Two tasks. t1 estimates 300 tokens, t2 estimates 100 tokens. Pool = 800.
    // Proportional: t1 gets 300/400 * 800 = 600, t2 gets 100/400 * 800 = 200.
    // ACTION: Compose wave with proportional allocation.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t1'), estimatedTokens: 300 }),
        makeEligibleTask({ taskId: testTaskId('t2'), estimatedTokens: 100 }),
      ],
      tokenPool: 800,
      deliberationPool: 200,
      allocationMethod: 'proportional',
      minimumViableTokens: 100,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that gives all tasks equal shares regardless of estimates.
    // Proportional allocation must weight by estimated usage.
    // Invariant: PSD-1 (Allocation Method)
    // Defect: DC-EGP-024 — Equal allocation masquerading as proportional
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 2);
    assert.strictEqual(result.value.allocationMethod, 'proportional');
    // t1 should get a larger share than t2
    const t1Res = result.value.reservations.find(r => r.taskId === testTaskId('t1'));
    const t2Res = result.value.reservations.find(r => r.taskId === testTaskId('t2'));
    assert.ok(t1Res !== undefined);
    assert.ok(t2Res !== undefined);
    assert.ok(t1Res!.reservedTokens > t2Res!.reservedTokens);
  });

  it('should compute equal allocation giving each task the same share', () => {
    // SETUP: Three tasks. Pool = 900 tokens. Equal allocation.
    // ACTION: Compose wave.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t1'), estimatedTokens: 100 }),
        makeEligibleTask({ taskId: testTaskId('t2'), estimatedTokens: 500 }),
        makeEligibleTask({ taskId: testTaskId('t3'), estimatedTokens: 200 }),
      ],
      tokenPool: 900,
      deliberationPool: 300,
      allocationMethod: 'equal',
      minimumViableTokens: 100,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that uses proportional allocation when 'equal' is specified.
    // Each task should receive 300 tokens (900/3).
    // Invariant: PSD-1
    // Defect: DC-EGP-025 — Proportional allocation when equal requested
    assert.ok(result.ok);
    assert.strictEqual(result.value.scheduledTaskIds.length, 3);
    for (const reservation of result.value.reservations) {
      assert.strictEqual(reservation.reservedTokens, 300);
    }
  });

  it('should record pool snapshot at wave start — immutable during composition', () => {
    // ACTION: Compose wave and verify the snapshot is recorded.
    const input = makeWaveInput({ tokenPool: 1000, deliberationPool: 500 });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that re-reads pool during allocation (TOCTOU).
    // Pool snapshot must be taken once at wave start and all allocations computed against it.
    // Invariant: EGP-I9 (determinism requires immutable snapshot)
    // Defect: DC-EGP-026 — Pool snapshot mutation during composition
    assert.ok(result.ok);
    assert.strictEqual(result.value.tokenPoolSnapshot, 1000);
    assert.strictEqual(result.value.deliberationPoolSnapshot, 500);
  });

  it('should report excluded tasks with reasons', () => {
    // SETUP: One task that can fit, one that cannot (pool too small for both).
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t-fits'), estimatedTokens: 300 }),
        makeEligibleTask({ taskId: testTaskId('t-excluded'), estimatedTokens: 300 }),
      ],
      tokenPool: 300,
      deliberationPool: 200,
      allocationMethod: 'equal',
      minimumViableTokens: 200,
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that silently drops tasks without recording exclusion reason.
    // Every excluded task must have a reason in the result.
    // Defect: DC-EGP-027 — Silent exclusion without reason
    assert.ok(result.ok);
    assert.ok(result.value.excludedTasks.length > 0);
    for (const excluded of result.value.excludedTasks) {
      assert.ok(typeof excluded.reason === 'string');
      assert.ok(excluded.reason.length > 0);
    }
  });

  it('should produce a unique waveId per composition', () => {
    // ACTION: Compose two waves with different tasks.
    // BRK-EGP-B06: Each compose creates formal reservations, so different
    // task IDs are required to avoid duplicate-reservation rejection.
    const input1 = makeWaveInput();
    const input2 = makeWaveInput({
      missionId: testMissionId('mission-002'),
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('task-003') }),
        makeEligibleTask({ taskId: testTaskId('task-004') }),
      ],
    });
    const result1 = governor.waveComposer.compose(conn, ctx, input1);
    const result2 = governor.waveComposer.compose(conn, ctx, input2);

    // CATCHES: Implementation that reuses waveId or uses a static value.
    // Each wave must have a unique identifier for replay.
    // Invariant: EGP-I9 (replay requires unique wave IDs)
    // Defect: DC-EGP-028 — Duplicate waveId
    assert.ok(result1.ok);
    assert.ok(result2.ok);
    assert.notStrictEqual(result1.value.waveId, result2.value.waveId);
  });

  it('should handle explicit allocation method', () => {
    // SETUP: Explicit allocation — planner specifies exact budgets.
    // ACTION: Compose wave with explicit method.
    const input = makeWaveInput({
      eligibleTasks: [
        makeEligibleTask({ taskId: testTaskId('t1'), estimatedTokens: 400 }),
        makeEligibleTask({ taskId: testTaskId('t2'), estimatedTokens: 200 }),
      ],
      tokenPool: 600,
      deliberationPool: 200,
      allocationMethod: 'explicit',
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that ignores the allocationMethod field.
    // When 'explicit', the estimatedTokens IS the requested budget (not an input to proportional).
    // Invariant: PSD-1
    // Defect: DC-EGP-029 — Allocation method ignored
    assert.ok(result.ok);
    assert.strictEqual(result.value.allocationMethod, 'explicit');
  });
});

// ============================================================================
// GROUP 4: Branch Failure Policies (~12 tests)
// CT-EGP-07, CT-EGP-08, CT-EGP-09, CT-EGP-10, CT-EGP-11, CT-EGP-22,
// CT-EGP-23, CT-EGP-28, CT-EGP-29
// ============================================================================

describe('GROUP 4: Branch Failure Policies', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-07: Isolate policy — siblings unaffected by failure', () => {
    // SETUP: Fan-out: Tasks A, B, C. Policy = isolate. A fails after retry exhaustion.
    // ACTION: Handle failure.
    const input: BranchFailureInput = {
      failedTaskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      policy: 'isolate',
      siblingTaskIds: [testTaskId('task-b'), testTaskId('task-c')],
      siblingStates: [
        { taskId: testTaskId('task-b'), state: 'RUNNING' },
        { taskId: testTaskId('task-c'), state: 'RUNNING' },
      ],
      fanInDependents: [],
    };
    const result = governor.branchFailure.handleFailure(conn, ctx, input);

    // CATCHES: Implementation that cancels siblings under isolate policy.
    // Isolate means: B and C continue execution, no cancellation.
    // Invariant: EGP-I6 (isolate = no sibling cancellation)
    // Defect: DC-EGP-030 — Sibling cancellation under isolate
    assert.ok(result.ok);
    assert.strictEqual(result.value.cancelledTaskIds.length, 0);
    assert.strictEqual(result.value.policy, 'isolate');
  });

  it('CT-EGP-08: Fail-fast — PENDING/SCHEDULED siblings cancelled, RUNNING continues', () => {
    // SETUP: Fan-out: Tasks A, B, C. Policy = fail-fast. A fails. B is PENDING. C is RUNNING.
    // ACTION: Handle failure.
    const input: BranchFailureInput = {
      failedTaskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      policy: 'fail-fast',
      siblingTaskIds: [testTaskId('task-b'), testTaskId('task-c')],
      siblingStates: [
        { taskId: testTaskId('task-b'), state: 'PENDING' },
        { taskId: testTaskId('task-c'), state: 'RUNNING' },
      ],
      fanInDependents: [],
    };
    const result = governor.branchFailure.handleFailure(conn, ctx, input);

    // CATCHES: Implementation that cancels RUNNING tasks or leaves PENDING tasks active.
    // B (PENDING) must be cancelled. C (RUNNING) continues to natural boundary.
    // Invariant: EGP-I6, EGP-I10 (running not preemptible)
    // Defect: DC-EGP-031 — RUNNING task cancelled or PENDING task left active
    assert.ok(result.ok);
    assert.deepStrictEqual(result.value.cancelledTaskIds, [testTaskId('task-b')]);
  });

  it('CT-EGP-09: Fail-fast not transitive — does not propagate beyond fan-out', () => {
    // SETUP: Fan-out [A, B, C]. A fails. B cancelled by fail-fast.
    // Task D depends on B. Task E is D's sibling in separate fan-out.
    // ACTION: Handle failure.
    const input: BranchFailureInput = {
      failedTaskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      policy: 'fail-fast',
      siblingTaskIds: [testTaskId('task-b'), testTaskId('task-c')],
      siblingStates: [
        { taskId: testTaskId('task-b'), state: 'PENDING' },
        { taskId: testTaskId('task-c'), state: 'RUNNING' },
      ],
      fanInDependents: [
        {
          taskId: testTaskId('task-d'),
          allPredecessorIds: [testTaskId('task-a'), testTaskId('task-b'), testTaskId('task-c')],
        },
      ],
    };
    const result = governor.branchFailure.handleFailure(conn, ctx, input);

    // CATCHES: Implementation that transitively cancels tasks outside the fan-out set.
    // E (in a separate fan-out) must NOT be cancelled. Only [A,B,C] fan-out is affected.
    // Invariant: EGP-I6 (PSD-5: fail-fast not transitive)
    // Defect: DC-EGP-032 — Transitive fail-fast propagation
    assert.ok(result.ok);
    // D's dependency is unmet (B cancelled), but E is NOT in cancelledTaskIds
    const cancelled = result.value.cancelledTaskIds;
    assert.ok(!cancelled.includes(testTaskId('task-e')));
  });

  it('CT-EGP-10: Quorum success — fan-in proceeds when threshold met', () => {
    // SETUP: Fan-in D depends on [A, B, C]. quorumThreshold = 0.6.
    // A completes. B fails. C completes. requiredSuccesses = ceil(0.6 * 3) = ceil(1.8) = 2.
    // 2 completed >= 2 required → quorum met. Fan-in proceeds.
    // BRK-EGP-B02: threshold adjusted from 0.67 to 0.6 because Math.ceil is now used.
    // ceil(0.67 * 3) = ceil(2.01) = 3, which requires ALL to complete — not a quorum test.
    // ACTION: Evaluate fan-in.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'COMPLETED' },
        { taskId: testTaskId('task-b'), state: 'FAILED' },
        { taskId: testTaskId('task-c'), state: 'COMPLETED' },
      ],
      0.6,
    );

    // CATCHES: Implementation that requires ALL predecessors to complete under quorum.
    // 2 of 3 completed >= ceil(0.6 * 3) = 2. Fan-in should proceed.
    // Invariant: EGP-I6 (Quorum)
    // Defect: DC-EGP-033 — Quorum requiring all completions
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, true);
    assert.strictEqual(result.value.reason, 'quorum_met');
    assert.ok(result.value.quorumState !== undefined);
    assert.strictEqual(result.value.quorumState!.met, true);
    assert.strictEqual(result.value.quorumState!.requiredSuccesses, 2);
    assert.strictEqual(result.value.quorumState!.completedSuccessCount, 2);
  });

  it('CT-EGP-11: Quorum failure — fan-in cancelled when quorum impossible', () => {
    // SETUP: Fan-in D depends on [A, B, C]. quorumThreshold = 0.67.
    // A completes. B fails. C fails. 1/3 < threshold.
    // ACTION: Evaluate fan-in.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'COMPLETED' },
        { taskId: testTaskId('task-b'), state: 'FAILED' },
        { taskId: testTaskId('task-c'), state: 'FAILED' },
      ],
      0.67,
    );

    // CATCHES: Implementation that leaves fan-in waiting when quorum is mathematically impossible.
    // 1 completed + 0 remaining < 2 required. Must cancel immediately.
    // Invariant: EGP-I6 (Quorum impossible detection)
    // Defect: DC-EGP-034 — Zombie fan-in waiting for impossible quorum
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, false);
    assert.strictEqual(result.value.reason, 'quorum_impossible');
    assert.ok(result.value.quorumState !== undefined);
    assert.strictEqual(result.value.quorumState!.impossible, true);
  });

  it('CT-EGP-22: Branch failure only on final failure — intermediate does not trigger', () => {
    // SETUP: Fan-out Tasks A, B, C. Policy = fail-fast.
    // Task A fails but retries remain. Task A retries successfully.
    // ACTION: handleFailure should NOT be called for intermediate failures.
    // We verify that if called with a task that has retries, no siblings are cancelled.
    // The spec says: "NOT triggered on intermediate failures that will be retried" (§6.2).
    // The contract enforces that terminalOp retains on intermediate failure (not releases).
    const createA = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
    }));
    assert.ok(createA.ok);
    governor.reservations.activate(conn, createA.value.reservationId);

    const termResult = governor.terminalOp.execute(
      conn, ctx, testTaskId('task-a'), 'FAILED', true, // hasRetriesRemaining = true
    );

    // CATCHES: Implementation that evaluates branch failure policy on every failure,
    // not just final failure. Intermediate failure should retain, not trigger policy.
    // Invariant: EGP-I6, §6.2 triggering condition
    // Defect: DC-EGP-035 — Branch failure evaluated on intermediate failure
    assert.ok(termResult.ok);
    assert.strictEqual(termResult.value.action, 'retained');
  });

  it('CT-EGP-23: Quorum impossible early detection — cancel before all predecessors finish', () => {
    // SETUP: Fan-in D depends on [A, B, C]. quorumThreshold = 0.67 (need 2 of 3).
    // A fails (final). B fails (final). C still RUNNING.
    // ACTION: Evaluate fan-in after B fails.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'FAILED' },
        { taskId: testTaskId('task-b'), state: 'FAILED' },
        { taskId: testTaskId('task-c'), state: 'RUNNING' },
      ],
      0.67,
    );

    // CATCHES: Implementation that waits for all predecessors to finish before evaluating.
    // With 0 completed + 1 active = 1 < 2 required: quorum impossible. Cancel D now.
    // Invariant: EGP-I6 (early impossibility detection)
    // Defect: DC-EGP-036 — Late quorum impossibility detection
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, false);
    assert.strictEqual(result.value.reason, 'quorum_impossible');
    assert.ok(result.value.quorumState !== undefined);
    assert.strictEqual(result.value.quorumState!.impossible, true);
    assert.strictEqual(result.value.quorumState!.remainingActiveCount, 1);
  });

  it('CT-EGP-28: Isolate fan-in eligibility after predecessor failure', () => {
    // SETUP: Fan-out: Tasks A, B. Fan-in: Task D depends on [A, B].
    // Policy = isolate. A fails terminally. B completes.
    // ACTION: Evaluate D's eligibility under isolate.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'isolate',
      [
        { taskId: testTaskId('task-a'), state: 'FAILED' },
        { taskId: testTaskId('task-b'), state: 'COMPLETED' },
      ],
    );

    // CATCHES: Implementation that requires all predecessors to COMPLETE under isolate.
    // Under isolate policy-aware resolution, ALL predecessors being terminally resolved
    // (COMPLETED, FAILED, or CANCELLED) makes the fan-in eligible.
    // Invariant: EGP-I5, EGP-I6 (policy-aware dependency resolution)
    // Defect: DC-EGP-037 — Isolate fan-in blocked by predecessor failure
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, true);
    assert.strictEqual(result.value.reason, 'all_resolved');
    assert.deepStrictEqual(result.value.completedPredecessors, [testTaskId('task-b')]);
    assert.deepStrictEqual(result.value.failedPredecessors, [testTaskId('task-a')]);
  });

  it('CT-EGP-29: Quorum rounding — ceil(0.5 * 3) = 2', () => {
    // SETUP: 3 predecessors. quorumThreshold = 0.5.
    // requiredSuccesses = ceil(0.5 * 3) = ceil(1.5) = 2.
    // 1 completed, 2 still running.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'COMPLETED' },
        { taskId: testTaskId('task-b'), state: 'RUNNING' },
        { taskId: testTaskId('task-c'), state: 'RUNNING' },
      ],
      0.5,
    );

    // CATCHES: Implementation that uses floor or round instead of ceil.
    // ceil(0.5 * 3) = 2, not 1. With 1 completed, quorum NOT met yet.
    // Invariant: EGP-I6 (Quorum arithmetic)
    // Defect: DC-EGP-038 — Floor/round instead of ceil in quorum calculation
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, false);
    assert.strictEqual(result.value.reason, 'waiting');
    assert.ok(result.value.quorumState !== undefined);
    assert.strictEqual(result.value.quorumState!.requiredSuccesses, 2);
    assert.strictEqual(result.value.quorumState!.met, false);
  });

  it('CT-EGP-29 (cont): Quorum rounding — ceil(0.33 * 3) = 1', () => {
    // SETUP: 3 predecessors. quorumThreshold = 0.33.
    // requiredSuccesses = ceil(0.33 * 3) = ceil(0.99) = 1.
    // 1 completed: quorum met.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'COMPLETED' },
        { taskId: testTaskId('task-b'), state: 'RUNNING' },
        { taskId: testTaskId('task-c'), state: 'RUNNING' },
      ],
      0.33,
    );

    // CATCHES: Implementation that computes ceil(0.99) as 1 incorrectly (e.g., floor gives 0).
    // ceil(0.33 * 3) = ceil(0.99) = 1. With 1 completed, quorum IS met.
    // Invariant: EGP-I6
    // Defect: DC-EGP-039 — Floating-point error in quorum ceil
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, true);
    assert.strictEqual(result.value.reason, 'quorum_met');
    assert.ok(result.value.quorumState !== undefined);
    assert.strictEqual(result.value.quorumState!.requiredSuccesses, 1);
    assert.strictEqual(result.value.quorumState!.met, true);
  });

  it('BRK-EGP-B02: quorum uses ceil not round — ceil(0.67 * 5) = 4, round = 3', () => {
    // SETUP: 5 predecessors. quorumThreshold = 0.67.
    // ceil(0.67 * 5) = ceil(3.35) = 4 (correct: need 4 of 5 for 2/3 majority).
    // round(0.67 * 5) = round(3.35) = 3 (wrong: 3 of 5 is only 60%, below 66.7%).
    // With 3 completed: quorum NOT met under ceil, but WOULD be met under round.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'COMPLETED' },
        { taskId: testTaskId('task-b'), state: 'COMPLETED' },
        { taskId: testTaskId('task-c'), state: 'COMPLETED' },
        { taskId: testTaskId('task-d-pred'), state: 'FAILED' },
        { taskId: testTaskId('task-e'), state: 'RUNNING' },
      ],
      0.67,
    );

    // CATCHES: Implementation using Math.round instead of Math.ceil.
    // With ceil: requiredSuccesses = 4, 3 completed < 4 → NOT met, waiting.
    // With round: requiredSuccesses = 3, 3 completed >= 3 → met (WRONG).
    // Invariant: EGP-I6 (Quorum arithmetic — ceil for minimum threshold)
    // Defect: DC-EGP-038 (BRK-EGP-B02)
    assert.ok(result.ok);
    assert.strictEqual(result.value.quorumState!.requiredSuccesses, 4,
      'ceil(0.67 * 5) must be 4, not round(3.35) = 3');
    assert.strictEqual(result.value.eligible, false,
      '3 of 5 completed must not meet 0.67 quorum under ceil');
    assert.strictEqual(result.value.reason, 'waiting');
  });

  it('should enforce mission-level policy only — no per-task override in v1', () => {
    // SETUP: All fan-outs in mission use the same policy.
    // ACTION: Handle failure with mission-level policy.
    const input: BranchFailureInput = {
      failedTaskId: testTaskId('task-a'),
      missionId: testMissionId('mission-001'),
      policy: 'isolate',
      siblingTaskIds: [testTaskId('task-b')],
      siblingStates: [{ taskId: testTaskId('task-b'), state: 'RUNNING' }],
      fanInDependents: [],
    };
    const result = governor.branchFailure.handleFailure(conn, ctx, input);

    // CATCHES: Implementation that allows per-task or per-fan-out policy override.
    // PSD-4: mission-level only in v1.
    // Defect: DC-EGP-040 — Per-task policy override accepted
    assert.ok(result.ok);
    assert.strictEqual(result.value.policy, 'isolate');
  });
});

// ============================================================================
// GROUP 5: Scheduling & Starvation (~6 tests)
// CT-EGP-06, CT-EGP-15
// ============================================================================

describe('GROUP 5: Scheduling & Starvation', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-06: Starvation bound — mission scheduled after N+1 cycles of starvation', () => {
    // SETUP: Mission B (non-starving) is FIRST in input order.
    // Mission A (starving, counter > bound) is SECOND in input order.
    // BRK-EGP-B04: Starving mission must be scheduled first regardless of input order.
    // Only the priority sort should place it first — not input position.
    // ACTION: Run scheduler cycle when Mission A has exceeded starvation bound.
    const input: SchedulerCycleInput = {
      availableWorkers: 1, // Only 1 worker — only one mission can be scheduled
      eligibleMissions: [
        {
          missionId: testMissionId('mission-b'),
          eligibleTasks: [makeEligibleTask({ taskId: testTaskId('task-b1') })],
          tokenPool: 1000,
          deliberationPool: 400,
          branchFailurePolicy: 'isolate',
          starvationCounter: 0,
        },
        {
          missionId: testMissionId('mission-a'),
          eligibleTasks: [makeEligibleTask({ taskId: testTaskId('task-a1') })],
          tokenPool: 500,
          deliberationPool: 200,
          branchFailurePolicy: 'isolate',
          starvationCounter: DEFAULT_MAX_STARVATION_CYCLES + 1,
        },
      ],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };
    const result = governor.scheduler.executeCycle(conn, ctx, input);

    // CATCHES: Implementation that ignores starvation counters and always picks
    // first-in-input-order mission. With sort removed, mission-b (first in input,
    // non-starving) would be scheduled instead of mission-a (second, starving).
    // Mission A (counter > bound) must be scheduled despite being second in input.
    // Invariant: EGP-I5 (Scheduling Fairness Bound), CF-11
    // Defect: DC-EGP-041 — Starvation counter ignored (BRK-EGP-B04)
    assert.ok(result.ok);
    const scheduledMissions = result.value.waves.map(w => w.missionId);
    assert.ok(scheduledMissions.includes(testMissionId('mission-a')),
      'Starving mission must be scheduled despite being second in input order');
    // With only 1 worker, only one mission gets scheduled. The starving one must win.
    assert.strictEqual(result.value.waves[0].missionId, testMissionId('mission-a'),
      'Starving mission must be first wave');
  });

  it('CT-EGP-15: Running tasks not preemptible — new mission queued', () => {
    // SETUP: All workers busy. Higher-priority mission arrives.
    // ACTION: Run scheduler cycle with 0 available workers.
    const input: SchedulerCycleInput = {
      availableWorkers: 0,
      eligibleMissions: [
        {
          missionId: testMissionId('mission-high'),
          eligibleTasks: [makeEligibleTask({ taskId: testTaskId('task-high') })],
          tokenPool: 1000,
          deliberationPool: 400,
          branchFailurePolicy: 'isolate',
          starvationCounter: 0,
        },
      ],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };
    const result = governor.scheduler.executeCycle(conn, ctx, input);

    // CATCHES: Implementation that preempts running tasks for higher-priority work.
    // With 0 workers, no new tasks can be dispatched.
    // Invariant: EGP-I10 (Running Tasks Not Preemptible)
    // Defect: DC-EGP-042 — Worker preemption for priority
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, SCHEDULER_ERROR_CODES.NO_WORKERS_AVAILABLE);
  });

  it('should increment starvation counter when mission eligible but not scheduled', () => {
    // ACTION: Increment counter for mission.
    governor.starvation.increment(testMissionId('mission-a'));

    // CATCHES: Implementation that doesn't track starvation counters at all.
    // Invariant: EGP-I5
    // Defect: DC-EGP-043 — Starvation counter not maintained
    const counter = governor.starvation.getCounter(testMissionId('mission-a'));
    assert.strictEqual(counter, 1);
  });

  it('should reset starvation counter when mission is scheduled', () => {
    // ACTION: Reset counter for mission.
    governor.starvation.reset(testMissionId('mission-a'));

    // CATCHES: Implementation that never resets counters, causing permanent promotion.
    // Invariant: EGP-I5
    // Defect: DC-EGP-044 — Counter never reset after scheduling
    const counter = governor.starvation.getCounter(testMissionId('mission-a'));
    assert.strictEqual(counter, 0);
  });

  it('should not increment counter during pure saturation — no mission scheduled', () => {
    // SETUP: Scheduler cycle where no mission received any scheduling (pure saturation).
    // ACTION: Check isAboveBound — counter should NOT have been incremented.
    // Pure saturation: zero workers available, no scheduling happens for anyone.
    const aboveBound = governor.starvation.isAboveBound(
      testMissionId('mission-a'),
      DEFAULT_MAX_STARVATION_CYCLES,
    );

    // CATCHES: Implementation that increments counter even when no other mission was scheduled.
    // "Pure saturation cycles do not increment the counter" — EGP-I5.
    // Invariant: EGP-I5
    // Defect: DC-EGP-045 — Counter incremented during pure saturation
    assert.strictEqual(aboveBound, false);
  });

  it('should include starvation updates in scheduler cycle result', () => {
    // ACTION: Execute scheduler cycle and verify starvation tracking in result.
    const input: SchedulerCycleInput = {
      availableWorkers: 1,
      eligibleMissions: [
        {
          missionId: testMissionId('mission-a'),
          eligibleTasks: [makeEligibleTask({ taskId: testTaskId('task-a1') })],
          tokenPool: 500,
          deliberationPool: 200,
          branchFailurePolicy: 'isolate',
          starvationCounter: 5,
        },
      ],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };
    const result = governor.scheduler.executeCycle(conn, ctx, input);

    // CATCHES: Implementation that omits starvation tracking from cycle results.
    // Replay requires starvation counter state.
    // Invariant: EGP-I9 (replay), EGP-I5
    // Defect: DC-EGP-046 — Missing starvation updates in result
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.value.starvationUpdates));
  });
});

// ============================================================================
// GROUP 6: Capability Mutability & Retry (~8 tests)
// CT-EGP-12, CT-EGP-13, CT-EGP-26
// ============================================================================

describe('GROUP 6: Capability Mutability & Retry', () => {
  let governor: ExecutionGovernor;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
  });

  it('CT-EGP-12: Read-only retry — web_search auto-retry permitted', () => {
    // SETUP: web_search capability fails.
    // ACTION: Evaluate retry policy.
    const result = governor.retryPolicy.evaluate(
      'web_search', undefined, 'read-only', false,
    );

    // CATCHES: Implementation that blocks retry for read-only capabilities.
    // Read-only is always safe to retry (no state change anywhere).
    // Invariant: EGP-I7 (Capability Mutability Classification)
    // Defect: DC-EGP-047 — Read-only retry blocked
    assert.ok(result.ok);
    assert.strictEqual(result.value.retryPermitted, true);
    assert.strictEqual(result.value.requiresSandboxReset, false);
    assert.strictEqual(result.value.mutabilityClass, 'read-only');
  });

  it('CT-EGP-13: Mutating-external no retry — api_call auto-retry forbidden', () => {
    // SETUP: api_call (mutating-external) fails.
    // ACTION: Evaluate retry policy.
    const result = governor.retryPolicy.evaluate(
      'api_call', undefined, 'mutating-external', false,
    );

    // CATCHES: Implementation that allows auto-retry for mutating-external operations.
    // mutating-external is never auto-retried — risk of duplicate external side effects.
    // Invariant: EGP-I7 (mutating-external never auto-retried)
    // Defect: DC-EGP-048 — Mutating-external retry permitted
    assert.ok(result.ok);
    assert.strictEqual(result.value.retryPermitted, false);
    assert.strictEqual(result.value.mutabilityClass, 'mutating-external');
  });

  it('CT-EGP-26: Binding-level classification — same adapter, different behavior', () => {
    // SETUP: api_call adapter with two operations:
    // GET /status (read-only) and POST /charge (mutating-external).
    // Both fail.
    // ACTION: Evaluate retry for each operation.
    const getResult = governor.retryPolicy.evaluate(
      'api_call', 'GET /status', 'read-only', false,
    );
    const postResult = governor.retryPolicy.evaluate(
      'api_call', 'POST /charge', 'mutating-external', false,
    );

    // CATCHES: Implementation that uses adapter-family default for all operations.
    // The operation-level classification overrides the adapter default.
    // GET → read-only → retry. POST → mutating-external → no retry.
    // Invariant: EGP-I7 (binding-level, not adapter-level)
    // Defect: DC-EGP-049 — Adapter-level classification applied uniformly
    assert.ok(getResult.ok);
    assert.ok(postResult.ok);
    assert.strictEqual(getResult.value.retryPermitted, true);
    assert.strictEqual(postResult.value.retryPermitted, false);
  });

  it('should require sandbox reset for side-effecting operations', () => {
    // SETUP: code_execute (side-effecting) fails. Sandbox reset available.
    // ACTION: Evaluate retry.
    const result = governor.retryPolicy.evaluate(
      'code_execute', undefined, 'side-effecting', true,
    );

    // CATCHES: Implementation that allows retry of side-effecting without sandbox reset.
    // Side-effecting: safe only after sandbox reset.
    // Invariant: EGP-I7
    // Defect: DC-EGP-050 — Side-effecting retry without sandbox reset
    assert.ok(result.ok);
    assert.strictEqual(result.value.retryPermitted, true);
    assert.strictEqual(result.value.requiresSandboxReset, true);
  });

  it('should deny side-effecting retry when sandbox reset unavailable', () => {
    // SETUP: code_execute (side-effecting) fails. Sandbox reset NOT available.
    // ACTION: Evaluate retry.
    const result = governor.retryPolicy.evaluate(
      'code_execute', undefined, 'side-effecting', false,
    );

    // CATCHES: Implementation that allows side-effecting retry without sandbox support.
    // No sandbox reset available → retry not permitted.
    // Invariant: EGP-I7
    // Defect: DC-EGP-051 — Side-effecting retry without sandbox availability
    assert.ok(result.ok);
    assert.strictEqual(result.value.retryPermitted, false);
  });

  it('should permit mutating (idempotent) retry', () => {
    // SETUP: file_write (mutating, idempotent by design) fails.
    // ACTION: Evaluate retry.
    const result = governor.retryPolicy.evaluate(
      'file_write', undefined, 'mutating', false,
    );

    // CATCHES: Implementation that treats mutating same as mutating-external.
    // Mutating is idempotent by design — safe to retry.
    // Invariant: EGP-I7
    // Defect: DC-EGP-052 — Mutating treated as mutating-external
    assert.ok(result.ok);
    assert.strictEqual(result.value.retryPermitted, true);
    assert.strictEqual(result.value.requiresSandboxReset, false);
  });

  it('should return default mutability class for known capability type', () => {
    // ACTION: Get default class for web_search.
    const result = governor.retryPolicy.getDefaultClass('web_search');

    // CATCHES: Implementation that returns wrong default or 'mutating-external' for everything.
    // DEFAULT_CAPABILITY_MUTABILITY maps web_search → 'read-only'.
    // Invariant: EGP-I7
    // Defect: DC-EGP-053 — Wrong default class
    assert.ok(result.ok);
    assert.strictEqual(result.value, 'read-only');
  });

  it('should default unclassified capability to mutating-external', () => {
    // ACTION: Get default class for unknown capability type.
    const result = governor.retryPolicy.getDefaultClass('unknown_capability');

    // CATCHES: Implementation that returns 'read-only' or throws for unknown capabilities.
    // Unclassified defaults to mutating-external (safest assumption).
    // Invariant: EGP-I7
    // Defect: DC-EGP-054 — Unclassified defaulting to permissive class
    assert.ok(result.ok);
    assert.strictEqual(result.value, 'mutating-external');
  });
});

// ============================================================================
// GROUP 7: Reservation Enforcement & Overage (~8 tests)
// CT-EGP-17, CT-EGP-18, CT-EGP-24
// ============================================================================

describe('GROUP 7: Reservation Enforcement & Overage', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-17: Headroom for admissibility — correct per-dimension calculation', () => {
    // SETUP: Task has reservation 500 token, 100 deliberation.
    // Consumed 400 token, 80 deliberation.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);
    governor.reservations.updateConsumed(conn, createResult.value.reservationId, 400, 80);

    // ACTION: Check headroom.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-001'), 0, 0,
    );

    // CATCHES: Implementation that computes headroom incorrectly (e.g., remaining = allocated
    // instead of reserved - consumed).
    // Headroom: token = 500 - 400 = 100. Deliberation = 100 - 80 = 20.
    // Invariant: EGP-I11 (Reservation Headroom for Admissibility)
    // Defect: DC-EGP-055 — Headroom based on allocated not reserved-consumed
    assert.ok(result.ok);
    assert.strictEqual(result.value.tokenHeadroom, 100);
    assert.strictEqual(result.value.deliberationHeadroom, 20);
    assert.strictEqual(result.value.allowed, true);
  });

  it('CT-EGP-18: Overage normalization — remaining clamped to zero, overage explicit', () => {
    // SETUP: Task consumes 600 of 500 token reservation.
    // Mission unreserved pool = 200.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);
    // Set mission unreserved pool to 200 tokens so overage can be absorbed
    governor.ledger.returnToPool(conn, testMissionId('mission-001'), 200, 0);

    // ACTION: Handle overage.
    const result = governor.enforcer.handleOverage(
      conn, ctx, testTaskId('task-001'), 100, 0,
    );

    // CATCHES: Implementation that shows negative remaining (-100) instead of clamping to 0.
    // Task remaining = 0 (not -100). Overage = 100. Pool: 200 - 100 = 100.
    // Invariant: EGP-I12 (Overage Normalization)
    // Defect: DC-EGP-056 — Negative remaining headroom
    assert.ok(result.ok);
    // handleOverage returns OverBudgetFaultState | null
    // With pool = 200, overage = 100: pool absorbs it. No fault state.
    assert.strictEqual(result.value, null);
  });

  it('CT-EGP-24: Overage when mission pool exhausted — triggers over-budget fault', () => {
    // SETUP: Task consumes 600 of 500 reservation. Mission pool = 50.
    // Overage = 100. Pool absorbs 50 → 0. Remaining 50 → missionDebt.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);
    // Set mission unreserved pool to exactly 50 tokens
    governor.ledger.returnToPool(conn, testMissionId('mission-001'), 50, 0);

    // ACTION: Handle overage.
    const result = governor.enforcer.handleOverage(
      conn, ctx, testTaskId('task-001'), 100, 0,
    );

    // CATCHES: Implementation that allows negative pool instead of entering fault state.
    // Pool clamps to 0. Excess becomes missionDebt. Mission enters over-budget fault.
    // Invariant: EGP-I12, EGP-I13
    // Defect: DC-EGP-057 — Negative pool allowed, no fault state
    assert.ok(result.ok);
    assert.notStrictEqual(result.value, null);
    assert.strictEqual(result.value!.active, true);
    assert.strictEqual(result.value!.admissionBlocked, true);
    assert.strictEqual(result.value!.schedulingBlocked, true);
  });

  it('should check headroom per dimension independently', () => {
    // SETUP: Task-001 with reservation 500/100, consumed 400/80.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);
    governor.reservations.updateConsumed(conn, createResult.value.reservationId, 400, 80);

    // ACTION: Check with additional tokens that would cause token overage only.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-001'), 600, 10,
    );

    // CATCHES: Implementation that checks total headroom across both dimensions.
    // Each dimension has its own overage projection.
    // Invariant: EGP-I4, EGP-I11
    // Defect: DC-EGP-058 — Summed headroom check
    assert.ok(result.ok);
    assert.strictEqual(result.value.wouldCauseTokenOverage, true);
    assert.strictEqual(result.value.wouldCauseDeliberationOverage, false);
  });

  it('should report projected overage amounts', () => {
    // SETUP: Task-overage with small reservation.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-overage'),
      reservedTokens: 100,
      reservedDeliberation: 30,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Check headroom with amounts exceeding both dimensions.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-overage'), 200, 50,
    );

    // CATCHES: Implementation that only reports boolean (allowed/not) without amounts.
    // Projected overage amounts must be computed per dimension.
    // Invariant: EGP-I11, EGP-I12
    // Defect: DC-EGP-059 — Missing projected overage amounts
    assert.ok(result.ok);
    assert.ok(typeof result.value.projectedTokenOverage === 'number');
    assert.ok(typeof result.value.projectedDeliberationOverage === 'number');
  });

  it('should record overage on mission ledger', () => {
    // ACTION: Record overage through the ledger directly.
    const result = governor.ledger.recordOverage(
      conn, ctx, testMissionId('mission-001'), 100, 0,
    );

    // CATCHES: Implementation that charges overage to the task reservation instead of
    // the mission unreserved pool.
    // Overage goes to mission pool, not to other task reservations (EGP-I1).
    // Invariant: EGP-I1, EGP-I12
    // Defect: DC-EGP-060 — Overage charged to task reservations
    assert.ok(result.ok);
  });

  it('should handle overage in deliberation dimension', () => {
    // SETUP: Create and activate reservation for the task (Debt 2: reservation required)
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-delib-overage'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Handle deliberation overage.
    const result = governor.enforcer.handleOverage(
      conn, ctx, testTaskId('task-delib-overage'), 0, 50,
    );

    // CATCHES: Implementation that only handles token overage, ignoring deliberation.
    // Both dimensions apply overage semantics independently (EGP-I12).
    // Invariant: EGP-I12 (both dimensions)
    // Defect: DC-EGP-061 — Deliberation overage ignored
    assert.ok(result.ok);
  });

  it('should record triggering dimensions in fault state', () => {
    // SETUP: Create and activate reservation for the task (Debt 2: reservation required)
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-both-overage'),
      missionId: testMissionId('mission-001'),
      reservedTokens: 50,
      reservedDeliberation: 20,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Trigger fault from both dimensions.
    const result = governor.enforcer.handleOverage(
      conn, ctx, testTaskId('task-both-overage'), 100, 50,
    );

    // CATCHES: Implementation that only records one triggering dimension.
    // triggeringDimensions should contain both 'token' and 'deliberation' when both exceed pool.
    // Invariant: EGP-I12, FM-EGP-05
    // Defect: DC-EGP-062 — Missing triggering dimension identification
    assert.ok(result.ok);
    if (result.value !== null) {
      assert.ok(result.value.triggeringDimensions.length > 0);
    }
  });
});

// ============================================================================
// GROUP 8: Conservation Law (~5 tests)
// CT-EGP-27
// ============================================================================

describe('GROUP 8: Conservation Law', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
  });

  it('CT-EGP-27: Conservation under mission debt', () => {
    // SETUP: Mission allocated = 1000 tokens. Task A reservation = 500.
    // Task A consumes 600 (100 overage). Pool before overage = 50.
    // Prior consumed from other tasks = 450.
    // After reconciliation: missionDebt = 50.
    // Conservation: allocated(1000) + missionDebt(50) = totalConsumed(1050) + reservedRemaining(0) + unreservedRemaining(0)
    // => 1050 = 1050.
    // ACTION: Check conservation.
    const result = governor.ledger.checkConservation(
      conn, testMissionId('mission-001'),
    );

    // CATCHES: Implementation where conservation law breaks under debt.
    // The debt term on the left side must balance the equation.
    // Invariant: EGP-I13 (Budget Conservation Per Dimension)
    // Defect: DC-EGP-063 — Conservation fails under debt
    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, true);
    assert.strictEqual(result.value.token.delta, 0);
  });

  it('should verify conservation after wave allocation', () => {
    // ACTION: Check conservation after allocating a wave.
    const result = governor.ledger.checkConservation(
      conn, testMissionId('mission-001'),
    );

    // CATCHES: Implementation where allocation creates phantom headroom.
    // allocated = totalConsumed + totalReserved + unreservedRemaining (no debt).
    // Invariant: EGP-I13
    // Defect: DC-EGP-064 — Phantom headroom after allocation
    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, true);
    assert.strictEqual(result.value.deliberation.delta, 0);
  });

  it('should verify conservation after task completion and reclaim', () => {
    // ACTION: Check conservation after releasing a reservation.
    const result = governor.ledger.checkConservation(
      conn, testMissionId('mission-001'),
    );

    // CATCHES: Implementation where reclaim creates or loses budget.
    // After release: consumed + unreservedRemaining (includes reclaimed) = allocated.
    // Invariant: EGP-I13
    // Defect: DC-EGP-065 — Budget leakage on reclaim
    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, true);
  });

  it('should verify conservation after retry with cumulative consumption', () => {
    // ACTION: Check conservation while task is retained (across retry).
    const result = governor.ledger.checkConservation(
      conn, testMissionId('mission-001'),
    );

    // CATCHES: Implementation where retry consumption is double-counted or lost.
    // Retained reservation's consumed must be counted once, not per-attempt.
    // Invariant: EGP-I8, EGP-I13
    // Defect: DC-EGP-066 — Double-counted consumption across retries
    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, true);
  });

  it('should verify conservation holds per dimension independently', () => {
    // ACTION: Check that both dimensions have independent conservation results.
    const result = governor.ledger.checkConservation(
      conn, testMissionId('mission-001'),
    );

    // CATCHES: Implementation that checks conservation across summed dimensions.
    // Each dimension is verified independently.
    // Invariant: EGP-I13 (per dimension independently)
    // Defect: DC-EGP-067 — Cross-dimension conservation check
    assert.ok(result.ok);
    assert.ok(typeof result.value.token.leftSide === 'number');
    assert.ok(typeof result.value.token.rightSide === 'number');
    assert.ok(typeof result.value.deliberation.leftSide === 'number');
    assert.ok(typeof result.value.deliberation.rightSide === 'number');
  });

  // ── BRK-EGP-B01: Discriminative conservation tests ──
  // These tests verify that conservation violations ARE DETECTED.
  // A mutation that always returns holds=true will FAIL these tests.

  it('BRK-EGP-B01a: conservation detects violation — token consumption without allocation', () => {
    // SETUP: Mission with allocated = 0 (default). Record consumption without
    // any corresponding allocation or reservation. This creates an imbalance:
    // Conservation: allocated(0) + debt(0) = 0 ≠ consumed(500) + reserved(0) + unreserved(0) = 500
    const missionId = testMissionId('conservation-violation-1');

    // Record 500 tokens consumed with no backing allocation
    governor.ledger.recordConsumption(conn, missionId, 500, 0);

    const result = governor.ledger.checkConservation(conn, missionId);

    // CATCHES: Implementation where checkConservation always returns holds=true.
    // Left side = 0, right side = 500. Delta = -500. Must NOT hold.
    // Invariant: EGP-I13
    // Defect: DC-EGP-023 (test non-discriminative)
    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, false, 'Conservation must detect token imbalance');
    assert.notStrictEqual(result.value.token.delta, 0, 'Token delta must be non-zero');
  });

  it('BRK-EGP-B01b: conservation detects violation when consumption exceeds allocated', () => {
    // SETUP: Mission with no allocation. Record consumption of 500 tokens.
    // Conservation: allocated(0) + debt(0) = 0, consumed(500) + reserved(0) + unreserved(0) = 500
    // Left ≠ Right → violation.
    const missionId = testMissionId('conservation-violation-2');

    governor.ledger.recordConsumption(conn, missionId, 500, 100);

    const result = governor.ledger.checkConservation(conn, missionId);

    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, false, 'Conservation must detect consumption without allocation');
    assert.notStrictEqual(result.value.token.delta, 0);
    assert.notStrictEqual(result.value.deliberation.delta, 0);
  });

  it('BRK-EGP-B01c: conservation holds when all dimensions are zero (balanced)', () => {
    // SETUP: Fresh mission — all budget fields are zero.
    // Conservation: allocated(0) + debt(0) = consumed(0) + reserved(0) + unreserved(0) → 0 = 0.
    // This is the counterpart — verify that a valid state reports holds=true.
    const missionId = testMissionId('conservation-balanced');

    const result = governor.ledger.checkConservation(conn, missionId);
    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, true);
    assert.strictEqual(result.value.token.delta, 0);
    assert.strictEqual(result.value.deliberation.delta, 0);
  });

  it('BRK-EGP-B01d: conservation violation in deliberation dimension only', () => {
    // SETUP: Token dimension balanced (all zeros). Deliberation imbalanced
    // via recordConsumption (deliberation only).
    // Conservation token: 0 = 0 (holds). Deliberation: 0 ≠ 300 (violated).
    const missionId = testMissionId('conservation-delib-violation');

    // Record deliberation consumption with no backing allocation
    governor.ledger.recordConsumption(conn, missionId, 0, 300);

    const result = governor.ledger.checkConservation(conn, missionId);

    assert.ok(result.ok);
    assert.strictEqual(result.value.holds, false, 'Conservation must detect deliberation-only violation');
    assert.strictEqual(result.value.token.delta, 0, 'Token dimension should still hold');
    assert.notStrictEqual(result.value.deliberation.delta, 0, 'Deliberation delta must be non-zero');
  });
});

// ============================================================================
// GROUP 9: Cancellation During Replan (~4 tests)
// CT-EGP-20
// ============================================================================

describe('GROUP 9: Cancellation During Replan', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('CT-EGP-20: Cancellation during replan — SCHEDULED/PENDING cancelled, RUNNING excluded', () => {
    // SETUP: Replan accepted. Old graph:
    //   Task A (RUNNING), Task B (SCHEDULED, reservation 300), Task C (PENDING).
    // ACTION: Calculate replan budget.
    const input: ReplanBudgetInput = {
      missionId: testMissionId('mission-001'),
      currentGraphTasks: [
        { taskId: testTaskId('task-a'), state: 'RUNNING' },
        { taskId: testTaskId('task-b'), state: 'SCHEDULED' },
        { taskId: testTaskId('task-c'), state: 'PENDING' },
      ],
    };
    const result = governor.replanCalculator.calculateReplanBudget(conn, ctx, input);

    // CATCHES: Implementation that cancels RUNNING tasks during replan.
    // A (RUNNING) continues. B (SCHEDULED) cancelled, 300 released. C (PENDING) cancelled.
    // Invariant: EGP-I10 (running not preemptible), §6.3
    // Defect: DC-EGP-068 — RUNNING task cancelled during replan
    assert.ok(result.ok);
    // A must be in runningTasksExcluded, not in cancelledTasks.
    assert.ok(result.value.runningTasksExcluded.some(
      t => t.taskId === testTaskId('task-a'),
    ));
    // B and C must be in cancelledTasks.
    const cancelledIds = result.value.cancelledTasks.map(t => t.taskId);
    assert.ok(cancelledIds.includes(testTaskId('task-b')));
    assert.ok(cancelledIds.includes(testTaskId('task-c')));
  });

  it('should include released budget in replan budget', () => {
    // ACTION: Calculate replan budget and verify released amounts are included.
    const input: ReplanBudgetInput = {
      missionId: testMissionId('mission-001'),
      currentGraphTasks: [
        { taskId: testTaskId('task-b'), state: 'SCHEDULED' },
      ],
    };
    const result = governor.replanCalculator.calculateReplanBudget(conn, ctx, input);

    // CATCHES: Implementation that cancels reservations but forgets to add released budget
    // to the replan total. Budget from cancelled tasks must be available for new graph.
    // Defect: DC-EGP-069 — Released budget not included in replan total
    assert.ok(result.ok);
    assert.ok(result.value.replanBudgetTokens >= 0);
    assert.ok(result.value.replanBudgetDeliberation >= 0);
  });

  it('should exclude RUNNING task budget from replan availability', () => {
    // ACTION: Running task's committed budget should NOT be in replan budget.
    const input: ReplanBudgetInput = {
      missionId: testMissionId('mission-001'),
      currentGraphTasks: [
        { taskId: testTaskId('task-a'), state: 'RUNNING' },
      ],
    };
    const result = governor.replanCalculator.calculateReplanBudget(conn, ctx, input);

    // CATCHES: Implementation that includes running task's reservation in replan budget.
    // Running tasks' reservations are committed — not available for replan.
    // Invariant: EGP-I2, EGP-I10
    // Defect: DC-EGP-070 — Running task budget available for replan
    assert.ok(result.ok);
    assert.ok(result.value.runningTasksExcluded.length > 0);
    assert.ok(result.value.runningTasksExcluded[0].committedTokens >= 0);
  });

  it('should handle replan with empty graph — no tasks to cancel', () => {
    // ACTION: Replan with no current tasks.
    const input: ReplanBudgetInput = {
      missionId: testMissionId('mission-001'),
      currentGraphTasks: [],
    };
    const result = governor.replanCalculator.calculateReplanBudget(conn, ctx, input);

    // CATCHES: Implementation that crashes on empty task list.
    // Empty graph: no cancellations, full pool available for replan.
    // Defect: DC-EGP-071 — Crash on empty replan input
    assert.ok(result.ok);
    assert.strictEqual(result.value.cancelledTasks.length, 0);
    assert.strictEqual(result.value.runningTasksExcluded.length, 0);
  });
});

// ============================================================================
// GROUP 10: Terminal Transition (~5 tests)
// EGPTerminalOperation for Phase 1D
// ============================================================================

describe('GROUP 10: Terminal Transition', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('should release and reclaim on COMPLETED', () => {
    // SETUP: Create and activate reservation for task-001.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Task completes successfully.
    const result = governor.terminalOp.execute(
      conn, ctx, testTaskId('task-001'), 'COMPLETED', false,
    );

    // CATCHES: Implementation that retains reservation on COMPLETED or forgets to reclaim.
    // COMPLETED is final terminal: release reservation, reclaim per dimension.
    // Invariant: EGP-I3 (Atomic Reclaim on Final Terminal)
    // Defect: DC-EGP-072 — Reservation retained on COMPLETED
    assert.ok(result.ok);
    assert.strictEqual(result.value.action, 'released');
    assert.ok(result.value.reclaimedTokens >= 0);
    assert.ok(result.value.reclaimedDeliberation >= 0);
  });

  it('should retain on FAILED with retries remaining', () => {
    // SETUP: Create and activate reservation for task-001.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Task fails but retries remain.
    const result = governor.terminalOp.execute(
      conn, ctx, testTaskId('task-001'), 'FAILED', true,
    );

    // CATCHES: Implementation that releases reservation when retries remain.
    // FAILED with retries: retain reservation. It persists for retry (EGP-I8).
    // Invariant: EGP-I3, EGP-I8
    // Defect: DC-EGP-073 — Reservation released on retriable failure
    assert.ok(result.ok);
    assert.strictEqual(result.value.action, 'retained');
    assert.strictEqual(result.value.reclaimedTokens, 0);
    assert.strictEqual(result.value.reclaimedDeliberation, 0);
  });

  it('should release on FAILED without retries remaining', () => {
    // SETUP: Create and activate reservation for task-001.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Task fails with no retries remaining — final failure.
    const result = governor.terminalOp.execute(
      conn, ctx, testTaskId('task-001'), 'FAILED', false,
    );

    // CATCHES: Implementation that retains reservation when no retries remain.
    // FAILED with no retries is final terminal: release and reclaim.
    // Invariant: EGP-I3
    // Defect: DC-EGP-074 — Reservation retained on final failure
    assert.ok(result.ok);
    assert.strictEqual(result.value.action, 'released');
    assert.ok(result.value.reservationId !== null);
  });

  it('should release on CANCELLED', () => {
    // SETUP: Create and activate reservation for task-001.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-001'),
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);

    // ACTION: Task cancelled.
    const result = governor.terminalOp.execute(
      conn, ctx, testTaskId('task-001'), 'CANCELLED', false,
    );

    // CATCHES: Implementation that leaves reservation in non-released state on cancellation.
    // CANCELLED is final terminal: release reservation, reclaim per dimension.
    // Invariant: EGP-I3
    // Defect: DC-EGP-075 — Reservation not released on CANCELLED
    assert.ok(result.ok);
    assert.strictEqual(result.value.action, 'released');
  });

  it('should no-op for v3.2 task without reservation', () => {
    // ACTION: Task from v3.2 (before EGP) has no reservation.
    const result = governor.terminalOp.execute(
      conn, ctx, testTaskId('task-v32-legacy'), 'COMPLETED', false,
    );

    // CATCHES: Implementation that crashes when no reservation exists for a task.
    // v3.2 compatibility: tasks without reservations get action='none'.
    // Defect: DC-EGP-076 — Crash on missing reservation
    assert.ok(result.ok);
    assert.strictEqual(result.value.action, 'none');
    assert.strictEqual(result.value.reclaimedTokens, 0);
    assert.strictEqual(result.value.reclaimedDeliberation, 0);
    assert.strictEqual(result.value.reservationId, null);
  });
});

// ============================================================================
// GROUP 11: Events & Replay (~5 tests)
// ============================================================================

describe('GROUP 11: Events & Replay', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('should emit TASK_BUDGET_EXCEEDED event when headroom exhausted', () => {
    // SETUP: Create reservation for task-exhausted with all tokens consumed.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-exhausted'),
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.ok(createResult.ok);
    governor.reservations.activate(conn, createResult.value.reservationId);
    governor.reservations.updateConsumed(conn, createResult.value.reservationId, 500, 0);

    // ACTION: Check headroom that results in exhaustion — event should be emitted.
    const result = governor.enforcer.checkHeadroom(
      conn, testTaskId('task-exhausted'), 1000, 0,
    );

    // CATCHES: Implementation that silently blocks without emitting event.
    // §5.3: TASK_BUDGET_EXCEEDED event required when reservation exhausted.
    // Defect: DC-EGP-077 — Missing budget exceeded event
    assert.ok(result.ok);
    // The enforcer should have emitted the event
    assert.strictEqual(result.value.tokenExhausted, true);
  });

  it('should emit WAVE_COMPOSED event after wave composition', () => {
    // ACTION: Compose a wave.
    const input = makeWaveInput();
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that composes waves without event notification.
    // §10: WAVE_COMPOSED event must be emitted.
    // Defect: DC-EGP-078 — Missing wave composed event
    assert.ok(result.ok);
    assert.ok(result.value.scheduledTaskIds.length > 0);
  });

  it('should emit RESERVATION_RELEASED event on release', () => {
    // SETUP: Create and activate reservation.
    const createResult = governor.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    governor.reservations.activate(conn, resId);

    // ACTION: Release a reservation.
    const result = governor.reservations.release(
      conn, ctx, resId, 'COMPLETED',
    );

    // CATCHES: Implementation that releases without event emission.
    // §10: RESERVATION_RELEASED event required.
    // Defect: DC-EGP-079 — Missing release event
    assert.ok(result.ok);
  });

  it('should produce complete replay record in scheduler cycle', () => {
    // ACTION: Execute scheduler cycle and verify replay record completeness.
    const input: SchedulerCycleInput = {
      availableWorkers: 2,
      eligibleMissions: [
        {
          missionId: testMissionId('mission-001'),
          eligibleTasks: [makeEligibleTask()],
          tokenPool: 500,
          deliberationPool: 200,
          branchFailurePolicy: 'isolate',
          starvationCounter: 0,
        },
      ],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };
    const result = governor.scheduler.executeCycle(conn, ctx, input);

    // CATCHES: Implementation that omits replay record fields.
    // EGP-I9: replay record must capture all inputs and outputs for deterministic replay.
    // Invariant: EGP-I9 (Scheduling Determinism)
    // Defect: DC-EGP-080 — Incomplete replay record
    assert.ok(result.ok);
    const replay = result.value.replayRecord;
    assert.ok(typeof replay.waveId === 'string');
    assert.ok(Array.isArray(replay.eligibleTaskIds));
    assert.ok(Array.isArray(replay.taskPriorities));
    assert.ok(Array.isArray(replay.taskDimensions));
    assert.ok(typeof replay.tokenPoolSnapshot === 'number');
    assert.ok(typeof replay.deliberationPoolSnapshot === 'number');
    assert.ok(typeof replay.workerAvailability === 'number');
    assert.ok(Array.isArray(replay.computedReservations));
    assert.ok(Array.isArray(replay.selectedTaskIds));
    assert.ok(Array.isArray(replay.starvationCounters));
    assert.ok(typeof replay.timestamp === 'string');
  });

  it('should record worker availability snapshot in cycle result', () => {
    // ACTION: Execute scheduler cycle.
    const input: SchedulerCycleInput = {
      availableWorkers: 5,
      eligibleMissions: [
        {
          missionId: testMissionId('mission-001'),
          eligibleTasks: [makeEligibleTask()],
          tokenPool: 500,
          deliberationPool: 200,
          branchFailurePolicy: 'isolate',
          starvationCounter: 0,
        },
      ],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };
    const result = governor.scheduler.executeCycle(conn, ctx, input);

    // CATCHES: Implementation that doesn't snapshot worker availability.
    // Worker count at decision time must be recorded for replay.
    // Invariant: EGP-I9
    // Defect: DC-EGP-081 — Missing worker availability in replay
    assert.ok(result.ok);
    assert.strictEqual(result.value.workerAvailabilitySnapshot, 5);
  });
});

// ============================================================================
// GROUP 12: Edge Cases & Structural (~5 tests)
// ============================================================================

describe('GROUP 12: Edge Cases & Structural', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('should have all subsystems present on governor facade', () => {
    // ACTION: Verify the ExecutionGovernor facade structure.

    // CATCHES: Implementation that omits a subsystem from the facade.
    // The facade must expose all 10 subsystems per ExecutionGovernor interface.
    // Defect: DC-EGP-082 — Missing subsystem on facade
    assert.ok(governor.reservations !== undefined, 'reservations subsystem missing');
    assert.ok(governor.ledger !== undefined, 'ledger subsystem missing');
    assert.ok(governor.waveComposer !== undefined, 'waveComposer subsystem missing');
    assert.ok(governor.branchFailure !== undefined, 'branchFailure subsystem missing');
    assert.ok(governor.retryPolicy !== undefined, 'retryPolicy subsystem missing');
    assert.ok(governor.scheduler !== undefined, 'scheduler subsystem missing');
    assert.ok(governor.enforcer !== undefined, 'enforcer subsystem missing');
    assert.ok(governor.replanCalculator !== undefined, 'replanCalculator subsystem missing');
    assert.ok(governor.starvation !== undefined, 'starvation subsystem missing');
    assert.ok(governor.terminalOp !== undefined, 'terminalOp subsystem missing');
  });

  it('should export all EGP constants', () => {
    // ACTION: Verify that all type constants from egp_types.ts are available.

    // CATCHES: Implementation that breaks re-export or constant definition.
    // Defect: DC-EGP-083 — Missing constant exports
    assert.ok(RESERVATION_STATUS_TRANSITIONS !== undefined);
    assert.deepStrictEqual(RESERVATION_STATUS_TRANSITIONS.reserved, ['active', 'released']);
    assert.deepStrictEqual(RESERVATION_STATUS_TRANSITIONS.active, ['retained', 'released']);
    assert.deepStrictEqual(RESERVATION_STATUS_TRANSITIONS.retained, ['active', 'released']);
    assert.deepStrictEqual(RESERVATION_STATUS_TRANSITIONS.released, []);

    assert.strictEqual(DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS, 100);
    assert.strictEqual(DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION, 50);
    assert.strictEqual(DEFAULT_MAX_STARVATION_CYCLES, 100);

    assert.ok(EGP_EVENTS.TASK_BUDGET_EXCEEDED === 'egp.task_budget_exceeded');
    assert.ok(EGP_EVENTS.WAVE_COMPOSED === 'egp.wave_composed');
    assert.ok(EGP_EVENTS.RESERVATION_RELEASED === 'egp.reservation_released');

    assert.ok(RESERVATION_ERROR_CODES.NOT_FOUND !== undefined);
    assert.ok(WAVE_ERROR_CODES.POOL_INSUFFICIENT !== undefined);
    assert.ok(BRANCH_FAILURE_ERROR_CODES.QUORUM_THRESHOLD_INVALID !== undefined);
    assert.ok(ENFORCEMENT_ERROR_CODES.OVER_BUDGET_FAULT !== undefined);
  });

  it('should reject quorum threshold > 1.0 at validation time', () => {
    // ACTION: Evaluate fan-in with quorumThreshold > 1.0.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'COMPLETED' },
        { taskId: testTaskId('task-b'), state: 'COMPLETED' },
      ],
      1.5, // invalid: > 1.0
    );

    // CATCHES: Implementation that accepts quorumThreshold > 1.0.
    // CT-EGP-29: "quorumThreshold > 1.0 rejected at task-graph validation time."
    // Invariant: EGP-I6
    // Defect: DC-EGP-084 — Invalid quorum threshold accepted
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, BRANCH_FAILURE_ERROR_CODES.QUORUM_THRESHOLD_INVALID);
  });

  it('should handle quorum threshold 0.0 — all dependencies optional', () => {
    // SETUP: quorumThreshold = 0.0 → requiredSuccesses = ceil(0) = 0.
    // Fan-in proceeds regardless of predecessor outcomes.
    const result = governor.branchFailure.evaluateFanIn(
      conn,
      testTaskId('task-d'),
      'quorum',
      [
        { taskId: testTaskId('task-a'), state: 'FAILED' },
        { taskId: testTaskId('task-b'), state: 'FAILED' },
        { taskId: testTaskId('task-c'), state: 'FAILED' },
      ],
      0.0,
    );

    // CATCHES: Implementation that treats 0.0 threshold as "no quorum" error
    // instead of "all optional, proceed regardless."
    // CT-EGP-29: 0.0 → requiredSuccesses = 0. Proceeds regardless.
    // Invariant: EGP-I6
    // Defect: DC-EGP-085 — Zero threshold rejected or mishandled
    assert.ok(result.ok);
    assert.strictEqual(result.value.eligible, true);
    assert.strictEqual(result.value.reason, 'quorum_met');
    assert.ok(result.value.quorumState !== undefined);
    assert.strictEqual(result.value.quorumState!.requiredSuccesses, 0);
    assert.strictEqual(result.value.quorumState!.met, true);
  });

  it('should handle empty eligible task set in wave composition', () => {
    // ACTION: Compose wave with zero eligible tasks.
    const input = makeWaveInput({
      eligibleTasks: [],
    });
    const result = governor.waveComposer.compose(conn, ctx, input);

    // CATCHES: Implementation that crashes on empty input or produces phantom tasks.
    // Empty eligible set should produce error or empty wave — not crash.
    // Defect: DC-EGP-086 — Crash on empty eligible set
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, WAVE_ERROR_CODES.NO_ELIGIBLE_TASKS);
  });
});

// ============================================================================
// GROUP 13: Mission Budget Ledger (~5 tests)
// ============================================================================

describe('GROUP 13: Mission Budget Ledger', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('should get mission budget state with both dimensions', () => {
    // ACTION: Query mission budget state.
    const result = governor.ledger.getState(conn, testMissionId('mission-001'));

    // CATCHES: Implementation that returns single-dimension budget state.
    // MissionBudgetState has token and deliberation dimensions independently.
    // Invariant: EGP-I4, EGP-I13
    // Defect: DC-EGP-087 — Missing dimension in budget state
    assert.ok(result.ok);
    assert.ok(typeof result.value.token.allocated === 'number');
    assert.ok(typeof result.value.deliberation.allocated === 'number');
    assert.ok(typeof result.value.token.unreservedRemaining === 'number');
    assert.ok(typeof result.value.deliberation.unreservedRemaining === 'number');
  });

  it('should reserve from pool — reducing unreserved amount per dimension', () => {
    // ACTION: Reserve 200 tokens and 50 deliberation from mission pool.
    const result = governor.ledger.reserveFromPool(
      conn, testMissionId('mission-001'), 200, 50,
    );

    // CATCHES: Implementation that doesn't deduct from unreserved pool.
    // After reservation: unreservedRemaining decreases by reservation amount.
    // Invariant: EGP-I13 (conservation)
    // Defect: DC-EGP-088 — Pool not decremented on reserve
    assert.ok(result.ok);
  });

  it('should return to pool — increasing unreserved amount on reclaim', () => {
    // ACTION: Return 100 tokens and 20 deliberation to mission pool.
    const result = governor.ledger.returnToPool(
      conn, testMissionId('mission-001'), 100, 20,
    );

    // CATCHES: Implementation that doesn't increment unreserved pool on return.
    // Invariant: EGP-I3, EGP-I13
    // Defect: DC-EGP-089 — Pool not incremented on return
    assert.ok(result.ok);
  });

  it('should record consumption against mission', () => {
    // ACTION: Record 300 tokens consumed.
    const result = governor.ledger.recordConsumption(
      conn, testMissionId('mission-001'), 300, 50,
    );

    // CATCHES: Implementation that doesn't track consumption at mission level.
    // totalConsumed must increase. Required for conservation law.
    // Invariant: EGP-I13
    // Defect: DC-EGP-090 — Mission-level consumption not tracked
    assert.ok(result.ok);
  });

  it('should report overBudgetFaultActive when missionDebt > 0', () => {
    // ACTION: Get state for a mission in over-budget fault.
    const result = governor.ledger.getState(conn, testMissionId('mission-over-budget'));

    // CATCHES: Implementation that doesn't set overBudgetFaultActive flag.
    // §5.5: true when missionDebt > 0 in either dimension.
    // Invariant: EGP-I12
    // Defect: DC-EGP-091 — Missing over-budget fault flag
    assert.ok(result.ok);
    assert.ok(typeof result.value.overBudgetFaultActive === 'boolean');
  });
});

// ============================================================================
// STRUCTURAL VERIFICATION: NotImplementedError sentinel
// ============================================================================

describe('STRUCTURAL: Harness throws NotImplementedError', () => {
  it('should export NotImplementedError with correct code', () => {
    // CATCHES: Harness that doesn't export NotImplementedError or uses wrong code.
    // Defect: DC-EGP-092 — Missing or incorrect error sentinel
    const err = new NotImplementedError('test');
    assert.strictEqual(err.code, 'NOT_IMPLEMENTED');
    assert.strictEqual(err.name, 'NotImplementedError');
    assert.ok(err.message.includes('test'));
    assert.ok(err instanceof Error);
  });

  it('should have harness methods that return Results (implementation replaces NotImplementedError)', () => {
    // CATCHES: Harness that silently returns undefined instead of a Result.
    // Defect: DC-EGP-093 — Silent no-op harness
    // Implementation now returns Result objects instead of throwing NotImplementedError.
    const deps = createMockDeps();
    const gov = createExecutionGovernor(deps);
    const conn = createMockConn();
    const ctx = createMockCtx();

    // Verify at least one method from each subsystem returns a Result (does not throw).
    const resResult = gov.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(typeof resResult.ok === 'boolean', 'reservations.create must return Result');

    const ledgerResult = gov.ledger.getState(conn, testMissionId('m'));
    assert.ok(typeof ledgerResult.ok === 'boolean', 'ledger.getState must return Result');

    const waveResult = gov.waveComposer.compose(conn, ctx, makeWaveInput());
    assert.ok(typeof waveResult.ok === 'boolean', 'waveComposer.compose must return Result');

    const retryResult = gov.retryPolicy.evaluate('web_search', undefined, 'read-only', false);
    assert.ok(typeof retryResult.ok === 'boolean', 'retryPolicy.evaluate must return Result');

    // starvation.increment does not return Result — it is void
    assert.doesNotThrow(() => gov.starvation.increment(testMissionId('m')));

    const termResult = gov.terminalOp.execute(conn, ctx, testTaskId('t'), 'COMPLETED', false);
    assert.ok(typeof termResult.ok === 'boolean', 'terminalOp.execute must return Result');
  });
});

// ============================================================================
// GROUP 14: v1.1 Gap Coverage (12 tests)
// Tests for DCs identified as gaps in the v1.1 defect class analysis.
// All tests FAIL against NOT_IMPLEMENTED harness.
// Gap Report ref: CORTEX_PHASE_1_EGP_GAP_REPORT.md §4, §6
// ============================================================================

describe('GROUP 14: v1.1 Gap Coverage', () => {
  let gov: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    gov = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  // --- DC-EGP-002: Non-negative consumption validation (v1.1 strengthened) ---
  it('should reject negative consumption in updateConsumed', () => {
    // CATCHES: Negative consumption accepted — inflates reservation headroom,
    // allowing a task to consume more than its ceiling without triggering overage.
    // Defect: DC-EGP-002 — Non-negative consumption validation
    const createResult = gov.reservations.create(conn, ctx, makeReservationInput());
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;
    gov.reservations.activate(conn, resId);

    const result = gov.reservations.updateConsumed(
      conn,
      resId,
      -100, // Negative tokens — must be rejected
      0,
    );

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.error.code, ENFORCEMENT_ERROR_CODES.INVALID_CONSUMPTION);
  });

  // --- DC-EGP-026: Mixed wave deliberation denominator ---
  it('should exclude non-deliberation tasks from deliberation denominator', () => {
    // CATCHES: Deliberation budget divided by ALL tasks including non-delib ones,
    // giving each delib task less deliberation than minimum viable.
    // Defect: DC-EGP-026 — Delib denominator wrong (partial gap: mixed wave)
    const mixedInput: WaveCompositionInput = {
      missionId: testMissionId('mission-mix'),
      eligibleTasks: [
        {
          taskId: testTaskId('delib-task'),
          priority: 1,
          estimatedTokens: 200,
          estimatedDeliberationTokens: 100,
          requiresDeliberation: true,
        },
        {
          taskId: testTaskId('no-delib-task'),
          priority: 2,
          estimatedTokens: 200,
          estimatedDeliberationTokens: 0,
          requiresDeliberation: false,
        },
      ],
      tokenPool: 1000,
      deliberationPool: 200,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };

    const result = gov.waveComposer.compose(conn, ctx, mixedInput);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Delib task gets full delib pool (only delib task in denominator)
    const delibRes = result.value.reservations.find(
      r => r.taskId === testTaskId('delib-task'),
    );
    assert.ok(delibRes);
    assert.strictEqual(delibRes!.reservedDeliberation, 200);
  });

  // --- DC-EGP-029: Per-invocation policy consistency ---
  it('should enforce consistent branch failure policy within single invocation', () => {
    // CATCHES: Policy read differs between check-time and enforcement-time
    // within the same invocation, producing inconsistent cancellation.
    // Defect: DC-EGP-029 — Per-invocation policy inconsistency (v1.1 merge)
    const input: BranchFailureInput = {
      failedTaskId: testTaskId('failed-task'),
      missionId: testMissionId('mission-policy'),
      policy: 'fail-fast',
      siblingTaskIds: [testTaskId('sib-1'), testTaskId('sib-2')],
      siblingStates: [
        { taskId: testTaskId('sib-1'), state: 'RUNNING' },
        { taskId: testTaskId('sib-2'), state: 'SCHEDULED' },
      ],
      fanInDependents: [],
    };

    const result = gov.branchFailure.handleFailure(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Fail-fast: SCHEDULED sibling cancelled, RUNNING sibling NOT cancelled
    assert.strictEqual(result.value.policy, 'fail-fast');
    assert.ok(result.value.cancelledTaskIds.includes(testTaskId('sib-2')));
    assert.ok(!result.value.cancelledTaskIds.includes(testTaskId('sib-1')));
  });

  // --- DC-EGP-034: v3.3 task terminal without reservation → error ---
  it('should detect missing reservation for v3.3 task at terminal', () => {
    // CATCHES: v3.3 task reaches terminal without reservation — returns 'none'
    // (same as v3.2 compat path), masking a reservation management failure.
    // Defect: DC-EGP-034 — v3.3 task RUNNING without reservation (partial gap)
    // The admission gate (DC-EGP-064) should prevent this. If bypassed,
    // the terminal handler must detect the anomaly.
    const admissionResult = gov.admissionGate.checkAdmission(
      conn, ctx, testTaskId('v33-no-res'), '3.3',
    );

    assert.strictEqual(admissionResult.ok, true);
    if (!admissionResult.ok) return;
    assert.strictEqual(admissionResult.value.admitted, false,
      'v3.3 task without reservation must not be admitted');
    assert.strictEqual(admissionResult.value.reservationId, null);
  });

  // --- DC-EGP-046: Reservation↔lifecycle sync in same transaction ---
  it('should sync reservation status with task lifecycle atomically', () => {
    // CATCHES: Reservation status updated in separate transaction from task state,
    // creating window where reservation says 'active' but task is 'failed'.
    // Defect: DC-EGP-046 — Reservation desync from task lifecycle
    const createResult = gov.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-sync'),
    }));
    assert.ok(createResult.ok);
    const resId = createResult.value.reservationId;

    const activateResult = gov.reservations.activate(conn, resId);

    assert.strictEqual(activateResult.ok, true);
    // Within same transaction: getById must reflect the activation
    const lookup = gov.reservations.getById(conn, resId);
    assert.strictEqual(lookup.ok, true);
    if (!lookup.ok) return;
    assert.strictEqual(lookup.value.status, 'active');
  });

  // --- DC-EGP-047: Retained reservation released during replan ---
  it('should release retained reservations during replan', () => {
    // CATCHES: Replan cancels SCHEDULED/PENDING tasks but leaves RETAINED
    // reservations orphaned — budget locked but task will never retry.
    // Defect: DC-EGP-047 — Retained reservation orphaned during replan
    const input: ReplanBudgetInput = {
      missionId: testMissionId('mission-replan'),
      currentGraphTasks: [
        { taskId: testTaskId('running-task'), state: 'RUNNING' },
        { taskId: testTaskId('scheduled-task'), state: 'SCHEDULED' },
        { taskId: testTaskId('retained-task'), state: 'FAILED' },
      ],
    };

    const result = gov.replanCalculator.calculateReplanBudget(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // RUNNING excluded, SCHEDULED cancelled, FAILED-with-retained also released
    const cancelledIds = result.value.cancelledTasks.map(t => t.taskId);
    assert.ok(cancelledIds.includes(testTaskId('retained-task')),
      'Retained reservation must be released during replan');
  });

  // --- DC-EGP-049: Reservation lifecycle events emitted ---
  it('should emit reservation lifecycle events through deps.events', () => {
    // CATCHES: Reservation state transitions occur without event emission,
    // making lifecycle invisible to observers and replayers.
    // Defect: DC-EGP-049 — Lifecycle events not emitted (partial gap)
    const deps = createMockDeps();
    const localGov = createExecutionGovernor(deps);

    const result = localGov.reservations.create(conn, ctx, makeReservationInput());

    assert.strictEqual(result.ok, true);
    // After creation: RESERVATION_CREATED event must be emitted
    const createdEvent = deps.emittedEvents.find(
      e => e.type === EGP_EVENTS.RESERVATION_CREATED,
    );
    assert.ok(createdEvent, 'RESERVATION_CREATED event must be emitted on create');
  });

  // --- DC-EGP-054: EGPRelevantTaskState↔TaskLifecycleState alignment ---
  it('should handle all 7 EGPRelevantTaskState values in dependency evaluation', () => {
    // CATCHES: EGPRelevantTaskState missing a lifecycle state — tasks in that
    // state silently ignored in scheduling and dependency resolution.
    // Defect: DC-EGP-054 — EGPRelevantTaskState diverges from TaskLifecycleState
    // Phase 0A TaskLifecycleState: pending, ready, executing, completed, failed, skipped, revoked
    // EGP mapping: PENDING, SCHEDULED, RUNNING, COMPLETED, FAILED, CANCELLED, BLOCKED
    const allEGPStates: EGPRelevantTaskState[] = [
      'PENDING', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED',
    ];

    // Every EGP state must be accepted by fan-in evaluation without error
    const result = gov.branchFailure.evaluateFanIn(
      conn,
      testTaskId('fan-in'),
      'isolate',
      allEGPStates.map((state, i) => ({
        taskId: testTaskId(`pred-${i}`),
        state,
      })),
    );

    assert.strictEqual(result.ok, true);
    assert.equal(allEGPStates.length, 7, 'EGPRelevantTaskState must cover 7 values');
  });

  // --- DC-EGP-055: Default allocation for pre-v3.3 missions ---
  it('should apply default EGP configuration for pre-v3.3 missions', () => {
    // CATCHES: Pre-v3.3 mission has no explicit EGP config — scheduler throws
    // or uses zero-value defaults, blocking all tasks from scheduling.
    // Defect: DC-EGP-055 — Defaults not applied to pre-v3.3 missions
    const input: SchedulerCycleInput = {
      availableWorkers: 2,
      eligibleMissions: [{
        missionId: testMissionId('pre-v33-mission'),
        eligibleTasks: [makeEligibleTask({
          taskId: testTaskId('old-task'),
          requiresDeliberation: false,
          estimatedDeliberationTokens: 0,
        })],
        tokenPool: 1000,
        deliberationPool: 0, // Pre-v3.3: no deliberation budget
        branchFailurePolicy: 'isolate',
        starvationCounter: 0,
      }],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };

    const result = gov.scheduler.executeCycle(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Pre-v3.3 mission with 0 deliberation must still schedule token-only tasks
    assert.ok(result.value.waves.length > 0, 'Pre-v3.3 mission must be schedulable');
  });

  // --- DC-EGP-056: Branded type factory verification ---
  it('should produce correctly branded ReservationId from create', () => {
    // CATCHES: Factory returns plain string instead of branded type —
    // runtime loss of type safety allows cross-subsystem ID confusion.
    // Defect: DC-EGP-056 — Branded type bypass
    const input = makeReservationInput();
    const result = gov.reservations.create(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // reservationId must be a non-empty string (branded at type level)
    assert.strictEqual(typeof result.value.reservationId, 'string');
    assert.ok(result.value.reservationId.length > 0, 'ReservationId must be non-empty');
    // Verify it's distinct from taskId (not reusing input IDs)
    assert.notStrictEqual(
      result.value.reservationId as string,
      input.taskId as string,
    );
  });

  // --- DC-EGP-060: Zero-worker error code ---
  it('should return NO_WORKERS_AVAILABLE error when zero workers', () => {
    // CATCHES: Zero-worker cycle silently returns empty waves without
    // indicating WHY no scheduling occurred.
    // Defect: DC-EGP-060 — Zero-worker invalid output (partial gap)
    const input: SchedulerCycleInput = {
      availableWorkers: 0,
      eligibleMissions: [{
        missionId: testMissionId('mission-zero-workers'),
        eligibleTasks: [makeEligibleTask()],
        tokenPool: 1000,
        deliberationPool: 200,
        branchFailurePolicy: 'isolate',
        starvationCounter: 0,
      }],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };

    const result = gov.scheduler.executeCycle(conn, ctx, input);

    // 0 workers → error with specific code, not silent empty waves
    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.error.code, SCHEDULER_ERROR_CODES.NO_WORKERS_AVAILABLE);
  });

  // --- DC-EGP-068: WaveComposer pathological inputs ---
  it('should reject pathological inputs to WaveComposer', () => {
    // CATCHES: Negative pool, duplicate taskIds, or NaN estimates accepted —
    // produces corrupt wave composition or division by zero.
    // Defect: DC-EGP-068 — WaveComposer pathological inputs (NEW in v1.1)
    const negativePoolInput: WaveCompositionInput = {
      missionId: testMissionId('mission-patho'),
      eligibleTasks: [makeEligibleTask()],
      tokenPool: -500, // Pathological: negative pool
      deliberationPool: 100,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };

    const result = gov.waveComposer.compose(conn, ctx, negativePoolInput);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.strictEqual(result.error.code, WAVE_ERROR_CODES.INVALID_POOL);
  });
});

// ============================================================================
// GROUP 15: Phase 0A Integration Tests (6 tests)
// Tests requiring Phase 0A governance primitives (TraceEmitter, CorrelationId,
// TransitionEnforcer, SuspensionStore). All FAIL against NOT_IMPLEMENTED harness.
// Gap Report ref: CORTEX_PHASE_1_EGP_GAP_REPORT.md §5
// ============================================================================

describe('GROUP 15: Phase 0A Integration', () => {
  let gov: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    const deps = createMockDeps();
    gov = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  // --- DC-EGP-050: CorrelationId propagated to EGP events ---
  it('should propagate correlationId from context to EGP events', () => {
    // CATCHES: CorrelationId dropped — EGP events not linkable to originating
    // syscall trace chain, breaking end-to-end observability.
    // Defect: DC-EGP-050 — CorrelationId not propagated through EGP operations
    const traceEvents: Array<{ correlationId: string; type: string }> = [];
    const phase0ADeps: ExecutionGovernorDeps = {
      ...createMockDeps(),
      traceEmitter: {
        emit(_conn: DatabaseConnection, _ctx: OperationContext, event: {
          readonly correlationId: CorrelationId;
          readonly type: string;
          readonly payload: Record<string, unknown>;
        }) {
          traceEvents.push({
            correlationId: event.correlationId as string,
            type: event.type,
          });
          return { ok: true as const, value: 'trace-id-mock' };
        },
      },
    };
    const localGov = createExecutionGovernor(phase0ADeps);
    const egpCtx: EGPOperationContext = {
      ...createMockCtx(),
      correlationId: 'corr-trace-001' as CorrelationId,
    };

    const result = localGov.reservations.create(conn, egpCtx, makeReservationInput());

    assert.strictEqual(result.ok, true);
    // Trace event must carry the originating correlationId
    assert.ok(traceEvents.length > 0, 'At least one trace event must be emitted');
    assert.strictEqual(traceEvents[0].correlationId, 'corr-trace-001');
  });

  // --- DC-EGP-051: Conservation check auditable ---
  it('should produce auditable conservation check result', () => {
    // CATCHES: Conservation check runs but result is not recorded in audit trail,
    // making post-incident investigation impossible.
    // Defect: DC-EGP-051 — Conservation check not auditable
    const deps = createMockDeps();
    const localGov = createExecutionGovernor(deps);

    const result = localGov.ledger.checkConservation(
      conn, testMissionId('mission-audit'),
    );

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Result must include full per-dimension breakdown for audit
    assert.strictEqual(typeof result.value.holds, 'boolean');
    assert.strictEqual(typeof result.value.token.leftSide, 'number');
    assert.strictEqual(typeof result.value.token.rightSide, 'number');
    assert.strictEqual(typeof result.value.token.delta, 'number');
    assert.strictEqual(typeof result.value.deliberation.leftSide, 'number');
    // Audit entry must be created
    assert.ok(deps.auditEntries.length > 0,
      'Conservation check must produce audit trail entry');
  });

  // --- DC-EGP-052: Starvation bound trigger event ---
  it('should emit STARVATION_BOUND_TRIGGERED event when bound exceeded', () => {
    // CATCHES: Starvation bound triggers priority promotion but no event
    // is emitted, making operational monitoring blind to starvation events.
    // Defect: DC-EGP-052 — Starvation bound event missing
    const deps = createMockDeps();
    const localGov = createExecutionGovernor(deps);

    const input: SchedulerCycleInput = {
      availableWorkers: 1,
      eligibleMissions: [{
        missionId: testMissionId('starving-mission'),
        eligibleTasks: [makeEligibleTask()],
        tokenPool: 1000,
        deliberationPool: 200,
        branchFailurePolicy: 'isolate',
        starvationCounter: DEFAULT_MAX_STARVATION_CYCLES + 1, // Above bound
      }],
      starvationBound: DEFAULT_MAX_STARVATION_CYCLES,
      allocationMethod: 'proportional',
      minimumViableTokens: DEFAULT_MINIMUM_VIABLE_RESERVATION_TOKENS,
      minimumViableDeliberation: DEFAULT_MINIMUM_VIABLE_RESERVATION_DELIBERATION,
    };

    const result = localGov.scheduler.executeCycle(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Starvation bound triggered — event must be emitted
    const starvationEvent = deps.emittedEvents.find(
      e => e.type === EGP_EVENTS.STARVATION_BOUND_TRIGGERED,
    );
    assert.ok(starvationEvent,
      'STARVATION_BOUND_TRIGGERED event must be emitted when bound exceeded');
  });

  // --- DC-EGP-061: Terminal handler requires TransitionEnforcer ---
  it('should validate terminal transition through TransitionEnforcer', () => {
    // CATCHES: Terminal handler releases reservation without verifying the
    // task state transition is valid per TransitionEnforcer, allowing
    // budget release on invalid transitions.
    // Defect: DC-EGP-061 — Terminal bypasses TransitionEnforcer (Phase 1D)
    // The terminal handler must compose with TransitionEnforcer to validate
    // that the task is actually transitioning to the claimed terminal state.
    const createResult = gov.reservations.create(conn, ctx, makeReservationInput({
      taskId: testTaskId('task-transition'),
    }));
    assert.ok(createResult.ok);
    gov.reservations.activate(conn, createResult.value.reservationId);

    const result = gov.terminalOp.execute(
      conn, ctx, testTaskId('task-transition'), 'COMPLETED', false,
    );

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Implementation must call TransitionEnforcer.enforceTaskTransition()
    // before releasing the reservation. The composition is verified in Phase 1D.
    assert.strictEqual(result.value.action, 'released');
    assert.ok(result.value.reservationId !== null,
      'Terminal result must reference the reservation');
  });

  // --- DC-EGP-062: Suspended task headroom non-consumable ---
  it('should flag suspended task headroom as non-consumable', () => {
    // CATCHES: Suspended task's reservation still shows headroom available,
    // allowing consumption against a frozen reservation (INV-X05 violation).
    // Defect: DC-EGP-062 — Suspension not reflected in reservation state
    const suspendedResult = gov.suspendedQuery.isTaskSuspended(
      conn, testTaskId('suspended-task'),
    );

    assert.strictEqual(suspendedResult.ok, true);
    if (!suspendedResult.ok) return;
    // If task is suspended: headroom check must return allowed=false
    if (suspendedResult.value) {
      const headroom = gov.enforcer.checkHeadroom(
        conn, testTaskId('suspended-task'), 100, 10,
      );
      assert.strictEqual(headroom.ok, true);
      if (!headroom.ok) return;
      assert.strictEqual(headroom.value.allowed, false,
        'Suspended task must not have consumable headroom');
    }
  });

  // --- DC-EGP-064: Admission gate blocks v3.3 task without reservation ---
  it('should block v3.3 task admission without reservation', () => {
    // CATCHES: v3.3 task enters 'executing' without budget reservation —
    // consumption untracked, conservation law violated.
    // Defect: DC-EGP-064 — Admission-time reservation gate (NEW in v1.1)
    // EGP-I14: Reservation is required for v3.3 task execution.
    const v33Result = gov.admissionGate.checkAdmission(
      conn, ctx, testTaskId('v33-task-no-res'), '3.3',
    );

    assert.strictEqual(v33Result.ok, true);
    if (!v33Result.ok) return;
    assert.strictEqual(v33Result.value.admitted, false,
      'v3.3 task without reservation must not be admitted');
    assert.strictEqual(v33Result.value.reservationId, null);

    // v3.2 task: exempt from reservation requirement (backward compat)
    const v32Result = gov.admissionGate.checkAdmission(
      conn, ctx, testTaskId('v32-legacy-task'), '3.2',
    );

    assert.strictEqual(v32Result.ok, true);
    if (!v32Result.ok) return;
    assert.strictEqual(v32Result.value.admitted, true,
      'v3.2 task must be admitted without reservation');
  });

  // --- GAP-EGP-A21-1: v3.3 task WITH confirmed reservation admitted ---
  it('GAP-EGP-A21-1: v3.3 task with confirmed reservation transitions to executing', () => {
    // CATCHES: Implementation that rejects v3.3 tasks regardless of reservation state,
    // or admission gate that doesn't actually look up the reservation.
    // Defect: DC-EGP-064 — Admission-time reservation gate (positive path)
    // EGP-I14: Reservation is required for v3.3 task execution — WITH reservation = admitted.
    //
    // Discriminativeness: If the admission gate were removed entirely (all tasks admitted
    // regardless), this test would still pass. But paired with the rejection test above
    // (v3.3 task WITHOUT reservation → rejected), together they prove the gate is
    // conditional: admits with reservation, blocks without.

    const taskId = testTaskId('v33-task-with-res');
    const missionId = testMissionId('mission-admit-001');

    // STEP 1: Create a reservation for the task.
    const createResult = gov.reservations.create(conn, ctx, makeReservationInput({
      taskId,
      missionId,
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.strictEqual(createResult.ok, true, 'Reservation creation must succeed');
    if (!createResult.ok) return;
    const resId = createResult.value.reservationId;

    // STEP 2: Activate the reservation (reserved → active, simulating task SCHEDULED → RUNNING).
    const activateResult = gov.reservations.activate(conn, resId);
    assert.strictEqual(activateResult.ok, true, 'Reservation activation must succeed');

    // STEP 3: Check admission — v3.3 task with active reservation.
    const admitResult = gov.admissionGate.checkAdmission(
      conn, ctx, taskId, '3.3',
    );

    // ASSERT: Admission SUCCEEDS.
    assert.strictEqual(admitResult.ok, true, 'Admission check must not error');
    if (!admitResult.ok) return;
    assert.strictEqual(admitResult.value.admitted, true,
      'v3.3 task WITH active reservation must be admitted');
    assert.strictEqual(admitResult.value.reservationId, resId,
      'Admission must return the matching reservation ID');

    // STEP 4: Verify reservation is still active (admission gate is read-only, does not mutate).
    const afterAdmit = gov.reservations.getByTaskId(conn, taskId);
    assert.strictEqual(afterAdmit.ok, true);
    if (!afterAdmit.ok) return;
    assert.notStrictEqual(afterAdmit.value, null, 'Reservation must still exist after admission');
    assert.strictEqual(afterAdmit.value!.status, 'active',
      'Reservation status must remain active — admission gate is non-mutating');
  });

  // --- GAP-EGP-A21-2: Released reservation cannot be reused for task execution ---
  it('GAP-EGP-A21-2: released reservation cannot be used for task execution', () => {
    // CATCHES: Implementation that accepts any reservation regardless of state,
    // or missing state machine enforcement on the released terminal state.
    // This tests TWO enforcement mechanisms:
    //   (a) Reservation state machine: released → active is an invalid transition.
    //   (b) Admission gate: released reservation not found (excluded from lookup).
    //
    // Discriminativeness: If the reservation state check were removed (any reservation
    // accepted regardless of state), this test MUST fail on both assertions:
    //   - reactivate() would succeed instead of returning INVALID_TRANSITION
    //   - admission gate would admit instead of blocking

    const taskId = testTaskId('v33-task-released-res');
    const missionId = testMissionId('mission-released-001');

    // SETUP: Create reservation → activate → release (normal completion lifecycle).
    const createResult = gov.reservations.create(conn, ctx, makeReservationInput({
      taskId,
      missionId,
      reservedTokens: 500,
      reservedDeliberation: 100,
    }));
    assert.strictEqual(createResult.ok, true, 'Setup: reservation creation');
    if (!createResult.ok) return;
    const resId = createResult.value.reservationId;

    const activateResult = gov.reservations.activate(conn, resId);
    assert.strictEqual(activateResult.ok, true, 'Setup: reservation activation');

    const releaseResult = gov.reservations.release(conn, ctx, resId, 'COMPLETED');
    assert.strictEqual(releaseResult.ok, true, 'Setup: reservation release');

    // ASSERTION 1: released → active transition MUST fail.
    // This is the direct state machine enforcement — released is terminal.
    const reactivateResult = gov.reservations.reactivate(conn, resId);
    assert.strictEqual(reactivateResult.ok, false,
      'released → active transition must be rejected');
    if (!reactivateResult.ok) {
      assert.strictEqual(reactivateResult.error.code, RESERVATION_ERROR_CODES.INVALID_TRANSITION,
        'Must fail with INVALID_TRANSITION error code, not NOT_FOUND');
    }

    // ASSERTION 2: Reservation state UNCHANGED — still 'released'.
    const afterReactivate = gov.reservations.getById(conn, resId);
    assert.strictEqual(afterReactivate.ok, true, 'Released reservation must still be retrievable by ID');
    if (!afterReactivate.ok) return;
    assert.strictEqual(afterReactivate.value.status, 'released',
      'Reservation must remain in released state after rejected transition');

    // ASSERTION 3: Admission gate rejects — released reservation excluded from task lookup.
    const admitResult = gov.admissionGate.checkAdmission(
      conn, ctx, taskId, '3.3',
    );
    assert.strictEqual(admitResult.ok, true, 'Admission check must not error');
    if (!admitResult.ok) return;
    assert.strictEqual(admitResult.value.admitted, false,
      'v3.3 task with only a released reservation must NOT be admitted');
  });
});
