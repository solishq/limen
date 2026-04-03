/**
 * Database lifecycle interface types.
 * S ref: §3.1, §3.4, §3.6, I-01, I-05, C-05, FM-05
 *
 * Phase: 1 (Kernel)
 * Implements: SQLite persistence lifecycle with WAL mode, forward-only migrations,
 *             and crash recovery guarantees.
 */

import type { Result } from './common.js';

// ─── Configuration ───

/**
 * Tenancy configuration per RDD-3.
 * Consumer never knows which mode is active -- the kernel abstracts this.
 * S ref: RDD-3 (tenancy modes)
 */
export interface TenancyConfig {
  readonly mode: 'single' | 'row-level' | 'database';
}

/**
 * Database configuration.
 * S ref: §3.6 (dataDir), FM-05 (busy timeout)
 */
export interface DatabaseConfig {
  readonly dataDir: string;
  readonly tenancy: TenancyConfig;
  readonly busyTimeoutMs?: number;  // default 5000, FM-05 defense
}

// ─── Connection ───

/**
 * Run result from a prepared statement execution.
 * S ref: §3.4 (ACID mutations)
 */
export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

/**
 * Active database connection with transaction support.
 * S ref: §3.4 (ACID), I-05 (transactional consistency), FM-05 (WAL + busy timeout)
 */
export interface DatabaseConnection {
  readonly dataDir: string;
  readonly schemaVersion: number;
  readonly tenancyMode: TenancyConfig['mode'];

  /**
   * Execute within a transaction. If fn throws, automatic rollback.
   * S ref: §3.4 ("Every operation fully committed or fully rolled back"), I-05
   */
  transaction<T>(fn: () => T): T;

  /**
   * Run a prepared statement (INSERT, UPDATE, DELETE).
   * S ref: §3.4 (ACID mutations)
   */
  run(sql: string, params?: unknown[]): RunResult;

  /**
   * Query with results.
   * S ref: §3.4 (read operations)
   */
  query<T>(sql: string, params?: unknown[]): T[];

  /**
   * Single result query.
   * S ref: §3.4 (read operations)
   */
  get<T>(sql: string, params?: unknown[]): T | undefined;

  /**
   * Graceful close: checkpoint WAL, release connection.
   * S ref: I-05 (crash recovery), §3.4 (WAL checkpoint on close)
   */
  close(): Result<void>;

  /**
   * Phase 11: Raw database handle for loading SQLite extensions (e.g., sqlite-vec).
   * Returns the underlying better-sqlite3 Database instance.
   * Optional: only present when the connection implementation supports it.
   * I-P11-01: Used exclusively for sqlite-vec.load() during initialization.
   */
  readonly rawHandle?: unknown;
}

// ─── Migration ───

/**
 * A single forward-only migration entry.
 * S ref: C-05 (forward-only migrations), §48 (migration strategy)
 */
export interface MigrationEntry {
  version: number;
  name: string;
  sql: string;
  checksum: string;  // SHA-256 of sql content
}

/**
 * Result of running migrations.
 * S ref: C-05 (forward-only migrations)
 */
export interface MigrationResult {
  readonly applied: number;
  readonly currentVersion: number;
  readonly migrations: ReadonlyArray<{ version: number; name: string; durationMs: number }>;
}

/**
 * Schema verification result.
 * S ref: C-05 (migration integrity)
 */
export interface SchemaVerification {
  readonly valid: boolean;
  readonly currentVersion: number;
  readonly expectedVersion: number;
  readonly missingMigrations: readonly number[];
}

// ─── Export & Health ───

/**
 * Export result metadata.
 * S ref: §3.6 ("limen export produces single .limen archive")
 */
export interface ExportResult {
  readonly path: string;
  readonly sizeBytes: number;
}

/**
 * Database health status.
 * S ref: I-05 (transactional consistency verification)
 */
export interface DatabaseHealth {
  readonly status: 'healthy' | 'unhealthy';
  readonly walSize: number;
  readonly pageCount: number;
  readonly freePages: number;
  readonly schemaVersion: number;
  readonly integrityOk: boolean;
}

// ─── Lifecycle Interface ───

/**
 * Database lifecycle management.
 * S ref: §3.1 (SQLite foundation), §3.4 (WAL mode), §3.6 (dataDir),
 *        I-05 (transactional consistency), C-05 (forward-only migrations)
 */
export interface DatabaseLifecycle {
  /**
   * Open database, run pending migrations, set WAL mode, return connection.
   * Creates dataDir if it does not exist (§3.6).
   * S ref: §3.4 (WAL mode), §3.6 (dataDir), I-05 (consistent state)
   */
  open(config: DatabaseConfig): Result<DatabaseConnection>;

  /**
   * Run all pending forward-only migrations.
   * Each migration runs in its own transaction.
   * Checksum verification prevents tampered migration files.
   * S ref: C-05 (forward-only migrations)
   */
  migrate(conn: DatabaseConnection, migrations: MigrationEntry[]): Result<MigrationResult>;

  /**
   * Verify current schema matches expected version.
   * S ref: C-05 (migration integrity verification)
   */
  verifySchema(conn: DatabaseConnection): Result<SchemaVerification>;

  /**
   * Export entire database to .limen archive.
   * S ref: §3.6 ("limen export produces single .limen archive for transfer")
   */
  export(conn: DatabaseConnection, outputPath: string): Result<ExportResult>;

  /**
   * Get database health status.
   * S ref: I-05 (consistency check)
   */
  health(conn: DatabaseConnection): Result<DatabaseHealth>;
}
