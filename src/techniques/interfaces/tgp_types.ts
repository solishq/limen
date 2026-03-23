/**
 * TGP (Technique Governance Protocol) — Frozen Type Definitions
 * Spec ref: TGP v1.0 Design Source (FINAL), Architecture Freeze CF-12/CF-13
 *
 * Phase: v3.3.0 — Technique Governance Truth Model
 * Status: FROZEN — derived from design source, no implementation exists.
 *
 * This file defines every type, interface, error code, event, and constant
 * for the technique governance protocol. Every field traces to a design
 * source section or a resolved ambiguity.
 *
 * EXISTING v3.2 DEPENDENCIES (additive-only):
 *   - TechniqueStore (src/learning/store/technique_store.ts)
 *   - TechniqueApplicator (src/learning/applicator/technique_applicator.ts)
 *   - QuarantineManager (src/learning/quarantine/quarantine_manager.ts)
 *   - ColdStartManager (src/learning/cold_start/cold_start_manager.ts)
 *   - CrossAgentTransfer (src/learning/transfer/cross_agent_transfer.ts)
 *   All are additive-only. TGP extends, never modifies.
 *
 * LAYER ISOLATION: TGP defines its own TGPTechniqueStatus independently
 * from v3.2's TechniqueStatus. Implementation amendment will reconcile.
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  OperationContext,
  Result,
  TenantId,
  AgentId,
  MissionId,
} from '../../kernel/interfaces/index.js';

import type { TechniqueId } from '../../learning/interfaces/learning_types.js';

// Re-export for convenience
export type { TechniqueId } from '../../learning/interfaces/learning_types.js';

// ============================================================================
// Branded Types
// ============================================================================

/** Unique identifier for a technique evaluation record. [§6.2] */
export type EvaluationId = string & { readonly __brand: 'EvaluationId' };

/** Unique identifier for a technique promotion decision record. [§6.3, CF-13] */
export type PromotionDecisionId = string & { readonly __brand: 'PromotionDecisionId' };

// ============================================================================
// Union Types
// ============================================================================

/**
 * Extended technique status with candidate state. [CF-12, §5.1]
 *
 * v3.2 has 3 states: active | suspended | retired.
 * TGP adds: candidate — unvalidated, not applied at inference.
 *
 * Defined independently from v3.2's TechniqueStatus per layer isolation.
 * Implementation amendment will extend v3.2's type.
 */
export type TGPTechniqueStatus = 'candidate' | 'active' | 'suspended' | 'retired';

/**
 * Provenance kind — how the technique entered the system. [§8]
 *
 * local_extraction: Extracted from agent's own interactions (§30).
 * cross_agent_transfer: Received from another agent (§29.8).
 * template_seed: Seeded from cold-start template (§29.9).
 */
export type TechniqueProvenanceKind =
  | 'local_extraction'
  | 'cross_agent_transfer'
  | 'template_seed';

/**
 * Evaluation source — how evaluation evidence was produced. [§6.2]
 *
 * runtime: Evaluation conducted during production execution.
 * template: Pre-populated evidence from template author (PSD-1).
 * transfer_history: Evidence from source agent's history (§29.8).
 * manual: Human-provided evaluation (HITL review).
 *
 * Trust principle [§6.2]: transfer_history alone CANNOT satisfy
 * the promotion gate. At least one evaluation with source ∈
 * {runtime, template, manual} is required. [AMB-03]
 */
export type EvaluationSource = 'runtime' | 'template' | 'transfer_history' | 'manual';

/**
 * Evaluation method — how the evaluation was conducted. [§6.2, PSD-2]
 *
 * The method is implementation freedom (PSD-2). These are the v1-defined
 * methods; future amendments may add more.
 */
export type EvaluationMethod =
  | 'shadow_execution'
  | 'dedicated_task'
  | 'retrospective'
  | 'human_review'
  | 'template_provided';

/**
 * Promotion decision result. [§6.3]
 *
 * promoted: Technique advanced to active status.
 * rejected: Promotion denied — reason recorded.
 */
export type PromotionResult = 'promoted' | 'rejected';

/**
 * Extended retirement reason — v3.2 reasons plus TGP additions. [§8, AMB-01]
 *
 * v3.2 reasons (§29.6): low_success_rate, low_confidence, stale, human_flagged.
 * TGP additions: candidate_expiry (TGP-I6), quarantine_permanent (§29.7).
 *
 * The design source uses 'threshold' as a category for v3.2's first three
 * and 'manual' for 'human_flagged'. We preserve v3.2's granularity.
 */
export type TGPRetiredReason =
  | 'low_success_rate'          // §29.6: success_rate < 0.3 over 50+ apps
  | 'low_confidence'            // §29.6: confidence < 0.2 after 20+ apps
  | 'stale'                     // §29.6: not applied in 90 days
  | 'human_flagged'             // §29.6: HITL batch-review
  | 'candidate_expiry'          // TGP-I6: candidate not promoted within retention period
  | 'quarantine_permanent';     // §29.7: quarantine resolved with permanent retirement

// ============================================================================
// State Transitions [§5.1, TGP-I2]
// ============================================================================

/**
 * Valid status transitions per TGP-I2. [CF-12, §5.1]
 *
 * candidate → active:    Promotion gate (TGP-I3)
 * candidate → retired:   Lifecycle bound expiry or manual (TGP-I6)
 * active → suspended:    Quarantine (I-10) or manual
 * active → retired:      §29.6 threshold or manual
 * suspended → active:    Restoration (CF-01, explicit governed action)
 * suspended → retired:   Retirement from suspension
 * retired → []:          Terminal — no transitions out
 *
 * No backward transitions to candidate. No skip from candidate to suspended.
 */
export const TGP_STATUS_TRANSITIONS: Readonly<Record<TGPTechniqueStatus, readonly TGPTechniqueStatus[]>> = {
  candidate: ['active', 'retired'],
  active: ['suspended', 'retired'],
  suspended: ['active', 'retired'],
  retired: [],
} as const;

// ============================================================================
// Domain Objects
// ============================================================================

/**
 * Extended Technique with TGP fields. [§8]
 *
 * This is the v3.3 technique schema. All v3.2 fields preserved.
 * New fields added per §8 mutability contract.
 */
export interface TGPTechnique {
  // ── Existing v3.2 fields (unchanged) ──
  readonly id: TechniqueId;
  readonly tenantId: TenantId;
  readonly agentId: AgentId;
  /** Immutable after creation. [TGP-I1] */
  readonly type: 'prompt_fragment' | 'decision_rule' | 'rag_pattern';
  /** Immutable after creation. [TGP-I1] */
  readonly content: string;
  /** Immutable after creation. Plural. [TGP-I1, §8] */
  readonly sourceMemoryIds: readonly string[];
  /**
   * Production confidence — EMA-updated during active use (§29.5).
   * Initialized from promotion evaluation's confidenceScore. [§5.3]
   * Meaningless for candidates. [§8]
   */
  readonly confidence: number;
  /**
   * Success rate — null until sufficient production applications. [§8, AMB-05]
   * Type changed from v3.2's `number` to `number | null`.
   * null = insufficient applications for meaningful computation.
   */
  readonly successRate: number | null;
  readonly applicationCount: number;
  readonly lastApplied: string | null;
  readonly lastUpdated: string;
  readonly createdAt: string;

  // ── Modified field ──
  /** Extended with 'candidate' state. [CF-12, §5.1] */
  readonly status: TGPTechniqueStatus;

  // ── New TGP fields ──
  /** How the technique entered the system. [§8] */
  readonly provenanceKind: TechniqueProvenanceKind;
  /**
   * Quarantine promotion block. [TGP-I5, PSD-4]
   * Set when any source memory is quarantined.
   * Cleared when ALL source memories are non-quarantined.
   * While non-null, promotion is BLOCKED.
   * Only meaningful for candidates — active techniques use status-based quarantine.
   */
  readonly quarantinedAt: string | null;
  /** Timestamp of promotion. null while candidate. [§5.3] */
  readonly promotedAt: string | null;
  /** Reference to successful promotion decision. null while candidate. [§6.3] */
  readonly promotionDecisionId: PromotionDecisionId | null;
  /** Source technique ID for cross-agent transfers. null for non-transfers. [§8] */
  readonly transferSourceTechniqueId: TechniqueId | null;
  /** Retirement timestamp. null while non-retired. [§8] */
  readonly retiredAt: string | null;
  /** Retirement reason. null while non-retired. [§8, AMB-01] */
  readonly retiredReason: TGPRetiredReason | null;
}

/**
 * Technique evaluation record. [§6.2, PSD-2]
 *
 * A single evaluation run comparing baseline vs technique performance.
 * Multiple evaluations may exist per technique.
 * Immutable after creation.
 */
export interface TechniqueEvaluation {
  readonly id: EvaluationId;
  readonly techniqueId: TechniqueId;
  readonly agentId: AgentId;
  /** FM-10: direct tenant predicate. [§6.2] */
  readonly tenantId: TenantId;
  /** Agent who conducted the evaluation. [§6.2] */
  readonly evaluatorAgentId: AgentId;
  /** Mission context if evaluation ran within a mission. [§6.2] */
  readonly missionId: MissionId | null;
  /** How the evaluation evidence was produced. [§6.2] */
  readonly evaluationSource: EvaluationSource;
  /**
   * Baseline performance metrics. [§6.2]
   * Structure is implementation freedom (PSD-2).
   */
  readonly baselinePerformance: Readonly<Record<string, unknown>>;
  /**
   * Technique performance metrics. [§6.2]
   * Structure is implementation freedom (PSD-2).
   */
  readonly techniquePerformance: Readonly<Record<string, unknown>>;
  /**
   * Comparative analysis result. [§6.2]
   * Structure is implementation freedom (PSD-2).
   */
  readonly comparisonResult: Readonly<Record<string, unknown>>;
  /**
   * Confidence score from evaluation. [§6.2]
   * null for non-numeric evaluations (e.g., human_review with qualitative assessment).
   * Seeds production confidence at promotion time. [§5.3, AMB-04]
   */
  readonly confidenceScore: number | null;
  /** Evaluation method used. [§6.2, PSD-2] */
  readonly evaluationMethod: EvaluationMethod;
  readonly createdAt: string;
}

/**
 * Technique promotion decision — CF-13 audit artifact. [§6.3]
 *
 * The governance record capturing the decision to promote or reject.
 * Exactly one per promotion. Multiple rejected decisions may exist.
 * IMMUTABLE after creation.
 *
 * Must be sufficient for an independent verifier to reconstruct why
 * the promotion was permitted without consulting live mutable state.
 */
export interface TechniquePromotionDecision {
  readonly id: PromotionDecisionId;
  readonly techniqueId: TechniqueId;
  readonly agentId: AgentId;
  /** FM-10: direct tenant predicate. [§6.3] */
  readonly tenantId: TenantId;
  /** Actor who initiated the decision. [§6.3] */
  readonly decidedBy: string;

  // ── CF-13 required fields ──
  /** ALL evaluations considered in the decision. [TGP-I4 req 1] */
  readonly evaluationLineage: readonly EvaluationId[];
  /** Confidence threshold governing the decision. null for non-numeric rules. [TGP-I4 req 3] */
  readonly confidenceThreshold: number | null;
  /** Description of the decision rule applied. Always present. [TGP-I4 req 3] */
  readonly decisionRule: string;
  /** Specific evidence that satisfied the criterion. [TGP-I4 req 4] */
  readonly activationBasis: Readonly<Record<string, unknown>>;
  /** Promotion policy version. [TGP-I4 req 5] */
  readonly policyVersion: string;
  /** Evaluation schema version. [TGP-I4 req 5] */
  readonly evaluationSchemaVersion: string;
  /** Threshold configuration version. [TGP-I4 req 5] */
  readonly thresholdConfigVersion: string;

  /** Promotion result. [§6.3] */
  readonly result: PromotionResult;
  /** Reason for rejection. null when promoted. [§6.3] */
  readonly rejectionReason: string | null;
  /** When the decision was made. [§6.3] */
  readonly decidedAt: string;
  /** When status changed to active. null if rejected. [§6.3] */
  readonly activatedAt: string | null;
}

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a technique evaluation. [§6.2]
 */
export interface EvaluationCreateInput {
  readonly techniqueId: TechniqueId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly evaluatorAgentId: AgentId;
  readonly missionId: MissionId | null;
  readonly evaluationSource: EvaluationSource;
  readonly baselinePerformance: Readonly<Record<string, unknown>>;
  readonly techniquePerformance: Readonly<Record<string, unknown>>;
  readonly comparisonResult: Readonly<Record<string, unknown>>;
  readonly confidenceScore: number | null;
  readonly evaluationMethod: EvaluationMethod;
}

/**
 * Input for attempting technique promotion. [§7.1, TGP-I3]
 *
 * The promotion gate validates: evaluation evidence exists (TGP-I3),
 * threshold met (configurable), quarantinedAt is null (TGP-I5),
 * CF-13 audit fields populated (TGP-I4).
 */
export interface PromotionAttemptInput {
  readonly techniqueId: TechniqueId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  /** Actor initiating promotion. [§7.2] */
  readonly decidedBy: string;
  /** Specific evaluations to reference. If empty, uses all available. [§6.3] */
  readonly evaluationIds: readonly EvaluationId[];
  /** Confidence threshold for this attempt. [TGP-I4 req 3] */
  readonly confidenceThreshold: number | null;
  /** Decision rule description. [TGP-I4 req 3] */
  readonly decisionRule: string;
  /** Policy version identifiers. [TGP-I4 req 5] */
  readonly policyVersion: string;
  readonly evaluationSchemaVersion: string;
  readonly thresholdConfigVersion: string;
}

/**
 * Input for retiring a candidate technique. [TGP-I6]
 */
export interface CandidateRetirementInput {
  readonly techniqueId: TechniqueId;
  readonly tenantId: TenantId;
  readonly reason: 'candidate_expiry' | 'manual';
  /** Actor identity for audit. [TGP-I6] */
  readonly actorId: string;
  /** Policy version for expiry-based retirement. null for manual. [TGP-I6] */
  readonly retentionPolicyVersion: string | null;
}

/**
 * Input for atomic template registration. [PSD-1, §29.9]
 *
 * All 6 operations in one transaction:
 * 1. Create technique as candidate
 * 2. Create TechniqueEvaluation with evaluationSource='template'
 * 3. Create TechniquePromotionDecision with result='promoted'
 * 4. Update status to active
 * 5. Initialize production metrics
 * 6. Emit technique.promoted event
 */
export interface TemplateRegistrationInput {
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly techniques: readonly {
    readonly type: 'prompt_fragment' | 'decision_rule' | 'rag_pattern';
    readonly content: string;
    /** Template-provided evaluation evidence. [PSD-1] */
    readonly evaluationEvidence: {
      readonly baselinePerformance: Readonly<Record<string, unknown>>;
      readonly techniquePerformance: Readonly<Record<string, unknown>>;
      readonly comparisonResult: Readonly<Record<string, unknown>>;
      readonly confidenceScore: number;
    };
  }[];
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of a promotion attempt. [§7.1]
 */
export interface PromotionAttemptResult {
  readonly decision: TechniquePromotionDecision;
  readonly promoted: boolean;
  /** Updated technique if promoted, original if rejected. */
  readonly technique: TGPTechnique;
}

/**
 * Result of quarantine cascade on candidates. [TGP-I5]
 */
export interface QuarantineUpdateResult {
  /** Candidate techniques that had quarantinedAt set. */
  readonly candidatesBlocked: readonly TechniqueId[];
  /** Active techniques that were suspended (existing I-10 behavior). */
  readonly activesSuspended: readonly TechniqueId[];
}

/**
 * Result of quarantine clearing (reverse cascade). [TGP-I5]
 */
export interface QuarantineClearResult {
  /** Candidate techniques that had quarantinedAt cleared. */
  readonly candidatesUnblocked: readonly TechniqueId[];
  /** Note: active-now-suspended restoration still requires human confirmation. */
}

/**
 * Result of candidate retention evaluation. [TGP-I6]
 */
export interface CandidateRetentionResult {
  readonly techniqueId: TechniqueId;
  readonly expired: boolean;
  /** Days since creation. */
  readonly ageDays: number;
  /** Configured retention period in days. */
  readonly retentionDays: number;
}

/**
 * Result of template registration. [PSD-1]
 */
export interface TemplateRegistrationResult {
  /** All techniques created and promoted atomically. */
  readonly techniques: readonly TGPTechnique[];
  /** Promotion decisions created. One per technique. */
  readonly decisions: readonly TechniquePromotionDecision[];
}

// ============================================================================
// Store Interfaces
// ============================================================================

/**
 * Persistence for technique evaluation records. [§6.2]
 *
 * Evaluations are immutable after creation.
 * Scoped by tenantId (FM-10).
 */
export interface TechniqueEvaluationStore {
  create(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: EvaluationCreateInput,
  ): Result<TechniqueEvaluation>;

  getById(
    conn: DatabaseConnection,
    id: EvaluationId,
    tenantId: TenantId,
  ): Result<TechniqueEvaluation>;

  getByTechnique(
    conn: DatabaseConnection,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<readonly TechniqueEvaluation[]>;
}

/**
 * Persistence for technique promotion decision records. [§6.3, CF-13]
 *
 * Decisions are immutable after creation.
 * Multiple decisions per technique (one per attempt).
 * At most one has result = 'promoted'.
 */
export interface PromotionDecisionStore {
  create(
    conn: DatabaseConnection,
    ctx: OperationContext,
    decision: Omit<TechniquePromotionDecision, 'id'>,
  ): Result<TechniquePromotionDecision>;

  getById(
    conn: DatabaseConnection,
    id: PromotionDecisionId,
    tenantId: TenantId,
  ): Result<TechniquePromotionDecision>;

  getByTechnique(
    conn: DatabaseConnection,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<readonly TechniquePromotionDecision[]>;

  /**
   * Get the successful promotion decision for a technique. [§6.3]
   * Returns null if technique has not been promoted.
   */
  getSuccessful(
    conn: DatabaseConnection,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<TechniquePromotionDecision | null>;
}

// ============================================================================
// Logic Interfaces
// ============================================================================

/**
 * Promotion gate — validates and executes technique promotion. [§7.1, TGP-I3]
 *
 * This is the governed action surface for CF-01 and CF-02 enforcement.
 * Authorization gates the action; it does not weaken validation (CF-02).
 *
 * Promotion is atomic: validates evidence → creates decision → updates status
 * → initializes production metrics — all in one transaction. [I-03]
 */
export interface PromotionGate {
  /**
   * Attempt to promote a candidate technique. [§7.1]
   *
   * Validation (TGP-I3):
   * 1. At least one TechniqueEvaluation exists.
   * 2. At least one evaluation has evaluationSource ∈ {runtime, template, manual}. [AMB-03]
   * 3. quarantinedAt must be null. [TGP-I5]
   * 4. Threshold or decision rule must be satisfied. [TGP-I4]
   *
   * On success: status → active, production metrics initialized. [§5.3]
   * On failure: TechniquePromotionDecision created with result='rejected'.
   */
  attemptPromotion(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: PromotionAttemptInput,
  ): Result<PromotionAttemptResult>;
}

/**
 * Quarantine cascade for TGP — bidirectional. [TGP-I5, I-10]
 *
 * Forward: memory quarantine → set quarantinedAt on derived candidate techniques
 *          + suspend active techniques (existing I-10 behavior).
 * Reverse: memory restoration → clear quarantinedAt on candidate techniques.
 *          Active-now-suspended restoration requires separate human action. [CF-01]
 */
export interface TGPQuarantineCascade {
  /**
   * Forward cascade: source memory quarantined. [TGP-I5]
   *
   * - Active techniques: status → suspended (existing I-10).
   * - Candidate techniques: quarantinedAt set. Status unchanged. [PSD-4]
   */
  onMemoryQuarantined(
    conn: DatabaseConnection,
    ctx: OperationContext,
    memoryId: string,
    tenantId: TenantId,
    reason: string,
  ): Result<QuarantineUpdateResult>;

  /**
   * Reverse cascade: source memory restored from quarantine. [TGP-I5]
   *
   * - Candidate techniques: quarantinedAt cleared IF ALL source memories
   *   are now non-quarantined. [§5.2]
   * - Active-now-suspended techniques: NOT automatically restored.
   *   Restoration requires explicit human action. [CF-01]
   */
  onMemoryRestored(
    conn: DatabaseConnection,
    ctx: OperationContext,
    memoryId: string,
    tenantId: TenantId,
  ): Result<QuarantineClearResult>;
}

/**
 * Candidate retention evaluator. [TGP-I6]
 *
 * Evaluates whether candidate techniques have exceeded their lifecycle
 * bound and are eligible for retirement.
 */
export interface CandidateRetentionEvaluator {
  /**
   * Check if a candidate has exceeded its retention period. [TGP-I6]
   */
  evaluate(
    conn: DatabaseConnection,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<CandidateRetentionResult>;

  /**
   * Evaluate all candidates for an agent and retire expired ones. [TGP-I6]
   * Returns the list of retired technique IDs.
   */
  retireExpired(
    conn: DatabaseConnection,
    ctx: OperationContext,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<readonly TechniqueId[]>;
}

/**
 * Inference filter — excludes candidates from inference retrieval. [TGP-I8]
 *
 * Ensures only active techniques participate in:
 * - Prompt fragment injection (§29.4)
 * - Decision rule evaluation (§29.4)
 * - RAG reranking (§29.4)
 */
export interface TGPInferenceFilter {
  /**
   * Filter a set of techniques to only those applicable at inference. [TGP-I8]
   * Returns only techniques with status = 'active'.
   * Candidates, suspended, and retired techniques are excluded.
   */
  filterForInference(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<readonly TGPTechnique[]>;
}

/**
 * Atomic template registrar. [PSD-1, §29.9]
 *
 * Handles cold-start template registration:
 * candidate creation → evaluation → promotion → active — atomically.
 *
 * All 6 operations in one transaction. [AMB-06]
 * No intermediate candidate state visible externally.
 */
export interface TemplateRegistrar {
  /**
   * Register template techniques atomically. [PSD-1]
   *
   * For each technique in the template:
   * 1. Create as candidate with provenanceKind='template_seed'
   * 2. Create TechniqueEvaluation with evaluationSource='template'
   * 3. Create TechniquePromotionDecision with result='promoted'
   * 4. Update status to active
   * 5. Initialize production metrics (confidence from template evidence)
   * 6. Emit technique.promoted event
   *
   * If any step fails, entire transaction rolls back. [I-03, AMB-06]
   */
  registerTemplate(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: TemplateRegistrationInput,
  ): Result<TemplateRegistrationResult>;
}

// ============================================================================
// Facade
// ============================================================================

/**
 * The TGP TechniqueGovernor facade. [§7]
 *
 * Composes all TGP subsystems. Phase 1D truth model entry point.
 * All methods throw NotImplementedError until implementation is built.
 */
export interface TechniqueGovernor {
  readonly evaluationStore: TechniqueEvaluationStore;
  readonly promotionStore: PromotionDecisionStore;
  readonly promotionGate: PromotionGate;
  readonly quarantineCascade: TGPQuarantineCascade;
  readonly candidateRetention: CandidateRetentionEvaluator;
  readonly inferenceFilter: TGPInferenceFilter;
  readonly templateRegistrar: TemplateRegistrar;
}

/**
 * Dependencies for constructing TechniqueGovernor.
 *
 * Includes connections to existing v3.2 subsystems that TGP extends.
 */
export interface TechniqueGovernorDeps {
  readonly audit: {
    readonly create: (
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: {
        readonly action: string;
        readonly resourceType: string;
        readonly resourceId: string;
        readonly details: Readonly<Record<string, unknown>>;
      },
    ) => Result<void>;
  };
  readonly events: {
    readonly emit: (event: {
      readonly type: string;
      readonly scope: 'agent' | 'mission' | 'system';
      readonly payload: Readonly<Record<string, unknown>>;
    }) => void;
  };
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: import('../../kernel/interfaces/time.js').TimeProvider;
}

// ============================================================================
// Error Codes
// ============================================================================

/** Promotion error codes. [TGP-I3, TGP-I4, TGP-I5] */
export const TGP_PROMOTION_ERROR_CODES = {
  /** No evaluation evidence exists. [TGP-I3 req 1] */
  NO_EVALUATION_EVIDENCE: 'TGP_PROMOTION_NO_EVALUATION_EVIDENCE',
  /** No qualifying evaluation source. Transfer-only evidence rejected. [AMB-03, §6.2] */
  INSUFFICIENT_EVALUATION_SOURCE: 'TGP_PROMOTION_INSUFFICIENT_EVALUATION_SOURCE',
  /** Candidate is quarantine-blocked. [TGP-I5] */
  TECHNIQUE_SOURCE_QUARANTINED: 'TGP_PROMOTION_TECHNIQUE_SOURCE_QUARANTINED',
  /** Confidence threshold not met. [TGP-I3 req 4] */
  THRESHOLD_NOT_MET: 'TGP_PROMOTION_THRESHOLD_NOT_MET',
  /** Technique is not in candidate status. [TGP-I2] */
  NOT_CANDIDATE: 'TGP_PROMOTION_NOT_CANDIDATE',
  /** Technique already promoted. [§6.3] */
  ALREADY_PROMOTED: 'TGP_PROMOTION_ALREADY_PROMOTED',
  /** CF-13 audit fields incomplete. [TGP-I4] */
  AUDIT_INCOMPLETE: 'TGP_PROMOTION_AUDIT_INCOMPLETE',
  /** Confidence threshold is invalid (NaN, Infinity, or below floor). [DC-TGP-411] */
  INVALID_THRESHOLD: 'TGP_PROMOTION_INVALID_THRESHOLD',
} as const;

/** Lifecycle error codes. [TGP-I2] */
export const TGP_LIFECYCLE_ERROR_CODES = {
  /** Backward transition to candidate attempted. [TGP-I2] */
  BACKWARD_TRANSITION: 'TGP_LIFECYCLE_BACKWARD_TRANSITION',
  /** Invalid transition from current status. [TGP-I2] */
  INVALID_TRANSITION: 'TGP_LIFECYCLE_INVALID_TRANSITION',
  /** Content modification attempted. [TGP-I1] */
  CONTENT_IMMUTABLE: 'TGP_LIFECYCLE_CONTENT_IMMUTABLE',
  /** Type modification attempted. [TGP-I1] */
  TYPE_IMMUTABLE: 'TGP_LIFECYCLE_TYPE_IMMUTABLE',
  /** Transition out of retired attempted. [TGP-I2] */
  RETIRED_TERMINAL: 'TGP_LIFECYCLE_RETIRED_TERMINAL',
  /** Candidate → suspended attempted (must pass through active). [TGP-I2] */
  CANDIDATE_SKIP_SUSPENDED: 'TGP_LIFECYCLE_CANDIDATE_SKIP_SUSPENDED',
} as const;

/** Quarantine error codes. [TGP-I5] */
export const TGP_QUARANTINE_ERROR_CODES = {
  /** Technique has no source memories to quarantine against. [§8] */
  NO_SOURCE_MEMORIES: 'TGP_QUARANTINE_NO_SOURCE_MEMORIES',
  /** Memory not found in technique's source list. */
  MEMORY_NOT_IN_SOURCES: 'TGP_QUARANTINE_MEMORY_NOT_IN_SOURCES',
} as const;

/** Evaluation error codes. [§6.2] */
export const TGP_EVALUATION_ERROR_CODES = {
  /** Technique not found. */
  TECHNIQUE_NOT_FOUND: 'TGP_EVALUATION_TECHNIQUE_NOT_FOUND',
  /** Invalid confidence score (not in 0.0-1.0). [§6.2] */
  INVALID_CONFIDENCE_SCORE: 'TGP_EVALUATION_INVALID_CONFIDENCE_SCORE',
  /** Evaluation not found. */
  EVALUATION_NOT_FOUND: 'TGP_EVALUATION_NOT_FOUND',
} as const;

/** Candidate retention error codes. [TGP-I6] */
export const TGP_RETENTION_ERROR_CODES = {
  /** Technique is not a candidate. [TGP-I6] */
  NOT_CANDIDATE: 'TGP_RETENTION_NOT_CANDIDATE',
} as const;

/** Template registration error codes. [PSD-1] */
export const TGP_TEMPLATE_ERROR_CODES = {
  /** Template contains no techniques. */
  EMPTY_TEMPLATE: 'TGP_TEMPLATE_EMPTY',
  /** Duplicate template application (idempotency check). */
  TEMPLATE_ALREADY_APPLIED: 'TGP_TEMPLATE_ALREADY_APPLIED',
  /** Atomic transaction failed. */
  TRANSACTION_FAILED: 'TGP_TEMPLATE_TRANSACTION_FAILED',
  /** Template evaluation evidence has invalid confidence score (NaN, Infinity, or out of range). [DC-TGP-109] */
  INVALID_CONFIDENCE_SCORE: 'TGP_TEMPLATE_INVALID_CONFIDENCE_SCORE',
} as const;

// ============================================================================
// Events [§9]
// ============================================================================

/**
 * TGP events — 8 events per §9. [DERIVED: from v3.2 §10]
 *
 * All carry: techniqueId, agentId, timestamp, and transition-specific payload.
 */
export const TGP_EVENTS = {
  /** Technique created as candidate. Scope: agent. Propagation: local. */
  TECHNIQUE_EXTRACTED: 'technique.extracted',
  /** candidate → active. Scope: agent. Propagation: up. Payload: promotionDecisionId. */
  TECHNIQUE_PROMOTED: 'technique.promoted',
  /** Promotion attempted but rejected. Scope: agent. Propagation: local. */
  TECHNIQUE_PROMOTION_REJECTED: 'technique.promotion_rejected',
  /** active → suspended. Scope: agent. Propagation: up. Payload: reason. */
  TECHNIQUE_SUSPENDED: 'technique.suspended',
  /** suspended → active. Scope: agent. Propagation: up. */
  TECHNIQUE_RESTORED: 'technique.restored',
  /** any → retired. Scope: agent. Propagation: local. Payload: retiredReason. */
  TECHNIQUE_RETIRED: 'technique.retired',
  /** quarantinedAt set on candidate. Scope: agent. Propagation: up. Payload: source memory ID. */
  TECHNIQUE_QUARANTINE_BLOCKED: 'technique.quarantine_blocked',
  /** quarantinedAt cleared on candidate. Scope: agent. Propagation: local. */
  TECHNIQUE_QUARANTINE_CLEARED: 'technique.quarantine_cleared',
} as const;

// ============================================================================
// Configuration Constants
// ============================================================================

/** Default candidate retention period in days. [TGP-I6, V1-CHOICE] */
export const DEFAULT_CANDIDATE_RETENTION_DAYS = 90;

/**
 * Default promotion confidence threshold. [AMB-02]
 * Derived from CT-TGP-23's test setup which uses 0.5.
 * Configurable per deployment.
 */
export const DEFAULT_PROMOTION_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Evaluation sources that qualify for sole-basis promotion. [§6.2, AMB-03]
 * transfer_history is EXCLUDED — it alone cannot satisfy the gate.
 */
export const QUALIFYING_EVALUATION_SOURCES: readonly EvaluationSource[] = [
  'runtime',
  'template',
  'manual',
] as const;
