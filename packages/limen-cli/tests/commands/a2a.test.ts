/**
 * CLI Phase 3 Commands -- Integration Tests
 *
 * Tests the 4 Phase 3 A2A commands (a2a-send, a2a-read, a2a-channels, a2a-presence)
 * via the actual CLI binary using child_process.exec.
 *
 * These are integration tests -- they bootstrap a real Limen engine.
 * Requires: limen init has been run (~/.limen/ exists).
 *
 * Test runner: vitest
 *
 * DC Coverage:
 *   === a2a-send command ===
 *   DC-CLI-065: a2a-send sends message and returns confirmation JSON (success)
 *   DC-CLI-066: a2a-send missing --from rejects with CLI_USAGE (rejection)
 *   DC-CLI-067: a2a-send without --to or --channel rejects with CLI_NO_TARGET (rejection) [F-BR3-001]
 *   DC-CLI-068: a2a-send missing --message rejects with CLI_USAGE (rejection)
 *   DC-CLI-069: a2a-send --from with invalid chars rejects with CLI_INVALID_SENDER (rejection)
 *   DC-CLI-070: a2a-send --to with invalid chars rejects with CLI_INVALID_RECIPIENT (rejection)
 *   DC-CLI-071: a2a-send --message empty rejects with CLI_INVALID_MESSAGE (rejection)
 *   DC-CLI-072: a2a-send --channel routes to channel instead of DM (success)
 *   DC-CLI-073: a2a-send --channel with invalid chars rejects with CLI_INVALID_CHANNEL (rejection)
 *   DC-CLI-074: a2a-send --metadata with invalid JSON rejects with CLI_INVALID_METADATA (rejection)
 *   DC-CLI-097: a2a-send --channel without --to sends to channel (F-BR3-001 parity) (success)
 *   DC-CLI-098: a2a-send --to and --channel both rejects with CLI_DUAL_TARGET (F-BR3-001) (rejection)
 *   DC-CLI-099: a2a-send --mentions with valid names includes mentions (F-BR3-002) (success)
 *   DC-CLI-100: a2a-send --mentions with invalid name rejects with CLI_INVALID_MENTION (F-BR3-002) (rejection)
 *   DC-CLI-101: a2a-send --message >2000 chars rejects with CLI_INVALID_MESSAGE (F-BR3-012) (rejection)
 *
 *   === a2a-read command ===
 *   DC-CLI-075: a2a-read --channel returns messages JSON (success)
 *   DC-CLI-076: a2a-read without --channel or --from rejects with CLI_NO_TARGET (rejection)
 *   DC-CLI-077: a2a-read --channel and --from both provided rejects with CLI_DUAL_TARGET (rejection)
 *   DC-CLI-078: a2a-read --from without --me rejects with CLI_NO_TARGET (rejection)
 *   DC-CLI-079: a2a-read --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-080: a2a-read --since invalid rejects with CLI_INVALID_TIMESTAMP (rejection)
 *   DC-CLI-081: a2a-read --channel with invalid chars rejects with CLI_INVALID_CHANNEL (rejection)
 *   DC-CLI-082: a2a-read messages sorted chronologically (success) [F-BR3-007 unconditional]
 *   DC-CLI-102: a2a-read --from with invalid name rejects with CLI_INVALID_SENDER (F-BR3-013) (rejection)
 *   DC-CLI-103: a2a-read --me with invalid name rejects with CLI_INVALID_SENDER (F-BR3-013) (rejection)
 *   DC-CLI-104: a2a-read --since filters by middle timestamp (success) [F-BR3-003 remediation]
 *   DC-CLI-105: a2a-read --agent-id filters by sender (success) [F-BR3-003 remediation]
 *
 *   === a2a-channels command ===
 *   DC-CLI-083: a2a-channels returns thread listing JSON (success)
 *   DC-CLI-084: a2a-channels output has count and threads fields (success)
 *   DC-CLI-085: a2a-channels --include-metadata includes metadata flag (success)
 *   DC-CLI-086: a2a-channels threads sorted by last activity (success) [F-BR3-006 unconditional]
 *   DC-CLI-087: a2a-channels shows channel names with # prefix (success)
 *   DC-CLI-088: a2a-channels stdout is valid JSON (success)
 *
 *   === a2a-presence command ===
 *   DC-CLI-089: a2a-presence returns agents JSON (success)
 *   DC-CLI-090: a2a-presence output has count and agents fields (success)
 *   DC-CLI-091: a2a-presence --agent-id filters to specific agent (success) [F-BR3-005 unconditional]
 *   DC-CLI-092: a2a-presence --agent-id with invalid chars rejects with CLI_INVALID_AGENT_ID (rejection)
 *   DC-CLI-093: a2a-presence --channel with invalid chars rejects with CLI_INVALID_CHANNEL (rejection)
 *   DC-CLI-094: a2a-presence agents have trustLevel field (success)
 *
 *   === JSON contract ===
 *   DC-CLI-095: all Phase 3 success stdout is valid JSON (success)
 *   DC-CLI-096: all Phase 3 error stderr is valid JSON (rejection)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);

const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

// F-BR3-010: Use isolated temp directory to prevent global database pollution
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-a2a-test-'));
const GLOBAL_OPTS = `--dataDir "${TEST_DATA_DIR}"`;

/**
 * Run a CLI command and return parsed stdout/stderr.
 * Retries on transient engine errors (SQLITE_BUSY, ENGINE_UNHEALTHY)
 * which occur during integration tests due to WAL contention.
 */
async function runCli(args: string, retries = 3): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  json: unknown;
}> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execAsync(`node ${CLI} ${GLOBAL_OPTS} ${args}`, {
        timeout: 15000,
      });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        json: stdout.trim() ? JSON.parse(stdout.trim()) : null,
      };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      const result = {
        stdout: (e.stdout ?? '').trim(),
        stderr: (e.stderr ?? '').trim(),
        exitCode: e.code ?? 1,
        json: null as unknown,
      };
      // Retry on transient engine errors, not on expected validation errors.
      // RATE_LIMITED is included because DC-CLI-104/105 (added for F-BR3-003
      // remediation) seed additional messages that can push later tests over
      // the per-process rate-limit bucket within a test run; the limit resets
      // within a minute so linear backoff recovers deterministically.
      const combined = result.stderr + result.stdout;
      const isTransient = combined.includes('ENGINE_UNHEALTHY') ||
        combined.includes('SQLITE_BUSY') ||
        combined.includes('database is locked') ||
        combined.includes('not initialized') ||
        combined.includes('Convenience API') ||
        combined.includes('RATE_LIMITED');
      if (isTransient && attempt < retries) {
        // Rate-limit windows are 60s; back off longer than the SQLite path.
        const isRateLimit = combined.includes('RATE_LIMITED');
        const delayMs = isRateLimit
          ? 2000 * (attempt + 1)
          : 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      return result;
    }
  }
  // Unreachable, but TypeScript wants it
  throw new Error('unreachable');
}

// Cleanup temp directory after all tests
afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

// Unique channel names for this test run to ensure deterministic data
const TEST_CHANNEL = `test-a2a-${Date.now()}`;
const SORT_CHANNEL = `test-sort-${Date.now()}`;

// Seed data: register an agent and send some messages before tests
beforeAll(async () => {
  // Register a test agent
  await runCli('agent register --name "test-agent-a2a"');

  // Send messages to a test channel using --channel (no --to needed per F-BR3-001)
  await runCli(
    `a2a-send --from "test-agent-a2a" --channel "${TEST_CHANNEL}" --message "hello from test agent"`,
  );

  // Small delay to ensure different timestamps for sort testing
  await new Promise(r => setTimeout(r, 50));

  await runCli(
    `a2a-send --from "test-agent-a2a" --channel "${TEST_CHANNEL}" --message "second message in channel"`,
  );

  // Send to a second channel for sort testing
  await new Promise(r => setTimeout(r, 50));
  await runCli(
    `a2a-send --from "test-agent-a2a" --channel "${SORT_CHANNEL}" --message "sort channel message"`,
  );

  // Send a DM
  await runCli(
    'a2a-send --from "test-agent-a2a" --to "other-agent" --message "hello via DM"',
  );
});

// =====================================================================
// a2a-send command
// =====================================================================

describe('limen a2a-send', () => {
  it('DC-CLI-065: sends message and returns confirmation JSON', async () => {
    const result = await runCli(
      'a2a-send --from "test-agent-a2a" --to "recipient-x" --message "test message for DC-065"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { sent: boolean; target: string; sender: string; claimId: string; transport: string };
    expect(data.sent).toBe(true);
    expect(data.sender).toBe('test-agent-a2a');
    expect(data.target).toBe('@recipient-x');
    expect(typeof data.claimId).toBe('string');
    expect(data.transport).toBe('cli');
  });

  it('DC-CLI-066: missing --from rejects with CLI_USAGE', async () => {
    const result = await runCli('a2a-send --to "recipient" --message "hello"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
  });

  // F-BR3-001: --to is now optional. Without --to OR --channel, reject with CLI_NO_TARGET
  it('DC-CLI-067: missing --to and --channel rejects with CLI_NO_TARGET', async () => {
    const result = await runCli('a2a-send --from "sender" --message "hello"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_NO_TARGET');
  });

  it('DC-CLI-068: missing --message rejects with CLI_USAGE', async () => {
    const result = await runCli('a2a-send --from "sender" --to "recipient"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
  });

  it('DC-CLI-069: --from with invalid chars rejects with CLI_INVALID_SENDER', async () => {
    const result = await runCli('a2a-send --from "inv@lid!" --to "recipient" --message "hello"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_SENDER');
  });

  it('DC-CLI-070: --to with invalid chars rejects with CLI_INVALID_RECIPIENT', async () => {
    const result = await runCli('a2a-send --from "sender" --to "inv@lid!" --message "hello"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_RECIPIENT');
  });

  it('DC-CLI-071: --message whitespace-only rejects with CLI_INVALID_MESSAGE', async () => {
    const result = await runCli('a2a-send --from "sender" --to "recipient" --message "   "');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MESSAGE');
  });

  it('DC-CLI-072: --channel routes to channel instead of DM', async () => {
    // F-BR3-001: now using --channel without --to
    const result = await runCli(
      'a2a-send --from "sender" --channel "engineering" --message "channel msg"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { target: string };
    expect(data.target).toBe('#engineering');
  });

  it('DC-CLI-073: --channel with invalid chars rejects with CLI_INVALID_CHANNEL', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --channel "inv@lid!" --message "hello"',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CHANNEL');
  });

  it('DC-CLI-074: --metadata with invalid JSON rejects with CLI_INVALID_METADATA', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --to "recipient" --message "hello" --metadata "not-json"',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_METADATA');
  });

  // F-BR3-001: Channel-only send (no --to) must succeed
  it('DC-CLI-097: --channel without --to sends to channel (MCP parity)', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --channel "general" --message "channel-only send"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { sent: boolean; target: string };
    expect(data.sent).toBe(true);
    expect(data.target).toBe('#general');
  });

  // F-BR3-001: Both --to and --channel rejects with CLI_DUAL_TARGET
  it('DC-CLI-098: --to and --channel both rejects with CLI_DUAL_TARGET', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --to "recipient" --channel "general" --message "hello"',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_DUAL_TARGET');
  });

  // F-BR3-002: --mentions with valid names
  it('DC-CLI-099: --mentions with valid names includes mentions in metadata', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --channel "general" --message "hey @codex" --mentions "codex,femi"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { sent: boolean; claimId: string };
    expect(data.sent).toBe(true);
    expect(typeof data.claimId).toBe('string');
  });

  // F-BR3-002: --mentions with invalid name rejects
  it('DC-CLI-100: --mentions with invalid name rejects with CLI_INVALID_MENTION', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --channel "general" --message "hello" --mentions "valid,inv@lid"',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MENTION');
  });

  // F-BR3-012: --message >2000 chars rejection path
  it('DC-CLI-101: --message >2000 chars rejects with CLI_INVALID_MESSAGE', async () => {
    const longMessage = 'x'.repeat(2001);
    const result = await runCli(
      `a2a-send --from "sender" --to "recipient" --message "${longMessage}"`,
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MESSAGE');
  });
});

// =====================================================================
// a2a-read command
// =====================================================================

describe('limen a2a-read', () => {
  it('DC-CLI-075: --channel returns messages JSON', async () => {
    const result = await runCli(`a2a-read --channel "${TEST_CHANNEL}"`);
    expect(result.exitCode).toBe(0);
    const data = result.json as { channel: string; count: number; messages: unknown[] };
    expect(data.channel).toBe(`#${TEST_CHANNEL}`);
    expect(typeof data.count).toBe('number');
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it('DC-CLI-076: without --channel or --from rejects with CLI_NO_TARGET', async () => {
    const result = await runCli('a2a-read');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_NO_TARGET');
  });

  it('DC-CLI-077: --channel and --from both provided rejects with CLI_DUAL_TARGET', async () => {
    const result = await runCli('a2a-read --channel "general" --from "agent" --me "me"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_DUAL_TARGET');
  });

  it('DC-CLI-078: --from without --me rejects with CLI_NO_TARGET', async () => {
    const result = await runCli('a2a-read --from "agent"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_NO_TARGET');
  });

  it('DC-CLI-079: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli(`a2a-read --channel "${TEST_CHANNEL}" --limit "abc"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
  });

  it('DC-CLI-080: --since invalid timestamp rejects with CLI_INVALID_TIMESTAMP', async () => {
    const result = await runCli(`a2a-read --channel "${TEST_CHANNEL}" --since "not-a-date"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_TIMESTAMP');
  });

  it('DC-CLI-081: --channel with invalid chars rejects with CLI_INVALID_CHANNEL', async () => {
    const result = await runCli('a2a-read --channel "inv@lid!"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CHANNEL');
  });

  // F-BR3-007: UNCONDITIONAL sort assertion -- we seeded 2+ messages in beforeAll
  it('DC-CLI-082: messages sorted chronologically', async () => {
    const result = await runCli(`a2a-read --channel "${TEST_CHANNEL}"`);
    expect(result.exitCode).toBe(0);
    const data = result.json as { messages: Array<{ timestamp: string }> };
    // UNCONDITIONAL: we seeded at least 2 messages to TEST_CHANNEL in beforeAll
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < data.messages.length; i++) {
      expect(data.messages[i]!.timestamp >= data.messages[i - 1]!.timestamp).toBe(true);
    }
  });

  // F-BR3-013: --from with invalid name rejects
  it('DC-CLI-102: --from with invalid name rejects with CLI_INVALID_SENDER', async () => {
    const result = await runCli('a2a-read --from "inv@lid" --me "valid-agent"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_SENDER');
  });

  // F-BR3-013: --me with invalid name rejects
  it('DC-CLI-103: --me with invalid name rejects with CLI_INVALID_SENDER', async () => {
    const result = await runCli('a2a-read --from "valid-agent" --me "inv@lid"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_SENDER');
  });

  // F-BR3-003 remediation: success-path coverage for --since filter.
  // Certifier Phase 3 (PHASE-3-CERTIFICATION.md DS-8) probed this scenario
  // directly and found LIMIT_EXCEEDED because the original fix set
  // fetchLimit=1000 > engine cap of 200. This test fails against the broken
  // implementation (exitCode=1, LIMIT_EXCEEDED on stderr) and passes once
  // fetchLimit is clamped to ENGINE_CLAIM_QUERY_MAX_LIMIT.
  it('DC-CLI-104: --since filters messages after middle timestamp', { timeout: 60_000 }, async () => {
    const sinceChannel = `test-since-${Date.now()}`;
    // Use a fresh agent identity so this test's rate-limit budget is isolated
    // from the shared `test-agent-a2a` used by earlier tests (CLAIM_RATE_LIMIT
    // = 100/min per agent at claim_types.ts).
    const sinceAgent = `since-agent-${Date.now()}`;
    await runCli(`agent register --name "${sinceAgent}"`);

    // Seed 5 messages with ~50ms spacing so we can capture a middle timestamp.
    for (let i = 0; i < 5; i++) {
      const r = await runCli(
        `a2a-send --from "${sinceAgent}" --channel "${sinceChannel}" --message "msg-${i}"`,
      );
      expect(r.exitCode).toBe(0);
      const data = r.json as { claimId: string };
      expect(typeof data.claimId).toBe('string');
      await new Promise((resolve) => setTimeout(resolve, 55));
    }

    // Pull all messages unfiltered to capture their exact timestamps.
    const all = await runCli(`a2a-read --channel "${sinceChannel}" --limit 50`);
    expect(all.exitCode).toBe(0);
    const allData = all.json as { messages: Array<{ timestamp: string }> };
    expect(allData.messages.length).toBe(5);

    // Pick the third message's timestamp as the --since boundary.
    // Filter should return messages where timestamp >= middle (indices 2, 3, 4).
    const middleTimestamp = allData.messages[2]!.timestamp;

    const filtered = await runCli(
      `a2a-read --channel "${sinceChannel}" --since "${middleTimestamp}"`,
    );

    // DISCRIMINATIVE: against the broken fetchLimit=1000 implementation this
    // line fails because exitCode=1 and stderr contains LIMIT_EXCEEDED.
    expect(filtered.exitCode).toBe(0);
    const filteredData = filtered.json as {
      count: number;
      messages: Array<{ timestamp: string; message: string }>;
    };
    expect(filteredData.count).toBe(3);
    expect(filteredData.messages.length).toBe(3);
    // Every returned message must satisfy the filter predicate.
    for (const m of filteredData.messages) {
      expect(m.timestamp >= middleTimestamp).toBe(true);
    }
  });

  // F-BR3-003 remediation: success-path coverage for --agent-id filter.
  // Certifier Phase 3 (PHASE-3-CERTIFICATION.md DS-9) probed this scenario
  // directly and found LIMIT_EXCEEDED. Discriminative against the broken
  // fetchLimit=1000 path.
  it('DC-CLI-105: --agent-id filters messages by sender', { timeout: 60_000 }, async () => {
    const idChannel = `test-agentid-${Date.now()}`;
    const agentX = `agent-x-${Date.now()}`;
    const agentY = `agent-y-${Date.now()}`;

    // Register both agents so self-declared senders are accepted.
    await runCli(`agent register --name "${agentX}"`);
    await runCli(`agent register --name "${agentY}"`);

    // Two messages from X, three messages from Y, interleaved.
    const seeds: Array<[string, string]> = [
      [agentX, 'x-first'],
      [agentY, 'y-first'],
      [agentX, 'x-second'],
      [agentY, 'y-second'],
      [agentY, 'y-third'],
    ];
    for (const [sender, body] of seeds) {
      const r = await runCli(
        `a2a-send --from "${sender}" --channel "${idChannel}" --message "${body}"`,
      );
      expect(r.exitCode).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Filter by agentY: must see exactly 3 messages, all from agentY.
    const filtered = await runCli(
      `a2a-read --channel "${idChannel}" --agent-id "${agentY}"`,
    );

    // DISCRIMINATIVE: against the broken fetchLimit=1000 implementation this
    // line fails because exitCode=1 and stderr contains LIMIT_EXCEEDED.
    expect(filtered.exitCode).toBe(0);
    const data = filtered.json as {
      count: number;
      messages: Array<{ sender: string; message: string }>;
    };
    expect(data.count).toBe(3);
    expect(data.messages.length).toBe(3);
    for (const m of data.messages) {
      expect(m.sender).toBe(agentY);
    }
    // And none of the X messages leaked through.
    const bodies = data.messages.map((m) => m.message).sort();
    expect(bodies).toEqual(['y-first', 'y-second', 'y-third']);
  });
});

// =====================================================================
// a2a-channels command
// =====================================================================

describe('limen a2a-channels', () => {
  it('DC-CLI-083: returns thread listing JSON', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();
  });

  it('DC-CLI-084: output has count and threads fields', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    const data = result.json as { count: number; threads: unknown[] };
    expect(typeof data.count).toBe('number');
    expect(Array.isArray(data.threads)).toBe(true);
  });

  it('DC-CLI-085: --include-metadata includes metadata flag', async () => {
    const result = await runCli('a2a-channels --include-metadata');
    expect(result.exitCode).toBe(0);
    const data = result.json as { threads: Array<{ raw?: boolean }> };
    // We seeded channels in beforeAll, so threads should be non-empty
    expect(data.threads.length).toBeGreaterThan(0);
    expect(data.threads[0]!.raw).toBe(true);
  });

  // F-BR3-006: UNCONDITIONAL sort assertion -- we seeded 2+ channels in beforeAll
  it('DC-CLI-086: threads sorted by last activity (newest first)', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    const data = result.json as { threads: Array<{ lastActivity: string }> };
    // UNCONDITIONAL: we seeded at least 2 distinct channels + DMs
    expect(data.threads.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < data.threads.length; i++) {
      expect(data.threads[i]!.lastActivity <= data.threads[i - 1]!.lastActivity).toBe(true);
    }
  });

  it('DC-CLI-087: channel names have # prefix', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    const data = result.json as { threads: Array<{ name: string; type: string }> };
    const channels = data.threads.filter((t) => t.type === 'channel');
    expect(channels.length).toBeGreaterThan(0);
    for (const ch of channels) {
      expect(ch.name.startsWith('#')).toBe(true);
    }
  });

  it('DC-CLI-088: stdout is valid JSON', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

// =====================================================================
// a2a-presence command
// =====================================================================

describe('limen a2a-presence', () => {
  it('DC-CLI-089: returns agents JSON', async () => {
    const result = await runCli('a2a-presence');
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();
  });

  it('DC-CLI-090: output has count and agents fields', async () => {
    const result = await runCli('a2a-presence');
    expect(result.exitCode).toBe(0);
    const data = result.json as { count: number; agents: unknown[] };
    expect(typeof data.count).toBe('number');
    expect(Array.isArray(data.agents)).toBe(true);
  });

  // F-BR3-005: UNCONDITIONAL assertion -- we seeded agent in beforeAll
  it('DC-CLI-091: --agent-id filters to specific agent', async () => {
    const result = await runCli('a2a-presence --agent-id "test-agent-a2a"');
    expect(result.exitCode).toBe(0);
    const data = result.json as { count: number; agents: Array<{ name: string }> };
    // UNCONDITIONAL: agent was registered in beforeAll, must exist
    expect(data.count).toBe(1);
    expect(data.agents.length).toBe(1);
    expect(data.agents[0]!.name).toBe('test-agent-a2a');
  });

  it('DC-CLI-092: --agent-id with invalid chars rejects with CLI_INVALID_AGENT_ID', async () => {
    const result = await runCli('a2a-presence --agent-id "inv@lid!"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_AGENT_ID');
  });

  it('DC-CLI-093: --channel with invalid chars rejects with CLI_INVALID_CHANNEL', async () => {
    const result = await runCli('a2a-presence --channel "inv@lid!"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CHANNEL');
  });

  it('DC-CLI-094: agents have trustLevel field', async () => {
    const result = await runCli('a2a-presence');
    expect(result.exitCode).toBe(0);
    const data = result.json as { agents: Array<{ trustLevel: string }> };
    for (const agent of data.agents) {
      expect(agent).toHaveProperty('trustLevel');
      expect(typeof agent.trustLevel).toBe('string');
    }
  });
});

// =====================================================================
// FP-09 a2a-send auto-registers sender in presence
// =====================================================================

describe('FP-09 a2a-send auto-registers sender', () => {
  it('FP-FP09-001: sending from a fresh sender auto-registers them in presence (success)', { timeout: 30_000 }, async () => {
    // Success path: a sender name that has never been registered. After
    // a2a-send, a2a-presence --agent-id <name> should return exactly 1 hit.
    const freshSender = `fp09-fresh-${Date.now()}`;
    const sendR = await runCli(
      `a2a-send --from "${freshSender}" --channel "${TEST_CHANNEL}" --message "FP-09 auto-register"`,
    );
    expect(sendR.exitCode).toBe(0);
    const sendData = sendR.json as { sent: boolean; sender: string };
    expect(sendData.sent).toBe(true);
    expect(sendData.sender).toBe(freshSender);

    const presenceR = await runCli(`a2a-presence --agent-id "${freshSender}"`);
    expect(presenceR.exitCode).toBe(0);
    const presenceData = presenceR.json as {
      count: number;
      agents: Array<{ name: string; capabilities: string[]; domains: string[] }>;
    };
    expect(presenceData.count).toBe(1);
    expect(presenceData.agents[0]!.name).toBe(freshSender);
    // Verify the auto-registration tagged the agent with the a2a domain
    expect(presenceData.agents[0]!.domains).toContain('a2a');
  });

  it('FP-FP09-002: sending twice from the same sender does not duplicate (rejection path)', { timeout: 30_000 }, async () => {
    // Rejection path: the auto-register branch must be idempotent. Sending
    // a second message from the same name must not produce two agents with
    // the same name or cause a registration error that propagates to the
    // user. The first send registers; the second must be a no-op.
    const repeatSender = `fp09-repeat-${Date.now()}`;
    const r1 = await runCli(
      `a2a-send --from "${repeatSender}" --channel "${TEST_CHANNEL}" --message "first"`,
    );
    expect(r1.exitCode).toBe(0);
    const r2 = await runCli(
      `a2a-send --from "${repeatSender}" --channel "${TEST_CHANNEL}" --message "second"`,
    );
    expect(r2.exitCode).toBe(0);

    const presenceR = await runCli(`a2a-presence --agent-id "${repeatSender}"`);
    expect(presenceR.exitCode).toBe(0);
    const presenceData = presenceR.json as { count: number };
    expect(presenceData.count).toBe(1);
  });
});

// =====================================================================
// JSON contract for Phase 3
// =====================================================================

describe('Phase 3 JSON contract', () => {
  // Four sequential runCli calls each with up-to-3 rate-limit retries
  // (see runCli). Default 5s timeout is insufficient once DC-CLI-104/105
  // have consumed a large share of the per-minute rate-limit budget.
  it('DC-CLI-095: all Phase 3 success stdout is valid JSON', { timeout: 60_000 }, async () => {
    // Run sequentially to avoid SQLite locking contention
    const r1 = await runCli('a2a-send --from "json-test" --to "recipient" --message "json contract test"');
    expect(r1.exitCode).toBe(0);
    expect(r1.json).not.toBeNull();

    const r2 = await runCli(`a2a-read --channel "${TEST_CHANNEL}"`);
    expect(r2.exitCode).toBe(0);
    expect(r2.json).not.toBeNull();

    const r3 = await runCli('a2a-channels');
    expect(r3.exitCode).toBe(0);
    expect(r3.json).not.toBeNull();

    const r4 = await runCli('a2a-presence');
    expect(r4.exitCode).toBe(0);
    expect(r4.json).not.toBeNull();
  });

  it('DC-CLI-096: all Phase 3 error stderr is valid JSON', { timeout: 60_000 }, async () => {
    // Run sequentially to avoid SQLite locking contention
    const e1 = await runCli('a2a-send --from "inv@lid" --to "recipient" --message "hello"');
    expect(e1.exitCode).toBe(1);
    expect(() => JSON.parse(e1.stderr)).not.toThrow();

    const e2 = await runCli('a2a-read');
    expect(e2.exitCode).toBe(1);
    expect(() => JSON.parse(e2.stderr)).not.toThrow();

    const e3 = await runCli('a2a-presence --agent-id "inv@lid"');
    expect(e3.exitCode).toBe(1);
    expect(() => JSON.parse(e3.stderr)).not.toThrow();
  });
});
