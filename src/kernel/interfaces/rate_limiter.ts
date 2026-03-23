/**
 * Rate limiter interface types.
 * S ref: §36
 *
 * Phase: 1 (Kernel)
 * Implements: Token-bucket rate limiting per tenant/agent.
 *
 * §36: Rate limiting for API calls, event emission, and propose rejections.
 *      Per-agent rate limits with configurable buckets.
 */

import type { Result, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── Types ───

/** §36: Bucket types for rate limiting */
export type BucketType = 'api_calls' | 'emit_event' | 'propose_rejections';

/**
 * Current rate limit status for an agent.
 * S ref: §36 (rate limit inspection)
 */
export interface RateLimitStatus {
  readonly currentTokens: number;
  readonly maxTokens: number;
  readonly refillRate: number;                // tokens per second
  readonly lastRefillAt: string;
}

// ─── Rate Limiter Interface ───

/**
 * Token-bucket rate limiter.
 * S ref: §36 (per-agent rate limiting)
 */
export interface RateLimiter {
  /**
   * Check if operation is allowed under rate limit. Consumes a token if allowed.
   * Returns true if token consumed, false if rate limited.
   * S ref: §36 (token-bucket rate limiting)
   */
  checkAndConsume(conn: DatabaseConnection, ctx: OperationContext, bucketType: BucketType): Result<boolean>;

  /**
   * Get current rate limit status for an agent.
   * S ref: §36 (rate limit status inspection)
   */
  getStatus(conn: DatabaseConnection, ctx: OperationContext, bucketType: BucketType): Result<RateLimitStatus>;
}
