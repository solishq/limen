/**
 * Phase 10: GDPR Erasure Engine
 *
 * Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 1, Erasure Engine)
 * Invariants: I-P10-20 (completeness), I-P10-21 (cascade), I-P10-22 (consent revocation),
 *             I-P10-23 (chain integrity), I-P10-24 (certificate hash), I-P10-25 (audit)
 * DCs: DC-P10-103, DC-P10-104, DC-P10-201, DC-P10-202, DC-P10-501
 *
 * Orchestrates:
 *   1. Query PII claims for data subject
 *   2. Tombstone each PII claim
 *   3. If includeRelated: follow derived_from relationships recursively
 *   4. Tombstone audit entries
 *   5. Revoke consent records
 *   6. Verify chain integrity
 *   7. Generate certificate with SHA-256 hash
 *   8. Store certificate
 *   9. Produce audit entry
 */

import { randomUUID, createHash } from 'node:crypto';
import type { OperationContext, Result } from '../../kernel/interfaces/common.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { AuditTrail } from '../../kernel/interfaces/audit.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { ClaimStore } from '../../claims/interfaces/claim_types.js';
import type { ConsentRegistry } from '../../security/security_types.js';
import type { ErasureRequest, ErasureCertificate } from '../classification/governance_types.js';

// ============================================================================
// Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

/**
 * Compute SHA-256 hash of the certificate content (excluding the hash itself).
 * I-P10-24: Deterministic — same inputs produce same hash.
 */
function computeCertificateHash(cert: Omit<ErasureCertificate, 'certificateHash'>): string {
  const payload = JSON.stringify({
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
  return createHash('sha256').update(payload).digest('hex');
}

// ============================================================================
// Erasure Engine Dependencies
// ============================================================================

export interface ErasureEngineDeps {
  readonly claimStore: ClaimStore;
  readonly audit: AuditTrail;
  readonly consentRegistry: ConsentRegistry;
  readonly time: TimeProvider;
}

// ============================================================================
// Erasure Engine
// ============================================================================

/**
 * Execute a GDPR erasure request.
 *
 * All operations within a single transaction for atomicity (DC-P10-201).
 * Non-PII claims are untouched (DC-P10-104).
 */
export function executeErasure(
  deps: ErasureEngineDeps,
  conn: DatabaseConnection,
  ctx: OperationContext,
  request: ErasureRequest,
): Result<ErasureCertificate> {
  return conn.transaction(() => {
    const requestedAt = deps.time.nowISO();
    const tenantId = ctx.tenantId;

    // 1. Query PII claims for data subject
    // I-P10-20: ALL claims with pii_detected=1 whose subject matches
    const subjectPattern = `%${request.dataSubjectId}%`;
    const piiClaims = conn.query<Record<string, unknown>>(
      `SELECT id, subject FROM claim_assertions
       WHERE pii_detected = 1
       AND subject LIKE ?
       AND purged_at IS NULL
       ${tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL'}`,
      tenantId !== null ? [subjectPattern, tenantId] : [subjectPattern],
    );

    if (piiClaims.length === 0) {
      return err<ErasureCertificate>(
        'ERASURE_NO_CLAIMS_FOUND',
        `No PII claims found for data subject: ${request.dataSubjectId}`,
        'I-P10-20',
      );
    }

    // 2. Tombstone each PII claim
    let claimsTombstoned = 0;
    for (const row of piiClaims) {
      const claimId = row['id'] as string;
      const result = deps.claimStore.tombstone(
        conn,
        claimId as import('../../claims/interfaces/claim_types.js').ClaimId,
        tenantId,
        `GDPR erasure: ${request.reason}`,
      );
      if (result.ok) {
        claimsTombstoned++;
      }
    }

    // 3. If includeRelated: follow derived_from relationships recursively (I-P10-21)
    let relationshipsCascaded = 0;
    if (request.includeRelated) {
      const tombstonedIds = new Set(piiClaims.map((r: Record<string, unknown>) => r['id'] as string));
      const queue = [...tombstonedIds];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        // Find claims derived from this one
        const derived = conn.query<Record<string, unknown>>(
          `SELECT cr.to_claim_id FROM claim_relationships cr
           JOIN claim_assertions ca ON ca.id = cr.to_claim_id
           WHERE cr.from_claim_id = ?
           AND cr.type = 'derived_from'
           AND ca.purged_at IS NULL`,
          [currentId],
        );

        for (const rel of derived) {
          const derivedId = rel['to_claim_id'] as string;
          if (!tombstonedIds.has(derivedId)) {
            tombstonedIds.add(derivedId);
            const result = deps.claimStore.tombstone(
              conn,
              derivedId as import('../../claims/interfaces/claim_types.js').ClaimId,
              tenantId,
              `GDPR erasure cascade: derived from ${currentId}`,
            );
            if (result.ok) {
              claimsTombstoned++;
              relationshipsCascaded++;
            }
            queue.push(derivedId);
          }
        }
      }
    }

    // 4. Tombstone audit entries (I-P10-23: chain integrity preserved via re-hash)
    let auditEntriesTombstoned = 0;
    if (tenantId !== null) {
      const tombResult = deps.audit.tombstone(conn, tenantId);
      if (tombResult.ok) {
        auditEntriesTombstoned = tombResult.value.tombstonedEntries;
      }
    }

    // 5. Revoke consent records (I-P10-22)
    let consentRecordsRevoked = 0;
    const consentList = deps.consentRegistry.list(conn, ctx, request.dataSubjectId);
    if (consentList.ok) {
      for (const record of consentList.value) {
        if (record.status === 'active') {
          const revokeResult = deps.consentRegistry.revoke(conn, ctx, record.id);
          if (revokeResult.ok) {
            consentRecordsRevoked++;
          }
        }
      }
    }

    // 6. Verify chain integrity (I-P10-23)
    const chainResult = deps.audit.verifyChain(conn, tenantId ?? undefined);
    const chainVerification: { valid: boolean; headHash: string } = {
      valid: chainResult.ok ? chainResult.value.valid : false,
      headHash: '',
    };

    // Get current chain head hash
    const headResult = deps.audit.getChainHead(conn, tenantId ?? undefined);
    if (headResult.ok) {
      chainVerification.headHash = headResult.value;
    }

    if (!chainVerification.valid) {
      return err<ErasureCertificate>(
        'ERASURE_CHAIN_INTEGRITY_FAILED',
        'Hash chain integrity verification failed after erasure',
        'I-P10-23',
      );
    }

    // 7. Generate certificate (I-P10-24)
    const certId = randomUUID();
    const completedAt = deps.time.nowISO();
    const certWithoutHash: Omit<ErasureCertificate, 'certificateHash'> = {
      id: certId,
      dataSubjectId: request.dataSubjectId,
      requestedAt,
      completedAt,
      claimsTombstoned,
      auditEntriesTombstoned,
      relationshipsCascaded,
      consentRecordsRevoked,
      chainVerification,
    };

    const certificateHash = computeCertificateHash(certWithoutHash);
    const certificate: ErasureCertificate = {
      ...certWithoutHash,
      certificateHash,
    };

    // 8. Store certificate in governance_erasure_certificates
    conn.run(
      `INSERT INTO governance_erasure_certificates
       (id, tenant_id, data_subject_id, requested_at, completed_at,
        claims_tombstoned, audit_entries_tombstoned, relationships_cascaded,
        consent_records_revoked, chain_valid, chain_head_hash, certificate_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        certificate.id,
        tenantId,
        certificate.dataSubjectId,
        certificate.requestedAt,
        certificate.completedAt,
        certificate.claimsTombstoned,
        certificate.auditEntriesTombstoned,
        certificate.relationshipsCascaded,
        certificate.consentRecordsRevoked,
        certificate.chainVerification.valid ? 1 : 0,
        certificate.chainVerification.headHash,
        certificate.certificateHash,
      ],
    );

    // 9. Audit entry (I-P10-25)
    deps.audit.append(conn, {
      tenantId,
      actorType: 'system',
      actorId: 'erasure_engine',
      operation: 'governance.erasure',
      resourceType: 'erasure_certificate',
      resourceId: certificate.id,
      detail: {
        dataSubjectId: request.dataSubjectId,
        reason: request.reason,
        claimsTombstoned: certificate.claimsTombstoned,
        auditEntriesTombstoned: certificate.auditEntriesTombstoned,
        relationshipsCascaded: certificate.relationshipsCascaded,
        consentRecordsRevoked: certificate.consentRecordsRevoked,
        includeRelated: request.includeRelated,
      },
    });

    return ok(certificate);
  });
}
