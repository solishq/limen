// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * RetentionPolicyEnforcer
 *
 * Contract: SHARED_TYPES.md S17 (Retention Policy)
 * Purpose: Enforces retention policies based on classification level.
 *          Handles auto-archive, tombstone, hard delete, and GDPR erasure rules.
 *
 * Design decisions:
 * - Retention rules derived from SHARED_TYPES.md S17 DEFAULT_RETENTION
 * - GDPR override allowed only for unrestricted/internal/confidential
 * - Tombstone preserves: identity, hash chain linkage, event type, timestamp, classification
 * - Hard delete only for unrestricted on expiry
 */

import type { ClassificationLevel, Result, KernelError, AgentId, SessionId } from '../../adapters/shared/types.js';
import { DEFAULT_RETENTION, type EnterpriseRetentionPolicy } from '../classification/engine.js';
import type { EnterpriseAuditEntry, TimeProvider } from './enterprise-logger.js';

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md S17' };
}

/**
 * Retention action applied to an entry.
 */
export type RetentionAction = 'none' | 'archive' | 'tombstone' | 'delete';

/**
 * Result of retention enforcement on a single entry.
 */
export interface RetentionResult {
  readonly entryId: string;
  readonly action: RetentionAction;
  readonly classification: ClassificationLevel;
  readonly ageInDays: number;
  readonly retentionDays: number;
  readonly autoArchiveDays: number | null;
}

/**
 * Result of GDPR erasure check.
 */
export interface GdprErasureResult {
  readonly allowed: boolean;
  readonly classification: ClassificationLevel;
  readonly reason: string;
}

/**
 * Tombstoned entry -- preserves identity and chain linkage only.
 *
 * SHARED_TYPES.md S17: tombstone redacts details but preserves:
 * - identity (id)
 * - hash chain linkage (previousHash, currentHash)
 * - event type
 * - timestamp
 * - classification
 */
/**
 * F-12: Uses AgentId and SessionId branded types instead of plain string.
 */
export interface TombstonedEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly event: string;
  readonly classification: ClassificationLevel;
  readonly previousHash: string;
  readonly currentHash: string;
  readonly sequenceNumber: number;
  readonly tombstoned: true;
  readonly tombstonedAt: string;
  readonly archiveStatus: 'tombstoned';
  readonly tenantId: null;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly action: null;
  readonly governanceDecision: null;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * RetentionPolicyEnforcer -- applies retention rules per SHARED_TYPES.md S17.
 *
 * #governed = true -- no ungoverned mode.
 */
const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => new Date().toISOString(),
};

export class RetentionPolicyEnforcer {
  /** Governance is always enforced. This field exists to make governance non-optional visible in source. */
  readonly #governed: true = true;
  readonly #timeProvider: TimeProvider;

  constructor(timeProvider?: TimeProvider) {
    this.#timeProvider = timeProvider ?? DEFAULT_TIME_PROVIDER;
  }

  /** Verify governance is active. Used by internal checks. */
  get governed(): boolean { return this.#governed; }

  /**
   * SHARED_TYPES.md S17 -- Enforce retention on a set of entries.
   *
   * Scans entries and determines which action to apply based on:
   * 1. Age vs autoArchiveDays -> 'archive'
   * 2. Age vs retentionDays -> 'tombstone' or 'delete' (based on tombstoneOnExpiry)
   * 3. Neither -> 'none'
   *
   * @param entries - Audit entries to evaluate
   * @param now - Current time (ISO-8601)
   * @returns Array of retention results
   */
  enforceRetention(
    entries: readonly EnterpriseAuditEntry[],
    now: Date,
  ): Result<readonly RetentionResult[]> {
    const results: RetentionResult[] = [];

    for (const entry of entries) {
      const policy = DEFAULT_RETENTION[entry.classification];
      const entryDate = new Date(entry.timestamp);
      const ageMs = now.getTime() - entryDate.getTime();
      const ageInDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

      let action: RetentionAction = 'none';

      // Check retention expiry first (takes precedence)
      if (ageInDays >= policy.retentionDays) {
        action = policy.tombstoneOnExpiry ? 'tombstone' : 'delete';
      }
      // Check auto-archive (only if not already expired)
      else if (policy.autoArchiveDays !== null && ageInDays >= policy.autoArchiveDays) {
        action = 'archive';
      }

      // Finding-59: Tombstoned entries past retention should still be deletable.
      // They contain no PII (content is replaced) but still consume storage.
      // Only skip tombstoned entries if they haven't exceeded retention.
      if (entry.tombstoned && action === 'tombstone') {
        // Already tombstoned — no need to re-tombstone, but allow archive/delete
        action = 'none';
      } else if (entry.tombstoned && action === 'none') {
        // Not past retention yet — leave as-is
        action = 'none';
      }
      // If entry.tombstoned && action === 'delete' or 'archive', allow it through

      results.push({
        entryId: entry.id,
        action,
        classification: entry.classification,
        ageInDays,
        retentionDays: policy.retentionDays,
        autoArchiveDays: policy.autoArchiveDays,
      });
    }

    return { ok: true, value: results };
  }

  /**
   * SHARED_TYPES.md S17 -- Check whether GDPR erasure is permitted.
   *
   * GDPR override rules:
   * - unrestricted: allowed (gdprOverride: true)
   * - internal: allowed (gdprOverride: true)
   * - confidential: allowed (gdprOverride: true)
   * - restricted: NOT allowed (gdprOverride: false)
   * - critical: NOT allowed (gdprOverride: false)
   *
   * @param entry - The audit entry to check
   * @returns GdprErasureResult
   */
  canGdprErase(entry: EnterpriseAuditEntry): Result<GdprErasureResult> {
    const policy = DEFAULT_RETENTION[entry.classification];

    if (policy.gdprOverride) {
      return {
        ok: true,
        value: {
          allowed: true,
          classification: entry.classification,
          reason: `GDPR erasure permitted for classification '${entry.classification}'`,
        },
      };
    }

    return {
      ok: true,
      value: {
        allowed: false,
        classification: entry.classification,
        reason: `GDPR erasure NOT permitted for classification '${entry.classification}': legal/regulatory retention requirement overrides GDPR`,
      },
    };
  }

  /**
   * SHARED_TYPES.md S17 -- Tombstone an entry.
   *
   * Redacts operational details but preserves:
   * - identity (id)
   * - hash chain linkage (previousHash, currentHash)
   * - event type
   * - timestamp
   * - classification
   * - sequence number
   *
   * The hash chain remains valid because currentHash was computed at append time
   * and is preserved, along with previousHash. Chain verification can still succeed
   * on the tombstoned entry if the original hash is retained.
   *
   * @param entry - The entry to tombstone
   * @returns The tombstoned entry
   */
  tombstone(entry: EnterpriseAuditEntry): Result<TombstonedEntry> {
    if (entry.tombstoned) {
      return { ok: false, error: makeError('ALREADY_TOMBSTONED', `Entry ${entry.id} is already tombstoned`) };
    }

    const tombstoned: TombstonedEntry = {
      id: entry.id,
      timestamp: entry.timestamp,
      event: entry.event,
      classification: entry.classification,
      previousHash: entry.previousHash,
      currentHash: entry.currentHash,
      sequenceNumber: entry.sequenceNumber,
      tombstoned: true,
      tombstonedAt: this.#timeProvider.now(),
      archiveStatus: 'tombstoned',
      tenantId: null,
      agentId: entry.agentId as AgentId,
      sessionId: entry.sessionId as SessionId,
      action: null,
      governanceDecision: null,
      details: { tombstoned: true, originalEvent: entry.event },
    };

    return { ok: true, value: tombstoned };
  }

  /**
   * Get the retention policy for a classification level.
   */
  getPolicy(classification: ClassificationLevel): EnterpriseRetentionPolicy {
    return DEFAULT_RETENTION[classification];
  }
}
