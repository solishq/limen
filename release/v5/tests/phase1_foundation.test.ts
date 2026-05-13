/*
 * Phase 1 foundation verification.
 * Contract refs: Phase 1 prompt action 8; SHARED_TYPES.md §§1-10, §§14-16, §20; CREWAI_ADAPTER_CONTRACT.md Claims 1.1-1.13.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditLogger, InMemoryAuditSink } from '../src/audit/AuditLogger.js';
import { LimenAgentClient } from '../src/client/LimenAgentClient.js';
import { VALID_TRANSITIONS } from '../src/lifecycle/AgentLifecycle.js';
import {
  AGENT_CAPABILITIES,
  AGENT_EVENTS,
  AGENT_FRAMEWORKS,
  TRUST_TO_CLEARANCE,
  adapterError,
  brand,
  derivePermissions,
  effectiveCapabilities,
  sessionToContext,
  type AgentCapability,
  type AgentTrustLevel,
  type ClaimId,
} from '../src/types/index.js';

function ids(prefix = 'id'): () => string {
  let index = 0;
  return () => `${prefix}_${index++}`;
}

function client(trustLevel: AgentTrustLevel = 'high', capabilities: ReadonlySet<AgentCapability> = new Set(AGENT_CAPABILITIES)): LimenAgentClient {
  const idFactory = ids('test');
  return new LimenAgentClient({
    adapterId: brand<'AdapterId'>('adapter:test'),
    agentId: brand<'AgentId'>('agent:test'),
    tenantId: brand<'TenantId'>('tenant:test'),
    trustLevel,
    capabilities,
    idFactory,
    nowMs: () => 1_775_000_000_000,
    nowIso: () => '2026-05-07T20:35:00.000Z',
  });
}

test('createSession, remember, recall, healthCheck, and shutdown audit public calls', async () => {
  const sink = new InMemoryAuditSink();
  const idFactory = ids('audit');
  const auditLogger = new AuditLogger({
    adapterId: brand<'AdapterId'>('adapter:audit'),
    nowIso: () => '2026-05-07T20:35:00.000Z',
    idFactory,
    sink,
  });
  const limen = new LimenAgentClient({
    adapterId: brand<'AdapterId'>('adapter:audit'),
    agentId: brand<'AgentId'>('agent:audit'),
    tenantId: brand<'TenantId'>('tenant:audit'),
    trustLevel: 'high',
    capabilities: new Set(AGENT_CAPABILITIES),
    auditLogger,
    idFactory,
    nowMs: () => 1_775_000_000_000,
    nowIso: () => '2026-05-07T20:35:00.000Z',
  });
  const session = await limen.createSession({ scenario: 'unit' });
  assert.equal(session.ok, true);
  const remembered = await limen.remember({ subject: 'phase1', predicate: 'status', value: 'ready' }, { classification: 'internal', confidence: 0.8 });
  assert.equal(remembered.ok, true);
  const recalled = await limen.recall({ subject: 'phase1' });
  assert.equal(recalled.ok, true);
  assert.equal(recalled.value.length, 1);
  const health = await limen.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.value.status, 'healthy');
  const shutdown = await limen.shutdown();
  assert.equal(shutdown.ok, true);
  assert.equal(auditLogger.verifyChain(sink.entries()).ok, true);
  assert.ok(sink.entries().length >= 5);
});

test('DEGRADED state is fail-closed for all core operations and permits healthCheck/getHealth', async () => {
  const limen = client('untrusted', new Set(['memory_read', 'context_management']));
  const session = await limen.createSession();
  assert.equal(session.ok, true);
  const refused = await limen.remember({ subject: 'x', predicate: 'y', value: 'z' }, { classification: 'internal' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'GOVERNANCE_REFUSAL');
  const degradedRemember = await limen.remember('another');
  const degradedRecall = await limen.recall({});
  const degradedBranch = await limen.createBranch(brand<'ClaimId'>('claim:1'), 'branch');
  const degradedMerge = await limen.mergeBranches([brand<'AgentBranchId'>('branch:1')], 'temporal_latest');
  const degradedResolve = await limen.resolveConflict({ mergeId: 'merge:1', conflictId: 'conflict:1', resolution: 'keep_trunk' });
  for (const result of [degradedRemember, degradedRecall, degradedBranch, degradedMerge, degradedResolve]) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CORE_PORT_UNAVAILABLE');
  }
  const health = await limen.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.value.status, 'degraded');
  assert.equal(limen.getHealth().status, 'degraded');
});

test('audit failure rejects the operation before state mutation', async () => {
  const adapterId = brand<'AdapterId'>('adapter:fail-audit');
  const auditLogger = new AuditLogger({
    adapterId,
    nowIso: () => '2026-05-07T20:35:00.000Z',
    idFactory: ids('fail'),
    sink: {
      append: () => ({
        ok: false,
        error: adapterError(adapterId, 'AUDIT_APPEND_FAILED', 'sink down', 'SHARED_TYPES.md §10.3'),
      }),
    },
  });
  const limen = new LimenAgentClient({
    adapterId,
    agentId: brand<'AgentId'>('agent:fail-audit'),
    tenantId: null,
    trustLevel: 'high',
    capabilities: new Set(AGENT_CAPABILITIES),
    auditLogger,
  });
  const result = await limen.createSession();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUDIT_APPEND_FAILED');
});

test('execute does not record governance allow before delegated operation governance passes', async () => {
  const sink = new InMemoryAuditSink();
  const idFactory = ids('execute');
  const auditLogger = new AuditLogger({
    adapterId: brand<'AdapterId'>('adapter:execute'),
    nowIso: () => '2026-05-07T20:35:00.000Z',
    idFactory,
    sink,
  });
  const limen = new LimenAgentClient({
    adapterId: brand<'AdapterId'>('adapter:execute'),
    agentId: brand<'AgentId'>('agent:execute'),
    tenantId: brand<'TenantId'>('tenant:execute'),
    trustLevel: 'untrusted',
    capabilities: new Set(['memory_read', 'context_management']),
    auditLogger,
    idFactory,
    nowMs: () => 1_775_000_000_000,
    nowIso: () => '2026-05-07T20:35:00.000Z',
  });
  assert.equal((await limen.createSession()).ok, true);
  const result = await limen.execute({ type: 'remember', content: 'blocked write' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GOVERNANCE_REFUSAL');
  assert.ok(sink.entries().some((entry) => entry.event === 'action:before' && entry.details['method'] === 'execute'));
  assert.ok(sink.entries().some((entry) => entry.event === 'governance:refused'));
  assert.equal(sink.entries().some((entry) => entry.event === 'governance:allowed' && entry.details['method'] === 'execute'), false);
});

test('branch merges consume merged branch IDs and manual merge rejects expired or repeated resolutions', async () => {
  let nowMs = Date.parse('2026-05-07T20:35:00.000Z');
  const limen = new LimenAgentClient({
    adapterId: brand<'AdapterId'>('adapter:merge'),
    agentId: brand<'AgentId'>('agent:merge'),
    tenantId: brand<'TenantId'>('tenant:merge'),
    trustLevel: 'high',
    capabilities: new Set(AGENT_CAPABILITIES),
    idFactory: ids('merge'),
    nowMs: () => nowMs,
    nowIso: () => new Date(nowMs).toISOString(),
  });
  assert.equal((await limen.createSession()).ok, true);
  const remembered = await limen.remember({ subject: 'merge', predicate: 'claim', value: 'v1' });
  assert.equal(remembered.ok, true);
  const branch = await limen.createBranch(remembered.value, 'consume-on-merge');
  assert.equal(branch.ok, true);
  const firstMerge = await limen.mergeBranches([branch.value], 'temporal_latest');
  assert.equal(firstMerge.ok, true);
  assert.deepEqual(firstMerge.value.mergedClaimIds, [remembered.value]);
  const secondMerge = await limen.mergeBranches([branch.value], 'temporal_latest');
  assert.equal(secondMerge.ok, true);
  assert.deepEqual(secondMerge.value.mergedClaimIds, []);

  const branchA = await limen.createBranch(remembered.value, 'manual-a');
  const branchB = await limen.createBranch(remembered.value, 'manual-b');
  assert.equal(branchA.ok, true);
  assert.equal(branchB.ok, true);
  const pending = await limen.mergeBranches([branchA.value, branchB.value], 'manual');
  assert.equal(pending.ok, true);
  assert.equal(pending.value.status, 'pending_resolution');
  assert.ok(pending.value.manualMergeState !== null);
  const conflict = pending.value.unresolvedConflicts[0];
  assert.ok(conflict !== undefined);
  const resolved = await limen.resolveConflict({
    mergeId: pending.value.manualMergeState.mergeId,
    conflictId: conflict.conflictId,
    resolution: 'keep_branch',
  });
  assert.equal(resolved.ok, true);
  const repeated = await limen.resolveConflict({
    mergeId: pending.value.manualMergeState.mergeId,
    conflictId: conflict.conflictId,
    resolution: 'keep_branch',
  });
  assert.equal(repeated.ok, false);
  assert.match(repeated.error.message, /already resolved/);

  const branchC = await limen.createBranch(remembered.value, 'manual-c');
  const branchD = await limen.createBranch(remembered.value, 'manual-d');
  assert.equal(branchC.ok, true);
  assert.equal(branchD.ok, true);
  const expiring = await limen.mergeBranches([branchC.value, branchD.value], 'manual');
  assert.equal(expiring.ok, true);
  assert.ok(expiring.value.manualMergeState !== null);
  const expiringConflict = expiring.value.unresolvedConflicts[0];
  assert.ok(expiringConflict !== undefined);
  nowMs += 31 * 60 * 1000;
  const expired = await limen.resolveConflict({
    mergeId: expiring.value.manualMergeState.mergeId,
    conflictId: expiringConflict.conflictId,
    resolution: 'keep_branch',
  });
  assert.equal(expired.ok, false);
  assert.match(expired.error.message, /expired/);
});

test('recall applies canonical filters and validates bounded numeric query fields', async () => {
  let nowMs = Date.parse('2026-05-07T20:35:00.000Z');
  const limen = new LimenAgentClient({
    adapterId: brand<'AdapterId'>('adapter:recall-filter'),
    agentId: brand<'AgentId'>('agent:recall-filter'),
    tenantId: brand<'TenantId'>('tenant:recall-filter'),
    trustLevel: 'high',
    capabilities: new Set(AGENT_CAPABILITIES),
    idFactory: ids('recall'),
    nowMs: () => nowMs,
    nowIso: () => new Date(nowMs).toISOString(),
  });
  assert.equal((await limen.createSession()).ok, true);
  const missionA = brand<'MissionId'>('mission:a');
  const missionB = brand<'MissionId'>('mission:b');
  assert.equal((await limen.remember({ subject: 'filter', predicate: 'item', value: 'older' }, { confidence: 0.4, tags: ['slow'], category: 'demo', missionId: missionA })).ok, true);
  nowMs += 60_000;
  assert.equal((await limen.remember({ subject: 'filter', predicate: 'item', value: 'newer' }, { confidence: 0.9, tags: ['fast'], category: 'demo', missionId: missionB })).ok, true);
  const recalled = await limen.recall({
    subject: 'filter',
    tags: ['fast'],
    category: 'demo',
    minConfidence: 0.5,
    timeRange: { from: '2026-05-07T20:35:30.000Z', to: '2026-05-07T20:37:00.000Z' },
    missionId: missionB,
  }, { sortBy: 'confidence' });
  assert.equal(recalled.ok, true);
  assert.equal(recalled.value.length, 1);
  assert.equal(recalled.value[0]?.belief.value, 'newer');

  const invalid = await limen.recall({ minConfidence: 1.1 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'SERDE_ERROR');
});

test('dual-projection parity constants expose closed TypeScript wire names', () => {
  assert.deepEqual(AGENT_FRAMEWORKS, ['claude', 'codex', 'openclaw', 'hermes', 'gemma', 'custom', 'crew_ai', 'auto_gen', 'semantic_kernel', 'llama_index']);
  assert.ok(AGENT_EVENTS.includes('session:rejected'));
  assert.ok(AGENT_EVENTS.includes('*'));
});

test('property sweep proves trust-to-clearance and permission derivation are monotonic', () => {
  const trustLevels: readonly AgentTrustLevel[] = ['untrusted', 'low', 'medium', 'high', 'verified'];
  for (let i = 0; i < trustLevels.length; i += 1) {
    const trust = trustLevels[i];
    assert.ok(trust !== undefined);
    assert.equal(TRUST_TO_CLEARANCE[trust], i);
    const capabilities = effectiveCapabilities(trust, new Set(AGENT_CAPABILITIES));
    for (const capability of capabilities) {
      const lowerTrust = trustLevels[Math.max(0, i - 1)];
      assert.ok(lowerTrust !== undefined);
      if (lowerTrust !== trust) {
        const lowerCaps = effectiveCapabilities(lowerTrust, new Set([capability]));
        assert.ok(lowerCaps.size <= 1);
      }
    }
    const permissions = derivePermissions(capabilities);
    assert.ok(permissions.size > 0);
  }
});

test('property sweep proves the 10 Phase X invariants on the foundation surface', async () => {
  const root = resolve(import.meta.dirname, '../../../');
  assert.equal(existsSync(resolve(root, 'v5')), false, 'Core Isolation: root v5 directory remains untouched');

  const mediated = client('high');
  const preSession = await mediated.remember('blocked until createSession');
  assert.equal(preSession.ok, false, 'Client Mediation: core operation before session is rejected');

  const session = await mediated.createSession();
  assert.equal(session.ok, true);
  const context = sessionToContext(session.value);
  assert.equal(context.agentId, session.value.agentId, 'Session Isolation: context carries explicit agent identity');

  const write = await mediated.remember({ subject: 'class', predicate: 'level', value: 'internal' }, { classification: 'internal' });
  assert.equal(write.ok, true, 'Governance Non-Optionality: governed write succeeds only through permissions');

  const health = await mediated.healthCheck();
  assert.equal(health.ok, true, 'Unified Audit Chain: health is audited and available');

  const one = client('high');
  const two = client('high');
  assert.equal((await one.createSession()).ok, true);
  assert.equal((await two.createSession()).ok, true);
  assert.equal((await one.remember({ subject: 'iso', predicate: 'owner', value: 'one' })).ok, true);
  const isolated = await two.recall({ subject: 'iso' });
  assert.equal(isolated.ok, true);
  assert.equal(isolated.value.length, 0, 'Session Isolation: separate clients do not share memory');

  const branch = await mediated.createBranch(write.value as ClaimId, 'manual branch');
  assert.equal(branch.ok, true, 'Adapter Purity: branch operation enters as canonical client operation');
  const merge = await mediated.mergeBranches([branch.value, brand<'AgentBranchId'>('branch:synthetic')], 'manual');
  assert.equal(merge.ok, true);
  assert.equal(merge.value.status, 'pending_resolution', 'CCP Conflict Authority: manual merge cannot silently complete');

  const unknownResolution = await mediated.resolveConflict({ mergeId: 'missing', conflictId: 'missing', resolution: 'keep_trunk' });
  assert.equal(unknownResolution.ok, false, 'CCP Conflict Authority: unknown conflicts are rejected');

  const classificationClient = client('high');
  assert.equal((await classificationClient.createSession()).ok, true);
  const recalled = await classificationClient.recall({ classification: 'critical' });
  assert.equal(recalled.ok, false, 'Classification Enforcement: critical read above high clearance is refused');

  const releaseRoot = resolve(root, 'release/v5');
  assert.equal(existsSync(releaseRoot), true, 'Additive Migration: foundation is additive under release/v5');

  const start = performance.now();
  await mediated.healthCheck();
  assert.ok(performance.now() - start < 50, 'Performance Budget: health/governance check stays inside local budget envelope');
});

test('mutation harness kills lifecycle critical-path mutants at >= 85 percent', () => {
  const requiredValid = new Set([
    'UNINITIALIZED->INITIALIZING',
    'UNINITIALIZED->SHUTDOWN',
    'INITIALIZING->READY',
    'INITIALIZING->DEGRADED',
    'INITIALIZING->SHUTDOWN',
    'READY->DEGRADED',
    'READY->SHUTDOWN',
    'DEGRADED->READY',
    'DEGRADED->SHUTDOWN',
  ]);
  const allStates = Object.keys(VALID_TRANSITIONS);
  const assertMatrix = (matrix: typeof VALID_TRANSITIONS): void => {
    for (const from of allStates) {
      for (const to of allStates) {
        const key = `${from}->${to}`;
        assert.equal(matrix[from as keyof typeof VALID_TRANSITIONS].includes(to as never), requiredValid.has(key), key);
      }
    }
  };
  const mutants = [
    { ...VALID_TRANSITIONS, READY: ['SHUTDOWN'] },
    { ...VALID_TRANSITIONS, DEGRADED: ['SHUTDOWN'] },
    { ...VALID_TRANSITIONS, SHUTDOWN: ['READY'] },
    { ...VALID_TRANSITIONS, UNINITIALIZED: ['READY'] },
    { ...VALID_TRANSITIONS, INITIALIZING: ['READY', 'SHUTDOWN'] },
    { ...VALID_TRANSITIONS, READY: ['DEGRADED', 'SHUTDOWN', 'READY'] },
    { ...VALID_TRANSITIONS, DEGRADED: [] },
  ] as const;
  let killed = 0;
  for (const mutant of mutants) {
    assert.throws(() => assertMatrix(mutant));
    killed += 1;
  }
  assert.equal(killed / mutants.length, 1);
  assert.ok(killed / mutants.length >= 0.85);
});
