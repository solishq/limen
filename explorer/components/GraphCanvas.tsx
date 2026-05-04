'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import ClaimNode from './ClaimNode';
import FilterBar from './FilterBar';
import NodeDetails from './NodeDetails';
import StatsPanel from './StatsPanel';
import { fetchNodes, fetchEdges, fetchStats } from '@/lib/api';
import { toFlowNodes, toFlowEdges } from '@/lib/graph-utils';
import type { GraphNode, GraphEdge, GraphStats, NodeFilter } from '@/lib/types';

const nodeTypes = { claim: ClaimNode };

export default function GraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [filters, setFilters] = useState<NodeFilter>({ limit: 200 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rawNodes, rawStats] = await Promise.all([
        fetchNodes(filters),
        fetchStats(),
      ]);
      setNodes(toFlowNodes(rawNodes));
      // Edges loaded per-node on click, not all at once
      setEdges([]);
      setStats(rawStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph data');
    } finally {
      setLoading(false);
    }
  }, [filters, setNodes, setEdges]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const onNodeClick: NodeMouseHandler = useCallback(async (_event, node) => {
    const raw = (node.data as Record<string, unknown>).raw as GraphNode;
    setSelectedNode(raw);
    try {
      const nodeEdges = await fetchEdges(raw.id);
      setSelectedEdges(nodeEdges);
      setEdges(toFlowEdges(nodeEdges));
    } catch {
      setSelectedEdges([]);
    }
  }, [setEdges]);

  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    const raw = (edge.data as Record<string, unknown>)?.raw as GraphEdge | undefined;
    if (raw) {
      setSelectedNode(null);
      setSelectedEdges([raw]);
    }
  }, []);

  return (
    <div className="w-full h-screen flex flex-col bg-[#0a0a0f]">
      <FilterBar filters={filters} onChange={setFilters} />

      <div className="flex-1 relative">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-50">
            <div className="bg-red-950/90 border border-red-800 rounded-lg p-6 max-w-md text-center">
              <p className="text-red-300 text-sm mb-2">Connection Error</p>
              <p className="text-red-400 text-xs mb-4">{error}</p>
              <button
                onClick={loadGraph}
                className="text-xs bg-red-800 hover:bg-red-700 text-white px-3 py-1 rounded"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-50">
            <div className="text-gray-500 text-xs animate-pulse">Loading graph...</div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          className="bg-[#0a0a0f]"
        >
          <Background color="#1e1e2e" gap={32} size={1} />
          <Controls
            className="!bg-[#111118] !border-[#1e1e2e] !shadow-none [&>button]:!bg-[#1a1a2e] [&>button]:!border-[#2a2a3e] [&>button]:!text-white [&>button:hover]:!bg-[#2a2a3e]"
          />
        </ReactFlow>

        <StatsPanel stats={stats} />

        <NodeDetails
          node={selectedNode}
          edges={selectedEdges}
          onClose={() => { setSelectedNode(null); setSelectedEdges([]); }}
        />
      </div>
    </div>
  );
}
