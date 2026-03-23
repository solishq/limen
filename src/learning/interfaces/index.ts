/**
 * Limen — Learning System (S29) Public Interface Barrel
 * Phase 4E-1: Executable Contract
 */
export type {
  // Branded types
  TechniqueId,
  // Enums
  TechniqueType,
  TechniqueStatus,
  OutcomeClassification,
  LearningCycleTrigger,
  RetirementReason,
  QuarantineResolution,
  // Domain objects
  Technique,
  TechniqueCreateInput,
  TechniqueUpdateInput,
  TechniqueApplication,
  TechniqueProposal,
  ExtractionCandidate,
  DuplicateCheckResult,
  RetirementDecision,
  QuarantineEntry,
  TransferRequest,
  TransferResult,
  ColdStartTemplate,
  ColdStartTechniqueEntry,
  SpecializationMetrics,
  LearningCycleResult,
  // Service interfaces
  TechniqueStore,
  TechniqueExtractor,
  TechniqueApplicator,
  EffectivenessTracker,
  RetirementEvaluator,
  QuarantineManager,
  CrossAgentTransfer,
  OverSpecializationDetector,
  ColdStartManager,
  LearningCycleOrchestrator,
  // Composite
  LearningSystem,
  LearningDeps,
} from './learning_types.js';

export {
  // Constants
  INITIAL_CONFIDENCE_EXTRACTED,
  INITIAL_CONFIDENCE_COLD_START,
  CONFIDENCE_RESET_TRANSFER,
  CONFIDENCE_RESET_REACTIVATION,
  EMA_WEIGHT_OLD,
  EMA_WEIGHT_RECENT,
  SUCCESS_RATE_WINDOW,
  RETIREMENT_MIN_APPLICATIONS_SUCCESS,
  RETIREMENT_MIN_APPLICATIONS_CONFIDENCE,
  RETIREMENT_THRESHOLD_SUCCESS_RATE,
  RETIREMENT_THRESHOLD_CONFIDENCE,
  RETIREMENT_STALENESS_DAYS,
  EXTRACTION_QUALITY_THRESHOLD,
  DEDUP_SIMILARITY_THRESHOLD,
  MAX_CONTEXT_WINDOW_RATIO,
  OVERSPECIALIZATION_THRESHOLD,
  DEFAULT_CYCLE_INTERVAL_MS,
  // Phase 4E-R1: Transfer qualification (BRK-S29-002)
  TRANSFER_MIN_CONFIDENCE,
  TRANSFER_MIN_SUCCESS_RATE,
  TRANSFER_MIN_APPLICATIONS,
  // Phase 4E-R1: HITL confidence (DEC-4E-003)
  HITL_CONFIDENCE,
  // Phase 4E-R1: RBAC permissions (BRK-S29-013)
  LEARNING_PERMISSIONS,
} from './learning_types.js';
