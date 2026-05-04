/**
 * Shared logic tests — filter, namespace, encoding
 * Covers: Claims 2.9–2.13, 3.7, 8.9
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter, compareValues, validateNamespace, dotJoin, splitNamespace, canonicalJson } from '../src/shared.js';
import { LimenStorageError } from '../src/errors.js';

describe('matchesFilter', () => {
  it('Claim 2.9: $eq operator', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $eq: 5 } }), true);
    assert.equal(matchesFilter({ x: 5 }, { x: { $eq: 6 } }), false);
  });

  it('Claim 2.9: $ne operator', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $ne: 6 } }), true);
    assert.equal(matchesFilter({ x: 5 }, { x: { $ne: 5 } }), false);
  });

  it('Claim 2.10: $gt uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '5' }, { x: { $gt: 3 } }), true);
    assert.equal(matchesFilter({ x: '2' }, { x: { $gt: 3 } }), false);
  });

  it('Claim 2.10: $gte uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '5' }, { x: { $gte: 5 } }), true);
    assert.equal(matchesFilter({ x: '4' }, { x: { $gte: 5 } }), false);
  });

  it('Claim 2.10: $lt uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '2' }, { x: { $lt: 3 } }), true);
  });

  it('Claim 2.10: $lte uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '3' }, { x: { $lte: 3 } }), true);
  });

  it('Claim 2.11: $in with non-array returns false', () => {
    assert.equal(compareValues(5, '$in', 'not-array'), false);
  });

  it('Claim 2.11: $nin with non-array returns true', () => {
    assert.equal(compareValues(5, '$nin', 'not-array'), true);
  });

  it('Claim 2.11: $in with array', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $in: [1, 5, 10] } }), true);
    assert.equal(matchesFilter({ x: 7 }, { x: { $in: [1, 5, 10] } }), false);
  });

  it('Claim 2.11: $nin with array', () => {
    assert.equal(matchesFilter({ x: 7 }, { x: { $nin: [1, 5, 10] } }), true);
    assert.equal(matchesFilter({ x: 5 }, { x: { $nin: [1, 5, 10] } }), false);
  });

  it('Claim 2.12: unknown operator returns false', () => {
    assert.equal(compareValues(5, '$regex', '.*'), false);
  });

  it('Claim 2.13: mixed keys fall through to === equality (reference)', () => {
    // { $eq, foo } — not all keys are valid operators, so falls through to ===
    // === on objects is reference equality — different literals never match
    const mixedObj = { $eq: 5, foo: 'bar' };
    const filter = { x: mixedObj };
    // Same reference matches
    assert.equal(matchesFilter({ x: mixedObj }, filter), true);
    // Different object with same shape does NOT match (=== is reference)
    assert.equal(matchesFilter({ x: { $eq: 5, foo: 'bar' } }, filter), false);
    // Primitive does not match
    assert.equal(matchesFilter({ x: 5 }, filter), false);
  });

  it('direct value comparison', () => {
    assert.equal(matchesFilter({ x: 'hello' }, { x: 'hello' }), true);
    assert.equal(matchesFilter({ x: 'hello' }, { x: 'world' }), false);
  });

  it('multiple filter keys — all must match', () => {
    assert.equal(matchesFilter({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
    assert.equal(matchesFilter({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
  });
});

describe('validateNamespace', () => {
  it('Claim 3.7 Rule 1: empty array throws', () => {
    assert.throws(() => validateNamespace([]), LimenStorageError);
  });

  it('Claim 3.7 Rule 2: non-string label throws', () => {
    assert.throws(() => validateNamespace([123 as any]), LimenStorageError);
  });

  it('Claim 3.7 Rule 3: empty string throws', () => {
    assert.throws(() => validateNamespace(['']), LimenStorageError);
  });

  it('Claim 3.7 Rule 4: dot in label throws', () => {
    assert.throws(() => validateNamespace(['user.data']), LimenStorageError);
  });

  it('Claim 3.7 Rule 5: "langgraph" exact throws', () => {
    assert.throws(() => validateNamespace(['langgraph']), LimenStorageError);
  });

  it('Claim 3.7 Rule 5: "langgraph_custom" allowed', () => {
    validateNamespace(['langgraph_custom']); // no throw
  });

  it('valid namespace passes', () => {
    validateNamespace(['users', 'active', 'v2']); // no throw
  });
});

describe('dotJoin / splitNamespace', () => {
  it('round-trips correctly', () => {
    const ns = ['users', 'active', 'v2'];
    assert.deepEqual(splitNamespace(dotJoin(ns)), ns);
  });
});

describe('canonicalJson', () => {
  it('produces valid JSON as Uint8Array', () => {
    const result = canonicalJson({ key: 'value', num: 42 });
    const parsed = JSON.parse(new TextDecoder().decode(result));
    assert.equal(parsed.key, 'value');
    assert.equal(parsed.num, 42);
  });
});
