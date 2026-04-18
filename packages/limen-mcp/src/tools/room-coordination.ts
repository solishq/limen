import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen, BeliefView, RememberResult } from 'limen-ai';
import { z } from 'zod';

export type TransportOrigin = 'stdio' | 'http';

export type RoomEventKind =
  | 'message'
  | 'participant'
  | 'blocker'
  | 'disagreement';

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

interface ParsedRoomMetadata {
  readonly sender: string;
  readonly timestamp: string;
  readonly transport: TransportOrigin;
  readonly room: string;
  readonly normalizedRoomId: string;
  readonly kind: RoomEventKind;
  readonly sourceId?: string;
  readonly mentions?: readonly string[];
  readonly details?: unknown;
}

const ROOM_ID_INPUT_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
const ROOM_ID_PERSISTED_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_REASONING_LENGTH = 1000;

const ROOM_PREDICATE_BY_KIND: Record<RoomEventKind, string> = {
  message: 'room.message',
  participant: 'room.participant',
  blocker: 'room.blocker',
  disagreement: 'room.disagreement',
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
  if (!ROOM_ID_INPUT_RE.test(room)) return null;
  const normalized = room.replace(/:/g, '_');
  if (!ROOM_ID_PERSISTED_RE.test(normalized)) return null;
  return normalized;
}

export function roomSubject(room: string): string | null {
  const normalized = normalizeRoomId(room);
  if (normalized === null) return null;
  return `entity:room:${normalized}`;
}

export function roomPredicate(kind: RoomEventKind): string {
  return ROOM_PREDICATE_BY_KIND[kind];
}

function parseDetailsJson(detailsJson: string | undefined): unknown {
  if (detailsJson === undefined) return undefined;
  return JSON.parse(detailsJson) as unknown;
}

function parseRoomMetadata(reasoning: string | null): ParsedRoomMetadata | null {
  if (reasoning === null) return null;
  try {
    return JSON.parse(reasoning) as ParsedRoomMetadata;
  } catch {
    return null;
  }
}

function findExistingBySourceId(
  limen: Limen,
  subject: string,
  predicate: string,
  sourceId: string,
): BeliefView | null {
  const existing = safeCall<readonly BeliefView[]>(() => limen.recall(subject, predicate, { limit: 200 }));
  if (!existing.ok) return null;
  for (const belief of existing.value ?? []) {
    const metadata = parseRoomMetadata(belief.reasoning);
    if (metadata?.sourceId === sourceId) return belief;
  }
  return null;
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
      'Room must be 1-64 chars using only alphanumeric, hyphens, underscores, and colons',
    );
  }

  const mentions = parseMentions(args.mentions);
  if (mentions === null) {
    return mcpError('ROOM_INVALID_MENTION', 'Mentions must be 1-64 chars: alphanumeric, hyphens, underscores');
  }

  let details: unknown;
  try {
    details = parseDetailsJson(args.detailsJson);
  } catch {
    return mcpError('ROOM_INVALID_DETAILS_JSON', 'detailsJson must be valid JSON');
  }

  const subject = `entity:room:${normalizedRoomId}`;
  const predicate = roomPredicate(args.kind);

  if (args.sourceId) {
    const duplicate = findExistingBySourceId(limen, subject, predicate, args.sourceId);
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
          }),
        }],
      };
    }
  }

  const metadata = {
    sender: args.sender,
    timestamp: new Date().toISOString(),
    transport,
    room: args.room,
    normalizedRoomId,
    kind: args.kind,
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(details !== undefined ? { details } : {}),
  };
  const reasoning = JSON.stringify(metadata);
  if (reasoning.length > MAX_REASONING_LENGTH) {
    return mcpError(
      'ROOM_METADATA_TOO_LARGE',
      `Metadata exceeds maximum reasoning length of ${MAX_REASONING_LENGTH} characters`,
    );
  }

  const result = safeCall<RememberResult>(() => limen.remember(
    subject,
    predicate,
    args.value,
    {
      confidence: 1.0,
      reasoning,
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
      'Room must be 1-64 chars using only alphanumeric, hyphens, underscores, and colons',
    );
  }

  const subject = `entity:room:${normalizedRoomId}`;
  const predicate = args.kind ? roomPredicate(args.kind) : 'room.*';
  const limit = args.limit ?? 50;
  const result = safeCall<readonly BeliefView[]>(() => limen.recall(subject, predicate, { limit }));

  if (!result.ok) {
    return mcpError(result.error!.code, result.error!.message);
  }

  const events = (result.value ?? [])
    .map((belief) => {
      const metadata = parseRoomMetadata(belief.reasoning);
      return {
        claimId: belief.claimId,
        predicate: belief.predicate,
        kind: belief.predicate.slice('room.'.length),
        value: belief.value,
        timestamp: metadata?.timestamp ?? belief.validAt,
        sender: metadata?.sender ?? 'unknown',
        transport: metadata?.transport ?? 'unknown',
        room: metadata?.room ?? args.room,
        normalizedRoomId: metadata?.normalizedRoomId ?? normalizedRoomId,
        ...(metadata?.sourceId ? { sourceId: metadata.sourceId } : {}),
        ...(metadata?.mentions ? { mentions: metadata.mentions } : {}),
        ...(metadata?.details !== undefined ? { details: metadata.details } : {}),
      };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

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
    'Record an append-only coordination event in a Limen room. Events are stored as governed claims under the room.* predicate family.',
    {
      room: z.string().min(1).max(64).describe('Human-facing room id, e.g. "artemis:slice-a1-1"'),
      sender: z.string().min(1).max(64).describe('Your agent name (self-declared)'),
      kind: z.enum(['message', 'participant', 'blocker', 'disagreement']).describe('Room event kind'),
      value: z.string().min(1).max(2000).describe('Primary event value. For message: text. For blocker: state. For disagreement: topic. For participant: role.'),
      detailsJson: z.string().max(2000).optional().describe('Optional JSON string carrying structured event details'),
      mentions: z.string().optional().describe('Optional comma-separated mentions for message events'),
      sourceId: z.string().max(128).optional().describe('Optional caller-provided source id for best-effort de-duplication'),
    },
    (args) => recordRoomEvent(limen, args, transport),
  );

  server.tool(
    'limen_room_read',
    'Read append-only room events in chronological order from a Limen room.',
    {
      room: z.string().min(1).max(64).describe('Human-facing room id, e.g. "artemis:slice-a1-1"'),
      kind: z.enum(['message', 'participant', 'blocker', 'disagreement']).optional().describe('Optional room event kind filter'),
      limit: z.number().min(1).max(200).optional().describe('Maximum number of events to return (default 50)'),
    },
    (args) => readRoomEvents(limen, args),
  );
}
