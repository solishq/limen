import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLimen } from '../../../src/api/index.js';
import type { Limen } from '../../../src/api/index.js';
import {
  normalizeRoomId,
  roomSubject,
  roomPredicate,
  recordRoomEvent,
  readRoomEvents,
  registerRoomCoordinationTools,
} from '../src/tools/room-coordination.js';

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RegisteredTool {
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;
  enabled: boolean;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-mcp-room-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

afterEach(async () => {
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* best effort */ }
  }
  instancesToShutdown.length = 0;
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  dirsToClean.length = 0;
});

async function createTestEngine(): Promise<Limen> {
  const dir = makeTempDir();
  dirsToClean.push(dir);
  const limen = await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] });
  instancesToShutdown.push(limen);
  return limen;
}

function parseToolText(result: {
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
}): unknown {
  return JSON.parse(result.content[0].text);
}

function getRegisteredTools(server: McpServer): Record<string, RegisteredTool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (server as any)._registeredTools as Record<string, RegisteredTool>;
}

function createRoomServer(limen: Limen): McpServer {
  const server = new McpServer({ name: 'test-room', version: '0.0.0' });
  registerRoomCoordinationTools(server, limen, 'http');
  return server;
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tools = getRegisteredTools(server);
  const tool = tools[name];
  if (!tool) {
    throw new Error(`Tool "${name}" not registered. Available: ${Object.keys(tools).join(', ')}`);
  }
  return await tool.handler(args, {});
}

describe('room coordination helpers', () => {
  it('accepts bijective v2 room ids without transforming them', () => {
    assert.equal(normalizeRoomId('artemis_slice-a1-1'), 'artemis_slice-a1-1');
    assert.equal(roomSubject('artemis_slice-a1-1'), 'entity:room:artemis_slice-a1-1');
  });

  it('rejects invalid room ids', () => {
    assert.equal(normalizeRoomId('artemis:slice-a1-1'), null);
    assert.equal(normalizeRoomId('artemis/slice-a1-1'), null);
    assert.equal(normalizeRoomId('bad room'), null);
    assert.equal(roomSubject('bad room'), null);
  });

  it('maps event kinds to verified room predicates', () => {
    assert.equal(roomPredicate('message'), 'room.message');
    assert.equal(roomPredicate('participant'), 'room.participant');
    assert.equal(roomPredicate('blocker'), 'room.blocker');
    assert.equal(roomPredicate('disagreement'), 'room.disagreement');
    assert.equal(roomPredicate('resolve'), 'room.resolve');
    assert.equal(roomPredicate('mode'), 'room.mode');
  });
});

describe('room coordination record/read', () => {
  it('records a room message under room.message', async () => {
    const limen = await createTestEngine();
    const result = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'message',
        value: 'reviewing room coordination seam',
        mentions: 'claude-code',
      },
      'http',
    );

    assert.equal('isError' in result, false);
    const payload = parseToolText(result);
    assert.equal((payload as { predicate: string }).predicate, 'room.message');

    const recall = limen.recall('entity:room:artemis_slice-a1-1', 'room.message');
    assert.ok(recall.ok);
    assert.equal(recall.value.length, 1);
    assert.equal(recall.value[0].value, 'reviewing room coordination seam');
    const metadata = JSON.parse(recall.value[0].reasoning!);
    assert.equal(metadata.sender, 'codex');
    assert.equal(metadata.transport, 'http');
    assert.deepEqual(metadata.mentions, ['claude-code']);
  });

  it('records blocker metadata at top level and rejects illegal reopen after RESOLVED', async () => {
    const limen = await createTestEngine();
    const open = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'blocker',
        value: 'OPEN',
        detailsJson: JSON.stringify({
          blocker_id: 'lc2-schema',
          reason: 'Need ratified payload contract',
        }),
      },
      'stdio',
    );
    assert.equal('isError' in open, false);

    const resolved = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'femi',
        kind: 'blocker',
        value: 'RESOLVED',
        detailsJson: JSON.stringify({
          blocker_id: 'lc2-schema',
          reason: 'Approved',
          prior_state: 'OPEN',
        }),
      },
      'http',
    );
    assert.equal('isError' in resolved, false);

    const recall = limen.recall('entity:room:artemis_slice-a1-1', 'room.blocker');
    assert.ok(recall.ok);
    assert.equal(recall.value.length, 2);
    const openClaim = recall.value.find((belief) => belief.value === 'OPEN');
    assert.ok(openClaim);
    const metadata = JSON.parse(openClaim.reasoning!);
    assert.equal(metadata.schema_version, 'coord-v1.0');
    assert.equal(metadata.kind, 'blocker');
    assert.equal(metadata.blocker_id, 'lc2-schema');
    assert.equal(metadata.reason, 'Need ratified payload contract');
    assert.equal(typeof metadata.source_id, 'string');
    assert.equal(metadata.transport, 'stdio');

    const illegalReopen = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'claude-code',
        kind: 'blocker',
        value: 'OPEN',
        detailsJson: JSON.stringify({
          blocker_id: 'lc2-schema',
          reason: 'Attempting reopen',
        }),
      },
      'http',
    );
    assert.equal('isError' in illegalReopen, true);
    const illegalPayload = parseToolText(illegalReopen as {
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    }) as { error: string };
    assert.equal(illegalPayload.error, 'ROOM_BLOCKER_ILLEGAL_TRANSITION');
  });

  it('reads room events in chronological order across room.* predicates', async () => {
    const limen = await createTestEngine();

    const first = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'participant',
        value: 'member',
        detailsJson: JSON.stringify({ participant_id: 'codex', trust_level: 'probationary' }),
      },
      'http',
    );
    assert.equal('isError' in first, false);

    const second = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'claude-code',
        kind: 'message',
        value: 'protocol draft inbound',
      },
      'stdio',
    );
    assert.equal('isError' in second, false);

    const third = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'disagreement',
        value: 'predicate namespace',
        detailsJson: JSON.stringify({
          disagreement_id: 'd-room-read',
          positions: [
            { by: 'claude-code', stance: 'coordination.*' },
            { by: 'codex', stance: 'room.*' },
          ],
        }),
      },
      'http',
    );
    assert.equal('isError' in third, false);

    const read = readRoomEvents(limen, { room: 'artemis_slice-a1-1' });
    assert.equal('isError' in read, false);
    const payload = parseToolText(read) as {
      count: number;
      events: Array<{ kind: string; sender: string; participant_id?: string; disagreement_id?: string; disagreement_state?: string }>;
    };
    assert.equal(payload.count, 3);
    assert.deepEqual(
      payload.events.map((event) => event.kind),
      ['participant', 'message', 'disagreement'],
    );
    assert.equal(payload.events[0].participant_id, 'codex');
    assert.equal(payload.events[2].disagreement_id, 'd-room-read');
    assert.equal(payload.events[2].disagreement_state, 'OPEN');
  });

  it('records resolve and mode events under the ratified v4 contract', async () => {
    const limen = await createTestEngine();

    const disagreement = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'claude-code',
        kind: 'disagreement',
        value: 'FSM shape',
        detailsJson: JSON.stringify({
          disagreement_id: 'd-resolve-1',
          positions: [
            { by: 'claude-code', stance: 'A' },
            { by: 'codex', stance: 'B' },
          ],
        }),
      },
      'stdio',
    );
    assert.equal('isError' in disagreement, false);

    const resolve = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'femi',
        kind: 'resolve',
        value: 'mutual',
        detailsJson: JSON.stringify({
          disagreement_id: 'd-resolve-1',
          resolver: 'femi',
          rationale: 'Merged the strongest parts of both positions',
          merged_position: 'A+B',
        }),
      },
      'http',
    );
    assert.equal('isError' in resolve, false);

    const mode = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'femi',
        kind: 'mode',
        value: 'debate',
      },
      'http',
    );
    assert.equal('isError' in mode, false);

    const readResolve = readRoomEvents(limen, { room: 'artemis_slice-a1-1', kind: 'resolve' });
    assert.equal('isError' in readResolve, false);
    const resolvePayload = parseToolText(readResolve) as {
      count: number;
      events: Array<{ value: string; disagreement_id?: string; disagreement_state?: string; merged_position?: string }>;
    };
    assert.equal(resolvePayload.count, 1);
    assert.equal(resolvePayload.events[0].value, 'mutual');
    assert.equal(resolvePayload.events[0].disagreement_id, 'd-resolve-1');
    assert.equal(resolvePayload.events[0].disagreement_state, 'RESOLVED_mutual');
    assert.equal(resolvePayload.events[0].merged_position, 'A+B');

    const readMode = readRoomEvents(limen, { room: 'artemis_slice-a1-1', kind: 'mode' });
    assert.equal('isError' in readMode, false);
    const modePayload = parseToolText(readMode) as {
      count: number;
      events: Array<{ value: string }>;
    };
    assert.equal(modePayload.count, 1);
    assert.equal(modePayload.events[0].value, 'debate');
  });

  it('best-effort de-duplicates matching source ids within subject + predicate history', async () => {
    const limen = await createTestEngine();

    const first = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'message',
        value: 'same logical event',
        sourceId: 'source-001',
      },
      'http',
    );
    assert.equal('isError' in first, false);
    const firstPayload = parseToolText(first) as { claimId: string };

    const second = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'message',
        value: 'same logical event but retried',
        sourceId: 'source-001',
      },
      'http',
    );
    assert.equal('isError' in second, false);
    const secondPayload = parseToolText(second) as { claimId: string; deduped: boolean };

    assert.equal(secondPayload.deduped, true);
    assert.equal(secondPayload.claimId, firstPayload.claimId);

    const recall = limen.recall('entity:room:artemis_slice-a1-1', 'room.message');
    assert.ok(recall.ok);
    assert.equal(recall.value.length, 1);
  });

  it('rejects malformed room ids at the tool boundary', async () => {
    const limen = await createTestEngine();
    const colonResult = recordRoomEvent(
      limen,
      {
        room: 'artemis:slice-a1-1',
        sender: 'codex',
        kind: 'message',
        value: 'v1-style room id should now fail',
      },
      'http',
    );

    assert.equal('isError' in colonResult, true);
    const colonPayload = parseToolText(colonResult as {
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    }) as { error: string };
    assert.equal(colonPayload.error, 'ROOM_INVALID_ID');

    const slashResult = recordRoomEvent(
      limen,
      {
        room: 'artemis/slice-a1-1',
        sender: 'codex',
        kind: 'message',
        value: 'bad room id',
      },
      'http',
    );

    assert.equal('isError' in slashResult, true);
    const slashPayload = parseToolText(slashResult as {
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    }) as { error: string };
    assert.equal(slashPayload.error, 'ROOM_INVALID_ID');
  });

  it('rejects malformed detailsJson at the tool boundary', async () => {
    const limen = await createTestEngine();
    const result = recordRoomEvent(
      limen,
      {
        room: 'artemis_slice-a1-1',
        sender: 'codex',
        kind: 'blocker',
        value: 'OPEN',
        detailsJson: '{"unterminated"',
      },
      'http',
    );

    assert.equal('isError' in result, true);
    const payload = parseToolText(result as {
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    }) as { error: string };
    assert.equal(payload.error, 'ROOM_INVALID_DETAILS_JSON');
  });
});

describe('room coordination MCP handlers', () => {
  it('registers limen_room_record and limen_room_read', async () => {
    const limen = await createTestEngine();
    const server = createRoomServer(limen);
    const tools = getRegisteredTools(server);

    assert.ok(tools['limen_room_record']);
    assert.ok(tools['limen_room_read']);
    assert.equal(tools['limen_room_record'].enabled, true);
    assert.equal(tools['limen_room_read'].enabled, true);
  });

  it('records and reads events through actual MCP handlers', async () => {
    const limen = await createTestEngine();
    const server = createRoomServer(limen);

    const recordResult = await callTool(server, 'limen_room_record', {
      room: 'artemis_slice-a1-1',
      sender: 'codex',
      kind: 'message',
      value: 'mcp handler roundtrip',
      sourceId: 'handler-001',
    });
    assert.equal(recordResult.isError, undefined);
    const recordPayload = parseToolText(recordResult as {
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    }) as { predicate: string; deduped: boolean };
    assert.equal(recordPayload.predicate, 'room.message');
    assert.equal(recordPayload.deduped, false);

    const readResult = await callTool(server, 'limen_room_read', {
      room: 'artemis_slice-a1-1',
    });
    assert.equal(readResult.isError, undefined);
    const readPayload = parseToolText(readResult as {
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    }) as {
      count: number;
      events: Array<{ value: string; sender: string; predicate: string }>;
    };
    assert.equal(readPayload.count, 1);
    assert.equal(readPayload.events[0].value, 'mcp handler roundtrip');
    assert.equal(readPayload.events[0].sender, 'codex');
    assert.equal(readPayload.events[0].predicate, 'room.message');
  });
});
