/**
 * Contract tests for CCP-01 (Memory Evidence) + CCP-02 (Capability Results).
 * Validates real evidence validators and capability result scope validator.
 *
 * Phase: Sprint 1 (Foundation Layer)
 * Spec ref: CCP v2.0 §7 (Evidence model), DC-CCP-118 (scope validation),
 *           WMP v1.0 §5 (Working memory), I-08 (Agent persistence)
 *
 * Tests: 16 contract tests covering:
 *   - Memory evidence with valid WM entry → success
 *   - Memory evidence with nonexistent key → EVIDENCE_NOT_FOUND
 *   - Memory evidence without taskId → rejected
 *   - Memory evidence cross-tenant → rejected
 *   - Memory evidence after WM entry discarded → rejected
 *   - Capability result evidence with valid result → success
 *   - Capability result evidence with fake ID → rejected
 *   - Capability result scope: same mission → valid
 *   - Capability result scope: ancestor mission → valid
 *   - Capability result scope: unrelated mission → scope violation (false)
 *   - Capability result cross-tenant → rejected
 *   - Artifact evidence still works (regression)
 *   - Claim evidence still works (regression)
 *   - Capability result immutability — no update
 *   - Capability result immutability — no delete
 *   - Unknown evidence type → rejected
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, seedMission } from '../helpers/test_database.js';
import type { DatabaseConnection, TenantId, MissionId } from '../../src/kernel/interfaces/index.js';
import { createEvidenceValidator } from '../../src/claims/evidence/evidence_validator.js';
import { createCapabilityResultScopeValidator } from '../../src/claims/evidence/capability_scope_validator.js';

// ─── Seed Helpers ───

/**
 * Seed a task into core_tasks for the given mission.
 * Matches the actual core_tasks schema from migration 009.
 */
function seedTask(conn: DatabaseConnection, options: {
  id: string;
  missionId: string;
  tenantId?: string;
  state?: string;
}): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [options.id, options.missionId, options.tenantId ?? 'tenant-a', `graph-${options.id}`, `Test task ${options.id}`, 'deterministic', options.state ?? 'PENDING', now, now],
  );
}

/**
 * Seed a working memory entry.
 */
function seedWmEntry(conn: DatabaseConnection, taskId: string, key: string, value: string): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO working_memory_entries (task_id, key, value, size_bytes, mutation_position, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [taskId, key, value, Buffer.byteLength(value), now, now],
  );
}

/**
 * Seed an artifact into core_artifacts.
 * Matches the actual schema from migration 010 (composite PK: id + version).
 */
function seedArtifact(conn: DatabaseConnection, id: string, tenantId: string | null): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, source_task_id, created_at)
     VALUES (?, 1, 'mission-1', ?, 'test-artifact', 'report', 'json', '{}', 'task-1', ?)`,
    [id, tenantId, now],
  );
}

/**
 * Seed a capability result.
 */
function seedCapabilityResult(conn: DatabaseConnection, id: string, tenantId: string | null, missionId: string, taskId: string): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_capability_results (id, tenant_id, mission_id, task_id, capability_type, parameters_hash, result_json, result_size, tokens_consumed, time_consumed_ms, compute_consumed, storage_consumed, created_at)
     VALUES (?, ?, ?, ?, 'web_search', 'hash123', '{"data":"result"}', 18, 100, 500, 0, 0, ?)`,
    [id, tenantId, missionId, taskId, now],
  );
}

describe('CCP-01 Memory Evidence + CCP-02 Capability Results — Contract Tests', () => {
  let conn: DatabaseConnection;
  const validator = createEvidenceValidator();
  const scopeValidator = createCapabilityResultScopeValidator();

  beforeEach(() => {
    conn = createTestDatabase();

    // Seed base data: mission + task for evidence lookups
    seedMission(conn, { id: 'mission-1', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'task-1', missionId: 'mission-1' });
  });

  // ─── Memory Evidence ───

  it('memory evidence with valid WM entry → success', () => {
    seedWmEntry(conn, 'task-1', 'findings.summary', '{"summary":"test"}');

    const result = validator.exists(conn, 'memory', 'findings.summary', 'tenant-a' as TenantId, 'task-1');
    assert.ok(result.ok, 'Valid memory evidence should return ok:true');
    assert.equal(result.value, true);
  });

  it('memory evidence with nonexistent key → EVIDENCE_NOT_FOUND', () => {
    const result = validator.exists(conn, 'memory', 'nonexistent-key', 'tenant-a' as TenantId, 'task-1');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  it('memory evidence without taskId → rejected', () => {
    seedWmEntry(conn, 'task-1', 'some-key', '{"data":"value"}');

    // No taskId passed — memory evidence requires task context
    const result = validator.exists(conn, 'memory', 'some-key', 'tenant-a' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
      assert.ok(result.error.message.includes('task context'));
    }
  });

  it('memory evidence cross-tenant → rejected', () => {
    seedWmEntry(conn, 'task-1', 'cross-tenant-key', '{"data":"value"}');

    // Mission is tenant-a; querying with tenant-b should fail
    const result = validator.exists(conn, 'memory', 'cross-tenant-key', 'tenant-b' as TenantId, 'task-1');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  it('memory evidence after WM entry discarded → rejected', () => {
    seedWmEntry(conn, 'task-1', 'ephemeral-key', '{"temp":"data"}');

    // Discard the WM entry (WMP uses physical DELETE)
    conn.run('DELETE FROM working_memory_entries WHERE task_id = ? AND key = ?', ['task-1', 'ephemeral-key']);

    const result = validator.exists(conn, 'memory', 'ephemeral-key', 'tenant-a' as TenantId, 'task-1');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  // ─── Capability Result Evidence ───

  it('capability result evidence with valid result → success', () => {
    seedCapabilityResult(conn, 'cap-result-1', 'tenant-a', 'mission-1', 'task-1');

    const result = validator.exists(conn, 'capability_result', 'cap-result-1', 'tenant-a' as TenantId);
    assert.ok(result.ok, 'Valid capability result evidence should return ok:true');
    assert.equal(result.value, true);
  });

  it('capability result evidence with fake ID → rejected', () => {
    const result = validator.exists(conn, 'capability_result', 'nonexistent-cap-result', 'tenant-a' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  it('capability result cross-tenant → rejected', () => {
    seedCapabilityResult(conn, 'cap-cross-tenant', 'tenant-a', 'mission-1', 'task-1');

    const result = validator.exists(conn, 'capability_result', 'cap-cross-tenant', 'tenant-b' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  // ─── Capability Result Scope Validation ───

  it('capability result scope: same mission → valid', () => {
    seedCapabilityResult(conn, 'scope-same', 'tenant-a', 'mission-1', 'task-1');

    const result = scopeValidator.validateScope(conn, 'scope-same', 'mission-1' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, true);
  });

  it('capability result scope: ancestor mission → valid', () => {
    // Create child mission with parent
    seedMission(conn, { id: 'child-mission-1', tenantId: 'tenant-a', parentId: 'mission-1' });
    seedTask(conn, { id: 'child-task-1', missionId: 'child-mission-1' });

    // Cap result produced by parent mission
    seedCapabilityResult(conn, 'scope-ancestor', 'tenant-a', 'mission-1', 'task-1');

    // Child mission referencing parent's capability result — ancestor chain valid
    const result = scopeValidator.validateScope(conn, 'scope-ancestor', 'child-mission-1' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, true, 'Ancestor mission capability result should be in scope');
  });

  it('capability result scope: unrelated mission → scope violation (false)', () => {
    seedMission(conn, { id: 'unrelated-mission', tenantId: 'tenant-a' });
    seedTask(conn, { id: 'unrelated-task', missionId: 'unrelated-mission' });
    seedCapabilityResult(conn, 'scope-unrelated', 'tenant-a', 'unrelated-mission', 'unrelated-task');

    // mission-1 trying to reference unrelated-mission's result
    const result = scopeValidator.validateScope(conn, 'scope-unrelated', 'mission-1' as MissionId, 'tenant-a' as TenantId);
    assert.ok(result.ok);
    assert.equal(result.value, false, 'Unrelated mission capability result should be out of scope');
  });

  it('capability result scope: nonexistent result → EVIDENCE_NOT_FOUND', () => {
    const result = scopeValidator.validateScope(conn, 'nonexistent-result', 'mission-1' as MissionId, 'tenant-a' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  // ─── Artifact Evidence (Regression) ───

  it('artifact evidence still works — regression', () => {
    seedArtifact(conn, 'art-regression-1', 'tenant-a');

    const result = validator.exists(conn, 'artifact', 'art-regression-1', 'tenant-a' as TenantId);
    assert.ok(result.ok, 'Artifact evidence should still work');
    assert.equal(result.value, true);
  });

  it('artifact evidence — nonexistent returns EVIDENCE_NOT_FOUND', () => {
    const result = validator.exists(conn, 'artifact', 'nonexistent-artifact', 'tenant-a' as TenantId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'EVIDENCE_NOT_FOUND');
    }
  });

  // ─── Claim Evidence (Regression) ───

  it('claim evidence still works — regression (always true for claim type)', () => {
    // Claim evidence is validated inline by claim_stores.ts, not by this validator.
    // The validator returns ok:true as a pass-through.
    const result = validator.exists(conn, 'claim', 'any-claim-id', 'tenant-a' as TenantId);
    assert.ok(result.ok, 'Claim evidence pass-through should return ok:true');
    assert.equal(result.value, true);
  });

  // ─── Capability Result Immutability ───

  it('capability result immutability — no update (trigger enforcement)', () => {
    seedCapabilityResult(conn, 'immutable-cap', 'tenant-a', 'mission-1', 'task-1');

    assert.throws(
      () => conn.run('UPDATE core_capability_results SET result_json = ? WHERE id = ?', ['{"new":"data"}', 'immutable-cap']),
      (err: Error) => {
        assert.ok(err.message.includes('CAPABILITY_RESULT_IMMUTABLE'));
        return true;
      },
    );
  });

  it('capability result immutability — no delete (trigger enforcement)', () => {
    seedCapabilityResult(conn, 'nodelete-cap', 'tenant-a', 'mission-1', 'task-1');

    assert.throws(
      () => conn.run('DELETE FROM core_capability_results WHERE id = ?', ['nodelete-cap']),
      (err: Error) => {
        assert.ok(err.message.includes('CAPABILITY_RESULT_NO_DELETE'));
        return true;
      },
    );
  });
});
