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
 *   - Error isolation: every hook call wrapped in try/catch
 *   - Max hooks limit shared with MAX_PLUGINS (resource containment)
 *   - beforeAssert null return = pipeline rejection (HOOK_REJECTED)
 *   - Decay hooks: last one wins (chain replacement)
 *   - Recall hooks: chain (output of one = input of next)
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
import { MAX_PLUGINS } from './plugin_types.js';

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
   * If multiple hooks define computeDecay, the last one (by priority) wins.
   * Error-isolated: falls back to null (caller uses default decay).
   */
  computeDecay(confidence: number, ageMs: number, stabilityDays: number): number | null;

  /**
   * Transform recall results through registered hooks in priority order.
   * Hooks chain: output of one = input of next.
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
      sortedAssertionHooks = getSortedByPriority(
        h => h.hook.claimAssertion !== undefined,
      );
    }
    return sortedAssertionHooks;
  }

  function getDecayHooks(): RegisteredHook[] {
    if (!sortedDecayHooks) {
      sortedDecayHooks = getSortedByPriority(
        h => h.hook.decay?.computeDecay !== undefined,
      );
    }
    return sortedDecayHooks;
  }

  function getRecallHooks(): RegisteredHook[] {
    if (!sortedRecallHooks) {
      sortedRecallHooks = getSortedByPriority(
        h => h.hook.recall?.onRecall !== undefined,
      );
    }
    return sortedRecallHooks;
  }

  return {
    registerAll(hooks) {
      if (!hooks || hooks.length === 0) return ok(undefined);

      // Resource containment: shared limit with plugins
      if (hooks.length > MAX_PLUGINS) {
        return err('HOOK_MAX_EXCEEDED', `Cannot register ${hooks.length} hooks. Maximum is ${MAX_PLUGINS}.`);
      }

      for (const hook of hooks) {
        // Validate meta
        if (!hook.meta?.name || typeof hook.meta.name !== 'string' || hook.meta.name.trim() === '') {
          log('error', 'hook', 'Hook has invalid meta: missing or empty name', { meta: hook.meta as unknown as Record<string, unknown> });
          continue;
        }
        if (!hook.meta?.version || typeof hook.meta.version !== 'string' || hook.meta.version.trim() === '') {
          log('error', 'hook', `Hook '${hook.meta.name}' has invalid meta: missing or empty version`, { meta: hook.meta as unknown as Record<string, unknown> });
          continue;
        }

        // Name uniqueness
        if (registered.some(r => r.hook.meta.name === hook.meta.name)) {
          log('error', 'hook', `Hook name '${hook.meta.name}' already registered. Skipping duplicate.`);
          continue;
        }

        const priority = hook.priority ?? DEFAULT_HOOK_PRIORITY;
        registered.push({ hook, priority });
        invalidateCaches();

        log('info', 'hook', `Hook '${hook.meta.name}@${hook.meta.version}' registered (priority: ${priority})`, {
          hasAssertion: hook.claimAssertion !== undefined,
          hasDecay: hook.decay?.computeDecay !== undefined,
          hasRecall: hook.recall?.onRecall !== undefined,
        });
      }

      return ok(undefined);
    },

    executeBeforeAssert(input, ctx) {
      const hooks = getAssertionHooks();
      let current: ClaimCreateInput = input;

      for (const entry of hooks) {
        const beforeFn = entry.hook.claimAssertion?.beforeAssert;
        if (!beforeFn) continue;

        try {
          const result = beforeFn(current, ctx);
          if (result === null) {
            log('info', 'hook', `Hook '${entry.hook.meta.name}' rejected claim assertion`, {
              subject: current.subject,
              predicate: current.predicate,
            });
            return ok(null);
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
        const afterFn = entry.hook.claimAssertion?.afterAssert;
        if (!afterFn) continue;

        try {
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

      // Last hook wins (highest priority number among sorted = last in array)
      const lastHook = hooks[hooks.length - 1]!;
      const decayFn = lastHook.hook.decay?.computeDecay;
      if (!decayFn) return null;

      try {
        return decayFn(confidence, ageMs, stabilityDays);
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
        const recallFn = entry.hook.recall?.onRecall;
        if (!recallFn) continue;

        try {
          current = recallFn(current, query);
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
