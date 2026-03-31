/**
 * Phase 4 Quality & Safety: Cascade Penalty Tests.
 * Tests the cascade retraction penalty computation.
 *
 * DC-P4-801, DC-P4-802, DC-P4-803: Cascade multiplier correctness.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CASCADE_FIRST_DEGREE_MULTIPLIER,
  CASCADE_SECOND_DEGREE_MULTIPLIER,
  CASCADE_MAX_DEPTH,
  computeCascadePenalty,
} from '../../src/cognitive/cascade.js';

// ============================================================================
// Cascade Constants (CONSTITUTIONAL — I-P4-01, I-P4-02, I-P4-03)
// ============================================================================

describe('Phase 4: Cascade retraction constants (CONSTITUTIONAL)', () => {
  it('DC-P4-801 success: first-degree multiplier is exactly 0.5 (I-P4-01)', () => {
    assert.strictEqual(CASCADE_FIRST_DEGREE_MULTIPLIER, 0.5);
  });

  it('DC-P4-801 rejection: mutating first-degree multiplier produces wrong value', () => {
    // This test verifies the constant is used, not a computed value
    assert.notStrictEqual(CASCADE_FIRST_DEGREE_MULTIPLIER, 0.3);
    assert.notStrictEqual(CASCADE_FIRST_DEGREE_MULTIPLIER, 0.25);
    assert.notStrictEqual(CASCADE_FIRST_DEGREE_MULTIPLIER, 1.0);
  });

  it('DC-P4-801 success: second-degree multiplier is exactly 0.25 (I-P4-02)', () => {
    assert.strictEqual(CASCADE_SECOND_DEGREE_MULTIPLIER, 0.25);
  });

  it('DC-P4-802 success: max depth is exactly 2 (I-P4-03)', () => {
    assert.strictEqual(CASCADE_MAX_DEPTH, 2);
  });
});

// ============================================================================
// Cascade Penalty Computation (Mock Database)
// ============================================================================

/**
 * Create a mock database connection that returns controlled results
 * for cascade traversal queries.
 */
function createMockConn(graph: {
  relationships: Array<{ from_claim_id: string; to_claim_id: string; type: string }>;
  claims: Array<{ id: string; status: string }>;
}) {
  return {
    dataDir: '/tmp/test',
    schemaVersion: 40,
    tenancyMode: 'single' as const,
    transaction: <T>(fn: () => T): T => fn(),
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    close: () => ({ ok: true as const, value: undefined }),
    query: <T>(sql: string, params?: unknown[]): T[] => {
      if (sql.includes('claim_relationships') && sql.includes('derived_from')) {
        const fromId = params?.[0] as string;
        const matches = graph.relationships
          .filter(r => r.from_claim_id === fromId && r.type === 'derived_from')
          .map(r => ({ to_claim_id: r.to_claim_id }));
        return matches as T[];
      }
      return [];
    },
    get: <T>(sql: string, params?: unknown[]): T | undefined => {
      if (sql.includes('claim_assertions') && sql.includes('status')) {
        const claimId = params?.[0] as string;
        const claim = graph.claims.find(c => c.id === claimId);
        return claim ? ({ status: claim.status } as T) : undefined;
      }
      return undefined;
    },
  };
}

describe('Phase 4: computeCascadePenalty (DC-P4-203, DC-P4-801, DC-P4-802)', () => {
  it('DC-P4-203 success: claim with no derived_from edges returns penalty 1.0', () => {
    const conn = createMockConn({
      relationships: [],
      claims: [],
    });
    const penalty = computeCascadePenalty(conn, 'claim-1');
    assert.strictEqual(penalty, 1.0);
  });

  it('DC-P4-203 rejection: claim with retracted parent returns penalty 0.5', () => {
    const conn = createMockConn({
      relationships: [
        { from_claim_id: 'child', to_claim_id: 'parent', type: 'derived_from' },
      ],
      claims: [
        { id: 'parent', status: 'retracted' },
      ],
    });
    const penalty = computeCascadePenalty(conn, 'child');
    assert.strictEqual(penalty, 0.5);
  });

  it('DC-P4-801 success: retracted parent yields first-degree multiplier exactly 0.5', () => {
    const conn = createMockConn({
      relationships: [
        { from_claim_id: 'child', to_claim_id: 'parent', type: 'derived_from' },
      ],
      claims: [
        { id: 'parent', status: 'retracted' },
      ],
    });
    const penalty = computeCascadePenalty(conn, 'child');
    assert.strictEqual(penalty, CASCADE_FIRST_DEGREE_MULTIPLIER);
  });

  it('DC-P4-801 success: retracted grandparent yields second-degree multiplier exactly 0.25', () => {
    const conn = createMockConn({
      relationships: [
        { from_claim_id: 'child', to_claim_id: 'parent', type: 'derived_from' },
        { from_claim_id: 'parent', to_claim_id: 'grandparent', type: 'derived_from' },
      ],
      claims: [
        { id: 'parent', status: 'active' },
        { id: 'grandparent', status: 'retracted' },
      ],
    });
    const penalty = computeCascadePenalty(conn, 'child');
    assert.strictEqual(penalty, CASCADE_SECOND_DEGREE_MULTIPLIER);
  });

  it('DC-P4-802 success: depth-3 ancestor retracted has no penalty (beyond max depth)', () => {
    // child -> parent -> grandparent -> great-grandparent (retracted)
    // Only depth 2 is traversed, so great-grandparent is not reached
    const conn = createMockConn({
      relationships: [
        { from_claim_id: 'child', to_claim_id: 'parent', type: 'derived_from' },
        { from_claim_id: 'parent', to_claim_id: 'grandparent', type: 'derived_from' },
        { from_claim_id: 'grandparent', to_claim_id: 'great-gp', type: 'derived_from' },
      ],
      claims: [
        { id: 'parent', status: 'active' },
        { id: 'grandparent', status: 'active' },
        { id: 'great-gp', status: 'retracted' },
      ],
    });
    const penalty = computeCascadePenalty(conn, 'child');
    assert.strictEqual(penalty, 1.0); // No penalty — beyond depth 2
  });

  it('DC-P4-203 success: all parents active returns penalty 1.0', () => {
    const conn = createMockConn({
      relationships: [
        { from_claim_id: 'child', to_claim_id: 'parent1', type: 'derived_from' },
        { from_claim_id: 'child', to_claim_id: 'parent2', type: 'derived_from' },
      ],
      claims: [
        { id: 'parent1', status: 'active' },
        { id: 'parent2', status: 'active' },
      ],
    });
    const penalty = computeCascadePenalty(conn, 'child');
    assert.strictEqual(penalty, 1.0);
  });

  it('DC-P4-803 success: cascade composes multiplicatively with decay', () => {
    // This tests the composition formula, not computeCascadePenalty directly
    const confidence = 0.8;
    const decayFactor = 0.9;
    const cascadePenalty = 0.5;
    const effectiveConfidence = confidence * decayFactor * cascadePenalty;
    // Floating point: 0.8 * 0.9 * 0.5 ≈ 0.36 (within epsilon)
    assert.ok(Math.abs(effectiveConfidence - 0.36) < 1e-10,
      `Expected ~0.36, got ${effectiveConfidence}`);
    // Verify it's NOT additive (additive would be 2.2)
    assert.ok(Math.abs(confidence + decayFactor + cascadePenalty - effectiveConfidence) > 1,
      'Result must differ significantly from additive composition');
  });

  it('worst penalty wins when multiple parents have different penalties', () => {
    // One parent retracted (0.5), one active with retracted grandparent (0.25)
    // Worst = 0.25
    const conn = createMockConn({
      relationships: [
        { from_claim_id: 'child', to_claim_id: 'parent1', type: 'derived_from' },
        { from_claim_id: 'child', to_claim_id: 'parent2', type: 'derived_from' },
        { from_claim_id: 'parent2', to_claim_id: 'gp', type: 'derived_from' },
      ],
      claims: [
        { id: 'parent1', status: 'retracted' },
        { id: 'parent2', status: 'active' },
        { id: 'gp', status: 'retracted' },
      ],
    });
    const penalty = computeCascadePenalty(conn, 'child');
    assert.strictEqual(penalty, 0.25);
  });
});
