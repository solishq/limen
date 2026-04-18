import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BeliefView, Limen, RememberResult } from 'limen-ai';
import { z } from 'zod';

export type TransportOrigin = 'stdio' | 'http';

export type RoomEventKind =
  | 'message'
  | 'participant'
  | 'blocker'
  | 'disagreement'
  | 'resolve'
  | 'mode';

interface LimenResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

interface RoomRecordArgs {
  readonly room: string;
  readonly sender: string;
  readonly kind: RoomEventKind;
  readonly value: string;
  readonly detailsJson?: string;
  readonly mentions?: string;
  readonly sourceId?: string;
}

interface ParsedRoomMetadata extends Record<string, unknown> {
  readonly sender?: unknown;
  readonly timestamp?: unknown;
  readonly transport?: unknown;
  readonly room?: unknown;
  readonly normalized_room_id?: unknown;
  readonly kind?: unknown;
  readonly schema_version?: unknown;
  readonly source_id?: unknown;
  readonly sourceId?: unknown;
}

const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ROOM_EVENT_KINDS: readonly RoomEventKind[] = [
  'message',
  'participant',
  'blocker',
  'disagreement',
  'resolve',
  'mode',
];
const ENGINE_CLAIM_QUERY_MAX_LIMIT = 200;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CEILING = 60;
const RESERVED_DETAIL_KEYS = new Set([
  'schema_version',
  'sender',
  'timestamp',
  'transport',
  'source_id',
  'sourceId',
  'room',
  'normalized_room_id',
  'normalizedRoomId',
  'kind',
]);

const ROOM_PREDICATE_BY_KIND: Record<RoomEventKind, string> = {
  message: 'room.message',
  participant: 'room.participant',
  blocker: 'room.blocker',
  disagreement: 'room.disagreement',
  resolve: 'room.resolve',
  mode: 'room.mode',
};

function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

function safeCall<T>(fn: () => LimenResult<T>): LimenResult<T> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return {
        ok: false,
        error: {
          code: 'ASYNC_NOT_SUPPORTED',
          message: 'Expected synchronous Limen Result<T>',
        },
      };
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'ENGINE_UNHEALTHY', message } };
  }
}

function recallRoomClaims(
  limen: Limen,
  subject: string,
  predicate: string,
  limit = ENGINE_CLAIM_QUERY_MAX_LIMIT,
): LimenResult<readonly BeliefView[]> {
  return safeCall<readonly BeliefView[]>(() => limen.recall(subject, predicate, { limit }));
}

function isValidAgentName(name: string): boolean {
  return AGENT_NAME_RE.test(name);
}

function parseMentions(raw: string | undefined): string[] | null {
  if (raw === undefined) return [];
  const mentions = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const mention of mentions) {
    if (!isValidAgentName(mention)) return null;
  }
  return mentions;
}

export function normalizeRoomId(room: string): string | null {
  if (!ROOM_ID_RE.test(room)) return null;
  return room;
}

export function roomSubject(room: string): string | null {
  const normalized = normalizeRoomId(room);
  if (normalized === null) return null;
  return `entity:room:${normalized}`;
}

export function roomPredicate(kind: RoomEventKind): string {
  return ROOM_PREDICATE_BY_KIND[kind];
}

function parseRoomMetadata(reasoning: string | null): ParsedRoomMetadata | null {
  if (reasoning === null) return null;
  try {
    const parsed = JSON.parse(reasoning) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as ParsedRoomMetadata;
  } catch {
    return null;
  }
}

function compareByValidAtThenClaimId<T extends { readonly validAt: string; readonly claimId: string }>(
  left: T,
  right: T,
): number {
  const validAtOrder = left.validAt.localeCompare(right.validAt);
  if (validAtOrder !== 0) return validAtOrder;
  return left.claimId.localeCompare(right.claimId);
}

function extractSourceId(metadata: ParsedRoomMetadata | null): string | null {
  if (metadata === null) return null;
  if (typeof metadata.source_id === 'string') return metadata.source_id;
  if (typeof metadata.sourceId === 'string') return metadata.sourceId;
  return null;
}

function extractTimestamp(metadata: ParsedRoomMetadata | null, fallback: string): string {
  return typeof metadata?.timestamp === 'string' ? metadata.timestamp : fallback;
}

function findExistingBySourceId(
  limen: Limen,
  subject: string,
  predicate: string,
  sourceId: string,
): BeliefView | null {
  const existing = recallRoomClaims(limen, subject, predicate);
  if (!existing.ok) return null;
  for (const belief of existing.value ?? []) {
    if (extractSourceId(parseRoomMetadata(belief.reasoning)) === sourceId) {
      return belief;
    }
  }
  return null;
}

function sanitizeDetailsFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...fields };
  for (const key of RESERVED_DETAIL_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

function validateValueForKind(
  kind: RoomEventKind,
  value: string,
): { code: string; message: string } | null {
  if (value.length === 0) {
    return { code: 'ROOM_EMPTY_VALUE', message: 'value must be non-empty' };
  }

  switch (kind) {
    case 'message':
      if (value.length > 2000) {
        return {
          code: 'ROOM_VALUE_TOO_LONG',
          message: `message value must not exceed 2000 characters (got ${value.length}) per §3.4`,
        };
      }
      return null;

    case 'blocker': {
      if (value === 'OPEN' || value === 'RESOLVED') return null;
      const waiting = /^WAITING_ON_(.+)$/.exec(value);
      if (waiting !== null && isValidAgentName(waiting[1])) return null;
      return {
        code: 'ROOM_INVALID_BLOCKER_VALUE',
        message:
          'blocker value must be "OPEN", "RESOLVED", or "WAITING_ON_<agent>" '
          + 'with <agent> matching /^[a-zA-Z0-9_-]{1,64}$/ per §4.3',
      };
    }

    case 'disagreement':
      if (value.length > 500) {
        return {
          code: 'ROOM_DISAGREEMENT_TOPIC_TOO_LONG',
          message: `disagreement value must not exceed 500 characters (got ${value.length}) per §5.1`,
        };
      }
      return null;

    case 'resolve': {
      if (value === 'mutual' || value === 'withdrawn') return null;
      const escalate = /^escalate:(.+)$/.exec(value);
      if (escalate !== null && isValidAgentName(escalate[1])) return null;
      if (isValidAgentName(value)) return null;
      return {
        code: 'ROOM_INVALID_RESOLVE_VALUE',
        message:
          'resolve value must be "mutual", "withdrawn", "escalate:<agent>", '
          + 'or a winning participant name matching /^[a-zA-Z0-9_-]{1,64}$/ per §5.1',
      };
    }

    case 'participant': {
      const validRoles = ['founder', 'member', 'observer', 'removed', 'archived'];
      if (validRoles.includes(value)) return null;
      return {
        code: 'ROOM_INVALID_PARTICIPANT_ROLE',
        message: `participant value must be one of: ${validRoles.join(', ')} per §2.3`,
      };
    }

    case 'mode': {
      const validModes = ['open', 'directed', 'debate', 'verify'];
      if (validModes.includes(value)) return null;
      return {
        code: 'ROOM_INVALID_MODE',
        message: `mode value must be one of: ${validModes.join(', ')} per §6.1`,
      };
    }
  }
}

function projectBlockerState(
  limen: Limen,
  subject: string,
  blockerId: string,
): string | null {
  const res = recallRoomClaims(limen, subject, 'room.blocker');
  if (!res.ok) return null;
  let latest: { readonly claimId: string; readonly validAt: string; readonly value: string } | null = null;
  for (const belief of res.value ?? []) {
    const metadata = parseRoomMetadata(belief.reasoning);
    if (metadata?.blocker_id !== blockerId) continue;
    if (typeof belief.value !== 'string') continue;
    const candidate = {
      claimId: belief.claimId,
      validAt: belief.validAt,
      value: belief.value,
    };
    if (latest === null || compareByValidAtThenClaimId(candidate, latest) > 0) {
      latest = candidate;
    }
  }
  return latest?.value ?? null;
}

function validateDetailsFieldsForKind(
  kind: RoomEventKind,
  value: string,
  fields: Record<string, unknown>,
  limen: Limen,
  subject: string,
): { code: string; message: string } | null {
  const idRegex = /^[a-zA-Z0-9_:-]{1,128}$/;

  switch (kind) {
    case 'message':
    case 'mode':
      return null;

    case 'participant': {
      const participantId = fields.participant_id;
      if (typeof participantId !== 'string' || !isValidAgentName(participantId)) {
        return {
          code: 'ROOM_PARTICIPANT_MISSING_ID',
          message: 'participant event requires participant_id (valid agent name) per §1.4',
        };
      }
      const trustLevel = fields.trust_level;
      if (trustLevel !== undefined) {
        const validTrustLevels = ['untrusted', 'probationary', 'trusted', 'admin'];
        if (typeof trustLevel !== 'string' || !validTrustLevels.includes(trustLevel)) {
          return {
            code: 'ROOM_PARTICIPANT_INVALID_TRUST',
            message: `participant trust_level must be one of: ${validTrustLevels.join(', ')} per §1.4`,
          };
        }
      }
      return null;
    }

    case 'blocker': {
      const blockerId = fields.blocker_id;
      if (typeof blockerId !== 'string' || !idRegex.test(blockerId)) {
        return {
          code: 'ROOM_BLOCKER_MISSING_ID',
          message: 'blocker event requires blocker_id (1-128 chars) per §1.4',
        };
      }
      const reason = fields.reason;
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > 500) {
        return {
          code: 'ROOM_BLOCKER_MISSING_REASON',
          message: 'blocker event requires reason (1-500 chars) per §1.4',
        };
      }
      const priorState = projectBlockerState(limen, subject, blockerId);
      if (priorState === 'RESOLVED' && value !== 'RESOLVED') {
        return {
          code: 'ROOM_BLOCKER_ILLEGAL_TRANSITION',
          message:
            `blocker "${blockerId}" is already RESOLVED; transition to "${value}" is forbidden per §4.2 `
            + '(RESOLVED is absorbing; open a new blocker_id if the issue recurs).',
        };
      }
      return null;
    }

    case 'disagreement': {
      const disagreementId = fields.disagreement_id;
      if (typeof disagreementId !== 'string' || !idRegex.test(disagreementId)) {
        return {
          code: 'ROOM_DISAGREEMENT_MISSING_ID',
          message: 'disagreement event requires disagreement_id (1-128 chars) per §1.4',
        };
      }
      const positions = fields.positions;
      if (!Array.isArray(positions) || positions.length < 2) {
        return {
          code: 'ROOM_DISAGREEMENT_MISSING_POSITIONS',
          message: 'disagreement event requires positions array (length >= 2) per §1.4',
        };
      }
      for (const position of positions) {
        if (
          typeof position !== 'object' ||
          position === null ||
          typeof (position as Record<string, unknown>).by !== 'string' ||
          typeof (position as Record<string, unknown>).stance !== 'string'
        ) {
          return {
            code: 'ROOM_DISAGREEMENT_INVALID_POSITION',
            message: 'disagreement positions entries must be objects with by and stance strings per §1.4',
          };
        }
      }
      return null;
    }

    case 'resolve': {
      const disagreementId = fields.disagreement_id;
      if (typeof disagreementId !== 'string' || !idRegex.test(disagreementId)) {
        return {
          code: 'ROOM_RESOLVE_MISSING_ID',
          message: 'resolve event requires disagreement_id referencing an existing disagreement per §1.4',
        };
      }
      const resolver = fields.resolver;
      if (typeof resolver !== 'string' || !isValidAgentName(resolver)) {
        return {
          code: 'ROOM_RESOLVE_MISSING_RESOLVER',
          message: 'resolve event requires resolver (valid agent name) per §1.4',
        };
      }
      const rationale = fields.rationale;
      if (typeof rationale !== 'string' || rationale.length === 0 || rationale.length > 1000) {
        return {
          code: 'ROOM_RESOLVE_MISSING_RATIONALE',
          message: 'resolve event requires rationale (1-1000 chars) per §1.4',
        };
      }
      const hasMergedPosition = 'merged_position' in fields;
      if (value === 'mutual' && !hasMergedPosition) {
        return {
          code: 'ROOM_RESOLVE_MUTUAL_REQUIRES_MERGED',
          message: 'resolve value "mutual" requires merged_position per §1.4',
        };
      }
      if (value !== 'mutual' && hasMergedPosition) {
        return {
          code: 'ROOM_RESOLVE_MERGED_ONLY_WITH_MUTUAL',
          message: 'merged_position is permitted only when value is "mutual" per §1.4',
        };
      }
      const disagreements = recallRoomClaims(limen, subject, 'room.disagreement');
      if (disagreements.ok) {
        const found = (disagreements.value ?? []).some((belief) => {
          const metadata = parseRoomMetadata(belief.reasoning);
          return metadata?.disagreement_id === disagreementId;
        });
        if (!found) {
          return {
            code: 'ROOM_RESOLVE_NO_OPEN_DISAGREEMENT',
            message: `disagreement_id "${disagreementId}" does not match any existing disagreement in this room`,
          };
        }
      }
      return null;
    }
  }
}

function checkRateLimit(
  limen: Limen,
  subject: string,
  sender: string,
  transport: TransportOrigin,
): { code: string; message: string } | null {
  const res = recallRoomClaims(limen, subject, 'room.*');
  if (!res.ok) return null;

  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  let count = 0;

  for (const belief of res.value ?? []) {
    const metadata = parseRoomMetadata(belief.reasoning);
    if (metadata === null) continue;
    if (metadata.sender !== sender || metadata.transport !== transport) continue;
    const timestamp = extractTimestamp(metadata, belief.validAt);
    const at = Date.parse(timestamp);
    if (!Number.isNaN(at) && at >= cutoff) {
      count += 1;
      if (count >= RATE_LIMIT_CEILING) {
        return {
          code: 'ROOM_RATE_LIMIT_EXCEEDED',
          message:
            `rate limit: sender "${sender}" over ${transport} transport has posted >= ${RATE_LIMIT_CEILING} `
            + 'room.* claims to this room in the last 60 seconds (coarse best-effort per §8.5).',
        };
      }
    }
  }

  return null;
}

function projectDisagreementStates(
  beliefs: readonly BeliefView[],
): Map<string, string> {
  const states = new Map<string, string>();
  const resolveValues = new Map<string, string[]>();

  for (const belief of beliefs) {
    const metadata = parseRoomMetadata(belief.reasoning);
    const disagreementId = typeof metadata?.disagreement_id === 'string'
      ? metadata.disagreement_id
      : null;
    if (belief.predicate === 'room.disagreement' && disagreementId !== null && !states.has(disagreementId)) {
      states.set(disagreementId, 'OPEN');
    }
    if (belief.predicate === 'room.resolve' && disagreementId !== null && typeof belief.value === 'string') {
      const values = resolveValues.get(disagreementId) ?? [];
      values.push(belief.value);
      resolveValues.set(disagreementId, values);
    }
  }

  for (const [disagreementId, values] of resolveValues.entries()) {
    if (values.length === 0) {
      states.set(disagreementId, 'OPEN');
    } else if (values.length === 1) {
      states.set(disagreementId, `RESOLVED_${values[0]}`);
    } else {
      states.set(disagreementId, 'CONFLICTED');
    }
  }

  return states;
}

export function recordRoomEvent(
  limen: Limen,
  args: RoomRecordArgs,
  transport: TransportOrigin,
) {
  if (!isValidAgentName(args.sender)) {
    return mcpError('ROOM_INVALID_SENDER', 'Sender must be 1-64 chars: alphanumeric, hyphens, underscores');
  }

  const normalizedRoomId = normalizeRoomId(args.room);
  if (normalizedRoomId === null) {
    return mcpError(
      'ROOM_INVALID_ID',
      'Room must be 1-64 chars using only alphanumeric, hyphens, and underscores',
    );
  }

  if (!ROOM_EVENT_KINDS.includes(args.kind)) {
    return mcpError('ROOM_INVALID_KIND', `kind must be one of: ${ROOM_EVENT_KINDS.join(', ')}`);
  }

  const valueErr = validateValueForKind(args.kind, args.value);
  if (valueErr !== null) {
    return mcpError(valueErr.code, valueErr.message);
  }

  const mentions = parseMentions(args.mentions);
  if (mentions === null) {
    return mcpError('ROOM_INVALID_MENTION', 'Mentions must be 1-64 chars: alphanumeric, hyphens, underscores');
  }

  let detailsFields: Record<string, unknown> = {};
  if (args.detailsJson !== undefined) {
    try {
      const parsed = JSON.parse(args.detailsJson) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return mcpError('ROOM_INVALID_DETAILS_JSON', 'detailsJson must be a JSON object');
      }
      detailsFields = parsed as Record<string, unknown>;
    } catch {
      return mcpError('ROOM_INVALID_DETAILS_JSON', 'detailsJson must be valid JSON');
    }
  }

  const subject = roomSubject(args.room)!;
  const detailsErr = validateDetailsFieldsForKind(args.kind, args.value, detailsFields, limen, subject);
  if (detailsErr !== null) {
    return mcpError(detailsErr.code, detailsErr.message);
  }

  const rateLimitErr = checkRateLimit(limen, subject, args.sender, transport);
  if (rateLimitErr !== null) {
    return mcpError(rateLimitErr.code, rateLimitErr.message);
  }

  const predicate = roomPredicate(args.kind);
  const effectiveSourceId = args.sourceId ?? randomUUID();
  const duplicate = findExistingBySourceId(limen, subject, predicate, effectiveSourceId);
  if (duplicate !== null) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          recorded: true,
          deduped: true,
          room: args.room,
          normalizedRoomId,
          predicate,
          claimId: duplicate.claimId,
          source_id: effectiveSourceId,
          transport,
        }),
      }],
    };
  }

  const sanitizedDetails = sanitizeDetailsFields(detailsFields);
  const metadata: Record<string, unknown> = {
    schema_version: 'coord-v1.0',
    sender: args.sender,
    timestamp: new Date().toISOString(),
    source_id: effectiveSourceId,
    room: args.room,
    normalized_room_id: normalizedRoomId,
    kind: args.kind,
    ...sanitizedDetails,
    ...(mentions.length > 0 ? { mentions } : {}),
    transport,
  };

  const result = safeCall<RememberResult>(() => limen.remember(
    subject,
    predicate,
    args.value,
    {
      confidence: 1.0,
      reasoning: JSON.stringify(metadata),
    },
  ));

  if (!result.ok) {
    return mcpError(result.error!.code, result.error!.message);
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        recorded: true,
        deduped: false,
        room: args.room,
        normalizedRoomId,
        predicate,
        claimId: result.value!.claimId,
        source_id: effectiveSourceId,
        transport,
      }),
    }],
  };
}

export function readRoomEvents(
  limen: Limen,
  args: {
    readonly room: string;
    readonly kind?: RoomEventKind;
    readonly limit?: number;
  },
) {
  const normalizedRoomId = normalizeRoomId(args.room);
  if (normalizedRoomId === null) {
    return mcpError(
      'ROOM_INVALID_ID',
      'Room must be 1-64 chars using only alphanumeric, hyphens, and underscores',
    );
  }

  if (args.kind !== undefined && !ROOM_EVENT_KINDS.includes(args.kind)) {
    return mcpError('ROOM_INVALID_KIND', `kind must be one of: ${ROOM_EVENT_KINDS.join(', ')}`);
  }

  const subject = roomSubject(args.room)!;
  const predicate = args.kind ? roomPredicate(args.kind) : 'room.*';
  const limit = args.limit ?? 50;
  const result = recallRoomClaims(limen, subject, predicate, limit);

  if (!result.ok) {
    return mcpError(result.error!.code, result.error!.message);
  }

  const disagreementStates = projectDisagreementStates(result.value ?? []);
  const events = (result.value ?? [])
    .map((belief) => {
      const metadata = parseRoomMetadata(belief.reasoning);
      const validAt = extractTimestamp(metadata, belief.validAt);
      const sender = typeof metadata?.sender === 'string' ? metadata.sender : 'unknown';
      const transport = typeof metadata?.transport === 'string' ? metadata.transport : 'unknown';
      const event: Record<string, unknown> = {
        claimId: belief.claimId,
        predicate: belief.predicate,
        kind: belief.predicate.slice('room.'.length),
        value: belief.value,
        validAt,
        sender,
        transport,
        senderMatchesTransport: transport === 'cli' || transport === 'stdio' || transport === 'http',
      };

      if (metadata !== null) {
        for (const [key, fieldValue] of Object.entries(metadata)) {
          if (key === 'sender' || key === 'timestamp' || key === 'transport' || key === 'kind') continue;
          event[key] = fieldValue;
        }
      } else {
        event.room = args.room;
        event.normalized_room_id = normalizedRoomId;
      }

      const disagreementId = typeof event.disagreement_id === 'string'
        ? event.disagreement_id
        : null;
      if (disagreementId !== null && disagreementStates.has(disagreementId)) {
        event.disagreement_state = disagreementStates.get(disagreementId);
      }

      return event as Record<string, unknown> & { readonly claimId: string; readonly validAt: string };
    })
    .sort(compareByValidAtThenClaimId);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        room: args.room,
        normalizedRoomId,
        subject,
        count: events.length,
        events,
      }),
    }],
  };
}

export function registerRoomCoordinationTools(
  server: McpServer,
  limen: Limen,
  transport: TransportOrigin = 'stdio',
): void {
  server.tool(
    'limen_room_record',
    'Record an append-only coordination event in a Limen room using the ratified room.* envelope contract.',
    {
      room: z.string().min(1).max(64).describe('Room id, e.g. "artemis_slice-a1-1"'),
      sender: z.string().min(1).max(64).describe('Your agent name (self-declared in v1.0)'),
      kind: z.enum(['message', 'participant', 'blocker', 'disagreement', 'resolve', 'mode']).describe('Room event kind'),
      value: z.string().min(1).max(2000).describe('Primary event value. Kind-specific validation is enforced per LIMEN-COORD-v1.0.'),
      detailsJson: z.string().max(4000).optional().describe('Optional JSON object whose keys are merged into the top-level reasoning envelope'),
      mentions: z.string().optional().describe('Optional comma-separated mentions for message events'),
      sourceId: z.string().max(128).optional().describe('Optional caller-supplied idempotency key; auto-generated if omitted'),
    },
    (args) => recordRoomEvent(limen, args, transport),
  );

  server.tool(
    'limen_room_read',
    'Read append-only room events in chronological order from a Limen room.',
    {
      room: z.string().min(1).max(64).describe('Room id, e.g. "artemis_slice-a1-1"'),
      kind: z.enum(['message', 'participant', 'blocker', 'disagreement', 'resolve', 'mode']).optional().describe('Optional room event kind filter'),
      limit: z.number().min(1).max(200).optional().describe('Maximum number of events to return (default 50)'),
    },
    (args) => readRoomEvents(limen, args),
  );
}
