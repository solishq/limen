/**
 * Idempotency / Resume-Token Semantics interfaces for Phase 0A governance layer.
 * Truth Model: Deliverable 12 (Idempotency / Resume-Token Semantics)
 *
 * Phase: 0A (Foundation)
 *
 * BC-130: Idempotency key scope: (tenant_id, caller_id, syscall_class, target_scope, key).
 * BC-131: Idempotency keys linked to CorrelationId.
 * BC-132: Same key + same hash → deduplicate (return cached result).
 * BC-133: Same key + different hash → IDEMPOTENCY_CONFLICT hard error.
 * BC-134: Payload canonicalization: SHA-256 of sorted-key JSON.
 * BC-135: Failed operations cached (failure IS the result).
 * BC-136: Resume token plaintext returned once in response.
 * BC-137: Resume token stored as SHA-256 hash.
 * BC-138: Resume token single-use consumption.
 * BC-139: Consumed tokens retained as tombstoned record for audit.
 * INV-130: Timing-safe comparison for resume tokens.
 * INV-131: Idempotency key TTL enforcement.
 * INV-132 (v1.1): Canonicalization function versioning — hash comparison checks version first.
 */

import type { Result } from './common.js';
import type { CorrelationId, SuspensionRecordId, SupervisorDecisionId } from './governance_ids.js';
import type { DatabaseConnection } from './database.js';

// ─── Idempotency Key ───

/**
 * BC-130: Idempotency key — composite scope + caller-provided key.
 * BC-131: Linked to CorrelationId for causal tracing.
 * BC-134: Payload hash is SHA-256 of canonicalized JSON.
 * INV-132 (v1.1): Canonicalization version stored for forward compatibility.
 */
export interface IdempotencyKey {
  readonly tenantId: string;
  /** Caller identity (agent ID, system call handler, etc.) */
  readonly callerId: string;
  /** System call class (e.g., 'SC-1', 'SC-4', 'SC-6') */
  readonly syscallClass: string;
  /** Target scope (e.g., mission ID, task ID) */
  readonly targetScope: string;
  /** Caller-provided key (unique within scope) */
  readonly key: string;
  /** BC-134: SHA-256 hash of canonicalized payload */
  readonly payloadHash: string;
  /** INV-132 (v1.1): Canonicalization function version */
  readonly canonicalizationVersion: string;
  /** BC-131: Correlation ID for causal linking */
  readonly correlationId: CorrelationId;
  /** Timestamp of key creation */
  readonly createdAt: string;
  /** TTL expiry timestamp (INV-131) */
  readonly expiresAt: string;
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
}

// ─── Idempotency Check Result ───

/**
 * BC-132, BC-133: Result of idempotency check.
 *   'new' — first time seeing this key, proceed with operation.
 *   'deduplicated' — same key + same hash, return cached result (BC-132).
 *   'conflict' — same key + different hash, IDEMPOTENCY_CONFLICT error (BC-133).
 */
export interface IdempotencyCheckResult {
  readonly outcome: 'new' | 'deduplicated' | 'conflict';
  /** Original correlation ID (present when deduplicated) */
  readonly originalCorrelationId?: CorrelationId;
  /** Existing payload hash (present when conflict) */
  readonly existingPayloadHash?: string;
}

// ─── Resume Token ───

/**
 * BC-136, BC-137: Resume token for re-entering suspended operations.
 * Plaintext returned once to caller. Only SHA-256 hash persisted.
 * BC-138: Single-use — consumed on first valid presentation.
 * BC-139: Consumed tokens retained as tombstoned record for audit.
 * INV-130: Timing-safe comparison for hash verification.
 */
export interface ResumeToken {
  readonly tenantId: string;
  /** SHA-256 hash of the plaintext token (BC-137) */
  readonly tokenHash: string;
  /** Suspension record this token unlocks */
  readonly suspensionRecordId: SuspensionRecordId;
  /** Decision that created this token */
  readonly decisionId: SupervisorDecisionId;
  /** Token expiry timestamp */
  readonly expiresAt: string;
  /** Whether this token has been consumed (BC-138) */
  readonly consumed: boolean;
  /** Consumption timestamp (null if not consumed) */
  readonly consumedAt: string | null;
  readonly createdAt: string;
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
}

// ─── Payload Canonicalizer (BC-134, INV-132) ───

/**
 * BC-134: Payload canonicalization for idempotency hash computation.
 * INV-132 (v1.1): Versioned — function version stored with each key.
 * When version changes, existing keys with old version treated as expired.
 */
export interface PayloadCanonicalizer {
  /** Current function version identifier */
  readonly version: string;
  /** Canonicalize payload to deterministic string form (sorted-key JSON) */
  canonicalize(payload: Readonly<Record<string, unknown>>): string;
  /** Compute SHA-256 hash of canonicalized payload */
  hash(canonicalized: string): string;
}

// ─── Store Interfaces ───

/**
 * Idempotency key persistence operations.
 * BC-132: Dedup on same key + same hash.
 * BC-133: Conflict on same key + different hash.
 * BC-135: Failed operations cached.
 * INV-131: TTL enforcement on reads.
 * INV-132 (v1.1): Version-aware comparison.
 */
export interface IdempotencyStore {
  /**
   * Check if an idempotency key exists and determine outcome.
   * INV-132: Checks canonicalization version first — mismatched versions = 'new'.
   */
  check(conn: DatabaseConnection, key: IdempotencyKey): Result<IdempotencyCheckResult>;
  /** Record a new idempotency key after successful or failed operation */
  record(conn: DatabaseConnection, key: IdempotencyKey): Result<void>;
}

/**
 * Resume token persistence operations.
 * BC-136: Create returns plaintext token (only time it's available).
 * BC-138: Consume is single-use — second consumption returns error.
 * BC-139: Consumed tokens tombstoned, not deleted.
 * INV-130: Timing-safe hash comparison.
 */
export interface ResumeTokenStore {
  /**
   * BC-136: Create a resume token. Returns the plaintext token.
   * The plaintext is returned ONCE — only the hash is persisted.
   */
  create(conn: DatabaseConnection, token: Omit<ResumeToken, 'consumed' | 'consumedAt'>): Result<{ readonly plaintextToken: string }>;
  /**
   * BC-138: Consume a resume token by its hash.
   * INV-130: Uses timing-safe comparison.
   * Returns the token record if valid, error if expired/consumed/not found.
   */
  consume(conn: DatabaseConnection, tokenHash: string): Result<ResumeToken>;
}
