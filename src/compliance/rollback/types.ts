// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Rollback Types
 *
 * Contract: PHASE_3_DESIGN_SOURCE.md S17 (Rollback Plan)
 * Purpose: Types for the RollbackManager.
 */

/**
 * Rollback plan -- describes what will be reverted.
 */
export interface RollbackPlan {
  readonly planId: string;
  readonly createdAt: string;
  readonly steps: readonly RollbackStep[];
  readonly estimatedDurationMs: number;
  readonly targetState: string;
}

/**
 * Individual rollback step.
 */
export interface RollbackStep {
  readonly order: number;
  readonly name: string;
  readonly description: string;
  readonly status: RollbackStepStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly error: string | null;
}

/**
 * Status of a rollback step.
 */
export type RollbackStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Overall rollback execution result.
 */
export interface RollbackResult {
  readonly planId: string;
  readonly status: 'completed' | 'failed' | 'partial';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly stepsCompleted: number;
  readonly stepsFailed: number;
  readonly requiresRca: boolean;
  readonly errors: readonly string[];
}

/**
 * Rollback verification result.
 */
export interface RollbackVerification {
  readonly verified: boolean;
  readonly checks: readonly RollbackCheck[];
  readonly overallStatus: 'pass' | 'fail' | 'partial';
}

/**
 * Individual rollback verification check.
 */
export interface RollbackCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * Rollback event types.
 */
export type RollbackEventType =
  | 'rollback:planned'
  | 'rollback:started'
  | 'rollback:step_completed'
  | 'rollback:step_failed'
  | 'rollback:completed'
  | 'rollback:failed'
  | 'rollback:verified';
