/**
 * Phase 0A Governance Harness — Factory for the complete governance system.
 * Truth Model: Deliverables 1-12 (286 assertions)
 *
 * Phase: 0A (Foundation)
 * Status: IMPLEMENTED — all methods backed by SQLite stores.
 *
 * Pattern: Follows src/working-memory/harness/wmp_harness.ts.
 */

import type { RunStore, AttemptStore } from '../../kernel/interfaces/run_identity.js';
import type { TraceEmitter, TraceEventStore } from '../../kernel/interfaces/trace.js';
import type { MissionContractStore, ConstitutionalModeStore } from '../../kernel/interfaces/mission_contract.js';
import type { SupervisorDecisionStore, SuspensionStore, HandoffStore } from '../../kernel/interfaces/supervisor.js';
import type { TransitionEnforcer } from '../../kernel/interfaces/lifecycle.js';
import type { EvalCaseStore } from '../../kernel/interfaces/eval.js';
import type { CapabilityManifestStore } from '../../kernel/interfaces/capability_manifest.js';
import type { PayloadCanonicalizer, IdempotencyStore, ResumeTokenStore } from '../../kernel/interfaces/idempotency.js';

// Real store implementations
import {
  createRunStoreImpl,
  createAttemptStoreImpl,
  createRunSequencerImpl,
  createTraceEmitterImpl,
  createTraceEventStoreImpl,
  createMissionContractStoreImpl,
  createConstitutionalModeStoreImpl,
  createSupervisorDecisionStoreImpl,
  createSuspensionStoreImpl,
  createHandoffStoreImpl,
  createTransitionEnforcerImpl,
  createEvalCaseStoreImpl,
  createCapabilityManifestStoreImpl,
  createIdempotencyStoreImpl,
  createResumeTokenStoreImpl,
  createPayloadCanonicalizerImpl,
  setGovernanceTimeProvider,
} from '../stores/governance_stores.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';

// ============================================================================
// NotImplementedError — sentinel for pre-implementation contract tests
// ============================================================================

/**
 * Thrown by all harness methods before implementation exists.
 * Contract tests catch this to verify they FAIL correctly.
 */
export class NotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';

  constructor(method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

// ============================================================================
// GovernanceSystem — facade type for the complete governance harness
// ============================================================================

/**
 * Complete Phase 0A governance system facade.
 * All methods throw NotImplementedError until implementation exists.
 */
export interface GovernanceSystem {
  readonly runStore: RunStore;
  readonly attemptStore: AttemptStore;
  readonly traceEmitter: TraceEmitter;
  readonly traceEventStore: TraceEventStore;
  readonly contractStore: MissionContractStore;
  readonly constitutionalModeStore: ConstitutionalModeStore;
  readonly supervisorDecisionStore: SupervisorDecisionStore;
  readonly suspensionStore: SuspensionStore;
  readonly handoffStore: HandoffStore;
  readonly transitionEnforcer: TransitionEnforcer;
  readonly evalCaseStore: EvalCaseStore;
  readonly capabilityManifestStore: CapabilityManifestStore;
  readonly idempotencyStore: IdempotencyStore;
  readonly resumeTokenStore: ResumeTokenStore;
  readonly payloadCanonicalizer: PayloadCanonicalizer;
}

// ============================================================================
// Factory — creates the complete governance system with real implementations
// ============================================================================

/**
 * Create a GovernanceSystem with all real SQLite-backed implementations.
 *
 * @returns Frozen GovernanceSystem — all stores backed by SQLite
 */
export function createGovernanceSystem(time?: TimeProvider): GovernanceSystem {
  // Hard Stop #7: Inject time provider into governance module stores
  if (time) setGovernanceTimeProvider(time);
  // Wire dependency graph: TransitionEnforcer depends on SuspensionStore,
  // TraceEmitter depends on RunSequencer
  const suspensionStore = createSuspensionStoreImpl();
  const sequencer = createRunSequencerImpl();

  return Object.freeze({
    runStore: createRunStoreImpl(),
    attemptStore: createAttemptStoreImpl(),
    traceEmitter: createTraceEmitterImpl(sequencer),
    traceEventStore: createTraceEventStoreImpl(),
    contractStore: createMissionContractStoreImpl(),
    constitutionalModeStore: createConstitutionalModeStoreImpl(),
    supervisorDecisionStore: createSupervisorDecisionStoreImpl(),
    suspensionStore,
    handoffStore: createHandoffStoreImpl(),
    transitionEnforcer: createTransitionEnforcerImpl(suspensionStore),
    evalCaseStore: createEvalCaseStoreImpl(),
    capabilityManifestStore: createCapabilityManifestStoreImpl(),
    idempotencyStore: createIdempotencyStoreImpl(),
    resumeTokenStore: createResumeTokenStoreImpl(),
    payloadCanonicalizer: createPayloadCanonicalizerImpl(),
  });
}
