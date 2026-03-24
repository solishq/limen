/**
 * Webhook delivery module — async HTTP delivery with HMAC-SHA256 signing.
 * S ref: IP-6 (Webhook delivery with at-least-once semantics, max 3 retries)
 *
 * Phase: Sprint 5 (Performance & Events)
 * Implements: Real HTTP delivery for webhook subscriptions, replacing the
 * placeholder in event_bus.ts processWebhooks().
 *
 * This module is STANDALONE — it does not modify the EventBus interface (frozen zone).
 * It queries pending deliveries from obs_webhook_deliveries, makes HTTP calls with
 * HMAC-SHA256 signatures, and updates delivery status in the database.
 *
 * Security requirements:
 *   - HMAC-SHA256 via createHmac('sha256', secret).update(body).digest('hex')
 *   - X-Limen-Signature header on every delivery
 *   - AbortSignal.timeout(5000) for 5-second deadline per delivery
 *   - Exponential backoff: Math.pow(2, attempt) * 10 seconds
 *   - Max 3 retries (schema default: max_attempts = 3)
 *   - Response status captured in obs_webhook_deliveries.response_status
 *   - Error message captured (webhook secrets NEVER in error messages)
 *   - URL validation: must start with 'https://' (no http, no localhost)
 *
 * Invariants enforced: IP-6 (at-least-once delivery)
 * Failure modes defended: FM-06 (external endpoint unavailability)
 */

import { createHmac } from 'node:crypto';
import type { DatabaseConnection, Result } from '../interfaces/index.js';
import type { TimeProvider } from '../interfaces/time.js';

// ============================================================================
// Types
// ============================================================================

/**
 * CF-010: Encryption interface for decrypting webhook secrets at rest.
 * Mirrors EventBusEncryption from event_bus.ts. Structurally typed to avoid
 * import coupling to the event bus module.
 */
interface WebhookEncryption {
  decrypt(ciphertext: string): Result<string>;
}

/**
 * Result of a single webhook delivery attempt.
 */
export interface WebhookDeliveryAttempt {
  readonly deliveryId: string;
  readonly subscriptionId: string;
  readonly eventId: string;
  readonly status: 'delivered' | 'failed' | 'exhausted' | 'skipped';
  readonly responseStatus?: number;
  readonly errorMessage?: string;
}

/**
 * Aggregate result from a batch delivery run.
 */
export interface WebhookDeliveryResult {
  readonly delivered: number;
  readonly failed: number;
  readonly exhausted: number;
  readonly skipped: number;
  readonly attempts: readonly WebhookDeliveryAttempt[];
}

// ============================================================================
// URL Validation
// ============================================================================

/**
 * IP-6: Validate webhook URL. Must use HTTPS in production.
 * Rejects http://, localhost, and non-URL strings.
 *
 * @param url - URL to validate
 * @returns true if URL is safe for webhook delivery
 */
export function isValidWebhookUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false;

  try {
    const parsed = new URL(url);
    // Strip brackets from IPv6 hostnames (Node URL parser includes them)
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // F-S5-001 FIX: Reject localhost, loopback (IPv4 + IPv6), and 0.0.0.0
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return false;
    }

    // F-S5-002 FIX: Reject RFC 1918 private ranges + link-local + AWS metadata
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      isInRange172(hostname)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an IPv4 hostname falls in 172.16.0.0/12 (172.16.x.x - 172.31.x.x).
 * @internal
 */
function isInRange172(hostname: string): boolean {
  if (!hostname.startsWith('172.')) return false;
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const second = parseInt(parts[1]!, 10);
  return second >= 16 && second <= 31;
}

// ============================================================================
// HMAC Signature
// ============================================================================

/**
 * IP-6: Compute HMAC-SHA256 signature for a webhook payload.
 *
 * @param secret - Webhook secret (plaintext)
 * @param body - JSON payload body
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function computeWebhookSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ============================================================================
// Delivery Engine
// ============================================================================

/**
 * IP-6: Deliver pending webhooks via HTTP POST.
 *
 * Queries obs_webhook_deliveries for pending/failed deliveries, makes HTTP calls
 * with HMAC-SHA256 signed payloads, and updates delivery status.
 *
 * This function is ASYNC and is called separately from the synchronous
 * EventBus.processWebhooks(). It handles the actual HTTP transport.
 *
 * @param conn - Database connection
 * @param encryption - Optional encryption for decrypting webhook secrets
 * @param time - TimeProvider for timestamps (Hard Stop #7)
 * @param batchSize - Maximum deliveries to process per call (default: 100)
 * @returns WebhookDeliveryResult with delivery statistics
 */
export async function deliverWebhooks(
  conn: DatabaseConnection,
  encryption?: WebhookEncryption,
  time?: TimeProvider,
  batchSize: number = 100,
): Promise<WebhookDeliveryResult> {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() }; // clock-exempt: fallback only

  let delivered = 0;
  let failed = 0;
  let exhausted = 0;
  let skipped = 0;
  const attempts: WebhookDeliveryAttempt[] = [];

  // Query pending deliveries
  const pendingDeliveries = conn.query<{
    id: string;
    subscription_id: string;
    event_id: string;
    attempts: number;
    max_attempts: number;
  }>(
    `SELECT id, subscription_id, event_id, attempts, max_attempts
     FROM obs_webhook_deliveries
     WHERE status IN ('pending', 'failed')
     AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC LIMIT ?`,
    [clock.nowISO(), batchSize],
  );

  // Process each delivery
  const deliveryPromises = pendingDeliveries.map(async (delivery) => {
    return deliverSingle(conn, delivery, encryption, clock);
  });

  // Execute deliveries with Promise.allSettled for fault isolation
  const results = await Promise.allSettled(deliveryPromises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const attempt = result.value;
      attempts.push(attempt);
      switch (attempt.status) {
        case 'delivered': delivered++; break;
        case 'failed': failed++; break;
        case 'exhausted': exhausted++; break;
        case 'skipped': skipped++; break;
      }
    } else {
      // Promise rejection — should not happen with our error handling,
      // but count as skipped to avoid losing visibility
      skipped++;
    }
  }

  return { delivered, failed, exhausted, skipped, attempts };
}

// ============================================================================
// Single Delivery
// ============================================================================

/**
 * Attempt delivery of a single webhook.
 *
 * @internal
 */
async function deliverSingle(
  conn: DatabaseConnection,
  delivery: {
    id: string;
    subscription_id: string;
    event_id: string;
    attempts: number;
    max_attempts: number;
  },
  encryption: WebhookEncryption | undefined,
  clock: TimeProvider,
): Promise<WebhookDeliveryAttempt> {
  // 1. Get subscription config
  const sub = conn.get<{ handler_config: string }>(
    `SELECT handler_config FROM obs_event_subscriptions WHERE id = ?`,
    [delivery.subscription_id],
  );

  if (!sub) {
    // Subscription deleted — mark exhausted
    conn.run(
      `UPDATE obs_webhook_deliveries SET status = 'exhausted', last_attempt_at = ?
       WHERE id = ?`,
      [clock.nowISO(), delivery.id],
    );
    return {
      deliveryId: delivery.id,
      subscriptionId: delivery.subscription_id,
      eventId: delivery.event_id,
      status: 'skipped',
      errorMessage: 'Subscription not found',
    };
  }

  const config = JSON.parse(sub.handler_config) as {
    url: string;
    secret: string;
    encrypted?: boolean;
  };

  // 2. Validate URL
  if (!isValidWebhookUrl(config.url)) {
    conn.run(
      `UPDATE obs_webhook_deliveries SET status = 'exhausted', last_attempt_at = ?,
       error_message = 'Invalid webhook URL: must use HTTPS'
       WHERE id = ?`,
      [clock.nowISO(), delivery.id],
    );
    return {
      deliveryId: delivery.id,
      subscriptionId: delivery.subscription_id,
      eventId: delivery.event_id,
      status: 'exhausted',
      errorMessage: 'Invalid webhook URL: must use HTTPS',
    };
  }

  // 3. Decrypt secret if encrypted (LRA-002: Result<string> pattern)
  let webhookSecret: string;
  if (config.encrypted && encryption) {
    const decryptResult = encryption.decrypt(config.secret);
    if (!decryptResult.ok) {
      // Decryption failure — do NOT include secret in error
      conn.run(
        `UPDATE obs_webhook_deliveries SET status = 'exhausted', last_attempt_at = ?,
         error_message = 'Webhook secret decryption failed'
         WHERE id = ?`,
        [clock.nowISO(), delivery.id],
      );
      return {
        deliveryId: delivery.id,
        subscriptionId: delivery.subscription_id,
        eventId: delivery.event_id,
        status: 'exhausted',
        errorMessage: 'Webhook secret decryption failed',
      };
    }
    webhookSecret = decryptResult.value;
  } else {
    webhookSecret = config.secret;
  }

  // 4. Get event payload
  const event = conn.get<{
    id: string;
    type: string;
    scope: string;
    payload: string;
    timestamp: number;
  }>(
    `SELECT id, type, scope, payload, timestamp FROM obs_events WHERE id = ?`,
    [delivery.event_id],
  );

  if (!event) {
    conn.run(
      `UPDATE obs_webhook_deliveries SET status = 'exhausted', last_attempt_at = ?
       WHERE id = ?`,
      [clock.nowISO(), delivery.id],
    );
    return {
      deliveryId: delivery.id,
      subscriptionId: delivery.subscription_id,
      eventId: delivery.event_id,
      status: 'skipped',
      errorMessage: 'Event not found',
    };
  }

  // 5. Build payload
  const eventPayload = JSON.stringify({
    id: event.id,
    type: event.type,
    scope: event.scope,
    payload: JSON.parse(event.payload),
    timestamp: event.timestamp,
  });

  // 6. Compute HMAC-SHA256 signature
  const signature = computeWebhookSignature(webhookSecret, eventPayload);

  // 7. Attempt HTTP delivery
  const newAttempts = delivery.attempts + 1;
  const nowISO = clock.nowISO();

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Limen-Signature': signature,
        'X-Limen-Event-Id': event.id,
        'X-Limen-Event-Type': event.type,
      },
      body: eventPayload,
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // Successful delivery
      conn.run(
        `UPDATE obs_webhook_deliveries SET
         status = 'delivered', attempts = ?, last_attempt_at = ?,
         response_status = ?
         WHERE id = ?`,
        [newAttempts, nowISO, response.status, delivery.id],
      );
      return {
        deliveryId: delivery.id,
        subscriptionId: delivery.subscription_id,
        eventId: delivery.event_id,
        status: 'delivered',
        responseStatus: response.status,
      };
    }

    // Non-2xx response — treat as failure
    return handleDeliveryFailure(
      conn, delivery, newAttempts, nowISO,
      `HTTP ${response.status}`, response.status,
    );
  } catch (err) {
    // Network error, timeout, etc.
    // SECURITY: Do not include webhook secret in error message
    const errorMessage = err instanceof Error
      ? err.name === 'TimeoutError'
        ? 'Delivery timeout (5s exceeded)'
        : `Network error: ${err.message}`
      : 'Unknown delivery error';

    return handleDeliveryFailure(
      conn, delivery, newAttempts, nowISO,
      errorMessage, undefined,
    );
  }
}

// ============================================================================
// Failure Handling
// ============================================================================

/**
 * Handle a failed delivery attempt. Either retry with exponential backoff
 * or mark as exhausted if max attempts reached.
 *
 * @internal
 */
function handleDeliveryFailure(
  conn: DatabaseConnection,
  delivery: {
    id: string;
    subscription_id: string;
    event_id: string;
    attempts: number;
    max_attempts: number;
  },
  newAttempts: number,
  nowISO: string,
  errorMessage: string,
  responseStatus: number | undefined,
): WebhookDeliveryAttempt {
  if (newAttempts >= delivery.max_attempts) {
    // Max retries exhausted
    conn.run(
      `UPDATE obs_webhook_deliveries SET
       status = 'exhausted', attempts = ?, last_attempt_at = ?,
       error_message = ?${responseStatus !== undefined ? ', response_status = ?' : ''}
       WHERE id = ?`,
      responseStatus !== undefined
        ? [newAttempts, nowISO, errorMessage, responseStatus, delivery.id]
        : [newAttempts, nowISO, errorMessage, delivery.id],
    );
    return {
      deliveryId: delivery.id,
      subscriptionId: delivery.subscription_id,
      eventId: delivery.event_id,
      status: 'exhausted' as const,
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      errorMessage,
    };
  }

  // Schedule retry with exponential backoff: 2^attempt * 10 seconds
  const backoffSeconds = Math.pow(2, newAttempts) * 10;
  conn.run(
    `UPDATE obs_webhook_deliveries SET
     status = 'failed', attempts = ?, last_attempt_at = ?,
     error_message = ?,
     next_retry_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || ? || ' seconds')
     ${responseStatus !== undefined ? ', response_status = ?' : ''}
     WHERE id = ?`,
    responseStatus !== undefined
      ? [newAttempts, nowISO, errorMessage, nowISO, backoffSeconds, responseStatus, delivery.id]
      : [newAttempts, nowISO, errorMessage, nowISO, backoffSeconds, delivery.id],
  );

  return {
    deliveryId: delivery.id,
    subscriptionId: delivery.subscription_id,
    eventId: delivery.event_id,
    status: 'failed' as const,
    ...(responseStatus !== undefined ? { responseStatus } : {}),
    errorMessage,
  };
}
