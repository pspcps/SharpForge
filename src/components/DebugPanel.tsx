import React, { useState, useEffect } from 'react';
import {
  Play,
  Square,
  Pause,
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  RotateCw,
  CircleDot,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Send,
  Terminal,
  Layers,
  Eye,
  Zap,
  AlertCircle,
  Copy,
  Pencil,
  Sparkles,
  Network,
  Globe,
  Braces,
  FileCode2
} from 'lucide-react';
import {
  Breakpoint,
  ExecutionTraceStep,
  ReturnValueEntry,
  StackFrame,
  VariableItem
} from '../types/minirider';
import { ExecutionFlowGraph } from './ExecutionFlowGraph';

interface DebugPanelProps {
  isDebugging: boolean;
  isPaused: boolean;
  isRealDiskSolution?: boolean;
  missingDebuggerMessage?: string | null;
  onContinue: () => void;
  onPause?: () => void;
  onStepOver: () => void;
  onStepInto: () => void;
  onStepOut: () => void;
  onStop: () => void;
  onRestart: () => void;
  callStack: StackFrame[];
  onSelectFrame: (frame: StackFrame) => void;
  selectedFrameId: number;
  variables: VariableItem[];
  onExpandVariable?: (varPath: string, variablesReference: number) => Promise<void>;
  onSetVariableValue?: (payload: {
    expression: string;
    newValue: string;
    variablesReference?: number;
    name?: string;
  }) => Promise<{ success: boolean; value?: string; error?: string }>;
  onOpenEvaluateModal?: (expression: string, mode?: 'evaluate' | 'setValue') => void;
  watchExpressions: { id: string; expression: string; value: string }[];
  onAddWatch: (expr: string) => void;
  onRemoveWatch: (id: string) => void;
  breakpoints: Breakpoint[];
  onToggleBreakpointEnabled: (id: string) => void;
  onRemoveBreakpoint: (id: string) => void;
  onNavigateToBreakpoint: (bp: Breakpoint) => void;
  debugOutput: string[];
  onSendTestApiRequest: (endpoint: string) => void;
  onInstallNetcoredbg?: () => void;
  returnValues?: ReturnValueEntry[];
  traceHistory?: ExecutionTraceStep[];
  onDecompileFrame?: (frame: StackFrame) => void;
  onCopyAsCurl?: () => void;
  onCopyExpressionAsJson?: (expr: string) => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  isDebugging,
  isPaused,
  isRealDiskSolution = false,
  missingDebuggerMessage,
  onContinue,
  onPause,
  onStepOver,
  onStepInto,
  onStepOut,
  onStop,
  onRestart,
  callStack,
  onSelectFrame,
  selectedFrameId,
  variables,
  onExpandVariable,
  onSetVariableValue,
  onOpenEvaluateModal,
  watchExpressions,
  onAddWatch,
  onRemoveWatch,
  breakpoints,
  onToggleBreakpointEnabled,
  onRemoveBreakpoint,
  onNavigateToBreakpoint,
  debugOutput,
  onSendTestApiRequest,
  onInstallNetcoredbg,
  returnValues = [],
  traceHistory = [],
  onDecompileFrame,
  onCopyAsCurl,
  onCopyExpressionAsJson
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'stack-vars' | 'flow' | 'watch' | 'breakpoints' | 'console'>(
    isRealDiskSolution ? 'console' : 'stack-vars'
  );
  const [newWatchInput, setNewWatchInput] = useState('');
  const [apiEndpoint, setApiEndpoint] = useState('/api/users/42');
  const [expandedVars, setExpandedVars] = useState<Record<string, boolean>>({ this: false, user: true });
  const [editingVarKey, setEditingVarKey] = useState<string | null>(null);
  const [editingVarValue, setEditingVarValue] = useState('');
  const [varContextMenu, setVarContextMenu] = useState<{
    x: number;
    y: number;
    item: VariableItem;
    exprPath: string;
    pathKey: string;
  } | null>(null);

  useEffect(() => {
    if (isPaused) {
      setActiveSubTab('stack-vars');
    } else if (isDebugging && isRealDiskSolution) {
      setActiveSubTab('console');
    }
  }, [isPaused, isDebugging, isRealDiskSolution]);

  const toggleVarExpand = async (item: VariableItem, pathKey: string) => {
    const nextOpen = !expandedVars[pathKey];
    setExpandedVars(prev => ({ ...prev, [pathKey]: nextOpen }));
    if (nextOpen && item.variablesReference && item.variablesReference > 0 && !item.children && onExpandVariable) {
      await onExpandVariable(pathKey, item.variablesReference);
    }
  };

  const handleAddWatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newWatchInput.trim()) {
      onAddWatch(newWatchInput.trim());
      setNewWatchInput('');
    }
  };

  const renderVariableNode = (v: VariableItem, pathKey: string, depth = 0, exprPrefix = '') => {
    const hasChildren = Boolean((v.children && v.children.length > 0) || (v.variablesReference && v.variablesReference > 0));
    const isExpanded = Boolean(expandedVars[pathKey]);
    const exprPath = exprPrefix ? `${exprPrefix}.${v.name}` : v.name;
    const isEditing = editingVarKey === pathKey;

    return (
      <div key={pathKey} className="space-y-0.5">
        <div
          onClick={() => hasChildren && !isEditing && toggleVarExpand(v, pathKey)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setVarContextMenu({
              x: e.clientX,
              y: e.clientY,
              item: v,
              exprPath,
              pathKey
            });
          }}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          className={`group flex items-center justify-between py-0.5 pr-2 rounded hover:bg-[#2b2d30] ${
            hasChildren ? 'cursor-pointer' : ''
          }`}
        >
          <div className="flex items-center space-x-1.5 min-w-0 flex-1">
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="text-[#c77dbb] font-semibold shrink-0">{v.name}</span>
            <span className="text-gray-500">=</span>

            {isEditing ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onSetVariableValue) {
                    await onSetVariableValue({
                      expression: exprPath,
                      newValue: editingVarValue,
                      variablesReference: v.parentVariablesReference,
                      name: v.name
                    });
                  }
                  setEditingVarKey(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center space-x-1 flex-1"
              >
                <input
                  type="text"
                  autoFocus
                  value={editingVarValue}
                  onChange={(e) => setEditingVarValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingVarKey(null);
                    }
                  }}
                  className="bg-[#18191c] border border-amber-500/60 rounded px-1.5 py-0.5 text-white font-mono text-[11px] flex-1 min-w-[80px] focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-1.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-[10px] font-sans"
                >
                  Apply
                </button>
              </form>
            ) : (
              <>
                <span className="text-[#6aab73] truncate">{v.value}</span>
                <span className="text-[10px] text-gray-500 shrink-0">({v.type})</span>
              </>
            )}
          </div>

          {!isEditing && isPaused && (
            <div
              className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 ml-2 shrink-0 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              {onSetVariableValue && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingVarKey(pathKey);
                    setEditingVarValue(v.value);
                  }}
                  className="p-0.5 text-gray-400 hover:text-amber-300 rounded"
                  title="Change Value at Runtime"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onAddWatch(exprPath)}
                className="p-0.5 text-gray-400 hover:text-sky-300 rounded"
                title="Add to Watches"
              >
                <Eye className="w-3 h-3" />
              </button>
              {onOpenEvaluateModal && (
                <button
                  type="button"
                  onClick={() => onOpenEvaluateModal(exprPath, 'evaluate')}
                  className="p-0.5 text-gray-400 hover:text-purple-300 rounded"
                  title="Evaluate Expression..."
                >
                  <Sparkles className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(v.value)}
                className="p-0.5 text-gray-400 hover:text-white rounded"
                title="Copy Value"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {hasChildren && isExpanded && v.children && (
          <div>
            {v.children.map((child, idx) =>
              renderVariableNode(child, `${pathKey}.${child.name}.${idx}`, depth + 1, exprPath)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1f22] text-[#bcbec4] text-xs select-none">
      {/* Debugger Top Stepping Toolbar */}
      <div className="h-9 bg-[#26282b] border-b border-[#1e1f22] px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5">
          {/* Continue (F5) */}
          <button
            onClick={onContinue}
            disabled={!isPaused}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition ${
              isPaused
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'text-gray-500 bg-gray-800/40 cursor-not-allowed'
            }`}
            title="Resume / Continue (F5)"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span className="font-semibold text-[11px]">Resume</span>
          </button>

          {/* Pause (F6) */}
          {onPause && (
            <button
              onClick={onPause}
              disabled={!isDebugging || isPaused}
              className={`p-1.5 rounded transition ${
                isDebugging && !isPaused ? 'hover:bg-[#35373c] text-amber-400' : 'text-gray-600 cursor-not-allowed'
              }`}
              title="Pause Program (F6)"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Step Over (F10) */}
          <button
            onClick={onStepOver}
            disabled={!isPaused}
            className={`p-1.5 rounded transition ${
              isPaused ? 'hover:bg-[#35373c] text-sky-400' : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Step Over (F10)"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          {/* Step Into (F11) */}
          <button
            onClick={onStepInto}
            disabled={!isPaused}
            className={`p-1.5 rounded transition ${
              isPaused ? 'hover:bg-[#35373c] text-indigo-400' : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Step Into (F11)"
          >
            <ArrowDownRight className="w-3.5 h-3.5" />
          </button>

          {/* Step Out (Shift+F11) */}
          <button
            onClick={onStepOut}
            disabled={!isPaused}
            className={`p-1.5 rounded transition ${
              isPaused ? 'hover:bg-[#35373c] text-purple-400' : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Step Out (Shift+F11)"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-[#393b40] mx-1" />

          {/* Restart */}
          <button
            onClick={onRestart}
            className="p-1.5 rounded hover:bg-[#35373c] text-[#dfe1e5] transition"
            title="Restart Debug Session"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* Stop (Shift+F5) */}
          <button
            onClick={onStop}
            className="p-1.5 rounded hover:bg-red-600/20 text-red-400 transition"
            title="Stop Debugging (Shift+F5)"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>

        <div className="flex items-center space-x-2 text-[11px] font-medium">
          {isPaused && onCopyAsCurl && (
            <button
              type="button"
              onClick={onCopyAsCurl}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition"
              title="Generate & Copy HTTP API call at current breakpoint line as cURL"
            >
              <Globe className="w-3 h-3" />
              <span>Copy as cURL</span>
            </button>
          )}
          {isPaused && onOpenEvaluateModal && (
            <button
              type="button"
              onClick={() => onOpenEvaluateModal('', 'evaluate')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 transition"
              title="Evaluate Expression (⌥F8)"
            >
              <Sparkles className="w-3 h-3" />
              <span>Evaluate (⌥F8)</span>
            </button>
          )}
          {missingDebuggerMessage ? (
            <span className="text-amber-300">Debugger missing (netcoredbg)</span>
          ) : isPaused ? (
            <span className="text-amber-300">Paused at Breakpoint</span>
          ) : isDebugging ? (
            <span className="text-emerald-400">Debugging · netcoredbg attached</span>
          ) : (
            <span className="text-gray-500">Debugger idle</span>
          )}
        </div>
      </div>

      {/* Missing netcoredbg helper banner on real disk projects */}
      {missingDebuggerMessage && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-3 py-2 flex items-center justify-between text-[11px]">
          <div className="flex items-center space-x-2 text-amber-200 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">{missingDebuggerMessage}</span>
          </div>
          {onInstallNetcoredbg && (
            <button
              onClick={onInstallNetcoredbg}
              className="ml-3 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded shrink-0 transition"
            >
              Install netcoredbg (brew)
            </button>
          )}
        </div>
      )}

      {/* Sample Solution Interactive API Test Trigger (only shown on virtual sample solution) */}
      {isDebugging && !isRealDiskSolution && (
        <div className="bg-[#212327] border-b border-[#2b2d30] px-3 py-1.5 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2 text-[11px]">
            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-300 font-medium">Sample API Trigger:</span>
            <span className="text-slate-400">Trigger sample controller breakpoint</span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              GET
            </span>
            <input
              type="text"
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              className="bg-[#1e1f22] text-slate-200 border border-[#393b40] rounded px-2 py-0.5 font-mono text-[11px] w-40 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => onSendTestApiRequest(apiEndpoint)}
              className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded text-[11px] font-medium transition"
            >
              <Send className="w-3 h-3" />
              <span>Send Request</span>
            </button>
          </div>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="h-7 bg-[#212327] border-b border-[#2b2d30] flex items-center px-2 space-x-1 shrink-0 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('stack-vars')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] transition whitespace-nowrap ${
            activeSubTab === 'stack-vars' ? 'bg-[#2b2d30] text-[#dfe1e5] font-semibold' : 'text-[#868a91] hover:text-[#dfe1e5]'
          }`}
        >
          <Layers className="w-3 h-3" />
          <span>Frames & Variables</span>
        </button>
        <button
          onClick={() => setActiveSubTab('flow')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] transition whitespace-nowrap ${
            activeSubTab === 'flow' ? 'bg-[#2b2d30] text-[#dfe1e5] font-semibold' : 'text-[#868a91] hover:text-[#dfe1e5]'
          }`}
        >
          <Network className="w-3 h-3 text-sky-400" />
          <span>Call Stack & Flow</span>
          {returnValues.length > 0 && (
            <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded">
              {returnValues.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab('console')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] transition whitespace-nowrap ${
            activeSubTab === 'console' ? 'bg-[#2b2d30] text-[#dfe1e5] font-semibold' : 'text-[#868a91] hover:text-[#dfe1e5]'
          }`}
        >
          <Terminal className="w-3 h-3" />
          <span>Debug Console</span>
        </button>
        <button
          onClick={() => setActiveSubTab('watch')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] transition whitespace-nowrap ${
            activeSubTab === 'watch' ? 'bg-[#2b2d30] text-[#dfe1e5] font-semibold' : 'text-[#868a91] hover:text-[#dfe1e5]'
          }`}
        >
          <Eye className="w-3 h-3" />
          <span>Watches ({watchExpressions.length})</span>
        </button>
        <button
          onClick={() => setActiveSubTab('breakpoints')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] transition whitespace-nowrap ${
            activeSubTab === 'breakpoints' ? 'bg-[#2b2d30] text-[#dfe1e5] font-semibold' : 'text-[#868a91] hover:text-[#dfe1e5]'
          }`}
        >
          <CircleDot className="w-3 h-3 text-red-400" />
          <span>Breakpoints ({breakpoints.length})</span>
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'stack-vars' && (
          <div className="grid grid-cols-1 md:grid-cols-2 h-full divide-y md:divide-y-0 md:divide-x divide-[#2b2d30]">
            {/* Left: Call Stack */}
            <div className="flex flex-col h-full overflow-hidden">
              <div className="h-6 bg-[#212327] px-2.5 flex items-center text-[10px] uppercase font-bold text-[#868a91] tracking-wider border-b border-[#2b2d30] shrink-0">
                Threads & Frames
              </div>
              <div className="flex-1 overflow-y-auto p-1 font-mono text-[11px] space-y-0.5 tabular-nums">
                {callStack.length === 0 ? (
                  <div className="p-3 text-gray-500 italic text-xs font-sans">
                    {isDebugging ? 'Running... hit a breakpoint or click Pause to inspect frames.' : 'No active call stack'}
                  </div>
                ) : (
                  callStack.map(frame => {
                    const isSelected = selectedFrameId === frame.id;
                    const isDll = (frame.file || '').toLowerCase().endsWith('.dll');
                    return (
                      <div
                        key={frame.id}
                        onClick={() => onSelectFrame(frame)}
                        className={`px-2 py-1 rounded cursor-pointer transition flex items-center justify-between ${
                          isSelected ? 'bg-[#3574f0]/25 text-[#dfe1e5]' : 'hover:bg-[#2b2d30] text-[#bcbec4]'
                        }`}
                      >
                        <span className="truncate font-semibold">{frame.name}</span>
                        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                          <span className="text-[10px] text-gray-500">
                            {frame.file.split('/').pop()}:{frame.line}
                          </span>
                          {isDll && onDecompileFrame && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDecompileFrame(frame);
                              }}
                              className="p-0.5 rounded bg-sky-500/15 hover:bg-sky-500/30 text-sky-300"
                              title="Decompile assembly (.dll)"
                            >
                              <FileCode2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right: Variables / Locals */}
            <div className="flex flex-col h-full overflow-hidden">
              <div className="h-6 bg-[#212327] px-2.5 flex items-center text-[10px] uppercase font-bold text-[#868a91] tracking-wider border-b border-[#2b2d30] shrink-0">
                Variables & Locals
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-1">
                {variables.length === 0 ? (
                  <div className="p-3 text-gray-500 italic text-xs font-sans">
                    {isDebugging && !isPaused ? 'Program running...' : 'No variables in current frame'}
                  </div>
                ) : (
                  variables.map((v, i) => renderVariableNode(v, `${v.name}-${i}`, 0))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Dedicated Call Stack & Graphical Execution Flow Tab */}
        {activeSubTab === 'flow' && (
          <ExecutionFlowGraph
            callStack={callStack}
            returnValues={returnValues}
            traceHistory={traceHistory}
            selectedFrameId={selectedFrameId}
            onSelectFrame={onSelectFrame}
            onDecompileFrame={onDecompileFrame}
            isDebugging={isDebugging}
            isPaused={isPaused}
          />
        )}

        {/* Watch Tab */}
        {activeSubTab === 'watch' && (
          <div className="flex flex-col h-full p-2 space-y-2">
            <form onSubmit={handleAddWatchSubmit} className="flex items-center space-x-2">
              <input
                type="text"
                placeholder="Evaluate / watch C# expression (e.g. order.Id, items.Count)..."
                value={newWatchInput}
                onChange={e => setNewWatchInput(e.target.value)}
                className="flex-1 bg-[#18191c] border border-[#393b40] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                type="submit"
                className="bg-[#3574f0] hover:bg-[#2c66db] text-white px-3 py-1 rounded text-xs font-medium flex items-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Evaluate</span>
              </button>
            </form>

            <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px]">
              {watchExpressions.length === 0 ? (
                <div className="text-gray-500 italic p-3 text-xs font-sans">No watch expressions</div>
              ) : (
                watchExpressions.map(w => (
                  <div
                    key={w.id}
                    className="group flex items-center justify-between p-1.5 bg-[#26282b] hover:bg-[#2b2d30] rounded border border-[#2b2d30]"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-sky-300 font-semibold shrink-0">{w.expression}</span>
                      <span className="text-gray-500">=</span>
                      <span className="text-emerald-400 truncate">{w.value}</span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      {isPaused && onOpenEvaluateModal && (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenEvaluateModal(w.expression, 'setValue')}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-amber-300 rounded transition-opacity"
                            title="Change Value at Runtime..."
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenEvaluateModal(w.expression, 'evaluate')}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-purple-300 rounded transition-opacity"
                            title="Inspect / Evaluate..."
                          >
                            <Sparkles className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveWatch(w.id)}
                        className="p-1 text-gray-500 hover:text-red-400 rounded shrink-0"
                        title="Remove Watch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Breakpoints Tab */}
        {activeSubTab === 'breakpoints' && (
          <div className="flex-1 h-full overflow-y-auto p-2 space-y-1">
            {breakpoints.length === 0 ? (
              <div className="text-gray-500 italic p-3 text-xs">
                No breakpoints set. Click the editor gutter or press F9 to toggle a breakpoint.
              </div>
            ) : (
              breakpoints.map(bp => {
                const parts = bp.filePath.replace(/\\/g, '/').split('/');
                const fileName = parts.pop() || bp.filePath;
                const folderHint = parts.slice(-2).join('/');
                return (
                  <div
                    key={bp.id}
                    onClick={() => onNavigateToBreakpoint(bp)}
                    title={`Open ${bp.filePath} at line ${bp.line}`}
                    className="flex items-center justify-between p-2 rounded bg-[#26282b] hover:bg-[#2b2d30] border border-[#2b2d30] cursor-pointer transition"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={bp.enabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleBreakpointEnabled(bp.id);
                        }}
                        className="rounded bg-[#1e1f22] border-[#393b40] text-blue-600 focus:ring-0 shrink-0"
                      />
                      <CircleDot className={`w-3.5 h-3.5 shrink-0 ${bp.enabled ? 'text-red-500 fill-red-500/40' : 'text-gray-500'}`} />
                      <span className="font-mono text-slate-200 font-semibold shrink-0">
                        {fileName}:{bp.line}
                      </span>
                      {folderHint && (
                        <span className="font-mono text-[10px] text-gray-500 truncate">
                          {folderHint}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveBreakpoint(bp.id);
                      }}
                      className="p-1 text-gray-500 hover:text-red-400 rounded shrink-0"
                      title="Remove Breakpoint"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Debug Console Tab */}
        {activeSubTab === 'console' && (
          <div className="flex-1 h-full overflow-y-auto p-3 font-mono text-[11px] space-y-0.5 bg-[#18191c]">
            {debugOutput.length === 0 ? (
              <div className="text-gray-500 italic">Debug console output will stream here...</div>
            ) : (
              debugOutput.map((line, idx) => (
                <div
                  key={idx}
                  className={`whitespace-pre-wrap ${
                    line.includes('[ERROR]') || line.toLowerCase().includes('fail:')
                      ? 'text-red-400'
                      : line.includes('Now listening on:')
                      ? 'text-emerald-400 font-semibold'
                      : 'text-slate-300'
                  }`}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Variable Right-Click Context Menu */}
      {varContextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setVarContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setVarContextMenu(null);
          }}
        >
          <div
            style={{
              top: Math.max(8, Math.min(varContextMenu.y, window.innerHeight - 190)),
              left: Math.max(8, Math.min(varContextMenu.x, window.innerWidth - 220))
            }}
            onClick={(e) => e.stopPropagation()}
            className="absolute bg-[#26282b] border border-[#393b40] rounded-lg shadow-2xl py-1 w-52 text-xs text-[#dfe1e5]"
          >
            <div className="px-3 py-1 text-[10px] font-mono text-gray-400 border-b border-[#393b40] truncate">
              {varContextMenu.exprPath}
            </div>
            {onSetVariableValue && (
              <button
                type="button"
                onClick={() => {
                  setEditingVarKey(varContextMenu.pathKey);
                  setEditingVarValue(varContextMenu.item.value);
                  setVarContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2 text-amber-300"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Set Value...</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onAddWatch(varContextMenu.exprPath);
                setVarContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2 text-sky-300"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Add to Watches</span>
            </button>
            {onOpenEvaluateModal && (
              <button
                type="button"
                onClick={() => {
                  onOpenEvaluateModal(varContextMenu.exprPath, 'evaluate');
                  setVarContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2 text-purple-300"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Evaluate Expression...</span>
              </button>
            )}
            {onCopyExpressionAsJson && (
              <button
                type="button"
                onClick={() => {
                  onCopyExpressionAsJson(varContextMenu.exprPath);
                  setVarContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2 text-emerald-300"
              >
                <Braces className="w-3.5 h-3.5" />
                <span>Copy as JSON Stringify</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(varContextMenu.item.value);
                setVarContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Value</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
