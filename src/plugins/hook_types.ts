/**
 * Phase 2.6 Slice 2: Computational Pipeline Hook Type Definitions.
 *
 * Hooks extend Limen's core computational pipelines — claim assertion,
 * decay computation, and recall result transformation. Unlike event-based
 * plugins (Phase 8) which OBSERVE, hooks INTERCEPT and can modify behavior.
 *
 * Design principles:
 *   - Hooks are OPTIONAL — if none registered, behavior is identical to current
 *   - Error isolation — one bad hook never crashes the pipeline
 *   - Priority ordering — lower priority number runs first
 *   - Synchronous execution (matches existing plugin system)
 *   - Backward compatible — existing LimenPlugin system unchanged
 */

import type { PluginMeta } from './plugin_types.js';
import type { ClaimCreateInput } from '../claims/interfaces/claim_types.js';

// ── Claim Assertion Hooks ──

/**
 * Context for assertion hooks. Subset of OperationContext plus
 * assertion-specific metadata.
 */
export interface AssertionHookContext {
  /** Agent performing the assertion */
  readonly agentId: string | null;
  /** Tenant scope */
  readonly tenantId: string | null;
  /** Mission context */
  readonly missionId: string | null;
}

/**
 * Minimal claim record passed to afterAssert hooks.
 * Avoids exposing full internal ClaimRecord.
 */
export interface AssertedClaimInfo {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly objectValue: string;
  readonly confidence: number;
  readonly groundingMode: string;
  readonly validAt: string;
  readonly createdAt: string;
}

/**
 * Hook for intercepting/modifying claim assertion.
 *
 * beforeAssert: Called between consent check and store.create().
 *   - Return modified input to change the claim being asserted
 *   - Return null to reject the assertion (pipeline returns HOOK_REJECTED)
 *   - Throw to be error-isolated (hook skipped, pipeline continues)
 *
 * afterAssert: Called after store.create() but before event emission.
 *   - Notification only — return value ignored
 *   - Throw to be error-isolated (logged, pipeline continues)
 */
export interface ClaimAssertionHook {
  readonly beforeAssert?: (claim: ClaimCreateInput, ctx: AssertionHookContext) => ClaimCreateInput | null;
  readonly afterAssert?: (claim: AssertedClaimInfo, ctx: AssertionHookContext) => void;
}

// ── Decay Hooks ──

/**
 * Hook for intercepting/replacing decay computation.
 *
 * computeDecay: Called instead of the default FSRS decay function.
 *   - Receives the same parameters as computeDecayFactor/computeEffectiveConfidence
 *   - Returns the decay factor (0.0 to 1.0)
 *   - If multiple hooks define computeDecay, the LAST one wins (chain replacement)
 *   - Throw to be error-isolated (falls back to default decay)
 *
 * Note: This does NOT modify the pure functions in cognitive/decay.ts.
 * It WRAPS them at the call sites in claim_stores.ts and convenience_layer.ts.
 */
export interface DecayHook {
  readonly computeDecay?: (confidence: number, ageMs: number, stabilityDays: number) => number;
}

// ── Recall Hooks ──

/**
 * Query context passed to recall hooks.
 */
export interface RecallQueryContext {
  readonly subject: string | undefined;
  readonly predicate: string | undefined;
  readonly minConfidence: number | undefined;
  readonly limit: number | undefined;
}

/**
 * Belief view passed to recall hooks — matches BeliefView shape
 * but typed loosely to avoid circular dependency with convenience_types.
 */
export interface RecallBeliefView {
  readonly claimId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly validAt: string;
  readonly freshness: string;
  [key: string]: unknown;
}

/**
 * Hook for intercepting/transforming recall results.
 *
 * onRecall: Called before results are returned to the caller.
 *   - Can filter, reorder, augment, or transform beliefs
 *   - Receives a mutable copy — modifications affect the result
 *   - If multiple hooks define onRecall, they chain (output of one = input of next)
 *   - Throw to be error-isolated (previous result preserved)
 */
export interface RecallHook {
  readonly onRecall?: (beliefs: RecallBeliefView[], query: RecallQueryContext) => RecallBeliefView[];
}

// ── Combined Hook Interface ──

/**
 * A Limen computational pipeline hook.
 *
 * Hooks are registered via LimenConfig.hooks[] and installed during
 * createLimen(), alongside plugins. They share the same MAX_PLUGINS limit.
 *
 * Unlike plugins (which subscribe to events), hooks intercept computation:
 *   - claimAssertion: modify/reject claims before persistence
 *   - decay: replace the FSRS decay formula
 *   - recall: transform recall results before return
 */
export interface LimenHook {
  /** Hook identity — unique name and version, reuses PluginMeta */
  readonly meta: PluginMeta;

  /** Priority for execution order. Lower number = runs first. Default: 100. */
  readonly priority?: number;

  /** Claim assertion pipeline hooks */
  readonly claimAssertion?: ClaimAssertionHook;

  /** Decay computation hook */
  readonly decay?: DecayHook;

  /** Recall result transformation hook */
  readonly recall?: RecallHook;
}

// ── Error Codes ──

export type HookErrorCode =
  | 'HOOK_INVALID_META'         // Missing name or version
  | 'HOOK_DUPLICATE_NAME'       // Hook with same name already registered
  | 'HOOK_MAX_EXCEEDED'         // Too many hooks (shared limit with plugins)
  | 'HOOK_REJECTED';            // beforeAssert returned null

/** Default hook priority */
export const DEFAULT_HOOK_PRIORITY = 100;
