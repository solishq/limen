/**
 * Rate limiter implementation.
 * S ref: §36
 *
 * Phase: 1 (Kernel) -- Build Order 6
 * Token-bucket rate limiting per tenant/agent.
 *
 * §36: Rate limiting for API calls, event emission, and propose rejections.
 *      Per-agent rate limits with configurable buckets.
 *
 * Defaults (§36):
 * - api_calls: 100/minute per agent
 * - emit_event: 10/minute per agent
 * - propose_rejections: max 10 per checkpoint period
 */

import { randomUUID } from 'node:crypto';
import type {
  Result, OperationContext,
  RateLimiter, RateLimitStatus, BucketType,
  DatabaseConnection,
} from '../interfaces/index.js';
import type { TimeProvider } from '../interfaces/time.js';

/**
 * Default rate limit configurations per §36.
 * S ref: §36 (rate limit defaults)
 */
const DEFAULT_LIMITS: Record<BucketType, { maxTokens: number; refillRate: number }> = {
  api_calls: { maxTokens: 100, refillRate: 100 / 60 },       // 100/min
  emit_event: { maxTokens: 10, refillRate: 10 / 60 },         // 10/min
  propose_rejections: { maxTokens: 10, refillRate: 10 / 60 },  // 10/period
};

/**
 * Create a RateLimiter implementation.
 * S ref: §36 (token-bucket rate limiting)
 */
export function createRateLimiter(time?: TimeProvider): RateLimiter {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  return {
    /**
     * Check if operation is allowed under rate limit. Consumes a token if allowed.
     * Uses token-bucket algorithm: tokens refill continuously at refillRate tokens/second.
     * S ref: §36 (token-bucket rate limiting)
     */
    checkAndConsume(conn: DatabaseConnection, ctx: OperationContext, bucketType: BucketType): Result<boolean> {
      try {
        const tenantId = ctx.tenantId;
        const agentId = ctx.agentId;

        // Get or create bucket
        let bucket = conn.get<{
          id: string; current_tokens: number; max_tokens: number;
          refill_rate: number; last_refill_at: string;
        }>(
          `SELECT id, current_tokens, max_tokens, refill_rate, last_refill_at
           FROM meter_rate_limits
           WHERE bucket_type = ?
           AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))
           AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
          [bucketType, tenantId, tenantId, agentId, agentId]
        );

        if (!bucket) {
          // Create bucket with defaults
          const defaults = DEFAULT_LIMITS[bucketType];
          const id = randomUUID();
          conn.run(
            `INSERT INTO meter_rate_limits (id, tenant_id, agent_id, bucket_type, max_tokens, refill_rate, current_tokens, last_refill_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
            [id, tenantId, agentId, bucketType, defaults.maxTokens, defaults.refillRate, defaults.maxTokens]
          );
          bucket = {
            id,
            current_tokens: defaults.maxTokens,
            max_tokens: defaults.maxTokens,
            refill_rate: defaults.refillRate,
            last_refill_at: clock.nowISO(),
          };
        }

        // Calculate token refill since last check
        const now = clock.nowMs();
        const lastRefill = new Date(bucket.last_refill_at).getTime();
        const elapsedSeconds = (now - lastRefill) / 1000;
        const refilled = elapsedSeconds * bucket.refill_rate;
        const newTokens = Math.min(bucket.max_tokens, bucket.current_tokens + refilled);

        if (newTokens < 1) {
          // Rate limited -- not enough tokens
          // Update refill time even when denied to avoid stale timestamp
          conn.run(
            `UPDATE meter_rate_limits SET current_tokens = ?, last_refill_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?`,
            [newTokens, bucket.id]
          );
          return { ok: true, value: false };
        }

        // Consume one token
        conn.run(
          `UPDATE meter_rate_limits SET current_tokens = ?, last_refill_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`,
          [newTokens - 1, bucket.id]
        );

        return { ok: true, value: true };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'RATE_LIMIT_CHECK_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§36',
          },
        };
      }
    },

    /**
     * Get current rate limit status for an agent.
     * S ref: §36 (rate limit status inspection)
     */
    getStatus(conn: DatabaseConnection, ctx: OperationContext, bucketType: BucketType): Result<RateLimitStatus> {
      try {
        const tenantId = ctx.tenantId;
        const agentId = ctx.agentId;

        const bucket = conn.get<{
          current_tokens: number; max_tokens: number;
          refill_rate: number; last_refill_at: string;
        }>(
          `SELECT current_tokens, max_tokens, refill_rate, last_refill_at
           FROM meter_rate_limits
           WHERE bucket_type = ?
           AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))
           AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
          [bucketType, tenantId, tenantId, agentId, agentId]
        );

        if (!bucket) {
          // No bucket exists -- return defaults (fully available)
          const defaults = DEFAULT_LIMITS[bucketType];
          return {
            ok: true,
            value: {
              currentTokens: defaults.maxTokens,
              maxTokens: defaults.maxTokens,
              refillRate: defaults.refillRate,
              lastRefillAt: clock.nowISO(),
            },
          };
        }

        // Calculate current tokens with refill
        const now = clock.nowMs();
        const lastRefill = new Date(bucket.last_refill_at).getTime();
        const elapsedSeconds = (now - lastRefill) / 1000;
        const refilled = elapsedSeconds * bucket.refill_rate;
        const currentTokens = Math.min(bucket.max_tokens, bucket.current_tokens + refilled);

        return {
          ok: true,
          value: {
            currentTokens,
            maxTokens: bucket.max_tokens,
            refillRate: bucket.refill_rate,
            lastRefillAt: bucket.last_refill_at,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'RATE_LIMIT_STATUS_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: '§36',
          },
        };
      }
    },
  };
}
