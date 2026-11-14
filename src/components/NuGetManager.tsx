import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Search, 
  Download, 
  Trash2, 
  Check, 
  RefreshCw,
  PackageCheck
} from 'lucide-react';
import { ProjectItem } from '../types/minirider';
import { POPULAR_NUGET_PACKAGES } from '../data/sampleSolutions';

interface NuGetCatalogItem {
  id: string;
  version: string;
  downloads: string;
  description: string;
}

interface NuGetManagerProps {
  projects: ProjectItem[];
  selectedProject: ProjectItem;
  onSelectProject: (project: ProjectItem) => void;
  onInstallPackage: (project: ProjectItem, packageId: string, version: string) => void;
  onUninstallPackage: (project: ProjectItem, packageId: string) => void;
}

function formatDownloads(num?: number): string {
  if (!num) return 'Popular';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return String(num);
}

export const NuGetManager: React.FC<NuGetManagerProps> = ({
  projects,
  selectedProject,
  onSelectProject,
  onInstallPackage,
  onUninstallPackage
}) => {
  const [activeTab, setActiveTab] = useState<'browse' | 'installed'>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [remotePackages, setRemotePackages] = useState<NuGetCatalogItem[]>([]);
  const [isSearchingNuget, setIsSearchingNuget] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  // Query live nuget.org v3 API when typing in Browse mode
  useEffect(() => {
    const q = searchQuery.trim();
    if (activeTab !== 'browse' || q.length < 2) {
      setRemotePackages([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearchingNuget(true);
      try {
        const res = await fetch(
          `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(q)}&take=15&prerelease=false`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          const items: NuGetCatalogItem[] = (data.data || []).map((item: any) => ({
            id: item.id,
            version: item.version || '1.0.0',
            downloads: formatDownloads(item.totalDownloads),
            description: item.description || item.title || 'NuGet package'
          }));
          setRemotePackages(items);
        }
      } catch {
        // Fallback silently to curated local catalog
      } finally {
        setIsSearchingNuget(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, activeTab]);

  const localFiltered = POPULAR_NUGET_PACKAGES.filter(p =>
    p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredCatalog = remotePackages.length > 0 ? remotePackages : localFiltered;

  const installedPackages = selectedProject.dependencies.packages.filter(p =>
    p.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleInstallClick = (packageId: string, version: string) => {
    setInstallingId(packageId);
    setTimeout(() => {
      onInstallPackage(selectedProject, packageId, version);
      setInstallingId(null);
    }, 500);
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1f22] text-[#bcbec4] text-xs select-none">
      {/* NuGet Header */}
      <div className="h-10 bg-[#26282b] border-b border-[#1e1f22] px-3 flex items-center justify-between">
        <div className="flex items-center space-x-2 truncate">
          <div className="flex items-center space-x-1.5 font-bold text-slate-200 shrink-0">
            <Box className="w-4 h-4 text-sky-400" />
            <span>NuGet</span>
          </div>

          <select
            value={selectedProject.name}
            onChange={(e) => {
              const found = projects.find(p => p.name === e.target.value);
              if (found) onSelectProject(found);
            }}
            className="bg-[#1e1f22] text-white border border-[#393b40] rounded px-1.5 py-0.5 text-[11px] focus:outline-none max-w-[120px] truncate"
          >
            {projects.map(p => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.dependencies.packages.length})
              </option>
            ))}
          </select>
        </div>

        {/* Tab switch */}
        <div className="flex items-center space-x-1 bg-[#1e1f22] p-0.5 rounded border border-[#393b40] shrink-0">
          <button
            onClick={() => setActiveTab('browse')}
            className={`px-2 py-0.5 rounded text-[11px] transition ${
              activeTab === 'browse' ? 'bg-[#3574f0] text-white font-medium' : 'text-[#868a91] hover:text-white'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setActiveTab('installed')}
            className={`px-2 py-0.5 rounded text-[11px] transition ${
              activeTab === 'installed' ? 'bg-[#3574f0] text-white font-medium' : 'text-[#868a91] hover:text-white'
            }`}
          >
            Installed ({selectedProject.dependencies.packages.length})
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="p-2 bg-[#212327] border-b border-[#2b2d30]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
          <input
            type="text"
            placeholder={activeTab === 'browse' ? 'Search nuget.org (live v3 feed)...' : 'Filter installed packages...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1e1f22] text-white border border-[#393b40] rounded pl-8 pr-3 py-1 text-xs focus:outline-none focus:border-blue-500"
          />
          {isSearchingNuget && (
            <RefreshCw className="w-3 h-3 animate-spin text-blue-400 absolute right-2.5 top-2" />
          )}
        </div>
      </div>

      {/* Packages List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {activeTab === 'browse' ? (
          filteredCatalog.map(pkg => {
            const isInstalled = selectedProject.dependencies.packages.some(p => p.id.toLowerCase() === pkg.id.toLowerCase());
            const isInstalling = installingId === pkg.id;

            return (
              <div
                key={pkg.id}
                className="p-2.5 bg-[#26282b] rounded-lg border border-[#2b2d30] hover:border-[#393b40] transition space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <span className="font-bold text-slate-200 text-xs truncate">{pkg.id}</span>
                      <span className="text-[10px] bg-[#1e1f22] text-gray-400 px-1.5 py-0.2 rounded border border-[#393b40]">
                        v{pkg.version}
                      </span>
                      <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded">
                        {pkg.downloads}
                      </span>
                    </div>
                    <p className="text-gray-400 text-[11px] line-clamp-2">{pkg.description}</p>
                  </div>

                  {isInstalled ? (
                    <div className="flex items-center space-x-1 text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/30 font-medium shrink-0 text-[11px]">
                      <Check className="w-3 h-3" />
                      <span>Installed</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstallClick(pkg.id, pkg.version)}
                      disabled={isInstalling}
                      className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-500 text-white font-medium px-2.5 py-1 rounded transition shadow-sm shrink-0 text-[11px]"
                    >
                      {isInstalling ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Adding...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3" />
                          <span>Install</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          installedPackages.length === 0 ? (
            <div className="p-4 text-center text-gray-500 italic">No package dependencies found in {selectedProject.name}</div>
          ) : (
            installedPackages.map(pkg => (
              <div
                key={pkg.id}
                className="p-2.5 bg-[#26282b] rounded-lg border border-[#2b2d30] flex items-center justify-between gap-2"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center space-x-1.5">
                    <PackageCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="font-bold text-slate-200 text-xs truncate">{pkg.id}</span>
                    <span className={`text-[9px] px-1 rounded ${pkg.isDirect ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-700/60 text-slate-400'}`}>
                      {pkg.isDirect ? 'Direct' : 'Transitive'}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono truncate">
                    v{pkg.resolvedVersion || pkg.version}
                  </div>
                </div>

                {pkg.isDirect && (
                  <button
                    onClick={() => onUninstallPackage(selectedProject, pkg.id)}
                    className="flex items-center space-x-1 px-2 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded transition text-[11px] shrink-0"
                    title="Remove Package Reference"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
};
