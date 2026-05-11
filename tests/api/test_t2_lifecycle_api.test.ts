// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * T2-AT-008/010/011/013: Lifecycle API adapter path tests.
 *
 * These tests exercise suspendAgent, reactivateAgent, decommissionAgent
 * through the PUBLIC API adapter (which auto-injects ctx), not the raw
 * lifecycle client.
 *
 * T2-GC-014: protectPredicate constraint check.
 * T2-XS-011: exportData with large claim counts.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-t2-'));
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

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

async function createTestLimen(): Promise<Limen> {
  const dir = makeTempDir();
  dirsToClean.push(dir);
  const limen = await createLimen({
    dataDir: dir,
    masterKey: randomBytes(32),
    providers: [],
  });
  instancesToShutdown.push(limen);
  return limen;
}

// ============================================================================
// T2-AT-008/010/011/013: Lifecycle methods through public API adapter
// ============================================================================

describe('T2-AT: Lifecycle API adapter path', () => {
  it('T2-AT-008: suspendAgent through public API does not throw', async () => {
    const limen = await createTestLimen();
    const reg = await limen.lifecycle.registerAgent({
      name: 't2-suspend-test',
      framework: 'claude',
      version: '1.0.0',
      capabilities: ['memory_read'],
      owner: 'test-user',
    });
    assert.ok(reg.ok, `registerAgent failed: ${!reg.ok ? reg.error.message : ''}`);

    const result = await limen.lifecycle.suspendAgent(reg.value.id, 'test suspension');
    assert.ok(result.ok, `suspendAgent failed: ${!result.ok ? result.error.message : ''}`);
    assert.equal(result.value.reason, 'test suspension');
  });

  it('T2-AT-010: reactivateAgent through public API does not throw', async () => {
    const limen = await createTestLimen();
    const reg = await limen.lifecycle.registerAgent({
      name: 't2-reactivate-test',
      framework: 'claude',
      version: '1.0.0',
      capabilities: ['memory_read'],
      owner: 'test-user',
    });
    assert.ok(reg.ok);

    const suspend = await limen.lifecycle.suspendAgent(reg.value.id, 'pre-reactivate');
    assert.ok(suspend.ok, `suspendAgent failed: ${!suspend.ok ? suspend.error.message : ''}`);

    const result = await limen.lifecycle.reactivateAgent(reg.value.id);
    assert.ok(result.ok, `reactivateAgent failed: ${!result.ok ? result.error.message : ''}`);
  });

  it('T2-AT-011: decommissionAgent through public API does not throw', async () => {
    const limen = await createTestLimen();
    const reg = await limen.lifecycle.registerAgent({
      name: 't2-decommission-test',
      framework: 'claude',
      version: '1.0.0',
      capabilities: ['memory_read'],
      owner: 'test-user',
    });
    assert.ok(reg.ok);

    const result = await limen.lifecycle.decommissionAgent(reg.value.id, 'end of life');
    assert.ok(result.ok, `decommissionAgent failed: ${!result.ok ? result.error.message : ''}`);
    assert.ok(result.value.decommissionedAt);
  });

  it('T2-AT-013: full lifecycle register -> suspend -> reactivate -> decommission', async () => {
    const limen = await createTestLimen();
    const reg = await limen.lifecycle.registerAgent({
      name: 't2-full-lifecycle',
      framework: 'claude',
      version: '1.0.0',
      capabilities: ['memory_read'],
      owner: 'test-user',
    });
    assert.ok(reg.ok);
    const agentId = reg.value.id;

    const s = await limen.lifecycle.suspendAgent(agentId, 'maintenance');
    assert.ok(s.ok, `suspendAgent: ${!s.ok ? s.error.message : ''}`);

    const r = await limen.lifecycle.reactivateAgent(agentId);
    assert.ok(r.ok, `reactivateAgent: ${!r.ok ? r.error.message : ''}`);

    const d = await limen.lifecycle.decommissionAgent(agentId, 'retired');
    assert.ok(d.ok, `decommissionAgent: ${!d.ok ? d.error.message : ''}`);
  });
});

// ============================================================================
// T2-GC-014: protectPredicate SQLITE_CONSTRAINT_CHECK
// ============================================================================

describe('T2-GC-014: protectPredicate constraint check', () => {
  it('protectPredicate with explicit action succeeds', async () => {
    const limen = await createTestLimen();
    const result = limen.governance.protectPredicate({
      predicatePattern: 'test.*',
      requiredPermission: 'manage_cognitive',
      action: 'both',
    });
    assert.ok(result.ok, `protectPredicate failed: ${!result.ok ? result.error.message : ''}`);
  });

  it('protectPredicate without action field defaults to both', async () => {
    const limen = await createTestLimen();
    // Omit action — should default to 'both'
    const result = limen.governance.protectPredicate({
      predicatePattern: 'test2.*',
      requiredPermission: 'manage_cognitive',
    } as any);
    assert.ok(result.ok, `protectPredicate without action failed: ${!result.ok ? result.error.message : ''}`);
  });
});

// ============================================================================
// T2-XS-011: exportData with large claim counts (too many SQL variables)
// ============================================================================

describe('T2-XS-011: exportData chunking', () => {
  it('exportData with >999 claims does not throw too many SQL variables', async () => {
    // Create engine with raised burst limit so we can insert >999 claims
    const dir = makeTempDir();
    dirsToClean.push(dir);
    const limen = await createLimen({
      dataDir: dir,
      masterKey: randomBytes(32),
      providers: [],
      security: {
        pii: { mode: 'tag', categories: ['email'] },
        injection: { enabled: true },
        poisoning: { enabled: true, burstLimit: 2000, diversityThreshold: 0.1, windowSeconds: 60 },
      },
    });
    instancesToShutdown.push(limen);

    // Insert 1100 claims to exceed SQLite's 999 parameter limit
    for (let i = 0; i < 1100; i++) {
      const result = limen.remember(
        `entity:test:bulk-${i}`,
        'test.data',
        `value-${i}`,
      );
      assert.ok(result.ok, `remember ${i} failed: ${!result.ok ? JSON.stringify(result.error) : ''}`);
    }

    // Export should handle >999 claims without "too many SQL variables" error
    const exportResult = limen.exportData({ format: 'json' });
    assert.ok(exportResult.ok, `exportData failed: ${!exportResult.ok ? exportResult.error.message : ''}`);

    const doc = JSON.parse(exportResult.value);
    assert.ok(doc.claims.length >= 1100, `Expected >= 1100 claims, got ${doc.claims.length}`);
  });

  it('exportData with includeEvidence and includeRelationships handles chunking', async () => {
    const dir = makeTempDir();
    dirsToClean.push(dir);
    const limen = await createLimen({
      dataDir: dir,
      masterKey: randomBytes(32),
      providers: [],
      security: {
        pii: { mode: 'tag', categories: ['email'] },
        injection: { enabled: true },
        poisoning: { enabled: true, burstLimit: 2000, diversityThreshold: 0.1, windowSeconds: 60 },
      },
    });
    instancesToShutdown.push(limen);

    // Insert 1100 claims
    for (let i = 0; i < 1100; i++) {
      const result = limen.remember(
        `entity:test:chunk-${i}`,
        'test.chunk',
        `chunk-value-${i}`,
      );
      assert.ok(result.ok, `remember ${i} failed: ${!result.ok ? JSON.stringify(result.error) : ''}`);
    }

    // Export with evidence and relationships — should chunk the IN queries
    const exportResult = limen.exportData({
      format: 'json',
      includeEvidence: true,
      includeRelationships: true,
    });
    assert.ok(exportResult.ok, `exportData failed: ${!exportResult.ok ? exportResult.error.message : ''}`);

    const doc = JSON.parse(exportResult.value);
    assert.ok(doc.claims.length >= 1100, `Expected >= 1100 claims, got ${doc.claims.length}`);
  });
});
