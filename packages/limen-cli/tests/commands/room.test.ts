/**
 * Unit tests for `packages/limen-cli/src/commands/room.ts`.
 *
 * F-LC3-001 / F-LC3-002 / F-LC3-003 closure: these tests cover the
 * per-kind value validators and the source_id best-effort idempotency
 * helper that the `room record` command depends on. Scope is the pure
 * helpers exported via `__TEST_ONLY__`; interactive `room join` loop
 * and the Commander action wiring are exercised by the e2e test suite.
 *
 * Reference: docs/process/COORDINATION-PROTOCOL-v1.0.md v3
 *   §2.3 participant roles (descriptive)
 *   §3.3 best-effort idempotency
 *   §4.3 blocker FSM values
 *   §5.1 disagreement topic 1-500
 *   §6.1 mode enum
 */

import { describe, it, expect } from 'vitest';
import { __TEST_ONLY__ } from '../../src/commands/room.js';

const {
  compareByValidAtThenClaimId,
  fetchRoomClaims,
  validateValueForKind,
  validateDetailsFieldsForKind,
  findExistingBySourceId,
  checkRateLimit,
  projectBlockerState,
  publishMessage,
  ENGINE_CLAIM_QUERY_MAX_LIMIT,
  RATE_LIMIT_CEILING,
  RATE_LIMIT_WINDOW_MS,
} = __TEST_ONLY__;

// ── Per-kind validator tests (F-LC3-002 closure) ──────────────────────

describe('validateValueForKind — message kind', () => {
  it('accepts 1-char message', () => {
    expect(validateValueForKind('message', 'x')).toBeNull();
  });

  it('accepts 2000-char message', () => {
    const value = 'a'.repeat(2000);
    expect(validateValueForKind('message', value)).toBeNull();
  });

  it('rejects empty message', () => {
    const err = validateValueForKind('message', '');
    expect(err?.code).toBe('CLI_ROOM_EMPTY_VALUE');
  });

  it('rejects 2001-char message (§3.4 cap)', () => {
    const value = 'a'.repeat(2001);
    const err = validateValueForKind('message', value);
    expect(err?.code).toBe('CLI_ROOM_VALUE_TOO_LONG');
  });
});

describe('validateValueForKind — blocker FSM values (§4.3)', () => {
  it('accepts OPEN', () => {
    expect(validateValueForKind('blocker', 'OPEN')).toBeNull();
  });

  it('accepts RESOLVED', () => {
    expect(validateValueForKind('blocker', 'RESOLVED')).toBeNull();
  });

  it('accepts WAITING_ON_<agent-with-valid-name>', () => {
    expect(validateValueForKind('blocker', 'WAITING_ON_claude-code')).toBeNull();
    expect(validateValueForKind('blocker', 'WAITING_ON_codex')).toBeNull();
    expect(validateValueForKind('blocker', 'WAITING_ON_femi')).toBeNull();
  });

  it('rejects empty', () => {
    const err = validateValueForKind('blocker', '');
    expect(err?.code).toBe('CLI_ROOM_EMPTY_VALUE');
  });

  it('rejects arbitrary unknown value', () => {
    const err = validateValueForKind('blocker', 'nonsense');
    expect(err?.code).toBe('CLI_ROOM_INVALID_BLOCKER_VALUE');
  });

  it('rejects WAITING_ON_ with empty agent', () => {
    const err = validateValueForKind('blocker', 'WAITING_ON_');
    expect(err?.code).toBe('CLI_ROOM_INVALID_BLOCKER_VALUE');
  });

  it('rejects WAITING_ON_ with invalid agent-name chars', () => {
    const err = validateValueForKind('blocker', 'WAITING_ON_bad agent');
    expect(err?.code).toBe('CLI_ROOM_INVALID_BLOCKER_VALUE');
  });

  it('rejects lowercase open/resolved (exact match required)', () => {
    expect(validateValueForKind('blocker', 'open')?.code).toBe('CLI_ROOM_INVALID_BLOCKER_VALUE');
    expect(validateValueForKind('blocker', 'resolved')?.code).toBe('CLI_ROOM_INVALID_BLOCKER_VALUE');
  });
});

describe('validateValueForKind — disagreement topic (§5.1)', () => {
  it('accepts short topic', () => {
    expect(validateValueForKind('disagreement', 'Dispute over FSM shape')).toBeNull();
  });

  it('accepts 500-char topic', () => {
    expect(validateValueForKind('disagreement', 'a'.repeat(500))).toBeNull();
  });

  it('rejects empty topic', () => {
    expect(validateValueForKind('disagreement', '')?.code).toBe('CLI_ROOM_EMPTY_VALUE');
  });

  it('rejects 501-char topic (§5.1 cap — F-LC3-002 repro)', () => {
    const err = validateValueForKind('disagreement', 'a'.repeat(501));
    expect(err?.code).toBe('CLI_ROOM_DISAGREEMENT_TOPIC_TOO_LONG');
  });
});

describe('validateValueForKind — resolve (§5.1)', () => {
  it('accepts mutual', () => {
    expect(validateValueForKind('resolve', 'mutual')).toBeNull();
  });

  it('accepts withdrawn', () => {
    expect(validateValueForKind('resolve', 'withdrawn')).toBeNull();
  });

  it('accepts escalate:<agent>', () => {
    expect(validateValueForKind('resolve', 'escalate:femi')).toBeNull();
    expect(validateValueForKind('resolve', 'escalate:claude-code')).toBeNull();
  });

  it('accepts winning participant name', () => {
    expect(validateValueForKind('resolve', 'codex')).toBeNull();
    expect(validateValueForKind('resolve', 'claude-code')).toBeNull();
  });

  it('rejects escalate with invalid agent-name', () => {
    expect(validateValueForKind('resolve', 'escalate:bad agent')?.code).toBe('CLI_ROOM_INVALID_RESOLVE_VALUE');
  });

  it('rejects values that do not match any legal form', () => {
    // The protocol accepts ANY valid agent-name as the winning
    // participant, so single-word lowercase strings like "maybe" are
    // protocol-valid (meaning "the agent named 'maybe' won"). What gets
    // rejected here is values that fail all four forms: not "mutual",
    // not "withdrawn", not "escalate:<agent>", and not a valid agent-name.
    expect(validateValueForKind('resolve', 'not a valid agent')?.code).toBe(
      'CLI_ROOM_INVALID_RESOLVE_VALUE',
    );
    expect(validateValueForKind('resolve', 'has:colon')?.code).toBe(
      'CLI_ROOM_INVALID_RESOLVE_VALUE',
    );
    expect(validateValueForKind('resolve', 'a'.repeat(65))?.code).toBe(
      'CLI_ROOM_INVALID_RESOLVE_VALUE',
    );
  });

  it('rejects empty', () => {
    expect(validateValueForKind('resolve', '')?.code).toBe('CLI_ROOM_EMPTY_VALUE');
  });
});

describe('validateValueForKind — participant role (§2.3 descriptive)', () => {
  it.each(['founder', 'member', 'observer', 'removed', 'archived'])(
    'accepts role "%s"',
    (role) => {
      expect(validateValueForKind('participant', role)).toBeNull();
    },
  );

  it('rejects arbitrary role value', () => {
    expect(validateValueForKind('participant', 'superuser')?.code).toBe(
      'CLI_ROOM_INVALID_PARTICIPANT_ROLE',
    );
  });

  it('rejects empty role', () => {
    expect(validateValueForKind('participant', '')?.code).toBe('CLI_ROOM_EMPTY_VALUE');
  });

  it('rejects capitalized role (exact-match convention)', () => {
    expect(validateValueForKind('participant', 'Founder')?.code).toBe(
      'CLI_ROOM_INVALID_PARTICIPANT_ROLE',
    );
  });
});

describe('validateValueForKind — mode (§6.1)', () => {
  it.each(['open', 'directed', 'debate', 'verify'])(
    'accepts mode "%s"',
    (mode) => {
      expect(validateValueForKind('mode', mode)).toBeNull();
    },
  );

  it('rejects nonsense mode (F-LC3-002 repro)', () => {
    expect(validateValueForKind('mode', 'nonsense')?.code).toBe('CLI_ROOM_INVALID_MODE');
  });

  it('rejects empty mode', () => {
    expect(validateValueForKind('mode', '')?.code).toBe('CLI_ROOM_EMPTY_VALUE');
  });

  it('rejects capitalized mode', () => {
    expect(validateValueForKind('mode', 'Open')?.code).toBe('CLI_ROOM_INVALID_MODE');
  });
});

// ── Per-kind semantic enforcement tests (F-LC3-R2-005 v4 closure) ─────

describe('validateDetailsFieldsForKind — message kind', () => {
  it('accepts empty details', () => {
    expect(validateDetailsFieldsForKind('message', 'hi', {})).toBeNull();
  });
  it('tolerates arbitrary extra fields', () => {
    expect(validateDetailsFieldsForKind('message', 'hi', { foo: 'bar' })).toBeNull();
  });
});

describe('validateDetailsFieldsForKind — blocker kind (§1.4 blocker_id + reason)', () => {
  const goodFields = { blocker_id: 'b1', reason: 'waiting on review' };

  it('accepts valid blocker_id + reason', () => {
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', goodFields)).toBeNull();
  });
  it('rejects missing blocker_id', () => {
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', { reason: 'x' })?.code)
      .toBe('CLI_ROOM_BLOCKER_MISSING_ID');
  });
  it('rejects missing reason', () => {
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', { blocker_id: 'b1' })?.code)
      .toBe('CLI_ROOM_BLOCKER_MISSING_REASON');
  });
  it('rejects empty reason', () => {
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', { blocker_id: 'b1', reason: '' })?.code)
      .toBe('CLI_ROOM_BLOCKER_MISSING_REASON');
  });
  it('rejects 501-char reason', () => {
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', { blocker_id: 'b1', reason: 'a'.repeat(501) })?.code)
      .toBe('CLI_ROOM_BLOCKER_MISSING_REASON');
  });
  it('rejects non-string blocker_id', () => {
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', { blocker_id: 42, reason: 'x' })?.code)
      .toBe('CLI_ROOM_BLOCKER_MISSING_ID');
  });
});

describe('validateDetailsFieldsForKind — disagreement kind (§1.4 disagreement_id + positions)', () => {
  const goodFields = {
    disagreement_id: 'd1',
    positions: [{ by: 'claude-code', stance: 'A' }, { by: 'codex', stance: 'B' }],
  };

  it('accepts valid fields', () => {
    expect(validateDetailsFieldsForKind('disagreement', 'topic', goodFields)).toBeNull();
  });
  it('rejects missing disagreement_id', () => {
    expect(validateDetailsFieldsForKind('disagreement', 'topic', { positions: goodFields.positions })?.code)
      .toBe('CLI_ROOM_DISAGREEMENT_MISSING_ID');
  });
  it('rejects positions with fewer than 2 entries', () => {
    expect(validateDetailsFieldsForKind('disagreement', 'topic', {
      disagreement_id: 'd1',
      positions: [{ by: 'claude-code', stance: 'A' }],
    })?.code).toBe('CLI_ROOM_DISAGREEMENT_MISSING_POSITIONS');
  });
  it('rejects position entries missing `by` or `stance`', () => {
    expect(validateDetailsFieldsForKind('disagreement', 'topic', {
      disagreement_id: 'd1',
      positions: [{ by: 'claude-code' }, { by: 'codex', stance: 'B' }],
    })?.code).toBe('CLI_ROOM_DISAGREEMENT_INVALID_POSITION');
  });
});

describe('validateDetailsFieldsForKind — resolve kind (§1.4 disagreement_id + resolver + rationale)', () => {
  const goodFields = {
    disagreement_id: 'd1',
    resolver: 'femi',
    rationale: 'After discussion, position B is the right call.',
  };

  it('accepts valid fields with value=<agent>', () => {
    // No limen passed → existence check is skipped (tool-layer only when limen+subject supplied)
    expect(validateDetailsFieldsForKind('resolve', 'codex', goodFields)).toBeNull();
  });
  it('accepts value=mutual WITH merged_position', () => {
    expect(validateDetailsFieldsForKind('resolve', 'mutual', {
      ...goodFields,
      merged_position: 'compromise text',
    })).toBeNull();
  });
  it('rejects value=mutual WITHOUT merged_position', () => {
    expect(validateDetailsFieldsForKind('resolve', 'mutual', goodFields)?.code)
      .toBe('CLI_ROOM_RESOLVE_MUTUAL_REQUIRES_MERGED');
  });
  it('rejects value=<agent> WITH merged_position (only permitted with mutual)', () => {
    expect(validateDetailsFieldsForKind('resolve', 'codex', {
      ...goodFields,
      merged_position: 'should not be here',
    })?.code).toBe('CLI_ROOM_RESOLVE_MERGED_ONLY_WITH_MUTUAL');
  });
  it('rejects missing disagreement_id', () => {
    expect(validateDetailsFieldsForKind('resolve', 'codex', {
      resolver: 'femi',
      rationale: 'x',
    })?.code).toBe('CLI_ROOM_RESOLVE_MISSING_ID');
  });
  it('rejects invalid resolver name', () => {
    expect(validateDetailsFieldsForKind('resolve', 'codex', {
      ...goodFields,
      resolver: 'bad agent!',
    })?.code).toBe('CLI_ROOM_RESOLVE_MISSING_RESOLVER');
  });
  it('rejects missing rationale', () => {
    expect(validateDetailsFieldsForKind('resolve', 'codex', {
      disagreement_id: 'd1',
      resolver: 'femi',
    })?.code).toBe('CLI_ROOM_RESOLVE_MISSING_RATIONALE');
  });
  it('rejects >1000-char rationale', () => {
    expect(validateDetailsFieldsForKind('resolve', 'codex', {
      ...goodFields,
      rationale: 'a'.repeat(1001),
    })?.code).toBe('CLI_ROOM_RESOLVE_MISSING_RATIONALE');
  });
});

describe('validateDetailsFieldsForKind — resolve kind with store (C-23 existence check)', () => {
  const goodFields = {
    disagreement_id: 'd1',
    resolver: 'femi',
    rationale: 'x',
  };

  it('rejects when referenced disagreement_id does not exist in store', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [
          {
            claimId: 'c1',
            subject: 'entity:room:r1',
            predicate: 'room.disagreement',
            value: 'topic-alpha',
            validAt: '2026-04-18T00:00:00Z',
            reasoning: JSON.stringify({
              schema_version: 'coord-v1.0',
              sender: 'claude-code',
              disagreement_id: 'different-id',
            }),
          },
        ],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const res = validateDetailsFieldsForKind('resolve', 'codex', goodFields, limen, 'entity:room:r1');
    expect(res?.code).toBe('CLI_ROOM_RESOLVE_NO_OPEN_DISAGREEMENT');
  });

  it('accepts when referenced disagreement_id exists in store', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [
          {
            claimId: 'c1',
            subject: 'entity:room:r1',
            predicate: 'room.disagreement',
            value: 'topic-alpha',
            validAt: '2026-04-18T00:00:00Z',
            reasoning: JSON.stringify({
              schema_version: 'coord-v1.0',
              sender: 'claude-code',
              disagreement_id: 'd1',
            }),
          },
        ],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const res = validateDetailsFieldsForKind('resolve', 'codex', goodFields, limen, 'entity:room:r1');
    expect(res).toBeNull();
  });

  it('does NOT block on transient recall failure (audit review catches orphans)', () => {
    const limen = {
      recall: () => ({ ok: false, error: { code: 'E', message: '' } }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const res = validateDetailsFieldsForKind('resolve', 'codex', goodFields, limen, 'entity:room:r1');
    // Transient store error should NOT block the append — pass-through.
    expect(res).toBeNull();
  });
});

describe('validateDetailsFieldsForKind — participant kind (§1.4 participant_id + trust_level)', () => {
  it('accepts participant_id alone (trust_level optional)', () => {
    expect(validateDetailsFieldsForKind('participant', 'founder', { participant_id: 'femi' })).toBeNull();
  });
  it('accepts participant_id + valid trust_level', () => {
    expect(validateDetailsFieldsForKind('participant', 'member', {
      participant_id: 'codex',
      trust_level: 'trusted',
    })).toBeNull();
  });
  it('rejects missing participant_id', () => {
    expect(validateDetailsFieldsForKind('participant', 'founder', {})?.code)
      .toBe('CLI_ROOM_PARTICIPANT_MISSING_ID');
  });
  it('rejects invalid participant_id chars', () => {
    expect(validateDetailsFieldsForKind('participant', 'founder', { participant_id: 'bad agent' })?.code)
      .toBe('CLI_ROOM_PARTICIPANT_MISSING_ID');
  });
  it('rejects unknown trust_level value', () => {
    expect(validateDetailsFieldsForKind('participant', 'member', {
      participant_id: 'codex',
      trust_level: 'superuser',
    })?.code).toBe('CLI_ROOM_PARTICIPANT_INVALID_TRUST');
  });
});

describe('validateDetailsFieldsForKind — mode kind', () => {
  it('accepts empty details (no required fields)', () => {
    expect(validateDetailsFieldsForKind('mode', 'open', {})).toBeNull();
  });
});

// ── Idempotency helper tests (F-LC3-001 closure) ──────────────────────

/** Minimal LimenCompat stub that returns a scripted recall response. */
function stubLimen(recallResponse: {
  ok: boolean;
  value?: readonly {
    claimId: string;
    subject: string;
    predicate: string;
    value: string;
    validAt: string;
    reasoning: string | null;
  }[];
  error?: { code: string; message: string };
}) {
  return {
    recall: () => recallResponse,
    remember: () => ({ ok: true, value: { claimId: 'new-claim' } }),
  };
}

// ── Blocker FSM projection + illegal-transition (F-LC3-R3-002 closure) ─

function makeBlockerClaim(
  blockerId: string,
  value: string,
  ageMs: number,
  now: number,
  claimId?: string,
) {
  const ts = new Date(now - ageMs).toISOString();
  return {
    claimId: claimId ?? `c-${Math.random()}`,
    subject: 'entity:room:demo',
    predicate: 'room.blocker',
    value,
    validAt: ts,
    reasoning: JSON.stringify({
      schema_version: 'coord-v1.0',
      sender: 'codex',
      timestamp: ts,
      transport: 'http',
      blocker_id: blockerId,
      reason: 'x',
    }),
  };
}

describe('projectBlockerState — v4 §4.4 most-recent-claim-wins', () => {
  const subject = 'entity:room:demo';
  const now = Date.parse('2026-04-18T12:00:00Z');

  it('returns null when no blocker claims exist for this id', () => {
    const limen = {
      recall: () => ({ ok: true, value: [] }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(projectBlockerState(limen, subject, 'b-1')).toBeNull();
  });

  it('returns the latest-by-validAt value for matching blocker_id', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [
          makeBlockerClaim('b-1', 'OPEN', 30_000, now),
          makeBlockerClaim('b-1', 'WAITING_ON_femi', 20_000, now),
          makeBlockerClaim('b-1', 'RESOLVED', 10_000, now),
        ],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(projectBlockerState(limen, subject, 'b-1')).toBe('RESOLVED');
  });

  it('ignores claims for a different blocker_id', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [
          makeBlockerClaim('b-other', 'RESOLVED', 10_000, now),
          makeBlockerClaim('b-1', 'OPEN', 20_000, now),
        ],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(projectBlockerState(limen, subject, 'b-1')).toBe('OPEN');
  });

  it('returns null on transient recall failure (pass-through)', () => {
    const limen = {
      recall: () => ({ ok: false, error: { code: 'E', message: '' } }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(projectBlockerState(limen, subject, 'b-1')).toBeNull();
  });

  it('breaks validAt ties by claimId so later claims win deterministically', () => {
    const ts = new Date(now - 10_000).toISOString();
    const limen = {
      recall: () => ({ ok: true, value: [] }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
      claims: {
        queryClaims: () => ({
          ok: true,
          value: {
            claims: [
              {
                claim: {
                  id: 'c-0002',
                  subject,
                  predicate: 'room.blocker',
                  object: { value: 'OPEN' },
                  validAt: ts,
                  reasoning: JSON.stringify({
                    schema_version: 'coord-v1.0',
                    sender: 'codex',
                    timestamp: ts,
                    transport: 'http',
                    blocker_id: 'b-1',
                    reason: 'latest',
                  }),
                },
              },
              {
                claim: {
                  id: 'c-0001',
                  subject,
                  predicate: 'room.blocker',
                  object: { value: 'RESOLVED' },
                  validAt: ts,
                  reasoning: JSON.stringify({
                    schema_version: 'coord-v1.0',
                    sender: 'codex',
                    timestamp: ts,
                    transport: 'http',
                    blocker_id: 'b-1',
                    reason: 'older',
                  }),
                },
              },
            ],
            hasMore: false,
          },
        }),
      },
    };
    expect(projectBlockerState(limen, subject, 'b-1')).toBe('OPEN');
  });
});

describe('compareByValidAtThenClaimId — protocol ordering', () => {
  it('orders equal validAt values by claimId ascending', () => {
    const ts = '2026-04-18T12:00:00.000Z';
    const ordered = [
      { validAt: ts, claimId: 'claim-0002' },
      { validAt: ts, claimId: 'claim-0001' },
      { validAt: '2026-04-18T12:00:01.000Z', claimId: 'claim-0000' },
    ].sort(compareByValidAtThenClaimId);
    expect(ordered.map((item) => item.claimId)).toEqual([
      'claim-0001',
      'claim-0002',
      'claim-0000',
    ]);
  });
});

describe('fetchRoomClaims — paginated queryClaims boundary', () => {
  it('pages queryClaims in 200-claim chunks instead of issuing LIMIT_EXCEEDED reads', () => {
    const subject = 'entity:room:demo';
    const predicate = 'room.message';
    const calls: Array<{ limit?: number; offset?: number }> = [];
    const limen = {
      recall: () => {
        throw new Error('fallback recall should not be used when claims.queryClaims exists');
      },
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
      claims: {
        queryClaims: (input: { limit?: number; offset?: number }) => {
          calls.push({ limit: input.limit, offset: input.offset });
          const offset = input.offset ?? 0;
          const size = offset === 0 ? ENGINE_CLAIM_QUERY_MAX_LIMIT : 50;
          return {
            ok: true,
            value: {
              claims: Array.from({ length: size }, (_, index) => {
                const n = offset + index;
                return {
                  claim: {
                    id: `claim-${n.toString().padStart(4, '0')}`,
                    subject,
                    predicate,
                    object: { value: `message-${n}` },
                    validAt: `2026-04-18T12:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
                    reasoning: null,
                  },
                };
              }),
              hasMore: offset === 0,
            },
          };
        },
      },
    };

    const result = fetchRoomClaims(limen, subject, predicate, { limit: 250 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(250);
    expect(calls).toEqual([
      { limit: ENGINE_CLAIM_QUERY_MAX_LIMIT, offset: 0 },
      { limit: 50, offset: ENGINE_CLAIM_QUERY_MAX_LIMIT },
    ]);
  });
});

describe('validateDetailsFieldsForKind — blocker illegal-transition (F-LC3-R3-002)', () => {
  const subject = 'entity:room:demo';
  const now = Date.parse('2026-04-18T12:00:00Z');
  const goodFields = { blocker_id: 'b-1', reason: 'reopen' };

  it('rejects RESOLVED → OPEN with ROOM_BLOCKER_ILLEGAL_TRANSITION (T-7)', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [makeBlockerClaim('b-1', 'RESOLVED', 10_000, now)],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const err = validateDetailsFieldsForKind('blocker', 'OPEN', goodFields, limen, subject);
    expect(err?.code).toBe('ROOM_BLOCKER_ILLEGAL_TRANSITION');
  });

  it('rejects RESOLVED → WAITING_ON_<agent>', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [makeBlockerClaim('b-1', 'RESOLVED', 10_000, now)],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const err = validateDetailsFieldsForKind('blocker', 'WAITING_ON_femi', goodFields, limen, subject);
    expect(err?.code).toBe('ROOM_BLOCKER_ILLEGAL_TRANSITION');
  });

  it('accepts RESOLVED → RESOLVED (absorbing no-op)', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [makeBlockerClaim('b-1', 'RESOLVED', 10_000, now)],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(validateDetailsFieldsForKind('blocker', 'RESOLVED', goodFields, limen, subject)).toBeNull();
  });

  it('accepts OPEN → WAITING_ON_<agent>', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [makeBlockerClaim('b-1', 'OPEN', 10_000, now)],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(validateDetailsFieldsForKind('blocker', 'WAITING_ON_codex', goodFields, limen, subject)).toBeNull();
  });

  it('accepts WAITING_ON_<agent> → OPEN', () => {
    const limen = {
      recall: () => ({
        ok: true,
        value: [makeBlockerClaim('b-1', 'WAITING_ON_femi', 10_000, now)],
      }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', goodFields, limen, subject)).toBeNull();
  });

  it('accepts first blocker claim regardless of incoming state (new id)', () => {
    const limen = {
      recall: () => ({ ok: true, value: [] }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    // No prior state — all incoming states are legal as first claim.
    expect(validateDetailsFieldsForKind('blocker', 'OPEN', goodFields, limen, subject)).toBeNull();
    expect(validateDetailsFieldsForKind('blocker', 'RESOLVED', goodFields, limen, subject)).toBeNull();
    expect(validateDetailsFieldsForKind('blocker', 'WAITING_ON_femi', goodFields, limen, subject)).toBeNull();
  });
});

describe('validateDetailsFieldsForKind — resolve disagreement lookup pagination', () => {
  it('accepts a resolve when the disagreement exists beyond the first 200 claims', () => {
    const subject = 'entity:room:demo';
    const wantedId = 'dg-250';
    const limen = {
      recall: () => ({ ok: false, error: { code: 'LIMIT_EXCEEDED', message: 'should not be used' } }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
      claims: {
        queryClaims: (input: { offset?: number; limit?: number }) => {
          const offset = input.offset ?? 0;
          const size = offset === 0 ? ENGINE_CLAIM_QUERY_MAX_LIMIT : 60;
          return {
            ok: true,
            value: {
              claims: Array.from({ length: size }, (_, index) => {
                const n = offset + index;
                const disagreementId = n === 250 ? wantedId : `dg-${n}`;
                return {
                  claim: {
                    id: `claim-${n.toString().padStart(4, '0')}`,
                    subject,
                    predicate: 'room.disagreement',
                    object: { value: `topic-${n}` },
                    validAt: `2026-04-18T12:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
                    reasoning: JSON.stringify({
                      schema_version: 'coord-v1.0',
                      sender: 'codex',
                      timestamp: '2026-04-18T12:00:00.000Z',
                      transport: 'cli',
                      disagreement_id: disagreementId,
                      positions: [
                        { by: 'codex', stance: 'A' },
                        { by: 'claude-code', stance: 'B' },
                      ],
                    }),
                  },
                };
              }),
              hasMore: offset === 0,
            },
          };
        },
      },
    };

    const err = validateDetailsFieldsForKind(
      'resolve',
      'mutual',
      {
        disagreement_id: wantedId,
        resolver: 'femi',
        rationale: 'merged',
        merged_position: 'combined',
      },
      limen,
      subject,
    );
    expect(err).toBeNull();
  });
});

describe('publishMessage — v4 §8.5 rate-limit on room join path (F-LC3-R3-001)', () => {
  const subject = 'entity:room:demo';

  it('rate-limits `room join` message-publish path the same as `room record`', async () => {
    // Build a claim set that crosses the ceiling for (cli, codex).
    const now = Date.now();
    const claims = [];
    for (let i = 0; i < RATE_LIMIT_CEILING; i++) {
      claims.push(makeRateLimitClaim('codex', 'cli', i * 100, now));
    }
    const limen = {
      recall: () => ({ ok: true, value: claims }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const res = await publishMessage(limen, {
      subject,
      room: 'demo',
      normalizedRoomId: 'demo',
      sender: 'codex',
      value: 'hi',
      clock: () => new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('CLI_ROOM_RATE_LIMIT_EXCEEDED');
  });

  it('allows publish when below ceiling', async () => {
    const limen = {
      recall: () => ({ ok: true, value: [] }),
      remember: () => ({ ok: true, value: { claimId: 'new-claim' } }),
    };
    const res = await publishMessage(limen, {
      subject,
      room: 'demo',
      normalizedRoomId: 'demo',
      sender: 'codex',
      value: 'hi',
      clock: () => new Date().toISOString(),
    });
    expect(res.ok).toBe(true);
    expect(res.value?.claimId).toBe('new-claim');
  });
});

// ── Rate-limit tests (F-LC3-R2-006 v4 closure, §8.5 coarse best-effort) ─

function makeRateLimitClaim(sender: string, transport: string, ageMs: number, now: number) {
  const ts = new Date(now - ageMs).toISOString();
  return {
    claimId: `c-${Math.random()}`,
    subject: 'entity:room:demo',
    predicate: 'room.message',
    value: 'msg',
    validAt: ts,
    reasoning: JSON.stringify({
      schema_version: 'coord-v1.0',
      sender,
      timestamp: ts,
      transport,
    }),
  };
}

describe('checkRateLimit — v4 §8.5 coarse (transport, sender) window', () => {
  const subject = 'entity:room:demo';
  const now = Date.parse('2026-04-18T12:00:00Z');

  it('passes when no recent claims exist', () => {
    const limen = {
      recall: () => ({ ok: true, value: [] }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(checkRateLimit(limen, subject, 'codex', now)).toBeNull();
  });

  it('passes when ceiling-minus-1 claims exist in-window from same sender', () => {
    const claims = [];
    for (let i = 0; i < RATE_LIMIT_CEILING - 1; i++) {
      claims.push(makeRateLimitClaim('codex', 'cli', i * 100, now));
    }
    const limen = {
      recall: () => ({ ok: true, value: claims }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(checkRateLimit(limen, subject, 'codex', now)).toBeNull();
  });

  it('rejects when ceiling claims exist in-window from same (transport, sender)', () => {
    const claims = [];
    for (let i = 0; i < RATE_LIMIT_CEILING; i++) {
      claims.push(makeRateLimitClaim('codex', 'cli', i * 100, now));
    }
    const limen = {
      recall: () => ({ ok: true, value: claims }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    const res = checkRateLimit(limen, subject, 'codex', now);
    expect(res?.code).toBe('CLI_ROOM_RATE_LIMIT_EXCEEDED');
  });

  it('does NOT count claims from a different sender', () => {
    const claims = [];
    for (let i = 0; i < RATE_LIMIT_CEILING + 5; i++) {
      claims.push(makeRateLimitClaim('someone-else', 'cli', i * 100, now));
    }
    const limen = {
      recall: () => ({ ok: true, value: claims }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(checkRateLimit(limen, subject, 'codex', now)).toBeNull();
  });

  it('does NOT count claims from a different transport (stdio, http)', () => {
    const claims = [];
    for (let i = 0; i < RATE_LIMIT_CEILING + 5; i++) {
      claims.push(makeRateLimitClaim('codex', 'http', i * 100, now));
    }
    const limen = {
      recall: () => ({ ok: true, value: claims }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(checkRateLimit(limen, subject, 'codex', now)).toBeNull();
  });

  it('does NOT count claims older than the window', () => {
    const claims = [];
    // 100 claims, all from same (cli, codex), all 5 minutes old
    for (let i = 0; i < 100; i++) {
      claims.push(makeRateLimitClaim('codex', 'cli', RATE_LIMIT_WINDOW_MS + 1000 + i * 10, now));
    }
    const limen = {
      recall: () => ({ ok: true, value: claims }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(checkRateLimit(limen, subject, 'codex', now)).toBeNull();
  });

  it('passes on recall error (does not block on transient store failure)', () => {
    const limen = {
      recall: () => ({ ok: false, error: { code: 'E', message: '' } }),
      remember: () => ({ ok: true, value: { claimId: 'new' } }),
    };
    expect(checkRateLimit(limen, subject, 'codex', now)).toBeNull();
  });
});

describe('findExistingBySourceId — §3.3 best-effort idempotency', () => {
  const subject = 'entity:room:demo_room';
  const predicate = 'room.message';

  it('returns null when recall fails', () => {
    const limen = stubLimen({ ok: false, error: { code: 'E', message: '' } });
    expect(findExistingBySourceId(limen, subject, predicate, 'src-1')).toBeNull();
  });

  it('returns null when no claims exist', () => {
    const limen = stubLimen({ ok: true, value: [] });
    expect(findExistingBySourceId(limen, subject, predicate, 'src-1')).toBeNull();
  });

  it('returns null when source_id not found in any reasoning', () => {
    const limen = stubLimen({
      ok: true,
      value: [{
        claimId: 'c1',
        subject, predicate, value: 'hi',
        validAt: '2026-04-18T00:00:00Z',
        reasoning: JSON.stringify({ sender: 'a', sourceId: 'other-src' }),
      }],
    });
    expect(findExistingBySourceId(limen, subject, predicate, 'src-1')).toBeNull();
  });

  it('returns existing claimId when source_id matches (idempotent hit)', () => {
    const limen = stubLimen({
      ok: true,
      value: [{
        claimId: 'c1',
        subject, predicate, value: 'hi',
        validAt: '2026-04-18T00:00:00Z',
        reasoning: JSON.stringify({ sender: 'a', sourceId: 'src-1' }),
      }],
    });
    expect(findExistingBySourceId(limen, subject, predicate, 'src-1')).toBe('c1');
  });

  it('returns the FIRST matching claimId when multiple claims share source_id', () => {
    // Multiple-match case documents the best-effort semantics: first
    // match wins. Not a claim about which producer published first.
    const limen = stubLimen({
      ok: true,
      value: [
        {
          claimId: 'c1',
          subject, predicate, value: 'hi',
          validAt: '2026-04-18T00:00:00Z',
          reasoning: JSON.stringify({ sender: 'a', sourceId: 'dup' }),
        },
        {
          claimId: 'c2',
          subject, predicate, value: 'hi',
          validAt: '2026-04-18T00:00:01Z',
          reasoning: JSON.stringify({ sender: 'a', sourceId: 'dup' }),
        },
      ],
    });
    expect(findExistingBySourceId(limen, subject, predicate, 'dup')).toBe('c1');
  });

  it('returns null when reasoning is not JSON', () => {
    const limen = stubLimen({
      ok: true,
      value: [{
        claimId: 'c1',
        subject, predicate, value: 'hi',
        validAt: '2026-04-18T00:00:00Z',
        reasoning: 'not json',
      }],
    });
    expect(findExistingBySourceId(limen, subject, predicate, 'src-1')).toBeNull();
  });

  it('returns null when reasoning is null', () => {
    const limen = stubLimen({
      ok: true,
      value: [{
        claimId: 'c1',
        subject, predicate, value: 'hi',
        validAt: '2026-04-18T00:00:00Z',
        reasoning: null,
      }],
    });
    expect(findExistingBySourceId(limen, subject, predicate, 'src-1')).toBeNull();
  });
});
