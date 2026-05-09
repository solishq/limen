// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Semantic Kernel Adapter Test Suite
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Covers: TC-01 through TC-51 mandatory test cases.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LimenSemanticKernelAdapter } from '../adapter.js';
import type { SKAdapterConfig, SKSessionStart, SKSessionEnd, SKHookEvent } from '../types.js';
import { translateToolToOperations, mapNativeEvent, mapLimenEvent, KNOWN_TOOLS } from '../hooks.js';
import type {
  AdapterId, AgentId, SessionId, ClaimId, AgentBranchId, EventId, TenantId,
  AgentCapability, LimenAgentClient, ComputerActionGovernor, OperationContext,
  AgentEventPayload, NativeAgentAction, ManualMergeResolutionRequest,
} from '../../shared/types.js';
import { ERROR_PRECEDENCE, NEVER_RETRYABLE } from '../../shared/types.js';

const TEST_ADAPTER_ID = 'adapter-sk-test' as AdapterId;
const TEST_AGENT_ID = 'agent-sk-001' as AgentId;
const TEST_TENANT_ID = 'tenant-001' as TenantId;

function makeCapabilities(...caps: AgentCapability[]): ReadonlySet<AgentCapability> {
  return new Set(caps);
}

function makeConfig(overrides?: Partial<SKAdapterConfig>): SKAdapterConfig {
  return {
    agentId: TEST_AGENT_ID, tenantId: TEST_TENANT_ID, trustLevel: 'medium',
    capabilities: makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'),
    defaultClassification: 'internal', governed: true, rateLimits: [],
    sandboxDefaults: { allowedPathPatterns: [], deniedPathPatterns: [], allowedHostPatterns: [], deniedHostPatterns: [], allowedCommands: [], deniedCommands: [], maxDurationMs: null, readOnlyFilesystem: false },
    refusalHints: [],
    tokenBudget: { maxTokensPerOperation: 1000, maxTokensPerSession: 10000, encoding: 'cl100k_base', warningThresholdPct: 80, replenishmentWindowSeconds: null },
    coreEndpoint: 'http://localhost:3000', connectionTimeoutMs: 5000,
    retryPolicy: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000, backoffMultiplier: 2, retryableErrors: ['CORE_PORT_UNAVAILABLE', 'CLIENT_ERROR'] },
    metadata: {},
    kernelId: 'kernel-001', allowedPlugins: ['LimenPlugin', 'MathPlugin'],
    plannerType: 'sequential', interceptSkMemory: true, maxPlannerSteps: 20,
    ...overrides,
  };
}

function makeMockClient(overrides?: Partial<LimenAgentClient>): LimenAgentClient {
  return {
    startSession: async () => ({ sessionId: 'session-mock' as SessionId, agentId: TEST_AGENT_ID, tenantId: TEST_TENANT_ID, adapterId: TEST_ADAPTER_ID, trustLevel: 'medium' as const, coreTrustLevel: 'trusted', clearanceLevel: 2, capabilities: new Set<AgentCapability>(['memory_read', 'memory_write']), startedAt: new Date().toISOString(), workingMemoryNamespace: 'test', activeMissions: [], metadata: {} }),
    endSession: async () => ({ sessionId: 'session-mock' as SessionId, agentId: TEST_AGENT_ID, duration: 1000, operationCount: 0, governanceRefusals: 0, branchesCreated: 0, branchesMerged: 0, missionsCompleted: 0, tokensBudgetUsed: 0, outcome: 'completed' as const }),
    remember: async () => 'claim-001' as ClaimId,
    recall: async () => ({ beliefs: [{ belief: { id: 'claim-001' as ClaimId, content: 'test', subject: 'test', predicate: 'test', value: 'test', confidence: 0.9, effectiveConfidence: 0.9, freshness: 'fresh' as const, classification: 'internal' as const, tags: [], category: null, sourceAgentId: TEST_AGENT_ID, missionId: null, taskId: null, groundingMode: 'evidence_path' as const, createdAt: new Date().toISOString() }, evidence: [], relationships: [], status: 'active' as const, retentionPolicy: null, governance: null }], totalCount: 1 }),
    createBranch: async () => 'branch-001' as AgentBranchId,
    mergeBranches: async () => ({ status: 'completed' as const, mergedClaimIds: ['claim-001' as ClaimId], conflictsResolved: [], unresolvedConflicts: [], manualMergeState: null }),
    resolveConflict: async () => ({ status: 'completed' as const, mergedClaimIds: ['claim-001' as ClaimId], conflictsResolved: [], unresolvedConflicts: [], manualMergeState: null }),
    appendAudit: async () => 'evt-001' as EventId,
    healthProbe: async () => ({ connected: true, latencyMs: 5 }),
    ...overrides,
  };
}

function makeMockGovernor(overrides?: Partial<ComputerActionGovernor>): ComputerActionGovernor {
  return { beforeAction: async () => ({ verdict: 'allow' as const, auditId: 'evt-gov-001' as EventId }), afterAction: async () => {}, ...overrides };
}

function makeSessionStart(overrides?: Partial<SKSessionStart>): SKSessionStart {
  return { kernelId: 'kernel-001', loadedPlugins: ['LimenPlugin'], plannerType: 'sequential', memoryEnabled: true, metadata: {}, ...overrides };
}

async function initAdapter(adapter: LimenSemanticKernelAdapter, config?: SKAdapterConfig, client?: LimenAgentClient, governor?: ComputerActionGovernor) {
  const result = await adapter.initialize(client ?? makeMockClient(), governor ?? makeMockGovernor(), config ?? makeConfig());
  assert.ok(result.ok, `Init failed: ${!result.ok ? result.error.message : ''}`);
}

async function initAndStartSession(adapter: LimenSemanticKernelAdapter, config?: SKAdapterConfig) {
  await initAdapter(adapter, config);
  const r = await adapter.onAgentSessionStart(makeSessionStart());
  assert.ok(r.ok);
  return r.value;
}

function makeCtx(sessionId: SessionId): OperationContext {
  return { tenantId: TEST_TENANT_ID, userId: null, agentId: TEST_AGENT_ID, permissions: new Set(), sessionId, clearanceLevel: 2 };
}

describe('LimenSemanticKernelAdapter', () => {
  let adapter: LimenSemanticKernelAdapter;

  beforeEach(() => {
    adapter = new LimenSemanticKernelAdapter(TEST_ADAPTER_ID, makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'));
  });

  it('TC-01: idempotent initialization', async () => {
    const config = makeConfig();
    await initAdapter(adapter, config);
    const r2 = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(r2.ok);
  });

  it('TC-02: different config re-init fails', async () => {
    await initAdapter(adapter);
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ kernelId: 'different' }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'ALREADY_INITIALIZED');
  });

  it('TC-03: agentFramework is semantic_kernel', () => {
    assert.equal(adapter.agentFramework, 'semantic_kernel');
  });

  it('TC-04: use-before-init returns NOT_INITIALIZED', async () => {
    const r = await adapter.remember(makeCtx('s' as SessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  it('TC-05: session lifecycle', async () => {
    await initAdapter(adapter);
    const startR = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(startR.ok);
    assert.ok(startR.value.workingMemoryNamespace.includes('semantic-kernel/'));
    const endR = await adapter.onAgentSessionEnd({ sessionId: startR.value.sessionId, kernelId: 'kernel-001', outcome: 'completed', metadata: {} });
    assert.ok(endR.ok);
    assert.equal(endR.value.outcome, 'completed');
  });

  it('TC-06: governance refusal blocks remember', async () => {
    const governor = makeMockGovernor({ beforeAction: async () => ({ verdict: 'refuse' as const, auditId: 'e' as EventId, reason: 'test', rule: 'r' }) });
    await initAdapter(adapter, undefined, undefined, governor);
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await adapter.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-07: token budget exceeded', async () => {
    const config = makeConfig({ tokenBudget: { maxTokensPerOperation: 5, maxTokensPerSession: 10, encoding: 'cl100k_base', warningThresholdPct: 80, replenishmentWindowSeconds: null } });
    await initAdapter(adapter, config);
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await adapter.remember(makeCtx(s.value.sessionId), 'a'.repeat(100));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'BUDGET_EXCEEDED');
  });

  it('TC-08: audit failure blocks operation', async () => {
    const s = await initAndStartSession(adapter);
    adapter._injectAuditFailure('pre');
    const r = await adapter.remember(makeCtx(s.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'AUDIT_FAILURE');
  });

  it('TC-09: post-audit failure blocks', async () => {
    const s = await initAndStartSession(adapter);
    adapter._injectAuditFailure('post');
    const r = await adapter.remember(makeCtx(s.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'AUDIT_FAILURE');
  });

  it('TC-10: core port loss -> DEGRADED', async () => {
    await initAdapter(adapter);
    adapter._simulateCorePortLoss();
    assert.equal(adapter.lifecycleState, 'DEGRADED');
  });

  it('TC-11: core port recovery', async () => {
    await initAdapter(adapter);
    adapter._simulateCorePortLoss();
    adapter._simulateCorePortRecovery();
    assert.equal(adapter.lifecycleState, 'READY');
  });

  it('TC-12: branch + merge', async () => {
    const s = await initAndStartSession(adapter);
    const ctx = makeCtx(s.sessionId);
    const br = await adapter.createBranch(ctx, 'c1' as ClaimId, 'test branch');
    assert.ok(br.ok);
    const mr = await adapter.mergeBranches(ctx, [br.value], 'highest_confidence');
    assert.ok(mr.ok);
  });

  it('TC-13: shutdown idempotency', async () => {
    await initAdapter(adapter);
    assert.ok((await adapter.shutdown()).ok);
    assert.ok((await adapter.shutdown()).ok);
  });

  it('TC-14: post-shutdown operations fail', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    const r = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  it('TC-15: all core ops fail in DEGRADED', async () => {
    const s = await initAndStartSession(adapter);
    const ctx = makeCtx(s.sessionId);
    adapter._simulateCorePortLoss();
    for (const r of await Promise.all([adapter.remember(ctx, 'x'), adapter.recall(ctx, { text: 'x' }), adapter.createBranch(ctx, 'c' as ClaimId, 'b')])) {
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'CORE_PORT_UNAVAILABLE');
    }
  });

  it('TC-16: error precedence', () => {
    assert.equal(ERROR_PRECEDENCE['NOT_INITIALIZED'], 1);
  });

  it('TC-17: NEVER_RETRYABLE', () => {
    assert.ok(NEVER_RETRYABLE.has('NOT_INITIALIZED'));
    assert.ok(NEVER_RETRYABLE.has('GOVERNANCE_REFUSAL'));
  });

  it('TC-18: recall works', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.recall(makeCtx(s.sessionId), { text: 'test' });
    assert.ok(r.ok);
  });

  it('TC-19: untrusted blocks remember', async () => {
    const a = new LimenSemanticKernelAdapter(TEST_ADAPTER_ID, makeCapabilities('memory_read', 'memory_write'));
    await initAdapter(a, makeConfig({ trustLevel: 'untrusted' }));
    const s = await a.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await a.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'TRUST_LEVEL_INSUFFICIENT');
  });

  it('TC-20: missing capability blocks', async () => {
    const a = new LimenSemanticKernelAdapter(TEST_ADAPTER_ID, makeCapabilities('memory_read'));
    await initAdapter(a);
    const s = await a.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await a.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CAPABILITY_NOT_DECLARED');
  });

  it('TC-21: unknown tool returns UNKNOWN_TOOL', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateToolCall({ toolName: 'nonexistent', toolArgs: {}, callId: 'c1', agentFramework: 'semantic_kernel', rawPayload: {} }, s.sessionId);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'UNKNOWN_TOOL');
  });

  it('TC-22: known tool translates', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateToolCall({ toolName: 'limen_remember', toolArgs: { content: 'x' }, callId: 'c1', agentFramework: 'semantic_kernel', rawPayload: {} }, s.sessionId);
    assert.ok(r.ok);
    assert.equal(r.value[0]!.type, 'remember');
  });

  it('TC-23: translateActionToGovernance', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateActionToGovernance({ adapterId: TEST_ADAPTER_ID, agentId: TEST_AGENT_ID, sessionId: s.sessionId, nativeType: 'custom_action', nativePayload: {}, timestamp: new Date().toISOString() });
    assert.ok(r.ok);
    assert.ok(r.value.type);
  });

  it('TC-24: event subscriptions', async () => {
    await initAdapter(adapter);
    const id = adapter.on('test', () => {});
    assert.ok(typeof id === 'string');
    adapter.off(id);
  });

  it('TC-25: healthCheck healthy', async () => {
    await initAdapter(adapter);
    const r = await adapter.healthCheck();
    assert.ok(r.ok);
    assert.equal(r.value.status, 'healthy');
  });

  it('TC-26: getHealth sync', async () => {
    await initAdapter(adapter);
    assert.equal(adapter.getHealth().status, 'healthy');
  });

  it('TC-27: suspended blocks session start', async () => {
    await initAdapter(adapter);
    adapter._setAgentState('suspended');
    const r = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-28: decommissioned blocks operations', async () => {
    const s = await initAndStartSession(adapter);
    adapter._setAgentState('decommissioned');
    const r = await adapter.remember(makeCtx(s.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-29: empty kernelId fails', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ kernelId: '' }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-30: maxPlannerSteps out of range', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ maxPlannerSteps: 101 }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-31: governed false rejected', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), { ...makeConfig(), governed: false } as unknown as SKAdapterConfig);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-32: session not found', async () => {
    await initAdapter(adapter);
    await adapter.onAgentSessionStart(makeSessionStart());
    const r = await adapter.remember(makeCtx('nonexistent' as SessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SESSION_NOT_FOUND');
  });

  it('TC-33: confidence cap', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.remember(makeCtx(s.sessionId), 'test', { confidence: 0.99 });
    assert.ok(r.ok);
  });

  it('TC-34: resolveConflict', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.resolveConflict(makeCtx(s.sessionId), { mergeId: 'm1', conflictId: 'c1', resolution: 'keep_a' });
    assert.ok(r.ok);
  });

  it('TC-35: merge_new_value without newValue fails', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.resolveConflict(makeCtx(s.sessionId), { mergeId: 'm1', conflictId: 'c1', resolution: 'merge_new_value' } as ManualMergeResolutionRequest);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-36: shutdown closes sessions', async () => {
    await initAndStartSession(adapter);
    assert.equal(adapter.getHealth().activeSessions, 1);
    await adapter.shutdown();
    assert.equal(adapter.getHealth().activeSessions, 0);
  });

  it('TC-37: init after shutdown fails', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  it('TC-38: client error propagation', async () => {
    await initAdapter(adapter, undefined, makeMockClient({ remember: async () => { throw new Error('fail'); } }));
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await adapter.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CLIENT_ERROR');
  });

  it('TC-39: governance escalation', async () => {
    const gov = makeMockGovernor({ beforeAction: async () => ({ verdict: 'escalate' as const, auditId: 'e' as EventId, reason: 'needs_approval', requiredApproval: 'human' as const }) });
    await initAdapter(adapter, undefined, undefined, gov);
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await adapter.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-40: on() throws after shutdown', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    assert.throws(() => adapter.on('x', () => {}));
  });

  it('TC-41: off() throws after shutdown', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    assert.throws(() => adapter.off('sub-0'));
  });

  it('TC-42: session namespace includes SK context', async () => {
    await initAdapter(adapter);
    const s = await adapter.onAgentSessionStart(makeSessionStart({ kernelId: 'k-xyz', plannerType: 'stepwise' }));
    assert.ok(s.ok);
    assert.ok(s.value.workingMemoryNamespace.includes('semantic-kernel/k-xyz/stepwise'));
  });

  it('TC-43: session metadata has SK fields', async () => {
    await initAdapter(adapter);
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    assert.equal(s.value.metadata.kernelId, 'kernel-001');
    assert.deepEqual(s.value.metadata.loadedPlugins, ['LimenPlugin']);
    assert.equal(s.value.metadata.plannerType, 'sequential');
    assert.equal(s.value.metadata.memoryEnabled, true);
  });

  it('TC-44: missing nativeType returns SERDE_ERROR', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateActionToGovernance({ adapterId: TEST_ADAPTER_ID, agentId: TEST_AGENT_ID, sessionId: s.sessionId, nativeType: '', nativePayload: {}, timestamp: new Date().toISOString() } as NativeAgentAction);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });
});

describe('SK Hook Translation', () => {
  it('TC-45: LimenPlugin.Remember translates', () => {
    const ops = translateToolToOperations({ toolName: 'LimenPlugin.Remember', toolArgs: { content: 'x' }, callId: 'c1', agentFramework: 'semantic_kernel', rawPayload: {} });
    assert.ok(ops !== null);
    assert.equal(ops[0]!.type, 'remember');
  });

  it('TC-46: LimenPlugin.Recall translates', () => {
    const ops = translateToolToOperations({ toolName: 'LimenPlugin.Recall', toolArgs: { query: 'x' }, callId: 'c1', agentFramework: 'semantic_kernel', rawPayload: {} });
    assert.ok(ops !== null);
    assert.equal(ops[0]!.type, 'recall');
  });

  it('TC-47: unknown tool returns null', () => {
    assert.equal(translateToolToOperations({ toolName: 'UnknownPlugin.Foo', toolArgs: {}, callId: 'c1', agentFramework: 'semantic_kernel', rawPayload: {} }), null);
  });

  it('TC-48: function_invoked maps to hook:after_tool_call', () => {
    const ev: SKHookEvent = { type: 'function_invoked', pluginName: 'P', functionName: 'F', args: {} };
    const mapped = mapNativeEvent(ev, 'a' as AdapterId, 'ag' as AgentId, null);
    assert.ok(mapped !== null);
    assert.equal(mapped.event, 'hook:after_tool_call');
  });

  it('TC-49: planner_step maps to sk:planner_step', () => {
    const ev: SKHookEvent = { type: 'planner_step', stepIndex: 0, plannerType: 'sequential', functionName: 'F' };
    const mapped = mapNativeEvent(ev, 'a' as AdapterId, 'ag' as AgentId, null);
    assert.ok(mapped !== null);
    assert.equal(mapped.event, 'sk:planner_step');
  });

  it('TC-50: mapLimenEvent round-trip', () => {
    const ev: AgentEventPayload = { eventId: 'e' as EventId, event: 'hook:after_tool_call', timestamp: '', adapterId: 'a' as AdapterId, sessionId: null, agentId: 'ag' as AgentId, data: { pluginName: 'P', functionName: 'F', args: {} } };
    const mapped = mapLimenEvent(ev);
    assert.ok(mapped !== null);
    assert.equal(mapped.type, 'function_invoked');
  });

  it('TC-51: KNOWN_TOOLS includes SK-style Plugin.Function names', () => {
    assert.ok(KNOWN_TOOLS.includes('LimenPlugin.Remember'));
    assert.ok(KNOWN_TOOLS.includes('LimenPlugin.Recall'));
    assert.ok(KNOWN_TOOLS.includes('limen_remember'));
  });
});
