'use client';

import { useCallback, useState } from 'react';
import { fetchBeliefVersions, createBranch, mergeBranches } from '@/lib/api';
import type { BeliefVersion, MergeResult } from '@/lib/types';

type ResolutionStrategy = 'take_source' | 'take_target' | 'take_higher_confidence';

export default function VersionsPage() {
  const [beliefId, setBeliefId] = useState('');
  const [versions, setVersions] = useState<BeliefVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<BeliefVersion | null>(null);
  const [branchName, setBranchName] = useState('');
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeResolution, setMergeResolution] = useState<ResolutionStrategy>('take_source');
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const search = useCallback(async () => {
    if (!beliefId.trim()) return;
    setLoading(true);
    setError(null);
    setVersions([]);
    setSelectedVersion(null);
    try {
      const data = await fetchBeliefVersions(beliefId.trim());
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch versions');
    } finally {
      setLoading(false);
    }
  }, [beliefId]);

  const handleCreateBranch = async () => {
    if (!selectedVersion || !branchName.trim()) return;
    setActionLoading(true);
    try {
      await createBranch(selectedVersion.belief_id, branchName.trim());
      setBranchName('');
      setShowBranchDialog(false);
      await search();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeSource.trim() || !mergeTarget.trim()) return;
    setActionLoading(true);
    setMergeResult(null);
    try {
      const result = await mergeBranches(mergeSource.trim(), mergeTarget.trim(), mergeResolution);
      setMergeResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge branches');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <h1 className="text-lg font-semibold text-white">Belief Versioning</h1>

      {/* Search */}
      <div className="flex gap-2 items-end">
        <label className="flex flex-col gap-1 flex-1 max-w-md">
          <span className="text-[10px] text-gray-500 uppercase">Belief ID</span>
          <input
            type="text"
            value={beliefId}
            onChange={(e) => setBeliefId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
            placeholder="Enter belief ID..."
            className="bg-[#111118] border border-[#2a2a3e] rounded px-2 py-1.5 text-xs text-gray-200"
          />
        </label>
        <button
          onClick={search}
          disabled={loading}
          className="bg-[#1a1a2e] border border-[#2a2a3e] hover:bg-[#2a2a3e] text-xs text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          Search
        </button>
        <button
          onClick={() => setShowMergeDialog(true)}
          className="bg-[#1a1a2e] border border-[#2a2a3e] hover:bg-[#2a2a3e] text-xs text-white px-3 py-1.5 rounded transition-colors"
        >
          Merge Branches
        </button>
      </div>

      {error && (
        <div className="bg-red-950/90 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-400 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {loading && <div className="text-gray-500 text-xs animate-pulse">Loading versions...</div>}

      {/* Version Timeline */}
      {versions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{versions.length} version(s) found</p>
          <div className="space-y-1">
            {versions.map((v) => (
              <div
                key={v.version_id}
                onClick={() => setSelectedVersion(v)}
                className={`
                  bg-[#111118] border rounded-lg p-3 cursor-pointer transition-colors
                  ${selectedVersion?.version_id === v.version_id
                    ? 'border-indigo-500/60 bg-[#14142a]'
                    : 'border-[#1e1e2e] hover:border-[#2a2a3e]'}
                `}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                    <span className="text-xs text-gray-200 font-mono">{v.version_id.slice(0, 12)}</span>
                    {v.branch_name && (
                      <span className="text-[10px] bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded">
                        {v.branch_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500">
                      confidence: <span className="text-gray-300">{v.confidence.toFixed(2)}</span>
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${stateColor(v.governance_state)}`}>
                      {v.governance_state}
                    </span>
                  </div>
                </div>
                <div className="mt-2 ml-5">
                  <p className="text-[11px] text-gray-500 truncate max-w-lg">
                    {typeof v.content === 'string' ? v.content : JSON.stringify(v.content).slice(0, 100)}
                  </p>
                  <p className="text-[10px] text-gray-600 mt-1">{v.created_at}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Branch from selected version */}
      {selectedVersion && (
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowBranchDialog(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-xs text-white px-3 py-1.5 rounded transition-colors"
          >
            Branch from {selectedVersion.version_id.slice(0, 8)}
          </button>
        </div>
      )}

      {/* Branch Dialog */}
      {showBranchDialog && (
        <Dialog onClose={() => setShowBranchDialog(false)} title="Create Branch">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-500 uppercase">Branch Name</span>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="e.g. experiment-a"
              className="bg-[#0a0a0f] border border-[#2a2a3e] rounded px-2 py-1.5 text-xs text-gray-200"
            />
          </label>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreateBranch}
              disabled={actionLoading || !branchName.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-xs text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowBranchDialog(false)}
              className="bg-[#1a1a2e] border border-[#2a2a3e] text-xs text-gray-300 px-3 py-1.5 rounded"
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}

      {/* Merge Dialog */}
      {showMergeDialog && (
        <Dialog onClose={() => { setShowMergeDialog(false); setMergeResult(null); }} title="Merge Branches">
          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase">Source Branch</span>
              <input
                type="text"
                value={mergeSource}
                onChange={(e) => setMergeSource(e.target.value)}
                placeholder="Source branch name"
                className="bg-[#0a0a0f] border border-[#2a2a3e] rounded px-2 py-1.5 text-xs text-gray-200"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase">Target Branch</span>
              <input
                type="text"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="Target branch name"
                className="bg-[#0a0a0f] border border-[#2a2a3e] rounded px-2 py-1.5 text-xs text-gray-200"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase">Conflict Resolution</span>
              <select
                value={mergeResolution}
                onChange={(e) => setMergeResolution(e.target.value as ResolutionStrategy)}
                className="bg-[#0a0a0f] border border-[#2a2a3e] rounded px-2 py-1.5 text-xs text-gray-200"
              >
                <option value="take_source">Take Source</option>
                <option value="take_target">Take Target</option>
                <option value="take_higher_confidence">Take Higher Confidence</option>
              </select>
            </label>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleMerge}
                disabled={actionLoading || !mergeSource.trim() || !mergeTarget.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 text-xs text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Merging...' : 'Merge'}
              </button>
              <button
                onClick={() => { setShowMergeDialog(false); setMergeResult(null); }}
                className="bg-[#1a1a2e] border border-[#2a2a3e] text-xs text-gray-300 px-3 py-1.5 rounded"
              >
                Cancel
              </button>
            </div>
            {mergeResult && (
              <div className="mt-3 bg-green-950/50 border border-green-800 rounded p-3 text-xs text-green-300">
                <p>Merged successfully. Conflicts resolved: {mergeResult.conflicts_resolved}</p>
                <p className="text-green-400 mt-1">Strategy: {mergeResult.resolution_strategy}</p>
                <p className="text-green-500 mt-1 font-mono text-[10px]">
                  Version: {mergeResult.merged_version.version_id}
                </p>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#111118] border border-[#2a2a3e] rounded-lg p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-white mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function stateColor(state: string): string {
  switch (state) {
    case 'active': return 'bg-green-900/40 text-green-300';
    case 'suspended': return 'bg-yellow-900/40 text-yellow-300';
    case 'revoked': return 'bg-red-900/40 text-red-300';
    case 'pending': return 'bg-blue-900/40 text-blue-300';
    case 'archived': return 'bg-gray-800/40 text-gray-400';
    default: return 'bg-gray-800/40 text-gray-400';
  }
}
