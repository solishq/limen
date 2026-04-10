/**
 * CLI Phase 2 Commands -- Integration Tests
 *
 * Tests the 3 Phase 2 commands (search, recall-bulk, context)
 * via the actual CLI binary using child_process.exec.
 *
 * These are integration tests -- they bootstrap a real Limen engine.
 * Requires: limen init has been run (~/.limen/ exists).
 *
 * Test runner: Node.js native (tsx --test)
 *
 * DC Coverage:
 *   === search command ===
 *   DC-CLI-031: search returns valid JSON array of results (success)
 *   DC-CLI-032: search --query "" rejects with CLI_INVALID_QUERY (rejection)
 *   DC-CLI-033: search --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-034: search --limit -5 rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-035: search --limit 300 rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-036: search --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-037: search --minConfidence 2 rejects with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-038: search missing --query rejects with CLI_USAGE (rejection)
 *   DC-CLI-039: search results contain belief, relevance, score fields (success)
 *
 *   === recall-bulk command ===
 *   DC-CLI-040: recall-bulk returns JSON array of subject results (success)
 *   DC-CLI-041: recall-bulk --subjects "" rejects with CLI_INVALID_SUBJECTS (rejection)
 *   DC-CLI-042: recall-bulk missing --subjects rejects with CLI_USAGE (rejection)
 *   DC-CLI-043: recall-bulk --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-044: recall-bulk --limit -5 rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-045: recall-bulk --limit 200 rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-046: recall-bulk --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-047: recall-bulk result sets grouped by subject (success)
 *
 *   === context command ===
 *   DC-CLI-048: context --format json returns JSON array of beliefs (success)
 *   DC-CLI-049: context --format text returns text block (success)
 *   DC-CLI-050: context --format "bogus" rejects with CLI_INVALID_FORMAT (rejection)
 *   DC-CLI-051: context --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-052: context --limit -5 rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-053: context --limit 200 rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-054: context --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-055: context default (no --format) returns text format (success)
 *   DC-CLI-056: context with no results returns "No relevant beliefs" text (success)
 *
 *   === JSON contract ===
 *   DC-CLI-057: all Phase 2 stdout is valid JSON (success)
 *   DC-CLI-058: all Phase 2 stderr is valid JSON (rejection)
 *
 *   === Certifier P2 fixes ===
 *   DC-CLI-059: forget --reason "bogus" returns CLI_INVALID_REASON code (regression fix)
 *   DC-CLI-060: connect --type "bogus" returns CLI_INVALID_TYPE code (regression fix)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
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

// Seed data before tests
before(async () => {
  await runCli(
    'remember --subject "entity:test:search-001" --predicate "test.search" --value "the quick brown fox jumps over the lazy dog"',
  );
  await runCli(
    'remember --subject "entity:test:search-002" --predicate "test.search" --value "a lazy cat sleeps on the warm windowsill"',
  );
  await runCli(
    'remember --subject "entity:test:bulk-001" --predicate "test.bulk" --value "bulk recall target alpha"',
  );
  await runCli(
    'remember --subject "entity:test:bulk-002" --predicate "test.bulk" --value "bulk recall target beta"',
  );
  await runCli(
    'remember --subject "entity:test:context-001" --predicate "test.context" --value "context generation target"',
  );
});

// ═══════════════════════════════════════════════════════════════════════
// search command
// ═══════════════════════════════════════════════════════════════════════

describe('limen search', () => {
  it('DC-CLI-031: returns valid JSON array of search results', async () => {
    const result = await runCli('search --query "lazy"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(Array.isArray(result.json), 'result must be array');
  });

  it('DC-CLI-039: results contain belief, relevance, score fields', async () => {
    const result = await runCli('search --query "lazy"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const results = result.json as Array<{ belief: unknown; relevance: number; score: number }>;
    if (results.length > 0) {
      const first = results[0]!;
      assert.ok('belief' in first, 'must have belief field');
      assert.ok('relevance' in first, 'must have relevance field');
      assert.ok('score' in first, 'must have score field');
      assert.equal(typeof first.relevance, 'number');
      assert.equal(typeof first.score, 'number');
    }
  });

  it('DC-CLI-032: --query whitespace-only rejects with CLI_INVALID_QUERY', async () => {
    const result = await runCli('search --query "   "');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_QUERY');
    assert.ok(errData.error.message.includes('empty'));
  });

  it('DC-CLI-033: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('search --query "test" --limit "abc"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-034: --limit -5 rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('search --query "test" --limit -5');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-035: --limit 300 rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('search --query "test" --limit 300');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-036: --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('search --query "test" --minConfidence "abc"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_CONFIDENCE');
  });

  it('DC-CLI-037: --minConfidence 2 rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('search --query "test" --minConfidence 2');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_CONFIDENCE');
  });

  it('DC-CLI-038: missing --query rejects with CLI_USAGE', async () => {
    const result = await runCli('search');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_USAGE');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// recall-bulk command
// ═══════════════════════════════════════════════════════════════════════

describe('limen recall-bulk', () => {
  it('DC-CLI-040: returns JSON array of subject results', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:bulk-001,entity:test:bulk-002"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(Array.isArray(result.json), 'result must be array');
    const data = result.json as Array<{ subject: string; beliefs: unknown[] }>;
    assert.equal(data.length, 2, 'must have 2 result sets');
  });

  it('DC-CLI-047: result sets grouped by subject', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:bulk-001,entity:test:bulk-002"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as Array<{ subject: string; beliefs: unknown[] }>;
    assert.equal(data[0]!.subject, 'entity:test:bulk-001');
    assert.equal(data[1]!.subject, 'entity:test:bulk-002');
  });

  it('DC-CLI-041: --subjects empty rejects with CLI_INVALID_SUBJECTS', async () => {
    const result = await runCli('recall-bulk --subjects ","');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_SUBJECTS');
  });

  it('DC-CLI-042: missing --subjects rejects with CLI_USAGE', async () => {
    const result = await runCli('recall-bulk');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_USAGE');
  });

  it('DC-CLI-043: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:x" --limit "abc"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-044: --limit -5 rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:x" --limit -5');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-045: --limit 200 rejects with CLI_INVALID_LIMIT (max 100)', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:x" --limit 200');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-046: --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:x" --minConfidence "abc"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_CONFIDENCE');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// context command
// ═══════════════════════════════════════════════════════════════════════

describe('limen context', () => {
  it('DC-CLI-048: --format json returns JSON array of beliefs', async () => {
    const result = await runCli('context --subject "entity:test:context-001" --format json');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(Array.isArray(result.json), 'json format result must be array');
  });

  it('DC-CLI-049: --format text returns text block', async () => {
    const result = await runCli('context --subject "entity:test:context-001" --format text');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { text: string };
    assert.ok(typeof data.text === 'string', 'text format must have text field');
    assert.ok(data.text.includes('Knowledge Context'), 'must include header');
  });

  it('DC-CLI-055: default (no --format) returns text format', async () => {
    const result = await runCli('context --subject "entity:test:context-001"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { text: string };
    assert.ok(typeof data.text === 'string', 'default format must have text field');
  });

  it('DC-CLI-056: with no results returns "No relevant beliefs" text', async () => {
    const result = await runCli('context --subject "entity:nonexistent:nothing-here-12345"');
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const data = result.json as { text: string };
    assert.ok(data.text.includes('No relevant beliefs'), `got: ${data.text}`);
  });

  it('DC-CLI-050: --format "bogus" rejects with CLI_INVALID_FORMAT', async () => {
    const result = await runCli('context --format "bogus"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_FORMAT');
  });

  it('DC-CLI-051: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('context --limit "abc"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-052: --limit -5 rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('context --limit -5');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-053: --limit 200 rejects with CLI_INVALID_LIMIT (max 100)', async () => {
    const result = await runCli('context --limit 200');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_LIMIT');
  });

  it('DC-CLI-054: --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('context --minConfidence "abc"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_CONFIDENCE');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// JSON contract for Phase 2
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 2 JSON contract', () => {
  it('DC-CLI-057: all Phase 2 success stdout is valid JSON', async () => {
    const result = await runCli('search --query "test"');
    assert.equal(result.exitCode, 0);
    assert.notEqual(result.json, null, 'stdout must be valid JSON');
  });

  it('DC-CLI-058: all Phase 2 error stderr is valid JSON', async () => {
    const result = await runCli('search --query "test" --limit "abc"');
    assert.equal(result.exitCode, 1);
    assert.doesNotThrow(() => JSON.parse(result.stderr), 'stderr must be valid JSON');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Certifier P2 fixes (F-CERT-001, F-CERT-002)
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 1 Certifier fixes', () => {
  it('DC-CLI-059: forget --reason "bogus" returns CLI_INVALID_REASON code', async () => {
    const result = await runCli('forget --claimId "some-id" --reason "bogus"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_REASON');
  });

  it('DC-CLI-060: connect --type "bogus" returns CLI_INVALID_TYPE code', async () => {
    const result = await runCli('connect --from "a" --to "b" --type "bogus"');
    assert.equal(result.exitCode, 1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    assert.equal(errData.error.code, 'CLI_INVALID_TYPE');
  });
});
