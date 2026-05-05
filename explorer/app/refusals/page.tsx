'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import { fetchRefusalAnalytics } from '@/lib/api';
import type { RefusalAnalytics } from '@/lib/types';

export default function RefusalsPage() {
  const [analytics, setAnalytics] = useState<RefusalAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { tenant_scope?: string; start_date?: string; end_date?: string } = {};
      if (tenant) params.tenant_scope = tenant;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const data = await fetchRefusalAnalytics(params);
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refusal analytics');
    } finally {
      setLoading(false);
    }
  }, [tenant, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const reasonData = analytics?.top_reasons.map(([reason, count]) => ({ reason, count })) ?? [];
  const trendData = analytics?.trend ?? [];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <h1 className="text-lg font-semibold text-white">Refusal Analytics</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 uppercase">Tenant</span>
          <input
            type="text"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="All tenants"
            className="bg-[#111118] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-gray-200 w-36"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 uppercase">Start Date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-[#111118] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-gray-200"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 uppercase">End Date</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-[#111118] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-gray-200"
          />
        </label>
        <button
          onClick={load}
          className="bg-[#1a1a2e] border border-[#2a2a3e] hover:bg-[#2a2a3e] text-xs text-white px-3 py-1.5 rounded transition-colors"
        >
          Apply
        </button>
      </div>

      {error && (
        <div className="bg-red-950/90 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="text-gray-500 text-xs animate-pulse">Loading analytics...</div>
      )}

      {analytics && !loading && (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total Refusals" value={analytics.total_refusals.toLocaleString()} />
            <StatCard label="Refusal Rate" value={`${(analytics.refusal_rate * 100).toFixed(1)}%`} />
            <StatCard label="Governance Impact" value={analytics.governance_impact_score.toFixed(2)} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart: Top Reasons */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-4">
              <h2 className="text-xs font-medium text-gray-400 mb-3">Top Refusal Reasons</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={reasonData} layout="vertical" margin={{ left: 80 }}>
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} />
                  <YAxis type="category" dataKey="reason" tick={{ fill: '#9ca3af', fontSize: 10 }} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: '#e5e5e5' }}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Line Chart: Trend */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-4">
              <h2 className="text-xs font-medium text-gray-400 mb-3">Refusal Trend (30 days)</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                  <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: '#e5e5e5' }}
                  />
                  <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DataTable title="By Governance State" data={analytics.by_governance_state} />
            <DataTable title="By Tenant" data={analytics.by_tenant} />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-4">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}

function DataTable({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-lg p-4">
      <h2 className="text-xs font-medium text-gray-400 mb-3">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-600">No data</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1e1e2e]">
              <th className="text-left py-1 text-gray-500 font-medium">Name</th>
              <th className="text-right py-1 text-gray-500 font-medium">Count</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, count]) => (
              <tr key={name} className="border-b border-[#0d0d14]">
                <td className="py-1.5 text-gray-300">{name}</td>
                <td className="py-1.5 text-right text-gray-200 font-mono">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
