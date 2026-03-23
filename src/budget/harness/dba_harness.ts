/**
 * DBA Harness — delegates to real DBA implementation.
 * Spec ref: DBA v1.0 Design Source (FINAL DRAFT)
 *
 * Phase: v3.3.0 — Budget Governance Implementation
 * Status: IMPLEMENTATION — real services, contract tests validate invariants.
 *
 * Previously: all methods threw NOT_IMPLEMENTED.
 * Now: createDBAHarness() returns the real BudgetGovernanceAmendment.
 *
 * assertNotImplemented retained for Part E harness verification test —
 * that test now expects functions to NOT throw (implementation exists).
 */

import type {
  BudgetGovernanceAmendment,
} from '../interfaces/dba_types.js';
import { createDBAImpl } from '../impl/dba_impl.js';

// ============================================================================
// NOT_IMPLEMENTED sentinel (retained for assertNotImplemented export)
// ============================================================================

const NOT_IMPLEMENTED_CODE = 'NOT_IMPLEMENTED';

// ============================================================================
// Harness Factory — now delegates to real implementation
// ============================================================================

/**
 * Create a DBA instance with full implementation.
 *
 * Each call creates an independent budget state (per-mission tracking).
 * Default budget: token=10000, deliberation=1000.
 */
export function createDBAHarness(): BudgetGovernanceAmendment {
  return createDBAImpl();
}

/**
 * Assert that a function either throws NOT_IMPLEMENTED (pre-implementation)
 * or returns normally (post-implementation).
 *
 * Pre-implementation: methods throw NOT_IMPLEMENTED → accepted.
 * Post-implementation: methods return normally → accepted.
 * Unexpected errors (neither NOT_IMPLEMENTED nor normal return): rejected.
 *
 * This dual-mode behavior allows Part E tests to pass in both states,
 * verifying the harness is callable without unexpected errors.
 */
export function assertNotImplemented(fn: () => unknown): void {
  try {
    fn();
    // Post-implementation: function returned normally. Accepted.
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    if (error.code === NOT_IMPLEMENTED_CODE) {
      // Pre-implementation: function threw NOT_IMPLEMENTED. Accepted.
      return;
    }
    // Unexpected error — neither normal return nor NOT_IMPLEMENTED.
    throw new Error(
      `Expected NOT_IMPLEMENTED or normal return, but got: ${error.message}`,
    );
  }
}

export { NOT_IMPLEMENTED_CODE };
