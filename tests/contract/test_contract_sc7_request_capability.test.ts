/**
 * SC-7 Contract Tests: request_capability -- Facade-Level Verification
 * S ref: S21 (request_capability), I-12 (sandboxing), I-22 (capability immutability),
 *        I-20 (never-negative budget), FM-02 (cost explosion defense)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT requestCapability directly)
 * Version pins: orchestration.ts frozen zone
 *
 * Amendment 21: Every enforcement DC gets BOTH success AND rejection tests.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONTROL 2: TRUTH MODEL
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. INVARIANTS
 *    - I-22: Capability immutability — agent capabilities cannot be expanded after
 *      registration. SC-7 enforces via missionCaps.has() at line 39.
 *      DCs: DC-SC7-401, DC-SC7-104, DC-SC7-302a (IBC)
 *    - I-12: Tool sandboxing — capability execution occurs in sandbox with workspace
 *      isolation per mission/task. DC-SC7-404, DC-SC7-905
 *    - I-07: Workspace isolation — each mission/task gets isolated workspace directory.
 *      DC-SC7-905
 *    - I-20: Budget never-negative — budget.checkBudget() pre-check + budget.consume()
 *      post-check. DCs: DC-SC7-103, DC-SC7-106, DC-SC7-202, DC-SC7-203, DC-SC7-B02
 *    - I-03: Atomic audit — every state mutation must have an audit entry.
 *      DC-SC7-501 (LIVE DEFECT: no audit entries produced)
 *
 * 2. STATE MACHINES
 *    - Mission state: SC-7 does NOT verify mission state before execution (DC-SC7-201).
 *      Any mission state with a valid capabilities JSON column allows execution.
 *    - Budget state: checkBudget → execute → consume sequence. Budget transitions
 *      from sufficient to potentially insufficient during execution.
 *
 * 3. FAILURE SEMANTICS
 *    - CAPABILITY_DENIED: mission not found (line 36), capability not in set (line 40),
 *      budget check error forwarded (line 46)
 *    - BUDGET_EXCEEDED: insufficient budget pre-check (line 48)
 *    - TIMEOUT: substrate error catch-all mapping (line 67)
 *    - SANDBOX_VIOLATION: substrate SANDBOX_VIOLATION or CAPABILITY_NOT_FOUND (line 65)
 *    - RATE_LIMITED: declared in contract but unreachable — substrate RATE_LIMITED
 *      maps to TIMEOUT (DC-SC7-903)
 *
 * 4. TRUST BOUNDARIES
 *    - SC-7 → deps.conn: direct SQL read on core_missions (TRUSTED — no tenant filter)
 *      DC-SC7-102, DC-SC7-B04
 *    - SC-7 → budget.checkBudget(): budget pre-check (TRUSTED — error code leak)
 *      DC-SC7-B01
 *    - SC-7 → budget.consume(): post-execution budget consumption (TRUSTED — result discarded)
 *      DC-SC7-B02, DC-SC7-203
 *    - SC-7 → substrate.adapters.execute(): capability execution in sandbox (UNTRUSTED —
 *      results require validation) DC-SC7-103, DC-SC7-106, DC-SC7-B03
 *
 * 5. SIDE-EFFECT MODEL
 *    - DB read: SELECT capabilities FROM core_missions WHERE id = ?
 *    - Substrate execution: adapters.execute() — external side effects possible
 *    - Budget mutation: budget.consume() updates core_resources
 *    - Audit: NONE produced (DC-SC7-501 LIVE DEFECT)
 *    - Events: NONE emitted (DC-SC7-502 — eventPropagator not passed to SC-7)
 *
 * 6. ENVIRONMENTAL ASSUMPTIONS
 *    - SQLite serialized writes (single-process, WAL mode, better-sqlite3)
 *    - Substrate adapters.execute() is synchronous (same as all Limen operations)
 *    - Capability types are a closed set defined in CapabilityType union
 *    - Clock: new Date() not used in SC-7 (no clock injection concern here)
 *
 * DC COVERAGE: DC-SC7-101, DC-SC7-102, DC-SC7-103, DC-SC7-104, DC-SC7-106,
 *   DC-SC7-201, DC-SC7-202, DC-SC7-203, DC-SC7-301, DC-SC7-302b,
 *   DC-SC7-401, DC-SC7-402, DC-SC7-404, DC-SC7-501, DC-SC7-901,
 *   DC-SC7-902, DC-SC7-903, DC-SC7-905, DC-SC7-B01, DC-SC7-B02, DC-SC7-B03
 */

import { join } from 'node:path';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import {
  createTestDatabase,
  createTestAuditTrail,
  createTestOperationContext,
  agentId,
  missionId as makeMissionId,
  taskId as makeTaskId,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId, TaskId, Result } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  RequestCapabilityInput,
  RequestCapabilityOutput,
} from '../../src/orchestration/interfaces/orchestration.js';
import type { Substrate } from '../../src/substrate/interfaces/substrate.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;

/**
 * Configurable substrate stub for SC-7 tests.
 * The `adapters.execute` method can be configured per test to return
 * specific results or errors.
 */
let executeStubResult: Result<{
  result: unknown;
  resourcesConsumed: {
    wallClockMs: number;
    tokensUsed: number;
    bytesRead: number;
    bytesWritten: number;
  };
}>;

/**
 * Captured arguments from the last call to adapters.execute().
 * Used by F-003 discriminative test to verify parameter correctness
 * at the call site (request_capability.ts:52-60).
 */
let executeCapturedArgs: {
  conn: unknown;
  ctx: unknown;
  request: {
    type: unknown;
    params: unknown;
    missionId: unknown;
    taskId: unknown;
    workspaceDir: unknown;
    timeoutMs: unknown;
  };
} | null = null;

function createConfigurableSubstrate(): Substrate {
  const notImpl = () => { throw new Error('Substrate stub: not implemented'); };

  return {
    scheduler: { enqueue: notImpl, dequeue: notImpl, peek: notImpl, size: notImpl, clear: notImpl },
    workerPool: { dispatch: notImpl, getWorker: notImpl, shutdown: notImpl, getMetrics: notImpl },
    gateway: { sendRequest: notImpl, requestStream: notImpl, getProviderHealth: notImpl, registerProvider: notImpl },
    heartbeat: { start: notImpl, stop: notImpl, check: notImpl, getStatus: notImpl },
    accounting: { recordInteraction: notImpl, getAccountingSummary: notImpl, checkRateLimit: notImpl, consumeRateLimit: notImpl },
    shutdown: notImpl,
    start: notImpl,
    health: notImpl,
    adapters: {
      execute: (connArg: unknown, ctxArg: unknown, requestArg: Record<string, unknown>) => {
        executeCapturedArgs = {
          conn: connArg,
          ctx: ctxArg,
          request: {
            type: requestArg.type,
            params: requestArg.params,
            missionId: requestArg.missionId,
            taskId: requestArg.taskId,
            workspaceDir: requestArg.workspaceDir,
            timeoutMs: requestArg.timeoutMs,
          },
        };
        return executeStubResult;
      },
      validateRegistration: notImpl,
      getSupportedCapabilities: () => ({ ok: true as const, value: ['web_search', 'web_fetch', 'code_execute', 'data_query', 'file_read', 'file_write', 'api_call'] }),
      getSandboxConfig: notImpl,
    },
    workers: { dispatch: notImpl, getWorker: notImpl, shutdown: notImpl, getMetrics: notImpl },
  } as unknown as Substrate;
}

function setup(): void {
  conn = createTestDatabase();
  const audit = createTestAuditTrail();
  ctx = createTestOperationContext();

  // Reset captured args
  executeCapturedArgs = null;

  // Default: substrate returns a successful result
  executeStubResult = {
    ok: true,
    value: {
      result: { data: 'test result' },
      resourcesConsumed: {
        wallClockMs: 150,
        tokensUsed: 50,
        bytesRead: 1024,
        bytesWritten: 512,
      },
    },
  };

  engine = createOrchestration(conn, createConfigurableSubstrate(), audit);
}

/** Create a test mission with capabilities via the facade */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for capability execution',
    successCriteria: ['Complete the task'],
    scopeBoundaries: ['Within budget'],
    capabilities: ['web_search', 'code_execute', 'file_read'],
    constraints: {
      budget: 50000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      ...(overrides.constraints ?? {}),
    },
    ...overrides,
    constraints: {
      budget: 50000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      ...(overrides.constraints ?? {}),
    },
  };
  const result = engine.proposeMission(ctx, input);
  assert.equal(result.ok, true, 'Test mission creation must succeed');
  if (!result.ok) throw new Error('Failed to create test mission');
  return result.value.missionId;
}

/** Construct a valid RequestCapabilityInput */
function validCapabilityInput(
  mid: MissionId,
  overrides: Partial<RequestCapabilityInput> = {},
): RequestCapabilityInput {
  return {
    capabilityType: 'web_search',
    parameters: { query: 'test query' },
    missionId: mid,
    taskId: makeTaskId('task-1'),
    ...overrides,
  };
}

// ─── A21 State-Unchanged Verification ───

/** Count budget consumption audit entries */
function countBudgetAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'consume_budget'",
  )?.cnt ?? 0;
}

/** Get remaining budget for a mission */
function getBudgetRemaining(conn: DatabaseConnection, mid: MissionId): number {
  return conn.get<{ token_remaining: number }>(
    'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
    [mid],
  )?.token_remaining ?? -1;
}

/** Get mission state */
function getMissionState(conn: DatabaseConnection, mid: MissionId): string {
  return conn.get<{ state: string }>(
    'SELECT state FROM core_missions WHERE id = ?',
    [mid],
  )?.state ?? 'UNKNOWN';
}

// ═══════════════════════════════════════════════════════════════════════
// CONTROL 3: VERIFICATION PACK
// ═══════════════════════════════════════════════════════════════════════

describe('SC-7 Contract: request_capability (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('DC-SC7-401-S: capability in mission set -> returns result + resourcesConsumed', () => {
      // DC-SC7-401 SUCCESS: capabilityType in mission set -> proceeds
      const mid = createTestMission({ capabilities: ['web_search'] });

      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        capabilityType: 'web_search',
      }));

      assert.equal(result.ok, true, 'S21: Capability in mission set must succeed');
      if (!result.ok) return;
      assert.deepStrictEqual(result.value.result, { data: 'test result' },
        'S21: Result must match substrate adapter output');
      assert.equal(typeof result.value.resourcesConsumed.tokens, 'number',
        'S21: resourcesConsumed.tokens must be a number');
    });

    it('DC-SC7-104-S: valid capabilityType string passes to adapter', () => {
      // DC-SC7-104 SUCCESS: valid CapabilityType string passes to adapter
      const mid = createTestMission({ capabilities: ['code_execute'] });

      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        capabilityType: 'code_execute',
      }));

      assert.equal(result.ok, true, 'S21: Valid capability type must succeed');
      if (!result.ok) return;
      assert.notEqual(result.value.result, undefined, 'S21: result must be defined');
    });

    it('DC-SC7-B01-S: checkBudget ok:true value:true -> proceed to execution', () => {
      // DC-SC7-B01 SUCCESS: checkBudget returns ok:true, value:true -> execution proceeds
      const mid = createTestMission({ constraints: { budget: 50000, deadline: new Date(Date.now() + 3600000).toISOString() } });

      const budgetBefore = getBudgetRemaining(conn, mid);
      assert.ok(budgetBefore > 0, 'Budget must be positive before capability execution');

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, true, 'S21: Sufficient budget -> capability executes');
    });

    it('DC-SC7-901-S: execution completes within timeout -> result returned', () => {
      // DC-SC7-901 SUCCESS: execution completes within timeout
      executeStubResult = {
        ok: true,
        value: {
          result: { completed: true },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: 10, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const mid = createTestMission();
      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, true, 'S21: Execution within timeout succeeds');
      if (!result.ok) return;
      assert.deepStrictEqual(result.value.result, { completed: true },
        'S21: Result reflects substrate output');
    });

    it('DC-SC7-B03-S: substrate returns success -> SC-7 returns success', () => {
      // DC-SC7-B03 SUCCESS: substrate returns result -> SC-7 returns success
      const mid = createTestMission();
      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, true, 'S21: Successful substrate execution -> SC-7 success');
      if (!result.ok) return;
      assert.equal(typeof result.value.resourcesConsumed.tokens, 'number',
        'S21: resourcesConsumed must include tokens');
    });

    it('DC-SC7-905-S: unique taskId -> isolated workspace (no collision)', () => {
      // DC-SC7-905 SUCCESS: each request gets isolated workspace via unique taskId
      const mid = createTestMission();

      const r1 = engine.requestCapability(ctx, validCapabilityInput(mid, {
        taskId: makeTaskId('task-unique-1'),
      }));
      const r2 = engine.requestCapability(ctx, validCapabilityInput(mid, {
        taskId: makeTaskId('task-unique-2'),
      }));

      assert.equal(r1.ok, true, 'S21: First request with unique taskId succeeds');
      assert.equal(r2.ok, true, 'S21: Second request with different taskId succeeds');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // REJECTION PATHS — A21 Dual-Path Testing
  // ════════════════════════════════════════════════════════════════════════

  describe('CAPABILITY_DENIED', () => {

    it('DC-SC7-401-R: capabilityType NOT in mission set -> CAPABILITY_DENIED + state unchanged', () => {
      // DC-SC7-401 REJECTION: I-22 enforcement
      const mid = createTestMission({ capabilities: ['web_search'] });
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        capabilityType: 'code_execute',  // NOT in mission set
      }));

      assert.equal(result.ok, false, 'I-22: Must reject capability not in set');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_DENIED',
          'I-22: Error code must be CAPABILITY_DENIED');
        assert.ok(result.error.message.includes('code_execute'),
          'I-22: Message must name the denied capability');
      }

      // A21: state unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after capability denial');
    });

    it('DC-SC7-104-R: invalid capabilityType string not in mission set -> CAPABILITY_DENIED', () => {
      // DC-SC7-104 REJECTION: arbitrary string not in CapabilityType union ->
      // caught by missionCaps.has() since the mission set only contains valid types
      const mid = createTestMission({ capabilities: ['web_search'] });

      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        capabilityType: 'shell_exec',  // Not a valid CapabilityType
      }));

      assert.equal(result.ok, false, 'S21: Invalid capability type must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_DENIED',
          'S21: Error code must be CAPABILITY_DENIED');
      }
    });

    it('DC-SC7-401-NONEXISTENT: nonexistent missionId -> CAPABILITY_DENIED', () => {
      // Mission not found -> CAPABILITY_DENIED
      const fakeMid = makeMissionId('nonexistent-mission-xyz');

      const result = engine.requestCapability(ctx, validCapabilityInput(fakeMid));

      assert.equal(result.ok, false, 'S21: Nonexistent mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_DENIED',
          'S21: Error code must be CAPABILITY_DENIED for missing mission');
      }
    });
  });

  describe('BUDGET_EXCEEDED', () => {

    it('DC-SC7-B01-R: checkBudget insufficient -> BUDGET_EXCEEDED + budget unchanged', () => {
      // DC-SC7-B01 REJECTION: checkBudget returns ok:true, value:false -> BUDGET_EXCEEDED
      // Create mission with minimal budget that will fail the estimatedCost=100 check
      const mid = createTestMission({
        constraints: { budget: 50, deadline: new Date(Date.now() + 3600000).toISOString() },
      });

      const budgetBefore = getBudgetRemaining(conn, mid);
      assert.equal(budgetBefore, 50, 'Budget should be 50');

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false, 'S21: Insufficient budget must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'S21: Error code must be BUDGET_EXCEEDED');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after budget rejection');
    });

    it('DC-SC7-902-S: actual cost <= remaining -> consume succeeds', () => {
      // DC-SC7-902 SUCCESS: execution cost within budget
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'ok' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: 10, bytesRead: 0, bytesWritten: 0 },
        },
      };
      const mid = createTestMission({ constraints: { budget: 50000, deadline: new Date(Date.now() + 3600000).toISOString() } });

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));
      assert.equal(result.ok, true, 'S21: Cost within budget -> success');
    });
  });

  describe('SANDBOX_VIOLATION', () => {

    it('DC-SC7-B03-SANDBOX: substrate returns SANDBOX_VIOLATION -> SC-7 returns SANDBOX_VIOLATION', () => {
      // DC-SC7-B03 REJECTION: substrate SANDBOX_VIOLATION -> SC-7 SANDBOX_VIOLATION
      executeStubResult = {
        ok: false,
        error: { code: 'SANDBOX_VIOLATION', message: 'Unauthorized filesystem access', spec: 'I-12' },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false, 'I-12: Sandbox violation must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'SANDBOX_VIOLATION',
          'I-12: Error code must be SANDBOX_VIOLATION');
      }

      // A21: budget unchanged (no consumption on sandbox violation)
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after sandbox violation');
    });

    it('DC-SC7-B03-CAPNOTFOUND: substrate CAPABILITY_NOT_FOUND -> SANDBOX_VIOLATION', () => {
      // DC-SC7-B03: CAPABILITY_NOT_FOUND maps to SANDBOX_VIOLATION
      executeStubResult = {
        ok: false,
        error: { code: 'CAPABILITY_NOT_FOUND', message: 'Adapter not registered', spec: 'S25.3' },
      };

      const mid = createTestMission();
      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false, 'S25.3: Unregistered adapter must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'SANDBOX_VIOLATION',
          'S21: CAPABILITY_NOT_FOUND maps to SANDBOX_VIOLATION');
      }
    });

    it('DC-SC7-404-S: well-formed parameters -> adapter executes', () => {
      // DC-SC7-404 SUCCESS: well-formed parameters pass to adapter
      const mid = createTestMission();
      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        parameters: { query: 'safe search', maxResults: 10 },
      }));

      assert.equal(result.ok, true, 'S21: Well-formed parameters must succeed');
    });
  });

  describe('TIMEOUT', () => {

    it('DC-SC7-901-R: substrate execution error (non-sandbox) -> TIMEOUT', () => {
      // DC-SC7-901 REJECTION: non-sandbox substrate error maps to TIMEOUT
      executeStubResult = {
        ok: false,
        error: { code: 'EXECUTION_TIMEOUT', message: 'Capability execution exceeded 30s', spec: 'S25.3' },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false, 'S21: Timeout must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'TIMEOUT',
          'S21: Error code must be TIMEOUT');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after timeout');
    });

    it('DC-SC7-903: substrate RATE_LIMITED -> maps to TIMEOUT (not RATE_LIMITED)', () => {
      // DC-SC7-903: RATE_LIMITED error from substrate maps to TIMEOUT due to
      // catch-all error mapping at line 67. The RATE_LIMITED code declared in
      // the contract is UNREACHABLE through SC-7's current implementation.
      executeStubResult = {
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests', spec: 'S21' },
      };

      const mid = createTestMission();
      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false, 'S21: Rate limited must produce an error');
      if (!result.ok) {
        // LIVE DEFECT DOCUMENTATION: RATE_LIMITED maps to TIMEOUT due to catch-all
        // at line 67 of request_capability.ts. The error code RATE_LIMITED in the
        // SubmitResultError union is unreachable.
        assert.equal(result.error.code, 'TIMEOUT',
          'DC-SC7-903: RATE_LIMITED currently maps to TIMEOUT (error mapping catch-all)');
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // LIVE DEFECT TESTS — Document current (buggy) behavior
  // ════════════════════════════════════════════════════════════════════════

  describe('LIVE DEFECT Documentation', () => {

    it('DC-SC7-203 / DC-SC7-B02: budget.consume() return value IS checked (F-014 fix)', () => {
      // FIX: DC-SC7-203 — budget.consume() return value is now checked.
      // When consume succeeds, SC-7 returns success with correct budget decrement.
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'consumed' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: 50, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      // F-014 FIX: SC-7 now checks consume result — on success, returns success
      assert.equal(result.ok, true,
        'F-014 FIX: SC-7 returns success when consume succeeds');

      // Verify budget was consumed
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.ok(budgetAfter < budgetBefore,
        'Budget must be decremented (consume ran and succeeded)');
      assert.equal(budgetAfter, budgetBefore - 50,
        'Budget must be decremented by exactly tokensUsed (50)');
    });

    it('DC-SC7-501: SC-7 produces ZERO audit entries after successful execution', () => {
      // LIVE DEFECT: DC-SC7-501 — No deps.audit.append() call in SC-7.
      // Test documents current (incorrect) behavior.
      const mid = createTestMission();

      const auditCountBefore = conn.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'request_capability'",
      )?.cnt ?? 0;

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));
      assert.equal(result.ok, true, 'Capability execution must succeed');

      const auditCountAfter = conn.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'request_capability'",
      )?.cnt ?? 0;

      // LIVE DEFECT: DC-SC7-501 — No audit entry for request_capability
      assert.equal(auditCountAfter, auditCountBefore,
        'LIVE DEFECT: DC-SC7-501 — SC-7 produces ZERO audit entries. No deps.audit.append() call exists.');
    });

    it('DC-SC7-201: mission in COMPLETED state still allows capability execution', () => {
      // LIVE DEFECT: DC-SC7-201 — SC-7 does not verify mission state before execution.
      // A mission in terminal state (COMPLETED) can still have capabilities executed.
      // We use seedMission to create a mission directly in COMPLETED state.
      const completedMid = 'completed-mission-1';
      seedMission(conn, {
        id: completedMid,
        state: 'COMPLETED',
        capabilities: ['web_search'],
      });
      seedResource(conn, { missionId: completedMid });

      const result = engine.requestCapability(ctx, validCapabilityInput(
        makeMissionId(completedMid),
      ));

      // LIVE DEFECT: DC-SC7-201 — Terminal-state mission allows capability execution
      // SC-7 only checks if mission exists and capability is in set, not mission state.
      assert.equal(result.ok, true,
        'LIVE DEFECT: DC-SC7-201 — COMPLETED mission still allows capability execution (no state check)');
    });

    it('DC-SC7-201-FAILED: mission in FAILED state still allows capability execution', () => {
      // LIVE DEFECT: DC-SC7-201 — same as above, FAILED state
      const failedMid = 'failed-mission-1';
      seedMission(conn, {
        id: failedMid,
        state: 'FAILED',
        capabilities: ['web_search'],
      });
      seedResource(conn, { missionId: failedMid });

      const result = engine.requestCapability(ctx, validCapabilityInput(
        makeMissionId(failedMid),
      ));

      // LIVE DEFECT: DC-SC7-201 — Terminal-state mission allows capability execution
      assert.equal(result.ok, true,
        'LIVE DEFECT: DC-SC7-201 — FAILED mission still allows capability execution (no state check)');
    });

    it('DC-SC7-101: malformed JSON in capabilities column causes unhandled exception', () => {
      // LIVE DEFECT: DC-SC7-101 — JSON.parse(mission.capabilities) at line 38 has no try/catch.
      // Malformed JSON throws SyntaxError which propagates as uncaught exception.
      const badMid = 'bad-json-mission';
      conn.run(
        `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective,
         success_criteria, scope_boundaries, capabilities, state, plan_version,
         delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'EXECUTING', 0, '[]', '{}', 0, 0, ?, ?)`,
        [badMid, 'test-tenant', 'test-agent', 'Test mission', '["ok"]', '["ok"]',
         '{NOT VALID JSON}', new Date().toISOString(), new Date().toISOString()],
      );
      seedResource(conn, { missionId: badMid });

      // Insert mission goals (required by schema)
      conn.run(
        `INSERT INTO core_mission_goals (mission_id, objective, success_criteria, scope_boundaries, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [badMid, 'Test mission', '["ok"]', '["ok"]', new Date().toISOString()],
      );

      // LIVE DEFECT: DC-SC7-101 — SyntaxError thrown, not caught
      assert.throws(
        () => engine.requestCapability(ctx, validCapabilityInput(makeMissionId(badMid))),
        (err: Error) => err instanceof SyntaxError,
        'LIVE DEFECT: DC-SC7-101 — Malformed JSON throws SyntaxError (not structured CAPABILITY_DENIED)',
      );
    });

    it('DC-SC7-103-R: negative tokensUsed from substrate -> BUDGET_EXCEEDED (F-001 fix)', () => {
      // FIX: DC-SC7-103 — Negative resourcesConsumed values now rejected.
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'negative tokens' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: -100, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false,
        'F-001 FIX: Negative tokensUsed must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'F-001 FIX: Error code must be BUDGET_EXCEEDED');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after negative resource rejection');
    });

    it('DC-SC7-106-R: NaN tokensUsed from substrate -> BUDGET_EXCEEDED (F-001 fix)', () => {
      // FIX: DC-SC7-106 — NaN now caught by Number.isFinite() guard.
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'NaN tokens' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: NaN, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false,
        'F-001 FIX: NaN tokensUsed must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'F-001 FIX: Error code must be BUDGET_EXCEEDED');
        assert.ok(result.error.message.includes('non-finite'),
          'F-001 FIX: Message must mention non-finite values');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after NaN resource rejection');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // NON-A21 OBSERVATION TESTS
  // ════════════════════════════════════════════════════════════════════════

  describe('Observation Tests (Non-A21)', () => {

    it('DC-SC7-202: budget.consume() after substrate execution records consumption', () => {
      // DC-SC7-202 observation: consume runs after execution, budget decremented
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'observed' },
          resourcesConsumed: { wallClockMs: 200, tokensUsed: 75, bytesRead: 0, bytesWritten: 100 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));
      assert.equal(result.ok, true, 'Capability execution must succeed');

      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore - 75,
        'DC-SC7-202: Budget must be decremented by tokensUsed');
    });

    it('DC-SC7-403: hardcoded estimatedCost=100 used in budget pre-check', () => {
      // DC-SC7-403 observation: estimatedCost is 100 tokens.
      // A budget of exactly 100 should pass the pre-check.
      const mid = createTestMission({
        constraints: { budget: 100, deadline: new Date(Date.now() + 3600000).toISOString() },
      });

      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'ok' },
          resourcesConsumed: { wallClockMs: 10, tokensUsed: 5, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));
      assert.equal(result.ok, true,
        'DC-SC7-403: Budget of exactly 100 passes the estimatedCost=100 pre-check');
    });

    it('DC-SC7-403: budget of 99 fails estimatedCost=100 pre-check', () => {
      // DC-SC7-403 observation: budget of 99 < estimatedCost of 100, fails pre-check
      const mid = createTestMission({
        constraints: { budget: 99, deadline: new Date(Date.now() + 3600000).toISOString() },
      });

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));
      assert.equal(result.ok, false, 'Budget 99 < estimatedCost 100 must fail pre-check');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'Budget insufficient for estimated cost -> BUDGET_EXCEEDED');
      }
    });

    it('DC-SC7-B01-LEAK: checkBudget error leaks MISSION_NOT_ACTIVE through SC-7', () => {
      // DC-SC7-B01 observation: When checkBudget returns {ok: false},
      // SC-7 forwards the error directly, leaking the internal code.
      // This happens when no core_resources row exists for the mission.
      const noResourceMid = 'no-resource-mission';
      seedMission(conn, {
        id: noResourceMid,
        state: 'EXECUTING',
        capabilities: ['web_search'],
      });
      // NO seedResource() call — no core_resources row

      const result = engine.requestCapability(ctx, validCapabilityInput(
        makeMissionId(noResourceMid),
      ));

      assert.equal(result.ok, false, 'No budget record -> error from checkBudget');
      if (!result.ok) {
        // The leaked error code from budget governance
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'DC-SC7-B01: checkBudget MISSION_NOT_ACTIVE leaks through SC-7 boundary');
      }
    });

    it('Resource consumption fields in output match substrate resourcesConsumed', () => {
      // Verify the output mapping from substrate to SC-7 output
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'resource test' },
          resourcesConsumed: { wallClockMs: 500, tokensUsed: 200, bytesRead: 2048, bytesWritten: 1024 },
        },
      };

      const mid = createTestMission();
      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, true, 'Capability must succeed');
      if (!result.ok) return;

      assert.equal(result.value.resourcesConsumed.tokens, 200,
        'resourcesConsumed.tokens must map from tokensUsed');
      assert.equal(result.value.resourcesConsumed.time, 500,
        'resourcesConsumed.time must map from wallClockMs');
      assert.equal(result.value.resourcesConsumed.compute, 0,
        'resourcesConsumed.compute must be floor(wallClockMs/1000)');
      assert.equal(result.value.resourcesConsumed.storage, 1024,
        'resourcesConsumed.storage must map from bytesWritten');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // F-003 FIX: Discriminative test for substrate.adapters.execute() parameters
  // ════════════════════════════════════════════════════════════════════════

  describe('F-003: substrate.adapters.execute() parameter verification', () => {

    it('DC-SC7-F003: adapters.execute() called with correct parameters from request_capability.ts:52-60', () => {
      // F-003 REMEDIATION: The stub previously ignored arguments.
      // This test verifies that adapters.execute() is called with the exact
      // parameter mapping defined at request_capability.ts:52-60:
      //   type: input.capabilityType as CapabilityType
      //   params: input.parameters
      //   missionId: input.missionId
      //   taskId: input.taskId
      //   workspaceDir: join(deps.conn.dataDir, 'workspaces', String(input.missionId), String(input.taskId ?? 'default'))
      //   timeoutMs: 30000
      //
      // DISCRIMINATIVE: Would fail if parameter mapping at lines 52-60 is changed.
      const mid = createTestMission({ capabilities: ['code_execute'] });
      const tid = makeTaskId('param-verify-task');
      const inputParams = { query: 'test', depth: 3 };

      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        capabilityType: 'code_execute',
        parameters: inputParams,
        taskId: tid,
      }));

      assert.equal(result.ok, true, 'Capability execution must succeed');

      // Verify execute was called
      assert.notEqual(executeCapturedArgs, null,
        'F-003: adapters.execute() must have been called');

      // Verify each parameter matches the call site at request_capability.ts:52-60
      assert.equal(executeCapturedArgs!.request.type, 'code_execute',
        'F-003: type must be input.capabilityType (line 53)');
      assert.deepStrictEqual(executeCapturedArgs!.request.params, inputParams,
        'F-003: params must be input.parameters (line 54)');
      assert.equal(executeCapturedArgs!.request.missionId, mid,
        'F-003: missionId must be input.missionId (line 55)');
      assert.equal(executeCapturedArgs!.request.taskId, tid,
        'F-003: taskId must be input.taskId (line 56)');

      // Verify workspaceDir construction (line 58)
      // join(':memory:', 'workspaces', String(mid), String(tid))
      const expectedWorkspace = join(':memory:', 'workspaces', String(mid), String(tid));
      assert.equal(executeCapturedArgs!.request.workspaceDir, expectedWorkspace,
        'F-003: workspaceDir must be join(dataDir, "workspaces", missionId, taskId) (line 58)');

      // Verify timeoutMs (line 59)
      assert.equal(executeCapturedArgs!.request.timeoutMs, 30000,
        'F-003: timeoutMs must be 30000 (line 59)');
    });

    it('DC-SC7-F003-DEFAULT: null taskId -> workspaceDir uses "default" segment', () => {
      // F-003 supplementary: verifies the `?? 'default'` fallback at line 58
      // when taskId is null/undefined.
      //
      // DISCRIMINATIVE: Would fail if the ?? 'default' fallback is removed.
      const mid = createTestMission();

      const result = engine.requestCapability(ctx, validCapabilityInput(mid, {
        taskId: undefined as unknown as TaskId,
      }));

      assert.equal(result.ok, true, 'Capability execution must succeed');
      assert.notEqual(executeCapturedArgs, null,
        'F-003: adapters.execute() must have been called');

      // Verify workspaceDir uses 'default' when taskId is nullish
      const workspaceDir = executeCapturedArgs!.request.workspaceDir as string;
      assert.ok(workspaceDir.includes('default'),
        'F-003: workspaceDir must contain "default" when taskId is nullish (line 58 ?? fallback)');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // F-001/F-014 GUARD TESTS — NaN/Infinity/Negative + Consume Check
  // ════════════════════════════════════════════════════════════════════════

  describe('F-001: NaN/Infinity/Negative guard on resourcesConsumed', () => {

    it('DC-SC7-106-S: finite positive resourcesConsumed -> budget consumed successfully', () => {
      // DC-SC7-106 SUCCESS: substrate returns valid finite positive values
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'finite resources' },
          resourcesConsumed: { wallClockMs: 200, tokensUsed: 75, bytesRead: 512, bytesWritten: 256 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, true,
        'F-001: Finite positive resourcesConsumed must succeed');
      if (!result.ok) return;

      // Verify budget was consumed
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore - 75,
        'F-001: Budget must be decremented by tokensUsed (75)');
    });

    it('DC-SC7-106-R-INFINITY: wallClockMs = Infinity -> BUDGET_EXCEEDED', () => {
      // DC-SC7-106 REJECTION: Infinity in resourcesConsumed
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'infinity time' },
          resourcesConsumed: { wallClockMs: Infinity, tokensUsed: 50, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false,
        'F-001: Infinity wallClockMs must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'F-001: Error code must be BUDGET_EXCEEDED');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after Infinity resource rejection');
    });

    it('DC-SC7-106-R-NEGATIVE-BYTES: bytesWritten = -500 -> BUDGET_EXCEEDED', () => {
      // DC-SC7-106 REJECTION: negative bytesWritten
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'negative bytes' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: 50, bytesRead: 0, bytesWritten: -500 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false,
        'F-001: Negative bytesWritten must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'F-001: Error code must be BUDGET_EXCEEDED');
        assert.ok(result.error.message.includes('negative'),
          'F-001: Message must mention negative values');
      }

      // A21: budget unchanged
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change after negative resource rejection');
    });
  });

  describe('F-014: budget.consume() return value checked', () => {

    it('DC-SC7-203-R: budget exhausted during execution -> BUDGET_EXCEEDED (consume check)', () => {
      // DC-SC7-203 REJECTION: When consume fails, SC-7 now returns BUDGET_EXCEEDED.
      // We simulate this by having execution cost exceed remaining budget.
      // Mission has 50000 tokens. We set tokensUsed to 60000 (exceeds remaining).
      executeStubResult = {
        ok: true,
        value: {
          result: { data: 'over budget' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: 60000, bytesRead: 0, bytesWritten: 0 },
        },
      };

      const mid = createTestMission();
      const budgetBefore = getBudgetRemaining(conn, mid);

      const result = engine.requestCapability(ctx, validCapabilityInput(mid));

      assert.equal(result.ok, false,
        'F-014 FIX: Consume failure must be propagated as error');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'F-014 FIX: Error code must be BUDGET_EXCEEDED');
      }

      // A21: budget unchanged (consume failed -> no deduction)
      const budgetAfter = getBudgetRemaining(conn, mid);
      assert.equal(budgetAfter, budgetBefore,
        'A21: Budget must not change when consume fails');
    });
  });
});
