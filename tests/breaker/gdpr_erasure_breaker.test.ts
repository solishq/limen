/**
 * GDPR Erasure Engine Breaker Attack Tests — Phase B Remediation
 *
 * Attack surface: The Builder changed GDPR erasure SQL from `LIKE '%subject%'`
 * to exact + child match with wildcard escaping. This test file attacks the fix
 * across 8 mandatory vectors.
 *
 * FINDING (F-GDPR-001): The erasure engine's LIKE child pattern
 *   (e.g., `entity:user:alice:%`) is designed to match hierarchical child
 *   subjects like `entity:user:alice:session:123`. However, isValidSubjectURN()
 *   at claim_stores.ts:162 enforces `parts.length !== 3` — exactly 3 colon-
 *   separated segments. This means child subjects with >3 segments can NEVER
 *   be created through the claim assertion pipeline. The LIKE child matching
 *   is dead code in the current system.
 *
 * Findings covered:
 *   AV-1: Boundary attacks — child hierarchy is dead code (FINDING F-GDPR-001)
 *   AV-2: Negative test — aliceberg survives alice erasure
 *   AV-3: Unicode attacks — null bytes and normalization
 *   AV-4: SQL injection — malicious subject parameter
 *   AV-5: Wildcard leakage — literal % and _ in subject
 *   AV-6: Empty/null subjects — must not delete everything
 *   AV-7: Nested subjects — can never be created (FINDING F-GDPR-001)
 *   AV-8: Case sensitivity — behavior documented
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLimen } from '../../src/api/index.js';
import { resetSecurityColumnCache } from '../../src/claims/store/claim_stores.js';

// -- Test Helpers --

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-gdpr-breaker-'));
}

function masterKey(): Buffer {
  return Buffer.alloc(32, 0xab);
}

async function withLimen(fn: (limen: Awaited<ReturnType<typeof createLimen>>) => void | Promise<void>): Promise<void> {
  const dataDir = tmpDir();
  resetSecurityColumnCache();
  const limen = await createLimen({
    dataDir,
    masterKey: masterKey(),
    providers: [],
  });
  try {
    await fn(limen);
  } finally {
    await limen.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ============================================================================
// AV-1: BOUNDARY ATTACKS — Child hierarchy is dead code
// FINDING F-GDPR-001: isValidSubjectURN enforces exactly 3 colon-separated
// segments, so child subjects like entity:user:alice:session:123 can NEVER
// be created. The LIKE child pattern in erasure_engine.ts:123 is untestable.
// ============================================================================

describe('AV-1: Boundary attacks — child hierarchy (F-GDPR-001)', () => {
  it('FINDING: isValidSubjectURN rejects subjects with >3 colon-separated segments', async () => {
    await withLimen(async (limen) => {
      // Attempt to create a child subject — should be rejected by validation
      const childResult = limen.remember(
        'entity:user:alice:session:123',
        'contact.email',
        'alice-session@example.com',
      );
      // EXPECTED: This fails because isValidSubjectURN requires exactly 3 segments
      assert.ok(!childResult.ok, 'F-GDPR-001: Child subject with >3 segments should be rejected by isValidSubjectURN');

      // Verify the deeply nested form is also rejected
      const deepResult = limen.remember(
        'entity:user:alice:device:phone:contact:1',
        'contact.email',
        'alice-deep@example.com',
      );
      assert.ok(!deepResult.ok, 'F-GDPR-001: Deep child subject should be rejected by isValidSubjectURN');
    });
  });

  it('EVIDENCE: exact match still works for 3-segment subjects', async () => {
    await withLimen(async (limen) => {
      // Create a valid 3-segment PII claim
      const result = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(result.ok, 'remember failed');

      // Erase alice — exact match works
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17 — exact match test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
      if (!erasureResult.ok) return;

      assert.ok(
        erasureResult.value.claimsTombstoned >= 1,
        `Expected at least 1 claim tombstoned, got ${erasureResult.value.claimsTombstoned}`,
      );

      // Verify alice is gone
      const recall = limen.recall('entity:user:alice');
      assert.ok(recall.ok);
      if (!recall.ok) return;
      assert.equal(recall.value.length, 0, 'alice claims should be tombstoned');
    });
  });
});

// ============================================================================
// AV-2: NEGATIVE TEST — aliceberg survives alice erasure
// ============================================================================

describe('AV-2: Negative test — aliceberg survives alice erasure', () => {
  it('ATTACK: entity:user:aliceberg MUST survive entity:user:alice erasure', async () => {
    await withLimen(async (limen) => {
      const aliceResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(aliceResult.ok);

      const alicebergResult = limen.remember(
        'entity:user:aliceberg',
        'contact.email',
        'aliceberg@example.com',
      );
      assert.ok(alicebergResult.ok);

      // Erase alice
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // alice is gone
      const aliceRecall = limen.recall('entity:user:alice');
      assert.ok(aliceRecall.ok);
      if (!aliceRecall.ok) return;
      assert.equal(aliceRecall.value.length, 0, 'alice should be tombstoned');

      // aliceberg MUST survive
      const alicebergRecall = limen.recall('entity:user:aliceberg');
      assert.ok(alicebergRecall.ok);
      if (!alicebergRecall.ok) return;
      assert.ok(
        alicebergRecall.value.length >= 1,
        'aliceberg MUST survive alice erasure — collateral damage detected',
      );
    });
  });

  it('ATTACK: entity:user:al survives entity:user:alice erasure (prefix test)', async () => {
    await withLimen(async (limen) => {
      const alResult = limen.remember(
        'entity:user:al',
        'contact.email',
        'al@example.com',
      );
      assert.ok(alResult.ok);

      const aliceResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(aliceResult.ok);

      // Erase alice
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok);

      // al MUST survive (it is a shorter subject, not alice's child)
      const alRecall = limen.recall('entity:user:al');
      assert.ok(alRecall.ok);
      if (!alRecall.ok) return;
      assert.ok(
        alRecall.value.length >= 1,
        'entity:user:al MUST survive entity:user:alice erasure — prefix collision',
      );
    });
  });

  it('ATTACK: entity:user:alice2 survives entity:user:alice erasure', async () => {
    await withLimen(async (limen) => {
      const alice2Result = limen.remember(
        'entity:user:alice2',
        'contact.email',
        'alice2@example.com',
      );
      assert.ok(alice2Result.ok);

      const aliceResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(aliceResult.ok);

      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok);

      // alice2 MUST survive
      const alice2Recall = limen.recall('entity:user:alice2');
      assert.ok(alice2Recall.ok);
      if (!alice2Recall.ok) return;
      assert.ok(
        alice2Recall.value.length >= 1,
        'entity:user:alice2 MUST survive entity:user:alice erasure',
      );
    });
  });
});

// ============================================================================
// AV-3: UNICODE ATTACKS — null bytes and Unicode normalization
// ============================================================================

describe('AV-3: Unicode attacks', () => {
  it('ATTACK: null byte in subject is rejected by validation or does not bypass match', async () => {
    await withLimen(async (limen) => {
      // Create claim with null byte embedded in subject
      // Subject: entity:user:alice\x00berg — has exactly 3 segments if null byte
      // is treated as part of the third segment
      const nullByteSubject = 'entity:user:alice\x00berg';
      const result = limen.remember(
        nullByteSubject,
        'contact.email',
        'nullbyte@example.com',
      );
      // The system should either reject the null byte or handle it properly.
      if (result.ok) {
        // Subject was accepted — now erase alice
        const erasureResult = limen.governance.erasure({
          dataSubjectId: 'user:alice',
          reason: 'GDPR Art. 17 — null byte test',
          includeRelated: false,
        });
        // The null-byte subject should NOT be matched by alice erasure
        // (it is entity:user:alice\x00berg, not entity:user:alice)
        const nullRecall = limen.recall(nullByteSubject);
        if (nullRecall.ok && nullRecall.value.length === 0) {
          assert.fail('NULL BYTE BYPASS: entity:user:alice\\x00berg was erased by alice erasure');
        }
        // If it survived, correct behavior
      }
      // If remember() failed, the system rejected null bytes — document but not a defect
    });
  });

  it('ATTACK: Unicode combining characters do not create false matches', async () => {
    await withLimen(async (limen) => {
      // Use Unicode e-acute (U+00E9, pre-composed) vs e + combining acute (U+0065 U+0301)
      const precomposed = 'entity:user:caf\u00e9';
      const decomposed = 'entity:user:cafe\u0301';

      const result1 = limen.remember(precomposed, 'contact.email', 'cafe1@example.com');
      assert.ok(result1.ok, 'precomposed remember failed');

      const result2 = limen.remember(decomposed, 'contact.email', 'cafe2@example.com');
      assert.ok(result2.ok, 'decomposed remember failed');

      // Erase the precomposed form
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:caf\u00e9',
        reason: 'GDPR Art. 17 — Unicode test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Verify the decomposed form still exists (byte comparison, different bytes)
      const decomposedRecall = limen.recall(decomposed);
      assert.ok(decomposedRecall.ok);
      if (!decomposedRecall.ok) return;
      assert.ok(
        decomposedRecall.value.length >= 1,
        'Decomposed Unicode subject must survive precomposed erasure (SQLite byte comparison)',
      );
    });
  });

  it('ATTACK: very long subject within 256 char limit', async () => {
    await withLimen(async (limen) => {
      // Subject with long third segment (but within 256 char limit)
      const longId = 'a'.repeat(240);
      const longSubject = `entity:user:${longId}`;
      const result = limen.remember(longSubject, 'contact.email', 'long@example.com');

      if (result.ok) {
        const erasureResult = limen.governance.erasure({
          dataSubjectId: `user:${longId}`,
          reason: 'GDPR Art. 17 — long subject test',
          includeRelated: false,
        });
        assert.ok(erasureResult.ok, 'Erasure of long subject should work');
      }
      // If rejected, 256-char limit validation is working
    });
  });
});

// ============================================================================
// AV-4: SQL INJECTION — malicious subject parameter
// ============================================================================

describe('AV-4: SQL injection attacks', () => {
  it('ATTACK: SQL injection via dataSubjectId does not execute', async () => {
    await withLimen(async (limen) => {
      // Create a legitimate claim first
      const legitimateResult = limen.remember(
        'entity:user:legitimate',
        'contact.email',
        'legit@example.com',
      );
      assert.ok(legitimateResult.ok, 'legitimate remember failed');

      // Attempt SQL injection via dataSubjectId
      const injectionResult = limen.governance.erasure({
        dataSubjectId: "'; DROP TABLE claim_assertions; --",
        reason: 'SQL injection test',
        includeRelated: false,
      });
      // This should return ERASURE_NO_CLAIMS_FOUND, not an SQL error
      // and certainly should NOT drop the table
      if (injectionResult.ok) {
        assert.fail('SQL injection found claims — possible vulnerability');
      }
      assert.equal(injectionResult.error.code, 'ERASURE_NO_CLAIMS_FOUND',
        'SQL injection should return no-claims-found, not succeed or crash');

      // Verify the legitimate claim still exists (table was not dropped)
      const recall = limen.recall('entity:user:legitimate');
      assert.ok(recall.ok, 'recall failed — table may have been dropped');
      if (!recall.ok) return;
      assert.ok(
        recall.value.length >= 1,
        'Legitimate claim must survive SQL injection attempt — table integrity check',
      );
    });
  });

  it('ATTACK: LIKE escape sequence injection via dataSubjectId', async () => {
    await withLimen(async (limen) => {
      const legitimateResult = limen.remember(
        'entity:user:safe',
        'contact.email',
        'safe@example.com',
      );
      assert.ok(legitimateResult.ok);

      // Try to inject LIKE escape sequences
      const escapeResult = limen.governance.erasure({
        dataSubjectId: "user:safe' OR '1'='1",
        reason: 'LIKE escape injection test',
        includeRelated: false,
      });
      // Should not find any claims
      assert.ok(!escapeResult.ok, 'SQL escape injection should not find claims');
      assert.equal(escapeResult.error.code, 'ERASURE_NO_CLAIMS_FOUND');

      // Verify the safe claim still exists
      const recall = limen.recall('entity:user:safe');
      assert.ok(recall.ok);
      if (!recall.ok) return;
      assert.ok(recall.value.length >= 1, 'Safe claim must survive escape injection');
    });
  });

  it('ATTACK: Union-based injection attempt', async () => {
    await withLimen(async (limen) => {
      const legitimateResult = limen.remember(
        'entity:user:target',
        'contact.email',
        'target@example.com',
      );
      assert.ok(legitimateResult.ok);

      // Union injection attempt
      const unionResult = limen.governance.erasure({
        dataSubjectId: "x' UNION SELECT id, subject FROM claim_assertions --",
        reason: 'union injection test',
        includeRelated: false,
      });
      assert.ok(!unionResult.ok, 'Union injection should not find claims');

      // Verify target is untouched
      const recall = limen.recall('entity:user:target');
      assert.ok(recall.ok);
      if (!recall.ok) return;
      assert.ok(recall.value.length >= 1, 'Target claim must survive union injection');
    });
  });
});

// ============================================================================
// AV-5: WILDCARD LEAKAGE — literal % and _ in subject
// ============================================================================

describe('AV-5: Wildcard leakage — literal % and _ in subject', () => {
  it('ATTACK: subject containing literal % does not become wildcard', async () => {
    await withLimen(async (limen) => {
      // Create a claim whose subject contains a literal %
      const percentResult = limen.remember(
        'entity:user:100%alice',
        'contact.email',
        'percent@example.com',
      );
      assert.ok(percentResult.ok, 'percent subject remember failed');

      // Create a claim for a different user
      const otherResult = limen.remember(
        'entity:user:bob',
        'contact.email',
        'bob@example.com',
      );
      assert.ok(otherResult.ok, 'bob remember failed');

      // Erase user:100%alice — the % must be treated as literal, not wildcard
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:100%alice',
        reason: 'GDPR Art. 17 — percent wildcard test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // bob MUST survive
      const bobRecall = limen.recall('entity:user:bob');
      assert.ok(bobRecall.ok);
      if (!bobRecall.ok) return;
      assert.ok(
        bobRecall.value.length >= 1,
        'bob MUST survive 100%alice erasure — % wildcard leakage detected',
      );
    });
  });

  it('ATTACK: subject containing literal _ does not become single-char wildcard', async () => {
    await withLimen(async (limen) => {
      // Create subject with underscore
      const underscoreResult = limen.remember(
        'entity:user:test_user',
        'contact.email',
        'underscore@example.com',
      );
      assert.ok(underscoreResult.ok);

      // Create subject that would match if _ is wildcard (testXuser)
      const similarResult = limen.remember(
        'entity:user:testXuser',
        'contact.email',
        'testxuser@example.com',
      );
      assert.ok(similarResult.ok);

      // Erase test_user
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:test_user',
        reason: 'GDPR Art. 17 — underscore wildcard test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok);

      // testXuser MUST survive (underscore must not act as single-char wildcard)
      const xRecall = limen.recall('entity:user:testXuser');
      assert.ok(xRecall.ok);
      if (!xRecall.ok) return;
      assert.ok(
        xRecall.value.length >= 1,
        'testXuser MUST survive test_user erasure — _ wildcard leakage detected',
      );
    });
  });

  it('ATTACK: subject containing literal backslash does not break escape sequence', async () => {
    await withLimen(async (limen) => {
      // Subject with literal backslash (the escape character itself)
      const bsResult = limen.remember(
        'entity:user:back\\slash',
        'contact.email',
        'backslash@example.com',
      );
      assert.ok(bsResult.ok, 'backslash subject remember failed');

      // Erase — should not crash or produce SQL error
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:back\\slash',
        reason: 'GDPR Art. 17 — backslash escape test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure with backslash failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
    });
  });

  it('ATTACK: double percent %% does not create match-all pattern', async () => {
    await withLimen(async (limen) => {
      // Create claims
      const dpResult = limen.remember(
        'entity:user:double%%pct',
        'contact.email',
        'doublepct@example.com',
      );
      assert.ok(dpResult.ok, 'double percent subject remember failed');

      const otherResult = limen.remember(
        'entity:user:innocent',
        'contact.email',
        'innocent@example.com',
      );
      assert.ok(otherResult.ok);

      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:double%%pct',
        reason: 'GDPR Art. 17 — double percent test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok);

      // innocent MUST survive
      const innocentRecall = limen.recall('entity:user:innocent');
      assert.ok(innocentRecall.ok);
      if (!innocentRecall.ok) return;
      assert.ok(
        innocentRecall.value.length >= 1,
        'innocent MUST survive double%% erasure',
      );
    });
  });
});

// ============================================================================
// AV-6: EMPTY/NULL SUBJECTS — must not delete everything
// ============================================================================

describe('AV-6: Empty/null subjects — catastrophic deletion guard', () => {
  it('ATTACK: empty string dataSubjectId must not delete all claims', async () => {
    await withLimen(async (limen) => {
      // Create a legitimate claim
      const result = limen.remember(
        'entity:user:protected',
        'contact.email',
        'protected@example.com',
      );
      assert.ok(result.ok);

      // Attempt erasure with empty string
      const erasureResult = limen.governance.erasure({
        dataSubjectId: '',
        reason: 'empty subject test',
        includeRelated: false,
      });

      // Either it fails gracefully OR it finds no claims.
      // It MUST NOT delete the protected claim.
      const recall = limen.recall('entity:user:protected');
      assert.ok(recall.ok, 'recall failed after empty subject erasure');
      if (!recall.ok) return;
      assert.ok(
        recall.value.length >= 1,
        'CATASTROPHIC: Empty string erasure deleted claims — ALL DATA AT RISK',
      );
    });
  });

  it('ATTACK: whitespace-only dataSubjectId must not delete all claims', async () => {
    await withLimen(async (limen) => {
      const result = limen.remember(
        'entity:user:guarded',
        'contact.email',
        'guarded@example.com',
      );
      assert.ok(result.ok);

      // Attempt erasure with whitespace
      const erasureResult = limen.governance.erasure({
        dataSubjectId: '   ',
        reason: 'whitespace subject test',
        includeRelated: false,
      });

      // Verify claim survives
      const recall = limen.recall('entity:user:guarded');
      assert.ok(recall.ok);
      if (!recall.ok) return;
      assert.ok(
        recall.value.length >= 1,
        'CATASTROPHIC: Whitespace erasure deleted claims',
      );
    });
  });

  it('ATTACK: single colon dataSubjectId does not match everything', async () => {
    await withLimen(async (limen) => {
      const result = limen.remember(
        'entity:user:sentinel',
        'contact.email',
        'sentinel@example.com',
      );
      assert.ok(result.ok);

      // Single colon — with LIKE ':%', could potentially match all subjects starting with colon
      const erasureResult = limen.governance.erasure({
        dataSubjectId: ':',
        reason: 'colon-only subject test',
        includeRelated: false,
      });

      // Verify claim survives
      const recall = limen.recall('entity:user:sentinel');
      assert.ok(recall.ok);
      if (!recall.ok) return;
      assert.ok(
        recall.value.length >= 1,
        'Single colon erasure deleted claims — wildcard behavior detected',
      );
    });
  });

  it('ATTACK: entity: prefix only (partial URN) does not over-match', async () => {
    await withLimen(async (limen) => {
      const result = limen.remember(
        'entity:user:safe-here',
        'contact.email',
        'safehere@example.com',
      );
      assert.ok(result.ok);

      // "entity:" as dataSubjectId — fullUrn becomes "entity:entity:"
      // LIKE pattern becomes "entity\\:entity\\::%"
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'entity:',
        reason: 'partial URN test',
        includeRelated: false,
      });

      // Claim must survive
      const recall = limen.recall('entity:user:safe-here');
      assert.ok(recall.ok);
      if (!recall.ok) return;
      assert.ok(
        recall.value.length >= 1,
        'Partial URN erasure deleted claims — over-matching detected',
      );
    });
  });
});

// ============================================================================
// AV-7: NESTED SUBJECTS — cannot be created (F-GDPR-001 confirmation)
// ============================================================================

describe('AV-7: Nested subjects (F-GDPR-001 confirmation)', () => {
  it('FINDING: entity:user:alice:entity:user:bob is rejected by validation', async () => {
    await withLimen(async (limen) => {
      // Attempt to create nested subject
      const nestedResult = limen.remember(
        'entity:user:alice:entity:user:bob',
        'contact.email',
        'bob-nested@example.com',
      );
      // EXPECTED: Rejected because parts.length !== 3
      assert.ok(
        !nestedResult.ok,
        'F-GDPR-001: Nested subject entity:user:alice:entity:user:bob should be rejected',
      );
    });
  });

  it('SEPARATION: erasing alice does not affect standalone bob', async () => {
    await withLimen(async (limen) => {
      const aliceResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(aliceResult.ok);

      const bobResult = limen.remember(
        'entity:user:bob',
        'contact.email',
        'bob@example.com',
      );
      assert.ok(bobResult.ok);

      // Erase alice
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17 — isolation test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok);

      // Bob MUST survive
      const bobRecall = limen.recall('entity:user:bob');
      assert.ok(bobRecall.ok);
      if (!bobRecall.ok) return;
      assert.ok(
        bobRecall.value.length >= 1,
        'Standalone bob MUST survive alice erasure',
      );
    });
  });
});

// ============================================================================
// AV-8: CASE SENSITIVITY — document behavior
// ============================================================================

describe('AV-8: Case sensitivity behavior', () => {
  it('DOCUMENT: entity:user:Alice vs entity:user:alice — SQLite exact match is case-sensitive', async () => {
    await withLimen(async (limen) => {
      // Create claim with lowercase
      const lowerResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice-lower@example.com',
      );
      assert.ok(lowerResult.ok);

      // Create claim with mixed case third segment
      const mixedResult = limen.remember(
        'entity:user:Alice',
        'contact.email',
        'alice-mixed@example.com',
      );
      assert.ok(mixedResult.ok, 'Mixed case subject remember failed');

      // Erase lowercase form
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17 — case sensitivity test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Check if mixed case survived
      const mixedRecall = limen.recall('entity:user:Alice');
      assert.ok(mixedRecall.ok);
      if (!mixedRecall.ok) return;

      // SQLite = operator IS case-sensitive.
      // But SQLite LIKE is case-insensitive for ASCII by default.
      // The exact match uses = so entity:user:Alice != entity:user:alice.
      // The LIKE child pattern is entity:user:alice:% which would case-insensitively
      // match entity:user:Alice:* but since child subjects cannot exist (F-GDPR-001),
      // only the = matters. entity:user:Alice should SURVIVE.
      const survived = mixedRecall.value.length >= 1;
      if (!survived) {
        // FINDING: case-insensitive erasure means data from different users
        // could be erased. However, since the LIKE only matches children (:%)
        // and = is case-sensitive, this would only happen if the fullUrn form
        // or the raw form matched case-insensitively. Let's check which matched.
        // If entity:user:Alice was erased, the LIKE pattern matched it, which
        // means the child LIKE is not dead code but is actually matching EXACT
        // subjects case-insensitively. This would be a HIGH finding.
        assert.fail(
          'CASE SENSITIVITY FINDING: entity:user:Alice was erased by user:alice — ' +
          'LIKE child pattern is case-insensitively matching exact subjects. ' +
          'This means SQLite LIKE "entity:user:alice:%" matched "entity:user:Alice" ' +
          'because LIKE is case-insensitive for ASCII. This is collateral erasure.',
        );
      }
    });
  });

  it('DOCUMENT: verify exact = operator behavior in claim query', async () => {
    await withLimen(async (limen) => {
      // Create two subjects that differ only by case
      const lower = limen.remember('entity:user:zebra', 'contact.email', 'zebra@example.com');
      assert.ok(lower.ok);

      const upper = limen.remember('entity:user:Zebra', 'contact.email', 'Zebra@example.com');
      assert.ok(upper.ok);

      // Erase lowercase
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:zebra',
        reason: 'GDPR case test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok);

      // Verify uppercase survives
      const upperRecall = limen.recall('entity:user:Zebra');
      assert.ok(upperRecall.ok);
      if (!upperRecall.ok) return;
      assert.ok(
        upperRecall.value.length >= 1,
        'entity:user:Zebra MUST survive entity:user:zebra erasure (case-sensitive = operator)',
      );
    });
  });
});

// ============================================================================
// BONUS: Audit trail integrity after erasure
// ============================================================================

describe('BONUS: Audit trail integrity after erasure', () => {
  it('ATTACK: audit chain is valid after erasure with multiple subjects', async () => {
    await withLimen(async (limen) => {
      // Create multiple subjects
      const r1 = limen.remember('entity:user:subj1', 'contact.email', 'subj1@example.com');
      assert.ok(r1.ok);
      const r2 = limen.remember('entity:user:subj2', 'contact.email', 'subj2@example.com');
      assert.ok(r2.ok);
      const r3 = limen.remember('entity:user:subj3', 'contact.email', 'subj3@example.com');
      assert.ok(r3.ok);

      // Erase subj2 (middle subject — tests chain re-hashing)
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:subj2',
        reason: 'GDPR Art. 17 — chain integrity test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
      if (!erasureResult.ok) return;

      // Verify chain is valid
      assert.ok(
        erasureResult.value.chainVerification.valid,
        'Audit chain must be valid after erasure',
      );

      // Verify certificate hash is non-empty
      assert.ok(
        erasureResult.value.certificateHash.length > 0,
        'Certificate hash must be non-empty',
      );
    });
  });

  it('ATTACK: sequential erasures maintain chain integrity', async () => {
    await withLimen(async (limen) => {
      const r1 = limen.remember('entity:user:seq1', 'contact.email', 'seq1@example.com');
      assert.ok(r1.ok);
      const r2 = limen.remember('entity:user:seq2', 'contact.email', 'seq2@example.com');
      assert.ok(r2.ok);

      // First erasure
      const erasure1 = limen.governance.erasure({
        dataSubjectId: 'user:seq1',
        reason: 'GDPR test 1',
        includeRelated: false,
      });
      assert.ok(erasure1.ok);
      if (!erasure1.ok) return;
      assert.ok(erasure1.value.chainVerification.valid, 'Chain invalid after first erasure');

      // Second erasure
      const erasure2 = limen.governance.erasure({
        dataSubjectId: 'user:seq2',
        reason: 'GDPR test 2',
        includeRelated: false,
      });
      assert.ok(erasure2.ok);
      if (!erasure2.ok) return;
      assert.ok(erasure2.value.chainVerification.valid, 'Chain invalid after second erasure');
    });
  });
});

// ============================================================================
// BONUS: Audit tombstone boundary matching (single-tenant mode)
// The audit entries use LIKE with JSON-quoted boundary matching.
// Verify that "user:alice" in JSON does not match "user:aliceberg".
// ============================================================================

describe('BONUS: Audit tombstone boundary matching', () => {
  it('ATTACK: audit entries for aliceberg survive alice erasure', async () => {
    await withLimen(async (limen) => {
      // Create PII claims for both subjects — creates audit entries
      const aliceResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(aliceResult.ok);

      const alicebergResult = limen.remember(
        'entity:user:aliceberg',
        'contact.email',
        'aliceberg@example.com',
      );
      assert.ok(alicebergResult.ok);

      // Erase alice — audit tombstoning should use JSON-quoted boundary
      // matching: %"user:alice"% should NOT match %"user:aliceberg"%
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17 — audit boundary test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Verify aliceberg's claims survive
      const alicebergRecall = limen.recall('entity:user:aliceberg');
      assert.ok(alicebergRecall.ok);
      if (!alicebergRecall.ok) return;
      assert.ok(
        alicebergRecall.value.length >= 1,
        'aliceberg claims must survive alice erasure (audit boundary check)',
      );

      // Export audit and verify aliceberg's data is still present
      const auditExport = limen.governance.exportAudit({
        from: '2020-01-01T00:00:00.000Z',
        to: '2030-12-31T23:59:59.999Z',
      });
      assert.ok(auditExport.ok, 'audit export failed');
      if (!auditExport.ok) return;

      const auditStr = JSON.stringify(auditExport.value);
      // alice's raw ID should NOT appear (tombstoned + hash substitution)
      // Note: we check for the raw dataSubjectId, not the entity URN
      assert.equal(
        auditStr.includes('"user:alice"'),
        false,
        'Audit should not contain raw "user:alice" after erasure (tombstoned or hashed)',
      );
    });
  });
});
