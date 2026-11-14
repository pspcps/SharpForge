import React, { useMemo, useState } from 'react';
import {
  GitCommitHorizontal,
  List,
  Network,
  ArrowRight,
  Copy,
  Check,
  FileCode2,
  CornerDownLeft,
  Eye,
  EyeOff
} from 'lucide-react';
import type { ExecutionTraceStep, ReturnValueEntry, StackFrame } from '../types/minirider';
import { buildFilteredCallFlowNodes, formatShortFunctionName } from '../utils/callStackFilter';

interface ExecutionFlowGraphProps {
  callStack: StackFrame[];
  returnValues: ReturnValueEntry[];
  traceHistory: ExecutionTraceStep[];
  selectedFrameId: number;
  onSelectFrame: (frame: StackFrame) => void;
  onDecompileFrame?: (frame: StackFrame) => void;
  isDebugging: boolean;
  isPaused: boolean;
}

export const ExecutionFlowGraph: React.FC<ExecutionFlowGraphProps> = ({
  callStack,
  returnValues,
  traceHistory,
  selectedFrameId,
  onSelectFrame,
  onDecompileFrame,
  isDebugging,
  isPaused
}) => {
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [includeExternal, setIncludeExternal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const flowNodes = useMemo(
    () => buildFilteredCallFlowNodes(callStack, returnValues, traceHistory, includeExternal),
    [callStack, returnValues, traceHistory, includeExternal]
  );

  const externalCount = useMemo(
    () => callStack.filter(f => f.isExternal).length,
    [callStack]
  );

  const visibleListFrames = useMemo(
    () => (includeExternal ? callStack : callStack.filter((f, idx) => idx === 0 || !f.isExternal)),
    [callStack, includeExternal]
  );

  const copyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  return (
    <div className="flex flex-col h-full bg-[#18191c] text-[#dfe1e5] text-xs select-none overflow-hidden">
      {/* Header Toolbar */}
      <div className="h-8 bg-[#212327] border-b border-[#2b2d30] px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-[#18191c] border border-[#393b40] rounded p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('graph')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] transition ${
                viewMode === 'graph'
                  ? 'bg-[#3574f0] text-white font-semibold'
                  : 'text-[#868a91] hover:text-white'
              }`}
            >
              <Network className="w-3 h-3" />
              <span>Flow Graph</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] transition ${
                viewMode === 'list'
                  ? 'bg-[#3574f0] text-white font-semibold'
                  : 'text-[#868a91] hover:text-white'
              }`}
            >
              <List className="w-3 h-3" />
              <span>Call Stack ({visibleListFrames.length})</span>
            </button>
          </div>

          <span className="text-[11px] text-gray-400 font-mono hidden sm:inline">
            {flowNodes.length} project node{flowNodes.length === 1 ? '' : 's'}
            {!includeExternal && externalCount > 0 ? ` · ${externalCount} framework hidden` : ''}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIncludeExternal(prev => !prev)}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] transition ${
            includeExternal
              ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
              : 'bg-[#26282b] border-[#393b40] text-gray-400 hover:text-white'
          }`}
          title="Toggle noisy framework/System.* external call frames"
        >
          {includeExternal ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          <span>{includeExternal ? 'Showing External' : 'Project Functions Only'}</span>
        </button>
      </div>

      {/* Main Content Split: Flow/List (left/top) + Maintained Return Values (right) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-[#2b2d30]">
        {/* Left/Center: Graph or Call Stack List */}
        <div className="flex-1 overflow-auto p-3">
          {callStack.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-1.5 py-6">
              <GitCommitHorizontal className="w-6 h-6 text-gray-600" />
              <div className="font-medium text-gray-400">
                {isDebugging && !isPaused
                  ? 'Running — execution flow will appear when a breakpoint is hit'
                  : 'No active call stack'}
              </div>
              <div className="text-[11px] text-gray-500">
                Set a breakpoint and hit an endpoint to inspect the exact function call journey & runtime values.
              </div>
            </div>
          ) : viewMode === 'graph' ? (
            <div className="min-w-max py-2">
              <div className="flex items-stretch space-x-2">
                {flowNodes.map((node, idx) => {
                  const isSelected = selectedFrameId === node.frame.id;
                  const isDll = (node.frame.file || '').toLowerCase().endsWith('.dll');
                  const retVal = node.returnValue;

                  return (
                    <React.Fragment key={node.id}>
                      {/* Frame Node Card */}
                      <div
                        onClick={() => onSelectFrame(node.frame)}
                        className={`w-64 rounded-lg border p-2.5 cursor-pointer transition flex flex-col justify-between shadow-lg ${
                          node.isCurrentBreakpoint
                            ? 'bg-amber-500/10 border-amber-500/70 ring-1 ring-amber-400/30'
                            : isSelected
                            ? 'bg-[#3574f0]/15 border-[#3574f0]'
                            : node.isExternal
                            ? 'bg-[#212327]/70 border-[#393b40]/60 opacity-80'
                            : 'bg-[#26282b] border-[#393b40] hover:border-[#3574f0]/60'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                node.isCurrentBreakpoint
                                  ? 'bg-amber-500 text-black'
                                  : 'bg-[#1e1f22] text-sky-300 border border-[#393b40]'
                              }`}
                            >
                              #{node.orderIndex} {node.isCurrentBreakpoint ? 'PAUSED HERE' : 'CALLER'}
                            </span>
                            <span className="text-[10px] font-mono text-gray-400 truncate">
                              {node.fileName}:{node.line}
                            </span>
                          </div>

                          <div
                            className="font-mono font-semibold text-xs text-white truncate"
                            title={node.frame.name}
                          >
                            {node.shortName}
                          </div>

                          {/* Runtime Values Captured at this Frame */}
                          {node.valuesPreview.length > 0 ? (
                            <div className="bg-[#18191c] border border-[#2b2d30] rounded p-1.5 space-y-1 font-mono text-[10px]">
                              {node.valuesPreview.map((pv, vIdx) => (
                                <div key={`${pv.name}-${vIdx}`} className="flex items-center justify-between gap-1.5">
                                  <span className="text-[#c77dbb] shrink-0">{pv.name}:</span>
                                  <span className="text-[#6aab73] truncate" title={`${pv.value} (${pv.type})`}>
                                    {pv.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-500 italic">
                              Click node to load frame variables
                            </div>
                          )}

                          {/* Captured Return Value on Frame */}
                          {retVal && (
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-1 font-mono text-[10px] flex items-center space-x-1 text-emerald-300">
                              <CornerDownLeft className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                returns {retVal.value}
                              </span>
                            </div>
                          )}
                        </div>

                        {isDll && onDecompileFrame && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDecompileFrame(node.frame);
                            }}
                            className="mt-2 w-full py-1 rounded bg-[#1e1f22] hover:bg-[#3574f0] text-sky-300 hover:text-white border border-[#393b40] text-[10px] font-medium flex items-center justify-center space-x-1 transition"
                          >
                            <FileCode2 className="w-3 h-3" />
                            <span>Decompile .dll</span>
                          </button>
                        )}
                      </div>

                      {/* SVG Flow Connector Arrow between nodes */}
                      {idx < flowNodes.length - 1 && (
                        <div className="flex items-center justify-center shrink-0 px-0.5">
                          <svg width="36" height="32" viewBox="0 0 36 32" className="text-[#3574f0]">
                            <path
                              d="M 2 16 C 12 16, 20 16, 29 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeDasharray={flowNodes[idx + 1]?.isExternal ? '3 3' : undefined}
                            />
                            <polygon points="27,11 35,16 27,21" fill="currentColor" />
                          </svg>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Execution Journey Trail Summary */}
              {traceHistory.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[#2b2d30]">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-[#868a91] mb-2">
                    Recent Execution Timeline ({traceHistory.length} stops)
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 font-mono text-[11px]">
                    {traceHistory.slice(-10).map((step, i) => (
                      <React.Fragment key={step.id}>
                        <span
                          className="px-2 py-0.5 rounded bg-[#26282b] border border-[#393b40] text-slate-200"
                          title={`${step.file}:${step.line} (${step.timestamp})`}
                        >
                          <span className="text-gray-500 mr-1">#{step.stepNumber}</span>
                          {step.shortName}
                          <span className="text-sky-400 ml-1">:{step.line}</span>
                        </span>
                        {i < Math.min(traceHistory.length, 10) - 1 && (
                          <ArrowRight className="w-3 h-3 text-gray-500" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Traditional Detailed Call Stack List */
            <div className="space-y-1 font-mono text-[11px]">
              {visibleListFrames.map((frame, idx) => {
                const isSelected = selectedFrameId === frame.id;
                const isDll = (frame.file || '').toLowerCase().endsWith('.dll');
                return (
                  <div
                    key={frame.id}
                    onClick={() => onSelectFrame(frame)}
                    className={`p-2 rounded border cursor-pointer transition space-y-1 ${
                      isSelected
                        ? 'bg-[#3574f0]/20 border-[#3574f0] text-white'
                        : 'bg-[#26282b] border-[#2b2d30] hover:bg-[#2b2d30] text-[#bcbec4]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="text-[10px] bg-[#18191c] px-1.5 py-0.5 rounded text-gray-400 shrink-0">
                          {idx}
                        </span>
                        <span className="font-semibold truncate" title={frame.name}>
                          {formatShortFunctionName(frame.name)}
                        </span>
                        {frame.isExternal && (
                          <span className="text-[9px] bg-slate-700/50 text-slate-300 px-1 rounded">
                            External
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-[10px] text-gray-400">
                          {frame.file.split('/').pop()}:{frame.line}
                        </span>
                        {isDll && onDecompileFrame && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDecompileFrame(frame);
                            }}
                            className="px-1.5 py-0.5 bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 rounded text-[10px] font-sans"
                          >
                            Decompile
                          </button>
                        )}
                      </div>
                    </div>

                    {((frame.parameters && frame.parameters.length > 0) ||
                      (frame.localsSnapshot && frame.localsSnapshot.length > 0)) && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {[...(frame.parameters || []), ...(frame.localsSnapshot || [])]
                          .slice(0, 5)
                          .map((v, vIdx) => (
                            <span
                              key={`${v.name}-${vIdx}`}
                              className="text-[10px] bg-[#18191c] border border-[#393b40] px-1.5 py-0.5 rounded"
                            >
                              <span className="text-[#c77dbb]">{v.name}</span>=
                              <span className="text-[#6aab73]">{v.value}</span>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Maintained Return Values History */}
        <div className="lg:w-80 shrink-0 flex flex-col bg-[#1e1f22] overflow-hidden">
          <div className="h-7 bg-[#212327] px-3 flex items-center justify-between border-b border-[#2b2d30] shrink-0">
            <div className="flex items-center space-x-1.5 text-[10px] uppercase font-bold text-emerald-300 tracking-wider">
              <CornerDownLeft className="w-3 h-3" />
              <span>Return Values ({returnValues.length})</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 font-mono text-[11px]">
            {returnValues.length === 0 ? (
              <div className="text-gray-500 italic text-[11px] font-sans p-2">
                Step Over / Step Out of a method to capture & preserve its return value details here.
              </div>
            ) : (
              returnValues.map((rv) => (
                <div
                  key={rv.id}
                  className="p-2 rounded bg-[#26282b] border border-emerald-500/25 space-y-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sky-300 font-semibold truncate">{rv.functionName}</span>
                    <button
                      type="button"
                      onClick={() => copyText(rv.id, rv.value)}
                      className="p-0.5 text-gray-400 hover:text-white rounded shrink-0"
                      title="Copy Return Value"
                    >
                      {copiedId === rv.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <div className="text-emerald-400 break-all bg-[#18191c] px-2 py-1 rounded border border-[#2b2d30]">
                    {rv.value}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500 font-sans">
                    <span className="font-mono text-gray-400 truncate">{rv.returnType}</span>
                    <span>{rv.file.split('/').pop()}:{rv.line}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
