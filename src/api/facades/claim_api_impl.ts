/**
 * ClaimApiImpl — Consumer-facing convenience wrapper for CCP system calls.
 *
 * Sprint 7: Bridge to Claude Code
 * Phase 3: Access tracking wired after query/search (Decision 5, I-P3-05).
 *
 * Follows AgentApiImpl pattern (src/api/agents/agent_api.ts):
 *   Constructor receives getConnection/getContext closures.
 *   Each method calls them internally before delegating to RawClaimFacade.
 *
 * This eliminates the need for consumers to construct DatabaseConnection
 * and OperationContext — internal kernel types they cannot access.
 *
 * Security: RawClaimFacade still enforces RBAC + rate limiting (DC-P4-404).
 * Invariants: I-13 (authorization), I-17 (governance boundary), I-P3-05 (access tracking scope).
 */

import type { TenantScopedConnection } from '../../kernel/tenant/tenant_scope.js';
import type { OperationContext, Result } from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  ClaimCreateInput, AssertClaimOutput,
  RelationshipCreateInput, RelateClaimsOutput,
  ClaimQueryInput, ClaimQueryResult,
  RetractClaimInput,
  SearchClaimInput, SearchClaimResult,
} from '../../claims/interfaces/claim_types.js';
import type { ClaimApi } from '../interfaces/api.js';
import type { RawClaimFacade } from './claim_facade.js';
import type { AccessTracker, ClaimAccessEntry } from '../../cognitive/access_tracker.js';

export class ClaimApiImpl implements ClaimApi {
  constructor(
    private readonly raw: RawClaimFacade,
    private readonly getConnection: () => TenantScopedConnection,
    private readonly getContext: () => OperationContext,
    private readonly accessTracker?: AccessTracker,
    private readonly time?: TimeProvider,
  ) {}

  assertClaim(input: ClaimCreateInput): Result<AssertClaimOutput> {
    return this.raw.assertClaim(this.getConnection(), this.getContext(), input);
  }

  relateClaims(input: RelationshipCreateInput): Result<RelateClaimsOutput> {
    return this.raw.relateClaims(this.getConnection(), this.getContext(), input);
  }

  queryClaims(input: ClaimQueryInput): Result<ClaimQueryResult> {
    const result = this.raw.queryClaims(this.getConnection(), this.getContext(), input);
    // Phase 3 (I-P3-05): Record access for RETURNED claims (not filtered-out claims)
    // F-R1-002 FIX: Pass ClaimAccessEntry[] with tenantId for tenant-scoped flush.
    if (result.ok && this.accessTracker && this.time) {
      const tenantId = this.getContext().tenantId;
      const entries: ClaimAccessEntry[] = result.value.claims.map(item => ({
        id: item.claim.id as string,
        tenantId,
      }));
      if (entries.length > 0) {
        this.accessTracker.recordAccess(entries, this.time.nowISO());
      }
    }
    return result;
  }

  retractClaim(input: RetractClaimInput): Result<void> {
    return this.raw.retractClaim(this.getConnection(), this.getContext(), input);
  }

  searchClaims(input: SearchClaimInput): Result<SearchClaimResult> {
    const result = this.raw.searchClaims(this.getConnection(), this.getContext(), input);
    // Phase 3 (I-P3-05): Record access for RETURNED claims
    // F-R1-002 FIX: Pass ClaimAccessEntry[] with tenantId for tenant-scoped flush.
    if (result.ok && this.accessTracker && this.time) {
      const tenantId = this.getContext().tenantId;
      const entries: ClaimAccessEntry[] = result.value.results.map(item => ({
        id: item.claim.id as string,
        tenantId,
      }));
      if (entries.length > 0) {
        this.accessTracker.recordAccess(entries, this.time.nowISO());
      }
    }
    return result;
  }
}
