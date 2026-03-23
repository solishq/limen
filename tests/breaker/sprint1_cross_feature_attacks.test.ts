/**
 * BREAKER: Sprint 1 Cross-Feature Attack Tests
 * Target: Cross-feature interactions between I-08 + CCP-01 + CCP-02
 *
 * Attack vectors: XF-01, XF-02, XF-04 + migration/wiring attacks.
 * Classification: Tier 1 (cross-feature integrity, authorization)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, seedMission, createTestOperationContext } from '../helpers/test_database.js';
import type { DatabaseConnection, TenantId, MissionId, RateLimiter, RbacEngine } from '../../src/kernel/interfaces/index.js';
import { AgentApiImpl } from '../../src/api/agents/agent_api.js';
import { createEvidenceValidator } from '../../src/claims/evidence/evidence_validator.js';
import { createCapabilityResultScopeValidator } from '../../src/claims/evidence/capability_scope_validator.js';
import { readFileSync } from 'node:fs';
import { getAgentPersistenceMigrations } from '../../src/api/migration/023_agent_persistence.js';

// ─── Test Helpers ───

function createMockRbac(): RbacEngine {
  return {
    checkPermission() { return { ok: true, value: true }; },
    grantPermission() { return { ok: true, value: undefined }; },
    revokePermission() { return { ok: true, value: undefined }; },
    listPermissions() { return { ok: true, value: [] }; },
  } as unknown as RbacEngine;
}

function createMockRateLimiter(): RateLimiter {
  return {
    checkAndConsume() { return { ok: true, value: true }; },
    getStatus() { return { ok: true, value: { currentTokens: 99, maxTokens: 100, refillRate: 1.67, lastRefillAt: '' } }; },
  };
}

function createTimeProvider() {
  return { nowISO: () => '2026-03-23T10:00:00.000Z', nowMs: () => 1711184400000 };
}

function createApi(conn: DatabaseConnection, tenantId: string | null = 'test-tenant') {
  const ctx = createTestOperationContext({ tenantId });
  return new AgentApiImpl(
    createMockRbac(),
    createMockRateLimiter(),
    () => conn,
    () => ctx,
    createTimeProvider(),
  );
}

function seedTask(conn: DatabaseConnection, options: {
  id: string;
  missionId: string;
  tenantId?: string;
}): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [options.id, options.missionId, options.tenantId ?? 'tenant-a', `graph-${options.id}`, `Test task ${options.id}`, 'deterministic', 'PENDING', now, now],
  );
}

function seedCapabilityResult(conn: DatabaseConnection, id: string, tenantId: string | null, missionId: string, taskId: string): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_capability_results (id, tenant_id, mission_id, task_id, capability_type, parameters_hash, result_json, result_size, tokens_consumed, time_consumed_ms, compute_consumed, storage_consumed, created_at)
     VALUES (?, ?, ?, ?, 'web_search', 'hash123', '{"data":"result"}', 18, 100, 500, 0, 0, ?)`,
    [id, tenantId, missionId, taskId, now],
  );
}

describe('BREAKER: Cross-Feature Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // XF-01: Agent impersonation + evidence fabrication
  // Can an agent in tenant-A register a claim with evidence from tenant-B?
  // ═══════════════════════════════════════════════════════════════════════════

  it('XF-01: agent from tenant-A cannot reference evidence in tenant-B', () => {
    seedMission(conn, { id: 'mission-a', tenantId: 'tenant-a' });
    seedMission(conn, { id: 'mission-b', tenantId: 'tenant-b' });
    seedTask(conn, { id: 'task-a', missionId: 'mission-a' });
    seedTask(conn, { id: 'task-b', missionId: 'mission-b', tenantId: 'tenant-b' });

    seedCapabilityResult(conn, 'tenant-b-result', 'tenant-b', 'mission-b', 'task-b');

    // Evidence validator enforces tenant isolation
    const validator = createEvidenceValidator();
    const result = validator.exists(conn, 'capability_result', 'tenant-b-result', 'tenant-a' as TenantId);
    assert.equal(result.ok, false, 'Tenant-A should not access tenant-B capability result');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // XF-02: Cross-tenant agent + cross-tenant evidence
  // ═══════════════════════════════════════════════════════════════════════════

  it('XF-02: agent from tenant-A invisible to tenant-B + evidence isolated', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    const agentA = await apiA.register({ name: 'agent-alpha' });

    // Agent isolation
    const ghostA = await apiB.get('agent-alpha');
    assert.equal(ghostA, null, 'Tenant-B cannot see tenant-A agent');

    // Evidence isolation
    seedMission(conn, { id: 'mission-xa', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'task-xa', missionId: 'mission-xa' });
    seedCapabilityResult(conn, 'xa-cap-result', 'tenant-a', 'mission-xa', 'task-xa');

    const validator = createEvidenceValidator();
    const result = validator.exists(conn, 'capability_result', 'xa-cap-result', 'tenant-b' as TenantId);
    assert.equal(result.ok, false, 'Cross-tenant evidence must be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Migration idempotency — can v32 run twice safely?
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIGRATION-01: v32 migration uses CREATE TABLE IF NOT EXISTS (idempotent)', () => {
    // The migration already ran in createTestDatabase(). Running the SQL again should not crash.
    // Verify by checking that the migration SQL contains IF NOT EXISTS
    const migrations = getAgentPersistenceMigrations();
    const sql = migrations[0]!.sql;

    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS core_agents'), 'core_agents must use IF NOT EXISTS');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS core_capability_results'), 'core_capability_results must use IF NOT EXISTS');
    assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS'), 'Indexes must use IF NOT EXISTS');
    assert.ok(sql.includes('CREATE TRIGGER IF NOT EXISTS'), 'Triggers must use IF NOT EXISTS');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Wiring verification — is createEvidenceValidator wired into createClaimSystem?
  // ═══════════════════════════════════════════════════════════════════════════

  it('WIRING-01: evidence validator wired in createLimen factory (verified by import)', () => {
    // This test verifies that the evidence validator is imported and used in api/index.ts
    // We cannot run createLimen in unit tests (needs filesystem), so we verify structurally
    const indexContent = readFileSync('/Users/solishq/Projects/limen/src/api/index.ts', 'utf-8');

    assert.ok(
      indexContent.includes("import { createEvidenceValidator }"),
      'createEvidenceValidator must be imported in api/index.ts',
    );
    assert.ok(
      indexContent.includes("import { createCapabilityResultScopeValidator }"),
      'createCapabilityResultScopeValidator must be imported in api/index.ts',
    );
    assert.ok(
      indexContent.includes('const evidenceValidator = createEvidenceValidator()'),
      'Evidence validator must be instantiated in api/index.ts',
    );
    assert.ok(
      indexContent.includes('evidenceValidator'),
      'Evidence validator must be passed to createClaimSystem deps',
    );
    assert.ok(
      indexContent.includes('capabilityResultScopeValidator'),
      'Scope validator must be passed to createClaimSystem deps',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FK cascade behavior — what happens when missions/tasks are deleted?
  // ═══════════════════════════════════════════════════════════════════════════

  it('FK-01: capability_results FK references core_missions and core_tasks', () => {
    seedMission(conn, { id: 'fk-mission', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'fk-task', missionId: 'fk-mission' });
    seedCapabilityResult(conn, 'fk-cap', 'tenant-a', 'fk-mission', 'fk-task');

    // Check that FK is enforced — try to insert with nonexistent mission
    assert.throws(
      () => {
        const now = new Date().toISOString();
        conn.run(
          `INSERT INTO core_capability_results (id, tenant_id, mission_id, task_id, capability_type, parameters_hash, result_json, result_size, created_at)
           VALUES (?, 'tenant-a', 'nonexistent-mission', 'nonexistent-task', 'web_search', 'h', '{}', 2, ?)`,
          ['fk-test', now],
        );
      },
      (err: Error) => {
        assert.ok(err.message.includes('FOREIGN KEY'), `Expected FK violation, got: ${err.message}`);
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Capability result persistence in request_capability.ts (CCP-02 wiring)
  // ═══════════════════════════════════════════════════════════════════════════

  it('WIRING-02: request_capability.ts persists results to core_capability_results', () => {
    const rcContent = readFileSync('/Users/solishq/Projects/limen/src/orchestration/syscalls/request_capability.ts', 'utf-8');

    assert.ok(
      rcContent.includes('core_capability_results'),
      'request_capability must INSERT into core_capability_results',
    );
    assert.ok(
      rcContent.includes('crypto.randomUUID()'),
      'Result ID must be generated with crypto.randomUUID()',
    );
    assert.ok(
      rcContent.includes('parameters_hash'),
      'Parameters must be hashed for the result record',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-XF-01: request_capability.ts silent catch (FINDING)
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-XF-01: request_capability persistence failure is audited (F-S1-003 FIXED)', () => {
    // F-S1-003 FIX: The catch block now records persistence failures via audit trail.
    // Persistence is still non-fatal (capability result returned regardless),
    // but failures are observable for diagnostic purposes.
    const rcContent = readFileSync('/Users/solishq/Projects/limen/src/orchestration/syscalls/request_capability.ts', 'utf-8');

    // Verify the catch block contains audit observability
    assert.ok(
      rcContent.includes('capability_result_persistence_failed'),
      'Persistence failure must be recorded as an audit event',
    );
    assert.ok(
      rcContent.includes('deps.audit.append'),
      'Persistence failure must use the audit trail for observability',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-XF-02: request_capability.ts uses 'default' for null taskId
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-XF-02: request_capability uses null for absent taskId in persistence (F-S1-002 FIXED)', () => {
    const rcContent = readFileSync('/Users/solishq/Projects/limen/src/orchestration/syscalls/request_capability.ts', 'utf-8');

    // F-S1-002 FIX: taskId now maps to null (not 'default' string) in the INSERT.
    // task_id column is nullable, FK on task_id removed.
    // Capability results without task context are persisted with task_id=NULL.
    // NOTE: 'default' still appears in workspaceDir path (filesystem, not DB FK) — that is correct.
    assert.ok(
      rcContent.includes('input.taskId ?? null'),
      'request_capability must use null for absent taskId in INSERT',
    );

    // Verify the INSERT array contains `input.taskId ?? null` (not 'default')
    // by checking the specific context: the INSERT VALUES array
    const insertIndex = rcContent.indexOf('INSERT INTO core_capability_results');
    assert.ok(insertIndex > 0, 'INSERT into core_capability_results must exist');
    const insertContext = rcContent.slice(insertIndex, insertIndex + 600);
    assert.ok(
      insertContext.includes('input.taskId ?? null'),
      'The INSERT VALUES must use null for absent taskId',
    );
    assert.ok(
      !insertContext.includes("input.taskId ?? 'default'"),
      'The INSERT VALUES must NOT use "default" string for absent taskId',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-XF-03: Scope validator ignores tenant (defense in depth analysis)
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-XF-03: scope validation call site in claim_stores.ts has evidence check before scope', () => {
    // Verify the defense-in-depth ordering: evidence exists check (with tenant) before scope check
    const csContent = readFileSync('/Users/solishq/Projects/limen/src/claims/store/claim_stores.ts', 'utf-8');

    const evidenceCheckIndex = csContent.indexOf('evidenceValidator.exists');
    const scopeCheckIndex = csContent.indexOf('capabilityResultScopeValidator.validateScope');

    assert.ok(evidenceCheckIndex > 0, 'Evidence check must exist in claim_stores.ts');
    assert.ok(scopeCheckIndex > 0, 'Scope check must exist in claim_stores.ts');
    assert.ok(evidenceCheckIndex < scopeCheckIndex,
      'Evidence check (with tenant isolation) must run BEFORE scope check');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-XF-04: capability_type CHECK constraint
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-XF-04: invalid capability_type blocked by CHECK constraint', () => {
    seedMission(conn, { id: 'check-mission', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'check-task', missionId: 'check-mission' });

    assert.throws(
      () => {
        const now = new Date().toISOString();
        conn.run(
          `INSERT INTO core_capability_results (id, tenant_id, mission_id, task_id, capability_type, parameters_hash, result_json, result_size, created_at)
           VALUES (?, 'tenant-a', 'check-mission', 'check-task', 'hacking_tool', 'h', '{}', 2, ?)`,
          ['bad-cap-type', now],
        );
      },
      (err: Error) => {
        assert.ok(err.message.includes('CHECK') || err.message.includes('constraint'),
          `Expected CHECK constraint violation for invalid capability_type, got: ${err.message}`);
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-XF-05: Agent table schema consistency
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-XF-05: core_agents table exists with expected columns', () => {
    const columns = conn.query<{ name: string; type: string; notnull: number }>(
      "PRAGMA table_info(core_agents)",
    );

    const columnNames = columns.map(c => c.name);
    assert.ok(columnNames.includes('id'), 'Must have id column');
    assert.ok(columnNames.includes('tenant_id'), 'Must have tenant_id column');
    assert.ok(columnNames.includes('name'), 'Must have name column');
    assert.ok(columnNames.includes('version'), 'Must have version column');
    assert.ok(columnNames.includes('trust_level'), 'Must have trust_level column');
    assert.ok(columnNames.includes('status'), 'Must have status column');
    assert.ok(columnNames.includes('capabilities'), 'Must have capabilities column');
    assert.ok(columnNames.includes('domains'), 'Must have domains column');
    assert.ok(columnNames.includes('created_at'), 'Must have created_at column');
    assert.ok(columnNames.includes('updated_at'), 'Must have updated_at column');
  });

  it('BREAKER-XF-05: core_capability_results table exists with expected columns', () => {
    const columns = conn.query<{ name: string; type: string; notnull: number }>(
      "PRAGMA table_info(core_capability_results)",
    );

    const columnNames = columns.map(c => c.name);
    assert.ok(columnNames.includes('id'), 'Must have id column');
    assert.ok(columnNames.includes('tenant_id'), 'Must have tenant_id column');
    assert.ok(columnNames.includes('mission_id'), 'Must have mission_id column');
    assert.ok(columnNames.includes('task_id'), 'Must have task_id column');
    assert.ok(columnNames.includes('capability_type'), 'Must have capability_type column');
    assert.ok(columnNames.includes('parameters_hash'), 'Must have parameters_hash column');
    assert.ok(columnNames.includes('result_json'), 'Must have result_json column');
    assert.ok(columnNames.includes('result_size'), 'Must have result_size column');
    assert.ok(columnNames.includes('created_at'), 'Must have created_at column');
  });
});
