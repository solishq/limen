/**
 * Tenant-scoped connection facade.
 * S ref: FM-10 (tenant data leakage prevention), RDD-3 (transparent tenancy)
 *
 * Phase: 4B (Certification — Tenant Isolation)
 * Decision: DEC-CERT-002 (tenant_id on all tables)
 *
 * Mechanism: Wraps a raw DatabaseConnection, intercepting query(), get(), run()
 * to auto-inject `AND tenant_id = ?` for SELECT/UPDATE/DELETE in row-level mode.
 * INSERTs pass through unchanged (caller includes tenant_id).
 *
 * In single/database mode: pure pass-through (no injection).
 *
 * This is the "suspenders" half of belt-and-suspenders. The "belt" is explicit
 * tenant_id predicates in each query. Together, a developer who forgets the belt
 * still has the suspenders. A developer writing a new query cannot bypass this —
 * the facade IS the connection. There is no raw DatabaseConnection accessible
 * from orchestration code except via the explicit .raw escape hatch.
 *
 * CORR1-01 + AUDIT-001: Complex SQL fail-safe. JOINs, CTEs, subqueries, and
 * set operations THROW immediately rather than silently mis-positioning the
 * tenant predicate. Forces the developer to use .raw with SYSTEM_SCOPE annotation.
 *
 * AUDIT-002: Falsy tenantId check. Empty string is as dangerous as null.
 */

import type {
  DatabaseConnection, RunResult, Result, TenantId,
} from '../interfaces/index.js';

// ─── Exported Type ───

/**
 * A DatabaseConnection with automatic tenant_id injection.
 * Satisfies DatabaseConnection interface — all existing code compiles unchanged.
 * The `raw` and `tenantId` properties are additive.
 */
export interface TenantScopedConnection extends DatabaseConnection {
  /** Escape hatch for system operations (audit hash chain, bulk expiry). */
  readonly raw: DatabaseConnection;
  /** Current tenant context. Null in single mode or when no tenant is set. */
  readonly tenantId: TenantId | null;
}

// ─── Complex SQL Patterns (CORR1-01 + AUDIT-001) ───

/**
 * Patterns that indicate complex SQL where regex-based tenant_id injection
 * is unsafe. If any pattern matches, injectTenantPredicate THROWS rather
 * than silently mis-positioning the predicate.
 *
 * Verified against current codebase: zero vulnerable queries use these patterns.
 * This fail-safe catches future developers who introduce complex SQL without
 * using the .raw escape hatch.
 */
const COMPLEX_SQL_PATTERNS: readonly RegExp[] = [
  /\bJOIN\b/i,
  /\bWITH\b/i,
  /\bIN\s*\(\s*SELECT\b/i,
  /\bEXISTS\s*\(/i,
  /\bNOT\s+IN\s*\(\s*SELECT\b/i,
  /\bNOT\s+EXISTS\s*\(/i,
  /\bUNION\b/i,
  /\bEXCEPT\b/i,
  /\bINTERSECT\b/i,
  /\bANY\s*\(/i,
  /\bALL\s*\(\s*SELECT\b/i,
];

// ─── SQL Injection Logic ───

/**
 * FM-10: Inject tenant_id predicate into SQL queries.
 *
 * Rules:
 * 1. INSERT statements: pass through unchanged (caller includes tenant_id)
 * 2. Complex SQL (JOIN, CTE, subquery, set ops): THROW — not safe for regex injection
 * 3. SELECT/UPDATE/DELETE with WHERE: append AND tenant_id = ?
 * 4. SELECT/UPDATE/DELETE without WHERE: add WHERE tenant_id = ?
 * 5. Position: before ORDER BY, GROUP BY, LIMIT, HAVING clauses
 *
 * Constraints (verified against current codebase — no violations):
 * - No CTEs in vulnerable queries (getRootMissionId uses loop)
 * - No JOINs in vulnerable queries (all single-table)
 * - No subqueries in vulnerable queries
 * - All UPDATE/DELETE have WHERE clauses
 *
 * CORR1-01 + AUDIT-001: Complex SQL fail-safe. If a future developer introduces
 * a JOIN, CTE, subquery, or set operation, the facade THROWS immediately rather
 * than silently mis-positioning the tenant predicate. This forces the developer
 * to use deps.conn.raw with SYSTEM_SCOPE annotation and manual tenant scoping.
 *
 * Exported for unit testing (Layer 1 tests).
 */
export function injectTenantPredicate(
  sql: string,
  params: unknown[],
  tenantId: TenantId,
): { scopedSql: string; scopedParams: unknown[] } {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  // Rule 1: INSERTs pass through
  if (upper.startsWith('INSERT')) {
    return { scopedSql: sql, scopedParams: params };
  }

  // Rule 2: Complex SQL fail-safe — THROW, don't silently mis-inject
  for (const pattern of COMPLEX_SQL_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `TenantScopedConnection: Complex SQL detected (${pattern}). ` +
        `Use deps.conn.raw with // SYSTEM_SCOPE annotation for complex queries. ` +
        `SQL: ${trimmed.slice(0, 80)}...`,
      );
    }
  }

  // Rule 3-5: Simple SELECT/UPDATE/DELETE — inject tenant_id
  const hasWhere = /\bWHERE\b/i.test(trimmed);
  const tenantClause = hasWhere ? ' AND tenant_id = ?' : ' WHERE tenant_id = ?';

  // Find insertion point: before trailing clauses
  const trailingPattern = /\b(ORDER\s+BY|GROUP\s+BY|LIMIT|HAVING)\b/i;
  const trailingMatch = trimmed.match(trailingPattern);
  const insertPos = trailingMatch?.index ?? trimmed.length;

  const scopedSql = trimmed.slice(0, insertPos) + tenantClause + trimmed.slice(insertPos);
  return { scopedSql, scopedParams: [...params, tenantId] };
}

// ─── Factory ───

/**
 * FM-10: Create a tenant-scoped connection facade.
 * In row-level mode: auto-injects AND tenant_id = ? into all
 * SELECT/UPDATE/DELETE queries. INSERTs pass through unchanged.
 * In single/database mode: pass-through (no injection).
 *
 * The returned object satisfies DatabaseConnection interface —
 * all existing code works unchanged.
 *
 * AUDIT-002: Uses falsy check (!tenantId) — empty string is as dangerous as null.
 *
 * @param conn - Raw DatabaseConnection to wrap
 * @param scopedTenantId - Tenant to scope queries to. Null = no scoping.
 * @returns TenantScopedConnection with .raw escape hatch and .tenantId property
 */
export function createTenantScopedConnection(
  conn: DatabaseConnection,
  scopedTenantId: TenantId | null,
): TenantScopedConnection {
  // Single mode or falsy tenant: no scoping needed
  // AUDIT-002: Use falsy check — empty string is as dangerous as null
  if (conn.tenancyMode !== 'row-level' || !scopedTenantId) {
    return {
      dataDir: conn.dataDir,
      schemaVersion: conn.schemaVersion,
      tenancyMode: conn.tenancyMode,
      raw: conn,
      tenantId: scopedTenantId,

      transaction<T>(fn: () => T): T {
        return conn.transaction(fn);
      },

      run(sql: string, params?: unknown[]): RunResult {
        return conn.run(sql, params);
      },

      query<T>(sql: string, params?: unknown[]): T[] {
        return conn.query<T>(sql, params);
      },

      get<T>(sql: string, params?: unknown[]): T | undefined {
        return conn.get<T>(sql, params);
      },

      close(): Result<void> {
        return conn.close();
      },
    };
  }

  // Row-level mode with valid tenantId: full scoping
  return {
    dataDir: conn.dataDir,
    schemaVersion: conn.schemaVersion,
    tenancyMode: conn.tenancyMode,
    tenantId: scopedTenantId,
    raw: conn,

    query<T>(sql: string, params?: unknown[]): T[] {
      const { scopedSql, scopedParams } = injectTenantPredicate(sql, params ?? [], scopedTenantId);
      return conn.query<T>(scopedSql, scopedParams);
    },

    get<T>(sql: string, params?: unknown[]): T | undefined {
      const { scopedSql, scopedParams } = injectTenantPredicate(sql, params ?? [], scopedTenantId);
      return conn.get<T>(scopedSql, scopedParams);
    },

    run(sql: string, params?: unknown[]): RunResult {
      const { scopedSql, scopedParams } = injectTenantPredicate(sql, params ?? [], scopedTenantId);
      return conn.run(scopedSql, scopedParams);
    },

    transaction<T>(fn: () => T): T {
      return conn.transaction(fn);
    },

    close(): Result<void> {
      return conn.close();
    },
  };
}
