/**
 * Limen v1.0 — CGP ↔ DBA Integration Tests
 * Phase 2B: Cross-Subsystem Wiring Verification — ECB Computation
 *
 * These tests verify live DBA ECB computation flows through the CGP admission pipeline
 * via the EcbProvider boundary. No mocks of the DBA formula — real DBA computation.
 *
 * Defect classes: DC-ECB-001 through DC-ECB-011
 * Key invariants: I-52 (per-invocation), I-53 (ECB formula), I-54 (overhead boundary),
 *                 I-55 (ceiling hierarchy), I-61 (audit transparency)
 *
 * Pattern:
 *   1. Create test-configured EcbProvider (uses real DBA formula + ceiling resolution
 *      but with controllable window values)
 *   2. Create CGP governor via stores (inject test EcbProvider)
 *   3. Call governor.admitContextWithLiveBudget() — verify ECB computation + admission
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// CGP — stores for direct governor creation with test deps
import {
  createContextGovernor,
} from '../../src/context/stores/cgp_stores.js';
import type {
  ContextGovernor,
  TaskContextSpec,
  ContextInvocationId,
  EcbProvider,
  EcbAuditInputs,
  BudgetComputationInputs,
} from '../../src/context/interfaces/cgp_types.js';

// DBA — real services for formula computation
import { createDBAHarness } from '../../src/budget/harness/dba_harness.js';

// CGP harness — for end-to-end test (IT-ECB-14)
import { createContextGovernor as createHarnessGovernor } from '../../src/context/harness/cgp_harness.js';

// Test infrastructure
import type { DatabaseConnection, TaskId, AgentId, MissionId, Result } from '../../src/kernel/interfaces/index.js';
import {
  createTestDatabase,
  seedMission,
} from '../helpers/test_database.js';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_MISSION = 'mission-ecb-001';
const TEST_TASK = 'task-ecb-001';
const TEST_AGENT = 'agent-ecb-001';
const TEST_MODEL = 'test-model-ecb';

function testTaskId(id: string = TEST_TASK): TaskId {
  return id as TaskId;
}

function testMissionId(id: string = TEST_MISSION): MissionId {
  return id as MissionId;
}

function testInvocationId(id: string = 'inv-ecb-001'): ContextInvocationId {
  return id as ContextInvocationId;
}

/** Seed a task into the database */
function seedTask(c: DatabaseConnection, options: {
  id: string;
  missionId: string;
  state?: string;
  agentId?: string;
}): void {
  const now = new Date().toISOString();
  const state = options.state ?? 'RUNNING';
  const agentIdVal = options.agentId ?? TEST_AGENT;

  const graphId = `graph-${options.missionId}`;
  const existingGraph = c.get<{ id: string }>(
    'SELECT id FROM core_task_graphs WHERE id = ?', [graphId],
  );
  if (!existingGraph) {
    c.run(
      `INSERT INTO core_task_graphs (id, mission_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, 1, 'Aligned with test objective', 1, ?)`,
      [graphId, options.missionId, now],
    );
  }

  const completedAt = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state) ? now : null;
  c.run(
    `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, assigned_agent, retry_count, max_retries, created_at, updated_at, completed_at)
     VALUES (?, ?, 'test-tenant', ?, 'ECB integration test task', 'deterministic', 100, '[]', ?, ?, 0, 3, ?, ?, ?)`,
    [options.id, options.missionId, graphId, state, agentIdVal, now, now, completedAt],
  );
}

function seedMissionAndTask(c: DatabaseConnection, opts?: {
  missionId?: string;
  taskId?: string;
}): void {
  const mid = opts?.missionId ?? TEST_MISSION;
  const tid = opts?.taskId ?? TEST_TASK;
  seedMission(c, { id: mid, state: 'EXECUTING' });
  seedTask(c, { id: tid, missionId: mid });
}

function makeTaskSpec(overrides?: Partial<TaskContextSpec>): TaskContextSpec {
  return {
    taskId: testTaskId(),
    missionId: testMissionId(),
    isChatMode: false,
    ...overrides,
  };
}

/**
 * Create an EcbProvider backed by real DBA services but with a configurable window.
 *
 * Uses real DBA formula (I-53), real ceiling resolution (I-55).
 * The availableInputWindow is test-controlled to enable deterministic assertions.
 */
function createTestEcbProvider(config: {
  availableInputWindow: number;
}): EcbProvider {
  const dba = createDBAHarness();

  return Object.freeze({
    computeECB(params: {
      readonly modelId: string;
      readonly systemOverhead: number;
      readonly missionCeiling: number | null;
      readonly taskCeiling: number | null;
    }): Result<{ readonly effectiveContextBudget: number; readonly auditInputs: EcbAuditInputs }> {
      const effectivePolicyCeiling = dba.policyGovernor.mergeEffectiveCeiling(
        params.missionCeiling,
        params.taskCeiling,
      );
      const overheadBasis = dba.overhead.getBasis();
      const ecbResult = dba.ecb.compute({
        availableInputWindow: config.availableInputWindow,
        windowDerivationMode: 'provider_authoritative',
        kernelDerivationVersion: null,
        systemOverhead: params.systemOverhead,
        overheadComputationBasis: overheadBasis.computationVersion,
        effectivePolicyCeiling,
      });

      return {
        ok: true as const,
        value: Object.freeze({
          effectiveContextBudget: ecbResult.effectiveContextBudget,
          auditInputs: Object.freeze({
            availableInputWindow: config.availableInputWindow,
            systemOverhead: params.systemOverhead,
            effectivePolicyCeiling,
            wasNormalized: ecbResult.wasNormalized,
            rawValue: ecbResult.rawValue,
            windowDerivationMode: 'provider_authoritative',
            overheadComputationBasis: overheadBasis.computationVersion,
          }),
        }),
      };
    },
  });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('CGP ↔ DBA Integration: ECB Computation Wire', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
    seedMissionAndTask(conn);
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-01: ECB computed fresh per admission cycle (DC-ECB-001 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-01: ECB computed fresh per admission cycle [DC-ECB-001, I-52]', () => {
    // Cycle 1: window = 8000, overhead = 1000, no ceiling → ECB = 7000
    const provider1 = createTestEcbProvider({ availableInputWindow: 8000 });
    const governor1 = createContextGovernor({ ecbProvider: provider1 });
    const result1 = governor1.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-cycle-1'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );
    assert.ok(result1.ok, 'Cycle 1 must succeed');
    assert.strictEqual(
      result1.value.replayRecord.effectiveContextBudget, 7000,
      'DC-ECB-001: Cycle 1 ECB = 8000 - 1000 = 7000',
    );

    // Cycle 2: window = 16000, same overhead → ECB = 15000
    const provider2 = createTestEcbProvider({ availableInputWindow: 16000 });
    const governor2 = createContextGovernor({ ecbProvider: provider2 });
    const result2 = governor2.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-cycle-2'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );
    assert.ok(result2.ok, 'Cycle 2 must succeed');
    assert.strictEqual(
      result2.value.replayRecord.effectiveContextBudget, 15000,
      'DC-ECB-001: Cycle 2 ECB = 16000 - 1000 = 15000',
    );

    // Discriminative: the two ECBs MUST differ (proves per-invocation computation)
    assert.notStrictEqual(
      result1.value.replayRecord.effectiveContextBudget,
      result2.value.replayRecord.effectiveContextBudget,
      'DC-ECB-001: Different inputs must produce different ECBs (I-52 per-invocation)',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-02: ECB formula — ceiling constrains (DC-ECB-002 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-02: ECB formula — ceiling constrains [DC-ECB-002, I-53]', () => {
    // modelWindow = 8000, overhead = 1000, ceiling = 4000
    // ECB = min(8000 - 1000, 4000) = min(7000, 4000) = 4000
    const provider = createTestEcbProvider({ availableInputWindow: 8000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-ceil'),
      { systemOverhead: 1000, missionCeiling: 4000, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed');
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 4000,
      'DC-ECB-002: ECB = min(7000, 4000) = 4000 (ceiling constrains)',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-03: ECB formula — window constrains (DC-ECB-002 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-03: ECB formula — window constrains [DC-ECB-002, I-53]', () => {
    // modelWindow = 8000, overhead = 1000, ceiling = 10000
    // ECB = min(8000 - 1000, 10000) = min(7000, 10000) = 7000
    const provider = createTestEcbProvider({ availableInputWindow: 8000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-win'),
      { systemOverhead: 1000, missionCeiling: 10000, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed');
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 7000,
      'DC-ECB-002: ECB = min(7000, 10000) = 7000 (window constrains)',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-04: ECB formula — null ceiling = unconstrained (DC-ECB-007 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-04: null ceiling = unconstrained [DC-ECB-007, I-53]', () => {
    // modelWindow = 8000, overhead = 1000, ceiling = null
    // ECB = min(7000, ∞) = 7000
    const provider = createTestEcbProvider({ availableInputWindow: 8000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-null-ceil'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed');
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 7000,
      'DC-ECB-007: null ceiling = unconstrained, ECB = window - overhead = 7000',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-05: Null ceiling does NOT produce zero/NaN (DC-ECB-007 rejection)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-05: null ceiling does NOT produce zero/NaN [DC-ECB-007 rejection]', () => {
    const provider = createTestEcbProvider({ availableInputWindow: 8000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-null-reject'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed');
    const ecb = result.value.replayRecord.effectiveContextBudget;
    assert.notStrictEqual(ecb, 0, 'DC-ECB-007: null ceiling must NOT produce ECB = 0');
    assert.ok(!Number.isNaN(ecb), 'DC-ECB-007: null ceiling must NOT produce NaN');
    assert.ok(ecb !== undefined, 'DC-ECB-007: null ceiling must NOT produce undefined');
    assert.ok(ecb > 0, 'DC-ECB-007: with window > overhead and null ceiling, ECB must be positive');
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-06: ECB clamped to zero when overhead exceeds window (DC-ECB-010 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-06: ECB clamped to zero when overhead exceeds window [DC-ECB-010, I-53]', () => {
    // modelWindow = 1000, overhead = 2000 → raw = -1000 → ECB = 0 (DBA-I14)
    const provider = createTestEcbProvider({ availableInputWindow: 1000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-zero'),
      { systemOverhead: 2000, missionCeiling: null, taskCeiling: null },
    );
    // Pipeline returns ok() — failure is encoded in admissionResult
    assert.ok(result.ok, 'Pipeline must succeed (failure encoded in admissionResult)');
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 0,
      'DC-ECB-010: ECB clamped to 0 when overhead > window (DBA-I14)',
    );
    // ECB audit should show normalization was applied
    assert.ok(result.value.replayRecord.ecbAuditInputs,
      'ECB audit inputs must be present');
    assert.strictEqual(
      result.value.replayRecord.ecbAuditInputs!.wasNormalized, true,
      'DC-ECB-010: wasNormalized must be true when raw < 0',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-07: ECB = 0 triggers CONTROL_STATE_OVERFLOW (DC-ECB-010 rejection)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-07: ECB = 0 triggers CONTROL_STATE_OVERFLOW when P1 > 0 [DC-ECB-010 rejection]', () => {
    // Force ECB = 0 by making overhead >> window
    const provider = createTestEcbProvider({ availableInputWindow: 100 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-overflow'),
      { systemOverhead: 10000, missionCeiling: null, taskCeiling: null },
    );
    // Pipeline returns ok() but admissionResult encodes the failure.
    // P1 always has non-zero cost (mission objective text). ECB = 0 → P1 > ECB → OVERFLOW.
    assert.ok(result.ok, 'Pipeline must return a result (failure encoded in admissionResult)');
    assert.strictEqual(
      result.value.admissionResult, 'CONTROL_STATE_OVERFLOW',
      'DC-ECB-010: ECB = 0 with P1 > 0 must produce CONTROL_STATE_OVERFLOW, not silent empty context',
    );
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 0,
      'DC-ECB-010: ECB must be 0 (clamped from negative)',
    );
    assert.strictEqual(
      result.value.admittedCandidates.length, 0,
      'DC-ECB-010: No candidates admitted when ECB = 0',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-08: System overhead excludes P1 content (DC-ECB-003)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-08: system overhead excludes P1 content [DC-ECB-003, I-54]', () => {
    // System overhead = 500 (infrastructure). P1 content has its own token cost.
    // ECB should be computed from overhead alone, not overhead + P1.
    // With window = 10000, overhead = 500: ECB = 9500
    // P1 token cost is separate — it's checked AGAINST ECB, not added to overhead.
    const provider = createTestEcbProvider({ availableInputWindow: 10000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-overhead'),
      { systemOverhead: 500, missionCeiling: null, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed with generous budget');

    const ecb = result.value.replayRecord.effectiveContextBudget;
    assert.strictEqual(ecb, 9500, 'DC-ECB-003: ECB = 10000 - 500 = 9500 (overhead only, not P1)');

    // P1 cost is deducted from ECB during admission, NOT added to overhead
    const p1Cost = result.value.replayRecord.position1.tokenCost;
    assert.ok(p1Cost > 0, 'P1 control state must have non-zero token cost');
    assert.ok(p1Cost <= ecb, 'P1 must fit within ECB (overhead did not include P1)');
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-09: Ceiling hierarchy — task more restrictive wins (DC-ECB-006 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-09: task ceiling more restrictive wins [DC-ECB-006, I-55]', () => {
    // Mission = 10000, task = 5000 → effective = 5000 (task wins)
    // Window = 20000, overhead = 1000 → ECB = min(19000, 5000) = 5000
    const provider = createTestEcbProvider({ availableInputWindow: 20000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-task-ceil'),
      { systemOverhead: 1000, missionCeiling: 10000, taskCeiling: 5000 },
    );
    assert.ok(result.ok, 'Admission must succeed');
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 5000,
      'DC-ECB-006: task ceiling (5000) more restrictive than mission (10000) → ECB = 5000',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-10: Ceiling hierarchy — mission more restrictive wins (DC-ECB-006 rejection)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-10: mission ceiling more restrictive wins [DC-ECB-006 rejection, I-55]', () => {
    // Mission = 5000, task = 10000 → effective = 5000 (mission wins)
    // Window = 20000, overhead = 1000 → ECB = min(19000, 5000) = 5000
    const provider = createTestEcbProvider({ availableInputWindow: 20000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-mission-ceil'),
      { systemOverhead: 1000, missionCeiling: 5000, taskCeiling: 10000 },
    );
    assert.ok(result.ok, 'Admission must succeed');
    assert.strictEqual(
      result.value.replayRecord.effectiveContextBudget, 5000,
      'DC-ECB-006: mission ceiling (5000) more restrictive than task (10000) → ECB = 5000',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-11: ECB inputs recorded in admission record (DC-ECB-008 success)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-11: ECB inputs recorded in admission record [DC-ECB-008, I-61]', () => {
    const provider = createTestEcbProvider({ availableInputWindow: 8000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-audit'),
      { systemOverhead: 1000, missionCeiling: 6000, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed');

    const record = result.value.replayRecord;
    assert.ok(record.ecbAuditInputs, 'DC-ECB-008: ecbAuditInputs must be present');

    const audit = record.ecbAuditInputs!;
    assert.strictEqual(audit.availableInputWindow, 8000,
      'DC-ECB-008: availableInputWindow recorded correctly');
    assert.strictEqual(audit.systemOverhead, 1000,
      'DC-ECB-008: systemOverhead recorded correctly');
    assert.strictEqual(audit.effectivePolicyCeiling, 6000,
      'DC-ECB-008: effectivePolicyCeiling recorded correctly');
    assert.strictEqual(record.effectiveContextBudget, 6000,
      'DC-ECB-008: ECB = min(7000, 6000) = 6000');

    // All four key values present and consistent
    const expectedEcb = Math.min(
      audit.availableInputWindow - audit.systemOverhead,
      audit.effectivePolicyCeiling ?? Infinity,
    );
    const clampedEcb = expectedEcb < 0 ? 0 : expectedEcb;
    assert.strictEqual(record.effectiveContextBudget, clampedEcb,
      'DC-ECB-008: ECB reconstructable from audit inputs');
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-12: Overhead breakdown recorded (DC-ECB-009)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-12: overhead breakdown recorded [DC-ECB-009, I-63]', () => {
    const provider = createTestEcbProvider({ availableInputWindow: 10000 });
    const governor = createContextGovernor({ ecbProvider: provider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-breakdown'),
      { systemOverhead: 750, missionCeiling: null, taskCeiling: null },
    );
    assert.ok(result.ok, 'Admission must succeed');

    const audit = result.value.replayRecord.ecbAuditInputs;
    assert.ok(audit, 'ecbAuditInputs must be present');
    assert.strictEqual(audit!.systemOverhead, 750,
      'DC-ECB-009: overhead value recorded');
    assert.ok(typeof audit!.overheadComputationBasis === 'string',
      'DC-ECB-009: overhead computation basis recorded');
    assert.ok(audit!.overheadComputationBasis.length > 0,
      'DC-ECB-009: overhead computation basis is non-empty');
    assert.ok(typeof audit!.windowDerivationMode === 'string',
      'DC-ECB-009: window derivation mode recorded');
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-13: DBA failure = admission failure (DC-ECB-011 rejection)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-13: DBA failure = admission failure [DC-ECB-011]', () => {
    // Create an EcbProvider that throws
    const failingProvider: EcbProvider = Object.freeze({
      computeECB(_params: {
        readonly modelId: string;
        readonly systemOverhead: number;
        readonly missionCeiling: number | null;
        readonly taskCeiling: number | null;
      }) {
        throw new Error('DBA compute service unavailable');
      },
    });

    const governor = createContextGovernor({ ecbProvider: failingProvider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-dba-fail'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );

    // DC-ECB-011: DBA failure = admission failure. NOT graceful degradation.
    assert.ok(!result.ok, 'DC-ECB-011: DBA failure must fail admission');
    assert.strictEqual(
      result.error.code, 'ECB_COMPUTATION_FAILED',
      'DC-ECB-011: Must fail with ECB_COMPUTATION_FAILED, not use ECB=0 or ECB=Infinity',
    );
    assert.ok(
      result.error.message.includes('DBA compute service unavailable'),
      'DC-ECB-011: Error message must include DBA failure details',
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-14: ECB correctly constrains total admission (end-to-end)
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-14: ECB constrains admission end-to-end [I-53, I-52]', () => {
    // Use the harness governor (real DBA services, real window = ~127500)
    // With high overhead to force a tight budget
    const governor = createHarnessGovernor();

    // The real DBA window service returns ~127500 tokens.
    // Set overhead very high to create a tight ECB.
    // With overhead = 127000, ECB = ~500. P1 control state will consume some of that.
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-ecb-e2e'),
      { systemOverhead: 127000, missionCeiling: null, taskCeiling: null },
    );

    if (result.ok) {
      // Verify total admitted cost ≤ ECB
      const ecb = result.value.replayRecord.effectiveContextBudget;
      const totalCost = result.value.replayRecord.totalAdmittedCost;
      assert.ok(ecb > 0, 'ECB must be positive with window > overhead');
      assert.ok(totalCost <= ecb,
        `IT-ECB-14: total admitted cost (${totalCost}) must be ≤ ECB (${ecb})`,
      );

      // Verify ECB audit inputs are present
      assert.ok(result.value.replayRecord.ecbAuditInputs,
        'IT-ECB-14: ECB audit inputs must be in replay record');
    } else {
      // CONTROL_STATE_OVERFLOW is acceptable if P1 > ECB with such tight budget
      assert.strictEqual(result.error.code, 'CONTROL_STATE_OVERFLOW',
        'IT-ECB-14: only CONTROL_STATE_OVERFLOW is acceptable as failure mode');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-15: NaN ECB from provider is rejected [F-01, I-53]
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-15: NaN ECB from provider causes admission failure [F-01, I-53]', () => {
    // F-01: A provider returning ok:true with ECB = NaN must be rejected.
    // NaN corrupts all numeric comparisons — the admission algorithm would
    // silently evict all non-protected candidates without reporting an error.
    const nanProvider: EcbProvider = Object.freeze({
      computeECB(_params: {
        readonly modelId: string;
        readonly systemOverhead: number;
        readonly missionCeiling: number | null;
        readonly taskCeiling: number | null;
      }): Result<{ readonly effectiveContextBudget: number; readonly auditInputs: EcbAuditInputs }> {
        return {
          ok: true as const,
          value: Object.freeze({
            effectiveContextBudget: NaN,
            auditInputs: Object.freeze({
              availableInputWindow: 127500,
              systemOverhead: 1000,
              effectivePolicyCeiling: null,
              wasNormalized: false,
              rawValue: NaN,
              windowDerivationMode: 'provider_authoritative',
              overheadComputationBasis: 'v1',
            }),
          }),
        };
      },
    });

    const governor = createContextGovernor({ ecbProvider: nanProvider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-nan'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );

    assert.strictEqual(result.ok, false,
      'IT-ECB-15: NaN ECB must cause admission failure, not silent passthrough');
    assert.strictEqual(result.error.code, 'ECB_COMPUTATION_FAILED',
      'IT-ECB-15: error code must be ECB_COMPUTATION_FAILED');
    assert.ok(result.error.message.includes('NaN'),
      'IT-ECB-15: error message must reference the invalid value');
  });

  // ────────────────────────────────────────────────────────────────────────
  // IT-ECB-16: Infinity ECB from provider is rejected [F-01, I-53]
  // ────────────────────────────────────────────────────────────────────────
  it('IT-ECB-16: Infinity ECB from provider causes admission failure [F-01, I-53]', () => {
    // F-01: A provider returning ok:true with ECB = Infinity must be rejected.
    // Infinity bypasses all budget constraints — every candidate admitted regardless of size.
    const infProvider: EcbProvider = Object.freeze({
      computeECB(_params: {
        readonly modelId: string;
        readonly systemOverhead: number;
        readonly missionCeiling: number | null;
        readonly taskCeiling: number | null;
      }): Result<{ readonly effectiveContextBudget: number; readonly auditInputs: EcbAuditInputs }> {
        return {
          ok: true as const,
          value: Object.freeze({
            effectiveContextBudget: Infinity,
            auditInputs: Object.freeze({
              availableInputWindow: Infinity,
              systemOverhead: 1000,
              effectivePolicyCeiling: null,
              wasNormalized: false,
              rawValue: Infinity,
              windowDerivationMode: 'provider_authoritative',
              overheadComputationBasis: 'v1',
            }),
          }),
        };
      },
    });

    const governor = createContextGovernor({ ecbProvider: infProvider });
    const result = governor.admitContextWithLiveBudget(
      conn, makeTaskSpec(), TEST_MODEL, testInvocationId('inv-inf'),
      { systemOverhead: 1000, missionCeiling: null, taskCeiling: null },
    );

    assert.strictEqual(result.ok, false,
      'IT-ECB-16: Infinity ECB must cause admission failure, not silent passthrough');
    assert.strictEqual(result.error.code, 'ECB_COMPUTATION_FAILED',
      'IT-ECB-16: error code must be ECB_COMPUTATION_FAILED');
    assert.ok(result.error.message.includes('Infinity'),
      'IT-ECB-16: error message must reference the invalid value');
  });
});
