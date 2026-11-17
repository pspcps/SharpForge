import React, { useState } from 'react';
import { 
  X, 
  Apple, 
  Terminal, 
  Copy, 
  Check, 
  Download, 
  FileCode, 
  ShieldCheck, 
  Cpu, 
  Layers,
  ExternalLink
} from 'lucide-react';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  setupScriptContent: string;
}

export const SetupModal: React.FC<SetupModalProps> = ({
  isOpen,
  onClose,
  setupScriptContent
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'quickstart' | 'script' | 'architecture'>('quickstart');

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(setupScriptContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadScript = () => {
    const blob = new Blob([setupScriptContent], { type: 'text/x-sh' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'setup.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = () => {
    // Download the real repository, including its lockfile, desktop modules and assets.
    const link = document.createElement('a');
    link.href = 'https://github.com/pspcps/SharpForge/archive/refs/heads/main.zip';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] text-[#dfe1e5] font-sans">
        {/* Header */}
        <div className="h-12 bg-[#26282b] border-b border-[#2b2d30] px-4 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center space-x-2">
            <img src="./icon.png" alt="Cairn IDE" className="w-6 h-6 rounded shadow object-cover" />
            <span className="font-bold text-sm">Cairn IDE macOS Desktop App Setup & Packaging</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#35373c] rounded-md transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="h-9 bg-[#212327] border-b border-[#2b2d30] px-4 flex items-center space-x-2 text-xs">
          <button
            onClick={() => setActiveTab('quickstart')}
            className={`px-3 py-1.5 rounded transition ${
              activeTab === 'quickstart' ? 'bg-[#3574f0] text-white font-medium' : 'text-[#868a91] hover:text-white'
            }`}
          >
            Quickstart & Installation
          </button>
          <button
            onClick={() => setActiveTab('script')}
            className={`px-3 py-1.5 rounded transition ${
              activeTab === 'script' ? 'bg-[#3574f0] text-white font-medium' : 'text-[#868a91] hover:text-white'
            }`}
          >
            setup.sh Source Code
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 py-1.5 rounded transition ${
              activeTab === 'architecture' ? 'bg-[#3574f0] text-white font-medium' : 'text-[#868a91] hover:text-white'
            }`}
          >
            Open-Source Architecture & Licensing
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 text-xs space-y-4">
          {activeTab === 'quickstart' && (
            <div className="space-y-4">
              <div className="bg-[#26282b] p-4 rounded-lg border border-[#2b2d30] space-y-2">
                <h4 className="font-bold text-slate-200 text-sm flex items-center space-x-1.5">
                  <Apple className="w-4 h-4 text-slate-300" />
                  <span>One-Command macOS Installation</span>
                </h4>
                <p className="text-gray-300 text-xs">
                  Run the automated setup script on your Mac. It detects Apple Silicon (M1/M2/M3/M4) vs Intel (x64), checks prerequisites, checks for the open-source DAP debugger (<code className="text-amber-300 font-mono">netcoredbg</code>), compiles the desktop app, and packages <code className="text-emerald-300 font-mono">Cairn IDE.app</code> into the <code className="text-emerald-300 font-mono">release/</code> folder.
                </p>

                <div className="relative mt-2">
                  <pre className="bg-[#18191c] p-3 rounded font-mono text-emerald-400 text-xs border border-[#393b40] overflow-x-auto">
{`# In your terminal on macOS:
chmod +x setup.sh
./setup.sh`}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('chmod +x setup.sh\n./setup.sh');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-[#2b2d30] hover:bg-[#35373c] text-gray-300 rounded border border-[#393b40] transition"
                    title="Copy command"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Hardware & System Detection Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-[#26282b] rounded-lg border border-[#2b2d30] space-y-1">
                  <div className="flex items-center space-x-1.5 font-semibold text-slate-200">
                    <Cpu className="w-4 h-4 text-purple-400" />
                    <span>Apple Silicon (arm64)</span>
                  </div>
                  <p className="text-gray-400 text-[11px]">
                    Native compilation target for M1, M2, M3, and M4 Macs with native arm64 netcoredbg CoreCLR runtime.
                  </p>
                </div>

                <div className="p-3 bg-[#26282b] rounded-lg border border-[#2b2d30] space-y-1">
                  <div className="flex items-center space-x-1.5 font-semibold text-slate-200">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    <span>Intel x64 Macs</span>
                  </div>
                  <p className="text-gray-400 text-[11px]">
                    Full backwards compatibility with Intel x86_64 architecture and Rosetta 2 support.
                  </p>
                </div>
              </div>

              {/* Export Buttons */}
              <div className="flex items-center space-x-3 pt-2">
                <button
                  onClick={handleDownloadScript}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition shadow"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download setup.sh</span>
                </button>

                <button
                  onClick={handleDownloadZip}
                  disabled={false}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-[#2b2d30] hover:bg-[#35373c] text-white border border-[#393b40] rounded font-medium transition"
                >
                  <FileCode className="w-3.5 h-3.5 text-amber-400" />
                  <span>Download repository source (.zip)</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'script' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-gray-400">
                <span>Executable setup script (root/setup.sh)</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center space-x-1 bg-[#2b2d30] hover:bg-[#35373c] text-white px-2.5 py-1 rounded border border-[#393b40] transition"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied!' : 'Copy setup.sh'}</span>
                </button>
              </div>
              <pre className="bg-[#18191c] p-3 rounded font-mono text-[11px] text-slate-300 border border-[#2b2d30] max-h-96 overflow-y-auto whitespace-pre">
                {setupScriptContent}
              </pre>
            </div>
          )}

          {activeTab === 'architecture' && (
            <div className="space-y-3">
              <div className="p-3 bg-[#26282b] rounded-lg border border-[#2b2d30] space-y-1.5">
                <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-sm">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Strict License Compliance — No Proprietary VS Code Binaries</span>
                </div>
                <p className="text-gray-300 text-xs">
                  Microsoft&apos;s proprietary <code className="text-red-300 font-mono">vsdbg</code> debugger and C# Dev Kit have commercial license restrictions preventing redistribution in third-party IDEs.
                </p>
                <p className="text-gray-300 text-xs">
                  Cairn IDE strictly uses <strong className="text-slate-100">netcoredbg</strong> (developed by Samsung and licensed under the permissive <strong className="text-emerald-300">MIT License</strong>), with redistribution subject to its license and applicable third-party notices.
                </p>
              </div>

              <div className="p-3 bg-[#26282b] rounded-lg border border-[#2b2d30] space-y-1.5">
                <div className="flex items-center space-x-2 text-sky-400 font-semibold text-sm">
                  <Layers className="w-4 h-4" />
                  <span>Standardized Protocols (LSP & DAP)</span>
                </div>
                <p className="text-gray-300 text-xs">
                  • <strong>DAP (Debug Adapter Protocol):</strong> Controls stepping, source breakpoints, call stacks, variable scope inspection, and conditional breakpoints.<br />
                  • <strong>Roslyn LSP (Language Server Protocol):</strong> Powers semantic code completion, Go to Definition (F12), Find All References (Shift+F12), and real-time compile diagnostics.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-11 bg-[#26282b] border-t border-[#2b2d30] px-4 flex items-center justify-between rounded-b-xl text-gray-400 text-xs">
          <span>Cairn IDE v1.0.0 for macOS Sonoma / Sequoia</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#3574f0] hover:bg-[#3068d8] text-white rounded font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
