// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
'use client';

import type { GraphNode, GraphEdge } from '@/lib/types';
import { governanceColor } from '@/lib/graph-utils';

interface NodeDetailsProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  onClose: () => void;
}

export default function NodeDetails({ node, edges, onClose }: NodeDetailsProps) {
  if (!node) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-[#111118] border-l border-[#1e1e2e] overflow-y-auto z-50 shadow-2xl">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white truncate flex-1">{node.label}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-lg ml-2"
          >
            x
          </button>
        </div>

        <div className="space-y-3">
          <Field label="ID" value={node.id} />
          <Field label="Type" value={node.node_type} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">State:</span>
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{ color: governanceColor(node.governance_state), borderColor: governanceColor(node.governance_state), border: '1px solid' }}
            >
              {node.governance_state}
            </span>
          </div>
          <Field label="Confidence" value={`${(node.confidence * 100).toFixed(1)}%`} />
          <Field label="Tenant" value={node.tenant_scope} />
          <Field label="Created" value={new Date(node.created_at).toLocaleString()} />
          {node.metadata && Object.keys(node.metadata).length > 0 && (
            <Field label="Metadata" value={JSON.stringify(node.metadata, null, 2)} multiline />
          )}

          {edges.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 block mb-1">Edges ({edges.length})</span>
              <div className="space-y-1">
                {edges.map((e) => (
                  <div key={e.id} className="text-[10px] text-gray-400 bg-[#0a0a0f] p-1.5 rounded flex justify-between">
                    <span className="text-purple-400">{e.edge_type}</span>
                    <span className="text-gray-600 truncate ml-2">{e.target_id === node.id ? e.source_id : e.target_id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <span className="text-xs text-gray-500 block">{label}</span>
      <span className={`text-xs text-gray-200 ${multiline ? 'whitespace-pre-wrap break-all' : 'truncate block'}`}>
        {value}
      </span>
    </div>
  );
}
