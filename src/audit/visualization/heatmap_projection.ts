// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §5
/**
 * Heatmap Projection — GovernanceHeatmapData aggregation from audit entries.
 *
 * Implements: AV-5.1 through AV-5.10, AV-10.8 (Privacy Safety), AV-10.10 (Single Source of Truth)
 *
 * AV-10.8: Heatmap aggregates contain ONLY counts and rates. No PII, no claim content,
 *          no subject URNs. actionCategory uses coarse categories, not specific predicates.
 * AV-5.8: HeatmapCell.intensity MUST be normalized within dataset (0.0-1.0).
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Result, AgentId } from '../../kernel/interfaces/index.js';
import type {
  GovernanceHeatmapData, HeatmapCell, GovernanceHeatmapTotals,
  HeatmapOptions, HeatmapGranularity, GovernanceDecision,
} from './visualization_types.js';

// ─── Internal row shape ───

interface AuditRow {
  id: string;
  timestamp: string;
  actor_id: string;
  operation: string;
  detail: string | null;
}

// ─── Coarse action category derivation (AV-10.8: no specific predicates) ───

function deriveActionCategory(operation: string): string {
  if (operation.startsWith('memory_') || operation === 'assert_claim' || operation === 'retract_claim' || operation === 'relate_claims') {
    return 'memory';
  }
  if (operation.startsWith('branch_')) return 'branch';
  if (operation.startsWith('session_')) return 'session';
  if (operation.startsWith('governance_') || operation === 'governance_check') return 'governance';
  if (operation === 'computer_action') return 'computer';
  if (operation === 'agent_register') return 'agent';
  if (operation === 'classification_change') return 'classification';
  if (operation === 'export' || operation === 'import') return 'exchange';
  return 'other';
}

// ─── Bucket timestamp generation ───

function getBucketStart(timestamp: string, granularity: HeatmapGranularity): string {
  const dt = new Date(timestamp);
  switch (granularity) {
    case 'minute':
      dt.setUTCSeconds(0, 0);
      break;
    case 'hour':
      dt.setUTCMinutes(0, 0, 0);
      break;
    case 'day':
      dt.setUTCHours(0, 0, 0, 0);
      break;
    case 'week': {
      // ISO week start (Monday)
      const day = dt.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      dt.setUTCDate(dt.getUTCDate() + diff);
      dt.setUTCHours(0, 0, 0, 0);
      break;
    }
  }
  return dt.toISOString();
}

// ─── Governance decision extraction ───

function extractDecision(detail: string | null): GovernanceDecision | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    const d = parsed.decision ?? parsed.governance_decision ?? parsed.governanceDecision;
    if (d === 'allow' || d === 'refuse' || d === 'escalate' || d === 'sandbox') return d;
  } catch {
    // Non-JSON detail — no decision
  }
  return null;
}

export interface HeatmapProjectionDeps {
  readonly conn: DatabaseConnection;
  readonly timeProvider: TimeProvider;
}

/**
 * Build GovernanceHeatmapData from audit entries.
 * AV-5.1: Returns timeRange, granularity, cells, totals.
 * AV-10.8: Only counts and rates. No PII.
 */
export function buildGovernanceHeatmap(
  deps: HeatmapProjectionDeps,
  options: HeatmapOptions,
): Result<GovernanceHeatmapData> {
  const { conn } = deps;
  const { timeRange, granularity, agentId, actionCategory } = options;

  // Query audit entries in time range
  const conditions: string[] = ['timestamp >= ?', 'timestamp <= ?'];
  const params: unknown[] = [timeRange.from, timeRange.to];

  if (agentId) {
    conditions.push('actor_id = ?');
    params.push(agentId);
  }

  const whereClause = conditions.join(' AND ');
  const rows = conn.query<AuditRow>(
    `SELECT id, timestamp, actor_id, operation, detail
     FROM core_audit_log
     WHERE ${whereClause}
     ORDER BY timestamp ASC`,
    params,
  );

  // Aggregate into buckets
  // Key: `${bucketTimestamp}|${agentId}|${category}`
  const buckets = new Map<string, { allowed: number; refused: number; escalated: number; sandboxed: number; agentId: string | null; category: string; timestamp: string }>();
  const ruleCounts = new Map<string, number>();
  let totalDecisions = 0;
  let totalAllowed = 0;
  let totalRefused = 0;
  let totalEscalated = 0;
  let totalSandboxed = 0;

  for (const row of rows) {
    const category = deriveActionCategory(row.operation);
    if (actionCategory && category !== actionCategory) continue;

    const decision = extractDecision(row.detail);
    if (!decision) continue; // Only governance decisions contribute to heatmap

    totalDecisions++;
    const bucketTs = getBucketStart(row.timestamp, granularity);
    const cellAgentId = agentId ? row.actor_id : null; // null = aggregate (AV-5.9)
    const key = `${bucketTs}|${cellAgentId ?? '__agg__'}|${category}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { allowed: 0, refused: 0, escalated: 0, sandboxed: 0, agentId: cellAgentId, category, timestamp: bucketTs };
      buckets.set(key, bucket);
    }

    switch (decision) {
      case 'allow':
        bucket.allowed++;
        totalAllowed++;
        break;
      case 'refuse':
        bucket.refused++;
        totalRefused++;
        // Track refusal rules
        try {
          const parsed = JSON.parse(row.detail ?? '{}');
          const rule = parsed.rule ?? parsed.ruleName ?? 'unknown';
          if (typeof rule === 'string') {
            ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
          }
        } catch { /* ignore parse failures */ }
        break;
      case 'escalate':
        bucket.escalated++;
        totalEscalated++;
        break;
      case 'sandbox':
        bucket.sandboxed++;
        totalSandboxed++;
        break;
    }
  }

  // Compute intensity normalization (AV-5.8)
  let maxTotal = 0;
  for (const bucket of buckets.values()) {
    const total = bucket.allowed + bucket.refused + bucket.escalated + bucket.sandboxed;
    if (total > maxTotal) maxTotal = total;
  }

  // Build cells
  const cells: HeatmapCell[] = [];
  for (const bucket of buckets.values()) {
    const total = bucket.allowed + bucket.refused + bucket.escalated + bucket.sandboxed;
    cells.push(Object.freeze({
      timestamp: bucket.timestamp,
      agentId: bucket.agentId as AgentId | null,
      actionCategory: bucket.category,
      allowed: bucket.allowed,
      refused: bucket.refused,
      escalated: bucket.escalated,
      sandboxed: bucket.sandboxed,
      intensity: maxTotal > 0 ? total / maxTotal : 0,
    }));
  }

  // Sort by timestamp
  cells.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Build top refusal rules (AV-5.7)
  const topRefusalRules = [...ruleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule, count]) => Object.freeze({ rule, count }));

  // Compute rates (AV-5.6, AV-5.10)
  const totals: GovernanceHeatmapTotals = Object.freeze({
    totalDecisions,
    allowRate: totalDecisions > 0 ? totalAllowed / totalDecisions : 0,
    refuseRate: totalDecisions > 0 ? totalRefused / totalDecisions : 0,
    escalateRate: totalDecisions > 0 ? totalEscalated / totalDecisions : 0,
    sandboxRate: totalDecisions > 0 ? totalSandboxed / totalDecisions : 0,
    topRefusalRules: Object.freeze(topRefusalRules),
  });

  const heatmap: GovernanceHeatmapData = Object.freeze({
    timeRange: Object.freeze({ from: timeRange.from, to: timeRange.to }),
    granularity,
    cells: Object.freeze(cells),
    totals,
  });

  return { ok: true, value: heatmap };
}
