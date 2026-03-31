/**
 * Phase 3: Decay computation unit tests.
 *
 * Tests the FSRS power-decay formula: R(t) = (1 + t/(9*S))^(-1)
 * All 10 test vectors from the Design Source.
 *
 * DCs covered: DC-P3-101 (formula correctness), DC-P3-102 (negative age clamp),
 *              DC-P3-103 (stability=0 guard)
 * Invariants: I-P3-01, I-P3-02
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeDecayFactor, computeEffectiveConfidence, computeAgeMs } from '../../src/cognitive/decay.js';

const MS_PER_DAY = 86_400_000;

describe('Phase 3: Decay computation', () => {
  describe('computeDecayFactor — 10 test vectors (I-P3-01)', () => {
    const vectors: Array<{ ageDays: number; stabilityDays: number; expected: number; desc: string }> = [
      { ageDays: 0, stabilityDays: 90, expected: 1.0000, desc: 'Brand new claim' },
      { ageDays: 9, stabilityDays: 90, expected: 0.9890, desc: 'Very recent' },
      { ageDays: 30, stabilityDays: 30, expected: 0.9000, desc: 'Warning claim at 1x stability' },
      { ageDays: 30, stabilityDays: 90, expected: 0.9643, desc: 'Finding claim at 1/3 stability' },
      { ageDays: 90, stabilityDays: 90, expected: 0.9000, desc: 'Finding claim at 1x stability' },
      { ageDays: 180, stabilityDays: 180, expected: 0.9000, desc: 'Architectural claim at 1x stability' },
      { ageDays: 365, stabilityDays: 365, expected: 0.9000, desc: 'Governance claim at 1x stability' },
      { ageDays: 270, stabilityDays: 90, expected: 0.7500, desc: 'Finding claim at 3x stability' },
      { ageDays: 810, stabilityDays: 90, expected: 0.5000, desc: 'Finding claim at 9x stability -- half-life' },
      { ageDays: 7, stabilityDays: 7, expected: 0.9000, desc: 'Ephemeral claim at 1x stability' },
    ];

    for (const v of vectors) {
      it(`${v.desc}: age=${v.ageDays}d, stability=${v.stabilityDays}d -> R(t)=${v.expected}`, () => {
        const result = computeDecayFactor(v.ageDays * MS_PER_DAY, v.stabilityDays);
        assert.ok(
          Math.abs(result - v.expected) < 0.001,
          `Expected ${v.expected}, got ${result} (delta: ${Math.abs(result - v.expected)})`,
        );
      });
    }

    it('additional: ephemeral at 9x stability (half-life = 63d)', () => {
      const result = computeDecayFactor(63 * MS_PER_DAY, 7);
      assert.ok(Math.abs(result - 0.5) < 0.001, `Expected 0.5, got ${result}`);
    });
  });

  describe('DC-P3-103: stability=0 guard [A21]', () => {
    it('success: stability > 0 returns valid decay factor', () => {
      const result = computeDecayFactor(30 * MS_PER_DAY, 90);
      assert.ok(result > 0 && result <= 1, `Expected (0, 1], got ${result}`);
    });

    it('rejection: stability=0 returns 0', () => {
      const result = computeDecayFactor(30 * MS_PER_DAY, 0);
      assert.equal(result, 0);
    });

    it('rejection: stability < 0 returns 0', () => {
      const result = computeDecayFactor(30 * MS_PER_DAY, -10);
      assert.equal(result, 0);
    });
  });

  describe('DC-P3-102: negative age clamp (future validAt) [A21]', () => {
    it('success: positive age gives normal decay', () => {
      const result = computeDecayFactor(90 * MS_PER_DAY, 90);
      assert.ok(result < 1.0, `Expected < 1.0, got ${result}`);
    });

    it('rejection: negative age clamped to 0, R(t)=1.0', () => {
      const result = computeDecayFactor(-30 * MS_PER_DAY, 90);
      assert.equal(result, 1.0);
    });
  });

  describe('computeEffectiveConfidence (I-P3-02)', () => {
    const vectors: Array<{ confidence: number; ageDays: number; stability: number; expected: number; desc: string }> = [
      { confidence: 0.7, ageDays: 0, stability: 90, expected: 0.7000, desc: 'New auto-extracted claim' },
      { confidence: 0.7, ageDays: 810, stability: 90, expected: 0.3500, desc: 'Same claim after half-life' },
      { confidence: 0.9, ageDays: 30, stability: 365, expected: 0.8919, desc: 'High-confidence governance, 30d old' },
      { confidence: 0.7, ageDays: 30, stability: 30, expected: 0.6300, desc: 'Warning claim after 30 days' },
      { confidence: 1.0, ageDays: 0, stability: 90, expected: 1.0000, desc: 'Max confidence, brand new' },
      { confidence: 0.5, ageDays: 90, stability: 90, expected: 0.4500, desc: 'Medium confidence finding, 90d' },
    ];

    for (const v of vectors) {
      it(`${v.desc}: conf=${v.confidence}, age=${v.ageDays}d, S=${v.stability}d -> ${v.expected}`, () => {
        const result = computeEffectiveConfidence(v.confidence, v.ageDays * MS_PER_DAY, v.stability);
        assert.ok(
          Math.abs(result - v.expected) < 0.001,
          `Expected ${v.expected}, got ${result}`,
        );
      });
    }

    it('effectiveConfidence never exceeds raw confidence', () => {
      for (let ageDays = 0; ageDays <= 1000; ageDays += 100) {
        const result = computeEffectiveConfidence(0.8, ageDays * MS_PER_DAY, 90);
        assert.ok(result <= 0.8, `At age=${ageDays}d, effectiveConfidence ${result} exceeds raw 0.8`);
      }
    });
  });

  describe('computeAgeMs', () => {
    it('computes age from validAt and nowMs', () => {
      const validAt = '2026-01-01T00:00:00.000Z';
      const nowMs = Date.parse('2026-01-31T00:00:00.000Z');
      const result = computeAgeMs(validAt, nowMs);
      assert.equal(result, 30 * MS_PER_DAY);
    });

    it('clamps future validAt to 0', () => {
      const validAt = '2026-02-01T00:00:00.000Z';
      const nowMs = Date.parse('2026-01-01T00:00:00.000Z');
      const result = computeAgeMs(validAt, nowMs);
      assert.equal(result, 0);
    });
  });
});
