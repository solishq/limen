// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §6
/**
 * Export Engine — JSON/CSV export formats with checksum verification.
 *
 * Implements: AV-6.1 through AV-6.12, AV-10.4 (Export Checksum Verifiability)
 *
 * AV-6.9: ExportResult.data is Buffer for PDF/SVG, string for JSON/CSV.
 * AV-6.11: ExportResult.checksum MUST be SHA-256 of ExportResult.data.
 * AV-10.4: Any consumer can verify export was not tampered with post-generation.
 * AV-6.6: ExportOptions.redactClassified MUST redact content above agent clearance.
 */

import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Result } from '../../kernel/interfaces/index.js';
import { CLASSIFICATION_LEVEL_ORDER } from '../../governance/classification/governance_types.js';
import type { ClassificationLevel } from '../../governance/classification/governance_types.js';
import type {
  ExportRequest, ExportResult, ExportFilters, ExportOptions,
  AuditFilter, Pagination, PaginatedResult, AgentAuditEntry,
} from './visualization_types.js';

// ─── Internal row shape ───

interface AuditRow {
  id: string;
  seq_no: number;
  tenant_id: string | null;
  timestamp: string;
  actor_type: string;
  actor_id: string;
  operation: string;
  resource_type: string;
  resource_id: string;
  detail: string | null;
  previous_hash: string;
  current_hash: string;
}

export interface ExportEngineDeps {
  readonly conn: DatabaseConnection;
  readonly timeProvider: TimeProvider;
  readonly clearanceLevel: number | undefined;
}

/**
 * Execute an export request against the audit log.
 * AV-6.11: checksum = SHA-256(data).
 * AV-10.4: Verifiable by any consumer.
 */
export function executeExport(
  deps: ExportEngineDeps,
  request: ExportRequest,
): Result<ExportResult> {
  const { conn, timeProvider, clearanceLevel } = deps;
  const { format, filters } = request;
  // CC-25 (P1): Guard against undefined options — callers may omit the optional-at-runtime field.
  const options: ExportOptions = request.options ?? {
    includeProvenance: false,
    includeBeliefGraph: false,
    includeTimeline: false,
    includeHeatmap: false,
    redactClassified: false,
  };

  // Validate format support
  if (format === 'pdf' || format === 'svg') {
    return {
      ok: false,
      error: {
        code: 'AV_UNSUPPORTED_FORMAT',
        message: `Export format '${format}' requires a rendering engine not available in this environment. Supported: json, csv.`,
        spec: 'AUDIT_VISUALIZATION_SCHEMA.md §6.1',
      },
    };
  }

  // Query entries with filters (BRK-AV-03: pass classificationMax for filtering)
  const rows = queryFilteredEntries(conn, filters, options.maxRecords, filters.classificationMax);

  // Post-filter by classification clearance (AV-10.3) and redaction (AV-6.6)
  const maxLevel = clearanceLevel ?? 4;
  const processedRows = rows
    .filter(row => {
      if (!options.redactClassified) return true;
      const detail = row.detail ? tryParseJson(row.detail) : null;
      if (!detail || !detail.classification) return true;
      const level = CLASSIFICATION_LEVEL_ORDER[detail.classification as ClassificationLevel];
      return level === undefined || level <= maxLevel;
    })
    .map(row => {
      if (!options.redactClassified) return row;
      // Redact content above clearance
      const detail = row.detail ? tryParseJson(row.detail) : null;
      if (!detail || !detail.classification) return row;
      const level = CLASSIFICATION_LEVEL_ORDER[detail.classification as ClassificationLevel];
      if (level !== undefined && level > maxLevel) {
        return { ...row, detail: JSON.stringify({ redacted: true, reason: 'classification_above_clearance' }) };
      }
      return row;
    });

  // Generate export data
  let data: string;
  if (format === 'json') {
    data = generateJsonExport(processedRows, options);
  } else {
    data = generateCsvExport(processedRows, options);
  }

  // Compute SHA-256 checksum (AV-6.11, AV-10.4)
  const checksum = createHash('sha256').update(data).digest('hex');

  const result: ExportResult = Object.freeze({
    format,
    data,
    recordCount: processedRows.length,
    filteredCount: rows.length - processedRows.length,
    generatedAt: timeProvider.nowISO(),
    checksum,
  });

  return { ok: true, value: result };
}

// ─── Query with filters ───

function queryFilteredEntries(
  conn: DatabaseConnection,
  filters: ExportFilters,
  maxRecords?: number,
  classificationMax?: ClassificationLevel,
): AuditRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.timeRange) {
    conditions.push('timestamp >= ?');
    params.push(filters.timeRange.from);
    conditions.push('timestamp <= ?');
    params.push(filters.timeRange.to);
  }

  if (filters.agentIds && filters.agentIds.length > 0) {
    const placeholders = filters.agentIds.map(() => '?').join(',');
    conditions.push(`actor_id IN (${placeholders})`);
    params.push(...filters.agentIds);
  }

  if (filters.sessionIds && filters.sessionIds.length > 0) {
    const placeholders = filters.sessionIds.map(() => '?').join(',');
    conditions.push(`resource_id IN (${placeholders})`);
    params.push(...filters.sessionIds);
  }

  if (filters.actionTypes && filters.actionTypes.length > 0) {
    const placeholders = filters.actionTypes.map(() => '?').join(',');
    conditions.push(`operation IN (${placeholders})`);
    params.push(...filters.actionTypes);
  }

  if (filters.governanceFilter === 'refused_only') {
    conditions.push("(detail LIKE '%\"refuse\"%' OR detail LIKE '%\"refused\"%')");
  } else if (filters.governanceFilter === 'escalated_only') {
    conditions.push("(detail LIKE '%\"escalate\"%' OR detail LIKE '%\"escalated\"%')");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = maxRecords ?? 10000;

  const rows = conn.query<AuditRow>(
    `SELECT id, seq_no, tenant_id, timestamp, actor_type, actor_id, operation, resource_type, resource_id, detail, previous_hash, current_hash
     FROM core_audit_log
     ${whereClause}
     ORDER BY seq_no ASC
     LIMIT ?`,
    [...params, limit],
  );

  // BRK-AV-03: Apply classificationMax filter post-query
  if (!classificationMax) return rows;
  const maxLevel = CLASSIFICATION_LEVEL_ORDER[classificationMax];
  return rows.filter(row => {
    if (!row.detail) return true;
    try {
      const detail = JSON.parse(row.detail) as Record<string, unknown>;
      if (!detail.classification) return true;
      const level = CLASSIFICATION_LEVEL_ORDER[detail.classification as ClassificationLevel];
      return level === undefined || level <= maxLevel;
    } catch {
      return true;
    }
  });
}

// ─── JSON Export ───

function generateJsonExport(rows: AuditRow[], options: ExportOptions): string {
  const entries = rows.map(row => {
    const base: Record<string, unknown> = {
      id: row.id,
      seqNo: row.seq_no,
      timestamp: row.timestamp,
      actorType: row.actor_type,
      actorId: row.actor_id,
      operation: row.operation,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      detail: row.detail ? tryParseJson(row.detail) : null,
    };
    if (options.includeProvenance) {
      base.previousHash = row.previous_hash;
      base.currentHash = row.current_hash;
    }
    return base;
  });

  return JSON.stringify({
    exportType: 'audit_visualization',
    version: '1.2.0',
    entries,
    metadata: {
      recordCount: entries.length,
      includeProvenance: options.includeProvenance,
      includeBeliefGraph: options.includeBeliefGraph,
      includeTimeline: options.includeTimeline,
      includeHeatmap: options.includeHeatmap,
    },
  }, null, 2);
}

// ─── CSV Export ───

function generateCsvExport(rows: AuditRow[], options: ExportOptions): string {
  const headers = ['id', 'seq_no', 'timestamp', 'actor_type', 'actor_id', 'operation', 'resource_type', 'resource_id'];
  if (options.includeProvenance) {
    headers.push('previous_hash', 'current_hash');
  }
  headers.push('detail');

  const csvRows: string[] = [headers.join(',')];

  for (const row of rows) {
    const values: string[] = [
      escapeCsv(row.id),
      String(row.seq_no),
      escapeCsv(row.timestamp),
      escapeCsv(row.actor_type),
      escapeCsv(row.actor_id),
      escapeCsv(row.operation),
      escapeCsv(row.resource_type),
      escapeCsv(row.resource_id),
    ];
    if (options.includeProvenance) {
      values.push(escapeCsv(row.previous_hash), escapeCsv(row.current_hash));
    }
    values.push(escapeCsv(row.detail ?? ''));
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

// ─── Helpers ───

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Entry query for the AuditQueryService.queryEntries method ───

export function queryAuditEntries(
  deps: ExportEngineDeps,
  filter: AuditFilter,
  pagination: Pagination,
): Result<PaginatedResult<AgentAuditEntry>> {
  const { conn, clearanceLevel } = deps;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agentIds && filter.agentIds.length > 0) {
    const placeholders = filter.agentIds.map(() => '?').join(',');
    conditions.push(`actor_id IN (${placeholders})`);
    params.push(...filter.agentIds);
  }

  if (filter.sessionIds && filter.sessionIds.length > 0) {
    const placeholders = filter.sessionIds.map(() => '?').join(',');
    conditions.push(`resource_id IN (${placeholders})`);
    params.push(...filter.sessionIds);
  }

  if (filter.actionTypes && filter.actionTypes.length > 0) {
    const placeholders = filter.actionTypes.map(() => '?').join(',');
    conditions.push(`operation IN (${placeholders})`);
    params.push(...filter.actionTypes);
  }

  if (filter.governanceDecision) {
    // BRK-AV-07: Validate against allowed values before use in query
    const allowedDecisions = new Set(['allow', 'refuse', 'escalate', 'sandbox']);
    if (!allowedDecisions.has(filter.governanceDecision)) {
      return {
        ok: false,
        error: {
          code: 'AV_INVALID_FILTER',
          message: `Invalid governanceDecision filter: '${filter.governanceDecision}'. Allowed: allow, refuse, escalate, sandbox.`,
          spec: 'AUDIT_VISUALIZATION_SCHEMA.md §8.7',
        },
      };
    }
    conditions.push('detail LIKE ?');
    params.push(`%"${filter.governanceDecision}"%`);
  }

  if (filter.timeRange) {
    conditions.push('timestamp >= ?');
    params.push(filter.timeRange.from);
    conditions.push('timestamp <= ?');
    params.push(filter.timeRange.to);
  }

  if (filter.searchText) {
    conditions.push('(operation LIKE ? OR detail LIKE ? OR actor_id LIKE ?)');
    const pattern = `%${filter.searchText}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countRow = conn.get<{ total: number }>(
    `SELECT COUNT(*) as total FROM core_audit_log ${whereClause}`,
    params,
  );
  const total = countRow?.total ?? 0;

  // Determine sort column
  let sortCol: string;
  switch (pagination.sortBy) {
    case 'timestamp': sortCol = 'timestamp'; break;
    case 'actionType': sortCol = 'operation'; break;
    case 'agentId': sortCol = 'actor_id'; break;
    default: sortCol = 'timestamp';
  }

  const orderDir = pagination.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const rows = conn.query<AuditRow>(
    `SELECT id, seq_no, tenant_id, timestamp, actor_type, actor_id, operation, resource_type, resource_id, detail, previous_hash, current_hash
     FROM core_audit_log
     ${whereClause}
     ORDER BY ${sortCol} ${orderDir}
     LIMIT ? OFFSET ?`,
    [...params, pagination.limit, pagination.offset],
  );

  // Post-filter by classification (AV-10.3)
  const serviceClearance = clearanceLevel ?? 4;
  const filterClassMax = filter.classificationMax
    ? CLASSIFICATION_LEVEL_ORDER[filter.classificationMax]
    : undefined;
  const maxLevel = filterClassMax !== undefined
    ? Math.min(serviceClearance, filterClassMax)
    : serviceClearance;
  const filteredItems: AgentAuditEntry[] = [];
  for (const row of rows) {
    // Check classification in detail
    if (maxLevel < 4 && row.detail) {
      const detail = tryParseJson(row.detail);
      if (detail?.classification) {
        const level = CLASSIFICATION_LEVEL_ORDER[detail.classification as ClassificationLevel];
        if (level !== undefined && level > maxLevel) continue;
      }
    }
    filteredItems.push({
      seqNo: row.seq_no,
      id: row.id,
      tenantId: row.tenant_id as import('../../kernel/interfaces/common.js').TenantId | null,
      timestamp: row.timestamp,
      actorType: row.actor_type as 'system' | 'user' | 'agent' | 'scheduler',
      actorId: row.actor_id,
      operation: row.operation,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      detail: row.detail ? tryParseJson(row.detail) : null,
      previousHash: row.previous_hash,
      currentHash: row.current_hash,
    });
  }

  const result: PaginatedResult<AgentAuditEntry> = Object.freeze({
    items: Object.freeze(filteredItems),
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore: pagination.offset + pagination.limit < total,
  });

  return { ok: true, value: result };
}
