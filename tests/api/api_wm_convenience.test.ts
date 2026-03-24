/**
 * Sprint 7: WorkingMemoryApi Convenience Wrapper Tests
 *
 * Verifies that limen.workingMemory.write/read/discard work
 * WITHOUT requiring DatabaseConnection or OperationContext parameters.
 *
 * Before Sprint 7, these methods required (conn, ctx, input) — internal
 * kernel types consumers cannot construct. WorkingMemoryApiImpl wraps them
 * with closure-captured getConnection()/getContext().
 *
 * Note: WMP operations require a real task in the DB (task-scoped memory).
 * These tests verify the convenience wrapper dispatches correctly — domain
 * validation errors prove the wrapper reached the WMP system (not ENGINE_UNHEALTHY).
 *
 * Spec refs: SC-14 (write), SC-15 (read), SC-16 (discard)
 * Invariants: I-13 (authorization), I-17 (governance boundary)
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ─── Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-wm-conv-'));
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

// ============================================================================
// Tests
// ============================================================================

describe('Sprint 7: WorkingMemoryApi convenience wrapper', () => {

  it('write dispatches to WMP system (input-only signature, no conn/ctx)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] }),
    );

    // WMP requires a real task — with a nonexistent taskId we get a domain error
    // (not ENGINE_UNHEALTHY which was the pre-Sprint-7 failure mode)
    const result = limen.workingMemory.write({
      taskId: 'task-nonexistent',
      key: 'scratchpad',
      value: { notes: 'test data' },
    });

    assert.ok(result, 'write must return a Result');
    // Domain error proves the wrapper reached WMP (not the old ENGINE_UNHEALTHY)
    assert.equal(result.ok, false, 'write with nonexistent task should fail');
    assert.ok(result.error.message.includes('not found'),
      `error must be domain-level task-not-found, got: ${result.error.message}`);
  });

  it('read dispatches to WMP system (input-only signature, no conn/ctx)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] }),
    );

    const result = limen.workingMemory.read({
      taskId: 'task-nonexistent',
      key: null,
    });

    assert.ok(result, 'read must return a Result');
    assert.equal(result.ok, false, 'read with nonexistent task should fail');
    assert.ok(result.error.message.includes('not found'),
      `error must be task-not-found, got: ${result.error.message}`);
  });

  it('discard dispatches to WMP system (input-only signature, no conn/ctx)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] }),
    );

    const result = limen.workingMemory.discard({
      taskId: 'task-nonexistent',
      key: null,
    });

    assert.ok(result, 'discard must return a Result');
    assert.equal(result.ok, false, 'discard with nonexistent task should fail');
    assert.ok(result.error.message.includes('not found'),
      `error must be task-not-found, got: ${result.error.message}`);
  });

  it('workingMemory API is deeply frozen on Limen object (C-07)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] }),
    );

    assert.ok(Object.isFrozen(limen.workingMemory),
      'C-07: limen.workingMemory must be frozen');
    assert.throws(
      () => { (limen.workingMemory as Record<string, unknown>).write = () => {}; },
      TypeError,
      'C-07: assignment to frozen workingMemory.write must throw',
    );
  });

});
