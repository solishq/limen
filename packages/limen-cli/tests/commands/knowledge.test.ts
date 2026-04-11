/**
 * CLI Knowledge Commands -- Integration Tests
 *
 * Tests the 5 Phase 1 knowledge commands (remember, recall, forget, connect, reflect)
 * via the actual CLI binary using child_process.exec.
 *
 * These are integration tests -- they bootstrap a real Limen engine.
 * Requires: limen init has been run (~/.limen/ exists).
 *
 * Test runner: vitest
 *
 * DC Coverage:
 *   DC-CLI-001: remember returns valid JSON with claimId (success)
 *   DC-CLI-002: remember with --confidence stores custom confidence (success)
 *   DC-CLI-003: remember with --reasoning stores reasoning (success)
 *   DC-CLI-004: recall returns JSON array of beliefs (success)
 *   DC-CLI-005: recall with --limit limits results (success)
 *   DC-CLI-006: recall with --subject wildcard filters correctly (success)
 *   DC-CLI-007: forget retracts a claim (success)
 *   DC-CLI-008: forget with nonexistent ID returns JSON error (rejection)
 *   DC-CLI-009: forget with invalid reason returns JSON error (rejection)
 *   DC-CLI-010: connect creates relationship (success)
 *   DC-CLI-011: connect with invalid type returns JSON error (rejection)
 *   DC-CLI-012: reflect stores entries (success)
 *   DC-CLI-013: reflect with invalid JSON returns JSON error (rejection)
 *   DC-CLI-014: reflect with --file reads from file (success)
 *   DC-CLI-015: all stdout is valid JSON (success)
 *   DC-CLI-016: all stderr is valid JSON (rejection)
 *
 * === Amendment 21 Rejection-Path Tests (Breaker remediation) ===
 *   DC-CLI-017: remember missing required params -> JSON error to stderr (rejection)
 *   DC-CLI-018: remember --confidence -1 -> rejection with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-019: remember --confidence 2 -> rejection with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-020: forget missing --claimId -> JSON error to stderr (rejection)
 *   DC-CLI-021: connect missing required params -> JSON error to stderr (rejection)
 *   DC-CLI-022: reflect --entries and --file both provided -> mutual exclusion error (rejection)
 *   DC-CLI-023: reflect --file /nonexistent/path.json -> JSON error (rejection)
 *   DC-CLI-024: recall --limit "abc" -> CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-025: recall --limit -5 -> CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-026: recall --minConfidence "abc" -> CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-027: remember --value "" -> CLI_INVALID_VALUE (rejection)
 *   DC-CLI-028: remember --value exceeding 500 chars -> CLI_INVALID_VALUE (rejection)
 *   DC-CLI-029: forget missing --claimId outputs JSON stderr (not plain text) (rejection)
 *   DC-CLI-030: error code propagation -- engine errors carry typed codes (rejection)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);

const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

// F-BR3-010: Use isolated temp directory to prevent global database pollution
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-knowledge-test-'));
const GLOBAL_OPTS = `--dataDir "${TEST_DATA_DIR}"`;

// F-BR4-001: Initialize the per-dataDir master key at suite start.
// The prior implementation let commands fall through to the user-home
// master key, silently bridging credential scope across unrelated
// dataDirs. With the fallback deleted (bootstrap.ts, F-BR4-001 remediation),
// every suite MUST initialize its own isolated dataDir explicitly before
// running any non-init command. Without this step every test in the suite
// fails with CLI_UNINITIALIZED_DATADIR — which is the correct safe default.
beforeAll(async () => {
  await runCli('init');
});

// Cleanup temp directory after all tests
afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

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
      {
        const trimmed = stdout.trim();
        let json: unknown = null;
        if (trimmed) { try { json = JSON.parse(trimmed); } catch { json = null; } }
        return {
          stdout: trimmed,
          stderr: stderr.trim(),
          exitCode: 0,
          json,
        };
      }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      const result = {
        stdout: (e.stdout ?? '').trim(),
        stderr: (e.stderr ?? '').trim(),
        exitCode: e.code ?? 1,
        json: null as unknown,
      };
      // Retry on transient engine errors, not on expected validation errors
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
        const delayMs = isRateLimit ? 2000 * (attempt + 1) : 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      return result;
    }
  }
  // Unreachable, but TypeScript wants it
  throw new Error('unreachable');
}

describe('limen remember', () => {
  it('DC-CLI-001: returns valid JSON with claimId and confidence', async () => {
    const result = await runCli(
      'remember --subject "entity:test:cli-test-001" --predicate "test.remember" --value "DC-CLI-001 test"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { claimId: string; confidence: number };
    expect(data.claimId).toBeTruthy();
    expect(typeof data.claimId).toBe('string');
    expect(typeof data.confidence).toBe('number');
    expect(data.confidence).toBeGreaterThan(0);
    expect(data.confidence).toBeLessThanOrEqual(1);
  });

  it('DC-CLI-002: stores custom confidence', async () => {
    const result = await runCli(
      'remember --subject "entity:test:cli-test-002" --predicate "test.remember" --value "custom confidence" --confidence 0.5',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { confidence: number };
    expect(data.confidence).toBe(0.5);
  });

  it('DC-CLI-003: stores reasoning', async () => {
    const result = await runCli(
      'remember --subject "entity:test:cli-test-003" --predicate "test.remember" --value "with reasoning" --reasoning "test reason"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { claimId: string };
    expect(data.claimId).toBeTruthy();
  });
});

describe('limen recall', () => {
  it('DC-CLI-004: returns JSON array of beliefs', async () => {
    // First store something
    await runCli(
      'remember --subject "entity:test:cli-recall-004" --predicate "test.recall" --value "recall target"',
    );
    const result = await runCli('recall --subject "entity:test:cli-recall-004"');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
    const beliefs = result.json as Array<{ claimId: string; subject: string; value: string }>;
    expect(beliefs.length).toBeGreaterThan(0);
    expect(beliefs[0]!.subject).toBe('entity:test:cli-recall-004');
  });

  it('DC-CLI-005: --limit limits results', async () => {
    const result = await runCli('recall --subject "entity:test:*" --limit 1');
    expect(result.exitCode).toBe(0);
    const beliefs = result.json as unknown[];
    expect(beliefs.length).toBeLessThanOrEqual(1);
  });

  it('DC-CLI-006: wildcard filtering works', async () => {
    const result = await runCli('recall --subject "entity:test:cli-recall-*"');
    expect(result.exitCode).toBe(0);
    const beliefs = result.json as Array<{ subject: string }>;
    for (const b of beliefs) {
      expect(b.subject.startsWith('entity:test:cli-recall-')).toBe(true);
    }
  });
});

describe('limen forget', () => {
  it('DC-CLI-007: retracts a claim', async () => {
    // Store then forget
    const storeResult = await runCli(
      'remember --subject "entity:test:cli-forget-007" --predicate "test.forget" --value "to be forgotten"',
    );
    const { claimId } = storeResult.json as { claimId: string };

    const result = await runCli(`forget --claimId "${claimId}"`);
    expect(result.exitCode).toBe(0);
    const data = result.json as { retracted: boolean; claimId: string };
    expect(data.retracted).toBe(true);
    expect(data.claimId).toBe(claimId);
  });

  it('DC-CLI-008: nonexistent ID returns JSON error', async () => {
    const result = await runCli('forget --claimId "nonexistent-claim-id"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    expect(errData.error.message).toContain('not found');
  });

  it('DC-CLI-009: invalid reason returns JSON error', async () => {
    const result = await runCli('forget --claimId "some-id" --reason "bogus"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    expect(errData.error.message).toContain('Invalid retraction reason');
  });
});

describe('limen connect', () => {
  it('DC-CLI-010: creates relationship', async () => {
    // Store two claims
    const r1 = await runCli(
      'remember --subject "entity:test:cli-connect-a" --predicate "test.connect" --value "claim A"',
    );
    const r2 = await runCli(
      'remember --subject "entity:test:cli-connect-b" --predicate "test.connect" --value "claim B"',
    );
    const id1 = (r1.json as { claimId: string }).claimId;
    const id2 = (r2.json as { claimId: string }).claimId;

    const result = await runCli(`connect --from "${id1}" --to "${id2}" --type supports`);
    expect(result.exitCode).toBe(0);
    const data = result.json as { connected: boolean; from: string; to: string; type: string };
    expect(data.connected).toBe(true);
    expect(data.from).toBe(id1);
    expect(data.to).toBe(id2);
    expect(data.type).toBe('supports');
  });

  it('DC-CLI-011: invalid type returns JSON error', async () => {
    const result = await runCli('connect --from "a" --to "b" --type "invalid"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    expect(errData.error.message).toContain('Invalid relationship type');
  });
});

describe('limen reflect', () => {
  it('DC-CLI-012: stores entries', async () => {
    const entries = JSON.stringify([
      { category: 'finding', statement: 'DC-CLI-012 test finding' },
    ]);
    const result = await runCli(`reflect --entries '${entries}'`);
    expect(result.exitCode).toBe(0);
    const data = result.json as { stored: number; claimIds: string[] };
    expect(data.stored).toBe(1);
    expect(data.claimIds.length).toBe(1);
  });

  it('DC-CLI-013: invalid JSON returns CLI_INVALID_JSON error code (FP-07)', async () => {
    // FP-07: The error code must be CLI_INVALID_JSON, not UNKNOWN.
    const result = await runCli('reflect --entries "not-valid-json"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_JSON');
    expect(errData.error.message).toContain('Invalid JSON');
  });

  it('DC-CLI-014: reads entries from file', async () => {
    const tmpFile = join(import.meta.dirname, 'test-entries.json');
    const entries = [{ category: 'pattern', statement: 'DC-CLI-014 file test' }];
    writeFileSync(tmpFile, JSON.stringify(entries), 'utf-8');

    try {
      const result = await runCli(`reflect --file "${tmpFile}"`);
      expect(result.exitCode).toBe(0);
      const data = result.json as { stored: number };
      expect(data.stored).toBe(1);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* cleanup */ }
    }
  });
});

describe('JSON contract', () => {
  it('DC-CLI-015: all success stdout is valid JSON', async () => {
    const result = await runCli(
      'remember --subject "entity:test:json-contract" --predicate "test.json" --value "json check"',
    );
    expect(result.exitCode).toBe(0);
    // If JSON.parse fails, the runCli json field will be null
    expect(result.json).not.toBeNull();
  });

  it('DC-CLI-016: all error stderr is valid JSON', async () => {
    const result = await runCli('forget --claimId "nonexistent"');
    expect(result.exitCode).toBe(1);
    expect(() => JSON.parse(result.stderr)).not.toThrow();
  });
});

// =====================================================================
// Amendment 21 Rejection-Path Tests -- Breaker Findings Remediation
// =====================================================================

describe('F-001: Commander required-option errors as JSON', () => {
  it('DC-CLI-017: remember missing required params -> JSON error to stderr', async () => {
    const result = await runCli('remember');
    expect(result.exitCode).toBe(1);
    // Must be valid JSON, not plain text
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
    expect(errData.error.message).toContain('--subject');
  });

  it('DC-CLI-020: forget missing --claimId -> JSON error to stderr', async () => {
    const result = await runCli('forget');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
    expect(errData.error.message).toContain('--claimId');
  });

  it('DC-CLI-021: connect missing required params -> JSON error to stderr', async () => {
    const result = await runCli('connect');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
    expect(errData.error.message).toContain('--from');
  });

  it('DC-CLI-029: Commander JSON errors are parseable (not plain text)', async () => {
    // Verify the ACTUAL contract: stderr from Commander errors is valid JSON
    const result = await runCli('remember --subject "entity:test:x" --predicate "test.x"');
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stderr) as { error: { code: string } };
    expect(parsed.error.code).toBe('CLI_USAGE');
  });
});

describe('F-002/F-003/F-004: recall numeric validation', () => {
  it('DC-CLI-024: recall --limit "abc" -> CLI_INVALID_LIMIT', async () => {
    const result = await runCli('recall --limit "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
    expect(errData.error.message).toContain('valid integer');
  });

  it('DC-CLI-025: recall --limit -5 -> CLI_INVALID_LIMIT', async () => {
    const result = await runCli('recall --limit -5');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
    expect(errData.error.message).toContain('positive');
  });

  it('DC-CLI-026: recall --minConfidence "abc" -> CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('recall --minConfidence "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
    expect(errData.error.message).toContain('valid number');
  });
});

describe('F-005: Error code propagation', () => {
  it('DC-CLI-030: engine errors carry typed codes, not UNKNOWN', async () => {
    const result = await runCli('forget --claimId "nonexistent-id-for-code-test"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).not.toBe('UNKNOWN');
    // It should be either CLAIM_NOT_FOUND or CONV_CLAIM_NOT_FOUND
    expect(
      errData.error.code.includes('NOT_FOUND') || errData.error.code.includes('CLAIM'),
    ).toBe(true);
  });
});

describe('F-006/F-007: remember value enforcement', () => {
  it('DC-CLI-018: remember --confidence -1 -> rejection', async () => {
    const result = await runCli(
      'remember --subject "entity:test:conf-neg" --predicate "test.conf" --value "test" --confidence -1',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
    expect(errData.error.message).toContain('[0.0, 1.0]');
  });

  it('DC-CLI-019: remember --confidence 2 -> rejection', async () => {
    const result = await runCli(
      'remember --subject "entity:test:conf-over" --predicate "test.conf" --value "test" --confidence 2',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
  });

  it('DC-CLI-027: remember --value "" (empty) -> rejection', async () => {
    const result = await runCli(
      'remember --subject "entity:test:empty-val" --predicate "test.val" --value "   "',
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_VALUE');
    expect(errData.error.message).toContain('empty');
  });

  it('DC-CLI-028: remember --value exceeding 500 chars -> rejection', async () => {
    const longValue = 'x'.repeat(501);
    const result = await runCli(
      `remember --subject "entity:test:long-val" --predicate "test.val" --value "${longValue}"`,
    );
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_VALUE');
    expect(errData.error.message).toContain('500');
  });
});

describe('F-008: reflect mutual exclusion', () => {
  it('DC-CLI-022: reflect --entries and --file both provided -> error', async () => {
    const result = await runCli('reflect --entries "[]" --file "/tmp/test.json"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    expect(errData.error.message).toContain('not both');
  });

  it('DC-CLI-023: reflect --file /nonexistent/path.json -> JSON error', async () => {
    const result = await runCli('reflect --file "/nonexistent/path/entries.json"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    expect(errData.error.message).toContain('Failed to read file');
  });
});

// =====================================================================
// Friction Remediation Pass — CLI Parity 2026-04-11
// =====================================================================
// FP-01: init respects --dataDir (functional)
// FP-02: confidence capping produces visible feedback (functional)
// FP-06: disputed flag recomputed after forget (cosmetic/state)
// FP-10a: bare recall excludes a2a.message claims (functional)
// Each FP has at least one success-path AND one rejection/discriminative test.

/** Run a CLI command with an explicit, test-supplied --dataDir instead of the suite default. */
async function runCliWithDataDir(dataDir: string, args: string, retries = 3): Promise<{
  stdout: string; stderr: string; exitCode: number; json: unknown;
}> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execAsync(
        `node ${CLI} --dataDir "${dataDir}" ${args}`,
        { timeout: 15000 },
      );
      const trimmed = stdout.trim();
      let json: unknown = null;
      if (trimmed) { try { json = JSON.parse(trimmed); } catch { json = null; } }
      return { stdout: trimmed, stderr: stderr.trim(), exitCode: 0, json };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      const result = {
        stdout: (e.stdout ?? '').trim(),
        stderr: (e.stderr ?? '').trim(),
        exitCode: e.code ?? 1,
        json: null as unknown,
      };
      const combined = result.stderr + result.stdout;
      const isTransient = combined.includes('ENGINE_UNHEALTHY') ||
        combined.includes('SQLITE_BUSY') ||
        combined.includes('database is locked') ||
        combined.includes('RATE_LIMITED');
      if (isTransient && attempt < retries) {
        const isRateLimit = combined.includes('RATE_LIMITED');
        const delayMs = isRateLimit ? 2000 * (attempt + 1) : 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      return result;
    }
  }
  throw new Error('unreachable');
}

describe('FP-01 init respects --dataDir', () => {
  it('FP-FP01-001: init --dataDir <X> writes home, data, master key, config to X', async () => {
    // Success path: create a fresh temp dir, init into it, assert all artifacts
    // live under the supplied path — not ~/.limen/.
    const tmpHome = mkdtempSync(join(tmpdir(), 'limen-fp01-success-'));
    try {
      const result = await runCliWithDataDir(tmpHome, 'init');
      expect(result.exitCode).toBe(0);
      const data = result.json as {
        initialized: boolean;
        home: string;
        dataDir: string;
        masterKeyPath: string;
        created: string[];
      };
      expect(data.initialized).toBe(true);
      expect(data.home).toBe(tmpHome);
      expect(data.dataDir).toBe(tmpHome);
      expect(data.masterKeyPath).toBe(join(tmpHome, 'master.key'));
      // master.key and config.json must be freshly created under tmpHome
      expect(existsSync(join(tmpHome, 'master.key'))).toBe(true);
      expect(existsSync(join(tmpHome, 'config.json'))).toBe(true);
      // The master key must have mode 0o600 (credential integrity — Defect Cat 7)
      const mkMode = statSync(join(tmpHome, 'master.key')).mode & 0o777;
      expect(mkMode).toBe(0o600);
      expect(data.created).toContain('master.key');
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('FP-FP01-002: init --dataDir <X> does NOT touch ~/.limen/ (rejection path)', async () => {
    // Rejection path: verify the bug fix by snapshotting ~/.limen/master.key
    // before and after. If init had written ~/.limen/master.key despite
    // --dataDir being provided, the mtime would change.
    const userHome = (process.env.HOME ?? '');
    const userKey = join(userHome, '.limen', 'master.key');
    const beforeExists = existsSync(userKey);
    const beforeMtime = beforeExists ? statSync(userKey).mtimeMs : 0;

    const tmpHome = mkdtempSync(join(tmpdir(), 'limen-fp01-reject-'));
    try {
      const result = await runCliWithDataDir(tmpHome, 'init');
      expect(result.exitCode).toBe(0);
      // Assert the temp home got its own master key
      expect(existsSync(join(tmpHome, 'master.key'))).toBe(true);
      // Assert the real user home was not mutated
      const afterExists = existsSync(userKey);
      expect(afterExists).toBe(beforeExists);
      if (beforeExists) {
        const afterMtime = statSync(userKey).mtimeMs;
        expect(afterMtime).toBe(beforeMtime);
      }
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('FP-FP01-003: init --dataDir "" (empty) rejects with CLI_INVALID_DATADIR', async () => {
    // Rejection path: empty/whitespace dataDir must be caught before filesystem ops.
    // Pass empty string literally.
    try {
      const { stdout, stderr } = await execAsync(
        `node ${CLI} --dataDir " " init`,
        { timeout: 15000 },
      );
      // If it succeeded, that's a defect
      throw new Error(`expected rejection, got stdout=${stdout} stderr=${stderr}`);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      expect(e.code).toBe(1);
      const errData = JSON.parse((e.stderr ?? '').trim()) as { error: { code: string } };
      expect(errData.error.code).toBe('CLI_INVALID_DATADIR');
    }
  });

  it('FP-FP01-004: subsequent commands against init --dataDir home work end-to-end', async () => {
    // Wiring verification: init then remember into the same isolated home.
    // This exercises bootstrap's master key auto-discovery (bootstrap.ts).
    const tmpHome = mkdtempSync(join(tmpdir(), 'limen-fp01-e2e-'));
    try {
      const initR = await runCliWithDataDir(tmpHome, 'init');
      expect(initR.exitCode).toBe(0);
      const storeR = await runCliWithDataDir(
        tmpHome,
        'remember --subject "entity:test:fp01-e2e" --predicate "test.fp01" --value "e2e value"',
      );
      expect(storeR.exitCode).toBe(0);
      const claim = storeR.json as { claimId: string };
      expect(typeof claim.claimId).toBe('string');
      expect(claim.claimId.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('FP-02 confidence capping feedback', () => {
  it('FP-FP02-001: remember --confidence 0.9 reports governed=true with requestedConfidence', async () => {
    // Success path: capping occurred -> governance fields present.
    const result = await runCli(
      'remember --subject "entity:test:fp02-cap" --predicate "test.fp02" --value "capped value" --confidence 0.9',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as {
      claimId: string;
      confidence: number;
      requestedConfidence?: number;
      governed?: boolean;
      governanceReason?: string;
    };
    expect(data.confidence).toBeLessThanOrEqual(0.7);
    expect(data.requestedConfidence).toBe(0.9);
    expect(data.governed).toBe(true);
    expect(typeof data.governanceReason).toBe('string');
    expect(data.governanceReason).toContain('maxAutoConfidence');
  });

  it('FP-FP02-002: remember --confidence 0.5 does NOT report governed fields (rejection path)', async () => {
    // Rejection path: no capping -> governance fields absent. Asserts the
    // annotation fires ONLY when capping occurred, preventing false-positive
    // governance flags from leaking.
    const result = await runCli(
      'remember --subject "entity:test:fp02-nocap" --predicate "test.fp02" --value "not capped" --confidence 0.5',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as {
      confidence: number;
      requestedConfidence?: number;
      governed?: boolean;
      governanceReason?: string;
    };
    expect(data.confidence).toBe(0.5);
    expect(data.requestedConfidence).toBeUndefined();
    expect(data.governed).toBeUndefined();
    expect(data.governanceReason).toBeUndefined();
  });

  it('FP-FP02-003: remember without --confidence does NOT report governed fields', async () => {
    // Discriminator: omitting --confidence uses engine default (0.7), which
    // equals the cap. Since the user did not request a specific value, we do
    // not annotate "governed" — the flag is a user-facing signal, not an
    // internal audit marker.
    const result = await runCli(
      'remember --subject "entity:test:fp02-default" --predicate "test.fp02" --value "default conf"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as { governed?: boolean; requestedConfidence?: number };
    expect(data.governed).toBeUndefined();
    expect(data.requestedConfidence).toBeUndefined();
  });
});

describe('FP-06 dispute flag recomputation after forget', () => {
  it('FP-FP06-001: surviving claim shows disputed=false after counterpart retracted', { timeout: 30_000 }, async () => {
    // Success path: store two contradicting claims, connect as contradicts,
    // forget one, recall the other — dispute must clear.
    const s1 = await runCli(
      'remember --subject "entity:test:fp06-dispute" --predicate "test.fp06" --value "claim ALPHA"',
    );
    const s2 = await runCli(
      'remember --subject "entity:test:fp06-dispute" --predicate "test.fp06" --value "claim BETA"',
    );
    expect(s1.exitCode).toBe(0);
    expect(s2.exitCode).toBe(0);
    const id1 = (s1.json as { claimId: string }).claimId;
    const id2 = (s2.json as { claimId: string }).claimId;

    const conn = await runCli(`connect --from "${id1}" --to "${id2}" --type contradicts`);
    expect(conn.exitCode).toBe(0);

    // Before retract: both disputed
    const before = await runCli('recall --subject "entity:test:fp06-dispute" --predicate "test.fp06"');
    expect(before.exitCode).toBe(0);
    const beforeBeliefs = before.json as Array<{ claimId: string; disputed: boolean }>;
    expect(beforeBeliefs.length).toBe(2);
    for (const b of beforeBeliefs) {
      expect(b.disputed).toBe(true);
    }

    // Retract one
    const forg = await runCli(`forget --claimId "${id2}"`);
    expect(forg.exitCode).toBe(0);

    // After retract: surviving claim must be disputed=false
    const after = await runCli('recall --subject "entity:test:fp06-dispute" --predicate "test.fp06"');
    expect(after.exitCode).toBe(0);
    const afterBeliefs = after.json as Array<{ claimId: string; disputed: boolean }>;
    expect(afterBeliefs.length).toBe(1);
    expect(afterBeliefs[0]!.claimId).toBe(id1);
    expect(afterBeliefs[0]!.disputed).toBe(false);
  });

  it('FP-FP06-002: dispute survives when counterpart is still active (rejection path)', { timeout: 30_000 }, async () => {
    // Rejection-path: recomputation must NOT over-clear disputes. If the
    // contradictor remains active, dispute must still be true.
    const s1 = await runCli(
      'remember --subject "entity:test:fp06-live" --predicate "test.fp06" --value "live ALPHA"',
    );
    const s2 = await runCli(
      'remember --subject "entity:test:fp06-live" --predicate "test.fp06" --value "live BETA"',
    );
    const id1 = (s1.json as { claimId: string }).claimId;
    const id2 = (s2.json as { claimId: string }).claimId;
    await runCli(`connect --from "${id1}" --to "${id2}" --type contradicts`);

    const r = await runCli('recall --subject "entity:test:fp06-live" --predicate "test.fp06"');
    expect(r.exitCode).toBe(0);
    const beliefs = r.json as Array<{ disputed: boolean }>;
    expect(beliefs.length).toBe(2);
    for (const b of beliefs) {
      expect(b.disputed).toBe(true);
    }
  });
});

describe('FP-10a bare recall excludes a2a.message claims', () => {
  it('FP-FP10a-001: bare recall does not return a2a.message claims (success)', { timeout: 30_000 }, async () => {
    // Seed an A2A message claim — it uses the a2a.message predicate.
    await runCli(
      'a2a-send --from "fp10a-sender" --channel "fp10a-channel" --message "hello fp10a world"',
    );
    // Seed a regular knowledge claim
    await runCli(
      'remember --subject "entity:test:fp10a-knowledge" --predicate "knowledge.fp10a" --value "real knowledge"',
    );

    // Bare recall with NO filters — a2a.message must be absent
    const result = await runCli('recall');
    expect(result.exitCode).toBe(0);
    const beliefs = result.json as Array<{ predicate: string }>;
    expect(beliefs.length).toBeGreaterThan(0);
    for (const b of beliefs) {
      expect(b.predicate).not.toBe('a2a.message');
    }
  });

  it('FP-FP10a-002: recall --predicate "a2a.message" INCLUDES a2a messages (rejection of over-filter)', async () => {
    // Rejection path for the filter: when the user explicitly asks for
    // a2a.message, they must get them. Over-filtering is a defect.
    const result = await runCli('recall --predicate "a2a.message"');
    expect(result.exitCode).toBe(0);
    const beliefs = result.json as Array<{ predicate: string }>;
    expect(beliefs.length).toBeGreaterThan(0);
    for (const b of beliefs) {
      expect(b.predicate).toBe('a2a.message');
    }
  });

  it('FP-FP10b-001: a2a.message claims are never marked disputed', { timeout: 60_000 }, async () => {
    // FP-10b: sequential a2a messages to the same channel share (subject,
    // predicate) but are not contradicting assertions — dispute detector
    // must skip them.
    const s1 = await runCli('a2a-send --from "fp10b-a" --channel "fp10b-disp" --message "first message"');
    expect(s1.exitCode, `s1 stderr: ${s1.stderr}`).toBe(0);
    const s2 = await runCli('a2a-send --from "fp10b-b" --channel "fp10b-disp" --message "second message"');
    expect(s2.exitCode, `s2 stderr: ${s2.stderr}`).toBe(0);
    const s3 = await runCli('a2a-send --from "fp10b-c" --channel "fp10b-disp" --message "third message"');
    expect(s3.exitCode, `s3 stderr: ${s3.stderr}`).toBe(0);

    const result = await runCli('recall --predicate "a2a.message"');
    expect(result.exitCode, `recall stderr: ${result.stderr}`).toBe(0);
    const beliefs = result.json as Array<{ predicate: string; disputed: boolean }>;
    const channelMsgs = beliefs.filter((b) => b.predicate === 'a2a.message');
    expect(channelMsgs.length).toBeGreaterThanOrEqual(3);
    for (const b of channelMsgs) {
      expect(b.disputed).toBe(false);
    }
  });
});

// =====================================================================
// F-BR4 Loopback — Breaker Control 4 remediation 2026-04-11
// =====================================================================
// F-BR4-001: credential-scope isolation (no fallback chain)
// F-BR4-004: dispute recomputation from relationship edges (no heuristic)
// Plus non-blocking sweep tests (F-BR4-008, 009)
// Unit-level tests for round4 / freshness / a2a predicate live in
// `belief-postprocess.test.ts` (same suite dir).

describe('F-BR4-001 master-key isolation (re-derivation)', () => {
  it('FP-FP01-005: uninitialized --dataDir rejects with CLI_UNINITIALIZED_DATADIR', async () => {
    // Re-derivation invariant: a master key is bound to exactly one dataDir.
    // Running a non-init command against a freshly-mkdtemp'd directory
    // (with no master.key inside it) MUST fail fast rather than silently
    // fall back to ~/.limen/master.key. The prior implementation collapsed
    // credential scope across trust boundaries (F-BR4-001, Critical).
    const freshDir = mkdtempSync(join(tmpdir(), 'limen-fp01-uninit-'));
    try {
      const { stdout, stderr } = await execAsync(
        `node ${CLI} --dataDir "${freshDir}" remember --subject "entity:test:x" --predicate "test.x" --value "hello"`,
        { timeout: 15000 },
      );
      throw new Error(`expected rejection, got stdout=${stdout} stderr=${stderr}`);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      expect(e.code).toBe(1);
      const errData = JSON.parse((e.stderr ?? '').trim()) as { error: { code: string; message: string } };
      expect(errData.error.code).toBe('CLI_UNINITIALIZED_DATADIR');
      // The error message must direct the user to `init` for this dataDir.
      expect(errData.error.message).toContain('init');
      expect(errData.error.message).toContain(freshDir);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('FP-FP01-006: cross-dataDir filesystem-scoped isolation — dirB does not surface dirA claims', { timeout: 30_000 }, async () => {
    // F-BR4-001 + F-BR5-001: what this test asserts, and what it does NOT.
    //
    // ASSERTS (the CLI-layer invariant the loopback was scoped to):
    //   Two independently-init'd dataDirs produce independent master-key
    //   files and independent sqlite files. A claim stored through
    //   `limen --dataDir dirA remember ...` is NOT surfaced when
    //   `limen --dataDir dirB recall ...` is invoked, because:
    //     1. `--dataDir dirB` makes the CLI resolve master.key to
    //        `dirB/master.key` (not a fallback to dirA or ~/.limen),
    //     2. the engine opens `dirB`'s sqlite file, which has no
    //        record of the dirA claim.
    //   This defeats the prior silent fallback that let dirB read
    //   dirA's claims via `~/.limen/master.key`.
    //
    // DOES NOT ASSERT (F-BR5-001 residual):
    //   That master-key bytes cryptographically gate claim content.
    //   An attacker who copies `dirA/master.key` on top of
    //   `dirB/master.key` is NOT exercised by this test and is NOT
    //   defended against at the CLI layer. That is a filesystem
    //   access-control concern, tracked as F-BR5-001 in the residual
    //   risk register, not a property this test or the loopback
    //   claims to deliver.
    //
    // The test body therefore verifies (a) each dataDir has its own
    // distinct master-key file at 0600 mode, and (b) dirB's recall of
    // a dirA-only subject/predicate returns an empty belief list.
    // Those are the falsifiable claims. Any stronger reading of this
    // test — e.g. "dirB cannot open dirA's database" — was retracted
    // after the F-BR5-001 discovery: that claim is stronger than the
    // implementation delivers and stronger than this body verifies.
    const dirA = mkdtempSync(join(tmpdir(), 'limen-fp01-iso-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'limen-fp01-iso-b-'));
    try {
      const initA = await runCliWithDataDir(dirA, 'init');
      expect(initA.exitCode).toBe(0);
      const initB = await runCliWithDataDir(dirB, 'init');
      expect(initB.exitCode).toBe(0);

      // Assert each dir got its own distinct master key on disk.
      const keyA = statSync(join(dirA, 'master.key'));
      const keyB = statSync(join(dirB, 'master.key'));
      expect(keyA.mode & 0o777).toBe(0o600);
      expect(keyB.mode & 0o777).toBe(0o600);
      const bytesA = readFileSync(join(dirA, 'master.key'));
      const bytesB = readFileSync(join(dirB, 'master.key'));
      expect(bytesA.equals(bytesB)).toBe(false);

      // Store a unique claim in dirA.
      const storeA = await runCliWithDataDir(
        dirA,
        'remember --subject "entity:test:iso-a" --predicate "test.iso" --value "only in A"',
      );
      expect(storeA.exitCode).toBe(0);

      // Recall from dirB — the claim must NOT be present. Even if the
      // recall succeeds (empty result is legal), it must not return the
      // dirA claim. What this verifies is filesystem-scoped isolation:
      // dirB opens its own sqlite file and sees no dirA rows. See
      // F-BR5-001 residual notes above for what this does NOT prove.
      const recallB = await runCliWithDataDir(
        dirB,
        'recall --subject "entity:test:iso-a" --predicate "test.iso"',
      );
      expect(recallB.exitCode).toBe(0);
      const beliefsB = recallB.json as Array<unknown>;
      expect(Array.isArray(beliefsB)).toBe(true);
      expect(beliefsB.length).toBe(0);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('FP-FP01-007: --dataDir "" (literal empty string) rejects with CLI_INVALID_DATADIR', async () => {
    // F-BR4-009: FP-FP01-003 exercised whitespace (" "), leaving the
    // literal empty-string branch un-discriminated. This test hits the
    // exact empty string so a future refactor that handles empty
    // string via Commander's option parsing (e.g. undefined instead of
    // "") cannot pass the suite.
    try {
      const { stdout, stderr } = await execAsync(
        `node ${CLI} --dataDir "" init`,
        { timeout: 15000 },
      );
      throw new Error(`expected rejection, got stdout=${stdout} stderr=${stderr}`);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      expect(e.code).toBe(1);
      const errData = JSON.parse((e.stderr ?? '').trim()) as { error: { code: string } };
      expect(errData.error.code).toBe('CLI_INVALID_DATADIR');
    }
  });

  it('FP-FP01-009: F-BR5-006 — second init on same dataDir is idempotent when master.key exists and is valid', async () => {
    // F-BR5-006: the prior implementation used existsSync() + writeFileSync()
    // which left a TOCTOU window between check and write. The fix switches
    // master.key creation to atomic `flag: 'wx'` (fails with EEXIST if the
    // file exists) and treats EEXIST as idempotent-when-valid.
    //
    // This test exercises the idempotent path: init creates the key on
    // first run, second run observes EEXIST + a valid 32-byte file and
    // reports master.key as `skipped` rather than re-creating.
    const tmpHome = mkdtempSync(join(tmpdir(), 'limen-fp01-idempotent-'));
    try {
      const first = await runCliWithDataDir(tmpHome, 'init');
      expect(first.exitCode).toBe(0);
      const firstJson = first.json as { created: string[]; skipped: string[] };
      expect(firstJson.created).toContain('master.key');

      // Snapshot the key bytes so we can verify the second init did NOT
      // overwrite. This is the discriminating assertion: if EEXIST
      // handling were removed and write used flag 'w' (overwrite), the
      // bytes would change.
      const beforeBytes = readFileSync(join(tmpHome, 'master.key'));
      expect(beforeBytes.length).toBe(32);

      const second = await runCliWithDataDir(tmpHome, 'init');
      expect(second.exitCode).toBe(0);
      const secondJson = second.json as { created: string[]; skipped: string[] };
      // DISCRIMINATIVE: second run must NOT report master.key as created.
      expect(secondJson.created).not.toContain('master.key');
      // And must explicitly report it as skipped.
      expect(secondJson.skipped).toContain('master.key (already exists)');

      const afterBytes = readFileSync(join(tmpHome, 'master.key'));
      expect(afterBytes.equals(beforeBytes)).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('FP-FP01-010: F-BR5-006 — init rejects with CLI_MASTER_KEY_CORRUPTED when existing master.key is not 32 bytes', async () => {
    // F-BR5-006 rejection path: a short/corrupted file at master.key
    // must NOT be silently treated as idempotent. Failing hard at this
    // point prevents the engine from loading a broken credential and
    // producing cryptic downstream errors.
    const tmpHome = mkdtempSync(join(tmpdir(), 'limen-fp01-corrupted-'));
    try {
      // Pre-seed a bogus master.key (0 bytes is a common post-crash state).
      writeFileSync(join(tmpHome, 'master.key'), '', { mode: 0o600 });

      try {
        const { stdout, stderr } = await execAsync(
          `node ${CLI} --dataDir "${tmpHome}" init`,
          { timeout: 15000 },
        );
        throw new Error(`expected rejection, got stdout=${stdout} stderr=${stderr}`);
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        expect(e.code).toBe(1);
        const errData = JSON.parse((e.stderr ?? '').trim()) as { error: { code: string; message: string } };
        expect(errData.error.code).toBe('CLI_MASTER_KEY_CORRUPTED');
        expect(errData.error.message).toContain('Refusing to overwrite');
      }
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('FP-FP01-008: --dataDir pointing at existing file rejects with CLI_DATADIR_NOT_DIRECTORY', async () => {
    // F-BR4-008: prior behavior surfaced raw Node EEXIST through the
    // CLI error envelope. CLI_* taxonomy now covers the case.
    const notDir = join(tmpdir(), `limen-fp01-notadir-${Date.now()}`);
    writeFileSync(notDir, 'not a directory');
    try {
      const { stdout, stderr } = await execAsync(
        `node ${CLI} --dataDir "${notDir}" init`,
        { timeout: 15000 },
      );
      throw new Error(`expected rejection, got stdout=${stdout} stderr=${stderr}`);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      expect(e.code).toBe(1);
      const errData = JSON.parse((e.stderr ?? '').trim()) as { error: { code: string; message: string } };
      expect(errData.error.code).toBe('CLI_DATADIR_NOT_DIRECTORY');
      expect(errData.error.message).toContain('not a directory');
    } finally {
      try { unlinkSync(notDir); } catch { /* best effort */ }
    }
  });
});

describe('F-BR4-004 dispute recomputation (re-derivation)', () => {
  it('FP-FP06-003: 3-claim (s,p) group with auto-contradicts — retracting one leaves survivors disputed by the other', { timeout: 60_000 }, async () => {
    // Re-derivation discriminator #1 (adjusted for engine auto-contradict
    // semantics, which the Breaker reproduction did not fully account for):
    //
    // The engine's autoConflict default creates a pairwise contradicts
    // edge for EVERY pair of claims in the same (subject, predicate)
    // group with different values. So for three claims A, B, C with
    // distinct values, the edge set is {A↔B, A↔C, B↔C} — six
    // directed entries in claim_relationships.
    //
    // Retracting B takes out {A↔B, B↔C} counterpart sides, but A↔C
    // remains with BOTH endpoints active. The correct invariant is:
    // A is still disputed (by C) and C is still disputed (by A).
    //
    // The OLD heuristic returned true whenever `others.length > 0`
    // regardless of which edges existed. The NEW invariant agrees with
    // the engine on this case (both A and C disputed), but for a
    // different REASON — it queries the edges. This test pins both
    // the reason and the outcome: we forget B, then forget A, and
    // assert C FINALLY clears. The heuristic would have claimed C is
    // still disputed because B's tombstone... actually, it would have
    // cleared early because `others.length === 1`. This test therefore
    // discriminates the order in which the flag flips.
    const subj = `entity:test:fp06-003-${Date.now()}`;
    const a = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "value-A"`);
    const b = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "value-B"`);
    const c = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "value-C"`);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(c.exitCode).toBe(0);
    const idA = (a.json as { claimId: string }).claimId;
    const idB = (b.json as { claimId: string }).claimId;
    const idC = (c.json as { claimId: string }).claimId;

    // Sanity: all three carry auto-contradicts edges, so all three are disputed.
    const before = await runCli(`recall --subject "${subj}" --predicate "test.fp06"`);
    expect(before.exitCode).toBe(0);
    const beforeBeliefs = before.json as Array<{ claimId: string; disputed: boolean }>;
    expect(beforeBeliefs.length).toBe(3);
    for (const b of beforeBeliefs) {
      expect(b.disputed).toBe(true);
    }

    // Retract B. Remaining active edges: A↔C. A and C are each disputed
    // by the OTHER, so both remain disputed=true.
    await runCli(`forget --claimId "${idB}"`);
    const afterB = await runCli(`recall --subject "${subj}" --predicate "test.fp06"`);
    const afterBBeliefs = afterB.json as Array<{ claimId: string; disputed: boolean }>;
    expect(afterBBeliefs.length).toBe(2);
    for (const bel of afterBBeliefs) {
      expect(bel.disputed, `after forget(B), ${bel.claimId} should still be disputed via A↔C edge`).toBe(true);
    }

    // Retract A. Remaining live edges touching C: A↔C (counterpart A
    // retracted), B↔C (counterpart B retracted). No live contradictors
    // remain for C. C should clear.
    await runCli(`forget --claimId "${idA}"`);
    const afterA = await runCli(`recall --subject "${subj}" --predicate "test.fp06"`);
    const afterABeliefs = afterA.json as Array<{ claimId: string; disputed: boolean }>;
    expect(afterABeliefs.length).toBe(1);
    expect(afterABeliefs[0]!.claimId).toBe(idC);
    expect(afterABeliefs[0]!.disputed, 'with A and B both retracted, C has zero live contradictors').toBe(false);
  });

  it('FP-FP06-004: 3 contradictors, retract endpoints — middle remains contradicted (rejection path)', { timeout: 60_000 }, async () => {
    // Re-derivation discriminator #2: symmetric case. A↔B and B↔C. Retract A
    // AND C. B had TWO contradictors — both are now retracted. B should
    // clear. (This is the "rejection" of an over-eager heuristic that
    // leaves stale disputes in place because it counted edges instead of
    // live counterparts.)
    const subj = `entity:test:fp06-004-${Date.now()}`;
    const a = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "A"`);
    const b = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "B"`);
    const c = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "C"`);
    const idA = (a.json as { claimId: string }).claimId;
    const idB = (b.json as { claimId: string }).claimId;
    const idC = (c.json as { claimId: string }).claimId;
    await runCli(`connect --from "${idA}" --to "${idB}" --type contradicts`);
    await runCli(`connect --from "${idB}" --to "${idC}" --type contradicts`);

    await runCli(`forget --claimId "${idA}"`);
    await runCli(`forget --claimId "${idC}"`);

    const recall = await runCli(`recall --subject "${subj}" --predicate "test.fp06"`);
    expect(recall.exitCode).toBe(0);
    const beliefs = recall.json as Array<{ claimId: string; disputed: boolean }>;
    const surviving = beliefs.find((x) => x.claimId === idB);
    expect(surviving, 'middle claim B must still be present after endpoints retracted').toBeDefined();
    expect(surviving!.disputed).toBe(false);
  });

  it('FP-FP06-005: 3 claims same (subject, predicate) with IDENTICAL value — no auto-contradicts, none disputed', { timeout: 30_000 }, async () => {
    // Re-derivation discriminator #3: kills the old heuristic directly.
    // Three co-located claims with IDENTICAL value. The engine's
    // autoConflict default creates contradicts edges for same (s, p) with
    // DIFFERENT value — identical values do NOT trigger auto-contradict.
    // The heuristic would have flagged these disputed just because
    // `others.length > 0`. The real invariant: no contradicts edge,
    // no dispute.
    //
    // Note: the engine may de-duplicate identical assertions via its
    // cache; we only assert that whichever claims end up in recall
    // carry disputed=false.
    const subj = `entity:test:fp06-005-${Date.now()}`;
    await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "same-value"`);
    await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "same-value"`);
    await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "same-value"`);

    const recall = await runCli(`recall --subject "${subj}" --predicate "test.fp06"`);
    expect(recall.exitCode).toBe(0);
    const beliefs = recall.json as Array<{ disputed: boolean }>;
    expect(beliefs.length).toBeGreaterThanOrEqual(1);
    for (const b of beliefs) {
      expect(b.disputed).toBe(false);
    }
  });

  it('FP-FP06-006: asserting a claim after contradictors are retracted does not inherit stale disputed flag', { timeout: 60_000 }, async () => {
    // Re-derivation discriminator #4: ordering. Assert A, assert B
    // (auto-contradicts A↔B edge created), forget A AND B. Then assert
    // a new claim C in the same (subject, predicate). C is the ONLY
    // active claim in the group. No live contradictors exist. C must
    // show disputed=false.
    //
    // The OLD heuristic would look at `recall(..., limit: 50)` and
    // return `others.length > 0` — which would also be false here
    // (others is empty). This test therefore does NOT discriminate
    // against the OLD heuristic on its own; it discriminates against a
    // weaker projection that might leave the engine's auto-asserted
    // disputed=false for freshly-inserted C OR miss the case that C has
    // zero edges. The combination with FP-FP06-003/004/005 is what
    // tightens the invariant.
    const subj = `entity:test:fp06-006-${Date.now()}`;
    const a = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "original-A"`);
    const b = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "original-B"`);
    const idA = (a.json as { claimId: string }).claimId;
    const idB = (b.json as { claimId: string }).claimId;

    // Forget both pre-existing claims. Any auto-contradicts edge has
    // its counterparts retracted.
    await runCli(`forget --claimId "${idA}"`);
    await runCli(`forget --claimId "${idB}"`);

    // Now assert C. No claims share the (s, p) actively, so auto-contradict
    // has no other active claim to pair C with. C should be disputed=false.
    const c = await runCli(`remember --subject "${subj}" --predicate "test.fp06" --value "fresh-C"`);
    expect(c.exitCode).toBe(0);
    const idC = (c.json as { claimId: string }).claimId;

    const recall = await runCli(`recall --subject "${subj}" --predicate "test.fp06"`);
    expect(recall.exitCode).toBe(0);
    const beliefs = recall.json as Array<{ claimId: string; disputed: boolean }>;
    const found = beliefs.find((x) => x.claimId === idC);
    expect(found, 'fresh claim C must be present in recall').toBeDefined();
    expect(found!.disputed).toBe(false);
  });
});

describe('F-BR4-005 a2a-send auto-register observability', () => {
  it('DC-BR4-005-001: successful auto-register emits no warning', { timeout: 30_000 }, async () => {
    // Sanity check: the happy path produces no warning on stderr.
    // This is the rejection-path discriminator for the stderr warning —
    // it must NOT fire when auto-register succeeds.
    const freshAgent = `fp-br4-ok-${Date.now()}`;
    const result = await runCli(
      `a2a-send --from "${freshAgent}" --channel "fp-br4-ok-channel" --message "first send"`,
    );
    expect(result.exitCode).toBe(0);
    // stderr must not contain an autoregister warning
    expect(result.stderr).not.toContain('CLI_AGENT_AUTOREGISTER_FAILED');
  });
});
