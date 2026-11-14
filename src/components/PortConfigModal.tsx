import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Globe,
  Play,
  RotateCcw,
  Save,
  Server,
  Skull,
  Sparkles,
  X
} from 'lucide-react';
import type { ActivePortProcess, ProjectItem, ProjectPortConfig } from '../types/minirider';
import { PortsPanel } from './PortsPanel';
import {
  buildUrlForPort,
  resolveProjectPortInfo,
  suggestNextFreePort
} from '../utils/portConfigHelper';

interface PortConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  project?: ProjectItem;
  currentOverride?: ProjectPortConfig | null;
  activePorts: ActivePortProcess[];
  isScanningPorts: boolean;
  isElectron: boolean;
  pendingLaunchMode?: 'run' | 'debug' | null;
  onRefreshPorts: () => void;
  onApplyPortConfig: (config: ProjectPortConfig | null) => void;
  onSavePortToLaunchSettings: (port: number, protocol: 'http' | 'https') => Promise<void>;
  onKillProcess: (options: { pid?: number; port?: number; force?: boolean }) => Promise<void>;
  onLaunchAfterResolve?: (mode: 'run' | 'debug', overrideConfig: ProjectPortConfig | null) => Promise<void>;
  onOpenUrl?: (url: string) => void;
}

export const PortConfigModal: React.FC<PortConfigModalProps> = ({
  isOpen,
  onClose,
  project,
  currentOverride,
  activePorts,
  isScanningPorts,
  isElectron,
  pendingLaunchMode = null,
  onRefreshPorts,
  onApplyPortConfig,
  onSavePortToLaunchSettings,
  onKillProcess,
  onLaunchAfterResolve,
  onOpenUrl
}) => {
  const defaultInfo = useMemo(() => resolveProjectPortInfo(project), [project]);

  const [useCustom, setUseCustom] = useState<boolean>(Boolean(currentOverride?.port));
  const [portInput, setPortInput] = useState<string>(
    String(currentOverride?.port || defaultInfo.defaultPort || 5124)
  );
  const [protocol, setProtocol] = useState<'http' | 'https'>(
    currentOverride?.protocol || (defaultInfo.defaultUrl.startsWith('https://') ? 'https' : 'http')
  );
  const [isActionBusy, setIsActionBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUseCustom(Boolean(currentOverride?.port));
    setPortInput(String(currentOverride?.port || defaultInfo.defaultPort || 5124));
    setProtocol(
      currentOverride?.protocol || (defaultInfo.defaultUrl.startsWith('https://') ? 'https' : 'http')
    );
    onRefreshPorts();
  }, [isOpen, currentOverride, defaultInfo.defaultPort, defaultInfo.defaultUrl]);

  const parsedCustomPort = useMemo(() => {
    const n = parseInt(portInput.trim(), 10);
    if (Number.isNaN(n) || n < 1 || n > 65535) return null;
    return n;
  }, [portInput]);

  const effectivePort = useCustom ? parsedCustomPort : defaultInfo.defaultPort;
  const effectiveUrl = effectivePort
    ? buildUrlForPort(effectivePort, protocol)
    : defaultInfo.defaultUrl;

  const occupiedPorts = useMemo(() => activePorts.map((p) => p.port), [activePorts]);
  const conflictsForEffective = useMemo(
    () => (effectivePort ? activePorts.filter((p) => p.port === effectivePort) : []),
    [activePorts, effectivePort]
  );
  const suggestedFreePort = useMemo(
    () => suggestNextFreePort(effectivePort || 5124, occupiedPorts),
    [effectivePort, occupiedPorts]
  );

  if (!isOpen) return null;

  const buildDesiredOverride = (): ProjectPortConfig | null => {
    if (!useCustom || !parsedCustomPort) return null;
    return { port: parsedCustomPort, protocol };
  };

  const handleApplyOnly = () => {
    onApplyPortConfig(buildDesiredOverride());
    onClose();
  };

  const handleSaveDisk = async () => {
    const portToSave = effectivePort || 5124;
    setIsActionBusy(true);
    try {
      await onSavePortToLaunchSettings(portToSave, protocol);
      // After persisting to launchSettings.json, default now matches that port
      onApplyPortConfig(null);
      setUseCustom(false);
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleKillAndLaunch = async (mode: 'run' | 'debug') => {
    if (!effectivePort) return;
    setIsActionBusy(true);
    try {
      await onKillProcess({ port: effectivePort, force: true });
      const cfg = buildDesiredOverride();
      onApplyPortConfig(cfg);
      onClose();
      if (onLaunchAfterResolve) {
        await onLaunchAfterResolve(mode, cfg);
      }
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleSwitchToFreeAndLaunch = async (mode: 'run' | 'debug') => {
    const freeCfg: ProjectPortConfig = { port: suggestedFreePort, protocol };
    setUseCustom(true);
    setPortInput(String(suggestedFreePort));
    onApplyPortConfig(freeCfg);
    onClose();
    if (onLaunchAfterResolve) {
      await onLaunchAfterResolve(mode, freeCfg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#232528] border border-[#393b40] rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden text-xs text-[#dfe1e5]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#2b2d30] border-b border-[#393b40] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#3574f0]/20 text-sky-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {pendingLaunchMode
                  ? `Port Conflict Detected Before ${pendingLaunchMode === 'debug' ? 'Debugging' : 'Running'}`
                  : 'Run & Debug Port Manager'}
              </h3>
              <p className="text-[11px] text-gray-400">
                Project: <span className="text-slate-200 font-medium">{project?.name || 'Startup Project'}</span> · Default from{' '}
                <span className="font-mono text-sky-300">{defaultInfo.source}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#35373c] text-gray-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conflict Warning Banner (when active port already has a listener) */}
        {conflictsForEffective.length > 0 && (
          <div className="px-4 py-3 bg-red-500/15 border-b border-red-500/35 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-start space-x-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold text-red-200">
                  Port :{effectivePort} is already in use ({conflictsForEffective.length} process{conflictsForEffective.length > 1 ? 'es' : ''})
                </div>
                <div className="text-[11px] text-red-300/90 font-mono truncate max-w-xl">
                  {conflictsForEffective.map((c) => `${c.processName} (PID ${c.pid}) — ${c.commandLine || c.address}`).join(' | ')}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {pendingLaunchMode ? (
                <>
                  <button
                    onClick={() => handleKillAndLaunch(pendingLaunchMode)}
                    disabled={isActionBusy}
                    className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center space-x-1.5 transition"
                  >
                    <Skull className="w-3.5 h-3.5" />
                    <span>{isActionBusy ? 'Stopping...' : `Kill :${effectivePort} & ${pendingLaunchMode === 'debug' ? 'Debug' : 'Run'}`}</span>
                  </button>
                  <button
                    onClick={() => handleSwitchToFreeAndLaunch(pendingLaunchMode)}
                    disabled={isActionBusy}
                    className="px-3 py-1.5 rounded bg-[#3574f0] hover:bg-[#2c66db] text-white font-semibold flex items-center space-x-1.5 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Use :{suggestedFreePort} & Launch</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    if (!effectivePort) return;
                    setIsActionBusy(true);
                    try {
                      await onKillProcess({ port: effectivePort, force: true });
                    } finally {
                      setIsActionBusy(false);
                    }
                  }}
                  disabled={isActionBusy}
                  className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center space-x-1.5 transition"
                >
                  <Skull className="w-3.5 h-3.5" />
                  <span>{isActionBusy ? 'Killing...' : `Kill Service on :${effectivePort}`}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Port Configuration Form */}
        <div className="p-4 border-b border-[#2b2d30] bg-[#1e1f22] space-y-3 shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Option 1: Project Default */}
            <label
              onClick={() => setUseCustom(false)}
              className={`p-3 rounded-lg border cursor-pointer transition flex items-start space-x-2.5 ${
                !useCustom
                  ? 'bg-[#3574f0]/15 border-[#3574f0] text-white'
                  : 'bg-[#26282b] border-[#393b40] text-gray-300 hover:border-[#4e5157]'
              }`}
            >
              <input
                type="radio"
                checked={!useCustom}
                onChange={() => setUseCustom(false)}
                className="mt-0.5 text-[#3574f0] focus:ring-0"
              />
              <div className="space-y-1 min-w-0">
                <div className="font-semibold flex items-center space-x-2">
                  <span>Use Default Port ({defaultInfo.defaultPort ? `:${defaultInfo.defaultPort}` : 'Auto'})</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#18191c] text-sky-300 border border-[#393b40]">
                    {defaultInfo.source}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-gray-400 truncate" title={defaultInfo.allUrls.join('; ')}>
                  {defaultInfo.allUrls.join('; ')}
                </div>
              </div>
            </label>

            {/* Option 2: Custom Override Port */}
            <div
              onClick={() => setUseCustom(true)}
              className={`p-3 rounded-lg border cursor-pointer transition flex items-start space-x-2.5 ${
                useCustom
                  ? 'bg-[#3574f0]/15 border-[#3574f0] text-white'
                  : 'bg-[#26282b] border-[#393b40] text-gray-300 hover:border-[#4e5157]'
              }`}
            >
              <input
                type="radio"
                checked={useCustom}
                onChange={() => setUseCustom(true)}
                className="mt-0.5 text-[#3574f0] focus:ring-0"
              />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Custom Port Override</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUseCustom(true);
                      setPortInput(String(suggestedFreePort));
                    }}
                    className="text-[10px] text-sky-400 hover:text-sky-300 hover:underline flex items-center space-x-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Pick free (:{suggestedFreePort})</span>
                  </button>
                </div>

                <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={protocol}
                    onChange={(e) => {
                      setUseCustom(true);
                      setProtocol(e.target.value as 'http' | 'https');
                    }}
                    className="bg-[#18191c] border border-[#393b40] rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-[#3574f0]"
                  >
                    <option value="http">http://</option>
                    <option value="https">https://</option>
                  </select>
                  <span className="font-mono text-gray-500">localhost:</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={portInput}
                    onChange={(e) => {
                      setUseCustom(true);
                      setPortInput(e.target.value);
                    }}
                    className="w-24 bg-[#18191c] border border-[#393b40] rounded px-2 py-1 text-[11px] font-mono text-white focus:outline-none focus:border-[#3574f0]"
                    placeholder="5055"
                  />

                  {effectivePort && conflictsForEffective.length === 0 && (
                    <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Available</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Effective URL Summary + Persist to launchSettings */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center space-x-2 text-[11px] text-gray-400">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>Effective URL:</span>
              <code className="px-2 py-0.5 rounded bg-[#18191c] border border-[#393b40] text-emerald-300 font-mono">
                {effectiveUrl}
              </code>
              {useCustom && (
                <button
                  onClick={() => {
                    setUseCustom(false);
                    setPortInput(String(defaultInfo.defaultPort || 5124));
                  }}
                  className="text-gray-400 hover:text-white flex items-center space-x-1"
                  title="Revert to launchSettings.json / appsettings.json default"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {effectivePort && (
              <button
                onClick={handleSaveDisk}
                disabled={isActionBusy}
                className="px-2.5 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] border border-[#393b40] text-slate-200 text-[11px] flex items-center space-x-1.5 transition"
                title="Write this URL/port permanently into Properties/launchSettings.json"
              >
                <Save className="w-3.5 h-3.5 text-amber-400" />
                <span>Save to launchSettings.json</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Listening Ports Section */}
        <div className="flex-1 min-h-[220px] overflow-hidden flex flex-col">
          <PortsPanel
            ports={activePorts}
            isLoading={isScanningPorts}
            configuredPort={effectivePort}
            configuredUrl={effectiveUrl}
            configuredSource={useCustom ? 'custom override' : defaultInfo.source}
            isElectron={isElectron}
            onRefresh={onRefreshPorts}
            onKillProcess={onKillProcess}
            onOpenUrl={onOpenUrl}
            onUsePort={(p) => {
              setUseCustom(true);
              setPortInput(String(p));
            }}
            compact
          />
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 bg-[#2b2d30] border-t border-[#393b40] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-gray-400">
            SharpForge injects <code className="text-slate-300">ASPNETCORE_URLS</code> & <code className="text-slate-300">PORT</code> on Run and Debug.
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#1e1f22] hover:bg-[#35373c] border border-[#393b40] text-gray-300 transition"
            >
              Cancel
            </button>

            {pendingLaunchMode && onLaunchAfterResolve && (
              <button
                onClick={async () => {
                  const cfg = buildDesiredOverride();
                  onApplyPortConfig(cfg);
                  onClose();
                  await onLaunchAfterResolve(pendingLaunchMode, cfg);
                }}
                className="px-3 py-1.5 rounded bg-[#35373c] hover:bg-[#43454b] border border-[#4e5157] text-slate-200 transition"
              >
                Launch Anyway
              </button>
            )}

            {!pendingLaunchMode && (
              <>
                <button
                  onClick={handleApplyOnly}
                  className="px-3 py-1.5 rounded bg-[#35373c] hover:bg-[#43454b] border border-[#4e5157] text-white font-medium transition"
                >
                  Apply Port
                </button>
                {onLaunchAfterResolve && (
                  <>
                    <button
                      onClick={async () => {
                        const cfg = buildDesiredOverride();
                        onApplyPortConfig(cfg);
                        onClose();
                        await onLaunchAfterResolve('run', cfg);
                      }}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center space-x-1 transition"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Run :{effectivePort || 'Auto'}</span>
                    </button>
                    <button
                      onClick={async () => {
                        const cfg = buildDesiredOverride();
                        onApplyPortConfig(cfg);
                        onClose();
                        await onLaunchAfterResolve('debug', cfg);
                      }}
                      className="px-3 py-1.5 rounded bg-[#3574f0] hover:bg-[#2c66db] text-white font-medium flex items-center space-x-1 transition"
                    >
                      <Bug className="w-3.5 h-3.5" />
                      <span>Debug :{effectivePort || 'Auto'}</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
