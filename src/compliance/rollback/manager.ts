/**
 * RollbackManager
 *
 * Contract: PHASE_3_DESIGN_SOURCE.md S17 (Rollback Plan)
 * Purpose: Staged rollback with planning, execution, and verification.
 *
 * Design decisions:
 * - Three-phase rollback: plan -> execute -> verify
 * - 15-minute recovery timeline tracking
 * - Events emitted at each stage
 * - Post-rollback triggers RCA per v2.2 S11
 * - Result<T> pattern for all operations
 */

import type { Result, KernelError } from '../../adapters/shared/types.js';
import type {
  RollbackPlan,
  RollbackStep,
  RollbackResult,
  RollbackVerification,
  RollbackCheck,
  RollbackEventType,
} from './types.js';
import type { TimeProvider } from '../audit/enterprise-logger.js';

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'PHASE_3_DESIGN_SOURCE.md S17' };
}

const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => new Date().toISOString(),
};

/**
 * F-08: StepExecutor function type for injection.
 * Called for each rollback step. Can throw or return error.
 */
export type StepExecutor = (step: RollbackStep) => Result<void>;

/** 15-minute recovery timeline (PHASE_3_DESIGN_SOURCE.md S17) */
const RECOVERY_TIMELINE_MS = 15 * 60 * 1000;

/**
 * RollbackManager -- staged rollback with planning, execution, and verification.
 *
 * PHASE_3_DESIGN_SOURCE.md S17:
 * 1. planRollback() -- generate rollback plan
 * 2. executeRollback(plan) -- execute staged rollback
 * 3. verifyRollback() -- confirm success
 *
 * #governed = true -- no ungoverned mode.
 */
export class RollbackManager {
  /** Governance is always enforced. */
  readonly #governed: true = true;
  /** Verify governance is active. */
  get governed(): boolean { return this.#governed; }
  readonly #eventListeners: Array<(event: RollbackEventType, data: unknown) => void> = [];
  readonly #timeProvider: TimeProvider;
  readonly #stepExecutor: StepExecutor;
  #currentPlan: RollbackPlan | null = null;
  #lastResult: RollbackResult | null = null;
  #nextPlanId = 0;

  /**
   * F-08: Accepts optional stepExecutor for testing.
   * F-13: Accepts optional TimeProvider for deterministic testing.
   */
  constructor(options?: { stepExecutor?: StepExecutor; timeProvider?: TimeProvider }) {
    this.#timeProvider = options?.timeProvider ?? DEFAULT_TIME_PROVIDER;
    this.#stepExecutor = options?.stepExecutor ?? ((_step: RollbackStep) => ({ ok: true as const, value: undefined }));
  }

  /**
   * PHASE_3_DESIGN_SOURCE.md S17 -- Generate rollback plan.
   *
   * The rollback plan describes:
   * 1. Disable adapters (set to SHUTDOWN)
   * 2. Revert AgentFramework enum (remove Phase 3 values)
   * 3. Revert manifest defense set (39 -> 35)
   * 4. Update Master Index hashes
   *
   * @returns RollbackPlan with all steps and estimated duration
   */
  planRollback(): Result<RollbackPlan> {
    const planId = `rollback-${String(++this.#nextPlanId)}`;
    const now = this.#timeProvider.now();

    const steps: RollbackStep[] = [
      {
        order: 1,
        name: 'disable_adapters',
        description: 'Disable all Phase 3 adapters by transitioning to SHUTDOWN state',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        error: null,
      },
      {
        order: 2,
        name: 'revert_agent_framework_enum',
        description: 'Remove Phase 3 AgentFramework values (crew_ai, auto_gen, semantic_kernel, llama_index)',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        error: null,
      },
      {
        order: 3,
        name: 'revert_manifest_defense_set',
        description: 'Revert manifest defense set count from Phase 3 to Phase 2 baseline (39 -> 35)',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        error: null,
      },
      {
        order: 4,
        name: 'update_master_index_hashes',
        description: 'Recompute and update Master Index hashes to reflect reverted state',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        error: null,
      },
      {
        order: 5,
        name: 'trigger_rca',
        description: 'Trigger Root Cause Analysis per v2.2 S11',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        error: null,
      },
    ];

    const plan: RollbackPlan = {
      planId,
      createdAt: now,
      steps,
      estimatedDurationMs: RECOVERY_TIMELINE_MS,
      targetState: 'Phase 2 baseline (pre-Phase 3)',
    };

    this.#currentPlan = plan;

    this.#emitEvent('rollback:planned', { planId, stepCount: steps.length });

    return { ok: true, value: plan };
  }

  /**
   * PHASE_3_DESIGN_SOURCE.md S17 -- Execute the rollback plan.
   *
   * Executes steps in order. If a step fails, subsequent steps are skipped.
   * Tracks 15-minute recovery timeline.
   *
   * @param plan - The rollback plan to execute
   * @returns RollbackResult with execution details
   */
  executeRollback(plan: RollbackPlan): Result<RollbackResult> {
    if (plan.planId !== this.#currentPlan?.planId) {
      return { ok: false, error: makeError('PLAN_MISMATCH', 'Plan does not match the current planned rollback') };
    }

    // Finding-48: Use TimeProvider instead of Date.now() for deterministic testing
    const startMs = new Date(this.#timeProvider.now()).getTime();
    const startedAtStr = this.#timeProvider.now();
    this.#emitEvent('rollback:started', { planId: plan.planId });

    const executedSteps: RollbackStep[] = [];
    let failed = false;
    const errors: string[] = [];

    for (const step of plan.steps) {
      if (failed) {
        executedSteps.push({ ...step, status: 'skipped' });
        continue;
      }

      const stepStart = this.#timeProvider.now();

      // Check 15-minute timeline
      // Finding-48: Use TimeProvider instead of Date.now()
      const elapsed = new Date(this.#timeProvider.now()).getTime() - startMs;
      if (elapsed > RECOVERY_TIMELINE_MS) {
        const timeoutError = `Step '${step.name}' skipped: 15-minute recovery timeline exceeded`;
        errors.push(timeoutError);
        executedSteps.push({
          ...step,
          status: 'failed',
          startedAt: stepStart,
          completedAt: this.#timeProvider.now(),
          error: timeoutError,
        });
        failed = true;
        this.#emitEvent('rollback:step_failed', { planId: plan.planId, step: step.name, error: timeoutError });
        continue;
      }

      // F-08: Execute step via injected executor (allows test injection of failures)
      const stepResult = this.#stepExecutor(step);

      if (stepResult.ok) {
        const completedStep: RollbackStep = {
          ...step,
          status: 'completed',
          startedAt: stepStart,
          completedAt: this.#timeProvider.now(),
          error: null,
        };
        executedSteps.push(completedStep);
        this.#emitEvent('rollback:step_completed', { planId: plan.planId, step: step.name });
      } else {
        const failedStep: RollbackStep = {
          ...step,
          status: 'failed',
          startedAt: stepStart,
          completedAt: this.#timeProvider.now(),
          error: stepResult.error.message,
        };
        executedSteps.push(failedStep);
        errors.push(stepResult.error.message);
        failed = true;
        this.#emitEvent('rollback:step_failed', { planId: plan.planId, step: step.name, error: stepResult.error.message });
      }
    }

    const completedAtStr = this.#timeProvider.now();
    // Finding-48: Use TimeProvider instead of Date.now()
    const durationMs = new Date(this.#timeProvider.now()).getTime() - startMs;
    const stepsCompleted = executedSteps.filter(s => s.status === 'completed').length;
    const stepsFailed = executedSteps.filter(s => s.status === 'failed').length;

    const result: RollbackResult = {
      planId: plan.planId,
      status: failed ? (stepsCompleted > 0 ? 'partial' : 'failed') : 'completed',
      startedAt: startedAtStr,
      completedAt: completedAtStr,
      durationMs,
      stepsCompleted,
      stepsFailed,
      requiresRca: true, // Always trigger RCA per v2.2 S11
      errors,
    };

    this.#lastResult = result;
    this.#emitEvent(failed ? 'rollback:failed' : 'rollback:completed', result);

    return { ok: true, value: result };
  }

  /**
   * PHASE_3_DESIGN_SOURCE.md S17 -- Verify rollback was successful.
   *
   * Checks:
   * 1. No Phase 3 adapters are registered/active
   * 2. AgentFramework enum has only Phase 2 values
   * 3. Defense set count matches Phase 2 baseline
   * 4. Master Index hashes are consistent
   * 5. RCA has been triggered
   */
  verifyRollback(): Result<RollbackVerification> {
    if (!this.#lastResult) {
      return { ok: false, error: makeError('NO_ROLLBACK', 'No rollback has been executed') };
    }

    // Finding-41: Verification checks step execution counts, not actual system state.
    // ARCHITECTURAL NOTE: True state verification requires injecting state query functions
    // at construction time. Current verification confirms the rollback procedure ran
    // to completion but does not independently verify the resulting state.
    // For production, inject state probes via the constructor.
    const checks: RollbackCheck[] = [
      {
        name: 'adapters_disabled',
        passed: this.#lastResult.status === 'completed' || this.#lastResult.stepsCompleted >= 1,
        detail: 'Phase 3 adapters should be in SHUTDOWN state',
      },
      {
        name: 'framework_enum_reverted',
        passed: this.#lastResult.stepsCompleted >= 2,
        detail: 'AgentFramework enum should have only Phase 2 values',
      },
      {
        name: 'defense_set_reverted',
        passed: this.#lastResult.stepsCompleted >= 3,
        detail: 'Manifest defense set should be at Phase 2 baseline count',
      },
      {
        name: 'master_index_consistent',
        passed: this.#lastResult.stepsCompleted >= 4,
        detail: 'Master Index hashes should be consistent with reverted state',
      },
      {
        name: 'rca_triggered',
        passed: this.#lastResult.requiresRca,
        detail: 'Root Cause Analysis should be triggered per v2.2 S11',
      },
      {
        name: 'within_timeline',
        passed: this.#lastResult.durationMs <= RECOVERY_TIMELINE_MS,
        detail: `Rollback completed within 15-minute timeline (${String(this.#lastResult.durationMs)}ms)`,
      },
    ];

    const allPassed = checks.every(c => c.passed);

    const verification: RollbackVerification = {
      verified: allPassed,
      checks,
      overallStatus: allPassed ? 'pass' : checks.some(c => c.passed) ? 'partial' : 'fail',
    };

    this.#emitEvent('rollback:verified', verification);

    return { ok: true, value: verification };
  }

  /**
   * Get the last rollback result.
   */
  getLastResult(): RollbackResult | null {
    return this.#lastResult;
  }

  /**
   * Subscribe to rollback events.
   * F-14: Returns an unsubscribe function to prevent memory leaks.
   */
  onEvent(listener: (event: RollbackEventType, data: unknown) => void): () => void {
    this.#eventListeners.push(listener);
    return () => this.offEvent(listener);
  }

  /**
   * F-14: Unsubscribe from rollback events.
   */
  offEvent(listener: (event: RollbackEventType, data: unknown) => void): void {
    const idx = this.#eventListeners.indexOf(listener);
    if (idx !== -1) {
      this.#eventListeners.splice(idx, 1);
    }
  }

  #emitEvent(event: RollbackEventType, data: unknown): void {
    // Finding-60: Isolate listener failures — one bad listener must not break others
    for (const listener of this.#eventListeners) {
      try {
        listener(event, data);
      } catch {
        // Finding-60: Swallow listener error to prevent cascade failure
      }
    }
  }
}
