/**
 * Phase 2B Integration Tests: EGP ↔ Execution Wiring
 * Spec ref: EGP v1.0 Design Source, I-76/77/78/83/86/87
 *
 * These tests verify the COMPOSED behavior of the wiring layer —
 * execution gate, invocation gate, terminal release, and floor enforcement.
 * Each test exercises the full wiring path, not individual subsystems.
 *
 * Amendment 22: Every wire has a call-site reference in the wiring manifest.
 * Amendment 2: Control 3 (Executable Contract, Interface-First).
 *
 * 14 integration tests covering 8 enforcement defect classes (DC-EGP-001 through DC-EGP-010).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionGovernor } from '../../src/execution/harness/egp_harness.js';
import { createExecutionGate } from '../../src/execution/wiring/execution_gate.js';
import { createInvocationGate } from '../../src/execution/wiring/invocation_gate.js';
import { createTerminalRelease } from '../../src/execution/wiring/terminal_release.js';
import { createFloorEnforcer } from '../../src/execution/wiring/floor_enforcer.js';

import type {
  ExecutionGovernor,
  ExecutionGovernorDeps,
  ReservationCreateInput,
} from '../../src/execution/interfaces/egp_types.js';
import type {
  DatabaseConnection,
  OperationContext,
  TaskId,
  MissionId,
} from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

function testTaskId(id: string): TaskId { return id as TaskId; }
function testMissionId(id: string): MissionId { return id as MissionId; }

function createMockConn(): DatabaseConnection {
  return {
    dataDir: ':memory:',
    schemaVersion: 12,
    tenancyMode: 'single',
    transaction<T>(fn: () => T): T { return fn(); },
    run() { return { changes: 0, lastInsertRowid: 0 }; },
    query<T>(): T[] { return []; },
    get<T>(): T | undefined { return undefined; },
    close() {},
    checkpoint() { return { ok: true as const, value: undefined }; },
  } as unknown as DatabaseConnection;
}

function createMockCtx(): OperationContext {
  return {
    tenantId: null, userId: null, agentId: null,
    permissions: new Set(), sessionId: undefined,
  } as unknown as OperationContext;
}

function createMockDeps(): ExecutionGovernorDeps {
  return {
    audit: {
      append() { return { ok: true as const, value: 'audit-mock' }; },
    },
    events: { emit() {} },
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  } as unknown as ExecutionGovernorDeps;
}

function makeReservation(overrides?: Partial<ReservationCreateInput>): ReservationCreateInput {
  return {
    taskId: testTaskId('task-001'),
    missionId: testMissionId('mission-001'),
    reservedTokens: 500,
    reservedDeliberation: 100,
    allocationMethod: 'proportional',
    ...overrides,
  };
}

// ============================================================================
// Integration Tests: EGP ↔ Execution Wiring (14 tests)
// ============================================================================

describe('Phase 2B: EGP ↔ Execution Wiring Integration', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    governor = createExecutionGovernor(createMockDeps());
    conn = createMockConn();
    ctx = createMockCtx();
  });

  // ── Wire-EGP-01: Execution Gate (DC-EGP-001 through DC-EGP-005) ──

  describe('Wire-EGP-01: Execution Gate', () => {

    it('IT-EGP-01: Task with active reservation executes (DC-EGP-001 success)', () => {
      const gate = createExecutionGate(governor);
      const taskId = testTaskId('task-exec-01');

      // Create reservation
      const create = governor.reservations.create(conn, ctx, makeReservation({ taskId }));
      assert.ok(create.ok);

      // Gate: check + activate
      const result = gate.checkAndActivate(conn, ctx, taskId, '3.3');
      assert.ok(result.ok);
      assert.strictEqual(result.value.admitted, true);
      assert.notStrictEqual(result.value.reservationId, null);

      // Reservation must now be active
      const res = governor.reservations.getByTaskId(conn, taskId);
      assert.ok(res.ok && res.value !== null);
      assert.strictEqual(res.value.status, 'active');
    });

    it('IT-EGP-02: Task without reservation rejected (DC-EGP-001 rejection)', () => {
      const gate = createExecutionGate(governor);

      // No reservation — attempt execution
      const result = gate.checkAndActivate(conn, ctx, testTaskId('no-res'), '3.3');
      assert.ok(result.ok);
      assert.strictEqual(result.value.admitted, false);
      assert.strictEqual(result.value.reservationId, null);
    });

    it('IT-EGP-03: Wrong task reservation rejected (DC-EGP-002 rejection)', () => {
      const gate = createExecutionGate(governor);
      const taskA = testTaskId('task-A');
      const taskB = testTaskId('task-B');

      // Create reservation for task A only
      governor.reservations.create(conn, ctx, makeReservation({ taskId: taskA }));

      // Attempt execution for task B — no reservation exists for B
      const result = gate.checkAndActivate(conn, ctx, taskB, '3.3');
      assert.ok(result.ok);
      assert.strictEqual(result.value.admitted, false,
        'Task B must NOT be admitted — reservation belongs to task A');
    });

    it('IT-EGP-04: Released reservation rejected (DC-EGP-003 rejection)', () => {
      const gate = createExecutionGate(governor);
      const taskId = testTaskId('task-released');

      // Create, then release reservation
      const create = governor.reservations.create(conn, ctx, makeReservation({ taskId }));
      assert.ok(create.ok);
      governor.reservations.release(conn, ctx, create.value.reservationId, 'test');

      // Attempt execution — released reservation is invisible
      const result = gate.checkAndActivate(conn, ctx, taskId, '3.3');
      assert.ok(result.ok);
      assert.strictEqual(result.value.admitted, false);
    });

    it('IT-EGP-07: Double reservation rejected (DC-EGP-005 rejection)', () => {
      const taskId = testTaskId('task-double');

      const first = governor.reservations.create(conn, ctx, makeReservation({ taskId }));
      assert.ok(first.ok);

      const second = governor.reservations.create(conn, ctx, makeReservation({
        taskId, reservedTokens: 200, reservedDeliberation: 50,
      }));
      assert.strictEqual(second.ok, false);
      assert.strictEqual(second.error.code, 'EGP_RESERVATION_ALREADY_EXISTS');
    });
  });

  // ── Wire-EGP-03: Terminal Release (DC-EGP-004) ──

  describe('Wire-EGP-03: Terminal Release', () => {

    it('IT-EGP-05: Reservation released on task completion (DC-EGP-004 success)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-complete');
      const missionId = testMissionId('mission-t1');

      // Setup: initialize budget, create + activate reservation, consume some
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 500, reservedDeliberation: 100,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 500, 100);
      governor.reservations.activate(conn, create.value.reservationId);
      governor.reservations.updateConsumed(conn, create.value.reservationId, 200, 30);

      // Terminal: COMPLETED
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'COMPLETED', false);
      assert.ok(result.ok);
      assert.strictEqual(result.value.terminalResult.action, 'released');
      assert.strictEqual(result.value.terminalResult.reclaimedTokens, 300);
      assert.strictEqual(result.value.terminalResult.reclaimedDeliberation, 70);

      // Reservation no longer findable by taskId
      const res = governor.reservations.getByTaskId(conn, taskId);
      assert.ok(res.ok);
      assert.strictEqual(res.value, null);
    });

    it('IT-EGP-06: Unreserved pool increases after release (DC-EGP-004 conservation)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-pool');
      const missionId = testMissionId('mission-pool');

      // Init: 2000 tokens, 500 deliberation
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);

      // Reserve 400 tokens, 80 deliberation for this task
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 400, reservedDeliberation: 80,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 400, 80);
      governor.reservations.activate(conn, create.value.reservationId);
      governor.reservations.updateConsumed(conn, create.value.reservationId, 150, 20);

      // Capture state before release
      const before = governor.ledger.getState(conn, missionId);
      assert.ok(before.ok);

      // Terminal release
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'COMPLETED', false);
      assert.ok(result.ok);

      // Verify unreserved pool increased by reclaimed amount
      const after = governor.ledger.getState(conn, missionId);
      assert.ok(after.ok);

      // Reclaimed: 400 - 150 = 250 tokens, 80 - 20 = 60 deliberation
      assert.strictEqual(after.value.token.unreservedRemaining,
        before.value.token.unreservedRemaining + 250,
        'Token unreserved must increase by reclaimed');
      assert.strictEqual(after.value.deliberation.unreservedRemaining,
        before.value.deliberation.unreservedRemaining + 60,
        'Deliberation unreserved must increase by reclaimed');
    });
  });

  // ── Wire-EGP-02: Invocation Gate (DC-EGP-007, DC-EGP-008) ──

  describe('Wire-EGP-02: Invocation Gate', () => {

    it('IT-EGP-08: Invocation within headroom succeeds (DC-EGP-007 success)', () => {
      const gate = createInvocationGate(governor);
      const taskId = testTaskId('task-hr-ok');

      // Create + activate with 500 tokens, 100 deliberation
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, reservedTokens: 500, reservedDeliberation: 100,
      }));
      assert.ok(create.ok);
      governor.reservations.activate(conn, create.value.reservationId);

      // Check headroom: 200 tokens, 50 deliberation — within limits
      const result = gate.checkAdmissibility(conn, taskId, 200, 50);
      assert.ok(result.ok);
      assert.strictEqual(result.value.admissible, true);
      assert.strictEqual(result.value.tokenHeadroom, 500);
      assert.strictEqual(result.value.deliberationHeadroom, 100);
      assert.strictEqual(result.value.rejectionDimension, null);
    });

    it('IT-EGP-09: Invocation exceeding headroom blocked (DC-EGP-007 rejection)', () => {
      const gate = createInvocationGate(governor);
      const taskId = testTaskId('task-hr-exceeded');

      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, reservedTokens: 500, reservedDeliberation: 100,
      }));
      assert.ok(create.ok);
      governor.reservations.activate(conn, create.value.reservationId);

      // Exhaust all tokens
      governor.reservations.updateConsumed(conn, create.value.reservationId, 500, 0);

      // Check: tokens exhausted → blocked
      const result = gate.checkAdmissibility(conn, taskId, 100, 0);
      assert.ok(result.ok);
      assert.strictEqual(result.value.admissible, false);
      assert.strictEqual(result.value.rejectionDimension, 'token');
    });

    it('IT-EGP-10: Token OK + deliberation exhausted = blocked (DC-EGP-008 rejection)', () => {
      const gate = createInvocationGate(governor);
      const taskId = testTaskId('task-delib-ex');

      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, reservedTokens: 1000, reservedDeliberation: 50,
      }));
      assert.ok(create.ok);
      governor.reservations.activate(conn, create.value.reservationId);

      // Exhaust deliberation only
      governor.reservations.updateConsumed(conn, create.value.reservationId, 0, 50);

      // I-56: both dimensions must pass — deliberation exhausted blocks despite token OK
      const result = gate.checkAdmissibility(conn, taskId, 100, 10);
      assert.ok(result.ok);
      assert.strictEqual(result.value.admissible, false);
      assert.strictEqual(result.value.rejectionDimension, 'deliberation');
    });

    it('IT-EGP-11: Both dimensions OK = proceeds (DC-EGP-008 success)', () => {
      const gate = createInvocationGate(governor);
      const taskId = testTaskId('task-both-ok');

      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, reservedTokens: 1000, reservedDeliberation: 200,
      }));
      assert.ok(create.ok);
      governor.reservations.activate(conn, create.value.reservationId);

      // Partial consumption
      governor.reservations.updateConsumed(conn, create.value.reservationId, 300, 80);

      // Both dimensions have remaining headroom
      const result = gate.checkAdmissibility(conn, taskId, 200, 50);
      assert.ok(result.ok);
      assert.strictEqual(result.value.admissible, true);
      assert.strictEqual(result.value.tokenHeadroom, 700);
      assert.strictEqual(result.value.deliberationHeadroom, 120);
    });
  });

  // ── Wire-EGP-04: Floor Enforcement (DC-EGP-010) ──

  describe('Wire-EGP-04: Floor Enforcement', () => {

    it('IT-EGP-12: Reservation violating floor rejected (DC-EGP-010 rejection)', () => {
      const enforcer = createFloorEnforcer(governor);
      const missionId = testMissionId('mission-floor');

      // Allocate 1000 tokens, 200 deliberation
      governor.ledger.initializeBudget(conn, missionId, 1000, 200);

      // Floor = 10%: 100 tokens, 20 deliberation
      // Available for reservation = 900 tokens, 180 deliberation
      // Try to reserve 950 tokens — exceeds available after floor
      const result = enforcer.checkFloor(conn, missionId, 950, 10);
      assert.ok(result.ok);
      assert.strictEqual(result.value.allowed, false);
      assert.strictEqual(result.value.tokenFloor, 100);
      assert.strictEqual(result.value.tokenAvailableAfterFloor, 900);
    });

    it('IT-EGP-13: Reservation within floor succeeds (DC-EGP-010 success)', () => {
      const enforcer = createFloorEnforcer(governor);
      const missionId = testMissionId('mission-floor-ok');

      // Allocate 1000 tokens, 200 deliberation
      governor.ledger.initializeBudget(conn, missionId, 1000, 200);

      // Reserve 800 tokens, 150 deliberation — within floor limits
      const result = enforcer.checkFloor(conn, missionId, 800, 150);
      assert.ok(result.ok);
      assert.strictEqual(result.value.allowed, true);
      assert.strictEqual(result.value.tokenAvailableAfterFloor, 900);
      assert.strictEqual(result.value.deliberationAvailableAfterFloor, 180);
    });
  });

  // ── End-to-End: Full Lifecycle + Conservation Law ──

  describe('End-to-End: Conservation Law', () => {

    it('IT-EGP-14: Conservation equation holds after full reservation lifecycle', () => {
      const gate = createExecutionGate(governor);
      const invGate = createInvocationGate(governor);
      const release = createTerminalRelease(governor);

      const taskId = testTaskId('task-lifecycle');
      const missionId = testMissionId('mission-lifecycle');

      // Step 1: Initialize mission budget
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);

      // Verify initial conservation
      const initConserve = governor.ledger.checkConservation(conn, missionId);
      assert.ok(initConserve.ok);
      assert.strictEqual(initConserve.value.holds, true, 'Init conservation must hold');

      // Step 2: Create reservation (simulates scheduler wave)
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 800, reservedDeliberation: 200,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 800, 200);

      // Verify conservation after reservation
      const postReserve = governor.ledger.checkConservation(conn, missionId);
      assert.ok(postReserve.ok);
      assert.strictEqual(postReserve.value.holds, true, 'Post-reserve conservation must hold');

      // Step 3: Execution gate — admitted + activated
      const gateResult = gate.checkAndActivate(conn, ctx, taskId, '3.3');
      assert.ok(gateResult.ok);
      assert.strictEqual(gateResult.value.admitted, true);

      // Step 4: Pre-invocation check — within headroom
      const invResult = invGate.checkAdmissibility(conn, taskId, 300, 100);
      assert.ok(invResult.ok);
      assert.strictEqual(invResult.value.admissible, true);

      // Step 5: Consume tokens (tracked at reservation level only — ledger untouched)
      governor.reservations.updateConsumed(conn, create.value.reservationId, 500, 150);

      // Step 6: Terminal release — completes, releases, finalizes
      const releaseResult = release.executeRelease(
        conn, ctx, taskId, missionId, 'COMPLETED', false,
      );
      assert.ok(releaseResult.ok);
      assert.strictEqual(releaseResult.value.terminalResult.action, 'released');
      assert.strictEqual(releaseResult.value.terminalResult.reclaimedTokens, 300);
      assert.strictEqual(releaseResult.value.terminalResult.reclaimedDeliberation, 50);

      // Step 7: Verify conservation law
      assert.strictEqual(releaseResult.value.conservationHolds, true,
        'Conservation MUST hold after full lifecycle');

      // Double-check via direct conservation query
      const finalConserve = governor.ledger.checkConservation(conn, missionId);
      assert.ok(finalConserve.ok);
      assert.strictEqual(finalConserve.value.holds, true,
        'Direct conservation check must hold');
      assert.strictEqual(finalConserve.value.token.delta, 0, 'Token delta must be 0');
      assert.strictEqual(finalConserve.value.deliberation.delta, 0, 'Deliberation delta must be 0');

      // Verify final state values
      const state = governor.ledger.getState(conn, missionId);
      assert.ok(state.ok);

      // allocated=2000, consumed=500, reserved=0 (released), unreserved=1500
      assert.strictEqual(state.value.token.allocated, 2000);
      assert.strictEqual(state.value.token.totalConsumed, 500);
      assert.strictEqual(state.value.token.totalReserved, 0, 'All reservations released');
      assert.strictEqual(state.value.token.unreservedRemaining, 1500);

      // deliberation: allocated=500, consumed=150, reserved=0, unreserved=350
      assert.strictEqual(state.value.deliberation.allocated, 500);
      assert.strictEqual(state.value.deliberation.totalConsumed, 150);
      assert.strictEqual(state.value.deliberation.totalReserved, 0);
      assert.strictEqual(state.value.deliberation.unreservedRemaining, 350);
    });
  });

  // ── BPB-EGP-01: Retry retention at wiring level (EGP-I8) ──

  describe('Wire-EGP-03: Retry Retention', () => {

    it('IT-EGP-15: FAILED with retries retains reservation (EGP-I8 success)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-retry-retain');
      const missionId = testMissionId('mission-retry');

      // Setup: budget, reservation, activation, partial consumption
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 600, reservedDeliberation: 120,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 600, 120);
      governor.reservations.activate(conn, create.value.reservationId);
      governor.reservations.updateConsumed(conn, create.value.reservationId, 200, 40);

      // Terminal: FAILED with retries remaining → reservation RETAINED
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'FAILED', true);
      assert.ok(result.ok);
      assert.strictEqual(result.value.terminalResult.action, 'retained',
        'EGP-I8: FAILED with retries → reservation retained, not released');
      assert.strictEqual(result.value.terminalResult.reclaimedTokens, 0,
        'Retained reservation reclaims nothing');
      assert.strictEqual(result.value.terminalResult.reclaimedDeliberation, 0,
        'Retained reservation reclaims nothing (deliberation)');

      // Reservation still exists and findable by taskId
      const res = governor.reservations.getByTaskId(conn, taskId);
      assert.ok(res.ok);
      assert.notStrictEqual(res.value, null,
        'Reservation must still exist after retention');
      assert.strictEqual(res.value!.status, 'retained',
        'Reservation status must be retained');

      // Prior consumption is preserved (cumulative for retry — EGP-I8)
      assert.strictEqual(res.value!.consumedTokens, 200,
        'Consumed tokens preserved for retry');
      assert.strictEqual(res.value!.consumedDeliberation, 40,
        'Consumed deliberation preserved for retry');

      // Budget pool unchanged — no finalization occurred
      const state = governor.ledger.getState(conn, missionId);
      assert.ok(state.ok);
      assert.strictEqual(state.value.token.totalReserved, 600,
        'Reservation still held in reserved pool');
    });

    it('IT-EGP-15b: FAILED without retries releases reservation (EGP-I8 rejection)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-no-retry');
      const missionId = testMissionId('mission-no-retry');

      // Setup
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 500, reservedDeliberation: 100,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 500, 100);
      governor.reservations.activate(conn, create.value.reservationId);
      governor.reservations.updateConsumed(conn, create.value.reservationId, 200, 30);

      // Terminal: FAILED without retries → reservation RELEASED
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'FAILED', false);
      assert.ok(result.ok);
      assert.strictEqual(result.value.terminalResult.action, 'released',
        'FAILED without retries → reservation released');

      // Reservation no longer findable
      const res = governor.reservations.getByTaskId(conn, taskId);
      assert.ok(res.ok);
      assert.strictEqual(res.value, null,
        'Released reservation must not be findable by taskId');
    });
  });

  // ── BPB-EGP-02: Overage recording (EGP-I12) ──

  describe('Wire-EGP-03: Overage Recording', () => {

    it('IT-EGP-16: Consumed > reserved records overage via recordOverage (EGP-I12)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-overage');
      const missionId = testMissionId('mission-overage');

      // Setup: TIGHT budget — unreserved pool must be smaller than overage
      // to trigger missionDebt. Budget=350, reserve=300 → unreserved=50.
      // Overage=100 → 100 > 50 → excess 50 becomes debt.
      governor.ledger.initializeBudget(conn, missionId, 350, 70);
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 300, reservedDeliberation: 60,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 300, 60);
      governor.reservations.activate(conn, create.value.reservationId);

      // Capture pre-release state
      const before = governor.ledger.getState(conn, missionId);
      assert.ok(before.ok);
      assert.strictEqual(before.value.token.unreservedRemaining, 50);
      assert.strictEqual(before.value.deliberation.unreservedRemaining, 10);

      // Consume MORE than reserved: 400 > 300 tokens, 80 > 60 deliberation
      governor.reservations.updateConsumed(conn, create.value.reservationId, 400, 80);

      // Terminal release
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'COMPLETED', false);
      assert.ok(result.ok);
      assert.strictEqual(result.value.terminalResult.action, 'released');

      // Overage values reported: 100 tokens (400-300), 20 deliberation (80-60)
      assert.strictEqual(result.value.terminalResult.overageTokens, 100,
        'EGP-I12: Token overage = consumed(400) - reserved(300)');
      assert.strictEqual(result.value.terminalResult.overageDeliberation, 20,
        'EGP-I12: Deliberation overage = consumed(80) - reserved(60)');

      // Verify: overage charged to pool, excess to missionDebt
      const state = governor.ledger.getState(conn, missionId);
      assert.ok(state.ok);
      // Token: pool had 50, overage 100 → pool=0, debt=50
      assert.strictEqual(state.value.token.unreservedRemaining, 0,
        'EGP-I12: Unreserved pool drained by overage');
      assert.strictEqual(state.value.token.missionDebt, 50,
        'EGP-I12: Token debt = overage(100) - pool(50)');
      // Deliberation: pool had 10, overage 20 → pool=0, debt=10
      assert.strictEqual(state.value.deliberation.unreservedRemaining, 0,
        'EGP-I12: Deliberation unreserved drained');
      assert.strictEqual(state.value.deliberation.missionDebt, 10,
        'EGP-I12: Deliberation debt = overage(20) - pool(10)');
    });
  });

  // ── BPB-EGP-03: Conservation check wiring (EGP-I13 fail-safe) ──

  describe('Wire-EGP-03: Conservation Check Wiring', () => {

    it('IT-EGP-17: conservationCheck is non-null after released terminal (BPB-EGP-03)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-conserve-check');
      const missionId = testMissionId('mission-conserve');

      // Setup: budget, reservation
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 500, reservedDeliberation: 100,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 500, 100);
      governor.reservations.activate(conn, create.value.reservationId);
      governor.reservations.updateConsumed(conn, create.value.reservationId, 200, 30);

      // Terminal: COMPLETED → released
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'COMPLETED', false);
      assert.ok(result.ok);
      assert.strictEqual(result.value.terminalResult.action, 'released');

      // BPB-EGP-03: conservationCheck must be non-null for released terminals
      assert.notStrictEqual(result.value.conservationCheck, null,
        'conservationCheck must be non-null after release — removing checkConservation() must fail this test');
      assert.strictEqual(result.value.conservationCheck!.holds, true,
        'Conservation must hold after correct lifecycle');
      assert.strictEqual(result.value.conservationHolds, true,
        'conservationHolds reflects conservationCheck.holds');
    });

    it('IT-EGP-17b: conservationHolds defaults to false when check is null (fail-safe)', () => {
      const release = createTerminalRelease(governor);
      const taskId = testTaskId('task-retain-conserve');
      const missionId = testMissionId('mission-retain-conserve');

      // Setup
      governor.ledger.initializeBudget(conn, missionId, 2000, 500);
      const create = governor.reservations.create(conn, ctx, makeReservation({
        taskId, missionId, reservedTokens: 500, reservedDeliberation: 100,
      }));
      assert.ok(create.ok);
      governor.ledger.reserveFromPool(conn, missionId, 500, 100);
      governor.reservations.activate(conn, create.value.reservationId);

      // Terminal: FAILED with retries → retained → no conservation check performed
      const result = release.executeRelease(conn, ctx, taskId, missionId, 'FAILED', true);
      assert.ok(result.ok);
      assert.strictEqual(result.value.terminalResult.action, 'retained');
      assert.strictEqual(result.value.conservationCheck, null,
        'No conservation check for retained reservation');
      assert.strictEqual(result.value.conservationHolds, false,
        'BPB-EGP-03: conservationHolds defaults to false when check is null (fail-safe)');
    });
  });
});
