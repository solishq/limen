// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Shared Adapter Types -- Canonical Source
 *
 * ALL types from SHARED_TYPES.md and AGENT_ADAPTER_ARCHITECTURE.md
 * are defined here. Individual adapters import from this module.
 * Compliance modules import from this module.
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1
 */

// ── Branded ID imports (SHARED_TYPES.md S1.1, S4) ──

export type TenantId = string & { readonly __brand: 'TenantId' };
export type AgentId = string & { readonly __brand: 'AgentId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type ClaimId = string & { readonly __brand: 'ClaimId' };
export type AgentBranchId = string & { readonly __brand: 'AgentBranchId' };
export type AdapterId = string & { readonly __brand: 'AdapterId' };
export type MissionId = string & { readonly __brand: 'MissionId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type EventId = string & { readonly __brand: 'EventId' };
export type PolicyId = string & { readonly __brand: 'PolicyId' };
export type RelationshipId = string & { readonly __brand: 'RelationshipId' };
export type ConsentId = string & { readonly __brand: 'ConsentId' };
export type UserId = string & { readonly __brand: 'UserId' };

// ── SHARED_TYPES.md S19 -- Consent Types ──

/** SHARED_TYPES.md S19 -- Consent purposes (5 values) */
export type ConsentPurpose = 'memory_storage' | 'technique_extraction' | 'knowledge_transfer' | 'analytics' | 'improvement';

/** SHARED_TYPES.md S19 -- Consentable operations (6 values) */
export type ConsentableOperation = 'store_personal_data' | 'extract_techniques' | 'transfer_knowledge' | 'collect_analytics' | 'train_models' | 'share_with_third_party';

// ── SHARED_TYPES.md S5 ── Trust and Clearance ──

/** SHARED_TYPES.md S5 -- 5-level agent trust model */
export type AgentTrustLevel = 'untrusted' | 'low' | 'medium' | 'high' | 'verified';

/** SHARED_TYPES.md S5 -- Trust-to-clearance mapping */
export const TRUST_TO_CLEARANCE: Record<AgentTrustLevel, number> = {
  untrusted: 0,
  low: 1,
  medium: 2,
  high: 3,
  verified: 4,
};

/** SHARED_TYPES.md S5.4 -- Confidence caps per trust level */
export const TRUST_CONFIDENCE_CAPS: Record<AgentTrustLevel, number> = {
  untrusted: 0,
  low: 0.3,
  medium: 0.7,
  high: 0.85,
  verified: 1.0,
};

// ── SHARED_TYPES.md S6 -- AgentCapability ──

/** SHARED_TYPES.md S6 -- 20-value capability enum */
export type AgentCapability =
  | 'memory_read' | 'memory_write' | 'belief_management' | 'branching'
  | 'technique_learning' | 'technique_transfer'
  | 'mission_creation' | 'mission_delegation'
  | 'computer_use' | 'browser_use' | 'terminal_use'
  | 'file_access' | 'code_execution' | 'api_calls' | 'network_access'
  | 'multi_agent' | 'knowledge_export' | 'knowledge_import'
  | 'context_management' | 'governance_admin';

// ── SHARED_TYPES.md S3 -- Classification ──

/** SHARED_TYPES.md S3 -- Classification levels */
export type ClassificationLevel = 'unrestricted' | 'internal' | 'confidential' | 'restricted' | 'critical';

// ── SHARED_TYPES.md S21 -- AgentFramework ──

/** SHARED_TYPES.md S21 -- 10-value framework enum */
/** SHARED_TYPES.md S21 -- 10-value framework enum (AgentFramework type) */
export type AgentFramework =
  | 'claude' | 'codex' | 'openclaw' | 'hermes' | 'gemma' // framework enum values
  | 'crew_ai' | 'auto_gen' | 'semantic_kernel' | 'llama_index' | 'custom';

// ── SHARED_TYPES.md S1.2, S1.3 ──

/** SHARED_TYPES.md S1.2 -- Permission type */
export type Permission =
  | 'create_agent' | 'modify_agent' | 'delete_agent'
  | 'chat' | 'infer'
  | 'create_mission'
  | 'view_telemetry' | 'view_audit'
  | 'manage_providers' | 'manage_budgets' | 'manage_roles'
  | 'purge_data'
  | 'approve_response' | 'edit_response' | 'takeover_session' | 'review_batch'
  | 'classify_claims' | 'manage_classification_rules'
  | 'manage_protected_predicates'
  | 'request_erasure' | 'export_compliance'
  | 'assert_claim' | 'retract_claim' | 'query_claims' | 'relate_claims'
  | 'write_wm' | 'read_wm'
  | 'manage_consent' | 'view_consent'
  | 'manage_cognitive'
  | 'manage_agents'
  | 'governance_admin';

/** SHARED_TYPES.md S1.3 -- OperationContext */
export interface OperationContext {
  readonly tenantId: TenantId | null;
  readonly userId: string | null;
  readonly agentId: AgentId | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly sessionId?: SessionId;
  readonly clearanceLevel?: number;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
}

// ── SHARED_TYPES.md S1.4, S1.5 ──

/** SHARED_TYPES.md S1.4 -- KernelError */
export interface KernelError {
  readonly code: string;
  readonly message: string;
  readonly spec: string;
  readonly violations?: readonly unknown[];
}

/** SHARED_TYPES.md S1.5 -- Result type */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KernelError };

// ── SHARED_TYPES.md S2 -- CCP Types ──

export type FreshnessLabel = 'fresh' | 'aging' | 'stale';
export type ClaimStatus = 'active' | 'retracted';
export type GroundingMode = 'evidence_path' | 'runtime_witness';
export type ObjectType = 'string' | 'number' | 'boolean' | 'date' | 'json';
export type EvidenceType = 'memory' | 'artifact' | 'claim' | 'capability_result';
export type RelationshipType = 'supports' | 'contradicts' | 'supersedes' | 'derived_from';
export type ArchiveMode = 'exclude' | 'include' | 'only';

// ── SHARED_TYPES.md S7 -- AgentSession ──

/** SHARED_TYPES.md S7 -- Canonical session type */
export interface AgentSession {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly adapterId: AdapterId;
  readonly trustLevel: AgentTrustLevel;
  readonly coreTrustLevel: string;
  readonly clearanceLevel: number;
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly startedAt: string;
  readonly workingMemoryNamespace: string;
  readonly activeMissions: readonly MissionId[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ── SHARED_TYPES.md S9, S10 -- Governance ──

/** SHARED_TYPES.md S9 -- GovernanceContext */
export interface GovernanceContext {
  readonly operationContext: OperationContext;
  readonly session: AgentSession;
  readonly action: GovernanceAction;
  readonly resource: string | null;
  readonly policyIds: readonly PolicyId[];
  readonly actionHistory: readonly ActionDigest[];
}

/** SHARED_TYPES.md S9 -- GovernanceAction */
export type GovernanceAction =
  | { readonly domain: 'memory'; readonly operation: 'write' | 'read' | 'delete' | 'branch' | 'merge' | 'resolve_merge_conflict' }
  | { readonly domain: 'computer'; readonly operation: string }
  | { readonly domain: 'execution'; readonly operation: 'create_mission' | 'delegate' | 'cancel' | 'retry' | 'tool_call' }
  | { readonly domain: 'lifecycle'; readonly operation: string }
  | { readonly domain: 'knowledge'; readonly operation: string }
  | { readonly domain: 'consent'; readonly operation: string }
  | { readonly domain: 'context'; readonly operation: string }
  | { readonly domain: 'search'; readonly operation: string }
  | { readonly domain: 'coordination'; readonly operation: string }
  | { readonly domain: 'output'; readonly operation: string };

/** SHARED_TYPES.md S10 -- GovernanceVerdict */
export type GovernanceVerdict =
  | { readonly verdict: 'allow'; readonly auditId: EventId; readonly conditions?: readonly string[] }
  | { readonly verdict: 'refuse'; readonly auditId: EventId; readonly reason: string; readonly rule: string; readonly alternatives?: readonly string[] }
  | { readonly verdict: 'escalate'; readonly auditId: EventId; readonly reason: string; readonly requiredApproval: 'human' | 'senior_agent' }
  | { readonly verdict: 'sandbox'; readonly auditId: EventId; readonly config: SandboxConfig };

/** SHARED_TYPES.md S10.1 -- GovernanceDecision */
export interface GovernanceDecision {
  readonly allowed: boolean;
  readonly verdict: GovernanceVerdict;
  readonly reason: string | null;
  readonly requiredPermissions: readonly Permission[];
  readonly missingPermissions: readonly Permission[];
  readonly clearanceRequired: number | null;
  readonly clearanceActual: number | null;
  readonly evaluatedAt: string;
}

// ── SHARED_TYPES.md S10.2 -- Memory and Belief Records ──

/** SHARED_TYPES.md S10.2.1 -- StructuredContent */
export interface StructuredContent {
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly objectType?: ObjectType;
}

/** SHARED_TYPES.md S10.2.1 -- AgentMemoryOptions */
export interface AgentMemoryOptions {
  readonly confidence?: number;
  readonly reasoning?: string;
  readonly classification?: ClassificationLevel;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly groundingMode?: GroundingMode;
  readonly retentionDays?: number;
}

/** SHARED_TYPES.md S10.2.1 -- AgentRecallQuery */
export interface AgentRecallQuery {
  readonly text?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly freshnessFilter?: FreshnessLabel | readonly FreshnessLabel[];
  readonly minConfidence?: number;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly classification?: ClassificationLevel;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly sourceAgentId?: AgentId;
  readonly includeSuperseded?: boolean;
  readonly branchId?: AgentBranchId;
}

/** SHARED_TYPES.md S10.2.1 -- AgentRecallOptions */
export interface AgentRecallOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly includeEvidence?: boolean;
  readonly includeRelationships?: boolean;
  readonly searchMode?: 'text' | 'semantic' | 'hybrid';
  readonly archiveMode?: ArchiveMode;
  readonly sortBy?: 'relevance' | 'confidence' | 'recency';
}

/** SHARED_TYPES.md S10.2 -- AgentMemoryEntry */
export interface AgentMemoryEntry {
  readonly id: ClaimId;
  readonly content: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly freshness: FreshnessLabel;
  readonly classification: ClassificationLevel;
  readonly tags: readonly string[];
  readonly category: string | null;
  readonly sourceAgentId: AgentId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly groundingMode: GroundingMode;
  readonly createdAt: string;
}

/** SHARED_TYPES.md S10.2 -- EvidenceRef */
export interface EvidenceRef {
  readonly type: EvidenceType;
  readonly id: string;
  readonly description?: string;
}

/** SHARED_TYPES.md S10.2 -- RelationshipRef */
export interface RelationshipRef {
  readonly id: RelationshipId;
  readonly type: RelationshipType;
  readonly targetId: ClaimId;
}

/** SHARED_TYPES.md S10.2 -- BeliefState */
export interface BeliefState {
  readonly belief: AgentMemoryEntry;
  readonly evidence: readonly EvidenceRef[];
  readonly relationships: readonly RelationshipRef[];
  readonly status: ClaimStatus;
  readonly retentionPolicy: RetentionPolicy | null;
  readonly governance: GovernanceDecision | null;
}

// ── SHARED_TYPES.md S10.3 -- AuditLogEntry ──

/** SHARED_TYPES.md S10.3 -- Unified audit record */
export interface AuditLogEntry {
  readonly id: EventId;
  readonly timestamp: string;
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly event: AgentEvent;
  readonly action: GovernanceAction | null;
  readonly governanceDecision: GovernanceDecision | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly previousHash: string;
  readonly currentHash: string;
  readonly classification: ClassificationLevel;
}

// ── SHARED_TYPES.md S11 -- ComputerAction ──

/** SHARED_TYPES.md S11.1 -- ActionBase */
export interface ActionBase {
  readonly type: string;
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly requestId: EventId;
}

/** SHARED_TYPES.md S11 -- ComputerAction (simplified for adapter use) */
export type ComputerAction = ActionBase & {
  readonly [key: string]: unknown;
};

/** SHARED_TYPES.md S11.4 -- NativeAgentAction */
export interface NativeAgentAction {
  readonly adapterId: AdapterId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly nativeType: string;
  readonly nativePayload: unknown;
  readonly timestamp: string;
}

// ── SHARED_TYPES.md S12, S12.1 -- Sandbox ──

/** SHARED_TYPES.md S12 -- SandboxConfig (rich) */
export interface SandboxConfig {
  readonly filesystem?: {
    readonly allowedPaths: readonly string[];
    readonly deniedPaths: readonly string[];
    readonly readOnly: boolean;
  };
  readonly network?: {
    readonly allowedHosts: readonly string[];
    readonly deniedHosts: readonly string[];
  };
  readonly process?: {
    readonly allowedCommands: readonly string[];
    readonly deniedCommands: readonly string[];
  };
  readonly resource?: {
    readonly maxMemoryMb?: number;
    readonly maxCpuPercent?: number;
  };
  readonly duration?: {
    readonly maxDurationMs: number;
  };
}

/** SHARED_TYPES.md S12.1 -- AdapterSandboxDefaults (lightweight) */
export interface AdapterSandboxDefaults {
  readonly allowedPathPatterns: readonly string[];
  readonly deniedPathPatterns: readonly string[];
  readonly allowedHostPatterns: readonly string[];
  readonly deniedHostPatterns: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly deniedCommands: readonly string[];
  readonly maxDurationMs?: number | null;
  readonly readOnlyFilesystem: boolean;
}

// ── SHARED_TYPES.md S13.1 -- AdapterRefusalHint ──

/** SHARED_TYPES.md S13.1 -- Lightweight refusal hint */
export interface AdapterRefusalHint {
  readonly name: string;
  readonly condition: unknown;
  readonly verdict: 'refuse' | 'escalate' | 'sandbox';
  readonly message: string;
}

// ── SHARED_TYPES.md S14 -- MergeStrategy ──

/** SHARED_TYPES.md S14 -- 4-value merge strategy */
export type MergeStrategy = 'highest_confidence' | 'most_recent' | 'manual' | 'union';

/** SHARED_TYPES.md S14.2 -- MergeConflict */
export interface MergeConflict {
  readonly conflictId: string;
  readonly claimIdA: ClaimId;
  readonly claimIdB: ClaimId;
  readonly predicate: string;
  readonly valueA: unknown;
  readonly valueB: unknown;
  readonly confidenceA: number;
  readonly confidenceB: number;
}

/** SHARED_TYPES.md S14.2 -- ManualMergeState */
export interface ManualMergeState {
  readonly mergeId: string;
  readonly pendingConflicts: readonly MergeConflict[];
  readonly resolvedConflicts: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** SHARED_TYPES.md S14.2 -- ManualMergeResolution */
export type ManualMergeResolution = 'keep_a' | 'keep_b' | 'merge_new_value' | 'discard_both';

// ── SHARED_TYPES.md S15 -- SessionSummary ──

/** SHARED_TYPES.md S15 -- Session summary on close */
export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly duration: number;
  readonly operationCount: number;
  readonly governanceRefusals: number;
  readonly branchesCreated: number;
  readonly branchesMerged: number;
  readonly missionsCompleted: number;
  readonly tokensBudgetUsed: number;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
}

// ── SHARED_TYPES.md S16 -- Event System ──

/** SHARED_TYPES.md S16.1 -- AgentEvent (subset relevant to adapter) */
export type AgentEvent = string;

/** SHARED_TYPES.md S16.2 -- AgentEventPayload */
export interface AgentEventPayload {
  readonly eventId: EventId;
  readonly event: AgentEvent;
  readonly timestamp: string;
  readonly adapterId: AdapterId;
  readonly sessionId: SessionId | null;
  readonly agentId: AgentId;
  readonly data: Readonly<Record<string, unknown>>;
}

/** SHARED_TYPES.md S16.2 -- AgentEventHandler */
export type AgentEventHandler = (payload: AgentEventPayload) => void;

/** SHARED_TYPES.md S16.2 -- AgentEventBus */
export interface AgentEventBus {
  emit(payload: AgentEventPayload): void;
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}

// ── SHARED_TYPES.md S17 -- RetentionPolicy ──

/** SHARED_TYPES.md S17 -- Retention policy */
export interface RetentionPolicy {
  readonly classification: ClassificationLevel;
  readonly retentionDays: number;
  readonly archiveAfterDays?: number;
  readonly purgeAfterDays?: number;
}

// ── SHARED_TYPES.md S18 -- RateLimitPolicy ──

/** SHARED_TYPES.md S18 -- Rate limit policy */
export interface RateLimitPolicy {
  readonly scope: 'global' | 'per_agent' | 'per_session' | 'per_adapter';
  readonly operation: string;
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly verdict: 'refuse' | 'throttle';
}

/** SHARED_TYPES.md S18 -- Default rate limits */
export const DEFAULT_RATE_LIMITS: readonly RateLimitPolicy[] = [
  { scope: 'per_session', operation: 'memory:write', maxRequests: 100, windowMs: 60_000, verdict: 'refuse' },
  { scope: 'per_session', operation: 'memory:read', maxRequests: 200, windowMs: 60_000, verdict: 'refuse' },
  { scope: 'per_agent', operation: 'memory:write', maxRequests: 1000, windowMs: 3_600_000, verdict: 'refuse' },
  { scope: 'per_session', operation: 'execution:tool_call', maxRequests: 50, windowMs: 60_000, verdict: 'refuse' },
];

// ── SHARED_TYPES.md S20, S20.1 -- Performance Budget and Token ──

/** SHARED_TYPES.md S20 -- Performance budget */
export interface PerformanceBudget {
  readonly governanceCheck: number;
  readonly auditAppend: number;
  readonly provenanceBatch: number;
}

/** SHARED_TYPES.md S20.1 -- Token encoding */
export type TokenEncoding = 'cl100k_base' | 'o200k_base' | 'provider_native';

/** SHARED_TYPES.md S20.1 -- Token estimate */
export interface TokenEstimate {
  readonly tokens: number;
  readonly encoding: TokenEncoding;
  readonly overflow: boolean;
  readonly components: Readonly<Record<string, number>>;
}

/** SHARED_TYPES.md S20.1 -- TokenEstimator */
export interface TokenEstimator {
  estimate(content: string | unknown, encoding: TokenEncoding): TokenEstimate;
}

// ── SHARED_TYPES.md S24 -- ActionDigest ──

/** SHARED_TYPES.md S24 -- Lightweight action summary */
export interface ActionDigest {
  readonly action: string;
  readonly domain: string;
  readonly timestamp: string;
  readonly sessionId: SessionId;
  readonly outcome: 'allowed' | 'refused' | 'escalated' | 'sandboxed';
}

// ── AGENT_ADAPTER_ARCHITECTURE.md S5.1 -- AgentToolCall ──

/** AGENT_ADAPTER_ARCHITECTURE.md S5.1 -- Native tool call */
export interface AgentToolCall {
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly callId: string;
  readonly agentFramework: AgentFramework;
  readonly rawPayload: unknown;
}

// ── AGENT_ADAPTER_ARCHITECTURE.md S5.2 -- LimenOperation ──

/** AGENT_ADAPTER_ARCHITECTURE.md S5.2 -- Discriminated union of operations */
export type LimenOperation =
  | { readonly type: 'remember'; readonly content: string | StructuredContent; readonly options?: AgentMemoryOptions }
  | { readonly type: 'recall'; readonly query: AgentRecallQuery; readonly options?: AgentRecallOptions }
  | { readonly type: 'forget'; readonly entryId: ClaimId; readonly reason: string }
  | { readonly type: 'get_belief'; readonly beliefId: ClaimId }
  | { readonly type: 'create_branch'; readonly baseBeliefId: ClaimId; readonly description: string }
  | { readonly type: 'merge_branches'; readonly branchIds: readonly AgentBranchId[]; readonly strategy: MergeStrategy }
  | { readonly type: 'discard_branch'; readonly branchId: AgentBranchId }
  | { readonly type: 'relate'; readonly fromId: ClaimId; readonly toId: ClaimId; readonly relationType: RelationshipType }
  | { readonly type: 'check_permission'; readonly action: ComputerAction; readonly context: GovernanceContext };

// ── AGENT_ADAPTER_ARCHITECTURE.md S6 -- LimenAgentClient ──

/** AGENT_ADAPTER_ARCHITECTURE.md -- LimenAgentClient interface */
export interface LimenAgentClient {
  startSession(config: unknown): Promise<AgentSession>;
  endSession(sessionId: SessionId): Promise<SessionSummary>;
  remember(ctx: OperationContext, content: string | StructuredContent, options?: AgentMemoryOptions): Promise<ClaimId>;
  recall(ctx: OperationContext, query: AgentRecallQuery, options?: AgentRecallOptions): Promise<{ beliefs: BeliefState[]; totalCount: number }>;
  createBranch(ctx: OperationContext, baseBeliefId: ClaimId, description: string): Promise<AgentBranchId>;
  mergeBranches(ctx: OperationContext, branchIds: readonly AgentBranchId[], strategy: MergeStrategy): Promise<MergeResultData>;
  resolveConflict(ctx: OperationContext, resolution: ManualMergeResolutionRequest): Promise<MergeResultData>;
  appendAudit(entry: Partial<AuditLogEntry>): Promise<EventId>;
  healthProbe(): Promise<{ connected: boolean; latencyMs: number }>;
}

/** Merge result data from Limen Core */
export interface MergeResultData {
  readonly status: 'completed' | 'pending_resolution' | 'failed';
  readonly mergedClaimIds: readonly ClaimId[];
  readonly conflictsResolved: readonly MergeConflictRecord[];
  readonly unresolvedConflicts: readonly MergeConflict[];
  readonly manualMergeState: ManualMergeState | null;
}

// ── AGENT_ADAPTER_ARCHITECTURE.md S6 -- ComputerActionGovernor ──

/** AGENT_ADAPTER_ARCHITECTURE.md -- Governance governor interface */
export interface ComputerActionGovernor {
  beforeAction(ctx: GovernanceContext): Promise<GovernanceVerdict>;
  afterAction(action: ComputerAction, result: unknown): Promise<void>;
}

// ── AGENT_ADAPTER_ARCHITECTURE.md S9.1 -- Adapter lifecycle state ──

/** Adapter lifecycle state */
export type AdapterLifecycleState =
  | 'UNINITIALIZED'
  | 'INITIALIZING'
  | 'READY'
  | 'DEGRADED'
  | 'SHUTDOWN';

// ── Adapter Error Codes ──

/** Adapter error codes (shared across all adapters) */
export type AdapterErrorCode =
  | 'NOT_INITIALIZED'
  | 'ALREADY_INITIALIZED'
  | 'TIME_PROVIDER_UNAVAILABLE'
  | 'GOVERNANCE_REFUSAL'
  | 'TRUST_LEVEL_INSUFFICIENT'
  | 'CAPABILITY_NOT_DECLARED'
  | 'UNKNOWN_TOOL'
  | 'BUDGET_EXCEEDED'
  | 'CORE_PORT_UNAVAILABLE'
  | 'AUDIT_FAILURE'
  | 'SERDE_ERROR'
  | 'BRANCH_CONFLICT'
  | 'SESSION_NOT_FOUND'
  | 'SHUTDOWN_FAILED'
  | 'TRANSLATION_FAILED'
  | 'MAX_SESSIONS_EXCEEDED'
  | 'CLIENT_ERROR'
  | 'INTERNAL';

/** @deprecated Use AdapterErrorCode */
export type CrewAIAdapterErrorCode = AdapterErrorCode;

/** Deterministic error precedence (1=highest) */
export const ERROR_PRECEDENCE: Record<AdapterErrorCode, number> = {
  'NOT_INITIALIZED': 1,
  'ALREADY_INITIALIZED': 2,
  'TIME_PROVIDER_UNAVAILABLE': 3,
  'SERDE_ERROR': 4,
  'GOVERNANCE_REFUSAL': 5,
  'TRUST_LEVEL_INSUFFICIENT': 6,
  'CAPABILITY_NOT_DECLARED': 7,
  'UNKNOWN_TOOL': 8,
  'TRANSLATION_FAILED': 9,
  'MAX_SESSIONS_EXCEEDED': 10,
  'BUDGET_EXCEEDED': 11,
  'CORE_PORT_UNAVAILABLE': 12,
  'AUDIT_FAILURE': 13,
  'BRANCH_CONFLICT': 14,
  'SESSION_NOT_FOUND': 15,
  'SHUTDOWN_FAILED': 16,
  'CLIENT_ERROR': 17,
  'INTERNAL': 18,
};

/** Non-retryable errors */
export const NEVER_RETRYABLE: ReadonlySet<AdapterErrorCode> = new Set([
  'NOT_INITIALIZED',
  'GOVERNANCE_REFUSAL',
]);

// ── Shared result types used by adapters ──

/** Recall result */
export interface RecallResult {
  readonly beliefs: readonly BeliefState[];
  readonly totalCount: number;
  readonly truncated: boolean;
  readonly tokenEstimate: TokenEstimate;
}

/** Merge result */
export interface MergeResult {
  readonly status: 'completed' | 'pending_resolution' | 'failed';
  readonly mergedClaimIds: readonly ClaimId[];
  readonly conflictsResolved: readonly MergeConflictRecord[];
  readonly unresolvedConflicts: readonly MergeConflict[];
  readonly manualMergeState: ManualMergeState | null;
  readonly auditId: EventId;
}

/** Merge conflict record */
export interface MergeConflictRecord {
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly winningClaimId: ClaimId;
}

/** Manual merge resolution request */
export interface ManualMergeResolutionRequest {
  readonly mergeId: string;
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly newValue?: string;
  readonly newConfidence?: number;
}

/** Token budget config */
export interface TokenBudgetConfig {
  readonly maxTokensPerOperation: number;
  readonly maxTokensPerSession: number;
  readonly encoding: TokenEncoding;
  readonly warningThresholdPct: number;
  readonly replenishmentWindowSeconds?: number | null;
}

/** Retry policy */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryableErrors: readonly AdapterErrorCode[];
}

/** Adapter health */
export interface AdapterHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly lifecycleState: AdapterLifecycleState;
  readonly lastActivity: string | null;
  readonly activeSessions: number;
  readonly errorCount: number;
  readonly uptimeMs: number;
  readonly corePortConnected: boolean;
  readonly tokenBudgetRemaining: number;
  readonly tokenBudgetTotal: number;
  readonly lastError?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

// ── Shared Adapter Config Types ──

/**
 * Generic adapter config shared across all framework adapters.
 * Each framework adapter extends this with framework-specific fields.
 */
export interface BaseAdapterConfig {
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly trustLevel: AgentTrustLevel;
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly defaultClassification: ClassificationLevel;
  readonly governed?: true;
  readonly rateLimits: readonly RateLimitPolicy[];
  readonly sandboxDefaults: AdapterSandboxDefaults;
  readonly refusalHints: readonly AdapterRefusalHint[];
  readonly tokenBudget: TokenBudgetConfig;
  readonly coreEndpoint: string;
  readonly connectionTimeoutMs: number;
  readonly retryPolicy: RetryPolicy;
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
  readonly sessionId: SessionId;
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
