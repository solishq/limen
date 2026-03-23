/**
 * SC-8 Contract Tests: request_budget -- Facade-Level Verification
 * S ref: S22 (request_budget), S11 (Resource), I-17, I-20 (never-negative),
 *        I-03 (atomic audit), SD-15 (atomic transfer), FM-02 (cost explosion)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT requestBudget directly)
 * Version pins: orchestration.ts frozen zone
 *
 * Amendment 21: Every enforcement DC gets BOTH success AND rejection tests.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONTROL 2: TRUTH MODEL
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. INVARIANTS
 *    - I-20: Budget can never go negative — CHECK constraint + application pre-check.
 *      DCs: DC-SC8-301, DC-SC8-404, DC-SC8-105
 *    - I-03: Every state mutation and its audit entry in same transaction.
 *      DC-SC8-502 (LIVE DEFECT: rejection paths produce NO audit entry)
 *    - SD-15: Atomic budget transfer — parent decrement + child increment in same
 *      SQLite transaction. DCs: DC-SC8-301
 *    - CF-013: Content size limits — justification max 10KB.
 *      DC-SC8-103
 *
 * 2. STATE MACHINES
 *    - Mission state: SC-8 checks mission active state via requestFromParent()
 *      (budget_governance.ts:168-171). Active = CREATED, PLANNING, EXECUTING,
 *      REVIEWING, PAUSED, DEGRADED, BLOCKED. Terminal = COMPLETED, FAILED, CANCELLED.
 *    - Mission → BLOCKED: on HUMAN_APPROVAL_REQUIRED, if mission state is EXECUTING.
 *      DC-SC8-201: non-EXECUTING states silently skip the transition.
 *    - Budget state: parent.token_remaining decremented, child.token_remaining +
 *      token_allocated incremented, atomically within transaction.
 *
 * 3. FAILURE SEMANTICS
 *    - JUSTIFICATION_REQUIRED: empty/whitespace-only justification (line 28, also
 *      redundantly at budget_governance.ts:157). DC-SC8-403
 *    - INVALID_INPUT: justification > 10KB (line 34). NOT in RequestBudgetError type
 *      union. DC-SC8-103
 *    - MISSION_NOT_ACTIVE: mission in terminal state or not found.
 *      DC-SC8-202
 *    - PARENT_INSUFFICIENT: parent remaining < requested amount.
 *      DC-SC8-104 (partial — only tokens)
 *    - HUMAN_APPROVAL_REQUIRED: root mission (no parent). Mission → BLOCKED if
 *      EXECUTING. DC-SC8-201
 *
 * 4. TRUST BOUNDARIES
 *    - SC-8 → BudgetGovernor.requestFromParent(): delegates domain validation
 *      (active state, parent sufficiency, justification). TRUSTED for domain logic.
 *      DC-SC8-301, DC-SC8-403, DC-SC8-502
 *    - SC-8 → EventPropagator.emitLifecycle(): BUDGET_REQUESTED event emitted
 *      regardless of outcome. Return value not checked. DC-SC8-504
 *    - SC-8 → MissionStore.get/transition(): state check + BLOCKED transition.
 *      Transition throws on state mismatch (DC-SC8-903). DC-SC8-201
 *
 * 5. SIDE-EFFECT MODEL
 *    - DB write: parent core_resources.token_remaining decremented
 *    - DB write: child core_resources.token_allocated + token_remaining incremented
 *    - Audit: budget_transfer audit entry (success path only, inside transaction)
 *    - Event: BUDGET_REQUESTED lifecycle event (all paths)
 *    - State transition: mission → BLOCKED (HUMAN_APPROVAL_REQUIRED + EXECUTING only)
 *
 * 6. ENVIRONMENTAL ASSUMPTIONS
 *    - SQLite serialized writes (single-process, WAL mode, better-sqlite3)
 *    - Only tokens dimension is transferable; time/compute/storage silently dropped
 *    - Clock: new Date() used in budget_governance.ts (not in request_budget.ts)
 *    - Root missions have parent_id = null, triggering HUMAN_APPROVAL_REQUIRED
 *
 * DC COVERAGE: DC-SC8-101, DC-SC8-103, DC-SC8-104, DC-SC8-105, DC-SC8-201,
 *   DC-SC8-202, DC-SC8-301, DC-SC8-401, DC-SC8-403, DC-SC8-404, DC-SC8-502,
 *   DC-SC8-903
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  agentId,
  missionId as makeMissionId,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  RequestBudgetInput,
} from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;
let orchestrationDeps: import('../../src/orchestration/interfaces/orchestration.js').OrchestrationDeps;

function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  orchestrationDeps = deps;
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** Transition a mission through the facade using real deps */
function transitionMission(mid: MissionId, from: string, to: string): void {
  const result = engine.missions.transition(
    orchestrationDeps, mid,
    from as import('../../src/orchestration/interfaces/orchestration.js').MissionState,
    to as import('../../src/orchestration/interfaces/orchestration.js').MissionState,
  );
  assert.equal(result.ok, true, `Transition ${from} -> ${to} must succeed`);
}

/** Create a root mission through the facade */
function createRootMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const deadline = new Date(Date.now() + 3600000).toISOString();
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Root mission for budget tests',
    successCriteria: ['Complete the task'],
    scopeBoundaries: ['Within budget'],
    capabilities: ['web_search'],
    constraints: {
      budget: 50000,
      deadline,
      ...(overrides.constraints ?? {}),
    },
    ...overrides,
    constraints: {
      budget: 50000,
      deadline,
      ...(overrides.constraints ?? {}),
    },
  };
  const result = engine.proposeMission(ctx, input);
  assert.equal(result.ok, true, 'Root mission creation must succeed');
  if (!result.ok) throw new Error('Failed to create root mission');
  return result.value.missionId;
}

/** Create a parent-child mission pair through the facade for budget transfer tests */
function createParentChildPair(
  parentBudget = 50000,
  childBudget = 10000,
): { parentId: MissionId; childId: MissionId } {
  const deadline = new Date(Date.now() + 3600000).toISOString();
  const parentId = createRootMission({
    constraints: { budget: parentBudget, deadline },
  });

  const childResult = engine.proposeMission(ctx, {
    parentMissionId: parentId,
    agentId: agentId('agent-child'),
    objective: 'Child mission for budget transfer',
    successCriteria: ['Complete child task'],
    scopeBoundaries: ['Within parent scope'],
    capabilities: ['web_search'],
    constraints: { budget: childBudget, deadline },
  });
  assert.equal(childResult.ok, true, 'Child mission creation must succeed');
  if (!childResult.ok) throw new Error('Failed to create child mission');

  return { parentId, childId: childResult.value.missionId };
}

/** Construct a valid RequestBudgetInput */
function validBudgetInput(
  mid: MissionId,
  overrides: Partial<RequestBudgetInput> = {},
): RequestBudgetInput {
  return {
    missionId: mid,
    amount: { tokens: 500 },
    justification: 'Need additional budget for data processing',
    ...overrides,
  };
}

// ─── A21 State-Unchanged Verification ───

function getBudgetRemaining(conn: DatabaseConnection, mid: MissionId): number {
  return conn.get<{ token_remaining: number }>(
    'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
    [mid],
  )?.token_remaining ?? -1;
}

function getBudgetAllocated(conn: DatabaseConnection, mid: MissionId): number {
  return conn.get<{ token_allocated: number }>(
    'SELECT token_allocated FROM core_resources WHERE mission_id = ?',
    [mid],
  )?.token_allocated ?? -1;
}

function getMissionState(conn: DatabaseConnection, mid: MissionId): string {
  return conn.get<{ state: string }>(
    'SELECT state FROM core_missions WHERE id = ?',
    [mid],
  )?.state ?? 'UNKNOWN';
}

function countBudgetTransferAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'budget_transfer'",
  )?.cnt ?? 0;
}

function countBudgetEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'BUDGET_REQUESTED'",
  )?.cnt ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════
// CONTROL 3: VERIFICATION PACK
// ═══════════════════════════════════════════════════════════════════════

describe('SC-8 Contract: request_budget (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('DC-SC8-104-S: request tokens from parent -> approved, allocated, source=parent', () => {
      // DC-SC8-104 SUCCESS: request { tokens: 500 }, parent has sufficient
      const { parentId, childId } = createParentChildPair(50000, 10000);

      const parentBefore = getBudgetRemaining(conn, parentId);
      const childBefore = getBudgetRemaining(conn, childId);
      const childAllocBefore = getBudgetAllocated(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: 500 },
      }));

      assert.equal(result.ok, true, 'S22: Budget request from parent must succeed');
      if (!result.ok) return;

      assert.equal(result.value.approved, true, 'S22: approved must be true');
      assert.equal(result.value.allocated.tokens, 500, 'S22: allocated.tokens must be 500');
      assert.equal(result.value.source, 'parent', 'S22: source must be parent');

      // SD-15: Verify atomic transfer
      const parentAfter = getBudgetRemaining(conn, parentId);
      const childAfter = getBudgetRemaining(conn, childId);
      const childAllocAfter = getBudgetAllocated(conn, childId);

      assert.equal(parentAfter, parentBefore - 500,
        'SD-15: Parent remaining must decrease by 500');
      assert.equal(childAfter, childBefore + 500,
        'SD-15: Child remaining must increase by 500');
      assert.equal(childAllocAfter, childAllocBefore + 500,
        'SD-15: Child allocated must increase by 500');
    });

    it('DC-SC8-403-S: non-empty justification passes both validation layers', () => {
      // DC-SC8-403 SUCCESS: non-empty justification passes
      const { childId } = createParentChildPair();

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: 'Valid justification for budget request',
      }));

      assert.equal(result.ok, true, 'S22: Non-empty justification must pass');
    });

    it('DC-SC8-103-S: justification at exactly 10240 bytes passes CF-013', () => {
      // DC-SC8-103 SUCCESS: justification at exactly 10KB passes
      const { childId } = createParentChildPair();
      const justification10KB = 'A'.repeat(10240);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: justification10KB,
      }));

      assert.equal(result.ok, true, 'CF-013: Justification at exactly 10240 bytes must pass');
    });

    it('DC-SC8-202-S: mission in EXECUTING state -> request proceeds', () => {
      // DC-SC8-202 SUCCESS: active mission receives budget
      const { parentId, childId } = createParentChildPair();

      // Transition child to EXECUTING through required intermediate states
      // CREATED -> PLANNING -> EXECUTING
      transitionMission(childId, 'CREATED', 'PLANNING');
      transitionMission(childId, 'PLANNING', 'EXECUTING');

      const result = engine.requestBudget(ctx, validBudgetInput(childId));
      assert.equal(result.ok, true, 'S22: EXECUTING mission must receive budget');
    });

    it('DC-SC8-301-S: single request with sufficient parent -> transfer succeeds', () => {
      // DC-SC8-301 SUCCESS: single request, sufficient parent budget
      const { childId } = createParentChildPair(50000, 5000);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: 1000 },
      }));

      assert.equal(result.ok, true, 'S22: Single request with sufficient parent succeeds');
      if (!result.ok) return;
      assert.equal(result.value.allocated.tokens, 1000, 'S22: Allocated tokens must be 1000');
    });

    it('DC-SC8-101-S: tenant A requests budget for own mission -> succeeds', () => {
      // DC-SC8-101 SUCCESS: same-tenant budget request
      const { childId } = createParentChildPair();

      const result = engine.requestBudget(ctx, validBudgetInput(childId));
      assert.equal(result.ok, true, 'FM-10: Same-tenant budget request succeeds');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // REJECTION PATHS — A21 Dual-Path Testing
  // ════════════════════════════════════════════════════════════════════════

  describe('JUSTIFICATION_REQUIRED', () => {

    it('DC-SC8-403-R-EMPTY: empty string justification -> JUSTIFICATION_REQUIRED + state unchanged', () => {
      // DC-SC8-403 REJECTION: empty justification rejected by first layer
      const { childId } = createParentChildPair();
      const budgetBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: '',
      }));

      assert.equal(result.ok, false, 'S22: Empty justification must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'JUSTIFICATION_REQUIRED',
          'S22: Error code must be JUSTIFICATION_REQUIRED');
      }

      // A21: state unchanged
      const budgetAfter = getBudgetRemaining(conn, childId);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after justification rejection');
    });

    it('DC-SC8-403-R-WHITESPACE: whitespace-only justification -> JUSTIFICATION_REQUIRED', () => {
      // DC-SC8-403 REJECTION: whitespace-only justification
      const { childId } = createParentChildPair();

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: '   \t\n  ',
      }));

      assert.equal(result.ok, false, 'S22: Whitespace-only justification must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'JUSTIFICATION_REQUIRED',
          'S22: Error code must be JUSTIFICATION_REQUIRED');
      }
    });
  });

  describe('INVALID_INPUT (CF-013)', () => {

    it('DC-SC8-103-R: justification > 10KB -> INVALID_INPUT + state unchanged', () => {
      // DC-SC8-103 REJECTION: CF-013 size guard
      // Note: INVALID_INPUT is NOT in RequestBudgetError type union (frozen zone gap)
      const { childId } = createParentChildPair();
      const budgetBefore = getBudgetRemaining(conn, childId);

      const oversizedJustification = 'X'.repeat(10241); // 10241 bytes > 10240 limit

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: oversizedJustification,
      }));

      assert.equal(result.ok, false, 'CF-013: Oversized justification must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'CF-013: Error code must be INVALID_INPUT');
        assert.ok(result.error.message.includes('exceeds maximum size'),
          'CF-013: Message must describe size violation');
      }

      // A21: state unchanged
      const budgetAfter = getBudgetRemaining(conn, childId);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after size rejection');
    });
  });

  describe('MISSION_NOT_ACTIVE', () => {

    it('DC-SC8-202-R: mission in COMPLETED state -> MISSION_NOT_ACTIVE + state unchanged', () => {
      // DC-SC8-202 REJECTION: terminal-state mission
      const completedMid = 'completed-mission-sc8';
      seedMission(conn, { id: completedMid, state: 'COMPLETED', parentId: null });
      seedResource(conn, { missionId: completedMid });

      const result = engine.requestBudget(ctx, validBudgetInput(
        makeMissionId(completedMid),
      ));

      assert.equal(result.ok, false, 'S22: COMPLETED mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S22: Error code must be MISSION_NOT_ACTIVE');
      }
    });

    it('DC-SC8-202-R-FAILED: mission in FAILED state -> MISSION_NOT_ACTIVE', () => {
      // DC-SC8-202 REJECTION: FAILED state
      const failedMid = 'failed-mission-sc8';
      seedMission(conn, { id: failedMid, state: 'FAILED', parentId: null });
      seedResource(conn, { missionId: failedMid });

      const result = engine.requestBudget(ctx, validBudgetInput(
        makeMissionId(failedMid),
      ));

      assert.equal(result.ok, false, 'S22: FAILED mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S22: Error code must be MISSION_NOT_ACTIVE');
      }
    });

    it('DC-SC8-202-R-CANCELLED: mission in CANCELLED state -> MISSION_NOT_ACTIVE', () => {
      // DC-SC8-202 REJECTION: CANCELLED state
      const cancelledMid = 'cancelled-mission-sc8';
      seedMission(conn, { id: cancelledMid, state: 'CANCELLED', parentId: null });
      seedResource(conn, { missionId: cancelledMid });

      const result = engine.requestBudget(ctx, validBudgetInput(
        makeMissionId(cancelledMid),
      ));

      assert.equal(result.ok, false, 'S22: CANCELLED mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S22: Error code must be MISSION_NOT_ACTIVE');
      }
    });

    it('DC-SC8-202-NOTFOUND: nonexistent mission -> MISSION_NOT_ACTIVE', () => {
      // Nonexistent mission
      const result = engine.requestBudget(ctx, validBudgetInput(
        makeMissionId('nonexistent-mission-sc8'),
      ));

      assert.equal(result.ok, false, 'S22: Nonexistent mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S22: Error code must be MISSION_NOT_ACTIVE');
      }
    });
  });

  describe('PARENT_INSUFFICIENT', () => {

    it('DC-SC8-301-R: parent remaining < requested -> PARENT_INSUFFICIENT + state unchanged', () => {
      // DC-SC8-301 REJECTION: parent has insufficient remaining
      // Create parent with 50000 budget, child with 10000. Parent remaining after
      // child allocation is 50000 - 10000 = 40000. Request 50000 -> insufficient.
      const { parentId, childId } = createParentChildPair(50000, 10000);

      const parentBefore = getBudgetRemaining(conn, parentId);
      const childBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: parentBefore + 1 }, // Request more than parent has
      }));

      assert.equal(result.ok, false, 'S22: Insufficient parent must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'PARENT_INSUFFICIENT',
          'S22: Error code must be PARENT_INSUFFICIENT');
      }

      // A21: state unchanged
      const parentAfter = getBudgetRemaining(conn, parentId);
      const childAfter = getBudgetRemaining(conn, childId);
      assert.equal(parentAfter, parentBefore,
        'A21: Parent budget must not change after PARENT_INSUFFICIENT');
      assert.equal(childAfter, childBefore,
        'A21: Child budget must not change after PARENT_INSUFFICIENT');
    });
  });

  describe('HUMAN_APPROVAL_REQUIRED', () => {

    it('DC-SC8-201-S: EXECUTING root mission -> HUMAN_APPROVAL_REQUIRED + transition to BLOCKED', () => {
      // DC-SC8-201 SUCCESS path for BLOCKED transition:
      // Root mission in EXECUTING state, HUMAN_APPROVAL_REQUIRED returned,
      // mission transitions to BLOCKED.
      const rootId = createRootMission();

      // Transition to EXECUTING through required intermediate states
      transitionMission(rootId, 'CREATED', 'PLANNING');
      transitionMission(rootId, 'PLANNING', 'EXECUTING');

      assert.equal(getMissionState(conn, rootId), 'EXECUTING', 'Mission must be EXECUTING');

      const result = engine.requestBudget(ctx, validBudgetInput(rootId));

      assert.equal(result.ok, false, 'S22: Root mission must return HUMAN_APPROVAL_REQUIRED');
      if (!result.ok) {
        assert.equal(result.error.code, 'HUMAN_APPROVAL_REQUIRED',
          'S22: Error code must be HUMAN_APPROVAL_REQUIRED');
      }

      // Verify mission transitioned to BLOCKED
      assert.equal(getMissionState(conn, rootId), 'BLOCKED',
        'S22: EXECUTING mission must transition to BLOCKED on HUMAN_APPROVAL_REQUIRED');
    });

    it('DC-SC8-201-R: PLANNING root mission -> HUMAN_APPROVAL_REQUIRED + stays PLANNING (no transition)', () => {
      // DC-SC8-201 REJECTION of BLOCKED transition:
      // Root mission in PLANNING state, HUMAN_APPROVAL_REQUIRED returned,
      // mission stays PLANNING (not BLOCKED) because code checks state === 'EXECUTING'.
      const rootId = createRootMission();

      // Transition to PLANNING only
      transitionMission(rootId, 'CREATED', 'PLANNING');

      assert.equal(getMissionState(conn, rootId), 'PLANNING', 'Mission must be PLANNING');

      const result = engine.requestBudget(ctx, validBudgetInput(rootId));

      assert.equal(result.ok, false, 'S22: Root mission must return HUMAN_APPROVAL_REQUIRED');
      if (!result.ok) {
        assert.equal(result.error.code, 'HUMAN_APPROVAL_REQUIRED',
          'S22: Error code must be HUMAN_APPROVAL_REQUIRED');
      }

      // A21: mission stays PLANNING (BLOCKED transition only applies to EXECUTING)
      assert.equal(getMissionState(conn, rootId), 'PLANNING',
        'A21: PLANNING mission must NOT transition to BLOCKED (only EXECUTING does)');
    });

    it('DC-SC8-201-CREATED: CREATED root mission -> HUMAN_APPROVAL_REQUIRED + stays CREATED', () => {
      // DC-SC8-201: CREATED state -> no BLOCKED transition
      const rootId = createRootMission();
      assert.equal(getMissionState(conn, rootId), 'CREATED', 'Mission must be CREATED');

      const result = engine.requestBudget(ctx, validBudgetInput(rootId));

      assert.equal(result.ok, false, 'S22: Root mission must return HUMAN_APPROVAL_REQUIRED');
      if (!result.ok) {
        assert.equal(result.error.code, 'HUMAN_APPROVAL_REQUIRED',
          'S22: Error code must be HUMAN_APPROVAL_REQUIRED');
      }

      assert.equal(getMissionState(conn, rootId), 'CREATED',
        'A21: CREATED mission must stay CREATED (no BLOCKED transition)');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // LIVE DEFECT TESTS
  // ════════════════════════════════════════════════════════════════════════

  describe('LIVE DEFECT Documentation', () => {

    it('DC-SC8-404-R-NEGATIVE: negative token amount -> INVALID_INPUT (F-002 fix)', () => {
      // FIX: DC-SC8-404 — Negative amounts now rejected by NaN/negative guard.
      const { parentId, childId } = createParentChildPair(50000, 10000);

      const parentBefore = getBudgetRemaining(conn, parentId);
      const childBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: -100 },
        justification: 'Negative amount test',
      }));

      assert.equal(result.ok, false,
        'F-002 FIX: Negative token amount must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-002 FIX: Error code must be INVALID_INPUT');
        assert.ok(result.error.message.includes('-100'),
          'F-002 FIX: Message must include the invalid amount');
      }

      // A21: state unchanged — no transfer occurred
      const parentAfter = getBudgetRemaining(conn, parentId);
      const childAfter = getBudgetRemaining(conn, childId);

      assert.equal(parentAfter, parentBefore,
        'A21: Parent budget must not change after INVALID_INPUT rejection');
      assert.equal(childAfter, childBefore,
        'A21: Child budget must not change after INVALID_INPUT rejection');
    });

    it('DC-SC8-404-R-ZERO: zero token amount -> INVALID_INPUT (F-002 fix)', () => {
      // FIX: DC-SC8-404 — Zero amounts now rejected by guard (tokenAmount <= 0).
      const { childId } = createParentChildPair(50000, 10000);
      const budgetBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: 0 },
        justification: 'Zero amount test',
      }));

      assert.equal(result.ok, false,
        'F-002 FIX: Zero token amount must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-002 FIX: Error code must be INVALID_INPUT');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, childId);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after zero amount rejection');
    });

    it('DC-SC8-105-R: NaN token amount -> INVALID_INPUT (F-002 fix)', () => {
      // FIX: DC-SC8-105 — NaN now caught by Number.isFinite() guard.
      const { childId } = createParentChildPair(50000, 10000);
      const budgetBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: NaN },
        justification: 'NaN amount test',
      }));

      assert.equal(result.ok, false,
        'F-002 FIX: NaN token amount must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-002 FIX: Error code must be INVALID_INPUT');
        assert.ok(result.error.message.includes('NaN'),
          'F-002 FIX: Message must include NaN');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, childId);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after NaN amount rejection');
    });

    it('DC-SC8-502: rejection paths produce NO audit entries', () => {
      // LIVE DEFECT: DC-SC8-502 — Only the success path (inside requestFromParent
      // transaction) produces an audit entry. All rejection paths are unaudited.
      const { childId } = createParentChildPair();

      const auditCountBefore = conn.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM core_audit_log",
      )?.cnt ?? 0;

      // Trigger JUSTIFICATION_REQUIRED rejection
      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: '',
      }));
      assert.equal(result.ok, false, 'Must be rejected');

      const auditCountAfter = conn.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM core_audit_log",
      )?.cnt ?? 0;

      // LIVE DEFECT: DC-SC8-502 — No audit entry for rejection
      assert.equal(auditCountAfter, auditCountBefore,
        'LIVE DEFECT: DC-SC8-502 — JUSTIFICATION_REQUIRED rejection produces ZERO audit entries');
    });

    it('DC-SC8-502-PARENT: PARENT_INSUFFICIENT rejection produces no budget_transfer audit entry', () => {
      // LIVE DEFECT: DC-SC8-502 — requestFromParent() only audits inside the success
      // transaction (line 204-212). PARENT_INSUFFICIENT rejection path has no
      // budget_transfer audit entry. (Note: emitLifecycle at line 43 does produce
      // an emit_event audit entry, but that is a lifecycle event, not a budget audit.)
      const { parentId, childId } = createParentChildPair(50000, 10000);

      const budgetAuditBefore = countBudgetTransferAuditEntries(conn);

      const parentRemaining = getBudgetRemaining(conn, parentId);
      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: parentRemaining + 1 },
      }));
      assert.equal(result.ok, false, 'Must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'PARENT_INSUFFICIENT', 'Must be PARENT_INSUFFICIENT');
      }

      const budgetAuditAfter = countBudgetTransferAuditEntries(conn);

      // LIVE DEFECT: DC-SC8-502 — No budget_transfer audit entry for PARENT_INSUFFICIENT
      assert.equal(budgetAuditAfter, budgetAuditBefore,
        'LIVE DEFECT: DC-SC8-502 — PARENT_INSUFFICIENT rejection produces ZERO budget_transfer audit entries');
    });

    it('DC-SC8-903: missions.transition() throw on HUMAN_APPROVAL_REQUIRED path does not crash when state matches', () => {
      // DC-SC8-903 documents the TOCTOU risk: if mission state changes between
      // missions.get() and missions.transition(), transition() throws.
      // This test verifies the HAPPY path (state matches, no throw).
      // The crash path requires concurrent state changes which cannot be easily
      // triggered in single-threaded SQLite tests.
      const rootId = createRootMission();

      transitionMission(rootId, 'CREATED', 'PLANNING');
      transitionMission(rootId, 'PLANNING', 'EXECUTING');

      // This should NOT throw because state is EXECUTING and transition succeeds
      const result = engine.requestBudget(ctx, validBudgetInput(rootId));

      assert.equal(result.ok, false, 'Must return HUMAN_APPROVAL_REQUIRED');
      if (!result.ok) {
        assert.equal(result.error.code, 'HUMAN_APPROVAL_REQUIRED',
          'Error code must be HUMAN_APPROVAL_REQUIRED');
      }
      assert.equal(getMissionState(conn, rootId), 'BLOCKED',
        'Mission must be BLOCKED (transition succeeded without throw)');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // OBSERVATION TESTS (Non-A21)
  // ════════════════════════════════════════════════════════════════════════

  describe('Observation Tests', () => {

    it('DC-SC8-104: request with only time dimension and tokens=0 -> INVALID_INPUT (F-002 guard)', () => {
      // DC-SC8-104 observation updated: tokens=0 now caught by F-002 guard.
      // Previously this was a "phantom success" (approved with 0 tokens).
      // Now the guard rejects zero tokens before delegation.
      const { childId } = createParentChildPair();

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { time: 100, tokens: 0 },
        justification: 'Requesting time dimension only',
      }));

      // F-002 guard: tokens=0 is now rejected as INVALID_INPUT
      assert.equal(result.ok, false,
        'DC-SC8-104: tokens=0 now rejected by F-002 guard (was phantom success)');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'DC-SC8-104: Error code must be INVALID_INPUT');
      }
    });

    it('BUDGET_REQUESTED event emitted on success', () => {
      // DC-SC8-501 observation: lifecycle event emitted regardless of outcome
      const { childId } = createParentChildPair();
      const eventsBefore = countBudgetEvents(conn);

      const result = engine.requestBudget(ctx, validBudgetInput(childId));
      assert.equal(result.ok, true, 'Request must succeed');

      const eventsAfter = countBudgetEvents(conn);
      assert.equal(eventsAfter, eventsBefore + 1,
        'BUDGET_REQUESTED event must be emitted on success');
    });

    it('BUDGET_REQUESTED event emitted on failure too', () => {
      // DC-SC8-501 observation: event emitted BEFORE error handling (line 43)
      const { parentId, childId } = createParentChildPair(50000, 10000);
      const eventsBefore = countBudgetEvents(conn);

      const parentRemaining = getBudgetRemaining(conn, parentId);
      engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: parentRemaining + 1 },
      }));

      const eventsAfter = countBudgetEvents(conn);
      assert.equal(eventsAfter, eventsBefore + 1,
        'BUDGET_REQUESTED event must be emitted even on failure (emitted before error check)');
    });

    it('Audit entry on success includes justification', () => {
      // DC-SC8-502 observation: success path has audit entry inside transaction
      const { childId } = createParentChildPair();
      const auditBefore = countBudgetTransferAuditEntries(conn);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: 'Audit-tracked justification',
      }));
      assert.equal(result.ok, true, 'Request must succeed');

      const auditAfter = countBudgetTransferAuditEntries(conn);
      assert.equal(auditAfter, auditBefore + 1,
        'budget_transfer audit entry must exist after successful transfer');

      // Verify justification is in the audit detail
      const auditRow = conn.get<{ detail: string }>(
        "SELECT detail FROM core_audit_log WHERE operation = 'budget_transfer' ORDER BY rowid DESC LIMIT 1",
      );
      assert.notEqual(auditRow, undefined, 'Audit row must exist');
      const detail = JSON.parse(auditRow!.detail);
      assert.equal(detail.justification, 'Audit-tracked justification',
        'Audit detail must include the justification text');
    });

    it('DC-SC8-401: _ctx parameter is unused — no authorization check exists', () => {
      // DC-SC8-401 observation: any agent can request budget for any mission.
      // The _ctx parameter at line 20 is prefixed with underscore (unused).
      // We verify by using a different agent context and confirming it still succeeds.
      const { childId } = createParentChildPair();

      const differentCtx = createTestOperationContext({
        agentId: 'different-agent-not-assigned',
        userId: 'different-user',
      });

      const result = engine.requestBudget(differentCtx, validBudgetInput(childId));

      // DC-SC8-401: No authorization check — any agent can request budget
      assert.equal(result.ok, true,
        'DC-SC8-401: Different agent can request budget (no auth check, _ctx unused)');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // F-001 FIX: Discriminative test for SC-8 layer justification guard
  // ════════════════════════════════════════════════════════════════════════

  describe('F-001: SC-8 layer justification guard isolation', () => {

    it('DC-SC8-F001-EMPTY: SC-8 guard rejects empty justification BEFORE reaching requestFromParent (no BUDGET_REQUESTED event)', () => {
      // F-001 REMEDIATION: The SC-8 guard at request_budget.ts:27-29 returns
      // JUSTIFICATION_REQUIRED immediately. This means:
      //   - budget.requestFromParent() at line 40 is NOT called
      //   - events.emitLifecycle() at line 43 is NOT called
      //
      // If the SC-8 guard is removed, the empty justification passes through to
      // requestFromParent() which has its own guard (budget_governance.ts:155-158).
      // After requestFromParent() returns, emitLifecycle() at line 43 DOES fire.
      //
      // DISCRIMINATIVE: SC-8 guard present → 0 BUDGET_REQUESTED events.
      //                 SC-8 guard removed → 1 BUDGET_REQUESTED event (from line 43).
      const { childId } = createParentChildPair();

      const eventsBefore = countBudgetEvents(conn);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: '',
      }));

      assert.equal(result.ok, false, 'S22: Empty justification must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'JUSTIFICATION_REQUIRED',
          'S22: Error code must be JUSTIFICATION_REQUIRED');
      }

      // DISCRIMINATIVE ASSERTION: If the SC-8 layer guard at lines 27-29 fires,
      // the function returns at line 28 BEFORE emitLifecycle at line 43.
      // Therefore ZERO BUDGET_REQUESTED events are emitted.
      // If the guard were removed, emitLifecycle at line 43 would fire (1 event).
      const eventsAfter = countBudgetEvents(conn);
      assert.equal(eventsAfter, eventsBefore,
        'F-001: SC-8 guard must reject BEFORE emitLifecycle (zero BUDGET_REQUESTED events). ' +
        'If this fails, the SC-8 layer guard was removed and the delegate guard caught the rejection.');
    });

    it('DC-SC8-F001-WHITESPACE: SC-8 guard rejects whitespace justification BEFORE reaching requestFromParent', () => {
      // Same as above but with whitespace-only justification.
      // DISCRIMINATIVE: Same logic — SC-8 guard returns before emitLifecycle.
      const { childId } = createParentChildPair();

      const eventsBefore = countBudgetEvents(conn);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        justification: '   \t\n  ',
      }));

      assert.equal(result.ok, false, 'S22: Whitespace justification must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'JUSTIFICATION_REQUIRED',
          'S22: Error code must be JUSTIFICATION_REQUIRED');
      }

      const eventsAfter = countBudgetEvents(conn);
      assert.equal(eventsAfter, eventsBefore,
        'F-001: SC-8 guard must reject BEFORE emitLifecycle (zero BUDGET_REQUESTED events)');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // F-002 GUARD TESTS — NaN/Infinity/Negative/Zero token amount
  // ════════════════════════════════════════════════════════════════════════

  describe('F-002: NaN/Infinity/Negative/Zero guard on tokenAmount', () => {

    it('DC-SC8-105-S: finite positive tokenAmount -> transfer proceeds', () => {
      // DC-SC8-105 SUCCESS: valid positive token amount
      const { childId } = createParentChildPair(50000, 10000);
      const budgetBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: 500 },
      }));

      assert.equal(result.ok, true,
        'F-002: Finite positive token amount must succeed');
      if (!result.ok) return;

      assert.equal(result.value.allocated.tokens, 500,
        'F-002: Allocated tokens must be 500');

      const budgetAfter = getBudgetRemaining(conn, childId);
      assert.equal(budgetAfter, budgetBefore + 500,
        'F-002: Child budget must increase by 500');
    });

    it('DC-SC8-105-R-INFINITY: Infinity tokenAmount -> INVALID_INPUT', () => {
      // DC-SC8-105 REJECTION: Infinity caught by Number.isFinite() guard
      const { childId } = createParentChildPair(50000, 10000);
      const budgetBefore = getBudgetRemaining(conn, childId);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: Infinity },
        justification: 'Infinity amount test',
      }));

      assert.equal(result.ok, false,
        'F-002: Infinity token amount must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-002: Error code must be INVALID_INPUT');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, childId);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after Infinity amount rejection');
    });

    it('DC-SC8-105-R-NEG-INFINITY: -Infinity tokenAmount -> INVALID_INPUT', () => {
      // DC-SC8-105 REJECTION: -Infinity caught by Number.isFinite() guard
      const { childId } = createParentChildPair(50000, 10000);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: -Infinity },
        justification: '-Infinity amount test',
      }));

      assert.equal(result.ok, false,
        'F-002: -Infinity token amount must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-002: Error code must be INVALID_INPUT');
      }
    });

    it('DC-SC8-F002-NO-EVENT: INVALID_INPUT rejection fires BEFORE emitLifecycle (zero events)', () => {
      // DISCRIMINATIVE: F-002 guard at request_budget.ts:41-43 returns BEFORE
      // emitLifecycle at line 48. If guard is removed, emitLifecycle fires.
      const { childId } = createParentChildPair(50000, 10000);
      const eventsBefore = countBudgetEvents(conn);

      const result = engine.requestBudget(ctx, validBudgetInput(childId, {
        amount: { tokens: NaN },
        justification: 'NaN event test',
      }));

      assert.equal(result.ok, false, 'Must be rejected');

      const eventsAfter = countBudgetEvents(conn);
      assert.equal(eventsAfter, eventsBefore,
        'F-002: Guard must reject BEFORE emitLifecycle (zero BUDGET_REQUESTED events)');
    });
  });
});
