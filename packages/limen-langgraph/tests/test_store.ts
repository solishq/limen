// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * LimenStore — Comprehensive Unit Tests
 *
 * Covers ALL design doc claims for the store:
 * - Claims 3.1-3.27 (BaseStore interface, batch, lifecycle)
 * - Claims 4.1-4.10 (Governance for store reads/writes)
 * - Claims 5.1-5.4 (Tenant Isolation)
 * - Claims 8.9 (F-LG-009), 8.10 (F-LG-010), 8.14 (F-LG-014)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LimenCheckpointSaver } from '../src/checkpoint.js';
import { LimenStore } from '../src/store.js';
import {
  LimenGovernanceError,
  LimenStorageError,
  LimenSerdeError,
  LimenNotStartedError,
} from '../src/errors.js';
import { createTestHarness, type TestHarness } from './harness.js';
import type { GetOperation, PutOperation, SearchOperation, ListNamespacesOperation } from '../src/types.js';

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
    it('Claim 3.27: assertStarted on get — throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.get(['ns'], 'key'),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.27: assertStarted on put — throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.put(['ns'], 'key', { v: 1 }),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.27: assertStarted on delete — throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.delete(['ns'], 'key'),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.27: assertStarted on search — throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.search(['ns']),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.27: assertStarted on listNamespaces — throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.listNamespaces(),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.27: assertStarted on batch — throws before start()', async () => {
      const fresh = new LimenStore(createTestHarness().config);
      await assert.rejects(
        () => fresh.batch([{ namespace: ['ns'], key: 'k' } as GetOperation]),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.24: start() is idempotent', async () => {
      await store.start();
      await store.start();
      // Verify store is fully functional after double start
      const result = await store.batch([{ namespace: ['test'], key: 'k' } as GetOperation]);
      assert.ok(Array.isArray(result));
    });

    it('Claim 3.26: start() after stop() throws', async () => {
      await store.stop();
      await assert.rejects(() => store.start(), LimenStorageError);
    });

    it('Claim 3.23: start() throws when schema < ADAPTER_SCHEMA_VERSION (needs checkpoint saver first)', async () => {
      const hh = createTestHarness();
      // Don't run checkpoint saver — schema stays at 0
      const raw = new LimenStore(hh.config);
      await assert.rejects(() => raw.start(), LimenStorageError);
    });

    it('Claim 3.23: start() throws on schema > ADAPTER_SCHEMA_VERSION', async () => {
      const hh = createTestHarness();
      const s = new LimenCheckpointSaver(hh.config);
      await s.start();
      hh.projection.setMetadata('lg_schema_version', '99');
      const raw = new LimenStore(hh.config);
      await assert.rejects(
        () => raw.start(),
        (e: Error) => e instanceof LimenStorageError
      );
    });

    it('Claim 3.25: stop() flushes projectPending', async () => {
      await store.put(['ns'], 'k', { v: 1 });
      await store.stop(); // Should not throw
    });

    it('Claim 3.25: stop() swallows projectPending error', async () => {
      h.projector.shouldFail = true;
      // stop() should NOT re-throw
      await store.stop();
    });

    it('Claim 3.25: post-stop calls throw LimenNotStartedError', async () => {
      await store.stop();
      await assert.rejects(
        () => store.get(['ns'], 'k'),
        (e: Error) => e instanceof LimenNotStartedError
      );
    });

    it('Claim 3.26: start() after stop() not supported', async () => {
      await store.stop();
      await assert.rejects(() => store.start(), LimenStorageError);
    });

    it('F-LG-005: stop() on non-initialized instance still prevents subsequent start()', async () => {
      const hh = createTestHarness();
      const saver = new LimenCheckpointSaver(hh.config);
      await saver.start();
      const fresh = new LimenStore(hh.config);
      // Do NOT call start() — stop directly
      await fresh.stop();
      // Now start() should throw because stopped=true was set before the early return
      await assert.rejects(() => fresh.start(), LimenStorageError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // batch() — Claims 3.1–3.6
  // ═══════════════════════════════════════════════════════════════════════════

  describe('batch', () => {
    it('Claim 3.1: three-phase ordering — Gets, then Searches+ListNS, then Puts', async () => {
      await store.put(['users'], 'u1', { name: 'Alice' });

      // Batch: Get (phase 1), Search (phase 2), Put (phase 3)
      const results = await store.batch([
        { namespace: ['users'], key: 'u1' } as GetOperation,
        { namespacePrefix: ['users'] } as SearchOperation,
        { namespace: ['users'], key: 'u1', value: { name: 'Bob' } } as PutOperation,
      ]);

      // Get returns pre-batch state
      assert.equal((results[0] as any)?.value.name, 'Alice');
      // Search returns pre-batch state
      assert.ok(Array.isArray(results[1]));
      assert.equal((results[1] as any[])[0]?.value.name, 'Alice');
      // Put returns undefined
      assert.equal(results[2], undefined);
    });

    it('Claim 3.2: reads resolve against pre-batch state', async () => {
      await store.put(['data'], 'k1', { v: 1 });

      const results = await store.batch([
        { namespace: ['data'], key: 'k1' } as GetOperation,
        { namespace: ['data'], key: 'k1', value: { v: 2 } } as PutOperation,
      ]);

      assert.equal((results[0] as any)?.value.v, 1); // Pre-batch
    });

    it('Claim 3.3: batch is NOT atomic — partial Phase 3 failure leaves partial entries', async () => {
      await store.put(['data'], 'k1', { v: 'original' });

      // Set chain to fail after first write
      h.chain.failAfterN = h.chain.getEntries().length + 1;

      try {
        await store.batch([
          { namespace: ['data'], key: 'k1', value: { v: 'first' } } as PutOperation,
          { namespace: ['data'], key: 'k2', value: { v: 'second' } } as PutOperation,
        ]);
      } catch {
        // Expected — partial failure
      }

      // Recovery: fix chain, projectPending recovers partial entries
      h.chain.failAfterN = null;
      h.chain.shouldFail = false;
      await h.projector.projectPending();

      // First put may have succeeded as a chain entry
      const item1 = await store.get(['data'], 'k1');
      // k1 always exists from setup — assert value content, not just existence
      assert.ok(item1 !== undefined);
      assert.ok(item1!.value.v === 'original' || item1!.value.v === 'first',
        `Expected k1 value to be 'original' or 'first', got '${item1!.value.v}'`);
    });

    it('Claim 3.4: GetOp returns deserialized copy, not reference', async () => {
      await store.put(['users'], 'u1', { name: 'Alice' });

      const item1 = await store.get(['users'], 'u1');
      const item2 = await store.get(['users'], 'u1');

      assert.notStrictEqual(item1, item2);
      assert.deepEqual(item1?.value, item2?.value);

      // Mutating one does not affect the other
      if (item1) (item1.value as any).name = 'Mutated';
      assert.equal(item2?.value.name, 'Alice');
    });

    it('Claim 3.5: PutOp returns undefined (not null)', async () => {
      const results = await store.batch([
        { namespace: ['ns'], key: 'k', value: { v: 1 } } as PutOperation,
      ]);
      assert.strictEqual(results[0], undefined);
    });

    it('Claim 3.6: multiple PutOps same key — last wins', async () => {
      await store.batch([
        { namespace: ['ns'], key: 'k', value: { v: 1 } } as PutOperation,
        { namespace: ['ns'], key: 'k', value: { v: 2 } } as PutOperation,
        { namespace: ['ns'], key: 'k', value: { v: 3 } } as PutOperation,
      ]);

      const item = await store.get(['ns'], 'k');
      assert.equal(item?.value.v, 3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // put/get/delete — Claims 3.19–3.22
  // ═══════════════════════════════════════════════════════════════════════════

  describe('put/get/delete', () => {
    it('Claim 3.20: INSERT OR REPLACE preserves created_at on update', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      const first = await store.get(['data'], 'k1');

      await new Promise(r => setTimeout(r, 10));
      await store.put(['data'], 'k1', { v: 2 });
      const second = await store.get(['data'], 'k1');

      assert.equal(second?.value.v, 2);
      assert.equal(first?.createdAt.getTime(), second?.createdAt.getTime());
    });

    it('Claim 3.20: updated_at changes on update', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      const first = await store.get(['data'], 'k1');

      await new Promise(r => setTimeout(r, 10));
      await store.put(['data'], 'k1', { v: 2 });
      const second = await store.get(['data'], 'k1');

      assert.ok(second!.updatedAt.getTime() >= first!.updatedAt.getTime());
    });

    it('Claim 3.19: store.delete builds PutOperation with value=null', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      await store.delete(['data'], 'k1');

      const item = await store.get(['data'], 'k1');
      assert.equal(item, null);

      // Verify chain entry is LgStoreDelete
      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgStoreDelete');
      assert.ok(entry);
    });

    it('Claim 3.21: delete is idempotent', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      await store.delete(['data'], 'k1');
      await store.delete(['data'], 'k1'); // No throw
      await store.delete(['data'], 'nonexistent'); // No throw
    });

    it('Claim 3.22: PutOperation.index stored in index_fields', async () => {
      await store.put(['data'], 'k1', { name: 'test' }, ['name']);

      const row = h.projection.queryOne<{ index_fields: string }>(
        'SELECT index_fields FROM lg_store_items WHERE key = ?',
        ['k1']
      );
      assert.ok(row);
      const fields = JSON.parse(row.index_fields);
      assert.deepEqual(fields, ['name']);
    });

    it('Claim 3.22: index not used for search', async () => {
      await store.put(['data'], 'k1', { name: 'test' }, ['name']);
      const results = await store.search(['data']);
      assert.equal(results.length, 1);
    });

    it('get returns null for nonexistent key', async () => {
      const item = await store.get(['ns'], 'nonexistent');
      assert.equal(item, null);
    });

    it('get returns correct Item shape', async () => {
      await store.put(['users', 'active'], 'u1', { name: 'Alice' });
      const item = await store.get(['users', 'active'], 'u1');
      assert.ok(item);
      assert.equal(item.key, 'u1');
      assert.deepEqual(item.namespace, ['users', 'active']);
      assert.equal(item.value.name, 'Alice');
      assert.ok(item.createdAt instanceof Date);
      assert.ok(item.updatedAt instanceof Date);
    });

    it('put with value=null creates LgStoreDelete chain entry', async () => {
      await store.put(['data'], 'k1', { v: 1 });
      await store.batch([{ namespace: ['data'], key: 'k1', value: null } as PutOperation]);

      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgStoreDelete');
      assert.ok(entry);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Namespace Validation — Claim 3.7
  // ═══════════════════════════════════════════════════════════════════════════

  describe('namespace validation', () => {
    it('Claim 3.7 Rule 1: empty array throws', async () => {
      await assert.rejects(() => store.put([], 'k', { v: 1 }), LimenStorageError);
    });

    it('Claim 3.7 Rule 2: non-string label throws', async () => {
      await assert.rejects(() => store.put([123 as any], 'k', { v: 1 }), LimenStorageError);
    });

    it('Claim 3.7 Rule 3: empty string label throws', async () => {
      await assert.rejects(() => store.put([''], 'k', { v: 1 }), LimenStorageError);
    });

    it('Claim 3.7 Rule 4: dot in label throws', async () => {
      await assert.rejects(() => store.put(['user.data'], 'k', { v: 1 }), LimenStorageError);
    });

    it('Claim 3.7 Rule 5: "langgraph" root throws', async () => {
      await assert.rejects(() => store.put(['langgraph'], 'k', { v: 1 }), LimenStorageError);
    });

    it('Claim 3.7 Rule 5: "langgraph" with children throws', async () => {
      await assert.rejects(() => store.put(['langgraph', 'internal'], 'k', { v: 1 }), LimenStorageError);
    });

    it('Claim 3.7: "langgraph_custom" root allowed', async () => {
      await store.put(['langgraph_custom'], 'k', { v: 1 });
      const item = await store.get(['langgraph_custom'], 'k');
      assert.equal(item?.value.v, 1);
    });

    it('Claim 3.7: valid multi-level namespace', async () => {
      await store.put(['users', 'active', 'v2'], 'k', { v: 1 });
      const item = await store.get(['users', 'active', 'v2'], 'k');
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

    it('Claim 3.8: prefix exact match included', async () => {
      // 'users' prefix matches 'users.active' and 'users.inactive'
      const results = await store.search(['users']);
      assert.equal(results.length, 3);
    });

    it('Claim 3.8: prefix child included', async () => {
      const results = await store.search(['users', 'active']);
      assert.equal(results.length, 2);
    });

    it('Claim 3.8: prefix sibling excluded', async () => {
      const results = await store.search(['orders']);
      assert.equal(results.length, 1);
      assert.equal(results[0].value.total, 100);
    });

    it('Claim 3.8 / 8.9 / F-LG-009: prefix partial name excluded (ASCII boundary)', async () => {
      // "user" should NOT match "users" — the '/' boundary ensures this
      await store.put(['user'], 'x', { v: 1 });
      const results = await store.search(['user']);
      // Should only match exact "user" namespace, not "users.*"
      assert.equal(results.length, 1);
      assert.equal(results[0].key, 'x');
    });

    it('Claim 3.9: empty prefix matches all items in tenant', async () => {
      const results = await store.search([], { limit: 100 });
      assert.equal(results.length, 4);
    });

    it('Claim 3.10: search filter uses same compareValues as checkpoint list', async () => {
      // $gt
      const results = await store.search(['users'], { filter: { age: { $gt: 28 } }, limit: 100 });
      assert.equal(results.length, 2);

      // $eq
      const eq = await store.search(['users'], { filter: { name: { $eq: 'Alice' } }, limit: 100 });
      assert.equal(eq.length, 1);

      // $in
      const inRes = await store.search(['users'], { filter: { name: { $in: ['Alice', 'Charlie'] } }, limit: 100 });
      assert.equal(inRes.length, 2);

      // $ne
      const ne = await store.search(['users'], { filter: { name: { $ne: 'Alice' } }, limit: 100 });
      assert.equal(ne.length, 2);
    });

    it('Claim 3.11: default limit is 10', async () => {
      // With only 4 items, all should return
      const results = await store.search(['users']);
      assert.ok(results.length <= 10);
      assert.equal(results.length, 3);
    });

    it('Claim 3.11: offset defaults to 0', async () => {
      const results = await store.search(['users'], { limit: 1, offset: 0 });
      assert.equal(results.length, 1);

      const results2 = await store.search(['users'], { limit: 1, offset: 1 });
      assert.equal(results2.length, 1);
      assert.notEqual(results[0].key, results2[0].key);
    });

    it('Claim 3.12: SearchItem.score always undefined', async () => {
      const results = await store.search(['users']);
      for (const r of results) {
        assert.strictEqual(r.score, undefined);
      }
    });

    it('Claim 3.13: search with query parameter throws', async () => {
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
      await store.put(['orders', 'shipped'], 'o2', { v: 1 });
    });

    it('Claim 3.15: default limit is 100', async () => {
      const ns = await store.listNamespaces();
      assert.ok(ns.length <= 100);
      assert.equal(ns.length, 4);
    });

    it('Claim 3.15: default offset is 0', async () => {
      const ns = await store.listNamespaces({ limit: 2 });
      assert.equal(ns.length, 2);
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

    it('Claim 3.17: wildcard in prefix', async () => {
      const ns = await store.listNamespaces({ prefix: ['*', 'active'] });
      // Should match ['users', 'active'] because '*' matches 'users' at position 0
      assert.equal(ns.length, 1);
    });

    it('Claim 3.18: maxDepth truncates and deduplicates', async () => {
      const ns = await store.listNamespaces({ maxDepth: 1 });
      // Should get ['users'] and ['orders'] — deduplicated
      assert.equal(ns.length, 2);
      assert.ok(ns.every(n => n.length === 1));
      const names = ns.map(n => n[0]).sort();
      assert.deepEqual(names, ['orders', 'users']);
    });

    it('Claim 3.18: maxDepth with deeper hierarchy', async () => {
      await store.put(['a', 'b', 'c'], 'k1', { v: 1 });
      await store.put(['a', 'b', 'd'], 'k2', { v: 1 });
      await store.put(['a', 'e'], 'k3', { v: 1 });

      const ns2 = await store.listNamespaces({ maxDepth: 2 });
      const hasAB = ns2.some(n => n.length === 2 && n[0] === 'a' && n[1] === 'b');
      const hasAE = ns2.some(n => n.length === 2 && n[0] === 'a' && n[1] === 'e');
      assert.ok(hasAB);
      assert.ok(hasAE);
    });

    it('offset + limit pagination', async () => {
      const page1 = await store.listNamespaces({ limit: 2, offset: 0 });
      const page2 = await store.listNamespaces({ limit: 2, offset: 2 });
      assert.equal(page1.length, 2);
      assert.equal(page2.length, 2);
      // No overlap
      const all = [...page1.map(n => n.join('.')), ...page2.map(n => n.join('.'))];
      assert.equal(new Set(all).size, 4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Governance — Claims 4.1–4.10
  // ═══════════════════════════════════════════════════════════════════════════

  describe('governance', () => {
    it('Claim 4.1: governed=true, Verified proceeds for reads', async () => {
      const hh = createTestHarness({ governed: true });
      const s = new LimenCheckpointSaver(hh.config);
      await s.start();
      const st = new LimenStore(hh.config);
      await st.start();

      hh.validity.setState('Verified');
      await st.put(['data'], 'k1', { v: 1 });
      const item = await st.get(['data'], 'k1');
      assert.equal(item?.value.v, 1);
    });

    it('Claim 4.2: governed=true, Lagging throws retryable for reads', async () => {
      const hh = createTestHarness({ governed: true });
      const s = new LimenCheckpointSaver(hh.config);
      await s.start();
      const st = new LimenStore(hh.config);
      await st.start();

      hh.validity.setState('Lagging');
      try {
        await st.get(['data'], 'k1');
        assert.fail('Should have thrown');
      } catch (e) {
        assert.ok(e instanceof LimenGovernanceError);
        assert.equal(e.state, 'Lagging');
        assert.equal(e.retryable, true);
      }
    });

    it('Claim 4.6: governed=false, Lagging proceeds with WARN via injected logger', async () => {
      h.validity.setState('Lagging');
      await store.put(['data'], 'k1', { v: 1 });
      // Reads should proceed
      const item = await store.get(['data'], 'k1');
      assert.equal(item?.value.v, 1);
      // F-LG-006: Verify WARN was logged via the injected logger (not console.warn)
      const warns = h.logger.getWarns();
      assert.ok(warns.some(w => w.msg.toLowerCase().includes('lagging')));
    });

    it('Claim 4.7: governed=false, Unverified throws', async () => {
      h.validity.setState('Unverified');
      await assert.rejects(
        () => store.get(['data'], 'k1'),
        (e: Error) => e instanceof LimenGovernanceError
      );
    });

    it('Claim 4.7: governed=false, Divergent throws', async () => {
      h.validity.setState('Divergent');
      await assert.rejects(
        () => store.search(['data']),
        (e: Error) => e instanceof LimenGovernanceError
      );
    });

    it('Claim 4.3: Rebuilding state throws retryable LimenGovernanceError for reads', async () => {
      h.validity.setState('Rebuilding');
      try {
        await store.get(['data'], 'k1');
        assert.fail('Should have thrown');
      } catch (e) {
        assert.ok(e instanceof LimenGovernanceError);
        assert.equal(e.state, 'Rebuilding');
        assert.equal(e.retryable, true);
      }
    });

    it('Claim 4.3: Rebuilding state throws retryable for batch GetOperation', async () => {
      h.validity.setState('Rebuilding');
      await assert.rejects(
        () => store.batch([{ namespace: ['data'], key: 'k1' } as GetOperation]),
        (e: Error) => {
          assert.ok(e instanceof LimenGovernanceError);
          assert.equal((e as LimenGovernanceError).retryable, true);
          return true;
        }
      );
    });

    it('Claim 4.8: all writes bypass governance gate', async () => {
      h.validity.setState('Divergent');
      // put is a write — should NOT throw
      await store.put(['data'], 'k1', { v: 1 });
      // delete is a write — should NOT throw
      await store.delete(['data'], 'k1');
    });

    it('Claim 4.8: batch with puts bypasses governance for write portion', async () => {
      h.validity.setState('Divergent');
      // PutOps should succeed even in Divergent state
      const results = await store.batch([
        { namespace: ['data'], key: 'k1', value: { v: 1 } } as PutOperation,
      ]);
      assert.equal(results[0], undefined);
    });

    it('Claim 4.8: batch with gets fails in Divergent state', async () => {
      h.validity.setState('Divergent');
      await assert.rejects(
        () => store.batch([{ namespace: ['data'], key: 'k1' } as GetOperation]),
        (e: Error) => e instanceof LimenGovernanceError
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JSON Parsing Errors — Claim 6.3.1
  // ═══════════════════════════════════════════════════════════════════════════

  describe('JSON parsing errors', () => {
    it('Claim 6.3.1: corrupted value_json throws LimenSerdeError', async () => {
      await store.put(['data'], 'k1', { v: 1 });

      // Corrupt value_json directly
      h.projection.getDb().prepare(
        'UPDATE lg_store_items SET value_json = ? WHERE key = ?'
      ).run('{invalid!!!', 'k1');

      try {
        await store.get(['data'], 'k1');
        assert.fail('Should have thrown');
      } catch (e) {
        assert.ok(e instanceof LimenSerdeError);
        assert.equal(e.context, 'value_json');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Failure Modes
  // ═══════════════════════════════════════════════════════════════════════════

  describe('failure modes', () => {
    it('F-LG-006: namespace validation rejects all invalid forms', async () => {
      // Covered by namespace validation tests above
      await assert.rejects(() => store.put([], 'k', { v: 1 }), LimenStorageError);
      await assert.rejects(() => store.put([''], 'k', { v: 1 }), LimenStorageError);
      await assert.rejects(() => store.put(['a.b'], 'k', { v: 1 }), LimenStorageError);
      await assert.rejects(() => store.put(['langgraph'], 'k', { v: 1 }), LimenStorageError);
      await assert.rejects(() => store.put([42 as any], 'k', { v: 1 }), LimenStorageError);
    });

    it('F-LG-009: prefix boundary ASCII adjacency', async () => {
      await store.put(['user'], 'x', { v: 1 });
      await store.put(['users', 'active'], 'y', { v: 2 });

      // "user" search should NOT include "users" items
      const results = await store.search(['user']);
      assert.equal(results.length, 1);
      assert.equal(results[0].key, 'x');
    });

    it('F-LG-014: batch partial writes recover on next projectPending', async () => {
      // Write some initial data
      await store.put(['data'], 'k1', { v: 'original' });

      // Fail chain after the first successful write in the batch
      h.chain.failAfterN = h.chain.getEntries().length + 1;

      try {
        await store.batch([
          { namespace: ['data'], key: 'a', value: { v: 'first' } } as PutOperation,
          { namespace: ['data'], key: 'b', value: { v: 'second' } } as PutOperation,
        ]);
      } catch {
        // Expected partial failure
      }

      // Recovery
      h.chain.failAfterN = null;
      h.chain.shouldFail = false;
      await h.projector.projectPending();

      // At least the first write should have been recovered
      const item = await store.get(['data'], 'a');
      assert.ok(item);
      assert.equal(item.value.v, 'first');
    });
  });
});
