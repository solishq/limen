import type { Node, Edge } from '@xyflow/react';
import type { GraphNode, GraphEdge, GovernanceState } from './types';

const GOVERNANCE_COLORS: Record<GovernanceState, string> = {
  Verified: '#22c55e',
  Lagging: '#eab308',
  Divergent: '#ef4444',
  Unverified: '#6b7280',
  Rebuilding: '#3b82f6',
};

const EDGE_COLORS: Record<GraphEdge['type'], string> = {
  supports: '#22c55e',
  contradicts: '#ef4444',
  supersedes: '#eab308',
  derived_from: '#8b5cf6',
};

export function governanceColor(state: GovernanceState): string {
  return GOVERNANCE_COLORS[state] || '#6b7280';
}

export function toFlowNodes(nodes: GraphNode[]): Node[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  return nodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const size = 30 + (node.effectiveConfidence * 40);
    return {
      id: node.id,
      type: 'claim',
      position: { x: col * 220 + Math.random() * 40, y: row * 180 + Math.random() * 40 },
      data: {
        label: node.subject.split(':').pop() || node.subject,
        predicate: node.predicate,
        governanceState: node.governanceState,
        color: governanceColor(node.governanceState),
        size,
        confidence: node.effectiveConfidence,
        raw: node,
      },
    };
  });
}

export function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'default',
    animated: edge.type === 'contradicts',
    style: { stroke: EDGE_COLORS[edge.type] || '#6b7280', strokeWidth: 1.5 },
    data: { raw: edge },
  }));
}
