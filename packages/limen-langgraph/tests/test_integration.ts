/**
 * Integration Tests
 *
 * End-to-end lifecycle tests exercising the full adapter stack:
 * - Full lifecycle (start -> operations -> stop)
 * - Governed fail-closed behavior
 * - Multi-tenant isolation
 * - Partial write recovery
 * - Stop + recover scenario
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
import {
  createTestHarness,
  makeCheckpoint,
  makeMetadata,
  makeConfig,
  type TestHarness,
  InMemoryChain,
  SqliteProjection,
  InMemoryProjector,
  MockValidity,
  CaptureLogger,
} from './harness.js';
import type { ValidityState, LimenCheckpointerConfig, RunnableConfig } from '../src/types.js';

describe('Integration: Full Lifecycle', () => {
  it('complete lifecycle: start -> write -> read -> delete -> stop', async () => {
    const h = createTestHarness();
    const saver = new LimenCheckpointSaver(h.config);
    const store = new LimenStore(h.config);

    // 1. Start both
    await saver.start();
    await store.start();

    // 2. Write checkpoint
    await saver.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});

    // 3. Write pending writes
    await saver.putWrites(
      makeConfig('t1', { checkpoint_id: 'cp1' }),
      [['messages', 'hello'], ['__error__', { msg: 'err' }]],
      'task1'
    );

    // 4. Write store items
    await store.put(['users'], 'u1', { name: 'Alice' });
    await store.put(['users'], 'u2', { name: 'Bob' });

    // 5. Read checkpoint
    const tuple = await saver.getTuple(makeConfig('t1'));
    assert.ok(tuple);
    assert.equal(tuple.checkpoint.id, 'cp1');
    assert.equal(tuple.pendingWrites.length, 2);

    // 6. Read store
    const item = await store.get(['users'], 'u1');
    assert.equal(item?.value.name, 'Alice');

    // 7. Search store
    const results = await store.search(['users']);
    assert.equal(results.length, 2);

    // 8. List checkpoints
    const listed: any[] = [];
    for await (const t of saver.list(makeConfig('t1'))) listed.push(t);
    assert.equal(listed.length, 1);

    // 9. Delete thread
    await saver.deleteThread('t1');
    assert.equal(await saver.getTuple(makeConfig('t1')), undefined);

    // 10. Store items survive thread delete
    assert.ok(await store.get(['users'], 'u1'));

    // 11. Stop both
    await saver.stop();
    await store.stop();

    // 12. Post-stop operations throw
    await assert.rejects(
      () => saver.getTuple(makeConfig('t1')),
      LimenNotStartedError
    );
    await assert.rejects(
      () => store.get(['users'], 'u1'),
      LimenNotStartedError
    );
  });
});

describe('Integration: Governed Fail-Closed', () => {
  it('governed=true blocks reads in all non-Verified states', async () => {
    const h = createTestHarness({ governed: true });
    const saver = new LimenCheckpointSaver(h.config);
    await saver.start();

    // Write data while Verified
    h.validity.setState('Verified');
    await saver.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});

    // Test each non-Verified state
    const states: Array<{ state: ValidityState; retryable: boolean }> = [
      { state: 'Lagging', retryable: true },
      { state: 'Unverified', retryable: false },
      { state: 'Divergent', retryable: false },
      { state: 'Rebuilding', retryable: true },
    ];

    for (const { state, retryable } of states) {
      h.validity.setState(state);
      try {
        await saver.getTuple(makeConfig('t1'));
        assert.fail(`Should have thrown for state ${state}`);
      } catch (e) {
        assert.ok(e instanceof LimenGovernanceError, `Expected LimenGovernanceError for ${state}`);
        assert.equal(e.state, state);
        assert.equal(e.retryable, retryable, `Expected retryable=${retryable} for ${state}`);
      }
    }

    // Writes still work in non-Verified states
    h.validity.setState('Divergent');
    await saver.put(
      makeConfig('t1', { checkpoint_id: 'cp1' }),
      makeCheckpoint('cp2'),
      makeMetadata(1),
      {}
    );

    // Recovery: Verified again
    h.validity.setState('Verified');
    const result = await saver.getTuple(makeConfig('t1'));
    assert.ok(result);
    assert.equal(result.checkpoint.id, 'cp2');
  });

  it('governed=false allows Lagging reads with WARN', async () => {
    const h = createTestHarness({ governed: false });
    const saver = new LimenCheckpointSaver(h.config);
    await saver.start();

    await saver.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});
    h.validity.setState('Lagging');

    const result = await saver.getTuple(makeConfig('t1'));
    assert.ok(result);
    assert.equal(result.checkpoint.id, 'cp1');

    // Check WARN was logged
    const warns = h.logger.getWarns();
    assert.ok(warns.length > 0);
    assert.ok(warns.some(w => w.msg.toLowerCase().includes('lagging')));
  });
});

describe('Integration: Multi-Tenant', () => {
  it('complete tenant isolation across checkpoint + store', async () => {
    // Shared infrastructure (chain, projection, projector)
    const h = createTestHarness();
    const saverA = new LimenCheckpointSaver({ ...h.config, tenantScope: 'tenant_a' });
    const saverB = new LimenCheckpointSaver({ ...h.config, tenantScope: 'tenant_b' });
    const storeA = new LimenStore({ ...h.config, tenantScope: 'tenant_a' });
    const storeB = new LimenStore({ ...h.config, tenantScope: 'tenant_b' });

    await saverA.start();
    await saverB.start();
    await storeA.start();
    await storeB.start();

    // Tenant A writes
    await saverA.put(makeConfig('shared-thread'), makeCheckpoint('cp_a'), makeMetadata(0), {});
    await storeA.put(['data'], 'key1', { tenant: 'a' });

    // Tenant B writes (same thread_id, same store key)
    await saverB.put(makeConfig('shared-thread'), makeCheckpoint('cp_b'), makeMetadata(0), {});
    await storeB.put(['data'], 'key1', { tenant: 'b' });

    // Reads are isolated
    const cpA = await saverA.getTuple(makeConfig('shared-thread'));
    const cpB = await saverB.getTuple(makeConfig('shared-thread'));
    assert.equal(cpA?.checkpoint.id, 'cp_a');
    assert.equal(cpB?.checkpoint.id, 'cp_b');

    const itemA = await storeA.get(['data'], 'key1');
    const itemB = await storeB.get(['data'], 'key1');
    assert.equal(itemA?.value.tenant, 'a');
    assert.equal(itemB?.value.tenant, 'b');

    // Delete tenant A — tenant B unaffected
    await saverA.deleteThread('shared-thread');
    assert.equal(await saverA.getTuple(makeConfig('shared-thread')), undefined);
    assert.ok(await saverB.getTuple(makeConfig('shared-thread')));

    // Store searches isolated
    const searchA = await storeA.search(['data']);
    const searchB = await storeB.search(['data']);
    assert.equal(searchA.length, 1);
    assert.equal(searchA[0].value.tenant, 'a');
    assert.equal(searchB.length, 1);
    assert.equal(searchB[0].value.tenant, 'b');
  });
});

describe('Integration: Partial Write Recovery', () => {
  it('chain entry preserved when projectPending fails, recovers on next call', async () => {
    const h = createTestHarness();
    const saver = new LimenCheckpointSaver(h.config);
    await saver.start();

    // Write succeeds to chain, but projectPending fails
    h.projector.shouldFail = true;

    try {
      await saver.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});
    } catch {
      // Expected
    }

    // Chain has the entry
    assert.equal(h.chain.getEntries().length, 1);

    // Projection doesn't have it yet
    const rows = h.projection.query('SELECT * FROM lg_checkpoints', []);
    assert.equal(rows.length, 0);

    // Recovery: projectPending succeeds
    h.projector.shouldFail = false;
    await h.projector.projectPending();

    // Now readable
    const result = await saver.getTuple(makeConfig('t1'));
    assert.ok(result);
    assert.equal(result.checkpoint.id, 'cp1');
  });

  it('multiple failed projectPending calls recover in batch', async () => {
    const h = createTestHarness();
    const saver = new LimenCheckpointSaver(h.config);
    await saver.start();

    // Write 3 checkpoints with failing projection
    h.projector.shouldFail = true;
    for (let i = 0; i < 3; i++) {
      try {
        await saver.put(
          makeConfig('t1', i > 0 ? { checkpoint_id: `cp${i - 1}` } : {}),
          makeCheckpoint(`cp${i}`),
          makeMetadata(i),
          {}
        );
      } catch {
        // Expected
      }
    }

    assert.equal(h.chain.getEntries().length, 3);

    // Single recovery call processes all 3
    h.projector.shouldFail = false;
    await h.projector.projectPending();

    const result = await saver.getTuple(makeConfig('t1'));
    assert.ok(result);
    assert.equal(result.checkpoint.id, 'cp2'); // Latest

    const all: any[] = [];
    for await (const t of saver.list(makeConfig('t1'))) all.push(t);
    assert.equal(all.length, 3);
  });
});

describe('Integration: Stop + Recover', () => {
  it('stop flushes pending, new instance recovers state', async () => {
    const chain = new InMemoryChain();
    const projection = new SqliteProjection();
    const projector = new InMemoryProjector(chain, projection);
    const validity = new MockValidity();
    const logger = new CaptureLogger();

    const config: LimenCheckpointerConfig = {
      chain, projection, projector, validity, logger,
      governed: false,
      tenantScope: '__default__',
    };

    // Instance 1: write and stop
    const saver1 = new LimenCheckpointSaver(config);
    await saver1.start();
    await saver1.put(makeConfig('t1'), makeCheckpoint('cp1'), makeMetadata(0), {});
    await saver1.stop();

    // Instance 2: new instance on same storage
    const saver2 = new LimenCheckpointSaver({
      chain, projection, projector, validity, logger,
      governed: false,
      tenantScope: '__default__',
    });
    await saver2.start();

    // Data survives
    const result = await saver2.getTuple(makeConfig('t1'));
    assert.ok(result);
    assert.equal(result.checkpoint.id, 'cp1');

    await saver2.stop();
  });

  it('store stop + new instance preserves data', async () => {
    const chain = new InMemoryChain();
    const projection = new SqliteProjection();
    const projector = new InMemoryProjector(chain, projection);
    const validity = new MockValidity();
    const logger = new CaptureLogger();

    const config: LimenCheckpointerConfig = {
      chain, projection, projector, validity, logger,
    };

    // Initialize schema with checkpoint saver
    const saver = new LimenCheckpointSaver(config);
    await saver.start();

    // Store instance 1: write and stop
    const store1 = new LimenStore(config);
    await store1.start();
    await store1.put(['data'], 'k1', { v: 1 });
    await store1.stop();

    // Store instance 2: new instance
    const store2 = new LimenStore(config);
    await store2.start();
    const item = await store2.get(['data'], 'k1');
    assert.ok(item);
    assert.equal(item.value.v, 1);

    await store2.stop();
    await saver.stop();
  });
});

describe('Integration: Error Types', () => {
  it('all 4 error types have correct names', () => {
    assert.equal(new LimenGovernanceError({ state: 'X', retryable: false }).name, 'LimenGovernanceError');
    assert.equal(new LimenStorageError('x').name, 'LimenStorageError');
    assert.equal(new LimenNotStartedError().name, 'LimenNotStartedError');

    const serdeErr = new LimenSerdeError({ typeTag: 'json', dataLength: 0, cause: new Error('x') });
    assert.equal(serdeErr.name, 'LimenSerdeError');
  });

  it('LimenGovernanceError fields are accessible', () => {
    const err = new LimenGovernanceError({
      state: 'Divergent',
      retryable: false,
      guidance: 'Rebuild projection',
      reason: 'digest mismatch',
    });
    assert.equal(err.state, 'Divergent');
    assert.equal(err.retryable, false);
    assert.equal(err.guidance, 'Rebuild projection');
    assert.equal(err.reason, 'digest mismatch');
    assert.ok(err.message.includes('Divergent'));
  });

  it('LimenStorageError has detail field', () => {
    const err = new LimenStorageError('SQLITE_BUSY after 3 retries');
    assert.equal(err.detail, 'SQLITE_BUSY after 3 retries');
    assert.ok(err.message.includes('SQLITE_BUSY'));
  });
});
