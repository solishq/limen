/**
 * Phase 3: Freshness classification unit tests.
 *
 * DCs covered: DC-P3-107 (freshness classification correctness)
 * Invariant: I-P3-06
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFreshness } from '../../src/cognitive/freshness.js';

const MS_PER_DAY = 86_400_000;
const NOW_MS = Date.parse('2026-03-30T12:00:00.000Z');

describe('Phase 3: Freshness classification', () => {
  describe('DC-P3-107: classification correctness [A21]', () => {
    it('success: 3 days since access -> fresh', () => {
      const lastAccessed = NOW_MS - (3 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'fresh');
    });

    it('success: 0 days since access -> fresh', () => {
      assert.equal(classifyFreshness(NOW_MS, NOW_MS), 'fresh');
    });

    it('success: 6.9 days since access -> fresh (boundary)', () => {
      const lastAccessed = NOW_MS - (6.9 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'fresh');
    });

    it('aging: 7 days since access -> aging (exact boundary)', () => {
      const lastAccessed = NOW_MS - (7 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'aging');
    });

    it('aging: 15 days since access -> aging', () => {
      const lastAccessed = NOW_MS - (15 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'aging');
    });

    it('aging: 29.9 days since access -> aging (boundary)', () => {
      const lastAccessed = NOW_MS - (29.9 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'aging');
    });

    it('stale: 30 days since access -> stale (exact boundary)', () => {
      const lastAccessed = NOW_MS - (30 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'stale');
    });

    it('stale: 45 days since access -> stale', () => {
      const lastAccessed = NOW_MS - (45 * MS_PER_DAY);
      assert.equal(classifyFreshness(lastAccessed, NOW_MS), 'stale');
    });

    it('rejection: null lastAccessedAt -> stale (never accessed)', () => {
      assert.equal(classifyFreshness(null, NOW_MS), 'stale');
    });
  });

  describe('custom thresholds', () => {
    it('custom freshDays=3, agingDays=10', () => {
      const thresholds = { freshDays: 3, agingDays: 10 };
      // 2 days -> fresh
      assert.equal(classifyFreshness(NOW_MS - (2 * MS_PER_DAY), NOW_MS, thresholds), 'fresh');
      // 5 days -> aging
      assert.equal(classifyFreshness(NOW_MS - (5 * MS_PER_DAY), NOW_MS, thresholds), 'aging');
      // 15 days -> stale
      assert.equal(classifyFreshness(NOW_MS - (15 * MS_PER_DAY), NOW_MS, thresholds), 'stale');
    });
  });
});
