import type { GraphNode, GraphEdge, GraphStats, NodeFilter, QueryRequest } from './types';

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
