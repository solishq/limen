/**
 * Limen — Learning System (S29) Type Definitions
 * Phase 4E-1: Truth Model Executable Contract
 *
 * Every type derives from specification S29.1-S29.10.
 * No type exists without spec traceability.
 *
 * S ref: S29, I-03, I-07, I-10, I-28, FM-01, FM-07
 */

import type {
  TenantId, AgentId, OperationContext, Result,
  DatabaseConnection, AuditTrail, EventBus,
  RbacEngine, RateLimiter,
} from '../../kernel/interfaces/index.js';
import type { LlmGateway } from '../../substrate/interfaces/substrate.js';

// ─── Branded Types ───

/** Unique identifier for a learned technique (S29.2) */
export type TechniqueId = string & { readonly __brand: 'TechniqueId' };

// ─── Enums ───

/** Three technique types per S29.1 taxonomy */
export type TechniqueType = 'prompt_fragment' | 'decision_rule' | 'rag_pattern';

/** Technique lifecycle states per S29.2, S29.6, S29.7 */
export type TechniqueStatus = 'active' | 'suspended' | 'retired';

/** Outcome classification per S29.5 */
export type OutcomeClassification = 'positive' | 'neutral' | 'negative';

/** Learning cycle trigger per S29.3 */
export type LearningCycleTrigger = 'periodic' | 'explicit_feedback' | 'hitl_correction';

/** Retirement reasons per S29.6 */
export type RetirementReason =
  | 'low_success_rate'    // success_rate < 0.3 over 50+ applications
  | 'low_confidence'      // confidence < 0.2 after 20+ applications
  | 'stale'               // not applied in 90 days
  | 'human_flagged';      // HITL batch-review mode

/** Quarantine resolution per S29.7 */
export type QuarantineResolution = 'reactivated' | 'permanently_retired';

// ─── Core Domain Objects ───

/**
 * A learned technique — the fundamental unit of the learning system.
 * Immutable learned artifact per S29.1. Schema per S29.2.
 *
 * Scoped to agentId x tenantId (I-07, tenant isolation).
 */
export interface Technique {
  readonly id: TechniqueId;
  readonly tenantId: TenantId;
  readonly agentId: AgentId;
  readonly type: TechniqueType;
  readonly content: string;
  readonly sourceMemoryIds: readonly string[];  // Provenance chain (S29.3 Step 4)
  readonly confidence: number;                  // 0.0-1.0, EMA-updated (S29.5)
  readonly successRate: number;                 // 0.0-1.0, rolling 50-application window (S29.5)
  readonly applicationCount: number;
  readonly lastApplied: string | null;          // ISO timestamp, null if never applied
  readonly lastUpdated: string;                 // ISO timestamp
  readonly status: TechniqueStatus;
  readonly createdAt: string;                   // ISO timestamp
}

/**
 * Input for creating a new technique.
 * Initial confidence MUST be 0.5 per S29.3 Step 4.
 */
export interface TechniqueCreateInput {
  readonly tenantId: TenantId;
  readonly agentId: AgentId;
  readonly type: TechniqueType;
  readonly content: string;
  readonly sourceMemoryIds: readonly string[];  // MUST be non-empty (provenance required)
  readonly initialConfidence: number;           // 0.5 for extracted, 0.6 for cold-start, 0.4 for transfer
}

/** Mutable fields for technique updates */
export interface TechniqueUpdateInput {
  readonly confidence?: number;
  readonly successRate?: number;
  readonly applicationCount?: number;
  readonly lastApplied?: string;
  readonly status?: TechniqueStatus;
}

/**
 * Record of a technique being applied (or skipped) during an interaction.
 * Per S29.4: each application recorded with { technique_id, interaction_id, timestamp, applied }.
 */
export interface TechniqueApplication {
  readonly techniqueId: TechniqueId;
  readonly interactionId: string;
  readonly tenantId: TenantId;
  readonly timestamp: string;
  readonly applied: boolean;  // false if skipped due to context limits (S29.4)
}

/**
 * LLM-generated technique proposal from extraction.
 * Output schema per S29.3 Step 2.
 */
export interface TechniqueProposal {
  readonly type: TechniqueType;
  readonly content: string;
  readonly confidence: number;
  readonly applicability: string;
}

/**
 * Candidate interaction for technique extraction.
 * Per S29.3 Step 1: quality > 0.7 AND positive feedback.
 */
export interface ExtractionCandidate {
  readonly interactionId: string;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly qualityScore: number;
  readonly userFeedback: 'positive' | 'correction' | null;
  readonly conversationContext: string;  // agent prompt + user message + response + feedback
}

/**
 * Result of duplicate check.
 * Per S29.3 Step 3: cosine similarity > 0.85 = duplicate.
 */
export interface DuplicateCheckResult {
  readonly isDuplicate: boolean;
  readonly existingTechniqueId: TechniqueId | null;
  readonly similarity: number;  // cosine similarity score
}

/**
 * Retirement evaluation decision per S29.6.
 */
export interface RetirementDecision {
  readonly techniqueId: TechniqueId;
  readonly shouldRetire: boolean;
  readonly reason: RetirementReason | null;
}

/**
 * Quarantine entry per S29.7.
 * Created when techniques are suspended as part of FM-01 defense.
 */
export interface QuarantineEntry {
  readonly id: string;
  readonly techniqueId: TechniqueId;
  readonly tenantId: TenantId;
  readonly agentId: AgentId;
  readonly reason: string;
  readonly quarantinedAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: QuarantineResolution | null;
}

/**
 * Cross-agent transfer request per S29.8.
 * Requires human approval (human gate).
 *
 * DEC-4E-002: Cross-TENANT transfer permanently blocked.
 * Single tenantId field = structural proof. Source and target agents
 * must be in the same tenant. No cross-tenant variant exists or will exist.
 */
export interface TransferRequest {
  readonly sourceTechniqueId: TechniqueId;
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly tenantId: TenantId;  // Single tenant — cross-tenant transfer structurally impossible (DEC-4E-002)
}

/**
 * Result of an approved cross-agent transfer per S29.8.
 * New technique created at confidence 0.4 in target agent.
 */
export interface TransferResult {
  readonly newTechniqueId: TechniqueId;
  readonly sourceProvenanceChain: readonly string[];
  readonly confidence: number;  // Reset to 0.4 per spec S29.8
}

/**
 * Cold-start template per S29.9.
 * Schema: { template_name: string, version: number, techniques: Technique[] }
 * Five spec-defined templates: customer-support, document-qa, code-assistant,
 * claims-processor, research-analyst.
 */
export interface ColdStartTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly version: number;           // Required per S29.9 (BRK-S29-001)
  readonly techniques: readonly ColdStartTechniqueEntry[];
}

/** Individual technique entry within a cold-start template */
export interface ColdStartTechniqueEntry {
  readonly type: TechniqueType;
  readonly content: string;
  // Confidence for cold-start = 0.6 per S29.9 (higher than extracted 0.5)
}

/**
 * Over-specialization metrics per S29.10 + DEC-4E-001.
 * FM-07 defense: detects when agent's technique types lack diversity.
 *
 * Formula (DEC-4E-001, §29.10):
 *   H = -Σ p_i × log(p_i)  (Shannon entropy of type distribution)
 *   Score = 1 - (H / log(N))  where N = number of distinct technique types
 *   Over-specialized when Score > configurable threshold (default 0.9)
 *
 * Score interpretation:
 *   0.0 = perfectly uniform distribution (maximum diversity)
 *   1.0 = all techniques are one type (zero diversity)
 */
export interface SpecializationMetrics {
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly typeDistribution: Readonly<Record<TechniqueType, number>>;
  readonly specializationScore: number;  // 1 - (Shannon entropy / log(N)), 0.0-1.0 (DEC-4E-001)
  readonly overSpecialized: boolean;     // true if specializationScore > OVERSPECIALIZATION_THRESHOLD
}

/**
 * Learning cycle result per S29.3.
 * Summary of a complete learning cycle execution.
 */
export interface LearningCycleResult {
  readonly cycleId: string;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly trigger: LearningCycleTrigger;
  readonly candidatesEvaluated: number;
  readonly techniquesExtracted: number;
  readonly duplicatesReinforced: number;
  readonly techniquesRetired: number;
  readonly overSpecializationDetected: boolean;
  readonly timestamp: string;
}

// ─── Service Interfaces ───

/**
 * Technique persistence and lifecycle management.
 * All queries scoped by tenantId (tenant isolation) and agentId (I-07).
 * All mutations produce audit entries (I-03).
 */
export interface TechniqueStore {
  create(conn: DatabaseConnection, ctx: OperationContext, input: TechniqueCreateInput): Result<Technique>;
  get(conn: DatabaseConnection, id: TechniqueId, tenantId: TenantId, agentId: AgentId): Result<Technique>;
  getByAgent(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId, status?: TechniqueStatus): Result<readonly Technique[]>;
  update(conn: DatabaseConnection, ctx: OperationContext, id: TechniqueId, tenantId: TenantId, updates: TechniqueUpdateInput): Result<Technique>;
  retire(conn: DatabaseConnection, ctx: OperationContext, id: TechniqueId, tenantId: TenantId, reason: RetirementReason): Result<void>;
  suspend(conn: DatabaseConnection, ctx: OperationContext, id: TechniqueId, tenantId: TenantId): Result<void>;
  reactivate(conn: DatabaseConnection, ctx: OperationContext, id: TechniqueId, tenantId: TenantId, resetConfidence: number): Result<void>;
  /** Find all techniques derived from a specific source memory (BRK-S29-007, FM-01 quarantine cascade) */
  getBySourceMemory(conn: DatabaseConnection, memoryId: string, tenantId: TenantId): Result<readonly Technique[]>;
}

/**
 * Technique extraction from interactions.
 * Per S29.3: collect candidates -> generate proposals -> dedup -> store.
 * Uses LLM gateway for extraction (substrate dependency).
 */
export interface TechniqueExtractor {
  collectCandidates(conn: DatabaseConnection, ctx: OperationContext, agentId: AgentId, sinceTimestamp: string): Result<readonly ExtractionCandidate[]>;
  generateProposal(ctx: OperationContext, candidate: ExtractionCandidate): Promise<Result<TechniqueProposal>>;
  checkDuplicate(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId, proposalContent: string): Promise<Result<DuplicateCheckResult>>;
  extractAndStore(conn: DatabaseConnection, ctx: OperationContext, candidate: ExtractionCandidate): Promise<Result<Technique | null>>;  // null = duplicate reinforced
}

/**
 * Technique application during chat pipeline Phase 7.
 * Per S29.4: ordered by confidence, respects context window limits.
 * Records every application (including skipped).
 */
export interface TechniqueApplicator {
  getActivePromptFragments(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId, maxTokenBudget: number): Result<readonly Technique[]>;
  getActiveDecisionRules(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId): Result<readonly Technique[]>;
  getActiveRagPatterns(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId): Result<readonly Technique[]>;
  recordApplications(conn: DatabaseConnection, ctx: OperationContext, applications: readonly TechniqueApplication[]): Result<void>;
}

/**
 * Effectiveness tracking per S29.5.
 * EMA confidence update: new = 0.8 * old + 0.2 * recent_success_rate.
 * Success rate: count(positive) / count(positive + negative) over rolling 50-application window.
 */
export interface EffectivenessTracker {
  recordOutcome(conn: DatabaseConnection, ctx: OperationContext, techniqueId: TechniqueId, tenantId: TenantId, outcome: OutcomeClassification): Result<void>;
  updateConfidence(conn: DatabaseConnection, ctx: OperationContext, techniqueId: TechniqueId, tenantId: TenantId): Result<number>;  // returns new confidence
  getSuccessRate(conn: DatabaseConnection, techniqueId: TechniqueId, tenantId: TenantId): Result<number>;
}

/**
 * Retirement evaluation per S29.6.
 * Four conditions: low success (<0.3/50+), low confidence (<0.2/20+), stale (90d), human-flagged.
 */
export interface RetirementEvaluator {
  evaluate(conn: DatabaseConnection, techniqueId: TechniqueId, tenantId: TenantId): Result<RetirementDecision>;
  evaluateAll(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId): Result<readonly RetirementDecision[]>;
}

/**
 * Quarantine cascade per S29.7.
 * FM-01 defense: atomic suspension of suspected techniques.
 * Resolution requires human authority (HITL review).
 */
export interface QuarantineManager {
  quarantine(conn: DatabaseConnection, ctx: OperationContext, techniqueIds: readonly TechniqueId[], tenantId: TenantId, reason: string): Result<readonly QuarantineEntry[]>;
  resolve(conn: DatabaseConnection, ctx: OperationContext, entryId: string, resolution: QuarantineResolution): Result<void>;
  getPending(conn: DatabaseConnection, tenantId: TenantId): Result<readonly QuarantineEntry[]>;
  /** BRK-IMPL-007: GDPR cascade — when a source memory is tombstoned,
   *  find all derived techniques and quarantine them.
   *  Bridges getBySourceMemory → quarantine in one atomic operation. */
  cascadeFromMemory(conn: DatabaseConnection, ctx: OperationContext, memoryId: string, tenantId: TenantId, reason: string): Result<readonly QuarantineEntry[]>;
}

/**
 * Cross-agent technique transfer per S29.8.
 * Human gate required. Confidence resets to 0.4 on transfer.
 * Source provenance chain preserved.
 */
export interface CrossAgentTransfer {
  requestTransfer(conn: DatabaseConnection, ctx: OperationContext, request: TransferRequest): Result<string>;  // returns request ID
  approveTransfer(conn: DatabaseConnection, ctx: OperationContext, requestId: string): Result<TransferResult>;
  rejectTransfer(conn: DatabaseConnection, ctx: OperationContext, requestId: string): Result<void>;
}

/**
 * Over-specialization detection per S29.10.
 * FM-07 defense: flags agents where >90% of techniques are one type.
 */
export interface OverSpecializationDetector {
  analyze(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId): Result<SpecializationMetrics>;
}

/**
 * Cold-start template management per S29.9.
 * Pre-built technique sets for new agents. Confidence 0.6.
 */
export interface ColdStartManager {
  applyTemplate(conn: DatabaseConnection, ctx: OperationContext, agentId: AgentId, tenantId: TenantId, templateId: string): Result<readonly Technique[]>;
  getAvailableTemplates(): Result<readonly ColdStartTemplate[]>;
}

/**
 * Learning cycle orchestrator per S29.3.
 * Orchestrates: collect -> extract -> dedup -> store -> track -> retire -> check specialization.
 * Emits learning.cycle.completed event on completion.
 */
export interface LearningCycleOrchestrator {
  runCycle(conn: DatabaseConnection, ctx: OperationContext, agentId: AgentId, trigger: LearningCycleTrigger): Promise<Result<LearningCycleResult>>;
  getLastCycleTime(conn: DatabaseConnection, agentId: AgentId, tenantId: TenantId): Result<string | null>;
}

// ─── Composite Interface ───

/**
 * The complete Learning System facade.
 * Composes all subsystem interfaces per S29.
 */
export interface LearningSystem {
  readonly store: TechniqueStore;
  readonly extractor: TechniqueExtractor;
  readonly applicator: TechniqueApplicator;
  readonly tracker: EffectivenessTracker;
  readonly retirement: RetirementEvaluator;
  readonly quarantine: QuarantineManager;
  readonly transfer: CrossAgentTransfer;
  readonly specialization: OverSpecializationDetector;
  readonly coldStart: ColdStartManager;
  readonly cycle: LearningCycleOrchestrator;
}

// ─── Dependencies ───

/**
 * Dependencies required to construct the LearningSystem.
 * Follows the same DI pattern as OrchestrationDeps.
 */
export interface LearningDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly audit: AuditTrail;
  readonly events: EventBus;
  readonly rbac: RbacEngine;
  readonly rateLimiter: RateLimiter;
  readonly gateway: LlmGateway;  // Substrate LLM gateway for extraction (BRK-S29-012, §29.3)
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: import('../../kernel/interfaces/time.js').TimeProvider;
}

// ─── Constants (spec-derived) ───

/** Initial confidence for extracted techniques (S29.3 Step 4) */
export const INITIAL_CONFIDENCE_EXTRACTED = 0.5;

/** Initial confidence for cold-start template techniques (S29.9) */
export const INITIAL_CONFIDENCE_COLD_START = 0.6;

/** Confidence reset for transferred techniques (S29.8) */
export const CONFIDENCE_RESET_TRANSFER = 0.4;

/** Confidence reset for reactivated (quarantine-resolved) techniques (S29.7) */
export const CONFIDENCE_RESET_REACTIVATION = 0.3;

/** EMA weight for old confidence (S29.5) */
export const EMA_WEIGHT_OLD = 0.8;

/** EMA weight for recent success rate (S29.5) */
export const EMA_WEIGHT_RECENT = 0.2;

/** Rolling window size for success rate calculation (S29.5) */
export const SUCCESS_RATE_WINDOW = 50;

/** Minimum applications before success-rate retirement (S29.6) */
export const RETIREMENT_MIN_APPLICATIONS_SUCCESS = 50;

/** Minimum applications before confidence retirement (S29.6) */
export const RETIREMENT_MIN_APPLICATIONS_CONFIDENCE = 20;

/** Success rate threshold for retirement (S29.6) */
export const RETIREMENT_THRESHOLD_SUCCESS_RATE = 0.3;

/** Confidence threshold for retirement (S29.6) */
export const RETIREMENT_THRESHOLD_CONFIDENCE = 0.2;

/** Staleness threshold in days for retirement (S29.6) */
export const RETIREMENT_STALENESS_DAYS = 90;

/** Quality score threshold for extraction candidates (S29.3 Step 1) */
export const EXTRACTION_QUALITY_THRESHOLD = 0.7;

/** Cosine similarity threshold for deduplication (S29.3 Step 3) */
export const DEDUP_SIMILARITY_THRESHOLD = 0.85;

/** Maximum proportion of context window for prompt fragments (S29.4) */
export const MAX_CONTEXT_WINDOW_RATIO = 0.2;

/** Over-specialization threshold: specialization score (Shannon entropy, DEC-4E-001, S29.10) */
export const OVERSPECIALIZATION_THRESHOLD = 0.9;

/** Default learning cycle interval in milliseconds (S29.3: 5 minutes) */
export const DEFAULT_CYCLE_INTERVAL_MS = 5 * 60 * 1000;

// ─── Transfer Qualification Thresholds (S29.8 Step 1) ───

/** Minimum confidence for transfer qualification (S29.8: confidence > 0.8) */
export const TRANSFER_MIN_CONFIDENCE = 0.8;

/** Minimum success rate for transfer qualification (S29.8: success_rate > 0.7) */
export const TRANSFER_MIN_SUCCESS_RATE = 0.7;

/** Minimum application count for transfer qualification (S29.8: applicationCount > 50) */
export const TRANSFER_MIN_APPLICATIONS = 50;

// ─── HITL Confidence (DEC-4E-003, §31.2) ───

/** Human-in-the-loop corrections always get maximum confidence (DEC-4E-003) */
export const HITL_CONFIDENCE = 1.0;

// ─── RBAC Permission Constants (BRK-S29-013) ───

/** RBAC permissions required for learning system operations */
export const LEARNING_PERMISSIONS = {
  /** Permission to read techniques and metrics */
  READ: 'learning:read',
  /** Permission to trigger learning cycles and extraction */
  WRITE: 'learning:write',
  /** Permission to approve/reject quarantine resolutions */
  QUARANTINE_RESOLVE: 'learning:quarantine:resolve',
  /** Permission to approve/reject cross-agent transfers */
  TRANSFER_APPROVE: 'learning:transfer:approve',
  /** Permission to apply cold-start templates */
  COLD_START: 'learning:cold_start:apply',
} as const;
