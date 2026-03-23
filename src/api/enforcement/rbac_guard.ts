/**
 * RBAC enforcement guard for the API surface.
 * S ref: §34 (RBAC), I-13 (authorization completeness), SD-14 (RBAC before rate limit),
 *        FPD-5 (RBAC -> Rate Limit -> Execute ordering)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 3
 *
 * Every public method on the Limen object calls requirePermission() before
 * delegating to orchestration. In single-user mode (RBAC dormant per §3.7),
 * all checks pass immediately. In multi-tenant mode, the kernel's RbacEngine
 * validates the permission against the OperationContext.
 *
 * Invariants enforced: I-13 (authorization completeness)
 * Failure modes defended: FM-10 (tenant data leakage via unauthorized access)
 */

import type {
  OperationContext, Permission, RbacEngine, Result,
} from '../../kernel/interfaces/index.js';
import { LimenError } from '../errors/limen_error.js';

/**
 * I-13, §34: Require a specific permission for the current operation.
 *
 * This function MUST be called before every delegation to orchestration.
 * It enforces the RBAC boundary at the API surface.
 *
 * In single-user mode (RBAC dormant), the kernel's RbacEngine.checkPermission()
 * always returns true, so this function passes through immediately.
 *
 * FPD-5: This runs BEFORE rate limiting. Unauthorized callers must not
 * consume rate limit tokens.
 *
 * @param rbac - The kernel's RbacEngine instance
 * @param ctx - The operation context with identity and permissions
 * @param required - The permission required for this operation
 * @throws LimenError with code UNAUTHORIZED if permission is denied
 */
export function requirePermission(
  rbac: RbacEngine,
  ctx: OperationContext,
  required: Permission,
): void {
  const result: Result<boolean> = rbac.checkPermission(ctx, required);

  if (!result.ok) {
    // S39 IP-4: Internal RBAC errors map to UNAUTHORIZED
    // Do not expose why the check failed (could leak permission structure)
    throw new LimenError('UNAUTHORIZED', 'Insufficient permissions for this operation.');
  }

  if (!result.value) {
    throw new LimenError('UNAUTHORIZED', 'Insufficient permissions for this operation.');
  }
}

/**
 * I-13, §34: Build an OperationContext from session state.
 *
 * This is the standard way to construct the identity context that flows
 * through the kernel and orchestration layers. Every API call needs one.
 *
 * In single-user mode: tenantId is null, userId is null, permissions is the
 * full set (RBAC dormant per §3.7).
 *
 * In multi-tenant mode: tenantId and userId come from the session,
 * permissions come from the RBAC engine's role resolution.
 *
 * @param tenantId - Tenant identifier (null in single-user mode)
 * @param userId - User identifier (null for system operations)
 * @param agentId - Agent identifier (null if no agent context)
 * @param permissions - Resolved permission set for this principal
 * @param sessionId - Session identifier (optional)
 */
export function buildOperationContext(
  tenantId: import('../../kernel/interfaces/index.js').TenantId | null,
  userId: import('../../kernel/interfaces/index.js').UserId | null,
  agentId: import('../../kernel/interfaces/index.js').AgentId | null,
  permissions: ReadonlySet<Permission>,
  sessionId?: import('../../kernel/interfaces/index.js').SessionId,
): OperationContext {
  const ctx: OperationContext = {
    tenantId,
    userId,
    agentId,
    permissions,
  };

  // OperationContext.sessionId is optional per the interface
  if (sessionId !== undefined) {
    return { ...ctx, sessionId };
  }

  return ctx;
}
