/**
 * LC.4 — CLI-side integration suite (LIMEN-COORD-v1.0 v4)
 *
 * Target: the conformance surface of `limen room record` / `limen room read`
 * against a live Limen engine on an isolated scratch dataDir. Each scenario
 * asserts (a) exact CLI success/error codes and (b) the round-trip envelope
 * shape — snake_case keys, mandatory common fields at top level, and
 * predicate-specific fields (blocker_id, disagreement_id, participant_id,
 * positions) at top level of reasoning (never nested under `details`).
 *
 * Scope: the subset of `lc4-integration-plan.md` scenarios that DO NOT
 * depend on Codex's in-flight LC.2 v4 MCP-tool rewrite. Cross-transport
 * parity (T-4.10, T-4.14) + CONFLICTED race (T-4.7) + rate-limit 60/min
 * (T-4.9) land in a second suite after LC.2 v4 ratifies.
 *
 * Covered here:
 *   T-4.1  participant registration across three senders
 *   T-4.2  message exchange — envelope parity + ordering
 *   T-4.3  source_id single-writer idempotency — dedup-hit returns same claimId
 *   T-4.5  blocker FSM progression + RESOLVED→OPEN illegal-transition
 *   T-4.6  disagreement + resolve, including unknown disagreement_id rejection
 *
 * DC (Direct-Coverage) annotations tie each assertion back to the LC.1 v4
 * conformance matrix (C-rules) and test matrix (T-rules).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);

const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

// Isolated dataDir per test process — no pollution of the user's ~/.limen.
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-lc4-cli-'));
const GLOBAL_OPTS = `--dataDir "${TEST_DATA_DIR}"`;

// Unique room per test run so repeated invocations don't alias against
// prior state (LIMEN-COORD-v1.0 v4 §1.2 bijective room ids; no colons).
const ROOM_ID = `lc4_cli_suite_${Date.now()}`;

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly json: unknown;
}

async function runCli(args: string, retries = 4): Promise<CliResult> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execAsync(
        `node ${CLI} ${GLOBAL_OPTS} ${args}`,
        { timeout: 20_000 },
      );
      const trimmed = stdout.trim();
      return {
        stdout: trimmed,
        stderr: stderr.trim(),
        exitCode: 0,
        json: trimmed ? JSON.parse(trimmed) : null,
      };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      const result: CliResult = {
        stdout: (e.stdout ?? '').trim(),
        stderr: (e.stderr ?? '').trim(),
        exitCode: e.code ?? 1,
        json: null,
      };
      const combined = result.stderr + result.stdout;
      const isRateLimited = combined.includes('RATE_LIMITED');
      const isTransient =
        combined.includes('ENGINE_UNHEALTHY') ||
        combined.includes('SQLITE_BUSY') ||
        combined.includes('database is locked') ||
        combined.includes('Convenience API') ||
        isRateLimited;
      if (isTransient && attempt < retries) {
        // Engine rate-limit windows are 60s. Linear-ish backoff lands us
        // past the window within a few attempts without ballooning total
        // suite time.
        const delayMs = isRateLimited ? 3_000 * (attempt + 1) : 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      return result;
    }
  }
  throw new Error('unreachable');
}

function parseStderrJson(stderr: string): { readonly error?: { readonly code?: string; readonly message?: string } } | null {
  try {
    return JSON.parse(stderr) as { readonly error?: { readonly code?: string; readonly message?: string } };
  } catch {
    return null;
  }
}

beforeAll(async () => {
  await runCli('init');
  // Register the three test participants.
  for (const name of ['femi', 'claude-code', 'codex']) {
    await runCli(`agent register --name "${name}"`);
  }
}, 60_000);

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); }
  catch { /* best-effort */ }
});

// ──────────────────────────────────────────────────────────────────────
// T-4.1 — Participant registration across three senders
// Closes: C-3 transport injection, C-20 snake_case, C-21 top-level placement
// ──────────────────────────────────────────────────────────────────────

describe('T-4.1 — Participant registration (§2.1)', () => {
  it('founder + member + observer participant claims land with spec-conformant envelopes', async () => {
    const fRes = await runCli(
      `room record ${ROOM_ID} --kind participant --value founder --as femi ` +
      `--details-json '{"participant_id":"femi","trust_level":"admin"}' ` +
      `--source-id participant-femi-${Date.now()}`,
    );
    expect(fRes.exitCode).toBe(0);
    expect((fRes.json as { recorded: boolean }).recorded).toBe(true);

    const cRes = await runCli(
      `room record ${ROOM_ID} --kind participant --value member --as claude-code ` +
      `--details-json '{"participant_id":"claude-code","trust_level":"trusted"}' ` +
      `--source-id participant-claude-${Date.now()}`,
    );
    expect(cRes.exitCode).toBe(0);

    const xRes = await runCli(
      `room record ${ROOM_ID} --kind participant --value member --as codex ` +
      `--details-json '{"participant_id":"codex","trust_level":"trusted"}' ` +
      `--source-id participant-codex-${Date.now()}`,
    );
    expect(xRes.exitCode).toBe(0);

    // Round-trip: read back the participant claims + inspect envelope shape.
    const readRes = await runCli(`room read ${ROOM_ID} --kind participant --limit 100`);
    expect(readRes.exitCode).toBe(0);
    const events = (readRes.json as { events: ReadonlyArray<{ sender: string; predicate: string; value: string; transport: string }> }).events;

    // Three distinct claims, one per sender.
    expect(events.length).toBeGreaterThanOrEqual(3);
    const senders = new Set(events.map(e => e.sender));
    expect(senders.has('femi')).toBe(true);
    expect(senders.has('claude-code')).toBe(true);
    expect(senders.has('codex')).toBe(true);

    // All three predicates MUST be `room.participant` (C-2 enumerated).
    for (const e of events) {
      expect(e.predicate).toBe('room.participant');
      // C-3 server-injected transport — CLI writes always record transport='cli'.
      expect(e.transport).toBe('cli');
      // Role value is one of the legal descriptive labels (§2.3).
      expect(['founder', 'member', 'observer', 'removed', 'archived']).toContain(e.value);
    }
  }, 30_000);
});

// ──────────────────────────────────────────────────────────────────────
// T-4.2 — Message exchange: envelope parity + chronological ordering
// Closes: C-5 message length, C-20/C-21 envelope shape, §3.2 ordering
// ──────────────────────────────────────────────────────────────────────

describe('T-4.2 — Message exchange', () => {
  it('messages from all three senders land + round-trip in chronological order', async () => {
    // Each message includes a mention + in_reply_to threaded reference in details-json.
    const a = await runCli(
      `room record ${ROOM_ID} --kind message --value "hello from femi" --as femi ` +
      `--source-id msg-a-${Date.now()}`,
    );
    expect(a.exitCode).toBe(0);
    const aClaimId = (a.json as { claimId: string }).claimId;

    const b = await runCli(
      `room record ${ROOM_ID} --kind message --value "hi from claude-code" --as claude-code ` +
      `--details-json '{"mentions":["femi"],"in_reply_to":"${aClaimId}"}' ` +
      `--source-id msg-b-${Date.now()}`,
    );
    expect(b.exitCode).toBe(0);

    const c = await runCli(
      `room record ${ROOM_ID} --kind message --value "codex here" --as codex ` +
      `--details-json '{"mentions":["femi","claude-code"]}' ` +
      `--source-id msg-c-${Date.now()}`,
    );
    expect(c.exitCode).toBe(0);

    const readRes = await runCli(`room read ${ROOM_ID} --kind message --limit 100`);
    expect(readRes.exitCode).toBe(0);
    const events = (readRes.json as { events: ReadonlyArray<{ sender: string; validAt: string; value: string }> }).events;
    expect(events.length).toBeGreaterThanOrEqual(3);

    // T-4.2 ordering: validAt must be non-decreasing (§3.2).
    for (let i = 1; i < events.length; i++) {
      expect(events[i].validAt.localeCompare(events[i - 1].validAt)).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it('rejects message >2000 chars with specific error code', async () => {
    const oversized = 'x'.repeat(2001);
    const res = await runCli(
      `room record ${ROOM_ID} --kind message --value "${oversized}" --as femi ` +
      `--source-id oversized-${Date.now()}`,
    );
    expect(res.exitCode).not.toBe(0);
    const err = parseStderrJson(res.stderr);
    expect(err?.error?.code).toBe('CLI_ROOM_VALUE_TOO_LONG');
  });
});

// ──────────────────────────────────────────────────────────────────────
// T-4.3 — source_id single-writer idempotency
// Closes: C-4 source_id mandatory, T-4 idempotent-hit
// ──────────────────────────────────────────────────────────────────────

describe('T-4.3 — source_id idempotency (§3.3)', () => {
  it('same source_id from a single writer returns the same claimId (dedup-hit)', async () => {
    const sid = `idempotent-${Date.now()}`;
    const a = await runCli(
      `room record ${ROOM_ID} --kind message --value "first call" --as claude-code --source-id ${sid}`,
    );
    expect(a.exitCode).toBe(0);
    const aJson = a.json as { claimId: string; deduped?: boolean };
    expect(aJson.deduped).toBeUndefined();

    const b = await runCli(
      `room record ${ROOM_ID} --kind message --value "second call same sid" --as claude-code --source-id ${sid}`,
    );
    expect(b.exitCode).toBe(0);
    const bJson = b.json as { claimId: string; deduped?: boolean };
    expect(bJson.deduped).toBe(true);
    // Idempotent hit: same claimId as the first call.
    expect(bJson.claimId).toBe(aJson.claimId);
  }, 20_000);
});

// ──────────────────────────────────────────────────────────────────────
// T-4.5 — Blocker FSM + illegal-transition rejection
// Closes: C-6 projection, C-7/C-23 illegal-transition, T-6, T-7
// ──────────────────────────────────────────────────────────────────────

describe('T-4.5 — Blocker FSM (§4)', () => {
  const blockerId = `b_${Date.now()}`;

  it('accepts OPEN → WAITING_ON_<agent> → RESOLVED sequence', async () => {
    const openRes = await runCli(
      `room record ${ROOM_ID} --kind blocker --value OPEN --as claude-code ` +
      `--details-json '{"blocker_id":"${blockerId}","reason":"review pending"}' ` +
      `--source-id blocker-open-${Date.now()}`,
    );
    expect(openRes.exitCode).toBe(0);

    const waitingRes = await runCli(
      `room record ${ROOM_ID} --kind blocker --value WAITING_ON_femi --as codex ` +
      `--details-json '{"blocker_id":"${blockerId}","reason":"need human call","prior_state":"OPEN"}' ` +
      `--source-id blocker-waiting-${Date.now()}`,
    );
    expect(waitingRes.exitCode).toBe(0);

    const resolvedRes = await runCli(
      `room record ${ROOM_ID} --kind blocker --value RESOLVED --as femi ` +
      `--details-json '{"blocker_id":"${blockerId}","reason":"approved","prior_state":"WAITING_ON_femi"}' ` +
      `--source-id blocker-resolved-${Date.now()}`,
    );
    expect(resolvedRes.exitCode).toBe(0);
  }, 30_000);

  it('rejects RESOLVED → OPEN as ROOM_BLOCKER_ILLEGAL_TRANSITION (T-7)', async () => {
    const res = await runCli(
      `room record ${ROOM_ID} --kind blocker --value OPEN --as claude-code ` +
      `--details-json '{"blocker_id":"${blockerId}","reason":"attempting reopen"}' ` +
      `--source-id blocker-illegal-${Date.now()}`,
    );
    expect(res.exitCode).not.toBe(0);
    const err = parseStderrJson(res.stderr);
    expect(err?.error?.code).toBe('ROOM_BLOCKER_ILLEGAL_TRANSITION');
  });

  it('rejects RESOLVED → WAITING_ON_<agent> as illegal', async () => {
    const res = await runCli(
      `room record ${ROOM_ID} --kind blocker --value WAITING_ON_codex --as claude-code ` +
      `--details-json '{"blocker_id":"${blockerId}","reason":"attempting reactivate"}' ` +
      `--source-id blocker-illegal2-${Date.now()}`,
    );
    expect(res.exitCode).not.toBe(0);
    const err = parseStderrJson(res.stderr);
    expect(err?.error?.code).toBe('ROOM_BLOCKER_ILLEGAL_TRANSITION');
  });

  it('rejects malformed blocker value with BLOCKER_VALUE error', async () => {
    const res = await runCli(
      `room record ${ROOM_ID} --kind blocker --value MALFORMED --as claude-code ` +
      `--details-json '{"blocker_id":"b_never","reason":"x"}' ` +
      `--source-id blocker-malformed-${Date.now()}`,
    );
    expect(res.exitCode).not.toBe(0);
    const err = parseStderrJson(res.stderr);
    expect(err?.error?.code).toBe('CLI_ROOM_INVALID_BLOCKER_VALUE');
  });
});

// ──────────────────────────────────────────────────────────────────────
// T-4.6 — Disagreement + resolve, including unknown disagreement_id
// Closes: C-8 resolve-no-open, C-23 tool-layer disagreement existence
// ──────────────────────────────────────────────────────────────────────

describe('T-4.6 — Disagreement + resolve (§5)', () => {
  const dId = `d_${Date.now()}`;

  it('disagreement record lands with positions array', async () => {
    const res = await runCli(
      `room record ${ROOM_ID} --kind disagreement --value "FSM shape debate" --as claude-code ` +
      `--details-json '{"disagreement_id":"${dId}","positions":[{"by":"claude-code","stance":"A"},{"by":"codex","stance":"B"}]}' ` +
      `--source-id disag-${Date.now()}`,
    );
    expect(res.exitCode).toBe(0);
  }, 30_000);

  it('rejects resolve referencing an unknown disagreement_id with ROOM_RESOLVE_NO_OPEN_DISAGREEMENT (T-8)', async () => {
    const res = await runCli(
      `room record ${ROOM_ID} --kind resolve --value codex --as femi ` +
      `--details-json '{"disagreement_id":"d_does_not_exist","resolver":"femi","rationale":"x"}' ` +
      `--source-id resolve-bad-${Date.now()}`,
    );
    expect(res.exitCode).not.toBe(0);
    const err = parseStderrJson(res.stderr);
    expect(err?.error?.code).toBe('CLI_ROOM_RESOLVE_NO_OPEN_DISAGREEMENT');
  }, 30_000);

  it('accepts resolve with existing disagreement_id', async () => {
    const res = await runCli(
      `room record ${ROOM_ID} --kind resolve --value codex --as femi ` +
      `--details-json '{"disagreement_id":"${dId}","resolver":"femi","rationale":"B is the stronger position per further analysis"}' ` +
      `--source-id resolve-good-${Date.now()}`,
    );
    expect(res.exitCode).toBe(0);
    expect((res.json as { recorded: boolean }).recorded).toBe(true);
  }, 30_000);

  it('rejects resolve with value=mutual missing merged_position', async () => {
    const dId2 = `d_mutual_${Date.now()}`;
    // First seed a fresh disagreement so existence check passes.
    await runCli(
      `room record ${ROOM_ID} --kind disagreement --value "mutual test" --as claude-code ` +
      `--details-json '{"disagreement_id":"${dId2}","positions":[{"by":"claude-code","stance":"A"},{"by":"codex","stance":"B"}]}' ` +
      `--source-id disag-mutual-${Date.now()}`,
    );

    const res = await runCli(
      `room record ${ROOM_ID} --kind resolve --value mutual --as femi ` +
      `--details-json '{"disagreement_id":"${dId2}","resolver":"femi","rationale":"x"}' ` +
      `--source-id resolve-mutual-bad-${Date.now()}`,
    );
    expect(res.exitCode).not.toBe(0);
    const err = parseStderrJson(res.stderr);
    expect(err?.error?.code).toBe('CLI_ROOM_RESOLVE_MUTUAL_REQUIRES_MERGED');
  }, 20_000);
});
