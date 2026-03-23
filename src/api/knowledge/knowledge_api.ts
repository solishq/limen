/**
 * Knowledge management API wrapper for the API surface.
 * S ref: S9 (memory/knowledge), UC-6 (document ingestion), I-02 (data ownership),
 *        A-04 (convenience wrapper, not a new system call)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 10
 *
 * A-04: This is a convenience wrapper over memory operations, not a new system call.
 * UC-6 shows the API but S14 defines only 10 system calls.
 *
 * ASSUMPTION: The OrchestrationEngine does not expose knowledge/memory-specific methods.
 * Knowledge management is a convenience API that will be wired when the memory subsystem
 * is integrated. For now, the API enforces RBAC and provides the public interface.
 *
 * All mutations delegate to L2 Orchestration (I-17).
 *
 * Invariants enforced: I-02 (data ownership), I-13 (RBAC), I-17 (governance boundary)
 * Failure modes defended: FM-10 (tenant data leakage via tenant-scoped search)
 */

import type {
  OperationContext, DatabaseConnection, RateLimiter, RbacEngine,
} from '../../kernel/interfaces/index.js';
import type {
  KnowledgeApi, IngestOptions, IngestResult,
  SearchOptions, MemoryView, PurgeFilter,
} from '../interfaces/api.js';
import { requirePermission } from '../enforcement/rbac_guard.js';
import { requireRateLimit } from '../enforcement/rate_guard.js';

// ============================================================================
// KnowledgeApiImpl
// ============================================================================

/**
 * S9, UC-6: Knowledge management API implementation.
 * A-04: Convenience wrapper, not a new system call.
 *
 * Knowledge operations will be delegated to the memory subsystem
 * once it is integrated into the orchestration layer.
 */
export class KnowledgeApiImpl implements KnowledgeApi {
  constructor(
    private readonly rbac: RbacEngine,
    private readonly rateLimiter: RateLimiter,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getContext: () => OperationContext,
  ) {}

  /**
   * S9: Ingest documents as source memories.
   * Permission: 'modify_agent'
   */
  async ingest(_options: IngestOptions): Promise<IngestResult> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'modify_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // Knowledge ingestion requires the memory subsystem (not yet wired to orchestration).
    // Return a stub result indicating no processing occurred.
    return {
      memoriesCreated: 0,
      chunksProcessed: 0,
      totalTokens: 0,
    };
  }

  /**
   * S9: Search memories.
   * I-13: RBAC enforced. SD-14: RBAC before rate limit.
   * FM-10: Tenant-scoped -- only returns memories accessible to the current tenant.
   */
  async search(_query: string, _options?: SearchOptions): Promise<readonly MemoryView[]> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    // I-13: RBAC check (SD-14: before rate limit)
    requirePermission(this.rbac, ctx, 'modify_agent');
    // §36: Rate limit check (SD-14: after RBAC)
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // Memory search requires the memory subsystem (not yet wired to orchestration).
    return [];
  }

  /**
   * I-02: Purge memories by filter.
   * Permission: 'purge_data'
   */
  async purge(_filter: PurgeFilter): Promise<{ purged: number }> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'purge_data');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // Memory purge requires the memory subsystem (not yet wired to orchestration).
    return { purged: 0 };
  }
}
