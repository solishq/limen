/**
 * RBAC engine interface types.
 * S ref: §34, I-13, §3.7
 *
 * Phase: 1 (Kernel)
 * Implements: Role-based access control with permission checking.
 *
 * §34: RBAC with five default roles (admin, developer, operator, viewer, auditor).
 * I-13: Authorization completeness -- every operation enforces RBAC.
 * §3.7: Single-user default mode where RBAC is dormant.
 */

import type { Result, Permission, RoleId, TenantId, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── RBAC Engine Interface ───

/**
 * Role-based access control engine.
 * S ref: §34 (RBAC definition), I-13 (authorization completeness),
 *        §3.7 (dormant in single-user mode)
 */
export interface RbacEngine {
  /**
   * Check if context has required permission. Returns true/false, never throws.
   * In single-user default mode (RBAC dormant), always returns true.
   * S ref: §34 (permission check), I-13 (every operation enforces RBAC)
   */
  checkPermission(ctx: OperationContext, required: Permission): Result<boolean>;

  /**
   * Check if RBAC is currently active (false in single-user default).
   * S ref: §3.7 (single-user mode), §34 (multi-user activation)
   */
  isActive(): boolean;

  /**
   * Create a role with the specified permissions.
   * S ref: §34 (role management)
   */
  createRole(conn: DatabaseConnection, ctx: OperationContext, name: string, permissions: Permission[]): Result<RoleId>;

  /**
   * Assign role to principal (user or agent).
   * S ref: §34 (role assignment), DL-3 (trust progression)
   */
  assignRole(conn: DatabaseConnection, ctx: OperationContext, principalType: 'user' | 'agent', principalId: string, roleId: RoleId): Result<void>;

  /**
   * Revoke role from principal.
   * S ref: §34 (role revocation)
   */
  revokeRole(conn: DatabaseConnection, ctx: OperationContext, principalType: 'user' | 'agent', principalId: string, roleId: RoleId): Result<void>;

  /**
   * Get permissions for a principal.
   * Returns the union of all permissions from all assigned roles.
   * S ref: §34 (permission resolution)
   */
  getPermissions(conn: DatabaseConnection, principalType: 'user' | 'agent', principalId: string, tenantId: TenantId | null): Result<ReadonlySet<Permission>>;

  /**
   * Seed default roles (admin, developer, operator, viewer, auditor).
   * S ref: §34 (five default roles with predefined permission sets)
   */
  seedDefaultRoles(conn: DatabaseConnection): Result<void>;
}
