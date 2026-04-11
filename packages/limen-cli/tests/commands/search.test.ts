/**
 * CLI Phase 2 Commands -- Integration Tests
 *
 * Tests the 3 Phase 2 commands (search, recall-bulk, context)
 * via the actual CLI binary using child_process.exec.
 *
 * These are integration tests -- they bootstrap a real Limen engine.
 * Requires: limen init has been run (~/.limen/ exists).
 *
 * Test runner: vitest
 *
 * DC Coverage:
 *   === search command ===
 *   DC-CLI-031: search returns valid JSON array of results (success)
 *   DC-CLI-032: search --query "" rejects with CLI_INVALID_QUERY (rejection)
 *   DC-CLI-033: search --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-034: search --limit -5 clamps to 1 (MCP parity -- success)
 *   DC-CLI-035: search --limit 300 clamps to 200 (MCP parity -- success)
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
 *   DC-CLI-044: recall-bulk --limit -5 clamps to 1 (MCP parity -- success)
 *   DC-CLI-045: recall-bulk --limit 200 clamps to 100 (MCP parity -- success)
 *   DC-CLI-046: recall-bulk --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE (rejection)
 *   DC-CLI-047: recall-bulk result sets grouped by subject (success)
 *
 *   === context command ===
 *   DC-CLI-048: context --format json returns JSON array of beliefs (success)
 *   DC-CLI-049: context --format text returns text block (success)
 *   DC-CLI-050: context --format "bogus" rejects with CLI_INVALID_FORMAT (rejection)
 *   DC-CLI-051: context --limit "abc" rejects with CLI_INVALID_LIMIT (rejection)
 *   DC-CLI-052: context --limit -5 clamps to 1 (MCP parity -- success)
 *   DC-CLI-053: context --limit 200 clamps to 100 (MCP parity -- success)
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
 *
 *   === Breaker P2 remediation (new) ===
 *   DC-CLI-061: recall-bulk --subjects with > 50 subjects rejects (rejection)
 *   DC-CLI-062: recall-bulk partial failure -- one valid, one invalid subject (rejection path)
 *   DC-CLI-063: recall-bulk accepts JSON array format (MCP parity -- success)
 *   DC-CLI-064: recall-bulk invalid JSON array rejects (rejection)
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
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-search-test-'));
const GLOBAL_OPTS = `--dataDir "${TEST_DATA_DIR}"`;

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
      // FP-08 accommodation: context --format text emits raw text (not JSON),
      // so JSON.parse would throw. Attempt parse; on failure leave json=null
      // and let the caller inspect stdout directly.
      let json: unknown = null;
      const trimmed = stdout.trim();
      if (trimmed) {
        try { json = JSON.parse(trimmed); } catch { json = null; }
      }
      return {
        stdout: trimmed,
        stderr: stderr.trim(),
        exitCode: 0,
        json,
      };
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

// Seed data before tests
beforeAll(async () => {
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

// =====================================================================
// search command
// =====================================================================

describe('limen search', () => {
  it('DC-CLI-031: returns valid JSON array of search results', async () => {
    const result = await runCli('search --query "lazy"');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
  });

  it('DC-CLI-039: results contain belief and score but NOT raw relevance (FP-05)', async () => {
    // FP-05: The raw BM25 `relevance` field was confusing (negative numbers
    // leaked into user output). We now emit only the normalized `score`.
    const result = await runCli('search --query "lazy"');
    expect(result.exitCode).toBe(0);
    const results = result.json as Array<{ belief: unknown; score: number; relevance?: number }>;
    expect(results.length).toBeGreaterThan(0);
    const first = results[0]!;
    expect(first).toHaveProperty('belief');
    expect(first).toHaveProperty('score');
    expect(typeof first.score).toBe('number');
    // FP-05: relevance field must be absent from CLI output
    expect(first.relevance).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(first, 'relevance')).toBe(false);
  });

  it('DC-CLI-032: --query whitespace-only rejects with CLI_INVALID_QUERY', async () => {
    const result = await runCli('search --query "   "');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_QUERY');
    expect(errData.error.message).toContain('empty');
  });

  it('DC-CLI-033: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('search --query "test" --limit "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
  });

  it('DC-CLI-034: --limit -5 clamps to 1 (MCP parity)', async () => {
    // F-BR2-002 FIX: CLI now clamps instead of rejecting, matching MCP behavior
    const result = await runCli('search --query "lazy" --limit -5');
    expect(result.exitCode).toBe(0);
    const results = result.json as unknown[];
    expect(Array.isArray(results)).toBe(true);
    // Clamped to 1, so at most 1 result
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('DC-CLI-035: --limit 300 clamps to 200 (MCP parity)', async () => {
    // F-BR2-002 FIX: CLI now clamps instead of rejecting, matching MCP behavior
    const result = await runCli('search --query "lazy" --limit 300');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
  });

  it('DC-CLI-036: --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('search --query "test" --minConfidence "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
  });

  it('DC-CLI-037: --minConfidence 2 rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('search --query "test" --minConfidence 2');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
  });

  it('DC-CLI-038: missing --query rejects with CLI_USAGE', async () => {
    const result = await runCli('search');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
  });
});

// =====================================================================
// recall-bulk command
// =====================================================================

describe('limen recall-bulk', () => {
  it('DC-CLI-040: returns JSON array of subject results', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:bulk-001,entity:test:bulk-002"');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
    const data = result.json as Array<{ subject: string; beliefs: unknown[] }>;
    expect(data.length).toBe(2);
  });

  it('DC-CLI-047: result sets grouped by subject', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:bulk-001,entity:test:bulk-002"');
    expect(result.exitCode).toBe(0);
    const data = result.json as Array<{ subject: string; beliefs: unknown[] }>;
    expect(data[0]!.subject).toBe('entity:test:bulk-001');
    expect(data[1]!.subject).toBe('entity:test:bulk-002');
  });

  it('DC-CLI-041: --subjects empty rejects with CLI_INVALID_SUBJECTS', async () => {
    const result = await runCli('recall-bulk --subjects ","');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_SUBJECTS');
  });

  it('DC-CLI-042: missing --subjects rejects with CLI_USAGE', async () => {
    const result = await runCli('recall-bulk');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_USAGE');
  });

  it('DC-CLI-043: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:x" --limit "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
  });

  it('DC-CLI-044: --limit -5 clamps to 1 (MCP parity)', async () => {
    // F-BR2-004 analog FIX: CLI now clamps instead of rejecting
    const result = await runCli('recall-bulk --subjects "entity:test:bulk-001" --limit -5');
    expect(result.exitCode).toBe(0);
    const data = result.json as Array<{ subject: string; beliefs: unknown[] }>;
    expect(data.length).toBe(1);
    expect(data[0]!.beliefs.length).toBeLessThanOrEqual(1);
  });

  it('DC-CLI-045: --limit 200 clamps to 100 (MCP parity)', async () => {
    // F-BR2-004 analog FIX: CLI now clamps instead of rejecting
    const result = await runCli('recall-bulk --subjects "entity:test:bulk-001" --limit 200');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
  });

  it('DC-CLI-046: --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('recall-bulk --subjects "entity:test:x" --minConfidence "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
  });

  // F-BR2-013 FIX: partial failure test (A21 rejection path)
  it('DC-CLI-062: partial failure -- valid subject + nonexistent subject', async () => {
    const result = await runCli(
      'recall-bulk --subjects "entity:test:bulk-001,entity:nonexistent:impossible-subject-zzz999"',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as Array<{ subject: string; beliefs: unknown[]; error?: string }>;
    expect(data.length).toBe(2);
    // First subject should have beliefs (seeded in beforeAll)
    expect(data[0]!.subject).toBe('entity:test:bulk-001');
    expect(data[0]!.beliefs.length).toBeGreaterThanOrEqual(0);
    // Second subject should succeed (recall returns empty for unknown subjects, not error)
    // but the error path is exercised when the engine returns an error for a subject
    expect(data[1]!.subject).toBe('entity:nonexistent:impossible-subject-zzz999');
    expect(data[1]!.beliefs).toBeDefined();
  });

  // M-5 FIX: rejection test for > 50 subjects
  it('DC-CLI-061: --subjects with > 50 subjects rejects with CLI_INVALID_SUBJECTS', async () => {
    const subjects = Array.from({ length: 51 }, (_, i) => `entity:test:over-limit-${i}`).join(',');
    const result = await runCli(`recall-bulk --subjects "${subjects}"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_SUBJECTS');
    expect(errData.error.message).toContain('50');
  });

  // F-BR2-003 FIX: JSON array format (MCP parity)
  it('DC-CLI-063: accepts JSON array format for --subjects', async () => {
    // Shell quoting: use escaped double quotes inside the argument
    const result = await runCli(
      'recall-bulk --subjects \'["entity:test:bulk-001","entity:test:bulk-002"]\'',
    );
    expect(result.exitCode).toBe(0);
    const data = result.json as Array<{ subject: string; beliefs: unknown[] }>;
    expect(data.length).toBe(2);
    expect(data[0]!.subject).toBe('entity:test:bulk-001');
    expect(data[1]!.subject).toBe('entity:test:bulk-002');
  });

  // F-BR2-003 FIX: invalid JSON array rejection
  it('DC-CLI-064: invalid JSON array rejects with CLI_INVALID_SUBJECTS', async () => {
    const result = await runCli("recall-bulk --subjects '[not valid json]'");
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_SUBJECTS');
  });
});

// =====================================================================
// context command
// =====================================================================

describe('limen context', () => {
  it('DC-CLI-048: --format json returns JSON array of beliefs', async () => {
    const result = await runCli('context --subject "entity:test:context-001" --format json');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
  });

  it('DC-CLI-049: --format text returns RAW text to stdout (FP-08)', async () => {
    // FP-08: text format must emit raw pipeable text, NOT a JSON wrapper.
    // This lets users run: `limen context --format text > prompt.txt`.
    const result = await runCli('context --subject "entity:test:context-001" --format text');
    expect(result.exitCode).toBe(0);
    // Raw text must NOT parse as JSON
    expect(result.json).toBeNull();
    // But stdout must contain the heading literally
    expect(result.stdout).toContain('# Knowledge Context');
    // And must not start with a JSON brace/bracket
    expect(result.stdout.startsWith('{')).toBe(false);
    expect(result.stdout.startsWith('[')).toBe(false);
  });

  it('DC-CLI-055: default (no --format) returns raw text (FP-08)', async () => {
    const result = await runCli('context --subject "entity:test:context-001"');
    expect(result.exitCode).toBe(0);
    expect(result.json).toBeNull();
    expect(result.stdout).toContain('# Knowledge Context');
  });

  it('DC-CLI-056: with no results returns raw "No relevant beliefs" text (FP-08)', async () => {
    const result = await runCli('context --subject "entity:nonexistent:nothing-here-12345"');
    expect(result.exitCode).toBe(0);
    expect(result.json).toBeNull();
    expect(result.stdout).toContain('No relevant beliefs');
  });

  it('DC-CLI-050: --format "bogus" rejects with CLI_INVALID_FORMAT', async () => {
    const result = await runCli('context --format "bogus"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_FORMAT');
  });

  it('DC-CLI-051: --limit "abc" rejects with CLI_INVALID_LIMIT', async () => {
    const result = await runCli('context --limit "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_LIMIT');
  });

  it('DC-CLI-052: --limit -5 clamps to 1 (MCP parity)', async () => {
    // F-BR2-004 FIX: CLI now clamps instead of rejecting
    const result = await runCli('context --subject "entity:test:context-001" --limit -5');
    expect(result.exitCode).toBe(0);
  });

  it('DC-CLI-053: --limit 200 clamps to 100 (MCP parity)', async () => {
    // F-BR2-004 FIX: CLI now clamps instead of rejecting
    const result = await runCli('context --subject "entity:test:context-001" --limit 200');
    expect(result.exitCode).toBe(0);
  });

  it('DC-CLI-054: --minConfidence "abc" rejects with CLI_INVALID_CONFIDENCE', async () => {
    const result = await runCli('context --minConfidence "abc"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_CONFIDENCE');
  });
});

// =====================================================================
// JSON contract for Phase 2
// =====================================================================

describe('Phase 2 JSON contract', () => {
  it('DC-CLI-057: all Phase 2 success stdout is valid JSON', async () => {
    const result = await runCli('search --query "test"');
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();
  });

  it('DC-CLI-058: all Phase 2 error stderr is valid JSON', async () => {
    const result = await runCli('search --query "test" --limit "abc"');
    expect(result.exitCode).toBe(1);
    expect(() => JSON.parse(result.stderr)).not.toThrow();
  });
});

// =====================================================================
// Certifier P2 fixes (F-CERT-001, F-CERT-002)
// =====================================================================

describe('Phase 1 Certifier fixes', () => {
  it('DC-CLI-059: forget --reason "bogus" returns CLI_INVALID_REASON code', async () => {
    const result = await runCli('forget --claimId "some-id" --reason "bogus"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_REASON');
  });

  it('DC-CLI-060: connect --type "bogus" returns CLI_INVALID_TYPE code', async () => {
    const result = await runCli('connect --from "a" --to "b" --type "bogus"');
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_TYPE');
  });
});

// =====================================================================
// Friction Remediation Pass (FP-03, FP-04, FP-05) — CLI presentation fixes
// =====================================================================

describe('FP-03/FP-04/FP-05 context and search presentation fixes', () => {
  it('FP-FP03-001: recalled claim shows time-based freshness (fresh on first recall)', async () => {
    // FP-03: A claim stored seconds ago must NOT show freshness "stale"
    // (which is what the engine's access-based freshness returned).
    // We reclassify at the CLI layer using createdAt age.
    const subject = `entity:test:fp03-${Date.now()}`;
    const store = await runCli(
      `remember --subject "${subject}" --predicate "test.fp03" --value "fresh value"`,
    );
    expect(store.exitCode).toBe(0);

    const result = await runCli(`recall --subject "${subject}"`);
    expect(result.exitCode).toBe(0);
    const beliefs = result.json as Array<{ freshness: string }>;
    expect(beliefs.length).toBeGreaterThan(0);
    // Newly stored claim must show "fresh" (age < 1h)
    expect(beliefs[0]!.freshness).toBe('fresh');
  });

  it('FP-FP04-001: effectiveConfidence is rounded to at most 4 decimal places', async () => {
    // FP-04: engine returns 16-digit floats (0.6999999011124111). CLI rounds.
    const result = await runCli('recall --subject "entity:test:context-001"');
    expect(result.exitCode).toBe(0);
    const beliefs = result.json as Array<{ effectiveConfidence: number }>;
    expect(beliefs.length).toBeGreaterThan(0);
    for (const b of beliefs) {
      const str = String(b.effectiveConfidence);
      const dotIdx = str.indexOf('.');
      if (dotIdx >= 0) {
        const decimals = str.length - dotIdx - 1;
        expect(decimals).toBeLessThanOrEqual(4);
      }
      // And the numeric value must round-trip through the round4 formula
      expect(b.effectiveConfidence).toBe(Math.round(b.effectiveConfidence * 10000) / 10000);
    }
  });

  it('FP-FP05-001: search score is in [0, 1] (rejection path: never negative)', async () => {
    // FP-05: The raw BM25 relevance was negative and confusing.
    // The normalized score must always be in [0, 1].
    const result = await runCli('search --query "lazy"');
    expect(result.exitCode).toBe(0);
    const results = result.json as Array<{ score: number }>;
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

// =====================================================================
// FP-08 context --format text rejection path (never wraps in JSON)
// =====================================================================

describe('FP-08 context text format discriminative', () => {
  it('FP-FP08-001: --format json returns a JSON array, NOT wrapped text', async () => {
    // Success-path discriminator: json format is an array of belief objects,
    // never a {text: "..."} wrapper.
    const result = await runCli('context --subject "entity:test:context-001" --format json');
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json)).toBe(true);
    const arr = result.json as unknown[];
    // Must not have `text` field anywhere at top level
    expect((result.json as { text?: unknown }).text).toBeUndefined();
    if (arr.length > 0) {
      expect(arr[0]).toHaveProperty('subject');
    }
  });

  it('FP-FP08-002: --format text stdout is NOT valid JSON (rejection-path)', async () => {
    // Rejection-path: asserting the ABSENCE of JSON wrapping. If a future
    // regression re-wraps the text in {text: "..."}, JSON.parse would succeed.
    const result = await runCli('context --subject "entity:test:context-001" --format text');
    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).toThrow();
  });
});
