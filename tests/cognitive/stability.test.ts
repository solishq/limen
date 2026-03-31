/**
 * Phase 3: Stability resolution unit tests.
 *
 * DCs covered: DC-P3-105 (stability assignment), DC-P3-402 (invalid stability config)
 * Invariant: I-P3-03
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveStability, DEFAULT_STABILITY_PATTERNS, DEFAULT_STABILITY_DAYS } from '../../src/cognitive/stability.js';

describe('Phase 3: Stability resolution', () => {
  describe('built-in patterns (I-P3-03)', () => {
    const cases: Array<{ predicate: string; expected: number; desc: string }> = [
      { predicate: 'governance.policy', expected: 365, desc: 'governance -> 365d' },
      { predicate: 'system.version', expected: 365, desc: 'system -> 365d' },
      { predicate: 'lifecycle.status', expected: 365, desc: 'lifecycle -> 365d' },
      { predicate: 'architecture.pattern', expected: 180, desc: 'architecture -> 180d' },
      { predicate: 'decision.approved', expected: 180, desc: 'decision -> 180d' },
      { predicate: 'design.component', expected: 180, desc: 'design -> 180d' },
      { predicate: 'preference.food', expected: 120, desc: 'preference -> 120d' },
      { predicate: 'reflection.pattern', expected: 120, desc: 'reflection.pattern -> 120d' },
      { predicate: 'reflection.decision', expected: 120, desc: 'reflection.decision -> 120d' },
      { predicate: 'finding.analysis', expected: 90, desc: 'finding -> 90d' },
      { predicate: 'observation.daily', expected: 90, desc: 'observation -> 90d' },
      { predicate: 'reflection.finding', expected: 90, desc: 'reflection.finding -> 90d' },
      { predicate: 'warning.security', expected: 30, desc: 'warning -> 30d' },
      { predicate: 'reflection.warning', expected: 30, desc: 'reflection.warning -> 30d' },
      { predicate: 'ephemeral.scratch', expected: 7, desc: 'ephemeral -> 7d' },
      { predicate: 'session.state', expected: 7, desc: 'session -> 7d' },
      { predicate: 'scratch.temp', expected: 7, desc: 'scratch -> 7d' },
    ];

    for (const c of cases) {
      it(c.desc, () => {
        assert.equal(resolveStability(c.predicate), c.expected);
      });
    }
  });

  describe('default for unmatched predicates', () => {
    it('unmatched predicate gets default 90 days', () => {
      assert.equal(resolveStability('custom.domain'), DEFAULT_STABILITY_DAYS);
    });

    it('custom default overrides', () => {
      assert.equal(resolveStability('custom.domain', { defaultStabilityDays: 45 }), 45);
    });
  });

  describe('custom patterns prepend defaults', () => {
    it('custom pattern overrides built-in for same predicate prefix', () => {
      const config = {
        patterns: [{ pattern: 'governance.*', stabilityDays: 500 }],
      };
      // Custom pattern wins
      assert.equal(resolveStability('governance.policy', config), 500);
      // Other built-in patterns still work
      assert.equal(resolveStability('warning.security', config), 30);
    });

    it('custom pattern for novel prefix', () => {
      const config = {
        patterns: [{ pattern: 'ml.*', stabilityDays: 14 }],
      };
      assert.equal(resolveStability('ml.accuracy', config), 14);
    });
  });

  describe('DC-P3-402: invalid stability config [A21]', () => {
    it('success: valid stabilityDays accepted', () => {
      const config = {
        patterns: [{ pattern: 'test.*', stabilityDays: 50 }],
      };
      assert.equal(resolveStability('test.value', config), 50);
    });

    it('rejection: stabilityDays <= 0 skipped, falls through to next match', () => {
      const config = {
        patterns: [
          { pattern: 'test.*', stabilityDays: 0 },
          { pattern: 'test.*', stabilityDays: 42 },
        ],
      };
      // First pattern skipped (invalid), second matches
      assert.equal(resolveStability('test.value', config), 42);
    });

    it('rejection: negative stabilityDays skipped', () => {
      const config = {
        patterns: [{ pattern: 'test.*', stabilityDays: -10 }],
      };
      // Falls through to default
      assert.equal(resolveStability('test.value', config), DEFAULT_STABILITY_DAYS);
    });
  });

  describe('exact match patterns', () => {
    it('exact match pattern works', () => {
      assert.equal(resolveStability('reflection.pattern'), 120);
    });

    it('exact match does not match prefix', () => {
      // 'reflection.pattern.extra' should NOT match 'reflection.pattern'
      // It should fall through to 'reflection.*' or default
      const result = resolveStability('reflection.pattern.extra');
      // No built-in pattern matches this (reflection.* is not a built-in)
      assert.equal(result, DEFAULT_STABILITY_DAYS);
    });
  });

  describe('DEFAULT_STABILITY_PATTERNS is read-only', () => {
    it('has expected number of patterns', () => {
      assert.ok(DEFAULT_STABILITY_PATTERNS.length >= 17, `Expected >= 17 patterns, got ${DEFAULT_STABILITY_PATTERNS.length}`);
    });

    it('all patterns have positive stabilityDays', () => {
      for (const p of DEFAULT_STABILITY_PATTERNS) {
        assert.ok(p.stabilityDays > 0, `Pattern ${p.pattern} has non-positive stability: ${p.stabilityDays}`);
      }
    });
  });
});
