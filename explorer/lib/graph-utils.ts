import type { Node, Edge } from '@xyflow/react';
import type { GraphNode, GraphEdge, NodeLifecycleState, EdgeType } from './types';

const LIFECYCLE_COLORS: Record<NodeLifecycleState, string> = {
  active: '#22c55e',
  suspended: '#eab308',
  revoked: '#ef4444',
  pending: '#6b7280',
  archived: '#3b82f6',
};

const EDGE_COLORS: Record<EdgeType, string> = {
  provenance: '#22c55e',
  governance: '#8b5cf6',
  cascade: '#eab308',
  refusal: '#ef4444',
};

export function governanceColor(state: NodeLifecycleState): string {
  return LIFECYCLE_COLORS[state] || '#6b7280';
}

export function toFlowNodes(nodes: GraphNode[]): Node[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  return nodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const size = 30 + (node.confidence * 40);
    return {
      id: node.id,
      type: 'claim',
      position: { x: col * 220 + Math.random() * 40, y: row * 180 + Math.random() * 40 },
      data: {
        label: node.label,
        predicate: node.node_type,
        governanceState: node.governance_state,
        color: governanceColor(node.governance_state),
        size,
        confidence: node.confidence,
        raw: node,
      },
    };
  });
}

export function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: 'default',
    animated: edge.edge_type === 'refusal',
    style: { stroke: EDGE_COLORS[edge.edge_type] || '#6b7280', strokeWidth: 1.5 },
    data: { raw: edge },
  }));
}
