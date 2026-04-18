/**
 * Room coordination CLI helpers — parity with
 *   packages/limen-mcp/src/tools/room-coordination.ts
 *
 * Local implementation per project convention: the CLI duplicates the
 * spec-level helpers rather than cross-importing them from the MCP
 * package. If the protocol contract (LIMEN-COORD-v1.0 §1.1, §1.2, §1.3)
 * changes, both sides must be updated.
 *
 * Spec reference: docs/process/COORDINATION-PROTOCOL-v1.0.md
 */

/**
 * LIMEN-COORD-v1.0 §1.2 v2 — bijective room-id rule.
 * Input form == persisted form. Colons are NOT accepted.
 * v1's colon-to-underscore normalization was non-bijective (F-LC1-001)
 * and has been dropped.
 */
const ROOM_ID_PERSISTED_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** LIMEN-COORD-v1.0 §7 — agent/sender name constraint. */
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** LIMEN-COORD-v1.0 §1.3 — enumerated 2-segment predicate set. */
export const ROOM_PREDICATES = Object.freeze({
  message: 'room.message',
  blocker: 'room.blocker',
  disagreement: 'room.disagreement',
  resolve: 'room.resolve',
  participant: 'room.participant',
  mode: 'room.mode',
} as const);

export type RoomEventKind = keyof typeof ROOM_PREDICATES;

/**
 * Validate a room-id per LIMEN-COORD-v1.0 §1.2 v2 (bijective rule).
 * Returns the input unchanged if valid, else null.
 *
 * v2 rule: input must match ROOM_ID_PERSISTED_RE
 * (`[a-zA-Z0-9_-]{1,64}`). Colons are REJECTED (F-LC1-001 closure).
 * No transformation is performed — storage form equals input form.
 *
 * The function name is retained for API compatibility with LC.2
 * (`packages/limen-mcp/src/tools/room-coordination.ts` exports the
 * same-named helper); callers should not depend on the previous
 * transformation behavior.
 */
export function normalizeRoomId(room: string): string | null {
  if (typeof room !== 'string') return null;
  if (!ROOM_ID_PERSISTED_RE.test(room)) return null;
  return room;
}

/**
 * Compute the storage-layer subject URN for a room. Returns null if the
 * input id is invalid.
 */
export function roomSubject(room: string): string | null {
  const normalized = normalizeRoomId(room);
  if (normalized === null) return null;
  return `entity:room:${normalized}`;
}

/** Return the canonical predicate string for an event kind. */
export function roomPredicate(kind: RoomEventKind): string {
  return ROOM_PREDICATES[kind];
}

/** LIMEN-COORD-v1.0 §7 — agent/sender name validation. */
export function isValidAgentName(name: string): boolean {
  if (typeof name !== 'string') return false;
  return AGENT_NAME_RE.test(name);
}

/**
 * Parse the `reasoning` metadata JSON of a room.* claim. Returns null
 * if the value is null, non-JSON, or not an object.
 */
/**
 * LIMEN-COORD-v1.0 v4 §1.4 envelope shape (snake_case). Optional fields
 * reflect that this type is used by both readers (tolerating older v1-v3
 * payloads that may still live in the store) and writers (which MUST
 * emit the v4 shape including `schema_version` and `source_id`).
 */
export interface ParsedRoomMetadata {
  readonly schema_version?: string;
  readonly sender?: string;
  readonly timestamp?: string;
  readonly transport?: string;
  readonly room?: string;
  readonly normalized_room_id?: string;
  readonly kind?: string;
  readonly source_id?: string;
  readonly mentions?: readonly string[];
  readonly [extraKey: string]: unknown;
}

export function parseRoomMetadata(reasoning: string | null | undefined): ParsedRoomMetadata | null {
  if (reasoning === null || reasoning === undefined) return null;
  try {
    const parsed = JSON.parse(reasoning) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as ParsedRoomMetadata;
  } catch {
    return null;
  }
}
