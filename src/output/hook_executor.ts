// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_OUTPUT_GOVERNANCE.md §7.5-§7.8
/**
 * Hook Executor — Registration, ordering, and execution for output governance hooks.
 *
 * Implements: OG-7.21 through OG-7.30, OG-12.7, OG-12.8, OG-12.12
 *
 * Invariants:
 * - OG-12.7: Deterministic ordering — priority ascending, then registration order
 * - OG-12.8: Blocking audit — proceed:false blocks with audit entry
 * - OG-12.12: 5000ms timeout — exceeded = proceed:true + warning audit
 * - OG-7.27: Handler throw = proceed:true + warning audit
 */

import { randomUUID } from 'node:crypto';
import type { Result, OperationContext } from '../kernel/interfaces/index.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { EventBus } from '../kernel/interfaces/events.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type {
  HookType, AgentHook, HookHandler, HookContext, HookResult,
  HookRegistration, AgentId, SessionId,
} from './output_types.js';
import { HOOK_TIMEOUT_MS, VALID_HOOK_TYPES } from './output_types.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'AOG-7' } };
}

// ============================================================================
// Internal Hook Entry
// ============================================================================

interface HookEntry {
  readonly hookId: string;
  readonly type: HookType;
  readonly priority: number;
  readonly name: string;
  readonly handler: HookHandler;
  readonly registeredAt: string;
  readonly registrationOrder: number;
  firedCount: number;
  blockedCount: number;
  lastFiredAt: string | null;
  errorCount: number;
}

// ============================================================================
// Hook Executor Dependencies
// ============================================================================

export interface HookExecutorDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly getContext: () => OperationContext;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
  readonly events: EventBus;
}

// ============================================================================
// Hook Executor Interface
// ============================================================================

export interface HookExecutor {
  register(hook: AgentHook): Result<string>;
  unregister(hookId: string): Result<void>;
  list(): Result<HookRegistration[]>;
  execute(
    type: HookType,
    agentId: AgentId,
    sessionId: SessionId,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<{ proceed: boolean; payload: Readonly<Record<string, unknown>>; blockingHookId?: string; reason?: string }>;
}

// ============================================================================
// Factory
// ============================================================================

const MAX_HOOKS = 200;

export function createHookExecutor(deps: HookExecutorDeps): HookExecutor {
  const { getConnection, getContext, audit, time, events } = deps;

  const hooks: HookEntry[] = [];
  let registrationCounter = 0;

  /** Emit event with proper conn/ctx/payload signature */
  function emitEvent(eventType: string, payload: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      const ctx = getContext();
      events.emit(conn, ctx, {
        type: eventType,
        scope: 'system',
        payload,
        propagation: 'local',
      });
    } catch { /* event emission non-fatal */ }
  }

  /** Append audit entry with proper conn signature */
  function appendAudit(operation: string, resourceType: string, resourceId: string, detail?: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      audit.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'output-governance',
        operation,
        resourceType,
        resourceId,
        ...(detail !== undefined ? { detail } : {}),
      });
    } catch { /* audit failure non-fatal in hook context */ }
  }

  function register(hook: AgentHook): Result<string> {
    if (!VALID_HOOK_TYPES.has(hook.type)) {
      return err('INVALID_HOOK_TYPE', `Invalid hook type: ${hook.type}`);
    }
    if (typeof hook.priority !== 'number' || hook.priority < 0 || hook.priority > 100) {
      return err('INVALID_HOOK_PRIORITY', `Hook priority must be 0-100, got: ${hook.priority}`);
    }
    if (!hook.name || typeof hook.name !== 'string' || hook.name.length === 0) {
      return err('INVALID_HOOK_NAME', 'Hook name must be non-empty');
    }
    if (typeof hook.handler !== 'function') {
      return err('INVALID_HOOK_HANDLER', 'Hook handler must be a function');
    }
    if (hooks.length >= MAX_HOOKS) {
      return err('MAX_HOOKS_EXCEEDED', `Maximum hooks limit (${MAX_HOOKS}) reached`);
    }

    const hookId = randomUUID();
    const now = time.nowISO();

    const entry: HookEntry = {
      hookId,
      type: hook.type,
      priority: hook.priority,
      name: hook.name,
      handler: hook.handler,
      registeredAt: now,
      registrationOrder: registrationCounter++,
      firedCount: 0,
      blockedCount: 0,
      lastFiredAt: null,
      errorCount: 0,
    };

    hooks.push(entry);

    // OG-8.26: hook:registered event
    emitEvent('hook:registered', { hookId, type: hook.type, priority: hook.priority });

    return ok(hookId);
  }

  function unregister(hookId: string): Result<void> {
    const idx = hooks.findIndex(h => h.hookId === hookId);
    if (idx === -1) {
      return err('HOOK_NOT_FOUND', `Hook not found: ${hookId}`);
    }
    hooks.splice(idx, 1);
    return ok(undefined);
  }

  function list(): Result<HookRegistration[]> {
    return ok(hooks.map(h => ({
      hookId: h.hookId,
      type: h.type,
      priority: h.priority,
      name: h.name,
      registeredAt: h.registeredAt,
      firedCount: h.firedCount,
      blockedCount: h.blockedCount,
      lastFiredAt: h.lastFiredAt,
      errorCount: h.errorCount,
    })));
  }

  async function execute(
    type: HookType,
    agentId: AgentId,
    sessionId: SessionId,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<{ proceed: boolean; payload: Readonly<Record<string, unknown>>; blockingHookId?: string; reason?: string }> {
    // OG-12.7: Sort by priority ascending, then registration order
    const matching = hooks
      .filter(h => h.type === type)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.registrationOrder - b.registrationOrder;
      });

    if (matching.length === 0) {
      return { proceed: true, payload };
    }

    let currentPayload = payload;

    for (const hook of matching) {
      const now = time.nowISO();
      const context: HookContext = {
        hookType: type,
        agentId,
        sessionId,
        timestamp: now,
        payload: currentPayload,
      };

      let result: HookResult;
      try {
        // OG-12.12: 5000ms timeout — BRK-015: clean up timer on success
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        result = await Promise.race([
          hook.handler(context).then(r => {
            // BRK-015: Clear timeout on successful completion
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            return r;
          }),
          new Promise<HookResult>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('HOOK_TIMEOUT')), HOOK_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        // OG-7.27 / OG-12.12: timeout or throw = proceed:true + warning audit
        hook.errorCount++;
        hook.firedCount++;
        hook.lastFiredAt = time.nowISO();

        const errorMessage = error instanceof Error ? error.message : String(error);
        appendAudit(
          errorMessage === 'HOOK_TIMEOUT' ? 'hook.timeout' : 'hook.error',
          'hook', hook.hookId,
          { hookType: type, hookName: hook.name, error: errorMessage, errorCount: hook.errorCount },
        );

        emitEvent('hook:fired', { hookId: hook.hookId, type: hook.type, proceed: true });
        continue;
      }

      hook.firedCount++;
      hook.lastFiredAt = time.nowISO();

      if (!result.proceed) {
        // OG-12.8: Hook blocked — audit + event
        hook.blockedCount++;

        appendAudit('hook.blocked_operation', 'hook', hook.hookId, {
          hookType: type,
          hookName: hook.name,
          reason: result.reason ?? 'No reason provided',
          blockedCount: hook.blockedCount,
        });

        emitEvent('hook:blocked', {
          hookId: hook.hookId,
          type: hook.type,
          reason: result.reason ?? 'No reason provided',
        });

        return {
          proceed: false,
          payload: currentPayload,
          blockingHookId: hook.hookId,
          reason: result.reason ?? 'Hook blocked operation',
        };
      }

      // OG-7.26: Apply modifications
      if (result.modified !== undefined) {
        currentPayload = result.modified;
      }

      emitEvent('hook:fired', { hookId: hook.hookId, type: hook.type, proceed: true });
    }

    return { proceed: true, payload: currentPayload };
  }

  return { register, unregister, list, execute };
}
