// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * LlamaIndex Adapter Test Suite
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Covers: TC-01 through TC-51 mandatory test cases.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LimenLlamaIndexAdapter } from '../adapter.js';
import type { LlamaIndexAdapterConfig, LlamaIndexSessionStart, LlamaIndexSessionEnd, LlamaIndexHookEvent } from '../types.js';
import { translateToolToOperations, mapNativeEvent, mapLimenEvent, KNOWN_TOOLS } from '../hooks.js';
import type {
  AdapterId, AgentId, SessionId, ClaimId, AgentBranchId, EventId, TenantId,
  AgentCapability, LimenAgentClient, ComputerActionGovernor, OperationContext,
  AgentEventPayload, NativeAgentAction, ManualMergeResolutionRequest,
} from '../../shared/types.js';
import { ERROR_PRECEDENCE, NEVER_RETRYABLE } from '../../shared/types.js';

const TEST_ADAPTER_ID = 'adapter-li-test' as AdapterId;
const TEST_AGENT_ID = 'agent-li-001' as AgentId;
const TEST_TENANT_ID = 'tenant-001' as TenantId;

function makeCapabilities(...caps: AgentCapability[]): ReadonlySet<AgentCapability> {
  return new Set(caps);
}

function makeConfig(overrides?: Partial<LlamaIndexAdapterConfig>): LlamaIndexAdapterConfig {
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
    indexId: 'idx-001', indexType: 'vector', interceptRetrieval: true, maxIngestionBatchSize: 100, retrievalTopK: 10,
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

function makeSessionStart(overrides?: Partial<LlamaIndexSessionStart>): LlamaIndexSessionStart {
  return { indexId: 'idx-001', indexType: 'vector', connectors: ['SimpleDirectoryReader'], queryEngineType: 'retriever', metadata: {}, ...overrides };
}

async function initAdapter(adapter: LimenLlamaIndexAdapter, config?: LlamaIndexAdapterConfig, client?: LimenAgentClient, governor?: ComputerActionGovernor) {
  const result = await adapter.initialize(client ?? makeMockClient(), governor ?? makeMockGovernor(), config ?? makeConfig());
  assert.ok(result.ok, `Init failed: ${!result.ok ? result.error.message : ''}`);
}

async function initAndStartSession(adapter: LimenLlamaIndexAdapter, config?: LlamaIndexAdapterConfig) {
  await initAdapter(adapter, config);
  const r = await adapter.onAgentSessionStart(makeSessionStart());
  assert.ok(r.ok);
  return r.value;
}

function makeCtx(sessionId: SessionId): OperationContext {
  return { tenantId: TEST_TENANT_ID, userId: null, agentId: TEST_AGENT_ID, permissions: new Set(), sessionId, clearanceLevel: 2 };
}

describe('LimenLlamaIndexAdapter', () => {
  let adapter: LimenLlamaIndexAdapter;

  beforeEach(() => {
    adapter = new LimenLlamaIndexAdapter(TEST_ADAPTER_ID, makeCapabilities('memory_read', 'memory_write', 'branching', 'belief_management'));
  });

  it('TC-01: idempotent initialization', async () => {
    const config = makeConfig();
    await initAdapter(adapter, config);
    const r2 = await adapter.initialize(makeMockClient(), makeMockGovernor(), config);
    assert.ok(r2.ok);
  });

  it('TC-02: different config re-init fails', async () => {
    await initAdapter(adapter);
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ indexId: 'different' }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'ALREADY_INITIALIZED');
  });

  it('TC-03: agentFramework is llama_index', () => {
    assert.equal(adapter.agentFramework, 'llama_index');
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
    assert.ok(startR.value.workingMemoryNamespace.includes('llamaindex/'));
    const endR = await adapter.onAgentSessionEnd({ sessionId: startR.value.sessionId, indexId: 'idx-001', outcome: 'completed', metadata: {} });
    assert.ok(endR.ok);
    assert.equal(endR.value.outcome, 'completed');
  });

  it('TC-06: governance refusal blocks remember', async () => {
    const gov = makeMockGovernor({ beforeAction: async () => ({ verdict: 'refuse' as const, auditId: 'e' as EventId, reason: 'test', rule: 'r' }) });
    await initAdapter(adapter, undefined, undefined, gov);
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

  it('TC-08: audit failure blocks', async () => {
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

  it('TC-10: DEGRADED state', async () => {
    await initAdapter(adapter);
    adapter._simulateCorePortLoss();
    assert.equal(adapter.lifecycleState, 'DEGRADED');
  });

  it('TC-11: recovery from DEGRADED', async () => {
    await initAdapter(adapter);
    adapter._simulateCorePortLoss();
    adapter._simulateCorePortRecovery();
    assert.equal(adapter.lifecycleState, 'READY');
  });

  it('TC-12: branch + merge', async () => {
    const s = await initAndStartSession(adapter);
    const ctx = makeCtx(s.sessionId);
    const br = await adapter.createBranch(ctx, 'c1' as ClaimId, 'test');
    assert.ok(br.ok);
    const mr = await adapter.mergeBranches(ctx, [br.value], 'highest_confidence');
    assert.ok(mr.ok);
  });

  it('TC-13: shutdown idempotent', async () => {
    await initAdapter(adapter);
    assert.ok((await adapter.shutdown()).ok);
    assert.ok((await adapter.shutdown()).ok);
  });

  it('TC-14: post-shutdown fails', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    const r = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  it('TC-15: DEGRADED blocks all ops', async () => {
    const s = await initAndStartSession(adapter);
    const ctx = makeCtx(s.sessionId);
    adapter._simulateCorePortLoss();
    for (const r of await Promise.all([adapter.remember(ctx, 'x'), adapter.recall(ctx, { text: 'x' }), adapter.createBranch(ctx, 'c' as ClaimId, 'b')])) {
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'CORE_PORT_UNAVAILABLE');
    }
  });

  it('TC-16: error precedence', () => { assert.equal(ERROR_PRECEDENCE['NOT_INITIALIZED'], 1); });
  it('TC-17: NEVER_RETRYABLE', () => { assert.ok(NEVER_RETRYABLE.has('NOT_INITIALIZED')); assert.ok(NEVER_RETRYABLE.has('GOVERNANCE_REFUSAL')); });

  it('TC-18: recall works', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.recall(makeCtx(s.sessionId), { text: 'test' });
    assert.ok(r.ok);
  });

  it('TC-19: untrusted blocks remember', async () => {
    const a = new LimenLlamaIndexAdapter(TEST_ADAPTER_ID, makeCapabilities('memory_read', 'memory_write'));
    await initAdapter(a, makeConfig({ trustLevel: 'untrusted' }));
    const s = await a.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await a.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'TRUST_LEVEL_INSUFFICIENT');
  });

  it('TC-20: missing capability blocks', async () => {
    const a = new LimenLlamaIndexAdapter(TEST_ADAPTER_ID, makeCapabilities('memory_read'));
    await initAdapter(a);
    const s = await a.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await a.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CAPABILITY_NOT_DECLARED');
  });

  it('TC-21: unknown tool', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateToolCall({ toolName: 'nonexistent', toolArgs: {}, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} }, s.sessionId);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'UNKNOWN_TOOL');
  });

  it('TC-22: known tool translates', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateToolCall({ toolName: 'limen_remember', toolArgs: { content: 'x' }, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} }, s.sessionId);
    assert.ok(r.ok);
    assert.equal(r.value[0]!.type, 'remember');
  });

  it('TC-23: translateActionToGovernance', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.translateActionToGovernance({ adapterId: TEST_ADAPTER_ID, agentId: TEST_AGENT_ID, sessionId: s.sessionId, nativeType: 'query', nativePayload: {}, timestamp: new Date().toISOString() });
    assert.ok(r.ok);
  });

  it('TC-24: event subscriptions', async () => {
    await initAdapter(adapter);
    const id = adapter.on('test', () => {});
    adapter.off(id);
  });

  it('TC-25: healthCheck', async () => {
    await initAdapter(adapter);
    const r = await adapter.healthCheck();
    assert.ok(r.ok);
    assert.equal(r.value.status, 'healthy');
  });

  it('TC-26: getHealth', async () => {
    await initAdapter(adapter);
    assert.equal(adapter.getHealth().status, 'healthy');
  });

  it('TC-27: suspended blocks session', async () => {
    await initAdapter(adapter);
    adapter._setAgentState('suspended');
    const r = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-28: decommissioned blocks ops', async () => {
    const s = await initAndStartSession(adapter);
    adapter._setAgentState('decommissioned');
    const r = await adapter.remember(makeCtx(s.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-29: empty indexId fails', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ indexId: '' }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-30: maxIngestionBatchSize out of range', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ maxIngestionBatchSize: 0 }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-31: retrievalTopK out of range', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig({ retrievalTopK: 0 }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-32: governed false rejected', async () => {
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), { ...makeConfig(), governed: false } as unknown as LlamaIndexAdapterConfig);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-33: session not found', async () => {
    await initAdapter(adapter);
    await adapter.onAgentSessionStart(makeSessionStart());
    const r = await adapter.remember(makeCtx('nonexistent' as SessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SESSION_NOT_FOUND');
  });

  it('TC-34: confidence cap', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.remember(makeCtx(s.sessionId), 'test', { confidence: 0.99 });
    assert.ok(r.ok);
  });

  it('TC-35: resolveConflict', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.resolveConflict(makeCtx(s.sessionId), { mergeId: 'm1', conflictId: 'c1', resolution: 'keep_a' });
    assert.ok(r.ok);
  });

  it('TC-36: merge_new_value without newValue fails', async () => {
    const s = await initAndStartSession(adapter);
    const r = await adapter.resolveConflict(makeCtx(s.sessionId), { mergeId: 'm1', conflictId: 'c1', resolution: 'merge_new_value' } as ManualMergeResolutionRequest);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'SERDE_ERROR');
  });

  it('TC-37: shutdown closes sessions', async () => {
    await initAndStartSession(adapter);
    assert.equal(adapter.getHealth().activeSessions, 1);
    await adapter.shutdown();
    assert.equal(adapter.getHealth().activeSessions, 0);
  });

  it('TC-38: init after shutdown fails', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    const r = await adapter.initialize(makeMockClient(), makeMockGovernor(), makeConfig());
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'NOT_INITIALIZED');
  });

  it('TC-39: client error propagation', async () => {
    await initAdapter(adapter, undefined, makeMockClient({ remember: async () => { throw new Error('fail'); } }));
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await adapter.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'CLIENT_ERROR');
  });

  it('TC-40: governance escalation', async () => {
    const gov = makeMockGovernor({ beforeAction: async () => ({ verdict: 'escalate' as const, auditId: 'e' as EventId, reason: 'needs_approval', requiredApproval: 'human' as const }) });
    await initAdapter(adapter, undefined, undefined, gov);
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    const r = await adapter.remember(makeCtx(s.value.sessionId), 'test');
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'GOVERNANCE_REFUSAL');
  });

  it('TC-41: on() throws after shutdown', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    assert.throws(() => adapter.on('x', () => {}));
  });

  it('TC-42: off() throws after shutdown', async () => {
    await initAdapter(adapter);
    await adapter.shutdown();
    assert.throws(() => adapter.off('sub-0'));
  });

  it('TC-43: namespace includes LlamaIndex context', async () => {
    await initAdapter(adapter);
    const s = await adapter.onAgentSessionStart(makeSessionStart({ indexId: 'my-idx', indexType: 'knowledge_graph' }));
    assert.ok(s.ok);
    assert.ok(s.value.workingMemoryNamespace.includes('llamaindex/my-idx/knowledge_graph'));
  });

  it('TC-44: session metadata has LlamaIndex fields', async () => {
    await initAdapter(adapter);
    const s = await adapter.onAgentSessionStart(makeSessionStart());
    assert.ok(s.ok);
    assert.equal(s.value.metadata.indexId, 'idx-001');
    assert.equal(s.value.metadata.indexType, 'vector');
    assert.deepEqual(s.value.metadata.connectors, ['SimpleDirectoryReader']);
    assert.equal(s.value.metadata.queryEngineType, 'retriever');
  });
});

describe('LlamaIndex Hook Translation', () => {
  it('TC-45: query tool translates to recall', () => {
    const ops = translateToolToOperations({ toolName: 'query', toolArgs: { query: 'what is X?' }, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} });
    assert.ok(ops !== null);
    assert.equal(ops[0]!.type, 'recall');
  });

  it('TC-46: ingest tool translates to remember', () => {
    const ops = translateToolToOperations({ toolName: 'ingest', toolArgs: { content: 'document content' }, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} });
    assert.ok(ops !== null);
    assert.equal(ops[0]!.type, 'remember');
  });

  it('TC-47: index_delete translates to forget', () => {
    const ops = translateToolToOperations({ toolName: 'index_delete', toolArgs: { nodeId: 'node-001' }, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} });
    assert.ok(ops !== null);
    assert.equal(ops[0]!.type, 'forget');
  });

  it('TC-48: index_refresh translates to remember + forget', () => {
    const ops = translateToolToOperations({ toolName: 'index_refresh', toolArgs: { documentsToAdd: ['doc1'], nodeIdsToDelete: ['n1'] }, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} });
    assert.ok(ops !== null);
    assert.equal(ops.length, 2);
    assert.equal(ops[0]!.type, 'remember');
    assert.equal(ops[1]!.type, 'forget');
  });

  it('TC-49: unknown tool returns null', () => {
    assert.equal(translateToolToOperations({ toolName: 'randomtool', toolArgs: {}, callId: 'c1', agentFramework: 'llama_index', rawPayload: {} }), null);
  });

  it('TC-50: query_start maps to llamaindex:query_start', () => {
    const ev: LlamaIndexHookEvent = { type: 'query_start', query: 'test', engineType: 'retriever' };
    const mapped = mapNativeEvent(ev, 'a' as AdapterId, 'ag' as AgentId, null);
    assert.ok(mapped !== null);
    assert.equal(mapped.event, 'llamaindex:query_start');
  });

  it('TC-51: mapLimenEvent round-trip for tool_called', () => {
    const ev: AgentEventPayload = { eventId: 'e' as EventId, event: 'hook:after_tool_call', timestamp: '', adapterId: 'a' as AdapterId, sessionId: null, agentId: 'ag' as AgentId, data: { toolName: 'test', args: {} } };
    const mapped = mapLimenEvent(ev);
    assert.ok(mapped !== null);
    assert.equal(mapped.type, 'tool_called');
  });
});
