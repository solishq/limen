/**
 * Event Propagation -- Event routing through mission trees.
 * S ref: S10 (Event), S20 (emit_event), FM-13 (unbounded autonomy),
 *        I-03 (atomic audit)
 *
 * Phase: 3 (Orchestration)
 * Implements: Event emission with namespace validation, propagation
 *             direction (up/down/local), lifecycle event restriction,
 *             rate limiting per agent (10/minute per S36).
 *
 * SD-09: Reserved namespaces (system.*, lifecycle.*) are rejected from agent emission.
 * SD-16: Rate limiting is enforced per agent, not per mission.
 */

import type { Result, OperationContext, MissionId, EventId, TenantId } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, EventPropagator, EmitEventInput, EmitEventOutput,
  EventScope,
} from '../interfaces/orchestration.js';
import { generateId } from '../interfaces/orchestration.js';

/** S10: Reserved event namespace prefixes -- agents cannot emit these */
const RESERVED_PREFIXES = ['system.', 'lifecycle.'] as const;

// CF-013: Event payload size limit (64KB)
const MAX_EVENT_PAYLOAD_BYTES = 65_536;

/**
 * S10: Create the event propagation module.
 * Factory function returns frozen object per C-07.
 */
export function createEventPropagator(): EventPropagator {

  /**
   * SD-16: In-memory rate limit tracking (10/minute per agent per S36).
   * CF-007: Fallback only — when deps.rateLimiter is available, the kernel's
   * SQLite-backed rate limiter is used instead for persistence across restarts.
   *
   * FO-003: Capped at MAX_RATE_LIMIT_ENTRIES to prevent unbounded memory growth.
   * Entries auto-reset their window after 60s of inactivity.
   * Periodic eviction of expired entries when at capacity.
   */
  const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
  const MAX_RATE_LIMIT_ENTRIES = 10_000;

  /** Evict entries whose 60s window has expired. Called when map is at capacity. */
  function evictExpiredRateLimitEntries(nowMs: number): void {
    for (const [key, entry] of rateLimitMap) {
      if (nowMs - entry.windowStart > 60_000) {
        rateLimitMap.delete(key);
      }
    }
  }

  /** FM-13: In-memory fallback rate limit check */
  function isRateLimitedFallback(agentId: string, nowMs: number): boolean {
    const entry = rateLimitMap.get(agentId);
    if (!entry || nowMs - entry.windowStart > 60_000) {
      // Evict expired entries if at capacity before inserting new one
      if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
        evictExpiredRateLimitEntries(nowMs);
      }
      rateLimitMap.set(agentId, { count: 1, windowStart: nowMs });
      return false;
    }
    entry.count++;
    return entry.count > 10;
  }

  /** S20: Emit an event (agent-callable, with namespace and rate restrictions) */
  function emit(
    deps: OrchestrationDeps,
    ctx: OperationContext,
    input: EmitEventInput,
  ): Result<EmitEventOutput> {
    // SD-09: Reject reserved namespaces
    const eventTypeLower = input.eventType.toLowerCase();
    for (const prefix of RESERVED_PREFIXES) {
      if (eventTypeLower.startsWith(prefix)) {
        return { ok: false, error: { code: 'INVALID_TYPE', message: `Event type '${input.eventType}' uses reserved namespace '${prefix}'`, spec: 'S20' } };
      }
    }

    // CF-013: Validate event payload size
    const payloadStr = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload);
    const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');
    if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: `Event payload exceeds maximum size (${payloadBytes} bytes > ${MAX_EVENT_PAYLOAD_BYTES} bytes limit)`, spec: 'S20/CF-013' } };
    }

    // Verify mission exists
    const mission = deps.conn.get<{ id: string; parent_id: string | null; state: string }>(
      'SELECT id, parent_id, state FROM core_missions WHERE id = ?',
      [input.missionId],
    );
    if (!mission) {
      return { ok: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${input.missionId} not found`, spec: 'S20' } };
    }

    // FM-13 / CF-007: Rate limiting (10/minute per agent per S36)
    const agentId = (ctx.agentId ?? ctx.userId ?? 'unknown') as string;

    // CF-007: Use kernel's SQLite-backed rate limiter if available (persistent across restarts).
    // Falls back to in-memory Map when rateLimiter is not injected (backward compatibility).
    if (deps.rateLimiter) {
      const rlResult = deps.rateLimiter.checkAndConsume(deps.conn, ctx, 'emit_event');
      if (!rlResult.ok) {
        return { ok: false, error: rlResult.error };
      }
      if (!rlResult.value) {
        return { ok: false, error: { code: 'RATE_LIMITED', message: `Agent ${agentId} exceeds event rate limit`, spec: 'S20, §36' } };
      }
    } else if (isRateLimitedFallback(agentId, deps.time.nowMs())) {
      return { ok: false, error: { code: 'RATE_LIMITED', message: `Agent ${agentId} exceeds 10 events/minute`, spec: 'S20' } };
    }

    const eventId = generateId() as EventId;
    const now = deps.time.nowMs();
    const isoNow = deps.time.nowISO();
    const scope: EventScope = 'mission';

    deps.conn.transaction(() => {
      // Store event in log
      deps.conn.run(
        `INSERT INTO core_events_log (id, tenant_id, type, scope, mission_id, payload_json, propagation, emitted_by, timestamp_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          ctx.tenantId,
          input.eventType,
          scope,
          input.missionId,
          JSON.stringify(input.payload),
          input.propagation,
          agentId,
          now,
          isoNow,
        ],
      );

      // Propagation: store propagated copies for parent/children
      if (input.propagation === 'up' && mission.parent_id !== null) {
        const propagatedId = generateId();
        deps.conn.run(
          `INSERT INTO core_events_log (id, tenant_id, type, scope, mission_id, payload_json, propagation, emitted_by, timestamp_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?, ?)`,
          [propagatedId, ctx.tenantId, input.eventType, scope, mission.parent_id, JSON.stringify(input.payload), agentId, now, isoNow],
        );
      } else if (input.propagation === 'down') {
        const children = deps.conn.query<{ id: string }>(
          'SELECT id FROM core_missions WHERE parent_id = ?',
          [input.missionId],
        );
        for (const child of children) {
          const propagatedId = generateId();
          deps.conn.run(
            `INSERT INTO core_events_log (id, tenant_id, type, scope, mission_id, payload_json, propagation, emitted_by, timestamp_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?, ?)`,
            [propagatedId, ctx.tenantId, input.eventType, scope, child.id, JSON.stringify(input.payload), agentId, now, isoNow],
          );
        }
      }
      // 'local' -- no propagation needed beyond the insertion

      // I-03: Audit entry
      deps.audit.append(deps.conn, {
        tenantId: ctx.tenantId,
        actorType: ctx.userId ? 'user' : 'agent',
        actorId: agentId,
        operation: 'emit_event',
        resourceType: 'event',
        resourceId: eventId,
        detail: { eventType: input.eventType, missionId: input.missionId, propagation: input.propagation },
      });
    });

    return {
      ok: true,
      value: { eventId, delivered: true },
    };
  }

  /** S10: Emit a lifecycle event (orchestrator-only, not agent-callable) */
  function emitLifecycle(
    deps: OrchestrationDeps,
    type: string,
    missionId: MissionId,
    payload: Record<string, unknown>,
  ): Result<EventId> {
    const eventId = generateId() as EventId;
    const now = deps.time.nowMs();
    const isoNow = deps.time.nowISO();

    // Debt 3: Derive tenant_id from mission for audit trail
    const missionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [missionId],
    );
    const lifecycleTenantId = (missionRow?.tenant_id ?? null) as TenantId | null;

    // CQ-05 fix: I-03 -- lifecycle event INSERT + audit in same transaction
    deps.conn.transaction(() => {
      deps.conn.run(
        `INSERT INTO core_events_log (id, tenant_id, type, scope, mission_id, payload_json, propagation, emitted_by, timestamp_ms, created_at)
         VALUES (?, ?, ?, 'system', ?, ?, 'up', 'orchestrator', ?, ?)`,
        [eventId, lifecycleTenantId, type, missionId, JSON.stringify(payload), now, isoNow],
      );

      deps.audit.append(deps.conn, {
        tenantId: lifecycleTenantId,
        actorType: 'system',
        actorId: 'orchestrator',
        operation: 'emit_lifecycle_event',
        resourceType: 'event',
        resourceId: eventId,
        detail: { type, missionId },
      });
    });

    return { ok: true, value: eventId };
  }

  return Object.freeze({
    emit,
    emitLifecycle,
  });
}
