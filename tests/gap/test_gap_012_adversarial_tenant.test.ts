/**
 * Layer 2B: Adversarial Tenant Isolation Tests
 * Verifies: The enforcement resists ATTACK, not just normal use.
 * 6 categories: SQL injection, pre-existing predicates, boundary inputs,
 * mode switching, resource ID guessing, immutability triggers.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * FM-10: tenant isolation must resist adversarial bypass
 * §3.7: "Query-level tenant filtering"
 * §32.4: "Multi-tenant security"
 *
 * Phase: 4B (Certification — Tenant Isolation)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createScopedTestDeps,
  createTestAuditTrail,
  createTestTransitionService,
  seedMission,
  seedResource,
  tenantId,
} from '../helpers/test_database.js';
import {
  createTenantScopedConnection,
  injectTenantPredicate,
} from '../../src/kernel/tenant/tenant_scope.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import type { TenantId, MissionId } from '../../src/kernel/interfaces/index.js';

// ─── Constants ───

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

// ─── Category 1: SQL Injection via tenant_id ───

describe('Layer 2B: Adversarial Tenant — Category 1: SQL Injection via tenant_id', () => {

  it('#1: SQL injection attempt: \' OR 1=1 -- as tenantId', () => {
    const rawConn = createTestDatabase('row-level');
    const now = new Date().toISOString();

    // Seed mission for real tenant
    seedMission(rawConn, { id: 'mission-sqli', tenantId: TENANT_A });

    // Create facade with SQL injection payload as tenantId
    const maliciousTid = "' OR 1=1 --" as unknown as TenantId;
    const scopedConn = createTenantScopedConnection(rawConn, maliciousTid);

    // Attempt to read — must return nothing (injection payload treated as literal string)
    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-sqli'],
    );
    assert.equal(result, undefined, 'SQL injection via tenantId must not bypass isolation');

    rawConn.close();
  });

  it('#2: SQL injection attempt: DROP TABLE as tenantId', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-drop', tenantId: TENANT_A });

    const maliciousTid = "'; DROP TABLE core_missions; --" as unknown as TenantId;
    const scopedConn = createTenantScopedConnection(rawConn, maliciousTid);

    // Attempt read — must not crash or delete table
    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-drop'],
    );
    assert.equal(result, undefined, 'DROP TABLE injection must not succeed');

    // Table must still exist
    const tableExists = rawConn.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='core_missions'",
    );
    assert.ok(tableExists, 'core_missions table must still exist after injection attempt');

    rawConn.close();
  });

  it('#3: SQL injection attempt: double-quote bypass', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-dq', tenantId: TENANT_A });

    const maliciousTid = '" OR ""="' as unknown as TenantId;
    const scopedConn = createTenantScopedConnection(rawConn, maliciousTid);

    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-dq'],
    );
    assert.equal(result, undefined, 'Double-quote injection must not bypass isolation');

    rawConn.close();
  });
});

// ─── Category 2: Pre-existing tenant_id in SQL ───

describe('Layer 2B: Adversarial Tenant — Category 2: Pre-existing tenant_id in SQL', () => {

  it('#4: Query with attacker-injected AND tenant_id still gets correct tenant appended', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-pre', tenantId: TENANT_A });

    const tid = tenantId(TENANT_B);

    // Attacker tries to pre-inject tenant_id for tenant-A in the SQL
    // The facade should STILL append its own AND tenant_id = ? for tenant-B
    const { scopedSql, scopedParams } = injectTenantPredicate(
      "SELECT * FROM core_missions WHERE id = ? AND tenant_id = 'tenant-A'",
      ['mission-pre'],
      tid,
    );

    // The facade appends another AND tenant_id = ? — the query must match BOTH conditions
    // Since tenant_id cannot be both 'tenant-A' AND 'tenant-B', this returns nothing
    assert.ok(scopedSql.includes('AND tenant_id = ?'), 'Facade must still inject its own tenant predicate');
    assert.deepEqual(scopedParams, ['mission-pre', 'tenant-B'], 'Params must include facade tenant_id');

    // Execute through scoped connection — must return nothing
    const scopedConn = createTenantScopedConnection(rawConn, tid);
    const result = scopedConn.get<{ id: string }>(
      "SELECT * FROM core_missions WHERE id = ? AND tenant_id = 'tenant-A'",
      ['mission-pre'],
    );
    assert.equal(result, undefined, 'Pre-existing tenant_id predicate must not override facade injection');

    rawConn.close();
  });

  it('#5: Query with hardcoded tenant_id in WHERE does not bypass facade', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-hc', tenantId: TENANT_A });

    // Tenant-B tries to SELECT with hardcoded tenant_id = TENANT_A
    const scopedConn = createTenantScopedConnection(rawConn, tenantId(TENANT_B));
    const result = scopedConn.query<{ id: string }>(
      "SELECT id FROM core_missions WHERE tenant_id = 'tenant-A'",
    );

    // Facade appends AND tenant_id = 'tenant-B', so both conditions must hold
    // A row with tenant_id = 'tenant-A' cannot also have tenant_id = 'tenant-B'
    assert.equal(result.length, 0, 'Hardcoded tenant_id in SQL must not bypass facade scoping');

    rawConn.close();
  });
});

// ─── Category 3: Empty/null/undefined tenant_id ───

describe('Layer 2B: Adversarial Tenant — Category 3: Boundary tenant_id values', () => {

  it('#6: Empty string tenantId returns pass-through (AUDIT-002)', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-empty', tenantId: TENANT_A });

    // Empty string should produce pass-through (no scoping) per AUDIT-002
    const scopedConn = createTenantScopedConnection(rawConn, '' as unknown as TenantId);

    // Pass-through means raw connection — can see all data
    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-empty'],
    );
    assert.ok(result, 'Empty tenantId must fall through to pass-through mode');
    assert.equal(scopedConn.tenantId, '', 'tenantId property must reflect empty string');
  });

  it('#7: null tenantId returns pass-through', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-null-tid', tenantId: TENANT_A });

    const scopedConn = createTenantScopedConnection(rawConn, null);

    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-null-tid'],
    );
    assert.ok(result, 'null tenantId must fall through to pass-through mode');
    assert.equal(scopedConn.tenantId, null, 'tenantId property must be null');
  });

  it('#8: Very long tenantId is treated as literal (no buffer overflow)', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-long', tenantId: TENANT_A });

    // 10,000 char tenantId
    const longTid = 'A'.repeat(10000) as unknown as TenantId;
    const scopedConn = createTenantScopedConnection(rawConn, longTid);

    // Must not crash or bypass — just returns no data (no tenant matches)
    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-long'],
    );
    assert.equal(result, undefined, 'Very long tenantId must not bypass isolation');

    rawConn.close();
  });
});

// ─── Category 4: Mode switching ───

describe('Layer 2B: Adversarial Tenant — Category 4: Mode and context manipulation', () => {

  it('#9: Single-mode database ignores tenant scoping entirely', () => {
    const singleConn = createTestDatabase('single');
    seedMission(singleConn, { id: 'mission-single', tenantId: TENANT_A });

    // In single mode, facade should return pass-through
    const scopedConn = createTenantScopedConnection(singleConn, tenantId(TENANT_B));

    // Pass-through: tenant-B can see tenant-A data (single mode = no isolation)
    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-single'],
    );
    assert.ok(result, 'Single mode: no tenant scoping applied');

    singleConn.close();
  });

  it('#10: Database-per-tenant mode ignores tenant scoping', () => {
    const dbConn = createTestDatabase('database');
    seedMission(dbConn, { id: 'mission-db', tenantId: TENANT_A });

    const scopedConn = createTenantScopedConnection(dbConn, tenantId(TENANT_B));

    const result = scopedConn.get<{ id: string }>(
      'SELECT id FROM core_missions WHERE id = ?',
      ['mission-db'],
    );
    assert.ok(result, 'Database mode: no tenant scoping (isolation via separate databases)');

    dbConn.close();
  });
});

// ─── Category 5: Resource ID guessing ───

describe('Layer 2B: Adversarial Tenant — Category 5: Resource ID guessing', () => {

  it('#11: Tenant-B cannot read tenant-A mission by known ID', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'known-mission-id', tenantId: TENANT_A });

    const { depsB } = createScopedTestDepsHelper(rawConn);
    const missions = createMissionStore();

    const result = missions.get(depsB, 'known-mission-id' as MissionId);
    assert.equal(result.ok, false, 'FM-10: tenant-B must not read tenant-A mission by known ID');
    if (!result.ok) {
      assert.equal(result.error.code, 'NOT_FOUND');
    }

    rawConn.close();
  });

  it('#12: Tenant-B cannot read tenant-A artifact by known ID', () => {
    const rawConn = createTestDatabase('row-level');
    const now = new Date().toISOString();
    seedMission(rawConn, { id: 'mission-art-guess', tenantId: TENANT_A });

    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['known-art-id', 1, 'mission-art-guess', TENANT_A, 'secret', 'data', 'json', '{"secret":true}', 'ACTIVE', 'task-1', 1, '{}', now],
    );

    const { depsB } = createScopedTestDepsHelper(rawConn);
    const artifacts = createArtifactStore();

    const result = artifacts.read(depsB, 'known-art-id', 'mission-art-guess' as MissionId);
    assert.equal(result.ok, false, 'FM-10: tenant-B must not read tenant-A artifact by known ID');

    rawConn.close();
  });

  it('#13: Tenant-B cannot consume tenant-A budget by known mission ID', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-budget-guess', tenantId: TENANT_A });
    seedResource(rawConn, { missionId: 'mission-budget-guess', tenantId: TENANT_A, tokenAllocated: 10000 });

    const { depsB } = createScopedTestDepsHelper(rawConn);
    const transitionService = createTestTransitionService(createTestAuditTrail());
    const budget = createBudgetGovernor(transitionService);

    // Tenant-B tries to consume tenant-A's budget
    const result = budget.consume(depsB, 'mission-budget-guess' as MissionId, { tokens: 100 });
    // Must fail — either NOT_FOUND or BUDGET_EXCEEDED because scoped query can't find the resource
    assert.equal(result.ok, false, 'FM-10: tenant-B must not consume tenant-A budget');

    rawConn.close();
  });
});

// ─── Category 6: Tenant_id immutability ───

describe('Layer 2B: Adversarial Tenant — Category 6: Tenant_id immutability triggers', () => {

  it('#14: UPDATE tenant_id on core_missions blocked by trigger', () => {
    const rawConn = createTestDatabase('row-level');
    seedMission(rawConn, { id: 'mission-immut', tenantId: TENANT_A });

    assert.throws(
      () => rawConn.run(
        'UPDATE core_missions SET tenant_id = ? WHERE id = ?',
        [TENANT_B, 'mission-immut'],
      ),
      /I-MUT: tenant_id is immutable/,
      'Trigger must block tenant_id mutation on core_missions',
    );

    rawConn.close();
  });

  it('#15: UPDATE tenant_id on core_tasks blocked by trigger', () => {
    const rawConn = createTestDatabase('row-level');
    const now = new Date().toISOString();
    seedMission(rawConn, { id: 'mission-tasks-immut', tenantId: TENANT_A });
    rawConn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ['tg-immut', 'mission-tasks-immut', TENANT_A, 1, 'aligned', now],
    );
    rawConn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-immut', 'mission-tasks-immut', TENANT_A, 'tg-immut', 'test', 'deterministic', 100, '[]', 'PENDING', now, now],
    );

    assert.throws(
      () => rawConn.run(
        'UPDATE core_tasks SET tenant_id = ? WHERE id = ?',
        [TENANT_B, 'task-immut'],
      ),
      /I-MUT: tenant_id is immutable/,
      'Trigger must block tenant_id mutation on core_tasks',
    );

    rawConn.close();
  });

  it('#16: UPDATE tenant_id on core_artifacts blocked by trigger', () => {
    const rawConn = createTestDatabase('row-level');
    const now = new Date().toISOString();
    seedMission(rawConn, { id: 'mission-art-immut', tenantId: TENANT_A });

    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-immut', 1, 'mission-art-immut', TENANT_A, 'test', 'data', 'json', 'data', 'ACTIVE', 'task-1', 1, '{}', now],
    );

    assert.throws(
      () => rawConn.run(
        'UPDATE core_artifacts SET tenant_id = ? WHERE id = ? AND version = ?',
        [TENANT_B, 'art-immut', 1],
      ),
      /I-MUT: tenant_id is immutable/,
      'Trigger must block tenant_id mutation on core_artifacts',
    );

    rawConn.close();
  });
});

// ─── Helper ───

function createScopedTestDepsHelper(rawConn: ReturnType<typeof createTestDatabase>) {
  const result = createScopedTestDeps(rawConn, TENANT_B);
  return { depsB: result.deps, auditB: result.audit };
}
