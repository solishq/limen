/**
 * SQLite database lifecycle implementation.
 * S ref: §3.1, §3.4, §3.6, I-01, I-05, C-05, FM-05
 *
 * Phase: 1 (Kernel) -- Build Order 1
 * Foundation: everything else depends on this.
 *
 * §3.1: SQLite foundation -- single-file database.
 * §3.4: WAL mode, ACID transactions, crash recovery.
 * §3.6: Entire engine state in dataDir. Backup = cp -r.
 * I-01: Only production dependency is better-sqlite3.
 * I-05: Database never in inconsistent state.
 * C-05: Forward-only migrations.
 * FM-05: WAL mode + busy timeout + foreign keys.
 */

import Database from 'better-sqlite3';
import { mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Result, DatabaseConfig, DatabaseConnection, DatabaseLifecycle,
  MigrationEntry, MigrationResult, SchemaVerification,
  ExportResult, DatabaseHealth, RunResult,
} from '../interfaces/index.js';

// ─── Genesis hash: SHA-256 of empty string ───
// Anchors the audit chain. Well-known constant per SDD A06-3.
const GENESIS_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Default busy timeout in milliseconds. S ref: FM-05. */
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Create a DatabaseConnection wrapping a better-sqlite3 instance.
 * S ref: §3.4 (ACID), I-05 (transactional consistency), FM-05 (WAL + busy timeout)
 */
function createConnection(
  db: Database.Database,
  dataDir: string,
  schemaVersion: number,
  tenancyMode: DatabaseConfig['tenancy']['mode'],
  onClose?: () => void,
): DatabaseConnection {
  const conn: DatabaseConnection = {
    dataDir,
    schemaVersion,
    tenancyMode,
    rawHandle: db,

    /** §3.4: Execute within transaction. Automatic rollback on throw. I-05. */
    transaction<T>(fn: () => T): T {
      const txn = db.transaction(fn);
      return txn();
    },

    /** §3.4: Run prepared statement. */
    run(sql: string, params?: unknown[]): RunResult {
      const stmt = db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },

    /** §3.4: Query with results. */
    query<T>(sql: string, params?: unknown[]): T[] {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    },

    /** §3.4: Single result. */
    get<T>(sql: string, params?: unknown[]): T | undefined {
      const stmt = db.prepare(sql);
      return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
    },

    /** I-05: Graceful close with WAL checkpoint. FO-003: Cleanup tracking map. */
    close(): Result<void> {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
        onClose?.();
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'DATABASE_CLOSE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-05',
          },
        };
      }
    },
  };

  return conn;
}

/**
 * Get current schema version from core_migrations table.
 * Returns 0 if the table does not exist yet.
 */
function getCurrentSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(
      `SELECT MAX(version) as version FROM core_migrations WHERE status = 'applied'`
    ).get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Create the core_migrations table if it does not exist.
 * S ref: C-05 (forward-only migrations), C-09 (core_ prefix)
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      checksum    TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','failed'))
    );
  `);
}

// ─── DatabaseLifecycle Implementation ───

/**
 * Create a DatabaseLifecycle implementation.
 * S ref: §3.1, §3.4, §3.6, I-01, I-05, C-05, FM-05
 */
export function createDatabaseLifecycle(): DatabaseLifecycle {
  /** Map of open databases for cleanup tracking */
  const openDatabases = new Map<string, Database.Database>();

  return {
    /**
     * Open database, configure WAL mode, set pragmas, return connection.
     * S ref: §3.4 (WAL mode), §3.6 (dataDir), I-05 (consistent state), FM-05 (busy timeout)
     */
    open(config: DatabaseConfig): Result<DatabaseConnection> {
      try {
        const { dataDir, tenancy, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS } = config;

        // §3.6: Create dataDir if it doesn't exist
        // P2-TOCTOU: Use atomic mkdirSync({recursive: true}) — idempotent, no TOCTOU race
        mkdirSync(dataDir, { recursive: true });

        const dbPath = join(dataDir, 'limen.db');
        const db = new Database(dbPath);

        // §3.4: WAL mode for crash safety
        db.pragma('journal_mode = WAL');

        // FM-05: Busy timeout to prevent SQLITE_BUSY
        db.pragma(`busy_timeout = ${busyTimeoutMs}`);

        // I-05: Foreign key enforcement
        db.pragma('foreign_keys = ON');

        // Performance: synchronous NORMAL is safe with WAL
        db.pragma('synchronous = NORMAL');

        // CF-022 DB-01: Production PRAGMAs for operational hardening
        db.pragma('journal_size_limit = 67108864'); // 64MB WAL journal cap
        db.pragma('cache_size = -20000');            // 20MB page cache (negative = KiB)
        db.pragma('mmap_size = 268435456');          // 256MB memory-mapped I/O

        // Ensure core_migrations table exists
        ensureMigrationsTable(db);

        const schemaVersion = getCurrentSchemaVersion(db);

        // CF-022 DB-03: Validate no failed migrations on startup.
        // A failed migration indicates the schema is in an unknown state
        // and must not be used until resolved.
        try {
          const failedRow = db.prepare(
            `SELECT version, name FROM core_migrations WHERE status = 'failed' LIMIT 1`
          ).get() as { version: number; name: string } | undefined;
          if (failedRow) {
            return {
              ok: false,
              error: {
                code: 'SCHEMA_INVALID',
                message: `Failed migration detected: v${failedRow.version} (${failedRow.name}). Database schema is in unknown state.`,
                spec: 'C-05, I-05',
              },
            };
          }
        } catch {
          // core_migrations table may not exist yet (first open) — that's fine
        }

        // Track for cleanup
        openDatabases.set(dataDir, db);

        // FO-003: Pass cleanup callback to remove stale entry when connection is closed
        const conn = createConnection(db, dataDir, schemaVersion, tenancy.mode, () => {
          openDatabases.delete(dataDir);
        });
        return { ok: true, value: conn };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'DATABASE_OPEN_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§3.4, I-05',
          },
        };
      }
    },

    /**
     * Run all pending forward-only migrations.
     * Each migration runs in its own transaction.
     * Checksum verification prevents tampered migration files.
     * S ref: C-05 (forward-only migrations)
     */
    migrate(conn: DatabaseConnection, migrations: MigrationEntry[]): Result<MigrationResult> {
      try {
        const db = openDatabases.get(conn.dataDir);
        if (!db) {
          return {
            ok: false,
            error: { code: 'DATABASE_NOT_OPEN', message: 'No open database for this connection', spec: '§3.4' },
          };
        }

        const currentVersion = getCurrentSchemaVersion(db);

        // Sort migrations by version
        const sorted = [...migrations].sort((a, b) => a.version - b.version);

        // Filter to only pending migrations
        const pending = sorted.filter(m => m.version > currentVersion);

        const applied: Array<{ version: number; name: string; durationMs: number }> = [];

        for (const migration of pending) {
          // C-05: Verify checksum
          const computedChecksum = createHash('sha256').update(migration.sql).digest('hex');
          if (computedChecksum !== migration.checksum) {
            return {
              ok: false,
              error: {
                code: 'MIGRATION_CHECKSUM_MISMATCH',
                message: `Migration ${migration.version} (${migration.name}): expected checksum ${migration.checksum}, got ${computedChecksum}`,
                spec: 'C-05',
              },
            };
          }

          const startTime = performance.now();
          try {
            // Each migration in its own transaction
            db.transaction(() => {
              db.exec(migration.sql);
              db.prepare(
                `INSERT INTO core_migrations (version, name, checksum, duration_ms, status)
                 VALUES (?, ?, ?, ?, 'applied')`
              ).run(migration.version, migration.name, migration.checksum, 0);
            })();

            const durationMs = Math.round(performance.now() - startTime);

            // Update duration after the fact
            db.prepare('UPDATE core_migrations SET duration_ms = ? WHERE version = ?')
              .run(durationMs, migration.version);

            applied.push({ version: migration.version, name: migration.name, durationMs });
          } catch (err) {
            // Record failed migration
            try {
              db.prepare(
                `INSERT OR REPLACE INTO core_migrations (version, name, checksum, status)
                 VALUES (?, ?, ?, 'failed')`
              ).run(migration.version, migration.name, migration.checksum);
            } catch {
              // Best effort to record failure
            }

            return {
              ok: false,
              error: {
                code: 'MIGRATION_FAILED',
                message: `Migration ${migration.version} (${migration.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
                spec: 'C-05',
              },
            };
          }
        }

        const newVersion = getCurrentSchemaVersion(db);

        return {
          ok: true,
          value: {
            applied: applied.length,
            currentVersion: newVersion,
            migrations: applied,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'MIGRATION_ERROR',
            message: err instanceof Error ? err.message : String(err),
            spec: 'C-05',
          },
        };
      }
    },

    /**
     * Verify current schema matches expected version.
     * S ref: C-05 (migration integrity verification)
     */
    verifySchema(conn: DatabaseConnection): Result<SchemaVerification> {
      try {
        const db = openDatabases.get(conn.dataDir);
        if (!db) {
          return {
            ok: false,
            error: { code: 'DATABASE_NOT_OPEN', message: 'No open database for this connection', spec: '§3.4' },
          };
        }

        const currentVersion = getCurrentSchemaVersion(db);
        const rows = db.prepare(
          `SELECT version FROM core_migrations WHERE status = 'applied' ORDER BY version`
        ).all() as Array<{ version: number }>;

        // Detect gaps in applied migrations
        const missingMigrations: number[] = [];
        if (rows.length > 0) {
          for (let v = 1; v <= currentVersion; v++) {
            if (!rows.some(r => r.version === v)) {
              missingMigrations.push(v);
            }
          }
        }

        return {
          ok: true,
          value: {
            valid: missingMigrations.length === 0,
            currentVersion,
            expectedVersion: currentVersion,
            missingMigrations,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'SCHEMA_VERIFY_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'C-05',
          },
        };
      }
    },

    /**
     * Export entire database to .limen archive.
     * S ref: §3.6 ("limen export produces single .limen archive for transfer")
     */
    export(conn: DatabaseConnection, outputPath: string): Result<ExportResult> {
      try {
        const db = openDatabases.get(conn.dataDir);
        if (!db) {
          return {
            ok: false,
            error: { code: 'DATABASE_NOT_OPEN', message: 'No open database for this connection', spec: '§3.6' },
          };
        }

        // Checkpoint WAL before export
        db.pragma('wal_checkpoint(TRUNCATE)');

        // Copy database file
        const dbPath = join(conn.dataDir, 'limen.db');
        copyFileSync(dbPath, outputPath);

        const stats = statSync(outputPath);

        return {
          ok: true,
          value: {
            path: outputPath,
            sizeBytes: stats.size,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'EXPORT_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§3.6',
          },
        };
      }
    },

    /**
     * Get database health status.
     * S ref: I-05 (consistency check)
     */
    health(conn: DatabaseConnection): Result<DatabaseHealth> {
      try {
        const db = openDatabases.get(conn.dataDir);
        if (!db) {
          return {
            ok: false,
            error: { code: 'DATABASE_NOT_OPEN', message: 'No open database for this connection', spec: 'I-05' },
          };
        }

        // CF-022 DB-02: quick_check instead of integrity_check for health hot path.
        // integrity_check is O(n) full database scan — too slow for routine health checks.
        // quick_check validates B-tree structure without verifying row content.
        const integrityResult = db.pragma('quick_check') as Array<{ quick_check: string }>;
        const integrityOk = integrityResult.length === 1 && integrityResult[0]?.quick_check === 'ok';

        // Page info
        const pageCount = (db.pragma('page_count') as Array<{ page_count: number }>)[0]?.page_count ?? 0;
        const freePages = (db.pragma('freelist_count') as Array<{ freelist_count: number }>)[0]?.freelist_count ?? 0;

        // WAL size (pages)
        const walCheckpoint = db.pragma('wal_checkpoint(PASSIVE)') as Array<{ busy: number; log: number; checkpointed: number }>;
        const walSize = walCheckpoint[0]?.log ?? 0;

        const schemaVersion = getCurrentSchemaVersion(db);

        return {
          ok: true,
          value: {
            status: integrityOk ? 'healthy' : 'unhealthy',
            walSize,
            pageCount,
            freePages,
            schemaVersion,
            integrityOk,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'HEALTH_CHECK_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-05',
          },
        };
      }
    },
  };
}

export { GENESIS_HASH };
