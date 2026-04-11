/**
 * Unit tests for CLI belief-postprocess helpers.
 *
 * F-BR4-002 (clock-skew freshness), F-BR4-003 (round4 clamp), F-BR4-007
 * (isA2aPredicate symmetry) are pure-function invariants that cannot be
 * exercised through the CLI binary alone. This file tests them directly
 * via the __TEST_ONLY__ export.
 *
 * These tests stand alongside the integration tests in knowledge.test.ts
 * — neither supersedes the other. Unit tests document the boundary
 * behavior of single functions; integration tests prove end-to-end
 * wiring.
 */

import { describe, it, expect } from 'vitest';
import { __TEST_ONLY__ } from '../../src/commands/belief-postprocess.js';

const { round4, isA2aPredicate, computeTimeFreshness } = __TEST_ONLY__;

describe('round4 — F-BR4-003 clamping and rounding', () => {
  it('rounds a normal value to 4 decimals', () => {
    expect(round4(0.12345)).toBe(0.1235);
    expect(round4(0.12344)).toBe(0.1234);
  });

  it('0.99995 rounds to 1.0 and is clamped to 1 (legitimate max)', () => {
    // IEEE 754: 0.99995 * 10000 = 9999.5 exactly, Math.round → 10000.
    // 1.0 is a legitimate effectiveConfidence value (grounded claims),
    // so the clamp is to [0, 1], not [0, 0.9999].
    expect(round4(0.99995)).toBe(1);
  });

  it('0.99994 rounds down to 0.9999', () => {
    expect(round4(0.99994)).toBe(0.9999);
  });

  it('1.0 stays 1', () => {
    expect(round4(1)).toBe(1);
  });

  it('0.0 stays 0', () => {
    expect(round4(0)).toBe(0);
  });

  it('negative input is clamped to 0', () => {
    // -0.0001 should not propagate below 0.
    expect(round4(-0.0001)).toBe(0);
  });

  it('over-1 input is clamped to 1', () => {
    expect(round4(1.0001)).toBe(1);
  });

  it('NaN collapses to 0 (no JSON.stringify(NaN)=null propagation)', () => {
    expect(round4(NaN)).toBe(0);
  });

  it('+Infinity collapses to 1', () => {
    expect(round4(Infinity)).toBe(1);
  });

  it('-Infinity collapses to 0', () => {
    expect(round4(-Infinity)).toBe(0);
  });
});

describe('computeTimeFreshness — F-BR4-002 clock-skew tolerance', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const now = Date.parse('2026-04-11T12:00:00Z');

  it('fresh within the hour', () => {
    const createdAt = new Date(now - 10 * 60 * 1000).toISOString();
    expect(computeTimeFreshness(createdAt, now)).toBe('fresh');
  });

  it('aging at just over an hour', () => {
    const createdAt = new Date(now - HOUR - 1).toISOString();
    expect(computeTimeFreshness(createdAt, now)).toBe('aging');
  });

  it('stale at exactly 24h', () => {
    const createdAt = new Date(now - DAY).toISOString();
    expect(computeTimeFreshness(createdAt, now)).toBe('stale');
  });

  it('future-dated claim is classified as fresh (clock-skew tolerance)', () => {
    // F-BR4-002: the prior implementation treated future-dated claims
    // the same as ordinary sub-hour claims. We now make the tolerance
    // an explicit choice: ageMs < 0 → 'fresh'. NTP drift and timezone
    // round-trips can produce slightly future createdAt values for
    // freshly-stored claims; labelling them stale would mislead users.
    const createdAt = new Date(now + HOUR).toISOString();
    expect(computeTimeFreshness(createdAt, now)).toBe('fresh');
  });

  it('10 years in the future is still fresh (clock skew, not freshness)', () => {
    // Extreme case: treating this as stale would be defensible, but so
    // would treating it as fresh. We pick fresh and document the choice
    // inline so a hostile reviewer cannot claim this is an accident.
    const createdAt = new Date(now + 10 * 365 * DAY).toISOString();
    expect(computeTimeFreshness(createdAt, now)).toBe('fresh');
  });

  it('invalid date string is stale', () => {
    expect(computeTimeFreshness('not-a-date', now)).toBe('stale');
  });

  it('empty string is stale', () => {
    expect(computeTimeFreshness('', now)).toBe('stale');
  });
});

describe('isA2aPredicate — F-BR4-007 symmetry', () => {
  it('matches a2a.message', () => {
    expect(isA2aPredicate('a2a.message')).toBe(true);
  });
  it('matches future a2a.event', () => {
    expect(isA2aPredicate('a2a.event')).toBe(true);
  });
  it('matches future a2a.ack', () => {
    expect(isA2aPredicate('a2a.ack')).toBe(true);
  });
  it('does NOT match a2b.message (boundary test — prefix must be exactly a2a.)', () => {
    expect(isA2aPredicate('a2b.message')).toBe(false);
  });
  it('does NOT match knowledge.foo', () => {
    expect(isA2aPredicate('knowledge.foo')).toBe(false);
  });
  it('does NOT match empty string', () => {
    expect(isA2aPredicate('')).toBe(false);
  });
  it('does NOT match plain "a2a" (no trailing dot)', () => {
    // F-BR4-007: startsWith('a2a.') requires the dot. "a2a" alone
    // could be a legitimate knowledge predicate used outside the
    // messaging domain.
    expect(isA2aPredicate('a2a')).toBe(false);
  });
});
