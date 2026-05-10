// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §3
/**
 * Timeline Projection — SessionTimeline assembly from audit entries.
 *
 * Implements: AV-3.1 through AV-3.14, AV-10.10 (Single Source of Truth)
 *
 * All timeline data derives exclusively from core_audit_log entries.
 * No visualization introduces data not traceable to an audit entry (AV-10.10).
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Result, SessionId, AgentId, EventId } from '../../kernel/interfaces/index.js';
import type { ClaimId } from '../../claims/interfaces/claim_types.js';
import type {
  SessionTimeline, TimelineEntry, TimelineEntryType,
  SessionStatistics, GovernanceDecision,
} from './visualization_types.js';
import { CLASSIFICATION_LEVEL_ORDER } from '../../governance/classification/governance_types.js';

// ─── Internal row shape from core_audit_log ───

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

function parseDetail(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function classifyEntryType(operation: string): TimelineEntryType {
  if (operation.startsWith('memory_') || operation === 'assert_claim' || operation === 'retract_claim' || operation === 'relate_claims' || operation === 'search_claims' || operation === 'query_claims') {
    return 'memory_operation';
  }
  if (operation.startsWith('branch_')) return 'branch_operation';
  if (operation.startsWith('session_') || operation === 'session_start' || operation === 'session_end') return 'session_event';
  if (operation.startsWith('governance_') || operation === 'governance_check') return 'governance_event';
  if (operation === 'computer_action') return 'computer_action';
  if (operation === 'error') return 'error';
  // Default for unrecognized operations
  if (operation.includes('governance') || operation.includes('refuse') || operation.includes('escalate')) {
    return 'governance_event';
  }
  return 'memory_operation';
}

function extractGovernanceDecision(detail: Record<string, unknown> | null): GovernanceDecision | null {
  if (!detail) return null;
  const decision = detail.decision ?? detail.governance_decision ?? detail.governanceDecision;
  if (decision === 'allow' || decision === 'refuse' || decision === 'escalate' || decision === 'sandbox') {
    return decision;
  }
  return null;
}

function extractRelatedClaimIds(detail: Record<string, unknown> | null): readonly ClaimId[] {
  if (!detail) return [];
  const ids: ClaimId[] = [];
  if (typeof detail.claimId === 'string') ids.push(detail.claimId as ClaimId);
  if (typeof detail.claim_id === 'string') ids.push(detail.claim_id as ClaimId);
  if (Array.isArray(detail.claimIdsReturned)) {
    for (const id of detail.claimIdsReturned) {
      if (typeof id === 'string') ids.push(id as ClaimId);
    }
  }
  if (Array.isArray(detail.claim_ids_returned)) {
    for (const id of detail.claim_ids_returned) {
      if (typeof id === 'string') ids.push(id as ClaimId);
    }
  }
  return ids;
}

function generateSummary(operation: string, detail: Record<string, unknown> | null): string {
  if (!detail) return operation.replace(/_/g, ' ');
  switch (operation) {
    case 'assert_claim':
    case 'memory_write':
      return `Wrote claim: ${detail.subject ?? detail.predicate ?? 'unknown'}`;
    case 'retract_claim':
    case 'memory_delete':
      return `Retracted claim: ${detail.claimId ?? detail.claim_id ?? 'unknown'}`;
    case 'query_claims':
    case 'belief_query':
      return `Queried beliefs: ${detail.resultCount ?? detail.result_count ?? '?'} results`;
    case 'search_claims':
    case 'memory_read':
      return `Searched: ${detail.query ?? 'unknown query'}`;
    case 'session_start':
      return `Session started (trust: ${detail.trustLevel ?? detail.trust_level ?? 'unknown'})`;
    case 'session_end':
      return `Session ended (${detail.reason ?? 'normal'})`;
    case 'governance_check':
      return `Governance: ${detail.decision ?? 'check'} — ${detail.rule ?? 'unknown rule'}`;
    case 'branch_create':
      return `Branch created: ${detail.branchId ?? detail.branch_id ?? 'unknown'}`;
    case 'branch_merge':
      return `Branch merged: ${detail.branchId ?? detail.branch_id ?? 'unknown'}`;
    case 'branch_discard':
      return `Branch discarded: ${detail.branchId ?? detail.branch_id ?? 'unknown'}`;
    case 'computer_action':
      return `Action: ${detail.actionName ?? detail.action_name ?? 'unknown'}`;
    case 'agent_register':
      return `Agent registered: ${detail.agentName ?? detail.agent_name ?? 'unknown'}`;
    case 'classification_change':
      return `Classification changed: ${detail.previousClassification ?? '?'} -> ${detail.newClassification ?? '?'}`;
    default:
      return operation.replace(/_/g, ' ');
  }
}

function rowToTimelineEntry(row: AuditRow): TimelineEntry {
  const detail = parseDetail(row.detail);
  const entryType = classifyEntryType(row.operation);
  return Object.freeze({
    id: row.id as EventId,
    timestamp: row.timestamp,
    type: entryType,
    summary: generateSummary(row.operation, detail),
    governanceDecision: extractGovernanceDecision(detail),
    relatedClaimIds: extractRelatedClaimIds(detail),
    metadata: detail ?? {},
  });
}

function computeStatistics(entries: readonly TimelineEntry[]): SessionStatistics {
  let memoryWrites = 0;
  let memoryReads = 0;
  let governanceRefusals = 0;
  let governanceEscalations = 0;
  let branchesCreated = 0;
  let branchesMerged = 0;
  let computerActions = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  const subjects = new Set<string>();
  const predicates = new Set<string>();

  for (const entry of entries) {
    switch (entry.type) {
      case 'memory_operation': {
        const meta = entry.metadata as Record<string, unknown>;
        if (meta.type === 'memory_write' || entry.summary.startsWith('Wrote')) {
          memoryWrites++;
          if (typeof meta.subject === 'string') subjects.add(meta.subject);
          if (typeof meta.predicate === 'string') predicates.add(meta.predicate);
          if (typeof meta.confidence === 'number') {
            confidenceSum += meta.confidence;
            confidenceCount++;
          }
        } else {
          memoryReads++;
        }
        break;
      }
      case 'governance_event': {
        if (entry.governanceDecision === 'refuse') governanceRefusals++;
        if (entry.governanceDecision === 'escalate') governanceEscalations++;
        break;
      }
      case 'branch_operation': {
        const meta = entry.metadata as Record<string, unknown>;
        if (meta.type === 'branch_create' || entry.summary.startsWith('Branch created')) branchesCreated++;
        if (meta.type === 'branch_merge' || entry.summary.startsWith('Branch merged')) branchesMerged++;
        break;
      }
      case 'computer_action':
        computerActions++;
        break;
    }
  }

  return Object.freeze({
    totalActions: entries.length,
    memoryWrites,
    memoryReads,
    governanceRefusals,
    governanceEscalations,
    branchesCreated,
    branchesMerged,
    computerActions,
    averageConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    uniqueSubjects: subjects.size,
    uniquePredicates: predicates.size,
  });
}

export interface TimelineProjectionDeps {
  readonly conn: DatabaseConnection;
  readonly timeProvider: TimeProvider;
  readonly clearanceLevel: number | undefined;
}

/**
 * Build a SessionTimeline from audit entries for a given session.
 * AV-3.1: SessionTimeline includes sessionId, agentId, startedAt, endedAt, durationMs, entries, statistics.
 * AV-10.3: Classification enforcement at service layer.
 * AV-10.10: All data derives from audit entries.
 */
export function buildSessionTimeline(
  deps: TimelineProjectionDeps,
  sessionId: SessionId,
): Result<SessionTimeline> {
  const { conn, timeProvider, clearanceLevel } = deps;

  // Query all audit entries for this session (referenced via resource_id or detail)
  // Sessions may be tracked via actor_id (the agent for that session) or via detail.sessionId
  const rows = conn.query<AuditRow>(
    `SELECT id, seq_no, tenant_id, timestamp, actor_type, actor_id, operation, resource_type, resource_id, detail, previous_hash, current_hash
     FROM core_audit_log
     WHERE resource_id = ? OR (detail LIKE ? AND detail LIKE ?)
     ORDER BY seq_no ASC`,
    [sessionId, `%"sessionId"%`, `%${sessionId}%`],
  );

  if (rows.length === 0) {
    // Try matching by actor_id (agent sessions often map actor_id to session tracking)
    const byActor = conn.query<AuditRow>(
      `SELECT id, seq_no, tenant_id, timestamp, actor_type, actor_id, operation, resource_type, resource_id, detail, previous_hash, current_hash
       FROM core_audit_log
       WHERE resource_id = ?
       ORDER BY seq_no ASC`,
      [sessionId],
    );
    if (byActor.length === 0) {
      return {
        ok: false,
        error: {
          code: 'AV_SESSION_NOT_FOUND',
          message: `No audit entries found for session: ${sessionId}`,
          spec: 'AUDIT_VISUALIZATION_SCHEMA.md §3',
        },
      };
    }
  }

  // Post-filter by classification clearance (AV-10.3)
  const filteredRows = rows.filter(row => {
    if (clearanceLevel === undefined || clearanceLevel >= 4) return true;
    const detail = parseDetail(row.detail);
    if (!detail || !detail.classification) return true;
    const entryLevel = CLASSIFICATION_LEVEL_ORDER[detail.classification as keyof typeof CLASSIFICATION_LEVEL_ORDER];
    if (entryLevel === undefined) return true;
    return entryLevel <= clearanceLevel;
  });

  const entries = filteredRows.map(rowToTimelineEntry);
  const statistics = computeStatistics(entries);

  // Derive session metadata from entries
  const firstEntry = filteredRows[0];
  const lastEntry = filteredRows[filteredRows.length - 1];
  const startedAt = firstEntry?.timestamp ?? timeProvider.nowISO();
  const endedAt = lastEntry?.timestamp ?? null;
  const startMs = new Date(startedAt).getTime();
  const endMs = endedAt ? new Date(endedAt).getTime() : null;
  const durationMs = endMs !== null ? endMs - startMs : null;

  // Derive agentId from first entry's actor
  const agentId = (firstEntry?.actor_id ?? 'unknown') as AgentId;

  const timeline: SessionTimeline = Object.freeze({
    sessionId,
    agentId,
    startedAt,
    endedAt,
    durationMs,
    entries: Object.freeze(entries),
    statistics,
  });

  return { ok: true, value: timeline };
}
