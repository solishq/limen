/**
 * ClaimApiImpl — Consumer-facing convenience wrapper for CCP system calls.
 *
 * Sprint 7: Bridge to Claude Code
 * Follows AgentApiImpl pattern (src/api/agents/agent_api.ts):
 *   Constructor receives getConnection/getContext closures.
 *   Each method calls them internally before delegating to RawClaimFacade.
 *
 * This eliminates the need for consumers to construct DatabaseConnection
 * and OperationContext — internal kernel types they cannot access.
 *
 * Security: RawClaimFacade still enforces RBAC + rate limiting (DC-P4-404).
 * Invariants: I-13 (authorization), I-17 (governance boundary).
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { OperationContext, Result } from '../../kernel/interfaces/index.js';
import type {
  ClaimCreateInput, AssertClaimOutput,
  RelationshipCreateInput, RelateClaimsOutput,
  ClaimQueryInput, ClaimQueryResult,
  RetractClaimInput,
} from '../../claims/interfaces/claim_types.js';
import type { ClaimApi } from '../interfaces/api.js';
import type { RawClaimFacade } from './claim_facade.js';

export class ClaimApiImpl implements ClaimApi {
  constructor(
    private readonly raw: RawClaimFacade,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getContext: () => OperationContext,
  ) {}

  assertClaim(input: ClaimCreateInput): Result<AssertClaimOutput> {
    return this.raw.assertClaim(this.getConnection(), this.getContext(), input);
  }

  relateClaims(input: RelationshipCreateInput): Result<RelateClaimsOutput> {
    return this.raw.relateClaims(this.getConnection(), this.getContext(), input);
  }

  queryClaims(input: ClaimQueryInput): Result<ClaimQueryResult> {
    return this.raw.queryClaims(this.getConnection(), this.getContext(), input);
  }

  retractClaim(input: RetractClaimInput): Result<void> {
    return this.raw.retractClaim(this.getConnection(), this.getContext(), input);
  }
}
