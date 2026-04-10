/**
 * CLI Phase 4 Commands -- Integration Tests
 *
 * Tests the health-cognitive command via the actual CLI binary
 * using child_process.exec.
 *
 * These are integration tests -- they bootstrap a real Limen engine.
 *
 * Test runner: vitest
 *
 * DC Coverage:
 *   === health-cognitive command ===
 *   DC-CLI-065: health-cognitive returns valid CognitiveHealthReport JSON (success)
 *   DC-CLI-066: health-cognitive report contains all required sections (success)
 *   DC-CLI-067: health-cognitive --gapThresholdDays "abc" rejects with CLI_INVALID_GAP_THRESHOLD (rejection)
 *   DC-CLI-068: health-cognitive --staleThresholdDays "abc" rejects with CLI_INVALID_STALE_THRESHOLD (rejection)
 *   DC-CLI-069: health-cognitive --maxCriticalConflicts "abc" rejects with CLI_INVALID_MAX_CONFLICTS (rejection)
 *   DC-CLI-070: health-cognitive --maxGaps "abc" rejects with CLI_INVALID_MAX_GAPS (rejection)
 *   DC-CLI-071: health-cognitive --maxStaleDomains "abc" rejects with CLI_INVALID_MAX_STALE (rejection)
 *   DC-CLI-072: health-cognitive --gapThresholdDays -5 rejects with CLI_INVALID_GAP_THRESHOLD (rejection)
 *   DC-CLI-073: health-cognitive with valid config flags returns report (success)
 *
 *   === Phase 4 Remediation (F-P4-001, F-P4-002) ===
 *   DC-CLI-082: health-cognitive --staleThresholdDays -1 rejects with CLI_INVALID_STALE_THRESHOLD (rejection)
 *   DC-CLI-083: health-cognitive --maxCriticalConflicts -1 rejects with CLI_INVALID_MAX_CONFLICTS (rejection)
 *   DC-CLI-084: health-cognitive --maxGaps -1 rejects with CLI_INVALID_MAX_GAPS (rejection)
 *   DC-CLI-085: health-cognitive --maxStaleDomains -1 rejects with CLI_INVALID_MAX_STALE (rejection)
 *   DC-CLI-086: health-cognitive --gapThresholdDays 3.7 rejects float input (rejection)
 *   DC-CLI-087: health-cognitive --gapThresholdDays 0x10 rejects hex input (rejection)
 *   DC-CLI-088: health-cognitive --gapThresholdDays 1e5 rejects scientific notation input (rejection)
 *   DC-CLI-074: health-cognitive totalClaims reflects seeded data (success)
 *   DC-CLI-075: health-cognitive freshness distribution sums to totalClaims (invariant)
 *   DC-CLI-076: health-cognitive confidence mean is in [0, 1] range (invariant)
 *   DC-CLI-077: health-cognitive stdout is valid JSON (JSON contract)
 *   DC-CLI-078: health-cognitive stderr is valid JSON on error (JSON contract)
 *   DC-CLI-079: health-cognitive with no claims returns all-zero report (empty state)
 *   DC-CLI-080: health-cognitive --maxGaps 0 returns empty gaps array (boundary)
 *   DC-CLI-081: health-cognitive --maxStaleDomains 0 returns empty staleDomains array (boundary)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);

const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

// Isolated temp directories to prevent global database pollution
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-hc-test-'));
const EMPTY_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-hc-empty-'));
const GLOBAL_OPTS = `--dataDir "${TEST_DATA_DIR}"`;
const EMPTY_OPTS = `--dataDir "${EMPTY_DATA_DIR}"`;

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(EMPTY_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

/**
 * Run a CLI command and return parsed stdout/stderr.
 * Retries on transient engine errors (SQLITE_BUSY, ENGINE_UNHEALTHY).
 */
async function runCli(args: string, retries = 3): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  json: unknown;
}> {
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        combined.includes('not initialized') ||
        combined.includes('Convenience API');
      if (isTransient && attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return result;
    }
  }
  throw new Error('unreachable');
}

// CognitiveHealthReport type for assertion
interface CognitiveHealthReport {
  totalClaims: number;
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    percentFresh: number;
  };
  conflicts: {
    unresolved: number;
    critical: Array<{ claimIds: [string, string]; subject: string }>;
  };
  confidence: {
    mean: number;
    median: number;
    below30: number;
    above90: number;
  };
  gaps: Array<{ domain: string; lastClaimAge: string; significance: string }>;
  staleDomains: Array<{ predicate: string; newestClaimAge: string; claimCount: number }>;
}

// Seed data before tests (using the seeded data dir)
beforeAll(async () => {
  await runCli(
    `${GLOBAL_OPTS} remember --subject "entity:test:hc-001" --predicate "test.cognitive" --value "cognitive health test claim alpha"`,
  );
  await runCli(
    `${GLOBAL_OPTS} remember --subject "entity:test:hc-002" --predicate "test.cognitive" --value "cognitive health test claim beta"`,
  );
  await runCli(
    `${GLOBAL_OPTS} remember --subject "entity:test:hc-003" --predicate "test.other" --value "claim in different predicate domain"`,
  );
});

// =====================================================================
// Success paths
// =====================================================================

describe('limen health-cognitive', () => {
  it('DC-CLI-065: returns valid CognitiveHealthReport JSON', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();
    const report = result.json as CognitiveHealthReport;
    expect(typeof report.totalClaims).toBe('number');
  });

  it('DC-CLI-066: report contains all required sections', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;

    // All 6 top-level sections present
    expect(report).toHaveProperty('totalClaims');
    expect(report).toHaveProperty('freshness');
    expect(report).toHaveProperty('conflicts');
    expect(report).toHaveProperty('confidence');
    expect(report).toHaveProperty('gaps');
    expect(report).toHaveProperty('staleDomains');

    // Freshness sub-fields
    expect(report.freshness).toHaveProperty('fresh');
    expect(report.freshness).toHaveProperty('aging');
    expect(report.freshness).toHaveProperty('stale');
    expect(report.freshness).toHaveProperty('percentFresh');

    // Conflicts sub-fields
    expect(report.conflicts).toHaveProperty('unresolved');
    expect(report.conflicts).toHaveProperty('critical');
    expect(Array.isArray(report.conflicts.critical)).toBe(true);

    // Confidence sub-fields
    expect(report.confidence).toHaveProperty('mean');
    expect(report.confidence).toHaveProperty('median');
    expect(report.confidence).toHaveProperty('below30');
    expect(report.confidence).toHaveProperty('above90');

    // Gaps and staleDomains are arrays
    expect(Array.isArray(report.gaps)).toBe(true);
    expect(Array.isArray(report.staleDomains)).toBe(true);
  });

  it('DC-CLI-073: with valid config flags returns report', async () => {
    const result = await runCli(
      `${GLOBAL_OPTS} health-cognitive --gapThresholdDays 7 --staleThresholdDays 14 --maxCriticalConflicts 5 --maxGaps 3 --maxStaleDomains 3`,
    );
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    expect(typeof report.totalClaims).toBe('number');
    // maxGaps=3 means gaps array length <= 3
    expect(report.gaps.length).toBeLessThanOrEqual(3);
    // maxStaleDomains=3 means staleDomains array length <= 3
    expect(report.staleDomains.length).toBeLessThanOrEqual(3);
  });

  it('DC-CLI-074: totalClaims reflects seeded data', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    // We seeded 3 claims
    expect(report.totalClaims).toBeGreaterThanOrEqual(3);
  });

  it('DC-CLI-075: freshness distribution sums to totalClaims (invariant)', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    const freshnessSum = report.freshness.fresh + report.freshness.aging + report.freshness.stale;
    expect(freshnessSum).toBe(report.totalClaims);
  });

  it('DC-CLI-076: confidence mean is in [0, 1] range (invariant)', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    expect(report.confidence.mean).toBeGreaterThanOrEqual(0);
    expect(report.confidence.mean).toBeLessThanOrEqual(1);
    expect(report.confidence.median).toBeGreaterThanOrEqual(0);
    expect(report.confidence.median).toBeLessThanOrEqual(1);
  });
});

// =====================================================================
// Rejection paths (A21: every validation requires rejection test)
// =====================================================================

describe('limen health-cognitive validation', () => {
  it('DC-CLI-067: --gapThresholdDays "abc" rejects with CLI_INVALID_GAP_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --gapThresholdDays "abc"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_GAP_THRESHOLD');
  });

  it('DC-CLI-068: --staleThresholdDays "abc" rejects with CLI_INVALID_STALE_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --staleThresholdDays "abc"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_STALE_THRESHOLD');
  });

  it('DC-CLI-069: --maxCriticalConflicts "abc" rejects with CLI_INVALID_MAX_CONFLICTS', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxCriticalConflicts "abc"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MAX_CONFLICTS');
  });

  it('DC-CLI-070: --maxGaps "abc" rejects with CLI_INVALID_MAX_GAPS', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxGaps "abc"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MAX_GAPS');
  });

  it('DC-CLI-071: --maxStaleDomains "abc" rejects with CLI_INVALID_MAX_STALE', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxStaleDomains "abc"`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MAX_STALE');
  });

  it('DC-CLI-072: --gapThresholdDays -5 rejects with CLI_INVALID_GAP_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --gapThresholdDays -5`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_GAP_THRESHOLD');
    expect(errData.error.message).toContain('non-negative');
  });

  // F-P4-002: Negative rejection tests for 4 remaining flags (A21 compliance)
  it('DC-CLI-082: --staleThresholdDays -1 rejects with CLI_INVALID_STALE_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --staleThresholdDays -1`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_STALE_THRESHOLD');
    expect(errData.error.message).toContain('non-negative');
  });

  it('DC-CLI-083: --maxCriticalConflicts -1 rejects with CLI_INVALID_MAX_CONFLICTS', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxCriticalConflicts -1`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MAX_CONFLICTS');
    expect(errData.error.message).toContain('non-negative');
  });

  it('DC-CLI-084: --maxGaps -1 rejects with CLI_INVALID_MAX_GAPS', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxGaps -1`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MAX_GAPS');
    expect(errData.error.message).toContain('non-negative');
  });

  it('DC-CLI-085: --maxStaleDomains -1 rejects with CLI_INVALID_MAX_STALE', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxStaleDomains -1`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_MAX_STALE');
    expect(errData.error.message).toContain('non-negative');
  });

  // F-P4-001: parseStrictInt rejects floats, hex, and scientific notation
  it('DC-CLI-086: --gapThresholdDays 3.7 rejects float with CLI_INVALID_GAP_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --gapThresholdDays 3.7`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_GAP_THRESHOLD');
    expect(errData.error.message).toContain('valid integer');
  });

  it('DC-CLI-087: --gapThresholdDays 0x10 rejects hex with CLI_INVALID_GAP_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --gapThresholdDays 0x10`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_GAP_THRESHOLD');
    expect(errData.error.message).toContain('valid integer');
  });

  it('DC-CLI-088: --gapThresholdDays 1e5 rejects scientific notation with CLI_INVALID_GAP_THRESHOLD', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --gapThresholdDays 1e5`);
    expect(result.exitCode).toBe(1);
    const errData = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(errData.error.code).toBe('CLI_INVALID_GAP_THRESHOLD');
    expect(errData.error.message).toContain('valid integer');
  });
});

// =====================================================================
// JSON contract
// =====================================================================

describe('Phase 4 JSON contract', () => {
  it('DC-CLI-077: health-cognitive stdout is valid JSON', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();
    // Double-check: parse stdout directly
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('DC-CLI-078: health-cognitive stderr is valid JSON on error', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --gapThresholdDays "xyz"`);
    expect(result.exitCode).toBe(1);
    expect(() => JSON.parse(result.stderr)).not.toThrow();
  });
});

// =====================================================================
// Edge cases and boundary conditions
// =====================================================================

describe('limen health-cognitive edge cases', () => {
  it('DC-CLI-079: empty database returns all-zero report', async () => {
    const result = await runCli(`${EMPTY_OPTS} health-cognitive`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    expect(report.totalClaims).toBe(0);
    expect(report.freshness.fresh).toBe(0);
    expect(report.freshness.aging).toBe(0);
    expect(report.freshness.stale).toBe(0);
    expect(report.freshness.percentFresh).toBe(0);
    expect(report.conflicts.unresolved).toBe(0);
    expect(report.conflicts.critical).toEqual([]);
    expect(report.confidence.mean).toBe(0);
    expect(report.confidence.median).toBe(0);
    expect(report.gaps).toEqual([]);
    expect(report.staleDomains).toEqual([]);
  });

  it('DC-CLI-080: --maxGaps 0 returns empty gaps array', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxGaps 0`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    expect(report.gaps).toEqual([]);
  });

  it('DC-CLI-081: --maxStaleDomains 0 returns empty staleDomains array', async () => {
    const result = await runCli(`${GLOBAL_OPTS} health-cognitive --maxStaleDomains 0`);
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    expect(report.staleDomains).toEqual([]);
  });
});
