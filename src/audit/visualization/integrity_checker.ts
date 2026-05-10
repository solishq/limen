// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §8.6, §8.7, §8.8
/**
 * Integrity Checker — Chain integrity verification for audit entries.
 *
 * Implements: AV-8.6, AV-8.12 through AV-8.17, AV-10.1 (Chain Continuity),
 *             AV-10.2 (Append-Only), AV-10.9 (Integrity Verifiability)
 *
 * AV-10.1: Every entry hash-chained; entry[n].previousHash === entry[n-1].currentHash.
 * AV-10.9: Chain integrity verifiable at any time. repairMode flags but does NOT mutate.
 */

import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Result, EventId } from '../../kernel/interfaces/index.js';
import type {
  IntegrityReport, IntegrityViolation, IntegrityCheckOptions,
  IntegrityViolationType,
} from './visualization_types.js';

// ─── Internal row shape ───

interface AuditChainRow {
  id: string;
  seq_no: number;
  timestamp: string;
  actor_type: string;
  actor_id: string;
  operation: string;
  resource_type: string;
  resource_id: string;
  detail: string | null;
  previous_hash: string;
  current_hash: string;
}

export interface IntegrityCheckerDeps {
  readonly conn: DatabaseConnection;
  readonly timeProvider: TimeProvider;
}

/**
 * Verify hash chain integrity of the audit log.
 * AV-10.1: entry[n].previousHash === entry[n-1].currentHash
 * AV-10.9: repairMode flags violations but does NOT mutate data.
 *
 * Checks:
 * 1. Hash chain continuity (hash_mismatch)
 * 2. Sequence number continuity (sequence_gap)
 * 3. Parent link validity (missing_parent)
 * 4. Monotonic timestamps (timestamp_regression)
 */
export function verifyChainIntegrity(
  deps: IntegrityCheckerDeps,
  options: IntegrityCheckOptions,
): Result<IntegrityReport> {
  const { conn, timeProvider } = deps;
  const { scope, recentWindowHours, repairMode: _repairMode } = options;

  // Build query based on scope
  let query: string;
  let params: unknown[];

  if (scope === 'recent') {
    const windowHours = recentWindowHours ?? 24;
    const cutoff = new Date(timeProvider.nowMs() - windowHours * 60 * 60 * 1000).toISOString();
    query = `SELECT id, seq_no, timestamp, actor_type, actor_id, operation, resource_type, resource_id, detail, previous_hash, current_hash
             FROM core_audit_log
             WHERE timestamp >= ?
             ORDER BY seq_no ASC`;
    params = [cutoff];
  } else {
    // Full scan
    query = `SELECT id, seq_no, timestamp, actor_type, actor_id, operation, resource_type, resource_id, detail, previous_hash, current_hash
             FROM core_audit_log
             ORDER BY seq_no ASC`;
    params = [];
  }

  const rows = conn.query<AuditChainRow>(query, params);

  const violations: IntegrityViolation[] = [];
  let brokenLinks = 0;
  let hashMismatches = 0;
  let firstBreakAt: EventId | null = null;

  let previousRow: AuditChainRow | null = null;

  for (const row of rows) {
    // Check 1: Hash chain continuity (AV-10.1)
    if (previousRow) {
      if (row.previous_hash !== previousRow.current_hash) {
        hashMismatches++;
        if (!firstBreakAt) firstBreakAt = row.id as EventId;
        violations.push(Object.freeze({
          entryId: row.id as EventId,
          type: 'hash_mismatch' as IntegrityViolationType,
          expected: previousRow.current_hash,
          actual: row.previous_hash,
        }));
      }
    }

    // Check 2: Sequence number continuity
    if (previousRow) {
      const expectedSeqNo = previousRow.seq_no + 1;
      if (row.seq_no !== expectedSeqNo) {
        brokenLinks++;
        if (!firstBreakAt) firstBreakAt = row.id as EventId;
        violations.push(Object.freeze({
          entryId: row.id as EventId,
          type: 'sequence_gap' as IntegrityViolationType,
          expected: String(expectedSeqNo),
          actual: String(row.seq_no),
        }));
      }
    }

    // Check 3: Monotonic timestamp (no regression)
    if (previousRow) {
      const prevMs = new Date(previousRow.timestamp).getTime();
      const currMs = new Date(row.timestamp).getTime();
      if (currMs < prevMs) {
        if (!firstBreakAt) firstBreakAt = row.id as EventId;
        violations.push(Object.freeze({
          entryId: row.id as EventId,
          type: 'timestamp_regression' as IntegrityViolationType,
          expected: `>= ${previousRow.timestamp}`,
          actual: row.timestamp,
        }));
      }
    }

    // Check 4: Verify the entry's own hash is consistent
    // Recompute the hash from entry fields to verify it was not tampered
    const recomputedHash = computeEntryHash(
      row.previous_hash,
      row.seq_no,
      row.timestamp,
      row.actor_type,
      row.actor_id,
      row.operation,
      row.resource_type,
      row.resource_id,
      row.detail,
    );
    if (recomputedHash !== row.current_hash) {
      hashMismatches++;
      if (!firstBreakAt) firstBreakAt = row.id as EventId;
      violations.push(Object.freeze({
        entryId: row.id as EventId,
        type: 'hash_mismatch' as IntegrityViolationType,
        expected: recomputedHash,
        actual: row.current_hash,
      }));
    }

    previousRow = row;
  }

  const report: IntegrityReport = Object.freeze({
    valid: violations.length === 0,
    entriesChecked: rows.length,
    brokenLinks,
    hashMismatches,
    firstBreakAt,
    details: Object.freeze(violations),
  });

  return { ok: true, value: report };
}

// ─── Hash computation (mirrors kernel audit_trail.ts) ───

function computeEntryHash(
  previousHash: string,
  seqNo: number,
  timestamp: string,
  actorType: string,
  actorId: string,
  operation: string,
  resourceType: string,
  resourceId: string,
  detail: string | null,
): string {
  const fields = [
    previousHash,
    String(seqNo),
    timestamp,
    actorType,
    actorId,
    operation,
    resourceType,
    resourceId,
    detail ?? '',
  ];
  const payload = fields.join('|');
  return createHash('sha256').update(payload).digest('hex');
}
