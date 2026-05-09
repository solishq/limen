// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1
/**
 * Decommission Cascade
 *
 * LM-14.13 through LM-14.20: Atomic 7-step decommission cascade.
 * This module documents the cascade steps executed by decommissionAgent().
 *
 * The cascade executes atomically within a single SQLite transaction:
 *
 * Step 1: Validate agent exists and is not already decommissioned (LM-14.14)
 * Step 2: Close all active sessions (LM-14.15)
 * Step 3: Revoke all capabilities (LM-14.17)
 * Step 4: Revoke all consent records (LM-14.16)
 * Step 5: Archive or tombstone all agent claims (LM-14.18)
 * Step 6: Remove from active adapter registrations (LM-14.19)
 * Step 7: Set state to decommissioned, record reason and timestamp (LM-14.20)
 *
 * Failure mode defense:
 * - FM-SM-07: decommission without cleanup prevented by atomic cascade
 * - FM-CC-07: concurrent decommission and operation prevented by SQLite
 *   transaction serializing the state change
 *
 * Implementation note: The cascade logic lives inline in
 * agent_lifecycle_client.ts#decommissionAgent() to keep it within the
 * same transaction scope. This module provides documentation and types.
 */

/** Cascade step names for audit and telemetry */
export const DECOMMISSION_STEPS = [
  'validate_state',         // Step 1: LM-14.14
  'terminate_sessions',     // Step 2: LM-14.15
  'revoke_consents',        // Step 3: LM-14.16
  'revoke_capabilities',    // Step 4: LM-14.17
  'archive_knowledge',      // Step 5: LM-14.18
  'remove_from_active',     // Step 6: LM-14.19
  'emit_event',             // Step 7: LM-14.20
] as const;

export type DecommissionStep = typeof DECOMMISSION_STEPS[number];

/** Cascade step result for telemetry */
export interface CascadeStepResult {
  readonly step: DecommissionStep;
  readonly success: boolean;
  readonly duration: number; // ms
  readonly itemsProcessed: number;
  readonly error?: string;
}

/** Full cascade result */
export interface CascadeResult {
  readonly steps: readonly CascadeStepResult[];
  readonly totalDuration: number; // ms
  readonly success: boolean;
}
