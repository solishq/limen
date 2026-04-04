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
import type { VectorStore } from '../../vector/vector_store.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Escape SQL LIKE wildcard characters in user input.
 * F-E2E-008b: Prevents '%' and '_' in dataSubjectId from being interpreted as wildcards.
 */
function escapeLikeWildcards(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

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
  /** Phase 11: Optional vector store for embedding deletion during GDPR erasure. */
  readonly vectorStore?: VectorStore | null;
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
    // F-E2E-002b fix: Use exact subject match instead of substring LIKE to prevent
    // collateral erasure (e.g., 'user:alice' matching 'user:aliceberg').
    // The dataSubjectId may be a full URN ('entity:user:alice') or a partial ID
    // ('user:alice'). We match both forms exactly — no substring wildcards.
    const fullUrn = request.dataSubjectId.startsWith('entity:')
      ? request.dataSubjectId
      : `entity:${request.dataSubjectId}`;
    const piiClaims = conn.query<Record<string, unknown>>(
      `SELECT id, subject FROM claim_assertions
       WHERE pii_detected = 1
       AND (subject = ? OR subject = ?)
       AND purged_at IS NULL
       ${tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL'}`,
      tenantId !== null
        ? [request.dataSubjectId, fullUrn, tenantId]
        : [request.dataSubjectId, fullUrn],
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
        // Find claims derived from this one.
        // Relationship semantic: connect(A, B, 'derived_from') stores from=A, to=B
        // meaning "A is derived from B". To find things derived FROM currentId,
        // we query WHERE to_claim_id = currentId and read from_claim_id as the descendant.
        const derived = conn.query<Record<string, unknown>>(
          `SELECT cr.from_claim_id FROM claim_relationships cr
           JOIN claim_assertions ca ON ca.id = cr.from_claim_id
           WHERE cr.to_claim_id = ?
           AND cr.type = 'derived_from'
           AND ca.purged_at IS NULL`,
          [currentId],
        );

        for (const rel of derived) {
          const derivedId = rel['from_claim_id'] as string;
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

    // 3b. Phase 11: Delete embeddings for tombstoned claims (I-P11-30, I-P11-31)
    // GDPR: embedding is a projection of claim content — must be deleted when content is tombstoned.
    if (deps.vectorStore) {
      // Collect all claim IDs that were tombstoned in steps 2+3.
      // Start with the directly-identified PII claims.
      const allTombstonedIds = piiClaims.map((r: Record<string, unknown>) => r['id'] as string);
      // If cascade happened, we need to include cascaded claim IDs too.
      // F-P5-001 fix: Query by claim ID instead of subject, because tombstoned claims
      // have subject=NULL (CCP-I10), so a WHERE subject=? query never matches them.
      if (request.includeRelated) {
        // Re-query tombstoned claims by ID. The IDs from the cascade are already
        // tracked in the tombstonedIds Set from step 3. But that Set is scoped
        // inside the if(request.includeRelated) block above. Instead, query all
        // claims in this tenant that were tombstoned (purged_at IS NOT NULL)
        // and whose IDs we haven't already collected.
        // Use the claim_assertions table with purged_at check, joining on id.
        const tombstonedNow = conn.query<Record<string, unknown>>(
          `SELECT ca.id FROM claim_assertions ca
           WHERE ca.purged_at IS NOT NULL
           AND ca.id IN (
             SELECT cr.from_claim_id FROM claim_relationships cr
             WHERE cr.type = 'derived_from'
             AND cr.to_claim_id IN (${allTombstonedIds.map(() => '?').join(',')})
           )
           ${tenantId !== null ? 'AND ca.tenant_id = ?' : 'AND ca.tenant_id IS NULL'}`,
          tenantId !== null
            ? [...allTombstonedIds, tenantId]
            : [...allTombstonedIds],
        );
        for (const row of tombstonedNow) {
          const id = row['id'] as string;
          if (!allTombstonedIds.includes(id)) {
            allTombstonedIds.push(id);
          }
        }
      }
      deps.vectorStore.deleteBatch(conn, allTombstonedIds);
    }

    // 3c. GDPR: Delete claim_relationships involving tombstoned PII claims.
    // I-31 triggers prevent DELETE on claim_relationships (append-only invariant).
    // For GDPR erasure this must be overridden: relationships reference PII claim IDs
    // which constitute personal data metadata. Strategy: temporarily drop the trigger,
    // delete relationships, recreate it. Safe because better-sqlite3 is synchronous
    // and single-threaded — no concurrent operation can exploit the window.
    {
      const tombstonedClaimIds = piiClaims.map((r: Record<string, unknown>) => r['id'] as string);

      // Drop I-31 immutability triggers
      conn.run('DROP TRIGGER IF EXISTS claim_relationships_no_delete');
      conn.run('DROP TRIGGER IF EXISTS claim_relationships_no_update');

      // Delete relationships where either endpoint is a tombstoned PII claim
      for (const claimId of tombstonedClaimIds) {
        const deleted = conn.run(
          'DELETE FROM claim_relationships WHERE from_claim_id = ? OR to_claim_id = ?',
          [claimId, claimId],
        );
        relationshipsCascaded += deleted.changes;
      }

      // Recreate I-31 triggers
      conn.run(`CREATE TRIGGER IF NOT EXISTS claim_relationships_no_update
        BEFORE UPDATE ON claim_relationships
        BEGIN
          SELECT RAISE(ABORT, 'I-31: Claim relationships are immutable. UPDATE is prohibited.');
        END`);
      conn.run(`CREATE TRIGGER IF NOT EXISTS claim_relationships_no_delete
        BEFORE DELETE ON claim_relationships
        BEGIN
          SELECT RAISE(ABORT, 'I-31: Claim relationships are immutable. DELETE is prohibited.');
        END`);
    }

    // 4. Tombstone audit entries (I-P10-23: chain integrity preserved via re-hash)
    // GAP-9 fix: In single-tenant mode (tenantId=null), the AuditTrail.tombstone()
    // interface requires a non-null TenantId. For single-tenant, we sanitize audit
    // entries whose detail JSON contains the data subject ID directly.
    let auditEntriesTombstoned = 0;
    if (tenantId !== null) {
      const tombResult = deps.audit.tombstone(conn, tenantId);
      if (tombResult.ok) {
        auditEntriesTombstoned = tombResult.value.tombstonedEntries;
      }
    } else {
      // Single-tenant mode: sanitize audit entries containing data subject PII.
      // Query entries whose detail contains the data subject ID.
      // F-E2E-002b + F-E2E-008b fix: Escape SQL wildcards in the dataSubjectId
      // before using in LIKE, and use bounded matching to prevent over-broad
      // collateral tombstoning (e.g., 'user:alice' matching 'user:aliceberg').
      // F-E2E-002b + F-E2E-008b fix: Escape SQL wildcards in the dataSubjectId
      // and use JSON-quoted boundary matching to prevent over-broad tombstoning.
      // The detail field is JSON text; the ID appears as a quoted value like "user:alice".
      // Quote boundaries prevent "user:alice" from matching "user:aliceberg".
      // Handle both the raw dataSubjectId and the full URN form.
      const escapedId = escapeLikeWildcards(request.dataSubjectId);
      const escapedFullUrn = escapeLikeWildcards(fullUrn);
      const detailPattern1 = `%"${escapedId}"%`;
      const detailPattern2 = `%"${escapedFullUrn}"%`;
      const auditEntries = conn.query<{ seq_no: number }>(
        `SELECT seq_no FROM core_audit_log WHERE (detail LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\') AND tenant_id IS NULL`,
        [detailPattern1, detailPattern2],
      );
      if (auditEntries.length > 0) {
        const purgeDate = deps.time.nowISO().split('T')[0]!;
        const tombstoneDetail = JSON.stringify({ purged: true, purge_date: purgeDate });
        // Set tombstone flag to bypass I-06 UPDATE trigger
        conn.run(`INSERT OR IGNORE INTO core_audit_tombstone_active (id) VALUES (1)`);
        conn.run(
          `UPDATE core_audit_log SET detail = ?, actor_id = 'purged' WHERE (detail LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\') AND tenant_id IS NULL`,
          [tombstoneDetail, detailPattern1, detailPattern2],
        );
        auditEntriesTombstoned = auditEntries.length;

        // Cascade re-hash from earliest modified entry
        const firstSeqNo = auditEntries[0]!.seq_no;
        const allSubsequent = conn.query<{
          seq_no: number; previous_hash: string; current_hash: string;
          timestamp: string; actor_type: string; actor_id: string;
          operation: string; resource_type: string; resource_id: string;
          detail: string | null; tenant_id: string | null;
        }>(
          `SELECT seq_no, tenant_id, timestamp, actor_type, actor_id, operation,
           resource_type, resource_id, detail, previous_hash, current_hash
           FROM core_audit_log WHERE seq_no >= ? ORDER BY seq_no ASC`,
          [firstSeqNo],
        );

        // Get previous hash for re-hash range start
        let prevHash: string;
        if (firstSeqNo === 1) {
          prevHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // GENESIS_HASH
        } else {
          const predecessor = conn.get<{ current_hash: string }>(
            `SELECT current_hash FROM core_audit_log WHERE seq_no < ? ORDER BY seq_no DESC LIMIT 1`,
            [firstSeqNo],
          );
          prevHash = predecessor?.current_hash ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        }

        // Re-hash each entry to maintain chain integrity
        for (const entry of allSubsequent) {
          const data = [
            prevHash,
            String(entry.seq_no),
            entry.timestamp,
            entry.actor_type,
            entry.actor_id,
            entry.operation,
            entry.resource_type,
            entry.resource_id,
            entry.detail ? JSON.stringify(JSON.parse(entry.detail), entry.detail !== '{}' ? Object.keys(JSON.parse(entry.detail)).sort() : undefined) : '',
          ].join('|');
          const newHash = createHash('sha256').update(data).digest('hex');
          conn.run(
            `UPDATE core_audit_log SET previous_hash = ?, current_hash = ? WHERE seq_no = ?`,
            [prevHash, newHash, entry.seq_no],
          );
          prevHash = newHash;
        }
        // Clear tombstone flag
        conn.run(`DELETE FROM core_audit_tombstone_active WHERE id = 1`);
      }
    }

    // 5. Revoke consent records (I-P10-22)
    // GAP-6 fix: Only active records need revocation. Expired and revoked records
    // are already in terminal states — they require no action and are intentionally
    // not counted in consentRecordsRevoked (which reflects active revocations performed).
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
        // expired/revoked records: terminal state, no action needed (I-P10-22)
      }
    }

    // 5b. Second-pass audit tombstoning for single-tenant mode.
    // Steps 2-5 (claim tombstoning, cascade, consent revocation) create new audit
    // entries that may contain the dataSubjectId in their detail field. These entries
    // are created AFTER the initial tombstoning pass in step 4. We need to sanitize
    // them to prevent PII re-introduction (F-E2E-003).
    if (tenantId === null) {
      const escapedId2 = escapeLikeWildcards(request.dataSubjectId);
      const escapedFullUrn2 = escapeLikeWildcards(fullUrn);
      const detailPattern2a = `%"${escapedId2}"%`;
      const detailPattern2b = `%"${escapedFullUrn2}"%`;
      const newPiiEntries = conn.query<{ seq_no: number }>(
        `SELECT seq_no FROM core_audit_log
         WHERE (detail LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')
         AND tenant_id IS NULL`,
        [detailPattern2a, detailPattern2b],
      );
      if (newPiiEntries.length > 0) {
        const purgeDate2 = deps.time.nowISO().split('T')[0]!;
        const tombstoneDetail2 = JSON.stringify({ purged: true, purge_date: purgeDate2 });
        conn.run(`INSERT OR IGNORE INTO core_audit_tombstone_active (id) VALUES (1)`);
        conn.run(
          `UPDATE core_audit_log SET detail = ?, actor_id = 'purged'
           WHERE (detail LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')
           AND tenant_id IS NULL`,
          [tombstoneDetail2, detailPattern2a, detailPattern2b],
        );
        auditEntriesTombstoned += newPiiEntries.length;

        // Re-hash from earliest modified entry to maintain chain integrity
        const firstSeqNo2 = newPiiEntries[0]!.seq_no;
        const allSubsequent2 = conn.query<{
          seq_no: number; previous_hash: string; current_hash: string;
          timestamp: string; actor_type: string; actor_id: string;
          operation: string; resource_type: string; resource_id: string;
          detail: string | null; tenant_id: string | null;
        }>(
          `SELECT seq_no, tenant_id, timestamp, actor_type, actor_id, operation,
           resource_type, resource_id, detail, previous_hash, current_hash
           FROM core_audit_log WHERE seq_no >= ? ORDER BY seq_no ASC`,
          [firstSeqNo2],
        );

        let prevHash2: string;
        if (firstSeqNo2 === 1) {
          prevHash2 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        } else {
          const predecessor2 = conn.get<{ current_hash: string }>(
            `SELECT current_hash FROM core_audit_log WHERE seq_no < ? ORDER BY seq_no DESC LIMIT 1`,
            [firstSeqNo2],
          );
          prevHash2 = predecessor2?.current_hash ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        }

        for (const entry of allSubsequent2) {
          const data = [
            prevHash2,
            String(entry.seq_no),
            entry.timestamp,
            entry.actor_type,
            entry.actor_id,
            entry.operation,
            entry.resource_type,
            entry.resource_id,
            entry.detail ? JSON.stringify(JSON.parse(entry.detail), entry.detail !== '{}' ? Object.keys(JSON.parse(entry.detail)).sort() : undefined) : '',
          ].join('|');
          const newHash = createHash('sha256').update(data).digest('hex');
          conn.run(
            `UPDATE core_audit_log SET previous_hash = ?, current_hash = ? WHERE seq_no = ?`,
            [prevHash2, newHash, entry.seq_no],
          );
          prevHash2 = newHash;
        }
        conn.run(`DELETE FROM core_audit_tombstone_active WHERE id = 1`);
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
    // F-E2E-003 fix: Sanitize PII — use a SHA-256 hash prefix instead of the raw
    // dataSubjectId. The raw ID is PII metadata that identifies the data subject.
    // After tombstoning audit entries containing the subject, re-introducing the
    // raw ID in the erasure audit entry defeats the purpose of GDPR tombstoning.
    // The certificate (stored separately) retains the full ID for compliance tracing.
    const dataSubjectHash = createHash('sha256')
      .update(request.dataSubjectId)
      .digest('hex')
      .substring(0, 16);
    deps.audit.append(conn, {
      tenantId,
      actorType: 'system',
      actorId: 'erasure_engine',
      operation: 'governance.erasure',
      resourceType: 'erasure_certificate',
      resourceId: certificate.id,
      detail: {
        dataSubjectHash,
        reason: request.reason,
        certificateId: certificate.id,
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
