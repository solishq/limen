// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AUDIT_VISUALIZATION_SCHEMA.md §4
/**
 * Belief Graph Projection — BeliefGraphSnapshot from claims + relationships.
 *
 * Implements: AV-4.1 through AV-4.19, AV-10.7 (Real-Time Consistency),
 *             AV-10.3 (Classification Enforcement), AV-10.10 (Single Source of Truth)
 *
 * AV-4.4: effectiveConfidence MUST use FSRS decay: R(t) = (1 + t/(9*S))^-1
 * AV-10.7: Snapshot reflects current state at query time. No stale caching.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Result, AgentId } from '../../kernel/interfaces/index.js';
import type { ClaimId, RelationshipId } from '../../claims/interfaces/claim_types.js';
import type { ClassificationLevel } from '../../governance/classification/governance_types.js';
import { CLASSIFICATION_LEVEL_ORDER } from '../../governance/classification/governance_types.js';
import type { FreshnessLabel } from '../../cognitive/freshness.js';
import type {
  BeliefGraphSnapshot, BeliefGraphNode, BeliefGraphEdge,
  GraphStatistics, BeliefGraphOptions, BeliefNodeType, ClaimStatus, BeliefEdgeType,
} from './visualization_types.js';

// ─── Internal row shapes ───

interface ClaimRow {
  id: string;
  tenant_id: string | null;
  subject: string | null;
  predicate: string | null;
  object_type: string | null;
  object_value: string | null;
  confidence: number | null;
  valid_at: string | null;
  source_agent_id: string | null;
  source_mission_id: string | null;
  source_task_id: string | null;
  grounding_mode: string | null;
  status: string;
  archived: number;
  created_at: string;
  stability: number | null;
  classification: string | null;
}

interface RelationshipRow {
  id: string;
  tenant_id: string | null;
  from_claim_id: string;
  to_claim_id: string;
  type: string;
  created_by: string | null;
  created_at: string;
}

// ─── FSRS Decay Function (AV-4.4) ───
// R(t) = (1 + t/(9*S))^-1
// t = time since last review (in days)
// S = stability (default 1.0)

function computeFSRSDecay(createdAt: string, nowMs: number, stability: number | null): number {
  const stab = stability ?? 1.0;
  if (stab <= 0) return 0;
  const createdMs = new Date(createdAt).getTime();
  const elapsedDays = (nowMs - createdMs) / (1000 * 60 * 60 * 24);
  if (elapsedDays <= 0) return 1.0;
  return Math.pow(1 + elapsedDays / (9 * stab), -1);
}

// ─── Freshness Label Derivation ───

function deriveFreshness(createdAt: string, nowMs: number): FreshnessLabel {
  const createdMs = new Date(createdAt).getTime();
  const elapsedHours = (nowMs - createdMs) / (1000 * 60 * 60);
  if (elapsedHours < 24) return 'fresh';
  if (elapsedHours < 168) return 'aging'; // 7 days
  return 'stale';
}

// ─── Node Type Derivation ───

function deriveNodeType(predicate: string | null): BeliefNodeType {
  if (!predicate) return 'belief';
  if (predicate.startsWith('governance.') || predicate.startsWith('gov.')) return 'governance';
  if (predicate.startsWith('authority.') || predicate.startsWith('trust.')) return 'authority';
  if (predicate.startsWith('refusal.') || predicate.includes('refuse')) return 'refusal';
  return 'belief';
}

// ─── Edge Type Mapping ───

function mapEdgeType(relType: string): BeliefEdgeType {
  switch (relType) {
    case 'supports': return 'supports';
    case 'contradicts': return 'contradicts';
    case 'supersedes': return 'supersedes';
    case 'derived_from': return 'derived_from';
    case 'provenance': return 'provenance';
    case 'governance': return 'governance';
    case 'cascade': return 'cascade';
    case 'refusal': return 'refusal';
    default: return 'supports';
  }
}

// ─── Connected Components (Union-Find) ───

function countConnectedComponents(nodeIds: readonly string[], edges: readonly { source: string; target: string }[]): number {
  if (nodeIds.length === 0) return 0;
  const parent = new Map<string, string>();
  for (const id of nodeIds) parent.set(id, id);

  function find(x: string): string {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) {
      parent.set(p, parent.get(parent.get(p) ?? p) ?? p);
      p = parent.get(p) ?? p;
    }
    parent.set(x, p);
    return p;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const edge of edges) {
    if (parent.has(edge.source) && parent.has(edge.target)) {
      union(edge.source, edge.target);
    }
  }

  const roots = new Set<string>();
  for (const id of nodeIds) roots.add(find(id));
  return roots.size;
}

export interface BeliefGraphProjectionDeps {
  readonly conn: DatabaseConnection;
  readonly timeProvider: TimeProvider;
  readonly clearanceLevel: number | undefined;
}

/**
 * Build a BeliefGraphSnapshot from the claims and relationships tables.
 * AV-10.7: Real-time — no caching.
 * AV-10.3: Classification enforcement at service layer.
 */
export function buildBeliefGraphSnapshot(
  deps: BeliefGraphProjectionDeps,
  options: BeliefGraphOptions,
): Result<BeliefGraphSnapshot> {
  const { conn, timeProvider, clearanceLevel } = deps;
  const nowMs = timeProvider.nowMs();
  const nowISO = timeProvider.nowISO();

  // Build WHERE clause for claims query
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.tenantId) {
    conditions.push('tenant_id = ?');
    params.push(options.tenantId);
  }
  if (options.agentId) {
    conditions.push('source_agent_id = ?');
    params.push(options.agentId);
  }
  if (!options.includeRetracted) {
    conditions.push("status != 'retracted'");
  }
  if (!options.includeArchived) {
    conditions.push('archived = 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Query claims
  let claimRows: ClaimRow[];
  if (options.rootClaimId) {
    // BFS from root up to depth hops
    const maxDepth = options.depth ?? 3;
    claimRows = breadthFirstClaims(conn, options.rootClaimId, maxDepth, whereClause, params);
  } else {
    claimRows = conn.query<ClaimRow>(
      `SELECT * FROM claim_assertions ${whereClause} ORDER BY created_at DESC LIMIT 1000`,
      params,
    );
  }

  // Post-filter by classification clearance (AV-10.3)
  const maxLevel = clearanceLevel ?? 4;
  const filteredClaims = claimRows.filter(row => {
    if (!row.classification) return true;
    const level = CLASSIFICATION_LEVEL_ORDER[row.classification as ClassificationLevel];
    return level === undefined || level <= maxLevel;
  });

  // Build nodes
  const nodeIds = new Set<string>();
  const nodes: BeliefGraphNode[] = [];
  for (const row of filteredClaims) {
    if (!row.id) continue;
    nodeIds.add(row.id);
    const confidence = row.confidence ?? 0;
    const effectiveConfidence = computeFSRSDecay(row.created_at, nowMs, row.stability);
    const node: BeliefGraphNode = Object.freeze({
      id: row.id as ClaimId,
      label: row.predicate ?? row.subject ?? row.id,
      nodeType: deriveNodeType(row.predicate),
      confidence,
      effectiveConfidence: confidence * effectiveConfidence,
      freshness: deriveFreshness(row.created_at, nowMs),
      classification: (row.classification ?? 'unrestricted') as ClassificationLevel,
      agentId: (row.source_agent_id ?? 'system') as AgentId,
      createdAt: row.created_at,
      status: (row.archived ? 'archived' : row.status) as ClaimStatus,
    });
    nodes.push(node);
  }

  // Query relationships for the node set
  const edges: BeliefGraphEdge[] = [];
  if (nodeIds.size > 0) {
    // Query all relationships involving our nodes
    const allRels = conn.query<RelationshipRow>(
      `SELECT * FROM claim_relationships
       WHERE from_claim_id IN (SELECT id FROM claim_assertions ${whereClause})
          OR to_claim_id IN (SELECT id FROM claim_assertions ${whereClause})
       LIMIT 5000`,
      [...params, ...params],
    );

    for (const rel of allRels) {
      if (nodeIds.has(rel.from_claim_id) || nodeIds.has(rel.to_claim_id)) {
        const sourceConf = filteredClaims.find(c => c.id === rel.from_claim_id)?.confidence ?? 0.5;
        edges.push(Object.freeze({
          id: rel.id as RelationshipId,
          source: rel.from_claim_id as ClaimId,
          target: rel.to_claim_id as ClaimId,
          edgeType: mapEdgeType(rel.type),
          weight: sourceConf,
          declaredBy: (rel.created_by ?? 'system') as AgentId,
          createdAt: rel.created_at,
        }));
      }
    }
  }

  // Compute statistics (AV-4.13 through AV-4.19)
  const connectedComponents = countConnectedComponents(
    [...nodeIds],
    edges.map(e => ({ source: e.source, target: e.target })),
  );

  const freshnessDistribution = { fresh: 0, aging: 0, stale: 0 };
  const classificationDistribution: Record<string, number> = {
    unrestricted: 0, internal: 0, confidential: 0, restricted: 0, critical: 0,
  };
  const agentDistribution: Record<string, number> = {};
  let confidenceSum = 0;

  for (const node of nodes) {
    freshnessDistribution[node.freshness]++;
    classificationDistribution[node.classification] = (classificationDistribution[node.classification] ?? 0) + 1;
    agentDistribution[node.agentId] = (agentDistribution[node.agentId] ?? 0) + 1;
    confidenceSum += node.confidence;
  }

  const statistics: GraphStatistics = Object.freeze({
    totalNodes: nodes.length,
    totalEdges: edges.length,
    connectedComponents,
    averageConfidence: nodes.length > 0 ? confidenceSum / nodes.length : 0,
    freshnessDistribution: Object.freeze(freshnessDistribution),
    classificationDistribution: Object.freeze(classificationDistribution) as Record<ClassificationLevel, number>,
    agentDistribution: Object.freeze(agentDistribution),
  });

  const snapshot: BeliefGraphSnapshot = Object.freeze({
    snapshotId: randomUUID(),
    timestamp: nowISO,
    agentId: options.agentId ?? null,
    tenantId: options.tenantId ?? null,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    statistics,
  });

  return { ok: true, value: snapshot };
}

// ─── BFS helper for rooted graph traversal ───

function breadthFirstClaims(
  conn: DatabaseConnection,
  rootId: ClaimId,
  maxDepth: number,
  _baseWhere: string,
  _baseParams: unknown[],
): ClaimRow[] {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  const results: ClaimRow[] = [];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);

    const row = conn.get<ClaimRow>(
      'SELECT * FROM claim_assertions WHERE id = ?',
      [item.id],
    );
    if (row) results.push(row);

    if (item.depth < maxDepth) {
      // Get adjacent nodes via relationships
      const rels = conn.query<{ from_claim_id: string; to_claim_id: string }>(
        'SELECT from_claim_id, to_claim_id FROM claim_relationships WHERE from_claim_id = ? OR to_claim_id = ?',
        [item.id, item.id],
      );
      for (const rel of rels) {
        const next = rel.from_claim_id === item.id ? rel.to_claim_id : rel.from_claim_id;
        if (!visited.has(next)) {
          queue.push({ id: next, depth: item.depth + 1 });
        }
      }
    }
  }

  return results;
}
