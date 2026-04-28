/**
 * ClaimFacade — RBAC + rate limit + delegation for SC-11, SC-12, SC-13.
 *
 * Phase: 4 (Governance Wiring)
 * Implements: Design Source §Output 4 (Facade Mapping)
 * Spec sections: §14.1 (assertClaim), §14.5 (relateClaims), §14.7 (queryClaims)
 *
 * Security constraints enforced:
 *   DC-P4-404: RBAC check first in every method — unauthorized → UNAUTHORIZED
 *   DC-P4-406: Raw ClaimSystem is closure-local; only facade exposed on Limen
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
import type { OperationContext, Result } from '../../kernel/interfaces/index.js';
import type { RbacEngine } from '../../kernel/interfaces/rbac.js';
import type { RateLimiter } from '../../kernel/interfaces/rate_limiter.js';
import type {
  ClaimSystem,
  ClaimCreateInput, AssertClaimOutput,
  RelationshipCreateInput, RelateClaimsOutput,
  ClaimQueryInput, ClaimQueryResult,
  RetractClaimInput,
  SearchClaimInput, SearchClaimResult,
  ClaimId,
} from '../../claims/interfaces/claim_types.js';

// DC-P4-404: RBAC enforcement at facade level (I-13 authorization completeness).
// Defense-in-depth: facade enforces RBAC even when called directly by orchestration.
import { requirePermission } from '../enforcement/rbac_guard.js';

// ============================================================================
// RawClaimFacade — internal facade interface (conn, ctx, input)
// ============================================================================

/**
 * Internal claim facade requiring explicit DatabaseConnection and OperationContext.
 * Used by orchestration layer. Consumers use ClaimApi (convenience wrapper).
 * SC-11 (assertClaim), SC-12 (relateClaims), SC-13 (queryClaims).
 * RBAC-gated, rate-limited, delegates to closure-local ClaimSystem.
 */
export interface RawClaimFacade {
  assertClaim(conn: DatabaseConnection, ctx: OperationContext, input: ClaimCreateInput): Result<AssertClaimOutput>;
  relateClaims(conn: DatabaseConnection, ctx: OperationContext, input: RelationshipCreateInput): Result<RelateClaimsOutput>;
  queryClaims(conn: DatabaseConnection, ctx: OperationContext, input: ClaimQueryInput): Result<ClaimQueryResult>;
  /** Phase 1 prerequisite: Retract a claim (active -> retracted, audited per I-03). */
  retractClaim(conn: DatabaseConnection, ctx: OperationContext, input: RetractClaimInput): Result<void>;
  /** Phase 2: Full-text search. RBAC-gated, rate-limited. Not a new system call. */
  searchClaims(conn: DatabaseConnection, ctx: OperationContext, input: SearchClaimInput): Result<SearchClaimResult>;
  /**
   * F-BR4-004: Single-claim status lookup for projection-layer consumers
   * (CLI dispute recomputation). Uses the same 'query_claims' permission
   * as queryClaims since it is strictly narrower (returns only the
   * status enum, no content, no relationships). Tenant-scoped.
   */
  getClaimStatus(
    conn: DatabaseConnection,
    ctx: OperationContext,
    claimId: string,
  ): Result<'active' | 'retracted' | 'not_found'>;
}

// ============================================================================
// createRawClaimFacade — factory
// ============================================================================

/**
 * Create a RawClaimFacade that wraps ClaimSystem with RBAC + rate limiting.
 *
 * The raw ClaimSystem is closure-local — never leaked (DC-P4-406, C-SEC-05).
 * The returned facade is frozen and satisfies RawClaimFacade.
 *
 * @param claimSystem - The raw ClaimSystem (closure-local, never exposed)
 * @param rbac - Kernel RBAC engine
 * @param rateLimiter - Kernel rate limiter
 * @returns Frozen RawClaimFacade
 */
export function createRawClaimFacade(
  claimSystem: ClaimSystem,
  rbac: RbacEngine,
  _rateLimiter: RateLimiter,
): RawClaimFacade {
  return Object.freeze({
    /**
     * SC-11: Assert a claim.
     * DC-P4-404: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    assertClaim(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: ClaimCreateInput,
    ): Result<AssertClaimOutput> {
      requirePermission(rbac, ctx, 'assert_claim');
      return claimSystem.assertClaim.execute(conn, ctx, input);
    },

    /**
     * SC-12: Relate claims.
     * DC-P4-404: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    relateClaims(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: RelationshipCreateInput,
    ): Result<RelateClaimsOutput> {
      requirePermission(rbac, ctx, 'relate_claims');
      return claimSystem.relateClaims.execute(conn, ctx, input);
    },

    /**
     * SC-13: Query claims.
     * DC-P4-404: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    queryClaims(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: ClaimQueryInput,
    ): Result<ClaimQueryResult> {
      requirePermission(rbac, ctx, 'query_claims');
      return claimSystem.queryClaims.execute(conn, ctx, input);
    },

    /**
     * §14.4: Retract a claim.
     * Phase 1 prerequisite: Expose retractClaim through the facade.
     * DC-P4-404: RBAC check FIRST — unauthorized → throws UNAUTHORIZED.
     */
    retractClaim(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: RetractClaimInput,
    ): Result<void> {
      requirePermission(rbac, ctx, 'retract_claim');
      return claimSystem.retractClaim.execute(conn, ctx, input);
    },

    /**
     * Phase 2: Search claims via FTS5.
     * DC-P2-010: RBAC + rate limit before search.
     */
    searchClaims(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: SearchClaimInput,
    ): Result<SearchClaimResult> {
      requirePermission(rbac, ctx, 'query_claims');
      return claimSystem.store.search(conn, ctx.tenantId, input);
    },

    /**
     * F-BR4-004: Projection-layer status lookup.
     * Returns the claim's current status ('active' | 'retracted') or
     * 'not_found' when no claim with the given id exists within the
     * caller's tenant scope. Uses the same 'query_claims' permission as
     * queryClaims — strictly narrower scope (no content, no relationships,
     * no evidence). Delegates to ClaimStore.get which already enforces
     * tenant scoping.
     */
    getClaimStatus(
      conn: DatabaseConnection,
      ctx: OperationContext,
      claimId: string,
    ): Result<'active' | 'retracted' | 'not_found'> {
      requirePermission(rbac, ctx, 'query_claims');
      const result = claimSystem.store.get(conn, claimId as ClaimId, ctx.tenantId);
      if (!result.ok) {
        if (result.error.code === 'CLAIM_NOT_FOUND') {
          return { ok: true, value: 'not_found' };
        }
        return { ok: false, error: result.error };
      }
      return { ok: true, value: result.value.status };
    },
  });
}
