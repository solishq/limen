// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for FR-007: Dependency Triggers.
 *
 * Verifies:
 *   - reviewNeeded computed property on BeliefView (via recall)
 *   - claim:dependency-invalidated event emission on retraction
 *   - CognitiveHealthReport.reviewNeeded count
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 *
 * Note: These tests insert claim_evidence rows directly to create claim-type
 * evidence links, because the grounding validator requires non-claim anchors
 * that are complex to set up via the public API. The FR-007 feature is about
 * the query-time reviewNeeded computation, not grounding. Direct insertion
 * tests exactly the right layer.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-dep-triggers-'));
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

/**
 * Helper: insert a claim_evidence row linking a dependent claim to a base claim.
 * This creates the evidence chain that reviewNeeded checks at query time.
 */
function insertClaimEvidence(limen: Limen, dependentClaimId: string, baseClaimId: string): void {
  // Access the raw DB connection via the internal API
  const conn = (limen as unknown as { _getConnection?: () => { run: (sql: string, params: unknown[]) => void } })._getConnection?.();
  if (!conn) {
    // Fallback: use the claims API to get at the database
    // The limen object has an internal connection we can reach through claims.queryClaims
    throw new Error('Cannot access internal connection');
  }
  conn.run(
    `INSERT INTO claim_evidence (claim_id, evidence_type, evidence_id, source_state, created_at)
     VALUES (?, 'claim', ?, 'live', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [dependentClaimId, baseClaimId],
  );
}

describe('FR-007: Dependency Triggers', () => {

  // ── DC-DEP-01 [SUCCESS]: claim with valid evidence shows reviewNeeded=false ──
  it('DC-DEP-01 [SUCCESS]: claim with valid evidence shows reviewNeeded=false', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create base claim (active)
    const base = limen.remember('entity:dep01:base', 'dep01.base', 'base value');
    assert.ok(base.ok, 'base claim must succeed');
    const baseId = base.value.claimId;

    // Create dependent claim
    const dep = limen.remember('entity:dep01:child', 'dep01.child', 'child value');
    assert.ok(dep.ok, 'dependent claim must succeed');
    const depId = dep.value.claimId;

    // Insert claim_evidence row linking dependent -> base
    // Use the raw SQL connection via the export API workaround
    const exported = limen.exportData({ format: 'json' });
    assert.ok(exported.ok, 'export must succeed');

    // We need raw DB access. Use the internal _testConnection if available,
    // otherwise use queryClaims to verify state.
    // Direct approach: use limen.claims.queryClaims with includeEvidence
    // Actually, we need to INSERT. Let's use a different approach.
    // The simplest: create via the low-level claim system.
    // Use SQL directly through the database.

    // Access internal DB by constructing a separate sqlite connection to the same file
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(dir, 'limen.db'));
    db.exec(
      `INSERT INTO claim_evidence (claim_id, evidence_type, evidence_id, source_state, created_at)
       VALUES ('${depId}', 'claim', '${baseId}', 'live', datetime('now'))`,
    );
    db.close();

    // Query the child claim — reviewNeeded should be false (base is active)
    const childQuery = limen.recall('entity:dep01:child');
    assert.ok(childQuery.ok, 'child recall must succeed');
    assert.ok(childQuery.value.length > 0, 'must find child claim');
    assert.equal(childQuery.value[0].reviewNeeded, false, 'reviewNeeded must be false when evidence is active');
  });

  // ── DC-DEP-02 [SUCCESS]: retracting evidence source sets reviewNeeded=true on dependent ──
  it('DC-DEP-02 [SUCCESS]: retracting evidence source sets reviewNeeded=true on dependent', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create base and dependent claims
    const base = limen.remember('entity:dep02:base', 'dep02.base', 'evidence source');
    assert.ok(base.ok);
    const baseId = base.value.claimId;

    const dep = limen.remember('entity:dep02:child', 'dep02.child', 'child value');
    assert.ok(dep.ok);
    const depId = dep.value.claimId;

    // Insert claim_evidence linking dependent -> base
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(dir, 'limen.db'));
    db.exec(
      `INSERT INTO claim_evidence (claim_id, evidence_type, evidence_id, source_state, created_at)
       VALUES ('${depId}', 'claim', '${baseId}', 'live', datetime('now'))`,
    );
    db.close();

    // Query before retraction — reviewNeeded should be false
    const beforeRetract = limen.recall('entity:dep02:child');
    assert.ok(beforeRetract.ok);
    assert.equal(beforeRetract.value[0].reviewNeeded, false, 'reviewNeeded must be false before retraction');

    // Retract the base claim
    const forgetResult = limen.forget(baseId, 'incorrect');
    assert.ok(forgetResult.ok, 'forget must succeed');

    // Query after retraction — reviewNeeded should now be true
    const afterRetract = limen.recall('entity:dep02:child');
    assert.ok(afterRetract.ok, 'recall after retract must succeed');
    assert.ok(afterRetract.value.length > 0, 'must find child claim after retraction');
    assert.equal(afterRetract.value[0].reviewNeeded, true, 'reviewNeeded must be true after evidence retracted');
  });

  // ── DC-DEP-03 [REJECTION]: claim with no evidence shows reviewNeeded=false (no crash) ──
  it('DC-DEP-03 [REJECTION]: claim with no evidence shows reviewNeeded=false', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a claim with no claim-type evidence (remember uses runtime_witness)
    const result = limen.remember('entity:dep03:solo', 'dep03.solo', 'no evidence');
    assert.ok(result.ok, 'remember must succeed');

    // Query — must not crash and reviewNeeded must be false
    const query = limen.recall('entity:dep03:solo');
    assert.ok(query.ok, 'recall must succeed');
    assert.ok(query.value.length > 0, 'must find claim');
    assert.equal(query.value[0].reviewNeeded, false, 'reviewNeeded must be false for claim with no claim-type evidence');
  });

  // ── DC-DEP-04 [SUCCESS]: dependency-invalidated event fires on retraction ──
  it('DC-DEP-04 [SUCCESS]: dependency-invalidated event fires on retraction', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create base and dependent claims
    const base = limen.remember('entity:dep04:base', 'dep04.base', 'evidence base');
    assert.ok(base.ok);
    const baseId = base.value.claimId;

    const dep = limen.remember('entity:dep04:child', 'dep04.child', 'dependent');
    assert.ok(dep.ok);
    const depId = dep.value.claimId;

    // Insert claim_evidence linking dependent -> base
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(dir, 'limen.db'));
    db.exec(
      `INSERT INTO claim_evidence (claim_id, evidence_type, evidence_id, source_state, created_at)
       VALUES ('${depId}', 'claim', '${baseId}', 'live', datetime('now'))`,
    );
    db.close();

    // Subscribe to dependency-invalidated events via public API
    const receivedEvents: Array<Record<string, unknown>> = [];
    limen.on('claim:dependency:invalidated', (event) => {
      receivedEvents.push(event.data as Record<string, unknown>);
    });

    // Retract the base claim
    const forgetResult = limen.forget(baseId, 'incorrect');
    assert.ok(forgetResult.ok, 'forget must succeed');

    // Event should have fired
    assert.ok(receivedEvents.length > 0, 'dependency-invalidated event must fire');
    assert.equal(receivedEvents[0].retractedEvidenceId, baseId, 'event must reference the retracted claim');
  });

  // ── DC-DEP-05 [SUCCESS]: health() includes reviewNeeded count ──
  it('DC-DEP-05 [SUCCESS]: health() includes reviewNeeded count', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create base and dependent claims
    const base = limen.remember('entity:dep05:base', 'dep05.base', 'evidence');
    assert.ok(base.ok);
    const baseId = base.value.claimId;

    const dep = limen.remember('entity:dep05:child', 'dep05.child', 'depends on base');
    assert.ok(dep.ok);
    const depId = dep.value.claimId;

    // Insert claim_evidence linking dependent -> base
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(dir, 'limen.db'));
    db.exec(
      `INSERT INTO claim_evidence (claim_id, evidence_type, evidence_id, source_state, created_at)
       VALUES ('${depId}', 'claim', '${baseId}', 'live', datetime('now'))`,
    );
    db.close();

    // Health before retraction
    const healthBefore = limen.cognitive.health();
    assert.ok(healthBefore.ok, 'health must succeed');
    assert.equal(healthBefore.value.reviewNeeded, 0, 'reviewNeeded must be 0 before retraction');

    // Retract the base
    limen.forget(baseId, 'superseded');

    // Invalidate cache and check health after retraction
    limen.cognitive.invalidateHealthCache();
    const healthAfter = limen.cognitive.health();
    assert.ok(healthAfter.ok, 'health must succeed after retraction');
    assert.ok(healthAfter.value.reviewNeeded > 0, 'reviewNeeded must be > 0 after evidence retracted');
  });

  // ── DC-DEP-06 [SUCCESS]: superseding evidence source also triggers reviewNeeded ──
  it('DC-DEP-06 [SUCCESS]: superseding evidence source also triggers reviewNeeded', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create base and dependent claims
    const base = limen.remember('entity:dep06:base', 'dep06.base', 'original');
    assert.ok(base.ok);
    const baseId = base.value.claimId;

    const dep = limen.remember('entity:dep06:child', 'dep06.child', 'depends on base');
    assert.ok(dep.ok);
    const depId = dep.value.claimId;

    // Insert claim_evidence linking dependent -> base
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(dir, 'limen.db'));
    db.exec(
      `INSERT INTO claim_evidence (claim_id, evidence_type, evidence_id, source_state, created_at)
       VALUES ('${depId}', 'claim', '${baseId}', 'live', datetime('now'))`,
    );
    db.close();

    // Retract the base claim with 'superseded' reason
    const forgetResult = limen.forget(baseId, 'superseded');
    assert.ok(forgetResult.ok, 'forget (superseded) must succeed');

    // Query the dependent — reviewNeeded should be true
    const childQuery = limen.recall('entity:dep06:child');
    assert.ok(childQuery.ok, 'recall must succeed');
    assert.ok(childQuery.value.length > 0, 'must find child claim');
    assert.equal(childQuery.value[0].reviewNeeded, true, 'reviewNeeded must be true after superseded retraction');
  });
});
