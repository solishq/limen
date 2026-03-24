/**
 * P0-A Individual Fix Tests
 *
 * Tests for Workstream B + C individual criticals from P0-A Structural Integrity Pass.
 *
 * C1: Namespace enforcer — gov_ prefix
 * C2: Vault store() transactionality (structural — INFRASTRUCTURE-BLOCKED for behavioral, see comment)
 * C3: Null-tenant claim handling (behavioral — F-P0A-009)
 * C5: Pipeline error code
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createNamespaceEnforcer } from '../../src/kernel/namespace/namespace_enforcer.js';
import { createClaimSystem } from '../../src/claims/harness/claim_harness.js';
import {
  createTestDatabase,
  createTestOperationContext,
  createTestAuditTrail,
  missionId,
  taskId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import type { ClaimSystem, ClaimSystemDeps, ClaimCreateInput, EvidenceSourceValidator } from '../../src/claims/interfaces/claim_types.js';

// ============================================================================
// C1: Namespace Enforcer — gov_ prefix
// ============================================================================

describe('P0-A C1: Namespace Enforcer — gov_ prefix', () => {
  it('C1 success: gov_ prefix is accepted as valid namespace', () => {
    const enforcer = createNamespaceEnforcer();
    const result = enforcer.validateMigration('CREATE TABLE gov_mission_contracts (id TEXT);');
    assert.equal(result.ok, true, 'gov_ prefix should be accepted');
  });

  it('C1 success: gov_ prefix accepted by isValidTableName', () => {
    const enforcer = createNamespaceEnforcer();
    assert.equal(enforcer.isValidTableName('gov_runs'), true, 'gov_runs should be valid');
    assert.equal(enforcer.isValidTableName('gov_attempts'), true, 'gov_attempts should be valid');
  });

  it('C1 rejection: invalid prefix is still rejected', () => {
    const enforcer = createNamespaceEnforcer();
    const result = enforcer.validateMigration('CREATE TABLE invalid_table (id TEXT);');
    assert.equal(result.ok, false, 'invalid_ prefix should be rejected');
    assert.ok(!result.ok && result.error.code === 'NAMESPACE_VIOLATION',
      'Should produce NAMESPACE_VIOLATION error');
  });

  it('C1 success: all 7 valid prefixes accepted', () => {
    const enforcer = createNamespaceEnforcer();
    const prefixes = ['core_', 'memory_', 'agent_', 'obs_', 'hitl_', 'meter_', 'gov_'];
    for (const prefix of prefixes) {
      assert.equal(
        enforcer.isValidTableName(`${prefix}test_table`), true,
        `${prefix} prefix should be valid`,
      );
    }
  });
});

// ============================================================================
// C2: Vault store() transactionality
// ============================================================================

describe('P0-A C2: Vault store() transactionality', () => {
  // C2 is verified structurally — the two conn.run() calls are now
  // wrapped in conn.transaction(). If the second fails, the first
  // rolls back. Full transactional behavior is verified by existing vault tests.
  //
  // F-P0A-009: Behavioral testing requires failure injection on the second SQL
  // operation (INSERT INTO core_encryption_keys) while the first succeeds (INSERT INTO
  // core_vault), then verifying the first is rolled back. The current test infra does
  // not support selective SQL failure injection. INFRASTRUCTURE-BLOCKED: Requires a
  // connection wrapper that can fail specific queries by pattern. Structural test retained.

  it('C2 success: vault store code wraps both SQL operations in transaction', async () => {
    // Structural verification: confirm the source contains conn.transaction()
    // wrapping both vault upsert and key metadata insert.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { dirname } = await import('node:path');

    const thisDir = dirname(fileURLToPath(import.meta.url));
    const cryptoPath = resolve(thisDir, '../../src/kernel/crypto/crypto_engine.ts');
    const source = readFileSync(cryptoPath, 'utf8');

    // Find the store method and verify transaction wrapping
    const storeMethodStart = source.indexOf('store(conn: DatabaseConnection');
    const storeMethodEnd = source.indexOf('retrieve(conn: DatabaseConnection');
    const storeMethod = source.slice(storeMethodStart, storeMethodEnd);

    assert.ok(
      storeMethod.includes('conn.transaction('),
      'Vault store() should wrap SQL operations in conn.transaction()',
    );

    // Verify both SQL operations are inside the transaction
    const txStart = storeMethod.indexOf('conn.transaction(');
    const afterTx = storeMethod.slice(txStart);
    assert.ok(
      afterTx.includes('INSERT INTO core_vault') && afterTx.includes('INSERT INTO core_encryption_keys'),
      'Both vault and encryption_keys inserts should be inside the transaction',
    );
  });
});

// ============================================================================
// C3: Null-Tenant Claim Handling — Behavioral Test (F-P0A-009)
// ============================================================================

// Helpers for claim system setup

function createMockEventBus(): import('../../src/kernel/interfaces/index.js').EventBus {
  return {
    emit(_conn: DatabaseConnection, _ctx: OperationContext, _event: unknown) {
      return { ok: true as const, value: 'evt-mock' as import('../../src/kernel/interfaces/index.js').EventId };
    },
    subscribe(_pattern: string, _handler: unknown) { return { ok: true as const, value: 'sub-mock' }; },
    unsubscribe(_id: string) { return { ok: true as const, value: undefined }; },
    registerWebhook(_conn: DatabaseConnection, _ctx: OperationContext, _pattern: string, _url: string, _secret: string) {
      return { ok: true as const, value: 'wh-mock' };
    },
    processWebhooks(_conn: DatabaseConnection) {
      return { ok: true as const, value: { delivered: 0, failed: 0, exhausted: 0 } };
    },
  } as import('../../src/kernel/interfaces/index.js').EventBus;
}

function createMockEvidenceValidator(): EvidenceSourceValidator {
  return {
    exists(_conn: DatabaseConnection, _type: string, _id: string, _tenantId: unknown) {
      return { ok: true as const, value: true };
    },
  };
}

describe('P0-A C3: Null-Tenant Claim Handling — Behavioral', () => {
  // F-P0A-009: Replaces structural test with behavioral verification.
  // Creates a claim with null tenant_id, retracts it, and verifies the claim
  // status is 'retracted' in the database. This exercises the IS operator fix
  // for NULL-safe comparison in claim_stores.ts retract().

  let conn: DatabaseConnection;
  let system: ClaimSystem;

  beforeEach(() => {
    conn = createTestDatabase();
    const deps: ClaimSystemDeps = {
      audit: createTestAuditTrail(),
      eventBus: createMockEventBus(),
      evidenceValidator: createMockEvidenceValidator(),
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    };
    system = createClaimSystem(deps);
  });

  it('C3 behavioral: claim with null tenant_id can be retracted successfully', () => {
    // Create an OperationContext with null tenantId
    const nullTenantCtx = createTestOperationContext({ tenantId: null });

    // Create a claim with null tenant_id
    const input: ClaimCreateInput = {
      subject: 'entity:test:null-tenant',
      predicate: 'test.retraction',
      object: { type: 'string', value: 'test-value' },
      confidence: 0.9,
      validAt: '2026-01-01T00:00:00.000Z',
      missionId: missionId('test-mission-c3'),
      evidenceRefs: [{ type: 'memory', id: 'mem-c3-001' }],
      groundingMode: 'evidence_path',
    };

    const createResult = system.assertClaim.execute(conn, nullTenantCtx, input);
    assert.ok(createResult.ok, `Claim creation must succeed, got: ${!createResult.ok ? createResult.error.message : ''}`);
    if (!createResult.ok) return;

    const claimId = createResult.value.claim.id;

    // Verify the claim exists with null tenant_id
    const claimRow = conn.get<{ tenant_id: string | null; status: string }>(
      'SELECT tenant_id, status FROM claim_assertions WHERE id = ?',
      [claimId],
    );
    assert.ok(claimRow, 'Claim must exist in database');
    assert.equal(claimRow!.tenant_id, null, 'Claim tenant_id must be null');
    assert.equal(claimRow!.status, 'active', 'Claim must be active before retraction');

    // Retract the claim with the same null-tenant context
    const retractResult = system.retractClaim.execute(conn, nullTenantCtx, {
      claimId,
      reason: 'C3 behavioral test: null-tenant retraction',
    });
    assert.ok(retractResult.ok, `Retraction must succeed with null tenant_id, got: ${!retractResult.ok ? retractResult.error.message : ''}`);

    // Verify claim status is 'retracted' in the database
    const afterRow = conn.get<{ status: string }>(
      'SELECT status FROM claim_assertions WHERE id = ?',
      [claimId],
    );
    assert.ok(afterRow, 'Claim must still exist after retraction');
    assert.equal(afterRow!.status, 'retracted',
      'Claim status must be "retracted" after retraction with null tenant_id');
  });
});

// ============================================================================
// C5: Pipeline Error Code
// ============================================================================

describe('P0-A C5: Pipeline Error Code', () => {
  it('C5 success: infer pipeline defensive path uses SCHEMA_VALIDATION_FAILED, not ENGINE_UNHEALTHY', async () => {
    // Structural verification: the unreachable code path after retry loop
    // should throw SCHEMA_VALIDATION_FAILED (accurate) not ENGINE_UNHEALTHY (misleading).

    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { dirname } = await import('node:path');

    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pipelinePath = resolve(thisDir, '../../src/api/infer/infer_pipeline.ts');
    const source = readFileSync(pipelinePath, 'utf8');

    // The defensive throw should NOT use ENGINE_UNHEALTHY
    const defensiveSection = source.slice(source.lastIndexOf('// Defensive'));
    assert.ok(
      !defensiveSection.includes("'ENGINE_UNHEALTHY'"),
      'Defensive unreachable path should not use ENGINE_UNHEALTHY',
    );
    assert.ok(
      defensiveSection.includes("'SCHEMA_VALIDATION_FAILED'"),
      'Defensive unreachable path should use SCHEMA_VALIDATION_FAILED',
    );
  });
});
