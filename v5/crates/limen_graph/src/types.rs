// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
use serde::{Deserialize, Serialize};

/// Classification of a graph node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Belief,
    Governance,
    Authority,
    Refusal,
}

/// Classification of a graph edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    Provenance,
    Governance,
    Cascade,
    Refusal,
}

/// Node lifecycle state (graph-level lifecycle, distinct from simulator's ProjectionValidityState).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeLifecycleState {
    Active,
    Suspended,
    Revoked,
    Pending,
    Archived,
}

impl Default for NodeLifecycleState {
    fn default() -> Self {
        Self::Pending
    }
}

/// A node in the knowledge graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub node_type: NodeType,
    pub label: String,
    pub tenant_scope: String,
    pub governance_state: NodeLifecycleState,
    pub confidence: f64,
    pub created_at: String,
    pub metadata: serde_json::Value,
}

/// A directed edge between two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub edge_type: EdgeType,
    pub source_id: String,
    pub target_id: String,
    pub weight: f64,
    pub label: String,
    pub created_at: String,
}

/// Aggregate statistics for the graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphStats {
    pub total_nodes: usize,
    pub total_edges: usize,
    pub nodes_by_type: NodeTypeCount,
    pub nodes_by_state: NodeLifecycleStateCount,
    pub avg_confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeTypeCount {
    pub belief: usize,
    pub governance: usize,
    pub authority: usize,
    pub refusal: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeLifecycleStateCount {
    pub active: usize,
    pub suspended: usize,
    pub revoked: usize,
    pub pending: usize,
    pub archived: usize,
}

/// Filter criteria for querying nodes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodeFilter {
    pub tenant_scope: Option<String>,
    pub governance_state: Option<NodeLifecycleState>,
    pub node_type: Option<NodeType>,
    pub min_confidence: Option<f64>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Request body for POST /graph/query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRequest {
    pub filters: Vec<NodeFilter>,
    pub limit: Option<usize>,
}

/// Error response for API endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub detail: Option<String>,
}
