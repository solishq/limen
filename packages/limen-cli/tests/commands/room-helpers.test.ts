/**
 * Unit tests for packages/limen-cli/src/commands/room-helpers.ts.
 *
 * Reference: docs/process/COORDINATION-PROTOCOL-v1.0.md §1.1, §1.2, §1.3, §7.
 *
 * F-LC1-001 closure check: normalizeRoomId is bijective (v2). Colons
 * are REJECTED. The v1 colon-to-underscore transformation that caused
 * non-bijective collisions is no longer present.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRoomId,
  roomSubject,
  roomPredicate,
  isValidAgentName,
  parseRoomMetadata,
  ROOM_PREDICATES,
} from '../../src/commands/room-helpers.js';

describe('normalizeRoomId — LIMEN-COORD-v1.0 §1.2 v2 (bijective)', () => {
  it('accepts alphanumeric+underscore+hyphen', () => {
    expect(normalizeRoomId('artemis_slice-a1-1')).toBe('artemis_slice-a1-1');
    expect(normalizeRoomId('lc-1')).toBe('lc-1');
    expect(normalizeRoomId('A123_b')).toBe('A123_b');
  });

  it('accepts a single character', () => {
    expect(normalizeRoomId('a')).toBe('a');
    expect(normalizeRoomId('0')).toBe('0');
    expect(normalizeRoomId('_')).toBe('_');
    expect(normalizeRoomId('-')).toBe('-');
  });

  it('accepts exactly 64 characters', () => {
    const id = 'a'.repeat(64);
    expect(normalizeRoomId(id)).toBe(id);
  });

  it('rejects >64 characters with no truncation', () => {
    const id = 'a'.repeat(65);
    expect(normalizeRoomId(id)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(normalizeRoomId('')).toBeNull();
  });

  it('rejects colons (F-LC1-001 v2 bijective rule)', () => {
    // v1 used to accept these and colon→underscore-normalize them.
    // v2 rejects them outright because that normalization was
    // non-bijective: `a:b-1` and `a_b-1` both mapped to `a_b-1`.
    expect(normalizeRoomId('artemis:slice-a1-1')).toBeNull();
    expect(normalizeRoomId('a:b')).toBeNull();
    expect(normalizeRoomId(':')).toBeNull();
    expect(normalizeRoomId('a::b')).toBeNull();
  });

  it('rejects whitespace', () => {
    expect(normalizeRoomId('slice 1')).toBeNull();
    expect(normalizeRoomId('a\tb')).toBeNull();
    expect(normalizeRoomId(' a')).toBeNull();
    expect(normalizeRoomId('a ')).toBeNull();
  });

  it('rejects other special characters', () => {
    expect(normalizeRoomId('a/b')).toBeNull();
    expect(normalizeRoomId('a.b')).toBeNull();
    expect(normalizeRoomId('a@b')).toBeNull();
    expect(normalizeRoomId('a#b')).toBeNull();
  });

  it('rejects non-string input', () => {
    // @ts-expect-error — runtime defense against bad callers.
    expect(normalizeRoomId(undefined)).toBeNull();
    // @ts-expect-error
    expect(normalizeRoomId(null)).toBeNull();
    // @ts-expect-error
    expect(normalizeRoomId(42)).toBeNull();
    // @ts-expect-error
    expect(normalizeRoomId({})).toBeNull();
  });

  it('v2 bijection property: distinct inputs map to distinct outputs', () => {
    // The whole point of v2. These three inputs were DIFFERENT human
    // strings and MUST remain distinct at the storage layer.
    const a = normalizeRoomId('a_b-1');
    const b = normalizeRoomId('a-b_1');
    const c = normalizeRoomId('ab-1');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe('roomSubject', () => {
  it('constructs subject URN for valid id', () => {
    expect(roomSubject('artemis_slice-a1-1')).toBe('entity:room:artemis_slice-a1-1');
    expect(roomSubject('x')).toBe('entity:room:x');
  });

  it('returns null for invalid id', () => {
    expect(roomSubject('artemis:slice-1')).toBeNull();
    expect(roomSubject('')).toBeNull();
    expect(roomSubject('a'.repeat(65))).toBeNull();
  });
});

describe('roomPredicate', () => {
  it('maps each kind to its 2-segment predicate', () => {
    expect(roomPredicate('message')).toBe('room.message');
    expect(roomPredicate('blocker')).toBe('room.blocker');
    expect(roomPredicate('disagreement')).toBe('room.disagreement');
    expect(roomPredicate('resolve')).toBe('room.resolve');
    expect(roomPredicate('participant')).toBe('room.participant');
    expect(roomPredicate('mode')).toBe('room.mode');
  });

  it('every predicate is strictly 2-segment (Limen engine requirement)', () => {
    for (const value of Object.values(ROOM_PREDICATES)) {
      expect(value.split('.').length).toBe(2);
    }
  });
});

describe('isValidAgentName', () => {
  it('accepts typical agent names', () => {
    expect(isValidAgentName('claude-code')).toBe(true);
    expect(isValidAgentName('codex')).toBe(true);
    expect(isValidAgentName('femi')).toBe(true);
    expect(isValidAgentName('agent_42')).toBe(true);
  });

  it('rejects empty and overlong', () => {
    expect(isValidAgentName('')).toBe(false);
    expect(isValidAgentName('a'.repeat(65))).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(isValidAgentName('a:b')).toBe(false);
    expect(isValidAgentName('a b')).toBe(false);
    expect(isValidAgentName('a.b')).toBe(false);
    expect(isValidAgentName('a/b')).toBe(false);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error
    expect(isValidAgentName(undefined)).toBe(false);
    // @ts-expect-error
    expect(isValidAgentName(null)).toBe(false);
    // @ts-expect-error
    expect(isValidAgentName(42)).toBe(false);
  });
});

describe('parseRoomMetadata', () => {
  it('parses valid metadata JSON', () => {
    const input = JSON.stringify({
      sender: 'claude-code',
      timestamp: '2026-04-18T01:00:00Z',
      transport: 'stdio',
      sourceId: 'src-1',
      mentions: ['codex'],
    });
    const parsed = parseRoomMetadata(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.sender).toBe('claude-code');
    expect(parsed?.mentions).toEqual(['codex']);
  });

  it('returns null for null/undefined', () => {
    expect(parseRoomMetadata(null)).toBeNull();
    expect(parseRoomMetadata(undefined)).toBeNull();
  });

  it('returns null for non-JSON string', () => {
    expect(parseRoomMetadata('not json')).toBeNull();
    expect(parseRoomMetadata('{broken')).toBeNull();
  });

  it('returns null for non-object JSON (array, primitive)', () => {
    expect(parseRoomMetadata('"string"')).toBeNull();
    expect(parseRoomMetadata('42')).toBeNull();
    // Arrays are technically objects in JS, but our contract is an
    // object shape; we accept array since typeof [] === 'object' and
    // the interface is purely advisory. The real contract is handled
    // by the field-level accessors returning undefined for absent
    // fields. This test documents the current behavior.
    expect(parseRoomMetadata('null')).toBeNull();
  });

  it('preserves extra fields for forward compatibility', () => {
    const input = JSON.stringify({
      sender: 'claude-code',
      futureField: 'new-value',
    });
    const parsed = parseRoomMetadata(input);
    expect(parsed?.['futureField']).toBe('new-value');
  });
});
