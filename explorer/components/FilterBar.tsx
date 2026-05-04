'use client';

import type { GovernanceState, NodeFilter } from '@/lib/types';

interface FilterBarProps {
  filters: NodeFilter;
  onChange: (filters: NodeFilter) => void;
}

const STATES: (GovernanceState | 'All')[] = ['All', 'Verified', 'Lagging', 'Divergent', 'Unverified', 'Rebuilding'];

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-[#111118] border-b border-[#1e1e2e]">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Limen Graph Explorer</span>
      <div className="flex-1" />

      <label className="text-xs text-gray-500">State</label>
      <select
        className="bg-[#1a1a2e] text-white text-xs px-2 py-1 rounded border border-[#2a2a3e] focus:outline-none focus:border-blue-500"
        value={filters.governanceState || 'All'}
        onChange={(e) => {
          const val = e.target.value;
          onChange({ ...filters, governanceState: val === 'All' ? undefined : val as GovernanceState });
        }}
      >
        {STATES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <label className="text-xs text-gray-500">Tenant</label>
      <input
        type="text"
        placeholder="all"
        className="bg-[#1a1a2e] text-white text-xs px-2 py-1 rounded border border-[#2a2a3e] w-24 focus:outline-none focus:border-blue-500"
        value={filters.tenant || ''}
        onChange={(e) => onChange({ ...filters, tenant: e.target.value || undefined })}
      />

      <label className="text-xs text-gray-500">Min Confidence</label>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={(filters.minConfidence || 0) * 100}
        onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) / 100 || undefined })}
        className="w-20 accent-blue-500"
      />
      <span className="text-xs text-gray-400 w-8">
        {((filters.minConfidence || 0) * 100).toFixed(0)}%
      </span>
    </div>
  );
}
