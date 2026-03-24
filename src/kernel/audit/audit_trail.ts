/**
 * Audit trail implementation.
 * S ref: I-03, I-06, §3.5, FM-08, T-5
 *
 * Phase: 1 (Kernel) -- Build Order 3
 * Must exist before any state mutation occurs.
 *
 * I-03: Every state mutation and its audit entry in same transaction.
 * I-06: Append-only. No modify, no delete. Retention = archival.
 * §3.5: SHA-256 hash chaining. Monotonic sequence numbers. Append-only.
 * FM-08: Defense against audit trail tampering via hash chain + triggers.
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type {
  Result, TenantId, OperationContext,
  AuditEntry, AuditCreateInput, AuditQueryFilter,
  ChainVerification, ArchiveResult, TombstoneResult, AuditTrail,
  DatabaseConnection,
} from '../interfaces/index.js';
import type { TimeProvider } from '../interfaces/time.js';

// ─── Genesis hash: SHA-256 of empty string ───
// Well-known constant. Anchors the hash chain (SDD A06-3).
const GENESIS_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * FM-10 + §3.5: Unwrap tenant-scoped connection for audit chain queries.
 * The audit hash chain is GLOBAL (all tenants share one monotonic sequence).
 * TenantScopedConnection.raw provides the unscoped connection.
 * If conn is not scoped, returns conn unchanged.
 *
 * S ref: §3.5 (global hash chain), FM-10 (tenant scoping must not corrupt chain)
 */
function unwrapForChainQuery(conn: DatabaseConnection): DatabaseConnection {
  return 'raw' in conn && (conn as Record<string, unknown>).raw !== undefined
    ? (conn as Record<string, unknown>).raw as DatabaseConnection
    : conn;
}

/**
 * Compute SHA-256 hash for audit chain entry.
 * Uses a deterministic field ordering for consistent hashing.
 * S ref: §3.5 (SHA-256 hash chaining)
 */
function computeEntryHash(sha256Fn: (data: string) => string, previousHash: string, input: AuditCreateInput, timestamp: string, seqNo: number): string {
  // Deterministic serialization: fixed field order, canonical JSON
  const data = [
    previousHash,
    String(seqNo),
    timestamp,
    input.actorType,
    input.actorId,
    input.operation,
    input.resourceType,
    input.resourceId,
    input.detail ? JSON.stringify(input.detail, Object.keys(input.detail).sort()) : '',
  ].join('|');

  return sha256Fn(data);
}

/**
 * Create an AuditTrail implementation.
 * Requires a sha256 function from the crypto module.
 * S ref: I-03 (atomic audit), I-06 (immutability),
 *        §3.5 (hash chaining), FM-08 (tamper detection)
 */
export function createAuditTrail(sha256Fn: (data: string) => string, time?: TimeProvider): AuditTrail {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  return {
    /**
     * Append entry. MUST be called within same transaction as mutation (I-03).
     * S ref: I-03 (atomic audit), §3.5 (hash chaining, monotonic sequence)
     */
    append(conn: DatabaseConnection, input: AuditCreateInput): Result<AuditEntry> {
      try {
        const id = randomUUID();
        const timestamp = clock.nowISO();

        // Get previous hash (chain head or genesis)
        // FM-10: Use raw connection — hash chain is GLOBAL, not per-tenant (§3.5)
        const rawConn = unwrapForChainQuery(conn);
        const lastEntry = rawConn.get<{ current_hash: string; seq_no: number }>(
          `SELECT current_hash, seq_no FROM core_audit_log ORDER BY seq_no DESC LIMIT 1`
        );

        const previousHash = lastEntry?.current_hash ?? GENESIS_HASH;
        const seqNo = (lastEntry?.seq_no ?? 0) + 1;

        // Compute hash for this entry
        const currentHash = computeEntryHash(sha256Fn, previousHash, input, timestamp, seqNo);

        // Insert into audit log
        const detailJson = input.detail ? JSON.stringify(input.detail) : null;

        conn.run(
          `INSERT INTO core_audit_log (id, seq_no, tenant_id, timestamp, actor_type, actor_id,
           operation, resource_type, resource_id, detail, previous_hash, current_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, seqNo, input.tenantId, timestamp, input.actorType, input.actorId,
           input.operation, input.resourceType, input.resourceId,
           detailJson, previousHash, currentHash]
        );

        const entry: AuditEntry = {
          seqNo,
          id,
          tenantId: input.tenantId,
          timestamp,
          actorType: input.actorType,
          actorId: input.actorId,
          operation: input.operation,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          detail: input.detail ?? null,
          previousHash,
          currentHash,
        };

        return { ok: true, value: entry };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'AUDIT_APPEND_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-03, I-06',
          },
        };
      }
    },

    /**
     * Batch append for observational (non-mutating) audits.
     * S ref: §3.5 (observational audit batching)
     */
    appendBatch(conn: DatabaseConnection, inputs: AuditCreateInput[]): Result<AuditEntry[]> {
      try {
        const entries: AuditEntry[] = [];

        // Get chain head once
        // FM-10: Use raw connection — hash chain is GLOBAL, not per-tenant (§3.5)
        const rawConn = unwrapForChainQuery(conn);
        const lastEntry = rawConn.get<{ current_hash: string; seq_no: number }>(
          `SELECT current_hash, seq_no FROM core_audit_log ORDER BY seq_no DESC LIMIT 1`
        );

        let previousHash = lastEntry?.current_hash ?? GENESIS_HASH;
        let seqNo = (lastEntry?.seq_no ?? 0);

        const insertStmt = `INSERT INTO core_audit_log (id, seq_no, tenant_id, timestamp, actor_type, actor_id,
           operation, resource_type, resource_id, detail, previous_hash, current_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        for (const input of inputs) {
          const id = randomUUID();
          const timestamp = clock.nowISO();
          seqNo += 1;

          const currentHash = computeEntryHash(sha256Fn, previousHash, input, timestamp, seqNo);
          const detailJson = input.detail ? JSON.stringify(input.detail) : null;

          conn.run(insertStmt,
            [id, seqNo, input.tenantId, timestamp, input.actorType, input.actorId,
             input.operation, input.resourceType, input.resourceId,
             detailJson, previousHash, currentHash]
          );

          entries.push({
            seqNo,
            id,
            tenantId: input.tenantId,
            timestamp,
            actorType: input.actorType,
            actorId: input.actorId,
            operation: input.operation,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            detail: input.detail ?? null,
            previousHash,
            currentHash,
          });

          previousHash = currentHash;
        }

        return { ok: true, value: entries };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'AUDIT_BATCH_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-03, I-06',
          },
        };
      }
    },

    /**
     * Query entries. RBAC: requires 'view_audit' permission.
     * S ref: I-13 (authorization on audit read)
     */
    query(conn: DatabaseConnection, ctx: OperationContext, filter: AuditQueryFilter): Result<AuditEntry[]> {
      try {
        // I-13: Check view_audit permission
        if (ctx.permissions.size > 0 && !ctx.permissions.has('view_audit')) {
          return {
            ok: false,
            error: {
              code: 'PERMISSION_DENIED',
              message: 'view_audit permission required to query audit entries',
              spec: 'I-13',
            },
          };
        }

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filter.tenantId !== undefined) {
          conditions.push('tenant_id = ?');
          params.push(filter.tenantId);
        }
        if (filter.actorId !== undefined) {
          conditions.push('actor_id = ?');
          params.push(filter.actorId);
        }
        if (filter.operation !== undefined) {
          conditions.push('operation = ?');
          params.push(filter.operation);
        }
        if (filter.resourceType !== undefined) {
          conditions.push('resource_type = ?');
          params.push(filter.resourceType);
        }
        if (filter.resourceId !== undefined) {
          conditions.push('resource_id = ?');
          params.push(filter.resourceId);
        }
        if (filter.fromTimestamp !== undefined) {
          conditions.push('timestamp >= ?');
          params.push(filter.fromTimestamp);
        }
        if (filter.toTimestamp !== undefined) {
          conditions.push('timestamp <= ?');
          params.push(filter.toTimestamp);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filter.limit ?? 100;
        const offset = filter.offset ?? 0;

        const sql = `SELECT seq_no, id, tenant_id, timestamp, actor_type, actor_id,
                     operation, resource_type, resource_id, detail, previous_hash, current_hash
                     FROM core_audit_log ${where}
                     ORDER BY seq_no ASC LIMIT ? OFFSET ?`;

        params.push(limit, offset);

        const rows = conn.query<{
          seq_no: number; id: string; tenant_id: string | null;
          timestamp: string; actor_type: string; actor_id: string;
          operation: string; resource_type: string; resource_id: string;
          detail: string | null; previous_hash: string; current_hash: string;
        }>(sql, params);

        const entries: AuditEntry[] = rows.map(row => ({
          seqNo: row.seq_no,
          id: row.id,
          tenantId: row.tenant_id as TenantId | null,
          timestamp: row.timestamp,
          actorType: row.actor_type as AuditEntry['actorType'],
          actorId: row.actor_id,
          operation: row.operation,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          detail: row.detail ? JSON.parse(row.detail) as Record<string, unknown> : null,
          previousHash: row.previous_hash,
          currentHash: row.current_hash,
        }));

        return { ok: true, value: entries };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'AUDIT_QUERY_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-06',
          },
        };
      }
    },

    /**
     * Verify hash chain integrity.
     * S ref: FM-08 (chain verification as runtime health check)
     */
    verifyChain(conn: DatabaseConnection, tenantId?: TenantId): Result<ChainVerification> {
      try {
        const tenantFilter = tenantId !== undefined ? 'WHERE tenant_id = ?' : '';
        const params = tenantId !== undefined ? [tenantId] : [];

        const rows = conn.query<{
          seq_no: number; previous_hash: string; current_hash: string;
          actor_type: string; actor_id: string; operation: string;
          resource_type: string; resource_id: string; detail: string | null;
          timestamp: string; tenant_id: string | null;
        }>(
          `SELECT seq_no, tenant_id, timestamp, actor_type, actor_id, operation,
           resource_type, resource_id, detail, previous_hash, current_hash
           FROM core_audit_log ${tenantFilter} ORDER BY seq_no ASC`,
          params
        );

        if (rows.length === 0) {
          return {
            ok: true,
            value: {
              valid: true,
              totalEntries: 0,
              firstSeqNo: 0,
              lastSeqNo: 0,
              brokenAt: null,
              expectedHash: null,
              actualHash: null,
              gaps: [],
            },
          };
        }

        const gaps: number[] = [];
        let valid = true;
        let brokenAt: number | null = null;
        let expectedHash: string | null = null;
        let actualHash: string | null = null;

        // PRR-F-001: The audit hash chain is global (all tenants share one
        // monotonic sequence). When filtering by tenantId, the filtered rows
        // will have non-contiguous seq_nos and each row's previous_hash points
        // to its global predecessor (which may belong to another tenant).
        // Therefore: skip chain linkage and gap checks for tenant-filtered views.
        // Per-entry hash recomputation still verifies individual entry integrity.
        const isTenantFiltered = tenantId !== undefined;
        let prevHash = GENESIS_HASH;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;

          // Check for sequence gaps (skip for tenant-filtered views — gaps are
          // structurally expected when other tenants' entries are excluded)
          if (!isTenantFiltered && i > 0) {
            const prevSeqNo = rows[i - 1]!.seq_no;
            for (let s = prevSeqNo + 1; s < row.seq_no; s++) {
              gaps.push(s);
            }
          }

          // Verify previousHash chain linkage (skip for tenant-filtered views —
          // the chain is global so filtered entries won't form a contiguous chain)
          if (!isTenantFiltered && row.previous_hash !== prevHash) {
            valid = false;
            brokenAt = row.seq_no;
            expectedHash = prevHash;
            actualHash = row.previous_hash;
            break;
          }

          // Recompute hash (always — proves individual entry integrity)
          const input: AuditCreateInput = {
            tenantId: row.tenant_id as TenantId | null,
            actorType: row.actor_type as AuditCreateInput['actorType'],
            actorId: row.actor_id,
            operation: row.operation,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
            ...(row.detail ? { detail: JSON.parse(row.detail) as Record<string, unknown> } : {}),
          };

          const recomputedHash = computeEntryHash(sha256Fn, row.previous_hash, input, row.timestamp, row.seq_no);

          if (recomputedHash !== row.current_hash) {
            valid = false;
            brokenAt = row.seq_no;
            expectedHash = recomputedHash;
            actualHash = row.current_hash;
            break;
          }

          prevHash = row.current_hash;
        }

        return {
          ok: true,
          value: {
            valid: valid && (isTenantFiltered || gaps.length === 0),
            totalEntries: rows.length,
            firstSeqNo: rows[0]!.seq_no,
            lastSeqNo: rows[rows.length - 1]!.seq_no,
            brokenAt,
            expectedHash,
            actualHash,
            gaps,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'CHAIN_VERIFY_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'FM-08',
          },
        };
      }
    },

    /**
     * Archive entries to sealed file.
     * S ref: I-06 (archival to sealed file, not deletion)
     */
    archive(conn: DatabaseConnection, olderThan: string, outputPath: string): Result<ArchiveResult> {
      try {
        // Find entries to archive
        const entries = conn.query<{
          seq_no: number; current_hash: string;
        }>(
          `SELECT seq_no, current_hash FROM core_audit_log WHERE timestamp < ? ORDER BY seq_no ASC`,
          [olderThan]
        );

        if (entries.length === 0) {
          return {
            ok: false,
            error: {
              code: 'NO_ENTRIES_TO_ARCHIVE',
              message: 'No audit entries found older than the specified timestamp',
              spec: 'I-06',
            },
          };
        }

        const firstSeqNo = entries[0]!.seq_no;
        const lastSeqNo = entries[entries.length - 1]!.seq_no;
        const finalHash = entries[entries.length - 1]!.current_hash;
        const segmentId = randomUUID();

        // Create archive database and copy entries
        // NOTE: Archive DB creation uses better-sqlite3 directly
        // This is the only place outside database_lifecycle.ts that opens a DB
        // because archive files are independent sealed databases.
        // S ref: I-06 (sealed archive files are independent SQLite databases)
        const require = createRequire(import.meta.url);
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchronous import required for sealed archive DB (I-06)
        const BetterSqlite3 = require('better-sqlite3') as {
          new (filename: string): {
            exec(sql: string): void;
            prepare(sql: string): { run(...params: unknown[]): void };
            transaction<T>(fn: () => T): () => T;
            close(): void;
          };
        };
        const archiveDb = new BetterSqlite3(outputPath);

        archiveDb.exec(`
          CREATE TABLE core_audit_log (
            seq_no        INTEGER PRIMARY KEY,
            id            TEXT    NOT NULL UNIQUE,
            tenant_id     TEXT,
            timestamp     TEXT    NOT NULL,
            actor_type    TEXT    NOT NULL,
            actor_id      TEXT    NOT NULL,
            operation     TEXT    NOT NULL,
            resource_type TEXT    NOT NULL,
            resource_id   TEXT    NOT NULL,
            detail        TEXT,
            previous_hash TEXT    NOT NULL,
            current_hash  TEXT    NOT NULL
          );
        `);

        // Copy entries
        const sourceEntries = conn.query<{
          seq_no: number; id: string; tenant_id: string | null;
          timestamp: string; actor_type: string; actor_id: string;
          operation: string; resource_type: string; resource_id: string;
          detail: string | null; previous_hash: string; current_hash: string;
        }>(
          `SELECT * FROM core_audit_log WHERE seq_no >= ? AND seq_no <= ? ORDER BY seq_no ASC`,
          [firstSeqNo, lastSeqNo]
        );

        const insertStmt = archiveDb.prepare(
          `INSERT INTO core_audit_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        const insertAll = archiveDb.transaction(() => {
          for (const entry of sourceEntries) {
            insertStmt.run(
              entry.seq_no, entry.id, entry.tenant_id, entry.timestamp,
              entry.actor_type, entry.actor_id, entry.operation,
              entry.resource_type, entry.resource_id, entry.detail,
              entry.previous_hash, entry.current_hash
            );
          }
        });
        insertAll();

        archiveDb.close();

        // Record archive segment
        conn.run(
          `INSERT INTO core_audit_archive_segments (id, file_path, first_seq_no, last_seq_no, final_hash, entry_count, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          [segmentId, outputPath, firstSeqNo, lastSeqNo, finalHash, entries.length]
        );

        // Remove archived entries from active table.
        // SEC-004 fix: Set archival flag to bypass DELETE trigger (I-06 defense-in-depth).
        // The trigger WHEN clause checks core_audit_archive_active; if a row exists, DELETE is allowed.
        // Flag is inserted and removed within the same transaction for atomicity.
        conn.run(`INSERT OR IGNORE INTO core_audit_archive_active (id) VALUES (1)`);
        conn.run(
          `DELETE FROM core_audit_log WHERE seq_no >= ? AND seq_no <= ?`,
          [firstSeqNo, lastSeqNo]
        );
        conn.run(`DELETE FROM core_audit_archive_active WHERE id = 1`);

        return {
          ok: true,
          value: {
            segmentId,
            archivedEntries: entries.length,
            firstSeqNo,
            lastSeqNo,
            finalHash,
            filePath: outputPath,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'ARCHIVE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-06',
          },
        };
      }
    },

    /**
     * CF-035, GDPR Art. 17: Tombstone audit entries for a tenant.
     * Replaces PII fields (detail, actor_id) with sanitized values
     * while preserving hash chain integrity via cascade re-hash.
     *
     * Algorithm:
     *   1. Find all entries for the given tenant
     *   2. Set tombstone flag (bypasses I-06 UPDATE trigger)
     *   3. For each tenant entry: replace detail → {"purged":true,"purge_date":"..."}, actor_id → "purged"
     *   4. Starting from the earliest tombstoned entry, cascade re-hash ALL subsequent entries
     *      (even non-tenant entries, because the chain is global per DEC-CERT-001)
     *   5. Clear tombstone flag
     *   6. Verify chain integrity
     *
     * S ref: I-06 (controlled UPDATE exception), I-02 (right to erasure),
     *        DEC-CERT-001 (global chain GDPR condition), §3.5 (hash chaining)
     */
    tombstone(conn: DatabaseConnection, tenantId: TenantId): Result<TombstoneResult> {
      try {
        // FM-10: Use raw connection — hash chain is GLOBAL (§3.5)
        const rawConn = unwrapForChainQuery(conn);

        // Find entries to tombstone
        const tenantEntries = rawConn.query<{ seq_no: number }>(
          `SELECT seq_no FROM core_audit_log WHERE tenant_id = ? ORDER BY seq_no ASC`,
          [tenantId]
        );

        if (tenantEntries.length === 0) {
          return {
            ok: true,
            value: { tombstonedEntries: 0, rehashedEntries: 0, chainValid: true },
          };
        }

        const firstTombstoneSeqNo = tenantEntries[0]!.seq_no;
        const purgeDate = clock.nowISO().split('T')[0]!; // YYYY-MM-DD
        const tombstoneDetail = JSON.stringify({ purged: true, purge_date: purgeDate });

        // Execute within a transaction for atomicity
        rawConn.transaction(() => {
          // Set tombstone flag to bypass I-06 UPDATE trigger
          rawConn.run(`INSERT OR IGNORE INTO core_audit_tombstone_active (id) VALUES (1)`);

          // Step 1: Tombstone all tenant entries (replace PII fields)
          rawConn.run(
            `UPDATE core_audit_log SET detail = ?, actor_id = 'purged' WHERE tenant_id = ?`,
            [tombstoneDetail, tenantId]
          );

          // Step 2: Cascade re-hash from first tombstoned entry to end of chain
          // Read ALL entries from first tombstoned entry onward
          const allEntries = rawConn.query<{
            seq_no: number; previous_hash: string; current_hash: string;
            timestamp: string; actor_type: string; actor_id: string;
            operation: string; resource_type: string; resource_id: string;
            detail: string | null; tenant_id: string | null;
          }>(
            `SELECT seq_no, tenant_id, timestamp, actor_type, actor_id, operation,
             resource_type, resource_id, detail, previous_hash, current_hash
             FROM core_audit_log WHERE seq_no >= ? ORDER BY seq_no ASC`,
            [firstTombstoneSeqNo]
          );

          // Get the previous_hash for the first entry in the re-hash range
          let prevHash: string;
          if (firstTombstoneSeqNo === 1) {
            prevHash = GENESIS_HASH;
          } else {
            const predecessor = rawConn.get<{ current_hash: string }>(
              `SELECT current_hash FROM core_audit_log WHERE seq_no < ? ORDER BY seq_no DESC LIMIT 1`,
              [firstTombstoneSeqNo]
            );
            prevHash = predecessor?.current_hash ?? GENESIS_HASH;
          }

          // Re-hash each entry
          for (const entry of allEntries) {
            const input: AuditCreateInput = {
              tenantId: entry.tenant_id as TenantId | null,
              actorType: entry.actor_type as AuditCreateInput['actorType'],
              actorId: entry.actor_id,
              operation: entry.operation,
              resourceType: entry.resource_type,
              resourceId: entry.resource_id,
              ...(entry.detail ? { detail: JSON.parse(entry.detail) as Record<string, unknown> } : {}),
            };

            const newHash = computeEntryHash(sha256Fn, prevHash, input, entry.timestamp, entry.seq_no);

            rawConn.run(
              `UPDATE core_audit_log SET previous_hash = ?, current_hash = ? WHERE seq_no = ?`,
              [prevHash, newHash, entry.seq_no]
            );

            prevHash = newHash;
          }

          // Clear tombstone flag
          rawConn.run(`DELETE FROM core_audit_tombstone_active WHERE id = 1`);
        });

        // Verify chain integrity post-tombstone
        const verifyResult = this.verifyChain(rawConn);
        const chainValid = verifyResult.ok ? verifyResult.value.valid : false;

        const rehashedEntries = rawConn.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM core_audit_log WHERE seq_no >= ?`,
          [firstTombstoneSeqNo]
        )?.count ?? 0;

        // FO-001: Meta-audit entry recording the tombstone operation itself.
        // Uses null tenantId because this is a system-level operation on the global chain.
        // Appended AFTER the tombstone transaction so it extends the chain normally.
        this.append(conn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'gdpr_tombstone',
          operation: 'gdpr_tombstone',
          resourceType: 'audit_trail',
          resourceId: tenantId,
          detail: { tombstonedEntries: tenantEntries.length, rehashedEntries, chainValid },
        });

        return {
          ok: true,
          value: { tombstonedEntries: tenantEntries.length, rehashedEntries, chainValid },
        };
      } catch (err) {
        // Ensure tombstone flag is cleaned up on error
        try {
          const rawConn = unwrapForChainQuery(conn);
          rawConn.run(`DELETE FROM core_audit_tombstone_active WHERE id = 1`);
        } catch { /* cleanup best-effort */ }

        return {
          ok: false,
          error: {
            code: 'TOMBSTONE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'CF-035, I-06, GDPR Art. 17',
          },
        };
      }
    },

    /**
     * Get current chain head hash.
     * S ref: §3.5 (hash chaining state)
     */
    getChainHead(conn: DatabaseConnection, tenantId?: TenantId): Result<string> {
      try {
        const tenantFilter = tenantId !== undefined ? 'WHERE tenant_id = ?' : '';
        const params = tenantId !== undefined ? [tenantId] : [];

        const row = conn.get<{ current_hash: string }>(
          `SELECT current_hash FROM core_audit_log ${tenantFilter} ORDER BY seq_no DESC LIMIT 1`,
          params
        );

        // If no entries, check archive segments for chain continuity
        if (!row) {
          const archiveRow = conn.get<{ final_hash: string }>(
            `SELECT final_hash FROM core_audit_archive_segments ORDER BY last_seq_no DESC LIMIT 1`
          );
          return { ok: true, value: archiveRow?.final_hash ?? GENESIS_HASH };
        }

        return { ok: true, value: row.current_hash };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'CHAIN_HEAD_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§3.5',
          },
        };
      }
    },
  };
}

export { GENESIS_HASH };
