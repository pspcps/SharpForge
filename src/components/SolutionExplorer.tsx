import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileJson, 
  FileText, 
  Box, 
  Layers, 
  Globe, 
  Library, 
  FlaskConical, 
  MoreVertical, 
  Plus, 
  Trash2, 
  FolderInput, 
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Package,
  FolderSync,
  LocateFixed,
  FileCode2
} from 'lucide-react';
import { SolutionFile, ProjectItem, SolutionFileItem, NuGetPackage } from '../types/minirider';

interface SolutionExplorerProps {
  solution: SolutionFile;
  selectedFile: SolutionFileItem | null;
  onSelectFile: (file: SolutionFileItem) => void;
  selectedProject: ProjectItem;
  onSetStartupProject: (project: ProjectItem) => void;
  onRevealInFinder: (filePath: string) => void;
  onOpenNuGetForProject: (project: ProjectItem) => void;
  onAddFileToProject: (project: ProjectItem, folderPath?: string) => void;
  onDeleteFile: (file: SolutionFileItem) => void;
  onBuildProject: (project: ProjectItem) => void;
  onOpenAppSettingsEnv?: (file: SolutionFileItem) => void;
  onRestoreDependencies?: () => void;
  isRestoring?: boolean;
  revealSignal?: number;
  onDecompilePackage?: (pkg: NuGetPackage, project: ProjectItem) => void;
  onDecompileDll?: (project: ProjectItem) => void;
}

export const SolutionExplorer: React.FC<SolutionExplorerProps> = ({
  solution,
  selectedFile,
  onSelectFile,
  selectedProject,
  onSetStartupProject,
  onRevealInFinder,
  onOpenNuGetForProject,
  onAddFileToProject,
  onDeleteFile,
  onBuildProject,
  onOpenAppSettingsEnv,
  onRestoreDependencies,
  isRestoring = false,
  revealSignal = 0,
  onDecompilePackage,
  onDecompileDll
}) => {
  // Expanded node tracking
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    'solution': true,
    'proj-api': true,
    'proj-core': true,
    'proj-tests': true,
    'folder-controllers': true,
    'folder-models': true,
    'folder-services': true,
    'folder-unit-tests': true,
    'dep-proj-api': true,
    'pkg-proj-api': true
  });

  // Auto-expand loaded solution & projects when switching or opening a real .sln/.slnx
  useEffect(() => {
    setExpandedNodes(prev => {
      const next: Record<string, boolean> = { ...prev, solution: true };
      solution.projects.forEach(p => {
        next[p.id] = true;
      });
      return next;
    });
  }, [solution.path, solution.name]);

  const treeContainerRef = React.useRef<HTMLDivElement>(null);

  const selectOpenedFileInTree = React.useCallback(() => {
    if (!selectedFile) return;

    const findAncestors = (
      items: SolutionFileItem[],
      target: SolutionFileItem,
      trail: string[]
    ): string[] | null => {
      for (const item of items) {
        if (item.id === target.id || item.path === target.path) {
          return trail;
        }
        if (item.isDirectory && item.children) {
          const found = findAncestors(item.children, target, [...trail, item.id]);
          if (found) return found;
        }
      }
      return null;
    };

    for (const proj of solution.projects) {
      const ancestors = findAncestors(proj.files, selectedFile, ['solution', proj.id]);
      if (ancestors) {
        setExpandedNodes(prev => {
          const next = { ...prev };
          ancestors.forEach(id => {
            next[id] = true;
          });
          return next;
        });
        setTimeout(() => {
          const el = treeContainerRef.current?.querySelector(
            `[data-file-id="${CSS.escape(selectedFile.id)}"]`
          );
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 60);
        return;
      }
    }
  }, [selectedFile, solution.projects]);

  useEffect(() => {
    if (revealSignal > 0 && selectedFile) {
      selectOpenedFileInTree();
    }
  }, [revealSignal, selectedFile, selectOpenedFileInTree]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'project' | 'file' | 'folder';
    target: any;
  } | null>(null);

  const toggleNode = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const collapseAll = () => {
    setExpandedNodes({});
  };

  const expandAll = () => {
    const all: Record<string, boolean> = { solution: true };
    solution.projects.forEach(p => {
      all[p.id] = true;
      all[`dep-${p.id}`] = true;
      all[`pkg-${p.id}`] = true;
      const walk = (items: SolutionFileItem[]) => {
        items.forEach(i => {
          if (i.isDirectory) {
            all[i.id] = true;
            if (i.children) walk(i.children);
          }
        });
      };
      walk(p.files);
    });
    setExpandedNodes(all);
  };

  const getProjectIcon = (type: ProjectItem['projectType']) => {
    switch (type) {
      case 'webapi':
        return <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      case 'test':
        return <FlaskConical className="w-3.5 h-3.5 text-green-400 shrink-0" />;
      case 'console':
        return <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      default:
        return <Library className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    }
  };

  const getFileIcon = (fileName: string, ext: string) => {
    if (ext === '.cs') {
      return (
        <span className="w-3.5 h-3.5 rounded bg-emerald-600/20 text-emerald-400 font-mono text-[9px] font-bold flex items-center justify-center shrink-0 border border-emerald-500/30">
          C#
        </span>
      );
    }
    if (ext === '.csproj' || ext === '.sln' || ext === '.slnx') {
      return <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    }
    if (ext === '.json') {
      return <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    return <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  };

  const renderFileTree = (items: SolutionFileItem[], project: ProjectItem) => {
    return items.map(item => {
      if (item.isDirectory) {
        const isExpanded = !!expandedNodes[item.id];
        return (
          <div key={item.id} className="select-none">
            <div
              onClick={() => toggleNode(item.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', target: { folder: item, project } });
              }}
              className="flex items-center space-x-1.5 py-1 px-2 hover:bg-[#2b2d30] rounded cursor-pointer group text-[#bcbec4] hover:text-[#dfe1e5]"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
              )}
              <span className="truncate text-xs">{item.name}</span>
            </div>

            {isExpanded && item.children && (
              <div className="pl-4 border-l border-[#2b2d30]/60 ml-3">
                {renderFileTree(item.children, project)}
              </div>
            )}
          </div>
        );
      } else {
        const isSelected = selectedFile?.id === item.id;
        return (
          <div
            key={item.id}
            data-file-id={item.id}
            onClick={() => onSelectFile(item)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', target: item });
            }}
            className={`flex items-center space-x-1.5 py-1 px-2 rounded cursor-pointer transition select-none group ${
              isSelected
                ? 'bg-[#3574f0]/25 text-[#3574f0] font-medium border-l-2 border-[#3574f0]'
                : 'text-[#bcbec4] hover:text-white hover:bg-[#2b2d30]'
            }`}
          >
            <span className="w-3.5 flex justify-center shrink-0">
              {getFileIcon(item.name, item.extension)}
            </span>
            <span className="truncate text-xs">{item.name}</span>
          </div>
        );
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1f22] text-[#bcbec4] text-xs overflow-hidden select-none">
      {/* Solution Explorer Title Bar */}
      <div className="h-8 bg-[#26282b] border-b border-[#2b2d30] px-3 flex items-center justify-between font-semibold tracking-wide text-[#dfe1e5]">
        <span className="uppercase text-[11px] text-[#868a91] font-bold">Solution Explorer</span>
        <div className="flex items-center space-x-1">
          <button
            onClick={selectOpenedFileInTree}
            disabled={!selectedFile}
            className="p-1 hover:bg-[#35373c] rounded text-[#868a91] hover:text-emerald-400 disabled:opacity-40"
            title="Select Opened File in Solution Explorer"
          >
            <LocateFixed className="w-3.5 h-3.5" />
          </button>
          {onRestoreDependencies && (
            <button
              onClick={onRestoreDependencies}
              disabled={isRestoring}
              className="p-1 hover:bg-[#35373c] rounded text-[#868a91] hover:text-sky-400 disabled:opacity-50"
              title="Restore NuGet & Refresh Dependency Graph (dotnet restore)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          )}
          <button
            onClick={collapseAll}
            className="p-1 hover:bg-[#35373c] rounded text-[#868a91] hover:text-[#dfe1e5]"
            title="Collapse All"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={expandAll}
            className="p-1 hover:bg-[#35373c] rounded text-[#868a91] hover:text-[#dfe1e5]"
            title="Expand All"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onRevealInFinder(solution.path)}
            className="p-1 hover:bg-[#35373c] rounded text-[#868a91] hover:text-[#dfe1e5]"
            title="Reveal Solution in Finder"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div ref={treeContainerRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Solution Root Node */}
        <div className="mb-2">
          <div
            onClick={() => toggleNode('solution')}
            className="flex items-center space-x-1.5 py-1 px-1.5 hover:bg-[#2b2d30] rounded cursor-pointer font-medium text-slate-200"
          >
            {expandedNodes['solution'] ? (
              <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            )}
            <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-semibold text-xs tracking-tight truncate">{solution.name}</span>
            <span className="text-[10px] bg-[#2b2d30] text-[#868a91] px-1.5 py-0.2 rounded border border-[#393b40]">
              {solution.projects.length} {solution.projects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>

          {/* Solution Projects List */}
          {expandedNodes['solution'] && (
            <div className="pl-3 mt-1 space-y-1 border-l border-[#2b2d30]/80 ml-2">
              {solution.projects.map(project => {
                const isProjectExpanded = !!expandedNodes[project.id];
                const isStartup = selectedProject?.id === project.id;
                const depKey = `dep-${project.id}`;
                const pkgKey = `pkg-${project.id}`;

                return (
                  <div key={project.id} className="space-y-0.5">
                    {/* Project Node */}
                    <div
                      onClick={() => toggleNode(project.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, type: 'project', target: project });
                      }}
                      className={`flex items-center justify-between py-1 px-1.5 hover:bg-[#2b2d30] rounded cursor-pointer group ${
                        isStartup ? 'bg-[#3574f0]/10 border-l-2 border-[#3574f0]' : ''
                      }`}
                    >
                      <div className="flex items-center space-x-1.5 truncate">
                        {isProjectExpanded ? (
                          <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />
                        )}
                        {getProjectIcon(project.projectType)}
                        <span className={`text-xs truncate ${isStartup ? 'text-[#dfe1e5] font-semibold' : 'text-[#bcbec4]'}`}>
                          {project.name}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0">
                        {isStartup && (
                          <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded border border-blue-500/30 font-medium">
                            Startup
                          </span>
                        )}
                        <span className="text-[9px] text-[#868a91] bg-[#1e1f22] px-1 rounded border border-[#2b2d30]">
                          {project.targetFramework}
                        </span>
                      </div>
                    </div>

                    {/* Project Children: Dependencies & Source Files */}
                    {isProjectExpanded && (
                      <div className="pl-4 space-y-0.5 border-l border-[#2b2d30]/60 ml-2">
                        {/* Dependencies Node */}
                        <div>
                          <div
                            onClick={() => toggleNode(depKey)}
                            className="flex items-center space-x-1.5 py-1 px-2 hover:bg-[#2b2d30] rounded cursor-pointer text-[#868a91] hover:text-[#dfe1e5]"
                          >
                            {expandedNodes[depKey] ? (
                              <ChevronDown className="w-3 h-3 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3 h-3 shrink-0" />
                            )}
                            <Box className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span className="text-xs">Dependencies</span>
                          </div>

                          {expandedNodes[depKey] && (
                            <div className="pl-4 space-y-0.5 border-l border-[#2b2d30]/60 ml-2">
                              {/* Frameworks */}
                              <div className="py-0.5 px-2 text-[11px] text-[#868a91] flex items-center space-x-1.5">
                                <Library className="w-3 h-3 text-slate-500" />
                                <span>Framework: {project.dependencies.frameworks.join(', ')}</span>
                              </div>

                              {/* Packages Node */}
                              <div>
                                <div
                                  onClick={() => toggleNode(pkgKey)}
                                  className="flex items-center justify-between py-0.5 px-2 hover:bg-[#2b2d30] rounded cursor-pointer text-[#868a91] hover:text-[#dfe1e5]"
                                >
                                  <div className="flex items-center space-x-1.5">
                                    {expandedNodes[pkgKey] ? (
                                      <ChevronDown className="w-2.5 h-2.5 shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                                    )}
                                    <Package className="w-3 h-3 text-amber-500" />
                                    <span className="text-[11px]">Packages ({project.dependencies.packages.length})</span>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenNuGetForProject(project);
                                    }}
                                    className="text-[10px] text-blue-400 hover:underline"
                                    title="Manage NuGet packages"
                                  >
                                    Manage
                                  </button>
                                </div>

                                {expandedNodes[pkgKey] && (
                                  <div className="pl-4 space-y-0.5 border-l border-[#2b2d30]/40 ml-2">
                                    {onDecompileDll && (
                                      <button
                                        type="button"
                                        onClick={() => onDecompileDll(project)}
                                        className="w-full py-1 px-1.5 mb-0.5 rounded bg-[#26282b] hover:bg-[#3574f0]/20 border border-[#393b40] text-[10px] text-sky-300 flex items-center space-x-1.5 transition"
                                        title="Pick any .dll assembly to decompile to C#"
                                      >
                                        <FileCode2 className="w-3 h-3 shrink-0" />
                                        <span>Decompile .dll Assembly...</span>
                                      </button>
                                    )}
                                    {project.dependencies.packages.map(pkg => (
                                      <div
                                        key={pkg.id}
                                        onClick={() => onOpenNuGetForProject(project)}
                                        className="group py-0.5 px-1.5 hover:bg-[#2b2d30] rounded flex items-center justify-between text-[11px] text-[#bcbec4] hover:text-white cursor-pointer"
                                      >
                                        <span className="truncate">{pkg.id}</span>
                                        <div className="flex items-center space-x-1 shrink-0 ml-1">
                                          <span className="text-[10px] text-slate-500 font-mono">{pkg.version}</span>
                                          {onDecompilePackage && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onDecompilePackage(pkg, project);
                                              }}
                                              className="opacity-70 group-hover:opacity-100 p-0.5 rounded hover:bg-[#3574f0] text-sky-300 hover:text-white transition"
                                              title={`Decompile ${pkg.id}.dll to C#`}
                                            >
                                              <FileCode2 className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Project References */}
                              {project.dependencies.projectReferences.length > 0 && (
                                <div className="space-y-0.5">
                                  <div className="py-0.5 px-2 text-[11px] text-[#868a91] flex items-center space-x-1.5">
                                    <Layers className="w-3 h-3 text-purple-400" />
                                    <span>Projects ({project.dependencies.projectReferences.length})</span>
                                  </div>
                                  <div className="pl-4 space-y-0.5">
                                    {project.dependencies.projectReferences.map(ref => (
                                      <div key={ref} className="py-0.5 px-1.5 text-[11px] text-[#bcbec4]">
                                        → {ref}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Project Files & Folders */}
                        {renderFileTree(project.files, project)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50 bg-black/10"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="absolute bg-[#26282b] border border-[#393b40] rounded shadow-xl py-1 text-xs text-[#dfe1e5] w-52 z-50 font-sans"
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.type === 'project' && (
              <>
                <button
                  onClick={() => {
                    onSetStartupProject(contextMenu.target);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Set as Startup Project</span>
                </button>
                <button
                  onClick={() => {
                    onBuildProject(contextMenu.target);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Build {contextMenu.target.name}</span>
                </button>
                <button
                  onClick={() => {
                    onOpenNuGetForProject(contextMenu.target);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <Box className="w-3.5 h-3.5 text-sky-400" />
                  <span>Manage NuGet Packages...</span>
                </button>
                <div className="border-t border-[#393b40] my-1" />
                <button
                  onClick={() => {
                    onAddFileToProject(contextMenu.target);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add New C# File...</span>
                </button>
                <button
                  onClick={() => {
                    onRevealInFinder(contextMenu.target.path);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Reveal in Finder</span>
                </button>
              </>
            )}

            {contextMenu.type === 'file' && (
              <>
                <button
                  onClick={() => {
                    onSelectFile(contextMenu.target);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Open in Editor</span>
                </button>
                <button
                  onClick={() => {
                    onRevealInFinder(contextMenu.target.path);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Reveal in Finder</span>
                </button>
                {contextMenu.target.name.toLowerCase().includes('appsettings') && (
                  <button
                    onClick={() => {
                      onOpenAppSettingsEnv?.(contextMenu.target);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2 bg-amber-500/10 text-amber-300 font-semibold"
                  >
                    <FolderSync className="w-3.5 h-3.5 text-amber-400" />
                    <span>Set & Configure Env Variables...</span>
                  </button>
                )}
                <div className="border-t border-[#393b40] my-1" />
                <button
                  onClick={() => {
                    onDeleteFile(contextMenu.target);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-red-600 hover:text-white text-red-400 flex items-center space-x-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete File</span>
                </button>
              </>
            )}

            {contextMenu.type === 'folder' && (
              <>
                <button
                  onClick={() => {
                    onAddFileToProject(contextMenu.target.project, contextMenu.target.folder.relativePath);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New File in {contextMenu.target.folder.name}...</span>
                </button>
                <button
                  onClick={() => {
                    onRevealInFinder(contextMenu.target.folder.path);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3574f0] hover:text-white flex items-center space-x-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Reveal Folder in Finder</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
