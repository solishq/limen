/**
 * EGP (Execution Governance Protocol) harness — factory + wiring.
 * Spec ref: EGP v1.0 Design Source (FINAL), Architecture Freeze CF-06/CF-11
 *
 * Phase: v3.3.0 — Execution Governance Truth Model
 *
 * This harness is the public entry point for the EGP subsystem.
 * It delegates to the real implementation in egp_stores.ts.
 * Contract tests verify behavior through this factory.
 *
 * Pattern: Follows src/learning/harness/learning_harness.ts.
 *
 * EXISTING v3.2 DEPENDENCIES (additive-only):
 *   - TaskScheduler (src/substrate/scheduler/task_scheduler.ts)
 *   - WorkerRuntime (src/substrate/workers/worker_runtime.ts)
 *   - ResourceAccounting (src/substrate/accounting/resource_accounting.ts)
 *   - CapabilityAdapterRegistry (src/substrate/adapters/capability_registry.ts)
 *   - CheckpointCoordinator (src/orchestration/checkpoints/checkpoint_coordinator.ts)
 *   All are additive-only. EGP extends, never modifies.
 *
 * SUPERSESSION: This file replaces the dead v1.2-based egp_harness.ts.
 */

import { createExecutionGovernorImpl } from '../stores/egp_stores.js';

import type {
  ExecutionGovernor,
  ExecutionGovernorDeps,
} from '../interfaces/egp_types.js';

// ============================================================================
// NotImplementedError — sentinel for pre-implementation contract tests
// ============================================================================

/**
 * Thrown by all harness methods before implementation exists.
 * Contract tests will FAIL with this error until implementation is built.
 * Retained as export for structural tests that verify against it.
 */
export class NotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';

  constructor(method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

// ============================================================================
// Factory — ExecutionGovernor
// ============================================================================

/**
 * Create the EGP ExecutionGovernor facade.
 *
 * Delegates to the real implementation in egp_stores.ts.
 * Contract tests verify behavior through this factory.
 *
 * @param deps - External dependencies (audit, events)
 * @returns Frozen ExecutionGovernor with all subsystems wired
 */
export function createExecutionGovernor(deps: ExecutionGovernorDeps): ExecutionGovernor {
  return createExecutionGovernorImpl(deps);
}
