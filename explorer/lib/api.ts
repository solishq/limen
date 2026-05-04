import type { GraphNode, GraphEdge, GraphStats, NodeFilter, QueryRequest } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchNodes(params: NodeFilter): Promise<GraphNode[]> {
  const searchParams = new URLSearchParams();
  if (params.governanceState) searchParams.set('governanceState', params.governanceState);
  if (params.tenant) searchParams.set('tenant', params.tenant);
  if (params.minConfidence !== undefined) searchParams.set('minConfidence', String(params.minConfidence));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));

  const url = `${API_BASE}/graph/nodes?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch nodes: ${res.status}`);
  return res.json();
}

export async function fetchEdges(nodeId: string): Promise<GraphEdge[]> {
  const res = await fetch(`${API_BASE}/graph/nodes/${encodeURIComponent(nodeId)}/edges`);
  if (!res.ok) throw new Error(`Failed to fetch edges: ${res.status}`);
  return res.json();
}

export async function fetchAllEdges(): Promise<GraphEdge[]> {
  const res = await fetch(`${API_BASE}/graph/edges`);
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
