/**
 * EnterpriseAuditLogger
 *
 * Contract: SHARED_TYPES.md S10.3 (AuditLogEntry), S17 (Retention Policy)
 * Purpose: Append-only, hash-chained enterprise audit logger with tamper detection.
 *
 * Design decisions:
 * - Hash chain: SHA-256 of canonical JSON (sorted keys, no currentHash field)
 * - Append-only: no modification, no deletion (only tombstone via retention)
 * - Fail-closed: if any audit operation fails, the caller must treat it as failure
 * - Classification-aware: entries inherit classification from operations
 */

import { createHash } from 'node:crypto';
import type {
  AuditLogEntry,
  ClassificationLevel,
  EventId,
  AgentId,
  SessionId,
  TenantId,
  GovernanceAction,
  GovernanceDecision,
  Result,
  KernelError,
} from '../../adapters/crewai/types.js';

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md S10.3' };
}

/**
 * Enterprise audit entry -- extends AuditLogEntry with enterprise metadata.
 */
export interface EnterpriseAuditEntry extends AuditLogEntry {
  readonly sequenceNumber: number;
  readonly tombstoned: boolean;
  readonly tombstonedAt: string | null;
  readonly archiveStatus: 'active' | 'archived' | 'tombstoned';
}

/**
 * Chain verification result.
 */
export interface ChainVerificationResult {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly firstInvalidIndex: number | null;
  readonly firstInvalidReason: string | null;
}

/**
 * EnterpriseAuditLogger -- append-only, hash-chained audit with tamper detection.
 *
 * SHARED_TYPES.md S10.3: AuditLogEntry with previousHash/currentHash chain.
 * Each entry's currentHash = SHA-256(canonical JSON of entry EXCLUDING currentHash).
 * previousHash links to the prior entry's currentHash.
 *
 * #governed = true -- no ungoverned mode.
 */
export class EnterpriseAuditLogger {
  readonly #governed = true;
  readonly #entries: EnterpriseAuditEntry[] = [];
  readonly #eventListeners: Array<(event: string, data: unknown) => void> = [];
  #nextSequence = 0;

  /**
   * SHARED_TYPES.md S10.3 -- Append an audit entry to the chain.
   *
   * Append-only, fail-closed. The entry is hash-chained to the previous entry.
   * currentHash = SHA-256(canonical JSON excluding currentHash).
   * previousHash = prior entry's currentHash (or '' for first entry).
   *
   * @param entry - Partial audit entry (id, timestamp, etc. required)
   * @returns Result with the assigned EventId
   */
  appendEntry(entry: {
    readonly id: EventId;
    readonly timestamp: string;
    readonly tenantId: TenantId | null;
    readonly agentId: AgentId;
    readonly sessionId: SessionId;
    readonly event: string;
    readonly action: GovernanceAction | null;
    readonly governanceDecision: GovernanceDecision | null;
    readonly details: Readonly<Record<string, unknown>>;
    readonly classification: ClassificationLevel;
  }): Result<EventId> {
    if (!this.#governed) {
      return { ok: false, error: makeError('GOVERNANCE_REQUIRED', 'Audit logger requires governance') };
    }

    const previousHash = this.#entries.length > 0
      ? this.#entries[this.#entries.length - 1]!.currentHash
      : '';

    const sequence = this.#nextSequence++;

    // Build the entry without currentHash for hashing
    const hashableEntry = {
      id: entry.id,
      timestamp: entry.timestamp,
      tenantId: entry.tenantId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      event: entry.event,
      action: entry.action,
      governanceDecision: entry.governanceDecision,
      details: entry.details,
      previousHash,
      classification: entry.classification,
      sequenceNumber: sequence,
    };

    const currentHash = this.#computeHash(hashableEntry);

    const fullEntry: EnterpriseAuditEntry = {
      ...entry,
      previousHash,
      currentHash,
      sequenceNumber: sequence,
      tombstoned: false,
      tombstonedAt: null,
      archiveStatus: 'active',
    };

    this.#entries.push(fullEntry);

    return { ok: true, value: entry.id };
  }

  /**
   * SHARED_TYPES.md S10.3 -- Verify the integrity of the audit chain.
   *
   * Checks that each entry's currentHash matches the recomputed hash,
   * and that each entry's previousHash matches the prior entry's currentHash.
   *
   * @param from - Start index (inclusive, default 0)
   * @param to - End index (exclusive, default entries.length)
   * @returns ChainVerificationResult
   */
  verifyChain(from?: number, to?: number): Result<ChainVerificationResult> {
    const start = from ?? 0;
    const end = to ?? this.#entries.length;

    if (start < 0 || end > this.#entries.length || start > end) {
      return { ok: false, error: makeError('INVALID_RANGE', `Invalid range: [${String(start)}, ${String(end)})`) };
    }

    for (let i = start; i < end; i++) {
      const entry = this.#entries[i]!;

      // Verify previousHash links
      if (i > 0) {
        const prev = this.#entries[i - 1]!;
        if (entry.previousHash !== prev.currentHash) {
          this.#emitEvent('audit:integrity_violation', {
            index: i,
            reason: 'previousHash mismatch',
          });
          return {
            ok: true,
            value: {
              valid: false,
              entriesChecked: i - start + 1,
              firstInvalidIndex: i,
              firstInvalidReason: `Entry ${String(i)}: previousHash does not match prior entry currentHash`,
            },
          };
        }
      } else if (i === 0 && entry.previousHash !== '') {
        this.#emitEvent('audit:integrity_violation', {
          index: 0,
          reason: 'First entry previousHash must be empty string',
        });
        return {
          ok: true,
          value: {
            valid: false,
            entriesChecked: 1,
            firstInvalidIndex: 0,
            firstInvalidReason: 'First entry previousHash must be empty string',
          },
        };
      }

      // Recompute currentHash
      const hashableEntry = {
        id: entry.id,
        timestamp: entry.timestamp,
        tenantId: entry.tenantId,
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        event: entry.event,
        action: entry.action,
        governanceDecision: entry.governanceDecision,
        details: entry.details,
        previousHash: entry.previousHash,
        classification: entry.classification,
        sequenceNumber: entry.sequenceNumber,
      };

      const recomputedHash = this.#computeHash(hashableEntry);
      if (entry.currentHash !== recomputedHash) {
        this.#emitEvent('audit:integrity_violation', {
          index: i,
          reason: 'currentHash mismatch (tamper detected)',
        });
        return {
          ok: true,
          value: {
            valid: false,
            entriesChecked: i - start + 1,
            firstInvalidIndex: i,
            firstInvalidReason: `Entry ${String(i)}: currentHash does not match recomputed hash (tamper detected)`,
          },
        };
      }
    }

    return {
      ok: true,
      value: {
        valid: true,
        entriesChecked: end - start,
        firstInvalidIndex: null,
        firstInvalidReason: null,
      },
    };
  }

  /**
   * Get all entries (read-only snapshot).
   */
  getEntries(): readonly EnterpriseAuditEntry[] {
    return [...this.#entries];
  }

  /**
   * Get entry count.
   */
  get entryCount(): number {
    return this.#entries.length;
  }

  /**
   * Subscribe to audit events.
   */
  onEvent(listener: (event: string, data: unknown) => void): void {
    this.#eventListeners.push(listener);
  }

  /**
   * Compute SHA-256 hash of canonical JSON (sorted keys, no whitespace).
   * SHARED_TYPES.md S10.3: currentHash = SHA-256(canonical serialized entry excluding currentHash).
   */
  #computeHash(obj: unknown): string {
    const canonical = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  #emitEvent(event: string, data: unknown): void {
    for (const listener of this.#eventListeners) {
      listener(event, data);
    }
  }
}
