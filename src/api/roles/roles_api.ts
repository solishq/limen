/**
 * RBAC administration API wrapper for the API surface.
 * S ref: §34 (RBAC), I-13 (authorization completeness)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 11
 *
 * Wraps RBAC management operations behind the RolesApi interface:
 *   - create(): Create a custom role (Permission: 'manage_roles')
 *   - assign(): Assign role to user/agent (Permission: 'manage_roles')
 *   - revoke(): Revoke role from user/agent (Permission: 'manage_roles')
 *
 * All operations delegate to L1 Kernel's RbacEngine (via L2 orchestration layer
 * for governance boundary compliance).
 *
 * Invariants enforced: I-13 (authorization completeness)
 */

import type {
  OperationContext, DatabaseConnection, RateLimiter, RbacEngine,
  Permission, RoleId,
} from '../../kernel/interfaces/index.js';
import type { RolesApi } from '../interfaces/api.js';
import { unwrapResult } from '../errors/limen_error.js';
import { requirePermission } from '../enforcement/rbac_guard.js';
import { requireRateLimit } from '../enforcement/rate_guard.js';

// ============================================================================
// RolesApiImpl
// ============================================================================

/**
 * §34: RBAC administration API implementation.
 */
export class RolesApiImpl implements RolesApi {
  constructor(
    private readonly rbac: RbacEngine,
    private readonly rateLimiter: RateLimiter,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getContext: () => OperationContext,
  ) {}

  /**
   * §34: Create a custom role with specified permissions.
   * Permission: 'manage_roles'
   */
  async create(name: string, permissions: readonly Permission[]): Promise<string> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'manage_roles');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // Delegate to kernel RBAC engine
    const result = this.rbac.createRole(conn, ctx, name, [...permissions]);
    const roleId: RoleId = unwrapResult(result);
    return roleId;
  }

  /**
   * §34: Assign role to a user or agent.
   * Permission: 'manage_roles'
   */
  async assign(
    principalType: 'user' | 'agent',
    principalId: string,
    roleId: string,
  ): Promise<void> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'manage_roles');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const result = this.rbac.assignRole(conn, ctx, principalType, principalId, roleId as RoleId);
    unwrapResult(result);
  }

  /**
   * §34: Revoke role from a user or agent.
   * Permission: 'manage_roles'
   */
  async revoke(
    principalType: 'user' | 'agent',
    principalId: string,
    roleId: string,
  ): Promise<void> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'manage_roles');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const result = this.rbac.revokeRole(conn, ctx, principalType, principalId, roleId as RoleId);
    unwrapResult(result);
  }
}
