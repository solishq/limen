// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
import type {
  GraphNode, GraphEdge, GraphStats, NodeFilter, QueryRequest,
  RefusalAnalytics, DailyRefusalCount,
  BeliefVersion, BeliefBranch, MergeResult,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchNodes(params: NodeFilter): Promise<GraphNode[]> {
  const searchParams = new URLSearchParams();
  if (params.governance_state) searchParams.set('governance_state', params.governance_state);
  if (params.tenant_scope) searchParams.set('tenant_scope', params.tenant_scope);
  if (params.node_type) searchParams.set('node_type', params.node_type);
  if (params.min_confidence !== undefined) searchParams.set('min_confidence', String(params.min_confidence));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset));

  const url = `${API_BASE}/graph/nodes?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch nodes: ${res.status}`);
  return res.json();
}

export async function fetchEdges(nodeId: string): Promise<GraphEdge[]> {
  const res = await fetch(`${API_BASE}/graph/edges?node_id=${encodeURIComponent(nodeId)}`);
  if (!res.ok) throw new Error(`Failed to fetch edges: ${res.status}`);
  return res.json();
}

export async function fetchStats(): Promise<GraphStats> {
  const res = await fetch(`${API_BASE}/graph/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

export async function queryNodes(body: QueryRequest): Promise<GraphNode[]> {
  const res = await fetch(`${API_BASE}/graph/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to query nodes: ${res.status}`);
  return res.json();
}

// --- Refusal Analytics ---

export async function fetchRefusalAnalytics(params?: {
  tenant_scope?: string;
  start_date?: string;
  end_date?: string;
}): Promise<RefusalAnalytics> {
  const searchParams = new URLSearchParams();
  if (params?.tenant_scope) searchParams.set('tenant_scope', params.tenant_scope);
  if (params?.start_date) searchParams.set('start_date', params.start_date);
  if (params?.end_date) searchParams.set('end_date', params.end_date);
  const url = `${API_BASE}/refusals/analytics?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch refusal analytics: ${res.status}`);
  return res.json();
}

export async function fetchRefusalTrends(days?: number): Promise<DailyRefusalCount[]> {
  const searchParams = new URLSearchParams();
  if (days !== undefined) searchParams.set('days', String(days));
  const url = `${API_BASE}/refusals/trends?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch refusal trends: ${res.status}`);
  return res.json();
}

// --- Belief Versioning ---

export async function fetchBeliefVersions(beliefId: string): Promise<BeliefVersion[]> {
  const res = await fetch(`${API_BASE}/beliefs/${encodeURIComponent(beliefId)}/versions`);
  if (!res.ok) throw new Error(`Failed to fetch belief versions: ${res.status}`);
  return res.json();
}

export async function createBranch(beliefId: string, branchName: string): Promise<BeliefBranch> {
  const res = await fetch(`${API_BASE}/beliefs/${encodeURIComponent(beliefId)}/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: branchName }),
  });
  if (!res.ok) throw new Error(`Failed to create branch: ${res.status}`);
  return res.json();
}

export async function mergeBranches(
  source: string,
  target: string,
  resolution: string,
): Promise<MergeResult> {
  const res = await fetch(`${API_BASE}/beliefs/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_branch: source, target_branch: target, resolution_strategy: resolution }),
  });
  if (!res.ok) throw new Error(`Failed to merge branches: ${res.status}`);
  return res.json();
}
