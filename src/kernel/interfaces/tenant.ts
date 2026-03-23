/**
 * Tenant context interface types.
 * S ref: RDD-3, FM-10
 *
 * Phase: 1 (Kernel)
 * Implements: Transparent tenant isolation via row-level or DB-per-tenant routing.
 *
 * RDD-3: Consumer never knows which tenancy mode is active.
 * FM-10: Tenant data leakage prevention via automatic tenant_id injection.
 */

import type { Result, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── Tenant Context Interface ───

/**
 * Tenant-scoped database operations.
 * Abstracts the tenancy mode so consumers never need to know whether
 * row-level or DB-per-tenant isolation is active.
 * S ref: RDD-3 (transparent tenancy), FM-10 (tenant isolation)
 */
export interface TenantContext {
  /**
   * Execute SQL with automatic tenant_id injection (row-level mode)
   * or routing to correct database file (DB-per-tenant mode).
   * Consumer never knows which mode is active per RDD-3.
   * S ref: RDD-3 (transparent tenancy), FM-10 (isolation enforcement)
   */
  execute<T>(conn: DatabaseConnection, ctx: OperationContext, sql: string, params?: unknown[]): Result<T[]>;

  /**
   * Get tenant-scoped connection (routes to correct DB in database mode).
   * In row-level mode, returns the same connection with tenant context attached.
   * S ref: RDD-3 (transparent routing), FM-10 (isolation)
   */
  getConnection(ctx: OperationContext): Result<DatabaseConnection>;
}
