// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Finding-63: Plugin hooks and adapter hooks are separate extension mechanisms.
 * - Plugin hooks: Kernel-level extension points (src/plugins/)
 * - Adapter hooks: Framework-specific integration points (src/adapters/{framework}/hooks.ts)
 * These are intentionally separate -- plugin hooks extend Limen Core behavior,
 * while adapter hooks translate framework-specific events to Limen operations.
 * Integration between them occurs at the adapter level when a plugin hook
 * triggers an event that the adapter translates.
 */

/**
 * Phase 2.6 Slice 2: Hook Registry — registration, ordering, and execution.
 *
 * Stores registered hooks, executes them in priority order, and isolates
 * errors per hook. One bad hook never crashes the pipeline.
 *
 * Architecture: hook_types.ts (contract) -> hook_registry.ts (implementation)
 *
 * Invariants:
 *   - Hooks execute in priority order (lower number first, registration order for ties)
 *   - Error isolation: every hook call AND property access wrapped in try/catch
 *   - Max hooks limit is per-type (independent from plugins)
 *   - beforeAssert null return = pipeline rejection (HOOK_REJECTED)
 *   - beforeAssert return validated for required fields
 *   - Decay hooks: highest priority number wins (last in sorted order)
 *   - Decay return clamped to [0, confidence] — NaN/Infinity/negative/amplification rejected
 *   - Recall hooks: chain (output of one = input of next), defensive copy before each
 */

import type { Result } from '../kernel/interfaces/index.js';
import type { ClaimCreateInput } from '../claims/interfaces/claim_types.js';
import type {
  LimenHook,
  AssertionHookContext,
  AssertedClaimInfo,
  RecallBeliefView,
  RecallQueryContext,
} from './hook_types.js';
import { DEFAULT_HOOK_PRIORITY } from './hook_types.js';

// ── Constants ──

/** Maximum hooks per registry instance (independent from plugin limit) */
export const MAX_HOOKS = 50;

/** Maximum length for hook meta.name */
const MAX_NAME_LENGTH = 256;

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-2.6' } };
}

// ── Log Callback Type ──

export type HookLogCallback = (
  level: string,
  category: string,
  message: string,
  context?: Record<string, unknown>,
) => void;

// ── Hook Registry Interface ──

export interface HookRegistry {
  /**
   * Register all hooks from config.
   * Called once during createLimen(), before deepFreeze().
   * Individual registration failures are non-fatal (logged, skipped).
   */
  registerAll(hooks: readonly LimenHook[]): Result<void>;

  /**
   * Execute beforeAssert hooks in priority order.
   * Returns modified input, or null if any hook rejected.
   * Error-isolated: a throwing hook is skipped, pipeline continues.
   * Return value validated for required fields.
   */
  executeBeforeAssert(input: ClaimCreateInput, ctx: AssertionHookContext): Result<ClaimCreateInput | null>;

  /**
   * Execute afterAssert hooks in priority order.
   * Notification only — no return value.
   * Error-isolated: a throwing hook is logged, others continue.
   */
  executeAfterAssert(claim: AssertedClaimInfo, ctx: AssertionHookContext): void;

  /**
   * Compute decay using registered hook, or return null if no decay hook.
   * If multiple hooks define computeDecay, the one with highest priority number wins.
   * Return value clamped to [0, confidence]. NaN/Infinity/negative → null (fallback).
   * Error-isolated: falls back to null (caller uses default decay).
   */
  computeDecay(confidence: number, ageMs: number, stabilityDays: number): number | null;

  /**
   * Transform recall results through registered hooks in priority order.
   * Hooks chain: output of one = input of next. Defensive copy before each.
   * Error-isolated: a throwing hook is skipped, previous result preserved.
   * Returns null if no recall hooks registered.
   */
  transformRecall(beliefs: RecallBeliefView[], query: RecallQueryContext): RecallBeliefView[] | null;

  /** Get registered hook count */
  readonly hookCount: number;

  /** Get registered hook names */
  readonly hookNames: readonly string[];

  /** Whether any hooks are registered */
  readonly hasHooks: boolean;

  /** Whether any decay hooks are registered */
  readonly hasDecayHook: boolean;

  /** Whether any recall hooks are registered */
  readonly hasRecallHook: boolean;

  /** Whether any assertion hooks are registered */
  readonly hasAssertionHook: boolean;
}

// ── Hook Registry Dependencies ──

export interface HookRegistryDeps {
  readonly log: HookLogCallback;
}

// ── Internal Hook Entry ──

interface RegisteredHook {
  readonly hook: LimenHook;
  readonly priority: number;
  // Pre-resolved hook capabilities (safe from getter traps)
  readonly hasAssertion: boolean;
  readonly hasDecay: boolean;
  readonly hasRecall: boolean;
}

// ── Safe Property Access ──

/** Safely access a property that might be a throwing getter */
function safeGet<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ── Factory ──

/**
 * Create the hook registry.
 * Called during createLimen(), before hook registration.
 */
export function createHookRegistry(deps: HookRegistryDeps): HookRegistry {
  const { log } = deps;

  // Mutable state — lives in closure, safe after freeze
  const registered: RegisteredHook[] = [];

  // Cached sorted views for each hook type (invalidated on registration)
  let sortedAssertionHooks: RegisteredHook[] | null = null;
  let sortedDecayHooks: RegisteredHook[] | null = null;
  let sortedRecallHooks: RegisteredHook[] | null = null;

  function invalidateCaches(): void {
    sortedAssertionHooks = null;
    sortedDecayHooks = null;
    sortedRecallHooks = null;
  }

  function getSortedByPriority(filter: (h: RegisteredHook) => boolean): RegisteredHook[] {
    return registered
      .filter(filter)
      .sort((a, b) => a.priority - b.priority);
  }

  function getAssertionHooks(): RegisteredHook[] {
    if (!sortedAssertionHooks) {
      sortedAssertionHooks = getSortedByPriority(h => h.hasAssertion);
    }
    return sortedAssertionHooks;
  }

  function getDecayHooks(): RegisteredHook[] {
    if (!sortedDecayHooks) {
      sortedDecayHooks = getSortedByPriority(h => h.hasDecay);
    }
    return sortedDecayHooks;
  }

  function getRecallHooks(): RegisteredHook[] {
    if (!sortedRecallHooks) {
      sortedRecallHooks = getSortedByPriority(h => h.hasRecall);
    }
    return sortedRecallHooks;
  }

  /**
   * Validate that a beforeAssert return value has required ClaimCreateInput fields.
   * Does NOT re-run all 23 validation guards — those run downstream.
   * Guards against hooks returning partial/garbage objects.
   */
  function validateAssertReturn(value: unknown): value is ClaimCreateInput {
    if (value === null || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (typeof v.subject !== 'string' || v.subject.length === 0) return false;
    if (typeof v.predicate !== 'string' || v.predicate.length === 0) return false;
    if (v.object === null || typeof v.object !== 'object') return false;
    if (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)) return false;
    if (v.confidence < 0 || v.confidence > 1) return false;
    if (typeof v.groundingMode !== 'string' || v.groundingMode.length === 0) return false;
    return true;
  }

  /**
   * Validate hook name: non-empty, reasonable length, no control characters.
   */
  function validateName(name: string): boolean {
    if (name.length > MAX_NAME_LENGTH) return false;
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) return false;
    return true;
  }

  return {
    registerAll(hooks) {
      if (!hooks || hooks.length === 0) return ok(undefined);

      // F-005 fix: Check cumulative total, not just batch size
      if (registered.length + hooks.length > MAX_HOOKS) {
        return err('HOOK_MAX_EXCEEDED', `Cannot register ${hooks.length} hooks. Current: ${registered.length}. Maximum: ${MAX_HOOKS}.`);
      }

      for (const hook of hooks) {
        // Validate meta — wrapped in try/catch for getter trap safety (F-002)
        let name: string;
        let version: string;
        try {
          name = hook.meta?.name as string;
          version = hook.meta?.version as string;
        } catch (accessError) {
          log('error', 'hook', `Hook meta access threw: ${accessError instanceof Error ? accessError.message : String(accessError)}`);
          continue;
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
          log('error', 'hook', 'Hook has invalid meta: missing or empty name');
          continue;
        }
        if (!version || typeof version !== 'string' || version.trim() === '') {
          log('error', 'hook', `Hook '${name}' has invalid meta: missing or empty version`);
          continue;
        }

        // F-008 fix: Validate name content
        if (!validateName(name)) {
          log('error', 'hook', `Hook '${name.slice(0, 50)}...' has invalid name: too long or contains control characters`);
          continue;
        }

        // Name uniqueness
        if (registered.some(r => r.hook.meta.name === name)) {
          log('error', 'hook', `Hook name '${name}' already registered. Skipping duplicate.`);
          continue;
        }

        // F-007 fix: Validate priority
        const rawPriority = hook.priority ?? DEFAULT_HOOK_PRIORITY;
        const priority = Number.isFinite(rawPriority) ? rawPriority : DEFAULT_HOOK_PRIORITY;
        if (!Number.isFinite(rawPriority)) {
          log('warn', 'hook', `Hook '${name}' has non-finite priority (${rawPriority}), using default ${DEFAULT_HOOK_PRIORITY}`);
        }

        // F-002 fix: Pre-resolve capabilities safely (avoids getter traps in hot path)
        const hasAssertion = safeGet(() => hook.claimAssertion !== undefined, false);
        const hasDecay = safeGet(() => hook.decay?.computeDecay !== undefined, false);
        const hasRecall = safeGet(() => hook.recall?.onRecall !== undefined, false);

        registered.push({ hook, priority, hasAssertion, hasDecay, hasRecall });
        invalidateCaches();

        log('info', 'hook', `Hook '${name}@${version}' registered (priority: ${priority})`, {
          hasAssertion,
          hasDecay,
          hasRecall,
        });
      }

      return ok(undefined);
    },

    executeBeforeAssert(input, ctx) {
      const hooks = getAssertionHooks();
      let current: ClaimCreateInput = input;

      for (const entry of hooks) {
        try {
          const beforeFn = entry.hook.claimAssertion?.beforeAssert;
          if (!beforeFn) continue;

          const result = beforeFn(current, ctx);
          if (result === null) {
            log('info', 'hook', `Hook '${entry.hook.meta.name}' rejected claim assertion`, {
              subject: current.subject,
              predicate: current.predicate,
            });
            return ok(null);
          }
          // F-001 fix: Validate the returned value has required fields
          if (!validateAssertReturn(result)) {
            log('warn', 'hook', `Hook '${entry.hook.meta.name}' beforeAssert returned invalid ClaimCreateInput — skipping`, {
              hookName: entry.hook.meta.name,
            });
            // Skip this hook's modification, continue with previous current
            continue;
          }
          current = result;
        } catch (hookError) {
          log('warn', 'hook', `Hook '${entry.hook.meta.name}' beforeAssert error: ${hookError instanceof Error ? hookError.message : String(hookError)}`, {
            hookName: entry.hook.meta.name,
          });
          // Error isolation: skip this hook, continue with current input
        }
      }

      return ok(current);
    },

    executeAfterAssert(claim, ctx) {
      const hooks = getAssertionHooks();

      for (const entry of hooks) {
        try {
          const afterFn = entry.hook.claimAssertion?.afterAssert;
          if (!afterFn) continue;
          afterFn(claim, ctx);
        } catch (hookError) {
          log('warn', 'hook', `Hook '${entry.hook.meta.name}' afterAssert error: ${hookError instanceof Error ? hookError.message : String(hookError)}`, {
            hookName: entry.hook.meta.name,
          });
          // Error isolation: log and continue
        }
      }
    },

    computeDecay(confidence, ageMs, stabilityDays) {
      const hooks = getDecayHooks();
      if (hooks.length === 0) return null;

      // Highest priority number wins (last in sorted-by-priority array)
      const lastHook = hooks[hooks.length - 1]!;

      try {
        const decayFn = lastHook.hook.decay?.computeDecay;
        if (!decayFn) return null;

        const raw = decayFn(confidence, ageMs, stabilityDays);

        // F-003 fix: Clamp return value — reject NaN, Infinity, negative, amplification
        if (!Number.isFinite(raw)) return null;
        if (raw < 0) return null;
        if (raw > confidence) return null;
        return raw;
      } catch (hookError) {
        log('warn', 'hook', `Hook '${lastHook.hook.meta.name}' computeDecay error: ${hookError instanceof Error ? hookError.message : String(hookError)}`, {
          hookName: lastHook.hook.meta.name,
        });
        // Error isolation: fall back to default decay
        return null;
      }
    },

    transformRecall(beliefs, query) {
      const hooks = getRecallHooks();
      if (hooks.length === 0) return null;

      let current: RecallBeliefView[] = beliefs;

      for (const entry of hooks) {
        try {
          const recallFn = entry.hook.recall?.onRecall;
          if (!recallFn) continue;

          // F-004 fix: Defensive copy before passing to hook
          const snapshot = [...current];
          const result = recallFn(snapshot, query);
          // Only accept arrays
          if (Array.isArray(result)) {
            current = result;
          } else {
            log('warn', 'hook', `Hook '${entry.hook.meta.name}' onRecall returned non-array — skipping`);
          }
        } catch (hookError) {
          log('warn', 'hook', `Hook '${entry.hook.meta.name}' onRecall error: ${hookError instanceof Error ? hookError.message : String(hookError)}`, {
            hookName: entry.hook.meta.name,
          });
          // Error isolation: skip this hook, preserve previous result
        }
      }

      return current;
    },

    get hookCount() {
      return registered.length;
    },

    get hookNames() {
      return registered.map(r => r.hook.meta.name);
    },

    get hasHooks() {
      return registered.length > 0;
    },

    get hasDecayHook() {
      return getDecayHooks().length > 0;
    },

    get hasRecallHook() {
      return getRecallHooks().length > 0;
    },

    get hasAssertionHook() {
      return getAssertionHooks().length > 0;
    },
  };
}
