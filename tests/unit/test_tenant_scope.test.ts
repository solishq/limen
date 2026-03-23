/**
 * Layer 1 + 1B: TenantScopedConnection Facade Unit Tests
 * Verifies: injectTenantPredicate SQL injection logic, facade mode switching,
 * complex SQL fail-safe, and boundary conditions.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * FM-10: "query-level tenant filtering"
 * S3.7: "Query-level tenant filtering"
 * S32.4: "Multi-tenant security"
 *
 * Phase: 4B (Certification — Tenant Isolation)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  tenantId,
} from '../helpers/test_database.js';
import {
  createTenantScopedConnection,
  injectTenantPredicate,
} from '../../src/kernel/tenant/tenant_scope.js';
import type { TenantId } from '../../src/kernel/interfaces/index.js';

// ─── Test helper: seed a mission row directly ───

function seedMissionRow(conn: ReturnType<typeof createTestDatabase>, id: string, tid: string): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_missions (id, tenant_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, tid, 'a1', 'obj', '[]', '[]', 'CREATED', 0, '[]', '[]', '{}', 0, now, now],
  );
}

// ─── Layer 1: injectTenantPredicate + createTenantScopedConnection ───

describe('Layer 1: TenantScopedConnection Facade (FM-10, S3.7)', () => {

  describe('injectTenantPredicate — SQL injection logic', () => {

    const tid = tenantId('tenant-A');

    it('SELECT with WHERE clause gets AND tenant_id = ?', () => {
      const { scopedSql, scopedParams } = injectTenantPredicate(
        'SELECT id FROM core_missions WHERE id = ?', ['m1'], tid,
      );
      assert.ok(scopedSql.includes('AND tenant_id = ?'), 'Must append AND tenant_id = ?');
      assert.deepEqual(scopedParams, ['m1', 'tenant-A']);
    });

    it('SELECT without WHERE clause gets WHERE tenant_id = ?', () => {
      const { scopedSql, scopedParams } = injectTenantPredicate(
        'SELECT id FROM core_missions', [], tid,
      );
      assert.ok(scopedSql.includes('WHERE tenant_id = ?'), 'Must add WHERE tenant_id = ?');
      assert.deepEqual(scopedParams, ['tenant-A']);
    });

    it('SELECT with WHERE and ORDER BY — tenant_id before ORDER BY', () => {
      const { scopedSql } = injectTenantPredicate(
        'SELECT id FROM core_missions WHERE state = ? ORDER BY id', ['CREATED'], tid,
      );
      const tenantPos = scopedSql.indexOf('tenant_id');
      const orderPos = scopedSql.indexOf('ORDER BY');
      assert.ok(tenantPos < orderPos, 'tenant_id must be positioned before ORDER BY');
    });

    it('SELECT with WHERE and GROUP BY — tenant_id before GROUP BY', () => {
      const { scopedSql } = injectTenantPredicate(
        'SELECT state, COUNT(*) FROM core_missions WHERE depth = ? GROUP BY state', [0], tid,
      );
      const tenantPos = scopedSql.indexOf('tenant_id');
      const groupPos = scopedSql.indexOf('GROUP BY');
      assert.ok(tenantPos < groupPos, 'tenant_id must be positioned before GROUP BY');
    });

    it('SELECT with WHERE and LIMIT — tenant_id before LIMIT', () => {
      const { scopedSql } = injectTenantPredicate(
        'SELECT id FROM core_missions WHERE state = ? LIMIT 10', ['CREATED'], tid,
      );
      const tenantPos = scopedSql.indexOf('tenant_id');
      const limitPos = scopedSql.indexOf('LIMIT');
      assert.ok(tenantPos < limitPos, 'tenant_id must be positioned before LIMIT');
    });

    it('UPDATE with WHERE clause gets AND tenant_id = ?', () => {
      const { scopedSql, scopedParams } = injectTenantPredicate(
        'UPDATE core_missions SET objective = ? WHERE id = ?', ['updated', 'm1'], tid,
      );
      assert.ok(scopedSql.includes('AND tenant_id = ?'), 'Must append AND tenant_id = ?');
      assert.deepEqual(scopedParams, ['updated', 'm1', 'tenant-A']);
    });

    it('DELETE with WHERE clause gets AND tenant_id = ?', () => {
      const { scopedSql, scopedParams } = injectTenantPredicate(
        'DELETE FROM core_tasks WHERE id = ?', ['t1'], tid,
      );
      assert.ok(scopedSql.includes('AND tenant_id = ?'), 'Must append AND tenant_id = ?');
      assert.deepEqual(scopedParams, ['t1', 'tenant-A']);
    });

    it('INSERT statement passes through unchanged', () => {
      const originalSql = 'INSERT INTO core_missions (id, tenant_id) VALUES (?, ?)';
      const originalParams = ['m1', 'tenant-A'];
      const { scopedSql, scopedParams } = injectTenantPredicate(originalSql, originalParams, tid);
      assert.equal(scopedSql, originalSql, 'INSERT must pass through unchanged');
      assert.deepEqual(scopedParams, originalParams, 'INSERT params must be unchanged');
    });

    it('params array appends tenantId as last element', () => {
      const { scopedParams } = injectTenantPredicate(
        'SELECT * FROM core_missions WHERE id = ? AND state = ?', ['m1', 'CREATED'], tid,
      );
      assert.equal(scopedParams[scopedParams.length - 1], 'tenant-A',
        'tenantId must be last param');
      assert.equal(scopedParams.length, 3, 'Must have original params + tenantId');
    });
  });

  describe('createTenantScopedConnection — mode switching', () => {

    it('single mode returns pass-through connection (no tenant filtering)', () => {
      const rawConn = createTestDatabase('single');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      seedMissionRow(rawConn, 'm1', 'tenant-A');
      seedMissionRow(rawConn, 'm2', 'tenant-B');

      // Single mode: scoped connection does NOT filter
      const all = scoped.query<{ id: string }>('SELECT id FROM core_missions ORDER BY id');
      assert.equal(all.length, 2, 'RDD-3: Single mode must return all data');

      rawConn.close();
    });

    it('database mode returns pass-through connection (no tenant filtering)', () => {
      const rawConn = createTestDatabase('database');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      seedMissionRow(rawConn, 'm1', 'tenant-A');

      const all = scoped.query<{ id: string }>('SELECT id FROM core_missions');
      assert.equal(all.length, 1, 'Database mode must return all data (isolation is at DB level)');

      rawConn.close();
    });

    it('row-level mode with null tenantId returns pass-through (no scoping)', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, null);

      seedMissionRow(rawConn, 'm1', 'tenant-A');
      seedMissionRow(rawConn, 'm2', 'tenant-B');

      const all = scoped.query<{ id: string }>('SELECT id FROM core_missions ORDER BY id');
      assert.equal(all.length, 2, 'Null tenantId must not filter');

      rawConn.close();
    });

    it('row-level mode with empty string tenantId returns pass-through (AUDIT-002)', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, '' as TenantId);

      seedMissionRow(rawConn, 'm1', 'tenant-A');

      // Empty string tenantId is falsy — must NOT inject '' as tenant_id
      const all = scoped.query<{ id: string }>('SELECT id FROM core_missions');
      assert.equal(all.length, 1, 'AUDIT-002: Empty string must not scope');

      rawConn.close();
    });

    it('row-level mode with valid tenantId scopes SELECT', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      seedMissionRow(rawConn, 'm1', 'tenant-A');
      seedMissionRow(rawConn, 'm2', 'tenant-B');

      const result = scoped.query<{ id: string }>('SELECT id FROM core_missions WHERE id = ?', ['m1']);
      assert.equal(result.length, 1, 'FM-10: Must return only tenant-A row');
      assert.equal(result[0].id, 'm1');

      // Attempting to read tenant-B data through scoped connection
      const cross = scoped.query<{ id: string }>('SELECT id FROM core_missions WHERE id = ?', ['m2']);
      assert.equal(cross.length, 0, 'FM-10: Must not see tenant-B data');

      rawConn.close();
    });

    it('row-level mode with valid tenantId scopes UPDATE', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      seedMissionRow(rawConn, 'm1', 'tenant-A');
      seedMissionRow(rawConn, 'm2', 'tenant-B');

      // Scoped UPDATE: only affects own tenant
      const result = scoped.run(
        'UPDATE core_missions SET objective = ? WHERE id = ?', ['updated', 'm1'],
      );
      assert.equal(result.changes, 1, 'FM-10: Scoped UPDATE must affect own row');

      // Cross-tenant UPDATE: scoped connection cannot touch tenant-B
      const cross = scoped.run(
        'UPDATE core_missions SET objective = ? WHERE id = ?', ['tampered', 'm2'],
      );
      assert.equal(cross.changes, 0, 'FM-10: Cross-tenant UPDATE must affect 0 rows');

      rawConn.close();
    });

    it('row-level mode with valid tenantId scopes get()', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      seedMissionRow(rawConn, 'm1', 'tenant-A');
      seedMissionRow(rawConn, 'm2', 'tenant-B');

      const own = scoped.get<{ id: string }>('SELECT id FROM core_missions WHERE id = ?', ['m1']);
      assert.ok(own, 'Must find own tenant row');
      assert.equal(own.id, 'm1');

      const cross = scoped.get<{ id: string }>('SELECT id FROM core_missions WHERE id = ?', ['m2']);
      assert.equal(cross, undefined, 'FM-10: Must not find cross-tenant row');

      rawConn.close();
    });

    it('INSERT passes through unchanged in row-level mode', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      // INSERT via scoped connection — must not inject tenant_id
      const now = new Date().toISOString();
      scoped.run(
        `INSERT INTO core_missions (id, tenant_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['m-insert', 'tenant-A', 'a1', 'obj', '[]', '[]', 'CREATED', 0, '[]', '[]', '{}', 0, now, now],
      );

      const result = rawConn.get<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM core_missions WHERE id = ?', ['m-insert'],
      );
      assert.ok(result, 'INSERT must succeed');
      assert.equal(result.tenant_id, 'tenant-A', 'INSERT must preserve caller-provided tenant_id');

      rawConn.close();
    });

    it('.raw returns unwrapped connection with no tenant injection', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      seedMissionRow(rawConn, 'm1', 'tenant-A');
      seedMissionRow(rawConn, 'm2', 'tenant-B');

      // .raw must return the original connection — sees all tenants
      const all = scoped.raw.query<{ id: string }>('SELECT id FROM core_missions ORDER BY id');
      assert.equal(all.length, 2, '.raw must see all tenants');

      rawConn.close();
    });

    it('.tenantId exposes the current tenant context', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));
      assert.equal(scoped.tenantId, 'tenant-A', 'Must expose tenantId');
      rawConn.close();
    });

    it('transaction delegates to raw connection', () => {
      const rawConn = createTestDatabase('row-level');
      const scoped = createTenantScopedConnection(rawConn, tenantId('tenant-A'));

      scoped.transaction(() => {
        seedMissionRow(rawConn, 'm-tx', 'tenant-A');
      });

      const result = rawConn.get<{ id: string }>('SELECT id FROM core_missions WHERE id = ?', ['m-tx']);
      assert.ok(result, 'Transaction must commit successfully');

      rawConn.close();
    });
  });
});

// ─── Layer 1B: Complex SQL Fail-Safe Tests (CORR1-01 + AUDIT-001) ───

describe('Layer 1B: Complex SQL Fail-Safe (CORR1-01, AUDIT-001)', () => {

  const tid = tenantId('tenant-A');

  it('JOIN pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT m.id FROM core_missions m JOIN core_tasks t ON t.mission_id = m.id WHERE m.id = ?',
        ['m1'], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'CORR1-01: JOIN must throw',
    );
  });

  it('WITH (CTE) pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'WITH tree AS (SELECT id FROM core_missions WHERE parent_id IS NULL) SELECT * FROM tree',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'CORR1-01: WITH/CTE must throw',
    );
  });

  it('IN (SELECT ...) subquery pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_tasks WHERE graph_id IN (SELECT id FROM core_task_graphs WHERE mission_id = ?)',
        ['m1'], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'CORR1-01: IN (SELECT) must throw',
    );
  });

  it('EXISTS (SELECT ...) pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions WHERE EXISTS (SELECT 1 FROM core_tasks WHERE mission_id = core_missions.id)',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'CORR1-01: EXISTS() must throw',
    );
  });

  it('UNION pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions UNION SELECT id FROM core_tasks',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: UNION must throw',
    );
  });

  it('EXCEPT pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions EXCEPT SELECT id FROM core_tasks',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: EXCEPT must throw',
    );
  });

  it('INTERSECT pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions INTERSECT SELECT mission_id FROM core_tasks',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: INTERSECT must throw',
    );
  });

  it('NOT IN (SELECT ...) pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions WHERE id NOT IN (SELECT mission_id FROM core_tasks)',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: NOT IN (SELECT) must throw',
    );
  });

  it('NOT EXISTS (SELECT ...) pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions WHERE NOT EXISTS (SELECT 1 FROM core_tasks WHERE mission_id = core_missions.id)',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: NOT EXISTS() must throw',
    );
  });

  it('ANY (SELECT ...) pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions WHERE depth > ANY (SELECT depth FROM core_missions)',
        [], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: ANY() must throw',
    );
  });

  it('ALL (SELECT ...) pattern throws', () => {
    assert.throws(
      () => injectTenantPredicate(
        'SELECT id FROM core_missions WHERE depth > ALL (SELECT depth FROM core_missions WHERE parent_id = ?)',
        ['m1'], tid,
      ),
      (err: Error) => err.message.includes('Complex SQL detected'),
      'AUDIT-001: ALL (SELECT) must throw',
    );
  });

  it('simple SELECT with WHERE does NOT trigger fail-safe (no false positive)', () => {
    // Must NOT throw
    const { scopedSql } = injectTenantPredicate(
      'SELECT * FROM core_missions WHERE id = ?', ['m1'], tid,
    );
    assert.ok(scopedSql.includes('tenant_id'), 'Must inject tenant_id without throwing');
  });

  it('SELECT with literal IN list does NOT trigger fail-safe (no false positive)', () => {
    // IN ('a', 'b') is NOT a subquery — must not be flagged
    const { scopedSql } = injectTenantPredicate(
      "SELECT id FROM core_missions WHERE state IN ('CREATED', 'ACTIVE')",
      [], tid,
    );
    assert.ok(scopedSql.includes('tenant_id'),
      'CORR1-01: Literal IN list must NOT trigger fail-safe');
  });

  it('error message includes SQL snippet and pattern name', () => {
    try {
      injectTenantPredicate(
        'SELECT m.id FROM core_missions m JOIN core_tasks t ON t.mission_id = m.id',
        [], tid,
      );
      assert.fail('Should have thrown');
    } catch (err: unknown) {
      const msg = (err as Error).message;
      assert.ok(msg.includes('Complex SQL detected'), 'Must identify as complex SQL');
      assert.ok(msg.includes('deps.conn.raw'), 'Must suggest .raw escape hatch');
      assert.ok(msg.includes('SYSTEM_SCOPE'), 'Must mention SYSTEM_SCOPE annotation');
    }
  });
});
