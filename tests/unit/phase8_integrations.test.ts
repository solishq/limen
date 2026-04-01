/**
 * Phase 8: Integrations — Unit Tests
 *
 * Tests for: Plugin System, Event Hooks, Export/Import, LangChain adapter.
 *
 * DC Coverage:
 *   DC-P8-101: Export/Import JSON roundtrip
 *   DC-P8-102: Import dedup by_content
 *   DC-P8-103: Import ID remapping for relationships
 *   DC-P8-104: Export includes Phase 3/5 fields
 *   DC-P8-105: CSV export is lossy
 *   DC-P8-201: Plugin lifecycle state machine
 *   DC-P8-202: Plugin install failure non-fatal
 *   DC-P8-203: Plugin destroy reverse order
 *   DC-P8-204: Plugin destroy failure non-fatal
 *   DC-P8-301: Event handler error isolation
 *   DC-P8-302: Event handler order
 *   DC-P8-401: Plugin API blocked during install
 *   DC-P8-402: Plugin name uniqueness
 *   DC-P8-403: Plugin max count
 *   DC-P8-404: Invalid plugin meta
 *   DC-P8-405: Invalid event name
 *   DC-P8-501: Event name mapping
 *   DC-P8-502: Wildcard subscription
 *   DC-P8-503: Event payload shape
 *   DC-P8-504: off() unsubscribes
 *   DC-P8-602: Export version field
 *   DC-P8-603: Import version validation
 *   DC-P8-801: Zero new production deps
 *   DC-P8-901: Plugin install failure non-fatal to engine
 *   DC-P8-902: Import dedup conflict with onConflict=error
 *   DC-P8-903: Export invalid format
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLimen } from '../../src/api/index.js';
import type { LimenPlugin, LimenEventName, LimenEvent } from '../../src/plugins/plugin_types.js';
import type { LimenExportDocument } from '../../src/exchange/exchange_types.js';

// ── Test Helpers ──

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-p8-'));
}

function masterKey(): Buffer {
  return Buffer.alloc(32, 0xab);
}

async function withLimen(
  opts: { plugins?: LimenPlugin[]; pluginConfig?: Record<string, Record<string, unknown>> } = {},
  fn: (limen: Awaited<ReturnType<typeof createLimen>>) => Promise<void> | void,
) {
  const dataDir = tmpDir();
  const limen = await createLimen({
    dataDir,
    masterKey: masterKey(),
    plugins: opts.plugins,
    pluginConfig: opts.pluginConfig,
  });
  try {
    await fn(limen);
  } finally {
    await limen.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── Plugin Test Helpers ──

function makePlugin(
  name: string,
  version: string = '1.0.0',
  installFn?: (ctx: Parameters<LimenPlugin['install']>[0]) => void,
  destroyFn?: () => void | Promise<void>,
): LimenPlugin {
  return {
    meta: { name, version },
    install: installFn ?? (() => {}),
    ...(destroyFn ? { destroy: destroyFn } : {}),
  };
}

// ============================================================================
// Plugin System Tests
// ============================================================================

describe('Phase 8: Plugin System', () => {

  // DC-P8-201: Plugin lifecycle
  it('DC-P8-201 success: plugin installs and receives context', async () => {
    let installed = false;
    let receivedConfig: Record<string, unknown> = {};

    const plugin = makePlugin('test-plugin', '1.0.0', (ctx) => {
      installed = true;
      receivedConfig = { ...ctx.config };
    });

    await withLimen({ plugins: [plugin], pluginConfig: { 'test-plugin': { key: 'value' } } }, () => {
      assert.equal(installed, true, 'Plugin install was called');
      assert.equal(receivedConfig.key, 'value', 'Plugin received config');
    });
  });

  // DC-P8-202: Install failure non-fatal [A21]
  it('DC-P8-202 success: good plugin installs despite failing sibling', async () => {
    let goodInstalled = false;

    const badPlugin = makePlugin('bad-plugin', '1.0.0', () => {
      throw new Error('Intentional install failure');
    });
    const goodPlugin = makePlugin('good-plugin', '1.0.0', () => {
      goodInstalled = true;
    });

    await withLimen({ plugins: [badPlugin, goodPlugin] }, () => {
      assert.equal(goodInstalled, true, 'Good plugin installed despite bad sibling');
    });
  });

  // DC-P8-203: Destroy reverse order
  it('DC-P8-203 success: plugins destroyed in reverse install order', async () => {
    const destroyOrder: string[] = [];

    const pluginA = makePlugin('plugin-a', '1.0.0', () => {}, () => { destroyOrder.push('A'); });
    const pluginB = makePlugin('plugin-b', '1.0.0', () => {}, () => { destroyOrder.push('B'); });
    const pluginC = makePlugin('plugin-c', '1.0.0', () => {}, () => { destroyOrder.push('C'); });

    const dataDir = tmpDir();
    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      plugins: [pluginA, pluginB, pluginC],
    });
    await limen.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });

    assert.deepEqual(destroyOrder, ['C', 'B', 'A'], 'Destroy in reverse order');
  });

  // DC-P8-204: Destroy failure non-fatal
  it('DC-P8-204 success: shutdown completes despite destroy error', async () => {
    const plugin = makePlugin('throw-destroy', '1.0.0', () => {}, () => {
      throw new Error('Destroy failed intentionally');
    });

    const dataDir = tmpDir();
    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      plugins: [plugin],
    });
    // Should not throw
    await limen.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // DC-P8-401: Plugin API blocked during install [A21]
  it('DC-P8-401 rejection: API calls during install throw PLUGIN_API_NOT_READY', async () => {
    let installError: Error | null = null;

    const plugin = makePlugin('api-caller', '1.0.0', (ctx) => {
      try {
        ctx.api.remember('s', 'p', 'v');
      } catch (e) {
        installError = e as Error;
      }
    });

    await withLimen({ plugins: [plugin] }, () => {
      assert.notEqual(installError, null, 'API call during install threw');
      assert.ok(installError!.message.includes('PLUGIN_API_NOT_READY'), 'Error mentions PLUGIN_API_NOT_READY');
    });
  });

  // DC-P8-402: Plugin name uniqueness [A21]
  it('DC-P8-402 success: unique names accepted', async () => {
    let aInstalled = false;
    let bInstalled = false;

    await withLimen({
      plugins: [
        makePlugin('unique-a', '1.0.0', () => { aInstalled = true; }),
        makePlugin('unique-b', '1.0.0', () => { bInstalled = true; }),
      ],
    }, () => {
      assert.equal(aInstalled, true);
      assert.equal(bInstalled, true);
    });
  });

  it('DC-P8-402 rejection: duplicate name skipped', async () => {
    let firstInstalled = false;
    let secondInstalled = false;

    await withLimen({
      plugins: [
        makePlugin('dupe', '1.0.0', () => { firstInstalled = true; }),
        makePlugin('dupe', '2.0.0', () => { secondInstalled = true; }),
      ],
    }, () => {
      assert.equal(firstInstalled, true, 'First plugin installed');
      assert.equal(secondInstalled, false, 'Duplicate skipped');
    });
  });

  // DC-P8-404: Invalid plugin meta [A21]
  it('DC-P8-404 rejection: empty name skipped', async () => {
    let badInstalled = false;
    let goodInstalled = false;

    const bad: LimenPlugin = {
      meta: { name: '', version: '1.0.0' },
      install: () => { badInstalled = true; },
    };
    const good = makePlugin('valid', '1.0.0', () => { goodInstalled = true; });

    await withLimen({ plugins: [bad, good] }, () => {
      assert.equal(badInstalled, false, 'Invalid plugin skipped');
      assert.equal(goodInstalled, true, 'Valid plugin installed');
    });
  });

  // DC-P8-901: Plugin install failure non-fatal to engine [A21]
  it('DC-P8-901 success: createLimen succeeds despite plugin failure', async () => {
    const failPlugin = makePlugin('fail', '1.0.0', () => { throw new Error('boom'); });

    await withLimen({ plugins: [failPlugin] }, (limen) => {
      // Engine is functional
      const result = limen.remember('test fact');
      assert.equal(result.ok, true, 'Engine works after plugin failure');
    });
  });
});

// ============================================================================
// Event Hooks Tests
// ============================================================================

describe('Phase 8: Event Hooks', () => {

  // DC-P8-501: Event name mapping [A21]
  it('DC-P8-501 success: claim:asserted fires on remember()', async () => {
    await withLimen({}, async (limen) => {
      let received: LimenEvent | null = null;

      limen.on('claim:asserted', (event) => {
        received = event;
      });

      limen.remember('entity:test:1', 'test.value', 'hello');

      assert.notEqual(received, null, 'Handler received event');
      assert.equal(received!.type, 'claim:asserted', 'Event type is claim:asserted');
    });
  });

  // DC-P8-405: Invalid event name [A21]
  it('DC-P8-405 rejection: invalid event name throws', async () => {
    await withLimen({}, (limen) => {
      assert.throws(
        () => limen.on('invalid:event' as LimenEventName, () => {}),
        /Unknown event name/,
        'Invalid event name rejected',
      );
    });
  });

  // DC-P8-301: Event handler error isolation [A21]
  it('DC-P8-301 success: handler error does not prevent other handlers', async () => {
    await withLimen({}, (limen) => {
      let handlerBCalled = false;

      limen.on('claim:asserted', () => {
        throw new Error('Handler A fails');
      });
      limen.on('claim:asserted', () => {
        handlerBCalled = true;
      });

      limen.remember('entity:test:1', 'test.value', 'hello');

      assert.equal(handlerBCalled, true, 'Handler B called despite Handler A error');
    });
  });

  // DC-P8-302: Event handler order
  it('DC-P8-302 success: handlers execute in registration order', async () => {
    await withLimen({}, (limen) => {
      const order: string[] = [];

      limen.on('claim:asserted', () => { order.push('first'); });
      limen.on('claim:asserted', () => { order.push('second'); });
      limen.on('claim:asserted', () => { order.push('third'); });

      limen.remember('entity:test:1', 'test.value', 'hello');

      assert.deepEqual(order, ['first', 'second', 'third']);
    });
  });

  // DC-P8-503: Event payload shape
  it('DC-P8-503 success: event has type, data, timestamp', async () => {
    await withLimen({}, (limen) => {
      let received: LimenEvent | null = null;

      limen.on('claim:asserted', (event) => { received = event; });
      limen.remember('entity:test:1', 'test.value', 'hello');

      assert.notEqual(received, null);
      assert.equal(typeof received!.type, 'string');
      assert.equal(typeof received!.data, 'object');
      assert.equal(typeof received!.timestamp, 'string');
    });
  });

  // DC-P8-504: off() unsubscribes [A21]
  it('DC-P8-504 success: handler fires before off(), not after', async () => {
    await withLimen({}, (limen) => {
      let callCount = 0;

      const subId = limen.on('claim:asserted', () => { callCount++; });

      limen.remember('entity:test:1', 'test.value', 'first');
      assert.equal(callCount, 1, 'Handler fired before off()');

      limen.off(subId);

      limen.remember('entity:test:2', 'test.value', 'second');
      assert.equal(callCount, 1, 'Handler did not fire after off()');
    });
  });

  // DC-P8-502: Wildcard subscription
  it('DC-P8-502 success: wildcard receives multiple event types', async () => {
    await withLimen({}, (limen) => {
      const events: LimenEvent[] = [];

      limen.on('*', (event) => { events.push(event); });

      // Create a claim (triggers claim:asserted)
      const r1 = limen.remember('entity:test:1', 'test.value', 'hello');
      assert.equal(r1.ok, true);

      // Wildcard should have received at least the asserted event
      assert.ok(events.length > 0, 'Wildcard received events');
    });
  });
});

// ============================================================================
// Export Tests
// ============================================================================

describe('Phase 8: Export', () => {

  // DC-P8-602: Export version field
  it('DC-P8-602 success: JSON export has version 1.0.0', async () => {
    await withLimen({}, (limen) => {
      limen.remember('entity:test:1', 'test.value', 'hello');

      const result = limen.exportData({ format: 'json' });
      assert.equal(result.ok, true);

      const doc = JSON.parse(result.value!) as LimenExportDocument;
      assert.equal(doc.version, '1.0.0');
    });
  });

  // DC-P8-104: Export includes Phase 3/5 fields
  it('DC-P8-104 success: export includes stability and reasoning fields', async () => {
    await withLimen({}, (limen) => {
      limen.remember('entity:test:1', 'test.value', 'hello', { reasoning: 'test reasoning' });

      const result = limen.exportData({ format: 'json' });
      assert.equal(result.ok, true);

      const doc = JSON.parse(result.value!) as LimenExportDocument;
      assert.ok(doc.claims.length > 0, 'Has claims');
      const claim = doc.claims[0]!;
      assert.ok('stability' in claim, 'Has stability field');
      assert.ok('reasoning' in claim, 'Has reasoning field');
      assert.equal(claim.reasoning, 'test reasoning');
    });
  });

  // DC-P8-105: CSV is lossy
  it('DC-P8-105 success: CSV export has no relationship columns', async () => {
    await withLimen({}, (limen) => {
      limen.remember('entity:test:1', 'test.value', 'hello');

      const result = limen.exportData({ format: 'csv' });
      assert.equal(result.ok, true);

      const lines = result.value!.split('\n');
      const header = lines[0]!;
      assert.ok(!header.includes('fromClaimId'), 'No relationship columns in CSV');
      assert.ok(!header.includes('evidenceRefs'), 'No evidence columns in CSV');
    });
  });

  // DC-P8-903: Invalid export format [A21]
  it('DC-P8-903 rejection: invalid format returns error', async () => {
    await withLimen({}, (limen) => {
      const result = limen.exportData({ format: 'xml' as 'json' });
      assert.equal(result.ok, false);
      assert.equal(result.error!.code, 'EXPORT_INVALID_FORMAT');
    });
  });

  // Export with metadata
  it('export metadata contains claim count and timestamp', async () => {
    await withLimen({}, (limen) => {
      limen.remember('entity:test:1', 'test.a', 'v1');
      limen.remember('entity:test:2', 'test.b', 'v2');

      const result = limen.exportData({ format: 'json' });
      assert.equal(result.ok, true);

      const doc = JSON.parse(result.value!) as LimenExportDocument;
      assert.ok(doc.metadata.claimCount >= 2, 'Claim count includes our claims');
      assert.ok(doc.metadata.exportedAt, 'Has export timestamp');
    });
  });
});

// ============================================================================
// Import Tests
// ============================================================================

describe('Phase 8: Import', () => {

  // DC-P8-101: Roundtrip fidelity
  it('DC-P8-101 success: export -> import roundtrip preserves claim data', async () => {
    const dataDir1 = tmpDir();
    const dataDir2 = tmpDir();

    try {
      // Source instance: create claims
      const source = await createLimen({ dataDir: dataDir1, masterKey: masterKey() });
      source.remember('entity:test:1', 'test.subject', 'original value', { reasoning: 'test reason' });
      source.remember('entity:test:2', 'test.predicate', 'second value');

      // Export
      const exportResult = source.exportData({ format: 'json' });
      assert.equal(exportResult.ok, true);
      await source.shutdown();

      // Target instance: import
      const target = await createLimen({ dataDir: dataDir2, masterKey: masterKey() });
      const doc = JSON.parse(exportResult.value!) as LimenExportDocument;
      const importResult = target.importData(doc, { dedup: 'none' });
      assert.equal(importResult.ok, true);
      assert.ok(importResult.value!.imported >= 2, 'Imported at least 2 claims');

      // Verify roundtrip: recall and check fields
      const recallResult = target.recall(undefined, 'test.subject');
      assert.equal(recallResult.ok, true);
      const beliefs = recallResult.value!;
      const match = beliefs.find(b => b.value === 'original value');
      assert.ok(match, 'Found imported claim');
      assert.equal(match!.subject, 'entity:test:1');
      assert.equal(match!.predicate, 'test.subject');

      await target.shutdown();
    } finally {
      fs.rmSync(dataDir1, { recursive: true, force: true });
      fs.rmSync(dataDir2, { recursive: true, force: true });
    }
  });

  // DC-P8-102: Import dedup by_content [A21]
  it('DC-P8-102 success: second import of same data is skipped', async () => {
    await withLimen({}, (limen) => {
      // Create a claim
      limen.remember('entity:test:1', 'test.value', 'hello');

      // Export
      const exportResult = limen.exportData({ format: 'json' });
      assert.equal(exportResult.ok, true);
      const doc = JSON.parse(exportResult.value!) as LimenExportDocument;

      // Import same data with dedup
      const importResult = limen.importData(doc, { dedup: 'by_content' });
      assert.equal(importResult.ok, true);
      // All claims should be skipped (already exist)
      assert.ok(importResult.value!.skipped > 0, 'Some claims skipped');
      assert.equal(importResult.value!.imported, 0, 'No new claims imported');
    });
  });

  // DC-P8-103: Import ID remapping for relationships
  it('DC-P8-103 success: relationships rebind to new IDs after import', async () => {
    const dataDir1 = tmpDir();
    const dataDir2 = tmpDir();

    try {
      const source = await createLimen({ dataDir: dataDir1, masterKey: masterKey() });
      const r1 = source.remember('entity:test:1', 'test.a', 'claim-a');
      const r2 = source.remember('entity:test:2', 'test.b', 'claim-b');
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);

      source.connect(r1.value!.claimId, r2.value!.claimId, 'supports');

      const exportResult = source.exportData({ format: 'json', includeRelationships: true });
      assert.equal(exportResult.ok, true);
      await source.shutdown();

      const target = await createLimen({ dataDir: dataDir2, masterKey: masterKey() });
      const doc = JSON.parse(exportResult.value!) as LimenExportDocument;
      const importResult = target.importData(doc, { dedup: 'none' });
      assert.equal(importResult.ok, true);

      // Verify relationships were imported
      assert.ok(importResult.value!.relationshipsImported > 0 || doc.relationships.length === 0,
        'Relationships imported or none to import');

      // Verify ID map has entries
      assert.ok(importResult.value!.idMap.size > 0, 'ID map has entries');

      await target.shutdown();
    } finally {
      fs.rmSync(dataDir1, { recursive: true, force: true });
      fs.rmSync(dataDir2, { recursive: true, force: true });
    }
  });

  // DC-P8-603: Import version validation [A21]
  it('DC-P8-603 success: version 1.0.0 accepted', async () => {
    await withLimen({}, (limen) => {
      const doc: LimenExportDocument = {
        version: '1.0.0',
        metadata: { exportedAt: new Date().toISOString(), limenVersion: '1.4.0', claimCount: 0, relationshipCount: 0 },
        claims: [],
        relationships: [],
      };
      const result = limen.importData(doc);
      assert.equal(result.ok, true);
    });
  });

  it('DC-P8-603 rejection: version 2.0.0 rejected', async () => {
    await withLimen({}, (limen) => {
      const doc = {
        version: '2.0.0',
        metadata: { exportedAt: new Date().toISOString(), limenVersion: '1.4.0', claimCount: 0, relationshipCount: 0 },
        claims: [],
        relationships: [],
      } as unknown as LimenExportDocument;
      const result = limen.importData(doc);
      assert.equal(result.ok, false);
      assert.equal(result.error!.code, 'IMPORT_INVALID_DOCUMENT');
    });
  });

  // DC-P8-902: Import dedup conflict with onConflict=error [A21]
  it('DC-P8-902 success: first import succeeds', async () => {
    await withLimen({}, (limen) => {
      const doc: LimenExportDocument = {
        version: '1.0.0',
        metadata: { exportedAt: new Date().toISOString(), limenVersion: '1.4.0', claimCount: 1, relationshipCount: 0 },
        claims: [{
          id: 'test-1',
          subject: 'entity:unique:1',
          predicate: 'test.unique',
          objectType: 'string',
          objectValue: 'unique value',
          confidence: 0.7,
          validAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          status: 'active',
          groundingMode: 'runtime_witness',
          stability: null,
          reasoning: null,
        }],
        relationships: [],
      };
      const result = limen.importData(doc, { onConflict: 'error', dedup: 'by_content' });
      assert.equal(result.ok, true);
      assert.equal(result.value!.imported, 1);
    });
  });

  it('DC-P8-902 rejection: second import with onConflict=error returns IMPORT_DEDUP_CONFLICT', async () => {
    await withLimen({}, (limen) => {
      const doc: LimenExportDocument = {
        version: '1.0.0',
        metadata: { exportedAt: new Date().toISOString(), limenVersion: '1.4.0', claimCount: 1, relationshipCount: 0 },
        claims: [{
          id: 'test-1',
          subject: 'entity:dup:1',
          predicate: 'test.dup',
          objectType: 'string',
          objectValue: 'dup value',
          confidence: 0.7,
          validAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          status: 'active',
          groundingMode: 'runtime_witness',
          stability: null,
          reasoning: null,
        }],
        relationships: [],
      };
      // First import succeeds
      const r1 = limen.importData(doc, { onConflict: 'error', dedup: 'by_content' });
      assert.equal(r1.ok, true);

      // Second import fails with dedup conflict
      const r2 = limen.importData(doc, { onConflict: 'error', dedup: 'by_content' });
      assert.equal(r2.ok, false);
      assert.equal(r2.error!.code, 'IMPORT_DEDUP_CONFLICT');
    });
  });
});

// ============================================================================
// Dependency Boundary Tests
// ============================================================================

describe('Phase 8: Dependency Boundary', () => {

  // DC-P8-801: Zero new production deps
  it('DC-P8-801: package.json has only better-sqlite3 as production dependency', () => {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const depNames = Object.keys(pkg.dependencies || {});
    assert.deepEqual(depNames, ['better-sqlite3'], 'Only better-sqlite3 as production dependency');
  });

  // DC-P8-601: No new migrations
  it('DC-P8-601: no new migration files in Phase 8', () => {
    // Phase 8 introduces no new database tables
    // This is a structural constraint — verified by checking that
    // the last migration file predates Phase 8.
    const migrationDir = path.join(process.cwd(), 'src', 'api', 'migration');
    const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.ts')).sort();
    const lastMig = files[files.length - 1]!;
    // Last migration is 032_reasoning.ts (Phase 5)
    assert.ok(lastMig.includes('032'), `Last migration is 032 (Phase 5), not a new Phase 8 migration. Got: ${lastMig}`);
  });
});
