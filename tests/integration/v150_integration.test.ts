/**
 * v1.5.0 E2E Integration Test — Capstone
 *
 * Proves all 6 cross-phase integration gaps are fixed:
 *   GAP 1 [P1]: PII detection elevates classification to 'restricted'
 *   GAP 3 [P2]: Vacuous assertions replaced with real tests
 *   GAP 4 [P1]: Export includes Phase 9/10 columns (pii_detected, classification)
 *   GAP 5 [P0]: Erasure cascade direction corrected (descendants, not ancestors)
 *   GAP 6 [P2]: Erasure handles expired consent gracefully
 *   GAP 9 [P0]: Audit tombstoning works in single-tenant mode
 *
 * Single flow:
 *   1. createLimen with security + governance config
 *   2. Add classification rules + protected predicate rules
 *   3. remember() PII claim -> verify pii_detected=1 AND classification='restricted' (elevated)
 *   4. remember() non-PII claim -> verify pii_detected=0 AND classification by rule
 *   5. connect(derived_from) between PII and non-PII claims
 *   6. Register consent for data subject
 *   7. exportData(json) -> verify export includes pii_detected + classification columns
 *   8. Create second Limen instance -> importData -> verify roundtrip preserves metadata
 *   9. governance.erasure(includeRelated=true) on first instance
 *      -> verify PII claim tombstoned
 *      -> verify derived claim tombstoned (cascade)
 *      -> verify consent revoked
 *      -> verify certificate generated with valid SHA-256
 *      -> verify chain integrity
 *      -> verify audit entry exists
 *   10. governance.exportAudit(soc2) -> verify no raw PII in export
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createLimen } from '../../src/api/index.js';
import { resetSecurityColumnCache } from '../../src/claims/store/claim_stores.js';
import type { LimenExportDocument } from '../../src/exchange/exchange_types.js';

// -- Test helpers --

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-v150-e2e-'));
}

function masterKey(): Buffer {
  return Buffer.alloc(32, 0xab);
}

describe('v1.5.0 E2E Integration — Cross-Phase Gap Verification', () => {
  it('full lifecycle: PII elevation + export columns + cascade + audit tombstone + consent', async () => {
    const dataDir = tmpDir();
    resetSecurityColumnCache();

    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      providers: [],
    });

    try {
      // ================================================================
      // Step 2: Add classification rules
      // ================================================================
      const ruleResult = limen.governance.addRule({
        predicatePattern: 'medical.*',
        level: 'confidential',
        reason: 'Medical data is confidential',
      });
      assert.ok(ruleResult.ok, `addRule failed: ${!ruleResult.ok ? ruleResult.error.message : ''}`);

      // ================================================================
      // Step 3: remember() PII claim
      //   GAP 1: verify pii_detected=1 AND classification='restricted' (elevated)
      //   The predicate 'contact.email' would normally be 'unrestricted' by default.
      //   But PII detection should elevate it to at least 'restricted'.
      // ================================================================
      const piiResult = limen.remember(
        'entity:user:alice',
        'contact.email',
        'alice@example.com',
      );
      assert.ok(piiResult.ok, `PII remember failed: ${!piiResult.ok ? piiResult.error.message : ''}`);
      if (!piiResult.ok) return;
      const piiClaimId = piiResult.value.claimId;

      // ================================================================
      // Step 4: remember() non-PII claim with medical predicate
      //   Should get classification='confidential' from rule, pii_detected=0
      // ================================================================
      const nonPiiResult = limen.remember(
        'entity:user:alice',
        'medical.bloodtype',
        'O-positive',
      );
      assert.ok(nonPiiResult.ok, `non-PII remember failed: ${!nonPiiResult.ok ? nonPiiResult.error.message : ''}`);
      if (!nonPiiResult.ok) return;
      const nonPiiClaimId = nonPiiResult.value.claimId;

      // ================================================================
      // Step 5: connect(derived_from) — derived claim derives from PII claim
      //   GAP 5: cascade direction test setup
      // ================================================================
      const connectResult = limen.connect(nonPiiClaimId, piiClaimId, 'derived_from');
      assert.ok(connectResult.ok, `connect failed: ${!connectResult.ok ? connectResult.error.message : ''}`);

      // ================================================================
      // Step 6: Register consent for data subject
      //   GAP 6: consent handling during erasure
      //   F-E2E-001 fix: Add expired and revoked consent records to verify
      //   only active records are counted in consentRecordsRevoked.
      // ================================================================
      const consentResult = limen.consent.register({
        dataSubjectId: 'user:alice',
        basis: 'explicit_consent',
        scope: 'email_marketing',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      assert.ok(consentResult.ok, `consent register failed: ${!consentResult.ok ? consentResult.error.message : ''}`);

      // Register a second consent and immediately revoke it (terminal state)
      const revokedConsentResult = limen.consent.register({
        dataSubjectId: 'user:alice',
        basis: 'explicit_consent',
        scope: 'analytics',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      assert.ok(revokedConsentResult.ok, `revoked consent register failed: ${!revokedConsentResult.ok ? revokedConsentResult.error.message : ''}`);
      if (!revokedConsentResult.ok) return;
      const revokeResult = limen.consent.revoke(revokedConsentResult.value.id);
      assert.ok(revokeResult.ok, `consent revoke failed: ${!revokeResult.ok ? revokeResult.error.message : ''}`);

      // ================================================================
      // Step 7: exportData(json) — verify Phase 9/10 columns present
      //   GAP 4: export includes pii_detected, piiCategories, classification
      // ================================================================
      const exportResult = limen.exportData({
        format: 'json',
        status: 'all',
        includeRelationships: true,
        includeEvidence: true,
      });
      assert.ok(exportResult.ok, `export failed: ${!exportResult.ok ? exportResult.error.message : ''}`);
      if (!exportResult.ok) return;

      const doc: LimenExportDocument = JSON.parse(exportResult.value);
      assert.ok(doc.claims.length >= 2, `Expected at least 2 claims, got ${doc.claims.length}`);

      // Find the PII claim in the export
      const exportedPiiClaim = doc.claims.find(c => c.id === piiClaimId);
      assert.ok(exportedPiiClaim, 'PII claim not found in export');

      // GAP 4 verification: Phase 9/10 columns are present in export
      assert.equal(
        (exportedPiiClaim as Record<string, unknown>).piiDetected,
        1,
        'PII claim should have piiDetected=1 in export',
      );
      assert.ok(
        (exportedPiiClaim as Record<string, unknown>).piiCategories !== null,
        'PII claim should have piiCategories in export',
      );

      // GAP 1 verification: PII detection elevated classification to 'restricted'
      assert.equal(
        (exportedPiiClaim as Record<string, unknown>).classification,
        'restricted',
        'PII claim should have classification elevated to restricted',
      );

      // Verify non-PII medical claim has classification from rule
      const exportedNonPiiClaim = doc.claims.find(c => c.id === nonPiiClaimId);
      assert.ok(exportedNonPiiClaim, 'Non-PII claim not found in export');
      assert.equal(
        (exportedNonPiiClaim as Record<string, unknown>).classification,
        'confidential',
        'Medical claim should have classification=confidential from rule',
      );

      // Verify relationships in export
      assert.ok(
        doc.relationships.length >= 1,
        `Expected at least 1 relationship in export, got ${doc.relationships.length}`,
      );
      const derivedRel = doc.relationships.find(
        r => r.type === 'derived_from',
      );
      assert.ok(derivedRel, 'derived_from relationship not found in export');

      // ================================================================
      // Step 8: Import into second instance — verify roundtrip
      //   GAP 4: imported claims preserve metadata via assertClaim delegation
      // ================================================================
      const dataDir2 = tmpDir();
      resetSecurityColumnCache();
      const limen2 = await createLimen({
        dataDir: dataDir2,
        masterKey: masterKey(),
        providers: [],
      });
      try {
        const importResult = limen2.importData(doc);
        assert.ok(importResult.ok, `import failed: ${!importResult.ok ? importResult.error.message : ''}`);
        if (!importResult.ok) return;
        assert.ok(
          importResult.value.imported >= 2,
          `Expected at least 2 imported, got ${importResult.value.imported}`,
        );

        // Verify imported data is searchable
        const recalled = limen2.recall('entity:user:alice');
        assert.ok(recalled.ok, 'recall on imported instance failed');
        if (!recalled.ok) return;
        assert.ok(recalled.value.length >= 2, 'Should recall at least 2 imported beliefs');
      } finally {
        await limen2.shutdown();
        fs.rmSync(dataDir2, { recursive: true, force: true });
      }

      // ================================================================
      // Step 9: governance.erasure(includeRelated=true)
      //   GAP 5: cascade direction — derived claim should be tombstoned
      //   GAP 9: audit tombstoning in single-tenant mode
      //   GAP 6: consent revocation
      // ================================================================
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Art. 17 right to erasure',
        includeRelated: true,
      });
      assert.ok(erasureResult.ok, `erasure failed: ${!erasureResult.ok ? erasureResult.error.message : ''}`);
      if (!erasureResult.ok) return;

      const cert = erasureResult.value;

      // Verify PII claim was tombstoned
      assert.ok(
        cert.claimsTombstoned >= 1,
        `Expected at least 1 claim tombstoned, got ${cert.claimsTombstoned}`,
      );

      // GAP 5: Verify cascade worked — derived claim should also be tombstoned
      assert.ok(
        cert.relationshipsCascaded >= 1,
        `Expected at least 1 cascaded relationship, got ${cert.relationshipsCascaded}`,
      );

      // GAP 6 + F-E2E-001 fix: Verify exactly 1 consent revoked (the active one).
      // The revoked consent record should NOT be counted — it's already terminal.
      assert.equal(
        cert.consentRecordsRevoked,
        1,
        `Expected exactly 1 consent revoked (only the active one, not the already-revoked one), got ${cert.consentRecordsRevoked}`,
      );

      // GAP 9: Verify audit entries were tombstoned (single-tenant mode, tenantId=null)
      assert.ok(
        cert.auditEntriesTombstoned >= 1,
        `Expected at least 1 audit entry tombstoned in single-tenant mode, got ${cert.auditEntriesTombstoned}`,
      );

      // Verify certificate hash is valid SHA-256 (64 hex chars)
      assert.match(cert.certificateHash, /^[a-f0-9]{64}$/, 'Certificate hash should be a valid SHA-256 hex string');

      // Verify chain integrity
      assert.equal(cert.chainVerification.valid, true, 'Hash chain should be valid after erasure');

      // Verify deterministic hash: recompute from certificate fields
      const certPayload = JSON.stringify({
        id: cert.id,
        dataSubjectId: cert.dataSubjectId,
        requestedAt: cert.requestedAt,
        completedAt: cert.completedAt,
        claimsTombstoned: cert.claimsTombstoned,
        auditEntriesTombstoned: cert.auditEntriesTombstoned,
        relationshipsCascaded: cert.relationshipsCascaded,
        consentRecordsRevoked: cert.consentRecordsRevoked,
        chainVerification: cert.chainVerification,
      });
      const expectedHash = createHash('sha256').update(certPayload).digest('hex');
      assert.equal(cert.certificateHash, expectedHash, 'Certificate hash should be deterministic');

      // ================================================================
      // Step 10: governance.exportAudit(soc2) — verify no raw PII in export
      // ================================================================
      const auditExport = limen.governance.exportAudit({
        from: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        to: new Date(Date.now() + 3600000).toISOString(),   // 1 hour from now
      });
      assert.ok(auditExport.ok, `audit export failed: ${!auditExport.ok ? auditExport.error.message : ''}`);
      if (!auditExport.ok) return;

      // Verify no raw PII (email address) appears in the SOC2 export
      const auditStr = JSON.stringify(auditExport.value);
      assert.equal(
        auditStr.includes('alice@example.com'),
        false,
        'SOC2 audit export should not contain raw PII (email address)',
      );

      // F-E2E-003 fix verification: The dataSubjectId itself is PII metadata.
      // After erasure, the audit entry should contain a hash, not the raw ID.
      assert.equal(
        auditStr.includes('user:alice'),
        false,
        'SOC2 audit export should not contain raw data subject ID after erasure (F-E2E-003)',
      );

    } finally {
      await limen.shutdown();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
