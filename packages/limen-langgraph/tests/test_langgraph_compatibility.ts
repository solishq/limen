// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * LangGraph Compatibility Tests
 *
 * Verifies the adapter satisfies the standard LangGraph checkpoint contract:
 * - put -> getTuple roundtrip
 * - list by thread
 * - delete thread
 * - putWrites accumulation
 * - thread isolation
 *
 * These tests exercise the full stack (chain -> projector -> projection -> read)
 * using the test harness, mirroring what a LangGraph graph would do.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LimenCheckpointSaver } from '../src/checkpoint.js';
import { LimenStore } from '../src/store.js';
import {
  createTestHarness,
  makeCheckpoint,
  makeMetadata,
  makeConfig,
  type TestHarness,
} from './harness.js';
import type {
  Checkpoint,
  CheckpointMetadata,
  RunnableConfig,
} from '../src/types.js';

describe('LangGraph Compatibility', () => {
  let h: TestHarness;
  let saver: LimenCheckpointSaver;

  beforeEach(async () => {
    h = createTestHarness();
    saver = new LimenCheckpointSaver(h.config);
    await saver.start();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Standard Checkpoint Contract
  // ═══════════════════════════════════════════════════════════════════════════

  describe('checkpoint contract', () => {
    it('put -> getTuple roundtrip preserves all fields', async () => {
      const cp: Checkpoint = {
        id: 'test-uuid-001',
        v: 4,
        ts: '2026-05-03T00:00:00.000Z',
        channel_values: { messages: ['hello', 'world'], counter: 42 },
        channel_versions: { messages: 2, counter: 1 },
        versions_seen: { task1: { messages: 1 } },
        pending_sends: [{ type: 'send', data: 'test' }],
      };

      const meta: CheckpointMetadata = {
        source: 'loop',
        step: 5,
        writes: { messages: ['new_msg'] },
        parents: { '': 'parent-uuid' },
      };

      const config = makeConfig('thread-001');
      await saver.put(config, cp, meta, {});

      const result = await saver.getTuple(makeConfig('thread-001'));
      assert.ok(result);

      // Checkpoint fields
      assert.equal(result.checkpoint.id, 'test-uuid-001');
      assert.equal(result.checkpoint.v, 4);
      assert.equal(result.checkpoint.ts, '2026-05-03T00:00:00.000Z');
      assert.deepEqual(result.checkpoint.channel_values, { messages: ['hello', 'world'], counter: 42 });
      assert.deepEqual(result.checkpoint.channel_versions, { messages: 2, counter: 1 });
      assert.deepEqual(result.checkpoint.versions_seen, { task1: { messages: 1 } });
      assert.deepEqual(result.checkpoint.pending_sends, [{ type: 'send', data: 'test' }]);

      // Metadata fields
      assert.equal(result.metadata.source, 'loop');
      assert.equal(result.metadata.step, 5);
      assert.deepEqual(result.metadata.writes, { messages: ['new_msg'] });
      assert.deepEqual(result.metadata.parents, { '': 'parent-uuid' });

      // Config
      assert.equal(result.config.configurable?.thread_id, 'thread-001');
      assert.equal(result.config.configurable?.checkpoint_id, 'test-uuid-001');
    });

    it('list by thread returns all checkpoints in reverse order', async () => {
      const config = makeConfig('thread-001');

      // Create a chain of checkpoints
      await saver.put(config, makeCheckpoint('cp1'), makeMetadata(0, 'input'), {});
      await saver.put(
        makeConfig('thread-001', { checkpoint_id: 'cp1' }),
        makeCheckpoint('cp2'),
        makeMetadata(1, 'loop'),
        {}
      );
      await saver.put(
        makeConfig('thread-001', { checkpoint_id: 'cp2' }),
        makeCheckpoint('cp3'),
        makeMetadata(2, 'loop'),
        {}
      );

      const results: any[] = [];
      for await (const tuple of saver.list(config)) {
        results.push(tuple);
      }

      assert.equal(results.length, 3);
      // Reverse order (most recent first)
      assert.equal(results[0].checkpoint.id, 'cp3');
      assert.equal(results[1].checkpoint.id, 'cp2');
      assert.equal(results[2].checkpoint.id, 'cp1');

      // Parent chain
      assert.equal(results[0].parentConfig?.configurable?.checkpoint_id, 'cp2');
      assert.equal(results[1].parentConfig?.configurable?.checkpoint_id, 'cp1');
      assert.equal(results[2].parentConfig, undefined); // First has no parent
    });

    it('delete thread removes all checkpoints and writes', async () => {
      await saver.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});
      await saver.putWrites(
        makeConfig('t1', { checkpoint_id: 'cp1' }),
        [['messages', 'hello'], ['__error__', { msg: 'err' }]],
        'task1'
      );

      // Verify data exists
      const before = await saver.getTuple(makeConfig('t1'));
      assert.ok(before);
      assert.equal(before.pendingWrites.length, 2);

      // Delete
      await saver.deleteThread('t1');

      // Verify data is gone
      const after = await saver.getTuple(makeConfig('t1'));
      assert.equal(after, undefined);
    });

    it('putWrites accumulates writes for a checkpoint', async () => {
      await saver.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});
      const cpConfig = makeConfig('t1', { checkpoint_id: 'cp1' });

      // Multiple tasks writing to same checkpoint
      await saver.putWrites(cpConfig, [['messages', 'msg1']], 'task_a');
      await saver.putWrites(cpConfig, [['state', { count: 1 }]], 'task_b');
      await saver.putWrites(cpConfig, [['__error__', { msg: 'oops' }]], 'task_c');

      const result = await saver.getTuple(makeConfig('t1'));
      assert.ok(result);
      assert.equal(result.pendingWrites.length, 3);

      const taskIds = result.pendingWrites.map(w => w[0]).sort();
      assert.deepEqual(taskIds, ['task_a', 'task_b', 'task_c']);
    });

    it('thread isolation — different threads do not interfere', async () => {
      // Thread 1
      await saver.put(makeConfig('t1'), makeCheckpoint('cp_t1'), makeMetadata(0), {});
      await saver.putWrites(
        makeConfig('t1', { checkpoint_id: 'cp_t1' }),
        [['messages', 'thread1_msg']],
        'task1'
      );

      // Thread 2
      await saver.put(makeConfig('t2'), makeCheckpoint('cp_t2'), makeMetadata(0), {});
      await saver.putWrites(
        makeConfig('t2', { checkpoint_id: 'cp_t2' }),
        [['messages', 'thread2_msg']],
        'task1'
      );

      // Verify isolation
      const r1 = await saver.getTuple(makeConfig('t1'));
      const r2 = await saver.getTuple(makeConfig('t2'));

      assert.equal(r1?.checkpoint.id, 'cp_t1');
      assert.equal(r2?.checkpoint.id, 'cp_t2');
      assert.equal(r1?.pendingWrites[0][2], 'thread1_msg');
      assert.equal(r2?.pendingWrites[0][2], 'thread2_msg');

      // Delete thread 1 — thread 2 unaffected
      await saver.deleteThread('t1');
      assert.equal(await saver.getTuple(makeConfig('t1')), undefined);
      assert.ok(await saver.getTuple(makeConfig('t2')));
    });

    it('checkpoint namespace isolation', async () => {
      // Same thread, different namespaces
      await saver.put(
        makeConfig('t1', { checkpoint_ns: 'ns_a' }),
        makeCheckpoint('cp_a'),
        makeMetadata(0),
        {}
      );
      await saver.put(
        makeConfig('t1', { checkpoint_ns: 'ns_b' }),
        makeCheckpoint('cp_b'),
        makeMetadata(0),
        {}
      );

      const resultA = await saver.getTuple(makeConfig('t1', { checkpoint_ns: 'ns_a' }));
      const resultB = await saver.getTuple(makeConfig('t1', { checkpoint_ns: 'ns_b' }));

      assert.equal(resultA?.checkpoint.id, 'cp_a');
      assert.equal(resultB?.checkpoint.id, 'cp_b');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Store Contract
  // ═══════════════════════════════════════════════════════════════════════════

  describe('store contract', () => {
    let store: LimenStore;

    beforeEach(async () => {
      store = new LimenStore(h.config);
      await store.start();
    });

    it('put -> get roundtrip', async () => {
      await store.put(['users', 'profiles'], 'user-001', {
        name: 'Alice',
        email: 'alice@example.com',
        tags: ['admin', 'active'],
      });

      const item = await store.get(['users', 'profiles'], 'user-001');
      assert.ok(item);
      assert.equal(item.key, 'user-001');
      assert.deepEqual(item.namespace, ['users', 'profiles']);
      assert.equal(item.value.name, 'Alice');
      assert.deepEqual(item.value.tags, ['admin', 'active']);
    });

    it('search by prefix', async () => {
      await store.put(['users', 'active'], 'u1', { name: 'Alice' });
      await store.put(['users', 'active'], 'u2', { name: 'Bob' });
      await store.put(['users', 'inactive'], 'u3', { name: 'Charlie' });
      await store.put(['orders'], 'o1', { total: 100 });

      const userResults = await store.search(['users']);
      assert.equal(userResults.length, 3);

      const activeResults = await store.search(['users', 'active']);
      assert.equal(activeResults.length, 2);
    });

    it('search with filter', async () => {
      await store.put(['products'], 'p1', { name: 'Widget', price: 10 });
      await store.put(['products'], 'p2', { name: 'Gadget', price: 50 });
      await store.put(['products'], 'p3', { name: 'Doohickey', price: 100 });

      const expensive = await store.search(['products'], {
        filter: { price: { $gte: 50 } },
        limit: 100,
      });
      assert.equal(expensive.length, 2);
    });

    it('delete removes item', async () => {
      await store.put(['ns'], 'k', { v: 1 });
      assert.ok(await store.get(['ns'], 'k'));

      await store.delete(['ns'], 'k');
      assert.equal(await store.get(['ns'], 'k'), null);
    });

    it('listNamespaces returns unique namespaces', async () => {
      await store.put(['a', 'b'], 'k1', { v: 1 });
      await store.put(['a', 'b'], 'k2', { v: 2 });
      await store.put(['a', 'c'], 'k3', { v: 3 });
      await store.put(['d'], 'k4', { v: 4 });

      const ns = await store.listNamespaces();
      assert.equal(ns.length, 3);
    });

    it('cross-thread storage — same namespace accessible from different threads', async () => {
      // Store is thread-independent
      await store.put(['shared'], 'config', { theme: 'dark' });
      const item = await store.get(['shared'], 'config');
      assert.equal(item?.value.theme, 'dark');
    });
  });
});
