// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Event bus implementation.
 * S ref: RDD-4, §10, IP-6
 *
 * Phase: 1 (Kernel) -- Build Order 5
 * Required by audit events and all subsequent modules.
 *
 * RDD-4: Synchronous in-process event dispatch.
 * §10: Event propagation through mission trees (up/down/local).
 * IP-6: Webhook delivery with at-least-once semantics, max 3 retries.
 */

import { randomUUID } from 'node:crypto';
import type {
  Result, EventId, OperationContext,
  EventBus, EventPayload, EventHandler,
  EventSubscriptionFilter,
  DatabaseConnection,
} from '../interfaces/index.js';
import type { TimeProvider } from '../interfaces/time.js';

/**
 * In-memory subscription entry.
 * S ref: RDD-4 (synchronous handler registry)
 */
interface Subscription {
  readonly id: string;
  readonly pattern: string;
  readonly handler: EventHandler;
  /** FR-005: Optional payload-level filter for predicate/subject matching. */
  readonly filter?: EventSubscriptionFilter;
  /** Finding-30: Pre-compiled regex for glob patterns. null = exact match (no wildcards). */
  readonly compiledPattern: RegExp | null;
}

/**
 * CF-029: Safe glob pattern validation.
 * Only allows alphanumeric, dots, hyphens, underscores, and asterisk (glob wildcard).
 * Rejects regex metacharacters to prevent ReDoS and unintended matching.
 * S ref: RDD-4 (pattern-based subscription)
 */
const SAFE_GLOB_PATTERN = /^[a-zA-Z0-9.*_-]+$/;

/**
 * Check if an event type matches a subscription pattern.
 * Supports glob patterns: '*' matches everything, 'mission.*' matches mission.created, etc.
 * CF-029: Pattern is validated against SAFE_GLOB_PATTERN before conversion to regex.
 * S ref: RDD-4 (pattern-based subscription)
 */
function matchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === '*') return true;

  // CF-029: Reject patterns containing regex metacharacters
  if (!SAFE_GLOB_PATTERN.test(pattern)) {
    return false;
  }

  // Convert safe glob pattern to regex
  const regexStr = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
  + '$';

  return new RegExp(regexStr).test(eventType);
}

/**
 * FR-005: Validate subject filter pattern.
 * Subject URNs use colons (entity:type:id) so we need a broader pattern than SAFE_GLOB_PATTERN.
 * Allows alphanumeric, dots, hyphens, underscores, colons, and asterisk wildcard.
 */
const SAFE_SUBJECT_PATTERN = /^[a-zA-Z0-9.*_:/-]+$/;

function isValidFilterSubject(pattern: string): boolean {
  return SAFE_SUBJECT_PATTERN.test(pattern);
}

/**
 * FR-005: Check if an event payload matches a subscription filter.
 * A filter matches if every specified field (predicate, subject) in the filter
 * matches the corresponding field in the event payload using glob-style patterns.
 * If a filter field is undefined, it matches all values for that field.
 * If the payload doesn't contain the field, the filter does NOT match (except when filter field is undefined).
 */
function matchesFilter(payload: Record<string, unknown>, filter: EventSubscriptionFilter): boolean {
  if (filter.predicate !== undefined) {
    const payloadPredicate = payload['predicate'];
    if (typeof payloadPredicate !== 'string') return false;
    if (!matchesPattern(payloadPredicate, filter.predicate)) return false;
  }
  if (filter.subject !== undefined) {
    const payloadSubject = payload['subject'];
    if (typeof payloadSubject !== 'string') return false;
    if (!matchesPattern(payloadSubject, filter.subject)) return false;
  }
  return true;
}

/**
 * CF-010: Optional encryption for webhook secrets at rest.
 * When provided, webhook secrets are encrypted before storage in obs_event_subscriptions.
 * S ref: I-11 (encryption at rest), IP-6 (webhook HMAC signing)
 */
interface EventBusEncryption {
  encrypt(plaintext: string): Result<string>;
  decrypt(ciphertext: string): Result<string>;
}

/**
 * Create an EventBus implementation.
 * CF-010: Optional encryption parameter for webhook secret storage.
 * S ref: RDD-4 (synchronous dispatch), §10 (event propagation),
 *        IP-6 (webhook delivery)
 */
// CF-014: Maximum in-memory subscriptions per EventBus instance
const MAX_SUBSCRIPTIONS = 10_000;

export function createEventBus(encryption?: EventBusEncryption, time?: TimeProvider): EventBus {
  // Finding-19: Fallback for DX convenience; inject TimeProvider via config for deterministic testing
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  /** In-memory subscription registry. S ref: RDD-4. */
  const subscriptions = new Map<string, Subscription>();

  return {
    /**
     * Emit event. Synchronous in-process dispatch per RDD-4.
     * Persists event to obs_events for replay and webhook delivery.
     * S ref: RDD-4 (synchronous dispatch), §10 (event propagation)
     */
    emit(conn: DatabaseConnection, ctx: OperationContext, event: EventPayload): Result<EventId> {
      try {
        const eventId = randomUUID() as EventId;
        const timestamp = clock.nowMs();

        // Phase 3 fix: Wrap all DB operations (persist + webhook records) in a single
        // transaction. In-memory handler dispatch happens AFTER the transaction commits
        // because handlers can't be rolled back.
        conn.transaction(() => {
          // Persist event to obs_events
          conn.run(
            `INSERT INTO obs_events (id, tenant_id, type, scope, mission_id, payload, timestamp, propagation, delivered, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
            [eventId, ctx.tenantId, event.type, event.scope,
             event.missionId ?? null, JSON.stringify(event.payload),
             timestamp, event.propagation]
          );

          // Check for webhook subscriptions and create delivery records
          const webhookSubs = conn.query<{ id: string; handler_config: string }>(
            `SELECT id, handler_config FROM obs_event_subscriptions
             WHERE active = 1 AND subscriber_type = 'webhook'
             AND (tenant_id = ? OR tenant_id IS NULL)`,
            [ctx.tenantId]
          );

          for (const webhookSub of webhookSubs) {
            // Check if this webhook's pattern matches
            const subPattern = conn.get<{ event_pattern: string }>(
              `SELECT event_pattern FROM obs_event_subscriptions WHERE id = ?`,
              [webhookSub.id]
            );

            if (subPattern && matchesPattern(event.type, subPattern.event_pattern)) {
              const deliveryId = randomUUID();
              const idempotencyKey = `${eventId}:${webhookSub.id}`;

              conn.run(
                `INSERT INTO obs_webhook_deliveries
                 (id, subscription_id, event_id, idempotency_key, status, attempts, max_attempts, created_at)
                 VALUES (?, ?, ?, ?, 'pending', 0, 3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
                [deliveryId, webhookSub.id, eventId, idempotencyKey]
              );
            }
          }
        });

        // Synchronous in-process dispatch to matching subscribers.
        // Dispatched AFTER transaction commits — handlers can't be rolled back,
        // so they must only see committed state.
        for (const sub of subscriptions.values()) {
          // Finding-30: Use pre-compiled regex (or exact match) instead of recompiling per emission
          const matches = sub.compiledPattern
            ? sub.compiledPattern.test(event.type)
            : sub.pattern === '*' || sub.pattern === event.type;
          if (matches) {
            // FR-005: Apply payload-level filter if present
            if (sub.filter && !matchesFilter(event.payload, sub.filter)) {
              continue;
            }
            try {
              sub.handler(event);
            } catch {
              // Handler errors do not propagate to emitter per RDD-4.
              // Handlers are responsible for their own error handling.
            }
          }
        }

        return { ok: true, value: eventId };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'EVENT_EMIT_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'RDD-4, §10',
          },
        };
      }
    },

    /**
     * Subscribe to events matching pattern. Returns subscription ID.
     * S ref: RDD-4 (subscription registry)
     */
    subscribe(pattern: string, handler: EventHandler, filter?: EventSubscriptionFilter): Result<string> {
      try {
        // CF-029: Validate pattern before registration
        if (!SAFE_GLOB_PATTERN.test(pattern)) {
          return {
            ok: false,
            error: {
              code: 'INVALID_PATTERN',
              message: `Event pattern contains unsafe characters. Only alphanumeric, '.', '*', '-', '_' allowed.`,
              spec: 'RDD-4',
            },
          };
        }

        // FR-005: Validate filter patterns if provided
        if (filter?.predicate !== undefined && !SAFE_GLOB_PATTERN.test(filter.predicate)) {
          return {
            ok: false,
            error: {
              code: 'INVALID_PATTERN',
              message: `Filter predicate pattern contains unsafe characters.`,
              spec: 'RDD-4/FR-005',
            },
          };
        }
        if (filter?.subject !== undefined && filter.subject !== '' && !isValidFilterSubject(filter.subject)) {
          return {
            ok: false,
            error: {
              code: 'INVALID_PATTERN',
              message: `Filter subject pattern contains unsafe characters.`,
              spec: 'RDD-4/FR-005',
            },
          };
        }

        // CF-014: Bound in-memory subscription count
        if (subscriptions.size >= MAX_SUBSCRIPTIONS) {
          return {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message: `Maximum subscriptions (${MAX_SUBSCRIPTIONS}) exceeded. Unsubscribe unused listeners first.`,
              spec: 'RDD-4/CF-014',
            },
          };
        }

        const id = randomUUID();
        // Finding-30: Pre-compile glob-to-regex at subscription time instead of every emission
        const compiledPattern = pattern.includes('*')
          ? new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
          : null; // null = exact match, no regex needed
        const sub: Subscription = filter
          ? { id, pattern, handler, filter, compiledPattern }
          : { id, pattern, handler, compiledPattern };
        subscriptions.set(id, sub);
        return { ok: true, value: id };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'SUBSCRIBE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'RDD-4',
          },
        };
      }
    },

    /**
     * Unsubscribe by subscription ID.
     * S ref: RDD-4 (subscription lifecycle)
     */
    unsubscribe(subscriptionId: string): Result<void> {
      try {
        const deleted = subscriptions.delete(subscriptionId);
        if (!deleted) {
          return {
            ok: false,
            error: {
              code: 'SUBSCRIPTION_NOT_FOUND',
              message: `Subscription ${subscriptionId} not found`,
              spec: 'RDD-4',
            },
          };
        }
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'UNSUBSCRIBE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'RDD-4',
          },
        };
      }
    },

    /**
     * Register webhook endpoint for external consumers.
     * S ref: IP-6 (webhook delivery with HMAC-SHA256 signing)
     */
    registerWebhook(conn: DatabaseConnection, ctx: OperationContext, pattern: string, url: string, secret: string): Result<string> {
      try {
        // CF-029: Validate pattern before registration
        if (!SAFE_GLOB_PATTERN.test(pattern)) {
          return {
            ok: false,
            error: {
              code: 'INVALID_PATTERN',
              message: `Event pattern contains unsafe characters. Only alphanumeric, '.', '*', '-', '_' allowed.`,
              spec: 'RDD-4, IP-6',
            },
          };
        }

        const id = randomUUID();
        // CF-010: Encrypt webhook secret before storage if encryption is available.
        // Finding-3 fix: When encryption IS configured but FAILS, return hard error.
        // Plaintext fallback is only acceptable when no encryption is configured at all.
        // Previous behavior (LRA-002) fell back to plaintext on encryption failure,
        // which silently stored secrets in cleartext when the crypto subsystem was broken.
        let storedSecret: string;
        let isEncrypted: boolean;
        if (encryption) {
          const encResult = encryption.encrypt(secret);
          if (!encResult.ok) {
            // Finding-3: Hard fail — do NOT fall back to plaintext storage
            return {
              ok: false,
              error: {
                code: 'ENCRYPTION_FAILED',
                message: `Webhook secret encryption failed: ${encResult.error.message}`,
                spec: 'I-11',
              },
            };
          }
          storedSecret = encResult.value;
          isEncrypted = true;
        } else {
          // No encryption configured — plaintext is the only option
          storedSecret = secret;
          isEncrypted = false;
        }
        const handlerConfig = JSON.stringify({ url, secret: storedSecret, encrypted: isEncrypted });

        conn.run(
          `INSERT INTO obs_event_subscriptions (id, event_pattern, subscriber_type, handler_config, tenant_id, active, created_at)
           VALUES (?, ?, 'webhook', ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          [id, pattern, handlerConfig, ctx.tenantId]
        );

        return { ok: true, value: id };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'WEBHOOK_REGISTER_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'IP-6',
          },
        };
      }
    },

    /**
     * Process pending webhook deliveries (retry logic).
     * At-least-once delivery with exponential backoff, max 3 attempts.
     * S ref: IP-6 (at-least-once, retry with exponential backoff max 3)
     */
    processWebhooks(conn: DatabaseConnection): Result<{ delivered: number; failed: number; exhausted: number }> {
      try {
        let delivered = 0;
        let failed = 0;
        let exhausted = 0;

        // Get pending deliveries
        const pendingDeliveries = conn.query<{
          id: string; subscription_id: string; event_id: string;
          attempts: number; max_attempts: number;
        }>(
          `SELECT id, subscription_id, event_id, attempts, max_attempts
           FROM obs_webhook_deliveries
           WHERE status IN ('pending', 'failed')
           AND (next_retry_at IS NULL OR next_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ORDER BY created_at ASC LIMIT 100`
        );

        for (const delivery of pendingDeliveries) {
          // Get webhook config
          const sub = conn.get<{ handler_config: string }>(
            `SELECT handler_config FROM obs_event_subscriptions WHERE id = ?`,
            [delivery.subscription_id]
          );

          if (!sub) {
            // Subscription deleted, mark exhausted
            conn.run(
              `UPDATE obs_webhook_deliveries SET status = 'exhausted', last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               WHERE id = ?`,
              [delivery.id]
            );
            exhausted++;
            continue;
          }

          // Get event payload
          const event = conn.get<{ payload: string; type: string }>(
            `SELECT payload, type FROM obs_events WHERE id = ?`,
            [delivery.event_id]
          );

          if (!event) {
            conn.run(
              `UPDATE obs_webhook_deliveries SET status = 'exhausted', last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               WHERE id = ?`,
              [delivery.id]
            );
            exhausted++;
            continue;
          }

          const newAttempts = delivery.attempts + 1;

          try {
            // Finding-29: Webhook HTTP delivery is not yet implemented.
            // Mark as 'pending' with a diagnostic note instead of false 'delivered' status.
            // The actual fetch implementation will be wired when the substrate provides HTTP capabilities.
            conn.run(
              `UPDATE obs_webhook_deliveries SET
               status = 'pending', attempts = ?, last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               response_body = ?
               WHERE id = ?`,
              [newAttempts, 'NOT_IMPLEMENTED: Webhook HTTP delivery is not yet wired. See Finding-29.', delivery.id]
            );
            // Return 0 delivered so callers know nothing was actually sent
          } catch {
            // Delivery failed
            if (newAttempts >= delivery.max_attempts) {
              // Max retries exhausted
              conn.run(
                `UPDATE obs_webhook_deliveries SET
                 status = 'exhausted', attempts = ?, last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?`,
                [newAttempts, delivery.id]
              );
              exhausted++;
            } else {
              // Schedule retry with exponential backoff
              // SEC-013 fix: Use parameterized query instead of string interpolation
              // to prevent SQL injection. SQLite's datetime modifiers accept '+N seconds'.
              const backoffSeconds = Math.pow(2, newAttempts) * 10;
              conn.run(
                `UPDATE obs_webhook_deliveries SET
                 status = 'failed', attempts = ?, last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 next_retry_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' seconds')
                 WHERE id = ?`,
                [newAttempts, backoffSeconds, delivery.id]
              );
              failed++;
            }
          }
        }

        return { ok: true, value: { delivered, failed, exhausted } };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'WEBHOOK_PROCESS_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'IP-6',
          },
        };
      }
    },
  };
}
