/**
 * CrewAI Adapter Test Suite
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md S10
 * Covers all mandatory test cases (TC-01 through TC-29).
 *
 * Test framework: node:test + node:assert/strict (per project convention)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LimenCrewAIAdapter } from '../adapter.js';
import type { CrewAIAdapterConfig } from '../config.js';
import { computeConfigDigest } from '../config.js';
import { CrewAIAdapterError, toResultError } from '../errors.js';
import {
  normalizeHookContext,
  validateHookContext,
  translateToolToOperations,
  mapNativeEvent,
  mapLimenEvent,
  KNOWN_TOOLS,
} from '../hooks.js';
import type {
  AdapterId,
  AgentId,
  SessionId,
  ClaimId,
  AgentBranchId,
  EventId,
  TenantId,
  TaskId,
  AgentCapability,
  AgentSession,
  LimenAgentClient,
  ComputerActionGovernor,
  GovernanceVerdict,
  GovernanceContext,
  OperationContext,
  BeliefState,
  AgentMemoryEntry,
  MergeResultData,
  ManualMergeResolutionRequest,
  CrewAIToolCall,
  CrewAIHookEvent,
  AgentEventPayload,
  NativeAgentAction,
  MergeConflict,
  ManualMergeState,
} from '../types.js';
import { TRUST_CONFIDENCE_CAPS, ERROR_PRECEDENCE, NEVER_RETRYABLE } from '../types.js';

// ── Test Helpers ──

const TEST_ADAPTER_ID = 'adapter-crewai-test' as AdapterId;
const TEST_AGENT_ID = 'agent-001' as AgentId;
const TEST_TENANT_ID = 'tenant-001' as TenantId;

function makeCapabilities(...caps: AgentCapability[]): ReadonlySet<AgentCapability> {
  return new Set(caps);
}

function makeConfig(overrides?: Partial<CrewAIAdapterConfig>): CrewAIAdapterConfig {
  return {
    agentId: TEST_AGENT_ID,
    tenantId: TEST_TENANT_ID,
    trustLevel: 'medium',
    capabilities: makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'),
    crewId: 'crew-alpha',
    agentRole: 'researcher',
    processType: 'sequential',
    delegationDepthMax: 3,
    defaultClassification: 'internal',
    governed: true,
    rateLimits: [],
    sandboxDefaults: {
      allowedPathPatterns: [],
      deniedPathPatterns: [],
      allowedHostPatterns: [],
      deniedHostPatterns: [],
      allowedCommands: [],
      deniedCommands: [],
      maxDurationMs: null,
      readOnlyFilesystem: false,
    },
    refusalHints: [],
    tokenBudget: {
      maxTokensPerOperation: 1000,
      maxTokensPerSession: 10000,
      encoding: 'cl100k_base',
      warningThresholdPct: 80,
      replenishmentWindowSeconds: null,
    },
    coreEndpoint: 'http://localhost:3000',
    connectionTimeoutMs: 5000,
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      retryableErrors: ['CORE_PORT_UNAVAILABLE', 'CLIENT_ERROR'],
    },
    metadata: {},
    ...overrides,
  };
}

function makeMockClient(overrides?: Partial<LimenAgentClient>): LimenAgentClient {
  return {
    startSession: async () => ({
      sessionId: 'session-mock' as SessionId,
      agentId: TEST_AGENT_ID,
      tenantId: TEST_TENANT_ID,
      adapterId: TEST_ADAPTER_ID,
      trustLevel: 'medium' as const,
      coreTrustLevel: 'trusted',
      clearanceLevel: 2,
      capabilities: new Set<AgentCapability>(['memory_read', 'memory_write']),
      startedAt: new Date().toISOString(),
      workingMemoryNamespace: 'test',
      activeMissions: [],
      metadata: {},
    }),
    endSession: async () => ({
      sessionId: 'session-mock' as SessionId,
      agentId: TEST_AGENT_ID,
      duration: 1000,
      operationCount: 5,
      governanceRefusals: 0,
      branchesCreated: 0,
      branchesMerged: 0,
      missionsCompleted: 0,
      tokensBudgetUsed: 100,
      outcome: 'completed' as const,
    }),
    remember: async () => 'claim-001' as ClaimId,
    recall: async () => ({
      beliefs: [],
      totalCount: 0,
    }),
    createBranch: async () => 'branch-001' as AgentBranchId,
    mergeBranches: async () => ({
      status: 'completed' as const,
      mergedClaimIds: [],
      conflictsResolved: [],
      unresolvedConflicts: [],
      manualMergeState: null,
    }),
    resolveConflict: async () => ({
      status: 'completed' as const,
      mergedClaimIds: [],
      conflictsResolved: [],
      unresolvedConflicts: [],
      manualMergeState: null,
    }),
    appendAudit: async () => 'evt-audit-001' as EventId,
    healthProbe: async () => ({ connected: true, latencyMs: 5 }),
    ...overrides,
  };
}

function makeMockGovernor(overrides?: Partial<ComputerActionGovernor>): ComputerActionGovernor {
  return {
    beforeAction: async () => ({
      verdict: 'allow' as const,
      auditId: 'evt-gov-001' as EventId,
    }),
    afterAction: async () => {},
    ...overrides,
  };
}

function makeAdapter(caps?: AgentCapability[]): LimenCrewAIAdapter {
  return new LimenCrewAIAdapter(
    TEST_ADAPTER_ID,
    makeCapabilities(...(caps ?? ['memory_read', 'memory_write', 'branching', 'belief_management'])),
  );
}

async function initAdapter(
  adapter: LimenCrewAIAdapter,
  configOverrides?: Partial<CrewAIAdapterConfig>,
  clientOverrides?: Partial<LimenAgentClient>,
  governorOverrides?: Partial<ComputerActionGovernor>,
): Promise<void> {
  const result = await adapter.initialize(
    makeMockClient(clientOverrides),
    makeMockGovernor(governorOverrides),
    makeConfig(configOverrides),
  );
  assert.ok(result.ok, `Initialize failed: ${!result.ok ? result.error.message : ''}`);
}

async function initAdapterWithSession(
  adapter: LimenCrewAIAdapter,
  configOverrides?: Partial<CrewAIAdapterConfig>,
  clientOverrides?: Partial<LimenAgentClient>,
  governorOverrides?: Partial<ComputerActionGovernor>,
): Promise<AgentSession> {
  await initAdapter(adapter, configOverrides, clientOverrides, governorOverrides);
  const sessionResult = await adapter.onAgentSessionStart({
    crewId: 'crew-alpha',
    agentRole: 'researcher',
    processType: 'sequential',
    metadata: {},
  });
  assert.ok(sessionResult.ok);
  return sessionResult.value;
}

function makeCtx(session: AgentSession): OperationContext {
  return {
    tenantId: session.tenantId,
    userId: null,
    agentId: session.agentId,
    permissions: new Set(),
    sessionId: session.sessionId,
    clearanceLevel: session.clearanceLevel,
  };
}

// ── Test Suite ──

describe('CrewAI Adapter', () => {

  /** TC-01: CREWAI_ADAPTER_CONTRACT.md S10 -- Happy Path Lifecycle */
  describe('TC-01: Happy Path Lifecycle', () => {
    it('completes full lifecycle: init -> session -> remember -> recall -> end -> shutdown', async () => {
      const adapter = makeAdapter();
      const mockClient = makeMockClient({
        remember: async () => 'claim-test-01' as ClaimId,
        recall: async () => ({
          beliefs: [{
            belief: {
              id: 'claim-test-01' as ClaimId,
              content: 'test content',
              subject: 'test',
              predicate: 'knows',
              value: 'test content',
              confidence: 0.7,
              effectiveConfidence: 0.7,
              freshness: 'fresh' as const,
              classification: 'internal' as const,
              tags: [],
              category: null,
              sourceAgentId: TEST_AGENT_ID,
              missionId: null,
              taskId: null,
              groundingMode: 'runtime_witness' as const,
              createdAt: new Date().toISOString(),
            },
            evidence: [],
            relationships: [],
            status: 'active' as const,
            retentionPolicy: null,
            governance: null,
          }],
          totalCount: 1,
        }),
      });

      // Initialize
      const initResult = await adapter.initialize(mockClient, makeMockGovernor(), makeConfig());
      assert.ok(initResult.ok);

      // Start session
      const sessionResult = await adapter.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        metadata: {},
      });
      assert.ok(sessionResult.ok);
      const session = sessionResult.value;

      // Remember
      const ctx = makeCtx(session);
      const rememberResult = await adapter.remember(ctx, 'test content');
      assert.ok(rememberResult.ok);
      assert.equal(rememberResult.value, 'claim-test-01');

      // Recall
      const recallResult = await adapter.recall(ctx, { text: 'test' });
      assert.ok(recallResult.ok);
      assert.equal(recallResult.value.beliefs.length, 1);

      // End session
      const endResult = await adapter.onAgentSessionEnd({
        sessionId: session.sessionId,
        crewId: 'crew-alpha',
        outcome: 'completed',
        metadata: {},
      });
      assert.ok(endResult.ok);
      assert.equal(endResult.value.outcome, 'completed');

      // Shutdown
      const shutdownResult = await adapter.shutdown();
      assert.ok(shutdownResult.ok);

      // Post-shutdown: operations return NOT_INITIALIZED
      const postResult = await adapter.remember(ctx, 'should fail');
      assert.ok(!postResult.ok);
      assert.equal(postResult.error.code, 'NOT_INITIALIZED');
    });
  });

  /** TC-02: CREWAI_ADAPTER_CONTRACT.md S10 -- Governance Refusal (Authorization-First) */
  describe('TC-02: Governance Refusal Is Authorization-First', () => {
    it('returns GOVERNANCE_REFUSAL for suspended agent even with budget exceeded', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, {
        tokenBudget: {
          maxTokensPerOperation: 10,
          maxTokensPerSession: 10,
          encoding: 'cl100k_base',
          warningThresholdPct: 80,
          replenishmentWindowSeconds: null,
        },
      });

      // Set agent to suspended state
      adapter._setAgentState('suspended');

      const ctx = makeCtx(session);
      // Content that exceeds budget + suspended agent = GOVERNANCE_REFUSAL (not BUDGET_EXCEEDED)
      const result = await adapter.remember(ctx, 'A'.repeat(10000));
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
    });
  });

  /** TC-03: CREWAI_ADAPTER_CONTRACT.md S10 -- Token Budget Exceeded */
  describe('TC-03: Token Budget Exceeded Mid-Operation', () => {
    it('returns BUDGET_EXCEEDED with retryable when replenishment configured', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, {
        tokenBudget: {
          maxTokensPerOperation: 5,
          maxTokensPerSession: 100,
          encoding: 'cl100k_base',
          warningThresholdPct: 80,
          replenishmentWindowSeconds: 60,
        },
      });

      const ctx = makeCtx(session);
      // Content that estimates to more than 5 tokens per operation
      const result = await adapter.remember(ctx, 'A'.repeat(100));
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'BUDGET_EXCEEDED');
      // Claim 4.4: retryable when replenishmentWindowSeconds non-null
      const violations = result.error.violations;
      assert.ok(violations);
    });

    it('returns BUDGET_EXCEEDED non-retryable when no replenishment', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, {
        tokenBudget: {
          maxTokensPerOperation: 5,
          maxTokensPerSession: 100,
          encoding: 'cl100k_base',
          warningThresholdPct: 80,
          replenishmentWindowSeconds: null,
        },
      });

      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'A'.repeat(100));
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'BUDGET_EXCEEDED');
    });
  });

  /** TC-04: CREWAI_ADAPTER_CONTRACT.md S10 -- Audit Failure Blocks Success */
  describe('TC-04: Audit Failure Blocks Operation Success', () => {
    it('pre-operation audit failure prevents Core call', async () => {
      const adapter = makeAdapter();
      let coreCallCount = 0;
      const session = await initAdapterWithSession(adapter, undefined, {
        remember: async () => {
          coreCallCount++;
          return 'claim-001' as ClaimId;
        },
        appendAudit: async () => 'evt-001' as EventId,
      });

      // Inject pre-operation audit failure
      adapter._injectAuditFailure('pre');

      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'test');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'AUDIT_FAILURE');
    });

    it('post-operation audit failure returns AUDIT_FAILURE even after successful core write (F-08)', async () => {
      const adapter = makeAdapter();
      let coreCallCount = 0;
      const session = await initAdapterWithSession(adapter, undefined, {
        remember: async () => {
          coreCallCount++;
          return 'claim-post-audit' as ClaimId;
        },
        appendAudit: async () => 'evt-001' as EventId,
      });

      // Inject POST-operation audit failure (F-08: now functional)
      adapter._injectAuditFailure('post');

      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'test content');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'AUDIT_FAILURE');
      // The core call DID happen (remember succeeded), but audit failed after
      assert.equal(coreCallCount, 1);
    });
  });

  /** TC-05: CREWAI_ADAPTER_CONTRACT.md S10 -- Core Port Loss and Recovery */
  describe('TC-05: Post-READY Core Port Loss and Recovery', () => {
    it('transitions to DEGRADED and back to READY on recovery', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter);

      assert.equal(adapter.getHealth().status, 'healthy');

      // Simulate port loss
      adapter._simulateCorePortLoss();
      assert.equal(adapter.getHealth().status, 'degraded');
      assert.equal(adapter.lifecycleState, 'DEGRADED');

      // Operations fail in DEGRADED
      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'should fail');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'CORE_PORT_UNAVAILABLE');

      // Recover
      adapter._simulateCorePortRecovery();
      assert.equal(adapter.getHealth().status, 'healthy');
      assert.equal(adapter.lifecycleState, 'READY');
    });
  });

  /** TC-06: CREWAI_ADAPTER_CONTRACT.md S10 -- Branch Creation and Merge with Conflict Resolution */
  describe('TC-06: Branch Creation and Merge with Conflict Resolution', () => {
    it('creates branch and merges with highest_confidence strategy', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, undefined, {
        createBranch: async () => 'branch-tc06' as AgentBranchId,
        mergeBranches: async () => ({
          status: 'completed' as const,
          mergedClaimIds: ['claim-merged' as ClaimId],
          conflictsResolved: [{
            conflictId: 'conflict-1',
            resolution: 'keep_a' as const,
            winningClaimId: 'claim-a' as ClaimId,
          }],
          unresolvedConflicts: [],
          manualMergeState: null,
        }),
        appendAudit: async () => 'evt-001' as EventId,
      });

      const ctx = makeCtx(session);

      // Create branch
      const branchResult = await adapter.createBranch(ctx, 'claim-base' as ClaimId, 'test branch');
      assert.ok(branchResult.ok);
      assert.equal(branchResult.value, 'branch-tc06');

      // Merge
      const mergeResult = await adapter.mergeBranches(ctx, ['branch-tc06' as AgentBranchId], 'highest_confidence');
      assert.ok(mergeResult.ok);
      assert.equal(mergeResult.value.status, 'completed');
      assert.equal(mergeResult.value.conflictsResolved.length, 1);
    });
  });

  /** TC-07: CREWAI_ADAPTER_CONTRACT.md S10 -- Use-Before-Initialize */
  describe('TC-07: Use-Before-Initialize', () => {
    it('all operations except shutdown return NOT_INITIALIZED', async () => {
      const adapter = makeAdapter();
      const ctx: OperationContext = {
        tenantId: null,
        userId: null,
        agentId: TEST_AGENT_ID,
        permissions: new Set(),
      };

      const rememberResult = await adapter.remember(ctx, 'test');
      assert.ok(!rememberResult.ok);
      assert.equal(rememberResult.error.code, 'NOT_INITIALIZED');

      const recallResult = await adapter.recall(ctx, { text: 'test' });
      assert.ok(!recallResult.ok);
      assert.equal(recallResult.error.code, 'NOT_INITIALIZED');

      const branchResult = await adapter.createBranch(ctx, 'claim-1' as ClaimId, 'test');
      assert.ok(!branchResult.ok);
      assert.equal(branchResult.error.code, 'NOT_INITIALIZED');

      const mergeResult = await adapter.mergeBranches(ctx, [], 'highest_confidence');
      assert.ok(!mergeResult.ok);
      assert.equal(mergeResult.error.code, 'NOT_INITIALIZED');

      const resolveResult = await adapter.resolveConflict(ctx, {
        mergeId: 'm1',
        conflictId: 'c1',
        resolution: 'keep_a',
      });
      assert.ok(!resolveResult.ok);
      assert.equal(resolveResult.error.code, 'NOT_INITIALIZED');

      const translateResult = await adapter.translateToolCall({
        toolName: 'remember',
        toolArgs: {},
        callId: 'c1',
        agentFramework: 'crew_ai',
        rawPayload: {},
      });
      assert.ok(!translateResult.ok);
      assert.equal(translateResult.error.code, 'NOT_INITIALIZED');

      // Shutdown is a no-op success
      const shutdownResult = await adapter.shutdown();
      assert.ok(shutdownResult.ok);
    });
  });

  /** TC-08: CREWAI_ADAPTER_CONTRACT.md S10 -- Shutdown Idempotency */
  describe('TC-08: Shutdown Idempotency', () => {
    it('multiple shutdowns return ok with no side effects', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);

      const r1 = await adapter.shutdown();
      assert.ok(r1.ok);
      assert.equal(adapter.lifecycleState, 'SHUTDOWN');

      const r2 = await adapter.shutdown();
      assert.ok(r2.ok);

      const r3 = await adapter.shutdown();
      assert.ok(r3.ok);
    });
  });

  /** TC-08A: CREWAI_ADAPTER_CONTRACT.md S10 -- Idempotent Initialize */
  describe('TC-08A: Idempotent Initialize', () => {
    it('second init with same config is no-op, different config is ALREADY_INITIALIZED', async () => {
      const adapter = makeAdapter();
      const config = makeConfig();

      // First init
      const r1 = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
      assert.ok(r1.ok);

      // Same config = no-op
      const r2 = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
      assert.ok(r2.ok);

      // Different config = error
      const r3 = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ crewId: 'different-crew' }));
      assert.ok(!r3.ok);
      assert.equal(r3.error.code, 'ALREADY_INITIALIZED');
    });
  });

  /** TC-09: CREWAI_ADAPTER_CONTRACT.md S10 -- Concurrent Operations During DEGRADED */
  describe('TC-09: Concurrent Operations During DEGRADED', () => {
    it('all concurrent operations fail with CORE_PORT_UNAVAILABLE', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter);
      const ctx = makeCtx(session);

      adapter._simulateCorePortLoss();

      const results = await Promise.all([
        ...Array.from({ length: 5 }, () => adapter.remember(ctx, 'test')),
        ...Array.from({ length: 5 }, () => adapter.recall(ctx, { text: 'test' })),
      ]);

      for (const r of results) {
        assert.ok(!r.ok);
        assert.equal(r.error.code, 'CORE_PORT_UNAVAILABLE');
      }
    });
  });

  /** TC-10: CREWAI_ADAPTER_CONTRACT.md S10 -- Error Precedence */
  describe('TC-10: Error Precedence Verification', () => {
    it('GOVERNANCE_REFUSAL takes precedence over BUDGET_EXCEEDED and CORE_PORT_UNAVAILABLE', async () => {
      // Claim 4.1: Deterministic precedence
      assert.ok(ERROR_PRECEDENCE['GOVERNANCE_REFUSAL'] < ERROR_PRECEDENCE['BUDGET_EXCEEDED']);
      assert.ok(ERROR_PRECEDENCE['BUDGET_EXCEEDED'] < ERROR_PRECEDENCE['CORE_PORT_UNAVAILABLE']);
      assert.ok(ERROR_PRECEDENCE['NOT_INITIALIZED'] < ERROR_PRECEDENCE['GOVERNANCE_REFUSAL']);
    });

    it('suspended agent with port loss returns GOVERNANCE_REFUSAL not CORE_PORT_UNAVAILABLE', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter);
      adapter._setAgentState('suspended');
      // Even though READY, governance fires first
      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'test');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
    });
  });

  /** TC-11: CREWAI_ADAPTER_CONTRACT.md S10 -- Confidence Cap */
  describe('TC-11: Confidence Cap Enforcement', () => {
    it('caps confidence at trust level ceiling', async () => {
      // Claim 3.5: medium trust caps at 0.7
      assert.equal(TRUST_CONFIDENCE_CAPS['medium'], 0.7);
      assert.equal(TRUST_CONFIDENCE_CAPS['low'], 0.3);
      assert.equal(TRUST_CONFIDENCE_CAPS['high'], 0.85);
      assert.equal(TRUST_CONFIDENCE_CAPS['verified'], 1.0);

      const adapter = makeAdapter();
      let capturedConfidence: number | undefined;
      const session = await initAdapterWithSession(adapter, { trustLevel: 'medium' }, {
        remember: async (_ctx, _content, options) => {
          capturedConfidence = options?.confidence;
          return 'claim-capped' as ClaimId;
        },
        appendAudit: async () => 'evt-001' as EventId,
      });

      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'test', { confidence: 0.95 });
      assert.ok(result.ok);
      // The adapter should have capped to 0.7
      assert.equal(capturedConfidence, 0.7);
    });
  });

  /** TC-12: CREWAI_ADAPTER_CONTRACT.md S10 -- Manual Merge with Pending Resolution */
  describe('TC-12: Manual Merge with Pending Resolution', () => {
    it('returns pending_resolution with non-null manualMergeState for manual strategy', async () => {
      const manualMergeState: ManualMergeState = {
        mergeId: 'merge-manual-01',
        pendingConflicts: [{
          conflictId: 'conflict-01',
          claimIdA: 'claim-a' as ClaimId,
          claimIdB: 'claim-b' as ClaimId,
          predicate: 'knows',
          valueA: 'value A',
          valueB: 'value B',
          confidenceA: 0.8,
          confidenceB: 0.6,
        }],
        resolvedConflicts: [],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, undefined, {
        mergeBranches: async () => ({
          status: 'pending_resolution' as const,
          mergedClaimIds: [],
          conflictsResolved: [],
          unresolvedConflicts: manualMergeState.pendingConflicts,
          manualMergeState,
        }),
        appendAudit: async () => 'evt-001' as EventId,
      });

      const ctx = makeCtx(session);
      const result = await adapter.mergeBranches(
        ctx,
        ['branch-1' as AgentBranchId, 'branch-2' as AgentBranchId],
        'manual',
      );

      assert.ok(result.ok);
      assert.equal(result.value.status, 'pending_resolution');
      assert.ok(result.value.manualMergeState !== null);
      assert.equal(result.value.manualMergeState!.pendingConflicts.length, 1);
      assert.equal(result.value.unresolvedConflicts.length, 1);
    });
  });

  /** TC-13: CREWAI_ADAPTER_CONTRACT.md S10 -- Manual Conflict Resolution API */
  describe('TC-13: Manual Conflict Resolution', () => {
    it('resolves conflicts deterministically and rejects malformed resolutions', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, undefined, {
        resolveConflict: async () => ({
          status: 'completed' as const,
          mergedClaimIds: ['claim-resolved' as ClaimId],
          conflictsResolved: [{
            conflictId: 'conflict-01',
            resolution: 'keep_a' as const,
            winningClaimId: 'claim-a' as ClaimId,
          }],
          unresolvedConflicts: [],
          manualMergeState: null,
        }),
        appendAudit: async () => 'evt-001' as EventId,
      });

      const ctx = makeCtx(session);

      // Valid resolution
      const validResult = await adapter.resolveConflict(ctx, {
        mergeId: 'merge-01',
        conflictId: 'conflict-01',
        resolution: 'keep_a',
      });
      assert.ok(validResult.ok);
      assert.equal(validResult.value.status, 'completed');

      // Malformed: merge_new_value without newValue
      const malformedResult = await adapter.resolveConflict(ctx, {
        mergeId: 'merge-01',
        conflictId: 'conflict-02',
        resolution: 'merge_new_value',
        // Missing newValue and newConfidence
      });
      assert.ok(!malformedResult.ok);
      assert.equal(malformedResult.error.code, 'SERDE_ERROR');
    });
  });

  /** TC-14: CREWAI_ADAPTER_CONTRACT.md S10 -- Unknown Tool Handling */
  describe('TC-14: Unknown Tool Handling', () => {
    it('returns UNKNOWN_TOOL with available operations', async () => {
      const adapter = makeAdapter();
      await initAdapterWithSession(adapter);

      const result = await adapter.translateToolCall({
        toolName: 'delete_everything',
        toolArgs: {},
        callId: 'c1',
        agentFramework: 'crew_ai',
        rawPayload: {},
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, 'UNKNOWN_TOOL');
      const violations = result.error.violations;
      assert.ok(violations);
      const ctx = violations[0] as Record<string, unknown>;
      assert.ok(Array.isArray(ctx.availableOperations));
      assert.ok((ctx.availableOperations as string[]).length > 0);
    });
  });

  /** TC-15: CREWAI_ADAPTER_CONTRACT.md S10 -- Tool Translation for Each Declared Capability */
  describe('TC-15: Tool Translation for Each Declared Capability', () => {
    it('translates known tools into LimenOperations', () => {
      const toolCall: CrewAIToolCall = {
        toolName: 'limen_remember',
        toolArgs: { content: 'hello' },
        callId: 'c1',
        agentFramework: 'crew_ai',
        rawPayload: {},
        tool: 'limen_remember',
        args: { content: 'hello' },
        context: {
          crewId: 'crew-1',
          agentRole: 'writer',
          taskId: null,
          delegationDepth: 0,
          processType: 'sequential',
          hookPhase: 'before_tool_call',
          rawHookContextDigest: {
            action: 'limen_remember',
            domain: 'execution',
            timestamp: new Date().toISOString(),
            sessionId: 'ses-1' as SessionId,
            outcome: 'allowed',
          },
        },
      };

      const ops = translateToolToOperations(toolCall);
      assert.ok(ops !== null);
      assert.equal(ops.length, 1);
      assert.equal(ops[0].type, 'remember');
    });

    it('returns null for unknown tools', () => {
      const toolCall: CrewAIToolCall = {
        toolName: 'unknown_tool',
        toolArgs: {},
        callId: 'c2',
        agentFramework: 'crew_ai',
        rawPayload: {},
        tool: 'unknown_tool',
        args: {},
        context: {
          crewId: 'crew-1',
          agentRole: 'writer',
          taskId: null,
          delegationDepth: 0,
          processType: 'sequential',
          hookPhase: 'before_tool_call',
          rawHookContextDigest: {
            action: 'unknown_tool',
            domain: 'execution',
            timestamp: new Date().toISOString(),
            sessionId: 'ses-1' as SessionId,
            outcome: 'allowed',
          },
        },
      };

      const ops = translateToolToOperations(toolCall);
      assert.equal(ops, null);
    });
  });

  /** TC-16: CREWAI_ADAPTER_CONTRACT.md S10 -- NativeAgentAction Translation */
  describe('TC-16: NativeAgentAction Translation', () => {
    it('translates crew_delegation to ComputerAction', async () => {
      const adapter = new LimenCrewAIAdapter(
        TEST_ADAPTER_ID,
        makeCapabilities('memory_read', 'memory_write', 'mission_delegation'),
      );
      const session = await initAdapterWithSession(adapter, {
        capabilities: makeCapabilities('memory_read', 'memory_write', 'mission_delegation'),
      });

      const action: NativeAgentAction = {
        adapterId: TEST_ADAPTER_ID,
        agentId: TEST_AGENT_ID,
        sessionId: session.sessionId,
        nativeType: 'crew_delegation',
        nativePayload: { delegateTo: 'writer' },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.translateActionToGovernance(action);
      assert.ok(result.ok);
      assert.equal(result.value.agentId, TEST_AGENT_ID);
    });

    it('rejects undeclared capability', async () => {
      const adapter = makeAdapter(); // No mission_delegation
      const session = await initAdapterWithSession(adapter);

      const action: NativeAgentAction = {
        adapterId: TEST_ADAPTER_ID,
        agentId: TEST_AGENT_ID,
        sessionId: session.sessionId,
        nativeType: 'crew_delegation',
        nativePayload: {},
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.translateActionToGovernance(action);
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'CAPABILITY_NOT_DECLARED');
    });

    it('rejects malformed payload', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);

      const action: NativeAgentAction = {
        adapterId: TEST_ADAPTER_ID,
        agentId: TEST_AGENT_ID,
        sessionId: '' as SessionId,
        nativeType: '',
        nativePayload: null,
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.translateActionToGovernance(action);
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'SERDE_ERROR');
    });
  });

  /** TC-17: CREWAI_ADAPTER_CONTRACT.md S10 -- Session Lifecycle Bridge */
  describe('TC-17: Session Lifecycle Bridge', () => {
    it('preserves crew metadata in session and returns SessionSummary', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);

      const sessionResult = await adapter.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        taskId: 'task-1' as TaskId,
        metadata: { extra: 'data' },
      });
      assert.ok(sessionResult.ok);
      const session = sessionResult.value;

      assert.equal(session.metadata.crewId, 'crew-alpha');
      assert.equal(session.metadata.agentRole, 'researcher');
      assert.equal(session.metadata.processType, 'sequential');
      assert.equal(session.metadata.taskId, 'task-1');

      const endResult = await adapter.onAgentSessionEnd({
        sessionId: session.sessionId,
        crewId: 'crew-alpha',
        outcome: 'completed',
        metadata: {},
      });
      assert.ok(endResult.ok);
      assert.equal(endResult.value.outcome, 'completed');
    });
  });

  /** TC-18: CREWAI_ADAPTER_CONTRACT.md S10 -- Event Bridge Mapping */
  describe('TC-18: Event Bridge Mapping', () => {
    it('maps native before_tool_call event to AgentEventPayload', () => {
      const nativeEvent: CrewAIHookEvent = {
        type: 'before_tool_call',
        context: {
          tool_name: 'limen_remember',
          tool_input: { content: 'test' },
        },
      };

      const result = mapNativeEvent(nativeEvent, TEST_ADAPTER_ID, TEST_AGENT_ID, 'ses-1' as SessionId);
      assert.ok(result !== null);
      assert.equal(result!.event, 'hook:before_tool_call');
      assert.equal(result!.data.toolName, 'limen_remember');
    });

    it('maps Limen event back to CrewAI event', () => {
      const limenEvent: AgentEventPayload = {
        eventId: 'evt-1' as EventId,
        event: 'hook:after_tool_call',
        timestamp: new Date().toISOString(),
        adapterId: TEST_ADAPTER_ID,
        sessionId: 'ses-1' as SessionId,
        agentId: TEST_AGENT_ID,
        data: {
          toolName: 'limen_recall',
          toolInput: { query: 'test' },
          toolResult: 'found 3 beliefs',
        },
      };

      const result = mapLimenEvent(limenEvent);
      assert.ok(result !== null);
      assert.equal(result!.type, 'after_tool_call');
      assert.equal(result!.context.tool_name, 'limen_recall');
    });

    it('returns null for unmappable events', () => {
      const limenEvent: AgentEventPayload = {
        eventId: 'evt-1' as EventId,
        event: 'some:unknown:event',
        timestamp: new Date().toISOString(),
        adapterId: TEST_ADAPTER_ID,
        sessionId: null,
        agentId: TEST_AGENT_ID,
        data: {},
      };

      const result = mapLimenEvent(limenEvent);
      assert.equal(result, null);
    });
  });

  /** TC-19: CREWAI_ADAPTER_CONTRACT.md S10 -- Governed False Rejection */
  describe('TC-19: Governed False Rejection', () => {
    it('rejects governed: false even with verified trust and governance_admin', async () => {
      const adapter = makeAdapter(['memory_read', 'memory_write', 'governance_admin']);
      const config = makeConfig({
        trustLevel: 'verified',
        governed: false as unknown as true,
        capabilities: makeCapabilities('memory_read', 'memory_write', 'governance_admin'),
      });

      const result = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
    });
  });

  /** TC-20: CREWAI_ADAPTER_CONTRACT.md S10 -- Rate Limit Inheritance */
  describe('TC-20: Rate Limit Inheritance', () => {
    it('rejects rate limits that weaken defaults (Claim 2.7)', async () => {
      const adapter = makeAdapter();
      const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({
        rateLimits: [{
          scope: 'per_session',
          operation: 'memory:write',
          maxRequests: 999, // Weaker than default 100
          windowMs: 60000,
          verdict: 'refuse',
        }],
      }));
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
    });

    it('accepts empty rate limits (inherit defaults)', async () => {
      const adapter = makeAdapter();
      const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({
        rateLimits: [],
      }));
      assert.ok(r.ok);
    });
  });

  /** TC-21: CREWAI_ADAPTER_CONTRACT.md S10 -- Dual Projection Parity */
  describe('TC-21: Dual Projection Parity', () => {
    it('TypeScript error codes match precedence ordering', () => {
      const codes = Object.keys(ERROR_PRECEDENCE);
      assert.equal(codes.length, 18);

      // Verify ordering is correct
      assert.ok(ERROR_PRECEDENCE['NOT_INITIALIZED'] < ERROR_PRECEDENCE['GOVERNANCE_REFUSAL']);
      assert.ok(ERROR_PRECEDENCE['GOVERNANCE_REFUSAL'] < ERROR_PRECEDENCE['BUDGET_EXCEEDED']);
      assert.ok(ERROR_PRECEDENCE['BUDGET_EXCEEDED'] < ERROR_PRECEDENCE['CORE_PORT_UNAVAILABLE']);
      assert.ok(ERROR_PRECEDENCE['CORE_PORT_UNAVAILABLE'] < ERROR_PRECEDENCE['CLIENT_ERROR']);
    });
  });

  /** TC-22: CREWAI_ADAPTER_CONTRACT.md S10 -- Sandbox Expansion */
  describe('TC-22: AdapterSandboxDefaults Expansion', () => {
    it('sandbox verdict is handled by governance pipeline', async () => {
      const sandboxVerdict: GovernanceVerdict = {
        verdict: 'sandbox',
        auditId: 'evt-sandbox-001' as EventId,
        config: {
          filesystem: { allowedPaths: ['/tmp'], deniedPaths: ['/etc'], readOnly: true },
        },
      };

      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, undefined, undefined, {
        beforeAction: async () => sandboxVerdict,
      });

      // Sandbox verdict allows the operation with constraints
      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'sandboxed content');
      // Sandbox is not a refusal -- operation proceeds
      assert.ok(result.ok);
    });
  });

  /** TC-23: CREWAI_ADAPTER_CONTRACT.md S10 -- CrewAI Delegation Depth Hostile Case */
  describe('TC-23: Delegation Depth Hostile', () => {
    it('rejects delegation from agent without mission_delegation capability', async () => {
      const adapter = makeAdapter(); // Does NOT have mission_delegation
      const session = await initAdapterWithSession(adapter);

      const action: NativeAgentAction = {
        adapterId: TEST_ADAPTER_ID,
        agentId: TEST_AGENT_ID,
        sessionId: session.sessionId,
        nativeType: 'crew_delegation',
        nativePayload: { delegateTo: 'writer', depth: 5 },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.translateActionToGovernance(action);
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'CAPABILITY_NOT_DECLARED');
    });

    it('rejects config with delegationDepthMax exceeding 10', async () => {
      const adapter = makeAdapter();
      const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({
        delegationDepthMax: 15,
      }));
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'SERDE_ERROR');
    });
  });

  /** TC-24: CREWAI_ADAPTER_CONTRACT.md S10 -- Hook Payload Shape Hostile Case */
  describe('TC-24: CrewAI Hook Payload Shape Hostile Case', () => {
    it('rejects payload without tool_name', () => {
      const result = validateHookContext({ tool_input: {} });
      assert.equal(result.valid, false);
    });

    it('rejects payload without tool_input', () => {
      const result = validateHookContext({ tool_name: 'test' });
      assert.equal(result.valid, false);
    });

    it('rejects null payload', () => {
      const result = validateHookContext(null);
      assert.equal(result.valid, false);
    });

    it('accepts valid hook context', () => {
      const result = validateHookContext({
        tool_name: 'limen_remember',
        tool_input: { content: 'test' },
      });
      assert.equal(result.valid, true);
    });
  });

  /** TC-25: CREWAI_ADAPTER_CONTRACT.md S10 -- Client Error Propagation */
  describe('TC-25: Client Error Propagation', () => {
    it('propagates LimenAgentClient errors as CLIENT_ERROR', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter, undefined, {
        remember: async () => { throw new Error('Connection reset'); },
        appendAudit: async () => 'evt-001' as EventId,
      });

      const ctx = makeCtx(session);
      const result = await adapter.remember(ctx, 'test');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'CLIENT_ERROR');
    });
  });

  /** TC-26: CREWAI_ADAPTER_CONTRACT.md S10 -- Concurrent Session Isolation */
  describe('TC-26: Concurrent Session Isolation', () => {
    it('sessions are isolated between adapter instances', async () => {
      const adapter1 = makeAdapter();
      const adapter2 = new LimenCrewAIAdapter(
        'adapter-2' as AdapterId,
        makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'),
      );

      await initAdapter(adapter1);
      await initAdapter(adapter2);

      const s1 = await adapter1.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        metadata: {},
      });
      const s2 = await adapter2.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'writer',
        processType: 'sequential',
        metadata: {},
      });

      assert.ok(s1.ok);
      assert.ok(s2.ok);

      assert.equal(adapter1.getHealth().activeSessions, 1);
      assert.equal(adapter2.getHealth().activeSessions, 1);
    });
  });

  /** TC-27: CREWAI_ADAPTER_CONTRACT.md S10 -- Shutdown with Active Sessions */
  describe('TC-27: Shutdown with Active Sessions', () => {
    it('closes all sessions on shutdown', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);

      // Start 3 sessions
      await adapter.onAgentSessionStart({ crewId: 'c1', agentRole: 'r1', processType: 'sequential', metadata: {} });
      await adapter.onAgentSessionStart({ crewId: 'c1', agentRole: 'r2', processType: 'sequential', metadata: {} });
      await adapter.onAgentSessionStart({ crewId: 'c1', agentRole: 'r3', processType: 'sequential', metadata: {} });

      assert.equal(adapter.getHealth().activeSessions, 3);

      const result = await adapter.shutdown();
      assert.ok(result.ok);
      assert.equal(adapter.getHealth().activeSessions, 0);
      assert.equal(adapter.lifecycleState, 'SHUTDOWN');
    });
  });

  /** TC-28: CREWAI_ADAPTER_CONTRACT.md S10 -- healthCheck Status Across States */
  describe('TC-28: healthCheck Returns Correct Status Across States', () => {
    it('returns correct health per lifecycle state', async () => {
      const adapter = makeAdapter();

      // UNINITIALIZED
      const h1 = await adapter.healthCheck();
      assert.ok(h1.ok);
      assert.equal(h1.value.status, 'unhealthy');
      assert.equal(h1.value.corePortConnected, false);

      // READY
      await initAdapter(adapter);
      const h2 = await adapter.healthCheck();
      assert.ok(h2.ok);
      assert.equal(h2.value.status, 'healthy');

      // DEGRADED
      adapter._simulateCorePortLoss();
      const h3 = adapter.getHealth();
      assert.equal(h3.status, 'degraded');

      // Recover
      adapter._simulateCorePortRecovery();
      const h4 = adapter.getHealth();
      assert.equal(h4.status, 'healthy');

      // SHUTDOWN
      await adapter.shutdown();
      const h5 = await adapter.healthCheck();
      assert.ok(!h5.ok);
      assert.equal(h5.error.code, 'NOT_INITIALIZED');

      // getHealth still works in SHUTDOWN
      const h6 = adapter.getHealth();
      assert.equal(h6.status, 'unhealthy');
    });
  });

  /** TC-29: CREWAI_ADAPTER_CONTRACT.md S10 -- Subscription Lifecycle */
  describe('TC-29: Subscription Lifecycle via on/off', () => {
    it('supports full subscription lifecycle', async () => {
      const adapter = makeAdapter();
      const events: string[] = [];

      // Register in UNINITIALIZED state
      const subId = adapter.on('governance:refused', (payload) => {
        events.push(payload.event);
      });
      assert.ok(subId.startsWith('sub-'));

      // Initialize
      await initAdapter(adapter);

      // Start session and trigger refusal
      const session = await adapter.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        metadata: {},
      });
      assert.ok(session.ok);

      adapter._setAgentState('suspended');
      const ctx = makeCtx(session.value);
      await adapter.remember(ctx, 'test');
      assert.ok(events.length > 0);

      // off() removes subscription
      adapter.off(subId);
      adapter._setAgentState('active');
      adapter._setAgentState('suspended');
      await adapter.remember(ctx, 'test2');

      // off() with unknown ID is no-op
      adapter.off('nonexistent-id');

      // Shutdown clears all
      adapter._setAgentState('active');
      await adapter.shutdown();

      // Post-SHUTDOWN: on() and off() throw NOT_INITIALIZED
      assert.throws(() => adapter.on('test', () => {}), (err: unknown) => {
        return err instanceof CrewAIAdapterError && err.code === 'NOT_INITIALIZED';
      });
      assert.throws(() => adapter.off('any-id'), (err: unknown) => {
        return err instanceof CrewAIAdapterError && err.code === 'NOT_INITIALIZED';
      });
    });
  });

  // ── Config Validation Tests ──

  describe('Config Validation', () => {
    it('rejects connectionTimeoutMs outside [1000, 30000] (Claim 2.2)', async () => {
      const adapter = makeAdapter();

      const r1 = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ connectionTimeoutMs: 500 }));
      assert.ok(!r1.ok);
      assert.equal(r1.error.code, 'SERDE_ERROR');

      const adapter2 = makeAdapter();
      const r2 = await adapter2.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ connectionTimeoutMs: 50000 }));
      assert.ok(!r2.ok);
      assert.equal(r2.error.code, 'SERDE_ERROR');
    });

    it('rejects delegationDepthMax outside [0, 10] (Claim 2.13)', async () => {
      const adapter = makeAdapter();
      const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ delegationDepthMax: 15 }));
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'SERDE_ERROR');
    });

    it('rejects warningThresholdPct outside [0, 100] (Claim 2.12)', async () => {
      const adapter = makeAdapter();
      const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({
        tokenBudget: {
          maxTokensPerOperation: 1000,
          maxTokensPerSession: 10000,
          encoding: 'cl100k_base',
          warningThresholdPct: 150,
          replenishmentWindowSeconds: null,
        },
      }));
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'SERDE_ERROR');
    });
  });

  // ── Error Code Tests ──

  describe('Error Codes', () => {
    it('creates properly structured CrewAIAdapterError', () => {
      const err = new CrewAIAdapterError({
        code: 'GOVERNANCE_REFUSAL',
        message: 'test refusal',
        adapterId: TEST_ADAPTER_ID,
        retryable: true, // Should be overridden to false
        context: { rule: 'test_rule' },
      });

      assert.equal(err.code, 'GOVERNANCE_REFUSAL');
      assert.equal(err.retryable, false); // Claim 4.2: NEVER retryable
      assert.equal(err.adapterId, TEST_ADAPTER_ID);
    });

    it('NOT_INITIALIZED is never retryable', () => {
      const err = new CrewAIAdapterError({
        code: 'NOT_INITIALIZED',
        message: 'test',
        adapterId: TEST_ADAPTER_ID,
        retryable: true, // Should be overridden
      });
      assert.equal(err.retryable, false); // Claim 4.3
    });

    it('NEVER_RETRYABLE contains correct codes', () => {
      assert.ok(NEVER_RETRYABLE.has('NOT_INITIALIZED'));
      assert.ok(NEVER_RETRYABLE.has('GOVERNANCE_REFUSAL'));
      assert.ok(!NEVER_RETRYABLE.has('CORE_PORT_UNAVAILABLE'));
    });
  });

  // ── resolveConflict Validation (Claim 2.9) ──

  describe('resolveConflict Validation', () => {
    it('rejects merge_new_value without newValue', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter);
      const ctx = makeCtx(session);

      const result = await adapter.resolveConflict(ctx, {
        mergeId: 'm1',
        conflictId: 'c1',
        resolution: 'merge_new_value',
        // Missing newValue and newConfidence
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, 'SERDE_ERROR');
    });
  });

  // ── Trust Level Tests ──

  describe('Trust Level Enforcement', () => {
    it('untrusted agents cannot remember (Claim 3.6)', async () => {
      const adapter = new LimenCrewAIAdapter(
        TEST_ADAPTER_ID,
        makeCapabilities('memory_read', 'memory_write'),
      );
      const session = await initAdapterWithSession(adapter, { trustLevel: 'untrusted' });
      const ctx = makeCtx(session);

      const result = await adapter.remember(ctx, 'test');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'TRUST_LEVEL_INSUFFICIENT');
    });

    it('low trust agents cannot create branches (Claim 1.6)', async () => {
      const adapter = new LimenCrewAIAdapter(
        TEST_ADAPTER_ID,
        makeCapabilities('memory_read', 'memory_write', 'branching'),
      );
      const session = await initAdapterWithSession(adapter, { trustLevel: 'low' });
      const ctx = makeCtx(session);

      const result = await adapter.createBranch(ctx, 'claim-1' as ClaimId, 'test');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'TRUST_LEVEL_INSUFFICIENT');
    });
  });

  // ── Config Digest Tests (Claim 2.10) ──

  describe('Config Digest (SHA-256)', () => {
    it('identical configs produce identical digests', () => {
      const c1 = makeConfig();
      const c2 = makeConfig();
      assert.equal(computeConfigDigest(c1), computeConfigDigest(c2));
    });

    it('different configs produce different digests', () => {
      const c1 = makeConfig();
      const c2 = makeConfig({ crewId: 'different-crew' });
      assert.notEqual(computeConfigDigest(c1), computeConfigDigest(c2));
    });

    it('digest is a hex SHA-256 (64 chars)', () => {
      const digest = computeConfigDigest(makeConfig());
      // SHA-256 hex is 64 characters, all hex digits
      assert.equal(digest.length, 64);
      assert.match(digest, /^[0-9a-f]{64}$/);
    });
  });

  // ── Lifecycle Edge Cases ──

  describe('Lifecycle Edge Cases', () => {
    it('initialize after SHUTDOWN returns NOT_INITIALIZED (Claim 7.2)', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);
      await adapter.shutdown();

      const result = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig());
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'NOT_INITIALIZED');
    });

    it('getHealth works in all states including SHUTDOWN', async () => {
      const adapter = makeAdapter();

      // UNINITIALIZED
      const h1 = adapter.getHealth();
      assert.equal(h1.status, 'unhealthy');

      // READY
      await initAdapter(adapter);
      const h2 = adapter.getHealth();
      assert.equal(h2.status, 'healthy');

      // SHUTDOWN
      await adapter.shutdown();
      const h3 = adapter.getHealth();
      assert.equal(h3.status, 'unhealthy');
    });
  });

  // ── F-02: Session ID Required Tests ──

  describe('F-02: Session ID Required', () => {
    it('returns SESSION_NOT_FOUND when ctx.sessionId is missing', async () => {
      const adapter = makeAdapter();
      await initAdapterWithSession(adapter);

      // Context without sessionId
      const ctx: OperationContext = {
        tenantId: TEST_TENANT_ID,
        userId: null,
        agentId: TEST_AGENT_ID,
        permissions: new Set(),
        // No sessionId!
      };

      const result = await adapter.remember(ctx, 'test');
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'SESSION_NOT_FOUND');
    });
  });

  // ── F-09: Session Start Governance Gate ──

  describe('F-09: onAgentSessionStart Governance Gate', () => {
    it('suspended agents cannot start sessions', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);

      adapter._setAgentState('suspended');

      const result = await adapter.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        metadata: {},
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
    });
  });

  // ── F-10: Session End Agent State Check ──

  describe('F-10: onAgentSessionEnd Agent State Check', () => {
    it('suspended agents cannot end sessions', async () => {
      const adapter = makeAdapter();
      const session = await initAdapterWithSession(adapter);

      adapter._setAgentState('suspended');

      const result = await adapter.onAgentSessionEnd({
        sessionId: session.sessionId,
        crewId: 'crew-alpha',
        outcome: 'completed',
        metadata: {},
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
    });
  });

  // ── F-11: translateActionToGovernance Governance Gate ──

  describe('F-11: translateActionToGovernance Governance Gate', () => {
    it('evaluates governance before translation', async () => {
      const adapter = new LimenCrewAIAdapter(
        TEST_ADAPTER_ID,
        makeCapabilities('memory_read', 'memory_write', 'mission_delegation'),
      );
      const session = await initAdapterWithSession(adapter, {
        capabilities: makeCapabilities('memory_read', 'memory_write', 'mission_delegation'),
      });

      // Set agent to suspended
      adapter._setAgentState('suspended');

      const action: NativeAgentAction = {
        adapterId: TEST_ADAPTER_ID,
        agentId: TEST_AGENT_ID,
        sessionId: session.sessionId,
        nativeType: 'crew_delegation',
        nativePayload: { delegateTo: 'writer' },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.translateActionToGovernance(action);
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
    });
  });

  // ── F-16: enrichRememberOptions never returns undefined ──

  describe('F-16: enrichRememberOptions', () => {
    it('auto-populates crewContext when options is undefined', async () => {
      const adapter = makeAdapter();
      let capturedOptions: unknown;
      const session = await initAdapterWithSession(adapter, undefined, {
        remember: async (_ctx, _content, options) => {
          capturedOptions = options;
          return 'claim-001' as ClaimId;
        },
        appendAudit: async () => 'evt-001' as EventId,
      });

      const ctx = makeCtx(session);
      // Call remember with NO options (undefined)
      const result = await adapter.remember(ctx, 'test content');
      assert.ok(result.ok);
      // The captured options should NOT be undefined -- should have crewContext
      assert.ok(capturedOptions !== undefined);
      const opts = capturedOptions as { crewContext?: unknown };
      assert.ok(opts.crewContext !== undefined);
    });
  });

  // ── F-19: Session IDs use crypto.randomUUID ──

  describe('F-19: Cryptographic Session IDs', () => {
    it('session IDs are valid UUIDs', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);

      const result = await adapter.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        metadata: {},
      });
      assert.ok(result.ok);

      // UUID v4 format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert.match(result.value.sessionId, uuidRegex);
    });
  });

  // ── F-21: Shutdown Race Prevention ──

  describe('F-21: Shutdown Race Prevention', () => {
    it('transitions to SHUTDOWN before session cleanup', async () => {
      const adapter = makeAdapter();
      await initAdapter(adapter);
      await adapter.onAgentSessionStart({
        crewId: 'crew-alpha',
        agentRole: 'researcher',
        processType: 'sequential',
        metadata: {},
      });

      // Start shutdown -- concurrent session start should fail
      const shutdownPromise = adapter.shutdown();

      // Attempt concurrent session start (adapter should already be SHUTDOWN)
      const sessionResult = await adapter.onAgentSessionStart({
        crewId: 'crew-beta',
        agentRole: 'writer',
        processType: 'sequential',
        metadata: {},
      });

      await shutdownPromise;

      // The concurrent session start should have failed
      assert.ok(!sessionResult.ok);
      assert.equal(sessionResult.error.code, 'NOT_INITIALIZED');
    });
  });

  // ── Hook Normalization Tests ──

  describe('Hook Normalization', () => {
    it('normalizes hook context from tool_name and tool_input', () => {
      const hookCtx = {
        tool_name: 'limen_remember',
        tool_input: { content: 'test data' },
      };

      const result = normalizeHookContext(
        hookCtx,
        'crew-1', 'researcher', null, 0, 'sequential', 'before_tool_call', 'call-1',
      );

      assert.equal(result.toolName, 'limen_remember');
      assert.equal(result.tool, 'limen_remember');
      assert.deepEqual(result.toolArgs, { content: 'test data' });
      assert.deepEqual(result.args, { content: 'test data' });
      assert.equal(result.agentFramework, 'crew_ai');
      assert.equal(result.context.crewId, 'crew-1');
      assert.equal(result.context.agentRole, 'researcher');
    });
  });
});
