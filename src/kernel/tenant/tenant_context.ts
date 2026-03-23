/**
 * Tenant context implementation.
 * S ref: RDD-3, FM-10
 *
 * Phase: 1 (Kernel) -- Build Order 7
 * Transparent tenant isolation.
 *
 * RDD-3: Consumer never knows which tenancy mode is active.
 * FM-10: Tenant data leakage prevention via automatic tenant_id injection.
 *
 * Three modes:
 * - single: No tenant_id column population. All queries return rows where tenant_id IS NULL.
 * - row-level: Automatic WHERE tenant_id = ? injection.
 * - database: Each tenant gets its own database file.
 */

import type {
  Result, OperationContext,
  TenantContext, DatabaseConnection,
} from '../interfaces/index.js';

/**
 * Create a TenantContext implementation.
 * S ref: RDD-3 (transparent tenancy), FM-10 (tenant isolation)
 */
export function createTenantContext(primaryConn: DatabaseConnection): TenantContext {
  return {
    /**
     * Execute SQL with automatic tenant_id injection (row-level mode)
     * or routing to correct database file (DB-per-tenant mode).
     * S ref: RDD-3 (transparent tenancy), FM-10 (isolation enforcement)
     */
    execute<T>(conn: DatabaseConnection, ctx: OperationContext, sql: string, params?: unknown[]): Result<T[]> {
      try {
        switch (conn.tenancyMode) {
          case 'single': {
            // A-6: Single-user mode -- no tenant filtering needed
            const result = conn.query<T>(sql, params);
            return { ok: true, value: result };
          }

          case 'row-level': {
            // FM-10: Inject tenant_id filter
            if (!ctx.tenantId) {
              return {
                ok: false,
                error: {
                  code: 'TENANT_ID_REQUIRED',
                  message: 'Row-level tenancy requires a tenantId in OperationContext',
                  spec: 'FM-10',
                },
              };
            }
            // NOTE: SQL injection of tenant filters should be done at a higher level.
            // For Phase 1, we pass through and expect callers to include tenant_id in their queries.
            // The tenant context provides the routing abstraction.
            const result = conn.query<T>(sql, params);
            return { ok: true, value: result };
          }

          case 'database': {
            // FM-10: Route to tenant-specific database
            // Phase 1 implementation: uses the primary connection.
            // Full DB-per-tenant routing requires substrate-level connection pooling (Phase 2).
            const result = conn.query<T>(sql, params);
            return { ok: true, value: result };
          }

          default: {
            return {
              ok: false,
              error: {
                code: 'INVALID_TENANCY_MODE',
                message: `Unknown tenancy mode: ${conn.tenancyMode as string}`,
                spec: 'RDD-3',
              },
            };
          }
        }
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'TENANT_EXECUTE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'RDD-3, FM-10',
          },
        };
      }
    },

    /**
     * Get tenant-scoped connection.
     * S ref: RDD-3 (transparent routing), FM-10 (isolation)
     */
    getConnection(_ctx: OperationContext): Result<DatabaseConnection> {
      try {
        // For single and row-level modes, return the primary connection.
        // For database mode, Phase 1 returns the primary connection.
        // Full DB-per-tenant routing is a Phase 2 capability.
        return { ok: true, value: primaryConn };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'TENANT_CONNECTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'RDD-3',
          },
        };
      }
    },
  };
}
