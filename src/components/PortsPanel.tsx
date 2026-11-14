import React, { useMemo, useState } from 'react';
import {
  Activity,
  ExternalLink,
  Flame,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  CheckCircle2,
  Skull,
  Terminal
} from 'lucide-react';
import type { ActivePortProcess } from '../types/minirider';

interface PortsPanelProps {
  ports: ActivePortProcess[];
  isLoading: boolean;
  configuredPort?: number | null;
  configuredUrl?: string | null;
  configuredSource?: string;
  isElectron: boolean;
  onRefresh: () => void;
  onKillProcess: (options: { pid?: number; port?: number; force?: boolean }) => Promise<void>;
  onOpenUrl?: (url: string) => void;
  onUsePort?: (port: number) => void;
  compact?: boolean;
}

export const PortsPanel: React.FC<PortsPanelProps> = ({
  ports,
  isLoading,
  configuredPort,
  configuredUrl,
  configuredSource,
  isElectron,
  onRefresh,
  onKillProcess,
  onOpenUrl,
  onUsePort,
  compact = false
}) => {
  const [filterText, setFilterText] = useState('');
  const [onlyDotnetAndCommon, setOnlyDotnetAndCommon] = useState(false);
  const [quickKillPort, setQuickKillPort] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const filteredPorts = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return ports.filter((item) => {
      if (onlyDotnetAndCommon) {
        const isWebPort =
          item.isDotnet ||
          item.port >= 3000 && item.port <= 9999 ||
          /node|dotnet|kestrel|python|ruby|java|nginx|caddy|docker/i.test(
            `${item.processName} ${item.commandLine || ''}`
          );
        if (!isWebPort) return false;
      }
      if (!q) return true;
      return (
        String(item.port).includes(q) ||
        String(item.pid).includes(q) ||
        item.processName.toLowerCase().includes(q) ||
        (item.commandLine || '').toLowerCase().includes(q) ||
        item.address.toLowerCase().includes(q)
      );
    });
  }, [ports, filterText, onlyDotnetAndCommon]);

  const targetConflicts = useMemo(() => {
    if (!configuredPort) return [];
    return ports.filter((p) => p.port === configuredPort);
  }, [ports, configuredPort]);

  const handleKill = async (key: string, options: { pid?: number; port?: number; force?: boolean }) => {
    setBusyKey(key);
    try {
      await onKillProcess(options);
    } finally {
      setBusyKey(null);
    }
  };

  const handleQuickKillPortSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(quickKillPort.trim(), 10);
    if (!p || Number.isNaN(p) || p < 1 || p > 65535) return;
    await handleKill(`quick-${p}`, { port: p, force: true });
    setQuickKillPort('');
  };

  return (
    <div className="flex flex-col h-full bg-[#18191c] text-xs text-[#dfe1e5] select-none overflow-hidden">
      {/* Top Status & Action Bar */}
      <div className="bg-[#232528] border-b border-[#2b2d30] px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Configured Port Health Pill */}
        <div className="flex items-center space-x-2 min-w-0">
          {configuredPort ? (
            targetConflicts.length > 0 ? (
              <div className="flex items-center space-x-2 px-2.5 py-1 rounded bg-red-500/15 border border-red-500/40 text-red-200">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="font-mono font-semibold">Port :{configuredPort} IN USE</span>
                <span className="text-[10px] text-red-300/80 hidden sm:inline">
                  ({targetConflicts[0].processName} · PID {targetConflicts[0].pid})
                </span>
                <button
                  onClick={() => handleKill(`port-${configuredPort}`, { port: configuredPort, force: true })}
                  disabled={busyKey === `port-${configuredPort}`}
                  className="ml-1 px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold text-[10px] transition flex items-center space-x-1"
                  title={`Kill service blocking port ${configuredPort}`}
                >
                  <Skull className="w-3 h-3" />
                  <span>{busyKey === `port-${configuredPort}` ? 'Killing...' : `Kill :${configuredPort}`}</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-mono font-semibold">Target :{configuredPort} Free</span>
                {configuredSource && (
                  <span className="text-[10px] text-emerald-400/75 hidden md:inline">
                    ({configuredSource})
                  </span>
                )}
                {configuredUrl && onOpenUrl && (
                  <button
                    onClick={() => onOpenUrl(configuredUrl)}
                    className="ml-1 text-emerald-300 hover:text-white"
                    title={`Open ${configuredUrl}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="flex items-center space-x-1.5 text-gray-400">
              <Server className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-semibold text-slate-200">Active Listening Ports</span>
            </div>
          )}

          <span className="text-[11px] text-gray-500 font-mono">
            {ports.length} active
          </span>
        </div>

        {/* Search, Filter, Quick Kill, Refresh */}
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          <div className="relative flex items-center">
            <Search className="w-3 h-3 text-gray-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter port, pid, dotnet..."
              className="pl-6 pr-2 py-1 w-40 bg-[#18191c] border border-[#393b40] rounded text-[11px] text-white focus:outline-none focus:border-[#3574f0]"
            />
          </div>

          <button
            onClick={() => setOnlyDotnetAndCommon((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] transition ${
              onlyDotnetAndCommon
                ? 'bg-[#3574f0]/20 border-[#3574f0] text-blue-300 font-medium'
                : 'bg-[#18191c] border-[#393b40] text-gray-400 hover:text-white'
            }`}
            title="Filter to .NET, Web & App dev ports"
          >
            .NET / Dev
          </button>

          <form onSubmit={handleQuickKillPortSubmit} className="flex items-center space-x-1">
            <input
              type="number"
              min={1}
              max={65535}
              value={quickKillPort}
              onChange={(e) => setQuickKillPort(e.target.value)}
              placeholder="Port #"
              className="w-20 px-2 py-1 bg-[#18191c] border border-[#393b40] rounded text-[11px] font-mono text-white focus:outline-none focus:border-red-500"
            />
            <button
              type="submit"
              disabled={!quickKillPort.trim()}
              className="px-2 py-1 rounded bg-red-600/20 hover:bg-red-600/35 disabled:opacity-40 text-red-300 border border-red-500/30 text-[11px] font-medium transition flex items-center space-x-1"
              title="Kill any service listening on this port"
            >
              <Flame className="w-3 h-3" />
              <span>Kill Port</span>
            </button>
          </form>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] border border-[#393b40] text-slate-200 text-[11px] transition"
            title="Refresh listening TCP ports"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-sky-400' : 'text-sky-400'}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Browser Preview Notice if not running inside Electron */}
      {!isElectron && ports.length === 0 && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/25 text-amber-200 text-[11px] flex items-center space-x-2 shrink-0">
          <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            Live macOS port scanning (`lsof`) and process killing require the SharpForge.app desktop runtime. Build via `./setup.sh` to manage live OS ports.
          </span>
        </div>
      )}

      {/* Ports Table */}
      <div className={`flex-1 overflow-y-auto ${compact ? 'max-h-[260px]' : ''}`}>
        {filteredPorts.length === 0 ? (
          <div className="p-6 text-center text-gray-500 italic">
            {isLoading
              ? 'Scanning active TCP listening ports...'
              : ports.length === 0
              ? 'No listening TCP ports detected.'
              : 'No ports match your current filter.'}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#232528] text-[10px] uppercase text-[#868a91] border-b border-[#2b2d30]">
              <tr>
                <th className="py-1.5 px-3 w-24">Port</th>
                <th className="py-1.5 px-2 w-24">PID</th>
                <th className="py-1.5 px-2 w-36">Service / Process</th>
                <th className="py-1.5 px-2 w-28">Bind Address</th>
                <th className="py-1.5 px-2">Command Line</th>
                <th className="py-1.5 px-3 text-right w-44">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPorts.map((item) => {
                const rowKey = `${item.pid}-${item.port}`;
                const isTargetConflict = configuredPort === item.port;
                return (
                  <tr
                    key={rowKey}
                    className={`border-b border-[#232528] transition ${
                      isTargetConflict
                        ? 'bg-red-500/10 hover:bg-red-500/15'
                        : 'hover:bg-[#26282b]'
                    }`}
                  >
                    <td className="py-1.5 px-3 font-mono font-semibold">
                      <span
                        className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] ${
                          isTargetConflict
                            ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                            : item.isDotnet
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : 'bg-[#2b2d30] text-emerald-300 border border-[#393b40]'
                        }`}
                      >
                        <Activity className="w-3 h-3" />
                        <span>:{item.port}</span>
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-gray-300">{item.pid}</td>
                    <td className="py-1.5 px-2 font-medium">
                      <div className="flex items-center space-x-1.5">
                        <span className={item.isDotnet ? 'text-sky-300 font-semibold' : 'text-slate-200'}>
                          {item.processName}
                        </span>
                        {item.isDotnet && (
                          <span className="px-1 py-0.2 text-[9px] rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                            .NET
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-gray-400 text-[11px]">
                      {item.address} ({item.protocol})
                    </td>
                    <td
                      className="py-1.5 px-2 font-mono text-[11px] text-gray-400 max-w-[360px] truncate"
                      title={item.commandLine || item.processName}
                    >
                      {item.commandLine || item.processName}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <div className="inline-flex items-center space-x-1">
                        {onUsePort && (
                          <button
                            onClick={() => onUsePort(item.port)}
                            className="px-1.5 py-0.5 rounded bg-[#2b2d30] hover:bg-[#35373c] text-gray-300 hover:text-white text-[10px] border border-[#393b40]"
                            title={`Configure app to use port ${item.port}`}
                          >
                            Select
                          </button>
                        )}
                        {onOpenUrl && (
                          <button
                            onClick={() => onOpenUrl(`http://localhost:${item.port}`)}
                            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-sky-300"
                            title={`Open http://localhost:${item.port}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleKill(rowKey, { pid: item.pid, port: item.port, force: false })}
                          disabled={busyKey === rowKey}
                          className="px-2 py-0.5 rounded bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/35 text-[10px] font-semibold transition"
                          title={`Terminate PID ${item.pid} (SIGTERM -> SIGKILL fallback)`}
                        >
                          {busyKey === rowKey ? '...' : 'Kill'}
                        </button>
                        <button
                          onClick={() => handleKill(`${rowKey}-force`, { pid: item.pid, port: item.port, force: true })}
                          disabled={busyKey === `${rowKey}-force`}
                          className="px-1.5 py-0.5 rounded bg-red-900/35 hover:bg-red-700/60 text-red-200 border border-red-500/40 text-[10px] font-mono transition"
                          title={`Force Kill PID ${item.pid} (-9)`}
                        >
                          -9
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
