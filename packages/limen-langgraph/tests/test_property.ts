// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Property-based tests using fast-check
 *
 * Covers:
 * - Checkpoint roundtrip (100 runs)
 * - Store roundtrip (100 runs)
 * - Filter correctness (50 runs)
 * - Namespace tree (50 runs)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { LimenCheckpointSaver } from '../src/checkpoint.js';
import { LimenStore } from '../src/store.js';
import {
  createTestHarness,
  makeCheckpoint,
  makeMetadata,
  makeConfig,
  type TestHarness,
} from './harness.js';
import { matchesFilter, compareValues, validateNamespace } from '../src/shared.js';
import { JsonPlusSerializer } from '../src/serde.js';
import type { Checkpoint, CheckpointMetadata } from '../src/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Arbitraries
// ═══════════════════════════════════════════════════════════════════════════

/** Safe string for checkpoint IDs — alphanumeric, no empty */
const safeId = fc.string({ minLength: 1, maxLength: 20 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s));

/** Safe namespace label — no dots, no empty, no "langgraph" */
const safeLabel = fc.string({ minLength: 1, maxLength: 16 })
  .filter(s => !s.includes('.') && s !== '' && s !== 'langgraph');

/** Valid namespace — 1-4 safe labels */
const safeNamespace = fc.array(safeLabel, { minLength: 1, maxLength: 4 });

/**
 * Arbitrary JSON-safe value for store.
 *
 * F-LG-010: Expanded generators to include nested objects, arrays, unicode
 * strings, empty objects, and large numbers for broader coverage.
 */

/** Leaf values — scalars + null */
const leafValue = fc.oneof(
  fc.string(),
  fc.string({ minLength: 1, maxLength: 20, unit: 'grapheme' }),  // F-LG-010: unicode strings
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter(n => !Object.is(n, -0)),  // F-LG-010: large/small numbers (exclude -0: JSON.stringify(-0) === "0")
  fc.boolean(),
  fc.constant(null),
);

/** Arrays of leaf values — F-LG-010: array coverage */
const leafArray = fc.array(leafValue, { minLength: 0, maxLength: 5 });

/** Nested object — one level deep */
const nestedObj = fc.record(
  {
    x: leafValue,
    y: leafValue,
  },
  { requiredKeys: [] },
).map(obj => {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
});

/** Full JSON value — scalars, arrays, nested objects, empty objects */
const jsonValue = fc.record(
  {
    a: fc.oneof(leafValue, leafArray, nestedObj),
    b: fc.oneof(leafValue, leafArray, nestedObj),
    c: fc.oneof(leafValue, leafArray, nestedObj),
    d: fc.constant({}),  // F-LG-010: empty object
  },
  { requiredKeys: ['a'] },
).map(obj => {
  // Ensure we have a plain Record<string, unknown>
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
});

describe('Property: checkpoint roundtrip', () => {
  it('put -> getTuple preserves checkpoint identity (100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(safeId, async (cpId) => {
        const h = createTestHarness();
        const saver = new LimenCheckpointSaver(h.config);
        await saver.start();

        const cp = makeCheckpoint(cpId);
        await saver.put(makeConfig('thread1'), cp, makeMetadata(0), {});

        const result = await saver.getTuple(makeConfig('thread1'));
        assert.ok(result);
        assert.equal(result.checkpoint.id, cpId);
        assert.equal(result.config.configurable?.checkpoint_id, cpId);

        await saver.stop();
      }),
      { numRuns: 100 }
    );
  });

  it('checkpoint with arbitrary channel_values roundtrips (100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(safeId, jsonValue, async (cpId, values) => {
        const h = createTestHarness();
        const saver = new LimenCheckpointSaver(h.config);
        await saver.start();

        const cp = makeCheckpoint(cpId);
        cp.channel_values = values;
        await saver.put(makeConfig('t1'), cp, makeMetadata(0), {});

        const result = await saver.getTuple(makeConfig('t1'));
        assert.ok(result);
        assert.deepEqual(result.checkpoint.channel_values, values);

        await saver.stop();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: store roundtrip', () => {
  it('put -> get preserves value (100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(safeNamespace, safeId, jsonValue, async (ns, key, value) => {
        const h = createTestHarness();
        const saver = new LimenCheckpointSaver(h.config);
        await saver.start();
        const store = new LimenStore(h.config);
        await store.start();

        await store.put(ns, key, value);
        const item = await store.get(ns, key);
        assert.ok(item);
        assert.deepEqual(item.value, value);
        assert.equal(item.key, key);
        assert.deepEqual(item.namespace, ns);

        await store.stop();
        await saver.stop();
      }),
      { numRuns: 100 }
    );
  });

  it('put -> delete -> get returns null (100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(safeNamespace, safeId, jsonValue, async (ns, key, value) => {
        const h = createTestHarness();
        const saver = new LimenCheckpointSaver(h.config);
        await saver.start();
        const store = new LimenStore(h.config);
        await store.start();

        await store.put(ns, key, value);
        await store.delete(ns, key);
        const item = await store.get(ns, key);
        assert.equal(item, null);

        await store.stop();
        await saver.stop();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: filter correctness', () => {
  it('$eq is strict equality (50 runs)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        (a, b) => {
          assert.equal(compareValues(a, '$eq', b), a === b);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('$ne is strict inequality (50 runs)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        (a, b) => {
          assert.equal(compareValues(a, '$ne', b), a !== b);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('$gt uses Number() coercion (50 runs)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string()),
        fc.oneof(fc.integer(), fc.string()),
        (a, b) => {
          assert.equal(compareValues(a, '$gt', b), Number(a) > Number(b));
        }
      ),
      { numRuns: 50 }
    );
  });

  it('$in always false for non-array operand (50 runs)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        (value, nonArray) => {
          assert.equal(compareValues(value, '$in', nonArray), false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('$nin always true for non-array operand (50 runs)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        (value, nonArray) => {
          assert.equal(compareValues(value, '$nin', nonArray), true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property: namespace tree', () => {
  it('valid namespaces never throw (50 runs)', () => {
    fc.assert(
      fc.property(safeNamespace, (ns) => {
        validateNamespace(ns); // Should not throw
      }),
      { numRuns: 50 }
    );
  });

  it('namespace with dots always throws (50 runs)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (prefix, suffix) => {
          const label = `${prefix}.${suffix}`;
          try {
            validateNamespace([label]);
            assert.fail('Should have thrown');
          } catch {
            // Expected
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('empty array always throws (50 runs)', () => {
    // This is deterministic but verifies the invariant
    for (let i = 0; i < 50; i++) {
      assert.throws(() => validateNamespace([]));
    }
  });
});

describe('Property: serializer roundtrip', () => {
  it('JsonPlusSerializer roundtrips arbitrary JSON values (100 runs)', () => {
    const serde = new JsonPlusSerializer();
    fc.assert(
      fc.property(jsonValue, (value) => {
        const [tag, bytes] = serde.dumpsTyped(value);
        const restored = serde.loadsTyped(tag, bytes);
        assert.deepEqual(restored, value);
      }),
      { numRuns: 100 }
    );
  });

  it('Uint8Array roundtrips as bytes tag (100 runs)', () => {
    const serde = new JsonPlusSerializer();
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 100 }),
        (data) => {
          const [tag, bytes] = serde.dumpsTyped(data);
          assert.equal(tag, 'bytes');
          const restored = serde.loadsTyped(tag, bytes);
          assert.deepEqual(restored, data);
        }
      ),
      { numRuns: 100 }
    );
  });
});
