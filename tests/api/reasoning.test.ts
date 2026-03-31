/**
 * Phase 5: Reasoning Integration Tests.
 *
 * Tests reasoning field through the full pipeline:
 *   - remember() with reasoning -> recall() returns reasoning
 *   - reasoning length validation
 *   - reasoning immutability (CCP-I1 trigger)
 *   - reasoning in 1-param remember() form
 *   - cognitive.health() integration
 *
 * DCs covered: DC-P5-101, DC-P5-102, DC-P5-103
 * Invariants: I-P5-01, I-P5-02, I-P5-07
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ─── Test Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-reasoning-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

function trackInstance(limen: Limen): Limen {
  instancesToShutdown.push(limen);
  return limen;
}

afterEach(async () => {
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* already shut down */ }
  }
  instancesToShutdown.length = 0;
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  dirsToClean.length = 0;
});

async function createTestLimen(): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  return trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
    }),
  );
}

/** Create test Limen AND return the data directory (for direct DB access). */
async function createTestLimenWithDir(): Promise<{ limen: Limen; dir: string }> {
  const dir = trackDir(makeTempDir());
  const limen = trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
    }),
  );
  return { limen, dir };
}

// ============================================================================
// DC-P5-101 / I-P5-02: Reasoning round-trip (remember -> recall)
// ============================================================================

describe('Phase 5: reasoning round-trip (I-P5-02)', () => {
  it('DC-P5-101 success: remember() with reasoning -> recall() returns it', async () => {
    const limen = await createTestLimen();
    const reasoning = 'This is the reasoning for this claim.';

    const remResult = limen.remember(
      'entity:test:reason1',
      'test.fact',
      'some value',
      { reasoning },
    );
    assert.equal(remResult.ok, true);
    if (!remResult.ok) return;

    const recResult = limen.recall('entity:test:reason1', 'test.fact');
    assert.equal(recResult.ok, true);
    if (!recResult.ok) return;

    assert.equal(recResult.value.length, 1);
    assert.equal(recResult.value[0]!.reasoning, reasoning);
  });

  it('DC-P5-101: remember() without reasoning -> recall() returns null reasoning', async () => {
    const limen = await createTestLimen();

    const remResult = limen.remember('entity:test:noreason', 'test.fact', 'value');
    assert.equal(remResult.ok, true);

    const recResult = limen.recall('entity:test:noreason', 'test.fact');
    assert.equal(recResult.ok, true);
    if (!recResult.ok) return;

    assert.equal(recResult.value.length, 1);
    assert.equal(recResult.value[0]!.reasoning, null);
  });

  it('DC-P5-101: 1-param remember() with reasoning flows through', async () => {
    const limen = await createTestLimen();
    const reasoning = 'Auto-generated observation with reasoning.';

    const remResult = limen.remember('some observation text', { reasoning });
    assert.equal(remResult.ok, true);
    if (!remResult.ok) return;

    // Recall by the generated claim ID
    const recResult = limen.recall(undefined, 'observation.note');
    assert.equal(recResult.ok, true);
    if (!recResult.ok) return;

    // Find the claim we just created
    const belief = recResult.value.find(b => b.reasoning === reasoning);
    assert.ok(belief, 'Should find the claim with our reasoning');
    assert.equal(belief!.reasoning, reasoning);
  });

  it('DC-P5-101: empty string reasoning is preserved (not treated as null)', async () => {
    const limen = await createTestLimen();

    const remResult = limen.remember(
      'entity:test:emptyreason',
      'test.fact',
      'value',
      { reasoning: '' },
    );
    assert.equal(remResult.ok, true);

    const recResult = limen.recall('entity:test:emptyreason', 'test.fact');
    assert.equal(recResult.ok, true);
    if (!recResult.ok) return;

    // Empty string is still stored as reasoning (not null)
    assert.equal(recResult.value.length, 1);
    assert.equal(recResult.value[0]!.reasoning, '');
  });
});

// ============================================================================
// DC-P5-103 / I-P5-07: Reasoning length validation [A21]
// ============================================================================

describe('Phase 5: reasoning length validation (I-P5-07) [A21]', () => {
  it('DC-P5-103 success: reasoning at exactly 1000 chars succeeds', async () => {
    const limen = await createTestLimen();
    const reasoning = 'x'.repeat(1000);

    const result = limen.remember(
      'entity:test:maxreason',
      'test.fact',
      'value',
      { reasoning },
    );
    assert.equal(result.ok, true);
  });

  it('DC-P5-103 rejection: reasoning exceeding 1000 chars returns CONV_REASONING_TOO_LONG', async () => {
    const limen = await createTestLimen();
    const reasoning = 'x'.repeat(1001);

    const result = limen.remember(
      'entity:test:longreason',
      'test.fact',
      'value',
      { reasoning },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'CONV_REASONING_TOO_LONG');
  });

  it('DC-P5-103 rejection: no claim created when reasoning too long', async () => {
    const limen = await createTestLimen();
    const reasoning = 'x'.repeat(1001);

    limen.remember('entity:test:longfail', 'test.fact', 'value', { reasoning });

    // Verify no claim was created
    const recResult = limen.recall('entity:test:longfail', 'test.fact');
    assert.equal(recResult.ok, true);
    if (!recResult.ok) return;
    assert.equal(recResult.value.length, 0);
  });
});

// ============================================================================
// DC-P5-102 / I-P5-01: Reasoning immutability (CCP-I1 trigger) [A21]
// ============================================================================

describe('Phase 5: reasoning immutability (I-P5-01) [A21]', () => {
  it('DC-P5-102 success: INSERT with reasoning succeeds', async () => {
    const limen = await createTestLimen();

    const result = limen.remember(
      'entity:test:immut',
      'test.fact',
      'value',
      { reasoning: 'original reasoning' },
    );
    assert.equal(result.ok, true);
  });

  it('DC-P5-102 rejection: direct SQL UPDATE of reasoning is blocked by CCP-I1 trigger', async () => {
    // F-P5-003 fix: Previous test only read the claim back, never attempted UPDATE.
    // This test opens the DB directly and attempts UPDATE on reasoning column,
    // asserting the CCP-I1 immutability trigger fires.
    const { limen, dir } = await createTestLimenWithDir();

    const remResult = limen.remember(
      'entity:test:immut2',
      'test.fact',
      'value',
      { reasoning: 'original' },
    );
    assert.equal(remResult.ok, true);
    if (!remResult.ok) return;

    const claimId = remResult.value.claimId;

    // Open DB directly and attempt UPDATE on reasoning
    const dbPath = join(dir, 'limen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      assert.throws(
        () => db.prepare(
          `UPDATE claim_assertions SET reasoning = ? WHERE id = ?`,
        ).run('tampered reasoning', claimId),
        (err: Error) => err.message.includes('CCP-I1'),
        'UPDATE reasoning must be blocked by CCP-I1 immutability trigger',
      );
    } finally {
      db.close();
    }

    // Verify the reasoning is still the original
    const recResult = limen.recall('entity:test:immut2', 'test.fact');
    assert.equal(recResult.ok, true);
    if (!recResult.ok) return;
    assert.equal(recResult.value[0]!.reasoning, 'original');
  });
});

// ============================================================================
// DC-P5-601: Migration trigger recreation [A21]
// ============================================================================

describe('Phase 5: migration trigger protection (DC-P5-601)', () => {
  it('DC-P5-601 success: existing content immutability still works after migration', async () => {
    const limen = await createTestLimen();

    const r = limen.remember('entity:test:trigger', 'test.fact', 'value');
    assert.equal(r.ok, true);

    const rec = limen.recall('entity:test:trigger', 'test.fact');
    assert.equal(rec.ok, true);
    if (!rec.ok) return;
    assert.equal(rec.value[0]!.subject, 'entity:test:trigger');
  });

  it('DC-P5-601 rejection: direct SQL UPDATE of subject is blocked by CCP-I1 trigger after migration', async () => {
    // F-P5-008 fix: Previous test never attempted UPDATE to verify the trigger fires.
    // This test opens the DB directly and attempts UPDATE on the subject column
    // (a pre-Phase-5 immutable field), confirming the recreated trigger still enforces
    // immutability for original columns.
    const { limen, dir } = await createTestLimenWithDir();

    const r = limen.remember('entity:test:trigger2', 'test.fact', 'value');
    assert.equal(r.ok, true);
    if (!r.ok) return;

    const claimId = r.value.claimId;

    const dbPath = join(dir, 'limen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      assert.throws(
        () => db.prepare(
          `UPDATE claim_assertions SET subject = ? WHERE id = ?`,
        ).run('entity:test:tampered', claimId),
        (err: Error) => err.message.includes('CCP-I1'),
        'UPDATE subject must be blocked by CCP-I1 immutability trigger after migration 041',
      );
    } finally {
      db.close();
    }
  });
});

// ============================================================================
// Integration: reasoning + cognitive.health()
// ============================================================================

describe('Phase 5: reasoning + cognitive.health() integration', () => {
  it('claims with reasoning are counted in health report', async () => {
    const limen = await createTestLimen();

    limen.remember('entity:test:r1', 'test.fact', 'v1', { reasoning: 'reason 1' });
    limen.remember('entity:test:r2', 'test.fact2', 'v2', { reasoning: 'reason 2' });
    limen.remember('entity:test:r3', 'test.fact3', 'v3'); // no reasoning

    const health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.totalClaims, 3);
  });

  it('cognitive.health() returns ok result type', async () => {
    const limen = await createTestLimen();
    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    assert.ok('value' in result);
    assert.ok('totalClaims' in result.value);
    assert.ok('freshness' in result.value);
    assert.ok('conflicts' in result.value);
    assert.ok('confidence' in result.value);
    assert.ok('gaps' in result.value);
    assert.ok('staleDomains' in result.value);
  });
});
