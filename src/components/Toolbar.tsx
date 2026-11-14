import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Bug,
  Square,
  RotateCw,
  Hammer,
  Settings as SettingsIcon,
  PackageCheck,
  Search,
  FolderOpen,
  Cpu,
  ArrowLeft,
  ArrowRight,
  Pause,
  ArrowDownRight,
  Globe,
  FolderTree,
  Blocks,
  Server,
  History,
  Trash2,
  X
} from 'lucide-react';
import { SolutionFile, ProjectItem, RecentSolutionEntry } from '../types/minirider';

interface ToolbarProps {
  solutions: SolutionFile[];
  currentSolution: SolutionFile;
  onSelectSolution: (solution: SolutionFile) => void;
  selectedProject: ProjectItem;
  onSelectProject: (project: ProjectItem) => void;
  buildConfig: 'Debug' | 'Release';
  onSelectBuildConfig: (config: 'Debug' | 'Release') => void;
  isBuilding: boolean;
  isRunning: boolean;
  isDebugging: boolean;
  isPaused?: boolean;
  runningUrl?: string | null;
  onBuild: () => void;
  onRun: () => void;
  onDebug: () => void;
  onStop: () => void;
  onPauseDebug?: () => void;
  onContinueDebug?: () => void;
  onStepOver?: () => void;
  onStepInto?: () => void;
  onOpenQuickOpen: () => void;
  onOpenSetupModal: () => void;
  onOpenSettings: () => void;
  onOpenRunningUrl?: (url: string) => void;
  onOpenSolutionFile: () => void;
  onOpenFolder?: () => void;
  activeSdk?: string;
  detectedSdks?: string[];
  onSelectSdk?: (sdk: string) => void;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onOpenExtensions?: () => void;
  configuredPort?: number | null;
  isCustomPort?: boolean;
  isPortInUse?: boolean;
  onOpenPortManager?: () => void;
  recentSolutions?: RecentSolutionEntry[];
  onOpenRecentSolution?: (entry: RecentSolutionEntry) => void;
  onRemoveRecentSolution?: (path: string) => void;
  onClearRecentSolutions?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  solutions,
  currentSolution,
  onSelectSolution,
  selectedProject,
  onSelectProject,
  buildConfig,
  onSelectBuildConfig,
  isBuilding,
  isRunning,
  isDebugging,
  isPaused = false,
  runningUrl,
  onBuild,
  onRun,
  onDebug,
  onStop,
  onPauseDebug,
  onContinueDebug,
  onStepOver,
  onStepInto,
  onOpenQuickOpen,
  onOpenSetupModal,
  onOpenSettings,
  onOpenRunningUrl,
  onOpenSolutionFile,
  onOpenFolder,
  activeSdk = '.NET 10.0',
  detectedSdks = ['10.0.302', '8.0.417', '7.0.410', '6.0.428'],
  onSelectSdk,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack = false,
  canNavigateForward = false,
  onOpenExtensions,
  configuredPort,
  isCustomPort = false,
  isPortInUse = false,
  onOpenPortManager,
  recentSolutions = [],
  onOpenRecentSolution,
  onRemoveRecentSolution,
  onClearRecentSolutions
}) => {
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const [isRecentMenuOpen, setIsRecentMenuOpen] = useState(false);
  const recentMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRecentMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (recentMenuRef.current && !recentMenuRef.current.contains(e.target as Node)) {
        setIsRecentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isRecentMenuOpen]);

  const formatRelativeTime = (iso: string) => {
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch {
      return '';
    }
  };

  return (
    <header
      className={`sharpforge-drag-region h-11 bg-[#2b2d30] border-b border-[#1e1f22] select-none flex items-center justify-between pr-3 text-[#dfe1e5] text-xs font-sans shrink-0 ${
        isElectron ? 'pl-[76px]' : 'pl-3'
      }`}
    >
      {/* Left: Navigation Arrows, Brand, Solution Picker & Open Button */}
      <div className="sharpforge-no-drag flex items-center space-x-2 min-w-0">
        {/* Back and Forward Navigation Buttons */}
        <div className="flex items-center space-x-0.5 bg-[#1e1f22] border border-[#393b40] rounded p-0.5">
          <button
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className={`p-1 rounded transition ${
              canNavigateBack
                ? 'text-[#dfe1e5] hover:bg-[#35373c] hover:text-white cursor-pointer'
                : 'text-[#4e5157] cursor-not-allowed opacity-50'
            }`}
            title="Navigate Back (⌥⌘← or ⌘[)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className={`p-1 rounded transition ${
              canNavigateForward
                ? 'text-[#dfe1e5] hover:bg-[#35373c] hover:text-white cursor-pointer'
                : 'text-[#4e5157] cursor-not-allowed opacity-50'
            }`}
            title="Navigate Forward (⌥⌘→ or ⌘])"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* SharpForge Brand */}
        <div className="flex items-center space-x-1.5 pl-1 border-l border-[#393b40] shrink-0">
          <img src="./icon.png" alt="SharpForge" className="w-5 h-5 rounded object-cover" />
          <span className="hidden sm:inline font-semibold tracking-tight text-[#dfe1e5] whitespace-nowrap">
            SharpForge
          </span>
        </div>

        {/* Solution dropdown */}
        <div className="flex items-center space-x-1">
          <select
            value={currentSolution.path}
            onChange={(e) => {
              const found = solutions.find(s => s.path === e.target.value);
              if (found) onSelectSolution(found);
            }}
            className="bg-[#1e1f22] text-[#dfe1e5] border border-[#393b40] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#3574f0] cursor-pointer max-w-[165px] truncate"
            title={currentSolution.path}
          >
            {solutions.map(sol => (
              <option key={sol.path} value={sol.path}>
                {sol.name}
              </option>
            ))}
          </select>

          <button
            onClick={onOpenSolutionFile}
            className="flex items-center space-x-1 px-2 py-1 bg-[#35373c] hover:bg-[#43454b] text-[#dfe1e5] border border-[#4e5157] rounded text-xs transition whitespace-nowrap shrink-0"
            title="Open Solution .sln or .slnx (⌘O)"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-medium">Open .sln</span>
          </button>

          {onOpenFolder && (
            <button
              onClick={onOpenFolder}
              className="flex items-center space-x-1 px-2 py-1 bg-[#35373c] hover:bg-[#43454b] text-[#dfe1e5] border border-[#4e5157] rounded text-xs transition whitespace-nowrap shrink-0"
              title="Open .NET Solution Folder (⌘⇧O)"
            >
              <FolderTree className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden lg:inline font-medium">Folder</span>
            </button>
          )}

          {/* Recent Solutions Dropdown */}
          {onOpenRecentSolution && (
            <div ref={recentMenuRef} className="relative shrink-0">
              <button
                onClick={() => setIsRecentMenuOpen((v) => !v)}
                className={`flex items-center space-x-1 px-2 py-1 border rounded text-xs transition whitespace-nowrap ${
                  isRecentMenuOpen
                    ? 'bg-[#3574f0] border-[#3574f0] text-white'
                    : 'bg-[#35373c] hover:bg-[#43454b] text-[#dfe1e5] border-[#4e5157]'
                }`}
                title="Recently Opened Solutions (.sln / .slnx)"
              >
                <History className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline font-medium">Recent</span>
                {recentSolutions.length > 0 && (
                  <span className="px-1 rounded bg-[#1e1f22]/70 text-[10px] font-mono text-gray-300">
                    {recentSolutions.length}
                  </span>
                )}
              </button>

              {isRecentMenuOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-80 bg-[#26282b] border border-[#393b40] rounded-lg shadow-2xl z-50 overflow-hidden">
                  <div className="px-3 py-2 bg-[#2b2d30] border-b border-[#393b40] flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-white">Recent Solutions</span>
                    {recentSolutions.length > 0 && onClearRecentSolutions && (
                      <button
                        onClick={() => {
                          onClearRecentSolutions();
                          setIsRecentMenuOpen(false);
                        }}
                        className="text-[10px] text-gray-400 hover:text-red-400 flex items-center space-x-1"
                        title="Clear recent history"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-[#2f3136]">
                    {recentSolutions.length === 0 ? (
                      <div className="p-4 text-center text-gray-500 text-[11px] italic">
                        No recent `.sln` projects recorded yet. Open a solution or folder and SharpForge will remember it automatically.
                      </div>
                    ) : (
                      recentSolutions.map((entry) => {
                        const isActive = entry.path === currentSolution.path;
                        const isMissing = entry.exists === false;
                        return (
                          <div
                            key={entry.path}
                            onClick={() => {
                              setIsRecentMenuOpen(false);
                              onOpenRecentSolution(entry);
                            }}
                            className={`px-3 py-2 cursor-pointer transition flex items-start justify-between group ${
                              isActive
                                ? 'bg-[#3574f0]/20 hover:bg-[#3574f0]/25'
                                : 'hover:bg-[#35373c]'
                            }`}
                          >
                            <div className="min-w-0 pr-2 space-y-0.5">
                              <div className="flex items-center space-x-1.5">
                                <span className={`font-semibold truncate ${isMissing ? 'text-gray-500 line-through' : 'text-slate-100'}`}>
                                  {entry.name}
                                </span>
                                {isActive && (
                                  <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono">
                                    OPEN
                                  </span>
                                )}
                                {isMissing && (
                                  <span className="px-1 py-0.2 rounded bg-red-500/20 text-red-300 text-[9px] font-mono">
                                    MISSING
                                  </span>
                                )}
                                {typeof entry.projectCount === 'number' && entry.projectCount > 0 && (
                                  <span className="text-[10px] text-gray-500 font-mono">
                                    {entry.projectCount}p
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-gray-400 truncate" title={entry.path}>
                                {entry.path}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                {formatRelativeTime(entry.lastOpened)}
                              </div>
                            </div>

                            {onRemoveRecentSolution && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveRecentSolution(entry.path);
                                }}
                                className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition shrink-0"
                                title="Remove from recent solutions"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* .NET SDK Selector (.NET 10, 9, 8, 7, 6) */}
        <div className="hidden xl:flex items-center space-x-1 bg-[#1e1f22] border border-[#393b40] rounded px-2 py-0.5 shrink-0">
          <Cpu className="w-3 h-3 text-sky-400" />
          <select
            value={activeSdk}
            onChange={(e) => onSelectSdk && onSelectSdk(e.target.value)}
            className="bg-transparent text-[#bcbec4] text-xs focus:outline-none cursor-pointer"
            title="Active .NET SDK"
          >
            <option value=".NET 10.0" className="bg-[#1e1f22]">.NET 10.0</option>
            <option value=".NET 9.0" className="bg-[#1e1f22]">.NET 9.0</option>
            <option value=".NET 8.0" className="bg-[#1e1f22]">.NET 8.0 (LTS)</option>
            <option value=".NET 7.0" className="bg-[#1e1f22]">.NET 7.0</option>
            <option value=".NET 6.0" className="bg-[#1e1f22]">.NET 6.0 (LTS)</option>
            {detectedSdks
              .filter(s => !['10.0', '9.0', '8.0', '7.0', '6.0'].some(v => s.startsWith(v)))
              .map(sdk => (
                <option key={sdk} value={sdk} className="bg-[#1e1f22]">SDK {sdk}</option>
              ))}
          </select>
        </div>
      </div>

      {/* Center: Run/Debug Execution Widget */}
      <div className="sharpforge-no-drag flex items-center space-x-1.5 bg-[#232528] border border-[#393b40] rounded-md px-1.5 py-0.5">
        {/* Startup Project Dropdown */}
        <select
          value={selectedProject?.name || ''}
          onChange={(e) => {
            const proj = currentSolution.projects.find(p => p.name === e.target.value);
            if (proj) onSelectProject(proj);
          }}
          className="bg-transparent text-[#dfe1e5] text-xs font-medium focus:outline-none cursor-pointer px-1 max-w-[190px] truncate"
          title="Startup Project"
        >
          {currentSolution.projects.map(p => (
            <option key={p.id} value={p.name} className="bg-[#1e1f22]">
              {p.name} [{p.projectType === 'webapi' ? 'Web' : p.projectType === 'console' ? 'Exe' : p.targetFramework}]
            </option>
          ))}
        </select>

        {/* Configuration */}
        <select
          value={buildConfig}
          onChange={(e) => onSelectBuildConfig(e.target.value as 'Debug' | 'Release')}
          className="bg-[#1e1f22] text-[#bcbec4] border border-[#393b40] rounded px-1.5 py-0.5 text-[11px] focus:outline-none cursor-pointer"
        >
          <option value="Debug">Debug</option>
          <option value="Release">Release</option>
        </select>

        {/* Run / Debug Port Pill */}
        {onOpenPortManager && (
          <button
            onClick={onOpenPortManager}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] font-mono transition shrink-0 ${
              isPortInUse && !isRunning && !isDebugging
                ? 'bg-red-500/15 border-red-500/45 text-red-300 hover:bg-red-500/25'
                : isCustomPort
                ? 'bg-[#3574f0]/20 border-[#3574f0]/50 text-sky-300 hover:bg-[#3574f0]/30'
                : 'bg-[#1e1f22] border-[#393b40] text-[#bcbec4] hover:text-white hover:border-[#4e5157]'
            }`}
            title={
              isPortInUse && !isRunning && !isDebugging
                ? `Port :${configuredPort} is currently in use! Click to change port or kill occupying service.`
                : `Configure Run/Debug Port (${configuredPort ? `:${configuredPort}` : 'Auto'}) & Manage Running Ports`
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isPortInUse && !isRunning && !isDebugging
                  ? 'bg-red-400 animate-pulse'
                  : isRunning || isDebugging
                  ? 'bg-emerald-400'
                  : isCustomPort
                  ? 'bg-sky-400'
                  : 'bg-gray-500'
              }`}
            />
            <Server className="w-3 h-3 opacity-80" />
            <span>{configuredPort ? `:${configuredPort}` : 'Port'}</span>
          </button>
        )}

        <div className="w-px h-4 bg-[#393b40] mx-0.5" />

        {/* Build */}
        <button
          onClick={onBuild}
          disabled={isBuilding}
          className={`flex items-center space-x-1 px-2 py-1 rounded transition whitespace-nowrap shrink-0 ${
            isBuilding ? 'bg-[#3574f0]/20 text-[#3574f0]' : 'hover:bg-[#35373c] text-[#dfe1e5]'
          }`}
          title="Build Solution (⌘⇧B)"
        >
          <Hammer className={`w-3.5 h-3.5 ${isBuilding ? 'animate-spin' : 'text-amber-400'}`} />
          <span className="hidden md:inline font-medium">Build</span>
        </button>

        {/* Run / Debug / Live Controls */}
        {isRunning || isDebugging ? (
          <div className="flex items-center space-x-1">
            {isDebugging && (
              <>
                {isPaused ? (
                  <button
                    onClick={onContinueDebug}
                    className="p-1 rounded bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 transition"
                    title="Continue (F5)"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={onPauseDebug}
                    className="p-1 rounded hover:bg-[#35373c] text-amber-400 transition"
                    title="Pause (F6)"
                  >
                    <Pause className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={onStepOver}
                  disabled={!isPaused}
                  className={`p-1 rounded transition ${isPaused ? 'hover:bg-[#35373c] text-sky-400' : 'text-gray-600 cursor-not-allowed'}`}
                  title="Step Over (F10)"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onStepInto}
                  disabled={!isPaused}
                  className={`p-1 rounded transition ${isPaused ? 'hover:bg-[#35373c] text-indigo-400' : 'text-gray-600 cursor-not-allowed'}`}
                  title="Step Into (F11)"
                >
                  <ArrowDownRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            <button
              onClick={isDebugging ? onDebug : onRun}
              className="p-1 rounded hover:bg-[#35373c] text-[#bcbec4] hover:text-white transition"
              title={isDebugging ? 'Restart Debugging' : 'Restart Application'}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onStop}
              className="flex items-center space-x-1 px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/35 rounded transition whitespace-nowrap shrink-0"
              title="Stop (⇧F5)"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="font-medium">Stop</span>
            </button>

            {runningUrl && (
              <button
                onClick={() => onOpenRunningUrl?.(runningUrl)}
                className="hidden lg:flex items-center space-x-1 px-2 py-0.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-mono transition"
                title={`Listening on ${runningUrl}`}
              >
                <Globe className="w-3 h-3" />
                <span>{runningUrl.replace(/^https?:\/\//, '')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center space-x-1">
            <button
              onClick={onRun}
              className="flex items-center space-x-1 px-2.5 py-1 hover:bg-[#369651]/25 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded font-medium transition whitespace-nowrap shrink-0"
              title="Run Startup Project (⌘R)"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run</span>
            </button>

            <button
              onClick={onDebug}
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#3574f0] hover:bg-[#2c66db] text-white rounded font-medium transition whitespace-nowrap shrink-0"
              title="Debug Startup Project with netcoredbg (F5)"
            >
              <Bug className="w-3.5 h-3.5" />
              <span>Debug</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: Quick Search, Build Script & Settings */}
      <div className="sharpforge-no-drag flex items-center space-x-1.5 shrink-0">
        <button
          onClick={onOpenQuickOpen}
          className="flex items-center space-x-2 bg-[#1e1f22] hover:bg-[#35373c] text-[#868a91] hover:text-[#dfe1e5] border border-[#393b40] rounded px-2.5 py-1 text-xs transition whitespace-nowrap shrink-0"
          title="Quick Open File (⌘P)"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Search Everywhere...</span>
          <kbd className="hidden lg:inline bg-[#2b2d30] px-1 rounded text-[10px] text-gray-400 border border-[#393b40]">⌘P</kbd>
        </button>

        {onOpenExtensions && (
          <button
            onClick={onOpenExtensions}
            className="p-1.5 hover:bg-[#35373c] text-purple-300 hover:text-white rounded transition"
            title="Extensions & Plugins (VS Code / JetBrains Marketplace)"
          >
            <Blocks className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onOpenSetupModal}
          className="p-1.5 hover:bg-[#35373c] text-[#bcbec4] hover:text-white rounded transition"
          title="macOS .app Packaging Script (setup.sh)"
        >
          <PackageCheck className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSettings}
          className="p-1.5 hover:bg-[#35373c] text-[#bcbec4] hover:text-white rounded transition"
          title="SharpForge IDE Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
