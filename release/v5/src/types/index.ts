/*
 * Phase X shared type projection.
 * Contract refs: MASTER-INDEX-v2.2-FINAL.md §2.2; SHARED_TYPES.md v1.4.1 §§1-10, §§14-16, §§18, §§20-21, §24, §27.
 * TC-21 parity: this TypeScript projection is mirrored by crates/limen_foundation/src/types/mod.rs using serde literal names.
 */

// SHARED_TYPES.md §1.1a: Kernel IDs are branded string aliases and remain inherited, not modified.
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type MissionId = Brand<string, 'MissionId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type EventId = Brand<string, 'EventId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type PolicyId = Brand<string, 'PolicyId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type SessionId = Brand<string, 'SessionId'>;

// SHARED_TYPES.md §1.1b: Protocol IDs are branded string aliases and remain inherited, not modified.
export type ClaimId = Brand<string, 'ClaimId'>;
export type RelationshipId = Brand<string, 'RelationshipId'>;
export type ReservationId = Brand<string, 'ReservationId'>;
export type WaveId = Brand<string, 'WaveId'>;
export type EvaluationId = Brand<string, 'EvaluationId'>;
export type PromotionDecisionId = Brand<string, 'PromotionDecisionId'>;

// SHARED_TYPES.md §4: Phase X branded IDs are new branded string aliases.
export type AgentBranchId = Brand<string, 'AgentBranchId'>;
export type AdapterId = Brand<string, 'AdapterId'>;
export type ConsentId = Brand<string, 'ConsentId'>;
export type AuditEntryId = Brand<string, 'AuditEntryId'>;
export type TriggerConfigId = Brand<string, 'TriggerConfigId'>;
export type KnowledgePackageId = Brand<string, 'KnowledgePackageId'>;

export function brand<T extends string>(value: string): Brand<string, T> {
  return value as Brand<string, T>;
}

// SHARED_TYPES.md §1.2: Permission is a closed 31-value literal union.
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
  | 'manage_agents';

export const PERMISSIONS: readonly Permission[] = [
  'create_agent', 'modify_agent', 'delete_agent',
  'chat', 'infer',
  'create_mission',
  'view_telemetry', 'view_audit',
  'manage_providers', 'manage_budgets', 'manage_roles',
  'purge_data',
  'approve_response', 'edit_response', 'takeover_session', 'review_batch',
  'classify_claims', 'manage_classification_rules',
  'manage_protected_predicates',
  'request_erasure', 'export_compliance',
  'assert_claim', 'retract_claim', 'query_claims', 'relate_claims',
  'write_wm', 'read_wm',
  'manage_consent', 'view_consent',
  'manage_cognitive',
  'manage_agents',
];

// SHARED_TYPES.md §1.3: OperationContext carries explicit identity, permissions, session, and clearance.
export interface OperationContext {
  readonly tenantId: TenantId | null;
  readonly userId: UserId | null;
  readonly agentId: AgentId | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly sessionId?: SessionId;
  readonly clearanceLevel?: number;
}

export interface LimenViolation {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly spec: string;
}

// SHARED_TYPES.md §1.4: KernelError is the canonical fallible-operation error envelope.
export interface KernelError {
  readonly code: string;
  readonly message: string;
  readonly spec: string;
  readonly violations?: readonly LimenViolation[];
}

// SHARED_TYPES.md §1.5: Result<T> is the only success/error carrier for fallible TypeScript operations.
export type Result<T, E extends KernelError = KernelError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T, E extends KernelError = KernelError>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<E extends KernelError>(error: E): Result<never, E> {
  return { ok: false, error };
}

// AGENT_ADAPTER_ARCHITECTURE.md §11: AdapterKernelError uses the canonical AdapterErrorCode taxonomy.
export type AdapterErrorCode =
  | 'NOT_INITIALIZED'
  | 'ALREADY_INITIALIZED'
  | 'SHUTDOWN_FAILED'
  | 'TRANSLATION_FAILED'
  | 'UNKNOWN_TOOL'
  | 'CAPABILITY_NOT_DECLARED'
  | 'GOVERNANCE_REFUSAL'
  | 'SESSION_NOT_FOUND'
  | 'MAX_SESSIONS_EXCEEDED'
  | 'TRUST_LEVEL_INSUFFICIENT'
  | 'CLIENT_ERROR'
  | 'INTERNAL'
  | 'CORE_PORT_UNAVAILABLE'
  | 'INVALID_TRANSITION'
  | 'SERDE_ERROR'
  | 'AUDIT_APPEND_FAILED'
  | 'GOVERNANCE_UNAVAILABLE'
  | 'PERFORMANCE_BUDGET_EXCEEDED';

export interface AdapterKernelError extends KernelError {
  readonly code: AdapterErrorCode;
  readonly adapterId: AdapterId;
  readonly context?: Readonly<Record<string, unknown>>;
}

export function adapterError(
  adapterId: AdapterId,
  code: AdapterErrorCode,
  message: string,
  spec: string,
  context?: Readonly<Record<string, unknown>>,
): AdapterKernelError {
  const base = { code, message, spec, adapterId };
  return context === undefined ? base : { ...base, context };
}

// SHARED_TYPES.md §2: CCP types are inherited closed literal unions.
export type ObjectType = 'string' | 'number' | 'boolean' | 'date' | 'json';
export type ClaimStatus = 'active' | 'retracted';
export type GroundingMode = 'evidence_path' | 'runtime_witness';
export type FreshnessLabel = 'fresh' | 'aging' | 'stale';
export type ArchiveMode = 'exclude' | 'include' | 'only';
export type EvidenceType = 'memory' | 'artifact' | 'claim' | 'capability_result';
export type RelationshipType = 'supports' | 'contradicts' | 'supersedes' | 'derived_from';

// SHARED_TYPES.md §3: ClassificationLevel is a closed union with numeric clearance mapping.
export type ClassificationLevel = 'unrestricted' | 'internal' | 'confidential' | 'restricted' | 'critical';
export const CLASSIFICATION_NUMERIC: Record<ClassificationLevel, number> = {
  unrestricted: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 4,
};

// SHARED_TYPES.md §5: Trust mapping is authoritative for Phase X sessions.
export type CoreTrustLevel = 'untrusted' | 'probationary' | 'trusted' | 'admin';
export type AgentTrustLevel = 'untrusted' | 'low' | 'medium' | 'high' | 'verified';
export const TRUST_TO_CLEARANCE: Record<AgentTrustLevel, number> = {
  untrusted: 0,
  low: 1,
  medium: 2,
  high: 3,
  verified: 4,
};
export const PHASE_X_TO_CORE_TRUST: Record<AgentTrustLevel, CoreTrustLevel> = {
  untrusted: 'untrusted',
  low: 'probationary',
  medium: 'trusted',
  high: 'trusted',
  verified: 'admin',
};
export const AGENT_TRUST_LEVELS: readonly AgentTrustLevel[] = ['untrusted', 'low', 'medium', 'high', 'verified'];

// SHARED_TYPES.md §6: AgentCapability is the canonical 20-value union.
export type AgentCapability =
  | 'memory_read' | 'memory_write' | 'belief_management' | 'branching'
  | 'technique_learning' | 'technique_transfer'
  | 'mission_creation' | 'mission_delegation'
  | 'computer_use' | 'browser_use' | 'terminal_use'
  | 'file_access' | 'code_execution' | 'api_calls' | 'network_access'
  | 'multi_agent' | 'knowledge_export' | 'knowledge_import'
  | 'context_management' | 'governance_admin';

export const AGENT_CAPABILITIES: readonly AgentCapability[] = [
  'memory_read', 'memory_write', 'belief_management', 'branching',
  'technique_learning', 'technique_transfer',
  'mission_creation', 'mission_delegation',
  'computer_use', 'browser_use', 'terminal_use',
  'file_access', 'code_execution', 'api_calls', 'network_access',
  'multi_agent', 'knowledge_export', 'knowledge_import',
  'context_management', 'governance_admin',
];

export const CAPABILITY_MIN_TRUST: Record<AgentCapability, AgentTrustLevel> = {
  memory_read: 'untrusted',
  context_management: 'untrusted',
  memory_write: 'low',
  belief_management: 'low',
  branching: 'medium',
  technique_learning: 'medium',
  mission_creation: 'medium',
  file_access: 'medium',
  api_calls: 'medium',
  computer_use: 'high',
  browser_use: 'high',
  terminal_use: 'high',
  code_execution: 'high',
  network_access: 'high',
  multi_agent: 'high',
  technique_transfer: 'high',
  mission_delegation: 'high',
  knowledge_export: 'high',
  knowledge_import: 'high',
  governance_admin: 'verified',
};

export function trustAllowsCapability(trustLevel: AgentTrustLevel, capability: AgentCapability): boolean {
  return TRUST_TO_CLEARANCE[trustLevel] >= TRUST_TO_CLEARANCE[CAPABILITY_MIN_TRUST[capability]];
}

export function effectiveCapabilities(
  trustLevel: AgentTrustLevel,
  requested: ReadonlySet<AgentCapability>,
): ReadonlySet<AgentCapability> {
  return new Set([...requested].filter((capability) => trustAllowsCapability(trustLevel, capability)));
}

// SHARED_TYPES.md §7: AgentSession is the canonical session object.
export interface AgentSession {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly adapterId: AdapterId;
  readonly trustLevel: AgentTrustLevel;
  readonly coreTrustLevel: CoreTrustLevel;
  readonly clearanceLevel: number;
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly startedAt: string;
  readonly workingMemoryNamespace: string;
  readonly activeMissions: readonly MissionId[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function validateAgentSession(session: AgentSession): boolean {
  return session.clearanceLevel === TRUST_TO_CLEARANCE[session.trustLevel]
    && session.coreTrustLevel === PHASE_X_TO_CORE_TRUST[session.trustLevel]
    && [...session.capabilities].every((capability) => trustAllowsCapability(session.trustLevel, capability));
}

// SHARED_TYPES.md §8: AgentSession converts to OperationContext exactly through derivePermissions.
export function sessionToContext(session: AgentSession): OperationContext {
  return {
    tenantId: session.tenantId,
    userId: null,
    agentId: session.agentId,
    permissions: derivePermissions(session.capabilities),
    sessionId: session.sessionId,
    clearanceLevel: session.clearanceLevel,
  };
}

// SHARED_TYPES.md §8.1: Complete capability-to-permission mapping.
export const CAPABILITY_TO_PERMISSIONS: Record<AgentCapability, readonly Permission[]> = {
  memory_read: ['query_claims', 'read_wm'],
  memory_write: ['assert_claim', 'retract_claim', 'relate_claims', 'write_wm'],
  belief_management: ['query_claims', 'relate_claims'],
  branching: ['assert_claim', 'retract_claim', 'query_claims', 'relate_claims'],
  technique_learning: ['query_claims', 'assert_claim'],
  technique_transfer: ['query_claims', 'assert_claim', 'relate_claims'],
  mission_creation: ['create_mission'],
  mission_delegation: ['create_mission', 'create_agent'],
  computer_use: ['view_telemetry'],
  browser_use: ['view_telemetry'],
  terminal_use: ['view_telemetry'],
  file_access: ['view_telemetry'],
  code_execution: ['view_telemetry'],
  api_calls: ['view_telemetry'],
  network_access: ['view_telemetry'],
  multi_agent: ['create_agent', 'modify_agent'],
  knowledge_export: ['query_claims', 'export_compliance'],
  knowledge_import: ['assert_claim', 'relate_claims'],
  context_management: ['read_wm', 'write_wm'],
  governance_admin: [
    'classify_claims', 'manage_classification_rules',
    'manage_protected_predicates', 'manage_agents',
    'manage_roles', 'manage_consent', 'view_consent',
    'manage_cognitive', 'view_audit', 'purge_data',
  ],
};

export function derivePermissions(capabilities: ReadonlySet<AgentCapability>): ReadonlySet<Permission> {
  const permissions = new Set<Permission>();
  for (const capability of capabilities) {
    for (const permission of CAPABILITY_TO_PERMISSIONS[capability]) {
      permissions.add(permission);
    }
  }
  return permissions;
}

// SHARED_TYPES.md §§9-10: GovernanceAction and GovernanceVerdict are closed discriminated unions.
export type GovernanceAction =
  | { readonly domain: 'memory'; readonly operation: 'write' | 'read' | 'delete' | 'branch' | 'merge' | 'resolve_merge_conflict' }
  | { readonly domain: 'computer'; readonly operation: ComputerActionType }
  | { readonly domain: 'execution'; readonly operation: 'create_mission' | 'delegate' | 'cancel' | 'retry' | 'tool_call' }
  | { readonly domain: 'lifecycle'; readonly operation: 'register' | 'promote' | 'demote' | 'suspend' | 'decommission' }
  | { readonly domain: 'knowledge'; readonly operation: 'export' | 'import' | 'transfer' }
  | { readonly domain: 'consent'; readonly operation: 'register' | 'revoke' | 'check' }
  | { readonly domain: 'context'; readonly operation: 'write_wm' | 'discard_wm' | 'pin' | 'unpin' | 'evict' | 'boundary_trigger' }
  | { readonly domain: 'search'; readonly operation: 'query' | 'embed' | 'duplicate_check' | 'configure' }
  | { readonly domain: 'coordination'; readonly operation: 'a2a_send' | 'fork_session' | 'sync' | 'replay' | 'rule' }
  | { readonly domain: 'output'; readonly operation: 'produce' | 'telemetry' | 'infer' | 'plugin' | 'hook' };

export type ComputerActionType =
  | 'file:read' | 'file:write' | 'file:delete'
  | 'directory:list'
  | 'terminal:execute'
  | 'browser:navigate' | 'browser:click' | 'browser:input' | 'browser:extract'
  | 'api:call'
  | 'code:execute'
  | 'process:spawn' | 'process:kill'
  | 'network:connect'
  | 'clipboard:access'
  | 'screenshot:capture'
  | 'database:query';

export interface GovernanceContext {
  readonly operationContext: OperationContext;
  readonly session: AgentSession;
  readonly action: GovernanceAction;
  readonly resource: string | null;
  readonly policyIds: readonly PolicyId[];
  readonly actionHistory: readonly ActionDigest[];
}

export type GovernanceVerdict =
  | { readonly verdict: 'allow'; readonly auditId: EventId; readonly conditions?: readonly string[] }
  | { readonly verdict: 'refuse'; readonly auditId: EventId; readonly reason: string; readonly rule: string; readonly alternatives?: readonly string[] }
  | { readonly verdict: 'escalate'; readonly auditId: EventId; readonly reason: string; readonly requiredApproval: 'human' | 'senior_agent' }
  | { readonly verdict: 'sandbox'; readonly auditId: EventId; readonly config: SandboxConfig };

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

export function validateGovernanceDecision(decision: GovernanceDecision): boolean {
  const verdictAllows = decision.verdict.verdict === 'allow';
  const rejectionHasCause = decision.reason !== null
    || decision.missingPermissions.length > 0
    || decision.clearanceRequired !== null;
  return decision.allowed === verdictAllows && (decision.allowed || rejectionHasCause);
}

// SHARED_TYPES.md §10.2: Memory and belief records are shared across Phase X surfaces.
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

export interface EvidenceRef {
  readonly type: EvidenceType;
  readonly id: string;
  readonly description?: string;
}

export interface RelationshipRef {
  readonly id: RelationshipId;
  readonly type: RelationshipType;
  readonly targetId: ClaimId;
}

export interface BeliefState {
  readonly belief: AgentMemoryEntry;
  readonly evidence: readonly EvidenceRef[];
  readonly relationships: readonly RelationshipRef[];
  readonly status: ClaimStatus;
  readonly retentionPolicy: RetentionPolicy | null;
  readonly governance: GovernanceDecision | null;
}

export type AgentBeliefState = BeliefState;

// SHARED_TYPES.md §10.2.1: Adapter-facing memory request DTOs are canonical shared request types.
export interface StructuredContent {
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly objectType?: ObjectType;
}

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

export interface AgentRecallOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly includeEvidence?: boolean;
  readonly includeRelationships?: boolean;
  readonly searchMode?: 'text' | 'semantic' | 'hybrid';
  readonly archiveMode?: ArchiveMode;
  readonly sortBy?: 'relevance' | 'confidence' | 'recency';
}

// SHARED_TYPES.md §10.3: AuditLogEntry is append-only and hash-chained.
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

export type AgentAuditEntry = AuditLogEntry;

// SHARED_TYPES.md §§11-14 support the adapter and client operation surface.
export interface ActionBase {
  readonly type: ComputerActionType;
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly requestId: EventId;
}

export type ComputerAction = ActionBase & Readonly<Record<string, unknown>>;

export interface NativeAgentAction {
  readonly adapterId: AdapterId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly nativeType: string;
  readonly nativePayload: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

export interface SandboxConfig {
  readonly filesystem: FilesystemSandbox;
  readonly network: NetworkSandbox;
  readonly process: ProcessSandbox;
  readonly resources: ResourceSandbox;
  readonly duration: DurationSandbox;
}

export interface FilesystemSandbox {
  readonly allowedPaths: readonly string[];
  readonly deniedPaths: readonly string[];
  readonly readOnly: boolean;
  readonly maxFileSize: number;
  readonly maxTotalSize: number;
}

export interface NetworkSandbox {
  readonly allowedHosts: readonly string[];
  readonly deniedHosts: readonly string[];
  readonly allowedProtocols: readonly ('http' | 'https' | 'tcp' | 'udp' | 'tls')[];
  readonly maxConnections: number;
  readonly maxBandwidth: number;
}

export interface ProcessSandbox {
  readonly allowedCommands: readonly string[];
  readonly deniedCommands: readonly string[];
  readonly maxProcesses: number;
  readonly inheritEnv: boolean;
  readonly allowedEnvVars: readonly string[];
}

export interface ResourceSandbox {
  readonly maxMemory: number;
  readonly maxCpu: number;
  readonly maxDiskIO: number;
}

export interface DurationSandbox {
  readonly maxDuration: number;
  readonly hardKillAfter: number;
  readonly warningAt: number;
}

export interface AdapterSandboxDefaults {
  readonly allowedPathPatterns?: readonly string[];
  readonly deniedPathPatterns?: readonly string[];
  readonly allowedHostPatterns?: readonly string[];
  readonly deniedHostPatterns?: readonly string[];
  readonly allowedCommands?: readonly string[];
  readonly deniedCommands?: readonly string[];
  readonly maxDurationMs?: number;
  readonly readOnlyFilesystem?: boolean;
}

export type RefusalCondition =
  | { readonly type: 'path_match'; readonly pattern: string; readonly deny: boolean }
  | { readonly type: 'command_match'; readonly pattern: string }
  | { readonly type: 'host_match'; readonly pattern: string }
  | { readonly type: 'action_type'; readonly actionTypes: readonly ComputerActionType[] }
  | { readonly type: 'trust_below'; readonly minimumTrust: AgentTrustLevel }
  | { readonly type: 'rate_exceeded'; readonly policy: RateLimitPolicy }
  | { readonly type: 'classification_above'; readonly maxLevel: ClassificationLevel }
  | { readonly type: 'time_window'; readonly denyDuring: { readonly start: string; readonly end: string } }
  | { readonly type: 'composite'; readonly operator: 'and' | 'or' | 'not'; readonly conditions: readonly RefusalCondition[] };

export interface AdapterRefusalHint {
  readonly name: string;
  readonly condition: RefusalCondition;
  readonly verdict: 'refuse' | 'escalate' | 'sandbox';
  readonly message: string;
}

export type MergeStrategy = 'highest_confidence' | 'evidence_weighted' | 'temporal_latest' | 'manual';
export type ManualMergeResolution = 'keep_branch' | 'keep_trunk' | 'keep_both' | 'discard_both' | 'merge_new_value';

export interface MergeConflict {
  readonly conflictId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly branchValue: string;
  readonly branchConfidence: number;
  readonly trunkValue: string;
  readonly trunkConfidence: number;
}

export interface MergeConflictResolution {
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly newValue?: string;
  readonly newConfidence?: number;
  readonly resolvedBy: AgentId;
  readonly resolvedAt: string;
}

export interface ManualMergeState {
  readonly mergeId: string;
  readonly status: 'pending_resolution' | 'resolved' | 'timed_out' | 'discarded';
  readonly conflicts: readonly MergeConflict[];
  readonly resolved: readonly MergeConflictResolution[];
  readonly deadline: string;
  readonly discardedReason?: 'timeout' | 'session_ended' | 'explicit_discard';
}

export interface MergeResult {
  readonly status: 'completed' | 'pending_resolution' | 'failed';
  readonly mergedClaimIds: readonly ClaimId[];
  readonly conflictsResolved: readonly MergeConflictResolution[];
  readonly unresolvedConflicts: readonly MergeConflict[];
  readonly manualMergeState: ManualMergeState | null;
  readonly auditId: EventId;
}

export interface ManualMergeResolutionRequest {
  readonly mergeId: string;
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly newValue?: string;
  readonly newConfidence?: number;
}

// SHARED_TYPES.md §15: Session summaries are canonical session terminal records.
export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly adapterId: AdapterId;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly duration: number;
  readonly operations: SessionOperationCounts;
  readonly governance: SessionGovernanceCounts;
  readonly branches: SessionBranchCounts;
  readonly missions: SessionMissionCounts;
}

export interface SessionOperationCounts {
  readonly memoryWrites: number;
  readonly memoryReads: number;
  readonly memoryDeletes: number;
  readonly computerActions: number;
  readonly totalOperations: number;
}

export interface SessionGovernanceCounts {
  readonly allowed: number;
  readonly refused: number;
  readonly escalated: number;
  readonly sandboxed: number;
}

export interface SessionBranchCounts {
  readonly created: number;
  readonly merged: number;
  readonly discarded: number;
}

export interface SessionMissionCounts {
  readonly created: number;
  readonly completed: number;
  readonly failed: number;
}

// SHARED_TYPES.md §16.1 and §21 TC-21 proof: TS literal unions are mirrored by Rust serde enums with identical wire names.
export type AgentEvent =
  | 'memory:created' | 'memory:recalled' | 'memory:forgotten'
  | 'memory:branch_created' | 'memory:branch_merged' | 'memory:branch_discarded'
  | 'governance:allowed' | 'governance:refused' | 'governance:escalated' | 'governance:sandboxed'
  | 'action:before' | 'action:after' | 'action:refused'
  | 'session:started' | 'session:ended' | 'session:rejected'
  | 'technique:extracted' | 'technique:evaluated' | 'technique:promoted'
  | 'technique:suspended' | 'technique:retired' | 'technique:transferred'
  | 'cognitive:health_degraded' | 'cognitive:consolidation_complete' | 'cognitive:gap_detected'
  | 'selfheal:triggered' | 'selfheal:cascade' | 'selfheal:complete' | 'selfheal:conflict_resolved'
  | 'mission:created' | 'mission:state_changed' | 'mission:delegated'
  | 'mission:completed' | 'mission:failed' | 'mission:cancelled'
  | 'task:created' | 'task:state_changed' | 'task:completed' | 'task:failed' | 'task:retried'
  | 'budget:reserved' | 'budget:consumed' | 'budget:released' | 'budget:exhausted'
  | 'wave:started' | 'wave:completed' | 'wave:failed'
  | 'context:pressure_changed' | 'context:eviction_triggered' | 'context:eviction_complete'
  | 'context:pin_added' | 'context:pin_removed'
  | 'working_memory:written' | 'working_memory:discarded' | 'working_memory:flushed'
  | 'search:queried' | 'embedding:queued' | 'embedding:completed' | 'duplicate:detected'
  | 'a2a:sent' | 'a2a:refused' | 'session:forked' | 'sync:watermark_advanced' | 'replay:verified' | 'replay:diverged'
  | 'a2a:rule_registered' | 'a2a:rule_removed' | 'a2a:action_validated'
  | 'a2a:action_denied' | 'a2a:action_masked' | 'a2a:rate_limited'
  | 'fork:created' | 'fork:merged' | 'fork:discarded' | 'fork:conflict_detected'
  | 'sync:started' | 'sync:completed' | 'sync:failed' | 'sync:conflict_resolved'
  | 'sync:peer_registered' | 'sync:peer_removed' | 'sync:peer_unreachable'
  | 'replay:snapshot_captured' | 'replay:verification_complete' | 'replay:verification_failed' | 'replay:divergence_detected'
  | 'output:produced' | 'telemetry:reported' | 'inference:completed' | 'inference:rejected'
  | 'plugin:installed' | 'plugin:disabled' | 'hook:failed'
  | 'output:retracted' | 'telemetry:cost_recorded' | 'telemetry:vital_recorded'
  | 'inference:started' | 'inference:retry' | 'inference:failed'
  | 'plugin:uninstalled' | 'plugin:error'
  | 'hook:registered' | 'hook:fired' | 'hook:blocked'
  | 'agent:registered' | 'agent:updated' | 'agent:suspended'
  | 'agent:reactivated' | 'agent:decommissioned'
  | 'capability:granted' | 'capability:revoked'
  | 'trust:promoted' | 'trust:demoted'
  | 'consent:registered' | 'consent:revoked' | 'consent:expired'
  | 'knowledge:exported' | 'knowledge:imported' | 'knowledge:transferred'
  | '*';

export const AGENT_EVENTS: readonly AgentEvent[] = [
  'memory:created', 'memory:recalled', 'memory:forgotten',
  'memory:branch_created', 'memory:branch_merged', 'memory:branch_discarded',
  'governance:allowed', 'governance:refused', 'governance:escalated', 'governance:sandboxed',
  'action:before', 'action:after', 'action:refused',
  'session:started', 'session:ended', 'session:rejected',
  'technique:extracted', 'technique:evaluated', 'technique:promoted',
  'technique:suspended', 'technique:retired', 'technique:transferred',
  'cognitive:health_degraded', 'cognitive:consolidation_complete', 'cognitive:gap_detected',
  'selfheal:triggered', 'selfheal:cascade', 'selfheal:complete', 'selfheal:conflict_resolved',
  'mission:created', 'mission:state_changed', 'mission:delegated',
  'mission:completed', 'mission:failed', 'mission:cancelled',
  'task:created', 'task:state_changed', 'task:completed', 'task:failed', 'task:retried',
  'budget:reserved', 'budget:consumed', 'budget:released', 'budget:exhausted',
  'wave:started', 'wave:completed', 'wave:failed',
  'context:pressure_changed', 'context:eviction_triggered', 'context:eviction_complete',
  'context:pin_added', 'context:pin_removed',
  'working_memory:written', 'working_memory:discarded', 'working_memory:flushed',
  'search:queried', 'embedding:queued', 'embedding:completed', 'duplicate:detected',
  'a2a:sent', 'a2a:refused', 'session:forked', 'sync:watermark_advanced', 'replay:verified', 'replay:diverged',
  'a2a:rule_registered', 'a2a:rule_removed', 'a2a:action_validated',
  'a2a:action_denied', 'a2a:action_masked', 'a2a:rate_limited',
  'fork:created', 'fork:merged', 'fork:discarded', 'fork:conflict_detected',
  'sync:started', 'sync:completed', 'sync:failed', 'sync:conflict_resolved',
  'sync:peer_registered', 'sync:peer_removed', 'sync:peer_unreachable',
  'replay:snapshot_captured', 'replay:verification_complete', 'replay:verification_failed', 'replay:divergence_detected',
  'output:produced', 'telemetry:reported', 'inference:completed', 'inference:rejected',
  'plugin:installed', 'plugin:disabled', 'hook:failed',
  'output:retracted', 'telemetry:cost_recorded', 'telemetry:vital_recorded',
  'inference:started', 'inference:retry', 'inference:failed',
  'plugin:uninstalled', 'plugin:error',
  'hook:registered', 'hook:fired', 'hook:blocked',
  'agent:registered', 'agent:updated', 'agent:suspended',
  'agent:reactivated', 'agent:decommissioned',
  'capability:granted', 'capability:revoked',
  'trust:promoted', 'trust:demoted',
  'consent:registered', 'consent:revoked', 'consent:expired',
  'knowledge:exported', 'knowledge:imported', 'knowledge:transferred',
  '*',
];

export interface AgentEventPayload {
  readonly type: AgentEvent;
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly auditId: EventId;
  readonly data: Readonly<Record<string, unknown>>;
}

export type AgentEventHandler = (payload: AgentEventPayload) => void | Promise<void>;

export interface AgentEventBus {
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
  emit(payload: AgentEventPayload): void;
}

export type EventBus = AgentEventBus;

export type AgentFramework = 'claude' | 'codex' | 'openclaw' | 'hermes' | 'gemma' | 'custom' | 'crew_ai' | 'auto_gen' | 'semantic_kernel' | 'llama_index';
export const AGENT_FRAMEWORKS: readonly AgentFramework[] = ['claude', 'codex', 'openclaw', 'hermes', 'gemma', 'custom', 'crew_ai', 'auto_gen', 'semantic_kernel', 'llama_index'];

// SHARED_TYPES.md §§17-18, §20, §24: Supporting policy, budget, and action history records.
export interface RetentionPolicy {
  readonly classification: ClassificationLevel;
  readonly retentionDays: number;
  readonly autoArchiveDays: number | null;
  readonly tombstoneOnExpiry: boolean;
  readonly gdprOverride: boolean;
}

export interface RateLimitPolicy {
  readonly scope: 'per_agent' | 'per_session' | 'per_adapter' | 'global';
  readonly dimension: 'actions' | 'memory_writes' | 'computer_actions' | 'all_operations';
  readonly limit: number;
  readonly windowSeconds: number;
  readonly enforcement: 'hard_refuse' | 'soft_throttle' | 'queue';
}

export interface PerformanceBudget {
  readonly governanceCheck: { readonly maxMs: 10; readonly includes: 'rule_evaluation, verdict_production' };
  readonly auditAppend: { readonly maxMs: 50; readonly mode: 'durable_before_success'; readonly guarantees: 'no_success_without_audit' };
  readonly provenanceHash: { readonly maxMs: 100; readonly mode: 'batched_background'; readonly batchSize: 100 };
  readonly fullChainVerification: { readonly mode: 'on_demand'; readonly notPerOperation: true };
}

export interface ActionDigest {
  readonly actionId: EventId;
  readonly type: string;
  readonly timestamp: string;
  readonly verdict: 'allow' | 'refuse' | 'escalate' | 'sandbox';
  readonly duration: number;
}

export const TYPE_PARITY_PROOF = {
  source: 'SHARED_TYPES.md v1.4.1 TC-21',
  agentEventWireNames: AGENT_EVENTS,
  agentFrameworkWireNames: AGENT_FRAMEWORKS,
  governanceVerdictDiscriminant: 'verdict',
  rustProjection: 'release/v5/crates/limen_foundation/src/types/mod.rs',
} as const;
