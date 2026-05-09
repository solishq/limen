// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for FR-006: Context Compiler (`limen.compile()`).
 *
 * Verifies:
 *   - DC-COMPILE-01: reasoning-ready format with semantic labels
 *   - DC-COMPILE-02: structured format returns categorized JSON
 *   - DC-COMPILE-03: raw format returns claim array
 *   - DC-COMPILE-04: non-existent domain returns empty context (0 claims)
 *   - DC-COMPILE-05: predicate filter restricts output
 *   - DC-COMPILE-06: maxTokens truncates output with omission notice
 *   - DC-COMPILE-07: priority=confidence sorts by effectiveConfidence descending
 *   - DC-COMPILE-08: includeRelationships adds contradiction/supersedes context
 *   - DC-COMPILE-09: empty domain returns error (COMPILE_EMPTY_DOMAIN)
 *   - DC-COMPILE-10: deterministic output (same input -> same output)
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
import Database from 'better-sqlite3';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-compile-'));
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
 * Helper: create a limen instance with seeded claims for testing.
 */
async function createSeededInstance(): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

  // Seed claims with different predicates for testing categorization
  limen.remember('entity:project:alpha', 'decision.auth', 'Using PKCE flow');
  limen.remember('entity:project:alpha', 'decision.session', 'Session tokens in Limen');
  limen.remember('entity:project:alpha', 'correction.middleware', 'Do NOT use middleware pattern');
  limen.remember('entity:project:alpha', 'observation.status', 'Auth module has 3 open findings');
  limen.remember('entity:project:alpha', 'warning.security', 'XSS risk in form handler');

  return limen;
}

describe('FR-006: Context Compiler (limen.cognitive.compile)', () => {

  // ── DC-COMPILE-01 [SUCCESS]: reasoning-ready format with semantic labels ──
  it('DC-COMPILE-01 [SUCCESS]: compile with reasoning-ready format returns text with DECIDED/OBSERVED labels', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:alpha',
      format: 'reasoning-ready',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(ctx.claimCount > 0, 'must include claims');
    assert.ok(ctx.text.includes('Context for entity:project:alpha'), 'header must contain domain');
    assert.ok(ctx.text.includes('DECIDED:'), 'must contain DECIDED label for decision.* predicates');
    assert.ok(ctx.text.includes('CORRECTION:'), 'must contain CORRECTION label for correction.* predicates');
    assert.ok(ctx.text.includes('OBSERVED:'), 'must contain OBSERVED label for observation.* predicates');
    assert.ok(ctx.text.includes('WARNING:'), 'must contain WARNING label for warning.* predicates');
    assert.ok(ctx.estimatedTokens > 0, 'estimated tokens must be positive');
    assert.ok(ctx.lastUpdated.length > 0, 'lastUpdated must be set');
    assert.ok(['fresh', 'aging', 'stale'].includes(ctx.staleness), 'staleness must be valid');
  });

  // ── DC-COMPILE-02 [SUCCESS]: structured format returns categorized JSON ──
  it('DC-COMPILE-02 [SUCCESS]: compile with structured format returns categorized JSON', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:alpha',
      format: 'structured',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(ctx.claimCount > 0, 'must include claims');

    // Parse the JSON output
    const parsed = JSON.parse(ctx.text);
    assert.equal(parsed.domain, 'entity:project:alpha', 'domain must match');
    assert.ok(parsed.categories, 'must have categories');
    assert.ok(parsed.compiledAt, 'must have compiledAt timestamp');

    // Check that categories contain the expected predicate namespaces
    const categoryKeys = Object.keys(parsed.categories);
    assert.ok(categoryKeys.includes('decision'), 'must have decision category');
    assert.ok(categoryKeys.includes('correction'), 'must have correction category');
    assert.ok(categoryKeys.includes('observation'), 'must have observation category');
  });

  // ── DC-COMPILE-03 [SUCCESS]: raw format returns claim array ──
  it('DC-COMPILE-03 [SUCCESS]: compile with raw format returns claim array', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:alpha',
      format: 'raw',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    const parsed = JSON.parse(ctx.text);
    assert.ok(Array.isArray(parsed), 'raw format must return JSON array');
    assert.ok(parsed.length > 0, 'must have claims');

    // Check claim structure
    const first = parsed[0];
    assert.ok('id' in first, 'each claim must have id');
    assert.ok('subject' in first, 'each claim must have subject');
    assert.ok('predicate' in first, 'each claim must have predicate');
    assert.ok('value' in first, 'each claim must have value');
    assert.ok('confidence' in first, 'each claim must have confidence');
    assert.ok('effectiveConfidence' in first, 'each claim must have effectiveConfidence');
    assert.ok('validAt' in first, 'each claim must have validAt');
    assert.ok('freshness' in first, 'each claim must have freshness');
  });

  // ── DC-COMPILE-04 [REJECTION]: non-existent domain returns empty context (0 claims) ──
  it('DC-COMPILE-04 [REJECTION]: compile with non-existent domain returns empty context', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:does-not-exist',
      format: 'reasoning-ready',
    });

    assert.equal(result.ok, true, 'must succeed (empty is not an error)');
    if (!result.ok) return;

    const ctx = result.value;
    assert.equal(ctx.claimCount, 0, 'must have zero claims');
    assert.ok(ctx.text.includes('0 claims'), 'text must indicate 0 claims');
    assert.ok(ctx.text.includes('No claims found'), 'text must indicate no claims found');
  });

  // ── DC-COMPILE-05 [SUCCESS]: predicate filter restricts output ──
  it('DC-COMPILE-05 [SUCCESS]: predicate filter restricts output to matching predicates only', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:alpha',
      predicates: ['decision.*'],
      format: 'reasoning-ready',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.equal(ctx.claimCount, 2, 'must include only 2 decision claims');
    assert.ok(ctx.text.includes('DECIDED:'), 'must contain DECIDED labels');
    assert.ok(!ctx.text.includes('CORRECTION:'), 'must NOT contain CORRECTION labels');
    assert.ok(!ctx.text.includes('OBSERVED:'), 'must NOT contain OBSERVED labels');
  });

  // ── DC-COMPILE-06 [SUCCESS]: maxTokens truncates output with omission notice ──
  it('DC-COMPILE-06 [SUCCESS]: maxTokens truncates output with omission notice', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed many claims to ensure truncation
    for (let i = 0; i < 20; i++) {
      limen.remember(
        'entity:project:trunctest',
        `observation.item${i}`,
        `This is a reasonably long observation value number ${i} that helps fill the token budget`,
      );
    }

    const result = limen.cognitive.compile({
      domain: 'entity:project:trunctest',
      format: 'reasoning-ready',
      maxTokens: 100, // Very small budget — forces truncation
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(ctx.claimCount < 20, 'must truncate (fewer than 20 claims)');
    assert.ok(ctx.text.includes('more claims omitted'), 'must contain omission notice');
    assert.ok(ctx.estimatedTokens <= 130, 'estimated tokens must be near budget (with omission text)');
  });

  // ── DC-COMPILE-07 [SUCCESS]: priority=confidence sorts by effectiveConfidence descending ──
  it('DC-COMPILE-07 [SUCCESS]: priority=confidence sorts by effectiveConfidence descending', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed claims with different confidence levels
    limen.remember('entity:project:conftest', 'observation.low', 'Low confidence claim', {
      confidence: 0.3,
    });
    limen.remember('entity:project:conftest', 'observation.high', 'High confidence claim', {
      confidence: 0.9,
    });
    limen.remember('entity:project:conftest', 'observation.mid', 'Medium confidence claim', {
      confidence: 0.6,
    });

    const result = limen.cognitive.compile({
      domain: 'entity:project:conftest',
      format: 'raw',
      priority: 'confidence',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const parsed = JSON.parse(result.value.text);
    assert.ok(Array.isArray(parsed), 'must be array');
    assert.ok(parsed.length >= 3, 'must have at least 3 claims');

    // Verify descending confidence order
    for (let i = 1; i < parsed.length; i++) {
      assert.ok(
        parsed[i - 1].effectiveConfidence >= parsed[i].effectiveConfidence,
        `claim ${i - 1} confidence (${parsed[i - 1].effectiveConfidence}) must be >= claim ${i} confidence (${parsed[i].effectiveConfidence})`,
      );
    }
  });

  // ── DC-COMPILE-08 [SUCCESS]: includeRelationships adds contradiction/supersedes context ──
  it('DC-COMPILE-08 [SUCCESS]: includeRelationships adds contradiction/supersedes context', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create two claims
    const r1 = limen.remember('entity:project:reltest', 'decision.approach', 'Use REST API');
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const r2 = limen.remember('entity:project:reltest', 'decision.approach2', 'Use GraphQL instead');
    assert.equal(r2.ok, true);
    if (!r2.ok) return;

    // Create a contradicts relationship
    const connResult = limen.connect(r1.value.claimId, r2.value.claimId, 'contradicts');
    assert.equal(connResult.ok, true, 'connect must succeed');

    const result = limen.cognitive.compile({
      domain: 'entity:project:reltest',
      format: 'reasoning-ready',
      includeRelationships: true,
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(ctx.text.includes('contradiction'), 'must include contradiction context');
  });

  // ── DC-COMPILE-09 [REJECTION]: empty domain returns error ──
  it('DC-COMPILE-09 [REJECTION]: compile with empty domain returns error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: '',
      format: 'reasoning-ready',
    });

    assert.equal(result.ok, false, 'empty domain must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'COMPILE_EMPTY_DOMAIN', 'error code must be COMPILE_EMPTY_DOMAIN');
  });

  // ── DC-COMPILE-09b [REJECTION]: whitespace-only domain returns error ──
  it('DC-COMPILE-09b [REJECTION]: compile with whitespace-only domain returns error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: '   ',
      format: 'reasoning-ready',
    });

    assert.equal(result.ok, false, 'whitespace domain must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'COMPILE_EMPTY_DOMAIN', 'error code must be COMPILE_EMPTY_DOMAIN');
  });

  // ── DC-COMPILE-10 [SUCCESS]: deterministic output ──
  // Determinism means: same claims + same clock = same output.
  // We verify by using the raw format (no timestamp in output) and checking
  // that claim ordering, values, and structure are identical across calls.
  it('DC-COMPILE-10 [SUCCESS]: compiled text is deterministic (same input produces same output)', async () => {
    const limen = await createSeededInstance();

    const opts = {
      domain: 'entity:project:alpha',
      format: 'raw' as const,
    };

    const r1 = limen.cognitive.compile(opts);
    const r2 = limen.cognitive.compile(opts);

    assert.equal(r1.ok, true, 'first compile must succeed');
    assert.equal(r2.ok, true, 'second compile must succeed');
    if (!r1.ok || !r2.ok) return;

    // Raw format has no timestamp — must be fully identical
    assert.equal(r1.value.text, r2.value.text, 'two calls with same input must produce identical output');
    assert.equal(r1.value.claimCount, r2.value.claimCount, 'claim counts must match');
    assert.equal(r1.value.estimatedTokens, r2.value.estimatedTokens, 'token estimates must match');

    // Also verify structured format has stable claim data (ignoring compiledAt)
    const s1 = limen.cognitive.compile({ domain: 'entity:project:alpha', format: 'structured' });
    const s2 = limen.cognitive.compile({ domain: 'entity:project:alpha', format: 'structured' });
    assert.equal(s1.ok, true);
    assert.equal(s2.ok, true);
    if (!s1.ok || !s2.ok) return;

    // Strip compiledAt for comparison — it uses real time
    const p1 = JSON.parse(s1.value.text);
    const p2 = JSON.parse(s2.value.text);
    delete p1.compiledAt;
    delete p2.compiledAt;
    assert.deepStrictEqual(p1, p2, 'structured content (minus timestamp) must be identical');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Breaker remediation tests — kill surviving mutants
  // ══════════════════════════════════════════════════════════════════════════

  // ── F-CC-001: Tenant isolation (M-3 kill) ──
  // Mutation: removing tenant_id filter from queryClaims must fail a test.
  // Approach: create a single-tenant instance (tenant_id IS NULL), seed claims
  // via the API, then insert a foreign-tenant claim directly via SQL.
  // Compile must NOT return the foreign-tenant claim.
  it('F-CC-001 [TENANT-ISOLATION]: compile excludes claims belonging to a different tenant', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed a legitimate claim via API (will have tenant_id = NULL in single-tenant mode)
    limen.remember('entity:project:iso', 'decision.arch', 'Use microservices');

    // Inject a foreign-tenant claim directly into the DB — simulating multi-tenant contamination.
    // This claim has the SAME subject pattern but belongs to a different tenant.
    const db = new Database(join(dir, 'limen.db'));
    db.exec(`
      INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, created_at, status, archived, grounding_mode)
      VALUES ('foreign-claim-001', 'tenant-X', 'entity:project:iso', 'decision.secret', 'string', 'Foreign secret data', 0.9, datetime('now'), datetime('now'), 'active', 0, 'runtime_witness')
    `);
    db.close();

    const result = limen.cognitive.compile({
      domain: 'entity:project:iso',
      format: 'raw',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const parsed = JSON.parse(result.value.text);
    assert.ok(Array.isArray(parsed), 'must be array');

    // The foreign-tenant claim must NOT appear
    const foreignClaims = parsed.filter((c: { id: string }) => c.id === 'foreign-claim-001');
    assert.equal(foreignClaims.length, 0, 'F-CC-001: foreign-tenant claim must NOT appear in compile output');

    // The legitimate claim MUST appear
    assert.ok(parsed.length >= 1, 'legitimate claims must be included');
    const hasLegit = parsed.some((c: { predicate: string }) => c.predicate === 'decision.arch');
    assert.ok(hasLegit, 'legitimate same-tenant claim must be present');
  });

  // ── F-CC-002: Decay computation (M-7 kill) ──
  // Mutation: hardcoding effectiveConfidence = confidence survives because all claims are fresh.
  // Fix: seed a claim with an old validAt, verify effectiveConfidence < confidence.
  it('F-CC-002 [DECAY]: effectiveConfidence is less than confidence for old claims', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed a claim via API first (to ensure schema exists)
    limen.remember('entity:project:decay', 'observation.recent', 'A recent observation');

    // Now insert a very old claim directly via SQL (1 year ago)
    const db = new Database(join(dir, 'limen.db'));
    const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
    db.exec(`
      INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, created_at, status, archived, grounding_mode)
      VALUES ('old-claim-001', NULL, 'entity:project:decay', 'observation.old', 'string', 'An old observation', 0.9, '${oneYearAgo}', '${oneYearAgo}', 'active', 0, 'runtime_witness')
    `);
    db.close();

    const result = limen.cognitive.compile({
      domain: 'entity:project:decay',
      format: 'raw',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const parsed = JSON.parse(result.value.text);
    const oldClaim = parsed.find((c: { id: string }) => c.id === 'old-claim-001');
    assert.ok(oldClaim, 'old claim must be included in output');
    assert.ok(
      oldClaim.effectiveConfidence < oldClaim.confidence,
      `F-CC-002: effectiveConfidence (${oldClaim.effectiveConfidence}) must be < confidence (${oldClaim.confidence}) for a 1-year-old claim`,
    );
    // Verify the recent claim is near 1.0 (no significant decay)
    const recentClaim = parsed.find((c: { predicate: string }) => c.predicate === 'observation.recent');
    assert.ok(recentClaim, 'recent claim must be included');
    assert.ok(
      recentClaim.effectiveConfidence > oldClaim.effectiveConfidence,
      'recent claim must have higher effectiveConfidence than old claim',
    );
  });

  // ── F-CC-003: Staleness computation (M-10 kill) ──
  // Mutation: hardcoding staleness='fresh' survives because all claims have recent lastAccessedAt.
  // Fix: seed claims with old lastAccessedAt via SQL, verify staleness='stale'.
  it('F-CC-003 [STALENESS]: staleness is "stale" when all claims have old lastAccessedAt', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed claims via API
    limen.remember('entity:project:stale', 'observation.item1', 'Observation one');
    limen.remember('entity:project:stale', 'observation.item2', 'Observation two');

    // Force all claims in this domain to have old lastAccessedAt
    const db = new Database(join(dir, 'limen.db'));
    db.exec(`
      UPDATE claim_assertions
      SET last_accessed_at = '2020-01-01T00:00:00.000Z'
      WHERE subject LIKE 'entity:project:stale%'
    `);
    db.close();

    const result = limen.cognitive.compile({
      domain: 'entity:project:stale',
      format: 'reasoning-ready',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    assert.equal(result.value.staleness, 'stale',
      'F-CC-003: staleness must be "stale" when all included claims have old lastAccessedAt');
    assert.ok(result.value.claimCount > 0, 'must include claims');
  });

  // ── F-CC-004: Archived filter (M-8 kill) ──
  // Mutation: removing `archived = 0` from SQL survives because no claims are archived.
  // Fix: archive a claim via SQL, verify it's excluded from compile output.
  it('F-CC-004 [ARCHIVED]: compile excludes archived claims', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed two claims
    limen.remember('entity:project:arch', 'decision.keep', 'Keep this');
    limen.remember('entity:project:arch', 'decision.remove', 'Archive this');

    // Archive one claim via SQL
    const db = new Database(join(dir, 'limen.db'));
    db.exec(`
      UPDATE claim_assertions
      SET archived = 1
      WHERE predicate = 'decision.remove' AND subject = 'entity:project:arch'
    `);
    db.close();

    const result = limen.cognitive.compile({
      domain: 'entity:project:arch',
      format: 'raw',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const parsed = JSON.parse(result.value.text);
    assert.equal(parsed.length, 1, 'F-CC-004: only non-archived claim should appear');
    assert.equal(parsed[0].predicate, 'decision.keep', 'the non-archived claim must be the one we kept');
  });

  // ── F-CC-005: LIKE escaping (M-11 kill) ──
  // Mutation: removing escapeLikeWildcards call survives because no domains contain SQL wildcards.
  // Fix: use a domain containing `_` (SQL LIKE wildcard), verify it doesn't match unintended rows.
  it('F-CC-005 [LIKE-ESCAPE]: domain with SQL wildcards does not match unintended subjects', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed claims for two similar-looking subjects
    limen.remember('entity:project:alpha', 'observation.a', 'Alpha claim');
    limen.remember('entity:project:beta', 'observation.b', 'Beta claim');

    // Query with a domain that uses `_` — without escaping, `_` matches any single char
    // in LIKE, so 'entity:project:a_pha' would match 'entity:project:alpha'.
    // But with proper escaping, it should NOT match 'entity:project:alpha'.
    const result = limen.cognitive.compile({
      domain: 'entity:project:a_pha',
      format: 'raw',
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const parsed = JSON.parse(result.value.text);
    // Without LIKE escaping, `a_pha` would match `alpha` (since `_` = any char).
    // With proper escaping, there should be no match.
    assert.equal(parsed.length, 0,
      'F-CC-005: domain "entity:project:a_pha" must NOT match "entity:project:alpha" — underscore must be escaped');
  });

  // ── F-CC-006: Determinism with tiebreaker ──
  // This test is covered by existing DC-COMPILE-10 but strengthened by the code fix
  // (ORDER BY ... , id ASC tiebreaker). No additional test needed beyond DC-COMPILE-10.

  // ── F-CC-007: Truncation for structured/raw formats ──
  // Existing DC-COMPILE-06 only tests reasoning-ready truncation.
  // Add tests for structured and raw formats with small maxTokens.
  it('F-CC-007a [TRUNCATION-STRUCTURED]: maxTokens truncates structured format', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed many claims
    for (let i = 0; i < 20; i++) {
      limen.remember(
        'entity:project:truncstruct',
        `observation.item${i}`,
        `A reasonably long structured observation value number ${i} that fills the token budget`,
      );
    }

    const result = limen.cognitive.compile({
      domain: 'entity:project:truncstruct',
      format: 'structured',
      maxTokens: 100, // Very small budget
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(ctx.claimCount < 20, 'F-CC-007a: structured format must truncate with small maxTokens');

    const parsed = JSON.parse(ctx.text);
    assert.ok(parsed.omitted, 'must contain omission notice in structured output');
  });

  it('F-CC-007b [TRUNCATION-RAW]: maxTokens truncates raw format', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed many claims
    for (let i = 0; i < 20; i++) {
      limen.remember(
        'entity:project:truncraw',
        `observation.item${i}`,
        `A reasonably long raw observation value number ${i} that fills the token budget nicely`,
      );
    }

    const result = limen.cognitive.compile({
      domain: 'entity:project:truncraw',
      format: 'raw',
      maxTokens: 100, // Very small budget
    });

    assert.equal(result.ok, true, 'compile must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(ctx.claimCount < 20, 'F-CC-007b: raw format must truncate with small maxTokens');

    const parsed = JSON.parse(ctx.text);
    const omissionEntry = parsed.find((c: { __omitted?: string }) => c.__omitted);
    assert.ok(omissionEntry, 'raw format must include omission sentinel when truncated');
  });

  // ── F-CC-008: maxTokens=0 returns error ──
  it('F-CC-008 [REJECTION]: maxTokens=0 returns COMPILE_INVALID_MAX_TOKENS error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:alpha',
      format: 'reasoning-ready',
      maxTokens: 0,
    });

    assert.equal(result.ok, false, 'maxTokens=0 must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'COMPILE_INVALID_MAX_TOKENS',
      'F-CC-008: error code must be COMPILE_INVALID_MAX_TOKENS');
  });

  it('F-CC-008b [REJECTION]: negative maxTokens returns COMPILE_INVALID_MAX_TOKENS error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.compile({
      domain: 'entity:project:alpha',
      format: 'raw',
      maxTokens: -10,
    });

    assert.equal(result.ok, false, 'negative maxTokens must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'COMPILE_INVALID_MAX_TOKENS',
      'F-CC-008b: error code must be COMPILE_INVALID_MAX_TOKENS');
  });

});
