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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __TEST_ONLY__, processBeliefs } from '../../src/commands/belief-postprocess.js';
import type { Limen, BeliefView, ClaimRelationship } from 'limen-ai';

const { round4, isA2aPredicate, isRoomPredicate, shouldIncludeRoom, computeTimeFreshness } = __TEST_ONLY__;

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

  it('future-dated claim (within an hour ahead) is classified as fresh', () => {
    // F-BR4-002 + F-BR5-004: the invariant is that future-dated claims
    // do NOT classify as 'stale'. They fall into 'fresh' because
    // ageMs < ONE_HOUR holds trivially for negative ageMs. This is
    // intentional clock-skew tolerance — NTP drift and timezone
    // round-trips can produce slightly future createdAt values for
    // freshly-stored claims. Labelling them stale would mislead users.
    //
    // Previously a dedicated `if (ageMs < 0) return 'fresh'` guard
    // existed; it was dead code (bit-identical output after deletion)
    // and was removed per F-BR5-004. The test kept its invariant
    // (future-dated → fresh) because that is the user-observable
    // behavior the function exists to guarantee.
    const createdAt = new Date(now + HOUR).toISOString();
    expect(computeTimeFreshness(createdAt, now)).toBe('fresh');
  });

  it('10 years in the future is still fresh (clock skew, not freshness)', () => {
    // Extreme case: treating this as stale would be defensible, but so
    // would treating it as fresh. We pick fresh — a 10-year-future
    // ageMs is still < ONE_HOUR (negative numbers are < ONE_HOUR), so
    // the same branch produces the same classification. This matches
    // the documented tolerance policy and is exercised here
    // defensively so a future rewrite of computeTimeFreshness that
    // special-cases large negatives cannot silently flip this result.
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

describe('isRoomPredicate — LIMEN-COORD-v1.0 §9.1 symmetry', () => {
  it('matches room.message', () => {
    expect(isRoomPredicate('room.message')).toBe(true);
  });
  it('matches room.blocker', () => {
    expect(isRoomPredicate('room.blocker')).toBe(true);
  });
  it('matches room.disagreement', () => {
    expect(isRoomPredicate('room.disagreement')).toBe(true);
  });
  it('matches room.resolve', () => {
    expect(isRoomPredicate('room.resolve')).toBe(true);
  });
  it('matches room.participant', () => {
    expect(isRoomPredicate('room.participant')).toBe(true);
  });
  it('matches room.mode', () => {
    expect(isRoomPredicate('room.mode')).toBe(true);
  });
  it('does NOT match unratified room.* extensions (F-LC3-R2-007 v4 closure)', () => {
    // v4 C-22: isRoomPredicate is scoped to the enumerated ratified set,
    // NOT prefix-wide. An unratified `room.<x>` predicate is NOT silently
    // blessed; the protocol must ratify each new predicate explicitly.
    expect(isRoomPredicate('room.modeChange')).toBe(false);
    expect(isRoomPredicate('room.snapshot')).toBe(false);
    expect(isRoomPredicate('room.anything')).toBe(false);
  });
  it('does NOT match knowledge.foo', () => {
    expect(isRoomPredicate('knowledge.foo')).toBe(false);
  });
  it('does NOT match a2a.message', () => {
    expect(isRoomPredicate('a2a.message')).toBe(false);
  });
  it('does NOT match empty string', () => {
    expect(isRoomPredicate('')).toBe(false);
  });
  it('does NOT match plain "room" (no trailing dot)', () => {
    expect(isRoomPredicate('room')).toBe(false);
  });
  it('does NOT match "room_message" (underscore, not dot)', () => {
    expect(isRoomPredicate('room_message')).toBe(false);
  });
});

describe('shouldIncludeRoom — LIMEN-COORD-v1.0 §9.1 inclusion rule', () => {
  it('undefined userPredicate → false (bare recall excludes room.*)', () => {
    expect(shouldIncludeRoom(undefined)).toBe(false);
  });
  it('explicit "room.*" wildcard → true', () => {
    expect(shouldIncludeRoom('room.*')).toBe(true);
  });
  it('explicit room.message → true', () => {
    expect(shouldIncludeRoom('room.message')).toBe(true);
  });
  it('explicit room.blocker → true', () => {
    expect(shouldIncludeRoom('room.blocker')).toBe(true);
  });
  it('unrelated predicate → false', () => {
    expect(shouldIncludeRoom('knowledge.foo')).toBe(false);
  });
  it('a2a.* → false (different predicate family)', () => {
    expect(shouldIncludeRoom('a2a.message')).toBe(false);
  });
});

// ─── F-BR5-003 / F-BR5-005 / F-BR5-006 observability tests ──────────────────

/**
 * Build a minimal BeliefView with the given fields, using sensible
 * defaults for the fields processBeliefs does not care about.
 */
function makeBelief(overrides: Partial<BeliefView>): BeliefView {
  return {
    claimId: overrides.claimId ?? ('claim-x' as BeliefView['claimId']),
    subject: overrides.subject ?? 'entity:test:subj',
    predicate: overrides.predicate ?? 'test.pred',
    value: overrides.value ?? 'v',
    confidence: overrides.confidence ?? 0.9,
    validAt: overrides.validAt ?? '2026-04-11T00:00:00Z',
    createdAt: overrides.createdAt ?? '2026-04-11T00:00:00Z',
    superseded: overrides.superseded ?? false,
    disputed: overrides.disputed ?? true,
    effectiveConfidence: overrides.effectiveConfidence ?? 0.9,
    freshness: overrides.freshness ?? 'stale',
    stability: overrides.stability ?? 7,
    lastAccessedAt: overrides.lastAccessedAt ?? null,
    accessCount: overrides.accessCount ?? 0,
    reasoning: overrides.reasoning ?? null,
  } as BeliefView;
}

/** Build a contradicts edge from one claim id to another. */
function edge(fromClaimId: string, toClaimId: string): ClaimRelationship {
  return {
    id: `${fromClaimId}->${toClaimId}` as ClaimRelationship['id'],
    tenantId: null,
    fromClaimId: fromClaimId as ClaimRelationship['fromClaimId'],
    toClaimId: toClaimId as ClaimRelationship['toClaimId'],
    type: 'contradicts',
    declaredByAgentId: 'agent-test' as ClaimRelationship['declaredByAgentId'],
    missionId: 'm-test' as ClaimRelationship['missionId'],
    createdAt: '2026-04-11T00:00:00Z',
  };
}

/**
 * Build a Limen stub that returns the given response for queryClaims
 * and dispatches getClaimStatus to the given function.
 */
function stubLimen(opts: {
  queryClaimsResponse: (input: {
    subject: string;
    predicate: string;
  }) => { ok: boolean; value?: unknown; error?: { code: string; message: string; spec: string } };
  getClaimStatus: (id: string) => { ok: boolean; value?: 'active' | 'retracted' | 'not_found'; error?: { code: string; message: string; spec: string } };
}): Limen {
  return {
    claims: {
      queryClaims(input: { subject: string; predicate: string }) {
        return opts.queryClaimsResponse(input);
      },
      getClaimStatus(id: string) {
        return opts.getClaimStatus(id);
      },
    },
  } as unknown as Limen;
}

describe('F-BR5-003 processBeliefs — relationship query truncation observability', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stderrLines: string[];

  beforeEach(() => {
    stderrLines = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('emits CLI_RELATIONSHIP_LIMIT_REACHED and marks disputedUncertain when the (s,p) query returns at the limit', () => {
    // Build 200 fake claims — enough to hit the RELATIONSHIP_QUERY_LIMIT.
    const fakeClaims = Array.from({ length: 200 }, (_, i) => ({
      claim: { id: `claim-${i}` },
      relationships: [] as ClaimRelationship[],
    }));
    const belief = makeBelief({
      claimId: 'claim-0' as BeliefView['claimId'],
      disputed: true,
    });
    const limen = stubLimen({
      queryClaimsResponse: () => ({ ok: true, value: { claims: fakeClaims } }),
      getClaimStatus: () => ({ ok: true, value: 'not_found' }),
    });

    const result = processBeliefs(limen, [belief], undefined, Date.parse('2026-04-11T00:00:00Z'));

    // DISCRIMINATIVE: a stderr warning with the CLI_RELATIONSHIP_LIMIT_REACHED
    // code must have been emitted. If the limit constant is inlined or
    // the detection is removed, this test fails.
    const joined = stderrLines.join('');
    expect(joined).toContain('CLI_RELATIONSHIP_LIMIT_REACHED');
    expect(joined).toContain('"limit":200');
    // The processed belief must carry disputedUncertain=true so consumers
    // know the recomputation may be incomplete.
    expect(result).toHaveLength(1);
    expect(result[0].disputedUncertain).toBe(true);
    // Disputed flag must be preserved from the engine (not silently
    // cleared). The belief's engine flag was true; there are 0 contradicts
    // edges, but the truncation forces us to preserve engine state.
    expect(result[0].disputed).toBe(true);
  });

  it('does NOT mark disputedUncertain when the (s,p) query returns fewer than the limit', () => {
    // Control: a small result set must NOT trigger the warning.
    const fakeClaims = [
      { claim: { id: 'claim-0' }, relationships: [] as ClaimRelationship[] },
    ];
    const belief = makeBelief({ claimId: 'claim-0' as BeliefView['claimId'], disputed: true });
    const limen = stubLimen({
      queryClaimsResponse: () => ({ ok: true, value: { claims: fakeClaims } }),
      getClaimStatus: () => ({ ok: true, value: 'not_found' }),
    });

    const result = processBeliefs(limen, [belief], undefined, Date.parse('2026-04-11T00:00:00Z'));

    const joined = stderrLines.join('');
    expect(joined).not.toContain('CLI_RELATIONSHIP_LIMIT_REACHED');
    // With no contradicts edges and no truncation, the recomputation
    // concludes dispute is stale. disputedUncertain must be false/absent.
    expect(result[0].disputedUncertain).toBeFalsy();
    expect(result[0].disputed).toBe(false);
  });
});

describe('F-BR5-005 processBeliefs — counterpart lookup failure is surfaced, not swallowed', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stderrLines: string[];

  beforeEach(() => {
    stderrLines = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('[REJECTION-path] when getClaimStatus errors for the sole counterpart, emits warning AND preserves disputed=true', () => {
    // Setup: one disputed belief with one contradicts edge pointing
    // at counterpart-1. getClaimStatus for counterpart-1 returns an
    // error (e.g. transient DB failure).
    //
    // DISCRIMINATIVE: the prior implementation silently coerced the
    // error to 'not_found', which caused recomputeDisputed to return
    // false (dispute cleared). The correct behaviour is to emit a
    // stderr warning AND preserve the engine's disputed flag.
    const belief = makeBelief({
      claimId: 'claim-0' as BeliefView['claimId'],
      disputed: true,
    });
    const relationship = edge('claim-0', 'counterpart-1');
    const limen = stubLimen({
      queryClaimsResponse: () => ({
        ok: true,
        value: { claims: [{ claim: { id: 'claim-0' }, relationships: [relationship] }] },
      }),
      getClaimStatus: (id: string) => {
        if (id === 'counterpart-1') {
          return { ok: false, error: { code: 'DATABASE_ERROR', message: 'simulated', spec: '§14.1' } };
        }
        return { ok: true, value: 'not_found' };
      },
    });

    const result = processBeliefs(limen, [belief], undefined, Date.parse('2026-04-11T00:00:00Z'));

    const joined = stderrLines.join('');
    expect(joined).toContain('CLI_STATUS_LOOKUP_FAILED');
    expect(joined).toContain('counterpart-1');
    expect(joined).toContain('DATABASE_ERROR');
    // DISCRIMINATIVE (fail-closed): disputed MUST NOT have been cleared.
    // If the error were silently coerced to 'not_found' (prior
    // behaviour), disputed would have become false.
    expect(result).toHaveLength(1);
    expect(result[0].disputed).toBe(true);
    expect(result[0].disputedUncertain).toBe(true);
  });

  it('[SUCCESS] when getClaimStatus succeeds for all counterparts and reports not_found, dispute is cleared with no warning', () => {
    // Control: the fail-closed path does not interfere with the
    // happy path. All counterparts resolve cleanly, the dispute
    // projection determines the engine flag is stale, and disputed
    // goes from true to false — no uncertainty signal, no warnings.
    const belief = makeBelief({
      claimId: 'claim-0' as BeliefView['claimId'],
      disputed: true,
    });
    const relationship = edge('claim-0', 'counterpart-1');
    const limen = stubLimen({
      queryClaimsResponse: () => ({
        ok: true,
        value: { claims: [{ claim: { id: 'claim-0' }, relationships: [relationship] }] },
      }),
      getClaimStatus: () => ({ ok: true, value: 'not_found' }),
    });

    const result = processBeliefs(limen, [belief], undefined, Date.parse('2026-04-11T00:00:00Z'));

    expect(stderrLines.join('')).toBe('');
    expect(result[0].disputed).toBe(false);
    expect(result[0].disputedUncertain).toBeFalsy();
  });

  it('[REJECTION-path] when queryClaims itself errors, group is marked uncertain and warning emitted', () => {
    // F-BR5-005 + F-BR5-003: the (s,p) fetch itself fails (network,
    // permission, DB error). Previously this was a `continue` that
    // silently dropped the group. Now: warning + group-wide
    // disputedUncertain + engine flag preserved.
    const belief = makeBelief({
      claimId: 'claim-0' as BeliefView['claimId'],
      disputed: true,
    });
    const limen = stubLimen({
      queryClaimsResponse: () => ({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'rate limit', spec: '§X' },
      }),
      getClaimStatus: () => ({ ok: true, value: 'not_found' }),
    });

    const result = processBeliefs(limen, [belief], undefined, Date.parse('2026-04-11T00:00:00Z'));

    const joined = stderrLines.join('');
    expect(joined).toContain('CLI_RELATIONSHIP_FETCH_FAILED');
    expect(joined).toContain('RATE_LIMITED');
    expect(result[0].disputed).toBe(true); // preserved
    expect(result[0].disputedUncertain).toBe(true);
  });
});

