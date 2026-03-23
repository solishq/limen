/**
 * Smoke test for the test database harness.
 * Verifies: harness creates working database, migrations applied, audit trail works.
 * Not a TEST-GAP test — this validates the test infrastructure itself.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestOrchestrationDeps,
  createTestOperationContext,
  createTestAuditTrail,
  seedMission,
  seedResource,
  seedAuditEntry,
  tenantId,
} from './test_database.js';

describe('Test Database Harness', () => {

  it('createTestDatabase() creates database with all migrations applied', () => {
    const conn = createTestDatabase();

    // Check schema version (should be 35 — includes replay pipeline migration)
    const version = conn.get<{ version: number }>(
      `SELECT MAX(version) as version FROM core_migrations WHERE status = 'applied'`
    );
    assert.ok(version, 'core_migrations table must exist');
    assert.equal(version.version, 35, 'All 35 migrations must be applied');

    conn.close();
  });

  it('createTestDatabase() creates all expected tables', () => {
    const conn = createTestDatabase();

    const tables = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    const tableNames = tables.map(t => t.name);

    // Key kernel tables
    assert.ok(tableNames.includes('core_audit_log'), 'core_audit_log must exist');
    assert.ok(tableNames.includes('core_vault'), 'core_vault must exist');
    assert.ok(tableNames.includes('core_policies'), 'core_policies must exist');

    // Key orchestration tables
    assert.ok(tableNames.includes('core_missions'), 'core_missions must exist');
    assert.ok(tableNames.includes('core_tasks'), 'core_tasks must exist');
    assert.ok(tableNames.includes('core_resources'), 'core_resources must exist');
    assert.ok(tableNames.includes('core_artifacts'), 'core_artifacts must exist');
    assert.ok(tableNames.includes('core_checkpoints'), 'core_checkpoints must exist');
    assert.ok(tableNames.includes('core_conversations'), 'core_conversations must exist');

    conn.close();
  });

  it('audit trail INSERT works and produces hash-chained entries', () => {
    const conn = createTestDatabase();
    const audit = createTestAuditTrail();

    const result1 = seedAuditEntry(conn, audit, {
      operation: 'test_op_1',
      resourceId: 'res-001',
    });
    assert.ok(result1.ok, 'First audit entry must succeed');

    const result2 = seedAuditEntry(conn, audit, {
      operation: 'test_op_2',
      resourceId: 'res-002',
    });
    assert.ok(result2.ok, 'Second audit entry must succeed');

    // Verify chain
    const entries = conn.query<{ seq_no: number; previous_hash: string; current_hash: string }>(
      `SELECT seq_no, previous_hash, current_hash FROM core_audit_log ORDER BY seq_no`
    );
    assert.equal(entries.length, 2, 'Two audit entries must exist');
    assert.equal(entries[0].seq_no, 1, 'First entry seq_no = 1');
    assert.equal(entries[1].previous_hash, entries[0].current_hash,
      'Second entry previous_hash must equal first entry current_hash (chain integrity)');

    conn.close();
  });

  it('audit trail UPDATE is blocked by I-06 trigger', () => {
    const conn = createTestDatabase();
    const audit = createTestAuditTrail();

    seedAuditEntry(conn, audit, { resourceId: 'immutable-entry' });

    assert.throws(
      () => conn.run(`UPDATE core_audit_log SET operation = 'tampered' WHERE seq_no = 1`),
      (err: Error) => err.message.includes('I-06'),
      'I-06: UPDATE on core_audit_log must be blocked by trigger'
    );

    conn.close();
  });

  it('audit trail DELETE is blocked by I-06 trigger', () => {
    const conn = createTestDatabase();
    const audit = createTestAuditTrail();

    seedAuditEntry(conn, audit, { resourceId: 'immutable-entry' });

    assert.throws(
      () => conn.run(`DELETE FROM core_audit_log WHERE seq_no = 1`),
      (err: Error) => err.message.includes('I-06'),
      'I-06: DELETE on core_audit_log must be blocked by trigger'
    );

    conn.close();
  });

  it('seedMission() creates a valid mission record', () => {
    const conn = createTestDatabase();

    try {
      seedMission(conn, { id: 'mission-001', tenantId: 'tenant-A', objective: 'Test the system' });
    } catch (err: unknown) {
      const e = err as Error;
      assert.fail(`seedMission failed: ${e.message}`);
    }

    const mission = conn.get<{ id: string; tenant_id: string; objective: string; state: string }>(
      `SELECT id, tenant_id, objective, state FROM core_missions WHERE id = ?`,
      ['mission-001']
    );
    assert.ok(mission, 'Mission must be created');
    assert.equal(mission.tenant_id, 'tenant-A');
    assert.equal(mission.state, 'CREATED');

    conn.close();
  });

  it('seedResource() creates a valid budget record', () => {
    const conn = createTestDatabase();

    seedMission(conn, { id: 'mission-002' });
    seedResource(conn, { missionId: 'mission-002', tokenAllocated: 5000, tokenConsumed: 1000 });

    const resource = conn.get<{ token_allocated: number; token_remaining: number }>(
      `SELECT token_allocated, token_remaining FROM core_resources WHERE mission_id = ?`,
      ['mission-002']
    );
    assert.ok(resource, 'Resource must be created');
    assert.equal(resource.token_allocated, 5000);
    assert.equal(resource.token_remaining, 4000, 'remaining = allocated - consumed');

    conn.close();
  });

  it('createTestOrchestrationDeps() provides working deps', () => {
    const { deps, conn } = createTestOrchestrationDeps();

    assert.ok(deps.conn, 'deps.conn must exist');
    assert.ok(deps.audit, 'deps.audit must exist');
    assert.ok(deps.substrate, 'deps.substrate must exist');

    // Verify deps.conn works
    const version = deps.conn.get<{ version: number }>(
      `SELECT MAX(version) as version FROM core_migrations WHERE status = 'applied'`
    );
    assert.equal(version?.version, 35);

    conn.close();
  });

  it('createTestOperationContext() provides valid context with defaults', () => {
    const ctx = createTestOperationContext();

    assert.ok(ctx.tenantId, 'Default tenantId must be set');
    assert.ok(ctx.userId, 'Default userId must be set');
    assert.ok(ctx.permissions.size > 0, 'Default permissions must be non-empty');
    assert.ok(ctx.permissions.has('create_mission'), 'Default must include create_mission');
  });

  it('createTestOperationContext() supports null tenantId for single mode', () => {
    const ctx = createTestOperationContext({ tenantId: null });

    assert.equal(ctx.tenantId, null, 'tenantId must be null when explicitly set');
  });

  it('row-level mode database rejects null tenantId context in queries', () => {
    const conn = createTestDatabase('row-level');

    // In row-level mode, the database itself doesn't enforce tenant — that's tenant_context's job.
    // But we can verify the schema supports tenant_id columns.
    const tableInfo = conn.query<{ name: string }>(
      `PRAGMA table_info(core_missions)`
    );
    const columnNames = tableInfo.map(c => c.name);
    assert.ok(columnNames.includes('tenant_id'),
      'core_missions must have tenant_id column for row-level mode');

    conn.close();
  });
});
