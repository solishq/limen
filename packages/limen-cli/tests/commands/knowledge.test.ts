/**
 * CLI Knowledge Commands — Integration Tests
 *
 * Tests the 5 Phase 1 knowledge commands (remember, recall, forget, connect, reflect)
 * via the actual CLI binary using child_process.exec.
 *
 * These are integration tests — they bootstrap a real Limen engine.
 * Requires: limen init has been run (~/.limen/ exists).
 *
 * Test runner: Node.js native (tsx --test)
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
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { claimId: string; confidence: number };
    assert.ok(data.claimId, 'claimId must be present');
    assert.equal(typeof data.claimId, 'string');
    assert.equal(typeof data.confidence, 'number');
    assert.ok(data.confidence > 0 && data.confidence <= 1, 'confidence in range');
  });

  it('DC-CLI-002: stores custom confidence', async () => {
    const result = await runCli(
      'remember --subject "entity:test:cli-test-002" --predicate "test.remember" --value "custom confidence" --confidence 0.5',
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { confidence: number };
    assert.equal(data.confidence, 0.5);
  });

  it('DC-CLI-003: stores reasoning', async () => {
    const result = await runCli(
      'remember --subject "entity:test:cli-test-003" --predicate "test.remember" --value "with reasoning" --reasoning "test reason"',
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { claimId: string };
    assert.ok(data.claimId);
  });
});

describe('limen recall', () => {
  it('DC-CLI-004: returns JSON array of beliefs', async () => {
    // First store something
    await runCli(
      'remember --subject "entity:test:cli-recall-004" --predicate "test.recall" --value "recall target"',
    );
    const result = await runCli('recall --subject "entity:test:cli-recall-004"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(Array.isArray(result.json), 'result must be array');
    const beliefs = result.json as Array<{ claimId: string; subject: string; value: string }>;
    assert.ok(beliefs.length > 0, 'must have results');
    assert.equal(beliefs[0]!.subject, 'entity:test:cli-recall-004');
  });

  it('DC-CLI-005: --limit limits results', async () => {
    const result = await runCli('recall --subject "entity:test:*" --limit 1');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const beliefs = result.json as unknown[];
    assert.ok(beliefs.length <= 1, 'must respect limit');
  });

  it('DC-CLI-006: wildcard filtering works', async () => {
    const result = await runCli('recall --subject "entity:test:cli-recall-*"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const beliefs = result.json as Array<{ subject: string }>;
    for (const b of beliefs) {
      assert.ok(b.subject.startsWith('entity:test:cli-recall-'), `subject mismatch: ${b.subject}`);
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
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { retracted: boolean; claimId: string };
    assert.equal(data.retracted, true);
    assert.equal(data.claimId, claimId);
  });

  it('DC-CLI-008: nonexistent ID returns JSON error', async () => {
    const result = await runCli('forget --claimId "nonexistent-claim-id"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    assert.ok(errData.error.message.includes('not found'), `message: ${errData.error.message}`);
  });

  it('DC-CLI-009: invalid reason returns JSON error', async () => {
    const result = await runCli('forget --claimId "some-id" --reason "bogus"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    assert.ok(errData.error.message.includes('Invalid retraction reason'));
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
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { connected: boolean; from: string; to: string; type: string };
    assert.equal(data.connected, true);
    assert.equal(data.from, id1);
    assert.equal(data.to, id2);
    assert.equal(data.type, 'supports');
  });

  it('DC-CLI-011: invalid type returns JSON error', async () => {
    const result = await runCli('connect --from "a" --to "b" --type "invalid"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    assert.ok(errData.error.message.includes('Invalid relationship type'));
  });
});

describe('limen reflect', () => {
  it('DC-CLI-012: stores entries', async () => {
    const entries = JSON.stringify([
      { category: 'finding', statement: 'DC-CLI-012 test finding' },
    ]);
    const result = await runCli(`reflect --entries '${entries}'`);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { stored: number; claimIds: string[] };
    assert.equal(data.stored, 1);
    assert.equal(data.claimIds.length, 1);
  });

  it('DC-CLI-013: invalid JSON returns JSON error', async () => {
    const result = await runCli('reflect --entries "not-valid-json"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { message: string } };
    assert.ok(errData.error.message.includes('Invalid JSON'));
  });

  it('DC-CLI-014: reads entries from file', async () => {
    const tmpFile = join(import.meta.dirname, 'test-entries.json');
    const entries = [{ category: 'pattern', statement: 'DC-CLI-014 file test' }];
    writeFileSync(tmpFile, JSON.stringify(entries), 'utf-8');

    try {
      const result = await runCli(`reflect --file "${tmpFile}"`);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      const data = result.json as { stored: number };
      assert.equal(data.stored, 1);
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
    assert.equal(result.exitCode, 0);
    // If JSON.parse fails, the runCli json field will be null
    assert.notEqual(result.json, null, 'stdout must be valid JSON');
  });

  it('DC-CLI-016: all error stderr is valid JSON', async () => {
    const result = await runCli('forget --claimId "nonexistent"');
    assert.equal(result.exitCode, 1);
    assert.doesNotThrow(() => JSON.parse(result.stderr), 'stderr must be valid JSON');
  });
});
