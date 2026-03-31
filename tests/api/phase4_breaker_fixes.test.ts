/**
 * Phase 4 Breaker Fix Cycle: Discriminative tests for 6 HIGH findings.
 *
 * Each test kills a specific surviving mutation identified in PHASE-4-BREAKER-REPORT.md.
 * Structure: One describe block per finding, with [A21] dual-path tests.
 *
 * F-P4-001: Retraction reason taxonomy (M-9 + M-15)
 * F-P4-002: Cascade penalty in query/recall path (M-8)
 * F-P4-003: Cascade penalty in search path (M-8)
 * F-P4-004: RBAC enforcement with requireRbac=true (M-11)
 * F-P4-005: .raw audit logging (M-12)
 * F-P4-006: .raw RBAC tag enforcement (M-13)
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';
import { createRbacEngine } from '../../src/kernel/rbac/rbac_engine.js';
import {
  createTenantScopedConnection,
} from '../../src/kernel/tenant/tenant_scope.js';
import type { RawAccessConfig, RawAccessAuditLogger } from '../../src/kernel/tenant/tenant_scope.js';
import { createTestDatabase, tenantId } from '../helpers/test_database.js';
import type { Permission, OperationContext, TenantId } from '../../src/kernel/interfaces/index.js';

// ── Test Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-p4fix-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirs: string[] = [];
const instances: Limen[] = [];

function trackDir(d: string): string { dirs.push(d); return d; }
function trackInstance(l: Limen): Limen { instances.push(l); return l; }

after(async () => {
  for (const inst of instances) {
    try { await inst.shutdown(); } catch { /* ignore */ }
  }
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  instances.length = 0;
  dirs.length = 0;
});

async function createTestLimen(overrides?: {
  requireRbac?: boolean;
  autoConflict?: boolean;
}): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  return trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
      ...(overrides?.requireRbac !== undefined ? { requireRbac: overrides.requireRbac } : {}),
      ...(overrides?.autoConflict !== undefined ? { autoConflict: overrides.autoConflict } : {}),
    }),
  );
}

// ============================================================================
// F-P4-001: Retraction Reason Taxonomy (Kills M-9 + M-15)
// ============================================================================

describe('F-P4-001: Retraction reason taxonomy validation', () => {
  it('DC-P4-104 rejection: forget() with invalid reason returns CONV_INVALID_REASON error', async () => {
    // KILLS M-15 (convenience_layer.ts:306 bypass)
    // If the convenience layer reason validation is removed (M-15), this test fails
    // because an invalid reason would either succeed or propagate to store level.
    const limen = await createTestLimen();

    const r = limen.remember('entity:test:reason-invalid', 'test.data', 'value');
    assert.ok(r.ok);
    if (!r.ok) return;

    // Pass an invalid reason that is NOT in the taxonomy
    const result = limen.forget(r.value.claimId, 'invalid_reason' as any);
    assert.strictEqual(result.ok, false, 'forget() with invalid reason must fail');
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'CONV_INVALID_REASON',
        'Error code must be CONV_INVALID_REASON');
    }
  });

  it('DC-P4-104 rejection: forget() with empty string reason returns error', async () => {
    // KILLS M-15 partial: empty string is also invalid
    const limen = await createTestLimen();

    const r = limen.remember('entity:test:reason-empty', 'test.data', 'value');
    assert.ok(r.ok);
    if (!r.ok) return;

    const result = limen.forget(r.value.claimId, '' as any);
    assert.strictEqual(result.ok, false, 'forget() with empty reason must fail');
  });

  it('DC-P4-104 success: forget() with reason=incorrect succeeds', async () => {
    const limen = await createTestLimen();

    const r = limen.remember('entity:test:reason-ok1', 'test.data', 'value');
    assert.ok(r.ok);
    if (!r.ok) return;

    const result = limen.forget(r.value.claimId, 'incorrect');
    assert.ok(result.ok, `forget() with reason=incorrect must succeed: ${!result.ok ? result.error.message : ''}`);
  });

  it('DC-P4-104 success: forget() with reason=manual succeeds', async () => {
    const limen = await createTestLimen();

    const r = limen.remember('entity:test:reason-ok2', 'test.data', 'value');
    assert.ok(r.ok);
    if (!r.ok) return;

    const result = limen.forget(r.value.claimId, 'manual');
    assert.ok(result.ok, `forget() with reason=manual must succeed: ${!result.ok ? result.error.message : ''}`);
  });

  it('DC-P4-602 rejection: forget() with arbitrary text reason returns error', async () => {
    // KILLS M-9 (claim_stores.ts:1538 bypass) via M-15 (convenience layer)
    // Tests multiple invalid values to ensure taxonomy is enforced, not just one value
    const limen = await createTestLimen();

    const invalidReasons = ['foo', 'INCORRECT', 'deleted', 'obsolete', 'wrong'];

    for (const reason of invalidReasons) {
      const r = limen.remember('entity:test:reason-arb', 'test.data', `value-${reason}`);
      assert.ok(r.ok);
      if (!r.ok) continue;

      const result = limen.forget(r.value.claimId, reason as any);
      assert.strictEqual(result.ok, false,
        `forget() with reason='${reason}' must be rejected by taxonomy validation`);
    }
  });
});

// ============================================================================
// F-P4-002 + F-P4-003: Cascade Penalty in Query and Search Paths (Kills M-8)
// ============================================================================

describe('F-P4-002: Cascade penalty in recall() path', () => {
  it('DC-P4-203 rejection: claim with retracted parent has reduced effectiveConfidence', async () => {
    // KILLS M-8 (claim_stores.ts:534 bypass)
    // If cascade penalty is hardcoded to 1.0 in the query path, this test fails
    // because effectiveConfidence would NOT be reduced by the retraction.
    const limen = await createTestLimen();

    // 1. Create parent claim A
    const parentResult = limen.remember(
      'entity:test:cascade-parent', 'cascade.test', 'parent-value',
      { validAt: '2020-01-01T00:00:00.000Z' },
    );
    assert.ok(parentResult.ok, `Parent remember: ${!parentResult.ok ? parentResult.error.message : ''}`);
    if (!parentResult.ok) return;

    // 2. Create child claim B
    const childResult = limen.remember(
      'entity:test:cascade-child', 'cascade.test', 'child-value',
      { validAt: '2020-01-01T00:00:00.000Z' },
    );
    assert.ok(childResult.ok, `Child remember: ${!childResult.ok ? childResult.error.message : ''}`);
    if (!childResult.ok) return;

    // 3. Connect B derived_from A
    const connectResult = limen.connect(
      childResult.value.claimId,
      parentResult.value.claimId,
      'derived_from',
    );
    assert.ok(connectResult.ok, `Connect: ${!connectResult.ok ? connectResult.error.message : ''}`);

    // 4. Recall B BEFORE retraction — get baseline effectiveConfidence
    const preRetract = limen.recall('entity:test:cascade-child', 'cascade.test');
    assert.ok(preRetract.ok);
    if (!preRetract.ok) return;
    const preChild = preRetract.value.find(b => b.claimId === childResult.value.claimId);
    assert.ok(preChild, 'Child claim must be in pre-retraction recall results');
    const preEffConf = preChild!.effectiveConfidence;

    // 5. Retract parent A
    const forgetResult = limen.forget(parentResult.value.claimId, 'incorrect');
    assert.ok(forgetResult.ok, `Forget: ${!forgetResult.ok ? forgetResult.error.message : ''}`);

    // 6. Recall B AFTER retraction — effectiveConfidence must be reduced
    const postRetract = limen.recall('entity:test:cascade-child', 'cascade.test');
    assert.ok(postRetract.ok);
    if (!postRetract.ok) return;
    const postChild = postRetract.value.find(b => b.claimId === childResult.value.claimId);
    assert.ok(postChild, 'Child claim must be in post-retraction recall results');
    const postEffConf = postChild!.effectiveConfidence;

    // The cascade penalty is 0.5 for first-degree retracted parent.
    // So postEffConf should be approximately preEffConf * 0.5
    // With some tolerance for decay changes between the two recall() calls.
    assert.ok(
      postEffConf < preEffConf * 0.75,
      `Cascade penalty must reduce effectiveConfidence. Pre: ${preEffConf}, Post: ${postEffConf}. ` +
      `Expected post < pre * 0.75 (penalty = 0.5). If post ~= pre, M-8 mutation survived.`,
    );

    // Verify the ratio is approximately 0.5 (cascade first-degree multiplier)
    const ratio = postEffConf / preEffConf;
    assert.ok(
      Math.abs(ratio - 0.5) < 0.1,
      `Penalty ratio should be ~0.5 (first-degree), got ${ratio.toFixed(4)}`,
    );
  });

  it('DC-P4-203 success: claim with NO derived_from edges has full effectiveConfidence', async () => {
    // Confirms the penalty is not universally applied — only when derived_from parent is retracted
    const limen = await createTestLimen();

    const r = limen.remember(
      'entity:test:cascade-none', 'cascade.baseline', 'value',
      { validAt: '2020-01-01T00:00:00.000Z' },
    );
    assert.ok(r.ok);
    if (!r.ok) return;

    const recalled = limen.recall('entity:test:cascade-none', 'cascade.baseline');
    assert.ok(recalled.ok);
    if (!recalled.ok) return;

    const belief = recalled.value.find(b => b.claimId === r.value.claimId);
    assert.ok(belief);
    // No cascade penalty, so effectiveConfidence = confidence * decay only
    // confidence is capped at maxAutoConfidence (0.7 default)
    // decay for a claim from 2020 will be significant, but cascade penalty = 1.0
    assert.ok(belief!.effectiveConfidence > 0, 'effectiveConfidence must be > 0');
  });
});

describe('F-P4-003: Cascade penalty in search() path', () => {
  it('DC-P4-203 rejection: search score for claim with retracted parent reflects cascade penalty', async () => {
    // KILLS M-8 (claim_stores.ts:755 bypass)
    // If cascade penalty is hardcoded to 1.0 in the search path, this test fails.
    const limen = await createTestLimen();

    // 1. Create two claims with searchable content
    const parentResult = limen.remember(
      'entity:test:search-parent', 'search.cascade', 'searchable alpha information',
      { validAt: '2020-01-01T00:00:00.000Z' },
    );
    assert.ok(parentResult.ok);
    if (!parentResult.ok) return;

    const childResult = limen.remember(
      'entity:test:search-child', 'search.cascade', 'searchable alpha information derived',
      { validAt: '2020-01-01T00:00:00.000Z' },
    );
    assert.ok(childResult.ok);
    if (!childResult.ok) return;

    // 2. Connect child derived_from parent
    const connectResult = limen.connect(
      childResult.value.claimId,
      parentResult.value.claimId,
      'derived_from',
    );
    assert.ok(connectResult.ok);

    // 3. Search BEFORE retraction
    const prSearch = limen.search('searchable alpha information');
    assert.ok(prSearch.ok);
    if (!prSearch.ok) return;
    const preChild = prSearch.value.find(sr => sr.belief.claimId === childResult.value.claimId);
    assert.ok(preChild, 'Child must appear in pre-retraction search results');
    const preScore = preChild!.score;

    // 4. Retract parent
    const forgetResult = limen.forget(parentResult.value.claimId, 'incorrect');
    assert.ok(forgetResult.ok);

    // 5. Search AFTER retraction — child's score must be reduced
    const postSearch = limen.search('searchable alpha information');
    assert.ok(postSearch.ok);
    if (!postSearch.ok) return;
    const postChild = postSearch.value.find(sr => sr.belief.claimId === childResult.value.claimId);
    assert.ok(postChild, 'Child must appear in post-retraction search results');
    const postScore = postChild!.score;

    // Score = -bm25 * effectiveConfidence. With cascade penalty 0.5,
    // effectiveConfidence drops by ~50%, so score should drop proportionally.
    assert.ok(
      postScore < preScore * 0.75,
      `Search score must reflect cascade penalty. Pre: ${preScore}, Post: ${postScore}. ` +
      `If post ~= pre, M-8 mutation survived in search path.`,
    );
  });
});

// ============================================================================
// F-P4-004: RBAC Enforcement with requireRbac=true (Kills M-11)
// ============================================================================

describe('F-P4-004: RBAC enforcement when requireRbac=true', () => {
  it('DC-P4-401 rejection: createRbacEngine with forceActive=true rejects empty-permission context', () => {
    // KILLS M-11 (rbac_engine.ts:82 bypass)
    // If `if (forceActive)` is changed to `if (false && forceActive)`, RBAC stays dormant
    // and checkPermission always returns true. This test verifies forceActive activates RBAC.
    const rbac = createRbacEngine(undefined, true);

    // Verify RBAC is active
    assert.strictEqual(rbac.isActive(), true,
      'RBAC must be active when forceActive=true. If false, M-11 mutation survived.');

    // Context with no permissions
    const emptyCtx: OperationContext = {
      tenantId: null,
      userId: null,
      agentId: null,
      permissions: new Set<Permission>(),
    };

    // checkPermission must deny
    const result = rbac.checkPermission(emptyCtx, 'create_mission');
    assert.ok(result.ok, 'checkPermission call itself must succeed (ok=true)');
    assert.strictEqual(result.value, false,
      'Permission check must DENY when context has no permissions and RBAC is active');
  });

  it('DC-P4-401 success: createRbacEngine with forceActive=true allows properly-permissioned context', () => {
    const rbac = createRbacEngine(undefined, true);

    const ctx: OperationContext = {
      tenantId: null,
      userId: null,
      agentId: null,
      permissions: new Set<Permission>(['create_mission']),
    };

    const result = rbac.checkPermission(ctx, 'create_mission');
    assert.ok(result.ok);
    assert.strictEqual(result.value, true,
      'Permission check must ALLOW when context has the required permission');
  });

  it('DC-P4-401: createRbacEngine without forceActive stays dormant (allows all)', () => {
    // Contrast test: without forceActive, RBAC is dormant
    const rbac = createRbacEngine(undefined, false);

    assert.strictEqual(rbac.isActive(), false,
      'RBAC must be dormant when forceActive=false');

    const emptyCtx: OperationContext = {
      tenantId: null,
      userId: null,
      agentId: null,
      permissions: new Set<Permission>(),
    };

    const result = rbac.checkPermission(emptyCtx, 'create_mission');
    assert.ok(result.ok);
    assert.strictEqual(result.value, true,
      'Dormant RBAC must allow all operations regardless of permissions');
  });

  it('DC-P4-401 integration: createLimen with requireRbac=true activates RBAC', async () => {
    // Integration-level: verify requireRbac threads through to RBAC engine activation.
    // In single-user mode, the convenience context has all permissions, so operations
    // still succeed. But the RBAC engine itself must be active (forceActive=true).
    // The discriminative assertion is that the system BOOTS with requireRbac=true
    // without error, proving the configuration path works end-to-end.
    const limen = await createTestLimen({ requireRbac: true });

    // If M-11 survived (forceActive bypassed), RBAC would be dormant.
    // Operations still succeed in single-user mode (all permissions), but
    // we verify the system boots and operates. The unit test above is the
    // discriminative mutation killer.
    const r = limen.remember('entity:test:rbac-active', 'test.data', 'value');
    assert.ok(r.ok, 'remember() must succeed with requireRbac=true in single-user mode');

    const recalled = limen.recall('entity:test:rbac-active');
    assert.ok(recalled.ok, 'recall() must succeed with requireRbac=true');
  });
});

// ============================================================================
// F-P4-005: .raw Audit Logging (Kills M-12)
// ============================================================================

describe('F-P4-005: .raw audit logging callback', () => {
  it('DC-P4-404 rejection: .raw access invokes auditLogger callback', () => {
    // KILLS M-12 (tenant_scope.ts:182 bypass)
    // If `if (rawAccessConfig.auditLogger)` is changed to `if (false)`,
    // the auditLogger callback never fires. This test verifies it does.
    const rawConn = createTestDatabase('single');
    const auditLog: Array<string | undefined> = [];

    const auditLogger: RawAccessAuditLogger = (tag) => {
      auditLog.push(tag);
    };

    const config: RawAccessConfig = {
      requireRbac: false,
      rawAccessTag: 'test-caller',
      auditLogger,
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    // Access .raw — must trigger the auditLogger
    const _raw = scoped.raw;

    assert.strictEqual(auditLog.length, 1,
      'auditLogger must be called exactly once on .raw access. ' +
      'If 0, M-12 mutation survived (audit logging bypassed).');
    assert.strictEqual(auditLog[0], 'test-caller',
      'auditLogger must receive the rawAccessTag');

    rawConn.close();
  });

  it('DC-P4-404 success: .raw access without auditLogger configured does not throw', () => {
    // When no auditLogger is configured, .raw access still works (no crash)
    const rawConn = createTestDatabase('single');

    const config: RawAccessConfig = {
      requireRbac: false,
      rawAccessTag: 'no-logger',
      // No auditLogger
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    // Must not throw
    const raw = scoped.raw;
    assert.ok(raw, '.raw must return a connection even without auditLogger');

    rawConn.close();
  });

  it('DC-P4-404: multiple .raw accesses produce multiple audit entries', () => {
    const rawConn = createTestDatabase('single');
    const auditLog: Array<string | undefined> = [];

    const config: RawAccessConfig = {
      requireRbac: false,
      rawAccessTag: 'multi-access',
      auditLogger: (tag) => auditLog.push(tag),
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    // Access .raw three times
    const _r1 = scoped.raw;
    const _r2 = scoped.raw;
    const _r3 = scoped.raw;

    assert.strictEqual(auditLog.length, 3,
      'Each .raw access must trigger a separate audit entry');

    rawConn.close();
  });
});

// ============================================================================
// F-P4-006: .raw RBAC Tag Enforcement (Kills M-13)
// ============================================================================

describe('F-P4-006: .raw RBAC tag enforcement', () => {
  it('DC-P4-403 rejection: .raw access with requireRbac=true and no rawAccessTag throws', () => {
    // KILLS M-13 (tenant_scope.ts:186 bypass)
    // If `if (rawAccessConfig.requireRbac && !rawAccessConfig.rawAccessTag)` is
    // changed to `if (false)`, .raw access never throws. This test verifies it does.
    const rawConn = createTestDatabase('single');

    const config: RawAccessConfig = {
      requireRbac: true,
      // Deliberately NO rawAccessTag
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    assert.throws(
      () => { const _r = scoped.raw; },
      (err: Error) => err.message.includes('rawAccessTag'),
      'DC-P4-403: .raw access must throw when requireRbac=true and rawAccessTag is missing. ' +
      'If no throw, M-13 mutation survived.',
    );

    rawConn.close();
  });

  it('DC-P4-403 success: .raw access with requireRbac=true AND rawAccessTag succeeds', () => {
    const rawConn = createTestDatabase('single');

    const config: RawAccessConfig = {
      requireRbac: true,
      rawAccessTag: 'authorized-caller',
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    // Must NOT throw
    const raw = scoped.raw;
    assert.ok(raw, '.raw must return connection when requireRbac=true with valid rawAccessTag');

    rawConn.close();
  });

  it('DC-P4-403: .raw access with requireRbac=false and no rawAccessTag succeeds', () => {
    // Contrast: when RBAC is not required, missing tag is fine
    const rawConn = createTestDatabase('single');

    const config: RawAccessConfig = {
      requireRbac: false,
      // No rawAccessTag
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    // Must NOT throw
    const raw = scoped.raw;
    assert.ok(raw, '.raw must succeed when requireRbac=false regardless of tag');

    rawConn.close();
  });

  it('DC-P4-403: .raw with requireRbac=true and empty string tag throws', () => {
    // Edge case: empty string tag should be treated as missing
    const rawConn = createTestDatabase('single');

    const config: RawAccessConfig = {
      requireRbac: true,
      rawAccessTag: '',
    };

    const scoped = createTenantScopedConnection(rawConn, null, config);

    assert.throws(
      () => { const _r = scoped.raw; },
      (err: Error) => err.message.includes('rawAccessTag'),
      'Empty string rawAccessTag must be treated as missing when requireRbac=true',
    );

    rawConn.close();
  });
});
