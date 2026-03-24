/**
 * Layer 4: System Operations Verification Tests
 * Verifies: SYSTEM_SCOPE paths work correctly — expireOverdue() operates across
 * all tenants, audit hash chain maintains global integrity through scoped connections,
 * verifyChain() validates multi-tenant chains.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * FM-10: tenant isolation must not break system-level operations
 * DEC-CERT-001: audit trail bypasses TenantScopedConnection — global hash chain
 * §3.5: hash chain is monotonic across all tenants
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
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import { createTenantScopedConnection } from '../../src/kernel/tenant/tenant_scope.js';
import type { OrchestrationDeps } from '../../src/orchestration/interfaces/orchestration.js';

// ─── Constants ───

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

// ─── Helper: create checkpoint coordinator deps with raw and scoped connections ───

function createSubstrateStub(): OrchestrationDeps['substrate'] {
  const notImplemented = () => { throw new Error('Substrate stub'); };
  return {
    scheduler: { enqueue: notImplemented, dequeue: notImplemented, peek: notImplemented, size: notImplemented, clear: notImplemented },
    workerPool: { dispatch: notImplemented, getWorker: notImplemented, shutdown: notImplemented, getMetrics: notImplemented },
    gateway: { sendRequest: notImplemented, requestStream: notImplemented, getProviderHealth: notImplemented, registerProvider: notImplemented },
    heartbeat: { start: notImplemented, stop: notImplemented, check: notImplemented, getStatus: notImplemented },
    accounting: { recordInteraction: notImplemented, getAccountingSummary: notImplemented, checkRateLimit: notImplemented, consumeRateLimit: notImplemented },
    shutdown: notImplemented,
  } as unknown as OrchestrationDeps['substrate'];
}

// ─── Layer 4: System Operations Verification ───

describe('Layer 4: System Operations Verification (FM-10, DEC-CERT-001)', () => {

  // Test 1: expireOverdue() expires checkpoints across ALL tenants
  it('#1: expireOverdue() expires checkpoints for both tenant-A and tenant-B', () => {
    const rawConn = createTestDatabase('row-level');
    const audit = createTestAuditTrail();
    const transitionService = createTestTransitionService(audit);
    const coordinator = createCheckpointCoordinator(transitionService);
    const now = new Date().toISOString();
    const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    // Seed missions for both tenants
    seedMission(rawConn, { id: 'mission-exp-A', tenantId: TENANT_A });
    seedMission(rawConn, { id: 'mission-exp-B', tenantId: TENANT_B });

    // Seed PENDING checkpoints for BOTH tenants with expired timeout
    rawConn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['cp-A', 'mission-exp-A', TENANT_A, 'BUDGET_THRESHOLD', '{}', 'PENDING', pastTime, now],
    );
    rawConn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['cp-B', 'mission-exp-B', TENANT_B, 'TASK_COMPLETED', '{}', 'PENDING', pastTime, now],
    );

    // Create scoped deps for tenant-A (simulates a per-request context)
    const scopedConn = createTenantScopedConnection(rawConn, tenantId(TENANT_A));
    const scopedDeps: OrchestrationDeps = Object.freeze({
      conn: scopedConn,
      substrate: createSubstrateStub(),
      audit,
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    });

    // Call expireOverdue with scoped deps — it MUST unwrap to raw and expire BOTH
    const result = coordinator.expireOverdue(scopedDeps);

    assert.equal(result.ok, true, 'expireOverdue must succeed');
    if (result.ok) {
      assert.equal(
        result.value, 2,
        'SYSTEM_SCOPE: expireOverdue must expire checkpoints for ALL tenants, not just the scoped one',
      );
    }

    // Verify both checkpoints are EXPIRED
    const cpA = rawConn.get<{ state: string }>(
      'SELECT state FROM core_checkpoints WHERE id = ?', ['cp-A'],
    );
    const cpB = rawConn.get<{ state: string }>(
      'SELECT state FROM core_checkpoints WHERE id = ?', ['cp-B'],
    );
    assert.equal(cpA?.state, 'EXPIRED', 'Tenant-A checkpoint must be EXPIRED');
    assert.equal(cpB?.state, 'EXPIRED', 'Tenant-B checkpoint must be EXPIRED');

    rawConn.close();
  });

  // Test 2: expireOverdue() with raw deps also works (no regression)
  it('#2: expireOverdue() with raw deps works correctly', () => {
    const rawConn = createTestDatabase('row-level');
    const audit = createTestAuditTrail();
    const transitionService = createTestTransitionService(audit);
    const coordinator = createCheckpointCoordinator(transitionService);
    const now = new Date().toISOString();
    const pastTime = new Date(Date.now() - 60000).toISOString();

    seedMission(rawConn, { id: 'mission-raw', tenantId: TENANT_A });
    rawConn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['cp-raw', 'mission-raw', TENANT_A, 'BUDGET_THRESHOLD', '{}', 'PENDING', pastTime, now],
    );

    const rawDeps: OrchestrationDeps = Object.freeze({
      conn: rawConn,
      substrate: createSubstrateStub(),
      audit,
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    });

    const result = coordinator.expireOverdue(rawDeps);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value, 1, 'Must expire the one overdue checkpoint');
    }

    rawConn.close();
  });

  // Test 3: Audit hash chain maintains global integrity through scoped connections
  it('#3: audit.append() through scoped connection maintains global hash chain', () => {
    const rawConn = createTestDatabase('row-level');
    const audit = createTestAuditTrail();

    // Create scoped connection for tenant-A
    const scopedConnA = createTenantScopedConnection(rawConn, tenantId(TENANT_A));

    // Append audit entries through scoped connection for different tenants
    const entry1 = audit.append(scopedConnA, {
      tenantId: tenantId(TENANT_A),
      actorType: 'user',
      actorId: 'user-A',
      operation: 'test_op_1',
      resourceType: 'mission',
      resourceId: 'mission-1',
    });

    // Create scoped connection for tenant-B
    const scopedConnB = createTenantScopedConnection(rawConn, tenantId(TENANT_B));

    const entry2 = audit.append(scopedConnB, {
      tenantId: tenantId(TENANT_B),
      actorType: 'user',
      actorId: 'user-B',
      operation: 'test_op_2',
      resourceType: 'mission',
      resourceId: 'mission-2',
    });

    const entry3 = audit.append(scopedConnA, {
      tenantId: tenantId(TENANT_A),
      actorType: 'system',
      actorId: 'system',
      operation: 'test_op_3',
      resourceType: 'artifact',
      resourceId: 'artifact-1',
    });

    // All three must succeed
    assert.equal(entry1.ok, true, 'Entry 1 must succeed');
    assert.equal(entry2.ok, true, 'Entry 2 must succeed');
    assert.equal(entry3.ok, true, 'Entry 3 must succeed');

    if (entry1.ok && entry2.ok && entry3.ok) {
      // §3.5: seq_no must be strictly monotonic across tenants
      assert.equal(entry1.value.seqNo, 1, 'First entry seq_no = 1');
      assert.equal(entry2.value.seqNo, 2, 'Second entry seq_no = 2 (different tenant)');
      assert.equal(entry3.value.seqNo, 3, 'Third entry seq_no = 3 (back to tenant-A)');

      // Hash chain: entry 2 links to entry 1, entry 3 links to entry 2
      assert.equal(
        entry2.value.previousHash, entry1.value.currentHash,
        '§3.5: Entry 2 previous_hash must link to entry 1 current_hash (cross-tenant chain)',
      );
      assert.equal(
        entry3.value.previousHash, entry2.value.currentHash,
        '§3.5: Entry 3 previous_hash must link to entry 2 current_hash',
      );
    }

    rawConn.close();
  });

  // Test 4: verifyChain() validates global chain with multi-tenant entries
  it('#4: verifyChain() validates global chain with multi-tenant entries', () => {
    const rawConn = createTestDatabase('row-level');
    const audit = createTestAuditTrail();

    // Append entries for both tenants through scoped connections
    const scopedA = createTenantScopedConnection(rawConn, tenantId(TENANT_A));
    const scopedB = createTenantScopedConnection(rawConn, tenantId(TENANT_B));

    audit.append(scopedA, {
      tenantId: tenantId(TENANT_A),
      actorType: 'user', actorId: 'u-A',
      operation: 'op_A1', resourceType: 'mission', resourceId: 'res-A1',
    });
    audit.append(scopedB, {
      tenantId: tenantId(TENANT_B),
      actorType: 'user', actorId: 'u-B',
      operation: 'op_B1', resourceType: 'mission', resourceId: 'res-B1',
    });
    audit.append(scopedA, {
      tenantId: tenantId(TENANT_A),
      actorType: 'system', actorId: 'sys',
      operation: 'op_A2', resourceType: 'artifact', resourceId: 'res-A2',
    });

    // Verify global chain (no tenant filter) — must be valid
    const globalResult = audit.verifyChain(rawConn);
    assert.equal(globalResult.ok, true, 'verifyChain must succeed');
    if (globalResult.ok) {
      assert.equal(globalResult.value.valid, true, 'Global chain must be valid');
      assert.equal(globalResult.value.totalEntries, 3, 'Must have 3 entries');
      assert.equal(globalResult.value.firstSeqNo, 1);
      assert.equal(globalResult.value.lastSeqNo, 3);
      assert.equal(globalResult.value.brokenAt, null, 'No breaks in chain');
    }

    rawConn.close();
  });

  // Test 5: verifyChain() with tenant filter returns tenant-specific subset
  it('#5: verifyChain() with tenant filter returns correct subset', () => {
    const rawConn = createTestDatabase('row-level');
    const audit = createTestAuditTrail();

    const scopedA = createTenantScopedConnection(rawConn, tenantId(TENANT_A));
    const scopedB = createTenantScopedConnection(rawConn, tenantId(TENANT_B));

    // 2 entries for tenant-A, 1 for tenant-B
    audit.append(scopedA, {
      tenantId: tenantId(TENANT_A),
      actorType: 'user', actorId: 'u-A',
      operation: 'op1', resourceType: 'mission', resourceId: 'r1',
    });
    audit.append(scopedB, {
      tenantId: tenantId(TENANT_B),
      actorType: 'user', actorId: 'u-B',
      operation: 'op2', resourceType: 'mission', resourceId: 'r2',
    });
    audit.append(scopedA, {
      tenantId: tenantId(TENANT_A),
      actorType: 'system', actorId: 'sys',
      operation: 'op3', resourceType: 'artifact', resourceId: 'r3',
    });

    // Verify tenant-A subset
    const tenantAResult = audit.verifyChain(rawConn, tenantId(TENANT_A));
    assert.equal(tenantAResult.ok, true, 'verifyChain for tenant-A must succeed');
    if (tenantAResult.ok) {
      assert.equal(tenantAResult.value.totalEntries, 2, 'Tenant-A must have 2 entries');
    }

    // Verify tenant-B subset
    const tenantBResult = audit.verifyChain(rawConn, tenantId(TENANT_B));
    assert.equal(tenantBResult.ok, true, 'verifyChain for tenant-B must succeed');
    if (tenantBResult.ok) {
      assert.equal(tenantBResult.value.totalEntries, 1, 'Tenant-B must have 1 entry');
    }

    rawConn.close();
  });

  // Test 6: expireOverdue() does NOT expire non-overdue checkpoints
  it('#6: expireOverdue() only expires checkpoints past timeout, not future ones', () => {
    const rawConn = createTestDatabase('row-level');
    const audit = createTestAuditTrail();
    const transitionService = createTestTransitionService(audit);
    const coordinator = createCheckpointCoordinator(transitionService);
    const now = new Date().toISOString();
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const futureTime = new Date(Date.now() + 3600000).toISOString();

    seedMission(rawConn, { id: 'mission-mix', tenantId: TENANT_A });

    // One expired, one not yet due
    rawConn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['cp-past', 'mission-mix', TENANT_A, 'BUDGET_THRESHOLD', '{}', 'PENDING', pastTime, now],
    );
    rawConn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['cp-future', 'mission-mix', TENANT_A, 'BUDGET_THRESHOLD', '{}', 'PENDING', futureTime, now],
    );

    const rawDeps: OrchestrationDeps = Object.freeze({
      conn: rawConn,
      substrate: createSubstrateStub(),
      audit,
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    });

    const result = coordinator.expireOverdue(rawDeps);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value, 1, 'Only the past-due checkpoint should expire');
    }

    const cpFuture = rawConn.get<{ state: string }>(
      'SELECT state FROM core_checkpoints WHERE id = ?', ['cp-future'],
    );
    assert.equal(cpFuture?.state, 'PENDING', 'Future checkpoint must remain PENDING');

    rawConn.close();
  });
});
