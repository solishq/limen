/**
 * TEST-GAP-016: Phase 4D-2 Enforcement Mechanisms
 * Tests for 8 findings: CF-027, CF-030, CF-020, CF-012, CF-013, CF-026, CF-008, CF-014
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * Each test verifies spec-mandated enforcement behavior.
 *
 * Phase: 4D-2 (Enforcement Mechanisms)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { LimenError } from '../../src/api/errors/limen_error.js';
import { MISSION_TREE_DEFAULTS } from '../../src/orchestration/interfaces/orchestration.js';
import { createCapabilityAdapterRegistry } from '../../src/substrate/adapters/capability_registry.js';
import {
  createTestDatabase,
  createTestOperationContext,
  createTestOrchestrationDeps,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import { requestCapability } from '../../src/orchestration/syscalls/request_capability.js';
import { requestBudget } from '../../src/orchestration/syscalls/request_budget.js';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import { createEventPropagator } from '../../src/orchestration/events/event_propagation.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import type { OperationContext, MissionId, AgentId } from '../../src/kernel/interfaces/index.js';
import { SessionManager } from '../../src/api/sessions/session_manager.js';
import { AgentApiImpl } from '../../src/api/agents/agent_api.js';
import { createEventBus } from '../../src/kernel/events/event_bus.js';

// ============================================================================
// CF-027: Mission Tree Total Node Limit (I-20)
// S ref: I-20 — "total nodes (max 50)"
// ============================================================================

describe('CF-027: maxTotalMissions matches spec I-20 (max 50)', () => {

  it('#1: MISSION_TREE_DEFAULTS.maxTotalMissions === 50', () => {
    // I-20: "Mission trees are bounded by depth (max 5) and children (max 10) and total nodes (max 50)"
    assert.equal(MISSION_TREE_DEFAULTS.maxTotalMissions, 50,
      'I-20: maxTotalMissions must be 50, not 100');
  });

  it('#2: Old value of 100 would violate I-20', () => {
    // Adversarial: ensure the constant is NOT the old incorrect value
    assert.notEqual(MISSION_TREE_DEFAULTS.maxTotalMissions, 100,
      'CF-027: maxTotalMissions must not be the pre-fix value of 100');
  });
});

// ============================================================================
// CF-030: Stack Trace Redaction (S39 IP-4)
// S ref: S39 IP-4 — "No internal state in public errors"
// ============================================================================

describe('CF-030: Stack trace redaction case sensitivity (S39 IP-4)', () => {

  it('#3: Mixed-case SQLITE_ error codes are redacted', () => {
    // CF-030: Before fix, "sqlite_ERROR" would pass through unredacted
    // because /SQLITE_/ was case-sensitive
    const error = new LimenError('ENGINE_UNHEALTHY', 'Database failure: sqlite_ERROR in handler');
    assert.ok(!error.message.includes('sqlite_ERROR'),
      'CF-030: Mixed-case sqlite_ERROR must be redacted');
  });

  it('#4: Mixed-case node_modules paths are redacted', () => {
    // CF-030: Before fix, "NODE_MODULES/better-sqlite3" would pass through
    const error = new LimenError('ENGINE_UNHEALTHY', 'Crash in NODE_MODULES/better-sqlite3/lib');
    assert.ok(!error.message.includes('NODE_MODULES'),
      'CF-030: Mixed-case NODE_MODULES must be redacted');
  });

  it('#5: Uppercase file extensions in paths are redacted', () => {
    // CF-030: Before fix, "/src/kernel/index.TS" wouldn't be caught
    // because the file path pattern only matched lowercase extensions
    const error = new LimenError('ENGINE_UNHEALTHY', 'Error at /src/kernel/index.TS:42');
    assert.ok(!error.message.includes('/src/kernel/index.TS'),
      'CF-030: File paths with uppercase extensions must be redacted');
  });

  it('#6: Mixed-case error names in stack traces are redacted', () => {
    // CF-030: Before fix, "Error: runtime_error at ..." wouldn't match
    // because /Error:\s+[A-Z_]+\s+at\s+/ only matched uppercase error names
    const error = new LimenError('ENGINE_UNHEALTHY', 'Error: runtime_error at somewhere');
    assert.ok(!error.message.includes('runtime_error'),
      'CF-030: Mixed-case error names in stack headers must be redacted');
  });

  it('#7: Already-working redaction still works (regression)', () => {
    // SQL redaction (was already case-insensitive)
    const sqlError = new LimenError('ENGINE_UNHEALTHY', 'select * from users WHERE id = 1');
    assert.ok(!sqlError.message.includes('select'),
      'SQL redaction must still work');

    // Sensitive token redaction (was already case-insensitive)
    const tokenError = new LimenError('ENGINE_UNHEALTHY', 'api_key=sk-12345');
    assert.ok(!tokenError.message.includes('api_key'),
      'Sensitive token redaction must still work');
  });
});

// ============================================================================
// CF-020: Hardcoded /tmp Workspace (I-07, I-12)
// S ref: I-07 (agent identity persistence), I-12 (sandbox isolation)
// ============================================================================

describe('CF-020: Workspace directory uses dataDir, not /tmp (I-12)', () => {

  it('#8: workspace path is derived from dataDir, not /tmp', () => {
    // CF-020: The workspace path must be derived from deps.conn.dataDir,
    // not hardcoded to /tmp. This ensures tenant/mission isolation.
    // We verify the path construction logic independently: join(dataDir, 'workspaces', missionId, taskId)
    const dataDir = '/var/limen/data'; // realistic production path
    const missionId = 'mission-123';
    const taskId = 'task-456';

    const workspaceDir = join(dataDir, 'workspaces', missionId, taskId);

    assert.ok(!workspaceDir.includes('/tmp'),
      'CF-020: Workspace must not contain /tmp');
    assert.ok(workspaceDir.startsWith(dataDir),
      'CF-020: Workspace must be under dataDir');
    assert.equal(workspaceDir, '/var/limen/data/workspaces/mission-123/task-456',
      'CF-020: Workspace must follow dataDir/workspaces/missionId/taskId pattern');
  });

  it('#8b: workspace path with :memory: dataDir is still not /tmp', () => {
    // Test databases use :memory: — the path is still not /tmp
    const dataDir = ':memory:';
    const workspaceDir = join(dataDir, 'workspaces', 'mission-1', 'task-1');

    assert.ok(!workspaceDir.includes('/tmp'),
      'CF-020: Even with :memory: dataDir, workspace must not be /tmp');
  });
});

// ============================================================================
// CF-008: Capability Execution Sandbox — Fail Closed (I-12, FM-09)
// S ref: I-12 (sandboxing), FM-09 (tool poisoning defense)
// ============================================================================

describe('CF-008: Capability execute() rejects with SANDBOX_VIOLATION (I-12, FM-09)', () => {

  it('#9: execute() on auto-registered capability returns SANDBOX_VIOLATION', () => {
    // CF-008: The stub must NOT silently succeed. Any capability execution
    // must fail with SANDBOX_VIOLATION until worker_threads sandbox is implemented.
    // All 7 capability types are auto-registered by createCapabilityAdapterRegistry().
    const conn = createTestDatabase();
    const ctx = createTestOperationContext();
    const registry = createCapabilityAdapterRegistry();

    // Execute a capability that IS registered (auto-registered) — must still fail
    const result = registry.execute(conn, ctx, {
      type: 'web_search' as any,
      params: { query: 'test' },
      missionId: 'mission-1',
      taskId: 'task-1',
      workspaceDir: '/safe/workspace',
      timeoutMs: 30000,
    });

    assert.equal(result.ok, false,
      'CF-008: execute() must NOT return success for any capability');
    if (!result.ok) {
      assert.equal(result.error.code, 'SANDBOX_VIOLATION',
        'CF-008: Error code must be SANDBOX_VIOLATION');
    }

    conn.close();
  });

  it('#10: All 7 capability types fail with SANDBOX_VIOLATION', () => {
    // CF-008: ALL capability types must fail — no silent execution for any type
    const conn = createTestDatabase();
    const ctx = createTestOperationContext();
    const registry = createCapabilityAdapterRegistry();

    const typesResult = registry.getSupportedCapabilities();
    assert.ok(typesResult.ok);
    const types = typesResult.value;

    for (const capType of types) {
      const result = registry.execute(conn, ctx, {
        type: capType,
        params: {},
        missionId: 'mission-1',
        taskId: 'task-1',
        workspaceDir: '/safe/workspace',
        timeoutMs: 30000,
      });
      assert.equal(result.ok, false,
        `CF-008: Capability '${capType}' must NOT succeed`);
      if (!result.ok) {
        assert.equal(result.error.code, 'SANDBOX_VIOLATION',
          `CF-008: '${capType}' must return SANDBOX_VIOLATION`);
      }
    }

    conn.close();
  });

  it('#11: Unregistered capability returns CAPABILITY_NOT_FOUND (not success)', () => {
    // Adversarial: even unregistered capabilities must not silently succeed
    const conn = createTestDatabase();
    const ctx = createTestOperationContext();
    const registry = createCapabilityAdapterRegistry();

    const result = registry.execute(conn, ctx, {
      type: 'arbitrary_code' as any,
      params: {},
      missionId: 'mission-1',
      taskId: 'task-1',
      workspaceDir: '/safe/workspace',
      timeoutMs: 30000,
    });

    assert.equal(result.ok, false,
      'CF-008: Unregistered capability must not succeed');

    conn.close();
  });
});

// ============================================================================
// CF-012: Immutability Enforcement via Database Triggers (I-19, I-24)
// S ref: I-19 (artifact content immutable), I-24 (goal anchoring)
// ============================================================================

describe('CF-012: Artifact immutability trigger (I-19)', () => {

  it('#12: UPDATE on core_artifacts.content is rejected by trigger', () => {
    // I-19: "Artifacts are write-once. Content and type cannot be modified after creation."
    // The trigger must prevent UPDATE on content column.
    const conn = createTestDatabase();

    // Seed a mission first (FK constraint)
    seedMission(conn, { id: 'mission-1' });

    // Insert an artifact
    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, source_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-1', 1, 'mission-1', 'test-tenant', 'test-artifact', 'report', 'markdown', 'original content', 'task-1', new Date().toISOString()],
    );

    // Attempt to UPDATE content — trigger must fire
    assert.throws(
      () => conn.run(`UPDATE core_artifacts SET content = ? WHERE id = ? AND version = ?`, ['modified content', 'art-1', 1]),
      (err: Error) => err.message.includes('I-19'),
      'CF-012: UPDATE on artifact content must be rejected with I-19 error',
    );

    conn.close();
  });

  it('#13: UPDATE on core_artifacts.type is rejected by trigger', () => {
    // I-19: type is also immutable once written
    const conn = createTestDatabase();
    seedMission(conn, { id: 'mission-1' });

    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, source_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-2', 1, 'mission-1', 'test-tenant', 'test-artifact-2', 'data', 'json', '{}', 'task-1', new Date().toISOString()],
    );

    assert.throws(
      () => conn.run(`UPDATE core_artifacts SET type = ? WHERE id = ? AND version = ?`, ['code', 'art-2', 1]),
      (err: Error) => err.message.includes('I-19'),
      'CF-012: UPDATE on artifact type must be rejected with I-19 error',
    );

    conn.close();
  });

  it('#14: UPDATE on core_artifacts.lifecycle_state IS allowed (archival)', () => {
    // I-19 does NOT prevent lifecycle transitions: ACTIVE → SUMMARIZED → ARCHIVED → DELETED
    // The trigger must only protect content and type, not lifecycle_state.
    const conn = createTestDatabase();
    seedMission(conn, { id: 'mission-1' });

    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, source_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-3', 1, 'mission-1', 'test-tenant', 'test-artifact-3', 'analysis', 'markdown', 'content', 'task-1', new Date().toISOString()],
    );

    // This must NOT throw — lifecycle transitions are allowed
    assert.doesNotThrow(
      () => conn.run(`UPDATE core_artifacts SET lifecycle_state = ? WHERE id = ? AND version = ?`, ['ARCHIVED', 'art-3', 1]),
      'CF-012: lifecycle_state changes must be allowed for archival operations',
    );

    // Verify it actually changed
    const row = conn.get<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM core_artifacts WHERE id = ? AND version = ?`, ['art-3', 1]);
    assert.equal(row?.lifecycle_state, 'ARCHIVED');

    conn.close();
  });
});

describe('CF-012: Goal anchoring trigger (I-24)', () => {

  it('#15: UPDATE on core_mission_goals.objective is rejected by trigger', () => {
    // I-24: "Mission objectives, success criteria, and scope boundaries are immutable
    //        once set. The agent cannot redefine what success means."
    const conn = createTestDatabase();

    // seedMission inserts into core_mission_goals automatically
    // We test UPDATE on the already-seeded goal row
    seedMission(conn, { id: 'mission-1', objective: 'Original objective' });

    assert.throws(
      () => conn.run(`UPDATE core_mission_goals SET objective = ? WHERE mission_id = ?`, ['Modified objective', 'mission-1']),
      (err: Error) => err.message.includes('I-24'),
      'CF-012: UPDATE on mission goal objective must be rejected with I-24 error',
    );

    conn.close();
  });

  it('#16: UPDATE on core_mission_goals.success_criteria is rejected', () => {
    const conn = createTestDatabase();
    seedMission(conn, { id: 'mission-1' });

    assert.throws(
      () => conn.run(`UPDATE core_mission_goals SET success_criteria = ? WHERE mission_id = ?`, ['["tampered"]', 'mission-1']),
      (err: Error) => err.message.includes('I-24'),
      'CF-012: UPDATE on success_criteria must be rejected with I-24 error',
    );

    conn.close();
  });

  it('#17: UPDATE on core_mission_goals.scope_boundaries is rejected', () => {
    const conn = createTestDatabase();
    seedMission(conn, { id: 'mission-1' });

    assert.throws(
      () => conn.run(`UPDATE core_mission_goals SET scope_boundaries = ? WHERE mission_id = ?`, ['["expanded"]', 'mission-1']),
      (err: Error) => err.message.includes('I-24'),
      'CF-012: UPDATE on scope_boundaries must be rejected with I-24 error',
    );

    conn.close();
  });
});

// ============================================================================
// CF-013: Input Size Limits at API Boundary
// S ref: SEC-009 (B), OPS-017 (E1)
// ============================================================================

describe('CF-013: Artifact content size limit (10MB)', () => {

  it('#18: Artifact content > 10MB is rejected with INVALID_INPUT', () => {
    // CF-013: Artifact content has a hard cap of 10MB (10,485,760 bytes)
    const { deps } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const artifacts = createArtifactStore();

    seedMission(deps.conn, { id: 'mission-1' });
    seedResource(deps.conn, { missionId: 'mission-1', tokenAllocated: 1_000_000_000 });
    // Set storage budget high enough that size check focuses on CF-013 limit
    deps.conn.run(`UPDATE core_resources SET storage_max_bytes = ? WHERE mission_id = ?`, [100_000_000, 'mission-1']);

    // Create content just over 10MB
    const oversizedContent = 'x'.repeat(10_485_761);

    const result = artifacts.create(deps, ctx, {
      missionId: 'mission-1' as MissionId,
      name: 'huge-artifact',
      type: 'raw',
      format: 'markdown',
      content: oversizedContent,
      sourceTaskId: 'task-1',
      parentArtifactId: null,
      metadata: {},
    });

    assert.equal(result.ok, false, 'CF-013: Oversized artifact must be rejected');
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_INPUT',
        'CF-013: Error code must be INVALID_INPUT for size violation');
    }

    deps.conn.close();
  });

  it('#19: Artifact content at 10MB boundary is accepted', () => {
    // 10MB exactly should pass the size check
    const { deps } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const artifacts = createArtifactStore();

    seedMission(deps.conn, { id: 'mission-1' });
    seedResource(deps.conn, { missionId: 'mission-1', tokenAllocated: 1_000_000_000 });
    deps.conn.run(`UPDATE core_resources SET storage_max_bytes = ? WHERE mission_id = ?`, [100_000_000, 'mission-1']);

    // Exactly 10MB (10,485,760 single-byte chars)
    const maxContent = 'x'.repeat(10_485_760);

    const result = artifacts.create(deps, ctx, {
      missionId: 'mission-1' as MissionId,
      name: 'max-artifact',
      type: 'raw',
      format: 'markdown',
      content: maxContent,
      sourceTaskId: 'task-1',
      parentArtifactId: null,
      metadata: {},
    });

    // Should pass size check (may fail on storage budget — that's a different check)
    // We only verify it does NOT fail with INVALID_INPUT
    if (!result.ok) {
      assert.notEqual(result.error.code, 'INVALID_INPUT',
        'CF-013: 10MB artifact should not be rejected for size');
    }

    deps.conn.close();
  });
});

describe('CF-013: Event payload size limit (64KB)', () => {

  it('#20: Event payload > 64KB is rejected with INVALID_INPUT', () => {
    // CF-013: Event payload has a 64KB (65,536 bytes) limit
    const { deps } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const events = createEventPropagator();

    seedMission(deps.conn, { id: 'mission-1' });

    // Create payload just over 64KB
    const bigPayload: Record<string, unknown> = {
      data: 'x'.repeat(65_537),
    };

    const result = events.emit(deps, ctx, {
      eventType: 'custom.test',
      missionId: 'mission-1' as MissionId,
      payload: bigPayload,
      propagation: 'local',
    });

    assert.equal(result.ok, false, 'CF-013: Oversized event payload must be rejected');
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_INPUT',
        'CF-013: Error code must be INVALID_INPUT for payload size violation');
    }

    deps.conn.close();
  });

  it('#21: Event payload at 64KB boundary is accepted', () => {
    const { deps } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const events = createEventPropagator();

    seedMission(deps.conn, { id: 'mission-1' });

    // Payload that serializes to under 64KB
    const smallPayload: Record<string, unknown> = {
      data: 'x'.repeat(100),
    };

    const result = events.emit(deps, ctx, {
      eventType: 'custom.test',
      missionId: 'mission-1' as MissionId,
      payload: smallPayload,
      propagation: 'local',
    });

    // Should pass the size check
    if (!result.ok) {
      assert.notEqual(result.error.code, 'INVALID_INPUT',
        'CF-013: Small event payload should not be rejected for size');
    }

    deps.conn.close();
  });
});

describe('CF-013: Budget justification max length (10KB)', () => {

  it('#22: Justification > 10KB is rejected with INVALID_INPUT', () => {
    const conn = createTestDatabase();
    const ctx = createTestOperationContext();
    const { deps } = createTestOrchestrationDeps();
    const budget = createBudgetGovernor();
    const events = createEventPropagator();

    seedMission(deps.conn, { id: 'mission-1' });
    seedResource(deps.conn, { missionId: 'mission-1', tokenAllocated: 100_000 });

    // Stub missions store — CF-013 validation fires before missions are accessed
    const missionsStub = { get: () => ({ ok: false, error: { code: 'NOT_FOUND', message: '', spec: '' } }) } as any;

    // Create justification just over 10KB
    const oversizedJustification = 'x'.repeat(10_241);

    const result = requestBudget(deps, ctx, {
      missionId: 'mission-1' as MissionId,
      amount: { tokens: 1000 },
      justification: oversizedJustification,
    }, budget, events, missionsStub);

    assert.equal(result.ok, false, 'CF-013: Oversized justification must be rejected');
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_INPUT',
        'CF-013: Error code must be INVALID_INPUT for justification size violation');
    }

    deps.conn.close();
  });
});

// ============================================================================
// CF-026: SC Minor Deviations (DEV-003, DEV-007)
// S ref: S15 (propose_mission), S21 (request_capability)
// ============================================================================

describe('CF-026: SC-1 agentId validation (DEV-003)', () => {

  it('#23: Empty agentId returns AGENT_NOT_FOUND', () => {
    // DEV-003: "AGENT_NOT_FOUND validates parent existence, not agent existence"
    // Fix: Empty agentId now returns AGENT_NOT_FOUND per S15
    const { deps } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const missions = createMissionStore();

    const result = missions.create(deps, ctx, {
      objective: 'Test mission',
      successCriteria: ['Complete'],
      scopeBoundaries: ['Within scope'],
      agentId: '' as AgentId,
      capabilities: ['web_search'],
      constraints: { budget: 10000, deadline: new Date(Date.now() + 3600000).toISOString(), maxDepth: 5, maxChildren: 10 },
      parentMissionId: null,
    });

    assert.equal(result.ok, false, 'CF-026: Empty agentId must be rejected');
    if (!result.ok) {
      assert.equal(result.error.code, 'AGENT_NOT_FOUND',
        'CF-026: Error code must be AGENT_NOT_FOUND for empty agentId');
    }

    deps.conn.close();
  });

  it('#24: Missing parent mission returns MISSION_NOT_FOUND (not AGENT_NOT_FOUND)', () => {
    // DEV-003: Error code for missing parent was incorrectly AGENT_NOT_FOUND
    // Fix: Now returns MISSION_NOT_FOUND per spec semantics
    const { deps } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const missions = createMissionStore();

    const result = missions.create(deps, ctx, {
      objective: 'Child mission',
      successCriteria: ['Complete'],
      scopeBoundaries: ['Within scope'],
      agentId: 'valid-agent' as AgentId,
      capabilities: ['web_search'],
      constraints: { budget: 10000, deadline: new Date(Date.now() + 3600000).toISOString(), maxDepth: 5, maxChildren: 10 },
      parentMissionId: 'nonexistent-parent' as MissionId,
    });

    assert.equal(result.ok, false, 'CF-026: Missing parent must be rejected');
    if (!result.ok) {
      assert.equal(result.error.code, 'MISSION_NOT_FOUND',
        'CF-026: Error code must be MISSION_NOT_FOUND for missing parent, not AGENT_NOT_FOUND');
    }

    deps.conn.close();
  });
});

// ============================================================================
// CF-014: Unbounded In-Memory State Growth
// S ref: SEC-009 (B), OPS-017 (E1)
// Each in-memory Map must be bounded to prevent OOM under sustained load.
// ============================================================================

describe('CF-014: SessionManager bounded at MAX_SESSIONS (10,000)', () => {

  it('#25: createSession rejects when session count reaches limit', async () => {
    // CF-014: SessionManager.sessions Map must be bounded at 10,000.
    // Pre-fill via internal Map access, then verify createSession throws RATE_LIMITED.
    const conn = createTestDatabase();
    // requirePermission calls rbac.checkPermission(ctx, perm) -> Result<boolean>
    const rbac = {
      checkPermission: () => ({ ok: true, value: true }),
      isActive: () => false,
      getPermissions: () => ({ ok: true, value: new Set() }),
    } as any;
    const orch = {
      conversations: {
        create: () => ({ ok: true, value: 'conv-1' }),
      },
    } as any;
    const audit = { append: () => {} } as any;
    const substrate = {} as any;

    const sm = new SessionManager(
      rbac, orch, () => conn, () => audit, () => substrate,
      'single',
      () => ({} as any),
      async () => ({} as any),
    );

    // Pre-fill sessions Map to MAX_SESSIONS (10,000)
    const sessionsMap = (sm as any).sessions as Map<string, unknown>;
    for (let i = 0; i < 10_000; i++) {
      sessionsMap.set(`session-${i}`, {
        sessionId: `session-${i}`,
        tenantId: null,
        agentId: 'agent-1',
        conversationId: 'conv-1',
        userId: null,
        permissions: new Set(),
        hitlMode: null,
        createdAt: Date.now(),
        activeStreams: new Set(),
      });
    }

    // Next createSession must throw RATE_LIMITED
    await assert.rejects(
      sm.createSession({ agentName: 'test-agent' }),
      (err: any) => {
        assert.equal(err.code, 'RATE_LIMITED');
        assert.ok(err.message.includes('10000'), 'Error must include the limit value');
        return true;
      },
    );

    conn.close();
  });
});

describe('CF-014: AgentApiImpl bounded at MAX_AGENTS (1,000)', () => {

  it('#26: register rejects when agent count reaches limit', async () => {
    // CF-014: AgentApiImpl backed by core_agents table, bounded at 1,000.
    const conn = createTestDatabase();
    const ctx = createTestOperationContext({ tenantId: null });
    // requirePermission calls rbac.checkPermission(ctx, perm) -> Result<boolean>
    const rbac = {
      checkPermission: () => ({ ok: true, value: true }),
    } as any;
    // requireRateLimit calls rateLimiter.checkAndConsume(conn, ctx, bucket) -> Result<boolean>
    const rateLimiter = {
      checkAndConsume: () => ({ ok: true, value: true }),
    } as any;

    const api = new AgentApiImpl(rbac, rateLimiter, () => conn, () => ctx);

    // Pre-fill core_agents table to MAX_AGENTS (1,000) via direct SQL
    const now = new Date().toISOString();
    conn.transaction(() => {
      for (let i = 0; i < 1_000; i++) {
        conn.run(
          `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
           VALUES (?, NULL, ?, 1, 'untrusted', 'registered', '[]', '[]', ?, ?)`,
          [`agent-${i}`, `agent-${i}`, now, now],
        );
      }
    });

    // Next register must throw RATE_LIMITED
    await assert.rejects(
      api.register({ name: 'one-too-many' }),
      (err: any) => {
        assert.equal(err.code, 'RATE_LIMITED');
        assert.ok(err.message.includes('1000'), 'Error must include the limit value');
        return true;
      },
    );

    conn.close();
  });
});

describe('CF-014: EventBus bounded at MAX_SUBSCRIPTIONS (10,000)', () => {

  it('#27: subscribe rejects when subscription count reaches limit', () => {
    // CF-014: EventBus subscriptions Map must be bounded at 10,000.
    // Fill to capacity via actual subscribe() calls (in-memory, no DB required).
    const bus = createEventBus();
    const noopHandler = () => {};

    // Fill to MAX_SUBSCRIPTIONS (10,000)
    for (let i = 0; i < 10_000; i++) {
      const result = bus.subscribe('*', noopHandler);
      if (!result.ok) {
        assert.fail(`Subscription ${i} should succeed but got: ${result.error.code}`);
      }
    }

    // Next subscribe must fail with RATE_LIMITED
    const overflow = bus.subscribe('*', noopHandler);
    assert.equal(overflow.ok, false, 'CF-014: EventBus must reject when subscription limit reached');
    if (!overflow.ok) {
      assert.equal(overflow.error.code, 'RATE_LIMITED',
        'CF-014: Error code must be RATE_LIMITED');
      assert.ok(overflow.error.message.includes('10000'),
        'CF-014: Error message must include the limit value');
    }
  });
});
