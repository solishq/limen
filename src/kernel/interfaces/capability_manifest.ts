/**
 * Capability Manifest Schema interfaces for Phase 0A governance layer.
 * Truth Model: Deliverable 9 (Capability Manifest Schema), Deliverable 10 (Retry/Replay Safety Matrix)
 *
 * Phase: 0A (Foundation)
 *
 * BC-100: CapabilityManifest carries trust tier.
 * BC-101: 5 ExecutionTrustTier values with defined retry policies.
 * BC-102: secretRequirements carry references only, never plaintext.
 * BC-103: Manifest immutable once registered.
 * BC-104: SideEffectClass classification for operational safety.
 * BC-110: Every system call must be classified in retry/replay matrix.
 * BC-111: Retry classification lookup table.
 * INV-X04: Every entity carries schemaVersion.
 */

import type { Result } from './common.js';
import type { CapabilityManifestId } from './governance_ids.js';
import type { DatabaseConnection } from './database.js';

// ─── Trust Tier ───

/**
 * BC-101: Execution trust tier classification.
 * Determines retry policy, supervisor requirements, and side-effect constraints.
 *
 *   deterministic-local: auto-retry, no constraint
 *   sandboxed-local: same-request-ID, verify prior state
 *   remote-tenant: no auto-retry, same-ID, verify
 *   remote-third-party: no auto-retry, supervisor review for irreversible
 *   human-mediated: always supervisor
 */
export type ExecutionTrustTier =
  | 'deterministic-local'
  | 'sandboxed-local'
  | 'remote-tenant'
  | 'remote-third-party'
  | 'human-mediated';

// ─── Side Effect Classification ───

/**
 * BC-104: Side effect classification for operational safety.
 * Determines retry and replay behavior per capability.
 */
export type SideEffectClass =
  | 'none'
  | 'idempotent'
  | 'reversible'
  | 'irreversible';

// ─── Capability Manifest Entity ───

/**
 * BC-100, BC-103: CapabilityManifest — immutable capability registration.
 * Once registered, a manifest cannot be modified. New versions create new manifests.
 * BC-102: secretRequirements carry vault key references, never plaintext.
 */
export interface CapabilityManifest {
  readonly manifestId: CapabilityManifestId;
  /** Capability type identifier (e.g., 'web_search', 'code_execute') */
  readonly capabilityType: string;
  /** BC-101: Trust tier determining retry/supervisor policy */
  readonly trustTier: ExecutionTrustTier;
  /** BC-104: Side effect classification */
  readonly sideEffectClass: SideEffectClass;
  /**
   * BC-102: Secret requirement references (vault key names, never plaintext).
   * Empty array means no secrets required.
   */
  readonly secretRequirements: readonly string[];
  /** INV-X04: Governance schema version (Amendment A12) */
  readonly schemaVersion: string;
  readonly createdAt: string;
}

// ─── Store Interface ───

/**
 * CapabilityManifest persistence operations.
 * BC-103: No update — manifests are immutable once registered.
 */
export interface CapabilityManifestStore {
  register(conn: DatabaseConnection, manifest: CapabilityManifest): Result<CapabilityManifest>;
  get(conn: DatabaseConnection, manifestId: CapabilityManifestId): Result<CapabilityManifest | null>;
  getByType(conn: DatabaseConnection, capabilityType: string): Result<CapabilityManifest | null>;
}

// ─── Archetype 4: Retry/Replay Classification (Deliverable 10, BC-110, BC-111) ───

/**
 * BC-111: Retry classification per system call.
 * BC-110: Every system call must have an entry.
 * Source: Truth Model Deliverable 10.
 */
export interface RetryClassification {
  readonly syscallId: string;
  readonly autoRetryable: boolean;
  readonly sameRequestIdRequired: boolean;
  readonly verifyPriorStateRequired: boolean;
  readonly supervisorReviewRequired: boolean;
  readonly traceReconstructable: boolean;
  readonly forkedRunReexecutable: boolean;
}

/**
 * BC-111: Complete retry/replay classification lookup table.
 * 13 system calls classified per Deliverable 10.
 */
export const RETRY_REPLAY_CLASSIFICATION: readonly RetryClassification[] = [
  { syscallId: 'SC-1', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-2', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-3', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-4', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-5', autoRetryable: true, sameRequestIdRequired: false, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-6', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-7', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: true, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-8', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: true, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-9', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: true, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-10', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: true, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-14', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-15', autoRetryable: true, sameRequestIdRequired: false, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
  { syscallId: 'SC-16', autoRetryable: false, sameRequestIdRequired: true, verifyPriorStateRequired: false, supervisorReviewRequired: false, traceReconstructable: true, forkedRunReexecutable: true },
] as const;

// ─── Archetype 4: Retention Categories (Deliverable 11, BC-120 to BC-126) ───

/**
 * BC-120 to BC-126: Retention/redaction classification per data category.
 * Source: Truth Model Deliverable 11.
 *
 * BC-120: Audit trail — permanent, never redacted internally, projection at API boundary.
 * BC-121: Trace events — configurable retention (default 90d), tool I/O redacted by default.
 * BC-122: Resume tokens — hash only stored, excluded from trace payloads.
 * BC-123: WMP thread — pruned on session close.
 * BC-124: WMP active — pruned on mission completion + window.
 * BC-125: Tombstone semantics — record persists, visibility changes, trace/audit intact.
 * BC-126: All Phase 0A data categories are tenant-local.
 */
export interface RetentionCategory {
  readonly category: string;
  readonly defaultRetentionDays: number | 'permanent';
  readonly redactionDefault: 'none' | 'tool-io' | 'hash-only';
  readonly tenantLocal: boolean;
}

export const RETENTION_CATEGORIES: readonly RetentionCategory[] = [
  { category: 'audit_trail', defaultRetentionDays: 'permanent', redactionDefault: 'none', tenantLocal: true },
  { category: 'trace_events', defaultRetentionDays: 90, redactionDefault: 'tool-io', tenantLocal: true },
  { category: 'resume_tokens', defaultRetentionDays: 30, redactionDefault: 'hash-only', tenantLocal: true },
  { category: 'wmp_thread', defaultRetentionDays: 1, redactionDefault: 'none', tenantLocal: true },
  { category: 'wmp_active', defaultRetentionDays: 7, redactionDefault: 'none', tenantLocal: true },
  { category: 'supervisor_decisions', defaultRetentionDays: 'permanent', redactionDefault: 'none', tenantLocal: true },
  { category: 'eval_cases', defaultRetentionDays: 'permanent', redactionDefault: 'none', tenantLocal: true },
] as const;
