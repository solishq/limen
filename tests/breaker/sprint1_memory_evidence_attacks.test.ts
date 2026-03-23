/**
 * BREAKER: Sprint 1 Memory Evidence Attack Tests
 * Target: CCP-01 Memory Evidence (evidence_validator.ts)
 *
 * Attack vectors: ME-01 through ME-08 + additional Breaker-discovered vectors.
 * Classification: Tier 1 (data integrity, authorization, tenant isolation)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, seedMission, createTestOperationContext, createTestAuditTrail } from '../helpers/test_database.js';
import type { DatabaseConnection, TenantId, MissionId, TaskId } from '../../src/kernel/interfaces/index.js';
import { createEvidenceValidator } from '../../src/claims/evidence/evidence_validator.js';
import { createCapabilityResultScopeValidator } from '../../src/claims/evidence/capability_scope_validator.js';

// ─── Seed Helpers ───

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

function seedWmEntry(conn: DatabaseConnection, taskId: string, key: string, value: string): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO working_memory_entries (task_id, key, value, size_bytes, mutation_position, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [taskId, key, value, Buffer.byteLength(value), now, now],
  );
}

function seedArtifact(conn: DatabaseConnection, id: string, tenantId: string | null): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, source_task_id, created_at)
     VALUES (?, 1, 'mission-1', ?, 'test-artifact', 'report', 'json', '{}', 'task-1', ?)`,
    [id, tenantId, now],
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

describe('BREAKER: Memory Evidence Attacks', () => {
  let conn: DatabaseConnection;
  const validator = createEvidenceValidator();

  beforeEach(() => {
    conn = createTestDatabase();
    seedMission(conn, { id: 'mission-1', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'task-1', missionId: 'mission-1' });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ME-01: Fabrication — claim with fake WM entry key
  // ═══════════════════════════════════════════════════════════════════════════

  it('ME-01: fabricated WM key rejected', () => {
    const result = validator.exists(conn, 'memory', 'nonexistent.fabricated.key', 'tenant-a' as TenantId, 'task-1');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
  });

  it('ME-01: SQL injection in evidence key does not crash', () => {
    const result = validator.exists(conn, 'memory', "'; DROP TABLE working_memory_entries; --", 'tenant-a' as TenantId, 'task-1');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');

    // Verify table still exists
    const check = conn.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='working_memory_entries'");
    assert.ok(check, 'working_memory_entries table must still exist after SQL injection attempt');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ME-02: Cross-task reference — claim referencing other task's WM
  // ═══════════════════════════════════════════════════════════════════════════

  it('ME-02: WM entry from different task rejected', () => {
    seedTask(conn, { id: 'task-2', missionId: 'mission-1' });
    seedWmEntry(conn, 'task-2', 'secret-findings', '{"secret":"data"}');

    // Try to reference task-2's WM entry from task-1 context
    const result = validator.exists(conn, 'memory', 'secret-findings', 'tenant-a' as TenantId, 'task-1');
    assert.equal(result.ok, false, 'WM entry from different task must be rejected');
    if (!result.ok) assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ME-03: Cross-tenant memory leakage
  // ═══════════════════════════════════════════════════════════════════════════

  it('ME-03: cross-tenant memory entry rejected via 3-table JOIN', () => {
    seedWmEntry(conn, 'task-1', 'tenant-a-secret', '{"classified":"data"}');

    // Query with tenant-b should not find tenant-a's WM entries
    const result = validator.exists(conn, 'memory', 'tenant-a-secret', 'tenant-b' as TenantId, 'task-1');
    assert.equal(result.ok, false, 'Cross-tenant memory access must be rejected');
  });

  it('ME-03: null tenant WM entry isolated from non-null tenant', () => {
    // Create a mission with null tenant directly
    const now = new Date().toISOString();
    conn.run(
      `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
       VALUES (?, NULL, NULL, 'test-agent', 'null tenant mission', '[]', '[]', 'CREATED', 0, '["web_search"]', '[]', '{}', 0, ?, ?)`,
      ['null-mission', now, now],
    );
    conn.run(
      `INSERT INTO core_mission_goals (mission_id, objective, success_criteria, scope_boundaries, created_at)
       VALUES (?, 'null tenant mission', '[]', '[]', ?)`,
      ['null-mission', now],
    );
    conn.run(
      `INSERT INTO core_tree_counts (root_mission_id, total_count, tenant_id) VALUES (?, 1, NULL)`,
      ['null-mission'],
    );
    conn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, state, created_at, updated_at)
       VALUES (?, 'null-mission', NULL, 'graph-null', 'Null tenant task', 'deterministic', 'PENDING', ?, ?)`,
      ['null-task', now, now],
    );
    seedWmEntry(conn, 'null-task', 'null-secret', '{"data":"null-tenant"}');

    // Query with 'tenant-a' should not find null-tenant WM
    const result = validator.exists(conn, 'memory', 'null-secret', 'tenant-a' as TenantId, 'null-task');
    assert.equal(result.ok, false, 'Null-tenant WM must be isolated from named tenants');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ME-04: TOCTOU — entry exists at check, discarded before commit
  // ═══════════════════════════════════════════════════════════════════════════

  it('ME-04: TOCTOU awareness — entry deleted between check and usage', () => {
    seedWmEntry(conn, 'task-1', 'ephemeral', '{"temp":"value"}');

    // Check succeeds
    const checkResult = validator.exists(conn, 'memory', 'ephemeral', 'tenant-a' as TenantId, 'task-1');
    assert.ok(checkResult.ok, 'Check should succeed while entry exists');

    // Entry deleted (simulating WMP discard between check and claim commit)
    conn.run('DELETE FROM working_memory_entries WHERE key = ?', ['ephemeral']);

    // Second check fails
    const recheckResult = validator.exists(conn, 'memory', 'ephemeral', 'tenant-a' as TenantId, 'task-1');
    assert.equal(recheckResult.ok, false, 'Recheck after deletion should fail');

    // NOTE: This is a TOCTOU window. The validator checks existence but does not
    // hold a lock. Between validation and claim insertion, the WM entry could be
    // discarded. The claim system should use a transaction to make this atomic.
    // This is a MEDIUM finding — documented, not a bug per se, but a known window.
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ME-08: Task ID confusion in evidence ID
  // ═══════════════════════════════════════════════════════════════════════════

  it('ME-08: empty taskId treated as no task context (rejected)', () => {
    seedWmEntry(conn, 'task-1', 'some-key', '{"data":"value"}');

    // Empty string taskId
    const result = validator.exists(conn, 'memory', 'some-key', 'tenant-a' as TenantId, '');
    assert.equal(result.ok, false, 'Empty taskId should fail validation');
  });

  it('ME-08: null taskId explicitly rejected for memory evidence', () => {
    seedWmEntry(conn, 'task-1', 'some-key', '{"data":"value"}');

    const result = validator.exists(conn, 'memory', 'some-key', 'tenant-a' as TenantId, null);
    assert.equal(result.ok, false, 'Null taskId should fail for memory evidence');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-ME-01: Evidence type mismatch exploit (XF-04)
  // ═══════════════════════════════════════════════════════════════════════════

  it('XF-04: artifact evidence type cannot reference WM entry', () => {
    seedWmEntry(conn, 'task-1', 'wm-key-as-artifact', '{"data":"value"}');

    // Try to use a WM key as artifact evidence
    const result = validator.exists(conn, 'artifact', 'wm-key-as-artifact', 'tenant-a' as TenantId);
    assert.equal(result.ok, false, 'WM key should not be found in artifacts table');
  });

  it('XF-04: memory evidence type cannot reference artifact', () => {
    seedArtifact(conn, 'art-as-memory', 'tenant-a');

    // Try to use an artifact ID as memory evidence
    const result = validator.exists(conn, 'memory', 'art-as-memory', 'tenant-a' as TenantId, 'task-1');
    assert.equal(result.ok, false, 'Artifact ID should not be found in WM entries');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-ME-02: Unknown evidence type
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-ME-02: unknown evidence type returns error', () => {
    const result = validator.exists(conn, 'unknown_type' as any, 'some-id', 'tenant-a' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.message.includes('Unknown evidence type'));
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-ME-03: Claim evidence pass-through security check
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-ME-03: claim evidence always returns true (design choice, not a vulnerability)', () => {
    // The 'claim' type is handled inline by claim_stores.ts.
    // The validator returning true is a pass-through — the actual validation
    // happens in the claim store itself. Verify this is intentional.
    const result = validator.exists(conn, 'claim', 'any-id', 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, true);

    // Even with fake tenant
    const result2 = validator.exists(conn, 'claim', 'any-id', 'nonexistent-tenant' as TenantId);
    assert.ok(result2.ok);
    // NOTE: This is by design — claim_stores.ts does its own claim lookup with tenant check
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-ME-04: Artifact evidence tenant isolation
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-ME-04: artifact evidence cross-tenant rejected', () => {
    seedArtifact(conn, 'tenant-a-artifact', 'tenant-a');

    const result = validator.exists(conn, 'artifact', 'tenant-a-artifact', 'tenant-b' as TenantId);
    assert.equal(result.ok, false, 'Cross-tenant artifact access must be rejected');
  });

  it('BREAKER-ME-04: artifact evidence with null tenant_id isolated', () => {
    seedArtifact(conn, 'null-tenant-art', null);

    // Access with named tenant should fail (null != 'tenant-a')
    const result = validator.exists(conn, 'artifact', 'null-tenant-art', 'tenant-a' as TenantId);
    assert.equal(result.ok, false, 'Null-tenant artifact should be isolated from named tenant');
  });

  it('BREAKER-ME-04: artifact evidence with null tenant_id accessible by null tenant', () => {
    seedArtifact(conn, 'null-accessible-art', null);

    const result = validator.exists(conn, 'artifact', 'null-accessible-art', null);
    assert.ok(result.ok, 'Null-tenant artifact should be accessible by null tenant');
  });
});

describe('BREAKER: Capability Result Attacks', () => {
  let conn: DatabaseConnection;
  const validator = createEvidenceValidator();
  const scopeValidator = createCapabilityResultScopeValidator();

  beforeEach(() => {
    conn = createTestDatabase();
    seedMission(conn, { id: 'mission-1', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'task-1', missionId: 'mission-1' });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CR-01: Fabrication — claim referencing non-existent result
  // ═══════════════════════════════════════════════════════════════════════════

  it('CR-01: fabricated capability result ID rejected', () => {
    const result = validator.exists(conn, 'capability_result', 'fabricated-result-id', 'tenant-a' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CR-02: Scope escape — result from unrelated mission
  // ═══════════════════════════════════════════════════════════════════════════

  it('CR-02: scope escape — result from sibling mission rejected', () => {
    seedMission(conn, { id: 'sibling-mission', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'sibling-task', missionId: 'sibling-mission' });
    seedCapabilityResult(conn, 'sibling-result', 'tenant-a', 'sibling-mission', 'sibling-task');

    const result = scopeValidator.validateScope(conn, 'sibling-result', 'mission-1' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, false, 'Sibling mission result must be out of scope');
  });

  it('CR-02: scope escape — result from deeply nested unrelated mission rejected', () => {
    // Create a tree: A → B → C
    seedMission(conn, { id: 'tree-a', tenantId: 'tenant-a' });
    seedMission(conn, { id: 'tree-b', tenantId: 'tenant-a', parentId: 'tree-a' });
    seedMission(conn, { id: 'tree-c', tenantId: 'tenant-a', parentId: 'tree-b' });

    seedTask(conn, { id: 'tree-c-task', missionId: 'tree-c' });
    seedCapabilityResult(conn, 'tree-c-result', 'tenant-a', 'tree-c', 'tree-c-task');

    // mission-1 trying to access tree-c's result — completely unrelated
    const result = scopeValidator.validateScope(conn, 'tree-c-result', 'mission-1' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, false, 'Deeply nested unrelated mission result must be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CR-03: Result tampering — verify immutability trigger
  // ═══════════════════════════════════════════════════════════════════════════

  it('CR-03: capability result update blocked by trigger', () => {
    seedCapabilityResult(conn, 'tamper-target', 'tenant-a', 'mission-1', 'task-1');

    assert.throws(
      () => conn.run('UPDATE core_capability_results SET result_json = ? WHERE id = ?', ['{"tampered":true}', 'tamper-target']),
      (err: Error) => {
        assert.ok(err.message.includes('CAPABILITY_RESULT_IMMUTABLE'));
        return true;
      },
    );
  });

  it('CR-03: capability result delete blocked by trigger', () => {
    seedCapabilityResult(conn, 'delete-target', 'tenant-a', 'mission-1', 'task-1');

    assert.throws(
      () => conn.run('DELETE FROM core_capability_results WHERE id = ?', ['delete-target']),
      (err: Error) => {
        assert.ok(err.message.includes('CAPABILITY_RESULT_NO_DELETE'));
        return true;
      },
    );
  });

  it('CR-03: capability result mission_id field tamper blocked', () => {
    seedCapabilityResult(conn, 'tamper-mission', 'tenant-a', 'mission-1', 'task-1');

    assert.throws(
      () => conn.run('UPDATE core_capability_results SET mission_id = ? WHERE id = ?', ['attacker-mission', 'tamper-mission']),
      (err: Error) => {
        assert.ok(err.message.includes('CAPABILITY_RESULT_IMMUTABLE'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CR-05: Cross-tenant result access
  // ═══════════════════════════════════════════════════════════════════════════

  it('CR-05: cross-tenant capability result rejected by evidence validator', () => {
    seedCapabilityResult(conn, 'cross-tenant-cap', 'tenant-a', 'mission-1', 'task-1');

    const result = validator.exists(conn, 'capability_result', 'cross-tenant-cap', 'tenant-b' as TenantId);
    assert.equal(result.ok, false, 'Cross-tenant capability result must be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CR-07: Ancestor chain cascade — child→parent and parent→child
  // ═══════════════════════════════════════════════════════════════════════════

  it('CR-07: child mission can access parent mission capability result (downward)', () => {
    seedMission(conn, { id: 'parent-m', tenantId: 'tenant-a' });
    seedMission(conn, { id: 'child-m', tenantId: 'tenant-a', parentId: 'parent-m' });
    seedTask(conn, { id: 'parent-task', missionId: 'parent-m' });
    seedCapabilityResult(conn, 'parent-cap', 'tenant-a', 'parent-m', 'parent-task');

    // Child accessing parent's result — valid (ancestor chain)
    const result = scopeValidator.validateScope(conn, 'parent-cap', 'child-m' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, true, 'Child should access parent capability result');
  });

  it('CR-07: parent mission CANNOT access child mission capability result (upward)', () => {
    seedMission(conn, { id: 'parent-m2', tenantId: 'tenant-a' });
    seedMission(conn, { id: 'child-m2', tenantId: 'tenant-a', parentId: 'parent-m2' });
    seedTask(conn, { id: 'child-task2', missionId: 'child-m2' });
    seedCapabilityResult(conn, 'child-cap', 'tenant-a', 'child-m2', 'child-task2');

    // Parent accessing child's result — should be out of scope (ancestor walk goes UP, not down)
    const result = scopeValidator.validateScope(conn, 'child-cap', 'parent-m2' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, false, 'Parent should NOT access child capability result');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-CR-01: maxDepth boundary — 6 levels deep
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-CR-01: ancestor chain walk bounded at maxDepth=5', () => {
    // Create chain: root → d1 → d2 → d3 → d4 → d5 → d6
    seedMission(conn, { id: 'root', tenantId: 'tenant-a' });
    seedMission(conn, { id: 'd1', tenantId: 'tenant-a', parentId: 'root' });
    seedMission(conn, { id: 'd2', tenantId: 'tenant-a', parentId: 'd1' });
    seedMission(conn, { id: 'd3', tenantId: 'tenant-a', parentId: 'd2' });
    seedMission(conn, { id: 'd4', tenantId: 'tenant-a', parentId: 'd3' });
    seedMission(conn, { id: 'd5', tenantId: 'tenant-a', parentId: 'd4' });
    seedMission(conn, { id: 'd6', tenantId: 'tenant-a', parentId: 'd5' });

    seedTask(conn, { id: 'root-task', missionId: 'root' });
    seedCapabilityResult(conn, 'root-cap', 'tenant-a', 'root', 'root-task');

    // d5 accessing root's result (5 hops: d5→d4→d3→d2→d1→root = depth 5)
    const result5 = scopeValidator.validateScope(conn, 'root-cap', 'd5' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result5.ok);
    assert.equal(result5.value, true, 'd5 should reach root within maxDepth=5');

    // d6 accessing root's result (6 hops: d6→d5→d4→d3→d2→d1→root = depth 6)
    // maxDepth=5 means loop runs i=0..5 (6 iterations), checking 6 nodes including self
    const result6 = scopeValidator.validateScope(conn, 'root-cap', 'd6' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result6.ok);
    // d6 checks: d6(i=0), d5(i=1), d4(i=2), d3(i=3), d2(i=4), d1(i=5) — stops here, never checks root
    assert.equal(result6.value, false, 'd6 should NOT reach root — exceeds maxDepth boundary');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-CR-02: Scope validator has NO tenant check (FINDING)
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-CR-02: scope validator has tenant isolation (F-S1-004 FIXED)', () => {
    // Create a mission in tenant-b
    seedMission(conn, { id: 'tenant-b-mission', tenantId: 'tenant-b' });
    seedTask(conn, { id: 'tenant-b-task', missionId: 'tenant-b-mission' });

    // Create a child mission in tenant-b
    seedMission(conn, { id: 'tenant-b-child', tenantId: 'tenant-b', parentId: 'tenant-b-mission' });

    // Create cap result in tenant-b mission
    seedCapabilityResult(conn, 'tenant-b-cap', 'tenant-b', 'tenant-b-mission', 'tenant-b-task');

    // F-S1-004 FIX: Scope validator now accepts tenantId and scopes mission lookups.
    // Same-tenant scope walk should still work
    const resultSameTenant = scopeValidator.validateScope(conn, 'tenant-b-cap', 'tenant-b-child' as MissionId, 'tenant-b' as TenantId);
    assert.ok(resultSameTenant.ok);
    assert.equal(resultSameTenant.value, true, 'Same-tenant scope walk should succeed');

    // Cross-tenant scope walk should fail — tenant-a cannot walk tenant-b missions
    const resultCrossTenant = scopeValidator.validateScope(conn, 'tenant-b-cap', 'tenant-b-child' as MissionId, 'tenant-a' as TenantId);
    assert.ok(resultCrossTenant.ok);
    assert.equal(resultCrossTenant.value, false, 'Cross-tenant scope walk must be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-CR-03: Cycle guard in ancestor walk
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-CR-03: circular parent reference does not cause infinite loop', () => {
    // Create mission with circular parent (corrupt data scenario)
    seedMission(conn, { id: 'cycle-a', tenantId: 'tenant-a' });
    seedMission(conn, { id: 'cycle-b', tenantId: 'tenant-a', parentId: 'cycle-a' });

    // Manually create circular reference
    conn.run('UPDATE core_missions SET parent_id = ? WHERE id = ?', ['cycle-b', 'cycle-a']);

    seedTask(conn, { id: 'cycle-task', missionId: 'mission-1' });
    seedCapabilityResult(conn, 'cycle-cap', 'tenant-a', 'mission-1', 'cycle-task');

    // Walk from cycle-a should terminate (visited set prevents infinite loop)
    const result = scopeValidator.validateScope(conn, 'cycle-cap', 'cycle-a' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok, 'Cycle guard should prevent crash');
    // It may or may not find the result — the point is it terminates
  });
});
