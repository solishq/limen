// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability docs/SPRP-PHASE-0.1-TRACEABILITY-FABRIC.md §2.1
/**
 * P0 Remediation Tests: FINDING-023 through FINDING-028
 *
 * These tests exercise the exact scenarios described in each finding,
 * verifying the defect exists before the fix and passes after.
 *
 * FINDING-023 (P0): consent.check() SQL parameter binding error
 * FINDING-024 (P1): Duplicate agent names accepted
 * FINDING-025 (P1): Consent revocation doesn't block subsequent PII writes
 * FINDING-026 (P1): Capability gating blocks after trust promotion
 * FINDING-027 (P1): Coordination tenant null mismatch in single-tenant mode
 * FINDING-028 (P1): Consent revoke can't find records registered in same session
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';
import type { SecurityPolicy } from '../../src/security/security_types.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-p0-remediation-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

function trackInstance(limen: Limen): Limen {
  instancesToShutdown.push(limen);
  return limen;
}

afterEach(async () => {
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* already shut down */ }
  }
  instancesToShutdown.length = 0;
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  dirsToClean.length = 0;
});

async function createConsentEnforcedLimen(dir: string): Promise<Limen> {
  const security: SecurityPolicy = {
    pii: { enabled: false, action: 'tag', categories: [] },
    injection: { enabled: false, action: 'tag' },
    poisoning: { enabled: false, burstLimit: 1000, windowSeconds: 60, subjectDiversityMin: 1 },
    consent: { required: true, scope: 'claim_assertion' },
  };
  return createLimen({ dataDir: dir, masterKey: makeKey(), security });
}

async function createDefaultLimen(dir: string): Promise<Limen> {
  return createLimen({ dataDir: dir, masterKey: makeKey() });
}

// ============================================================================
// FINDING-023 (P0): consent.check() SQL parameter binding
// ============================================================================

describe('FINDING-023: consent.check() SQL parameter binding', () => {
  it('check() returns active consent record after registration (single-tenant)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    // Register consent
    const reg = limen.consent.register({
      dataSubjectId: 'user:alice',
      basis: 'explicit_consent',
      scope: 'claim_assertion',
    });
    assert.ok(reg.ok, `register should succeed: ${JSON.stringify(reg)}`);

    // Check consent — this is the P0 path
    const check = limen.consent.check('user:alice', 'claim_assertion');
    assert.ok(check.ok, `check should succeed (not SQL error): ${JSON.stringify(check)}`);
    assert.ok(check.value !== null, 'check should find the active consent');
    assert.equal(check.value!.status, 'active', 'consent should be active');
    assert.equal(check.value!.dataSubjectId, 'user:alice');
  });

  it('check() returns null when no consent exists', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    const check = limen.consent.check('user:nonexistent', 'claim_assertion');
    assert.ok(check.ok, `check should succeed (not error): ${JSON.stringify(check)}`);
    assert.equal(check.value, null, 'should return null for no matching consent');
  });
});

// ============================================================================
// FINDING-024 (P1): Duplicate agent names accepted
// ============================================================================

describe('FINDING-024: Duplicate agent names rejected per tenant', () => {
  it('second registerAgent with same name (same framework, same tenant) is rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    const reg1 = await limen.lifecycle.registerAgent({
      name: 'test-agent',
      framework: 'claude',
      version: '1.0',
      capabilities: ['memory_read'],
      owner: 'user-1',
    });
    assert.ok(reg1.ok, `first registration should succeed: ${JSON.stringify(reg1)}`);

    const reg2 = await limen.lifecycle.registerAgent({
      name: 'test-agent',
      framework: 'claude',
      version: '2.0',
      capabilities: ['memory_read'],
      owner: 'user-2',
    });
    assert.ok(!reg2.ok, 'second registration with same name+framework should fail');
  });

  it('same name with DIFFERENT framework is accepted (unique per name+framework+tenant)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    const reg1 = await limen.lifecycle.registerAgent({
      name: 'test-agent',
      framework: 'claude',
      version: '1.0',
      capabilities: ['memory_read'],
      owner: 'user-1',
    });
    assert.ok(reg1.ok, 'first registration should succeed');

    const reg2 = await limen.lifecycle.registerAgent({
      name: 'test-agent',
      framework: 'codex',
      version: '1.0',
      capabilities: ['memory_read'],
      owner: 'user-1',
    });
    // Current schema allows same name with different framework — this is BY DESIGN
    // The unique constraint is (name, framework, tenant_id).
    // FINDING-024 says "names must be unique per tenant" — but the migration has
    // the constraint on (name, framework, COALESCE(tenant_id, '__NULL__')).
    // We need to tighten to (name, COALESCE(tenant_id, '__NULL__')) alone.
    assert.ok(!reg2.ok, 'same name with different framework should also be rejected per F-024');
  });
});

// ============================================================================
// FINDING-025 (P1): Consent revocation doesn't block subsequent PII writes
// ============================================================================

describe('FINDING-025: Consent revocation blocks subsequent PII writes', () => {
  it('PII write blocked after consent revocation', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createConsentEnforcedLimen(dir));

    // Register consent
    const reg = limen.consent.register({
      dataSubjectId: 'user:charlie',
      basis: 'explicit_consent',
      scope: 'claim_assertion',
    });
    assert.ok(reg.ok, 'consent register should succeed');

    // Write PII — should succeed
    const write1 = limen.remember('entity:user:charlie', 'personal.name', 'Charlie Brown');
    assert.ok(write1.ok, 'PII write should succeed with active consent');

    // Revoke consent
    const revoke = limen.consent.revoke(reg.value!.id);
    assert.ok(revoke.ok, `consent revoke should succeed: ${JSON.stringify(revoke)}`);

    // Write PII again — should be BLOCKED
    const write2 = limen.remember('entity:user:charlie', 'personal.email', 'charlie@example.com');
    assert.ok(!write2.ok, 'PII write should be blocked after consent revocation');
    assert.equal(write2.error?.code, 'CONSENT_REQUIRED', `error should be CONSENT_REQUIRED, got: ${write2.error?.code}`);
  });
});

// ============================================================================
// FINDING-026 (P1): Capability gating blocks after trust promotion
// ============================================================================

describe('FINDING-026: Capabilities expand after trust promotion', () => {
  it('agent gains knowledge_export capability after promotion to medium', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    // Register agent requesting knowledge_export (requires medium trust)
    const reg = await limen.lifecycle.registerAgent({
      name: 'capable-agent',
      framework: 'claude',
      version: '1.0',
      capabilities: ['memory_read', 'memory_write', 'knowledge_export'],
      owner: 'user-1',
    });
    assert.ok(reg.ok, 'registration should succeed');
    const agentId = reg.value!.id;

    // At untrusted, knowledge_export should NOT be granted
    const capsAtUntrusted = await limen.lifecycle.getCapabilities(agentId);
    assert.ok(capsAtUntrusted.ok);
    assert.ok(!capsAtUntrusted.value!.granted.includes('knowledge_export'),
      'knowledge_export should not be granted at untrusted level');

    // Promote to low
    const promo1 = await limen.lifecycle.promoteAgent(agentId, {
      targetLevel: 'low',
      justification: 'test',
      evidence: [],
    });
    assert.ok(promo1.ok, `promotion to low should succeed: ${JSON.stringify(promo1)}`);

    // Promote to medium (requires evidence)
    const promo2 = await limen.lifecycle.promoteAgent(agentId, {
      targetLevel: 'medium',
      justification: 'test',
      evidence: [
        { type: 'session_count', value: 50, description: '50 sessions completed' },
        { type: 'governance_compliance', value: 0, description: 'no refusals' },
      ],
    });
    assert.ok(promo2.ok, `promotion to medium should succeed: ${JSON.stringify(promo2)}`);

    // After promotion, knowledge_export SHOULD be available
    const capsAfterPromo = await limen.lifecycle.getCapabilities(agentId);
    assert.ok(capsAfterPromo.ok);
    assert.ok(capsAfterPromo.value!.granted.includes('knowledge_export'),
      'knowledge_export should be granted after promotion to medium');
  });
});

// ============================================================================
// FINDING-027 (P1): Coordination tenant null in single-tenant mode
// ============================================================================

describe('FINDING-027: Coordination operations work in single-tenant mode', () => {
  it('registerA2ARule succeeds in single-tenant mode (tenantId=null)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    // In single-tenant mode, the operation context has tenantId=null.
    // Coordination operations should accept null tenantId in this mode.
    const result = await limen.coordination.registerA2ARule({
      sourceAgent: '*',
      targetAgent: '*',
      skill: '*',
      action: 'allow',
    });
    assert.ok(result.ok, `registerA2ARule should succeed in single-tenant mode: ${JSON.stringify(result)}`);
  });

  it('validateA2AAction succeeds in single-tenant mode', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    const result = await limen.coordination.validateA2AAction(
      { domain: 'knowledge', operation: 'share' },
      'target-agent-id' as any,
    );
    assert.ok(result.ok, `validateA2AAction should succeed in single-tenant mode: ${JSON.stringify(result)}`);
  });
});

// ============================================================================
// FINDING-028 (P1): Consent revoke can't find records registered in same session
// ============================================================================

describe('FINDING-028: Consent revoke finds records registered in same session', () => {
  it('register then immediately revoke by returned id', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    const reg = limen.consent.register({
      dataSubjectId: 'user:dana',
      basis: 'explicit_consent',
      scope: 'analytics',
    });
    assert.ok(reg.ok, `register should succeed: ${JSON.stringify(reg)}`);

    const consentId = reg.value!.id;
    assert.ok(consentId, 'consent id should be present');

    // Immediately revoke — should find the record
    const revoke = limen.consent.revoke(consentId);
    assert.ok(revoke.ok, `revoke should find and revoke the record: ${JSON.stringify(revoke)}`);
    assert.equal(revoke.value!.status, 'revoked', 'revoked consent should have status=revoked');
  });

  it('revoke works with multiple consent records for same subject', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createDefaultLimen(dir));

    const reg1 = limen.consent.register({
      dataSubjectId: 'user:eva',
      basis: 'explicit_consent',
      scope: 'marketing',
    });
    assert.ok(reg1.ok);

    const reg2 = limen.consent.register({
      dataSubjectId: 'user:eva',
      basis: 'explicit_consent',
      scope: 'analytics',
    });
    assert.ok(reg2.ok);

    // Revoke only the second one
    const revoke = limen.consent.revoke(reg2.value!.id);
    assert.ok(revoke.ok, `revoke should succeed: ${JSON.stringify(revoke)}`);

    // First should still be active
    const check = limen.consent.check('user:eva', 'marketing');
    assert.ok(check.ok);
    assert.ok(check.value !== null, 'first consent should still be active');
    assert.equal(check.value!.status, 'active');
  });
});
