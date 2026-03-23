/**
 * Rejection-Path Tests: Constitutional Debt Remediation
 * Closes 3 surviving mutations from Review Pass on Debts 2 & 3.
 *
 * M1: Audit tenantId in budget_governance — verify tenant flows to audit entries
 * M2: TransitionEnforcer phantom entity rejection — verify non-existent entities rejected
 * M3: EGP handleOverage RESERVATION_NOT_FOUND — verify rejection when no reservation
 *
 * Spec refs: I-03 (atomic audit), FM-10 (tenant isolation), ST-060..062 (lifecycle),
 *            EGP-I14 (overage enforcement), Hard Ban #24, Amendment 21
 *
 * Phase: 2 Cleanup (remediation)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── M1: Audit tenantId verification ──
import { createOrchestration } from '../../src/orchestration/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import {
  createTestDatabase,
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  agentId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId, TaskId } from '../../src/kernel/interfaces/index.js';
import type { ProposeMissionInput } from '../../src/orchestration/interfaces/orchestration.js';

// ── M2: TransitionEnforcer phantom entity rejection ──
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { runId, handoffId } from '../helpers/governance_test_helpers.js';
import { taskId } from '../helpers/test_database.js';

// ── M3: EGP handleOverage RESERVATION_NOT_FOUND ──
import { createExecutionGovernor } from '../../src/execution/harness/egp_harness.js';
import type { ExecutionGovernor, ExecutionGovernorDeps, EGPOperationContext } from '../../src/execution/interfaces/egp_types.js';

// ============================================================================
// M1: Audit tenantId Verification
// Closes: Mutation M1 — budget_governance tenantId reverted to null survives
// Proves: Debt 3 fix propagates tenantId from mission/resource into audit entries
// ============================================================================

describe('M1: Audit tenantId flows to budget_transfer entries (Debt 3)', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let engine: OrchestrationEngine;
  let orchestrationDeps: import('../../src/orchestration/interfaces/orchestration.js').OrchestrationDeps;

  function setup(): void {
    const { deps, conn: c, audit } = createTestOrchestrationDeps();
    conn = c;
    ctx = createTestOperationContext(); // tenantId = 'test-tenant'
    orchestrationDeps = deps;
    engine = createOrchestration(conn, deps.substrate, audit);
  }

  function validRootInput(overrides: Partial<ProposeMissionInput> = {}): ProposeMissionInput {
    return {
      parentMissionId: null,
      agentId: agentId('agent-1'),
      objective: 'Audit tenantId test mission',
      successCriteria: ['Complete'],
      scopeBoundaries: ['Within budget'],
      capabilities: ['web_search'],
      constraints: {
        budget: 5000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        ...(overrides.constraints ?? {}),
      },
      ...overrides,
      constraints: {
        budget: overrides.constraints?.budget ?? 5000,
        deadline: overrides.constraints?.deadline ?? new Date(Date.now() + 3600000).toISOString(),
        ...(overrides.constraints ?? {}),
      },
    };
  }

  beforeEach(() => { setup(); });

  it('BRK-M1-01: propose_mission audit entry has non-null tenant_id', () => {
    // SETUP: Create a root mission via the orchestration facade.
    // The OperationContext has tenantId = 'test-tenant'.
    const result = engine.proposeMission(ctx, validRootInput());
    assert.equal(result.ok, true, 'Mission creation must succeed');
    if (!result.ok) return;
    const mid = result.value.missionId;

    // VERIFY: Audit entry for propose_mission has tenant_id set (not null).
    // This catches the mutation where tenantId is reverted to null in audit.append().
    const auditRow = conn.get<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM core_audit_log WHERE operation = 'propose_mission' AND resource_id = ?",
      [mid],
    );
    assert.ok(auditRow, 'I-03: Audit entry must exist');
    assert.notEqual(auditRow!.tenant_id, null,
      'FM-10/Debt3: Audit entry tenant_id must be non-null for tenant-scoped operations');
    assert.equal(auditRow!.tenant_id, 'test-tenant',
      'FM-10/Debt3: Audit entry tenant_id must match OperationContext.tenantId');
  });

  it('BRK-M1-02: budget_transfer audit entry has non-null tenant_id', () => {
    // SETUP: Create parent and child missions, then request budget transfer.
    // This exercises budget_governance.requestFromParent audit path.
    const parentResult = engine.proposeMission(ctx, validRootInput({
      objective: 'Parent for budget transfer audit test',
    }));
    assert.equal(parentResult.ok, true, 'Parent creation must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    const childResult = engine.proposeMission(ctx, validRootInput({
      parentMissionId: parentId,
      agentId: agentId('agent-child'),
      objective: 'Child for budget transfer audit test',
      constraints: {
        budget: 500,
        deadline: new Date(Date.now() + 1800000).toISOString(),
      },
    }));
    assert.equal(childResult.ok, true, 'Child creation must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // Request budget transfer from parent to child
    const budgetResult = engine.requestBudget(ctx, {
      missionId: childId,
      amount: { tokens: 200 },
      justification: 'Testing audit tenantId propagation',
    });
    assert.equal(budgetResult.ok, true, 'Budget request must succeed');

    // VERIFY: budget_transfer audit entry has non-null tenant_id
    const auditRow = conn.get<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM core_audit_log WHERE operation = 'budget_transfer' ORDER BY rowid DESC LIMIT 1",
    );
    assert.ok(auditRow, 'I-03: Budget transfer audit entry must exist');
    assert.notEqual(auditRow!.tenant_id, null,
      'FM-10/Debt3: budget_transfer audit tenant_id must be non-null');
    assert.equal(auditRow!.tenant_id, 'test-tenant',
      'FM-10/Debt3: budget_transfer audit tenant_id must match context');
  });

  it('BRK-M1-03: mission_transition audit entry has non-null tenant_id', () => {
    // SETUP: Create a mission and explicitly transition it via MissionStore.transition().
    // This exercises the Debt 3 fix in mission_store.ts transition() that derives
    // tenantId from the mission record for the audit entry.
    const result = engine.proposeMission(ctx, validRootInput());
    assert.equal(result.ok, true, 'Mission creation must succeed');
    if (!result.ok) return;
    const mid = result.value.missionId;

    // Transition CREATED -> PLANNING (exercises mission_store.transition)
    const transResult = engine.missions.transition(
      orchestrationDeps, mid,
      'CREATED' as import('../../src/orchestration/interfaces/orchestration.js').MissionState,
      'PLANNING' as import('../../src/orchestration/interfaces/orchestration.js').MissionState,
    );
    assert.equal(transResult.ok, true, 'Transition CREATED -> PLANNING must succeed');

    // VERIFY: mission_transition audit entry has non-null tenant_id
    const auditRow = conn.get<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM core_audit_log WHERE operation = 'mission_transition' AND resource_id = ?",
      [mid],
    );
    assert.ok(auditRow, 'I-03: mission_transition audit entry must exist');
    assert.notEqual(auditRow!.tenant_id, null,
      'FM-10/Debt3: mission_transition audit tenant_id must be non-null');
    assert.equal(auditRow!.tenant_id, 'test-tenant',
      'FM-10/Debt3: mission_transition audit tenant_id must match mission tenant');
  });
});

// ============================================================================
// M2: TransitionEnforcer Phantom Entity Rejection
// Closes: Mutation M2 — phantom entity default restored survives
// Proves: Debt 2 Category A fix rejects transitions on non-existent entities
// ============================================================================

describe('M2: TransitionEnforcer rejects phantom entities (Debt 2)', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let gov: GovernanceSystem;

  beforeEach(() => {
    conn = createTestDatabase();
    ctx = createTestOperationContext();
    gov = createGovernanceSystem();
    // NOTE: No entity seeding — phantom IDs must be rejected
  });

  it('BRK-M2-01: Mission transition on phantom ID rejected with LIFECYCLE_INVALID_TRANSITION', () => {
    // SETUP: No mission 'phantom-mission-xyz' exists in core_missions or gov_runs.
    // ACTION: Attempt to transition a non-existent mission.
    const result = gov.transitionEnforcer.enforceMissionTransition(
      conn, missionId('phantom-mission-xyz'), 'active',
    );

    // CATCHES: Implementation that defaults missing entities to initial state (created),
    // allowing phantom entities to transition through the state machine.
    // Invariant: ST-060, BC-062
    // Defect: DC-GOV-PHANTOM — Phantom entity acceptance
    assert.equal(result.ok, false, 'ST-060/Debt2: Must reject transition on phantom mission');
    if (!result.ok) {
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION',
        'ST-060/Debt2: Error code must be LIFECYCLE_INVALID_TRANSITION');
      assert.match(result.error.message, /phantom entity/i,
        'ST-060/Debt2: Error message must indicate phantom entity');
    }
  });

  it('BRK-M2-02: Task transition on phantom ID rejected', () => {
    // SETUP: No task 'phantom-task-xyz' exists in core_tasks.
    const result = gov.transitionEnforcer.enforceTaskTransition(
      conn, taskId('phantom-task-xyz'), 'ready',
    );

    assert.equal(result.ok, false, 'ST-061/Debt2: Must reject transition on phantom task');
    if (!result.ok) {
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
      assert.match(result.error.message, /phantom entity/i);
    }
  });

  it('BRK-M2-03: Handoff transition on phantom ID rejected', () => {
    // SETUP: No handoff 'phantom-handoff-xyz' exists in gov_handoffs.
    const result = gov.transitionEnforcer.enforceHandoffTransition(
      conn, handoffId('phantom-handoff-xyz'), 'accepted',
    );

    assert.equal(result.ok, false, 'ST-062/Debt2: Must reject transition on phantom handoff');
    if (!result.ok) {
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
      assert.match(result.error.message, /phantom entity/i);
    }
  });

  it('BRK-M2-04: Run transition on phantom ID rejected', () => {
    // SETUP: No run 'phantom-run-xyz' exists in gov_runs.
    const result = gov.transitionEnforcer.enforceRunTransition(
      conn, runId('phantom-run-xyz'), 'completed',
    );

    assert.equal(result.ok, false, 'ST-020/Debt2: Must reject transition on phantom run');
    if (!result.ok) {
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
      assert.match(result.error.message, /phantom entity/i);
    }
  });
});

// ============================================================================
// M3: EGP handleOverage RESERVATION_NOT_FOUND
// Closes: Mutation M3 — reservation check reverted to return ok(null) survives
// Proves: Debt 2 Category B fix rejects overage when no reservation exists
// ============================================================================

describe('M3: handleOverage rejects when no reservation exists (Debt 2)', () => {
  let governor: ExecutionGovernor;
  let conn: DatabaseConnection;
  let ctx: EGPOperationContext;

  // ── EGP mock helpers (copied from test_contract_egp.test.ts pattern) ──

  function testTaskId(id: string): TaskId {
    return id as TaskId;
  }

  function testMissionId(id: string): MissionId {
    return id as MissionId;
  }

  function createMockConn(): DatabaseConnection {
    const data = new Map<string, unknown[]>();
    return {
      run: () => ({ changes: 0 }),
      get: <T>(): T | undefined => undefined,
      query: <T>(): T[] => [],
      transaction: (fn: () => void) => fn(),
    } as unknown as DatabaseConnection;
  }

  function createMockCtx(): EGPOperationContext {
    return {
      tenantId: 'test-tenant' as unknown as import('../../src/kernel/interfaces/index.js').TenantId,
      userId: null,
      agentId: null,
      permissions: new Set(),
      correlationId: 'corr-001' as unknown as import('../../src/kernel/interfaces/index.js').CorrelationId,
    };
  }

  function createMockDeps(): ExecutionGovernorDeps {
    return {
      audit: {
        append() { return { ok: true as const, value: 'audit-mock' }; },
      },
      events: {
        emit() {},
      },
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    } as unknown as ExecutionGovernorDeps;
  }

  beforeEach(() => {
    const deps = createMockDeps();
    governor = createExecutionGovernor(deps);
    conn = createMockConn();
    ctx = createMockCtx();
  });

  it('BRK-M3-01: handleOverage returns RESERVATION_NOT_FOUND for untracked task', () => {
    // SETUP: Governor starts with empty state. No reservations created.
    // ACTION: Attempt to handle overage for a task with no reservation.
    const result = governor.enforcer.handleOverage(
      conn, ctx, testTaskId('task-no-reservation'), 100, 0,
    );

    // CATCHES: Implementation that silently returns ok(null) when no reservation exists,
    // allowing untracked budget consumption. Budget enforcement is impossible without
    // a reservation to anchor the overage to a mission.
    // Invariant: EGP-I14
    // Defect: DC-EGP-PHANTOM-RESERVATION — Overage silently dropped for untracked task
    assert.equal(result.ok, false,
      'EGP-I14/Debt2: Must reject overage when no reservation exists');
    if (!result.ok) {
      assert.equal(result.error.code, 'RESERVATION_NOT_FOUND',
        'EGP-I14/Debt2: Error code must be RESERVATION_NOT_FOUND');
    }
  });

  // Note: Released reservations are still found by findReservationByTask (by design —
  // overage recording needs the mission anchor even after release). The Debt 2 fix
  // targets the case where NO reservation ever existed, tested by BRK-M3-01.
});
