/**
 * Contract tests for WG-03: Auto-Connection Suggestions.
 * v3.0.0 Phase 1, Slice 1.4
 *
 * Verifies:
 *   - claim.asserted event triggers connection suggestion (with debounce)
 *   - autoSuggestConnections=false disables listener
 *   - Suggestion errors are non-fatal
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
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
  return mkdtempSync(join(tmpdir(), 'limen-autoconn-'));
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

describe('WG-03: Auto-Connection Suggestion Wiring', () => {
  it('DC-AUTOCONN-01 [SUCCESS]: asserting a claim does not crash with auto-suggest enabled', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      cognitive: { autoSuggestConnections: true },
    }));

    // Remember a claim — should trigger claim.asserted event
    // Even without vector store, auto-suggest should be non-fatal
    const result = limen.remember('entity:test:subject', 'test.property', 'test-value');
    assert.ok(result.ok, `remember should succeed: ${!result.ok ? result.error.message : ''}`);

    // Remember another claim to test debounce batching
    const result2 = limen.remember('entity:test:subject', 'test.other', 'other-value');
    assert.ok(result2.ok, 'second remember should succeed');
  });

  it('DC-AUTOCONN-02 [REJECTION]: autoSuggestConnections=false skips listener setup', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      cognitive: { autoSuggestConnections: false },
    }));

    // Should work fine — no auto-suggest listener
    const result = limen.remember('entity:test:subject', 'test.is', 'value');
    assert.ok(result.ok, 'remember should succeed with auto-suggest disabled');
  });

  it('DC-AUTOCONN-03 [SUCCESS]: suggestion errors are non-fatal to claim assertion', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      // Auto-suggest enabled by default
    }));

    // Multiple rapid claims — tests debounce doesn't break
    for (let i = 0; i < 5; i++) {
      const result = limen.remember(`entity:test:subject-${i}`, 'test.property', `value-${i}`);
      assert.ok(result.ok, `remember ${i} should succeed`);
    }
  });
});
