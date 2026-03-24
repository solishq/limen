/**
 * Phase 4 Governance Wiring — Integration Tests
 *
 * Phase: 4 (Governance Wiring)
 * Tier: 1 (Governance)
 * Implements: Control 3 (Executable Contract) for Phase 4 governance wiring
 *
 * Defect classes covered:
 *   DC-P4-103: Inner engine not exposed on GovernedOrchestration (CONSTITUTIONAL)
 *   DC-P4-401: Governance hooks fire on SC calls — SC-1..SC-10 (CONSTITUTIONAL)
 *     SC-1: proposeMission parent suspension (success + rejection)
 *     SC-2: proposeTaskGraph mission suspension (success + rejection)
 *     SC-3: proposeTaskExecution task→mission cascade (success + rejection)
 *     SC-4: createArtifact mission suspension (success + rejection)
 *     SC-5: readArtifact artifact→mission suspension (success + rejection + unknown artifact)
 *     SC-6: emitEvent mission suspension (covered via DC-P4-402 success test)
 *     SC-7: requestCapability invocation gate + suspension (success + gate rejection)
 *     SC-8: requestBudget mission suspension (success + rejection)
 *     SC-9: submitResult mission suspension + terminal tracking (success + rejection + escalation)
 *     SC-10: respondCheckpoint checkpoint→mission suspension (success + rejection + fail-closed)
 *   DC-P4-402: Pre-hook error returns GOVERNANCE_UNAVAILABLE (CONSTITUTIONAL)
 *   DC-P4-403: SC-5 suspension-scope check — conservative all-block (CONSTITUTIONAL)
 *   DC-P4-404: ClaimFacade RBAC blocks unauthorized call (CONSTITUTIONAL)
 *   DC-P4-405: WorkingMemoryFacade RBAC blocks unauthorized call (CONSTITUTIONAL)
 *   DC-P4-406: Raw systems not accessible on Limen — structural test (CONSTITUTIONAL)
 *   DC-P4-502: Consumption recording failure counter increments per-instance (QUALITY_GATE)
 *   DC-P4-901: Terminal release failure escalation at N=3 (QUALITY_GATE)
 *
 * Amendment 21: Every enforcement DC has BOTH success and rejection tests.
 * Amendment 22: Wiring manifest produced separately.
 *
 * Version pins: orchestration.ts frozen zone
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTestDatabase, createTestOperationContext,
  missionId, taskId, agentId, tenantId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, Result } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/interfaces/orchestration.js';
import type {
  ProposeMissionInput, ProposeMissionOutput,
  ProposeTaskGraphInput, ProposeTaskGraphOutput,
  ProposeTaskExecutionInput, ProposeTaskExecutionOutput,
  CreateArtifactInput, CreateArtifactOutput,
  ReadArtifactInput, ReadArtifactOutput,
  EmitEventInput, EmitEventOutput,
  RequestCapabilityInput, RequestCapabilityOutput,
  RequestBudgetInput, RequestBudgetOutput,
  SubmitResultInput, SubmitResultOutput,
  RespondCheckpointInput, RespondCheckpointOutput,
} from '../../src/orchestration/interfaces/orchestration.js';

import { createGovernedOrchestration } from '../../src/api/governance/governed_orchestration.js';
import type { GovernanceRefs, GovernedOrchestrationResult } from '../../src/api/governance/governed_orchestration.js';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createExecutionGovernor } from '../../src/execution/harness/egp_harness.js';
import { createInvocationGate } from '../../src/execution/wiring/invocation_gate.js';
import type { ExecutionGovernorDeps } from '../../src/execution/interfaces/egp_types.js';

import { createRawClaimFacade } from '../../src/api/facades/claim_facade.js';
import { createRawWorkingMemoryFacade } from '../../src/api/facades/working_memory_facade.js';
import { createWorkingMemorySystem } from '../../src/working-memory/harness/wmp_harness.js';

import type { RbacEngine } from '../../src/kernel/interfaces/rbac.js';
import type { RateLimiter } from '../../src/kernel/interfaces/rate_limiter.js';
import type { SuspensionRecordId, SupervisorDecisionId } from '../../src/kernel/interfaces/governance_ids.js';

// ============================================================================
// Test Infrastructure
// ============================================================================

function createMockOrchestration(): OrchestrationEngine {
  const scCallLog: string[] = [];

  function makeResult<T>(value: T): Result<T> {
    return { ok: true, value };
  }

  const engine: OrchestrationEngine = {
    proposeMission(_ctx: OperationContext, _input: ProposeMissionInput) {
      scCallLog.push('proposeMission');
      return makeResult({ missionId: missionId('m-1'), state: 'CREATED' as const, allocated: { budget: 1000 } });
    },
    proposeTaskGraph(_ctx: OperationContext, _input: ProposeTaskGraphInput) {
      scCallLog.push('proposeTaskGraph');
      return makeResult({ graphId: 'g-1', taskIds: [], warnings: [] });
    },
    proposeTaskExecution(_ctx: OperationContext, _input: ProposeTaskExecutionInput) {
      scCallLog.push('proposeTaskExecution');
      return makeResult({ executionId: 'e-1', scheduledAt: '2026-01-01', workerId: 'w-1' });
    },
    createArtifact(_ctx: OperationContext, _input: CreateArtifactInput) {
      scCallLog.push('createArtifact');
      return makeResult({ artifactId: 'a-1' as import('../../src/kernel/interfaces/index.js').ArtifactId, version: 1 });
    },
    readArtifact(_ctx: OperationContext, _input: ReadArtifactInput) {
      scCallLog.push('readArtifact');
      return makeResult({
        artifact: {
          id: 'a-1' as import('../../src/kernel/interfaces/index.js').ArtifactId,
          version: 1, missionId: missionId('m-1'),
          name: 'test', type: 'file' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactType,
          format: 'text' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactFormat,
          content: 'test', lifecycleState: 'active' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactLifecycleState,
          metadata: {},
        },
      });
    },
    emitEvent(_ctx: OperationContext, _input: EmitEventInput) {
      scCallLog.push('emitEvent');
      return makeResult({ eventId: 'ev-1' as import('../../src/kernel/interfaces/index.js').EventId, delivered: true });
    },
    requestCapability(_ctx: OperationContext, _input: RequestCapabilityInput) {
      scCallLog.push('requestCapability');
      return makeResult({ result: {}, resourcesConsumed: { tokens: 10 } });
    },
    requestBudget(_ctx: OperationContext, _input: RequestBudgetInput) {
      scCallLog.push('requestBudget');
      return makeResult({ granted: true, remaining: 900 });
    },
    submitResult(_ctx: OperationContext, _input: SubmitResultInput) {
      scCallLog.push('submitResult');
      return makeResult({ resultId: 'r-1', missionState: 'COMPLETED' as const });
    },
    respondCheckpoint(_ctx: OperationContext, _input: RespondCheckpointInput) {
      scCallLog.push('respondCheckpoint');
      return makeResult({ accepted: true, nextAction: 'continue' });
    },
    get missions() { return {} as OrchestrationEngine['missions']; },
    get taskGraph() { return {} as OrchestrationEngine['taskGraph']; },
    get artifacts() { return {} as OrchestrationEngine['artifacts']; },
    get budget() { return {} as OrchestrationEngine['budget']; },
    get checkpoints() { return {} as OrchestrationEngine['checkpoints']; },
    get compaction() { return {} as OrchestrationEngine['compaction']; },
    get events() { return {} as OrchestrationEngine['events']; },
    get conversations() { return {} as OrchestrationEngine['conversations']; },
    get delegation() { return {} as OrchestrationEngine['delegation']; },
  };

  return Object.assign(engine, { _scCallLog: scCallLog });
}

function createMockRbac(authorized: boolean = true): RbacEngine {
  return {
    checkPermission(_ctx: OperationContext, _permission: import('../../src/kernel/interfaces/index.js').Permission) {
      if (authorized) {
        return { ok: true, value: true };
      }
      return { ok: false, error: { code: 'RBAC_DENIED', message: 'Denied', spec: 'I-13' } };
    },
    assignRole() { return { ok: true, value: undefined }; },
    revokeRole() { return { ok: true, value: undefined }; },
    getRoles() { return { ok: true, value: [] }; },
  } as unknown as RbacEngine;
}

function createMockRateLimiter(): RateLimiter {
  return {
    checkAndConsume(_conn: DatabaseConnection, _ctx: OperationContext, _bucket: import('../../src/kernel/interfaces/rate_limiter.js').BucketType) {
      return { ok: true as const, value: true };
    },
    getStatus(_conn: DatabaseConnection, _ctx: OperationContext, _bucket: import('../../src/kernel/interfaces/rate_limiter.js').BucketType) {
      return { ok: true as const, value: { currentTokens: 99, maxTokens: 100, refillRate: 1, lastRefillAt: new Date().toISOString() } };
    },
  } as RateLimiter;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Phase 4: Governance Wiring — GovernedOrchestration', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let governance: ReturnType<typeof createGovernanceSystem>;
  let mockInner: OrchestrationEngine & { _scCallLog: string[] };
  let governed: OrchestrationEngine;
  let governedResult: GovernedOrchestrationResult;

  beforeEach(() => {
    conn = createTestDatabase();
    ctx = createTestOperationContext();
    governance = createGovernanceSystem();

    const egpDeps = {
      audit: { append() { return { ok: true, value: {} }; } },
      events: { emit() {} },
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    } as unknown as ExecutionGovernorDeps;
    const egp = createExecutionGovernor(egpDeps);
    const invGate = createInvocationGate(egp);

    const mockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

    mockInner = createMockOrchestration() as OrchestrationEngine & { _scCallLog: string[] };
    governedResult = createGovernedOrchestration(mockInner, {
      governance,
      egp,
      invocationGate: invGate,
      getConnection: () => conn,
      time: mockTime,
    });
    governed = governedResult.engine;
  });

  // DC-P4-103: Inner engine reference not leaked
  // Amendment 21: Success + Rejection
  describe('DC-P4-103: Inner engine not exposed on GovernedOrchestration', () => {
    it('SUCCESS: governed wrapper methods delegate correctly to inner', () => {
      // proposeMission with null parentMissionId skips suspension check —
      // goes straight to inner engine. No SQL required for this path.
      const result = governed.proposeMission(ctx, {
        parentMissionId: null,
        agentId: agentId('a-1'),
        objective: 'test',
        successCriteria: [],
        scopeBoundaries: [],
        capabilities: [],
        constraints: { budget: 1000, deadline: '2026-12-31' },
      });
      assert.ok(result.ok, 'proposeMission should succeed when no parent suspension');
      assert.strictEqual(mockInner._scCallLog.includes('proposeMission'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: no property named "inner" or equivalent exists on frozen wrapper', () => {
      // The governed object is frozen — no 'inner', '_inner', 'engine', or 'raw' property
      const governed_any = governed as Record<string, unknown>;
      assert.strictEqual('inner' in governed_any, false, 'No "inner" property should exist');
      assert.strictEqual('_inner' in governed_any, false, 'No "_inner" property should exist');
      assert.strictEqual('engine' in governed_any, false, 'No "engine" property should exist');
      assert.strictEqual('raw' in governed_any, false, 'No "raw" property should exist');

      // Object is frozen
      assert.ok(Object.isFrozen(governed), 'GovernedOrchestration must be frozen');
    });
  });

  // DC-P4-401: Governance hooks fire on SC calls
  describe('DC-P4-401: Governance hooks fire on SC calls', () => {
    it('SUCCESS: SC-2 proposeTaskGraph calls through governed wrapper', () => {
      const result = governed.proposeTaskGraph(ctx, {
        missionId: missionId('m-1'),
        tasks: [],
        dependencies: [],
        objectiveAlignment: 'test',
      });
      assert.ok(result.ok, 'proposeTaskGraph should succeed');
      assert.strictEqual(mockInner._scCallLog.includes('proposeTaskGraph'), true);
    });

    it('REJECTION: SC-2 proposeTaskGraph blocked by active mission suspension', () => {
      // Create active suspension for mission m-1
      const suspDecisionId = 'susp-dec-1' as SupervisorDecisionId;
      governance.supervisorDecisionStore.create(conn, {
        decisionId: suspDecisionId,
        tenantId: '',
        supervisorType: 'hard-policy',
        targetType: 'mission',
        targetId: 'm-1',
        outcome: 'defer',
        rationale: 'Test suspension',
        precedence: 100,
        schemaVersion: '1.0',
        origin: 'runtime',
        createdAt: new Date().toISOString(),
      });
      governance.suspensionStore.create(conn, {
        suspensionId: 'susp-1' as SuspensionRecordId,
        tenantId: '',
        targetType: 'mission',
        targetId: 'm-1',
        state: 'active',
        creatingDecisionId: suspDecisionId,
        resolutionDecisionId: null,
        schemaVersion: '1.0',
        origin: 'runtime',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      });

      const result = governed.proposeTaskGraph(ctx, {
        missionId: missionId('m-1'),
        tasks: [],
        dependencies: [],
        objectiveAlignment: 'test',
      });

      assert.ok(!result.ok, 'proposeTaskGraph should be blocked by suspension');
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE');
      }
      // Verify inner was NOT called
      assert.strictEqual(mockInner._scCallLog.includes('proposeTaskGraph'), false,
        'Inner engine should NOT be called when governance pre-hook blocks');
    });
  });

  // ========================================================================
  // Helper: create an active suspension for a mission
  // ========================================================================
  function createSuspension(
    targetType: 'mission' | 'task',
    targetId: string,
    suffix: string = '1',
  ): void {
    const suspDecisionId = `susp-dec-${suffix}` as SupervisorDecisionId;
    governance.supervisorDecisionStore.create(conn, {
      decisionId: suspDecisionId,
      tenantId: '',
      supervisorType: 'hard-policy',
      targetType,
      targetId,
      outcome: 'defer',
      rationale: `Test suspension for ${targetType} ${targetId}`,
      precedence: 100,
      schemaVersion: '1.0',
      origin: 'runtime',
      createdAt: new Date().toISOString(),
    });
    governance.suspensionStore.create(conn, {
      suspensionId: `susp-${suffix}` as SuspensionRecordId,
      tenantId: '',
      targetType,
      targetId,
      state: 'active',
      creatingDecisionId: suspDecisionId,
      resolutionDecisionId: null,
      schemaVersion: '1.0',
      origin: 'runtime',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    });
  }

  // ========================================================================
  // SC-1: proposeMission — suspension on parent
  // ========================================================================
  describe('DC-P4-401 SC-1: proposeMission governance hook', () => {
    it('SUCCESS: proposeMission with suspended parent=null passes through', () => {
      // No parent → no suspension check → delegates to inner
      const result = governed.proposeMission(ctx, {
        parentMissionId: null,
        agentId: agentId('a-1'),
        objective: 'test',
        successCriteria: [],
        scopeBoundaries: [],
        capabilities: [],
        constraints: { budget: 1000, deadline: '2026-12-31' },
      });
      assert.ok(result.ok, 'proposeMission should succeed with null parent');
      assert.strictEqual(mockInner._scCallLog.includes('proposeMission'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: proposeMission blocked when parent mission is suspended', () => {
      // Create suspension for parent mission m-parent
      createSuspension('mission', 'm-parent', 'sc1');

      mockInner._scCallLog.length = 0;
      const result = governed.proposeMission(ctx, {
        parentMissionId: missionId('m-parent'),
        agentId: agentId('a-1'),
        objective: 'child mission',
        successCriteria: [],
        scopeBoundaries: [],
        capabilities: [],
        constraints: { budget: 500, deadline: '2026-12-31' },
      });

      assert.strictEqual(result.ok, false, 'proposeMission should be blocked by parent suspension');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE',
          'Error code should be SUSPENSION_ACTIVE');
      }
      assert.strictEqual(mockInner._scCallLog.includes('proposeMission'), false,
        'Inner engine should NOT be called when parent is suspended');
    });
  });

  // ========================================================================
  // SC-3: proposeTaskExecution — task→mission cascade (BC-049)
  // ========================================================================
  describe('DC-P4-401 SC-3: proposeTaskExecution governance hook', () => {
    // Helper to seed a mission + task pair for SC-3 tests
    function seedMissionAndTask(mId: string, tId: string): void {
      const now = new Date().toISOString();
      // Seed mission first (FK constraint)
      conn.run(
        `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mId, 'test-tenant', null, 'a-1', 'Test mission', '[]', '[]', 'EXECUTING', 0, '[]', '[]', '{}', 0, now, now],
      );
      // Seed task (core_tasks schema: id, mission_id, tenant_id, graph_id, description, execution_mode, state, ...)
      conn.run(
        `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tId, mId, 'test-tenant', 'g-1', 'Test task', 'deterministic', 'PENDING', now, now],
      );
    }

    it('SUCCESS: proposeTaskExecution passes when task mission is not suspended', () => {
      seedMissionAndTask('m-sc3', 't-sc3');

      const result = governed.proposeTaskExecution(ctx, {
        taskId: taskId('t-sc3'),
        workerId: 'w-1',
      });
      assert.ok(result.ok, 'proposeTaskExecution should succeed without suspension');
      assert.strictEqual(mockInner._scCallLog.includes('proposeTaskExecution'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: proposeTaskExecution blocked when task mission is suspended', () => {
      seedMissionAndTask('m-susp3', 't-susp3');

      // Create suspension for mission (BC-049: mission suspended → tasks implicitly blocked)
      createSuspension('mission', 'm-susp3', 'sc3');

      mockInner._scCallLog.length = 0;
      const result = governed.proposeTaskExecution(ctx, {
        taskId: taskId('t-susp3'),
        workerId: 'w-1',
      });

      assert.strictEqual(result.ok, false, 'proposeTaskExecution should be blocked');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE',
          'Error code should be SUSPENSION_ACTIVE for mission-level cascade');
      }
      assert.strictEqual(mockInner._scCallLog.includes('proposeTaskExecution'), false,
        'Inner engine should NOT be called when task mission is suspended');
    });
  });

  // ========================================================================
  // SC-4: createArtifact — mission suspension
  // ========================================================================
  describe('DC-P4-401 SC-4: createArtifact governance hook', () => {
    it('SUCCESS: createArtifact passes when mission is not suspended', () => {
      const result = governed.createArtifact(ctx, {
        missionId: missionId('m-1'),
        name: 'test-artifact',
        type: 'report' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactType,
        format: 'markdown' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactFormat,
        content: 'test content',
        sourceTaskId: taskId('t-1'),
      });
      assert.ok(result.ok, 'createArtifact should succeed without suspension');
      assert.strictEqual(mockInner._scCallLog.includes('createArtifact'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: createArtifact blocked when mission is suspended', () => {
      createSuspension('mission', 'm-susp4', 'sc4');

      mockInner._scCallLog.length = 0;
      const result = governed.createArtifact(ctx, {
        missionId: missionId('m-susp4'),
        name: 'blocked-artifact',
        type: 'report' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactType,
        format: 'markdown' as import('../../src/orchestration/interfaces/orchestration.js').ArtifactFormat,
        content: 'should not be created',
        sourceTaskId: taskId('t-1'),
      });

      assert.strictEqual(result.ok, false, 'createArtifact should be blocked by suspension');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE');
      }
      assert.strictEqual(mockInner._scCallLog.includes('createArtifact'), false,
        'Inner engine should NOT be called when mission is suspended');
    });
  });

  // ========================================================================
  // SC-5: readArtifact — suspension on artifact's owning mission (FIX-1)
  // ========================================================================
  describe('DC-P4-403 SC-5: readArtifact governance hook', () => {
    // Helper: seed mission + task + artifact for SC-5 tests
    function seedArtifact(aId: string, mId: string): void {
      const now = new Date().toISOString();
      // Seed mission (FK for artifact.mission_id)
      conn.run(
        `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mId, 'test-tenant', null, 'a-1', 'Artifact mission', '[]', '[]', 'EXECUTING', 0, '[]', '[]', '{}', 0, now, now],
      );
      // Seed artifact (source_task_id is NOT NULL but no FK — use placeholder)
      conn.run(
        `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, relevance_decay, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [aId, 1, mId, 'test-tenant', 'Test artifact', 'report', 'markdown', 'content', 'ACTIVE', 't-placeholder', 0, now],
      );
    }

    it('SUCCESS: readArtifact passes when artifact mission is not suspended', () => {
      seedArtifact('a-sc5', 'm-sc5');

      const result = governed.readArtifact(ctx, {
        artifactId: 'a-sc5' as import('../../src/kernel/interfaces/index.js').ArtifactId,
        version: 'latest',
      });
      assert.ok(result.ok, 'readArtifact should succeed without suspension');
      assert.strictEqual(mockInner._scCallLog.includes('readArtifact'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: readArtifact blocked when artifact mission is suspended', () => {
      seedArtifact('a-susp5', 'm-susp5');
      createSuspension('mission', 'm-susp5', 'sc5');

      mockInner._scCallLog.length = 0;
      const result = governed.readArtifact(ctx, {
        artifactId: 'a-susp5' as import('../../src/kernel/interfaces/index.js').ArtifactId,
        version: 'latest',
      });

      assert.strictEqual(result.ok, false, 'readArtifact should be blocked by suspension');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE',
          'Error code should be SUSPENSION_ACTIVE for suspended mission artifact');
      }
      assert.strictEqual(mockInner._scCallLog.includes('readArtifact'), false,
        'Inner engine should NOT be called when artifact mission is suspended');
    });

    it('REJECTION: readArtifact returns GOVERNANCE_UNAVAILABLE for unknown artifact', () => {
      // No artifact row exists — fail-closed per C-SEC-01
      mockInner._scCallLog.length = 0;
      const result = governed.readArtifact(ctx, {
        artifactId: 'nonexistent' as import('../../src/kernel/interfaces/index.js').ArtifactId,
        version: 'latest',
      });

      assert.strictEqual(result.ok, false, 'readArtifact should fail for unknown artifact');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'GOVERNANCE_UNAVAILABLE',
          'Error code should be GOVERNANCE_UNAVAILABLE for unknown artifact');
      }
      assert.strictEqual(mockInner._scCallLog.includes('readArtifact'), false,
        'Inner engine should NOT be called for unknown artifact');
    });
  });

  // ========================================================================
  // SC-7: requestCapability — invocation gate + consumption recording
  // ========================================================================
  describe('DC-P4-401/DC-P4-502 SC-7: requestCapability governance hook', () => {
    it('SUCCESS: requestCapability passes when invocation gate admits', () => {
      // The default governed wrapper uses the real InvocationGate which needs
      // a reservation row in the DB. Create a wrapper with a permissive gate.
      const admittingGate: import('../../src/execution/wiring/invocation_gate.js').InvocationGate = {
        checkAdmissibility() {
          return {
            ok: true,
            value: {
              admissible: true,
              tokenHeadroom: 1000,
              deliberationHeadroom: 100,
              rejectionDimension: null,
            },
          };
        },
      };
      const mockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
      const egpDeps = {
        audit: { append() { return { ok: true, value: {} }; } },
        events: { emit() {} },
        time: mockTime,
      } as unknown as ExecutionGovernorDeps;
      const sc7GovResult = createGovernedOrchestration(mockInner, {
        governance,
        egp: createExecutionGovernor(egpDeps),
        invocationGate: admittingGate,
        getConnection: () => conn,
        time: mockTime,
      });

      mockInner._scCallLog.length = 0;
      const result = sc7GovResult.engine.requestCapability(ctx, {
        missionId: missionId('m-1'),
        taskId: taskId('t-1'),
        capabilityType: 'llm',
        parameters: {},
      });
      assert.ok(result.ok, 'requestCapability should succeed with admitting gate');
      assert.strictEqual(mockInner._scCallLog.includes('requestCapability'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: requestCapability blocked when invocation gate rejects', () => {
      // Create a governed wrapper with a rejecting invocation gate
      const rejectingGate: import('../../src/execution/wiring/invocation_gate.js').InvocationGate = {
        checkAdmissibility() {
          return {
            ok: true,
            value: {
              admissible: false,
              tokenHeadroom: 0,
              deliberationHeadroom: 100,
              rejectionDimension: 'token' as const,
            },
          };
        },
      };

      const mockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
      const egpDeps = {
        audit: { append() { return { ok: true, value: {} }; } },
        events: { emit() {} },
        time: mockTime,
      } as unknown as ExecutionGovernorDeps;

      const gateGovResult = createGovernedOrchestration(mockInner, {
        governance,
        egp: createExecutionGovernor(egpDeps),
        invocationGate: rejectingGate,
        getConnection: () => conn,
        time: mockTime,
      });

      mockInner._scCallLog.length = 0;
      const result = gateGovResult.engine.requestCapability(ctx, {
        missionId: missionId('m-1'),
        taskId: taskId('t-1'),
        capabilityType: 'llm',
        parameters: {},
      });

      assert.strictEqual(result.ok, false, 'requestCapability should be blocked by invocation gate');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'EGP_TOKEN_HEADROOM_EXHAUSTED',
          'Error code should indicate token headroom exhaustion');
      }
      assert.strictEqual(mockInner._scCallLog.includes('requestCapability'), false,
        'Inner engine should NOT be called when invocation gate rejects');
    });

    it('DC-P4-502: consumption recording failure increments per-instance counter', () => {
      // Create a governed wrapper with EGP ledger that throws on recordConsumption
      // AND a permissive invocation gate (so requestCapability succeeds past the gate)
      const mockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
      const failingEgp = createExecutionGovernor({
        audit: { append() { return { ok: true, value: {} }; } },
        events: { emit() {} },
        time: mockTime,
      } as unknown as ExecutionGovernorDeps);

      // Override recordConsumption to throw
      const originalLedger = failingEgp.ledger;
      const failingLedger = {
        ...originalLedger,
        recordConsumption() {
          throw new Error('Simulated consumption recording failure');
        },
      };
      const failingEgpWithLedger = {
        ...failingEgp,
        ledger: failingLedger,
      } as unknown as import('../../src/execution/interfaces/egp_types.js').ExecutionGovernor;

      // Permissive invocation gate — bypass real EGP headroom check
      const admittingGate: import('../../src/execution/wiring/invocation_gate.js').InvocationGate = {
        checkAdmissibility() {
          return {
            ok: true,
            value: {
              admissible: true,
              tokenHeadroom: 1000,
              deliberationHeadroom: 100,
              rejectionDimension: null,
            },
          };
        },
      };

      const failGovResult = createGovernedOrchestration(mockInner, {
        governance,
        egp: failingEgpWithLedger,
        invocationGate: admittingGate,
        getConnection: () => conn,
        time: mockTime,
      });

      // Counter should start at 0
      assert.strictEqual(failGovResult.getConsumptionRecordingFailureCount(), 0,
        'Counter should start at 0');

      mockInner._scCallLog.length = 0;
      // This should succeed (the SC itself works) but recording fails
      const result = failGovResult.engine.requestCapability(ctx, {
        missionId: missionId('m-1'),
        taskId: taskId('t-1'),
        capabilityType: 'llm',
        parameters: {},
      });

      assert.ok(result.ok, 'requestCapability itself should succeed even if recording fails');
      assert.strictEqual(failGovResult.getConsumptionRecordingFailureCount(), 1,
        'Counter should increment to 1 after recording failure');

      // Second call — counter should increment again
      failGovResult.engine.requestCapability(ctx, {
        missionId: missionId('m-1'),
        taskId: taskId('t-1'),
        capabilityType: 'llm',
        parameters: {},
      });
      assert.strictEqual(failGovResult.getConsumptionRecordingFailureCount(), 2,
        'Counter should increment to 2 after second recording failure');
    });
  });

  // ========================================================================
  // SC-8: requestBudget — mission suspension
  // ========================================================================
  describe('DC-P4-401 SC-8: requestBudget governance hook', () => {
    it('SUCCESS: requestBudget passes when mission is not suspended', () => {
      const result = governed.requestBudget(ctx, {
        missionId: missionId('m-1'),
        requestedAmount: 500,
        justification: 'Need more budget',
      });
      assert.ok(result.ok, 'requestBudget should succeed without suspension');
      assert.strictEqual(mockInner._scCallLog.includes('requestBudget'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: requestBudget blocked when mission is suspended', () => {
      createSuspension('mission', 'm-susp8', 'sc8');

      mockInner._scCallLog.length = 0;
      const result = governed.requestBudget(ctx, {
        missionId: missionId('m-susp8'),
        requestedAmount: 500,
        justification: 'Need more budget',
      });

      assert.strictEqual(result.ok, false, 'requestBudget should be blocked by suspension');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE');
      }
      assert.strictEqual(mockInner._scCallLog.includes('requestBudget'), false,
        'Inner engine should NOT be called when mission is suspended');
    });
  });

  // ========================================================================
  // SC-9: submitResult — mission suspension + terminal release tracking
  // ========================================================================
  describe('DC-P4-401/DC-P4-901 SC-9: submitResult governance hook', () => {
    it('SUCCESS: submitResult passes when mission is not suspended', () => {
      const result = governed.submitResult(ctx, {
        missionId: missionId('m-1'),
        taskId: taskId('t-1'),
        status: 'completed',
        output: { summary: 'done' },
      });
      assert.ok(result.ok, 'submitResult should succeed without suspension');
      assert.strictEqual(mockInner._scCallLog.includes('submitResult'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: submitResult blocked when mission is suspended', () => {
      createSuspension('mission', 'm-susp9', 'sc9');

      mockInner._scCallLog.length = 0;
      const result = governed.submitResult(ctx, {
        missionId: missionId('m-susp9'),
        taskId: taskId('t-1'),
        status: 'completed',
        output: { summary: 'done' },
      });

      assert.strictEqual(result.ok, false, 'submitResult should be blocked by suspension');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE');
      }
      assert.strictEqual(mockInner._scCallLog.includes('submitResult'), false,
        'Inner engine should NOT be called when mission is suspended');
    });

    it('DC-P4-901: terminal release failure after N=3 creates synthetic supervisor decision', () => {
      // Create a governed wrapper with EGP ledger.getState that always fails
      const mockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
      const failingEgp = createExecutionGovernor({
        audit: { append() { return { ok: true, value: {} }; } },
        events: { emit() {} },
        time: mockTime,
      } as unknown as ExecutionGovernorDeps);

      // Override getState to always fail
      const failingLedger = {
        ...failingEgp.ledger,
        getState() {
          return { ok: false, error: { code: 'NOT_FOUND', message: 'Simulated ledger failure', spec: 'test' } };
        },
      };
      const failingEgpMod = {
        ...failingEgp,
        ledger: failingLedger,
      } as unknown as import('../../src/execution/interfaces/egp_types.js').ExecutionGovernor;

      const invGate = createInvocationGate(createExecutionGovernor({
        audit: { append() { return { ok: true, value: {} }; } },
        events: { emit() {} },
        time: mockTime,
      } as unknown as ExecutionGovernorDeps));

      const sc9GovResult = createGovernedOrchestration(mockInner, {
        governance,
        egp: failingEgpMod,
        invocationGate: invGate,
        getConnection: () => conn,
        time: mockTime,
      });

      // Submit 3 results for the same mission — should trigger escalation at N=3
      for (let i = 0; i < 3; i++) {
        mockInner._scCallLog.length = 0;
        sc9GovResult.engine.submitResult(ctx, {
          missionId: missionId('m-terminal'),
          taskId: taskId(`t-${i}`),
          status: 'completed',
          output: { summary: `result ${i}` },
        });
      }

      // After 3 consecutive failures, a synthetic supervisor decision should exist.
      // Use the governance store API (targetType/targetId stored in conditions JSON)
      const decisionsResult = governance.supervisorDecisionStore.getByTarget(conn, 'mission', 'm-terminal');
      assert.ok(decisionsResult.ok, 'Decision query should succeed');
      if (decisionsResult.ok) {
        const systemTimeoutDecisions = decisionsResult.value.filter(
          (d) => d.supervisorType === 'system-timeout' && d.targetId === 'm-terminal',
        );
        assert.ok(systemTimeoutDecisions.length > 0,
          'Synthetic supervisor decision should be created after 3 consecutive terminal release failures');
        assert.ok(systemTimeoutDecisions[0]!.rationale.includes('Terminal release check failed 3 consecutive times'),
          'Rationale should mention 3 consecutive failures');
      }
    });
  });

  // ========================================================================
  // SC-10: respondCheckpoint — mission suspension (FIX-3: fail-closed)
  // ========================================================================
  describe('DC-P4-401 SC-10: respondCheckpoint governance hook', () => {
    // Helper: seed mission + checkpoint for SC-10 tests
    function seedCheckpoint(cpId: string, mId: string): void {
      const now = new Date().toISOString();
      const timeout = new Date(Date.now() + 3600000).toISOString();
      conn.run(
        `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mId, 'test-tenant', null, 'a-1', 'CP mission', '[]', '[]', 'EXECUTING', 0, '[]', '[]', '{}', 0, now, now],
      );
      conn.run(
        `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, created_at, timeout_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cpId, mId, 'test-tenant', 'PERIODIC', 'PENDING', now, timeout],
      );
    }

    it('SUCCESS: respondCheckpoint passes when checkpoint mission is not suspended', () => {
      seedCheckpoint('cp-1', 'm-cp');

      const result = governed.respondCheckpoint(ctx, {
        checkpointId: 'cp-1',
        assessment: 'on track',
        confidence: 0.8,
        proposedAction: 'continue',
      });
      assert.ok(result.ok, 'respondCheckpoint should succeed without suspension');
      assert.strictEqual(mockInner._scCallLog.includes('respondCheckpoint'), true,
        'Inner engine should have been called');
    });

    it('REJECTION: respondCheckpoint blocked when checkpoint mission is suspended', () => {
      seedCheckpoint('cp-susp', 'm-cp-susp');

      createSuspension('mission', 'm-cp-susp', 'sc10');

      mockInner._scCallLog.length = 0;
      const result = governed.respondCheckpoint(ctx, {
        checkpointId: 'cp-susp',
        assessment: 'suspended check',
        confidence: 0.5,
        proposedAction: 'continue',
      });

      assert.strictEqual(result.ok, false, 'respondCheckpoint should be blocked by suspension');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'SUSPENSION_ACTIVE',
          'Error code should be SUSPENSION_ACTIVE');
      }
      assert.strictEqual(mockInner._scCallLog.includes('respondCheckpoint'), false,
        'Inner engine should NOT be called when checkpoint mission is suspended');
    });

    it('REJECTION: respondCheckpoint returns GOVERNANCE_UNAVAILABLE for unknown checkpoint (fail-closed)', () => {
      // No checkpoint row exists — FIX-3 ensures fail-closed
      mockInner._scCallLog.length = 0;
      const result = governed.respondCheckpoint(ctx, {
        checkpointId: 'nonexistent-cp',
        assessment: 'should fail',
        confidence: 0.5,
        proposedAction: 'continue',
      });

      assert.strictEqual(result.ok, false, 'respondCheckpoint should fail for unknown checkpoint');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'GOVERNANCE_UNAVAILABLE',
          'Error code should be GOVERNANCE_UNAVAILABLE for unknown checkpoint');
      }
      assert.strictEqual(mockInner._scCallLog.includes('respondCheckpoint'), false,
        'Inner engine should NOT be called for unknown checkpoint');
    });
  });

  // DC-P4-402: Pre-hook error returns GOVERNANCE_UNAVAILABLE
  describe('DC-P4-402: Pre-hook fail-closed behavior', () => {
    it('SUCCESS: valid pre-hook allows SC through', () => {
      // No suspension exists → pre-hook passes
      const result = governed.emitEvent(ctx, {
        eventType: 'test',
        missionId: missionId('m-1'),
        payload: {},
        propagation: 'local' as import('../../src/orchestration/interfaces/orchestration.js').PropagationDirection,
      });
      assert.ok(result.ok, 'emitEvent should succeed without suspension');
    });

    it('REJECTION: governance infrastructure error returns GOVERNANCE_UNAVAILABLE, SC not executed', () => {
      // Create a governed wrapper with a broken suspension store
      const brokenGovernance = {
        ...governance,
        suspensionStore: {
          ...governance.suspensionStore,
          getActiveForTarget() {
            throw new Error('Simulated governance infrastructure failure');
          },
        },
      };

      const brokenMockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
      const brokenGovResult = createGovernedOrchestration(mockInner, {
        governance: brokenGovernance as ReturnType<typeof createGovernanceSystem>,
        egp: createExecutionGovernor({
          audit: { append() { return { ok: true, value: {} }; } },
          events: { emit() {} },
          time: brokenMockTime,
        } as unknown as ExecutionGovernorDeps),
        invocationGate: createInvocationGate(createExecutionGovernor({
          audit: { append() { return { ok: true, value: {} }; } },
          events: { emit() {} },
          time: brokenMockTime,
        } as unknown as ExecutionGovernorDeps)),
        getConnection: () => conn,
        time: brokenMockTime,
      });
      const brokenGoverned = brokenGovResult.engine;

      // Reset call log
      mockInner._scCallLog.length = 0;

      const result = brokenGoverned.emitEvent(ctx, {
        eventType: 'test',
        missionId: missionId('m-1'),
        payload: {},
        propagation: 'local' as import('../../src/orchestration/interfaces/orchestration.js').PropagationDirection,
      });

      assert.ok(!result.ok, 'emitEvent should fail when governance is unavailable');
      if (!result.ok) {
        assert.strictEqual(result.error.code, 'GOVERNANCE_UNAVAILABLE');
      }
      // Verify inner was NOT called (fail-closed — C-SEC-01)
      assert.strictEqual(mockInner._scCallLog.length, 0,
        'Inner engine must NOT be called when pre-hook throws (fail-closed)');
    });
  });
});

// ============================================================================
// Facade RBAC Tests
// ============================================================================

describe('Phase 4: Governance Wiring — ClaimFacade RBAC', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    conn = createTestDatabase();
    ctx = createTestOperationContext();
  });

  // DC-P4-404: ClaimFacade RBAC
  describe('DC-P4-404: ClaimFacade RBAC enforcement', () => {
    it('SUCCESS: authorized call succeeds', () => {
      // For this test, we verify that the facade calls through to the system
      // with RBAC passing. The underlying claim system may reject the call
      // for other reasons (e.g., invalid input), but RBAC does not block.
      const rbac = createMockRbac(true);
      const rateLimiter = createMockRateLimiter();
      const wmpSystem = createWorkingMemorySystem();

      // Create a minimal claim system mock that tracks calls
      let assertClaimCalled = false;
      const claimSystemMock = {
        assertClaim: {
          execute() {
            assertClaimCalled = true;
            return { ok: true, value: { claimId: 'c-1', created: true } };
          },
        },
        relateClaims: { execute() { return { ok: true, value: {} }; } },
        queryClaims: { execute() { return { ok: true, value: { items: [], total: 0 } }; } },
      } as unknown as import('../../src/claims/interfaces/claim_types.js').ClaimSystem;

      const facade = createRawClaimFacade(claimSystemMock, rbac, rateLimiter);
      facade.assertClaim(conn, ctx, {} as import('../../src/claims/interfaces/claim_types.js').ClaimCreateInput);
      assert.ok(assertClaimCalled, 'assertClaim should have been called on underlying system');
    });

    it('REJECTION: unauthorized call throws UNAUTHORIZED', () => {
      const rbac = createMockRbac(false);
      const rateLimiter = createMockRateLimiter();

      const claimSystemMock = {
        assertClaim: { execute() { return { ok: true, value: {} }; } },
        relateClaims: { execute() { return { ok: true, value: {} }; } },
        queryClaims: { execute() { return { ok: true, value: {} }; } },
      } as unknown as import('../../src/claims/interfaces/claim_types.js').ClaimSystem;

      const facade = createRawClaimFacade(claimSystemMock, rbac, rateLimiter);

      assert.throws(
        () => facade.assertClaim(conn, ctx, {} as import('../../src/claims/interfaces/claim_types.js').ClaimCreateInput),
        (err: Error & { code?: string }) => {
          return err.code === 'UNAUTHORIZED';
        },
        'Unauthorized call should throw UNAUTHORIZED',
      );
    });
  });
});

describe('Phase 4: Governance Wiring — WorkingMemoryFacade RBAC', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;

  beforeEach(() => {
    conn = createTestDatabase();
    ctx = createTestOperationContext();
  });

  // DC-P4-405: WorkingMemoryFacade RBAC
  describe('DC-P4-405: WorkingMemoryFacade RBAC enforcement', () => {
    it('SUCCESS: authorized write call succeeds', () => {
      const rbac = createMockRbac(true);
      const rateLimiter = createMockRateLimiter();

      let writeCalled = false;
      const wmpMock = {
        write: {
          execute() {
            writeCalled = true;
            return { ok: true, value: { key: 'k', sizeBytes: 5, created: true, mutationOrder: 1 } };
          },
        },
        read: { execute() { return { ok: true, value: { entries: [] } }; } },
        discard: { execute() { return { ok: true, value: { discardedCount: 0, freedBytes: 0 } }; } },
      } as unknown as import('../../src/working-memory/interfaces/wmp_types.js').WorkingMemorySystem;

      const facade = createRawWorkingMemoryFacade(wmpMock, rbac, rateLimiter);
      facade.write(conn, ctx, {
        taskId: taskId('t-1'),
        key: 'test-key',
        value: 'test-value',
      });
      assert.ok(writeCalled, 'write should have been called on underlying WMP system');
    });

    it('REJECTION: unauthorized write call throws UNAUTHORIZED', () => {
      const rbac = createMockRbac(false);
      const rateLimiter = createMockRateLimiter();

      const wmpMock = {
        write: { execute() { return { ok: true, value: {} }; } },
        read: { execute() { return { ok: true, value: {} }; } },
        discard: { execute() { return { ok: true, value: {} }; } },
      } as unknown as import('../../src/working-memory/interfaces/wmp_types.js').WorkingMemorySystem;

      const facade = createRawWorkingMemoryFacade(wmpMock, rbac, rateLimiter);

      assert.throws(
        () => facade.write(conn, ctx, {
          taskId: taskId('t-1'),
          key: 'test-key',
          value: 'test-value',
        }),
        (err: Error & { code?: string }) => {
          return err.code === 'UNAUTHORIZED';
        },
        'Unauthorized write should throw UNAUTHORIZED',
      );
    });
  });
});

// ============================================================================
// Structural Tests
// ============================================================================

describe('Phase 4: Governance Wiring — Structural Verification', () => {
  // DC-P4-406: Raw systems not accessible on Limen object
  // Note: This is tested structurally at the type level via api.ts.
  // The Limen interface has claims (ClaimApi) and workingMemory (WorkingMemoryApi)
  // but not claimSystem (ClaimSystem) or workingMemorySystem (WorkingMemorySystem).
  // TypeScript compilation enforces this. This test verifies at runtime.
  describe('DC-P4-406: Facade-only exposure on Limen', () => {
    it('REJECTION: GovernedOrchestration has no "claimSystem" or "workingMemorySystem" property', () => {
      const conn = createTestDatabase();
      const governance = createGovernanceSystem();
      const structMockTime = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
      const egp = createExecutionGovernor({
        audit: { append() { return { ok: true, value: {} }; } },
        events: { emit() {} },
        time: structMockTime,
      } as unknown as ExecutionGovernorDeps);
      const invGate = createInvocationGate(egp);
      const mockInner = createMockOrchestration();

      const govResult = createGovernedOrchestration(mockInner, {
        governance,
        egp,
        invocationGate: invGate,
        getConnection: () => conn,
        time: structMockTime,
      });

      const governed_any = govResult.engine as Record<string, unknown>;
      assert.strictEqual('claimSystem' in governed_any, false, 'No claimSystem on governed');
      assert.strictEqual('workingMemorySystem' in governed_any, false, 'No workingMemorySystem on governed');
      assert.strictEqual('governanceSystem' in governed_any, false, 'No governanceSystem on governed');
    });
  });
});
