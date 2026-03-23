/**
 * Rate limit enforcement guard for the API surface.
 * S ref: §36 (rate limiting), SD-14 (RBAC -> Rate Limit -> Execute ordering),
 *        FM-02 (cost explosion defense)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 4
 *
 * After RBAC passes (FPD-5), rate limiting checks the token-bucket
 * before allowing the operation to proceed. The kernel's RateLimiter
 * handles the token-bucket state in SQLite.
 *
 * Three bucket types per §36:
 *   - api_calls: General API call rate (default 100/min)
 *   - emit_event: Event emission rate (default 10/min)
 *   - propose_rejections: Rejection tracking
 *
 * Invariants enforced: I-13 (enforcement ordering via SD-14)
 * Failure modes defended: FM-02 (cost explosion via call frequency capping)
 */

import type {
  OperationContext, RateLimiter, BucketType, DatabaseConnection,
} from '../../kernel/interfaces/index.js';
import { LimenError } from '../errors/limen_error.js';

/**
 * §36, SD-14: Require rate limit allowance for the current operation.
 *
 * This function MUST be called AFTER RBAC check (FPD-5) and BEFORE
 * delegation to orchestration.
 *
 * The kernel's RateLimiter.checkAndConsume() atomically checks and
 * consumes a token from the specified bucket. If no tokens remain,
 * this function throws RATE_LIMITED with cooldownMs indicating when
 * the bucket will refill.
 *
 * @param rateLimiter - The kernel's RateLimiter instance
 * @param conn - Database connection for atomic token-bucket operations
 * @param ctx - The operation context (scopes the bucket to tenant/agent)
 * @param bucketType - Which rate limit bucket to check
 * @throws LimenError with code RATE_LIMITED if bucket is exhausted
 */
export function requireRateLimit(
  rateLimiter: RateLimiter,
  conn: DatabaseConnection,
  ctx: OperationContext,
  bucketType: BucketType,
): void {
  const result = rateLimiter.checkAndConsume(conn, ctx, bucketType);

  if (!result.ok) {
    // Internal rate limiter error. This is an infrastructure issue, not a rate limit.
    // Map to ENGINE_UNHEALTHY to avoid leaking internal errors.
    throw new LimenError('ENGINE_UNHEALTHY', 'Rate limiting subsystem error.');
  }

  if (!result.value) {
    // Token bucket exhausted. Get status for cooldown information.
    const statusResult = rateLimiter.getStatus(conn, ctx, bucketType);

    let cooldownMs: number | undefined;
    if (statusResult.ok) {
      // Calculate approximate time until next token refill
      const { refillRate, maxTokens, currentTokens } = statusResult.value;
      if (refillRate > 0 && currentTokens < maxTokens) {
        // Time for 1 token to refill: 1000ms / refillRate
        cooldownMs = Math.ceil(1000 / refillRate);
      }
    }

    throw new LimenError(
      'RATE_LIMITED',
      'Request rate limit exceeded.',
      // exactOptionalPropertyTypes: only include cooldownMs when it has a value
      cooldownMs !== undefined ? { cooldownMs } : undefined,
    );
  }
}

/**
 * §36: Check concurrent stream count against per-tenant limit.
 *
 * S36 specifies a default of 50 concurrent streams per tenant.
 * This is separate from the token-bucket rate limiter -- it tracks
 * active stream count in memory (not in SQLite).
 *
 * @param activeStreamCount - Current number of active streams for this tenant
 * @param maxConcurrentStreams - Configured maximum (default 50 per S36)
 * @throws LimenError with code RATE_LIMITED if stream limit reached
 */
export function requireStreamCapacity(
  activeStreamCount: number,
  maxConcurrentStreams: number,
): void {
  if (activeStreamCount >= maxConcurrentStreams) {
    throw new LimenError(
      'RATE_LIMITED',
      'Maximum concurrent stream limit reached.',
      { cooldownMs: 1000 },
    );
  }
}
