// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md
/**
 * Audit Visualization — Module barrel export.
 *
 * Re-exports the AuditQueryService factory and all visualization types.
 */

export { createAuditQueryService } from './audit_query_service.js';
export type { AuditQueryServiceConfig } from './audit_query_service.js';

export type {
  // §2 AuditActionType & DetailPayloads
  AuditActionType,
  ActionDetailPayload,
  MemoryWriteDetail, MemoryReadDetail, MemoryDeleteDetail,
  BeliefQueryDetail, BranchCreateDetail, BranchMergeDetail, BranchDiscardDetail,
  ComputerActionDetail, GovernanceCheckDetail,
  SessionStartDetail, SessionEndDetail, AgentRegisterDetail,
  ClassificationChangeDetail, ExportDetail, ImportDetail,
  GovernanceDecision, AuditGovernanceRecord, AuditProvenance,
  MemoryOperationType, MemoryOperationRecord,

  // §3 Timeline
  TimelineEntryType, TimelineEntry, SessionStatistics, SessionTimeline,

  // §4 Belief Graph
  BeliefNodeType, ClaimStatus, BeliefGraphNode,
  BeliefEdgeType, BeliefGraphEdge,
  GraphStatistics, BeliefGraphSnapshot,

  // §5 Heatmap
  HeatmapGranularity, HeatmapCell, GovernanceHeatmapTotals, GovernanceHeatmapData,

  // §6 Export
  ExportFormat, ExportScope, ExportFilters, ExportOptions, ExportRequest, ExportResult,

  // §7 Privacy & Retention
  PrivacyControls, TombstoneReason, TombstoneRecord,

  // §8 Query Interfaces
  AuditFilter, SortBy, SortOrder, Pagination, PaginatedResult,
  GraphLayout, BeliefGraphOptions, HeatmapOptions,
  IntegrityScope, IntegrityCheckOptions,
  IntegrityViolationType, IntegrityViolation, IntegrityReport,
  AgentAuditEntry, AuditQueryService,
} from './visualization_types.js';
