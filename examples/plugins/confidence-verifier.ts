/**
 * Reference Plugin: Confidence Verifier
 *
 * Demonstrates ClaimAssertionHook — blocks claims with
 * effectiveConfidence below a configurable threshold.
 *
 * Usage:
 *   import { confidenceVerifier } from './confidence-verifier.js';
 *   const limen = await createLimen({
 *     hooks: [confidenceVerifier({ minConfidence: 0.7 })],
 *   });
 */

import type { LimenHook } from '../../src/plugins/hook_types.js';

export interface ConfidenceVerifierOptions {
  /** Minimum confidence required. Claims below this are rejected. Default: 0.5 */
  readonly minConfidence?: number;
  /** Predicates to exempt from the check. */
  readonly exemptPredicates?: readonly string[];
}

export function confidenceVerifier(options: ConfidenceVerifierOptions = {}): LimenHook {
  const minConfidence = options.minConfidence ?? 0.5;
  const exemptPredicates = new Set(options.exemptPredicates ?? []);

  return {
    meta: { name: 'confidence-verifier', version: '1.0.0' },
    priority: 10,
    claimAssertion: {
      beforeAssert(claim, _ctx) {
        if (exemptPredicates.has(claim.predicate)) {
          return claim;
        }
        // F-009 fix: NaN fails the check (NaN >= x is false)
        if (!(claim.confidence >= minConfidence)) {
          return null; // Reject — pipeline returns HOOK_REJECTED
        }
        return claim;
      },
    },
  };
}
