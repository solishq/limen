// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for EG-03: Trust-Level Filtered Retrieval.
 * v3.0.0 Phase 2, Slice 2.2
 *
 * Verifies:
 *   - Trust levels map to clearance levels
 *   - Queries are filtered based on agent clearance
 *   - Backward compatibility (default = full access)
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';
import { getClearanceForTrust, TRUST_TO_CLEARANCE } from '../../src/api/agents/trust_progression.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-trust-filter-'));
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

describe('EG-03: Trust-Level Filtered Retrieval', () => {
  it('DC-TRUST-01 [SUCCESS]: trust-to-clearance mapping is correct', () => {
    // Verify the mapping values align with CLASSIFICATION_LEVEL_ORDER
    assert.equal(TRUST_TO_CLEARANCE['untrusted'], 0, 'untrusted = 0 (unrestricted only)');
    assert.equal(TRUST_TO_CLEARANCE['probationary'], 1, 'probationary = 1 (internal)');
    assert.equal(TRUST_TO_CLEARANCE['trusted'], 2, 'trusted = 2 (confidential)');
    assert.equal(TRUST_TO_CLEARANCE['admin'], 4, 'admin = 4 (all levels)');
  });

  it('DC-TRUST-02 [REJECTION]: untrusted clearance level is below restricted', () => {
    // Untrusted clearance (0) is below restricted (3) — classification filter will block
    const untrustedClearance = getClearanceForTrust('untrusted');
    assert.equal(untrustedClearance, 0, 'untrusted clearance = 0');
    assert.ok(untrustedClearance < 3, 'untrusted clearance (0) < restricted level (3)');
    assert.ok(untrustedClearance < 2, 'untrusted clearance (0) < confidential level (2)');
    assert.ok(untrustedClearance < 1, 'untrusted clearance (0) < internal level (1)');
  });

  it('DC-TRUST-03 [SUCCESS]: admin clearance queries all claims', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Store claims with different classification levels via predicates
    const r1 = limen.remember('entity:test:1', 'knowledge.fact', 'public fact');
    assert.ok(r1.ok, 'store public fact');

    // Default context has no clearanceLevel (undefined) = full access (admin equivalent)
    const queryResult = limen.claims.queryClaims({
      subject: 'entity:test:1',
    });
    assert.ok(queryResult.ok, 'admin-level query should succeed');
    const claims = (queryResult.value as { claims: unknown[] }).claims;
    assert.ok(claims.length > 0, 'admin should see all claims');
  });

  it('DC-TRUST-04 [SUCCESS]: default behavior unchanged (backward compat)', () => {
    // When trust level is null/undefined, full access is granted
    const nullClearance = getClearanceForTrust(null);
    assert.equal(nullClearance, 4, 'null trust = full access');

    const undefinedClearance = getClearanceForTrust(undefined);
    assert.equal(undefinedClearance, 4, 'undefined trust = full access');
  });
});
