// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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

export interface QueryRequest {
  filters: NodeFilter[];
  limit?: number;
}

// --- Refusal Analytics ---

export interface DailyRefusalCount {
  day: string;
  count: number;
  rate: number;
}

export interface RefusalAnalytics {
  total_refusals: number;
  refusal_rate: number;
  top_reasons: [string, number][];
  by_governance_state: Record<string, number>;
  by_tenant: Record<string, number>;
  trend: DailyRefusalCount[];
  governance_impact_score: number;
}

// --- Belief Versioning ---

export interface BeliefVersion {
  version_id: string;
  belief_id: string;
  content: unknown;
  confidence: number;
  governance_state: string;
  created_at: string;
  parent_version: string | null;
  branch_name: string | null;
}

export interface BeliefBranch {
  branch_id: string;
  name: string;
  base_version: string;
  versions: BeliefVersion[];
  created_at: string;
}

export interface MergeResult {
  merged_version: BeliefVersion;
  conflicts_resolved: number;
  resolution_strategy: string;
}
