use std::collections::BTreeMap;

use crate::types::{
    NodeLifecycleState, NodeLifecycleStateCount, GraphEdge, GraphNode, GraphStats, NodeFilter,
    NodeType, NodeTypeCount,
};

/// In-memory graph store backed by BTreeMap for deterministic ordering.
#[derive(Debug, Default, Clone)]
pub struct InMemoryGraphStore {
    nodes: BTreeMap<String, GraphNode>,
    edges: BTreeMap<String, GraphEdge>,
    /// Index: node_id -> list of edge_ids where node is source or target.
    node_edges: BTreeMap<String, Vec<String>>,
}

impl InMemoryGraphStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_node(&mut self, node: GraphNode) {
        self.nodes.insert(node.id.clone(), node);
    }

    pub fn add_edge(&mut self, edge: GraphEdge) {
        let edge_id = edge.id.clone();
        self.node_edges
            .entry(edge.source_id.clone())
            .or_default()
            .push(edge_id.clone());
        self.node_edges
            .entry(edge.target_id.clone())
            .or_default()
            .push(edge_id.clone());
        self.edges.insert(edge_id, edge);
    }

    pub fn query_nodes(&self, filter: &NodeFilter) -> Vec<&GraphNode> {
        let offset = filter.offset.unwrap_or(0);
        let limit = filter.limit.unwrap_or(50);

        self.nodes
            .values()
            .filter(|node| {
                if let Some(ref tenant) = filter.tenant_scope {
                    if &node.tenant_scope != tenant {
                        return false;
                    }
                }
                if let Some(state) = filter.governance_state {
                    if node.governance_state != state {
                        return false;
                    }
                }
                if let Some(nt) = filter.node_type {
                    if node.node_type != nt {
                        return false;
                    }
                }
                if let Some(min_conf) = filter.min_confidence {
                    if node.confidence < min_conf {
                        return false;
                    }
                }
                true
            })
            .skip(offset)
            .take(limit)
            .collect()
    }

    pub fn query_edges(&self, node_id: &str) -> Vec<&GraphEdge> {
        match self.node_edges.get(node_id) {
            Some(edge_ids) => edge_ids
                .iter()
                .filter_map(|eid| self.edges.get(eid))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Return all nodes as a Vec of references (used by analytics).
    pub fn all_nodes(&self) -> Vec<&GraphNode> {
        self.nodes.values().collect()
    }

    pub fn stats(&self) -> GraphStats {
        let mut by_type = NodeTypeCount {
            belief: 0,
            governance: 0,
            authority: 0,
            refusal: 0,
        };
        let mut by_state = NodeLifecycleStateCount {
            active: 0,
            suspended: 0,
            revoked: 0,
            pending: 0,
            archived: 0,
        };
        let mut total_confidence = 0.0;

        for node in self.nodes.values() {
            match node.node_type {
                NodeType::Belief => by_type.belief += 1,
                NodeType::Governance => by_type.governance += 1,
                NodeType::Authority => by_type.authority += 1,
                NodeType::Refusal => by_type.refusal += 1,
            }
            match node.governance_state {
                NodeLifecycleState::Active => by_state.active += 1,
                NodeLifecycleState::Suspended => by_state.suspended += 1,
                NodeLifecycleState::Revoked => by_state.revoked += 1,
                NodeLifecycleState::Pending => by_state.pending += 1,
                NodeLifecycleState::Archived => by_state.archived += 1,
            }
            total_confidence += node.confidence;
        }

        let avg_confidence = if self.nodes.is_empty() {
            0.0
        } else {
            total_confidence / self.nodes.len() as f64
        };

        GraphStats {
            total_nodes: self.nodes.len(),
            total_edges: self.edges.len(),
            nodes_by_type: by_type,
            nodes_by_state: by_state,
            avg_confidence,
        }
    }
}
