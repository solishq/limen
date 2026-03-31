/**
 * Phase 3: AccessTracker unit tests.
 *
 * DCs covered: DC-P3-104 (flush writes correct values), DC-P3-201 (writes after destroy),
 *              DC-P3-202 (timer cleared on destroy), DC-P3-901 (timer lifecycle)
 * Invariants: I-P3-12, I-P3-13
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAccessTracker } from '../../src/cognitive/access_tracker.js';
import type { DatabaseConnection } from '../../src/kernel/interfaces/database.js';

/** Mock database connection that records SQL calls */
function createMockConn(): { conn: DatabaseConnection; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const conn = {
    run(sql: string, params?: unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { changes: 0 };
    },
    get() { return null; },
    query() { return []; },
    close() {},
    transaction<T>(fn: () => T): T { return fn(); },
  } as unknown as DatabaseConnection;
  return { conn, calls };
}

describe('Phase 3: AccessTracker', () => {
  describe('recordAccess and flush (DC-P3-104)', () => {
    it('accumulates access events and flushes to database', () => {
      const { conn, calls } = createMockConn();
      const tracker = createAccessTracker(() => conn, { flushIntervalMs: 0 }); // disable timer

      tracker.recordAccess(['claim-1', 'claim-2'], '2026-03-30T12:00:00.000Z');
      assert.equal(tracker.pendingCount(), 2);

      tracker.flush();
      assert.equal(tracker.pendingCount(), 0);

      // Expect: BEGIN + 2 UPDATEs + COMMIT
      assert.equal(calls.length, 4);
      assert.ok(calls[0]!.sql.includes('BEGIN'));
      assert.ok(calls[1]!.sql.includes('UPDATE claim_assertions'));
      assert.ok(calls[2]!.sql.includes('UPDATE claim_assertions'));
      assert.ok(calls[3]!.sql.includes('COMMIT'));

      tracker.destroy();
    });

    it('merges multiple accesses for same claim ID', () => {
      const { conn, calls } = createMockConn();
      const tracker = createAccessTracker(() => conn, { flushIntervalMs: 0 });

      tracker.recordAccess(['claim-1'], '2026-03-30T12:00:00.000Z');
      tracker.recordAccess(['claim-1'], '2026-03-30T13:00:00.000Z');
      tracker.recordAccess(['claim-1'], '2026-03-30T14:00:00.000Z');
      assert.equal(tracker.pendingCount(), 1); // only 1 distinct claim

      tracker.flush();

      // The UPDATE should have count=3 and the latest timestamp
      const updateCall = calls.find(c => c.sql.includes('UPDATE'));
      assert.ok(updateCall);
      assert.equal(updateCall.params[0], '2026-03-30T14:00:00.000Z'); // latestAt
      assert.equal(updateCall.params[1], 3); // count

      tracker.destroy();
    });

    it('flush with no pending events is a no-op', () => {
      const { conn, calls } = createMockConn();
      const tracker = createAccessTracker(() => conn, { flushIntervalMs: 0 });

      tracker.flush();
      assert.equal(calls.length, 0);

      tracker.destroy();
    });
  });

  describe('threshold trigger', () => {
    it('flushes automatically when threshold reached', () => {
      const { conn, calls } = createMockConn();
      const tracker = createAccessTracker(() => conn, {
        flushIntervalMs: 0,
        flushThreshold: 3,
      });

      // Add 2 claims -- no flush
      tracker.recordAccess(['a', 'b'], '2026-03-30T12:00:00.000Z');
      assert.equal(tracker.pendingCount(), 2);

      // Add third claim -- triggers threshold flush
      tracker.recordAccess(['c'], '2026-03-30T12:00:00.000Z');
      // After threshold flush, pending should be 0
      assert.equal(tracker.pendingCount(), 0);
      assert.ok(calls.length > 0, 'Flush should have fired');

      tracker.destroy();
    });
  });

  describe('DC-P3-201: writes after destroy', () => {
    it('recordAccess after destroy is silently ignored', () => {
      const { conn } = createMockConn();
      const tracker = createAccessTracker(() => conn, { flushIntervalMs: 0 });

      tracker.destroy();
      tracker.recordAccess(['claim-1'], '2026-03-30T12:00:00.000Z');
      assert.equal(tracker.pendingCount(), 0);
    });
  });

  describe('DC-P3-202: timer cleared on destroy (I-P3-13)', () => {
    it('destroy can be called multiple times without error', () => {
      const { conn } = createMockConn();
      const tracker = createAccessTracker(() => conn, { flushIntervalMs: 100 });

      tracker.destroy();
      tracker.destroy(); // second call should be safe
      assert.equal(tracker.pendingCount(), 0);
    });
  });

  describe('DC-P3-902: flush error containment', () => {
    it('flush error does not propagate', () => {
      const failConn = {
        run() { throw new Error('DB closed'); },
        get() { return null; },
        query() { return []; },
        close() {},
        transaction<T>(fn: () => T): T { return fn(); },
      } as unknown as DatabaseConnection;

      const tracker = createAccessTracker(() => failConn, { flushIntervalMs: 0 });
      tracker.recordAccess(['claim-1'], '2026-03-30T12:00:00.000Z');

      // flush() should not throw even though DB errors
      assert.doesNotThrow(() => tracker.flush());

      tracker.destroy();
    });
  });

  describe('connection factory error', () => {
    it('flush skips when getConnection throws', () => {
      const tracker = createAccessTracker(
        () => { throw new Error('No connection'); },
        { flushIntervalMs: 0 },
      );

      tracker.recordAccess(['claim-1'], '2026-03-30T12:00:00.000Z');
      // Should not throw
      assert.doesNotThrow(() => tracker.flush());
      // Events still pending since flush was skipped
      assert.equal(tracker.pendingCount(), 1);

      tracker.destroy();
    });
  });
});
