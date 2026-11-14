import React, { useState } from 'react';
import { 
  X, 
  Zap, 
  Check, 
  Copy, 
  Save, 
  FileCode, 
  Settings, 
  ArrowRight,
  ShieldCheck,
  FolderSync
} from 'lucide-react';
import { ProjectItem, SolutionFileItem } from '../types/minirider';

interface AppSettingsEnvModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: SolutionFileItem | null;
  project: ProjectItem;
  onSyncToLaunchSettings: (envVars: Record<string, string>) => void;
  onSaveEnvFile: (content: string) => void;
}

export const AppSettingsEnvModal: React.FC<AppSettingsEnvModalProps> = ({
  isOpen,
  onClose,
  file,
  project,
  onSyncToLaunchSettings,
  onSaveEnvFile
}) => {
  const [copied, setCopied] = useState(false);
  const [synced, setSynced] = useState(false);

  // Parse JSON content and flatten keys using ASP.NET Core double underscore (__) naming convention
  const flattenJsonToEnv = (content: string): Record<string, string> => {
    try {
      const obj = JSON.parse(content || '{}');
      const result: Record<string, string> = {};

      const recurse = (curr: any, prefix = '') => {
        if (curr === null || curr === undefined) return;
        if (typeof curr === 'object' && !Array.isArray(curr)) {
          for (const key of Object.keys(curr)) {
            const newKey = prefix ? `${prefix}__${key}` : key;
            recurse(curr[key], newKey);
          }
        } else if (Array.isArray(curr)) {
          curr.forEach((item, index) => {
            const newKey = `${prefix}__${index}`;
            recurse(item, newKey);
          });
        } else {
          result[prefix] = String(curr);
        }
      };

      recurse(obj);
      return result;
    } catch {
      return {};
    }
  };

  const envMap = flattenJsonToEnv(file?.content || '{}');
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    Object.keys(envMap).forEach(k => {
      init[k] = true;
    });
    return init;
  });

  if (!isOpen) return null;

  const toggleKey = (key: string) => {
    setSelectedKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => {
    const all: Record<string, boolean> = {};
    Object.keys(envMap).forEach(k => { all[k] = true; });
    setSelectedKeys(all);
  };

  const deselectAll = () => {
    const none: Record<string, boolean> = {};
    Object.keys(envMap).forEach(k => { none[k] = false; });
    setSelectedKeys(none);
  };

  // Filtered active env vars
  const activeEnvVars: Record<string, string> = {};
  Object.entries(envMap).forEach(([k, v]) => {
    if (selectedKeys[k]) {
      activeEnvVars[k] = v;
    }
  });

  const envFileContent = Object.entries(activeEnvVars)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n');

  const shellExportContent = Object.entries(activeEnvVars)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join('\n');

  const handleSyncLaunchSettings = () => {
    onSyncToLaunchSettings(activeEnvVars);
    setSynced(true);
    setTimeout(() => setSynced(false), 2500);
  };

  const handleSaveDotEnv = () => {
    onSaveEnvFile(envFileContent);
    setSynced(true);
    setTimeout(() => setSynced(false), 2500);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(envFileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden font-sans text-xs text-[#dfe1e5] flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="h-12 bg-[#26282b] border-b border-[#2b2d30] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <span className="font-bold text-sm text-slate-100">Convert AppSettings to Environment Variables</span>
              <div className="text-[11px] text-gray-400 font-mono">
                Source: {file?.name || 'appsettings.json'} → Target Project: {project.name}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#35373c] text-gray-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-[#212327] border-b border-[#2b2d30] px-4 py-2 flex items-center justify-between text-[11px]">
          <span className="text-gray-300">
            Converts JSON hierarchy into ASP.NET Core double underscore format (<code className="text-amber-400 font-mono">Section__SubKey</code>).
          </span>
          <div className="flex items-center space-x-2">
            <button onClick={selectAll} className="text-blue-400 hover:underline">Select All</button>
            <span className="text-gray-500">•</span>
            <button onClick={deselectAll} className="text-blue-400 hover:underline">Deselect All</button>
          </div>
        </div>

        {/* Variables List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {Object.keys(envMap).length === 0 ? (
            <div className="p-6 text-center text-gray-500 italic">No settings properties found in this file.</div>
          ) : (
            Object.entries(envMap).map(([envKey, envVal]) => {
              const isChecked = !!selectedKeys[envKey];
              return (
                <div
                  key={envKey}
                  onClick={() => toggleKey(envKey)}
                  className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                    isChecked
                      ? 'bg-[#26282b] border-[#3574f0]/50 text-slate-200'
                      : 'bg-[#1e1f22] border-[#2b2d30] text-gray-500 opacity-60'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate mr-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleKey(envKey)}
                      className="rounded bg-[#18191c] border-[#393b40] text-blue-600 focus:ring-0"
                    />
                    <div className="truncate">
                      <div className="font-mono font-semibold text-emerald-400 text-xs truncate">
                        {envKey}
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono truncate">
                        = &quot;{envVal}&quot;
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] bg-[#18191c] text-gray-400 px-2 py-0.5 rounded border border-[#393b40] font-mono shrink-0">
                    env
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Live Preview Box */}
        <div className="bg-[#18191c] border-t border-[#2b2d30] p-3">
          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
            <span>Preview ({Object.keys(activeEnvVars).length} variables selected):</span>
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1 text-blue-400 hover:text-blue-300"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy Values'}</span>
            </button>
          </div>
          <pre className="bg-[#141517] p-2 rounded text-[11px] font-mono text-emerald-400/90 max-h-24 overflow-y-auto whitespace-pre">
            {envFileContent || '# No variables selected'}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="h-12 bg-[#26282b] border-t border-[#2b2d30] px-4 flex items-center justify-between">
          <span className="text-gray-400 text-[11px]">
            {synced ? <span className="text-emerald-400 font-semibold flex items-center space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Synced successfully!</span>
            </span> : 'No manual configuration needed.'}
          </span>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleSaveDotEnv}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#393b40] hover:bg-[#4e5157] text-white rounded font-medium transition"
              title="Save to .env in project root"
            >
              <FileCode className="w-3.5 h-3.5 text-amber-400" />
              <span>Export .env</span>
            </button>

            <button
              onClick={handleSyncLaunchSettings}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium shadow transition"
              title="Directly update Properties/launchSettings.json with these environment variables"
            >
              <FolderSync className="w-3.5 h-3.5" />
              <span>Sync to launchSettings.json</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
