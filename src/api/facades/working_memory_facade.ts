/**
 * WorkingMemoryFacade — RBAC + rate limit + delegation for SC-14, SC-15, SC-16.
 *
 * Phase: 4 (Governance Wiring)
 * Implements: Design Source §Output 4 (Facade Mapping)
 * Spec sections: §WMP 5.2 (write), §WMP 5.3 (read), §WMP 5.4 (discard)
 *
 * Security constraints enforced:
 *   DC-P4-405: RBAC check first in every method — unauthorized → UNAUTHORIZED
 *   DC-P4-406: Raw WorkingMemorySystem is closure-local; only facade exposed on Limen
 *   C-SEC-05: Facade-only exposure — raw system never on Limen object
 *
 * Pattern: Follows MissionApiImpl (src/api/missions/mission_api.ts):
 *   1. requirePermission (RBAC)
 *   2. requireRateLimit
 *   3. Delegate to underlying system
 *
 * Invariants enforced: I-13 (authorization completeness), I-17 (governance boundary)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { OperationContext, AgentId, Result } from '../../kernel/interfaces/index.js';
import type { RbacEngine } from '../../kernel/interfaces/rbac.js';
import type { RateLimiter } from '../../kernel/interfaces/rate_limiter.js';
import type {
  WorkingMemorySystem,
  WriteWorkingMemoryInput, WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput, ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput, DiscardWorkingMemoryOutput,
} from '../../working-memory/interfaces/wmp_types.js';

import { requirePermission } from '../enforcement/rbac_guard.js';
import { requireRateLimit } from '../enforcement/rate_guard.js';

// ============================================================================
// RawWorkingMemoryFacade — internal facade interface (conn, ctx, input)
// ============================================================================

/**
 * Internal working memory facade requiring explicit DatabaseConnection and OperationContext.
 * Used by orchestration layer. Consumers use WorkingMemoryApi (convenience wrapper).
 * SC-14 (write), SC-15 (read), SC-16 (discard).
 * RBAC-gated, rate-limited, delegates to closure-local WorkingMemorySystem.
 */
export interface RawWorkingMemoryFacade {
  write(conn: DatabaseConnection, ctx: OperationContext, input: WriteWorkingMemoryInput): Result<WriteWorkingMemoryOutput>;
  read(conn: DatabaseConnection, ctx: OperationContext, input: ReadWorkingMemoryInput): Result<ReadWorkingMemoryOutput>;
  discard(conn: DatabaseConnection, ctx: OperationContext, input: DiscardWorkingMemoryInput): Result<DiscardWorkingMemoryOutput>;
}

// ============================================================================
// createRawWorkingMemoryFacade — factory
// ============================================================================

/**
 * Create a RawWorkingMemoryFacade that wraps WorkingMemorySystem with RBAC + rate limiting.
 *
 * The raw WorkingMemorySystem is closure-local — never leaked (DC-P4-406, C-SEC-05).
 * The returned facade is frozen and satisfies RawWorkingMemoryFacade.
 *
 * @param wmpSystem - The raw WorkingMemorySystem (closure-local, never exposed)
 * @param rbac - Kernel RBAC engine
 * @param rateLimiter - Kernel rate limiter
 * @returns Frozen RawWorkingMemoryFacade
 */
export function createRawWorkingMemoryFacade(
  wmpSystem: WorkingMemorySystem,
  rbac: RbacEngine,
  rateLimiter: RateLimiter,
): RawWorkingMemoryFacade {
  return Object.freeze({
    /**
     * SC-14: Write to working memory.
     * DC-P4-405: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    write(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: WriteWorkingMemoryInput,
    ): Result<WriteWorkingMemoryOutput> {
      requirePermission(rbac, ctx, 'create_mission');  // mission-scope permission
      requireRateLimit(rateLimiter, conn, ctx, 'api_calls');

      // WMP handlers take (conn, callerTaskId, callerAgentId, input)
      const callerTaskId = input.taskId;
      const callerAgentId = (ctx.agentId ?? 'system') as AgentId;
      return wmpSystem.write.execute(conn, callerTaskId, callerAgentId, input);
    },

    /**
     * SC-15: Read from working memory.
     * DC-P4-405: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    read(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: ReadWorkingMemoryInput,
    ): Result<ReadWorkingMemoryOutput> {
      requirePermission(rbac, ctx, 'create_mission');
      requireRateLimit(rateLimiter, conn, ctx, 'api_calls');

      const callerTaskId = input.taskId;
      const callerAgentId = (ctx.agentId ?? 'system') as AgentId;
      return wmpSystem.read.execute(conn, callerTaskId, callerAgentId, input);
    },

    /**
     * SC-16: Discard from working memory.
     * DC-P4-405: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    discard(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: DiscardWorkingMemoryInput,
    ): Result<DiscardWorkingMemoryOutput> {
      requirePermission(rbac, ctx, 'create_mission');
      requireRateLimit(rateLimiter, conn, ctx, 'api_calls');

      const callerTaskId = input.taskId;
      const callerAgentId = (ctx.agentId ?? 'system') as AgentId;
      return wmpSystem.discard.execute(conn, callerTaskId, callerAgentId, input);
    },
  });
}
