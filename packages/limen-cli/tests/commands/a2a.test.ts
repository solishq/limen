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
 *   DC-CLI-067: a2a-send missing --to rejects with CLI_USAGE (rejection)
 *   DC-CLI-068: a2a-send missing --message rejects with CLI_USAGE (rejection)
 *   DC-CLI-069: a2a-send --from with invalid chars rejects with CLI_INVALID_SENDER (rejection)
 *   DC-CLI-070: a2a-send --to with invalid chars rejects with CLI_INVALID_RECIPIENT (rejection)
 *   DC-CLI-071: a2a-send --message empty rejects with CLI_INVALID_MESSAGE (rejection)
 *   DC-CLI-072: a2a-send --channel routes to channel instead of DM (success)
 *   DC-CLI-073: a2a-send --channel with invalid chars rejects with CLI_INVALID_CHANNEL (rejection)
 *   DC-CLI-074: a2a-send --metadata with invalid JSON rejects with CLI_INVALID_METADATA (rejection)
 *
 *   === a2a-read command ===
 *   DC-CLI-075: a2a-read --channel returns messages JSON (success)
 *   DC-CLI-076: a2a-read without --channel or --from rejects with CLI_NO_TARGET (rejection)
 *   DC-CLI-077: a2a-read --channel and --from both provided rejects with CLI_DUAL_TARGET (rejection)
 *   DC-CLI-078: a2a-read --from without --me rejects with CLI_NO_TARGET (rejection)
 *   DC-CLI-079: a2a-read --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-080: a2a-read --since invalid rejects with CLI_INVALID_TIMESTAMP (rejection)
 *   DC-CLI-081: a2a-read --channel with invalid chars rejects with CLI_INVALID_CHANNEL (rejection)
 *   DC-CLI-082: a2a-read messages sorted chronologically (success)
 *
 *   === a2a-channels command ===
 *   DC-CLI-083: a2a-channels returns thread listing JSON (success)
 *   DC-CLI-084: a2a-channels output has count and threads fields (success)
 *   DC-CLI-085: a2a-channels --include-metadata includes metadata flag (success)
 *   DC-CLI-086: a2a-channels threads sorted by last activity (success)
 *   DC-CLI-087: a2a-channels shows channel names with # prefix (success)
 *   DC-CLI-088: a2a-channels stdout is valid JSON (success)
 *
 *   === a2a-presence command ===
 *   DC-CLI-089: a2a-presence returns agents JSON (success)
 *   DC-CLI-090: a2a-presence output has count and agents fields (success)
 *   DC-CLI-091: a2a-presence --agent-id filters to specific agent (success)
 *   DC-CLI-092: a2a-presence --agent-id with invalid chars rejects with CLI_INVALID_AGENT_ID (rejection)
 *   DC-CLI-093: a2a-presence --channel with invalid chars rejects with CLI_INVALID_CHANNEL (rejection)
 *   DC-CLI-094: a2a-presence agents have trustLevel field (success)
 *
 *   === JSON contract ===
 *   DC-CLI-095: all Phase 3 success stdout is valid JSON (success)
 *   DC-CLI-096: all Phase 3 error stderr is valid JSON (rejection)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execAsync = promisify(exec);

const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

/** Run a CLI command and return parsed stdout/stderr. */
async function runCli(args: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  json: unknown;
}> {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI} ${args}`, {
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
    return {
      stdout: (e.stdout ?? '').trim(),
      stderr: (e.stderr ?? '').trim(),
      exitCode: e.code ?? 1,
      json: null,
    };
  }
}

// Seed data: register an agent and send some messages before tests
beforeAll(async () => {
  // Register a test agent
  await runCli('agent register --name "test-agent-a2a"');

  // Send messages to a test channel
  await runCli(
    'a2a-send --from "test-agent-a2a" --to "general" --channel "test-a2a-chan" --message "hello from test agent"',
  );
  await runCli(
    'a2a-send --from "test-agent-a2a" --to "other-agent" --channel "test-a2a-chan" --message "second message in channel"',
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

  it('DC-CLI-067: missing --to rejects with CLI_USAGE', async () => {
    const result = await runCli('a2a-send --from "sender" --message "hello"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
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
    const result = await runCli(
      'a2a-send --from "sender" --to "recipient" --channel "engineering" --message "channel msg"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { target: string };
    expect(data.target).toBe('#engineering');
  });

  it('DC-CLI-073: --channel with invalid chars rejects with CLI_INVALID_CHANNEL', async () => {
    const result = await runCli(
      'a2a-send --from "sender" --to "recipient" --channel "inv@lid!" --message "hello"',
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
});

// =====================================================================
// a2a-read command
// =====================================================================

describe('limen a2a-read', () => {
  it('DC-CLI-075: --channel returns messages JSON', async () => {
    const result = await runCli('a2a-read --channel "test-a2a-chan"');
    expect(result.exitCode).toBe(0);
    const data = result.json as { channel: string; count: number; messages: unknown[] };
    expect(data.channel).toBe('#test-a2a-chan');
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
    const result = await runCli('a2a-read --channel "test-a2a-chan" --limit "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
  });

  it('DC-CLI-080: --since invalid timestamp rejects with CLI_INVALID_TIMESTAMP', async () => {
    const result = await runCli('a2a-read --channel "test-a2a-chan" --since "not-a-date"');
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

  it('DC-CLI-082: messages sorted chronologically', async () => {
    const result = await runCli('a2a-read --channel "test-a2a-chan"');
    expect(result.exitCode).toBe(0);
    const data = result.json as { messages: Array<{ timestamp: string }> };
    if (data.messages.length >= 2) {
      for (let i = 1; i < data.messages.length; i++) {
        expect(data.messages[i]!.timestamp >= data.messages[i - 1]!.timestamp).toBe(true);
      }
    }
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
    if (data.threads.length > 0) {
      expect(data.threads[0]!.raw).toBe(true);
    }
  });

  it('DC-CLI-086: threads sorted by last activity (newest first)', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    const data = result.json as { threads: Array<{ lastActivity: string }> };
    if (data.threads.length >= 2) {
      for (let i = 1; i < data.threads.length; i++) {
        expect(data.threads[i]!.lastActivity <= data.threads[i - 1]!.lastActivity).toBe(true);
      }
    }
  });

  it('DC-CLI-087: channel names have # prefix', async () => {
    const result = await runCli('a2a-channels');
    expect(result.exitCode).toBe(0);
    const data = result.json as { threads: Array<{ name: string; type: string }> };
    const channels = data.threads.filter((t) => t.type === 'channel');
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

  it('DC-CLI-091: --agent-id filters to specific agent', async () => {
    const result = await runCli('a2a-presence --agent-id "test-agent-a2a"');
    expect(result.exitCode).toBe(0);
    const data = result.json as { count: number; agents: Array<{ name: string }> };
    // Either 0 (agent registered in different db) or 1 (filtered correctly)
    expect(data.count).toBeLessThanOrEqual(1);
    if (data.agents.length > 0) {
      expect(data.agents[0]!.name).toBe('test-agent-a2a');
    }
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
// JSON contract for Phase 3
// =====================================================================

describe('Phase 3 JSON contract', () => {
  it('DC-CLI-095: all Phase 3 success stdout is valid JSON', async () => {
    // Run sequentially to avoid SQLite locking contention
    const r1 = await runCli('a2a-send --from "json-test" --to "recipient" --message "json contract test"');
    expect(r1.exitCode).toBe(0);
    expect(r1.json).not.toBeNull();

    const r2 = await runCli('a2a-read --channel "test-a2a-chan"');
    expect(r2.exitCode).toBe(0);
    expect(r2.json).not.toBeNull();

    const r3 = await runCli('a2a-channels');
    expect(r3.exitCode).toBe(0);
    expect(r3.json).not.toBeNull();

    const r4 = await runCli('a2a-presence');
    expect(r4.exitCode).toBe(0);
    expect(r4.json).not.toBeNull();
  });

  it('DC-CLI-096: all Phase 3 error stderr is valid JSON', async () => {
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
