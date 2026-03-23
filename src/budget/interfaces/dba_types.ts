/**
 * DBA (Deliberation & Context Budget Amendment) interface types.
 * Spec ref: DBA v1.0 Design Source (FINAL DRAFT), Architecture Freeze CF-06/CF-07/CF-10
 *
 * Phase: v3.3.0 — Budget Governance Truth Model
 * Status: FROZEN — interfaces defined before implementation.
 *
 * Implements: All TypeScript types for the DBA subsystem:
 *   §3 (16 Constitutional Invariants DBA-I1..DBA-I16),
 *   §4 (14 Pre-Schema Decisions PSD-1..PSD-14),
 *   §6 (Deliberation Accounting — Resource Extension, Accounting Modes, Estimator Contract),
 *   §7 (Context Budget Model — contextPolicy, ECB Computation, Substrate/Overhead Contracts),
 *   §8 (SC-8 Interaction),
 *   §10 (6 Failure Modes FM-DBA-01..FM-DBA-06),
 *   §12 (Schema Extension — Resource Object + InvocationAccounting 34-field record)
 *
 * Key architectural properties:
 *   - PART A (consumptive): deliberationBudget — depletes, reserves, inherits, threshold-fires
 *   - PART B (non-consumptive): contextPolicy/ECB — computed fresh per invocation, never depletes
 *   - These two surfaces MUST NEVER be collapsed. Generic resource processing loops MUST NOT
 *     apply consumptive semantics (allocated/consumed/remaining/reservation) to contextPolicy.
 *   - tokenBudget semantics NARROWED: prompt/completion only after DBA integration (DBA-I1)
 *   - Dual-source provenance with ASYMMETRIC resolution:
 *       prompt/completion → provider authoritative (DBA-I2)
 *       context window → more restrictive value wins (§7.4, PSD-12)
 *   - InvocationAccounting: 34 fields across 4 nested groups — most complex record in v3.3.0
 *
 * CROSS-SUBSYSTEM CONTRACTS:
 *   - EGP imports: DeliberationBudget (as reservable dimension via EGP-I4)
 *   - CGP imports: effectiveContextBudget (as admission ceiling via CGP-I2, Step 1)
 *   - v3.2 tokenBudget: semantics narrowed, overage field added
 *
 * Freeze items: CF-06 (Deliberation Resource), CF-07 (Context Budget Model), CF-10 (Eviction Determinism)
 */

import type {
  TaskId, MissionId, CorrelationId,
} from '../../kernel/interfaces/index.js';

// ============================================================================
// Branded ID Types — DBA-specific
// ============================================================================

/** Unique identifier for a single model invocation within a task */
export type BudgetInvocationId = string & { readonly __brand: 'BudgetInvocationId' };

/** Unique identifier for a deliberation estimator version */
export type EstimatorVersionId = string & { readonly __brand: 'EstimatorVersionId' };

// ============================================================================
// Part A: Consumptive Budget Dimension Types — DBA-I1, CF-06
// ============================================================================

/**
 * §12.1: Consumptive budget dimension with standard lifecycle semantics.
 * Used by both tokenBudget (existing, narrowed) and deliberationBudget (new).
 *
 * DBA-I13: remaining is NEVER negative. Overage is recorded separately.
 * DBA-I1: tokenBudget and deliberationBudget are INDEPENDENT dimensions.
 */
export interface ConsumptiveBudgetDimension {
  /** Tokens allocated to this mission for this dimension */
  readonly allocated: number;
  /** Tokens consumed so far in this dimension */
  readonly consumed: number;
  /** allocated - consumed, clamped to zero (DBA-I13: never negative) */
  readonly remaining: number;
  /** Consumption beyond allocated, recorded explicitly (DBA-I13) */
  readonly overage: number;
}

/**
 * §6.1: deliberationBudget — NEW consumptive governed dimension [FREEZE: CF-06].
 *
 * Tracks model reasoning effort (thinking tokens, chain-of-thought) independently
 * from prompt/completion consumption. Participates in inheritance, reservation,
 * enforcement, threshold triggers, and checkpoint participation.
 *
 * Same structural shape as tokenBudget but semantically independent (DBA-I1).
 */
export type DeliberationBudget = ConsumptiveBudgetDimension;

/**
 * §12.1: tokenBudget — EXISTING dimension, semantics NARROWED by DBA-I1.
 *
 * After DBA integration, tokenBudget governs canonical provider-facing
 * prompt/completion token consumption ONLY. No longer a proxy for total
 * model cost. Gains overage field (DBA-I13).
 *
 * Legacy harmonization flag (DBA-I1): All existing code treating tokenBudget
 * as total model cost must be updated.
 */
export type TokenBudget = ConsumptiveBudgetDimension;

// ============================================================================
// Part B: Non-Consumptive Governance Surface Types — DBA-I6, CF-07
// ============================================================================

/**
 * §7.1: contextPolicy — NEW non-consumptive governance configuration [FREEZE: CF-07].
 *
 * Constrains context admission per invocation but is NOT consumptive, reservable,
 * reclaimable, or depletable. Does NOT participate in allocated/consumed/remaining
 * semantics. No code path may apply consumption, reservation, or depletion logic
 * to contextPolicy (DBA-I6).
 *
 * DBA-I7: Frozen terminology. contextPolicy = governing configuration surface.
 * DBA-I8: Monotonic inheritance — child ceiling ≤ parent ceiling.
 * PSD-8: ceiling = null means "no additional local ceiling beyond inherited governance."
 */
export interface ContextPolicy {
  /**
   * Maximum context-admission tokens per invocation.
   * null = no local ceiling (inherited or unbounded per PSD-8).
   * Must be non-negative integer when present. Zero is valid (means
   * "no context beyond control state and overhead").
   * Negative values MUST be rejected at policy-setting time.
   */
  readonly ceiling: number | null;
}

// ============================================================================
// Resource Object Extension — §12.1
// ============================================================================

/**
 * §12.1: DBA extension fields added to the v3.2 Resource object.
 *
 * These fields are co-located on the Resource object but have fundamentally
 * different semantics:
 * - deliberationBudget: consumptive (depletes, reserves, inherits with decayFactor)
 * - contextPolicy: non-consumptive (computed fresh per invocation, inherits as ceiling)
 *
 * Implementation MUST ensure generic resource processing code does NOT apply
 * allocated/consumed/remaining/reservation logic to contextPolicy (DBA-I6).
 */
export interface DBAResourceExtension {
  /** NEW [FREEZE: CF-06]: Consumptive reasoning budget dimension */
  readonly deliberationBudget: DeliberationBudget;
  /** NEW [FREEZE: CF-07]: Non-consumptive context admission governance */
  readonly contextPolicy: ContextPolicy;
}

// ============================================================================
// Accounting Provenance Types — DBA-I2, DBA-I4, PSD-12
// ============================================================================

/**
 * DBA-I2: Provenance of prompt/completion accounting.
 * Provider-reported is authoritative when available.
 * Kernel-counted is fallback from canonical serialized payload.
 */
export type PromptCompletionProvenance = 'provider_reported' | 'kernel_counted';

/**
 * §6.2: Deliberation accounting mode — per invocation, not per model (DBA-I4).
 * Determined at invocation time based on what the provider actually returns.
 */
export type DeliberationAccountingMode = 'provider_authoritative' | 'estimated';

/**
 * §7.4: Derivation mode for availableInputWindow.
 * Provider-authoritative: provider reports usable input limit directly.
 * Kernel-derived: computed from model raw limit minus reserved completion minus deductions.
 */
export type WindowDerivationMode = 'provider_authoritative' | 'kernel_derived';

/**
 * DBA-I2: Kernel counting basis — tokenizer identity + version.
 * Sufficient to reproduce identical counts from same serialized payloads.
 */
export interface KernelCountingBasis {
  readonly tokenizer: string;
  readonly version: string;
}

// ============================================================================
// Deliberation Estimator Contract — §6.3, DBA-I3
// ============================================================================

/**
 * §6.3: Estimator input basis — recorded for audit/replay.
 * Only replay-stable recorded invocation inputs and governed configuration.
 *
 * DBA-I3 FORBIDDEN inputs: wall-clock time, response latency, queue delay,
 * retry history outside recorded transcript, hidden provider state,
 * mutable unrecorded implementation state.
 */
export interface EstimatorInputBasis {
  /** Model/provider identifier */
  readonly modelId: string;
  /** Governed reasoning mode/effort setting if applicable */
  readonly reasoningEffort: string | null;
  /** Provider-reported prompt token count */
  readonly promptTokens: number;
  /** Provider-reported completion token count */
  readonly completionTokens: number;
  /** Provider-reported total/billable tokens if available */
  readonly totalBilledTokens: number | null;
  /** Any additional replay-stable response payload fields */
  readonly additionalFields: Readonly<Record<string, unknown>> | null;
}

/**
 * §6.3: Deliberation estimator contract [FREEZE: CF-06].
 *
 * The design source specifies the CONTRACT, not the algorithm.
 * The specific algorithm is implementation freedom provided:
 * 1. Determinism: identical inputs + identical version → identical charge (DBA-I3)
 * 2. Versioning: governed identity + version, changes are auditable events
 * 3. Input restriction: only replay-stable recorded inputs (DBA-I3 forbidden list)
 * 4. Audit binding: each charge records estimator ID, version, inputs, result
 * 5. Transparency: never presented as provider-authoritative (DBA-I4)
 */
export interface DeliberationEstimator {
  /** Estimator identity — unique, governed */
  readonly estimatorId: string;
  /** Estimator version — versioned, auditable changes */
  readonly estimatorVersion: EstimatorVersionId;

  /**
   * Compute deliberation token charge from invocation inputs.
   *
   * DBA-I3: MUST be deterministic — same inputs, same version → same charge.
   * DBA-I3: MUST NOT use wall-clock time, latency, queue delay, hidden state.
   *
   * @param basis - Replay-stable invocation inputs (recorded for audit)
   * @returns Non-negative integer deliberation token charge
   */
  estimate(basis: EstimatorInputBasis): number;
}

// ============================================================================
// InvocationAccounting Record — §12.2, 34 fields across 4 nested groups
// ============================================================================

/**
 * §12.2: Prompt/completion accounting — dual-source provenance [PSD-12].
 * 11 fields.
 *
 * ASYMMETRIC RESOLUTION (Note 5):
 * - Enforcement: provider-reported is authoritative (DBA-I2)
 * - Recording: both sources recorded for verification
 * - Discrepancy: logged when both exist and differ beyond tolerance
 */
export interface PromptCompletionAccounting {
  /** Value used for budget enforcement */
  readonly chosenPromptTokens: number;
  /** Value used for budget enforcement */
  readonly chosenCompletionTokens: number;
  /** Which source was authoritative for enforcement */
  readonly provenance: PromptCompletionProvenance;
  /** Provider-reported prompt tokens, null if unavailable */
  readonly providerReportedPrompt: number | null;
  /** Provider-reported completion tokens, null if unavailable */
  readonly providerReportedCompletion: number | null;
  /** Kernel-counted prompt tokens, null if unavailable */
  readonly kernelCountedPrompt: number | null;
  /** Kernel-counted completion tokens, null if unavailable */
  readonly kernelCountedCompletion: number | null;
  /** Counting basis when kernel_counted, null when provider_reported */
  readonly kernelCountingBasis: KernelCountingBasis | null;
  /** True when both provider and kernel values exist and differ */
  readonly discrepancyDetected: boolean;
  /** |provider - kernel| for prompt, when discrepancy detected */
  readonly promptDiscrepancyAmount: number | null;
  /** |provider - kernel| for completion, when discrepancy detected */
  readonly completionDiscrepancyAmount: number | null;
}

/**
 * §12.2: Deliberation accounting.
 * 5 fields.
 *
 * Per-invocation accounting mode (DBA-I4): determined by what the provider
 * actually returns, not inferred from model name or global config.
 */
export interface DeliberationAccounting {
  /** Deliberation tokens charged (provider-authoritative or estimated) */
  readonly deliberationTokens: number;
  /** Per-invocation accounting mode */
  readonly accountingMode: DeliberationAccountingMode;
  /** Estimator identity when estimated, null when provider_authoritative */
  readonly estimatorId: string | null;
  /** Estimator version when estimated, null when provider_authoritative */
  readonly estimatorVersion: string | null;
  /** Input values used for estimate, null when provider_authoritative */
  readonly estimatorInputBasis: EstimatorInputBasis | null;
}

/**
 * §12.2: Context budget computation — dual-source provenance [PSD-12].
 * 10 fields.
 *
 * ASYMMETRIC RESOLUTION (Note 5):
 * - Context window: more restrictive value wins (§7.4)
 * - Both values recorded for verification
 * - Discrepancy logged when both exist and differ
 *
 * NOTE 2: systemOverhead = infrastructure only (system prompt, safety preamble,
 * tool definitions, pipeline metadata). NOT application control state (mission
 * objective, task definition, budgets, policies — those are CGP Position 1).
 */
export interface ContextBudgetComputation {
  /** Value used for admission — more restrictive when dual-source (§7.4) */
  readonly chosenAvailableInputWindow: number;
  /** Which source was used */
  readonly windowProvenance: WindowDerivationMode;
  /** Provider-reported window, null if unavailable */
  readonly providerReportedWindow: number | null;
  /** Kernel-derived window, null if unavailable */
  readonly kernelDerivedWindow: number | null;
  /** Kernel derivation method/version, null when provider_authoritative */
  readonly kernelDerivationVersion: string | null;
  /** True when both provider and kernel values exist and differ */
  readonly windowDiscrepancyDetected: boolean;
  /** Measured token cost of required system content (DBA-I15) */
  readonly systemOverhead: number;
  /** Computation basis/version identifier for overhead (DBA-I15) */
  readonly overheadComputationBasis: string;
  /** Effective ceiling after inheritance/merge (DBA-I12), null if no ceiling applies */
  readonly effectivePolicyCeiling: number | null;
  /** Computed result — non-negative (DBA-I14) */
  readonly effectiveContextBudget: number;
}

/**
 * §12.2: Invocation admissibility envelope — pre-invocation (PSD-7, PSD-13).
 * 3 fields.
 *
 * PSD-13: Envelope is finalized AFTER context compilation and canonical
 * serialization, BEFORE provider call. Token component uses actual serialized
 * prompt size, not pre-compilation estimate.
 *
 * PSD-11: Per-dimension vector — prompt/completion and deliberation are NEVER
 * combined into one synthetic scalar for admissibility comparison.
 */
export interface AdmissibilityEnvelope {
  /** Prompt (actual serialized) + completion allowance — post-serialization (PSD-13) */
  readonly tokenEnvelope: number;
  /** Deliberation allowance */
  readonly deliberationEnvelope: number;
  /** Admissibility result */
  readonly result: AdmissibilityResult;
}

/** Admissibility outcome — identifies failing dimension(s) */
export type AdmissibilityResult =
  | 'admitted'
  | 'rejected_token'
  | 'rejected_deliberation'
  | 'rejected_both';

/**
 * §12.2: InvocationAccounting — the complete per-invocation accounting record.
 * 34 fields across 4 nested groups + 5 top-level fields.
 *
 * This is the most complex record in v3.3.0. Each field is typed precisely.
 * Each must be populated correctly. Each must be recorded for replay (CF-10).
 */
export interface InvocationAccounting {
  // --- Top-level fields (5) ---

  /** Unique invocation identifier */
  readonly invocationId: BudgetInvocationId;
  /** Task this invocation belongs to */
  readonly taskId: TaskId;
  /** Mission this invocation belongs to */
  readonly missionId: MissionId;
  /** Non-constitutional provider billing if reported, null otherwise */
  readonly providerBilledTokens: number | null;
  /** Invocation timestamp (epoch ms) */
  readonly timestamp: number;

  // --- Nested groups (4 groups, 29 fields total) ---

  /** Prompt/completion accounting — 11 fields */
  readonly promptCompletionAccounting: PromptCompletionAccounting;
  /** Deliberation accounting — 5 fields */
  readonly deliberationAccounting: DeliberationAccounting;
  /** Context budget computation — 10 fields */
  readonly contextBudgetComputation: ContextBudgetComputation;
  /** Admissibility envelope — 3 fields */
  readonly admissibilityEnvelope: AdmissibilityEnvelope;
}

// ============================================================================
// ECB Computation Types — §7.3
// ============================================================================

/**
 * §7.3: Inputs to effectiveContextBudget computation.
 * All values must be recorded per invocation (DBA-I9) for replay.
 */
export interface ECBComputationInput {
  /** Substrate-reported context tokens available (PSD-4) */
  readonly availableInputWindow: number;
  /** How the window value was derived */
  readonly windowDerivationMode: WindowDerivationMode;
  /** Kernel derivation method/version when kernel_derived, null when provider */
  readonly kernelDerivationVersion: string | null;
  /** Token cost of required system content (DBA-I15) — infrastructure only (Note 2) */
  readonly systemOverhead: number;
  /** Overhead computation basis/version (DBA-I15) */
  readonly overheadComputationBasis: string;
  /** Most restrictive ceiling after inheritance/merge (DBA-I12), null if none */
  readonly effectivePolicyCeiling: number | null;
}

/**
 * §7.3: Result of ECB computation.
 * DBA-I14: always non-negative.
 */
export interface ECBComputationResult {
  /** The computed effective context budget — non-negative (DBA-I14) */
  readonly effectiveContextBudget: number;
  /** True if negative-normalization was applied */
  readonly wasNormalized: boolean;
  /** The raw value before normalization (may be negative) */
  readonly rawValue: number;
}

// ============================================================================
// Threshold Event Types — PSD-10, §6.1
// ============================================================================

/** Budget dimension identifier for threshold events (DBA-I1: independent) */
export type ThresholdDimension = 'token' | 'deliberation';

/** Default threshold percentages — v1 design choice, not freeze-derived law (PSD-10) */
export const DEFAULT_THRESHOLD_PERCENTAGES = [25, 50, 75, 90] as const;

export type ThresholdPercentage = typeof DEFAULT_THRESHOLD_PERCENTAGES[number];

/**
 * §6.1: Dimension-specific budget threshold event payload.
 *
 * DBA-I1: Events identify the triggering dimension. Neither dimension's
 * threshold logic references the other's state. Independent evaluation.
 *
 * DBA-I4: Events derived from estimated deliberation carry estimate marking.
 */
export interface BudgetThresholdEvent {
  /** Which dimension triggered this event */
  readonly dimension: ThresholdDimension;
  /** Threshold percentage crossed */
  readonly thresholdPercent: ThresholdPercentage;
  /** Allocated budget for this dimension */
  readonly allocated: number;
  /** Consumed at time of event */
  readonly consumed: number;
  /** Remaining at time of event */
  readonly remaining: number;
  /** For deliberation: accounting mode at time of triggering invocation */
  readonly accountingMode: DeliberationAccountingMode | null;
  /** For deliberation when estimated: estimator version */
  readonly estimatorVersion: string | null;
}

/**
 * §6.1: Dimension-specific budget exceeded event payload.
 * Emitted when remaining hits zero and overage is recorded (DBA-I13).
 */
export interface BudgetExceededEvent {
  /** Which dimension was exceeded */
  readonly dimension: ThresholdDimension;
  /** Allocated budget */
  readonly allocated: number;
  /** Total consumed (including overage-causing invocation) */
  readonly consumed: number;
  /** Overage amount (consumed - allocated) */
  readonly overage: number;
  /** Accounting mode for the triggering invocation */
  readonly accountingMode: DeliberationAccountingMode | null;
}

// ============================================================================
// Two-Phase Enforcement Types — PSD-5, §5
// ============================================================================

/**
 * §5.1 Phase 1: Pre-invocation admissibility check input.
 *
 * PSD-14: Evaluates actual invocation envelope against task's currently
 * available headroom (reserved-or-remaining), not planning-time estimates.
 */
export interface PreInvocationCheckInput {
  /** Task requesting the invocation */
  readonly taskId: TaskId;
  /** Mission owning the task */
  readonly missionId: MissionId;
  /** Token envelope: actual serialized prompt + completion allowance (PSD-13) */
  readonly tokenEnvelope: number;
  /** Deliberation envelope: deliberation allowance */
  readonly deliberationEnvelope: number;
  /** Binding 12: Correlation identifier for trace event linking (Phase 0A governance) */
  readonly correlationId: CorrelationId;
}

/**
 * §5.1 Phase 1: Pre-invocation admissibility check result.
 * DBA-I10: Joint feasibility — ALL dimensions must pass.
 */
export interface PreInvocationCheckResult {
  /** Whether the invocation is admissible */
  readonly admissible: boolean;
  /** Available token headroom (reserved-or-remaining) */
  readonly tokenHeadroom: number;
  /** Available deliberation headroom (reserved-or-remaining) */
  readonly deliberationHeadroom: number;
  /** Per-dimension pass/fail detail */
  readonly tokenPass: boolean;
  /** Per-dimension pass/fail detail */
  readonly deliberationPass: boolean;
  /** When rejected: which dimension(s) failed */
  readonly rejectionDimension: AdmissibilityResult;
}

/**
 * §5.1 Phase 2: Post-invocation reconciliation input.
 *
 * DBA-I16: Usage recorded when actually incurred at provider boundary,
 * even if invocation fails semantically.
 */
export interface PostInvocationReconciliationInput {
  readonly invocationId: BudgetInvocationId;
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  /** Actual prompt/completion from provider or kernel counting */
  readonly promptCompletionAccounting: PromptCompletionAccounting;
  /** Actual or estimated deliberation */
  readonly deliberationAccounting: DeliberationAccounting;
  /** Whether the provider call was emitted (DBA-I16) */
  readonly providerCallEmitted: boolean;
  /** Whether the provider processed tokens before error (DBA-I16) */
  readonly providerProcessedTokens: boolean;
  /** Binding 12: Correlation identifier for trace event linking (Phase 0A governance) */
  readonly correlationId: CorrelationId;
}

/**
 * §5.1 Phase 2: Post-invocation reconciliation result.
 * DBA-I13: Remaining clamped to zero, overage recorded explicitly.
 */
export interface PostInvocationReconciliationResult {
  /** Updated token budget state after reconciliation */
  readonly tokenBudgetAfter: ConsumptiveBudgetDimension;
  /** Updated deliberation budget state after reconciliation */
  readonly deliberationBudgetAfter: ConsumptiveBudgetDimension;
  /** Token threshold events that fired */
  readonly tokenThresholdEvents: readonly BudgetThresholdEvent[];
  /** Deliberation threshold events that fired */
  readonly deliberationThresholdEvents: readonly BudgetThresholdEvent[];
  /** Token exceeded event if applicable */
  readonly tokenExceededEvent: BudgetExceededEvent | null;
  /** Deliberation exceeded event if applicable */
  readonly deliberationExceededEvent: BudgetExceededEvent | null;
}

// ============================================================================
// SC-8 Extension Types — §8
// ============================================================================

/**
 * §8: SC-8 extended amount — gains deliberation dimension.
 * contextPolicy is NOT requestable through SC-8 (DBA-I6, §8).
 */
export interface SC8BudgetAmount {
  readonly tokens?: number;
  readonly deliberation?: number;
  readonly time?: number;
  readonly compute?: number;
  readonly storage?: number;
}

// ============================================================================
// Discrepancy Types — PSD-12
// ============================================================================

/**
 * PSD-12: Discrepancy event payload — logged when provider and kernel values differ.
 *
 * Asymmetric resolution:
 * - Prompt/completion: provider authoritative for enforcement
 * - Context window: more restrictive value used for admission
 */
export interface DiscrepancyEvent {
  /** Which surface has the discrepancy */
  readonly surface: 'prompt_completion' | 'context_window';
  /** Provider-reported value */
  readonly providerValue: number;
  /** Kernel-counted/derived value */
  readonly kernelValue: number;
  /** Absolute difference */
  readonly discrepancyAmount: number;
  /** Which value was used for enforcement/admission */
  readonly chosenValue: number;
  /** Why this value was chosen */
  readonly resolutionRule: 'provider_authoritative' | 'more_restrictive';
}

// ============================================================================
// System Overhead Types — §7.5, DBA-I15
// ============================================================================

/**
 * §7.5: System overhead computation basis.
 *
 * DBA-I15: Must be governed, replay-stable, versioned.
 * Not a hardcoded constant. Not dependent on hidden mutable logic.
 * Deterministic: identical system content + identical version → identical overhead.
 *
 * NOTE 2: systemOverhead = infrastructure only. NOT application control state.
 * System prompt, safety preamble, tool definitions, pipeline metadata.
 * Mission objective, task definition, budgets, policies → CGP Position 1.
 */
export interface SystemOverheadBasis {
  /** Computation method/version identifier */
  readonly computationVersion: string;
  /** Tokenizer used for measurement (if tokenizer-based) */
  readonly tokenizer: string | null;
  /** Tokenizer version */
  readonly tokenizerVersion: string | null;
}

// ============================================================================
// Service Interfaces — governance logic
// ============================================================================

/**
 * ECB computation service — §7.3.
 * Computes effectiveContextBudget per invocation from substrate-reported
 * window, kernel-determined overhead, and governance-configured ceiling.
 *
 * DBA-I5: Fresh per invocation. No cross-invocation depletion.
 * DBA-I14: Result always non-negative.
 */
export interface ECBComputationService {
  /**
   * Compute effectiveContextBudget for a single invocation.
   *
   * Formula (§7.3):
   *   if effectivePolicyCeiling present:
   *     ECB = min(availableInputWindow - systemOverhead, effectivePolicyCeiling)
   *   else:
   *     ECB = availableInputWindow - systemOverhead
   *   if ECB < 0: ECB = 0  (DBA-I14)
   */
  compute(input: ECBComputationInput): ECBComputationResult;
}

/**
 * Context policy governance — §7.1, §7.2.
 * Validates and merges context policy ceilings across mission/task hierarchy.
 */
export interface ContextPolicyGovernor {
  /**
   * DBA-I8: Validate child ceiling against parent.
   * Child ceiling ≤ parent ceiling. Widening is non-conforming.
   */
  validateInheritance(
    parentCeiling: number | null,
    childCeiling: number | null,
  ): { readonly valid: boolean; readonly reason: string | null };

  /**
   * DBA-I12: Merge applicable ceilings to find effective ceiling.
   * Returns the most restrictive ceiling from all applicable scopes.
   */
  mergeEffectiveCeiling(
    missionCeiling: number | null,
    taskCeiling: number | null,
  ): number | null;
}

/**
 * Pre-invocation admissibility service — §5.1, DBA-I10.
 * Evaluates whether a model invocation should proceed.
 *
 * DBA-I10: Joint feasibility — ALL dimensions must pass.
 * PSD-14: Evaluates against task's available headroom (reserved-or-remaining).
 */
export interface InvocationAdmissibilityService {
  /**
   * Phase 1: Pre-invocation check.
   * Evaluates token and deliberation envelope against available headroom.
   */
  checkAdmissibility(input: PreInvocationCheckInput): PreInvocationCheckResult;
}

/**
 * Post-invocation reconciliation service — §5.1 Phase 2.
 * Records actual consumption, evaluates thresholds, handles overage.
 *
 * DBA-I16: Charges usage actually incurred at provider boundary.
 * DBA-I13: Clamps remaining to zero, records overage explicitly.
 */
export interface InvocationReconciliationService {
  /**
   * Phase 2: Post-invocation reconciliation.
   * Records consumption, evaluates thresholds, handles overage.
   */
  reconcile(input: PostInvocationReconciliationInput): PostInvocationReconciliationResult;
}

/**
 * System overhead computation service — §7.5, DBA-I15.
 * Computes token cost of required system content.
 */
export interface SystemOverheadService {
  /**
   * Compute system overhead for the given system content.
   * DBA-I15: governed, replay-stable, versioned, deterministic.
   */
  computeOverhead(
    systemContent: string,
    basis: SystemOverheadBasis,
  ): number;

  /** Get the current computation basis */
  getBasis(): SystemOverheadBasis;
}

/**
 * Substrate window service — §7.4, PSD-4.
 * Provides per-invocation availableInputWindow.
 */
export interface SubstrateWindowService {
  /**
   * Get available input window for a specific model invocation.
   * PSD-4: Accounts for model raw limit, reserved completion, provider constraints.
   * PSD-12: When both provider and kernel values exist, returns both with derivation modes.
   */
  getAvailableInputWindow(modelId: string): {
    readonly chosenValue: number;
    readonly derivationMode: WindowDerivationMode;
    readonly providerReportedWindow: number | null;
    readonly kernelDerivedWindow: number | null;
    readonly kernelDerivationVersion: string | null;
    readonly discrepancyDetected: boolean;
  };
}

// ============================================================================
// DBA Facade — top-level interface
// ============================================================================

/**
 * DBA Facade — the top-level interface that subsystems import from DBA.
 *
 * DBA is upstream of EGP and CGP:
 *   EGP → imports deliberationBudget as reservable dimension
 *   CGP → imports effectiveContextBudget as admission ceiling
 */
export interface BudgetGovernanceAmendment {
  readonly ecb: ECBComputationService;
  readonly policyGovernor: ContextPolicyGovernor;
  readonly admissibility: InvocationAdmissibilityService;
  readonly reconciliation: InvocationReconciliationService;
  readonly overhead: SystemOverheadService;
  readonly window: SubstrateWindowService;
  readonly estimator: DeliberationEstimator;
}

// ============================================================================
// Error Code Constants
// ============================================================================

export const DBA_ERROR_CODES = Object.freeze({
  // Pre-invocation admissibility
  TOKEN_HEADROOM_INSUFFICIENT: 'DBA_TOKEN_HEADROOM_INSUFFICIENT',
  DELIBERATION_HEADROOM_INSUFFICIENT: 'DBA_DELIBERATION_HEADROOM_INSUFFICIENT',
  JOINT_FEASIBILITY_FAILED: 'DBA_JOINT_FEASIBILITY_FAILED',

  // Context policy
  CEILING_EXCEEDS_PARENT: 'DBA_CEILING_EXCEEDS_PARENT',
  CEILING_NEGATIVE: 'DBA_CEILING_NEGATIVE',
  CONTEXT_POLICY_NOT_REQUESTABLE: 'DBA_CONTEXT_POLICY_NOT_REQUESTABLE',

  // ECB computation
  ECB_NEGATIVE_NORMALIZED: 'DBA_ECB_NEGATIVE_NORMALIZED',
  CONTROL_STATE_OVERFLOW: 'DBA_CONTROL_STATE_OVERFLOW',

  // Accounting
  ESTIMATOR_VERSION_MISMATCH: 'DBA_ESTIMATOR_VERSION_MISMATCH',
  FORBIDDEN_ESTIMATOR_INPUT: 'DBA_FORBIDDEN_ESTIMATOR_INPUT',

  // Discrepancy
  PROMPT_COMPLETION_DISCREPANCY: 'DBA_PROMPT_COMPLETION_DISCREPANCY',
  CONTEXT_WINDOW_DISCREPANCY: 'DBA_CONTEXT_WINDOW_DISCREPANCY',

  // Silent truncation
  SILENT_TRUNCATION_ATTEMPTED: 'DBA_SILENT_TRUNCATION_ATTEMPTED',

  // v1.1 error codes (DBA defect-class v1.1 corrections)
  /** DC-DBA-811: Both provider and kernel measurement failed — no conforming accounting source */
  MEASUREMENT_FAILURE: 'DBA_MEASUREMENT_FAILURE',
  /** DC-DBA-403: Negative ceiling value rejected at policy-setting time */
  NEGATIVE_CEILING_REJECTED: 'DBA_NEGATIVE_CEILING_REJECTED',
} as const);

// ============================================================================
// Event Constants — §6.1 threshold events, discrepancy events
// ============================================================================

export const DBA_EVENTS = Object.freeze({
  // Threshold events — dimension-specific (DBA-I1)
  TOKEN_BUDGET_THRESHOLD: 'dba.token_budget_threshold',
  DELIBERATION_BUDGET_THRESHOLD: 'dba.deliberation_budget_threshold',

  // Exceeded events
  TOKEN_BUDGET_EXCEEDED: 'dba.token_budget_exceeded',
  DELIBERATION_BUDGET_EXCEEDED: 'dba.deliberation_budget_exceeded',

  // Discrepancy events (PSD-12)
  PROMPT_COMPLETION_DISCREPANCY: 'dba.prompt_completion_discrepancy',
  CONTEXT_WINDOW_DISCREPANCY: 'dba.context_window_discrepancy',

  // Accounting mode events (FM-DBA-05)
  ACCOUNTING_MODE_TRANSITION: 'dba.accounting_mode_transition',

  // Estimator events
  ESTIMATOR_VERSION_CHANGED: 'dba.estimator_version_changed',

  // ECB events
  ECB_NEGATIVE_NORMALIZED: 'dba.ecb_negative_normalized',

  // v1.1 operational events (DBA defect-class v1.1 corrections)
  /** DC-DBA-811: Both provider and kernel counting fail for prompt/completion */
  MEASUREMENT_FAILURE: 'dba.measurement_failure',
  /** DC-DBA-910: ECB=0 advisory — invocation will fail CGP admission */
  ECB_ZERO_ADVISORY: 'dba.ecb_zero_advisory',
  /** DC-DBA-306: Budget mutated between pre-check and reconciliation by external action */
  EXTERNAL_BUDGET_MUTATION_OVERAGE: 'dba.external_budget_mutation_overage',
  /** DC-DBA-901 (amended): SC-8 approval timeout — task liveness defense */
  SC8_APPROVAL_TIMEOUT: 'dba.sc8_approval_timeout',
  /** DC-DBA-909: Parent ceiling change while child tasks active */
  CEILING_CHANGE_PROPAGATION: 'dba.ceiling_change_propagation',
} as const);

// ============================================================================
// Configuration Constants — PSD defaults
// ============================================================================

/** PSD-10: Default threshold percentages for both dimensions */
export const DBA_DEFAULT_THRESHOLD_PERCENTAGES: readonly ThresholdPercentage[] = [25, 50, 75, 90];

/** v1 contextPolicy shape: ceiling only (PSD-3) */
export const CONTEXT_POLICY_V1_FIELDS = ['ceiling'] as const;

// ============================================================================
// Field Count Verification — compile-time documentation
// ============================================================================

/**
 * InvocationAccounting field count verification:
 *
 * Top-level:          5 (invocationId, taskId, missionId, providerBilledTokens, timestamp)
 * PromptCompletion:  11 (chosen×2, provenance, providerReported×2, kernelCounted×2,
 *                       kernelCountingBasis, discrepancyDetected, discrepancyAmount×2)
 * Deliberation:       5 (deliberationTokens, accountingMode, estimatorId, estimatorVersion,
 *                       estimatorInputBasis)
 * ContextBudget:     10 (chosenAvailableInputWindow, windowProvenance, providerReportedWindow,
 *                       kernelDerivedWindow, kernelDerivationVersion, windowDiscrepancyDetected,
 *                       systemOverhead, overheadComputationBasis, effectivePolicyCeiling,
 *                       effectiveContextBudget)
 * Admissibility:      3 (tokenEnvelope, deliberationEnvelope, result)
 *
 * TOTAL:             34
 */
export const INVOCATION_ACCOUNTING_FIELD_COUNT = 34 as const;
