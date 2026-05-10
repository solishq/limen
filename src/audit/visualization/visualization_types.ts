// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §2-§8
/**
 * Audit Visualization — Type Definitions
 *
 * Implements: AV-2.1 through AV-8.26, AV-10.11 (Governance Verdict Alignment)
 *
 * All types derive from the AUDIT_VISUALIZATION_SCHEMA contract v1.2.0.
 * Governance verdict values use ONLY canonical forms: 'allow' | 'refuse' | 'escalate' | 'sandbox'.
 * No alternative spellings permitted (AV-10.11).
 */

import type {
  EventId, AgentId, SessionId, TenantId, MissionId, TaskId,
  Result,
} from '../../kernel/interfaces/index.js';
import type { ClaimId, RelationshipId } from '../../claims/interfaces/claim_types.js';
import type { ClassificationLevel } from '../../governance/classification/governance_types.js';
import type { FreshnessLabel } from '../../cognitive/freshness.js';

// ============================================================================
// §2.2 AuditActionType (AV-2.2: 15 values)
// ============================================================================

export type AuditActionType =
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

// ============================================================================
// §2.3 ActionDetailPayload — Discriminated Union (AV-2.3 through AV-2.18)
// ============================================================================

export interface MemoryWriteDetail {
  readonly type: 'memory_write';
  readonly claimId: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly confidence: number;
  readonly classification: ClassificationLevel;
  readonly supersedes: ClaimId | null;
}

export interface MemoryReadDetail {
  readonly type: 'memory_read';
  readonly query: string;
  readonly resultCount: number;
  readonly claimIdsReturned: readonly ClaimId[];
}

export interface MemoryDeleteDetail {
  readonly type: 'memory_delete';
  readonly claimId: ClaimId;
  readonly reason: 'incorrect' | 'superseded' | 'expired' | 'manual';
}

export interface BeliefQueryDetail {
  readonly type: 'belief_query';
  readonly subject: string | null;
  readonly predicate: string | null;
  readonly minConfidence: number | null;
  readonly resultCount: number;
  readonly executionMs: number;
}

export interface BranchCreateDetail {
  readonly type: 'branch_create';
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly reason: string;
}

export interface BranchMergeDetail {
  readonly type: 'branch_merge';
  readonly branchId: string;
  readonly targetBranchId: string;
  readonly claimsMerged: number;
  readonly conflictsResolved: number;
}

export interface BranchDiscardDetail {
  readonly type: 'branch_discard';
  readonly branchId: string;
  readonly claimsDiscarded: number;
  readonly reason: string;
}

export interface ComputerActionDetail {
  readonly type: 'computer_action';
  readonly actionName: string;
  readonly targetResource: string;
  readonly parameters: Record<string, unknown>;
  readonly resultSummary: string;
  readonly durationMs: number;
}

export interface GovernanceCheckDetail {
  readonly type: 'governance_check';
  readonly rule: string;
  readonly requestedAction: string;
  readonly context: Record<string, unknown>;
}

export interface SessionStartDetail {
  readonly type: 'session_start';
  readonly agentVersion: string;
  readonly capabilities: readonly string[];
  readonly trustLevel: string;
}

export interface SessionEndDetail {
  readonly type: 'session_end';
  readonly reason: 'normal' | 'timeout' | 'error' | 'revoked';
  readonly durationMs: number;
  readonly actionsPerformed: number;
}

export interface AgentRegisterDetail {
  readonly type: 'agent_register';
  readonly agentName: string;
  readonly capabilities: readonly string[];
  readonly domains: readonly string[];
  readonly initialTrustLevel: string;
}

export interface ClassificationChangeDetail {
  readonly type: 'classification_change';
  readonly claimId: ClaimId;
  readonly previousClassification: ClassificationLevel;
  readonly newClassification: ClassificationLevel;
  readonly justification: string;
}

export interface ExportDetail {
  readonly type: 'export';
  readonly format: ExportFormat;
  readonly scope: ExportScope;
  readonly recordCount: number;
  readonly checksum: string;
}

export interface ImportDetail {
  readonly type: 'import';
  readonly source: string;
  readonly recordCount: number;
  readonly validationResult: 'passed' | 'partial' | 'failed';
  readonly failedRecords: number;
}

export type ActionDetailPayload =
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

// ============================================================================
// §2.4 AuditGovernanceRecord (AV-2.19, AV-2.20)
// ============================================================================

/** Canonical governance verdict values — AV-10.11 enforced */
export type GovernanceDecision = 'allow' | 'refuse' | 'escalate' | 'sandbox';

export interface AuditGovernanceRecord {
  readonly decision: GovernanceDecision;
  readonly reason: string;
  readonly rule: string | null;
  readonly confidence: number;
  readonly evaluationDurationMs: number;
}

// ============================================================================
// §2.5 AuditProvenance (AV-2.21)
// ============================================================================

export interface AuditProvenance {
  readonly chainPosition: number;
  readonly parentActionId: EventId | null;
  readonly correlationId: string;
  readonly sourceAgent: AgentId;
  readonly sourceMission: MissionId | null;
  readonly sourceTask: TaskId | null;
}

// ============================================================================
// §2.6 MemoryOperationRecord (AV-2.22, AV-2.23)
// ============================================================================

export type MemoryOperationType = 'assert' | 'retract' | 'query' | 'search' | 'relate';

export interface MemoryOperationRecord {
  readonly type: MemoryOperationType;
  readonly claimId: ClaimId | null;
  readonly subject: string | null;
  readonly predicate: string | null;
  readonly confidence: number | null;
  readonly resultCount: number | null;
}

// ============================================================================
// §3 AgentSessionTimeline (AV-3.1 through AV-3.14)
// ============================================================================

export type TimelineEntryType =
  | 'memory_operation'
  | 'computer_action'
  | 'governance_event'
  | 'branch_operation'
  | 'session_event'
  | 'error';

export interface TimelineEntry {
  readonly id: EventId;
  readonly timestamp: string;
  readonly type: TimelineEntryType;
  readonly summary: string;
  readonly governanceDecision: GovernanceDecision | null;
  readonly relatedClaimIds: readonly ClaimId[];
  readonly metadata: Record<string, unknown>;
}

export interface SessionStatistics {
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

export interface SessionTimeline {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly entries: readonly TimelineEntry[];
  readonly statistics: SessionStatistics;
}

// ============================================================================
// §4 Belief Graph Schema (AV-4.1 through AV-4.19)
// ============================================================================

export type BeliefNodeType = 'belief' | 'governance' | 'authority' | 'refusal';
export type ClaimStatus = 'active' | 'retracted' | 'archived';

export interface BeliefGraphNode {
  readonly id: ClaimId;
  readonly label: string;
  readonly nodeType: BeliefNodeType;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly freshness: FreshnessLabel;
  readonly classification: ClassificationLevel;
  readonly agentId: AgentId;
  readonly createdAt: string;
  readonly status: ClaimStatus;
  readonly position?: { readonly x: number; readonly y: number };
}

export type BeliefEdgeType =
  | 'supports'
  | 'contradicts'
  | 'supersedes'
  | 'derived_from'
  | 'provenance'
  | 'governance'
  | 'cascade'
  | 'refusal';

export interface BeliefGraphEdge {
  readonly id: RelationshipId;
  readonly source: ClaimId;
  readonly target: ClaimId;
  readonly edgeType: BeliefEdgeType;
  readonly weight: number;
  readonly declaredBy: AgentId;
  readonly createdAt: string;
}

export interface GraphStatistics {
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
  readonly agentDistribution: Record<string, number>;
}

export interface BeliefGraphSnapshot {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly agentId: AgentId | null;
  readonly tenantId: TenantId | null;
  readonly nodes: readonly BeliefGraphNode[];
  readonly edges: readonly BeliefGraphEdge[];
  readonly statistics: GraphStatistics;
}

// ============================================================================
// §5 Governance Decision Heatmap (AV-5.1 through AV-5.10)
// ============================================================================

export type HeatmapGranularity = 'minute' | 'hour' | 'day' | 'week';

export interface HeatmapCell {
  readonly timestamp: string;
  readonly agentId: AgentId | null;
  readonly actionCategory: string;
  readonly allowed: number;
  readonly refused: number;
  readonly escalated: number;
  readonly sandboxed: number;
  readonly intensity: number;
}

export interface GovernanceHeatmapTotals {
  readonly totalDecisions: number;
  readonly allowRate: number;
  readonly refuseRate: number;
  readonly escalateRate: number;
  readonly sandboxRate: number;
  readonly topRefusalRules: readonly { readonly rule: string; readonly count: number }[];
}

export interface GovernanceHeatmapData {
  readonly timeRange: { readonly from: string; readonly to: string };
  readonly granularity: HeatmapGranularity;
  readonly cells: readonly HeatmapCell[];
  readonly totals: GovernanceHeatmapTotals;
}

// ============================================================================
// §6 Export Contracts (AV-6.1 through AV-6.12)
// ============================================================================

export type ExportFormat = 'json' | 'csv' | 'pdf' | 'svg';
export type ExportScope = 'session' | 'agent' | 'tenant' | 'time_range' | 'custom_query';

export interface ExportFilters {
  readonly sessionIds?: readonly SessionId[];
  readonly agentIds?: readonly AgentId[];
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly actionTypes?: readonly AuditActionType[];
  readonly governanceFilter?: 'all' | 'refused_only' | 'escalated_only';
  readonly classificationMax?: ClassificationLevel;
}

export interface ExportOptions {
  readonly includeProvenance: boolean;
  readonly includeBeliefGraph: boolean;
  readonly includeTimeline: boolean;
  readonly includeHeatmap: boolean;
  readonly redactClassified: boolean;
  readonly maxRecords?: number;
}

export interface ExportRequest {
  readonly format: ExportFormat;
  readonly scope: ExportScope;
  readonly filters: ExportFilters;
  readonly options: ExportOptions;
}

export interface ExportResult {
  readonly format: ExportFormat;
  readonly data: Buffer | string;
  readonly recordCount: number;
  readonly filteredCount: number;
  readonly generatedAt: string;
  readonly checksum: string;
}

// ============================================================================
// §7 Retention & Privacy Controls (AV-7.1 through AV-7.11)
// ============================================================================

export interface PrivacyControls {
  readonly dataSubjectMapping: boolean;
  readonly consentAware: boolean;
  readonly erasureSupport: boolean;
  readonly auditOfAudit: boolean;
}

export type TombstoneReason = 'gdpr_erasure' | 'retention_expired' | 'manual';

export interface TombstoneRecord {
  readonly originalId: EventId;
  readonly tombstonedAt: string;
  readonly reason: TombstoneReason;
  readonly erasureCertificateId: string | null;
  readonly retainedFields: readonly string[];
}

// ============================================================================
// §8 Query Interfaces (AV-8.1 through AV-8.26)
// ============================================================================

export interface AuditFilter {
  readonly agentIds?: readonly AgentId[];
  readonly sessionIds?: readonly SessionId[];
  readonly actionTypes?: readonly AuditActionType[];
  readonly governanceDecision?: GovernanceDecision;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly classificationMax?: ClassificationLevel;
  readonly searchText?: string;
}

export type SortBy = 'timestamp' | 'actionType' | 'agentId';
export type SortOrder = 'asc' | 'desc';

export interface Pagination {
  readonly limit: number;
  readonly offset: number;
  readonly sortBy: SortBy;
  readonly sortOrder: SortOrder;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export type GraphLayout = 'force' | 'hierarchical' | 'radial';

export interface BeliefGraphOptions {
  readonly agentId?: AgentId;
  readonly tenantId?: TenantId;
  readonly depth?: number;
  readonly rootClaimId?: ClaimId;
  readonly includeRetracted?: boolean;
  readonly includeArchived?: boolean;
  readonly layout?: GraphLayout;
}

export interface HeatmapOptions {
  readonly timeRange: { readonly from: string; readonly to: string };
  readonly granularity: HeatmapGranularity;
  readonly agentId?: AgentId;
  readonly actionCategory?: string;
}

export type IntegrityScope = 'full' | 'recent';

export interface IntegrityCheckOptions {
  readonly scope: IntegrityScope;
  readonly recentWindowHours?: number;
  readonly repairMode?: boolean;
}

export type IntegrityViolationType = 'hash_mismatch' | 'missing_parent' | 'sequence_gap' | 'timestamp_regression';

export interface IntegrityViolation {
  readonly entryId: EventId;
  readonly type: IntegrityViolationType;
  readonly expected: string;
  readonly actual: string;
}

export interface IntegrityReport {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly brokenLinks: number;
  readonly hashMismatches: number;
  readonly firstBreakAt: EventId | null;
  readonly details: readonly IntegrityViolation[];
}

// ============================================================================
// §8.1 AuditQueryService Interface (AV-8.1 through AV-8.6)
// ============================================================================

import type { AuditEntry } from '../../kernel/interfaces/audit.js';

/** AgentAuditEntry is canonical alias to kernel AuditEntry (AV-2.1) */
export type AgentAuditEntry = AuditEntry;

export interface AuditQueryService {
  queryEntries(
    filter: AuditFilter,
    pagination: Pagination,
  ): Result<PaginatedResult<AgentAuditEntry>>;

  getTimeline(sessionId: SessionId): Result<SessionTimeline>;

  getBeliefGraph(options: BeliefGraphOptions): Result<BeliefGraphSnapshot>;

  getGovernanceHeatmap(options: HeatmapOptions): Result<GovernanceHeatmapData>;

  export(request: ExportRequest): Result<ExportResult>;

  verifyChainIntegrity(options: IntegrityCheckOptions): Result<IntegrityReport>;
}
