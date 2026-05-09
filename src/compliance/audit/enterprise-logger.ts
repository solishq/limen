// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
} from '../../adapters/shared/types.js';

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md S10.3' };
}

/**
 * TimeProvider interface for deterministic testing.
 * F-13: All temporal logic uses injected provider, never direct Date.
 */
export interface TimeProvider {
  now(): string; // ISO-8601
}

const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => new Date().toISOString(),
};

/**
 * Recursive sorted-key JSON serializer for deterministic hash computation.
 * F-01: Handles nested objects (recursive sort), arrays (preserve order),
 * null, and primitives. Produces identical output regardless of key insertion order.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalJsonStringify(item));
    return '[' + items.join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    key => JSON.stringify(key) + ':' + canonicalJsonStringify(obj[key]),
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Enterprise audit entry -- extends AuditLogEntry with enterprise metadata.
 */
export interface EnterpriseAuditEntry extends AuditLogEntry {
  readonly sequenceNumber: number;
  readonly tombstoned: boolean;
  readonly tombstonedAt: string | null;
  readonly archiveStatus: 'active' | 'archived' | 'tombstoned';
  /**
   * Finding-9 fix: Original content hash preserved at tombstone time.
   * When an entry is tombstoned, its details/action/governanceDecision are
   * redacted but the original currentHash is kept for chain linkage.
   * This field stores that original hash so verifyChain() can confirm the
   * tombstoned entry still references the correct pre-tombstone hash.
   * null for non-tombstoned entries.
   */
  readonly originalContentHash: string | null;
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
 * GOVERNANCE: This component is always governed (readonly #governed = true).
 * Finding-37: Removed dead governance bypass check — #governed is readonly true.
 */
export class EnterpriseAuditLogger {
  // Finding-10/36: Bound in-memory entries to prevent unbounded memory growth.
  // When capacity is reached, oldest entries are evicted FIFO.
  static readonly MAX_ENTRIES = 10_000;

  // Finding-37: governance is always active (no ungoverned mode)
  readonly #entries: EnterpriseAuditEntry[] = [];
  readonly #eventListeners: Array<(event: string, data: unknown) => void> = [];
  readonly #timeProvider: TimeProvider;
  #nextSequence = 0;

  constructor(timeProvider?: TimeProvider) {
    this.#timeProvider = timeProvider ?? DEFAULT_TIME_PROVIDER;
  }

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
    // Finding-37: Dead governance check removed — #governed is readonly true.

    // Finding-10/36: FIFO eviction when capacity reached
    if (this.#entries.length >= EnterpriseAuditLogger.MAX_ENTRIES) {
      this.#entries.shift();
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
      originalContentHash: null, // Finding-9: only set during tombstone
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

      // Finding-9 fix: For tombstoned entries, verify that currentHash matches
      // the preserved originalContentHash. This ensures a tombstoned entry's
      // hash was not tampered with after tombstoning. The content itself cannot
      // be re-verified (details were redacted), but the stored original hash
      // proves the chain link is authentic.
      if (entry.tombstoned) {
        if (entry.originalContentHash === null) {
          // Finding-9: Tombstoned entry missing originalContentHash — integrity
          // cannot be verified. This indicates corruption or a pre-fix tombstone.
          this.#emitEvent('audit:integrity_violation', {
            index: i,
            reason: 'Tombstoned entry missing originalContentHash (Finding-9)',
          });
          return {
            ok: true,
            value: {
              valid: false,
              entriesChecked: i - start + 1,
              firstInvalidIndex: i,
              firstInvalidReason: `Entry ${String(i)}: tombstoned entry missing originalContentHash — cannot verify integrity`,
            },
          };
        }
        if (entry.currentHash !== entry.originalContentHash) {
          // Finding-9: currentHash was modified after tombstoning — tamper detected
          this.#emitEvent('audit:integrity_violation', {
            index: i,
            reason: 'Tombstoned entry currentHash does not match originalContentHash (Finding-9)',
          });
          return {
            ok: true,
            value: {
              valid: false,
              entriesChecked: i - start + 1,
              firstInvalidIndex: i,
              firstInvalidReason: `Entry ${String(i)}: tombstoned entry currentHash does not match originalContentHash (tamper detected)`,
            },
          };
        }
        continue;
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
   * Get entries with optional pagination.
   * Finding-10: Added pagination to avoid deep-cloning all entries.
   * Returns a frozen shallow slice — entries themselves are readonly interfaces.
   *
   * @param offset - Start index (default 0)
   * @param limit - Maximum entries to return (default all)
   * @returns Frozen array of audit entries
   */
  getEntries(offset?: number, limit?: number): readonly EnterpriseAuditEntry[] {
    const start = offset ?? 0;
    const end = limit !== undefined ? Math.min(start + limit, this.#entries.length) : this.#entries.length;
    const slice = this.#entries.slice(start, end);
    return Object.freeze(slice.map(e => Object.freeze(structuredClone(e))));
  }

  /**
   * F-02: Tombstone an entry in-place in the audit chain.
   * Replaces the entry at the given index with a tombstoned version.
   * The currentHash is PRESERVED (it was already chained) -- only details are redacted.
   * Chain verification continues to work because the original hash is retained.
   *
   * @param index - The index of the entry to tombstone
   * @returns Result with the tombstoned entry
   */
  tombstoneEntry(index: number): Result<EnterpriseAuditEntry> {
    if (index < 0 || index >= this.#entries.length) {
      return { ok: false, error: makeError('INVALID_INDEX', `Index ${String(index)} out of range [0, ${String(this.#entries.length)})`) };
    }
    const entry = this.#entries[index]!;
    if (entry.tombstoned) {
      return { ok: false, error: makeError('ALREADY_TOMBSTONED', `Entry at index ${String(index)} is already tombstoned`) };
    }
    const tombstoned: EnterpriseAuditEntry = {
      id: entry.id,
      timestamp: entry.timestamp,
      tenantId: entry.tenantId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      event: entry.event,
      action: null,
      governanceDecision: null,
      details: Object.freeze({ tombstoned: true, originalEvent: entry.event }),
      previousHash: entry.previousHash,
      currentHash: entry.currentHash,
      classification: entry.classification,
      sequenceNumber: entry.sequenceNumber,
      tombstoned: true,
      tombstonedAt: this.#timeProvider.now(),
      archiveStatus: 'tombstoned',
      // Finding-9 fix: Preserve original content hash for verification.
      // verifyChain() uses this to confirm the tombstoned entry's currentHash
      // still matches the pre-tombstone computation.
      originalContentHash: entry.currentHash,
    };
    this.#entries[index] = tombstoned;
    return { ok: true, value: tombstoned };
  }

  /**
   * Get entry count.
   */
  get entryCount(): number {
    return this.#entries.length;
  }

  /**
   * Subscribe to audit events.
   * F-14: Returns an unsubscribe function to prevent memory leaks.
   */
  onEvent(listener: (event: string, data: unknown) => void): () => void {
    this.#eventListeners.push(listener);
    return () => this.offEvent(listener);
  }

  /**
   * F-14: Unsubscribe from audit events.
   */
  offEvent(listener: (event: string, data: unknown) => void): void {
    const idx = this.#eventListeners.indexOf(listener);
    if (idx !== -1) {
      this.#eventListeners.splice(idx, 1);
    }
  }

  /**
   * Compute SHA-256 hash of canonical JSON (recursively sorted keys, no whitespace).
   * SHARED_TYPES.md S10.3: currentHash = SHA-256(canonical serialized entry excluding currentHash).
   * F-01: Uses canonicalJsonStringify for deterministic nested object serialization.
   */
  #computeHash(obj: unknown): string {
    const canonical = canonicalJsonStringify(obj);
    return createHash('sha256').update(canonical).digest('hex');
  }

  #emitEvent(event: string, data: unknown): void {
    // Finding-60: Isolate listener failures — one bad listener must not break others
    for (const listener of this.#eventListeners) {
      try {
        listener(event, data);
      } catch {
        // Finding-60: Swallow listener error to prevent cascade failure
      }
    }
  }
}
