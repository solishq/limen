/**
 * Audit trail interface types.
 * S ref: I-03, I-06, §3.5, FM-08, T-5
 *
 * Phase: 1 (Kernel)
 * Implements: Append-only, hash-chained audit trail with tamper detection.
 *
 * I-03: Every state mutation and its audit entry in same transaction.
 * I-06: Active database audit entries are append-only. No modify, no delete.
 *        Retention = archival to cryptographically sealed file.
 * §3.5: SHA-256 hash chaining. Monotonic sequence numbers. Append-only.
 * FM-08: Defense against audit trail tampering.
 */

import type { Result, TenantId, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── Audit Entry ───

/**
 * A single audit log entry with hash chain fields.
 * S ref: §3.5 (SHA-256 hash chaining, monotonic sequence numbers)
 */
export interface AuditEntry {
  readonly seqNo: number;
  readonly id: string;                        // UUID
  readonly tenantId: TenantId | null;
  readonly timestamp: string;                 // ISO 8601 with fractional seconds
  readonly actorType: 'system' | 'user' | 'agent' | 'scheduler';
  readonly actorId: string;
  readonly operation: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly detail: Record<string, unknown> | null;
  readonly previousHash: string;
  readonly currentHash: string;
}

/**
 * Input for creating a new audit entry.
 * S ref: I-03 (who, what, when, why)
 */
export interface AuditCreateInput {
  tenantId: TenantId | null;
  actorType: 'system' | 'user' | 'agent' | 'scheduler';
  actorId: string;
  operation: string;
  resourceType: string;
  resourceId: string;
  detail?: Record<string, unknown>;
}

/**
 * Filter for querying audit entries.
 * S ref: I-06 (audit query)
 */
export interface AuditQueryFilter {
  readonly tenantId?: TenantId;
  readonly actorId?: string;
  readonly operation?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly limit?: number;                    // default 100
  readonly offset?: number;                   // default 0
}

// ─── Chain Verification ───

/**
 * Result of hash chain integrity verification.
 * S ref: FM-08 (tamper detection), §3.5 (SHA-256 hash chaining)
 */
export interface ChainVerification {
  readonly valid: boolean;
  readonly totalEntries: number;
  readonly firstSeqNo: number;
  readonly lastSeqNo: number;
  readonly brokenAt: number | null;           // sequence number where break detected
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
  readonly gaps: readonly number[];           // missing sequence numbers
}

// ─── Archival ───

/**
 * Result of archiving audit entries to a sealed file.
 * S ref: I-06 (archival to cryptographically sealed file, not deletion)
 */
export interface ArchiveResult {
  readonly segmentId: string;
  readonly archivedEntries: number;
  readonly firstSeqNo: number;
  readonly lastSeqNo: number;
  readonly finalHash: string;
  readonly filePath: string;
}

// ─── Audit Trail Interface ───

/**
 * Append-only, hash-chained audit trail.
 * S ref: I-03 (atomic mutation + audit), I-06 (immutability),
 *        §3.5 (SHA-256 chaining), FM-08 (tamper detection)
 */
export interface AuditTrail {
  /**
   * Append entry. MUST be called within same transaction as mutation (I-03).
   * Assigns monotonic sequence number and computes SHA-256 hash chain.
   * S ref: I-03 (atomic audit), §3.5 (hash chaining)
   */
  append(conn: DatabaseConnection, input: AuditCreateInput): Result<AuditEntry>;

  /**
   * Batch append for observational (non-mutating) audits.
   * Batched for performance -- up to 50 entries or 100ms window.
   * S ref: §3.5 (observational audit batching)
   */
  appendBatch(conn: DatabaseConnection, inputs: AuditCreateInput[]): Result<AuditEntry[]>;

  /**
   * Query entries. RBAC: requires 'view_audit' permission.
   * S ref: I-13 (authorization on audit read)
   */
  query(conn: DatabaseConnection, ctx: OperationContext, filter: AuditQueryFilter): Result<AuditEntry[]>;

  /**
   * Verify hash chain integrity.
   * Returns detailed verification result with break location if tampered.
   * S ref: FM-08 (chain verification as runtime health check)
   */
  verifyChain(conn: DatabaseConnection, tenantId?: TenantId): Result<ChainVerification>;

  /**
   * Archive entries to sealed file.
   * Active DB starts new chain segment linked to archive's final hash.
   * S ref: I-06 (archival, not deletion), §35 (7-year default retention)
   */
  archive(conn: DatabaseConnection, olderThan: string, outputPath: string): Result<ArchiveResult>;

  /**
   * Get current chain head hash.
   * S ref: §3.5 (hash chaining state)
   */
  getChainHead(conn: DatabaseConnection, tenantId?: TenantId): Result<string>;

  /**
   * CF-035, GDPR Art. 17: Tombstone audit entries for a tenant.
   * Replaces PII fields (detail, actor_id) with sanitized values
   * while preserving hash chain integrity via cascade re-hash.
   * S ref: I-06 (immutability — controlled exception for GDPR),
   *        I-02 (data ownership — right to erasure),
   *        DEC-CERT-001 (global chain GDPR condition)
   */
  tombstone(conn: DatabaseConnection, tenantId: TenantId): Result<TombstoneResult>;
}

/**
 * CF-035: Result of a GDPR tombstone operation.
 */
export interface TombstoneResult {
  readonly tombstonedEntries: number;
  readonly rehashedEntries: number;
  readonly chainValid: boolean;
}
