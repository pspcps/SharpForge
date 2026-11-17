import React, { useState, useRef, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  Hammer,
  Bug,
  AlertTriangle,
  X,
  Trash2,
  ExternalLink,
  Code,
  CircleDot,
  AlertCircle,
  Network,
  Server
} from 'lucide-react';
import {
  ActivePortProcess,
  Breakpoint,
  DiagnosticItem,
  ExecutionTraceStep,
  ReferenceItem,
  ReturnValueEntry,
  StackFrame
} from '../types/minirider';
import { ExecutionFlowGraph } from './ExecutionFlowGraph';
import { TerminalWorkspace } from './TerminalWorkspace';
import { PortsPanel } from './PortsPanel';

interface BottomPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'terminal' | 'build' | 'debug' | 'flow' | 'ports' | 'problems' | 'references' | 'breakpoints';
  onSelectTab: (tab: 'terminal' | 'build' | 'debug' | 'flow' | 'ports' | 'problems' | 'references' | 'breakpoints') => void;
  solutionName?: string;
  workspaceDirectory?: string;
  terminalLogs: string[];
  buildLogs: string[];
  debugLogs: string[];
  diagnostics: DiagnosticItem[];
  references: ReferenceItem[];
  breakpoints?: Breakpoint[];
  callStack?: StackFrame[];
  returnValues?: ReturnValueEntry[];
  traceHistory?: ExecutionTraceStep[];
  selectedFrameId?: number;
  onSelectFrame?: (frame: StackFrame) => void;
  onDecompileFrame?: (frame: StackFrame) => void;
  missingDebuggerMessage?: string | null;
  onInstallNetcoredbg?: () => void;
  onNavigateToBreakpoint?: (bp: Breakpoint) => void;
  onToggleBreakpointEnabled?: (id: string) => void;
  onRemoveBreakpoint?: (id: string) => void;
  onExecuteTerminalCommand: (command: string) => void;
  onNavigateToDiagnostic: (diag: DiagnosticItem) => void;
  onNavigateToReference: (ref: ReferenceItem) => void;
  onClearTerminal: () => void;
  activePorts?: ActivePortProcess[];
  isScanningPorts?: boolean;
  configuredPort?: number | null;
  configuredUrl?: string | null;
  configuredPortSource?: string;
  onRefreshPorts?: () => void;
  onKillPortProcess?: (options: { pid?: number; port?: number; force?: boolean }) => Promise<void>;
  onOpenPortUrl?: (url: string) => void;
  onSelectCustomPort?: (port: number) => void;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  solutionName = 'Cairn IDE',
  workspaceDirectory,
  terminalLogs,
  buildLogs,
  debugLogs,
  diagnostics,
  references,
  breakpoints = [],
  callStack = [],
  returnValues = [],
  traceHistory = [],
  selectedFrameId = 1,
  onSelectFrame,
  onDecompileFrame,
  missingDebuggerMessage,
  onInstallNetcoredbg,
  onNavigateToBreakpoint,
  onToggleBreakpointEnabled,
  onRemoveBreakpoint,
  onExecuteTerminalCommand,
  onNavigateToDiagnostic,
  onNavigateToReference,
  onClearTerminal,
  activePorts = [],
  isScanningPorts = false,
  configuredPort,
  configuredUrl,
  configuredPortSource,
  onRefreshPorts,
  onKillPortProcess,
  onOpenPortUrl,
  onSelectCustomPort
}) => {
  const [terminalInput, setTerminalInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs, buildLogs, debugLogs]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = terminalInput.trim();
    if (!cmd) return;

    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIndex(-1);
    onExecuteTerminalCommand(cmd);
    setTerminalInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIdx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIdx);
        setTerminalInput(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const nextIdx = historyIndex + 1;
        if (nextIdx >= commandHistory.length) {
          setHistoryIndex(-1);
          setTerminalInput('');
        } else {
          setHistoryIndex(nextIdx);
          setTerminalInput(commandHistory[nextIdx]);
        }
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="h-full bg-[#1e1f22] flex flex-col text-xs select-none">
      {/* Panel Tab Bar */}
      <div className="h-8 bg-[#26282b] border-b border-[#1e1f22] px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1 overflow-x-auto">
          <button
            onClick={() => onSelectTab('terminal')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'terminal' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => onSelectTab('build')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'build' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <Hammer className="w-3.5 h-3.5 text-amber-400" />
            <span>Build Output</span>
          </button>

          <button
            onClick={() => onSelectTab('debug')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'debug' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <Bug className="w-3.5 h-3.5 text-purple-400" />
            <span>Debug Console</span>
          </button>

          <button
            onClick={() => onSelectTab('flow')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'flow' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-sky-400" />
            <span>Call Stack & Flow</span>
          </button>

          <button
            onClick={() => onSelectTab('breakpoints')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'breakpoints' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <CircleDot className="w-3.5 h-3.5 text-red-400" />
            <span>Breakpoints ({breakpoints.length})</span>
          </button>

          <button
            onClick={() => {
              onSelectTab('ports');
              onRefreshPorts?.();
            }}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'ports' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <span>Ports{activePorts.length > 0 ? ` (${activePorts.length})` : ''}</span>
          </button>

          <button
            onClick={() => onSelectTab('problems')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
              activeTab === 'problems' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
            <span>Problems ({diagnostics.length})</span>
          </button>

          {references.length > 0 && (
            <button
              onClick={() => onSelectTab('references')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition whitespace-nowrap ${
                activeTab === 'references' ? 'bg-[#1e1f22] text-white font-medium border-t-2 border-[#3574f0]' : 'text-[#868a91] hover:text-[#dfe1e5]'
              }`}
            >
              <Code className="w-3.5 h-3.5 text-sky-400" />
              <span>Usages ({references.length})</span>
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {activeTab === 'terminal' && (
            <button
              onClick={onClearTerminal}
              className="p-1 hover:bg-[#35373c] text-gray-400 hover:text-white rounded"
              title="Clear Terminal Output"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#35373c] text-gray-400 hover:text-white rounded"
            title="Close Panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Panel Contents */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {/* Terminal Tab */}
        {window.electronAPI?.terminalList && workspaceDirectory && <div className={activeTab === 'terminal' ? 'h-full min-h-0' : 'hidden'}><TerminalWorkspace key={workspaceDirectory} cwd={workspaceDirectory} /></div>}
        {activeTab === 'terminal' && !(window.electronAPI?.terminalList && workspaceDirectory) && (
          <div className="flex flex-col h-full bg-[#18191c] font-mono text-[11px] p-2">
            <div className="flex-1 overflow-y-auto space-y-0.5">
              <div className="text-gray-500 pb-1">
                Cairn IDE Terminal ({solutionName}) · Type &apos;dotnet --help&apos; or any shell command
              </div>
              {terminalLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`whitespace-pre-wrap ${
                    log.includes('Now listening on:')
                      ? 'text-emerald-400 font-semibold'
                      : log.includes('[Error]') || log.includes('error ')
                      ? 'text-red-400'
                      : 'text-slate-300'
                  }`}
                >
                  {log}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>

            {/* Terminal Prompt */}
            <form onSubmit={handleCommandSubmit} className="flex items-center space-x-2 pt-1 border-t border-[#2b2d30] mt-1">
              <span className="text-emerald-400 font-bold shrink-0">{solutionName.replace(/\.(sln|slnx)$/i, '')}$</span>
              <input
                type="text"
                value={terminalInput}
                onChange={e => setTerminalInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="dotnet build, dotnet run, dotnet test, git status..."
                className="flex-1 bg-transparent text-white focus:outline-none"
              />
            </form>
          </div>
        )}

        {/* Build Tab */}
        {activeTab === 'build' && (
          <div className="flex flex-col h-full bg-[#18191c] font-mono text-[11px] p-3 overflow-y-auto space-y-1">
            {buildLogs.length === 0 ? (
              <div className="text-gray-500 italic">No build output. Press &apos;Build&apos; in toolbar to build solution.</div>
            ) : (
              buildLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`whitespace-pre-wrap ${
                    log.includes('error') ? 'text-red-400 font-bold' : log.includes('Build succeeded') ? 'text-emerald-400 font-bold' : 'text-slate-300'
                  }`}
                >
                  {log}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        )}

        {/* Debug Console Tab */}
        {activeTab === 'debug' && (
          <div className="flex flex-col h-full bg-[#18191c] font-mono text-[11px] overflow-hidden">
            {missingDebuggerMessage && (
              <div className="bg-amber-500/10 border-b border-amber-500/30 px-3 py-2 flex items-center justify-between text-[11px] font-sans shrink-0">
                <div className="flex items-center space-x-2 text-amber-200 min-w-0">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">{missingDebuggerMessage}</span>
                </div>
                {onInstallNetcoredbg && (
                  <button
                    onClick={onInstallNetcoredbg}
                    className="ml-3 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded shrink-0 transition"
                  >
                    Install netcoredbg
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 p-3 overflow-y-auto space-y-1">
              {debugLogs.length === 0 ? (
                <div className="text-gray-500 italic">Debug console idle. Start debugging (F5) to view DAP messages.</div>
              ) : (
                debugLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`whitespace-pre-wrap ${
                      log.includes('[ERROR]') || log.toLowerCase().includes('error ')
                        ? 'text-red-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        )}

        {/* Call Stack & Graphical Execution Flow Tab */}
        {activeTab === 'flow' && (
          <ExecutionFlowGraph
            callStack={callStack}
            returnValues={returnValues}
            traceHistory={traceHistory}
            selectedFrameId={selectedFrameId}
            onSelectFrame={(f) => onSelectFrame?.(f)}
            onDecompileFrame={onDecompileFrame}
            isDebugging={false}
            isPaused={false}
          />
        )}

        {/* Active Listening Ports & Service Killer Tab */}
        {activeTab === 'ports' && (
          <PortsPanel
            ports={activePorts}
            isLoading={isScanningPorts}
            configuredPort={configuredPort}
            configuredUrl={configuredUrl}
            configuredSource={configuredPortSource}
            isElectron={Boolean(window.electronAPI?.isElectron)}
            onRefresh={() => onRefreshPorts?.()}
            onKillProcess={async (opts) => {
              if (onKillPortProcess) await onKillPortProcess(opts);
            }}
            onOpenUrl={onOpenPortUrl}
            onUsePort={onSelectCustomPort}
          />
        )}

        {/* Breakpoints Tab (accessible anytime, even when not paused) */}
        {activeTab === 'breakpoints' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {breakpoints.length === 0 ? (
              <div className="text-gray-500 italic p-3 text-xs">
                No breakpoints set. Click any line gutter or press F9 to add a breakpoint.
              </div>
            ) : (
              breakpoints.map(bp => {
                const parts = bp.filePath.replace(/\\/g, '/').split('/');
                const fileName = parts.pop() || bp.filePath;
                const folderHint = parts.slice(-2).join('/');
                return (
                  <div
                    key={bp.id}
                    onClick={() => onNavigateToBreakpoint?.(bp)}
                    title={`Jump to ${bp.filePath}:${bp.line}`}
                    className="flex items-center justify-between p-2 rounded bg-[#26282b] hover:bg-[#2b2d30] border border-[#2b2d30] cursor-pointer transition"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {onToggleBreakpointEnabled && (
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
                      )}
                      <CircleDot className={`w-3.5 h-3.5 shrink-0 ${bp.enabled ? 'text-red-500 fill-red-500/40' : 'text-gray-500'}`} />
                      <span className="font-mono text-slate-200 font-semibold shrink-0">
                        {fileName}:{bp.line}
                      </span>
                      {folderHint && (
                        <span className="font-mono text-[10px] text-gray-500 truncate">{folderHint}</span>
                      )}
                    </div>

                    {onRemoveBreakpoint && (
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
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Problems / Diagnostics Tab */}
        {activeTab === 'problems' && (
          <div className="flex-1 overflow-y-auto p-2">
            {diagnostics.length === 0 ? (
              <div className="p-4 text-center text-gray-500 italic">No syntax errors or warnings reported by MSBuild/Roslyn</div>
            ) : (
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="border-b border-[#2b2d30] text-[#868a91] text-[10px] uppercase">
                    <th className="py-1 px-2">Code</th>
                    <th className="py-1 px-2">Description</th>
                    <th className="py-1 px-2">File</th>
                    <th className="py-1 px-2">Line</th>
                    <th className="py-1 px-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.map(diag => (
                    <tr
                      key={diag.id}
                      onClick={() => onNavigateToDiagnostic(diag)}
                      className="border-b border-[#26282b] hover:bg-[#2b2d30] cursor-pointer text-[#bcbec4]"
                    >
                      <td className="py-1.5 px-2 font-mono font-semibold text-amber-400">{diag.code}</td>
                      <td className="py-1.5 px-2 text-slate-200">{diag.message}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{diag.file.split('/').pop()}</td>
                      <td className="py-1.5 px-2 font-mono">{diag.line}:{diag.column}</td>
                      <td className="py-1.5 px-2 text-[10px] text-gray-500">{diag.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* References Tab */}
        {activeTab === 'references' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="text-[11px] text-[#868a91] px-2 py-1 font-semibold uppercase">
              Found {references.length} Usages across solution
            </div>
            {references.map((ref, idx) => (
              <div
                key={idx}
                onClick={() => onNavigateToReference(ref)}
                className="p-2 rounded bg-[#26282b] hover:bg-[#2b2d30] cursor-pointer flex items-center justify-between border border-[#2b2d30]"
              >
                <div className="space-y-0.5">
                  <div className="font-mono text-slate-200 font-medium">
                    {ref.file.split('/').pop()}:{ref.line}
                  </div>
                  <div className="font-mono text-xs text-emerald-400 bg-[#1e1f22] px-2 py-0.5 rounded border border-[#393b40]">
                    {ref.preview}
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
