/**
 * Phase 9: Consent Registry — CRUD for data subject consent records.
 *
 * Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 1, Consent Registry)
 * Invariants: I-P9-20 (immutable identity), I-P9-21 (terminal states),
 *             I-P9-22 (expiry computed on read), I-P9-23 (audit trail),
 *             I-P9-24 (tenant isolation)
 * DCs: DC-P9-103, DC-P9-201, DC-P9-202, DC-P9-203, DC-P9-501, DC-P9-502
 *
 * All mutations produce audit entries via deps.audit.append() (I-P9-23).
 * Expiry is computed on read, never by a background job (I-P9-22).
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, OperationContext, Result } from '../kernel/interfaces/index.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type {
  ConsentRecord, ConsentCreateInput, ConsentStatus, ConsentBasis,
  ConsentRegistry,
} from './security_types.js';
import { VALID_CONSENT_BASES } from './security_types.js';

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
 * I-P9-22: Compute effective consent status on read.
 * If expiresAt < now, status is 'expired' regardless of stored value.
 */
function computeEffectiveStatus(
  storedStatus: string,
  expiresAt: string | null,
  revokedAt: string | null,
  time: TimeProvider,
): ConsentStatus {
  // Revoked is terminal — always wins
  if (storedStatus === 'revoked' || revokedAt !== null) {
    return 'revoked';
  }

  // Check expiry on read (I-P9-22)
  if (expiresAt !== null) {
    const expiresMs = new Date(expiresAt).getTime();
    if (time.nowMs() > expiresMs) {
      return 'expired';
    }
  }

  return 'active';
}

function rowToConsentRecord(
  row: Record<string, unknown>,
  time: TimeProvider,
): ConsentRecord {
  const storedStatus = row['status'] as string;
  const expiresAt = row['expires_at'] as string | null;
  const revokedAt = row['revoked_at'] as string | null;

  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string | null,
    dataSubjectId: row['data_subject_id'] as string,
    basis: row['basis'] as ConsentBasis,
    scope: row['scope'] as string,
    grantedAt: row['granted_at'] as string,
    expiresAt,
    revokedAt,
    status: computeEffectiveStatus(storedStatus, expiresAt, revokedAt, time),
    createdAt: row['created_at'] as string,
  };
}

// ============================================================================
// Consent Registry Factory
// ============================================================================

export interface ConsentRegistryDeps {
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
}

/**
 * Create a ConsentRegistry instance.
 *
 * @param deps - Dependencies (audit trail, time provider)
 * @returns ConsentRegistry implementation
 */
export function createConsentRegistry(deps: ConsentRegistryDeps): ConsentRegistry {
  return Object.freeze({
    /**
     * Register a new consent record.
     * DC-P9-103: All required fields persisted.
     * DC-P9-501: Audit entry with operation = 'consent.register'.
     */
    register(conn: DatabaseConnection, ctx: OperationContext, input: ConsentCreateInput): Result<ConsentRecord> {
      // Validate required fields
      if (!input.dataSubjectId || typeof input.dataSubjectId !== 'string' || input.dataSubjectId.trim().length === 0) {
        return err('CONSENT_INVALID_INPUT', 'dataSubjectId is required', 'I-P9-20');
      }
      if (!input.basis || !(VALID_CONSENT_BASES as readonly string[]).includes(input.basis)) {
        return err('CONSENT_INVALID_INPUT', `Invalid basis: ${input.basis}`, 'I-P9-20');
      }
      if (!input.scope || typeof input.scope !== 'string' || input.scope.trim().length === 0) {
        return err('CONSENT_INVALID_INPUT', 'scope is required', 'I-P9-20');
      }

      const id = randomUUID();
      const now = deps.time.nowISO();

      try {
        conn.run(
          `INSERT INTO security_consent (id, tenant_id, data_subject_id, basis, scope, granted_at, expires_at, revoked_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?)`,
          [id, ctx.tenantId, input.dataSubjectId, input.basis, input.scope, now, input.expiresAt ?? null, now],
        );

        // I-P9-23: Audit entry in same transaction
        deps.audit.append(conn, {
          tenantId: ctx.tenantId,
          actorType: ctx.agentId ? 'agent' : 'system',
          actorId: ctx.agentId ?? 'system',
          operation: 'consent.register',
          resourceType: 'security_consent',
          resourceId: id,
          detail: {
            dataSubjectId: input.dataSubjectId,
            basis: input.basis,
            scope: input.scope,
            expiresAt: input.expiresAt ?? null,
          },
        });

        const record: ConsentRecord = {
          id,
          tenantId: ctx.tenantId,
          dataSubjectId: input.dataSubjectId,
          basis: input.basis,
          scope: input.scope,
          grantedAt: now,
          expiresAt: input.expiresAt ?? null,
          revokedAt: null,
          status: 'active',
          createdAt: now,
        };

        return ok(record);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('CONSENT_INVALID_INPUT', `Failed to register consent: ${msg}`, 'I-P9-20');
      }
    },

    /**
     * Revoke a consent record.
     * DC-P9-201: ACTIVE -> REVOKED transition.
     * DC-P9-203: Already revoked/expired -> CONSENT_ALREADY_REVOKED.
     * DC-P9-502: Audit entry with operation = 'consent.revoke'.
     */
    revoke(conn: DatabaseConnection, ctx: OperationContext, id: string): Result<ConsentRecord> {
      // Fetch current record
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM security_consent WHERE id = ? AND tenant_id IS ?',
        [id, ctx.tenantId],
      );

      if (!row) {
        return err('CONSENT_NOT_FOUND', `Consent record ${id} not found`, 'I-P9-21');
      }

      const currentRecord = rowToConsentRecord(row, deps.time);

      // I-P9-21: Terminal states cannot transition
      if (currentRecord.status === 'revoked') {
        return err('CONSENT_ALREADY_REVOKED', `Consent ${id} is already revoked`, 'I-P9-21');
      }
      if (currentRecord.status === 'expired') {
        return err('CONSENT_ALREADY_REVOKED', `Consent ${id} has expired (terminal state)`, 'I-P9-21');
      }

      const now = deps.time.nowISO();

      conn.run(
        `UPDATE security_consent SET status = 'revoked', revoked_at = ? WHERE id = ?`,
        [now, id],
      );

      // I-P9-23: Audit entry in same transaction
      deps.audit.append(conn, {
        tenantId: ctx.tenantId,
        actorType: ctx.agentId ? 'agent' : 'system',
        actorId: ctx.agentId ?? 'system',
        operation: 'consent.revoke',
        resourceType: 'security_consent',
        resourceId: id,
        detail: {
          dataSubjectId: currentRecord.dataSubjectId,
          previousStatus: currentRecord.status,
          revokedAt: now,
        },
      });

      return ok({
        ...currentRecord,
        status: 'revoked' as ConsentStatus,
        revokedAt: now,
      });
    },

    /**
     * Check if active consent exists for a data subject + scope.
     * I-P9-22: Expiry computed on read.
     */
    check(conn: DatabaseConnection, ctx: OperationContext, dataSubjectId: string, scope: string): Result<ConsentRecord | null> {
      const row = conn.get<Record<string, unknown>>(
        `SELECT * FROM security_consent
         WHERE data_subject_id = ? AND scope = ? AND status = 'active' AND tenant_id IS ?
         ORDER BY granted_at DESC LIMIT 1`,
        [dataSubjectId, scope, ctx.tenantId],
      );

      if (!row) {
        return ok(null);
      }

      const record = rowToConsentRecord(row, deps.time);

      // I-P9-22: If expired on read, return null (no active consent)
      if (record.status === 'expired') {
        return ok(null);
      }

      return ok(record);
    },

    /**
     * List all consent records for a data subject.
     * I-P9-22: Expiry computed on read for each record.
     */
    list(conn: DatabaseConnection, ctx: OperationContext, dataSubjectId: string): Result<readonly ConsentRecord[]> {
      const rows = conn.query<Record<string, unknown>>(
        `SELECT * FROM security_consent
         WHERE data_subject_id = ? AND tenant_id IS ?
         ORDER BY granted_at DESC`,
        [dataSubjectId, ctx.tenantId],
      );

      const records = rows.map(row => rowToConsentRecord(row, deps.time));
      return ok(records);
    },
  });
}
