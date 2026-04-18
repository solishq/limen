/**
 * limen room — Interactive room coordination UI.
 *
 * Per LIMEN-COORD-v1.0 §9.3 (docs/process/COORDINATION-PROTOCOL-v1.0.md),
 * this command is the human-facing seat in a coordination room. Joins a
 * room by id, renders existing messages chronologically, polls for new
 * `room.*` claims, and accepts typed input that is published with
 * `transport=cli`.
 *
 * Subcommands:
 *   limen room join <room-id> [--as <sender>] [--poll-interval <ms>]
 *   limen room record <room-id> --kind <kind> --value <text> [--as <sender>] [--details-json <json>] [--source-id <uuid>]
 *   limen room read <room-id> [--kind <kind>] [--limit <n>]
 *
 * JSON stdout for read/record; `join` renders human-readable output.
 */

import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Interface as ReadlineInterface } from 'node:readline';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import {
  normalizeRoomId,
  roomSubject,
  roomPredicate,
  isValidAgentName,
  parseRoomMetadata,
  ROOM_PREDICATES,
  type RoomEventKind,
} from './room-helpers.js';

// Narrow shape of the Limen convenience API we depend on — avoids
// pulling in the full Limen type surface.
interface LimenRecallResult {
  readonly ok: boolean;
  readonly value?: readonly {
    readonly claimId: string;
    readonly subject: string;
    readonly predicate: string;
    readonly value: string;
    readonly validAt: string;
    readonly reasoning: string | null;
  }[];
  readonly error?: { readonly code: string; readonly message: string };
}

interface LimenRememberResult {
  readonly ok: boolean;
  readonly value?: { readonly claimId: string };
  readonly error?: { readonly code: string; readonly message: string };
}

interface LimenQueryClaimsResult {
  readonly ok: boolean;
  readonly value?: {
    readonly claims: readonly {
      readonly claim: {
        readonly id: string;
        readonly subject: string;
        readonly predicate: string;
        readonly object: { readonly value: unknown };
        readonly validAt: string;
        readonly reasoning: string | null;
      };
    }[];
    readonly hasMore: boolean;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

interface RoomStoredClaim {
  readonly claimId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly validAt: string;
  readonly reasoning: string | null;
}

interface LimenCompat {
  recall(
    subject: string,
    predicate: string,
    options?: { readonly limit?: number },
  ): LimenRecallResult;
  remember(
    subject: string,
    predicate: string,
    value: string,
    options?: { readonly confidence?: number; readonly reasoning?: string },
  ): LimenRememberResult;
  readonly claims?: {
    queryClaims(input: {
      readonly subject?: string | null;
      readonly predicate?: string | null;
      readonly status?: 'active' | 'retracted' | null;
      readonly validAtFrom?: string | null;
      readonly limit?: number;
      readonly offset?: number;
    }): LimenQueryClaimsResult;
  };
}

/**
 * Engine-enforced ceiling on a single queryClaims()/recall() call. Kept
 * in sync with CLAIM_QUERY_MAX_LIMIT = 200 in the engine.
 */
const ENGINE_CLAIM_QUERY_MAX_LIMIT = 200;

/** Default sender when `--as` is not provided. Prefers USER, then LOGNAME, then "cli-user". */
function defaultSender(): string {
  const fromEnv = (name: string) => {
    const raw = process.env[name];
    return raw && isValidAgentName(raw) ? raw : null;
  };
  return fromEnv('USER') ?? fromEnv('LOGNAME') ?? 'cli-user';
}

interface RenderRecord {
  readonly claimId: string;
  readonly predicate: string;
  readonly value: string;
  readonly validAt: string;
  readonly sender: string;
  readonly transport: string;
  readonly senderMatchesTransport: boolean;
}

function toRenderRecord(belief: NonNullable<LimenRecallResult['value']>[number]): RenderRecord {
  const metadata = parseRoomMetadata(belief.reasoning);
  const sender = metadata?.sender ?? 'unknown';
  const transport = metadata?.transport ?? 'unknown';
  return {
    claimId: belief.claimId,
    predicate: belief.predicate,
    value: belief.value,
    validAt: metadata?.timestamp ?? belief.validAt,
    sender,
    transport,
    // LIMEN-COORD-v1.0 §7.2: render transport next to sender whenever they diverge.
    senderMatchesTransport: transport === 'cli' || transport === 'stdio' || transport === 'http',
  };
}

function compareByValidAtThenClaimId<T extends { readonly validAt: string; readonly claimId: string }>(
  a: T,
  b: T,
): number {
  const validAtOrder = a.validAt.localeCompare(b.validAt);
  if (validAtOrder !== 0) return validAtOrder;
  return a.claimId.localeCompare(b.claimId);
}

function fetchRoomClaims(
  limen: LimenCompat,
  subject: string,
  predicate: string,
  options?: {
    readonly limit?: number;
    readonly validAtFrom?: string;
  },
): { ok: true; value: RoomStoredClaim[] } | { ok: false; error: { code: string; message: string } } {
  const normalizedLimit = options?.limit !== undefined
    ? Math.max(0, Math.trunc(options.limit))
    : undefined;
  if (normalizedLimit === 0) {
    return { ok: true, value: [] };
  }

  if (limen.claims !== undefined) {
    const collected: RoomStoredClaim[] = [];
    let offset = 0;

    while (normalizedLimit === undefined || collected.length < normalizedLimit) {
      const pageLimit = normalizedLimit === undefined
        ? ENGINE_CLAIM_QUERY_MAX_LIMIT
        : Math.min(ENGINE_CLAIM_QUERY_MAX_LIMIT, normalizedLimit - collected.length);
      const page = limen.claims.queryClaims({
        subject,
        predicate,
        status: 'active',
        validAtFrom: options?.validAtFrom ?? null,
        limit: pageLimit,
        offset,
      });
      if (!page.ok) {
        return {
          ok: false,
          error: {
            code: page.error?.code ?? 'CLI_ROOM_QUERY_FAILED',
            message: page.error?.message ?? 'Failed to query room claims',
          },
        };
      }
      const items = page.value?.claims ?? [];
      for (const item of items) {
        if (typeof item.claim.object.value !== 'string') continue;
        collected.push({
          claimId: item.claim.id,
          subject: item.claim.subject,
          predicate: item.claim.predicate,
          value: item.claim.object.value,
          validAt: item.claim.validAt,
          reasoning: item.claim.reasoning,
        });
      }
      if (page.value?.hasMore !== true || items.length === 0) break;
      offset += items.length;
    }

    return { ok: true, value: collected };
  }

  const recallLimit = normalizedLimit === undefined
    ? ENGINE_CLAIM_QUERY_MAX_LIMIT
    : Math.min(normalizedLimit, ENGINE_CLAIM_QUERY_MAX_LIMIT);
  const recalled = limen.recall(subject, predicate, { limit: recallLimit });
  if (!recalled.ok) {
    return {
      ok: false,
      error: {
        code: recalled.error?.code ?? 'CLI_ROOM_READ_FAILED',
        message: recalled.error?.message ?? 'Failed to read room claims',
      },
    };
  }
  return { ok: true, value: [...(recalled.value ?? [])] };
}

/** Format a single claim for terminal display. Plain text; no ANSI. */
function formatRender(rec: RenderRecord): string {
  const kind = rec.predicate.slice('room.'.length);
  const senderLabel = `${rec.sender}@${rec.transport}`;
  if (kind === 'message') {
    return `[${rec.validAt}] ${senderLabel}: ${rec.value}`;
  }
  return `[${rec.validAt}] ${senderLabel} (${kind}): ${rec.value}`;
}

async function publishMessage(
  limen: LimenCompat,
  params: {
    readonly subject: string;
    readonly room: string;
    readonly normalizedRoomId: string;
    readonly sender: string;
    readonly value: string;
    readonly clock: () => string;
  },
): Promise<LimenRememberResult> {
  // LIMEN-COORD-v1.0 v4 §8.5 / C-12 (F-LC3-R3-001 closure):
  // the `room join` interactive publish path MUST also rate-limit
  // every append with the coarse `(transport='cli', sender)` key.
  // Prior v4 wired the limit into `room record` only; `room join`
  // provided an unbounded alternate append surface — found by
  // Codex Breaker round 3.
  const rateLimitErr = checkRateLimit(limen, params.subject, params.sender);
  if (rateLimitErr !== null) {
    return {
      ok: false,
      error: { code: rateLimitErr.code, message: rateLimitErr.message },
    };
  }

  // LIMEN-COORD-v1.0 v4 §1.4 envelope: snake_case keys, mandatory
  // schema_version + source_id, server-injected transport overwrites
  // any client value (we assemble both here and set transport last).
  const metadata = JSON.stringify({
    schema_version: 'coord-v1.0',
    sender: params.sender,
    timestamp: params.clock(),
    source_id: randomUUID(),
    room: params.room,
    normalized_room_id: params.normalizedRoomId,
    kind: 'message' as RoomEventKind,
    transport: 'cli',
  });
  return limen.remember(
    params.subject,
    ROOM_PREDICATES.message,
    params.value,
    { confidence: 1.0, reasoning: metadata },
  );
}

function createJoinCommand(): Command {
  return new Command('join')
    .description('Join a coordination room interactively (LIMEN-COORD-v1.0 §9.3)')
    .argument('<room-id>', 'Room id (matches /^[a-zA-Z0-9_-]{1,64}$/; colons rejected per v2 bijective rule)')
    .option('--as <sender>', 'Override sender name (default: $USER)')
    .option('--poll-interval <ms>', 'Poll interval in milliseconds (200-60000, default 1000)', (v) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 200 || n > 60_000) {
        throw new Error('--poll-interval must be an integer in [200, 60000]');
      }
      return n;
    })
    .option('--history-limit <n>', 'Max historical messages to render on join (1-1000, default 100)', (v) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 1000) {
        throw new Error('--history-limit must be an integer in [1, 1000]');
      }
      return n;
    })
    .option('--once', 'Render existing messages and exit without polling/input')
    .action(async (
      roomId: string,
      options: {
        as?: string;
        pollInterval?: number;
        historyLimit?: number;
        once?: true;
      },
      command: Command,
    ) => {
      try {
        const globals = command.optsWithGlobals<{ dataDir?: string; masterKey?: string }>();

        const normalized = normalizeRoomId(roomId);
        if (normalized === null) {
          writeError(new CliError(
            'CLI_ROOM_INVALID_ID',
            'Room id must match ^[a-zA-Z0-9_-]{1,64}$ (colons are REJECTED per v2 §1.2 bijective rule)',
          ));
          process.exitCode = 1;
          return;
        }
        const subject = roomSubject(roomId)!;

        const sender = options.as ?? defaultSender();
        if (!isValidAgentName(sender)) {
          writeError(new CliError(
            'CLI_ROOM_INVALID_SENDER',
            '--as must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        const pollIntervalMs = options.pollInterval ?? 1000;
        const historyLimit = options.historyLimit ?? 100;

        await withEngine(
          async (limen): Promise<{ exited: true }> => {
            const limenCompat = limen as unknown as LimenCompat;

            // 1. Historical render.
            const historyRes = fetchRoomClaims(limenCompat, subject, 'room.*', { limit: historyLimit });
            if (!historyRes.ok) {
              throw new CliError(
                historyRes.error.code,
                historyRes.error.message,
              );
            }
            const history = (historyRes.value ?? [])
              .map(toRenderRecord)
              .sort(compareByValidAtThenClaimId);

            // Header + history are written to stdout as human-readable
            // text. The structured JSON audit trail lives in Limen
            // claims, not in CLI output.
            process.stdout.write(
              `# Room ${roomId} (subject=${subject})\n`
              + `# Sender: ${sender} · Transport: cli · Poll: ${pollIntervalMs}ms\n`
              + `# Rendering ${history.length} historical messages:\n`,
            );
            for (const rec of history) {
              process.stdout.write(formatRender(rec) + '\n');
            }

            if (options.once === true) {
              process.stdout.write(`# --once specified; exiting.\n`);
              return { exited: true };
            }

            // 2. Interactive loop: poll + read input.
            let lastValidAt = history.length > 0 ? history[history.length - 1].validAt : '';
            const seenClaimIds = new Set(history.map((r) => r.claimId));

            const rl: ReadlineInterface = createInterface({
              input: process.stdin,
              output: process.stdout,
              terminal: false,
            });

            let exiting = false;
            const shutdown = () => {
              if (exiting) return;
              exiting = true;
              process.stdout.write(`# Leaving ${roomId}.\n`);
              rl.close();
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);

            const pollTimer = setInterval(() => {
              const res = fetchRoomClaims(limenCompat, subject, 'room.*', {
                validAtFrom: lastValidAt.length > 0 ? lastValidAt : undefined,
              });
              if (!res.ok) {
                process.stderr.write(
                  `# poll error: ${res.error.code}: ${res.error.message}\n`,
                );
                return;
              }
              const fresh = (res.value ?? [])
                .map(toRenderRecord)
                .filter((r) => !seenClaimIds.has(r.claimId))
                .sort(compareByValidAtThenClaimId);
              for (const r of fresh) {
                seenClaimIds.add(r.claimId);
                if (r.validAt > lastValidAt) lastValidAt = r.validAt;
                process.stdout.write(formatRender(r) + '\n');
              }
            }, pollIntervalMs);
            pollTimer.unref();

            rl.on('line', (line) => {
              if (exiting) return;
              const trimmed = line.replace(/\r?\n?$/, '');
              if (trimmed === '/quit' || trimmed === '/exit') {
                shutdown();
                return;
              }
              if (trimmed.length === 0) return;
              if (trimmed.length > 2000) {
                process.stderr.write(
                  `# input too long (${trimmed.length} > 2000); message NOT sent.\n`,
                );
                return;
              }
              const published = publishMessage(limenCompat, {
                subject,
                room: roomId,
                normalizedRoomId: normalized,
                sender,
                value: trimmed,
                clock: () => new Date().toISOString(),
              });
              // remember() in the in-process CLI path returns synchronously.
              // Await via Promise.resolve keeps the typing clean if that
              // ever changes.
              void Promise.resolve(published).then((res) => {
                if (!res.ok) {
                  process.stderr.write(
                    `# publish error: ${res.error?.code ?? 'UNKNOWN'}: ${res.error?.message ?? ''}\n`,
                  );
                }
              });
            });

            await new Promise<void>((resolve) => {
              rl.on('close', () => {
                clearInterval(pollTimer);
                resolve();
              });
            });

            return { exited: true };
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );
      } catch (err) {
        // LIMEN-COORD-v1.0 v4 error-propagation fix: `writeError` already
        // recovers the code from CliError OR any Error with a string
        // `code` property. Using it directly preserves the thrown code
        // even when an `instanceof CliError` check fails at module
        // boundaries (e.g. errors thrown inside `withEngine`). Previously
        // the instanceof fallthrough rewrapped every structured error
        // into `CLI_UNEXPECTED`, hiding the real code.
        writeError(err);
        process.exitCode = 1;
      }
    });
}

/**
 * Per-kind value validators. LIMEN-COORD-v1.0 §1-§6 obligations surfaced
 * at the CLI tool layer so non-conformant content is rejected before
 * hitting Limen.
 *
 * Returns null on pass, or a `CliError` code + message on reject.
 * F-LC3-002 closure.
 */
function validateValueForKind(
  kind: RoomEventKind,
  value: string,
): { code: string; message: string } | null {
  // Blanket floor/ceiling first (§3.4 message cap, also applied generally).
  if (value.length === 0) {
    return { code: 'CLI_ROOM_EMPTY_VALUE', message: '--value must be non-empty' };
  }

  switch (kind) {
    case 'message':
      // §3.1 — 1-2000 chars already enforced above.
      if (value.length > 2000) {
        return {
          code: 'CLI_ROOM_VALUE_TOO_LONG',
          message: `message --value must not exceed 2000 characters (got ${value.length}) per §3.4`,
        };
      }
      return null;

    case 'blocker': {
      // §4.3 — value MUST be OPEN, RESOLVED, or WAITING_ON_<agent>.
      if (value === 'OPEN' || value === 'RESOLVED') return null;
      const m = /^WAITING_ON_(.+)$/.exec(value);
      if (m !== null && isValidAgentName(m[1])) return null;
      return {
        code: 'CLI_ROOM_INVALID_BLOCKER_VALUE',
        message:
          'blocker --value must be "OPEN", "RESOLVED", or "WAITING_ON_<agent>" '
          + 'with <agent> matching /^[a-zA-Z0-9_-]{1,64}$/ per §4.3',
      };
    }

    case 'disagreement':
      // §5.1 — topic is value; 1-500 chars.
      if (value.length > 500) {
        return {
          code: 'CLI_ROOM_DISAGREEMENT_TOPIC_TOO_LONG',
          message: `disagreement --value (topic) must not exceed 500 characters (got ${value.length}) per §5.1`,
        };
      }
      return null;

    case 'resolve': {
      // §5.1 — winning position, "mutual", "escalate:femi", "withdrawn", or "<agent>".
      if (value === 'mutual' || value === 'withdrawn') return null;
      const escalate = /^escalate:(.+)$/.exec(value);
      if (escalate !== null && isValidAgentName(escalate[1])) return null;
      if (isValidAgentName(value)) return null;
      return {
        code: 'CLI_ROOM_INVALID_RESOLVE_VALUE',
        message:
          'resolve --value must be "mutual", "withdrawn", "escalate:<agent>", '
          + 'or a winning participant name matching /^[a-zA-Z0-9_-]{1,64}$/ per §5.1',
      };
    }

    case 'participant': {
      // §2.3 descriptive role enum.
      const validRoles = ['founder', 'member', 'observer', 'removed', 'archived'];
      if (validRoles.includes(value)) return null;
      return {
        code: 'CLI_ROOM_INVALID_PARTICIPANT_ROLE',
        message: `participant --value (role) must be one of: ${validRoles.join(', ')} per §2.3`,
      };
    }

    case 'mode': {
      // §6.1 — one of open | directed | debate | verify.
      const validModes = ['open', 'directed', 'debate', 'verify'];
      if (validModes.includes(value)) return null;
      return {
        code: 'CLI_ROOM_INVALID_MODE',
        message: `mode --value must be one of: ${validModes.join(', ')} per §6.1`,
      };
    }

    default:
      return { code: 'CLI_ROOM_INVALID_KIND', message: `unknown kind: ${kind}` };
  }
}

/**
 * v4 §4.4 blocker state projection. Returns the CURRENT state of the
 * blocker identified by `blocker_id` in this room, computed as the
 * `value` of the most-recent `room.blocker` claim with matching
 * `reasoning.blocker_id`. Returns `null` if no such claim exists
 * (blocker is new), or on transient recall failure (caller should
 * treat as pass-through per §8.5 truthful-boundary).
 */
function projectBlockerState(
  limen: LimenCompat,
  subject: string,
  blockerId: string,
): string | null {
  const res = fetchRoomClaims(limen, subject, 'room.blocker');
  if (!res.ok || !res.value) return null;
  let latest: { validAt: string; claimId: string; value: string } | null = null;
  for (const b of res.value) {
    const meta = parseRoomMetadata(b.reasoning);
    if (meta === null) continue;
    if ((meta as Record<string, unknown>).blocker_id !== blockerId) continue;
    if (latest === null || compareByValidAtThenClaimId(b, latest) > 0) {
      latest = { validAt: b.validAt, claimId: b.claimId, value: b.value };
    }
  }
  return latest ? latest.value : null;
}

/**
 * Validate top-level predicate-specific fields in the reasoning envelope
 * per LIMEN-COORD-v1.0 v4 §1.4 (F-LC3-R2-005 + F-LC3-R3-002 closures).
 * Returns null on pass, or a CliError `{code, message}` on reject.
 * Requires the caller-supplied details payload (already parsed and
 * spread at top level of reasoning). For `room.resolve`, ALSO queries
 * the store to verify the referenced `disagreement_id` points to an
 * existing disagreement in this room. For `room.blocker`, ALSO projects
 * the current blocker state and rejects illegal transitions per §4.2
 * (C-7, C-23).
 */
function validateDetailsFieldsForKind(
  kind: RoomEventKind,
  value: string,
  fields: Record<string, unknown>,
  limen?: LimenCompat,
  subject?: string,
): { code: string; message: string } | null {
  const idRegex = /^[a-zA-Z0-9_:-]{1,128}$/;

  switch (kind) {
    case 'message':
      return null;

    case 'blocker': {
      const bid = fields.blocker_id;
      if (typeof bid !== 'string' || !idRegex.test(bid)) {
        return {
          code: 'CLI_ROOM_BLOCKER_MISSING_ID',
          message: 'blocker event requires --details-json with `blocker_id` (1-128 chars: alphanumeric, _, -, :) per v4 §1.4',
        };
      }
      const reason = fields.reason;
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > 500) {
        return {
          code: 'CLI_ROOM_BLOCKER_MISSING_REASON',
          message: 'blocker event requires --details-json with `reason` (1-500 chars) per v4 §1.4',
        };
      }
      // v4 §4.2 / C-7 / C-23 (F-LC3-R3-002 closure): illegal-transition
      // rejection. Project the current state of this blocker_id by
      // reading prior `room.blocker` claims for the same blocker_id and
      // comparing against the legal-transitions table:
      //   OPEN                → OPEN | WAITING_ON_<agent> | RESOLVED
      //   WAITING_ON_<agent>  → OPEN | WAITING_ON_<agent> | RESOLVED
      //   RESOLVED            → RESOLVED (absorbing)
      if (limen && subject) {
        const priorState = projectBlockerState(limen, subject, bid);
        const incomingState = value;  // OPEN | RESOLVED | WAITING_ON_<agent>
        if (priorState === 'RESOLVED' && incomingState !== 'RESOLVED') {
          return {
            code: 'ROOM_BLOCKER_ILLEGAL_TRANSITION',
            message:
              `blocker "${bid}" is already RESOLVED; transition to "${incomingState}" is forbidden per v4 §4.2 ` +
              `(RESOLVED is absorbing — open a new blocker with a fresh blocker_id if the issue recurs).`,
          };
        }
      }
      return null;
    }

    case 'disagreement': {
      const did = fields.disagreement_id;
      if (typeof did !== 'string' || !idRegex.test(did)) {
        return {
          code: 'CLI_ROOM_DISAGREEMENT_MISSING_ID',
          message: 'disagreement event requires --details-json with `disagreement_id` (1-128 chars) per v4 §1.4',
        };
      }
      const positions = fields.positions;
      if (!Array.isArray(positions) || positions.length < 2) {
        return {
          code: 'CLI_ROOM_DISAGREEMENT_MISSING_POSITIONS',
          message: 'disagreement event requires --details-json with `positions` array (length ≥ 2) per v4 §1.4',
        };
      }
      for (const p of positions) {
        if (
          typeof p !== 'object' ||
          p === null ||
          typeof (p as Record<string, unknown>).by !== 'string' ||
          typeof (p as Record<string, unknown>).stance !== 'string'
        ) {
          return {
            code: 'CLI_ROOM_DISAGREEMENT_INVALID_POSITION',
            message: 'disagreement --details-json `positions` entries must be objects with `by` and `stance` strings per v4 §1.4',
          };
        }
      }
      return null;
    }

    case 'resolve': {
      const did = fields.disagreement_id;
      if (typeof did !== 'string' || !idRegex.test(did)) {
        return {
          code: 'CLI_ROOM_RESOLVE_MISSING_ID',
          message: 'resolve event requires --details-json with `disagreement_id` referencing an existing disagreement per v4 §1.4',
        };
      }
      const resolver = fields.resolver;
      if (typeof resolver !== 'string' || !isValidAgentName(resolver)) {
        return {
          code: 'CLI_ROOM_RESOLVE_MISSING_RESOLVER',
          message: 'resolve event requires --details-json with `resolver` (valid agent name) per v4 §1.4',
        };
      }
      const rationale = fields.rationale;
      if (typeof rationale !== 'string' || rationale.length === 0 || rationale.length > 1000) {
        return {
          code: 'CLI_ROOM_RESOLVE_MISSING_RATIONALE',
          message: 'resolve event requires --details-json with `rationale` (1-1000 chars) per v4 §1.4',
        };
      }
      const hasMerged = 'merged_position' in fields;
      if (value === 'mutual' && !hasMerged) {
        return {
          code: 'CLI_ROOM_RESOLVE_MUTUAL_REQUIRES_MERGED',
          message: 'resolve --value "mutual" requires --details-json.merged_position per v4 §1.4',
        };
      }
      if (value !== 'mutual' && hasMerged) {
        return {
          code: 'CLI_ROOM_RESOLVE_MERGED_ONLY_WITH_MUTUAL',
          message: 'resolve --details-json.merged_position is permitted ONLY when --value is "mutual" per v4 §1.4',
        };
      }
      // C-23: tool-layer semantic check — disagreement_id must refer to
      // an existing open disagreement in the same room.
      if (limen && subject) {
        const existing = fetchRoomClaims(limen, subject, 'room.disagreement');
        if (existing.ok) {
          const found = (existing.value ?? []).some((b) => {
            const meta = parseRoomMetadata(b.reasoning);
            return typeof meta?.['disagreement_id'] === 'string' &&
              meta['disagreement_id'] === did;
          });
          if (!found) {
            return {
              code: 'CLI_ROOM_RESOLVE_NO_OPEN_DISAGREEMENT',
              message: `--details-json.disagreement_id "${did}" does not match any existing disagreement in this room`,
            };
          }
        }
        // If recall failed, fall through without the existence check;
        // do not block the append on a transient store error. The
        // append will still carry the caller-supplied disagreement_id;
        // audit review will surface orphaned resolves.
      }
      return null;
    }

    case 'participant': {
      const pid = fields.participant_id;
      if (typeof pid !== 'string' || !isValidAgentName(pid)) {
        return {
          code: 'CLI_ROOM_PARTICIPANT_MISSING_ID',
          message: 'participant event requires --details-json with `participant_id` (valid agent name) per v4 §1.4',
        };
      }
      const trust = fields.trust_level;
      if (trust !== undefined) {
        const valid = ['untrusted', 'probationary', 'trusted', 'admin'];
        if (typeof trust !== 'string' || !valid.includes(trust)) {
          return {
            code: 'CLI_ROOM_PARTICIPANT_INVALID_TRUST',
            message: `participant --details-json.trust_level must be one of: ${valid.join(', ')} per v4 §1.4`,
          };
        }
      }
      return null;
    }

    case 'mode':
      return null;
  }
}

/**
 * LIMEN-COORD-v1.0 v4 §8.5 / C-12 (F-LC3-R2-006 closure) — coarse
 * best-effort rate limit on CLI `room record` appends.
 *
 * Key: `(transport='cli', sender)` per v4. Window: 60 seconds rolling.
 * Ceiling: 60 appends/minute (v1.0 recommendation).
 *
 * Implementation: store-backed. Before each append, query the most
 * recent `room.*` claims for the SAME ROOM and count those authored by
 * `(cli, sender)` within the window. The store is naturally
 * cross-process and persistent, so the counter is shared across
 * invocations of the CLI binary. Accuracy scales with the 200-claim
 * recall ceiling — faithful to the "coarse best-effort" §8.5 language.
 *
 * Returns `null` on pass, `{code, message}` on rate-limit rejection.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CEILING = 60;

function checkRateLimit(
  limen: LimenCompat,
  subject: string,
  sender: string,
  nowMs: number = Date.now(),
): { code: string; message: string } | null {
  const res = limen.recall(subject, 'room.*', { limit: ENGINE_CLAIM_QUERY_MAX_LIMIT });
  if (!res.ok || !res.value) return null;  // Transient store error: pass through; audit review.
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  let count = 0;
  for (const b of res.value) {
    const meta = parseRoomMetadata(b.reasoning);
    if (meta === null) continue;
    if (meta.sender !== sender) continue;
    if (meta.transport !== 'cli') continue;
    const tsStr = typeof meta.timestamp === 'string' ? meta.timestamp : b.validAt;
    const ts = Date.parse(tsStr);
    if (!Number.isFinite(ts)) continue;
    if (ts < cutoff) continue;
    count += 1;
    if (count >= RATE_LIMIT_CEILING) {
      return {
        code: 'CLI_ROOM_RATE_LIMIT_EXCEEDED',
        message:
          `rate limit: sender "${sender}" over cli transport has posted ≥ ${RATE_LIMIT_CEILING} ` +
          `room.* claims to this room in the last 60 seconds (v4 §8.5 coarse best-effort). ` +
          `Truthful boundary: rotating sender strings bypasses; see §8.5.`,
      };
    }
  }
  return null;
}

/**
 * F-LC3-001 + v4 §3.3 (F-LC1-R3-001 closure) — best-effort idempotency.
 * Query recent `room.<kind>` claims for the room and return the claimId
 * of any existing claim whose reasoning envelope carries the same
 * `source_id`. Matches LIMEN-COORD-v1.0 v4 universal-across-kinds scope;
 * dedup window is `(subject, same predicate)`.
 *
 * Reader tolerates both the v4 snake_case `source_id` (canonical) and
 * the v1-v3 camelCase `sourceId` (legacy in-store claims) so a CLI
 * upgrade doesn't orphan idempotency for claims written before v4.
 * Writers emit only the snake_case form per §1.4/C-20.
 */
function findExistingBySourceId(
  limen: LimenCompat,
  subject: string,
  predicate: string,
  sourceId: string,
): string | null {
  const res = limen.recall(subject, predicate, { limit: ENGINE_CLAIM_QUERY_MAX_LIMIT });
  if (!res.ok || !res.value) return null;
  for (const belief of res.value) {
    const meta = parseRoomMetadata(belief.reasoning);
    if (meta === null) continue;
    const stored = meta.source_id ?? (meta as Record<string, unknown>).sourceId;
    if (stored === sourceId) return belief.claimId;
  }
  return null;
}

function createRecordCommand(): Command {
  return new Command('record')
    .description('Append a room.* event (LIMEN-COORD-v1.0 §1.3)')
    .argument('<room-id>', 'Room id (matches /^[a-zA-Z0-9_-]{1,64}$/; colons rejected per v2)')
    .requiredOption('--kind <kind>', 'Event kind: message | blocker | disagreement | resolve | participant | mode')
    .requiredOption('--value <text>', 'Primary value (kind-specific validation per LIMEN-COORD-v1.0)')
    .option('--as <sender>', 'Override sender name (default: $USER)')
    .option('--details-json <json>', 'Optional structured payload (merged into reasoning metadata)')
    .option('--source-id <id>', 'Caller-supplied idempotency key (best-effort per §3.3)')
    .action(async (
      roomId: string,
      options: {
        kind: string;
        value: string;
        as?: string;
        detailsJson?: string;
        sourceId?: string;
      },
      command: Command,
    ) => {
      try {
        const globals = command.optsWithGlobals<{ dataDir?: string; masterKey?: string }>();

        const normalized = normalizeRoomId(roomId);
        if (normalized === null) {
          writeError(new CliError(
            'CLI_ROOM_INVALID_ID',
            'Room id must match ^[a-zA-Z0-9_-]{1,64}$ (colons rejected per v2 §1.2)',
          ));
          process.exitCode = 1;
          return;
        }
        const subject = roomSubject(roomId)!;

        const validKinds: readonly RoomEventKind[] = [
          'message', 'blocker', 'disagreement', 'resolve', 'participant', 'mode',
        ];
        if (!validKinds.includes(options.kind as RoomEventKind)) {
          writeError(new CliError(
            'CLI_ROOM_INVALID_KIND',
            `--kind must be one of: ${validKinds.join(', ')}`,
          ));
          process.exitCode = 1;
          return;
        }
        const kind = options.kind as RoomEventKind;

        // F-LC3-002: per-kind value validation at the CLI tool layer.
        const kindErr = validateValueForKind(kind, options.value);
        if (kindErr !== null) {
          writeError(new CliError(kindErr.code, kindErr.message));
          process.exitCode = 1;
          return;
        }

        const sender = options.as ?? defaultSender();
        if (!isValidAgentName(sender)) {
          writeError(new CliError('CLI_ROOM_INVALID_SENDER', 'Invalid sender name'));
          process.exitCode = 1;
          return;
        }

        // LIMEN-COORD-v1.0 v4 §1.4 / C-21 (F-LC3-R2-004 closure):
        // predicate-specific fields MUST live at the top level of the
        // reasoning envelope, not nested under `details`. Parse the
        // caller-supplied JSON and spread its keys at top level.
        let detailsFields: Record<string, unknown> = {};
        if (options.detailsJson !== undefined) {
          try {
            const parsed = JSON.parse(options.detailsJson);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              writeError(new CliError(
                'CLI_ROOM_INVALID_DETAILS_JSON',
                '--details-json must be a JSON object (its keys are spread into the reasoning envelope at top level per v4 §1.4/C-21)',
              ));
              process.exitCode = 1;
              return;
            }
            detailsFields = parsed as Record<string, unknown>;
          } catch {
            writeError(new CliError('CLI_ROOM_INVALID_DETAILS_JSON', '--details-json must be valid JSON'));
            process.exitCode = 1;
            return;
          }
        }

        // v4 C-20 (F-LC3-R2-004 closure): source_id is MANDATORY on every
        // append of every kind. Generate one if the caller didn't supply it.
        const effectiveSourceId = options.sourceId ?? randomUUID();

        // v4 C-23 drop: client-supplied `transport` in detailsFields must
        // be discarded; server overwrites authoritatively.
        if ('transport' in detailsFields) {
          delete detailsFields.transport;
        }
        // Same for common envelope keys — caller cannot override these.
        for (const reservedKey of ['schema_version', 'sender', 'timestamp', 'source_id']) {
          if (reservedKey in detailsFields) delete detailsFields[reservedKey];
        }

        const predicate = roomPredicate(kind);

        // v4 §1.4 envelope: snake_case keys; schema_version mandatory;
        // predicate-specific fields (from --details-json) merged at top
        // level; server-injected `transport: cli` last (cannot be
        // overridden by detailsFields since we scrubbed it).
        const reasoningObj: Record<string, unknown> = {
          schema_version: 'coord-v1.0',
          sender,
          timestamp: new Date().toISOString(),
          source_id: effectiveSourceId,
          room: roomId,
          normalized_room_id: normalized,
          kind,
          ...detailsFields,
          transport: 'cli',
        };
        const reasoning = JSON.stringify(reasoningObj);

        const result = await withEngine(
          async (limen): Promise<{ recorded: true; deduped?: true; claimId: string; predicate: string; normalizedRoomId: string }> => {
            const lc = limen as unknown as LimenCompat;

            // v4 §1.4 / C-23 (F-LC3-R2-005 closure): per-kind semantic
            // enforcement at the tool layer. For `room.resolve` this
            // includes querying the store to verify the referenced
            // `disagreement_id` exists.
            const detailsErr = validateDetailsFieldsForKind(
              kind,
              options.value,
              detailsFields,
              lc,
              subject,
            );
            if (detailsErr !== null) {
              throw new CliError(detailsErr.code, detailsErr.message);
            }

            // v4 §8.5 / C-12 (F-LC3-R2-006 closure): coarse best-effort
            // rate limit, key = (transport='cli', sender), window = 60s,
            // ceiling = 60 appends. Store-backed counter.
            const rateLimitErr = checkRateLimit(lc, subject, sender);
            if (rateLimitErr !== null) {
              throw new CliError(rateLimitErr.code, rateLimitErr.message);
            }

            // v4 §3.3 (F-LC1-R3-001 closure): source_id is universal
            // across kinds. Dedup query scoped to (subject, same predicate).
            // Truthful boundary: single-writer only; concurrent writers may
            // produce duplicates (§3.3 TOCTOU).
            {
              const existingId = findExistingBySourceId(lc, subject, predicate, effectiveSourceId);
              if (existingId !== null) {
                return {
                  recorded: true,
                  deduped: true,
                  claimId: existingId,
                  predicate,
                  normalizedRoomId: normalized,
                };
              }
            }

            const res = lc.remember(subject, predicate, options.value, { confidence: 1.0, reasoning });
            if (!res.ok) {
              throw new CliError(
                res.error?.code ?? 'CLI_ROOM_RECORD_FAILED',
                res.error?.message ?? 'Failed to record room event',
              );
            }
            return {
              recorded: true,
              claimId: res.value!.claimId,
              predicate,
              normalizedRoomId: normalized,
            };
          },
          { dataDir: globals.dataDir, masterKeyPath: globals.masterKey },
        );

        writeResult(result);
      } catch (err) {
        // LIMEN-COORD-v1.0 v4 error-propagation fix: `writeError` already
        // recovers the code from CliError OR any Error with a string
        // `code` property. Using it directly preserves the thrown code
        // even when an `instanceof CliError` check fails at module
        // boundaries (e.g. errors thrown inside `withEngine`). Previously
        // the instanceof fallthrough rewrapped every structured error
        // into `CLI_UNEXPECTED`, hiding the real code.
        writeError(err);
        process.exitCode = 1;
      }
    });
}

function createReadCommand(): Command {
  return new Command('read')
    .description('Read room.* events chronologically')
    .argument('<room-id>', 'Human-facing room id')
    .option('--kind <kind>', 'Filter to one kind (message | blocker | disagreement | resolve | participant | mode)')
    .option('--limit <n>', 'Max claims to return (1-1000, default 100)', (v) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 1000) {
        throw new Error('--limit must be an integer in [1, 1000]');
      }
      return n;
    })
    .action(async (
      roomId: string,
      options: { kind?: string; limit?: number },
      command: Command,
    ) => {
      try {
        const globals = command.optsWithGlobals<{ dataDir?: string; masterKey?: string }>();

        const normalized = normalizeRoomId(roomId);
        if (normalized === null) {
          writeError(new CliError('CLI_ROOM_INVALID_ID', 'Invalid room id'));
          process.exitCode = 1;
          return;
        }
        const subject = roomSubject(roomId)!;

        let predicate = 'room.*';
        if (options.kind !== undefined) {
          const validKinds: readonly RoomEventKind[] = [
            'message', 'blocker', 'disagreement', 'resolve', 'participant', 'mode',
          ];
          if (!validKinds.includes(options.kind as RoomEventKind)) {
            writeError(new CliError(
              'CLI_ROOM_INVALID_KIND',
              `--kind must be one of: ${validKinds.join(', ')}`,
            ));
            process.exitCode = 1;
            return;
          }
          predicate = roomPredicate(options.kind as RoomEventKind);
        }

        const limit = options.limit ?? 100;

        const result = await withEngine(
          async (limen): Promise<{ room: string; normalizedRoomId: string; count: number; events: RenderRecord[] }> => {
            const lc = limen as unknown as LimenCompat;
            const res = fetchRoomClaims(lc, subject, predicate, { limit });
            if (!res.ok) {
              throw new CliError(
                res.error.code,
                res.error.message,
              );
            }
            const events = (res.value ?? [])
              .map(toRenderRecord)
              .sort(compareByValidAtThenClaimId);
            return {
              room: roomId,
              normalizedRoomId: normalized,
              count: events.length,
              events,
            };
          },
          { dataDir: globals.dataDir, masterKeyPath: globals.masterKey },
        );

        writeResult(result);
      } catch (err) {
        // LIMEN-COORD-v1.0 v4 error-propagation fix: `writeError` already
        // recovers the code from CliError OR any Error with a string
        // `code` property. Using it directly preserves the thrown code
        // even when an `instanceof CliError` check fails at module
        // boundaries (e.g. errors thrown inside `withEngine`). Previously
        // the instanceof fallthrough rewrapped every structured error
        // into `CLI_UNEXPECTED`, hiding the real code.
        writeError(err);
        process.exitCode = 1;
      }
    });
}

export function createRoomCommand(): Command {
  const cmd = new Command('room').description('Coordination rooms (LIMEN-COORD-v1.0)');
  cmd.addCommand(createJoinCommand());
  cmd.addCommand(createRecordCommand());
  cmd.addCommand(createReadCommand());
  return cmd;
}

// Test-only exports for direct unit testing.
export const __TEST_ONLY__ = Object.freeze({
  defaultSender,
  toRenderRecord,
  compareByValidAtThenClaimId,
  fetchRoomClaims,
  formatRender,
  validateValueForKind,
  validateDetailsFieldsForKind,
  findExistingBySourceId,
  checkRateLimit,
  projectBlockerState,
  publishMessage,
  ENGINE_CLAIM_QUERY_MAX_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_CEILING,
});
