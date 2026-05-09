<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Audit & Visualization Schema Contract v1.2.0

**Status:** RATIFIED DESIGN — Pending Implementation
**Governing:** SolisForge Protocol v1.4 [HISTORICAL: CDM v2.1 + Contract Compliance v2.1 — superseded]
**Scope:** Audit log schema + visualization contracts for agent activity

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

## 1. Purpose

Rich audit and visualization layer for inspecting all AI agent activity within Limen. Provides structured schemas for compliance auditing, runtime debugging, belief graph exploration, and governance decision analysis. All visualization data derives from the append-only hash-chained audit log as single source of truth.

## 2. AgentAuditLog Schema

### 2.1 AgentAuditEntry

Canonical shared type alias to `AuditLogEntry`. See `SHARED_TYPES.md` §10.3. This contract defines visualization payloads derived from the audit log; it does not redefine the append-only audit entry itself.

### 2.2 AuditActionType

```typescript
type AuditActionType =
  | 'memory_write'
  | 'memory_read'
  | 'memory_delete'
  | 'belief_query'
  | 'branch_create'
  | 'branch_merge'
  | 'branch_discard'
  | 'computer_action'
  | 'governance_check'
  | 'session_start'
  | 'session_end'
  | 'agent_register'
  | 'classification_change'
  | 'export'
  | 'import';
```

### 2.3 ActionDetailPayload (Discriminated Union)

```typescript
type ActionDetailPayload =
  | MemoryWriteDetail
  | MemoryReadDetail
  | MemoryDeleteDetail
  | BeliefQueryDetail
  | BranchCreateDetail
  | BranchMergeDetail
  | BranchDiscardDetail
  | ComputerActionDetail
  | GovernanceCheckDetail
  | SessionStartDetail
  | SessionEndDetail
  | AgentRegisterDetail
  | ClassificationChangeDetail
  | ExportDetail
  | ImportDetail;

interface MemoryWriteDetail {
  readonly type: 'memory_write';
  readonly claimId: ClaimId; // See SHARED_TYPES.md §1.1
  readonly subject: string;
  readonly predicate: string;
  readonly confidence: number;
  readonly classification: ClassificationLevel; // See SHARED_TYPES.md §3
  readonly supersedes: ClaimId | null;
}

interface MemoryReadDetail {
  readonly type: 'memory_read';
  readonly query: string;
  readonly resultCount: number;
  readonly claimIdsReturned: readonly ClaimId[];
}

interface MemoryDeleteDetail {
  readonly type: 'memory_delete';
  readonly claimId: ClaimId;
  readonly reason: 'incorrect' | 'superseded' | 'expired' | 'manual';
}

interface BeliefQueryDetail {
  readonly type: 'belief_query';
  readonly subject: string | null;
  readonly predicate: string | null;
  readonly minConfidence: number | null;
  readonly resultCount: number;
  readonly executionMs: number;
}

interface BranchCreateDetail {
  readonly type: 'branch_create';
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly reason: string;
}

interface BranchMergeDetail {
  readonly type: 'branch_merge';
  readonly branchId: string;
  readonly targetBranchId: string;
  readonly claimsMerged: number;
  readonly conflictsResolved: number;
}

interface BranchDiscardDetail {
  readonly type: 'branch_discard';
  readonly branchId: string;
  readonly claimsDiscarded: number;
  readonly reason: string;
}

interface ComputerActionDetail {
  readonly type: 'computer_action';
  readonly actionName: string;
  readonly targetResource: string;
  readonly parameters: Record<string, unknown>;
  readonly resultSummary: string;
  readonly durationMs: number;
}

interface GovernanceCheckDetail {
  readonly type: 'governance_check';
  readonly rule: string;
  readonly requestedAction: string;
  readonly context: Record<string, unknown>;
}

interface SessionStartDetail {
  readonly type: 'session_start';
  readonly agentVersion: string;
  readonly capabilities: readonly AgentCapability[]; // See SHARED_TYPES.md §6
  readonly trustLevel: AgentTrustLevel; // See SHARED_TYPES.md §5
}

interface SessionEndDetail {
  readonly type: 'session_end';
  readonly reason: 'normal' | 'timeout' | 'error' | 'revoked';
  readonly durationMs: number;
  readonly actionsPerformed: number;
}

interface AgentRegisterDetail {
  readonly type: 'agent_register';
  readonly agentName: string;
  readonly capabilities: readonly AgentCapability[]; // See SHARED_TYPES.md §6
  readonly domains: readonly string[];
  readonly initialTrustLevel: AgentTrustLevel; // See SHARED_TYPES.md §5
}

interface ClassificationChangeDetail {
  readonly type: 'classification_change';
  readonly claimId: ClaimId;
  readonly previousClassification: ClassificationLevel;
  readonly newClassification: ClassificationLevel;
  readonly justification: string;
}

interface ExportDetail {
  readonly type: 'export';
  readonly format: ExportFormat;
  readonly scope: ExportScope;
  readonly recordCount: number;
  readonly checksum: string;
}

interface ImportDetail {
  readonly type: 'import';
  readonly source: string;
  readonly recordCount: number;
  readonly validationResult: 'passed' | 'partial' | 'failed';
  readonly failedRecords: number;
}
```

### 2.4 AuditGovernanceRecord

Uses `GovernanceVerdict` verdict values from `SHARED_TYPES.md` §10.

```typescript
interface AuditGovernanceRecord {
  readonly decision: 'allow' | 'refuse' | 'escalate' | 'sandbox';
  readonly reason: string;
  readonly rule: string | null;
  readonly confidence: number;
  readonly evaluationDurationMs: number;
}
```

### 2.5 AuditProvenance

```typescript
interface AuditProvenance {
  readonly chainPosition: number;
  readonly parentActionId: EventId | null;
  readonly correlationId: string; // groups related actions
  readonly sourceAgent: AgentId;
  readonly sourceMission: MissionId | null; // See SHARED_TYPES.md §1.1
  readonly sourceTask: TaskId | null; // See SHARED_TYPES.md §1.1
}
```

### 2.6 MemoryOperationRecord

```typescript
interface MemoryOperationRecord {
  readonly type: 'assert' | 'retract' | 'query' | 'search' | 'relate';
  readonly claimId: ClaimId | null;
  readonly subject: string | null;
  readonly predicate: string | null;
  readonly confidence: number | null;
  readonly resultCount: number | null;
}
```

## 3. AgentSessionTimeline

Session timeline visualization references `AgentSession` from `SHARED_TYPES.md` §7 for session metadata. The timeline structures below are contract-specific visualization types.

### 3.1 SessionTimeline

```typescript
interface SessionTimeline {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly startedAt: string; // ISO 8601
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly entries: readonly TimelineEntry[];
  readonly statistics: SessionStatistics;
}
```

### 3.2 TimelineEntry

```typescript
interface TimelineEntry {
  readonly id: EventId;
  readonly timestamp: string; // ISO 8601
  readonly type: TimelineEntryType;
  readonly summary: string; // human-readable
  readonly governanceDecision: 'allow' | 'refuse' | 'escalate' | 'sandbox' | null;
  readonly relatedClaimIds: readonly ClaimId[];
  readonly metadata: Record<string, unknown>;
}
```

### 3.3 TimelineEntryType

```typescript
type TimelineEntryType =
  | 'memory_operation'
  | 'computer_action'
  | 'governance_event'
  | 'branch_operation'
  | 'session_event'
  | 'error';
```

### 3.4 SessionStatistics

```typescript
interface SessionStatistics {
  readonly totalActions: number;
  readonly memoryWrites: number;
  readonly memoryReads: number;
  readonly governanceRefusals: number;
  readonly governanceEscalations: number;
  readonly branchesCreated: number;
  readonly branchesMerged: number;
  readonly computerActions: number;
  readonly averageConfidence: number;
  readonly uniqueSubjects: number;
  readonly uniquePredicates: number;
}
```

## 4. Belief Graph Schema

### 4.1 BeliefGraphSnapshot

```typescript
interface BeliefGraphSnapshot {
  readonly snapshotId: string;
  readonly timestamp: string; // ISO 8601
  readonly agentId: AgentId | null; // null = all agents
  readonly tenantId: TenantId | null;
  readonly nodes: readonly BeliefGraphNode[];
  readonly edges: readonly BeliefGraphEdge[];
  readonly statistics: GraphStatistics;
}
```

### 4.2 BeliefGraphNode

Uses `FreshnessLabel` from `SHARED_TYPES.md` §2 and `ClassificationLevel` from `SHARED_TYPES.md` §3.

```typescript
interface BeliefGraphNode {
  readonly id: ClaimId;
  readonly label: string; // predicate or summary
  readonly nodeType: 'belief' | 'governance' | 'authority' | 'refusal';
  readonly confidence: number;
  readonly effectiveConfidence: number; // after FSRS decay: R(t) = (1 + t/(9*S))^-1
  readonly freshness: FreshnessLabel; // See SHARED_TYPES.md §2
  readonly classification: ClassificationLevel; // See SHARED_TYPES.md §3
  readonly agentId: AgentId;
  readonly createdAt: string; // ISO 8601
  readonly status: 'active' | 'retracted' | 'archived';
  readonly position?: { readonly x: number; readonly y: number }; // layout hint
}
```

### 4.3 BeliefGraphEdge

```typescript
interface BeliefGraphEdge {
  readonly id: RelationshipId; // See SHARED_TYPES.md §1.1
  readonly source: ClaimId;
  readonly target: ClaimId;
  readonly edgeType:
    | 'supports'
    | 'contradicts'
    | 'supersedes'
    | 'derived_from'
    | 'provenance'
    | 'governance'
    | 'cascade'
    | 'refusal';
  readonly weight: number; // derived from source confidence
  readonly declaredBy: AgentId;
  readonly createdAt: string; // ISO 8601
}
```

### 4.4 GraphStatistics

```typescript
interface GraphStatistics {
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly connectedComponents: number;
  readonly averageConfidence: number;
  readonly freshnessDistribution: {
    readonly fresh: number;
    readonly aging: number;
    readonly stale: number;
  };
  readonly classificationDistribution: Record<ClassificationLevel, number>;
  readonly agentDistribution: Record<string, number>; // agentId -> count
}
```

## 5. Governance Decision Heatmap

### 5.1 GovernanceHeatmapData

```typescript
interface GovernanceHeatmapData {
  readonly timeRange: { readonly from: string; readonly to: string };
  readonly granularity: 'minute' | 'hour' | 'day' | 'week';
  readonly cells: readonly HeatmapCell[];
  readonly totals: GovernanceHeatmapTotals;
}
```

### 5.2 HeatmapCell

Uses `GovernanceVerdict` verdict values (`'allow' | 'refuse' | 'escalate' | 'sandbox'`) from `SHARED_TYPES.md` §10 as column semantics.

```typescript
interface HeatmapCell {
  readonly timestamp: string; // bucket start, ISO 8601
  readonly agentId: AgentId | null; // null = aggregate across agents
  readonly actionCategory: string;
  readonly allowed: number;
  readonly refused: number;
  readonly escalated: number;
  readonly sandboxed: number;
  readonly intensity: number; // 0.0-1.0, normalized within dataset
}
```

### 5.3 GovernanceHeatmapTotals

```typescript
interface GovernanceHeatmapTotals {
  readonly totalDecisions: number;
  readonly allowRate: number; // 0.0-1.0
  readonly refuseRate: number;
  readonly escalateRate: number;
  readonly sandboxRate: number;
  readonly topRefusalRules: readonly { readonly rule: string; readonly count: number }[];
}
```

## 6. Export Contracts

### 6.1 ExportFormat

```typescript
type ExportFormat = 'json' | 'csv' | 'pdf' | 'svg';
```

### 6.2 ExportRequest

```typescript
interface ExportRequest {
  readonly format: ExportFormat;
  readonly scope: ExportScope;
  readonly filters: ExportFilters;
  readonly options: ExportOptions;
}
```

### 6.3 ExportScope

```typescript
type ExportScope = 'session' | 'agent' | 'tenant' | 'time_range' | 'custom_query';
```

### 6.4 ExportFilters

```typescript
interface ExportFilters {
  readonly sessionIds?: readonly SessionId[];
  readonly agentIds?: readonly AgentId[];
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly actionTypes?: readonly AuditActionType[];
  readonly governanceFilter?: 'all' | 'refused_only' | 'escalated_only';
  readonly classificationMax?: ClassificationLevel; // filter out above this level
}
```

### 6.5 ExportOptions

```typescript
interface ExportOptions {
  readonly includeProvenance: boolean;
  readonly includeBeliefGraph: boolean;
  readonly includeTimeline: boolean;
  readonly includeHeatmap: boolean;
  readonly redactClassified: boolean; // redact content above agent clearance
  readonly maxRecords?: number;
}
```

### 6.6 ExportResult

```typescript
interface ExportResult {
  readonly format: ExportFormat;
  readonly data: Buffer | string; // Buffer for PDF/SVG, string for JSON/CSV
  readonly recordCount: number;
  readonly filteredCount: number;
  readonly generatedAt: string; // ISO 8601
  readonly checksum: string; // SHA-256 of data
}
```

## 7. Retention & Privacy Controls

### 7.1 Retention Policy

Audit entries follow the unified retention policy defined in `SHARED_TYPES.md` §17. Classification-based retention applies as follows:

| Classification | Retention | Auto-Archive After | Tombstone on Expiry | GDPR Override |
|---|---|---|---|---|
| unrestricted | 90 days | 30 days | No (hard delete) | Yes |
| internal | 1 year | 90 days | Yes | Yes |
| confidential | 3 years | 1 year | Yes | Yes |
| restricted | 5 years | 2 years | Yes | No |
| critical | 7 years | Never | Yes | No |

The `RetentionPolicy` interface and `DEFAULT_RETENTION` constants are defined in `SHARED_TYPES.md` §17. Implementations use those constants directly.

### 7.2 PrivacyControls

```typescript
interface PrivacyControls {
  readonly dataSubjectMapping: boolean; // link audit entries to data subjects
  readonly consentAware: boolean; // respect consent records in queries
  readonly erasureSupport: boolean; // GDPR erasure via tombstone (not delete)
  readonly auditOfAudit: boolean; // audit access to audit logs themselves
}
```

### 7.3 TombstoneRecord

```typescript
interface TombstoneRecord {
  readonly originalId: EventId;
  readonly tombstonedAt: string; // ISO 8601
  readonly reason: 'gdpr_erasure' | 'retention_expired' | 'manual';
  readonly erasureCertificateId: string | null;
  readonly retainedFields: readonly string[]; // preserved for statistics (e.g., timestamp, actionType)
}
```

## 8. Query Interfaces

### 8.1 AuditQueryService

```typescript
interface AuditQueryService {
  queryEntries(
    filter: AuditFilter,
    pagination: Pagination
  ): Promise<Result<PaginatedResult<AgentAuditEntry>>>; // Result from SHARED_TYPES.md §1.5

  getTimeline(sessionId: SessionId): Promise<Result<SessionTimeline>>;

  getBeliefGraph(options: BeliefGraphOptions): Promise<Result<BeliefGraphSnapshot>>;

  getGovernanceHeatmap(options: HeatmapOptions): Promise<Result<GovernanceHeatmapData>>;

  export(request: ExportRequest): Promise<Result<ExportResult>>;

  verifyChainIntegrity(
    options: IntegrityCheckOptions
  ): Promise<Result<IntegrityReport>>;
}
```

### 8.2 AuditFilter

```typescript
interface AuditFilter {
  readonly agentIds?: readonly AgentId[];
  readonly sessionIds?: readonly SessionId[];
  readonly actionTypes?: readonly AuditActionType[];
  readonly governanceDecision?: 'allow' | 'refuse' | 'escalate' | 'sandbox';
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly classificationMax?: ClassificationLevel;
  readonly searchText?: string;
}
```

### 8.3 Pagination

```typescript
interface Pagination {
  readonly limit: number;
  readonly offset: number;
  readonly sortBy: 'timestamp' | 'actionType' | 'agentId';
  readonly sortOrder: 'asc' | 'desc';
}

interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}
```

### 8.4 BeliefGraphOptions

```typescript
interface BeliefGraphOptions {
  readonly agentId?: AgentId;
  readonly tenantId?: TenantId;
  readonly depth?: number; // max edge hops from root
  readonly rootClaimId?: ClaimId; // start graph from this claim
  readonly includeRetracted?: boolean;
  readonly includeArchived?: boolean;
  readonly layout?: 'force' | 'hierarchical' | 'radial';
}
```

### 8.5 HeatmapOptions

```typescript
interface HeatmapOptions {
  readonly timeRange: { readonly from: string; readonly to: string };
  readonly granularity: 'minute' | 'hour' | 'day' | 'week';
  readonly agentId?: AgentId;
  readonly actionCategory?: string;
}
```

### 8.6 IntegrityCheckOptions

```typescript
interface IntegrityCheckOptions {
  readonly scope: 'full' | 'recent';
  readonly recentWindowHours?: number;
  readonly repairMode?: boolean; // flag broken links, do not mutate data
}
```

### 8.7 IntegrityReport

```typescript
interface IntegrityReport {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly brokenLinks: number;
  readonly hashMismatches: number;
  readonly firstBreakAt: EventId | null;
  readonly details: readonly IntegrityViolation[];
}
```

### 8.8 IntegrityViolation

```typescript
interface IntegrityViolation {
  readonly entryId: EventId;
  readonly type: 'hash_mismatch' | 'missing_parent' | 'sequence_gap' | 'timestamp_regression';
  readonly expected: string;
  readonly actual: string;
}
```

## 9. Rust Types (v5 Alignment)

Branded IDs (`EventId`, `ClaimId`, `AgentId`, `SessionId`, `TenantId`, `MissionId`, `TaskId`, `RelationshipId`), `ClassificationLevel`, `FreshnessLabel`, and `GovernanceVerdict` are defined in `SHARED_TYPES.md` §25. This section defines only contract-specific Rust types.

### 9.1 AuditGovernanceRecord

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// AuditGovernanceDecision maps to GovernanceVerdict.verdict values (SHARED_TYPES.md §10/§25)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditGovernanceDecision {
    Allow,
    Refuse,
    Escalate,
    Sandbox,
}
```

### 9.2 AgentAuditEntry

Canonical Rust type alias to `AuditLogEntry`. See `SHARED_TYPES.md` §25. This contract defines visualization-only projections around the shared audit entry.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditActionType {
    MemoryWrite,
    MemoryRead,
    MemoryDelete,
    BeliefQuery,
    BranchCreate,
    BranchMerge,
    BranchDiscard,
    ComputerAction,
    GovernanceCheck,
    SessionStart,
    SessionEnd,
    AgentRegister,
    ClassificationChange,
    Export,
    Import,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActionDetailPayload {
    MemoryWrite {
        claim_id: ClaimId,
        subject: String,
        predicate: String,
        confidence: f64,
        classification: ClassificationLevel,
        supersedes: Option<ClaimId>,
    },
    MemoryRead {
        query: String,
        result_count: u64,
        claim_ids_returned: Vec<ClaimId>,
    },
    MemoryDelete {
        claim_id: ClaimId,
        reason: RetractReason,
    },
    BeliefQuery {
        subject: Option<String>,
        predicate: Option<String>,
        min_confidence: Option<f64>,
        result_count: u64,
        execution_ms: u64,
    },
    BranchCreate {
        branch_id: String,
        parent_branch_id: Option<String>,
        reason: String,
    },
    BranchMerge {
        branch_id: String,
        target_branch_id: String,
        claims_merged: u64,
        conflicts_resolved: u64,
    },
    BranchDiscard {
        branch_id: String,
        claims_discarded: u64,
        reason: String,
    },
    ComputerAction {
        action_name: String,
        target_resource: String,
        parameters: serde_json::Value,
        result_summary: String,
        duration_ms: u64,
    },
    GovernanceCheck {
        rule: String,
        requested_action: String,
        context: serde_json::Value,
    },
    SessionStart {
        agent_version: String,
        capabilities: Vec<String>,
        trust_level: String,
    },
    SessionEnd {
        reason: SessionEndReason,
        duration_ms: u64,
        actions_performed: u64,
    },
    AgentRegister {
        agent_name: String,
        capabilities: Vec<String>,
        domains: Vec<String>,
        initial_trust_level: String,
    },
    ClassificationChange {
        claim_id: ClaimId,
        previous_classification: ClassificationLevel,
        new_classification: ClassificationLevel,
        justification: String,
    },
    Export {
        format: ExportFormat,
        scope: ExportScope,
        record_count: u64,
        checksum: String,
    },
    Import {
        source: String,
        record_count: u64,
        validation_result: ValidationResult,
        failed_records: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetractReason {
    Incorrect,
    Superseded,
    Expired,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEndReason {
    Normal,
    Timeout,
    Error,
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationResult {
    Passed,
    Partial,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditGovernanceRecord {
    pub decision: AuditGovernanceDecision,
    pub reason: String,
    pub rule: Option<String>,
    pub confidence: f64,
    pub evaluation_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditProvenance {
    pub chain_position: u64,
    pub parent_action_id: Option<EventId>,
    pub correlation_id: String,
    pub source_agent: AgentId,
    pub source_mission: Option<MissionId>,
    pub source_task: Option<TaskId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryOperationRecord {
    pub op_type: MemoryOpType,
    pub claim_id: Option<ClaimId>,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub confidence: Option<f64>,
    pub result_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOpType {
    Assert,
    Retract,
    Query,
    Search,
    Relate,
}
```

### 9.3 BeliefGraphNode

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeliefGraphNode {
    pub id: ClaimId,
    pub label: String,
    pub node_type: NodeType,
    pub confidence: f64,
    pub effective_confidence: f64,
    pub freshness: FreshnessLabel, // See SHARED_TYPES.md §25
    pub classification: ClassificationLevel, // See SHARED_TYPES.md §25
    pub agent_id: AgentId,
    pub created_at: DateTime<Utc>,
    pub status: ClaimStatus,
    pub position: Option<Position2D>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Belief,
    Governance,
    Authority,
    Refusal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Active,
    Retracted,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position2D {
    pub x: f64,
    pub y: f64,
}
```

### 9.4 BeliefGraphEdge

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeliefGraphEdge {
    pub id: RelationshipId,
    pub source: ClaimId,
    pub target: ClaimId,
    pub edge_type: EdgeType,
    pub weight: f64,
    pub declared_by: AgentId,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    Supports,
    Contradicts,
    Supersedes,
    DerivedFrom,
    Provenance,
    Governance,
    Cascade,
    Refusal,
}
```

### 9.5 GovernanceHeatmapData

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceHeatmapData {
    pub time_range: TimeRange,
    pub granularity: Granularity,
    pub cells: Vec<HeatmapCell>,
    pub totals: GovernanceHeatmapTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Granularity {
    Minute,
    Hour,
    Day,
    Week,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatmapCell {
    pub timestamp: DateTime<Utc>,
    pub agent_id: Option<AgentId>,
    pub action_category: String,
    pub allowed: u64,
    pub refused: u64,
    pub escalated: u64,
    pub sandboxed: u64,
    pub intensity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceHeatmapTotals {
    pub total_decisions: u64,
    pub allow_rate: f64,
    pub refuse_rate: f64,
    pub escalate_rate: f64,
    pub sandbox_rate: f64,
    pub top_refusal_rules: Vec<RuleCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleCount {
    pub rule: String,
    pub count: u64,
}
```

### 9.6 ExportResult

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Json,
    Csv,
    Pdf,
    Svg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    Session,
    Agent,
    Tenant,
    TimeRange,
    CustomQuery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub data: Vec<u8>,
    pub record_count: u64,
    pub filtered_count: u64,
    pub generated_at: DateTime<Utc>,
    pub checksum: String, // SHA-256
}
```

### 9.7 AuditQueryService Trait

```rust
use std::future::Future;

pub type Result<T> = std::result::Result<T, KernelError>;

#[trait_variant::make(Send)]
pub trait AuditQueryService {
    fn query_entries(
        &self,
        filter: AuditFilter,
        pagination: Pagination,
    ) -> impl Future<Output = Result<PaginatedResult<AgentAuditEntry>>>;

    fn get_timeline(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = Result<SessionTimeline>>;

    fn get_belief_graph(
        &self,
        options: BeliefGraphOptions,
    ) -> impl Future<Output = Result<BeliefGraphSnapshot>>;

    fn get_governance_heatmap(
        &self,
        options: HeatmapOptions,
    ) -> impl Future<Output = Result<GovernanceHeatmapData>>;

    fn export(
        &self,
        request: ExportRequest,
    ) -> impl Future<Output = Result<ExportResult>>;

    fn verify_chain_integrity(
        &self,
        options: IntegrityCheckOptions,
    ) -> impl Future<Output = Result<IntegrityReport>>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditFilter {
    pub agent_ids: Option<Vec<AgentId>>,
    pub session_ids: Option<Vec<SessionId>>,
    pub action_types: Option<Vec<AuditActionType>>,
    pub governance_decision: Option<AuditGovernanceDecision>,
    pub time_range: Option<TimeRange>,
    pub classification_max: Option<ClassificationLevel>,
    pub search_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub limit: u64,
    pub offset: u64,
    pub sort_by: SortField,
    pub sort_order: SortOrder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Timestamp,
    ActionType,
    AgentId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeliefGraphOptions {
    pub agent_id: Option<AgentId>,
    pub tenant_id: Option<TenantId>,
    pub depth: Option<u32>,
    pub root_claim_id: Option<ClaimId>,
    pub include_retracted: Option<bool>,
    pub include_archived: Option<bool>,
    pub layout: Option<GraphLayout>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphLayout {
    Force,
    Hierarchical,
    Radial,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatmapOptions {
    pub time_range: TimeRange,
    pub granularity: Granularity,
    pub agent_id: Option<AgentId>,
    pub action_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityCheckOptions {
    pub scope: IntegrityScope,
    pub recent_window_hours: Option<u64>,
    pub repair_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrityScope {
    Full,
    Recent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityReport {
    pub valid: bool,
    pub entries_checked: u64,
    pub broken_links: u64,
    pub hash_mismatches: u64,
    pub first_break_at: Option<EventId>,
    pub details: Vec<IntegrityViolation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityViolation {
    pub entry_id: EventId,
    pub violation_type: ViolationType,
    pub expected: String,
    pub actual: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationType {
    HashMismatch,
    MissingParent,
    SequenceGap,
    TimestampRegression,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTimeline {
    pub session_id: SessionId,
    pub agent_id: AgentId,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    pub entries: Vec<TimelineEntry>,
    pub statistics: SessionStatistics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub id: EventId,
    pub timestamp: DateTime<Utc>,
    pub entry_type: TimelineEntryType,
    pub summary: String,
    pub governance_decision: Option<AuditGovernanceDecision>,
    pub related_claim_ids: Vec<ClaimId>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineEntryType {
    MemoryOperation,
    ComputerAction,
    GovernanceEvent,
    BranchOperation,
    SessionEvent,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatistics {
    pub total_actions: u64,
    pub memory_writes: u64,
    pub memory_reads: u64,
    pub governance_refusals: u64,
    pub governance_escalations: u64,
    pub branches_created: u64,
    pub branches_merged: u64,
    pub computer_actions: u64,
    pub average_confidence: f64,
    pub unique_subjects: u64,
    pub unique_predicates: u64,
}
```

## 10. Invariants

1. **Chain Continuity** — Every audit entry is hash-chained. `entry[n].previousHash === entry[n-1].currentHash`. No gaps, no mutations. Verified by `verifyChainIntegrity`.

2. **Append-Only Guarantee** — Audit entries are never modified or deleted. Tombstoning replaces content fields with null but preserves the entry's position in the chain and its hash contribution.

3. **Classification Enforcement** — All query interfaces filter results by the requesting agent's clearance level (see `SHARED_TYPES.md` §5 for trust-to-clearance mapping). An agent with `internal` clearance never receives entries classified `confidential` or above. Enforcement is at the service layer, not the caller.

4. **Export Checksum Verifiability** — Every `ExportResult.checksum` is SHA-256 of `ExportResult.data`. Any consumer can verify the export was not tampered with post-generation.

5. **Automatic Retention Enforcement** — Retention policies (see `SHARED_TYPES.md` §17) execute on schedule without manual intervention. When `retentionDays` expires, the entry is tombstoned (not deleted, except `unrestricted` which hard-deletes per policy). Archive thresholds trigger automatic archival to cold storage.

6. **GDPR Erasure Protocol** — Erasure requests produce a `TombstoneRecord` with an `erasureCertificateId`. The original content is irrecoverably removed. The chain position and structural fields (`timestamp`, `actionType`, `previousHash`, `currentHash`) are retained to preserve chain integrity. Silent deletion is structurally impossible. Only classifications where `gdprOverride: true` (see `SHARED_TYPES.md` §17) permit GDPR erasure.

7. **Belief Graph Real-Time Consistency** — `BeliefGraphSnapshot` reflects the current state of the knowledge graph at query time. No stale caching. The `effectiveConfidence` field applies FSRS decay: `R(t) = (1 + t/(9*S))^-1` where `t` is time since last review and `S` is stability.

8. **Governance Heatmap Privacy Safety** — Heatmap aggregates contain only counts and rates. No PII, no claim content, no subject URNs appear in `HeatmapCell` or `GovernanceHeatmapTotals`. The `actionCategory` field uses coarse categories, not specific predicates.

9. **Integrity Verifiability** — Chain integrity is verifiable at any time via `verifyChainIntegrity`. Full scan checks every entry. Recent scan checks a configurable window. `repairMode` flags violations without mutating data.

10. **Single Source of Truth** — All visualization data (timeline, belief graph, heatmap, exports) derives exclusively from `AgentAuditEntry` records. No visualization introduces data not traceable to an audit entry. The audit log is the sole authoritative record of system activity.

11. **Governance Verdict Alignment** — All governance decision fields in this contract use the canonical verdict values (`'allow' | 'refuse' | 'escalate' | 'sandbox'`) from `SHARED_TYPES.md` §10 `GovernanceVerdict`. No alternative spellings (e.g., `'allowed'`, `'refused'`) are permitted.

## 11. Event Integration

This contract emits and consumes events from the unified event system defined in `SHARED_TYPES.md` §16. Relevant event types:

- **Emitted:** None (audit is a consumer/recorder, not an emitter)
- **Consumed (triggers audit entry creation):** All `AgentEvent` types listed in `SHARED_TYPES.md` §16.1. Every event that passes through the `AgentEventBus` results in an `AgentAuditEntry` being appended to the hash chain.

The `AgentEventPayload.auditId` field (see `SHARED_TYPES.md` §16.2) links each event back to its corresponding `AgentAuditEntry.id`.
