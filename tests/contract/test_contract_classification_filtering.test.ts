// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for EG-04: Classification-Filtered Retrieval.
 * v3.0.0 Phase 2, Slice 2.3
 *
 * Verifies:
 *   - Claims classified at assertion are filtered at query time by clearanceLevel
 *   - Public clearance (0) excludes restricted/critical claims
 *   - Admin clearance (4) sees all classification levels
 *   - Unclassified claims (NULL) visible to all
 *   - Search path also filters by classification
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 * F-V3P2-002/004: Tests exercise the ACTUAL SQL filter, not just constants.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';
import { extractEntityFromSubject } from '../../src/claims/store/claim_stores.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-class-filter-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string { dirsToClean.push(dir); return dir; }
function trackInstance(limen: Limen): Limen { instancesToShutdown.push(limen); return limen; }

afterEach(async () => {
  for (const inst of instancesToShutdown) { try { await inst.shutdown(); } catch {} }
  instancesToShutdown.length = 0;
  for (const d of dirsToClean) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  dirsToClean.length = 0;
});

describe('EG-04: Classification-Filtered Retrieval', () => {
  it('DC-CLASS-01 [SUCCESS]: admin clearance sees all classification levels', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Store claims — default agent is admin (clearance=4)
    limen.remember('entity:class:test', 'knowledge.public', 'unrestricted');
    limen.remember('entity:class:test', 'preference.color', 'may be confidential');
    limen.remember('entity:class:test', 'medical.diagnosis', 'restricted');

    const result = limen.claims.queryClaims({ subject: 'entity:class:test' });
    assert.ok(result.ok);
    const claims = (result.value as { claims: unknown[] }).claims;
    assert.equal(claims.length, 3, 'admin (clearance=4) should see all 3 claims');
  });

  it('DC-CLASS-02 [REJECTION]: classification filter mechanism produces correct SQL for restricted clearance', async () => {
    // Verify the classification filter SQL is structurally correct by testing
    // the CLASSIFICATION_LEVEL_ORDER constants and the getClearanceForTrust mapping.
    // The actual SQL filter is tested end-to-end when requireRbac=true (multi-tenant).
    // In single-tenant mode (dormant RBAC), admin clearance is granted for backward compat.
    const { TRUST_TO_CLEARANCE, getClearanceForTrust } = await import('../../src/api/agents/trust_progression.js');
    const { CLASSIFICATION_LEVEL_ORDER } = await import('../../src/governance/classification/governance_types.js');

    // Untrusted agent gets clearance=0 (unrestricted only)
    assert.equal(getClearanceForTrust('untrusted'), 0, 'untrusted -> clearance 0');
    // Restricted claims are level 3
    assert.equal(CLASSIFICATION_LEVEL_ORDER['restricted'], 3, 'restricted -> level 3');
    // Level 3 > clearance 0 -> BLOCKED
    assert.ok(CLASSIFICATION_LEVEL_ORDER['restricted'] > getClearanceForTrust('untrusted'),
      'restricted claims blocked for untrusted agents');

    // Admin gets clearance=4, sees everything
    assert.equal(getClearanceForTrust('admin'), 4, 'admin -> clearance 4');
    assert.ok(CLASSIFICATION_LEVEL_ORDER['critical'] <= getClearanceForTrust('admin'),
      'admin sees even critical claims');

    // Verify the filter works end-to-end with requireRbac=true
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      requireRbac: true,
    }));

    // With requireRbac=true, the default agent's actual trust level is used.
    // Default convenience agent starts as 'untrusted' (I-09) -> clearance=0.
    const r1 = limen.remember('entity:rbac:x', 'knowledge.fact', 'public');
    assert.ok(r1.ok, 'assertion should succeed (no classification filter on writes)');
    const r2 = limen.remember('entity:rbac:x', 'medical.condition', 'restricted');
    assert.ok(r2.ok, 'assertion should succeed');

    // Query with untrusted clearance should filter restricted claims
    const q = limen.claims.queryClaims({ subject: 'entity:rbac:x' });
    assert.ok(q.ok, 'query should succeed');
    const claims = (q.value as { claims: unknown[] }).claims;
    // With clearance=0, only unrestricted/unclassified claims should be visible
    assert.ok(claims.length < 2, 'untrusted agent should see fewer than all claims (classification filter active)');
  });

  it('DC-CLASS-03 [SUCCESS]: unclassified claims visible to all clearance levels', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const r = limen.remember('entity:compat:test', 'observation.note', 'unclassified');
    assert.ok(r.ok);

    const result = limen.claims.queryClaims({ subject: 'entity:compat:test' });
    assert.ok(result.ok);
    const claims = (result.value as { claims: unknown[] }).claims;
    assert.equal(claims.length, 1, 'unclassified claim visible');
  });

  it('DC-CLASS-04 [SUCCESS]: search path filters by classification with requireRbac=true (F-CERT-P2-003)', async () => {
    // Mirrors DC-CLASS-02 approach but for the search path.
    // With requireRbac=true, the untrusted default agent gets clearance=0,
    // which should exclude classified claims from search results.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      requireRbac: true,
    }));

    // Store claims — assertion doesn't filter by classification
    limen.remember('entity:searchfilter:a', 'knowledge.searchable', 'findable public data');
    limen.remember('entity:searchfilter:b', 'medical.searchable', 'findable restricted data');

    // Search with untrusted clearance (0) — should filter restricted claims
    const searchResult = limen.search('findable');
    assert.ok(searchResult.ok, 'search should succeed');
    if (searchResult.ok) {
      // With clearance=0, medical.* (restricted=3) should be filtered out.
      // Only knowledge.* (unrestricted=0) should appear in results.
      for (const item of searchResult.value) {
        assert.ok(!item.belief.predicate.startsWith('medical.'),
          `restricted claim with predicate '${item.belief.predicate}' should not appear in search for clearance=0`);
      }
    }
  });
});

describe('extractEntityFromSubject utility', () => {
  it('extracts entity ID from valid entity URN', () => {
    assert.equal(extractEntityFromSubject('entity:user:alice'), 'user:alice');
    assert.equal(extractEntityFromSubject('entity:patient:123'), 'patient:123');
    assert.equal(extractEntityFromSubject('entity:company:acme:labs'), 'company:acme:labs');
  });

  it('returns null for non-entity subjects', () => {
    assert.equal(extractEntityFromSubject('decision:arch:redesign'), null);
    assert.equal(extractEntityFromSubject('observation:note:123'), null);
    assert.equal(extractEntityFromSubject(''), null);
    assert.equal(extractEntityFromSubject('entity'), null);
    assert.equal(extractEntityFromSubject('entity:'), null);
  });
});
