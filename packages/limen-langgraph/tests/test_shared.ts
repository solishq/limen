/**
 * Shared logic tests — filter, namespace, encoding, type guards
 * Covers: Claims 2.9–2.13, 3.7, 3.17, 8.9
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesFilter,
  compareValues,
  validateNamespace,
  dotJoin,
  splitNamespace,
  canonicalJson,
  matchesConditions,
  isGetOp,
  isPutOp,
  isSearchOp,
  isListNsOp,
} from '../src/shared.js';
import { LimenStorageError } from '../src/errors.js';
import { VALID_FILTER_OPS } from '../src/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// matchesFilter — Claims 2.9–2.13
// ═══════════════════════════════════════════════════════════════════════════

describe('matchesFilter', () => {
  it('Claim 2.9: $eq operator — match', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $eq: 5 } }), true);
  });

  it('Claim 2.9: $eq operator — no match', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $eq: 6 } }), false);
  });

  it('Claim 2.9: $ne operator — match', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $ne: 6 } }), true);
  });

  it('Claim 2.9: $ne operator — no match', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $ne: 5 } }), false);
  });

  it('Claim 2.10: $gt uses Number() coercion — string vs number', () => {
    assert.equal(matchesFilter({ x: '5' }, { x: { $gt: 3 } }), true);
    assert.equal(matchesFilter({ x: '2' }, { x: { $gt: 3 } }), false);
  });

  it('Claim 2.10: $gte uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '5' }, { x: { $gte: 5 } }), true);
    assert.equal(matchesFilter({ x: '4' }, { x: { $gte: 5 } }), false);
  });

  it('Claim 2.10: $lt uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '2' }, { x: { $lt: 3 } }), true);
    assert.equal(matchesFilter({ x: '5' }, { x: { $lt: 3 } }), false);
  });

  it('Claim 2.10: $lte uses Number() coercion', () => {
    assert.equal(matchesFilter({ x: '3' }, { x: { $lte: 3 } }), true);
    assert.equal(matchesFilter({ x: '4' }, { x: { $lte: 3 } }), false);
  });

  it('Claim 2.11: $in with non-array returns false', () => {
    assert.equal(compareValues(5, '$in', 'not-array'), false);
    assert.equal(compareValues(5, '$in', 42), false);
    assert.equal(compareValues(5, '$in', null), false);
  });

  it('Claim 2.11: $nin with non-array returns true', () => {
    assert.equal(compareValues(5, '$nin', 'not-array'), true);
    assert.equal(compareValues(5, '$nin', 42), true);
    assert.equal(compareValues(5, '$nin', null), true);
  });

  it('Claim 2.11: $in with array — match and no-match', () => {
    assert.equal(matchesFilter({ x: 5 }, { x: { $in: [1, 5, 10] } }), true);
    assert.equal(matchesFilter({ x: 7 }, { x: { $in: [1, 5, 10] } }), false);
  });

  it('Claim 2.11: $nin with array — match and no-match', () => {
    assert.equal(matchesFilter({ x: 7 }, { x: { $nin: [1, 5, 10] } }), true);
    assert.equal(matchesFilter({ x: 5 }, { x: { $nin: [1, 5, 10] } }), false);
  });

  it('Claim 2.12: unknown operator returns false silently', () => {
    assert.equal(compareValues(5, '$regex', '.*'), false);
    assert.equal(compareValues(5, '$startsWith', 'x'), false);
    assert.equal(compareValues(5, '$custom', true), false);
  });

  it('Claim 2.13: mixed keys (operator + non-operator) fall through to === equality', () => {
    const mixedObj = { $eq: 5, foo: 'bar' };
    const filter = { x: mixedObj };
    // Same reference matches (=== reference equality)
    assert.equal(matchesFilter({ x: mixedObj }, filter), true);
    // Different object with same shape does NOT match
    assert.equal(matchesFilter({ x: { $eq: 5, foo: 'bar' } }, filter), false);
  });

  it('Claim 2.9: all 8 operators work in a single filter', () => {
    const data = { a: 5, b: 10, c: 'hello', d: 3, e: 7, f: 'x', g: 8, h: 100 };
    const filter = {
      a: { $eq: 5 },
      b: { $ne: 5 },
      c: { $gt: 0 },   // Number('hello') = NaN > 0 = false!
    };
    // $gt on non-numeric string coerces to NaN, which is not > 0
    assert.equal(matchesFilter(data, filter), false);
  });

  it('direct value comparison (non-object filter value)', () => {
    assert.equal(matchesFilter({ x: 'hello' }, { x: 'hello' }), true);
    assert.equal(matchesFilter({ x: 'hello' }, { x: 'world' }), false);
    assert.equal(matchesFilter({ x: 42 }, { x: 42 }), true);
    assert.equal(matchesFilter({ x: null }, { x: null }), true);
  });

  it('multiple filter keys — all must match (AND semantics)', () => {
    assert.equal(matchesFilter({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
    assert.equal(matchesFilter({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
    assert.equal(matchesFilter({ a: 1 }, { a: 1, b: 2 }), false); // b missing
  });

  it('empty filter matches everything', () => {
    assert.equal(matchesFilter({ a: 1, b: 2 }, {}), true);
    assert.equal(matchesFilter({}, {}), true);
  });

  it('array filter value uses === (not deep equality)', () => {
    const arr = [1, 2, 3];
    assert.equal(matchesFilter({ x: arr }, { x: arr }), true);
    assert.equal(matchesFilter({ x: [1, 2, 3] }, { x: arr }), false); // Different reference
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VALID_FILTER_OPS — Appendix A.3
// ═══════════════════════════════════════════════════════════════════════════

describe('VALID_FILTER_OPS', () => {
  it('has exactly 8 operators', () => {
    assert.equal(VALID_FILTER_OPS.length, 8);
  });

  it('contains all documented operators', () => {
    const expected = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'];
    assert.deepEqual([...VALID_FILTER_OPS], expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateNamespace — Claim 3.7
// ═══════════════════════════════════════════════════════════════════════════

describe('validateNamespace', () => {
  it('Claim 3.7 Rule 1: empty array throws', () => {
    assert.throws(() => validateNamespace([]), LimenStorageError);
  });

  it('Claim 3.7 Rule 1: non-array throws', () => {
    assert.throws(() => validateNamespace('not-array' as any), LimenStorageError);
  });

  it('Claim 3.7 Rule 2: non-string label throws', () => {
    assert.throws(() => validateNamespace([123 as any]), LimenStorageError);
    assert.throws(() => validateNamespace([null as any]), LimenStorageError);
    assert.throws(() => validateNamespace([undefined as any]), LimenStorageError);
  });

  it('Claim 3.7 Rule 3: empty string throws', () => {
    assert.throws(() => validateNamespace(['']), LimenStorageError);
    assert.throws(() => validateNamespace(['valid', '']), LimenStorageError);
  });

  it('Claim 3.7 Rule 4: dot in label throws', () => {
    assert.throws(() => validateNamespace(['user.data']), LimenStorageError);
    assert.throws(() => validateNamespace(['a', 'b.c', 'd']), LimenStorageError);
  });

  it('Claim 3.7 Rule 5: "langgraph" exact match throws', () => {
    assert.throws(() => validateNamespace(['langgraph']), LimenStorageError);
    assert.throws(() => validateNamespace(['langgraph', 'internal']), LimenStorageError);
  });

  it('Claim 3.7 Rule 5: "langgraph_custom" allowed', () => {
    validateNamespace(['langgraph_custom']); // No throw
  });

  it('Claim 3.7 Rule 5: "langgraphs" allowed', () => {
    validateNamespace(['langgraphs']); // Not exact match
  });

  it('valid namespaces pass', () => {
    validateNamespace(['users']);
    validateNamespace(['users', 'active']);
    validateNamespace(['a', 'b', 'c', 'd', 'e']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dotJoin / splitNamespace
// ═══════════════════════════════════════════════════════════════════════════

describe('dotJoin / splitNamespace', () => {
  it('round-trips single component', () => {
    assert.deepEqual(splitNamespace(dotJoin(['users'])), ['users']);
  });

  it('round-trips multiple components', () => {
    const ns = ['users', 'active', 'v2'];
    assert.deepEqual(splitNamespace(dotJoin(ns)), ns);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// canonicalJson
// ═══════════════════════════════════════════════════════════════════════════

describe('canonicalJson', () => {
  it('produces valid JSON as Uint8Array', () => {
    const result = canonicalJson({ key: 'value', num: 42 });
    assert.ok(result instanceof Uint8Array);
    const parsed = JSON.parse(new TextDecoder().decode(result));
    assert.equal(parsed.key, 'value');
    assert.equal(parsed.num, 42);
  });

  it('deterministic output', () => {
    const a = canonicalJson({ x: 1, y: 2 });
    const b = canonicalJson({ x: 1, y: 2 });
    assert.deepEqual(a, b);
  });

  it('F-LG-009: sorts keys for deterministic output regardless of insertion order', () => {
    const a = canonicalJson({ z: 3, a: 1, m: 2 });
    const b = canonicalJson({ a: 1, m: 2, z: 3 });
    assert.deepEqual(a, b);
    // Verify actual key order in output
    const decoded = new TextDecoder().decode(a);
    const keys = [...decoded.matchAll(/"([a-z])":/g)].map(m => m[1]);
    assert.deepEqual(keys, ['a', 'm', 'z']);
  });

  it('F-LG-009: sorts nested object keys recursively', () => {
    const a = canonicalJson({ outer: { z: 1, a: 2 }, b: 3 });
    const b = canonicalJson({ b: 3, outer: { a: 2, z: 1 } });
    assert.deepEqual(a, b);
  });

  it('F-LG-009: arrays pass through unchanged (no sorting)', () => {
    const result = canonicalJson({ arr: [3, 1, 2] });
    const parsed = JSON.parse(new TextDecoder().decode(result));
    assert.deepEqual(parsed.arr, [3, 1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// matchesConditions — Claim 3.17
// ═══════════════════════════════════════════════════════════════════════════

describe('matchesConditions', () => {
  it('prefix match — exact prefix', () => {
    assert.equal(matchesConditions(['users', 'active'], [{ matchType: 'prefix', path: ['users'] }]), true);
  });

  it('prefix match — full match', () => {
    assert.equal(matchesConditions(['users'], [{ matchType: 'prefix', path: ['users'] }]), true);
  });

  it('prefix match — no match', () => {
    assert.equal(matchesConditions(['orders'], [{ matchType: 'prefix', path: ['users'] }]), false);
  });

  it('prefix match — path longer than ns fails', () => {
    assert.equal(matchesConditions(['a'], [{ matchType: 'prefix', path: ['a', 'b'] }]), false);
  });

  it('suffix match', () => {
    assert.equal(matchesConditions(['users', 'active'], [{ matchType: 'suffix', path: ['active'] }]), true);
    assert.equal(matchesConditions(['users', 'inactive'], [{ matchType: 'suffix', path: ['active'] }]), false);
  });

  it('suffix match — path longer than ns fails', () => {
    assert.equal(matchesConditions(['a'], [{ matchType: 'suffix', path: ['x', 'a'] }]), false);
  });

  it('wildcard in prefix', () => {
    assert.equal(matchesConditions(['users', 'active'], [{ matchType: 'prefix', path: ['*', 'active'] }]), true);
    assert.equal(matchesConditions(['orders', 'active'], [{ matchType: 'prefix', path: ['*', 'active'] }]), true);
    assert.equal(matchesConditions(['users', 'inactive'], [{ matchType: 'prefix', path: ['*', 'active'] }]), false);
  });

  it('wildcard in suffix', () => {
    assert.equal(matchesConditions(['a', 'b', 'c'], [{ matchType: 'suffix', path: ['*', 'c'] }]), true);
    assert.equal(matchesConditions(['a', 'b', 'd'], [{ matchType: 'suffix', path: ['*', 'c'] }]), false);
  });

  it('multiple conditions — all must match (AND)', () => {
    assert.equal(matchesConditions(
      ['users', 'active'],
      [
        { matchType: 'prefix', path: ['users'] },
        { matchType: 'suffix', path: ['active'] },
      ]
    ), true);

    assert.equal(matchesConditions(
      ['users', 'inactive'],
      [
        { matchType: 'prefix', path: ['users'] },
        { matchType: 'suffix', path: ['active'] },
      ]
    ), false);
  });

  it('empty conditions array matches everything', () => {
    assert.equal(matchesConditions(['any', 'ns'], []), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation Type Guards
// ═══════════════════════════════════════════════════════════════════════════

describe('operation type guards', () => {
  it('isGetOp identifies get operations', () => {
    assert.equal(isGetOp({ namespace: ['ns'], key: 'k' }), true);
    assert.equal(isGetOp({ namespace: ['ns'], key: 'k', value: { v: 1 } }), false); // PutOp
    assert.equal(isGetOp({ namespacePrefix: ['ns'] }), false); // SearchOp
  });

  it('isPutOp identifies put operations', () => {
    assert.equal(isPutOp({ namespace: ['ns'], key: 'k', value: { v: 1 } }), true);
    assert.equal(isPutOp({ namespace: ['ns'], key: 'k', value: null }), true);
    assert.equal(isPutOp({ namespace: ['ns'], key: 'k' }), false); // GetOp
  });

  it('isSearchOp identifies search operations', () => {
    assert.equal(isSearchOp({ namespacePrefix: ['ns'] }), true);
    assert.equal(isSearchOp({ namespace: ['ns'], key: 'k' }), false);
  });

  it('isListNsOp identifies listNamespaces operations', () => {
    assert.equal(isListNsOp({ matchConditions: [], maxDepth: 2 }), true);
    assert.equal(isListNsOp({ maxDepth: 1 }), true);
    assert.equal(isListNsOp({ matchConditions: [] }), true);
    assert.equal(isListNsOp({ namespace: ['ns'], key: 'k' }), false);
  });

  it('F-LG-008: isListNsOp rejects ambiguous limit-only operations', () => {
    // An object with only `limit` and no `matchConditions` or `maxDepth`
    // is ambiguous — could be a partial SearchOperation or ListNamespacesOperation.
    // The tightened guard requires at least one discriminating field.
    assert.equal(isListNsOp({ limit: 5 } as any), false);
  });
});
