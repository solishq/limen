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
          <h2 className="text-sm font-bold text-white truncate flex-1">{node.subject}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-lg ml-2"
          >
            x
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Predicate" value={node.predicate} />
          <Field label="Value" value={node.objectValue} multiline />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Governance:</span>
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{ color: governanceColor(node.governanceState), borderColor: governanceColor(node.governanceState), border: '1px solid' }}
            >
              {node.governanceState}
            </span>
          </div>
          <Field label="Effective Confidence" value={`${(node.effectiveConfidence * 100).toFixed(1)}%`} />
          <Field label="Raw Confidence" value={`${(node.confidence * 100).toFixed(1)}%`} />
          <Field label="Tenant" value={node.tenant} />
          <Field label="Valid At" value={new Date(node.validAt).toLocaleString()} />
          <Field label="Created" value={new Date(node.createdAt).toLocaleString()} />
          {node.certificateRef && <Field label="Certificate" value={node.certificateRef} />}

          {node.provenance && node.provenance.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 block mb-1">Provenance</span>
              <div className="space-y-1">
                {node.provenance.map((p, i) => (
                  <div key={i} className="text-[10px] text-gray-400 bg-[#0a0a0f] p-1.5 rounded">
                    <span className="text-blue-400">{p.action}</span>
                    {p.agent && <span className="text-gray-600"> by {p.agent}</span>}
                    <span className="text-gray-600 block">{new Date(p.timestamp).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {edges.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 block mb-1">Edges ({edges.length})</span>
              <div className="space-y-1">
                {edges.map((e) => (
                  <div key={e.id} className="text-[10px] text-gray-400 bg-[#0a0a0f] p-1.5 rounded flex justify-between">
                    <span className="text-purple-400">{e.type}</span>
                    <span className="text-gray-600 truncate ml-2">{e.target === node.id ? e.source : e.target}</span>
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
