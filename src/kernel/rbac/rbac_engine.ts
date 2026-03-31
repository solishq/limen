/**
 * RBAC engine implementation.
 * S ref: §34, I-13, §3.7
 *
 * Phase: 1 (Kernel) -- Build Order 6
 * Required by all API-facing modules.
 *
 * §34: RBAC with five default roles (admin, developer, operator, viewer, auditor).
 * I-13: Authorization completeness -- every operation enforces RBAC.
 * §3.7: Single-user default mode where RBAC is dormant.
 */

import { randomUUID } from 'node:crypto';
import type {
  Result, Permission, RoleId, TenantId, OperationContext,
  RbacEngine, DatabaseConnection,
} from '../interfaces/index.js';

/**
 * Default role definitions per §34.
 * S ref: §34 (five default roles with predefined permission sets)
 */
const DEFAULT_ROLES: ReadonlyArray<{
  name: string;
  permissions: readonly Permission[];
}> = [
  {
    name: 'admin',
    permissions: [
      'create_agent', 'modify_agent', 'delete_agent',
      'chat', 'infer', 'create_mission',
      'view_telemetry', 'view_audit',
      'manage_providers', 'manage_budgets', 'manage_roles',
      'purge_data',
      'approve_response', 'edit_response', 'takeover_session', 'review_batch',
    ],
  },
  {
    name: 'developer',
    permissions: [
      'create_agent', 'modify_agent',
      'chat', 'infer', 'create_mission',
      'view_telemetry',
    ],
  },
  {
    name: 'operator',
    permissions: [
      'chat',
      'view_telemetry',
      'manage_providers', 'manage_budgets',
    ],
  },
  {
    name: 'viewer',
    permissions: [
      'chat',
      'view_telemetry',
    ],
  },
  {
    name: 'auditor',
    permissions: [
      'view_audit',
      'view_telemetry',
    ],
  },
];

/**
 * Create an RbacEngine implementation.
 * CF-006: Accepts optional conn to restore RBAC active state from DB on restart.
 * If custom roles exist (is_default=0), RBAC activates immediately.
 * S ref: §34 (RBAC), I-13 (authorization completeness), §3.7 (dormant mode)
 */
export function createRbacEngine(conn?: DatabaseConnection, forceActive?: boolean): RbacEngine {
  /** RBAC active state. Starts dormant (single-user default). S ref: §3.7. */
  let rbacActive = false;

  // Phase 4 §4.5, C.8: When forceActive (requireRbac=true), RBAC is active immediately.
  // I-P4-10: Default false. I-P4-11: When true, enforces.
  if (forceActive) {
    rbacActive = true;
  }

  // CF-006: Restore active state from DB if custom roles exist.
  // Without this, a restart after role creation leaves RBAC dormant,
  // bypassing all permission checks until a new custom role is created.
  if (!rbacActive && conn) {
    const customRoleCount = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_roles WHERE is_default = 0'
    );
    if (customRoleCount && customRoleCount.cnt > 0) {
      rbacActive = true;
    }
  }

  return {
    /**
     * Check if context has required permission.
     * In dormant mode (single-user), always returns true.
     * S ref: §34 (permission check), I-13 (every operation enforces RBAC)
     */
    checkPermission(ctx: OperationContext, required: Permission): Result<boolean> {
      try {
        // §3.7: In single-user mode, RBAC is dormant -- all operations allowed
        if (!rbacActive) {
          return { ok: true, value: true };
        }

        // I-13: Check if context has the required permission
        const hasPermission = ctx.permissions.has(required);
        return { ok: true, value: hasPermission };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'RBAC_CHECK_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-13',
          },
        };
      }
    },

    /**
     * Check if RBAC is currently active.
     * S ref: §3.7 (single-user mode), §34 (multi-user activation)
     */
    isActive(): boolean {
      return rbacActive;
    },

    /**
     * Create a role with the specified permissions.
     * Activates RBAC if not already active.
     * S ref: §34 (role management)
     */
    createRole(conn: DatabaseConnection, ctx: OperationContext, name: string, permissions: Permission[]): Result<RoleId> {
      try {
        const roleId = randomUUID() as RoleId;
        const tenantId = ctx.tenantId;

        conn.run(
          `INSERT INTO core_roles (id, tenant_id, name, permissions, is_default, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          [roleId, tenantId, name, JSON.stringify(permissions)]
        );

        // Activate RBAC when first non-default role is created
        rbacActive = true;

        return { ok: true, value: roleId };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'ROLE_CREATE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§34',
          },
        };
      }
    },

    /**
     * Assign role to principal (user or agent).
     * S ref: §34 (role assignment), DL-3 (trust progression)
     */
    assignRole(conn: DatabaseConnection, ctx: OperationContext, principalType: 'user' | 'agent', principalId: string, roleId: RoleId): Result<void> {
      try {
        // Verify role exists
        const role = conn.get<{ id: string }>(
          `SELECT id FROM core_roles WHERE id = ?`,
          [roleId]
        );

        if (!role) {
          return {
            ok: false,
            error: {
              code: 'ROLE_NOT_FOUND',
              message: `Role ${roleId} not found`,
              spec: '§34',
            },
          };
        }

        const id = randomUUID();
        const tenantId = ctx.tenantId;
        const grantedBy = ctx.userId ?? ctx.agentId ?? 'system';

        conn.run(
          `INSERT INTO core_role_assignments (id, tenant_id, principal_type, principal_id, role_id, granted_by, granted_at)
           VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT(tenant_id, principal_type, principal_id, role_id) DO NOTHING`,
          [id, tenantId, principalType, principalId, roleId, grantedBy]
        );

        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'ROLE_ASSIGN_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§34',
          },
        };
      }
    },

    /**
     * Revoke role from principal.
     * S ref: §34 (role revocation)
     */
    revokeRole(conn: DatabaseConnection, ctx: OperationContext, principalType: 'user' | 'agent', principalId: string, roleId: RoleId): Result<void> {
      try {
        const tenantId = ctx.tenantId;

        conn.run(
          `DELETE FROM core_role_assignments
           WHERE principal_type = ? AND principal_id = ? AND role_id = ?
           AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))`,
          [principalType, principalId, roleId, tenantId, tenantId]
        );

        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'ROLE_REVOKE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§34',
          },
        };
      }
    },

    /**
     * Get permissions for a principal.
     * Returns the union of all permissions from all assigned roles.
     * S ref: §34 (permission resolution)
     */
    getPermissions(conn: DatabaseConnection, principalType: 'user' | 'agent', principalId: string, tenantId: TenantId | null): Result<ReadonlySet<Permission>> {
      try {
        const rows = conn.query<{ permissions: string }>(
          `SELECT r.permissions FROM core_roles r
           INNER JOIN core_role_assignments ra ON ra.role_id = r.id
           WHERE ra.principal_type = ? AND ra.principal_id = ?
           AND (ra.tenant_id = ? OR (ra.tenant_id IS NULL AND ? IS NULL))
           AND (ra.expires_at IS NULL OR ra.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          [principalType, principalId, tenantId, tenantId]
        );

        const permissionSet = new Set<Permission>();
        for (const row of rows) {
          const perms = JSON.parse(row.permissions) as Permission[];
          for (const p of perms) {
            permissionSet.add(p);
          }
        }

        return { ok: true, value: permissionSet };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'PERMISSIONS_FETCH_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§34',
          },
        };
      }
    },

    /**
     * Seed default roles (admin, developer, operator, viewer, auditor).
     * S ref: §34 (five default roles with predefined permission sets)
     */
    seedDefaultRoles(conn: DatabaseConnection): Result<void> {
      try {
        for (const role of DEFAULT_ROLES) {
          const roleId = randomUUID();
          conn.run(
            `INSERT INTO core_roles (id, tenant_id, name, permissions, is_default, version, created_at, updated_at)
             VALUES (?, NULL, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(tenant_id, name) DO NOTHING`,
            [roleId, role.name, JSON.stringify(role.permissions)]
          );
        }

        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'SEED_ROLES_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§34',
          },
        };
      }
    },
  };
}
