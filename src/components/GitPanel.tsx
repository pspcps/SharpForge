import React, { useState } from 'react';
import { GitBranch, RefreshCw, Check, FileDiff, GitCommitHorizontal } from 'lucide-react';
import type { GitChangeItem } from '../types/electron';

interface GitPanelProps {
  branch: string;
  isRepo: boolean;
  changes: GitChangeItem[];
  onRefresh: () => void;
  onOpenChangedFile: (fullPath: string) => void;
  onViewDiff: (fullPath: string) => void;
  onCommit: (message: string) => Promise<void>;
  activeDiff?: { file: string; diff: string } | null;
}

export const GitPanel: React.FC<GitPanelProps> = ({
  branch,
  isRepo,
  changes,
  onRefresh,
  onOpenChangedFile,
  onViewDiff,
  onCommit,
  activeDiff
}) => {
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  const handleCommitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim() || changes.length === 0) return;
    setIsCommitting(true);
    try {
      await onCommit(commitMessage.trim());
      setCommitMessage('');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1f22] text-[#bcbec4] text-xs overflow-hidden select-none">
      <div className="h-8 bg-[#26282b] border-b border-[#2b2d30] px-3 flex items-center justify-between">
        <span className="uppercase text-[11px] text-[#868a91] font-bold">Git Source Control</span>
        <button
          onClick={onRefresh}
          className="p-1 hover:bg-[#35373c] rounded text-gray-400 hover:text-white"
          title="Refresh Git Status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-3 flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center space-x-2 text-gray-300 bg-[#26282b] px-2.5 py-1.5 rounded border border-[#2b2d30]">
          <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate font-mono text-[11px] font-semibold text-emerald-300">{branch}</span>
          {!isRepo && (
            <span className="ml-auto text-[10px] text-gray-500">Workspace</span>
          )}
        </div>

        {/* Commit Box */}
        <form onSubmit={handleCommitSubmit} className="space-y-1.5">
          <textarea
            rows={2}
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            placeholder="Commit message (Stage & Commit all changes)..."
            className="w-full bg-[#18191c] border border-[#393b40] rounded px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-[#3574f0] resize-none"
          />
          <button
            type="submit"
            disabled={isCommitting || !commitMessage.trim() || changes.length === 0}
            className="w-full flex items-center justify-center space-x-1.5 py-1.5 bg-[#3574f0] hover:bg-blue-500 disabled:opacity-40 text-white rounded font-medium transition"
          >
            <GitCommitHorizontal className="w-3.5 h-3.5" />
            <span>{isCommitting ? 'Committing...' : `Commit (${changes.length})`}</span>
          </button>
        </form>

        {/* Changed Files List */}
        <div className="text-[11px] uppercase font-semibold text-gray-500 pt-1">
          Changes ({changes.length})
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
          {changes.length === 0 ? (
            <div className="flex items-center space-x-1.5 text-gray-500 italic py-2">
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span>Working tree clean</span>
            </div>
          ) : (
            changes.map((c, idx) => (
              <div
                key={`${c.file}-${idx}`}
                className="p-1.5 bg-[#26282b] rounded border border-[#2b2d30] hover:border-[#393b40] flex items-center justify-between group"
              >
                <div
                  onClick={() => onOpenChangedFile(c.fullPath)}
                  className="flex items-center space-x-1.5 truncate cursor-pointer flex-1"
                  title={c.file}
                >
                  <span
                    className={`font-mono text-[10px] font-bold px-1 rounded ${
                      c.status.includes('M')
                        ? 'text-amber-400 bg-amber-500/10'
                        : c.status.includes('?') || c.status.includes('A')
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : 'text-red-400 bg-red-500/10'
                    }`}
                  >
                    {c.status}
                  </span>
                  <span className="font-mono text-slate-200 truncate">{c.file.split('/').pop()}</span>
                </div>
                <button
                  onClick={() => onViewDiff(c.fullPath)}
                  className="p-1 hover:bg-[#35373c] rounded text-gray-400 hover:text-white shrink-0"
                  title="Inspect Git Diff in Terminal"
                >
                  <FileDiff className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {activeDiff && activeDiff.diff && (
          <div className="max-h-36 overflow-y-auto bg-[#18191c] border border-[#2b2d30] rounded p-2 font-mono text-[10px] space-y-0.5">
            <div className="text-blue-400 font-bold truncate pb-1">{activeDiff.file.split('/').pop()}</div>
            {activeDiff.diff.split('\n').slice(0, 40).map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('+') && !line.startsWith('+++')
                    ? 'text-emerald-400'
                    : line.startsWith('-') && !line.startsWith('---')
                    ? 'text-red-400'
                    : 'text-gray-400'
                }
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
