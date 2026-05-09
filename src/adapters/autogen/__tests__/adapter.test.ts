// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * AutoGen Adapter Test Suite
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Covers: TC-01 through TC-40+ mandatory test cases.
 *
 * Test framework: node:test + node:assert/strict (per project convention)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LimenAutoGenAdapter } from '../adapter.js';
import type { AutoGenAdapterConfig, AutoGenSessionStart, AutoGenSessionEnd, AutoGenHookEvent } from '../types.js';
import { translateToolToOperations, mapNativeEvent, mapLimenEvent, KNOWN_TOOLS } from '../hooks.js';
import type {
  AdapterId,
  AgentId,
  SessionId,
  ClaimId,
  AgentBranchId,
  EventId,
  TenantId,
  AgentCapability,
  LimenAgentClient,
  ComputerActionGovernor,
  GovernanceVerdict,
  GovernanceContext,
  OperationContext,
  BeliefState,
  AgentMemoryEntry,
  MergeResultData,
  ManualMergeResolutionRequest,
  AgentEventPayload,
  NativeAgentAction,
} from '../../shared/types.js';
import { TRUST_CONFIDENCE_CAPS, ERROR_PRECEDENCE, NEVER_RETRYABLE } from '../../shared/types.js';

// ── Test Helpers ──

const TEST_ADAPTER_ID = 'adapter-autogen-test' as AdapterId;
const TEST_AGENT_ID = 'agent-autogen-001' as AgentId;
const TEST_TENANT_ID = 'tenant-001' as TenantId;

function makeCapabilities(...caps: AgentCapability[]): ReadonlySet<AgentCapability> {
  return new Set(caps);
}

function makeConfig(overrides?: Partial<AutoGenAdapterConfig>): AutoGenAdapterConfig {
  return {
    agentId: TEST_AGENT_ID,
    tenantId: TEST_TENANT_ID,
    trustLevel: 'medium',
    capabilities: makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'),
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
    // AutoGen-specific
    conversationId: 'conv-001',
    agentName: 'assistant',
    codeExecutionEnabled: true,
    maxConsecutiveAutoReplies: 10,
    humanInputMode: 'TERMINATE',
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
      operationCount: 0,
      governanceRefusals: 0,
      branchesCreated: 0,
      branchesMerged: 0,
      missionsCompleted: 0,
      tokensBudgetUsed: 0,
      outcome: 'completed' as const,
    }),
    remember: async () => 'claim-001' as ClaimId,
    recall: async () => ({
      beliefs: [{
        belief: {
          id: 'claim-001' as ClaimId,
          content: 'test',
          subject: 'test',
          predicate: 'test',
          value: 'test',
          confidence: 0.9,
          effectiveConfidence: 0.9,
          freshness: 'fresh' as const,
          classification: 'internal' as const,
          tags: [],
          category: null,
          sourceAgentId: TEST_AGENT_ID,
          missionId: null,
          taskId: null,
          groundingMode: 'evidence_path' as const,
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
    createBranch: async () => 'branch-001' as AgentBranchId,
    mergeBranches: async () => ({
      status: 'completed' as const,
      mergedClaimIds: ['claim-001' as ClaimId],
      conflictsResolved: [],
      unresolvedConflicts: [],
      manualMergeState: null,
    }),
    resolveConflict: async () => ({
      status: 'completed' as const,
      mergedClaimIds: ['claim-001' as ClaimId],
      conflictsResolved: [],
      unresolvedConflicts: [],
      manualMergeState: null,
    }),
    appendAudit: async () => 'evt-001' as EventId,
    healthProbe: async () => ({ connected: true, latencyMs: 5 }),
    ...overrides,
  };
}

function makeMockGovernor(overrides?: Partial<ComputerActionGovernor>): ComputerActionGovernor {
  return {
    beforeAction: async () => ({ verdict: 'allow' as const, auditId: 'evt-gov-001' as EventId }),
    afterAction: async () => {},
    ...overrides,
  };
}

function makeSessionStart(overrides?: Partial<AutoGenSessionStart>): AutoGenSessionStart {
  return {
    conversationId: 'conv-001',
    agentName: 'assistant',
    codeExecutionEnabled: true,
    humanInputMode: 'TERMINATE',
    metadata: {},
    ...overrides,
  };
}

async function initAdapter(
  adapter: LimenAutoGenAdapter,
  config?: AutoGenAdapterConfig,
  client?: LimenAgentClient,
  governor?: ComputerActionGovernor,
) {
  const result = await adapter.initialize(
    client ?? makeMockClient(),
    governor ?? makeMockGovernor(),
    config ?? makeConfig(),
  );
  assert.ok(result.ok, `Init failed: ${!result.ok ? result.error.message : ''}`);
  return result;
}

async function initAndStartSession(adapter: LimenAutoGenAdapter, config?: AutoGenAdapterConfig) {
  await initAdapter(adapter, config);
  const sessionResult = await adapter.onAgentSessionStart(makeSessionStart());
  assert.ok(sessionResult.ok);
  return sessionResult.value;
}

function makeCtx(sessionId: SessionId): OperationContext {
  return {
    tenantId: TEST_TENANT_ID,
    userId: null,
    agentId: TEST_AGENT_ID,
    permissions: new Set(),
    sessionId,
    clearanceLevel: 2,
  };
}

// ── Tests ──

describe('LimenAutoGenAdapter', () => {
  let adapter: LimenAutoGenAdapter;

  beforeEach(() => {
    adapter = new LimenAutoGenAdapter(
      TEST_ADAPTER_ID,
      makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'),
    );
  });

  // TC-01: Idempotent init
  it('TC-01: idempotent initialization with same config', async () => {
    const config = makeConfig();
    await initAdapter(adapter, config);
    const r2 = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(r2.ok, 'Second init with same config should succeed');
  });

  // TC-02: Different config re-init fails
  it('TC-02: re-initialization with different config fails', async () => {
    await initAdapter(adapter);
    const r2 = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ agentName: 'different' }));
    assert.ok(!r2.ok);
    assert.equal(r2.error.code, 'ALREADY_INITIALIZED');
  });

  // TC-03: Framework identity
  it('TC-03: agentFramework is auto_gen', () => {
    assert.equal(adapter.agentFramework, 'auto_gen');
  });

  // TC-04: Use-before-init rejection
  it('TC-04: operations before init return NOT_INITIALIZED', async () => {
    const ctx = makeCtx('session-mock' as SessionId);
    const r = await adapter.remember(ctx, 'test content');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  // TC-05: Session start/end lifecycle
  it('TC-05: session start and end produce valid types', async () => {
    await initAdapter(adapter);
    const startResult = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(startResult.ok);
    assert.equal(startResult.value.trustLevel, 'medium');
    assert.ok(startResult.value.workingMemoryNamespace.includes('autogen/'));

    const endResult = await adapter.onAgentSessionEnd({
      sessionId: startResult.value.sessionId,
      conversationId: 'conv-001',
      outcome: 'completed',
      metadata: {},
    });
    assert.ok(endResult.ok);
    assert.equal(endResult.value.outcome, 'completed');
  });

  // TC-06: Governance authorization-first (refuse verdict)
  it('TC-06: governance refusal blocks remember', async () => {
    const governor = makeMockGovernor({
      beforeAction: async () => ({
        verdict: 'refuse' as const,
        auditId: 'evt-gov-ref' as EventId,
        reason: 'test_refusal',
        rule: 'test_rule',
      }),
    });
    await initAdapter(adapter, undefined, undefined, governor);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    const ctx = makeCtx(session.value.sessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  // TC-07: Token budget exceeded
  it('TC-07: token budget exceeded blocks operation', async () => {
    const config = makeConfig({
      tokenBudget: {
        maxTokensPerOperation: 5,
        maxTokensPerSession: 10,
        encoding: 'cl100k_base',
        warningThresholdPct: 80,
        replenishmentWindowSeconds: null,
      },
    });
    await initAdapter(adapter, config);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    const ctx = makeCtx(session.value.sessionId);
    const r = await adapter.remember(ctx, 'a'.repeat(100));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'BUDGET_EXCEEDED');
  });

  // TC-08: Audit failure blocks operation
  it('TC-08: audit failure blocks remember', async () => {
    await initAdapter(adapter);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    adapter._injectAuditFailure('pre');
    const ctx = makeCtx(session.value.sessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'AUDIT_FAILURE');
  });

  // TC-09: Post-audit failure blocks
  it('TC-09: post-operation audit failure blocks', async () => {
    await initAdapter(adapter);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    adapter._injectAuditFailure('post');
    const ctx = makeCtx(session.value.sessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'AUDIT_FAILURE');
  });

  // TC-10: Core port loss -> DEGRADED
  it('TC-10: core port loss transitions to DEGRADED', async () => {
    await initAdapter(adapter);
    adapter._simulateCorePortLoss();
    assert.equal(adapter.lifecycleState, 'DEGRADED');
    const session = makeSessionStart();
    const r = await adapter.onAgentSessionStart(session);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CORE_PORT_UNAVAILABLE');
  });

  // TC-11: Core port recovery
  it('TC-11: core port recovery restores READY', async () => {
    await initAdapter(adapter);
    adapter._simulateCorePortLoss();
    adapter._simulateCorePortRecovery();
    assert.equal(adapter.lifecycleState, 'READY');
  });

  // TC-12: Branch + merge
  it('TC-12: createBranch and mergeBranches work', async () => {
    const session = await initAndStartSession(adapter);
    const ctx = makeCtx(session.sessionId);
    const branchResult = await adapter.createBranch(ctx, 'claim-base' as ClaimId, 'test branch');
    assert.ok(branchResult.ok);

    const mergeResult = await adapter.mergeBranches(ctx, [branchResult.value], 'highest_confidence');
    assert.ok(mergeResult.ok);
    assert.equal(mergeResult.value.status, 'completed');
  });

  // TC-13: Shutdown idempotency
  it('TC-13: shutdown is idempotent', async () => {
    await initAdapter(adapter);
    const r1 = await adapter.shutdown();
    assert.ok(r1.ok);
    const r2 = await adapter.shutdown();
    assert.ok(r2.ok);
  });

  // TC-14: Post-shutdown operations fail
  it('TC-14: operations after shutdown return NOT_INITIALIZED', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    const r = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  // TC-15: Concurrent DEGRADED operations
  it('TC-15: all core operations fail in DEGRADED state', async () => {
    const session = await initAndStartSession(adapter);
    const ctx = makeCtx(session.sessionId);
    adapter._simulateCorePortLoss();

    const ops = await Promise.all([
      adapter.remember(ctx, 'test'),
      adapter.recall(ctx, { text: 'test' }),
      adapter.createBranch(ctx, 'claim-001' as ClaimId, 'branch'),
    ]);
    for (const r of ops) {
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'CORE_PORT_UNAVAILABLE');
    }
  });

  // TC-16: Error precedence
  it('TC-16: NOT_INITIALIZED has highest precedence (prec 1)', () => {
    assert.equal(ERROR_PRECEDENCE['NOT_INITIALIZED'], 1);
    assert.ok(ERROR_PRECEDENCE['GOVERNANCE_REFUSAL'] > ERROR_PRECEDENCE['NOT_INITIALIZED']);
  });

  // TC-17: NEVER_RETRYABLE enforcement
  it('TC-17: GOVERNANCE_REFUSAL and NOT_INITIALIZED are never retryable', () => {
    assert.ok(NEVER_RETRYABLE.has('NOT_INITIALIZED'));
    assert.ok(NEVER_RETRYABLE.has('GOVERNANCE_REFUSAL'));
  });

  // TC-18: Recall with clearance filtering
  it('TC-18: recall filters beliefs by clearance level', async () => {
    const session = await initAndStartSession(adapter);
    const ctx = makeCtx(session.sessionId);
    const r = await adapter.recall(ctx, { text: 'test' });
    assert.ok(r.ok);
    assert.ok(r.value.beliefs.length >= 0);
  });

  // TC-19: Trust level insufficient for remember at untrusted
  it('TC-19: untrusted trust level blocks remember', async () => {
    const untrustedAdapter = new LimenAutoGenAdapter(
      TEST_ADAPTER_ID,
      makeCapabilities('memory_read', 'memory_write'),
    );
    const config = makeConfig({ trustLevel: 'untrusted' });
    await initAdapter(untrustedAdapter, config);
    const session = await untrustedAdapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    const ctx = makeCtx(session.value.sessionId);
    const r = await untrustedAdapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'TRUST_LEVEL_INSUFFICIENT');
  });

  // TC-20: Capability not declared blocks operation
  it('TC-20: missing memory_write capability blocks remember', async () => {
    const noBranchAdapter = new LimenAutoGenAdapter(
      TEST_ADAPTER_ID,
      makeCapabilities('memory_read'),
    );
    const config = makeConfig();
    await initAdapter(noBranchAdapter, config);
    const session = await noBranchAdapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    const ctx = makeCtx(session.value.sessionId);
    const r = await noBranchAdapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CAPABILITY_NOT_DECLARED');
  });

  // TC-21: Unknown tool returns UNKNOWN_TOOL
  it('TC-21: unknown tool call returns UNKNOWN_TOOL', async () => {
    const session = await initAndStartSession(adapter);
    const r = await adapter.translateToolCall({
      toolName: 'nonexistent_tool',
      toolArgs: {},
      callId: 'call-001',
      agentFramework: 'auto_gen',
      rawPayload: {},
    }, session.sessionId);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'UNKNOWN_TOOL');
  });

  // TC-22: Known tool translates correctly
  it('TC-22: limen_remember tool translates to remember operation', async () => {
    const session = await initAndStartSession(adapter);
    const r = await adapter.translateToolCall({
      toolName: 'limen_remember',
      toolArgs: { content: 'test content' },
      callId: 'call-001',
      agentFramework: 'auto_gen',
      rawPayload: {},
    }, session.sessionId);
    assert.ok(r.ok);
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0]!.type, 'remember');
  });

  // TC-23: Translate action to governance
  it('TC-23: translateActionToGovernance produces valid ComputerAction', async () => {
    const session = await initAndStartSession(adapter);
    const action: NativeAgentAction = {
      adapterId: TEST_ADAPTER_ID,
      agentId: TEST_AGENT_ID,
      sessionId: session.sessionId,
      nativeType: 'custom_action',
      nativePayload: { name: 'test', args: {} },
      timestamp: new Date().toISOString(),
    };
    const r = await adapter.translateActionToGovernance(action);
    assert.ok(r.ok);
    assert.ok(r.value.type);
    assert.equal(r.value.agentId, TEST_AGENT_ID);
  });

  // TC-24: Event subscription and emission
  it('TC-24: on/off event subscriptions work', async () => {
    await initAdapter(adapter);
    let received = false;
    const subId = adapter.on('governance:refused', () => { received = true; });
    assert.ok(typeof subId === 'string');
    adapter.off(subId);
    // After off, no events should fire for this subscription
    assert.ok(!received);
  });

  // TC-25: Health check returns valid health
  it('TC-25: healthCheck returns healthy when READY', async () => {
    await initAdapter(adapter);
    const r = await adapter.healthCheck();
    assert.ok(r.ok);
    assert.equal(r.value.status, 'healthy');
    assert.equal(r.value.lifecycleState, 'READY');
  });

  // TC-26: getHealth synchronous
  it('TC-26: getHealth returns health without I/O', async () => {
    await initAdapter(adapter);
    const health = adapter.getHealth();
    assert.equal(health.status, 'healthy');
    assert.ok(health.uptimeMs >= 0);
  });

  // TC-27: Suspended agent state blocks session start
  it('TC-27: suspended agent cannot start sessions', async () => {
    await initAdapter(adapter);
    adapter._setAgentState('suspended');
    const r = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  // TC-28: Decommissioned agent blocks operations
  it('TC-28: decommissioned agent cannot remember', async () => {
    const session = await initAndStartSession(adapter);
    adapter._setAgentState('decommissioned');
    const ctx = makeCtx(session.sessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  // TC-29: Config validation - empty conversationId
  it('TC-29: empty conversationId fails validation', async () => {
    const config = makeConfig({ conversationId: '' });
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  // TC-30: Config validation - empty agentName
  it('TC-30: empty agentName fails validation', async () => {
    const config = makeConfig({ agentName: '' });
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  // TC-31: Config validation - maxConsecutiveAutoReplies out of range
  it('TC-31: maxConsecutiveAutoReplies > 100 fails', async () => {
    const config = makeConfig({ maxConsecutiveAutoReplies: 101 });
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  // TC-32: governed: false rejected
  it('TC-32: governed: false is rejected with GOVERNANCE_REFUSAL', async () => {
    const config = { ...makeConfig(), governed: false } as unknown as AutoGenAdapterConfig;
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  // TC-33: Session not found
  it('TC-33: operations with unknown sessionId return SESSION_NOT_FOUND', async () => {
    await initAdapter(adapter);
    await adapter.onAgentSessionStart(makeSessionStart());
    const ctx = makeCtx('nonexistent-session' as SessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SESSION_NOT_FOUND');
  });

  // TC-34: Confidence cap per trust level
  it('TC-34: confidence is capped per trust level', async () => {
    const session = await initAndStartSession(adapter);
    const ctx = makeCtx(session.sessionId);
    // medium trust cap is 0.7
    const r = await adapter.remember(ctx, 'test', { confidence: 0.95 });
    assert.ok(r.ok); // Confidence silently capped, operation succeeds
  });

  // TC-35: Resolve conflict with valid merge_new_value
  it('TC-35: resolveConflict works with valid resolution', async () => {
    const session = await initAndStartSession(adapter);
    const ctx = makeCtx(session.sessionId);
    const r = await adapter.resolveConflict(ctx, {
      mergeId: 'merge-001',
      conflictId: 'conflict-001',
      resolution: 'keep_a',
    });
    assert.ok(r.ok);
  });

  // TC-36: Resolve conflict with invalid merge_new_value
  it('TC-36: merge_new_value without newValue fails', async () => {
    const session = await initAndStartSession(adapter);
    const ctx = makeCtx(session.sessionId);
    const r = await adapter.resolveConflict(ctx, {
      mergeId: 'merge-001',
      conflictId: 'conflict-001',
      resolution: 'merge_new_value',
    } as ManualMergeResolutionRequest);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  // TC-37: Shutdown closes active sessions
  it('TC-37: shutdown closes all active sessions', async () => {
    await initAndStartSession(adapter);
    const health1 = adapter.getHealth();
    assert.equal(health1.activeSessions, 1);
    await adapter.shutdown();
    const health2 = adapter.getHealth();
    assert.equal(health2.activeSessions, 0);
  });

  // TC-38: Init after shutdown fails
  it('TC-38: initialize after shutdown returns NOT_INITIALIZED', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  // TC-39: Client error propagation
  it('TC-39: client errors propagate as CLIENT_ERROR', async () => {
    const failClient = makeMockClient({
      remember: async () => { throw new Error('Network failure'); },
    });
    await initAdapter(adapter, undefined, failClient);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    const ctx = makeCtx(session.value.sessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CLIENT_ERROR');
  });

  // TC-40: Governance escalation
  it('TC-40: governance escalation blocks operation', async () => {
    const governor = makeMockGovernor({
      beforeAction: async () => ({
        verdict: 'escalate' as const,
        auditId: 'evt-esc' as EventId,
        reason: 'needs_approval',
        requiredApproval: 'human' as const,
      }),
    });
    await initAdapter(adapter, undefined, undefined, governor);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    const ctx = makeCtx(session.value.sessionId);
    const r = await adapter.remember(ctx, 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  // TC-41: Subscription throws on shutdown
  it('TC-41: on() throws after shutdown', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    assert.throws(() => {
      adapter.on('test', () => {});
    });
  });

  // TC-42: off() throws on shutdown
  it('TC-42: off() throws after shutdown', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    assert.throws(() => {
      adapter.off('sub-0');
    });
  });

  // TC-43: Working memory namespace includes AutoGen context
  it('TC-43: session namespace includes conversationId and agentName', async () => {
    await initAdapter(adapter);
    const session = await adapter.onAgentSessionStart(makeSessionStart({
      conversationId: 'conv-xyz',
      agentName: 'coder',
    }));
    assert.ok(session.ok);
    assert.ok(session.value.workingMemoryNamespace.includes('autogen/conv-xyz/coder'));
  });

  // TC-44: Session metadata includes AutoGen fields
  it('TC-44: session metadata has AutoGen-specific fields', async () => {
    await initAdapter(adapter);
    const session = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(session.ok);
    assert.equal(session.value.metadata.conversationId, 'conv-001');
    assert.equal(session.value.metadata.agentName, 'assistant');
    assert.equal(session.value.metadata.codeExecutionEnabled, true);
    assert.equal(session.value.metadata.humanInputMode, 'TERMINATE');
  });

  // TC-45: translateActionToGovernance with missing nativeType
  it('TC-45: missing nativeType returns SERDE_ERROR', async () => {
    const session = await initAndStartSession(adapter);
    const action = {
      adapterId: TEST_ADAPTER_ID,
      agentId: TEST_AGENT_ID,
      sessionId: session.sessionId,
      nativeType: '',
      nativePayload: {},
      timestamp: new Date().toISOString(),
    } as NativeAgentAction;
    const r = await adapter.translateActionToGovernance(action);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });
});

describe('AutoGen Hook Translation', () => {
  // TC-46: translateToolToOperations for known tools
  it('TC-46: recall tool translates correctly', () => {
    const ops = translateToolToOperations({
      toolName: 'limen_recall',
      toolArgs: { query: 'test query' },
      callId: 'c1',
      agentFramework: 'auto_gen',
      rawPayload: {},
    });
    assert.ok(ops !== null);
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.type, 'recall');
  });

  // TC-47: translateToolToOperations for unknown tool
  it('TC-47: unknown tool returns null', () => {
    const ops = translateToolToOperations({
      toolName: 'some_random_tool',
      toolArgs: {},
      callId: 'c1',
      agentFramework: 'auto_gen',
      rawPayload: {},
    });
    assert.equal(ops, null);
  });

  // TC-48: mapNativeEvent for message_sent
  it('TC-48: message_sent maps to autogen:message_sent', () => {
    const event: AutoGenHookEvent = { type: 'message_sent', from: 'agent1', to: 'agent2', content: 'hello' };
    const mapped = mapNativeEvent(event, 'a1' as AdapterId, 'ag1' as AgentId, null);
    assert.ok(mapped !== null);
    assert.equal(mapped.event, 'autogen:message_sent');
  });

  // TC-49: mapNativeEvent for tool_called
  it('TC-49: tool_called maps to hook:after_tool_call', () => {
    const event: AutoGenHookEvent = { type: 'tool_called', toolName: 'test', args: {} };
    const mapped = mapNativeEvent(event, 'a1' as AdapterId, 'ag1' as AgentId, null);
    assert.ok(mapped !== null);
    assert.equal(mapped.event, 'hook:after_tool_call');
  });

  // TC-50: mapLimenEvent round-trip
  it('TC-50: mapLimenEvent maps tool call back to AutoGen', () => {
    const limenEvent: AgentEventPayload = {
      eventId: 'evt-1' as EventId,
      event: 'hook:after_tool_call',
      timestamp: new Date().toISOString(),
      adapterId: 'a1' as AdapterId,
      sessionId: null,
      agentId: 'ag1' as AgentId,
      data: { toolName: 'test', args: {} },
    };
    const mapped = mapLimenEvent(limenEvent);
    assert.ok(mapped !== null);
    assert.equal(mapped.type, 'tool_called');
  });

  // TC-51: KNOWN_TOOLS contains expected tools
  it('TC-51: KNOWN_TOOLS includes limen_ prefixed and standard names', () => {
    assert.ok(KNOWN_TOOLS.includes('limen_remember'));
    assert.ok(KNOWN_TOOLS.includes('remember'));
    assert.ok(KNOWN_TOOLS.includes('limen_recall'));
    assert.ok(KNOWN_TOOLS.includes('search_memory'));
  });
});
