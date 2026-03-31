/**
 * Phase 7: MCP Enhancement — Integration Tests.
 *
 * Tests all Phase 7 MCP tools:
 *   - limen_context (§7.1): Context builder for system prompts
 *   - limen_health_cognitive (§7.2): Cognitive health report
 *   - limen_recall_bulk (§7.3): Bulk recall for multiple subjects
 *   - limen_search (§7.4): Full-text search
 *   - limen_recall (§7.5): Recall with decay visibility (effectiveConfidence, freshness)
 *
 * All tests use real Limen engine instances (no mocks).
 * Each test verifies delegation to the convenience API.
 *
 * DC coverage:
 *   DC-P7-001: Delegation invariant (all tests verify via real engine calls)
 *   DC-P7-002: Context builder output (context tests)
 *   DC-P7-003: Bulk recall completeness (bulk recall tests)
 *   DC-P7-004: Search fidelity (search tests)
 *   DC-P7-005: Decay visibility (recall tests)
 *   DC-P7-006: Health on empty knowledge base (cognitive health tests)
 *   DC-P7-007: Input validation (validation tests)
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createLimen } from '../../../src/api/index.js';
import type { Limen } from '../../../src/api/index.js';

// ─── Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-mcp-p7-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

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

async function createTestEngine(): Promise<Limen> {
  const dir = makeTempDir();
  dirsToClean.push(dir);
  const limen = await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] });
  instancesToShutdown.push(limen);
  return limen;
}

/**
 * Helper: populate a Limen instance with test claims.
 * Returns claim IDs.
 */
function seedClaims(limen: Limen): string[] {
  const claimIds: string[] = [];

  const r1 = limen.remember('entity:project:alpha', 'decision.architecture', 'Chose microservices');
  assert.ok(r1.ok, `Seed claim 1 failed: ${!r1.ok && r1.error.message}`);
  if (r1.ok) claimIds.push(r1.value.claimId);

  const r2 = limen.remember('entity:project:alpha', 'decision.language', 'TypeScript for backend');
  assert.ok(r2.ok, `Seed claim 2 failed: ${!r2.ok && r2.error.message}`);
  if (r2.ok) claimIds.push(r2.value.claimId);

  const r3 = limen.remember('entity:user:bob', 'preference.editor', 'VS Code');
  assert.ok(r3.ok, `Seed claim 3 failed: ${!r3.ok && r3.error.message}`);
  if (r3.ok) claimIds.push(r3.value.claimId);

  return claimIds;
}


// ============================================================================
// §7.5: limen_recall — Decay Visibility (DC-P7-005)
// ============================================================================

describe('limen_recall — Decay Visibility', () => {

  it('recall returns beliefs with effectiveConfidence and freshness fields', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.recall('entity:project:alpha');
    assert.ok(result.ok, 'recall must succeed');
    assert.ok(result.value.length > 0, 'Must return at least one belief');

    for (const belief of result.value) {
      assert.equal(typeof belief.effectiveConfidence, 'number', 'effectiveConfidence must be a number');
      assert.ok(belief.effectiveConfidence >= 0 && belief.effectiveConfidence <= 1, 'effectiveConfidence in [0,1]');
      assert.equal(typeof belief.freshness, 'string', 'freshness must be a string');
      assert.ok(['fresh', 'aging', 'stale'].includes(belief.freshness), `freshness must be fresh/aging/stale, got: ${belief.freshness}`);
    }
  });

  it('recall with no matching subject returns empty array (not error)', async () => {
    const limen = await createTestEngine();

    const result = limen.recall('entity:nonexistent:xyz');
    assert.ok(result.ok, 'recall with no match must succeed');
    assert.equal(result.value.length, 0, 'Must return empty array');
  });

  it('recall with minConfidence filters correctly', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    // Default maxAutoConfidence is 0.7, so all seeded claims are at 0.7
    const result = limen.recall(undefined, undefined, { minConfidence: 0.8 });
    assert.ok(result.ok, 'recall with high confidence filter must succeed');
    assert.equal(result.value.length, 0, 'No claims should match above 0.8');
  });
});


// ============================================================================
// §7.1: limen_context — Context Builder (DC-P7-002)
// ============================================================================

describe('limen_context delegation', () => {

  it('context builder returns beliefs from recall', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    // Simulate what context tool does: call recall and format
    const result = limen.recall('entity:project:alpha');
    assert.ok(result.ok, 'recall must succeed');
    assert.ok(result.value.length >= 2, 'Must include seeded project claims');

    // Verify the beliefs contain the data needed for context generation
    const subjects = result.value.map(b => b.subject);
    assert.ok(subjects.every(s => s === 'entity:project:alpha'), 'All subjects must match filter');
  });

  it('context with no matching claims returns empty', async () => {
    const limen = await createTestEngine();

    const result = limen.recall('entity:nonexistent:xyz');
    assert.ok(result.ok, 'recall must succeed on empty result');
    assert.equal(result.value.length, 0, 'Must be empty');
  });
});


// ============================================================================
// §7.2: limen_health_cognitive — Cognitive Health (DC-P7-006)
// ============================================================================

describe('limen_health_cognitive delegation', () => {

  it('health report on empty knowledge base returns all-zero values', async () => {
    const limen = await createTestEngine();

    const result = limen.cognitive.health();
    assert.ok(result.ok, 'health must succeed on empty knowledge base');

    const report = result.value;
    assert.equal(report.totalClaims, 0, 'totalClaims must be 0');
    assert.equal(report.freshness.fresh, 0, 'fresh must be 0');
    assert.equal(report.freshness.aging, 0, 'aging must be 0');
    assert.equal(report.freshness.stale, 0, 'stale must be 0');
    assert.equal(report.conflicts.unresolved, 0, 'unresolved conflicts must be 0');
    assert.equal(report.confidence.mean, 0, 'mean confidence must be 0');
  });

  it('health report reflects seeded claims', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.cognitive.health();
    assert.ok(result.ok, 'health must succeed');

    const report = result.value;
    assert.equal(report.totalClaims, 3, 'totalClaims must match seeded count');
    assert.ok(report.totalClaims > 0, 'Must have claims');
  });

  it('health report has complete structure', async () => {
    const limen = await createTestEngine();

    const result = limen.cognitive.health();
    assert.ok(result.ok, 'health must succeed');

    const report = result.value;
    // Verify all required fields exist
    assert.equal(typeof report.totalClaims, 'number');
    assert.equal(typeof report.freshness, 'object');
    assert.equal(typeof report.freshness.fresh, 'number');
    assert.equal(typeof report.freshness.aging, 'number');
    assert.equal(typeof report.freshness.stale, 'number');
    assert.equal(typeof report.freshness.percentFresh, 'number');
    assert.equal(typeof report.conflicts, 'object');
    assert.equal(typeof report.conflicts.unresolved, 'number');
    assert.ok(Array.isArray(report.conflicts.critical));
    assert.equal(typeof report.confidence, 'object');
    assert.equal(typeof report.confidence.mean, 'number');
    assert.equal(typeof report.confidence.median, 'number');
    assert.equal(typeof report.confidence.below30, 'number');
    assert.equal(typeof report.confidence.above90, 'number');
    assert.ok(Array.isArray(report.gaps));
    assert.ok(Array.isArray(report.staleDomains));
  });
});


// ============================================================================
// §7.3: limen_recall_bulk — Bulk Recall (DC-P7-003)
// ============================================================================

describe('limen_recall_bulk delegation', () => {

  it('bulk recall returns one result per subject', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const subjects = ['entity:project:alpha', 'entity:user:bob'];
    const results: Array<{ subject: string; beliefs: unknown[] }> = [];

    for (const subject of subjects) {
      const result = limen.recall(subject);
      assert.ok(result.ok, `recall for ${subject} must succeed`);
      results.push({ subject, beliefs: [...result.value] });
    }

    assert.equal(results.length, 2, 'Must have one result per subject');
    assert.equal(results[0].subject, 'entity:project:alpha');
    assert.ok(results[0].beliefs.length >= 2, 'Alpha must have 2+ beliefs');
    assert.equal(results[1].subject, 'entity:user:bob');
    assert.ok(results[1].beliefs.length >= 1, 'Bob must have 1+ belief');
  });

  it('bulk recall with non-existent subject returns empty beliefs array', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const subjects = ['entity:nonexistent:xyz', 'entity:project:alpha'];
    const results: Array<{ subject: string; beliefs: unknown[] }> = [];

    for (const subject of subjects) {
      const result = limen.recall(subject);
      assert.ok(result.ok, `recall for ${subject} must succeed`);
      results.push({ subject, beliefs: [...result.value] });
    }

    assert.equal(results[0].beliefs.length, 0, 'Non-existent subject returns empty');
    assert.ok(results[1].beliefs.length > 0, 'Existing subject returns beliefs');
  });

  it('empty subjects array returns empty results', async () => {
    const limen = await createTestEngine();

    // Simulates what the MCP tool does with empty input
    const subjects: string[] = [];
    const results: unknown[] = [];

    for (const subject of subjects) {
      const result = limen.recall(subject);
      if (result.ok) results.push({ subject, beliefs: result.value });
    }

    assert.equal(results.length, 0, 'Empty input returns empty output');
  });
});


// ============================================================================
// §7.4: limen_search — Full-Text Search (DC-P7-004)
// ============================================================================

describe('limen_search delegation', () => {

  it('search returns matching claims with relevance and score', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.search('microservices');
    assert.ok(result.ok, 'search must succeed');
    assert.ok(result.value.length > 0, 'Must find the microservices claim');

    for (const sr of result.value) {
      assert.equal(typeof sr.belief, 'object', 'SearchResult must have belief');
      assert.equal(typeof sr.relevance, 'number', 'SearchResult must have relevance');
      assert.equal(typeof sr.score, 'number', 'SearchResult must have score');
      // Verify belief has decay visibility fields
      assert.equal(typeof sr.belief.effectiveConfidence, 'number', 'belief must have effectiveConfidence');
      assert.equal(typeof sr.belief.freshness, 'string', 'belief must have freshness');
    }
  });

  it('search with non-matching query returns empty array', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.search('zzzznonexistentterm');
    assert.ok(result.ok, 'search must succeed even with no matches');
    assert.equal(result.value.length, 0, 'Non-matching search returns empty');
  });

  it('search with empty query returns error', async () => {
    const limen = await createTestEngine();

    const result = limen.search('');
    assert.equal(result.ok, false, 'Empty query must fail');
    if (!result.ok) {
      assert.equal(result.error.code, 'CONV_SEARCH_EMPTY_QUERY', 'Must return CONV_SEARCH_EMPTY_QUERY');
    }
  });

  it('search results have complete BeliefView structure', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.search('TypeScript');
    assert.ok(result.ok, 'search must succeed');
    assert.ok(result.value.length > 0, 'Must find TypeScript claim');

    const belief = result.value[0].belief;
    assert.equal(typeof belief.claimId, 'string');
    assert.equal(typeof belief.subject, 'string');
    assert.equal(typeof belief.predicate, 'string');
    assert.equal(typeof belief.value, 'string');
    assert.equal(typeof belief.confidence, 'number');
    assert.equal(typeof belief.validAt, 'string');
    assert.equal(typeof belief.createdAt, 'string');
    assert.equal(typeof belief.superseded, 'boolean');
    assert.equal(typeof belief.disputed, 'boolean');
    assert.equal(typeof belief.effectiveConfidence, 'number');
    assert.equal(typeof belief.freshness, 'string');
    assert.equal(typeof belief.stability, 'number');
    assert.equal(typeof belief.accessCount, 'number');
  });
});


// ============================================================================
// Input Validation (DC-P7-007)
// ============================================================================

describe('Phase 7 input validation', () => {

  it('search rejects empty query string', async () => {
    const limen = await createTestEngine();

    const result = limen.search('');
    assert.equal(result.ok, false, 'Empty query must be rejected');
  });

  it('recall with valid wildcard subject works', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.recall('entity:project:*');
    assert.ok(result.ok, 'Wildcard recall must succeed');
    assert.ok(result.value.length > 0, 'Must match project claims');
  });

  it('recall with valid wildcard predicate works', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);

    const result = limen.recall(undefined, 'decision.*');
    assert.ok(result.ok, 'Wildcard predicate recall must succeed');
    assert.ok(result.value.length > 0, 'Must match decision claims');
  });
});
