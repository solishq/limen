// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §8.1
/**
 * AuditQueryService — Unified query interface for audit visualization.
 *
 * Implements: AV-8.1 through AV-8.6 (service interface methods),
 *             AV-10.3 (Classification Enforcement at service layer),
 *             AV-10.10 (Single Source of Truth — all data from audit entries)
 *
 * This is the composition root that delegates to:
 * - timeline_projection.ts for getTimeline
 * - belief_graph_projection.ts for getBeliefGraph
 * - heatmap_projection.ts for getGovernanceHeatmap
 * - integrity_checker.ts for verifyChainIntegrity
 * - export_engine.ts for export and queryEntries
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Result, SessionId } from '../../kernel/interfaces/index.js';
import type {
  AuditQueryService as IAuditQueryService,
  AuditFilter, Pagination, PaginatedResult, AgentAuditEntry,
  SessionTimeline, BeliefGraphOptions, BeliefGraphSnapshot,
  HeatmapOptions, GovernanceHeatmapData,
  ExportRequest, ExportResult,
  IntegrityCheckOptions, IntegrityReport,
} from './visualization_types.js';
import { buildSessionTimeline } from './timeline_projection.js';
import { buildBeliefGraphSnapshot } from './belief_graph_projection.js';
import { buildGovernanceHeatmap } from './heatmap_projection.js';
import { verifyChainIntegrity } from './integrity_checker.js';
import { executeExport, queryAuditEntries } from './export_engine.js';

// ─── Configuration ───

export interface AuditQueryServiceConfig {
  readonly conn: DatabaseConnection;
  readonly timeProvider: TimeProvider;
  /**
   * Clearance level of the requesting agent.
   * AV-10.3: Enforcement is at the service layer, not the caller.
   * 0=unrestricted only, 1=internal, 2=confidential, 3=restricted, 4=all
   */
  readonly clearanceLevel: number | undefined;
}

// ─── Factory ───

/**
 * Create an AuditQueryService instance.
 * Returns a frozen object implementing all 6 interface methods (AV-8.1 through AV-8.6).
 *
 * @param config - Database connection, time provider, and clearance level
 * @returns Frozen AuditQueryService implementation
 */
export function createAuditQueryService(config: AuditQueryServiceConfig): IAuditQueryService {
  const { conn, timeProvider, clearanceLevel } = config;

  const service: IAuditQueryService = {
    /**
     * AV-8.1: queryEntries(filter, pagination) -> PaginatedResult<AgentAuditEntry>
     * AV-8.7: Filter supports agentIds, sessionIds, actionTypes, governanceDecision,
     *         timeRange, classificationMax, searchText.
     * AV-8.8: Pagination includes limit, offset, sortBy, sortOrder.
     * AV-8.9: PaginatedResult includes items, total, limit, offset, hasMore.
     */
    queryEntries(filter: AuditFilter, pagination: Pagination): Result<PaginatedResult<AgentAuditEntry>> {
      return queryAuditEntries({ conn, timeProvider, clearanceLevel }, filter, pagination);
    },

    /**
     * AV-8.2: getTimeline(sessionId) -> SessionTimeline
     * AV-3.1: Returns sessionId, agentId, startedAt, endedAt, durationMs, entries, statistics.
     */
    getTimeline(sessionId: SessionId): Result<SessionTimeline> {
      return buildSessionTimeline({ conn, timeProvider, clearanceLevel }, sessionId);
    },

    /**
     * AV-8.3: getBeliefGraph(options) -> BeliefGraphSnapshot
     * AV-4.1: Returns snapshotId, timestamp, agentId, tenantId, nodes, edges, statistics.
     * AV-10.7: Real-time consistency — no stale caching.
     */
    getBeliefGraph(options: BeliefGraphOptions): Result<BeliefGraphSnapshot> {
      return buildBeliefGraphSnapshot({ conn, timeProvider, clearanceLevel }, options);
    },

    /**
     * AV-8.4: getGovernanceHeatmap(options) -> GovernanceHeatmapData
     * AV-5.1: Returns timeRange, granularity, cells, totals.
     * AV-10.8: Privacy safety — only counts and rates.
     */
    getGovernanceHeatmap(options: HeatmapOptions): Result<GovernanceHeatmapData> {
      return buildGovernanceHeatmap({ conn, timeProvider, clearanceLevel }, options);
    },

    /**
     * AV-8.5: export(request) -> ExportResult
     * AV-6.11: checksum = SHA-256(data).
     * AV-10.4: Verifiable by any consumer.
     */
    export(request: ExportRequest): Result<ExportResult> {
      return executeExport({ conn, timeProvider, clearanceLevel }, request);
    },

    /**
     * AV-8.6: verifyChainIntegrity(options) -> IntegrityReport
     * AV-10.1: Verifies entry[n].previousHash === entry[n-1].currentHash.
     * AV-10.9: repairMode flags but does not mutate.
     */
    verifyChainIntegrity(options: IntegrityCheckOptions): Result<IntegrityReport> {
      return verifyChainIntegrity({ conn, timeProvider }, options);
    },
  };

  return Object.freeze(service);
}
