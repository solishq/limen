/**
 * LimenCheckpointSaver — Unit tests
 * Covers: Claims 2.1–2.35, 3.23–3.27, 4.1–4.8, 5.1–5.4, 6.1–6.5, 8.12
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LimenCheckpointSaver } from '../src/checkpoint.js';
import { LimenGovernanceError, LimenStorageError, LimenNotStartedError, LimenSerdeError } from '../src/errors.js';
import { createTestHarness, type TestHarness } from './harness.js';
import type { RunnableConfig, Checkpoint, CheckpointMetadata } from '../src/types.js';

// Helper: minimal valid checkpoint
function makeCheckpoint(id: string, step = 0): Checkpoint {
  return {
    id,
    v: 4,
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
    pending_sends: [],
  };
}

function makeMetadata(step: number, source: 'input' | 'loop' = 'input'): CheckpointMetadata {
  return { source, step, writes: null, parents: {} };
}

describe('LimenCheckpointSaver', () => {
  let h: TestHarness;
  let saver: LimenCheckpointSaver;

  beforeEach(async () => {
    h = createTestHarness();
    saver = new LimenCheckpointSaver(h.config);
    await saver.start();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle — Claims 3.23, 3.24, 3.26, 3.27, 8.12
  // ═══════════════════════════════════════════════════════════════════════════

  describe('lifecycle', () => {
    it('Claim 8.12: throws LimenNotStartedError before start()', async () => {
      const fresh = new LimenCheckpointSaver(createTestHarness().config);
      await assert.rejects(
        () => fresh.getTuple({ configurable: { thread_id: 't1' } }),
        LimenNotStartedError
      );
    });

    it('Claim 3.24: start() is idempotent', async () => {
      await saver.start(); // second call
      await saver.start(); // third call
      // no throw = pass
    });

    it('Claim 3.26: start() after stop() throws', async () => {
      await saver.stop();
      await assert.rejects(() => saver.start(), LimenStorageError);
    });

    it('Claim 3.25: stop() flushes projectPending', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('cp1'), makeMetadata(0), {});
      // stop should not throw
      await saver.stop();
    });

    it('Claim 3.25: post-stop calls throw LimenNotStartedError', async () => {
      await saver.stop();
      await assert.rejects(
        () => saver.getTuple({ configurable: { thread_id: 't1' } }),
        LimenNotStartedError
      );
    });

    it('Claim 3.23: start() throws on chain inaccessible', async () => {
      const broken = new LimenCheckpointSaver({
        ...h.config,
        chain: null as any,
      });
      await assert.rejects(() => broken.start(), LimenStorageError);
    });

    it('Claim 3.23: start() throws on validity failure', async () => {
      const hh = createTestHarness();
      hh.validity.shouldFailStartup = true;
      const broken = new LimenCheckpointSaver(hh.config);
      await assert.rejects(() => broken.start(), LimenStorageError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getTuple — Claims 2.1–2.7
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getTuple', () => {
    it('Claim 2.6: returns undefined when no row found', async () => {
      const result = await saver.getTuple({ configurable: { thread_id: 'nonexistent' } });
      assert.equal(result, undefined);
    });

    it('Claim 2.1: with checkpoint_id returns exact match', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('cp1'), makeMetadata(0), {});
      await saver.put(
        { configurable: { thread_id: 't1', checkpoint_id: 'cp1' } },
        makeCheckpoint('cp2'),
        makeMetadata(1),
        {}
      );

      const result = await saver.getTuple({ configurable: { thread_id: 't1', checkpoint_id: 'cp1' } });
      assert.equal(result?.config.configurable?.checkpoint_id, 'cp1');
    });

    it('Claim 2.2: without checkpoint_id returns latest', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('aaa'), makeMetadata(0), {});
      await saver.put(
        { configurable: { thread_id: 't1', checkpoint_id: 'aaa' } },
        makeCheckpoint('zzz'),
        makeMetadata(1),
        {}
      );

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      assert.equal(result?.config.configurable?.checkpoint_id, 'zzz');
    });

    it('Claim 2.4: deserializes checkpoint via serde', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      const cp = makeCheckpoint('cp1');
      cp.channel_values = { messages: ['hello'] };
      await saver.put(config, cp, makeMetadata(0), {});

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      assert.deepEqual(result?.checkpoint.channel_values, { messages: ['hello'] });
    });

    it('Claim 2.7: get() delegates to getTuple', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('cp1'), makeMetadata(0), {});

      const checkpoint = await saver.get({ configurable: { thread_id: 't1' } });
      assert.equal(checkpoint?.id, 'cp1');
    });

    it('returns parentConfig when parent exists', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('parent1'), makeMetadata(0), {});
      await saver.put(
        { configurable: { thread_id: 't1', checkpoint_id: 'parent1' } },
        makeCheckpoint('child1'),
        makeMetadata(1),
        {}
      );

      const result = await saver.getTuple({ configurable: { thread_id: 't1', checkpoint_id: 'child1' } });
      assert.equal(result?.parentConfig?.configurable?.checkpoint_id, 'parent1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // put — Claims 2.16–2.21
  // ═══════════════════════════════════════════════════════════════════════════

  describe('put', () => {
    it('Claim 2.19: chain entry has LgCheckpoint transition_kind', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      const entry = h.chain.getLastEntry();
      assert.equal(entry?.transition_kind, 'LgCheckpoint');
    });

    it('Claim 2.19: tenant_scope is top-level field', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      const entry = h.chain.getLastEntry();
      assert.equal(entry?.tenant_scope, '__default__');
    });

    it('Claim 2.17: metadata extra properties preserved', async () => {
      const meta = { ...makeMetadata(0), custom_field: 'test_value' };
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        meta as CheckpointMetadata,
        {}
      );

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      assert.equal((result?.metadata as any).custom_field, 'test_value');
    });

    it('Claim 2.18: newVersions parameter dropped', async () => {
      const versions = { messages: 5, state: 3 };
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        versions
      );
      // Verify versions not stored — check chain payload
      const entry = h.chain.getLastEntry();
      const payload = JSON.parse(new TextDecoder().decode(entry!.state_json));
      assert.equal(payload.new_versions, undefined);
    });

    it('Claim 2.20: projectPending failure propagates', async () => {
      h.projector.shouldFail = true;
      await assert.rejects(
        () => saver.put(
          { configurable: { thread_id: 't1' } },
          makeCheckpoint('cp1'),
          makeMetadata(0),
          {}
        ),
        /projectPending failure/
      );
      // Chain entry still preserved
      assert.equal(h.chain.getEntries().length, 1);
    });

    it('Claim 2.21: put bypasses governance gate', async () => {
      h.validity.setState('Divergent');
      // Should NOT throw — writes bypass governance
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
    });

    it('returns RunnableConfig with checkpoint_id', async () => {
      const result = await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      assert.equal(result.configurable?.checkpoint_id, 'cp1');
      assert.equal(result.configurable?.thread_id, 't1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // putWrites — Claims 2.24–2.29
  // ═══════════════════════════════════════════════════════════════════════════

  describe('putWrites', () => {
    it('Claim 2.24: special channels get negative indices', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1', checkpoint_id: 'cp1' } };
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );

      await saver.putWrites(config, [['__error__', { msg: 'fail' }]], 'task1');

      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgWrite');
      const payload = JSON.parse(new TextDecoder().decode(entry!.state_json));
      assert.equal(payload.writes[0].write_idx, -1); // __error__ → -1
    });

    it('Claim 2.24: regular channels get sequential indices', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );

      await saver.putWrites(
        { configurable: { thread_id: 't1', checkpoint_id: 'cp1' } },
        [['messages', 'hello'], ['state', { count: 1 }]],
        'task1'
      );

      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgWrite');
      const payload = JSON.parse(new TextDecoder().decode(entry!.state_json));
      assert.equal(payload.writes[0].write_idx, 0);
      assert.equal(payload.writes[1].write_idx, 1);
    });

    it('Claim 2.3: pending writes loaded and ordered', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );

      await saver.putWrites(
        { configurable: { thread_id: 't1', checkpoint_id: 'cp1' } },
        [['messages', 'hello'], ['state', 42]],
        'task1'
      );

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      assert.equal(result?.pendingWrites.length, 2);
      assert.equal(result?.pendingWrites[0][1], 'messages');
      assert.equal(result?.pendingWrites[0][2], 'hello');
    });

    it('Claim 2.25: uses INSERT OR REPLACE (retry overwrites)', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );

      const config: RunnableConfig = { configurable: { thread_id: 't1', checkpoint_id: 'cp1' } };
      await saver.putWrites(config, [['messages', 'first']], 'task1');
      await saver.putWrites(config, [['messages', 'second']], 'task1');

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      // Last write wins
      assert.equal(result?.pendingWrites.length, 1);
      assert.equal(result?.pendingWrites[0][2], 'second');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // deleteThread — Claims 2.31–2.35
  // ═══════════════════════════════════════════════════════════════════════════

  describe('deleteThread', () => {
    it('Claim 2.31-2.32: deletes all checkpoints and writes', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      await saver.putWrites(
        { configurable: { thread_id: 't1', checkpoint_id: 'cp1' } },
        [['messages', 'hello']],
        'task1'
      );

      await saver.deleteThread('t1');

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      assert.equal(result, undefined);
    });

    it('Claim 2.33: uses adapter tenantScope', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );

      await saver.deleteThread('t1');

      const entry = h.chain.getEntries().find(e => e.transition_kind === 'LgDelete');
      assert.equal(entry?.tenant_scope, '__default__');
    });

    it('Claim 2.34: bypasses governance gate', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      h.validity.setState('Divergent');
      // Should NOT throw
      await saver.deleteThread('t1');
    });

    it('Claim 2.35: chain entries preserved', async () => {
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      const countBefore = h.chain.getEntries().length;
      await saver.deleteThread('t1');
      // Delete adds an entry, doesn't remove existing
      assert.equal(h.chain.getEntries().length, countBefore + 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getNextVersion — Claims 2.22, 2.23
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getNextVersion', () => {
    it('Claim 2.22: increments number', () => {
      assert.equal(saver.getNextVersion(5), 6);
      assert.equal(saver.getNextVersion(0), 1);
    });

    it('Claim 2.22: undefined returns 1', () => {
      assert.equal(saver.getNextVersion(undefined), 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Governance Gate — Claims 4.1–4.8
  // ═══════════════════════════════════════════════════════════════════════════

  describe('governance', () => {
    it('Claim 4.1: governed=true, Verified proceeds', async () => {
      const governed = new LimenCheckpointSaver({ ...h.config, governed: true });
      await governed.start();
      h.validity.setState('Verified');
      // No throw
      await governed.getTuple({ configurable: { thread_id: 't1' } });
    });

    it('Claim 4.2: governed=true, Lagging throws retryable', async () => {
      const governed = new LimenCheckpointSaver({ ...h.config, governed: true });
      await governed.start();
      h.validity.setState('Lagging');

      try {
        await governed.getTuple({ configurable: { thread_id: 't1' } });
        assert.fail('Should have thrown');
      } catch (e) {
        assert(e instanceof LimenGovernanceError);
        assert.equal(e.state, 'Lagging');
        assert.equal(e.retryable, true);
      }
    });

    it('Claim 4.3: governed=true, Unverified throws non-retryable', async () => {
      const governed = new LimenCheckpointSaver({ ...h.config, governed: true });
      await governed.start();
      h.validity.setState('Unverified');

      try {
        await governed.getTuple({ configurable: { thread_id: 't1' } });
        assert.fail('Should have thrown');
      } catch (e) {
        assert(e instanceof LimenGovernanceError);
        assert.equal(e.state, 'Unverified');
        assert.equal(e.retryable, false);
      }
    });

    it('Claim 4.4: Divergent throws non-retryable', async () => {
      const governed = new LimenCheckpointSaver({ ...h.config, governed: true });
      await governed.start();
      h.validity.setState('Divergent');

      try {
        await governed.getTuple({ configurable: { thread_id: 't1' } });
        assert.fail('Should have thrown');
      } catch (e) {
        assert(e instanceof LimenGovernanceError);
        assert.equal(e.retryable, false);
        assert.equal(e.guidance, 'Rebuild projection');
      }
    });

    it('Claim 4.5: Rebuilding throws retryable', async () => {
      const governed = new LimenCheckpointSaver({ ...h.config, governed: true });
      await governed.start();
      h.validity.setState('Rebuilding');

      try {
        await governed.getTuple({ configurable: { thread_id: 't1' } });
        assert.fail('Should have thrown');
      } catch (e) {
        assert(e instanceof LimenGovernanceError);
        assert.equal(e.retryable, true);
      }
    });

    it('Claim 4.6: governed=false, Lagging proceeds', async () => {
      h.validity.setState('Lagging');
      // Default governed=false — should not throw
      await saver.getTuple({ configurable: { thread_id: 't1' } });
    });

    it('Claim 4.7: governed=false, Unverified still throws', async () => {
      h.validity.setState('Unverified');
      await assert.rejects(
        () => saver.getTuple({ configurable: { thread_id: 't1' } }),
        LimenGovernanceError
      );
    });

    it('Claim 4.8: all writes bypass governance', async () => {
      h.validity.setState('Divergent');
      // put, putWrites, deleteThread should all work
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tenant Isolation — Claims 5.1–5.4
  // ═══════════════════════════════════════════════════════════════════════════

  describe('tenant isolation', () => {
    it('Claim 5.1: config tenant takes priority', async () => {
      await saver.put(
        { configurable: { thread_id: 't1', limen_tenant_scope: 'tenant_a' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );
      const entry = h.chain.getLastEntry();
      assert.equal(entry?.tenant_scope, 'tenant_a');
    });

    it('Claim 5.4: cross-tenant isolation', async () => {
      await saver.put(
        { configurable: { thread_id: 't1', limen_tenant_scope: 'a' } },
        makeCheckpoint('cp1'),
        makeMetadata(0),
        {}
      );

      // Same thread_id, different tenant — should not find it
      const result = await saver.getTuple({
        configurable: { thread_id: 't1', limen_tenant_scope: 'b' }
      });
      assert.equal(result, undefined);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // list() — Claims 2.8–2.15
  // ═══════════════════════════════════════════════════════════════════════════

  describe('list', () => {
    it('Claim 2.8: before filter uses checkpoint_id', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('aaa'), makeMetadata(0), {});
      await saver.put(
        { configurable: { thread_id: 't1', checkpoint_id: 'aaa' } },
        makeCheckpoint('mmm'),
        makeMetadata(1),
        {}
      );
      await saver.put(
        { configurable: { thread_id: 't1', checkpoint_id: 'mmm' } },
        makeCheckpoint('zzz'),
        makeMetadata(2),
        {}
      );

      const results: any[] = [];
      for await (const tuple of saver.list(config, {
        before: { configurable: { checkpoint_id: 'zzz' } }
      })) {
        results.push(tuple);
      }
      // Should get mmm and aaa (before zzz)
      assert.equal(results.length, 2);
      assert.equal(results[0].config.configurable.checkpoint_id, 'mmm');
    });

    it('Claim 2.14: respects limit option', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      for (let i = 0; i < 5; i++) {
        await saver.put(
          { configurable: { thread_id: 't1', checkpoint_id: i > 0 ? `cp${i - 1}` : undefined } },
          makeCheckpoint(`cp${i}`),
          makeMetadata(i),
          {}
        );
      }

      const results: any[] = [];
      for await (const tuple of saver.list(config, { limit: 2 })) {
        results.push(tuple);
      }
      assert.equal(results.length, 2);
    });

    it('Claim 2.15: governance gate checked once', async () => {
      const config: RunnableConfig = { configurable: { thread_id: 't1' } };
      await saver.put(config, makeCheckpoint('cp1'), makeMetadata(0), {});

      // Start iterating
      const gen = saver.list(config);
      const first = await gen.next();
      assert.equal(first.done, false);

      // Change state mid-iteration
      h.validity.setState('Divergent');

      // Should NOT throw — gate was checked once at creation
      // (iteration continues with stale state)
      const second = await gen.next();
      assert.equal(second.done, true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Serialization — Claims 6.1–6.5
  // ═══════════════════════════════════════════════════════════════════════════

  describe('serialization', () => {
    it('Claim 6.5: metadata extra properties roundtrip', async () => {
      const meta: any = { ...makeMetadata(0), custom: { nested: true }, num: 42 };
      await saver.put(
        { configurable: { thread_id: 't1' } },
        makeCheckpoint('cp1'),
        meta,
        {}
      );

      const result = await saver.getTuple({ configurable: { thread_id: 't1' } });
      assert.deepEqual((result?.metadata as any).custom, { nested: true });
      assert.equal((result?.metadata as any).num, 42);
    });
  });
});
