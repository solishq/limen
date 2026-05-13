//! Rust projection of Phase X shared types.
//! Contract refs: SHARED_TYPES.md v1.4.1 §§1-10, §§14-16, §§18, §§20-21, §24, §25.
//! TC-21 proof: TypeScript literal unions in release/v5/src/types/index.ts serialize to the same wire names as these serde enums.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

macro_rules! branded_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub struct $name(pub String);
    };
}

branded_id!(TenantId);
branded_id!(UserId);
branded_id!(AgentId);
branded_id!(MissionId);
branded_id!(TaskId);
branded_id!(EventId);
branded_id!(ArtifactId);
branded_id!(PolicyId);
branded_id!(RoleId);
branded_id!(SessionId);
branded_id!(ClaimId);
branded_id!(RelationshipId);
branded_id!(ReservationId);
branded_id!(WaveId);
branded_id!(EvaluationId);
branded_id!(PromotionDecisionId);
branded_id!(AgentBranchId);
branded_id!(AdapterId);
branded_id!(ConsentId);
branded_id!(AuditEntryId);
branded_id!(TriggerConfigId);
branded_id!(KnowledgePackageId);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    CreateAgent,
    ModifyAgent,
    DeleteAgent,
    Chat,
    Infer,
    CreateMission,
    ViewTelemetry,
    ViewAudit,
    ManageProviders,
    ManageBudgets,
    ManageRoles,
    PurgeData,
    ApproveResponse,
    EditResponse,
    TakeoverSession,
    ReviewBatch,
    ClassifyClaims,
    ManageClassificationRules,
    ManageProtectedPredicates,
    RequestErasure,
    ExportCompliance,
    AssertClaim,
    RetractClaim,
    QueryClaims,
    RelateClaims,
    WriteWm,
    ReadWm,
    ManageConsent,
    ViewConsent,
    ManageCognitive,
    ManageAgents,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OperationContext {
    pub tenant_id: Option<TenantId>,
    pub user_id: Option<UserId>,
    pub agent_id: Option<AgentId>,
    pub permissions: Vec<Permission>,
    pub session_id: Option<SessionId>,
    pub clearance_level: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LimenViolation {
    pub code: String,
    pub message: String,
    pub path: Option<String>,
    pub spec: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KernelError {
    pub code: String,
    pub message: String,
    pub spec: String,
    pub violations: Option<Vec<LimenViolation>>,
}

pub type LimenResult<T> = Result<T, KernelError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdapterErrorCode {
    NotInitialized,
    AlreadyInitialized,
    ShutdownFailed,
    TranslationFailed,
    UnknownTool,
    CapabilityNotDeclared,
    GovernanceRefusal,
    SessionNotFound,
    MaxSessionsExceeded,
    TrustLevelInsufficient,
    ClientError,
    Internal,
    CorePortUnavailable,
    InvalidTransition,
    SerdeError,
    AuditAppendFailed,
    GovernanceUnavailable,
    PerformanceBudgetExceeded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterKernelError {
    pub code: AdapterErrorCode,
    pub message: String,
    pub adapter_id: AdapterId,
    pub spec: String,
    pub context: Option<BTreeMap<String, Value>>,
}

pub type AdapterResult<T> = Result<T, AdapterKernelError>;

impl AdapterKernelError {
    pub fn new(
        adapter_id: AdapterId,
        code: AdapterErrorCode,
        message: impl Into<String>,
        spec: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            adapter_id,
            spec: spec.into(),
            context: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectType {
    String,
    Number,
    Boolean,
    Date,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Active,
    Retracted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroundingMode {
    EvidencePath,
    RuntimeWitness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessLabel {
    Fresh,
    Aging,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveMode {
    Exclude,
    Include,
    Only,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    Memory,
    Artifact,
    Claim,
    CapabilityResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipType {
    Supports,
    Contradicts,
    Supersedes,
    DerivedFrom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClassificationLevel {
    Unrestricted = 0,
    Internal = 1,
    Confidential = 2,
    Restricted = 3,
    Critical = 4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreTrustLevel {
    Untrusted,
    Probationary,
    Trusted,
    Admin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTrustLevel {
    Untrusted = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Verified = 4,
}

impl AgentTrustLevel {
    pub const fn clearance_level(self) -> u8 {
        match self {
            Self::Untrusted => 0,
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Verified => 4,
        }
    }

    pub const fn core_trust_level(self) -> CoreTrustLevel {
        match self {
            Self::Untrusted => CoreTrustLevel::Untrusted,
            Self::Low => CoreTrustLevel::Probationary,
            Self::Medium | Self::High => CoreTrustLevel::Trusted,
            Self::Verified => CoreTrustLevel::Admin,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCapability {
    MemoryRead,
    MemoryWrite,
    BeliefManagement,
    Branching,
    TechniqueLearning,
    TechniqueTransfer,
    MissionCreation,
    MissionDelegation,
    ComputerUse,
    BrowserUse,
    TerminalUse,
    FileAccess,
    CodeExecution,
    ApiCalls,
    NetworkAccess,
    MultiAgent,
    KnowledgeExport,
    KnowledgeImport,
    ContextManagement,
    GovernanceAdmin,
}

pub const AGENT_CAPABILITIES: [AgentCapability; 20] = [
    AgentCapability::MemoryRead,
    AgentCapability::MemoryWrite,
    AgentCapability::BeliefManagement,
    AgentCapability::Branching,
    AgentCapability::TechniqueLearning,
    AgentCapability::TechniqueTransfer,
    AgentCapability::MissionCreation,
    AgentCapability::MissionDelegation,
    AgentCapability::ComputerUse,
    AgentCapability::BrowserUse,
    AgentCapability::TerminalUse,
    AgentCapability::FileAccess,
    AgentCapability::CodeExecution,
    AgentCapability::ApiCalls,
    AgentCapability::NetworkAccess,
    AgentCapability::MultiAgent,
    AgentCapability::KnowledgeExport,
    AgentCapability::KnowledgeImport,
    AgentCapability::ContextManagement,
    AgentCapability::GovernanceAdmin,
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSession {
    pub session_id: SessionId,
    pub agent_id: AgentId,
    pub tenant_id: Option<TenantId>,
    pub adapter_id: AdapterId,
    pub trust_level: AgentTrustLevel,
    pub core_trust_level: CoreTrustLevel,
    pub clearance_level: u8,
    pub capabilities: Vec<AgentCapability>,
    pub started_at: String,
    pub working_memory_namespace: String,
    pub active_missions: Vec<MissionId>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ComputerActionType {
    #[serde(rename = "file:read")]
    FileRead,
    #[serde(rename = "file:write")]
    FileWrite,
    #[serde(rename = "file:delete")]
    FileDelete,
    #[serde(rename = "directory:list")]
    DirectoryList,
    #[serde(rename = "terminal:execute")]
    TerminalExecute,
    #[serde(rename = "browser:navigate")]
    BrowserNavigate,
    #[serde(rename = "browser:click")]
    BrowserClick,
    #[serde(rename = "browser:input")]
    BrowserInput,
    #[serde(rename = "browser:extract")]
    BrowserExtract,
    #[serde(rename = "api:call")]
    ApiCall,
    #[serde(rename = "code:execute")]
    CodeExecute,
    #[serde(rename = "process:spawn")]
    ProcessSpawn,
    #[serde(rename = "process:kill")]
    ProcessKill,
    #[serde(rename = "network:connect")]
    NetworkConnect,
    #[serde(rename = "clipboard:access")]
    ClipboardAccess,
    #[serde(rename = "screenshot:capture")]
    ScreenshotCapture,
    #[serde(rename = "database:query")]
    DatabaseQuery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOperation {
    Write,
    Read,
    Delete,
    Branch,
    Merge,
    ResolveMergeConflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionOperation {
    CreateMission,
    Delegate,
    Cancel,
    Retry,
    ToolCall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleOperation {
    Register,
    Promote,
    Demote,
    Suspend,
    Decommission,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeOperation {
    Export,
    Import,
    Transfer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsentOperation {
    Register,
    Revoke,
    Check,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextOperation {
    WriteWm,
    DiscardWm,
    Pin,
    Unpin,
    Evict,
    BoundaryTrigger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchOperation {
    Query,
    Embed,
    DuplicateCheck,
    Configure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoordinationOperation {
    A2aSend,
    ForkSession,
    Sync,
    Replay,
    Rule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputOperation {
    Produce,
    Telemetry,
    Infer,
    Plugin,
    Hook,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "domain")]
pub enum GovernanceAction {
    #[serde(rename = "memory")]
    Memory { operation: MemoryOperation },
    #[serde(rename = "computer")]
    Computer { operation: ComputerActionType },
    #[serde(rename = "execution")]
    Execution { operation: ExecutionOperation },
    #[serde(rename = "lifecycle")]
    Lifecycle { operation: LifecycleOperation },
    #[serde(rename = "knowledge")]
    Knowledge { operation: KnowledgeOperation },
    #[serde(rename = "consent")]
    Consent { operation: ConsentOperation },
    #[serde(rename = "context")]
    Context { operation: ContextOperation },
    #[serde(rename = "search")]
    Search { operation: SearchOperation },
    #[serde(rename = "coordination")]
    Coordination { operation: CoordinationOperation },
    #[serde(rename = "output")]
    Output { operation: OutputOperation },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GovernanceContext {
    pub operation_context: OperationContext,
    pub session: AgentSession,
    pub action: GovernanceAction,
    pub resource: Option<String>,
    pub policy_ids: Vec<PolicyId>,
    pub action_history: Vec<ActionDigest>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum GovernanceVerdict {
    #[serde(rename_all = "camelCase")]
    Allow {
        audit_id: EventId,
        conditions: Option<Vec<String>>,
    },
    #[serde(rename_all = "camelCase")]
    Refuse {
        audit_id: EventId,
        reason: String,
        rule: String,
        alternatives: Option<Vec<String>>,
    },
    #[serde(rename_all = "camelCase")]
    Escalate {
        audit_id: EventId,
        reason: String,
        required_approval: ApprovalType,
    },
    #[serde(rename_all = "camelCase")]
    Sandbox {
        audit_id: EventId,
        config: Box<SandboxConfig>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalType {
    Human,
    SeniorAgent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GovernanceDecision {
    pub allowed: bool,
    pub verdict: GovernanceVerdict,
    pub reason: Option<String>,
    pub required_permissions: Vec<Permission>,
    pub missing_permissions: Vec<Permission>,
    pub clearance_required: Option<u8>,
    pub clearance_actual: Option<u8>,
    pub evaluated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMemoryEntry {
    pub id: ClaimId,
    pub content: String,
    pub subject: String,
    pub predicate: String,
    pub value: Value,
    pub confidence: f64,
    pub effective_confidence: f64,
    pub freshness: FreshnessLabel,
    pub classification: ClassificationLevel,
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub source_agent_id: AgentId,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub grounding_mode: GroundingMode,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRef {
    #[serde(rename = "type")]
    pub evidence_type: EvidenceType,
    pub id: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelationshipRef {
    pub id: RelationshipId,
    #[serde(rename = "type")]
    pub relationship_type: RelationshipType,
    pub target_id: ClaimId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BeliefState {
    pub belief: AgentMemoryEntry,
    pub evidence: Vec<EvidenceRef>,
    pub relationships: Vec<RelationshipRef>,
    pub status: ClaimStatus,
    pub retention_policy: Option<RetentionPolicy>,
    pub governance: Option<GovernanceDecision>,
}

pub type AgentBeliefState = BeliefState;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StructuredContent {
    pub subject: String,
    pub predicate: String,
    pub value: Value,
    pub object_type: Option<ObjectType>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMemoryOptions {
    pub confidence: Option<f64>,
    pub reasoning: Option<String>,
    pub classification: Option<ClassificationLevel>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub grounding_mode: Option<GroundingMode>,
    pub retention_days: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimeRange {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeWindow {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FreshnessFilter {
    One(FreshnessLabel),
    Many(Vec<FreshnessLabel>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentRecallQuery {
    pub text: Option<String>,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub freshness_filter: Option<FreshnessFilter>,
    pub min_confidence: Option<f64>,
    pub time_range: Option<TimeRange>,
    pub classification: Option<ClassificationLevel>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub source_agent_id: Option<AgentId>,
    pub include_superseded: Option<bool>,
    pub branch_id: Option<AgentBranchId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Text,
    Semantic,
    Hybrid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecallSortBy {
    Relevance,
    Confidence,
    Recency,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentRecallOptions {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub include_evidence: Option<bool>,
    pub include_relationships: Option<bool>,
    pub search_mode: Option<SearchMode>,
    pub archive_mode: Option<ArchiveMode>,
    pub sort_by: Option<RecallSortBy>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: EventId,
    pub timestamp: String,
    pub tenant_id: Option<TenantId>,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub event: AgentEvent,
    pub action: Option<GovernanceAction>,
    pub governance_decision: Option<GovernanceDecision>,
    pub details: Value,
    pub previous_hash: String,
    pub current_hash: String,
    pub classification: ClassificationLevel,
}

pub type AgentAuditEntry = AuditLogEntry;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionBase {
    #[serde(rename = "type")]
    pub action_type: ComputerActionType,
    pub timestamp: String,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub request_id: EventId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComputerAction {
    #[serde(flatten)]
    pub base: ActionBase,
    #[serde(flatten)]
    pub payload: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeAgentAction {
    pub adapter_id: AdapterId,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub native_type: String,
    pub native_payload: BTreeMap<String, Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub filesystem: FilesystemSandbox,
    pub network: NetworkSandbox,
    pub process: ProcessSandbox,
    pub resources: ResourceSandbox,
    pub duration: DurationSandbox,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilesystemSandbox {
    pub allowed_paths: Vec<String>,
    pub denied_paths: Vec<String>,
    pub read_only: bool,
    pub max_file_size: u64,
    pub max_total_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NetworkSandbox {
    pub allowed_hosts: Vec<String>,
    pub denied_hosts: Vec<String>,
    pub allowed_protocols: Vec<String>,
    pub max_connections: u32,
    pub max_bandwidth: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessSandbox {
    pub allowed_commands: Vec<String>,
    pub denied_commands: Vec<String>,
    pub max_processes: u32,
    pub inherit_env: bool,
    pub allowed_env_vars: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceSandbox {
    pub max_memory: u64,
    pub max_cpu: u8,
    pub max_disk_io: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DurationSandbox {
    pub max_duration: u64,
    pub hard_kill_after: u64,
    pub warning_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterSandboxDefaults {
    pub allowed_path_patterns: Vec<String>,
    pub denied_path_patterns: Vec<String>,
    pub allowed_host_patterns: Vec<String>,
    pub denied_host_patterns: Vec<String>,
    pub allowed_commands: Vec<String>,
    pub denied_commands: Vec<String>,
    pub max_duration_ms: Option<u64>,
    pub read_only_filesystem: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterRefusalHint {
    pub name: String,
    pub condition: RefusalCondition,
    pub verdict: RefusalVerdict,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalVerdict {
    Refuse,
    Escalate,
    Sandbox,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RefusalCondition {
    PathMatch {
        pattern: String,
        deny: bool,
    },
    CommandMatch {
        pattern: String,
    },
    HostMatch {
        pattern: String,
    },
    ActionType {
        action_types: Vec<ComputerActionType>,
    },
    TrustBelow {
        minimum_trust: AgentTrustLevel,
    },
    RateExceeded {
        policy: RateLimitPolicy,
    },
    ClassificationAbove {
        max_level: ClassificationLevel,
    },
    TimeWindow {
        deny_during: TimeWindow,
    },
    Composite {
        operator: CompositeOperator,
        conditions: Vec<RefusalCondition>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompositeOperator {
    And,
    Or,
    Not,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    HighestConfidence,
    EvidenceWeighted,
    TemporalLatest,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManualMergeResolution {
    KeepBranch,
    KeepTrunk,
    KeepBoth,
    DiscardBoth,
    MergeNewValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeConflict {
    pub conflict_id: String,
    pub subject: String,
    pub predicate: String,
    pub branch_value: String,
    pub branch_confidence: f64,
    pub trunk_value: String,
    pub trunk_confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeConflictResolution {
    pub conflict_id: String,
    pub resolution: ManualMergeResolution,
    pub new_value: Option<String>,
    pub new_confidence: Option<f64>,
    pub resolved_by: AgentId,
    pub resolved_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManualMergeStatus {
    PendingResolution,
    Resolved,
    TimedOut,
    Discarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManualMergeDiscardedReason {
    Timeout,
    SessionEnded,
    ExplicitDiscard,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManualMergeState {
    pub merge_id: String,
    pub status: ManualMergeStatus,
    pub conflicts: Vec<MergeConflict>,
    pub resolved: Vec<MergeConflictResolution>,
    pub deadline: String,
    pub discarded_reason: Option<ManualMergeDiscardedReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStatus {
    Completed,
    PendingResolution,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeResult {
    pub status: MergeStatus,
    pub merged_claim_ids: Vec<ClaimId>,
    pub conflicts_resolved: Vec<MergeConflictResolution>,
    pub unresolved_conflicts: Vec<MergeConflict>,
    pub manual_merge_state: Option<ManualMergeState>,
    pub audit_id: EventId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManualMergeResolutionRequest {
    pub merge_id: String,
    pub conflict_id: String,
    pub resolution: ManualMergeResolution,
    pub new_value: Option<String>,
    pub new_confidence: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub session_id: SessionId,
    pub agent_id: AgentId,
    pub adapter_id: AdapterId,
    pub started_at: String,
    pub ended_at: String,
    pub duration: u64,
    pub operations: SessionOperationCounts,
    pub governance: SessionGovernanceCounts,
    pub branches: SessionBranchCounts,
    pub missions: SessionMissionCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionOperationCounts {
    pub memory_writes: u64,
    pub memory_reads: u64,
    pub memory_deletes: u64,
    pub computer_actions: u64,
    pub total_operations: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionGovernanceCounts {
    pub allowed: u64,
    pub refused: u64,
    pub escalated: u64,
    pub sandboxed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionBranchCounts {
    pub created: u64,
    pub merged: u64,
    pub discarded: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionMissionCounts {
    pub created: u64,
    pub completed: u64,
    pub failed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AgentEvent {
    #[serde(rename = "memory:created")]
    MemoryCreated,
    #[serde(rename = "memory:recalled")]
    MemoryRecalled,
    #[serde(rename = "memory:forgotten")]
    MemoryForgotten,
    #[serde(rename = "memory:branch_created")]
    MemoryBranchCreated,
    #[serde(rename = "memory:branch_merged")]
    MemoryBranchMerged,
    #[serde(rename = "memory:branch_discarded")]
    MemoryBranchDiscarded,
    #[serde(rename = "governance:allowed")]
    GovernanceAllowed,
    #[serde(rename = "governance:refused")]
    GovernanceRefused,
    #[serde(rename = "governance:escalated")]
    GovernanceEscalated,
    #[serde(rename = "governance:sandboxed")]
    GovernanceSandboxed,
    #[serde(rename = "action:before")]
    ActionBefore,
    #[serde(rename = "action:after")]
    ActionAfter,
    #[serde(rename = "action:refused")]
    ActionRefused,
    #[serde(rename = "session:started")]
    SessionStarted,
    #[serde(rename = "session:ended")]
    SessionEnded,
    #[serde(rename = "session:rejected")]
    SessionRejected,
    #[serde(rename = "technique:extracted")]
    TechniqueExtracted,
    #[serde(rename = "technique:evaluated")]
    TechniqueEvaluated,
    #[serde(rename = "technique:promoted")]
    TechniquePromoted,
    #[serde(rename = "technique:suspended")]
    TechniqueSuspended,
    #[serde(rename = "technique:retired")]
    TechniqueRetired,
    #[serde(rename = "technique:transferred")]
    TechniqueTransferred,
    #[serde(rename = "cognitive:health_degraded")]
    CognitiveHealthDegraded,
    #[serde(rename = "cognitive:consolidation_complete")]
    CognitiveConsolidationComplete,
    #[serde(rename = "cognitive:gap_detected")]
    CognitiveGapDetected,
    #[serde(rename = "selfheal:triggered")]
    SelfhealTriggered,
    #[serde(rename = "selfheal:cascade")]
    SelfhealCascade,
    #[serde(rename = "selfheal:complete")]
    SelfhealComplete,
    #[serde(rename = "selfheal:conflict_resolved")]
    SelfhealConflictResolved,
    #[serde(rename = "mission:created")]
    MissionCreated,
    #[serde(rename = "mission:state_changed")]
    MissionStateChanged,
    #[serde(rename = "mission:delegated")]
    MissionDelegated,
    #[serde(rename = "mission:completed")]
    MissionCompleted,
    #[serde(rename = "mission:failed")]
    MissionFailed,
    #[serde(rename = "mission:cancelled")]
    MissionCancelled,
    #[serde(rename = "task:created")]
    TaskCreated,
    #[serde(rename = "task:state_changed")]
    TaskStateChanged,
    #[serde(rename = "task:completed")]
    TaskCompleted,
    #[serde(rename = "task:failed")]
    TaskFailed,
    #[serde(rename = "task:retried")]
    TaskRetried,
    #[serde(rename = "budget:reserved")]
    BudgetReserved,
    #[serde(rename = "budget:consumed")]
    BudgetConsumed,
    #[serde(rename = "budget:released")]
    BudgetReleased,
    #[serde(rename = "budget:exhausted")]
    BudgetExhausted,
    #[serde(rename = "wave:started")]
    WaveStarted,
    #[serde(rename = "wave:completed")]
    WaveCompleted,
    #[serde(rename = "wave:failed")]
    WaveFailed,
    #[serde(rename = "context:pressure_changed")]
    ContextPressureChanged,
    #[serde(rename = "context:eviction_triggered")]
    ContextEvictionTriggered,
    #[serde(rename = "context:eviction_complete")]
    ContextEvictionComplete,
    #[serde(rename = "context:pin_added")]
    ContextPinAdded,
    #[serde(rename = "context:pin_removed")]
    ContextPinRemoved,
    #[serde(rename = "working_memory:written")]
    WorkingMemoryWritten,
    #[serde(rename = "working_memory:discarded")]
    WorkingMemoryDiscarded,
    #[serde(rename = "working_memory:flushed")]
    WorkingMemoryFlushed,
    #[serde(rename = "search:queried")]
    SearchQueried,
    #[serde(rename = "embedding:queued")]
    EmbeddingQueued,
    #[serde(rename = "embedding:completed")]
    EmbeddingCompleted,
    #[serde(rename = "duplicate:detected")]
    DuplicateDetected,
    #[serde(rename = "a2a:sent")]
    A2aSent,
    #[serde(rename = "a2a:refused")]
    A2aRefused,
    #[serde(rename = "session:forked")]
    SessionForked,
    #[serde(rename = "sync:watermark_advanced")]
    SyncWatermarkAdvanced,
    #[serde(rename = "replay:verified")]
    ReplayVerified,
    #[serde(rename = "replay:diverged")]
    ReplayDiverged,
    #[serde(rename = "a2a:rule_registered")]
    A2aRuleRegistered,
    #[serde(rename = "a2a:rule_removed")]
    A2aRuleRemoved,
    #[serde(rename = "a2a:action_validated")]
    A2aActionValidated,
    #[serde(rename = "a2a:action_denied")]
    A2aActionDenied,
    #[serde(rename = "a2a:action_masked")]
    A2aActionMasked,
    #[serde(rename = "a2a:rate_limited")]
    A2aRateLimited,
    #[serde(rename = "fork:created")]
    ForkCreated,
    #[serde(rename = "fork:merged")]
    ForkMerged,
    #[serde(rename = "fork:discarded")]
    ForkDiscarded,
    #[serde(rename = "fork:conflict_detected")]
    ForkConflictDetected,
    #[serde(rename = "sync:started")]
    SyncStarted,
    #[serde(rename = "sync:completed")]
    SyncCompleted,
    #[serde(rename = "sync:failed")]
    SyncFailed,
    #[serde(rename = "sync:conflict_resolved")]
    SyncConflictResolved,
    #[serde(rename = "sync:peer_registered")]
    SyncPeerRegistered,
    #[serde(rename = "sync:peer_removed")]
    SyncPeerRemoved,
    #[serde(rename = "sync:peer_unreachable")]
    SyncPeerUnreachable,
    #[serde(rename = "replay:snapshot_captured")]
    ReplaySnapshotCaptured,
    #[serde(rename = "replay:verification_complete")]
    ReplayVerificationComplete,
    #[serde(rename = "replay:verification_failed")]
    ReplayVerificationFailed,
    #[serde(rename = "replay:divergence_detected")]
    ReplayDivergenceDetected,
    #[serde(rename = "output:produced")]
    OutputProduced,
    #[serde(rename = "telemetry:reported")]
    TelemetryReported,
    #[serde(rename = "inference:completed")]
    InferenceCompleted,
    #[serde(rename = "inference:rejected")]
    InferenceRejected,
    #[serde(rename = "plugin:installed")]
    PluginInstalled,
    #[serde(rename = "plugin:disabled")]
    PluginDisabled,
    #[serde(rename = "hook:failed")]
    HookFailed,
    #[serde(rename = "output:retracted")]
    OutputRetracted,
    #[serde(rename = "telemetry:cost_recorded")]
    TelemetryCostRecorded,
    #[serde(rename = "telemetry:vital_recorded")]
    TelemetryVitalRecorded,
    #[serde(rename = "inference:started")]
    InferenceStarted,
    #[serde(rename = "inference:retry")]
    InferenceRetry,
    #[serde(rename = "inference:failed")]
    InferenceFailed,
    #[serde(rename = "plugin:uninstalled")]
    PluginUninstalled,
    #[serde(rename = "plugin:error")]
    PluginError,
    #[serde(rename = "hook:registered")]
    HookRegistered,
    #[serde(rename = "hook:fired")]
    HookFired,
    #[serde(rename = "hook:blocked")]
    HookBlocked,
    #[serde(rename = "agent:registered")]
    AgentRegistered,
    #[serde(rename = "agent:updated")]
    AgentUpdated,
    #[serde(rename = "agent:suspended")]
    AgentSuspended,
    #[serde(rename = "agent:reactivated")]
    AgentReactivated,
    #[serde(rename = "agent:decommissioned")]
    AgentDecommissioned,
    #[serde(rename = "capability:granted")]
    CapabilityGranted,
    #[serde(rename = "capability:revoked")]
    CapabilityRevoked,
    #[serde(rename = "trust:promoted")]
    TrustPromoted,
    #[serde(rename = "trust:demoted")]
    TrustDemoted,
    #[serde(rename = "consent:registered")]
    ConsentRegistered,
    #[serde(rename = "consent:revoked")]
    ConsentRevoked,
    #[serde(rename = "consent:expired")]
    ConsentExpired,
    #[serde(rename = "knowledge:exported")]
    KnowledgeExported,
    #[serde(rename = "knowledge:imported")]
    KnowledgeImported,
    #[serde(rename = "knowledge:transferred")]
    KnowledgeTransferred,
    #[serde(rename = "*")]
    Wildcard,
}

pub const AGENT_EVENTS: [AgentEvent; 120] = [
    AgentEvent::MemoryCreated,
    AgentEvent::MemoryRecalled,
    AgentEvent::MemoryForgotten,
    AgentEvent::MemoryBranchCreated,
    AgentEvent::MemoryBranchMerged,
    AgentEvent::MemoryBranchDiscarded,
    AgentEvent::GovernanceAllowed,
    AgentEvent::GovernanceRefused,
    AgentEvent::GovernanceEscalated,
    AgentEvent::GovernanceSandboxed,
    AgentEvent::ActionBefore,
    AgentEvent::ActionAfter,
    AgentEvent::ActionRefused,
    AgentEvent::SessionStarted,
    AgentEvent::SessionEnded,
    AgentEvent::SessionRejected,
    AgentEvent::TechniqueExtracted,
    AgentEvent::TechniqueEvaluated,
    AgentEvent::TechniquePromoted,
    AgentEvent::TechniqueSuspended,
    AgentEvent::TechniqueRetired,
    AgentEvent::TechniqueTransferred,
    AgentEvent::CognitiveHealthDegraded,
    AgentEvent::CognitiveConsolidationComplete,
    AgentEvent::CognitiveGapDetected,
    AgentEvent::SelfhealTriggered,
    AgentEvent::SelfhealCascade,
    AgentEvent::SelfhealComplete,
    AgentEvent::SelfhealConflictResolved,
    AgentEvent::MissionCreated,
    AgentEvent::MissionStateChanged,
    AgentEvent::MissionDelegated,
    AgentEvent::MissionCompleted,
    AgentEvent::MissionFailed,
    AgentEvent::MissionCancelled,
    AgentEvent::TaskCreated,
    AgentEvent::TaskStateChanged,
    AgentEvent::TaskCompleted,
    AgentEvent::TaskFailed,
    AgentEvent::TaskRetried,
    AgentEvent::BudgetReserved,
    AgentEvent::BudgetConsumed,
    AgentEvent::BudgetReleased,
    AgentEvent::BudgetExhausted,
    AgentEvent::WaveStarted,
    AgentEvent::WaveCompleted,
    AgentEvent::WaveFailed,
    AgentEvent::ContextPressureChanged,
    AgentEvent::ContextEvictionTriggered,
    AgentEvent::ContextEvictionComplete,
    AgentEvent::ContextPinAdded,
    AgentEvent::ContextPinRemoved,
    AgentEvent::WorkingMemoryWritten,
    AgentEvent::WorkingMemoryDiscarded,
    AgentEvent::WorkingMemoryFlushed,
    AgentEvent::SearchQueried,
    AgentEvent::EmbeddingQueued,
    AgentEvent::EmbeddingCompleted,
    AgentEvent::DuplicateDetected,
    AgentEvent::A2aSent,
    AgentEvent::A2aRefused,
    AgentEvent::SessionForked,
    AgentEvent::SyncWatermarkAdvanced,
    AgentEvent::ReplayVerified,
    AgentEvent::ReplayDiverged,
    AgentEvent::A2aRuleRegistered,
    AgentEvent::A2aRuleRemoved,
    AgentEvent::A2aActionValidated,
    AgentEvent::A2aActionDenied,
    AgentEvent::A2aActionMasked,
    AgentEvent::A2aRateLimited,
    AgentEvent::ForkCreated,
    AgentEvent::ForkMerged,
    AgentEvent::ForkDiscarded,
    AgentEvent::ForkConflictDetected,
    AgentEvent::SyncStarted,
    AgentEvent::SyncCompleted,
    AgentEvent::SyncFailed,
    AgentEvent::SyncConflictResolved,
    AgentEvent::SyncPeerRegistered,
    AgentEvent::SyncPeerRemoved,
    AgentEvent::SyncPeerUnreachable,
    AgentEvent::ReplaySnapshotCaptured,
    AgentEvent::ReplayVerificationComplete,
    AgentEvent::ReplayVerificationFailed,
    AgentEvent::ReplayDivergenceDetected,
    AgentEvent::OutputProduced,
    AgentEvent::TelemetryReported,
    AgentEvent::InferenceCompleted,
    AgentEvent::InferenceRejected,
    AgentEvent::PluginInstalled,
    AgentEvent::PluginDisabled,
    AgentEvent::HookFailed,
    AgentEvent::OutputRetracted,
    AgentEvent::TelemetryCostRecorded,
    AgentEvent::TelemetryVitalRecorded,
    AgentEvent::InferenceStarted,
    AgentEvent::InferenceRetry,
    AgentEvent::InferenceFailed,
    AgentEvent::PluginUninstalled,
    AgentEvent::PluginError,
    AgentEvent::HookRegistered,
    AgentEvent::HookFired,
    AgentEvent::HookBlocked,
    AgentEvent::AgentRegistered,
    AgentEvent::AgentUpdated,
    AgentEvent::AgentSuspended,
    AgentEvent::AgentReactivated,
    AgentEvent::AgentDecommissioned,
    AgentEvent::CapabilityGranted,
    AgentEvent::CapabilityRevoked,
    AgentEvent::TrustPromoted,
    AgentEvent::TrustDemoted,
    AgentEvent::ConsentRegistered,
    AgentEvent::ConsentRevoked,
    AgentEvent::ConsentExpired,
    AgentEvent::KnowledgeExported,
    AgentEvent::KnowledgeImported,
    AgentEvent::KnowledgeTransferred,
    AgentEvent::Wildcard,
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentEventPayload {
    #[serde(rename = "type")]
    pub event_type: AgentEvent,
    pub timestamp: String,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub audit_id: EventId,
    pub data: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentFramework {
    Claude,
    Codex,
    Openclaw,
    Hermes,
    Gemma,
    Custom,
    CrewAi,
    AutoGen,
    SemanticKernel,
    LlamaIndex,
}

pub const AGENT_FRAMEWORKS: [AgentFramework; 10] = [
    AgentFramework::Claude,
    AgentFramework::Codex,
    AgentFramework::Openclaw,
    AgentFramework::Hermes,
    AgentFramework::Gemma,
    AgentFramework::Custom,
    AgentFramework::CrewAi,
    AgentFramework::AutoGen,
    AgentFramework::SemanticKernel,
    AgentFramework::LlamaIndex,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetentionPolicy {
    pub classification: ClassificationLevel,
    pub retention_days: u32,
    pub auto_archive_days: Option<u32>,
    pub tombstone_on_expiry: bool,
    pub gdpr_override: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitScope {
    PerAgent,
    PerSession,
    PerAdapter,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitDimension {
    Actions,
    MemoryWrites,
    ComputerActions,
    AllOperations,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitEnforcement {
    HardRefuse,
    SoftThrottle,
    Queue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RateLimitPolicy {
    pub scope: RateLimitScope,
    pub dimension: RateLimitDimension,
    pub limit: u32,
    pub window_seconds: u32,
    pub enforcement: RateLimitEnforcement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionDigest {
    pub action_id: EventId,
    #[serde(rename = "type")]
    pub action_type: String,
    pub timestamp: String,
    pub verdict: ActionDigestVerdict,
    pub duration: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionDigestVerdict {
    Allow,
    Refuse,
    Escalate,
    Sandbox,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_framework_serializes_to_typescript_literals() {
        let names: Vec<String> = AGENT_FRAMEWORKS
            .iter()
            .map(|framework| {
                serde_json::to_value(framework)
                    .expect("serialize framework")
                    .as_str()
                    .expect("string")
                    .to_owned()
            })
            .collect();
        assert_eq!(
            names,
            vec![
                "claude",
                "codex",
                "openclaw",
                "hermes",
                "gemma",
                "custom",
                "crew_ai",
                "auto_gen",
                "semantic_kernel",
                "llama_index",
            ]
        );
    }

    #[test]
    fn governance_verdict_uses_typescript_discriminant() {
        let verdict = GovernanceVerdict::Escalate {
            audit_id: EventId("evt_1".to_owned()),
            reason: "needs human".to_owned(),
            required_approval: ApprovalType::SeniorAgent,
        };
        let value = serde_json::to_value(verdict).expect("serialize verdict");
        assert_eq!(value["verdict"], "escalate");
        assert_eq!(value["requiredApproval"], "senior_agent");
    }
}
