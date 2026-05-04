'use client';

import type { GraphStats } from '@/lib/types';
import { governanceColor } from '@/lib/graph-utils';
import type { GovernanceState } from '@/lib/types';

interface StatsPanelProps {
  stats: GraphStats | null;
}

export default function StatsPanel({ stats }: StatsPanelProps) {
  if (!stats) return null;

  return (
    <div className="absolute bottom-4 left-4 bg-[#111118]/95 border border-[#1e1e2e] rounded-lg p-3 z-40 backdrop-blur-sm">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <Stat label="Nodes" value={String(stats.totalNodes)} />
        <Stat label="Edges" value={String(stats.totalEdges)} />
        <Stat label="Avg Confidence" value={`${(stats.avgConfidence * 100).toFixed(0)}%`} />
        <Stat label="Tenants" value={String(stats.tenants.length)} />
      </div>
      <div className="mt-2 pt-2 border-t border-[#1e1e2e] flex gap-2 flex-wrap">
        {Object.entries(stats.byGovernanceState).map(([state, count]) => (
          <span
            key={state}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: governanceColor(state as GovernanceState), border: `1px solid ${governanceColor(state as GovernanceState)}30` }}
          >
            {state}: {count}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-white font-mono">{value}</span>
    </div>
  );
}
