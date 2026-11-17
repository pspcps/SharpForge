import React, { useState } from 'react';
import { X, Settings, Check, Folder, Cpu, Terminal } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sdkPath: string;
  onUpdateSdkPath: (path: string) => void;
  debuggerPath: string;
  onUpdateDebuggerPath: (path: string) => void;
  activeSdk?: string;
  detectedSdks?: string[];
  onSelectSdk?: (sdk: string) => void;
  editorTheme?: 'sharpforge-dark' | 'vs-dark-plus' | 'darcula';
  onSelectEditorTheme?: (theme: 'sharpforge-dark' | 'vs-dark-plus' | 'darcula') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  sdkPath,
  onUpdateSdkPath,
  debuggerPath,
  onUpdateDebuggerPath,
  activeSdk = '.NET 10.0',
  detectedSdks = ['10.0.302', '9.0.100', '8.0.417', '7.0.410', '6.0.428'],
  onSelectSdk,
  editorTheme = 'sharpforge-dark',
  onSelectEditorTheme
}) => {
  const [localSdk, setLocalSdk] = useState(sdkPath);
  const [localDebugger, setLocalDebugger] = useState(debuggerPath);
  const [selectedSdkVersion, setSelectedSdkVersion] = useState(activeSdk);
  const [selectedTheme, setSelectedTheme] = useState<'sharpforge-dark' | 'vs-dark-plus' | 'darcula'>(editorTheme);

  React.useEffect(() => {
    if (isOpen) {
      setLocalSdk(sdkPath);
      setLocalDebugger(debuggerPath);
      setSelectedSdkVersion(activeSdk);
      setSelectedTheme(editorTheme);
    }
  }, [isOpen, sdkPath, debuggerPath, activeSdk, editorTheme]);

  if (!isOpen) return null;

  const handleSave = () => {
    onUpdateSdkPath(localSdk);
    onUpdateDebuggerPath(localDebugger);
    if (onSelectSdk) {
      onSelectSdk(selectedSdkVersion);
    }
    if (onSelectEditorTheme) {
      onSelectEditorTheme(selectedTheme);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden font-sans text-xs text-[#dfe1e5]">
        <div className="h-11 bg-[#26282b] border-b border-[#2b2d30] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 font-bold text-sm">
            <Settings className="w-4 h-4 text-slate-300" />
            <span>Cairn IDE Settings</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#35373c] text-gray-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="font-semibold text-slate-200 flex items-center space-x-1.5">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>Active .NET SDK Version (Multi-Targeting)</span>
            </label>
            <select
              value={selectedSdkVersion}
              onChange={e => setSelectedSdkVersion(e.target.value)}
              className="w-full bg-[#18191c] text-white border border-[#393b40] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value=".NET 10.0">.NET 10.0 (Current / Preview)</option>
              <option value=".NET 9.0">.NET 9.0 (STS)</option>
              <option value=".NET 8.0">.NET 8.0 (LTS)</option>
              <option value=".NET 7.0">.NET 7.0</option>
              <option value=".NET 6.0">.NET 6.0 (LTS)</option>
              {detectedSdks
                .filter(s => !['10.0', '9.0', '8.0', '7.0', '6.0'].some(v => s.startsWith(v)))
                .map(sdk => (
                  <option key={sdk} value={sdk}>Installed SDK {sdk}</option>
                ))}
            </select>
            <p className="text-gray-400 text-[11px]">
              Detected SDKs: <span className="font-mono text-purple-300">{detectedSdks.join(', ')}</span>
            </p>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-200">.NET SDK Location (dotnet CLI)</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={localSdk}
                onChange={e => setLocalSdk(e.target.value)}
                className="flex-1 bg-[#18191c] border border-[#393b40] rounded px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
            <p className="text-gray-400 text-[11px]">Default on macOS: /usr/local/share/dotnet, ~/.dotnet, or /opt/homebrew/bin/dotnet</p>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-200">Open-Source Debugger Executable (netcoredbg)</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={localDebugger}
                onChange={e => setLocalDebugger(e.target.value)}
                className="flex-1 bg-[#18191c] border border-[#393b40] rounded px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
            <p className="text-gray-400 text-[11px]">MIT licensed open-source debugger (Samsung netcoredbg for CoreCLR)</p>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-200">Editor Color Theme</label>
            <select
              value={selectedTheme}
              onChange={e => setSelectedTheme(e.target.value as 'sharpforge-dark' | 'vs-dark-plus' | 'darcula')}
              className="w-full bg-[#18191c] text-white border border-[#393b40] rounded px-3 py-1.5 text-xs focus:outline-none cursor-pointer"
            >
              <option value="sharpforge-dark">Cairn IDE Dark (Modern .NET UI)</option>
              <option value="vs-dark-plus">Visual Studio Dark+</option>
              <option value="darcula">Darcula Classic</option>
            </select>
          </div>
        </div>

        <div className="h-11 bg-[#26282b] border-t border-[#2b2d30] px-4 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 hover:bg-[#35373c] text-gray-300 rounded font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium shadow"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
