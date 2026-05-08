/**
 * Shared Adapter Types
 *
 * Re-exports canonical types from the CrewAI adapter types module.
 * All adapters import from here to maintain a single source of truth
 * without modifying the CrewAI adapter.
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1
 */

// Re-export everything from the canonical CrewAI types.
// CrewAI types already define all SHARED_TYPES.md types.
export type {
  // Branded IDs
  TenantId,
  AgentId,
  SessionId,
  ClaimId,
  AgentBranchId,
  AdapterId,
  MissionId,
  TaskId,
  EventId,
  PolicyId,
  RelationshipId,
  // Enums and unions
  AgentTrustLevel,
  AgentCapability,
  ClassificationLevel,
  AgentFramework,
  TokenEncoding,
  MergeStrategy,
  ManualMergeResolution,
  FreshnessLabel,
  ClaimStatus,
  GroundingMode,
  ObjectType,
  EvidenceType,
  RelationshipType,
  ArchiveMode,
  AdapterLifecycleState,
  CrewAIAdapterErrorCode,
  AgentEvent,
  GovernanceAction,
  Permission,
  // Interfaces
  AgentSession,
  SessionSummary,
  OperationContext,
  StructuredContent,
  AgentMemoryOptions,
  AgentRecallQuery,
  AgentRecallOptions,
  AgentMemoryEntry,
  BeliefState,
  EvidenceRef,
  RelationshipRef,
  GovernanceContext,
  GovernanceVerdict,
  GovernanceDecision,
  SandboxConfig,
  AdapterSandboxDefaults,
  AdapterRefusalHint,
  RateLimitPolicy,
  TokenEstimate,
  TokenEstimator,
  PerformanceBudget,
  ActionDigest,
  AgentToolCall,
  LimenOperation,
  NativeAgentAction,
  ComputerAction,
  ActionBase,
  AuditLogEntry,
  RetentionPolicy,
  MergeConflict,
  ManualMergeState,
  AgentEventPayload,
  AgentEventHandler,
  AgentEventBus,
  LimenAgentClient,
  ComputerActionGovernor,
  Result,
  KernelError,
  // CrewAI local types reused by shared base
  TokenBudgetConfig,
  RetryPolicy,
  AdapterHealth,
  MergeResultData,
  MergeConflictRecord,
  ManualMergeResolutionRequest,
  RecallResult,
  MergeResult,
} from '../crewai/types.js';

export {
  TRUST_TO_CLEARANCE,
  TRUST_CONFIDENCE_CAPS,
  DEFAULT_RATE_LIMITS,
  ERROR_PRECEDENCE,
  NEVER_RETRYABLE,
} from '../crewai/types.js';

/**
 * Generic adapter config shared across all framework adapters.
 * Each framework adapter extends this with framework-specific fields.
 */
export interface BaseAdapterConfig {
  readonly agentId: import('../crewai/types.js').AgentId;
  readonly tenantId: import('../crewai/types.js').TenantId | null;
  readonly trustLevel: import('../crewai/types.js').AgentTrustLevel;
  readonly capabilities: ReadonlySet<import('../crewai/types.js').AgentCapability>;
  readonly defaultClassification: import('../crewai/types.js').ClassificationLevel;
  readonly governed?: true;
  readonly rateLimits: readonly import('../crewai/types.js').RateLimitPolicy[];
  readonly sandboxDefaults: import('../crewai/types.js').AdapterSandboxDefaults;
  readonly refusalHints: readonly import('../crewai/types.js').AdapterRefusalHint[];
  readonly tokenBudget: import('../crewai/types.js').TokenBudgetConfig;
  readonly coreEndpoint: string;
  readonly connectionTimeoutMs: number;
  readonly retryPolicy: import('../crewai/types.js').RetryPolicy;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Framework-specific session start data.
 * Each adapter defines its own concrete type.
 */
export interface FrameworkSessionStart {
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Framework-specific session end data.
 * Each adapter defines its own concrete type.
 */
export interface FrameworkSessionEnd {
  readonly sessionId: import('../crewai/types.js').SessionId;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Audit details shape for non-CrewAI adapters.
 */
export interface AdapterAuditDetails {
  readonly operationType: string;
  readonly tokenCost: number;
  readonly governanceState: 'allowed' | 'refused' | 'escalated' | 'sandboxed' | 'not_applicable';
  readonly errorCode?: string;
  readonly duration: number;
  readonly [key: string]: unknown;
}
