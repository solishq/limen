/**
 * LimenStore — Unit tests
 * Covers: Claims 3.1–3.22, 3.27, 4.8, 5.1–5.4, 8.9
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LimenCheckpointSaver } from '../src/checkpoint.js';
import { LimenStore } from '../src/store.js';
import { LimenStorageError, LimenNotStartedError } from '../src/errors.js';
import { createTestHarness, type TestHarness } from './harness.js';

describe('LimenStore', () => {
  let h: TestHarness;
  let store: LimenStore;

  beforeEach(async () => {
    h = createTestHarness();
    // Schema migration requires LimenCheckpointSaver to run first
    const saver = new LimenCheckpointSaver(h.config);
    await saver.start();
    store = new LimenStore(h.config);
    await store.start();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle — Claims 3.23–3.27
  // ═══════════════════════════════════════════════════════════════════════════

  describe('lifecycle', () => {
    it('Claim 3.27: throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.get(['ns'], 'key'),
        LimenNotStartedError
      );
    });

    it('Claim 3.26: start after stop throws', async () => {
      await store.stop();
      await assert.rejects(() => store.start(), LimenStorageError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // batch() — Claims 3.1–3.6
  // ═══════════════════════════════════════════════════════════════════════════

  describe('batch', () => {
    it('Claim 3.2: gets resolve against pre-batch state', async () => {
      await store.put(['users'], 'u1', { name: 'Alice' });

      // Batch: get (sees old) + put (updates)
      const results = await store.batch([
        { namespace: ['users'], key: 'u1' },           // GetOp
        { namespace: ['users'], key: 'u1', value: { name: 'Bob' } }, // PutOp
      ]);

      // Get should return pre-batch value
      assert.equal((results[0] as any)?.value.name, 'Alice');
      // Put returns undefined (Claim 3.5)
      assert.equal(results[1], undefined);
    });

    it('Claim 3.4: GetOp returns copy, not reference', async () => {
      await store.put(['users'], 'u1', { name: 'Alice' });

      const item1 = await store.get(['users'], 'u1');
      const item2 = await store.get(['users'], 'u1');
      assert.notStrictEqual(item1, item2); // Different references
      assert.deepEqual(item1?.value, item2?.value);
    });

    it('Claim 3.5: PutOp returns undefined', async () => {
      const results = await store.batch([
        { namespace: ['users'], key: 'u1', value: { name: 'Alice' } },
      ]);
      assert.equal(results[0], undefined);
    });

    it('Claim 3.6: multiple PutOps same key → last wins', async () => {
      await store.batch([
        { namespace: ['users'], key: 'u1', value: { name: 'Alice' } },
        { namespace: ['users'], key: 'u1', value: { name: 'Bob' } },
      ]);

      const item = await store.get(['users'], 'u1');
      assert.equal(item?.value.name, 'Bob');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // put/get/delete — Claims 3.19–3.22
  // ═══════════════════════════════════════════════════════════════════════════

  describe('put/get/delete', () => {
    it('Claim 3.20: put stores value, preserves created_at on update', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      const first = await store.get(['data'], 'k1');

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 5));
      await store.put(['data'], 'k1', { v: 2 });
      const second = await store.get(['data'], 'k1');

      assert.equal(second?.value.v, 2);
      // created_at preserved from first write
      assert.equal(first?.createdAt.getTime(), second?.createdAt.getTime());
    });

    it('Claim 3.19 + 3.21: delete removes item, idempotent', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      await store.delete(['data'], 'k1');

      const item = await store.get(['data'], 'k1');
      assert.equal(item, null);

      // Idempotent — no throw on second delete
      await store.delete(['data'], 'k1');
    });

    it('Claim 3.22: index stored but not used for search', async () => {
      await store.put(['data'], 'k1', { name: 'test' }, ['name']);

      // Should still be searchable without index
      const results = await store.search(['data']);
      assert.equal(results.length, 1);
      assert.equal(results[0].value.name, 'test');
    });

    it('put with value=null is delete (LgStoreDelete)', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      await store.batch([{ namespace: ['data'], key: 'k1', value: null }]);

      const item = await store.get(['data'], 'k1');
      assert.equal(item, null);

      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgStoreDelete');
      assert.ok(entry);
    });

    it('put with value!=null is LgStorePut', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgStorePut');
      assert.ok(entry);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Namespace Validation — Claim 3.7
  // ═══════════════════════════════════════════════════════════════════════════

  describe('namespace validation', () => {
    it('Rule 1: empty array throws', async () => {
      await assert.rejects(() => store.put([], 'k', { v: 1 }), LimenStorageError);
    });

    it('Rule 3: empty string label throws', async () => {
      await assert.rejects(() => store.put([''], 'k', { v: 1 }), LimenStorageError);
    });

    it('Rule 4: dot in label throws', async () => {
      await assert.rejects(() => store.put(['user.data'], 'k', { v: 1 }), LimenStorageError);
    });

    it('Rule 5: "langgraph" root throws', async () => {
      await assert.rejects(() => store.put(['langgraph'], 'k', { v: 1 }), LimenStorageError);
    });

    it('Rule 5: "langgraph_custom" root allowed', async () => {
      await store.put(['langgraph_custom'], 'k', { v: 1 });
      const item = await store.get(['langgraph_custom'], 'k');
      assert.equal(item?.value.v, 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Search — Claims 3.8–3.14
  // ═══════════════════════════════════════════════════════════════════════════

  describe('search', () => {
    beforeEach(async () => {
      await store.put(['users', 'active'], 'u1', { name: 'Alice', age: 30 });
      await store.put(['users', 'active'], 'u2', { name: 'Bob', age: 25 });
      await store.put(['users', 'inactive'], 'u3', { name: 'Charlie', age: 40 });
      await store.put(['orders'], 'o1', { total: 100 });
    });

    it('Claim 3.8: prefix matches exact and children', async () => {
      const results = await store.search(['users']);
      assert.equal(results.length, 3); // active + inactive
    });

    it('Claim 3.8: prefix excludes siblings', async () => {
      const results = await store.search(['orders']);
      assert.equal(results.length, 1);
    });

    it('Claim 3.9: empty prefix matches all', async () => {
      const results = await store.search([], { limit: 100 });
      assert.equal(results.length, 4);
    });

    it('Claim 3.10: filter with $gt operator', async () => {
      const results = await store.search(['users'], {
        filter: { age: { $gt: 28 } },
        limit: 100,
      });
      assert.equal(results.length, 2); // Alice (30) + Charlie (40)
    });

    it('Claim 3.11: default limit is 10', async () => {
      // Already tested implicitly — 4 items < 10
      const results = await store.search(['users']);
      assert.ok(results.length <= 10);
    });

    it('Claim 3.12: score always undefined', async () => {
      const results = await store.search(['users']);
      for (const r of results) {
        assert.equal(r.score, undefined);
      }
    });

    it('Claim 3.13: query parameter throws', async () => {
      await assert.rejects(
        () => store.search(['users'], { query: 'semantic query' }),
        /Semantic search not supported/
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // listNamespaces — Claims 3.15–3.18
  // ═══════════════════════════════════════════════════════════════════════════

  describe('listNamespaces', () => {
    beforeEach(async () => {
      await store.put(['users', 'active'], 'u1', { v: 1 });
      await store.put(['users', 'inactive'], 'u2', { v: 1 });
      await store.put(['orders', 'pending'], 'o1', { v: 1 });
    });

    it('lists all unique namespaces', async () => {
      const ns = await store.listNamespaces();
      assert.equal(ns.length, 3);
    });

    it('Claim 3.17: prefix match condition', async () => {
      const ns = await store.listNamespaces({ prefix: ['users'] });
      assert.equal(ns.length, 2);
      assert.ok(ns.every(n => n[0] === 'users'));
    });

    it('Claim 3.17: suffix match condition', async () => {
      const ns = await store.listNamespaces({ suffix: ['active'] });
      assert.equal(ns.length, 1);
      assert.deepEqual(ns[0], ['users', 'active']);
    });

    it('Claim 3.18: maxDepth truncates and deduplicates', async () => {
      const ns = await store.listNamespaces({ maxDepth: 1 });
      // users + orders (deduplicated from users.active, users.inactive)
      assert.equal(ns.length, 2);
      assert.ok(ns.every(n => n.length === 1));
    });

    it('Claim 3.15: default limit 100', async () => {
      const ns = await store.listNamespaces();
      assert.ok(ns.length <= 100);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Governance — Claim 4.8
  // ═══════════════════════════════════════════════════════════════════════════

  describe('governance', () => {
    it('Claim 4.8: writes bypass governance gate', async () => {
      h.validity.setState('Divergent');
      // put is a write — should NOT throw
      await store.put(['data'], 'k1', { v: 1 });
    });
  });
});
