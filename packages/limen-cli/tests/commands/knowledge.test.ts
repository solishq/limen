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

import { describe, it, expect } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
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

  it('DC-CLI-013: invalid JSON returns JSON error', async () => {
    const result = await runCli('reflect --entries "not-valid-json"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
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
