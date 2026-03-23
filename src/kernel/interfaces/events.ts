/**
 * Event bus interface types.
 * S ref: RDD-4, §10, IP-6
 *
 * Phase: 1 (Kernel)
 * Implements: Synchronous in-process event dispatch with webhook support.
 *
 * RDD-4: Event bus dispatch is synchronous in-process.
 * §10: Event propagation through mission trees (up/down/local).
 * IP-6: Webhook delivery with at-least-once semantics, max 3 retries.
 */

import type { Result, MissionId, EventId, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── Event Types ───

/** §10: Event scoping */
export type EventScope = 'system' | 'mission' | 'task';

/** §10: Event propagation direction */
export type Propagation = 'up' | 'down' | 'local';

/**
 * Event payload for emission.
 * S ref: §10 (event structure), RDD-4 (synchronous dispatch)
 */
export interface EventPayload {
  readonly type: string;                      // structured namespace: 'mission.created', 'task.failed'
  readonly scope: EventScope;
  readonly missionId?: MissionId;
  readonly payload: Record<string, unknown>;
  readonly propagation: Propagation;
}

/**
 * Event handler callback.
 * S ref: RDD-4 (synchronous handler invocation)
 */
export type EventHandler = (event: EventPayload) => void;

// ─── Event Bus Interface ───

/**
 * In-process event bus with persistent event storage and webhook delivery.
 * S ref: RDD-4 (synchronous dispatch), §10 (event propagation),
 *        IP-6 (webhook delivery)
 */
export interface EventBus {
  /**
   * Emit event. Synchronous in-process dispatch per RDD-4.
   * Persists event to obs_events for replay and webhook delivery.
   * S ref: RDD-4 (synchronous dispatch), §10 (event propagation)
   */
  emit(conn: DatabaseConnection, ctx: OperationContext, event: EventPayload): Result<EventId>;

  /**
   * Subscribe to events matching pattern. Returns subscription ID.
   * Pattern uses glob syntax: 'mission.*', 'task.failed', '*'.
   * S ref: RDD-4 (subscription registry)
   */
  subscribe(pattern: string, handler: EventHandler): Result<string>;

  /**
   * Unsubscribe by subscription ID.
   * S ref: RDD-4 (subscription lifecycle)
   */
  unsubscribe(subscriptionId: string): Result<void>;

  /**
   * Register webhook endpoint for external consumers.
   * S ref: IP-6 (webhook delivery with HMAC-SHA256 signing)
   */
  registerWebhook(conn: DatabaseConnection, ctx: OperationContext, pattern: string, url: string, secret: string): Result<string>;

  /**
   * Process pending webhook deliveries (retry logic).
   * At-least-once delivery with exponential backoff, max 3 attempts.
   * S ref: IP-6 (at-least-once, retry with exponential backoff max 3)
   */
  processWebhooks(conn: DatabaseConnection): Result<{ delivered: number; failed: number; exhausted: number }>;
}
