import React from 'react';
import { X, Keyboard, Command } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { category: 'Debugging (DAP / netcoredbg)', items: [
      { key: 'F5', desc: 'Start Debugging / Continue' },
      { key: 'F9', desc: 'Toggle Line Breakpoint' },
      { key: 'F10', desc: 'Step Over' },
      { key: 'F11', desc: 'Step Into' },
      { key: '⇧F11', desc: 'Step Out' },
      { key: '⇧F5', desc: 'Stop Debugger' }
    ]},
    { category: 'Build, File & Run', items: [
      { key: '⌘O', desc: 'Open Solution (.sln / .slnx)' },
      { key: '⌘S', desc: 'Save Current File to Disk' },
      { key: '⌘R', desc: 'Run Startup Project' },
      { key: '⌘⇧B', desc: 'Build Solution (dotnet build)' },
      { key: '⌘T', desc: 'Run All Tests (dotnet test)' }
    ]},
    { category: 'Code Navigation & History (Roslyn LSP)', items: [
      { key: '⌘+Click / Ctrl+Click', desc: 'Jump to Symbol Definition' },
      { key: '⌥⌘B / ⌘F12', desc: 'Go to Implementation (Exact Line)' },
      { key: '⌘B / F12', desc: 'Declaration or Usages (Go to Definition)' },
      { key: '⌥⌘← / ⌘[', desc: 'Navigate Back (Previous File & Line)' },
      { key: '⌥⌘→ / ⌘]', desc: 'Navigate Forward' },
      { key: '⌥F7 / ⇧F12', desc: 'Find Usages / All References' },
      { key: '⌘P', desc: 'Quick Open Any File' },
      { key: '⌘⇧F', desc: 'Search Across Solution' },
      { key: 'Right-Click AppSettings', desc: 'Set & Sync Environment Variables' }
    ]}
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#1e1f22] border border-[#393b40] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden font-sans text-xs text-[#dfe1e5]">
        <div className="h-11 bg-[#26282b] border-b border-[#2b2d30] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 font-bold text-sm">
            <Keyboard className="w-4 h-4 text-purple-400" />
            <span>Cairn IDE Keyboard Shortcuts</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#35373c] text-gray-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {shortcuts.map(cat => (
            <div key={cat.category} className="space-y-2">
              <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                {cat.category}
              </div>
              <div className="space-y-1">
                {cat.items.map(item => (
                  <div key={item.key} className="flex items-center justify-between py-1 px-2 bg-[#26282b] rounded border border-[#2b2d30]">
                    <span className="text-gray-300">{item.desc}</span>
                    <kbd className="bg-[#18191c] px-2 py-0.5 rounded font-mono text-[11px] font-semibold text-emerald-400 border border-[#393b40]">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="h-10 bg-[#26282b] border-t border-[#2b2d30] px-4 flex items-center justify-end">
          <button onClick={onClose} className="px-3 py-1 bg-[#3574f0] text-white rounded font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
