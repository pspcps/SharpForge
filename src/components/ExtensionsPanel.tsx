import React, { useEffect, useState } from 'react';
import {
  Blocks,
  Search,
  Download,
  Trash2,
  Palette,
  ExternalLink,
  Power,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import type { MarketplaceExtension } from '../types/minirider';

const CURATED_EXTENSIONS: MarketplaceExtension[] = [
  {
    id: 'vscode:muhammad-sammy.csharp',
    name: 'csharp',
    displayName: 'C# Dev Kit (Open VSX)',
    publisher: 'muhammad-sammy',
    version: '2.50.1',
    description: 'C# language editing, Razor syntax, symbol navigation & Roslyn diagnostics support.',
    source: 'vscode',
    downloads: 4820000,
    rating: 4.8,
    categories: ['Programming Languages', '.NET']
  },
  {
    id: 'vscode:dracula-theme.theme-dracula',
    name: 'theme-dracula',
    displayName: 'Dracula Official Theme',
    publisher: 'dracula-theme',
    version: '2.25.1',
    description: 'Dracula color theme for Monaco Editor with vibrant purple, cyan, and pink token colors.',
    source: 'vscode',
    downloads: 7450000,
    rating: 4.9,
    categories: ['Themes'],
    themes: [
      {
        id: 'ext-dracula-theme',
        label: 'Dracula Official',
        uiTheme: 'vs-dark',
        colors: {
          'editor.background': '#282a36',
          'editor.foreground': '#f8f8f2',
          'editorLineNumber.foreground': '#6272a4',
          'editor.selectionBackground': '#44475a',
          'editor.lineHighlightBackground': '#343746',
          'editorCursor.foreground': '#f8f8f0'
        },
        rules: [
          { token: 'keyword', foreground: 'FF79C6', fontStyle: 'bold' },
          { token: 'keyword.cs', foreground: 'FF79C6', fontStyle: 'bold' },
          { token: 'comment', foreground: '6272A4', fontStyle: 'italic' },
          { token: 'string', foreground: 'F1FA8C' },
          { token: 'number', foreground: 'BD93F9' },
          { token: 'type', foreground: '8BE9FD' },
          { token: 'class', foreground: '8BE9FD' },
          { token: 'interface', foreground: '8BE9FD', fontStyle: 'italic' },
          { token: 'method', foreground: '50FA7B' },
          { token: 'property', foreground: 'F8F8F2' },
          { token: 'parameter', foreground: 'FFB86C' }
        ]
      }
    ]
  },
  {
    id: 'vscode:enkia.tokyo-night',
    name: 'tokyo-night',
    displayName: 'Tokyo Night Theme',
    publisher: 'enkia',
    version: '1.1.0',
    description: 'Clean dark Tokyo Night editor theme tuned for C# & TypeScript readability.',
    source: 'vscode',
    downloads: 3200000,
    rating: 4.9,
    categories: ['Themes'],
    themes: [
      {
        id: 'ext-tokyo-night',
        label: 'Tokyo Night',
        uiTheme: 'vs-dark',
        colors: {
          'editor.background': '#1a1b26',
          'editor.foreground': '#c0caf5',
          'editorLineNumber.foreground': '#565f89',
          'editor.selectionBackground': '#283457',
          'editor.lineHighlightBackground': '#24283b',
          'editorCursor.foreground': '#c0caf5'
        },
        rules: [
          { token: 'keyword', foreground: 'BB9AF7', fontStyle: 'bold' },
          { token: 'keyword.cs', foreground: 'BB9AF7', fontStyle: 'bold' },
          { token: 'comment', foreground: '565F89', fontStyle: 'italic' },
          { token: 'string', foreground: '9ECE6A' },
          { token: 'number', foreground: 'FF9E64' },
          { token: 'type', foreground: '2AC3DE' },
          { token: 'class', foreground: '2AC3DE' },
          { token: 'interface', foreground: '73DACA' },
          { token: 'method', foreground: '7AA2F7' },
          { token: 'property', foreground: '7DCFFF' },
          { token: 'parameter', foreground: 'E0AF68' }
        ]
      }
    ]
  },
  {
    id: 'jetbrains:Roslynator',
    name: 'Roslynator',
    displayName: 'Roslynator Refactorings & Analyzers',
    publisher: 'Josef Pihrt / JetBrains',
    version: '4.12.9',
    description: '500+ Roslyn analyzers, quick fixes & code refactorings for C# solutions.',
    source: 'jetbrains',
    downloads: 1900000,
    rating: 4.9,
    categories: ['Code Analysis', 'C#'],
    homepageUrl: 'https://plugins.jetbrains.com/'
  },
  {
    id: 'jetbrains:com.jetbrains.rider.keymap',
    name: 'RiderKeymap',
    displayName: 'JetBrains Rider Keymap & Navigation',
    publisher: 'JetBrains',
    version: '2025.1',
    description: 'Authentic Rider macOS keybindings (⌘B, ⌥⌘B, ⌥F7, ⌥F8, ⌥⌘←/→) for C# navigation.',
    source: 'jetbrains',
    downloads: 920000,
    rating: 4.8,
    categories: ['Keymaps']
  },
  {
    id: 'vscode:humao.rest-client',
    name: 'rest-client',
    displayName: 'REST Client (.http / cURL)',
    publisher: 'humao',
    version: '0.25.1',
    description: 'Send HTTP requests directly and generate executable cURL commands from endpoints.',
    source: 'vscode',
    downloads: 5100000,
    rating: 4.8,
    categories: ['HTTP', 'Testing']
  }
];

interface ExtensionsPanelProps {
  installedExtensions: MarketplaceExtension[];
  onInstallExtension: (ext: MarketplaceExtension) => Promise<void>;
  onUninstallExtension: (id: string) => Promise<void>;
  onToggleExtension: (id: string, enabled: boolean) => Promise<void>;
  onApplyTheme?: (theme: NonNullable<MarketplaceExtension['themes']>[number]) => void;
  activeEditorTheme?: string;
}

export const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({
  installedExtensions,
  onInstallExtension,
  onUninstallExtension,
  onToggleExtension,
  onApplyTheme,
  activeEditorTheme
}) => {
  const [subTab, setSubTab] = useState<'marketplace' | 'installed'>('marketplace');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'vscode' | 'jetbrains'>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketplaceExtension[]>(CURATED_EXTENSIONS);
  const [isSearching, setIsSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const installedIds = new Set(installedExtensions.map(e => e.id));

  const runSearch = async (q: string, src: 'all' | 'vscode' | 'jetbrains') => {
    setIsSearching(true);
    setStatusNotice(null);
    try {
      if (window.electronAPI?.extensionsSearch) {
        const res = await window.electronAPI.extensionsSearch(q || 'csharp', src);
        if (res && res.length > 0) {
          setResults(res);
          return;
        }
      }

      // Browser fallback: query Open VSX public REST API when possible, plus filter curated
      const cleanQ = q.trim().toLowerCase();
      let liveVscode: MarketplaceExtension[] = [];
      if (src === 'all' || src === 'vscode') {
        try {
          const resp = await fetch(
            `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q.trim() || 'csharp')}&size=12&sortBy=downloadCount`
          );
          if (resp.ok) {
            const data = await resp.json();
            liveVscode = (data.extensions || []).map((ext: any) => ({
              id: `vscode:${ext.namespace}.${ext.name}`,
              name: ext.name,
              displayName: ext.displayName || ext.name,
              publisher: ext.namespace,
              version: ext.version || '1.0.0',
              description: ext.description || 'VS Code extension from Open VSX Registry',
              source: 'vscode' as const,
              downloadUrl: ext.files?.download,
              homepageUrl: ext.url || `https://open-vsx.org/extension/${ext.namespace}/${ext.name}`,
              downloads: ext.downloadCount,
              rating: ext.averageRating,
              categories: ext.categories || [],
              iconUrl: ext.files?.icon
            }));
          }
        } catch {
          // Offline or CORS restricted; fallback to curated below
        }
      }

      const curatedMatches = CURATED_EXTENSIONS.filter(ext => {
        if (src !== 'all' && ext.source !== src) return false;
        if (!cleanQ) return true;
        return (
          ext.displayName.toLowerCase().includes(cleanQ) ||
          ext.description.toLowerCase().includes(cleanQ) ||
          ext.publisher.toLowerCase().includes(cleanQ) ||
          (ext.categories || []).some(c => c.toLowerCase().includes(cleanQ))
        );
      });

      const merged = [...curatedMatches];
      for (const lv of liveVscode) {
        if (!merged.some(m => m.id === lv.id)) {
          merged.push(lv);
        }
      }
      setResults(merged);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!query.trim()) {
        const filteredCurated = CURATED_EXTENSIONS.filter(
          e => sourceFilter === 'all' || e.source === sourceFilter
        );
        setResults(filteredCurated);
      } else {
        runSearch(query, sourceFilter);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query, sourceFilter]);

  const displayedList =
    subTab === 'installed'
      ? installedExtensions
      : results.map(r => {
          const inst = installedExtensions.find(i => i.id === r.id);
          return inst ? { ...r, ...inst, installed: true } : r;
        });

  const handleInstall = async (ext: MarketplaceExtension) => {
    setBusyId(ext.id);
    setStatusNotice(null);
    try {
      await onInstallExtension(ext);
      setStatusNotice(`Installed ${ext.displayName}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1f22] text-[#bcbec4] text-xs select-none overflow-hidden">
      {/* Header */}
      <div className="h-8 bg-[#26282b] border-b border-[#2b2d30] px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5">
          <Blocks className="w-3.5 h-3.5 text-purple-400" />
          <span className="uppercase text-[11px] text-[#868a91] font-bold">
            Extensions & Plugins
          </span>
        </div>
        <span className="text-[10px] bg-[#1e1f22] text-purple-300 border border-[#393b40] px-1.5 py-0.2 rounded">
          {installedExtensions.length} installed
        </span>
      </div>

      {/* Mode Tabs: Marketplace vs Installed */}
      <div className="p-2 border-b border-[#2b2d30] space-y-2 shrink-0 bg-[#212327]">
        <div className="grid grid-cols-2 gap-1 bg-[#18191c] p-0.5 rounded border border-[#393b40]">
          <button
            type="button"
            onClick={() => setSubTab('marketplace')}
            className={`py-1 rounded text-[11px] font-medium transition ${
              subTab === 'marketplace'
                ? 'bg-[#3574f0] text-white'
                : 'text-[#868a91] hover:text-white'
            }`}
          >
            Marketplace
          </button>
          <button
            type="button"
            onClick={() => setSubTab('installed')}
            className={`py-1 rounded text-[11px] font-medium transition ${
              subTab === 'installed'
                ? 'bg-[#3574f0] text-white'
                : 'text-[#868a91] hover:text-white'
            }`}
          >
            Installed ({installedExtensions.length})
          </button>
        </div>

        {subTab === 'marketplace' && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch(query, sourceFilter);
              }}
              className="relative"
            >
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search VS Code / JetBrains plugins..."
                className="w-full bg-[#18191c] border border-[#393b40] rounded pl-8 pr-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#3574f0]"
              />
            </form>

            {/* Registry Filter */}
            <div className="flex items-center space-x-1 text-[10px]">
              {(['all', 'vscode', 'jetbrains'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(src)}
                  className={`px-2 py-0.5 rounded border transition ${
                    sourceFilter === src
                      ? 'bg-[#3574f0]/25 border-[#3574f0] text-white font-semibold'
                      : 'bg-[#18191c] border-[#393b40] text-gray-400 hover:text-white'
                  }`}
                >
                  {src === 'all' ? 'All Registries' : src === 'vscode' ? 'VS Code (Open VSX)' : 'JetBrains'}
                </button>
              ))}
            </div>
          </>
        )}

        {statusNotice && (
          <div className="text-[11px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2 py-1 rounded flex items-center space-x-1">
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{statusNotice}</span>
          </div>
        )}
      </div>

      {/* Extensions List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {isSearching ? (
          <div className="flex items-center justify-center py-8 text-gray-400 space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#3574f0]" />
            <span>Searching Open VSX & JetBrains Marketplace...</span>
          </div>
        ) : displayedList.length === 0 ? (
          <div className="text-center text-gray-500 py-8 px-3">
            {subTab === 'installed'
              ? 'No extensions installed yet. Browse the Marketplace tab to install VS Code themes, C# analyzers, or JetBrains plugins.'
              : 'No matching extensions found. Try searching "csharp", "dracula", "roslyn", or "rider".'}
          </div>
        ) : (
          displayedList.map((ext) => {
            const isInstalled = installedIds.has(ext.id) || Boolean(ext.installed);
            const isEnabled = ext.enabled !== false;
            const isBusy = busyId === ext.id;
            const firstTheme = ext.themes && ext.themes[0];

            return (
              <div
                key={ext.id}
                className="p-2.5 rounded-lg bg-[#26282b] border border-[#393b40] hover:border-[#4e5157] space-y-1.5 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-semibold text-[#dfe1e5] truncate">{ext.displayName}</span>
                      <span
                        className={`text-[9px] px-1 rounded font-mono shrink-0 ${
                          ext.source === 'vscode'
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {ext.source === 'vscode' ? 'VS Code' : 'JetBrains'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono truncate">
                      {ext.publisher} · v{ext.version}
                    </div>
                  </div>

                  {ext.homepageUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.electronAPI?.openExternal) {
                          window.electronAPI.openExternal(ext.homepageUrl!);
                        }
                      }}
                      className="p-1 text-gray-500 hover:text-white rounded shrink-0"
                      title="Open Plugin Page"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
                  {ext.description}
                </p>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center space-x-1.5">
                    {!isInstalled ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleInstall(ext)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#3574f0] hover:bg-[#2c66db] text-white font-medium text-[11px] disabled:opacity-50 transition"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        <span>{isBusy ? 'Installing...' : 'Install'}</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleExtension(ext.id, !isEnabled)}
                          className={`flex items-center space-x-1 px-2 py-1 rounded border text-[11px] transition ${
                            isEnabled
                              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                              : 'bg-[#1e1f22] border-[#393b40] text-gray-400'
                          }`}
                          title={isEnabled ? 'Disable Extension' : 'Enable Extension'}
                        >
                          <Power className="w-3 h-3" />
                          <span>{isEnabled ? 'Enabled' : 'Disabled'}</span>
                        </button>

                        {firstTheme && onApplyTheme && isEnabled && (
                          <button
                            type="button"
                            onClick={() => onApplyTheme(firstTheme)}
                            className={`flex items-center space-x-1 px-2 py-1 rounded border text-[11px] transition ${
                              activeEditorTheme === firstTheme.id
                                ? 'bg-purple-500/25 border-purple-400 text-purple-200 font-semibold'
                                : 'bg-[#1e1f22] hover:bg-purple-500/20 border-[#393b40] text-purple-300'
                            }`}
                          >
                            <Palette className="w-3 h-3" />
                            <span>
                              {activeEditorTheme === firstTheme.id ? 'Active Theme' : 'Apply Theme'}
                            </span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onUninstallExtension(ext.id)}
                          className="p-1 text-gray-500 hover:text-red-400 rounded transition"
                          title="Uninstall Extension"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>

                  {ext.downloads && (
                    <span className="text-[10px] text-gray-500 font-mono">
                      {ext.downloads >= 1000000
                        ? `${(ext.downloads / 1000000).toFixed(1)}M`
                        : ext.downloads >= 1000
                        ? `${Math.round(ext.downloads / 1000)}K`
                        : ext.downloads}{' '}
                      dl
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
