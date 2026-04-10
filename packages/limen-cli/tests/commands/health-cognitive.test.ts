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
 *   DC-CLI-073: health-cognitive with valid config flags returns report (success + discriminative)
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
 *   DC-CLI-080: health-cognitive --maxGaps 0 truncates gaps (boundary, discriminative with aged data)
 *   DC-CLI-081: health-cognitive --maxStaleDomains 0 returns empty staleDomains array (boundary)
 *
 *   === Phase 4 Final Remediation (F-P4-003, F-P4-004, F-P4-006) ===
 *   DC-CLI-089: --gapThresholdDays detects aged claims as gaps (discriminative)
 *   DC-CLI-090: --maxGaps truncates aged gap domains (discriminative)
 *   DC-CLI-091: --maxStaleDomains truncates stale domains with 5 distinct predicates (discriminative)
 *   DC-CLI-092: --maxCriticalConflicts 0 returns empty critical array despite existing conflicts (boundary)
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
const AGED_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-hc-aged-'));
const CONFLICT_DATA_DIR = mkdtempSync(join(tmpdir(), 'limen-hc-conflict-'));
const GLOBAL_OPTS = `--dataDir "${TEST_DATA_DIR}"`;
const EMPTY_OPTS = `--dataDir "${EMPTY_DATA_DIR}"`;
const AGED_OPTS = `--dataDir "${AGED_DATA_DIR}"`;
const CONFLICT_OPTS = `--dataDir "${CONFLICT_DATA_DIR}"`;

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(EMPTY_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(AGED_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(CONFLICT_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
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

/**
 * Seed a claim via `remember` and return its claimId.
 */
async function seedClaim(
  dataOpts: string,
  subject: string,
  predicate: string,
  value: string,
  confidence?: number,
): Promise<string> {
  const confArg = confidence !== undefined ? ` --confidence ${confidence}` : '';
  const result = await runCli(
    `${dataOpts} remember --subject "${subject}" --predicate "${predicate}" --value "${value}"${confArg}`,
  );
  if (result.exitCode !== 0) {
    throw new Error(`seedClaim failed: ${result.stderr}`);
  }
  const parsed = result.json as Record<string, unknown>;
  return parsed?.claimId as string;
}

/**
 * Insert a raw claim directly into the database with a specific valid_at timestamp.
 *
 * This bypasses the normal claim assertion pipeline to set temporal anchors
 * for gap detection and staleness tests. The CCP-I1 immutability trigger
 * prevents UPDATE of valid_at, so we must INSERT directly with the desired
 * timestamp rather than backdating.
 *
 * Requires the database to already exist (bootstrap via `remember` first).
 */
async function seedAgedClaim(
  dataDir: string,
  id: string,
  subject: string,
  predicate: string,
  value: string,
  daysOld: number,
  confidence = 0.7,
): Promise<void> {
  const pastISO = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  const dbPath = join(dataDir, 'limen.db');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  // Write a temp script to avoid shell escaping issues
  const scriptPath = join(dataDir, '_seed_aged.cjs');
  const scriptContent = `
const Database = require('better-sqlite3');
const db = new Database(${JSON.stringify(dbPath)});
db.prepare(
  "INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, source_agent_id, source_mission_id, source_task_id, grounding_mode, runtime_witness, status, archived, created_at) VALUES (?, NULL, ?, ?, 'string', ?, ?, ?, 'test-agent', 'test-mission', NULL, 'runtime_witness', NULL, 'active', 0, ?)"
).run(${JSON.stringify(id)}, ${JSON.stringify(subject)}, ${JSON.stringify(predicate)}, ${JSON.stringify(JSON.stringify(value))}, ${confidence}, ${JSON.stringify(pastISO)}, ${JSON.stringify(pastISO)});
db.close();
`;
  writeFileSync(scriptPath, scriptContent);
  try {
    // Set NODE_PATH so better-sqlite3 can be resolved from workspace root
    const nodeModulesPath = join(import.meta.dirname, '..', '..', '..', '..', 'node_modules');
    await execAsync(`node ${scriptPath}`, { timeout: 10000, env: { ...process.env, NODE_PATH: nodeModulesPath } });
  } finally {
    try { unlinkSync(scriptPath); } catch { /* best effort */ }
  }
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

  // === Aged data dir: 5 distinct predicate domains, all with old validAt ===
  // Used by F-P4-003 (gap detection) and F-P4-004 (stale domain truncation)
  // Bootstrap the database first with a single `remember` call, then
  // insert aged claims directly via SQLite to bypass CCP-I1 immutability.
  await seedClaim(
    AGED_OPTS,
    'entity:test:bootstrap',
    'bootstrap.init',
    'bootstrap claim to initialize database schema',
  );
  const agedDomains = ['alpha.metric', 'beta.metric', 'gamma.metric', 'delta.metric', 'epsilon.metric'];
  for (let i = 0; i < agedDomains.length; i++) {
    await seedAgedClaim(
      AGED_DATA_DIR,
      `aged-claim-${i}`,
      `entity:test:aged-${i}`,
      agedDomains[i],
      `aged claim in domain ${agedDomains[i]}`,
      60, // 60 days old
    );
  }

  // === Conflict data dir: 2 high-confidence contradicting claims ===
  // Used by F-P4-006 (--maxCriticalConflicts 0 boundary)
  // The convenience API caps confidence at 0.7 (DEFAULT_MAX_AUTO_CONFIDENCE),
  // but critical conflicts require confidence >= 0.8. We must seed directly
  // via SQLite to bypass the cap, then create the relationship via CLI `connect`.
  // Bootstrap DB first:
  await seedClaim(
    CONFLICT_OPTS,
    'entity:test:conflict-bootstrap',
    'bootstrap.init',
    'bootstrap claim to initialize database schema',
  );
  // Insert two high-confidence claims directly
  const conflictId1 = 'conflict-claim-001';
  const conflictId2 = 'conflict-claim-002';
  await seedAgedClaim(
    CONFLICT_DATA_DIR,
    conflictId1,
    'entity:test:conflict-subject',
    'test.conflicted',
    'claim A says X is true',
    0, // current time (0 days old)
    0.9, // High confidence -> critical conflict
  );
  await seedAgedClaim(
    CONFLICT_DATA_DIR,
    conflictId2,
    'entity:test:conflict-subject',
    'test.conflicted',
    'claim B says X is false',
    0, // current time (0 days old)
    0.9, // High confidence -> critical conflict
  );
  // Create contradicts relationship between the two high-confidence claims
  await runCli(
    `${CONFLICT_OPTS} connect --from "${conflictId1}" --to "${conflictId2}" --type contradicts`,
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

  it('DC-CLI-073: with valid config flags returns report with observable truncation (discriminative)', async () => {
    // Use AGED_OPTS which has 5 distinct predicate domains with 60-day-old claims.
    // gapThresholdDays=1 ensures all 5 domains are detected as gaps.
    // maxGaps=2 should truncate from 5 to 2.
    // maxStaleDomains=2 should truncate from 5 to 2.
    const result = await runCli(
      `${AGED_OPTS} health-cognitive --gapThresholdDays 1 --staleThresholdDays 14 --maxCriticalConflicts 5 --maxGaps 2 --maxStaleDomains 2`,
    );
    expect(result.exitCode).toBe(0);
    const report = result.json as CognitiveHealthReport;
    expect(typeof report.totalClaims).toBe('number');
    // Discriminative: 5 gap domains exist but maxGaps=2 truncates to exactly 2
    expect(report.gaps.length).toBe(2);
    // Discriminative: 5 stale domains exist but maxStaleDomains=2 truncates to exactly 2
    expect(report.staleDomains.length).toBe(2);
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

  it('DC-CLI-080: --maxGaps 0 truncates gaps that would otherwise exist (discriminative with aged data)', async () => {
    // Use the AGED_OPTS dir which has claims with old validAt timestamps.
    // First verify gaps exist without the flag:
    const baseline = await runCli(`${AGED_OPTS} health-cognitive --gapThresholdDays 1`);
    expect(baseline.exitCode).toBe(0);
    const baseReport = baseline.json as CognitiveHealthReport;
    // Precondition: gaps MUST be non-empty (aged claims are older than 1 day)
    expect(baseReport.gaps.length).toBeGreaterThan(0);

    // Now apply --maxGaps 0 and verify truncation
    const result = await runCli(`${AGED_OPTS} health-cognitive --gapThresholdDays 1 --maxGaps 0`);
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

// =====================================================================
// Phase 4 Final Remediation: F-P4-003, F-P4-004, F-P4-006
// Discriminative tests with aged claim seeding infrastructure
// =====================================================================

describe('limen health-cognitive discriminative gap/stale/conflict tests', () => {
  // F-P4-003: --gapThresholdDays with actual aged claims
  it('DC-CLI-089: --gapThresholdDays detects aged claims as gaps (discriminative)', async () => {
    // With gapThresholdDays=1, all 5 domains (60 days old) should be gaps
    const withGaps = await runCli(`${AGED_OPTS} health-cognitive --gapThresholdDays 1`);
    expect(withGaps.exitCode).toBe(0);
    const reportWithGaps = withGaps.json as CognitiveHealthReport;
    expect(reportWithGaps.gaps.length).toBe(5);

    // With gapThresholdDays=365, no domains should be gaps (all within 365 days)
    const noGaps = await runCli(`${AGED_OPTS} health-cognitive --gapThresholdDays 365`);
    expect(noGaps.exitCode).toBe(0);
    const reportNoGaps = noGaps.json as CognitiveHealthReport;
    expect(reportNoGaps.gaps.length).toBe(0);

    // This test is discriminative: removing --gapThresholdDays support would
    // make both invocations return the same result, failing one assertion.
  });

  // F-P4-003 continued: --maxGaps truncation with real gaps
  it('DC-CLI-090: --maxGaps truncates aged gap domains (discriminative)', async () => {
    // Baseline: 5 gap domains exist with gapThresholdDays=1
    const baseline = await runCli(`${AGED_OPTS} health-cognitive --gapThresholdDays 1`);
    expect(baseline.exitCode).toBe(0);
    const baseReport = baseline.json as CognitiveHealthReport;
    expect(baseReport.gaps.length).toBe(5);

    // maxGaps=3 should truncate to exactly 3
    const truncated = await runCli(`${AGED_OPTS} health-cognitive --gapThresholdDays 1 --maxGaps 3`);
    expect(truncated.exitCode).toBe(0);
    const truncReport = truncated.json as CognitiveHealthReport;
    expect(truncReport.gaps.length).toBe(3);

    // Discriminative: removing maxGaps support would return 5 instead of 3.
  });

  // F-P4-004: --maxStaleDomains with 5+ distinct stale predicate domains
  it('DC-CLI-091: --maxStaleDomains truncates stale domains with 5+ distinct predicates (discriminative)', async () => {
    // Baseline: 5 aged domains + 1 bootstrap domain = 6 stale predicate domains
    // (all never accessed, last_accessed_at=NULL)
    const baseline = await runCli(`${AGED_OPTS} health-cognitive`);
    expect(baseline.exitCode).toBe(0);
    const baseReport = baseline.json as CognitiveHealthReport;
    // Precondition: must have more than 2 stale domains for truncation to be observable
    expect(baseReport.staleDomains.length).toBeGreaterThan(2);
    const fullCount = baseReport.staleDomains.length;

    // maxStaleDomains=2 should truncate to exactly 2
    const truncated = await runCli(`${AGED_OPTS} health-cognitive --maxStaleDomains 2`);
    expect(truncated.exitCode).toBe(0);
    const truncReport = truncated.json as CognitiveHealthReport;
    expect(truncReport.staleDomains.length).toBe(2);

    // Discriminative: removing maxStaleDomains support would return fullCount instead of 2.
    expect(fullCount).toBeGreaterThan(2);
  });

  // F-P4-006: --maxCriticalConflicts 0 boundary
  it('DC-CLI-092: --maxCriticalConflicts 0 returns empty critical array despite existing conflicts (boundary)', async () => {
    // Baseline: verify at least 1 critical conflict exists without the flag
    const baseline = await runCli(`${CONFLICT_OPTS} health-cognitive`);
    expect(baseline.exitCode).toBe(0);
    const baseReport = baseline.json as CognitiveHealthReport;
    // Precondition: critical conflicts must exist (two 0.9-confidence contradicting claims)
    expect(baseReport.conflicts.critical.length).toBeGreaterThan(0);

    // --maxCriticalConflicts 0 should truncate critical to empty
    const zeroed = await runCli(`${CONFLICT_OPTS} health-cognitive --maxCriticalConflicts 0`);
    expect(zeroed.exitCode).toBe(0);
    const zeroReport = zeroed.json as CognitiveHealthReport;
    expect(zeroReport.conflicts.critical).toEqual([]);

    // Discriminative: removing maxCriticalConflicts support would return
    // the non-empty critical array, failing the toEqual([]) assertion.
  });
});
