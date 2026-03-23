/**
 * CCP (Claim Protocol) harness — factory + wiring.
 * Spec ref: CCP v2.0 Design Source, C-07 (Object.freeze)
 *
 * Phase: v3.3.0 — Claim Protocol Truth Model
 * Status: IMPLEMENTED — delegates to src/claims/store/claim_stores.ts
 *
 * This harness is the stable import target for contract tests.
 * Implementation lives in ../store/claim_stores.ts.
 *
 * Pattern: Follows src/learning/harness/learning_harness.ts exactly.
 */

// Re-export the real implementation
export { createClaimSystem } from '../store/claim_stores.js';

/**
 * Retained for backward compatibility with contract test imports.
 * No longer thrown by any production code path.
 */
export class NotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';

  constructor(method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}
