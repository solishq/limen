// Frontend types — derived from backend v5/crates/limen_graph/src/types.rs
// serde(rename_all = "snake_case") means JSON uses snake_case enum variants

export type NodeType = 'belief' | 'governance' | 'authority' | 'refusal';

export type EdgeType = 'provenance' | 'governance' | 'cascade' | 'refusal';

// Graph lifecycle state (backend: NodeLifecycleState per F-010 rename)
export type NodeLifecycleState = 'active' | 'suspended' | 'revoked' | 'pending' | 'archived';

export interface GraphNode {
  id: string;
  node_type: NodeType;
  label: string;
  tenant_scope: string;
  governance_state: NodeLifecycleState;
  confidence: number;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  edge_type: EdgeType;
  source_id: string;
  target_id: string;
  weight: number;
  label: string;
  created_at: string;
}

export interface NodeTypeCount {
  belief: number;
  governance: number;
  authority: number;
  refusal: number;
}

export interface NodeLifecycleStateCount {
  active: number;
  suspended: number;
  revoked: number;
  pending: number;
  archived: number;
}

export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  nodes_by_type: NodeTypeCount;
  nodes_by_state: NodeLifecycleStateCount;
  avg_confidence: number;
}

export interface NodeFilter {
  tenant_scope?: string;
  governance_state?: NodeLifecycleState;
  node_type?: NodeType;
  min_confidence?: number;
  limit?: number;
  offset?: number;
}

export interface TimeRange {
  start?: string;
  end?: string;
}

export interface QueryRequest {
  filters: NodeFilter[];
  time_range?: TimeRange;
  limit?: number;
}
