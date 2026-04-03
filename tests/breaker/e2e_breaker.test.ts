/**
 * v1.5.0 E2E Integration Hardening -- Breaker Attack Tests
 *
 * Tests that attack the E2E capstone test's blindspots.
 * Each test targets a specific finding from E2E-BREAKER-REPORT.md.
 *
 * Findings covered:
 *   F-E2E-001: Consent status filter mutation survived -- test only has active consent
 *   F-E2E-002: Audit tombstone LIKE pattern over-broad (false positives)
 *   F-E2E-003: Erasure audit entry re-introduces PII after tombstoning
 *   F-E2E-004: No over-erasure protection test (only one data subject)
 *   F-E2E-005: Import roundtrip does not verify PII metadata
 *   F-E2E-008: LIKE wildcard in dataSubjectId not escaped
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLimen } from '../../src/api/index.js';
import { resetSecurityColumnCache } from '../../src/claims/store/claim_stores.js';
import type { LimenExportDocument } from '../../src/exchange/exchange_types.js';

// -- Test Helpers --

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-e2e-breaker-'));
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
// F-E2E-001: Consent status filter -- expired consent should NOT be revoked
// The Gap 6 fix filters to only active consent records. If the filter is
// removed (M-6 mutation), expired records would be revoked too. The E2E test
// misses this because it only creates active consent.
// ============================================================================

describe('F-E2E-001: Consent status filter during erasure', () => {
  it('ATTACK: erasure should NOT revoke expired consent records', async () => {
    await withLimen(async (limen) => {
      // Create a PII claim for our data subject
      const piiResult = limen.remember(
        'entity:user:bob',
        'contact.email',
        'bob@example.com',
      );
      assert.ok(piiResult.ok, `remember failed: ${!piiResult.ok ? piiResult.error.message : ''}`);

      // Register an active consent
      const activeConsent = limen.consent.register({
        dataSubjectId: 'user:bob',
        basis: 'explicit_consent',
        scope: 'email_marketing',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      assert.ok(activeConsent.ok, 'active consent register failed');

      // Register a second consent and then revoke it (terminal state)
      const revokedConsent = limen.consent.register({
        dataSubjectId: 'user:bob',
        basis: 'explicit_consent',
        scope: 'analytics',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      assert.ok(revokedConsent.ok, 'revoked consent register failed');
      if (!revokedConsent.ok) return;
      const revokeResult = limen.consent.revoke(revokedConsent.value.id);
      assert.ok(revokeResult.ok, 'consent revoke failed');

      // Now run erasure
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:bob',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
      if (!erasureResult.ok) return;

      // The consent filter should only count the active one.
      // If M-6 mutation is applied (filter removed), revoke on already-revoked record
      // would either increment the count (false positive) or error.
      // With the filter, only the 1 active consent should be revoked.
      assert.equal(
        erasureResult.value.consentRecordsRevoked,
        1,
        'Should revoke exactly 1 consent record (the active one), not the already-revoked one',
      );
    });
  });
});

// ============================================================================
// F-E2E-002: Audit tombstone LIKE pattern over-broad -- false positives
// dataSubjectId 'user:alice' in LIKE '%user:alice%' would also match
// audit entries containing 'user:aliceberg' or other superstrings.
// ============================================================================

describe('F-E2E-002: Audit tombstone LIKE pattern over-broad', () => {
  it('ATTACK: erasure for user:alice should NOT tombstone user:aliceberg audit entries', async () => {
    await withLimen(async (limen) => {
      // Create PII claims for two similar data subjects
      const aliceResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(aliceResult.ok, 'alice remember failed');

      const alicebergResult = limen.remember(
        'entity:user:aliceberg',
        'contact.email',
        'aliceberg@example.com',
      );
      assert.ok(alicebergResult.ok, 'aliceberg remember failed');

      // Erase alice's data
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Verify aliceberg's claim still exists (not tombstoned)
      const alicebergRecall = limen.recall('entity:user:aliceberg');
      assert.ok(alicebergRecall.ok, 'aliceberg recall failed');
      if (!alicebergRecall.ok) return;

      // F-E2E-002b fix: After switching from LIKE '%user:alice%' to exact subject
      // match, user:aliceberg's claims must survive user:alice erasure.
      assert.ok(
        alicebergRecall.value.length >= 1,
        'user:aliceberg claims must survive user:alice erasure (F-E2E-002b fix: exact subject match)',
      );
    });
  });
});

// ============================================================================
// F-E2E-003: Erasure audit entry re-introduces data subject ID
// The erasure engine tombstones audit entries containing the data subject ID
// but then creates a NEW audit entry (step 9) that contains dataSubjectId
// in its detail field.
// ============================================================================

describe('F-E2E-003: Erasure audit entry PII re-introduction', () => {
  it('ATTACK: SOC2 audit export after erasure should not contain data subject ID', async () => {
    await withLimen(async (limen) => {
      // Create PII claim
      const result = limen.remember(
        'entity:user:carol',
        'contact.email',
        'carol@example.com',
      );
      assert.ok(result.ok, 'remember failed');

      // Register consent
      const consent = limen.consent.register({
        dataSubjectId: 'user:carol',
        basis: 'explicit_consent',
        scope: 'marketing',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      assert.ok(consent.ok, 'consent register failed');

      // Erase
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:carol',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Export SOC2 audit
      const auditExport = limen.governance.exportAudit({
        from: '2020-01-01T00:00:00.000Z',
        to: '2030-12-31T23:59:59.999Z',
      });
      assert.ok(auditExport.ok, 'audit export failed');
      if (!auditExport.ok) return;

      const auditStr = JSON.stringify(auditExport.value);

      // The E2E test checks for the email address, but NOT for the data subject ID.
      // After erasure, the data subject ID should not appear in the audit trail.
      // FINDING: The erasure engine's own audit entry (step 9) contains
      // dataSubjectId: 'user:carol' in its detail, re-introducing PII.
      assert.equal(
        auditStr.includes('carol@example.com'),
        false,
        'SOC2 export should not contain raw email after erasure',
      );

      // F-E2E-003 fix: The dataSubjectId itself is PII metadata identifying
      // the data subject. After the fix, the erasure audit entry should contain
      // a SHA-256 hash prefix instead of the raw dataSubjectId.
      assert.equal(
        auditStr.includes('user:carol'),
        false,
        'SOC2 audit export should not contain raw data subject ID after erasure (F-E2E-003 fix)',
      );
    });
  });
});

// ============================================================================
// F-E2E-004: Over-erasure protection -- second data subject should survive
// ============================================================================

describe('F-E2E-004: Over-erasure protection', () => {
  it('ATTACK: erasing subject A must not affect subject B claims', async () => {
    await withLimen(async (limen) => {
      // Create PII claims for two different data subjects
      const aliceResult = limen.remember(
        'entity:user:diana',
        'contact.email',
        'diana@example.com',
      );
      assert.ok(aliceResult.ok, 'diana remember failed');

      const bobResult = limen.remember(
        'entity:user:eve',
        'contact.email',
        'eve@example.com',
      );
      assert.ok(bobResult.ok, 'eve remember failed');

      // Erase diana
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:diana',
        reason: 'GDPR Art. 17',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Verify eve's claim still exists
      const eveRecall = limen.recall('entity:user:eve');
      assert.ok(eveRecall.ok, 'eve recall failed');
      if (!eveRecall.ok) return;
      assert.ok(
        eveRecall.value.length >= 1,
        'Eve claim must survive Diana erasure',
      );

      // Verify diana's claim is gone
      const dianaRecall = limen.recall('entity:user:diana');
      assert.ok(dianaRecall.ok, 'diana recall failed');
      if (!dianaRecall.ok) return;
      assert.equal(
        dianaRecall.value.length,
        0,
        'Diana claims should be tombstoned after erasure',
      );
    });
  });
});

// ============================================================================
// F-E2E-005: Import roundtrip PII metadata preservation
// The E2E test imports claims but never verifies PII metadata survives.
// ============================================================================

describe('F-E2E-005: Import roundtrip PII metadata', () => {
  it('ATTACK: exported PII claim reimported should have pii_detected=1', async () => {
    // Instance 1: create and export
    const dataDir1 = tmpDir();
    resetSecurityColumnCache();
    const limen1 = await createLimen({
      dataDir: dataDir1,
      masterKey: masterKey(),
      providers: [],
    });

    let exportDoc: LimenExportDocument;
    try {
      const result = limen1.remember(
        'entity:user:frank',
        'contact.email',
        'frank@example.com',
      );
      assert.ok(result.ok, 'remember failed');

      const exportResult = limen1.exportData({
        format: 'json',
        status: 'all',
      });
      assert.ok(exportResult.ok, 'export failed');
      if (!exportResult.ok) return;
      exportDoc = JSON.parse(exportResult.value);
    } finally {
      await limen1.shutdown();
      fs.rmSync(dataDir1, { recursive: true, force: true });
    }

    // Instance 2: import and re-export to verify metadata
    const dataDir2 = tmpDir();
    resetSecurityColumnCache();
    const limen2 = await createLimen({
      dataDir: dataDir2,
      masterKey: masterKey(),
      providers: [],
    });

    try {
      const importResult = limen2.importData(exportDoc);
      assert.ok(importResult.ok, `import failed: ${!importResult.ok ? importResult.error.message : ''}`);

      // Re-export from instance 2
      const reExportResult = limen2.exportData({
        format: 'json',
        status: 'all',
      });
      assert.ok(reExportResult.ok, 're-export failed');
      if (!reExportResult.ok) return;

      const reExportDoc: LimenExportDocument = JSON.parse(reExportResult.value);
      const frankClaim = reExportDoc.claims.find(c => c.subject === 'entity:user:frank');
      assert.ok(frankClaim, 'frank claim not found in re-export');

      // The import goes through assertClaim which re-scans for PII.
      // So piiDetected should be 1 on the reimported claim.
      const piiDetected = (frankClaim as Record<string, unknown>).piiDetected;
      assert.equal(
        piiDetected,
        1,
        'Reimported PII claim should have piiDetected=1 (via re-scan during assertClaim)',
      );
    } finally {
      await limen2.shutdown();
      fs.rmSync(dataDir2, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// F-E2E-008: LIKE wildcard characters in dataSubjectId
// If dataSubjectId contains '%' or '_', the LIKE pattern matches too broadly.
// ============================================================================

describe('F-E2E-008: LIKE wildcard in dataSubjectId', () => {
  it('ATTACK: dataSubjectId containing underscore should not wildcard-match', async () => {
    await withLimen(async (limen) => {
      // Create claims for two subjects that differ by one character
      const result1 = limen.remember(
        'entity:user:test_a',
        'contact.email',
        'testa@example.com',
      );
      assert.ok(result1.ok, 'remember test_a failed');

      const result2 = limen.remember(
        'entity:user:testXa',
        'contact.email',
        'testxa@example.com',
      );
      assert.ok(result2.ok, 'remember testXa failed');

      // Erase user:test_a -- the underscore in LIKE matches any single character
      // so '%user:test_a%' also matches 'entity:user:testXa'
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:test_a',
        reason: 'GDPR test',
        includeRelated: false,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);

      // Verify testXa's claim still exists
      const testXaRecall = limen.recall('entity:user:testXa');
      assert.ok(testXaRecall.ok, 'testXa recall failed');
      if (!testXaRecall.ok) return;

      // F-E2E-008b fix: After escaping SQL wildcards in dataSubjectId,
      // underscore no longer acts as a single-character wildcard.
      assert.ok(
        testXaRecall.value.length >= 1,
        'user:testXa claim must survive user:test_a erasure (F-E2E-008b fix: wildcards escaped)',
      );
    });
  });
});

// ============================================================================
// Cascade topology attacks
// ============================================================================

describe('Cascade topology: A->B->C chain (multi-hop)', () => {
  it('ATTACK: tombstoning root PII claim cascades through B to C', async () => {
    await withLimen(async (limen) => {
      // C is PII root
      const cResult = limen.remember('entity:user:geo', 'contact.email', 'geo@example.com');
      assert.ok(cResult.ok, 'C remember failed');
      if (!cResult.ok) return;

      // B derived_from C
      const bResult = limen.remember('entity:user:geo', 'analysis.derived1', 'derived from email');
      assert.ok(bResult.ok, 'B remember failed');
      if (!bResult.ok) return;
      const connectBC = limen.connect(bResult.value.claimId, cResult.value.claimId, 'derived_from');
      assert.ok(connectBC.ok, 'connect B->C failed');

      // A derived_from B
      const aResult = limen.remember('entity:user:geo', 'analysis.derived2', 'derived from derived');
      assert.ok(aResult.ok, 'A remember failed');
      if (!aResult.ok) return;
      const connectAB = limen.connect(aResult.value.claimId, bResult.value.claimId, 'derived_from');
      assert.ok(connectAB.ok, 'connect A->B failed');

      // Erase -- C is PII, cascade should reach A through B
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:geo',
        reason: 'GDPR cascade test',
        includeRelated: true,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
      if (!erasureResult.ok) return;

      // Verify cascade reached both B and A
      assert.ok(
        erasureResult.value.relationshipsCascaded >= 2,
        `Expected at least 2 cascaded relationships (B and A), got ${erasureResult.value.relationshipsCascaded}`,
      );

      // Verify all claims tombstoned
      const geoRecall = limen.recall('entity:user:geo');
      assert.ok(geoRecall.ok, 'recall failed');
      if (!geoRecall.ok) return;
      assert.equal(
        geoRecall.value.length,
        0,
        'All 3 claims (A, B, C) should be tombstoned after cascade',
      );
    });
  });
});

describe('Cascade topology: diamond inheritance', () => {
  it('ATTACK: D derived_from B AND C, tombstone B, D gets tombstoned via cascade', async () => {
    await withLimen(async (limen) => {
      // B is PII root (email -- detected as PII)
      const bResult = limen.remember('entity:user:hugo', 'contact.email', 'hugo@example.com');
      assert.ok(bResult.ok);
      if (!bResult.ok) return;

      // C is also PII (use email format to ensure PII detection)
      const cResult = limen.remember('entity:user:hugo', 'contact.secondary_email', 'hugo.alt@example.com');
      assert.ok(cResult.ok);
      if (!cResult.ok) return;

      // D derives from both B and C (non-PII content)
      const dResult = limen.remember('entity:user:hugo', 'analysis.combined', 'combined analysis');
      assert.ok(dResult.ok);
      if (!dResult.ok) return;

      limen.connect(dResult.value.claimId, bResult.value.claimId, 'derived_from');
      limen.connect(dResult.value.claimId, cResult.value.claimId, 'derived_from');

      // Erase hugo
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:hugo',
        reason: 'GDPR diamond test',
        includeRelated: true,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
      if (!erasureResult.ok) return;

      // B and C are PII (2 from PII query), D is cascaded from B (1 from cascade)
      // Total tombstoned: 3 (B + C from PII, D from cascade)
      assert.ok(
        erasureResult.value.claimsTombstoned >= 3,
        `Expected at least 3 claims tombstoned (B, C, D), got ${erasureResult.value.claimsTombstoned}`,
      );

      // D should be counted only once in cascaded relationships
      // (discovered via B, skipped when C is processed because already in tombstonedIds)
      assert.ok(
        erasureResult.value.relationshipsCascaded >= 1,
        `Expected at least 1 cascaded relationship, got ${erasureResult.value.relationshipsCascaded}`,
      );

      const hugoRecall = limen.recall('entity:user:hugo');
      assert.ok(hugoRecall.ok);
      if (!hugoRecall.ok) return;
      assert.equal(hugoRecall.value.length, 0, 'All hugo claims should be tombstoned');
    });
  });

  it('F-E2E-011 fix: phone number +1234567890 should be detected as PII', async () => {
    await withLimen(async (limen) => {
      // Phone number in international format (no separators)
      const phoneResult = limen.remember('entity:user:ivan', 'contact.phone', '+1234567890');
      assert.ok(phoneResult.ok);

      // Export to check PII detection
      const exportResult = limen.exportData({ format: 'json', status: 'all' });
      assert.ok(exportResult.ok);
      if (!exportResult.ok) return;

      const doc = JSON.parse(exportResult.value);
      const phoneClaim = doc.claims.find(
        (c: Record<string, unknown>) => c.predicate === 'contact.phone',
      );
      assert.ok(phoneClaim, 'phone claim not found');

      // F-E2E-011 fix: +1234567890 should now be detected as PII.
      assert.equal(
        (phoneClaim as Record<string, unknown>).piiDetected,
        1,
        'Phone number +1234567890 should have pii_detected=1 after F-E2E-011 fix',
      );
    });
  });
});
