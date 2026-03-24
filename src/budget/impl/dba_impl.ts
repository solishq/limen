/**
 * DBA Implementation — Limen v1.0
 * Spec ref: DBA v1.0 Design Source (FINAL DRAFT)
 *
 * Implements all 7 DBA service interfaces from dba_types.ts.
 * Constitutional invariants: DBA-I1 through DBA-I16.
 *
 * Architecture — Three-tier budget model:
 *
 *   1. ADMISSION TIER (module-level, PSD-14):
 *      Token reservation ledger per mission. When a pre-check passes for
 *      the token dimension, the envelope is reserved (committed), reducing
 *      headroom for future admissibility checks. Deliberation is checked
 *      but not reserved (deliberation costs are estimated, DBA-I3/DBA-I4,
 *      and therefore not suitable for hard reservation).
 *      - token=1000, deliberation=50 per mission
 *
 *   2. MISSION TIER (per-instance, PSD-10):
 *      Cumulative consumption tracker per mission within a DBA instance.
 *      Threshold events fire at [25, 50, 75, 90]% of mission allocation.
 *      - token=10000, deliberation=1000
 *
 *   3. INVOCATION TIER (per-reconcile-call, PSD-14):
 *      Fresh per-invocation budget allocation. budgetAfter and exceeded
 *      events are computed against this tier.
 *      - token=200, deliberation=100
 *
 * DBA-I1: Token and deliberation dimensions are INDEPENDENT at all tiers.
 *
 * DC-DBA-109: Reconciliation and budget deduction are atomic within the
 *             closure — no intermediate state is observable between
 *             consumption and threshold evaluation.
 */

import type {
  ECBComputationService,
  ECBComputationInput,
  ECBComputationResult,
  ContextPolicyGovernor,
  InvocationAdmissibilityService,
  PreInvocationCheckInput,
  PreInvocationCheckResult,
  InvocationReconciliationService,
  PostInvocationReconciliationInput,
  PostInvocationReconciliationResult,
  SystemOverheadService,
  SystemOverheadBasis,
  SubstrateWindowService,
  DeliberationEstimator,
  EstimatorInputBasis,
  EstimatorVersionId,
  BudgetGovernanceAmendment,
  ConsumptiveBudgetDimension,
  BudgetThresholdEvent,
  BudgetExceededEvent,
  ThresholdDimension,
  ThresholdPercentage,
  AdmissibilityResult,
  DeliberationAccountingMode,
} from '../interfaces/dba_types.js';

// ============================================================================
// Constants
// ============================================================================

const THRESHOLD_PERCENTAGES: readonly ThresholdPercentage[] = [25, 50, 75, 90];

const ESTIMATOR_ID = 'limen-dba-estimator';
const ESTIMATOR_VERSION = 'v1.0.0' as EstimatorVersionId;

const OVERHEAD_COMPUTATION_VERSION = 'limen-overhead-v1.0';

// ============================================================================
// Budget Configuration — Three-Tier Model
// ============================================================================

/** Admission tier: per-mission reservation budget (PSD-14) */
const ADMISSION_TOKEN_BUDGET = 1_000;
const ADMISSION_DELIBERATION_BUDGET = 50;

/** Mission tier: aggregate budget for threshold calculation (PSD-10) */
const MISSION_TOKEN_BUDGET = 10_000;
const MISSION_DELIBERATION_BUDGET = 1_000;

/** Invocation tier: per-reconcile fresh allocation (PSD-14, §12.1) */
const INVOCATION_TOKEN_BUDGET = 200;
const INVOCATION_DELIBERATION_BUDGET = 100;

// ============================================================================
// Internal State Types
// ============================================================================

interface DimensionState {
  allocated: number;
  consumed: number;
  firedThresholds: Set<number>;
}

function makeDimension(allocated: number, consumed: number): ConsumptiveBudgetDimension {
  const remaining = Math.max(0, allocated - consumed);
  const overage = Math.max(0, consumed - allocated);
  return Object.freeze({ allocated, consumed, remaining, overage });
}

function makeDimensionState(allocated: number): DimensionState {
  return { allocated, consumed: 0, firedThresholds: new Set() };
}

// ============================================================================
// Admission Reservation State Types (PSD-14)
// ============================================================================

/**
 * Per-instance admission reservation ledger.
 *
 * Keyed by missionId. Tracks cumulative token AND deliberation reservations
 * from admissibility checks. This state is per-instance (C-06 compliance):
 * each createDBAImpl() call produces an independent DBA with its own
 * reservation map. Two independent Limen instances never share admission state.
 *
 * Token reservations are hard commitments (exact envelope reserved).
 * Deliberation reservations enforce the hard cap: when cumulative
 * deliberation consumption exhausts the admission budget, further
 * reasoning-mode invocations are rejected at the admissibility tier
 * (pre-admission rejection, not post-hoc exceeded event).
 */
interface AdmissionState {
  tokenConsumed: number;
  deliberationConsumed: number;
}

// ============================================================================
// ECB Computation Service — §7.3, DBA-I5, DBA-I14
// ============================================================================

function createECBComputationImpl(): ECBComputationService {
  return Object.freeze({
    compute(input: ECBComputationInput): ECBComputationResult {
      // §7.3 Formula:
      //   if effectivePolicyCeiling present:
      //     ECB = min(availableInputWindow - systemOverhead, effectivePolicyCeiling)
      //   else:
      //     ECB = availableInputWindow - systemOverhead
      //   if ECB < 0: ECB = 0 (DBA-I14)
      const windowMinusOverhead = input.availableInputWindow - input.systemOverhead;
      let rawValue: number;

      if (input.effectivePolicyCeiling !== null) {
        rawValue = Math.min(windowMinusOverhead, input.effectivePolicyCeiling);
      } else {
        rawValue = windowMinusOverhead;
      }

      const wasNormalized = rawValue < 0;
      const effectiveContextBudget = wasNormalized ? 0 : rawValue;

      return Object.freeze({
        effectiveContextBudget,
        wasNormalized,
        rawValue,
      });
    },
  });
}

// ============================================================================
// Context Policy Governor — §7.1, §7.2, DBA-I8, DBA-I12
// ============================================================================

function createContextPolicyGovernorImpl(): ContextPolicyGovernor {
  return Object.freeze({
    validateInheritance(
      parentCeiling: number | null,
      childCeiling: number | null,
    ): { readonly valid: boolean; readonly reason: string | null } {
      // DBA-I8: child ceiling ≤ parent ceiling. Widening is non-conforming.
      if (childCeiling === null) {
        return Object.freeze({ valid: true, reason: null });
      }
      if (parentCeiling === null) {
        return Object.freeze({ valid: true, reason: null });
      }
      if (childCeiling <= parentCeiling) {
        return Object.freeze({ valid: true, reason: null });
      }
      return Object.freeze({
        valid: false,
        reason: `DBA-I8: child ceiling ${childCeiling} exceeds parent ceiling ${parentCeiling}`,
      });
    },

    mergeEffectiveCeiling(
      missionCeiling: number | null,
      taskCeiling: number | null,
    ): number | null {
      // DBA-I12: Most restrictive ceiling wins.
      if (missionCeiling === null && taskCeiling === null) {
        return null;
      }
      if (missionCeiling === null) {
        return taskCeiling;
      }
      if (taskCeiling === null) {
        return missionCeiling;
      }
      return Math.min(missionCeiling, taskCeiling);
    },
  });
}

// ============================================================================
// System Overhead Service — §7.5, DBA-I15
// ============================================================================

function createSystemOverheadImpl(): SystemOverheadService {
  const basis: SystemOverheadBasis = Object.freeze({
    computationVersion: OVERHEAD_COMPUTATION_VERSION,
    tokenizer: 'limen-tokenizer',
    tokenizerVersion: 'v1.0',
  });

  return Object.freeze({
    computeOverhead(systemContent: string, _basis: SystemOverheadBasis): number {
      // DBA-I15: governed, replay-stable, versioned, deterministic.
      // ~4 chars per token heuristic. Deterministic: same content = same result.
      return Math.ceil(systemContent.length / 4);
    },

    getBasis(): SystemOverheadBasis {
      return basis;
    },
  });
}

// ============================================================================
// Substrate Window Service — §7.4, PSD-4, PSD-12
// ============================================================================

function createSubstrateWindowImpl(): SubstrateWindowService {
  return Object.freeze({
    getAvailableInputWindow(_modelId: string): {
      readonly chosenValue: number;
      readonly derivationMode: 'provider_authoritative' | 'kernel_derived';
      readonly providerReportedWindow: number | null;
      readonly kernelDerivedWindow: number | null;
      readonly kernelDerivationVersion: string | null;
      readonly discrepancyDetected: boolean;
    } {
      const providerWindow: number = 128_000;
      const kernelWindow: number = 127_500;

      // PSD-12: When both exist, more restrictive (lower) value wins
      const chosenValue = Math.min(providerWindow, kernelWindow);
      const discrepancyDetected = providerWindow !== kernelWindow;

      return Object.freeze({
        chosenValue,
        derivationMode: 'provider_authoritative' as const,
        providerReportedWindow: providerWindow,
        kernelDerivedWindow: kernelWindow,
        kernelDerivationVersion: 'limen-kernel-v1.0',
        discrepancyDetected,
      });
    },
  });
}

// ============================================================================
// Deliberation Estimator — §6.3, DBA-I3
// ============================================================================

function createDeliberationEstimatorImpl(): DeliberationEstimator {
  return Object.freeze({
    estimatorId: ESTIMATOR_ID,
    estimatorVersion: ESTIMATOR_VERSION,

    estimate(basis: EstimatorInputBasis): number {
      // DBA-I3: deterministic. Same inputs + same version = same charge.
      // DBA-I3: MUST NOT use wall-clock time, latency, queue delay, hidden state.
      //
      // Input validation: negative token counts are invalid (would produce
      // negative charges, violating the non-negative integer contract).
      if (basis.completionTokens < 0) {
        throw new Error('INVALID_INPUT: completionTokens must be non-negative');
      }
      //
      // Governed algorithm v1.0:
      //   charge = ceil(completionTokens * 0.3)
      const charge = Math.ceil(basis.completionTokens * 0.3);
      return charge;
    },
  });
}

// ============================================================================
// Reconciliation Service — §5.1 Phase 2, DBA-I13, DBA-I16
// ============================================================================

/**
 * Create the reconciliation service with per-instance mission state
 * and per-invocation task budgets.
 *
 * Mission state (thresholds): cumulative within this DBA instance.
 * Task state (budgetAfter, exceeded): fresh per reconcile() call.
 */
function createInvocationReconciliationImpl(): InvocationReconciliationService {
  // Per-instance mission state for threshold tracking
  const missionStates = new Map<string, {
    token: DimensionState;
    deliberation: DimensionState;
  }>();

  return Object.freeze({
    reconcile(input: PostInvocationReconciliationInput): PostInvocationReconciliationResult {
      const missionId = input.missionId as string;

      // Get or create mission state (per-instance, cumulative for thresholds)
      let mission = missionStates.get(missionId);
      if (!mission) {
        mission = {
          token: makeDimensionState(MISSION_TOKEN_BUDGET),
          deliberation: makeDimensionState(MISSION_DELIBERATION_BUDGET),
        };
        missionStates.set(missionId, mission);
      }

      // Fresh per-invocation task budget (PSD-14)
      const taskToken: DimensionState = {
        allocated: INVOCATION_TOKEN_BUDGET,
        consumed: 0,
        firedThresholds: new Set(),
      };
      const taskDelib: DimensionState = {
        allocated: INVOCATION_DELIBERATION_BUDGET,
        consumed: 0,
        firedThresholds: new Set(),
      };

      // DBA-I16: Charge usage actually incurred at provider boundary.
      // If provider call was never emitted, the invocation was rejected before
      // reaching the provider — zero consumption regardless of reported values.
      let tokenConsumption: number;
      let deliberationConsumption: number;

      if (!input.providerCallEmitted) {
        tokenConsumption = 0;
        deliberationConsumption = 0;
      } else {
        tokenConsumption = input.promptCompletionAccounting.chosenPromptTokens
          + input.promptCompletionAccounting.chosenCompletionTokens;
        deliberationConsumption = input.deliberationAccounting.deliberationTokens;
      }

      // Record previous mission consumption for threshold crossing detection
      const prevMissionTokenConsumed = mission.token.consumed;
      const prevMissionDelibConsumed = mission.deliberation.consumed;

      // Atomically update mission tier (DC-DBA-109)
      mission.token.consumed += tokenConsumption;
      mission.deliberation.consumed += deliberationConsumption;

      // Update per-invocation task tier
      taskToken.consumed = tokenConsumption;
      taskDelib.consumed = deliberationConsumption;

      // budgetAfter reflects INVOCATION allocation (PSD-14: per-invocation headroom)
      const tokenAfter = makeDimension(taskToken.allocated, taskToken.consumed);
      const deliberationAfter = makeDimension(taskDelib.allocated, taskDelib.consumed);

      // Threshold events fire against MISSION allocation (PSD-10: aggregate thresholds)
      const tokenThresholdEvents = evaluateThresholds(
        'token',
        mission.token.allocated,
        prevMissionTokenConsumed,
        mission.token.consumed,
        mission.token.firedThresholds,
        null,
        null,
      );

      const deliberationThresholdEvents = evaluateThresholds(
        'deliberation',
        mission.deliberation.allocated,
        prevMissionDelibConsumed,
        mission.deliberation.consumed,
        mission.deliberation.firedThresholds,
        input.deliberationAccounting.accountingMode,
        input.deliberationAccounting.estimatorVersion,
      );

      // Exceeded events fire against INVOCATION allocation (per-invocation overage)
      const tokenExceededEvent = evaluateExceeded(
        'token',
        taskToken.allocated,
        0,
        taskToken.consumed,
        null,
      );

      const deliberationExceededEvent = evaluateExceeded(
        'deliberation',
        taskDelib.allocated,
        0,
        taskDelib.consumed,
        input.deliberationAccounting.accountingMode,
      );

      return Object.freeze({
        tokenBudgetAfter: tokenAfter,
        deliberationBudgetAfter: deliberationAfter,
        tokenThresholdEvents: Object.freeze(tokenThresholdEvents),
        deliberationThresholdEvents: Object.freeze(deliberationThresholdEvents),
        tokenExceededEvent,
        deliberationExceededEvent,
      });
    },
  });
}

function evaluateThresholds(
  dimension: ThresholdDimension,
  allocated: number,
  prevConsumed: number,
  newConsumed: number,
  firedSet: Set<number>,
  accountingMode: DeliberationAccountingMode | null,
  estimatorVersion: string | null,
): BudgetThresholdEvent[] {
  if (allocated <= 0) return [];

  const events: BudgetThresholdEvent[] = [];
  const prevPercent = (prevConsumed / allocated) * 100;
  const newPercent = (newConsumed / allocated) * 100;

  for (const threshold of THRESHOLD_PERCENTAGES) {
    if (newPercent >= threshold && prevPercent < threshold && !firedSet.has(threshold)) {
      firedSet.add(threshold);
      const remaining = Math.max(0, allocated - newConsumed);
      events.push(Object.freeze({
        dimension,
        thresholdPercent: threshold,
        allocated,
        consumed: newConsumed,
        remaining,
        accountingMode: dimension === 'deliberation' ? accountingMode : null,
        estimatorVersion: dimension === 'deliberation' ? estimatorVersion : null,
      }));
    }
  }

  return events;
}

function evaluateExceeded(
  dimension: ThresholdDimension,
  allocated: number,
  prevConsumed: number,
  newConsumed: number,
  accountingMode: DeliberationAccountingMode | null,
): BudgetExceededEvent | null {
  if (newConsumed > allocated && prevConsumed <= allocated) {
    return Object.freeze({
      dimension,
      allocated,
      consumed: newConsumed,
      overage: newConsumed - allocated,
      accountingMode: dimension === 'deliberation' ? accountingMode : null,
    });
  }
  return null;
}

// ============================================================================
// Admissibility Service — §5.1 Phase 1, DBA-I10, PSD-11, PSD-14
// ============================================================================

/**
 * Create the admissibility service using the per-instance reservation ledger.
 *
 * C-06: Each DBA instance owns its own reservation map. Two independent
 * createLimen() instances never share admission state.
 *
 * When tokenPass=true, the token envelope is reserved (committed).
 * When deliberationPass=true, the deliberation envelope is reserved
 * (hard cap enforcement at admissibility tier).
 */
function createInvocationAdmissibilityImpl(
  admissionReservations: Map<string, AdmissionState>,
): InvocationAdmissibilityService {
  return Object.freeze({
    checkAdmissibility(input: PreInvocationCheckInput): PreInvocationCheckResult {
      const missionId = input.missionId as string;

      // Get or create admission state for this mission
      let admission = admissionReservations.get(missionId);
      if (!admission) {
        admission = { tokenConsumed: 0, deliberationConsumed: 0 };
        admissionReservations.set(missionId, admission);
      }

      // PSD-14: headroom = admission budget - cumulative reservations
      const tokenRemaining = Math.max(0, ADMISSION_TOKEN_BUDGET - admission.tokenConsumed);
      // Deliberation: track cumulative consumption for hard cap enforcement.
      // When deliberation budget is exhausted, reasoning-mode invocations are
      // rejected at admissibility (pre-admission), not just recorded post-hoc.
      const deliberationRemaining = Math.max(0, ADMISSION_DELIBERATION_BUDGET - admission.deliberationConsumed);

      // PSD-11: Per-dimension vector — never combined into single scalar
      const tokenPass = input.tokenEnvelope <= tokenRemaining;
      const deliberationPass = input.deliberationEnvelope <= deliberationRemaining;

      // PSD-14: Reserve token envelope when token dimension passes
      if (tokenPass) {
        admission.tokenConsumed += input.tokenEnvelope;
      }

      // Reserve deliberation envelope when deliberation dimension passes.
      // Mirrors token reservation logic — pessimistic hedge for concurrent
      // admissibility checks on the same mission.
      if (deliberationPass) {
        admission.deliberationConsumed += input.deliberationEnvelope;
      }

      // DBA-I10: Joint feasibility — ALL dimensions must pass
      const admissible = tokenPass && deliberationPass;

      let rejectionDimension: AdmissibilityResult;
      if (admissible) {
        rejectionDimension = 'admitted';
      } else if (!tokenPass && !deliberationPass) {
        rejectionDimension = 'rejected_both';
      } else if (!tokenPass) {
        rejectionDimension = 'rejected_token';
      } else {
        rejectionDimension = 'rejected_deliberation';
      }

      return Object.freeze({
        admissible,
        tokenHeadroom: tokenRemaining,
        deliberationHeadroom: deliberationRemaining,
        tokenPass,
        deliberationPass,
        rejectionDimension,
      });
    },
  });
}

// ============================================================================
// DBA Facade Factory
// ============================================================================

/**
 * Create a fully functional DBA implementation.
 *
 * Three-tier budget model:
 *   - Admission tier (per-instance, C-06): token reservation ledger per mission
 *   - Mission tier (per-instance): threshold tracking per mission
 *   - Invocation tier (per-reconcile): fresh per-invocation task budget
 *
 * C-06: Every mutable state (admission reservations, mission thresholds)
 * is scoped to the DBA instance. Two createDBAImpl() calls produce
 * fully independent budget governors with no shared mutable state.
 *
 * Stateless services (ECB, PolicyGovernor, Overhead, Window, Estimator)
 * are created fresh per instance but have no mutable state.
 */
export function createDBAImpl(): BudgetGovernanceAmendment {
  // C-06: Per-instance admission reservation ledger.
  // Each createLimen() → createDBAImpl() gets its own map.
  const admissionReservations = new Map<string, AdmissionState>();

  return Object.freeze({
    ecb: createECBComputationImpl(),
    policyGovernor: createContextPolicyGovernorImpl(),
    admissibility: createInvocationAdmissibilityImpl(admissionReservations),
    reconciliation: createInvocationReconciliationImpl(),
    overhead: createSystemOverheadImpl(),
    window: createSubstrateWindowImpl(),
    estimator: createDeliberationEstimatorImpl(),
  });
}
